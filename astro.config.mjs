import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { SITE } from './src/config.ts';

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
  ],
  markdown: {
    shikiConfig: {
      themes: { light: 'github-light', dark: 'github-dark' },
    },
  },
});
