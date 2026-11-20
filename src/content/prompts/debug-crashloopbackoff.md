---
title: Debug a pod in CrashLoopBackOff
description: Find the root cause of a crashing pod from its describe output, logs and recent changes.
category: Incident
tags: [kubernetes, crashloopbackoff, debug, pod, oomkilled, incident]
relatedTools: [k8s-pod-status, k8s-manifest-checker, k8s-redactor]
whenToUse: Use this prompt during an active Kubernetes incident when a pod is restarting repeatedly in CrashLoopBackOff or OOMKilled and you want a fast, evidence-grounded root cause analysis without pasting raw secrets, tokens, or internal IP addresses into an AI chat.
tips:
  - Always include logs from the crashed container using --previous; current container logs are often empty right after a restart.
  - Paste the full Events and Last State sections from kubectl describe pod so the model sees exact exit codes (for example, 137 for OOMKilled or 143 for SIGTERM).
  - Mention recent Helm, ArgoCD, ConfigMap, or Secret changes—most production CrashLoopBackOff incidents correlate with a deployment or config change within the last 30 minutes.
variables:
  - name: describe
    label: kubectl describe pod output
    placeholder: kubectl describe pod <pod> -n <namespace>
    multiline: true
  - name: logs
    label: Logs from the crashed container
    placeholder: kubectl logs <pod> --previous --tail=200
    multiline: true
  - name: change
    label: What changed recently
    placeholder: New image tag deployed via ArgoCD 20 minutes ago
    optional: true
---
You are an SRE helping me debug a Kubernetes pod stuck in CrashLoopBackOff. Think step by step and base every conclusion on the evidence below.

{{#change}}
Recent change: {{change}}
{{/change}}

kubectl describe output:
```
{{describe}}
```

Logs from the previous container:
```
{{logs}}
```

Answer in this order:
1. The most likely root cause, with the exact lines from the evidence that support it (exit code, last state reason, error message).
2. Other possible causes ranked by likelihood, and the single command that would confirm or rule out each one.
3. The fix, including any YAML change.
4. How to prevent it next time (probe settings, resource limits, startup checks, alerts).

If the evidence is not enough, tell me exactly which command output you need next.
