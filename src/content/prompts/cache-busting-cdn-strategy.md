---
title: Implement 4-tier cache-busting & CDN cache strategy
description: Configure zero-cache HTML, immutable content-hashed assets, client-side build-ID invalidation and automated Cloudflare CDN edge purge.
category: Deployment
tags: [cache, cdn, cloudflare-pages, cache-control, fingerprinting, headers, deployment, spa, static-site]
relatedTools: [env-suggest, text-diff]
variables:
  - name: stack
    label: Web framework and build tool
    placeholder: Astro 5 / Vite / Next.js / React SPA / Vanilla Static Build
  - name: hosting
    label: Hosting and CDN provider
    placeholder: Cloudflare Pages with Custom Domain Zone (example.com)
  - name: configs
    label: Current build config, Makefile or _headers
    placeholder: Paste astro.config.mjs, vite.config.ts, Makefile, package.json or public/_headers
    multiline: true
  - name: preserve
    label: Client localStorage keys to preserve on cache reset
    placeholder: theme, auth_token, user_preferences
    optional: true
---
You are a senior web infrastructure and performance engineer. Implement the mandatory 4-tier Cache-Busting & CDN Cache Strategy (Zero-Cache HTML + Immutable Fingerprinted Assets) for the project below so it achieves maximum load speed while never serving stale HTML or broken chunks on Client or CDN after deployment.

Project stack: {{stack}}
Hosting & CDN: {{hosting}}
{{#preserve}}
Client storage keys to preserve: {{preserve}}
{{/preserve}}

Current configuration / build files:
```
{{configs}}
```

Implement all 4 tiers below with complete, drop-in code changes:

### 1. Asset Fingerprinting (Content-Hash Filenames)
- Never reference fixed-filename CSS/JS/data bundles (e.g., `/assets/style.css`, `/assets/app.js`) alongside `immutable` caching.
- During the build step, compute an 8-character SHA-256 content hash (`<hash>`) so all bundled assets are emitted with content-hashed filenames (`style.<hash>.css`, `app.<hash>.js`, `data.<hash>.js` or `/_astro/<name>.<hash>.<ext>`).
- For any internal subpages or apps/games embedded via `<iframe>`, automatically append `?v=<buildId>` to the `src` attribute.

### 2. Separated HTTP `Cache-Control` Headers (`_headers`)
- **HTML routes (`/*`, `/*.html`, subroutes) & unhashed endpoints (`/search.json`, `/sitemap*.xml`)**:
  Set `Cache-Control: public, max-age=0, must-revalidate` so browsers and CDN edge nodes always revalidate the latest HTML immediately after each deploy.
- **Content-Hashed Static Assets (`*.<hash>.css`, `*.<hash>.js`, `/_astro/*`) & Static Images (`/assets/images/*`)**:
  Set `Cache-Control: public, max-age=31536000, immutable` (cached for 1 year without re-downloading when content is unchanged).

### 3. Client-Side Build-ID Cache Invalidation
- Inject `window.__BUILD_ID__ = "<buildHash>"` inline inside `<head>`.
- Compare `window.__BUILD_ID__` against `localStorage.getItem('app_build_id')`. Whenever they differ (new deployment) or the URL contains `?clear_cache=1`:
  - Update `app_build_id` in `localStorage`.
  - Automatically clear `window.caches` (Cache Storage API) and unregister old `navigator.serviceWorker.getRegistrations()`.
  - Preserve user data in `localStorage` (auth tokens, progress, theme, personal settings{{#preserve}}: {{preserve}}{{/preserve}}).
  - If `?clear_cache=1` is present in the URL, strip `clear_cache` from the query string and call `window.location.replace()` to reload cleanly from the network.

### 4. Automated CDN Edge Purge on Deploy (`Makefile` & `scripts/purge-cache.mjs`)
- Provide a `scripts/purge-cache.mjs` script and `Makefile` targets (`deploy`, `deploy-prod`, `purge-cache`) that automatically call the Cloudflare Zone API (`POST /client/v4/zones/<zone_id>/purge_cache` with `{"purge_everything": true}`) after deploying to Cloudflare Pages whenever `CF_API_TOKEN` / `CLOUDFLARE_API_TOKEN` is configured.
