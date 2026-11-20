import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ZONE_DOMAIN = process.env.CF_ZONE_DOMAIN || 'opsmask.com';

function resolveCloudflareBearerToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN.trim();
  if (process.env.CF_API_TOKEN) return process.env.CF_API_TOKEN.trim();

  const wranglerConfigs = [
    path.join(os.homedir(), 'Library/Preferences/.wrangler/config/default.toml'),
    path.join(os.homedir(), '.wrangler/config/default.toml'),
    path.join(os.homedir(), '.config/.wrangler/config/default.toml'),
  ];

  for (const cfgPath of wranglerConfigs) {
    if (fs.existsSync(cfgPath)) {
      const content = fs.readFileSync(cfgPath, 'utf8');
      const m = content.match(/oauth_token\s*=\s*"([^"]+)"/);
      if (m && m[1]) return m[1].trim();
    }
  }
  return '';
}

async function purgeCloudflareCdnCache() {
  const token = resolveCloudflareBearerToken();
  if (!token) {
    console.log(
      'INFO: No Cloudflare API token found for custom Zone CDN purge (Cloudflare Pages edge cache is already invalidated on deploy).'
    );
    return;
  }

  try {
    let zoneId = (process.env.CF_ZONE_ID || '').trim();
    if (!zoneId) {
      const zoneRes = await fetch(
        `https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(ZONE_DOMAIN)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );
      const zoneData = await zoneRes.json();
      if (zoneData?.success && Array.isArray(zoneData.result) && zoneData.result.length > 0) {
        zoneId = zoneData.result[0].id;
      }
    }

    if (!zoneId) {
      console.log(
        `INFO: No custom Cloudflare Zone found for ${ZONE_DOMAIN} (or token only has Pages scope). Cloudflare Pages edge cache is already refreshed.`
      );
      return;
    }

    const purgeRes = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ purge_everything: true }),
      }
    );
    const purgeData = await purgeRes.json();
    if (purgeData?.success) {
      console.log(
        `SUCCESS: Purged 100% of Cloudflare Zone CDN Cache (purge_everything) for ${ZONE_DOMAIN} (Zone ID: ${zoneId}).`
      );
    } else {
      console.log(
        `INFO: Cloudflare Pages edge cache refreshed on deploy. (To also purge Custom Zone Cache via API, provide CF_API_TOKEN with Zone.Cache Purge permission for Zone ID: ${zoneId}).`
      );
    }
  } catch (err) {
    console.log('WARN: Unable to call Cloudflare Zone Purge API:', err.message);
  }
}

purgeCloudflareCdnCache();
