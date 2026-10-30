---
title: Write a PromQL query or alert
description: Describe what you want to measure and get a working PromQL query, with an alert rule if needed.
category: Observability
tags: [promql, prometheus, mimir, grafana, alerting, metrics]
variables:
  - name: goal
    label: What you want to see or alert on
    placeholder: Alert when 5xx errors are above 2% for 10 minutes, per service
  - name: metrics
    label: Metric names and labels you have
    placeholder: "http_server_requests_seconds_count{namespace, service, status}"
    multiline: true
  - name: stack
    label: Backend
    placeholder: Grafana Mimir, scraped by Grafana Alloy every 30s
  - name: tried
    label: What you tried
    placeholder: The query you have now and what is wrong with it
    multiline: true
    optional: true
---
You are an observability engineer who writes precise PromQL.

Goal: {{goal}}

Backend: {{stack}}

Available metrics and labels:
{{metrics}}

{{#tried}}
What I tried and what went wrong:
{{tried}}
{{/tried}}

Give me:
1. The PromQL query, formatted across lines.
2. A short explanation of each function and why the range window fits the scrape interval.
3. If this is an alert: a Prometheus alerting rule in YAML with a sensible `for:` duration, labels (severity) and an annotation summary that includes the service label.
4. Pitfalls with this query, such as counter resets, missing series when traffic is zero, or high cardinality.

Use only the metric names I gave. If something is missing, tell me which metric I need instead of guessing.
