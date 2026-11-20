---
title: openssl and TLS
description: Inspect X.509 certificates, verify live TLS handshakes with SNI, match private keys, and convert between PEM, PFX, and DER formats.
tags: [tls, ssl, certificate, x509, pfx, pem, https, openssl]
updated: "2026-11-20"
---

Expired certificates, missing intermediate chains, and mismatched private keys are recurring causes of production HTTPS outages. This `openssl` cheatsheet covers the exact commands needed to inspect local files, test live endpoints behind SNI load balancers, verify certificate/key pairs, and convert formats between cloud key vaults and Kubernetes TLS Secrets.

## Inspect a local certificate file

Before uploading a certificate to an Ingress controller, CDN, or load balancer, inspect its subject, issuer, validity window, and Subject Alternative Names (SANs). Modern browsers and Go/Java TLS clients ignore the Common Name (`CN`) and validate hostnames strictly against `subjectAltName`.

```bash
# Print subject, issuer, and notBefore/notAfter validity dates
openssl x509 -in cert.pem -noout -subject -issuer -dates

# List all DNS names and IP SANs covered by the certificate
openssl x509 -in cert.pem -noout -ext subjectAltName

# Inspect the full decoded X.509 structure (key size, signature algorithm, extensions)
openssl x509 -in cert.pem -noout -text
```

## Check a live TLS endpoint

Testing a live server verifies not only the leaf certificate but also the intermediate chain, negotiated TLS protocol version, and cipher suite.

```bash
# Show the full certificate chain presented by the server
openssl s_client -connect example.com:443 -servername example.com -showcerts </dev/null

# Extract only the certificate expiry date (useful for monitoring scripts)
echo | openssl s_client -connect example.com:443 -servername example.com 2>/dev/null \
  | openssl x509 -noout -enddate

# Force a specific TLS version (e.g., verify TLS 1.3 support or test if TLS 1.1 is disabled)
openssl s_client -connect example.com:443 -servername example.com -tls1_3 </dev/null

# Inspect a certificate behind an internal IP while sending a specific Host/SNI name
openssl s_client -connect 10.20.4.15:443 -servername api.internal.example.com </dev/null
```

> **Why `-servername` matters:** Reverse proxies such as NGINX Ingress, Traefik, Envoy, Cloudflare, and AWS ALB host multiple certificates on a single IP using Server Name Indication (SNI). Omitting `-servername` often returns the proxy's fallback/default certificate instead of your application's certificate.

## Verify that a private key matches a certificate

If an Ingress controller or NGINX fails to start with `key values mismatch`, compare the SHA-256 hash of the public key extracted from the certificate against the public key derived from the private key. This method works for both RSA and ECDSA keys (unlike older modulus-only checks).

```bash
# Public key hash from the certificate
openssl x509 -noout -pubkey -in cert.pem | openssl pkey -pubin -outform der | openssl dgst -sha256

# Public key hash from the private key
openssl pkey -pubout -in key.pem -outform der | openssl dgst -sha256
```

If both SHA-256 digests are identical, the certificate and private key belong together. You can also verify a Certificate Signing Request (CSR) against the private key using `openssl req -noout -pubkey -in request.csr`.

## Verify a certificate chain locally

A leaf certificate that validates in a desktop browser (which may cache intermediates via AIA fetching) can still fail in `curl`, Python, Go, or microservices if the server does not send the full intermediate chain.

```bash
# Verify cert.pem against an intermediate chain and the system CA bundle
openssl verify -CAfile chain.pem cert.pem

# Count how many certificates exist in a bundled PEM file (1 = leaf only, 2+ = includes chain)
grep -c "BEGIN CERTIFICATE" fullchain.pem
```

## Convert between PEM, PFX (PKCS#12), and DER

Cloud platforms differ in expected formats: Kubernetes `kubernetes.io/tls` Secrets, NGINX, and Envoy expect PEM files, whereas Azure Key Vault, IIS, and some Java keystores export PKCS#12 (`.pfx` / `.p12`).

```bash
# Extract the leaf certificate from a PFX bundle (Azure Key Vault / Windows export)
openssl pkcs12 -in cert.pfx -clcerts -nokeys -out cert.pem

# Extract intermediate CA certificates from a PFX bundle
openssl pkcs12 -in cert.pfx -cacerts -nokeys -out chain.pem

# Extract the unencrypted private key from a PFX bundle (OpenSSL 3 uses -noenc; OpenSSL 1.1 uses -nodes)
openssl pkcs12 -in cert.pfx -nocerts -nodes -out key.pem

# Bundle PEM cert, key, and intermediate chain into a PFX archive
openssl pkcs12 -export -in cert.pem -inkey key.pem -certfile chain.pem -out cert.pfx

# Convert binary DER (.cer / .der) to ASCII PEM
openssl x509 -inform der -in cert.cer -out cert.pem
```

> **OpenSSL 3 legacy PFX note:** Older `.pfx` files exported from Windows Server or legacy Java tools may use RC2/3DES encryption and trigger `unsupported` errors on OpenSSL 3.x. Add the `-legacy` flag to `openssl pkcs12` when reading legacy bundles.

## Generate a self-signed certificate with SANs for local development

```bash
openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
  -keyout key.pem -out cert.pem \
  -subj "/CN=dev.local" \
  -addext "subjectAltName=DNS:dev.local,DNS:*.dev.local,IP:127.0.0.1"
```

Need to troubleshoot TLS handshakes alongside DNS, routing, or firewall timeouts? Use the [Network Troubleshooting Commands](/tools/network-commands/) builder for cross-platform `curl`, `openssl`, `dig`, and `nc` commands.
