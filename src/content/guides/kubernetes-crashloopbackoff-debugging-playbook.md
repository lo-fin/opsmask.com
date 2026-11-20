---
title: Debugging Kubernetes CrashLoopBackOff and OOMKilled Pods — An SRE Playbook
description: A systematic, evidence-first runbook for diagnosing CrashLoopBackOff, exit codes 137/143/1, failing probes, and OOMKilled containers in Kubernetes.
category: Kubernetes
tags: [kubernetes, crashloopbackoff, oomkilled, debugging, sre, pods]
published: "2026-11-20"
readingTime: "9 min read"
relatedTools: [k8s-pod-status, kubectl-builder, k8s-manifest-checker, k8s-resource-calculator]
---

`CrashLoopBackOff` is not an error by itself—it is Kubernetes telling you that a container inside a pod keeps starting, crashing, and being restarted with an exponential backoff delay (10s, 20s, 40s, up to 5 minutes). Treating every `CrashLoopBackOff` the same way wastes precious minutes during an incident.

This playbook walks through the exact diagnostic sequence senior SREs use to isolate the root cause in under five minutes.

## Step 1: Capture state, exit code, and events before restarting anything

Resist the temptation to immediately run `kubectl delete pod`. Deleting a pod destroys its previous container logs if you do not have centralized logging, and rarely fixes a deterministic crash.

Start by inspecting the pod's full state and recent events:

```bash
kubectl describe pod <pod-name> -n <namespace>
```

Look specifically at two sections: **Last State** under the failing container, and **Events** at the bottom. You can paste sanitized `kubectl describe pod` output directly into the [Pod Status Explainer](/tools/k8s-pod-status/) to parse exit codes and recommended commands automatically.

### Decode the Linux exit code immediately

The container's `Exit Code` tells you *how* the process died:

- **Exit Code 137 (`128 + 9`, `SIGKILL`)**: Almost always **OOMKilled** (the Linux kernel's OOM killer terminated the process because it exceeded `resources.limits.memory`). Confirm by checking `Reason: OOMKilled` in `describe pod`. Occasionally, exit code 137 also occurs when a pod ignores `SIGTERM` during shutdown and Kubernetes forcefully kills it after `terminationGracePeriodSeconds` (default 30s).
- **Exit Code 143 (`128 + 15`, `SIGTERM`)**: The container received a graceful termination signal. If this happens repeatedly without a rollout, suspect a failing **`livenessProbe`**—kubelet sends `SIGTERM` every time the liveness probe exceeds `failureThreshold`.
- **Exit Code 1 (General application error)**: Your application exited on its own—typically due to a missing environment variable, invalid config file, failed database connection at startup, or unhandled exception.
- **Exit Code 126 / 127**: Command cannot execute (permission denied) or command not found. Common when overriding `command:` or `args:` in YAML or using a base image where `/bin/bash` does not exist.
- **Exit Code 139 (`SIGSEGV`)**: Segmentation fault in native code (C/C++/Go CGO/Node native addon), often caused by musl vs. glibc incompatibilities (e.g., Alpine vs. Debian).

## Step 2: Read logs from the previous crashed container

If you run `kubectl logs <pod>` while the pod is waiting in backoff, you often get empty output or only the first two lines of the new attempt. Always pass `--previous` (`-p`):

```bash
kubectl logs <pod-name> -n <namespace> -c <container-name> --previous --tail=200
```

If the container crashes so early that `--previous` is empty, check the `Events` section of `kubectl describe pod` for `CreateContainerConfigError` (missing ConfigMap or Secret key) or `RunContainerError` (missing binary or bad volume mount path).

## Step 3: Fixing the 4 most common root causes

### Cause A: OOMKilled (Exit Code 137)

When a container hits its memory limit, the kernel kills it instantaneously with no stack trace.

1. **Verify working set memory vs. limit** using `kubectl top pod` or Prometheus (`container_memory_working_set_bytes`).
2. **Check runtime heap settings**:
   - **Java (JVM)**: Ensure `-XX:MaxRAMPercentage=75.0` is set rather than hardcoding `-Xmx` close to the container limit—remember that JVM metaspace, thread stacks, and native buffers live outside the heap.
   - **Node.js**: Set `NODE_OPTIONS=--max-old-space-size=<MB>` to roughly 70–75% of the container memory limit.
   - **Go 1.19+**: Set `GOMEMLIMIT` to ~80–85% of the memory limit so the Go garbage collector runs aggressively before hitting the cgroup ceiling.
3. **Set memory `requests == limits`** for critical workloads (Guaranteed QoS class) so Kubernetes never overcommits node memory and evicts your pod under pressure. Use the [Kubernetes Resource Calculator](/tools/k8s-resource-calculator/) to verify node capacity before raising limits.

### Cause B: Overly aggressive Liveness Probes

A surprisingly common production outage happens when a slow startup or brief downstream database latency causes a `livenessProbe` to fail, putting healthy-but-busy pods into a restart spiral.

- **Separate `startupProbe`, `readinessProbe`, and `livenessProbe`**:
  - Use `startupProbe` for slow-booting apps (JVM, Spring Boot, ML model loading) with a generous `failureThreshold * periodSeconds`.
  - Use `readinessProbe` to remove overloaded pods from Service traffic without killing them.
  - Keep `livenessProbe` lightweight (an in-process `/healthz` endpoint) and **never** make a liveness probe check an external database or third-party API—if the database blips, Kubernetes will restart every replica simultaneously and worsen the outage.

### Cause C: Missing ConfigMap/Secret keys or bad Base64 encoding

If logs show authentication failures or missing configuration right after a deployment:
- Verify every referenced ConfigMap and Secret exists in the same namespace.
- Check for hidden trailing newlines in Base64-encoded Secret values using the [Kubernetes Secret Decoder](/tools/k8s-secret/). A trailing `\n` in a database password or API token causes immediate startup failure even though the decoded text looks normal in a terminal.

### Cause D: Bad `securityContext` or Read-Only Root Filesystem

Hardened production manifests often set `runAsNonRoot: true` and `readOnlyRootFilesystem: true`. If an application tries to write temporary files to `/tmp` or cache files to `/var/cache/nginx`, it exits immediately with exit code 1.

Fix this properly by mounting an `emptyDir` volume at `/tmp` (or the required cache directory) rather than disabling `readOnlyRootFilesystem`:

```yaml
volumeMounts:
  - name: tmp
    mountPath: /tmp
volumes:
  - name: tmp
    emptyDir:
      sizeLimit: 128Mi
```

## Step 4: Debug a crashing container interactively

When logs still do not explain why the container exits, clone the pod with an overridden entrypoint (`sleep infinity`) using `kubectl debug` so you can inspect files, permissions, and environment variables interactively:

```bash
kubectl debug <pod-name> -n <namespace> -it \
  --copy-to=debug-copy \
  --container=<container-name> \
  -- sh
```

Remember to delete `debug-copy` once your investigation is complete (`kubectl delete pod debug-copy -n <namespace>`).

## Prevent repeat incidents

Before closing the incident ticket:
1. Run the Deployment YAML through the [Kubernetes Manifest Checker](/tools/k8s-manifest-checker/) to verify probes, limits, and image tags.
2. Add a Prometheus alert on `kube_pod_container_status_waiting_reason{reason="CrashLoopBackOff"} == 1` with a `for: 5m` duration (see our [PromQL Cheatsheet](/cheatsheets/promql/)).
3. If you need a fast second opinion from an AI assistant during triage, use the auto-redacting [Debug CrashLoopBackOff Prompt](/prompts/debug-crashloopbackoff/) so credentials and IPs are stripped automatically.
