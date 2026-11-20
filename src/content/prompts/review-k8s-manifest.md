---
title: Review a Kubernetes manifest
description: Get a security and reliability review of a Deployment, StatefulSet or Helm-rendered YAML.
category: Review
tags: [kubernetes, k8s, yaml, security, aks, helm]
relatedTools: [k8s-manifest-checker, k8s-neat, k8s-redactor, yaml-json]
whenToUse: Use this prompt before opening a pull request or promoting a new Kubernetes Deployment, StatefulSet, or Helm-rendered manifest to production. It guides the AI to prioritize real security, availability, and operational risks rather than stylistic nitpicks.
tips:
  - Render Helm charts or Kustomize overlays first (helm template ...) so the review covers the exact YAML submitted to the Kubernetes API server.
  - Specify your exact Kubernetes version and cloud provider (AKS, EKS, GKE) so the model does not suggest deprecated APIs or incompatible annotations.
  - Run the manifest through the Kubernetes Manifest Checker locally first for instant deterministic checks, then use this prompt for architectural trade-offs like graceful shutdown and PodDisruptionBudgets.
variables:
  - name: platform
    label: Cluster platform and version
    placeholder: AKS 1.30, Azure CNI, Traefik ingress
  - name: workload
    label: What the workload does
    placeholder: Public REST API, stateless, ~200 req/s at peak
  - name: manifest
    label: Manifest YAML
    placeholder: Paste the rendered YAML (helm template ... or kubectl get -o yaml)
    multiline: true
  - name: concerns
    label: Anything specific to look at
    placeholder: We had OOMKilled pods last week
    optional: true
---
You are a senior Kubernetes platform engineer. Review the manifest below for production readiness.

Context:
- Platform: {{platform}}
- Workload: {{workload}}
{{#concerns}}
- Specific concern: {{concerns}}
{{/concerns}}

Check these areas and report only real problems, most severe first:
1. Security: securityContext, root user, privilege escalation, capabilities, host namespaces, secrets in plain text, service account token.
2. Reliability: replicas, resource requests and limits, probes, PodDisruptionBudget, anti-affinity or topology spread, graceful shutdown.
3. Operability: image tag pinning, labels, rollout strategy.

For each finding give: severity (high, medium, low), the exact YAML path, why it matters for this workload, and a corrected YAML snippet. End with a full corrected manifest. Do not invent fields that do not exist in the Kubernetes API for this version.

```yaml
{{manifest}}
```
