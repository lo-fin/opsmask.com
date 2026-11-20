---
title: Cloud VPC and Azure VNet CIDR Planning — Avoiding IP Exhaustion and Reserved Address Traps
description: A practical guide to sizing IPv4 CIDR blocks for AWS VPCs, Azure VNets, and Kubernetes clusters without hitting IP exhaustion or peering overlaps.
category: Networking
tags: [cidr, subnetting, networking, azure, aws, kubernetes, vpc]
published: "2026-11-20"
readingTime: "8 min read"
relatedTools: [cidr-calculator, network-commands, k8s-networkpolicy, k8s-resource-calculator]
---

Poor CIDR planning is one of the hardest infrastructure mistakes to fix later. Changing a database password takes five minutes; re-IPing a production AWS VPC, Azure VNet, or Kubernetes cluster subnet because you ran out of IP addresses or collided with a partner VPN can require rebuilding entire environments.

This guide covers the exact IPv4 CIDR math, cloud provider reserved-address rules, and Kubernetes CNI sizing formulas you need to design clean, future-proof cloud networks.

## The cloud reserved-IP trap: 5 reserved addresses, not 2

Traditional networking textbooks teach that a subnet reserves **2 IP addresses**: the network address (first IP) and the broadcast address (last IP). On that basis, a `/28` (16 total IPs) would have 14 usable addresses.

In **AWS VPC** and **Azure VNet**, every single subnet reserves **5 IP addresses**:

| Offset in subnet (example `10.0.1.0/24`) | Reserved Purpose |
| :--- | :--- |
| `.0` (first IP) | Network address |
| `.1` | Default gateway / VPC router |
| `.2` | Cloud DNS / Azure internal mapping |
| `.3` | Reserved by AWS/Azure for future use |
| `.255` (last IP) | Network broadcast address |

This means:
- A **`/28`** (16 total IPs) has only **11 usable IPs** (not 14).
- A **`/27`** (32 total IPs) has **27 usable IPs**.
- A **`/24`** (256 total IPs) has **251 usable IPs**.
- A **`/22`** (1,024 total IPs) has **1,019 usable IPs**.

You can compute exact usable host counts (including Azure/AWS 5-address reservations) and split parent blocks cleanly in the [CIDR / Subnet Calculator](/tools/cidr-calculator/).

## Avoiding RFC 1918 overlaps across environments

If you create every VPC or VNet with `10.0.0.0/16` (the default in many quickstart templates), you will hit an immediate roadblock the day you need VPC peering, Transit Gateway, Azure Virtual WAN, or site-to-site VPNs to an on-premises office.

Instead, carve a top-level IPAM plan out of `10.0.0.0/8` (or `172.16.0.0/12`) from day one:

- **Production Region A**: `10.10.0.0/16`
- **Production Region B (DR)**: `10.11.0.0/16`
- **Staging**: `10.20.0.0/16`
- **Development / Sandbox**: `10.30.0.0/16`
- **Shared Services / Hub (DNS, VPN, Bastion)**: `10.0.0.0/16`

Avoid `192.168.0.0/16` and `192.168.1.0/24` for cloud workloads—they collide with almost every home Wi-Fi router when engineers connect over remote VPN.

## Sizing subnets for Kubernetes (AKS, EKS, GKE)

Kubernetes is the fastest way to exhaust a poorly sized subnet, especially when using **flat-network CNIs** (Azure CNI classic, AWS VPC CNI) where **every pod receives a real IP address from the node subnet**.

### The Kubernetes IP sizing formula

Always include **rolling upgrade surge nodes** and **pod surge** in your math:

$$\text{Required IPs} = (\text{Max Nodes} + \text{Upgrade Surge Nodes}) \times (1 + \text{Max Pods per Node})$$

**Real-world example:** Suppose you run a 10-node AKS cluster with Azure CNI and `maxPods = 30`, plus 2 surge nodes during Kubernetes upgrades:
- $(10 + 2) \times (1 + 30) = 372\text{ IPs}$
- A `/24` subnet only gives you **251 usable IPs**—your cluster upgrade will fail halfway through with `Insufficient IP addresses in subnet`!
- A **`/22`** subnet provides **1,019 usable IPs**, comfortably covering growth to 30+ nodes.

**Modern alternative:** If IPv4 space is tight in your corporate network, use **Azure CNI Overlay** (pods get a separate private overlay CIDR like `10.244.0.0/16`, while only nodes consume VNet IPs) or **AWS VPC CNI prefix delegation / secondary CIDRs** (`100.64.0.0/10` CGNAT space).

## Structuring a `/16` VNet or VPC cleanly

When dividing a `/16` (65,536 IPs) for a production environment across 3 Availability Zones, leave contiguous free space for future node pools and managed services:

1. **Public / Ingress subnets** (load balancers, NAT gateways): three `/24` subnets (e.g., `10.10.0.0/24`, `10.10.1.0/24`, `10.10.2.0/24`).
2. **Private Application / Kubernetes Node subnets**: three `/21` or `/22` subnets (e.g., `10.10.16.0/21`, `10.10.24.0/21`, `10.10.32.0/21`)—2,043 usable IPs per AZ.
3. **Private Data subnets** (RDS, Azure SQL Private Endpoints, Redis, Kafka): three `/24` subnets (e.g., `10.10.48.0/24`, `10.10.49.0/24`, `10.10.50.0/24`).
4. **Reserved expansion space**: keep `10.10.128.0/17` completely unallocated for future workloads or dedicated GPU/batch node pools.

## Troubleshooting subnet routing and connectivity

Once your subnets are deployed, if traffic fails between tiers:
- Check whether the error is **Connection refused** (host reachable, port closed) vs. **Connection timed out** (Security Group, NSG, NACL, or route table dropping packets).
- Use the [Network Troubleshooting Commands](/tools/network-commands/) builder to run exact `nc`, `Test-NetConnection`, `traceroute`, `ip route`, and `dig` checks across Linux, macOS, and Windows.
- Double-check Kubernetes [NetworkPolicy](/tools/k8s-networkpolicy/) `ipBlock` rules if pods can reach each other but cannot reach a private database subnet.
