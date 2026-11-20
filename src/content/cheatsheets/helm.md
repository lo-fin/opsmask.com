---
title: Helm
description: Copy-ready Helm v3 commands for rendering templates locally, diffing upgrades, inspecting release values, and safely rolling back Kubernetes charts.
tags: [helm, kubernetes, k8s, gitops, charts, yaml]
updated: "2026-11-20"
---

Helm is the standard package manager for Kubernetes, but blind `helm upgrade` commands in production can introduce breaking manifest changes or drift from Git. This cheatsheet focuses on safe inspection, local template rendering, dry-run validation, and clean rollbacks with Helm v3.

## Repositories and OCI registries

Modern charts are increasingly distributed via OCI container registries (`oci://...`) alongside traditional Helm HTTP repositories.

```bash
# Add and update a classic Helm chart repository
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo update

# Search available chart versions (including pre-releases with --devel)
helm search repo bitnami/nginx --versions | head -15

# Pull and unpack a chart locally to audit its templates before installing
helm pull oci://registry-1.docker.io/bitnamicharts/nginx --version 18.2.0 --untar
```

## Render and validate manifests locally before deploying

Never apply a chart upgrade without inspecting the rendered Kubernetes YAML first. `helm template` renders manifests completely offline without touching your cluster.

```bash
# Render a chart with custom values files into a local YAML file
helm template my-api ./charts/api -n app -f values.yaml -f values-prod.yaml > rendered.yaml

# Render only a single template file (great for debugging Go template syntax errors)
helm template my-api ./charts/api -s templates/deployment.yaml -f values-prod.yaml

# Run Helm's built-in linter to catch schema and YAML issues
helm lint ./charts/api -f values-prod.yaml
```

After running `helm template`, paste the rendered YAML into the [Kubernetes Manifest Checker](/tools/k8s-manifest-checker/) to catch missing resource limits, root containers, and `:latest` image tags before applying to the cluster.

## Install, upgrade, and atomic rollbacks

Using `helm upgrade --install` makes CI/CD pipelines idempotent. Adding `--atomic` automatically rolls back the release if pods fail to become Ready within `--timeout`.

```bash
# Preview changes against the live cluster without applying them
helm upgrade --install my-api ./charts/api -n app -f values-prod.yaml --dry-run --debug

# Idempotent production upgrade with automatic rollback on failure
helm upgrade --install my-api ./charts/api \
  --namespace app --create-namespace \
  -f values-prod.yaml \
  --atomic --timeout 5m

# Install the helm-diff plugin to see a colorized unified diff before upgrading
helm diff upgrade my-api ./charts/api -n app -f values-prod.yaml
```

## Inspect live releases and values

```bash
# List all releases across every namespace (including failed or pending-upgrade states)
helm list -A --all

# Print ONLY the user-supplied values for a live release (great for auditing drift)
helm get values my-api -n app

# Print all computed values (chart defaults merged with user overrides)
helm get values my-api -n app --all

# Export the exact Kubernetes manifests currently managed by a Helm release
helm get manifest my-api -n app
```

## Release history and rollbacks

```bash
# View revision history, chart versions, app versions, and deployment status
helm history my-api -n app

# Roll back to a specific known-good revision number
helm rollback my-api 4 -n app --wait --timeout 5m

# Uninstall a release while keeping history for auditability (omit --keep-history to delete completely)
helm uninstall my-api -n app
```

> **Stuck in `pending-upgrade`?** If a CI job was killed mid-upgrade, Helm locks the release state. Run `helm history my-api -n app` to verify the last `deployed` revision, then run `helm rollback my-api <last-good-rev> -n app` to unlock it cleanly.
