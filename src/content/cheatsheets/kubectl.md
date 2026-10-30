---
title: kubectl
description: Day-to-day kubectl commands for inspecting, debugging and fixing workloads.
tags: [kubernetes, k8s, aks, debug, pods]
---

## Context and namespace

```bash
kubectl config get-contexts
kubectl config use-context my-aks-prod
kubectl config set-context --current --namespace=app
```

## Find what is broken

```bash
# Pods that are not Running or Completed, across all namespaces
kubectl get pods -A --field-selector=status.phase!=Running,status.phase!=Succeeded

# Recent events, newest last
kubectl get events -n app --sort-by=.lastTimestamp | tail -20

# Why a pod is stuck
kubectl describe pod <pod> -n app
```

## Logs

```bash
kubectl logs deploy/api -n app --since=15m
kubectl logs <pod> -c <container> --previous     # logs from the crashed container
kubectl logs -l app=api -n app --tail=100 --prefix
```

## Get inside

```bash
kubectl exec -it <pod> -n app -- sh
# Image has no shell? Attach a debug container
kubectl debug -it <pod> -n app --image=busybox:1.36 --target=<container>
```

## Rollouts

```bash
kubectl rollout status deploy/api -n app
kubectl rollout history deploy/api -n app
kubectl rollout undo deploy/api -n app
kubectl rollout restart deploy/api -n app
```

With ArgoCD auto-sync, a manual change is reverted on the next sync. Change Git instead, or pause auto-sync first.

## Resources and capacity

```bash
kubectl top pods -n app --sort-by=memory
kubectl top nodes
kubectl describe node <node> | grep -A8 "Allocated resources"
```

## Secrets and config

```bash
kubectl get secret app-secrets -n app -o jsonpath='{.data.DB_PASSWORD}' | base64 -d
kubectl create secret generic app-secrets -n app \
  --from-literal=DB_PASSWORD='...' --dry-run=client -o yaml
```

## Port forward

```bash
kubectl port-forward svc/api 8080:80 -n app
kubectl port-forward pod/<pod> 5432:5432 -n data
```
