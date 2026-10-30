---
title: openssl and TLS
description: Inspect certificates, check expiry, test TLS endpoints and convert between PEM, PFX and DER.
tags: [tls, ssl, certificate, x509, pfx, https]
---

## Inspect a certificate

```bash
openssl x509 -in cert.pem -noout -subject -issuer -dates
openssl x509 -in cert.pem -noout -ext subjectAltName
```

## Check a live endpoint

```bash
# Show the chain the server sends
openssl s_client -connect example.com:443 -servername example.com -showcerts </dev/null

# Just the expiry date
echo | openssl s_client -connect example.com:443 -servername example.com 2>/dev/null \
  | openssl x509 -noout -enddate
```

`-servername` matters behind Traefik, Cloudflare or any ingress that routes by SNI. Without it you may see the default certificate.

## Does the key match the certificate?

```bash
openssl x509 -noout -pubkey -in cert.pem | openssl sha256
openssl pkey -pubout -in key.pem | openssl sha256
```

The two hashes must be identical.

## Convert formats

```bash
# PFX (Azure Key Vault export) to PEM cert + key
openssl pkcs12 -in cert.pfx -clcerts -nokeys -out cert.pem
openssl pkcs12 -in cert.pfx -nocerts -nodes -out key.pem

# PEM to PFX
openssl pkcs12 -export -in cert.pem -inkey key.pem -certfile chain.pem -out cert.pfx

# DER to PEM
openssl x509 -inform der -in cert.cer -out cert.pem
```

## Create a self-signed certificate for testing

```bash
openssl req -x509 -newkey rsa:2048 -nodes -days 30 \
  -keyout key.pem -out cert.pem -subj "/CN=dev.local" \
  -addext "subjectAltName=DNS:dev.local"
```
