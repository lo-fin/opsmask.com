// Central site settings.
// Account-specific identifiers (AdSense, Ko-fi, sponsors) are injected via
// environment variables (.env locally or CI/CD secrets) so no personal IDs
// are hardcoded in the public repository.

function env(key: string, fallback = ''): string {
  const viteEnv =
    typeof import.meta !== 'undefined'
      ? (import.meta as { env?: Record<string, string | undefined> }).env
      : undefined;
  const fromVite = viteEnv?.[key];
  if (fromVite !== undefined && fromVite !== '') return fromVite;
  const fromProcess = typeof process !== 'undefined' ? process.env?.[key] : undefined;
  if (fromProcess !== undefined && fromProcess !== '') return fromProcess;
  return fallback;
}

type AdProvider = 'none' | 'carbon' | 'ethicalads' | 'adsense';
const rawProvider = env('PUBLIC_ADS_PROVIDER', 'none');
const adsProvider: AdProvider =
  rawProvider === 'adsense' || rawProvider === 'carbon' || rawProvider === 'ethicalads'
    ? rawProvider
    : 'none';

export const SITE = {
  name: 'OpsMask',
  tagline: 'DevOps tools, cheatsheets, guides and AI prompts that mask your secrets. Everything runs in your browser.',
  url: env('PUBLIC_SITE_URL', 'https://opsmask.com'),
  contactEmail: env('PUBLIC_CONTACT_EMAIL', 'contact@opsmask.com'),

  // Public repo. Used for the GitHub link, "Edit this page" and issue templates.
  repo: 'https://github.com/lo-fin/opsmask.com',
  branch: 'main',

  support: {
    kofi: env('PUBLIC_KOFI_URL', ''),
    kofiWidgetId: env('PUBLIC_KOFI_WIDGET_ID', ''),
    githubSponsors: env('PUBLIC_GITHUB_SPONSORS_URL', ''),
  },

  ads: {
    // 'none'       -> shows a small "support OpsMask" card instead of an ad
    // 'carbon'     -> Carbon Ads (needs approval: carbonads.net)
    // 'ethicalads' -> EthicalAds (needs approval: ethicalads.io)
    // 'adsense'    -> Google AdSense
    provider: adsProvider,
    adsense: {
      clientId: env('PUBLIC_ADSENSE_CLIENT_ID', ''),
      slotId: env('PUBLIC_ADSENSE_SLOT_ID', ''),
    },
    carbon: {
      serve: env('PUBLIC_CARBON_SERVE', ''),
      placement: env('PUBLIC_CARBON_PLACEMENT', ''),
    },
    ethicalads: {
      publisher: env('PUBLIC_ETHICALADS_PUBLISHER', ''),
    },
  },
};

export const repoIssueUrl = (template?: string) =>
  `${SITE.repo}/issues/new${template ? `?template=${template}` : '/choose'}`;
export const repoEditUrl = (filePath?: string) =>
  filePath ? `${SITE.repo}/edit/${SITE.branch}/${filePath.replace(/^\.\//, '')}` : SITE.repo;
