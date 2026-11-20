import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import { loadEnv } from 'vite';
import sitemap from '@astrojs/sitemap';
import { SITE } from './src/config.ts';

const loadedEnv = loadEnv(process.env.NODE_ENV || 'production', process.cwd(), '');
const adsenseClientId = process.env.PUBLIC_ADSENSE_CLIENT_ID || loadedEnv.PUBLIC_ADSENSE_CLIENT_ID || '';

function computeBuildId() {
  const hash = crypto.createHash('sha256');
  const rootDir = fileURLToPath(new URL('.', import.meta.url));

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        hash.update(path.relative(rootDir, fullPath));
        hash.update(fs.readFileSync(fullPath));
      }
    }
  }

  walk(path.join(rootDir, 'src'));
  walk(path.join(rootDir, 'public'));
  for (const file of ['package.json', 'astro.config.mjs']) {
    const filePath = path.join(rootDir, file);
    if (fs.existsSync(filePath)) {
      hash.update(file);
      hash.update(fs.readFileSync(filePath));
    }
  }

  return hash.digest('hex').slice(0, 8);
}

export const BUILD_ID = computeBuildId();

function postBuildAssetsAndSitemap(buildId) {
  return {
    name: 'post-build-assets-and-sitemap',
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

        // Write fingerprinted search index bundle for immutable caching
        const searchJson = path.join(distDir, 'search.json');
        if (fs.existsSync(searchJson)) {
          const astroDir = path.join(distDir, '_astro');
          if (fs.existsSync(astroDir)) {
            fs.copyFileSync(searchJson, path.join(astroDir, `search.${buildId}.json`));
          }
          fs.copyFileSync(searchJson, path.join(distDir, `search.${buildId}.json`));
        }

        // Generate dist/ads.txt dynamically from PUBLIC_ADSENSE_CLIENT_ID when configured
        if (adsenseClientId) {
          const pubId = adsenseClientId.replace(/^ca-/, '');
          fs.writeFileSync(
            path.join(distDir, 'ads.txt'),
            `google.com, ${pubId}, DIRECT, f08c47fec0942fa0\n`,
            'utf8',
          );
        }
      },
    },
  };
}

export default defineConfig({
  site: SITE.url,
  vite: {
    define: {
      __BUILD_ID__: JSON.stringify(BUILD_ID),
    },
    build: {
      rollupOptions: {
        output: {
          entryFileNames: '_astro/[name].[hash].js',
          chunkFileNames: '_astro/[name].[hash].js',
          assetFileNames: '_astro/[name].[hash][extname]',
        },
      },
    },
  },
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
        } else if (item.url.includes('/guides/')) {
          item.changefreq = 'weekly';
          item.priority = 0.85;
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
    postBuildAssetsAndSitemap(BUILD_ID),
  ],
  markdown: {
    shikiConfig: {
      themes: { light: 'github-light', dark: 'github-dark' },
    },
  },
});

