import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { SITE } from './src/config.ts';

function sitemapXmlAlias() {
  return {
    name: 'sitemap-xml-alias',
    hooks: {
      'astro:build:done': async ({ dir }) => {
        const distDir = fileURLToPath(dir);
        const sitemap0 = path.join(distDir, 'sitemap-0.xml');
        const sitemapIndex = path.join(distDir, 'sitemap-index.xml');
        const sitemapTarget = path.join(distDir, 'sitemap.xml');

        if (fs.existsSync(sitemap0)) {
          fs.copyFileSync(sitemap0, sitemapTarget);
        } else if (fs.existsSync(sitemapIndex)) {
          fs.copyFileSync(sitemapIndex, sitemapTarget);
        }
      },
    },
  };
}

export default defineConfig({
  site: SITE.url,
  integrations: [
    sitemap({
      filter: (page) => !page.includes('/404'),
      serialize(item) {
        if (item.url === `${SITE.url}/` || item.url === `${SITE.url}`) {
          item.changefreq = 'daily';
          item.priority = 1.0;
        } else if (item.url.includes('/tools/')) {
          item.changefreq = 'weekly';
          item.priority = 0.9;
        } else if (item.url.includes('/cheatsheets/') || item.url.includes('/prompts/')) {
          item.changefreq = 'weekly';
          item.priority = 0.8;
        } else {
          item.changefreq = 'monthly';
          item.priority = 0.6;
        }
        return item;
      },
    }),
    sitemapXmlAlias(),
  ],
  markdown: {
    shikiConfig: {
      themes: { light: 'github-light', dark: 'github-dark' },
    },
  },
});

