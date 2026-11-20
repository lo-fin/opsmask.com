# CLAUDE.md — OpsMask Project Rules & Conventions

## 1. Language Rule (Strict English Only)
- **All repository content MUST be written in English.**
- This applies to:
  - UI copy, labels, buttons, badges, placeholders, status messages, and documentation (`slot="notes"`, markdown content, titles, descriptions).
  - Source code, variable/function/type names, comments, docstrings, and error messages.
  - Unit tests, test descriptions, and fixture text.
  - Build scripts, `Makefile` comments/descriptions, and commit messages.
- Do not introduce Vietnamese or any other non-English text into the codebase, even if the user prompt or discussion is in Vietnamese.

## 2. Architecture & Code Organization
- **Pure Logic in `src/lib/<tool>.ts`**:
  - Keep parsing, matching, command generation, and serialization pure and DOM-free so they can be tested directly in Vitest.
  - Pair every `src/lib/<tool>.ts` module with unit tests in `src/lib/<tool>.test.ts`.
- **Tool Pages in `src/pages/tools/<slug>.astro`**:
  - Wrap every tool page in `<ToolShell slug="<slug>">` (`src/components/ToolShell.astro`).
  - Provide helpful, concise operational context and security notes inside `<div slot="notes" class="prose">`.
  - Register every tool in `src/data/tools.ts` (`TOOLS` array) so it appears in the sidebar navigation, home page, sitemap, and `/search.json`.
- **Client-Side Privacy & Local Execution**:
  - All tools run 100% locally in the browser tab. Never send user-pasted configs, manifests, or secrets over the network.
  - Wrap all `localStorage` reads/writes in `try / catch` blocks using the `opsmask:` key prefix so tools continue working when storage is blocked or full.
  - Mask sensitive values (Secrets, passwords, tokens, keys) by default on screen (`mark.mask` / `.mask` or `type="password"`).

## 3. CLI & OS Command Guidelines
- When generating shell/CLI commands (e.g., `kubectl`, network tools, clipboard pipes):
  - Support **macOS**, **Linux**, and **Windows (PowerShell)** explicitly.
  - Include clipboard piping where helpful (`| pbcopy` on macOS, `| xclip -selection clipboard` or `wl-copy` on Linux, `| Set-Clipboard` or `| clip` on Windows).
  - Always provide copy-ready **installation commands** (`brew`, `apt-get`, `dnf`, `apk`, `winget`) when a command relies on tools that may not be pre-installed (`kubectl`, `jq`, `xclip`, `wl-clipboard`, etc.).

## 4. Cache-Busting & CDN Cache Strategy (Zero-Cache HTML + Immutable Fingerprinted Assets)
Every build and deployment MUST adhere to the 4-tier caching strategy:
1. **Asset Fingerprinting (Content-Hash Filenames)**:
   - Never serve fixed-name CSS/JS/data bundles with `immutable` caching.
   - All bundled CSS, JS, and search index data use content-hashed filenames (`/_astro/<name>.<hash>.css`, `/_astro/<name>.<hash>.js`, `/search.<hash>.json`).
   - Any internal `<iframe>` embeds must include `?v=<buildId>` in their `src` attribute.
2. **Separated HTTP `Cache-Control` Headers (`public/_headers`)**:
   - **HTML routes (`/*`, `/*.html`, `/tools/*`, `/cheatsheets/*`, `/prompts/*`, `/about/*`) & unhashed endpoints (`/search.json`, `/sitemap*.xml`)**:
     `Cache-Control: public, max-age=0, must-revalidate` so browsers and CDN edges always revalidate HTML after each deploy.
   - **Content-Hashed Static Assets (`/_astro/*`, `/search.*.json`, `/assets/images/*`)**:
     `Cache-Control: public, max-age=31536000, immutable` (1-year immutable cache).
3. **Client-Side Build-ID Cache Invalidation (`src/layouts/Base.astro`)**:
   - Inject `window.__BUILD_ID__ = "<buildHash>"` in `<head>` and compare against `localStorage.getItem('app_build_id')`.
   - When `app_build_id` changes or `?clear_cache=1` is present in the URL:
     - Update `app_build_id` in `localStorage`.
     - Purge `window.caches` (Cache Storage API) and unregister any existing `navigator.serviceWorker` registrations while preserving user preferences and saved tool state (`theme`, `opsmask:*`).
     - If `?clear_cache=1` is present, remove the query parameter and call `location.replace()` to reload cleanly from the network.
4. **Automated CDN Edge Purge on Deploy (`Makefile` & `scripts/purge-cache.mjs`)**:
   - `make deploy` and `make deploy-prod` automatically run `node scripts/purge-cache.mjs` after deploying to Cloudflare Pages to trigger `purge_everything` via the Cloudflare Zone API when a zone/token is configured.

## 5. Verification Workflow
Before considering any change complete, run:
```bash
make verify
# which runs:
# 1. npm test       (vitest run)
# 2. npm run check  (astro check)
# 3. npm run build  (astro build)
```
