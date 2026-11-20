---
title: Docker & Containers
description: Essential Docker CLI commands for building multi-stage images, debugging running containers, inspecting networks, and reclaiming disk space.
tags: [docker, containers, devops, buildx, debugging, oci]
updated: "2026-11-20"
---

Whether you are debugging a local microservice stack, building multi-architecture OCI images in CI/CD, or investigating a full disk on a build runner, this Docker cheatsheet covers the commands engineers rely on most.

## Inspect running and stopped containers

By default, `docker ps` only lists running containers. Use `-a` to see exited containers and their exit codes (such as `137` for OOMKilled or `127` for missing entrypoint binaries).

```bash
# List all containers with compact status and port formatting
docker ps -a --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"

# Inspect exit code, OOMKilled flag, and restart count of a container
docker inspect <container> --format '{{json .State}}' | jq

# View real-time CPU, memory, and network I/O across all running containers
docker stats --no-stream
```

## Logs and interactive debugging

```bash
# Follow logs from the last 10 minutes with timestamps
docker logs -f --since 10m --timestamps <container>

# Open an interactive shell inside a running container
docker exec -it <container> sh

# Run a command as root inside a container whose default USER is non-root
docker exec -u 0 -it <container> sh

# Copy a config or heap dump out of a container to your host machine
docker cp <container>:/tmp/heap.hprof ./heap.hprof
```

## Build images efficiently with BuildKit

Modern Docker builds use BuildKit for parallel stage execution, layer caching, and secret mounts that never leak into image layers.

```bash
# Build with explicit tag and pull latest base image patches
docker build --pull -t myorg/api:1.4.2 .

# Build without cache when troubleshooting stale apt/npm layers
docker build --no-cache -t myorg/api:debug .

# Build multi-architecture images (amd64 + arm64) and push to a registry
docker buildx build --platform linux/amd64,linux/arm64 -t myorg/api:1.4.2 --push .

# Inspect the size of every layer in an image to find bloat
docker history --human --no-trunc myorg/api:1.4.2
```

> **Security tip:** Never pass passwords, npm tokens, or SSH keys via `ARG` or `ENV` in a `Dockerfile`—they remain permanently visible in `docker history` and image metadata. Use BuildKit secret mounts (`RUN --mount=type=secret,id=npmrc ...`) instead.

## Networking and DNS troubleshooting

Containers on the default `bridge` network cannot resolve each other by container name; always use a user-defined bridge network (which Docker Compose creates automatically).

```bash
# List networks and inspect attached containers and subnet CIDRs
docker network ls
docker network inspect <network>

# Launch a temporary network troubleshooting container sharing another container's network stack
docker run --rm -it --network container:<target-container> nicolaka/netshoot
```

## Reclaim disk space safely

CI runners and developer laptops frequently fill up with dangling layers, stopped containers, and BuildKit cache. Always check disk usage with `docker system df` before pruning.

```bash
# Show disk space used by images, containers, volumes, and build cache
docker system df

# Remove stopped containers, unused networks, and dangling (untagged) images
docker system prune

# Aggressive cleanup: also remove unused images older than 7 days and build cache
docker image prune -a --filter "until=168h"
docker builder prune --filter "until=168h"
```

> **Warning:** Avoid passing `--volumes` to `docker system prune` unless you are certain you want to permanently delete unattached database volumes (PostgreSQL, Redis, Elasticsearch data).
