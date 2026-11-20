---
title: Hardening Kubernetes Clusters with Least-Privilege RBAC and Zero-Trust NetworkPolicies
description: Practical patterns for auditing Kubernetes Roles, scoping CI/CD ServiceAccounts, implementing default-deny NetworkPolicies, and avoiding DNS outages.
category: Security
tags: [kubernetes, rbac, networkpolicy, zero-trust, security, serviceaccount]
published: "2026-11-20"
readingTime: "9 min read"
relatedTools: [k8s-rbac-explainer, k8s-networkpolicy, k8s-kubeconfig, k8s-label-selector]
---

By default, a fresh Kubernetes cluster is remarkably open inside the perimeter: every pod can open TCP connections to every other pod across every namespace, and over-permissive Helm charts frequently request broad `ClusterRole` permissions that nobody audits during installation.

If an attacker exploits a single public-facing web application pod, two controls decide whether the incident stays contained or becomes a full cluster takeover: **Role-Based Access Control (RBAC)** and **NetworkPolicies**.

## Part 1: Auditing and tightening Kubernetes RBAC

RBAC controls *who* (Users, Groups, or ServiceAccounts) can perform *which verbs* (`get`, `list`, `watch`, `create`, `update`, `patch`, `delete`) on *which API resources*.

### High-risk RBAC patterns to eliminate

When reviewing a `Role` or `ClusterRole` (or auditing a third-party chart via the [RBAC Explainer](/tools/k8s-rbac-explainer/)), flag these dangerous patterns immediately:

1. **Wildcards (`"*"`) in `apiGroups`, `resources`, or `verbs`**: Wildcards grant access not only to every built-in resource (including `secrets`), but also to any Custom Resource Definitions (CRDs) installed in the future.
2. **Cluster-wide `get`/`list` on `secrets`**: Anyone who can read all Secrets across namespaces can harvest database passwords, TLS private keys, and cloud credentials.
3. **`create` on `pods/exec` or `pods`**: Allows an identity to run arbitrary commands inside existing privileged pods or spawn a new pod mounting the host filesystem (`hostPath`).
4. **`escalate`, `bind`, and `impersonate` verbs**: These special verbs explicitly allow a subject to bypass Kubernetes privilege-escalation protections and grant itself `cluster-admin`.
5. **Default ServiceAccount token auto-mounting**: Every namespace has a `default` ServiceAccount, and by default Kubernetes mounts its bearer token at `/var/run/secrets/kubernetes.io/serviceaccount/token` inside every pod. For workloads that do not call the Kubernetes API (which is 95% of application pods), set `automountServiceAccountToken: false` on both the ServiceAccount and the pod spec.

### Prefer namespaced `RoleBinding` over `ClusterRoleBinding`

Even if you want to reuse a standard `ClusterRole` (like `view` or a custom `deployer` role), bind it with a namespaced **`RoleBinding`** rather than a `ClusterRoleBinding`. A `RoleBinding` strictly confines the permissions to a single namespace.

For CI/CD pipelines that need to deploy to a specific namespace, avoid sharing a `cluster-admin` kubeconfig. Use OIDC Workload Identity where possible, or generate a namespace-scoped ServiceAccount and expiring token via `kubectl create token` using our [Service Account Kubeconfig Generator](/tools/k8s-kubeconfig/).

## Part 2: Zero-Trust pod networking with NetworkPolicies

Kubernetes `NetworkPolicy` resources act as a distributed L3/L4 firewall enforced by your CNI plugin (Calico, Cilium, Antrea, or Azure CNI Powered by Cilium).

> **Prerequisite check:** Verify your cluster's CNI actually enforces NetworkPolicies. Basic kubenet or unmanaged bridge plugins accept `NetworkPolicy` YAML into etcd without enforcing a single packet drop.

### Step 1: Apply a default-deny baseline per namespace

Before writing allow rules, establish a default-deny baseline for both ingress and egress in every application namespace:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: payments
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
```

An empty `podSelector: {}` selects **all pods** in the `payments` namespace. Because no `ingress:` or `egress:` rules are listed, all inbound and outbound traffic is blocked until another policy explicitly permits it.

### Step 2: Explicitly allow CoreDNS egress (avoiding the #1 outage)

The most common mistake when rolling out default-deny egress is forgetting DNS. Without DNS egress, pods cannot resolve Kubernetes Services or external APIs. Always pair default-deny egress with a DNS allow policy:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns-egress
  namespace: payments
spec:
  podSelector: {}
  policyTypes:
    - Egress
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
```

### Step 3: Beware the YAML dash (`-`) AND vs. OR trap

This subtle YAML difference trips up even experienced Kubernetes operators:

```yaml
# ONE list item = AND (must match BOTH namespace AND pod labels)
from:
  - namespaceSelector:
      matchLabels:
        kubernetes.io/metadata.name: ingress-nginx
    podSelector:
      matchLabels:
        app.kubernetes.io/name: ingress-nginx

# TWO list items = OR (allows ALL pods in ingress-nginx OR matching pods in current namespace!)
from:
  - namespaceSelector:
      matchLabels:
        kubernetes.io/metadata.name: ingress-nginx
  - podSelector:
      matchLabels:
        app.kubernetes.io/name: ingress-nginx
```

Adding a single stray `-` before `podSelector` turns a tight rule into an overly broad OR condition. Always verify your policies in the [NetworkPolicy Explainer](/tools/k8s-networkpolicy/) and test selectors against live pod labels using the [Label Selector Tester](/tools/k8s-label-selector/) before applying to production.

## Rollout checklist for existing clusters

1. **Audit RBAC first**: Export non-system `ClusterRoleBindings` and inspect them with the [RBAC Explainer](/tools/k8s-rbac-explainer/).
2. **Disable ServiceAccount token mounting** on standard app workloads (`automountServiceAccountToken: false`).
3. **Label your namespaces consistently** (Kubernetes 1.21+ automatically adds `kubernetes.io/metadata.name`).
4. **Roll out NetworkPolicies in staging first**, verify DNS + metrics scraping (Prometheus) + ingress controller traffic, and monitor dropped packets in Cilium Hubble or Calico logs before enforcing in production.
