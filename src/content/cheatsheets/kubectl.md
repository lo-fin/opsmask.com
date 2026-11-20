---
title: kubectl
description: Day-to-day kubectl commands for inspecting, debugging, rolling back, and troubleshooting Kubernetes workloads safely.
tags: [kubernetes, k8s, aks, eks, gke, debug, pods, kubectl]
updated: "2026-11-20"
---

This `kubectl` reference focuses on the commands SREs and platform engineers actually run during incidents, deployments, and routine cluster maintenance. Every command is designed to be copy-ready and safe to run against production clusters—mutating operations include notes on GitOps controllers like ArgoCD and Flux.

## Context and namespace

Before running any write command, confirm your active kubeconfig context and default namespace. Mistakenly running a rollout or delete against production instead of staging is one of the most common operator errors.

```bash
# List all configured contexts (* marks the active context)
kubectl config get-contexts

# Switch to a specific cluster context
kubectl config use-context my-aks-prod

# Set a default namespace so you do not have to repeat -n on every command
kubectl config set-context --current --namespace=app

# Print the currently active context name (useful in shell prompts and scripts)
kubectl config current-context
```

## Find what is broken

When an alert fires, start with a cluster-wide view of unhealthy pods and recent namespace events sorted chronologically. Kubernetes events expire after 1 hour by default, so capture them early during an incident.

```bash
# Pods that are not Running or Completed, across all namespaces
kubectl get pods -A --field-selector=status.phase!=Running,status.phase!=Succeeded

# Recent events in a namespace, newest at the bottom
kubectl get events -n app --sort-by=.lastTimestamp | tail -25

# Inspect container states, exit codes, probe failures, and scheduling events
kubectl describe pod <pod> -n app

# Show pod IPs, node placement, and restart counts in one table
kubectl get pods -n app -o wide
```

If `describe pod` shows `CrashLoopBackOff`, `OOMKilled` (exit code 137), or `ImagePullBackOff`, paste the sanitized output into the [Pod Status Explainer](/tools/k8s-pod-status/) to pinpoint the exact failure condition.

## Logs

Container logs are lost once a pod is deleted unless you ship them to a central logging backend (Loki, Elasticsearch, CloudWatch, or Azure Monitor). Always check `--previous` when a container has restarted.

```bash
# Tail recent logs from a Deployment (selects one pod automatically)
kubectl logs deploy/api -n app --since=15m

# Fetch logs from the crashed container instance before the latest restart
kubectl logs <pod> -c <container> --previous --tail=200

# Stream logs from all pods matching a label selector with pod/container prefixes
kubectl logs -l app=api -n app --tail=100 --prefix -f

# Include RFC3339 timestamps for correlating with traces or ingress logs
kubectl logs <pod> -n app --timestamps --since=30m
```

## Get inside a running or distroless container

Modern production images (distroless, scratch, Chainguard) often omit `sh`, `curl`, and `nc` to reduce attack surface. Use `kubectl debug` to attach an ephemeral troubleshooting container sharing the target's process and network namespace without restarting the workload.

```bash
# Interactive shell inside a container that includes sh or bash
kubectl exec -it <pod> -n app -c <container> -- sh

# Run a single non-interactive diagnostic command
kubectl exec <pod> -n app -- env | sort

# Image has no shell? Attach an ephemeral debug container
kubectl debug -it <pod> -n app --image=nicolaka/netshoot --target=<container>

# Create a copy of a crashing pod with an overridden command to inspect its filesystem
kubectl debug <pod> -n app -it --copy-to=debug-pod --container=<container> -- sh
```

## Rollouts and safe rollbacks

Deployments maintain a revision history (default `revisionHistoryLimit: 10`) that lets you monitor rollout health or roll back a bad release immediately.

```bash
# Watch a rollout until all replicas are Ready (exits non-zero on timeout)
kubectl rollout status deploy/api -n app --timeout=180s

# Inspect revision history and change-cause annotations
kubectl rollout history deploy/api -n app

# Roll back immediately to the previous working ReplicaSet
kubectl rollout undo deploy/api -n app

# Trigger a zero-downtime rolling restart (e.g., after rotating a ConfigMap or Secret)
kubectl rollout restart deploy/api -n app
```

> **GitOps warning:** If your cluster uses ArgoCD or Flux with auto-sync enabled, manual `kubectl rollout undo` or `kubectl edit` changes will be overwritten on the next reconciliation cycle. Revert the commit in Git, or pause auto-sync temporarily during an active outage.

## Resources, capacity, and node pressure

High memory usage causes `OOMKilled` restarts, while insufficient unallocated requests cause pods to stay `Pending`.

```bash
# Live CPU and memory usage (requires metrics-server)
kubectl top pods -n app --sort-by=memory
kubectl top nodes --sort-by=cpu

# Inspect total requests/limits allocated on a specific node
kubectl describe node <node> | grep -A10 "Allocated resources"

# Find nodes with taints or NotReady conditions
kubectl get nodes -o custom-columns=NAME:.metadata.name,STATUS:.status.conditions[-1].type,TAINTS:.spec.taints
```

Use the [Kubernetes Resource Calculator](/tools/k8s-resource-calculator/) to check how many replicas fit on a given node SKU before adjusting requests and limits.

## Secrets and ConfigMaps

Kubernetes Secrets store values as Base64-encoded strings—not encrypted text. Always avoid leaving trailing newlines when encoding values.

```bash
# Decode a single Secret key safely
kubectl get secret app-secrets -n app -o jsonpath='{.data.DB_PASSWORD}' | base64 -d; echo

# Generate a Secret manifest locally without applying it to the cluster
kubectl create secret generic app-secrets -n app \
  --from-literal=DB_PASSWORD='change-me' --dry-run=client -o yaml

# Export a live manifest cleanly (strip status and managedFields with kubectl neat)
kubectl get deploy api -n app -o yaml
```

To decode an entire Secret manifest at once or detect hidden trailing newlines, use the [Kubernetes Secret Decoder](/tools/k8s-secret/). Before sharing exported YAML with an AI assistant or support ticket, strip cluster metadata with [kubectl neat](/tools/k8s-neat/) and mask credentials with the [Kubernetes Redactor](/tools/k8s-redactor/).

## Port forwarding and networking checks

Port forwarding tunnels traffic directly through the Kubernetes API server to a Pod or Service without exposing a public Ingress or LoadBalancer.

```bash
# Forward local port 8080 to Service port 80
kubectl port-forward svc/api 8080:80 -n app

# Forward a database port from a specific pod
kubectl port-forward pod/<pod> 5432:5432 -n data

# Verify that a Service actually has ready endpoints (empty means label selector mismatch)
kubectl get endpoints svc/api -n app
```
