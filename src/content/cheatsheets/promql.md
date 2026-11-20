---
title: PromQL
description: Practical PromQL queries for HTTP request rates, 5xx error budgets, latency percentiles, Kubernetes CPU/memory usage, and reliable alerting rules.
tags: [prometheus, mimir, grafana, metrics, observability, alerting, promql]
updated: "2026-11-20"
---

Writing accurate PromQL requires understanding metric types (counters vs. gauges vs. histograms), label aggregation rules, and scrape intervals. This cheatsheet collects battle-tested queries for Prometheus, Grafana Mimir, Thanos, and VictoriaMetrics, along with the subtle pitfalls that cause false alerts or misleading dashboards.

## Request rates and counter increases

Counters only ever increase (except when a process restarts and resets to zero). Never graph a raw counter directly; always wrap it in `rate()` or `increase()`, which automatically compensate for counter resets.

```text
# Requests per second (RPS) over a 5-minute window, grouped by service
sum(rate(http_requests_total{namespace="app"}[5m])) by (service)

# Instantaneous rate using the last two samples (useful for spiky graphs, noisy for alerts)
sum(irate(http_requests_total{namespace="app"}[5m])) by (service)

# Total number of requests over the last hour
sum(increase(http_requests_total{namespace="app"}[1h])) by (service)
```

> **Range window rule of thumb:** Choose a range vector window (`[5m]`) that is at least **4× your scrape interval**. If Prometheus scrapes every 30 seconds, `[2m]` is the safe minimum; `[5m]` gives smoother alerts and survives occasional missed scrapes. Never use `rate()` on a gauge like memory usage—use the raw gauge or `avg_over_time()` instead.

## Error ratio and SLO burn rate

Dividing error rate by total request rate produces a ratio between `0` and `1` (multiply by `100` for percentages). Notice that if a service has zero 5xx errors, the numerator may return no series unless you handle missing labels or use `or vector(0)`.

```text
# 5xx error ratio per service (returns 0.02 for 2% errors)
sum(rate(http_requests_total{namespace="app", status=~"5.."}[5m])) by (service)
/
sum(rate(http_requests_total{namespace="app"}[5m])) by (service)

# Safe version that returns 0 instead of "No data" when there are no 5xx responses
(
  sum(rate(http_requests_total{namespace="app", status=~"5.."}[5m])) by (service)
  or
  0 * sum(rate(http_requests_total{namespace="app"}[5m])) by (service)
)
/
sum(rate(http_requests_total{namespace="app"}[5m])) by (service)
```

## Latency percentiles with histograms

Prometheus histograms store cumulative bucket counts labeled with `le` ("less than or equal to"). You must compute `rate()` on the buckets first, then sum while **preserving `le`**, and finally call `histogram_quantile()`.

```text
# p95 request latency per service over 5 minutes
histogram_quantile(0.95,
  sum(rate(http_request_duration_seconds_bucket{namespace="app"}[5m])) by (le, service)
)

# p99 latency across an entire ingress controller
histogram_quantile(0.99,
  sum(rate(nginx_ingress_controller_request_duration_seconds_bucket[5m])) by (le, ingress)
)
```

**Common mistake:** Dropping `le` from the `by (...)` clause or averaging pre-computed quantiles across pods produces mathematically invalid results. Always aggregate raw `_bucket` counters by `le`.

## Kubernetes CPU, throttling, and memory

cAdvisor exports container metrics with both `container=""` (pod-level cgroup totals) and named containers. Filtering `container!=""` prevents double-counting when summing across pods.

```text
# CPU cores actively used per pod
sum(rate(container_cpu_usage_seconds_total{namespace="app", container!="", container!="POD"}[5m])) by (pod)

# CPU throttling ratio (> 0.25 indicates CPU limits are too tight)
sum(rate(container_cpu_cfs_throttled_periods_total{namespace="app", container!=""}[5m])) by (pod, container)
/
sum(rate(container_cpu_cfs_periods_total{namespace="app", container!=""}[5m])) by (pod, container)

# Working set memory (what Kubernetes uses to decide OOMKills, excluding reclaimable page cache)
sum(container_memory_working_set_bytes{namespace="app", container!="", container!="POD"}) by (pod)

# Memory usage as a fraction of the configured container memory limit
sum(container_memory_working_set_bytes{namespace="app", container!="", container!="POD"}) by (pod, container)
/
sum(kube_pod_container_resource_limits{namespace="app", resource="memory"}) by (pod, container)
```

## Pod restarts and CrashLoopBackOff alerts

Combine `kube-state-metrics` with a `for:` clause in your Alertmanager rules so transient blips do not wake on-call engineers.

```text
# Containers that restarted more than 3 times in the past hour
increase(kube_pod_container_status_restarts_total{namespace="app"}[1h]) > 3

# Pods currently stuck in CrashLoopBackOff
kube_pod_container_status_waiting_reason{reason="CrashLoopBackOff"} == 1

# Deployments with fewer available replicas than desired
kube_deployment_status_replicas_available < kube_deployment_spec_replicas
```

## Week-over-week anomaly comparisons

Use `offset` to compare current traffic against the same time last week, accounting for daily and weekly seasonality.

```text
# Current RPS divided by RPS 7 days ago (0.5 = 50% traffic drop)
sum(rate(http_requests_total{namespace="app"}[5m]))
/
sum(rate(http_requests_total{namespace="app"}[5m] offset 1w))
```

Need help drafting a custom PromQL query or Alertmanager rule from your exact metric names? Try the [Write a PromQL Query or Alert](/prompts/write-promql/) AI prompt template.
