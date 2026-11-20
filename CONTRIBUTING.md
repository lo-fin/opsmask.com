# Contributing to OpsMask

Thanks for helping. The fastest contributions to review are cheatsheets and prompts, because they are plain Markdown.

## Ground rules

- Tools must run entirely in the browser. No calls to external APIs: the site's Content Security Policy blocks them anyway.
- No real secrets, internal hostnames or company names in examples.
- Keep copy short and practical: commands people can paste and run.

## Local setup

```bash
npm install
npm run dev
```

## Adding content

- Cheatsheet: `src/content/cheatsheets/<slug>.md`
- Prompt: `src/content/prompts/<slug>.md` (see an existing file for the frontmatter and `{{variable}}` syntax)
- Tool: add an entry in `src/data/tools.ts` and a page in `src/pages/tools/<slug>.astro`

Run `npm run build` before opening a pull request. CI runs the same build.
