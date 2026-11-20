---
title: Kubernetes CPU and Memory Requests, Limits, and Node Capacity Planning Explained
description: Understand how Kubernetes scheduling, CFS CPU throttling, OOMKills, QoS classes, and allocatable node headroom work so you can size clusters accurately.
category: Kubernetes
tags: [kubernetes, capacity-planning, cpu, memory, qos, aks, eks]
published: "2026-11-20"
readingTime: "8 min read"
relatedTools: [k8s-resource-calculator, k8s-manifest-checker, k8s-pod-status]
---

Misconfigured CPU and memory `requests` and `limits` are responsible for two of the most expensive problems in Kubernetes: **wasted cloud spend** (over-provisioned clusters running at 15% utilization) and **production instability** (unexpected `OOMKilled` restarts, severe tail-latency spikes from CPU throttling, and pods stuck `Pending` during deployments).

This guide breaks down how Kubernetes actually enforces CPU and memory under the hood, and gives you a concrete formula for right-sizing workloads and node pools.

## Requests vs. Limits: two completely different mechanisms

Although `requests` and `limits` sit next to each other in a pod manifest, Kubernetes uses them at different layers:

- **`requests`** are used by the **kube-scheduler** to decide which node has enough free capacity to place the pod. Requests are *reservations*—a node will not schedule a pod if the sum of existing requests plus the new pod's request exceeds the node's **Allocatable** CPU or memory.
- **`limits`** are enforced at runtime by the Linux kernel's **cgroups** on the node where the container runs.

Crucially, CPU and memory behave completely differently when a container hits its limit:

| Resource | Type | What happens at the limit? |
| :--- | :--- | :--- |
| **CPU** | Compressible | The Linux Completely Fair Scheduler (CFS) **throttles** the container until the next 100ms quota period. The process slows down, causing p99 latency spikes, but is **not killed**. |
| **Memory** | Incompressible | The Linux kernel **OOM-kills** the container immediately (Exit Code 137). Memory cannot be throttled safely. |

## Units: millicores (`m`) and binary (`Mi`/`Gi`) vs. decimal (`M`/`G`)

Always standardize your manifests on these conventions:

- **CPU**: `1` equals 1 vCPU (1 hyperthread on most cloud VMs), and `1000m` (1000 millicores) equals `1`. So `250m` is 0.25 vCPU.
- **Memory**: Use binary units—`Mi` (mebibytes, $1024^2$ bytes) and `Gi` (gibibytes, $1024^3$ bytes). Avoid decimal `M` or `G` (`1G` is ~953.7 `Mi`), and never write lowercase `m` for memory (`512m` means 0.512 *bytes*, which is a famous YAML typo!).

You can double-check conversions and sum requests across multi-document YAML files locally with the [Kubernetes Resource Calculator](/tools/k8s-resource-calculator/).

## Why you cannot fit 16 GiB of pods on a 16 GiB node

A common capacity-planning mistake is assuming a 4 vCPU / 16 GiB VM (for example, an AWS `m6i.xlarge` or Azure `Standard_D4s_v5`) can host sixteen `1Gi` pods. In reality, **Allocatable** capacity is significantly smaller than raw VM capacity:

$$\text{Allocatable} = \text{Node Capacity} - \text{kube-reserved} - \text{system-reserved} - \text{eviction-threshold}$$

On a typical managed Kubernetes node (AKS, EKS, or GKE):
1. **OS kernel & cloud reservations** consume ~100–250m CPU and ~1.5–2.5 GiB of RAM on a 16 GiB VM.
2. **DaemonSets** (CNI plugin, kube-proxy, node-exporter, Fluent Bit / Grafana Alloy, CSI node drivers) run on *every single node* and reserve another ~300–600m CPU and ~500 Mi–1.2 GiB RAM.
3. **Rolling update surge headroom**: A Deployment with `maxSurge: 25%` temporarily schedules extra pods before terminating old ones. If your cluster runs at 95% requested capacity, deployments will stall in `Pending` until the Cluster Autoscaler provisions a new node (which takes 2–5 minutes).

**Practical rule of thumb:** Plan for **75–80% usable capacity** per node after subtracting DaemonSets, and keep at least one node's worth of headroom (or warm buffer pods) if you need instant rollouts and fast failover.

## Understanding Kubernetes QoS classes

Based on how you set `requests` and `limits`, Kubernetes assigns every pod a Quality of Service (QoS) class that determines eviction order when a node runs low on memory:

1. **Guaranteed** (safest, evicted last): Every container in the pod sets both `requests` and `limits` for CPU and memory, and `requests == limits` for each.
2. **Burstable** (most common): At least one container has a CPU or memory request/limit, but they are not equal across all containers.
3. **BestEffort** (evicted first): No container sets any CPU or memory request or limit. Avoid this in production.

## Recommended sizing strategy for production services

### 1. Memory: set `requests == limits` for stateful and latency-critical apps
Because hitting a memory limit causes an immediate OOMKill, overcommitting memory across nodes leads to cascading node-level evictions. Setting `requests.memory == limits.memory` (sized to peak working set + 25–30% headroom) guarantees the scheduler reserves the RAM your container actually needs.

### 2. CPU: set accurate `requests`, and be careful with tight `limits`
Set `requests.cpu` based on your service's steady-state p95 CPU usage (from Prometheus `container_cpu_usage_seconds_total`).

For `limits.cpu`, check your throttling metrics (`container_cpu_cfs_throttled_periods_total`). Many modern multi-threaded runtimes (JVM, Go, Node.js) burst briefly during startup, TLS handshakes, or garbage collection. A low CPU limit like `200m` can trigger severe CFS throttling even when the host node has plenty of idle CPU. Either:
- Set a generous CPU limit (2×–4× the request) if you operate a multi-tenant cluster requiring strict noisy-neighbor isolation, or
- Omit `limits.cpu` on trusted, single-tenant services while keeping `requests.cpu` accurate and `limits.memory` strictly enforced.

### 3. Validate before merging
Always validate your resource blocks with the [Kubernetes Manifest Checker](/tools/k8s-manifest-checker/) and track live usage via the queries in our [PromQL Cheatsheet](/cheatsheets/promql/) to adjust requests quarterly based on real traffic rather than guesswork.
