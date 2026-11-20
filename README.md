# OpsMask

[opsmask.com](https://opsmask.com): DevOps tools, cheatsheets and AI prompts that mask your secrets. Static site built with Astro: no backend, nothing uploaded.

Contributions welcome, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Run locally

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # output in dist/
```

Requires Node 22.12 or newer.

## Structure

```
src/
  config.ts                 Site name, domain, donate link, ad settings
  data/tools.ts             Tool registry (title, group, keywords for search)
  pages/tools/<slug>.astro  One page per tool, wrapped in ToolShell
  content/cheatsheets/*.md  Cheatsheets (Markdown)
  content/prompts/*.md      Prompt templates (frontmatter variables + body)
  lib/redact.ts             Secret / IP / email / GUID masking for prompts
  lib/cron.ts               Cron parser and next-run calculator
  lib/k8s-check.ts          Kubernetes manifest checks
  pages/search.json.ts      Search index generated at build time
```

## Add a tool

1. Add an entry to `src/data/tools.ts`.
2. Create `src/pages/tools/<slug>.astro` using `<ToolShell slug="<slug>">`.
3. Put the logic in a `<script>` block (bundled by Astro, runs in the browser).

## Add a cheatsheet

Create `src/content/cheatsheets/<slug>.md` with `title`, `description`, `tags`. Use `##` headings: they become the table of contents. Code blocks get a copy button automatically.

## Add a prompt

Create `src/content/prompts/<slug>.md`:

```yaml
title: ...
description: ...
category: Review | Observability | Incident | ...
tags: [...]
relatedTools: [k8s-manifest-checker]
variables:
  - name: manifest
    label: Manifest YAML
    multiline: true
  - name: concerns
    label: Anything specific
    optional: true
```

In the body, `{{name}}` inserts a value and `{{#name}} ... {{/name}}` is a block shown only when that value is filled in.

## Deploy to Cloudflare Pages

1. Push the repo to GitHub.
2. Cloudflare dashboard → Workers & Pages → Create → Pages → connect the repo.
3. Build command `npm run build`, output directory `dist`, environment variable `NODE_VERSION=22`.
4. Add the custom domain, then update `url` in `src/config.ts` and `public/robots.txt`.

## Ads, donations and GitHub

Everything is set in `src/config.ts`:

- `repo`: your public GitHub repo URL (header icon, footer, "Edit on GitHub", issue templates).
- `support.kofi`: your Ko-fi page. Shown in the header, footer, the house card and once per session after a prompt is copied.
- `ads.provider`: `none` shows a small support card in the ad slot. Switch to `carbon` or `ethicalads` once your account is approved and fill in the IDs.

Ad rules built into the layout: one ad per page, in the sidebar on desktop and after the content on mobile, never between a tool's input and output, no popups, height reserved so the page does not jump. The home page has no ad.

## Security headers

`public/_headers` sets a Content Security Policy for Cloudflare Pages. `connect-src 'self'` blocks page scripts from sending data to other servers, which backs the "nothing leaves your browser" promise. If an ad provider changes its domains and the ad stops showing, check the browser console for CSP errors and add the domain to `script-src` or `img-src` only.

## License

MIT, see [LICENSE](LICENSE).
