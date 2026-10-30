---
title: PromQL
description: PromQL queries for request rates, error ratios, latency percentiles and Kubernetes resource usage.
tags: [prometheus, mimir, grafana, metrics, observability, alerting]
---

## Rates and counters

```text
# Requests per second over 5 minutes
sum(rate(http_requests_total{namespace="app"}[5m])) by (service)

# Total increase over the last hour
sum(increase(http_requests_total[1h]))
```

Use `rate()` on counters only. For gauges such as memory, use the value directly or `avg_over_time()`.

## Error ratio

```text
sum(rate(http_requests_total{status=~"5.."}[5m])) by (service)
/
sum(rate(http_requests_total[5m])) by (service)
```

## Latency percentiles

```text
histogram_quantile(0.95,
  sum(rate(http_request_duration_seconds_bucket[5m])) by (le, service)
)
```

Always keep `le` in the `by` clause, or the quantile is wrong.

## Kubernetes CPU and memory

```text
# CPU cores used per pod
sum(rate(container_cpu_usage_seconds_total{namespace="app", container!=""}[5m])) by (pod)

# Memory working set per pod
sum(container_memory_working_set_bytes{namespace="app", container!=""}) by (pod)

# Memory as a share of the limit
sum(container_memory_working_set_bytes{container!=""}) by (pod, container)
/
sum(kube_pod_container_resource_limits{resource="memory"}) by (pod, container)
```

## Restarts and pod health

```text
increase(kube_pod_container_status_restarts_total[1h]) > 3

kube_pod_container_status_waiting_reason{reason="CrashLoopBackOff"} == 1
```

## Comparing with the past

```text
sum(rate(http_requests_total[5m]))
/
sum(rate(http_requests_total[5m] offset 1w))
```
