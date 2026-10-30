// Central site settings.
export const SITE = {
  name: 'OpsMask',
  tagline: 'DevOps tools, cheatsheets and AI prompts that mask your secrets. Everything runs in your browser.',
  url: 'https://opsmask.com',

  // Public repo. Used for the GitHub link, "Edit this page" and issue templates.
  repo: 'https://github.com/lo-finom',
  branch: 'main',

  support: {
    kofi: 'https://ko-fi.com/toantruyen', // '' hides it
    kofiWidgetId: 'M1I529MM56',
    githubSponsors: '',                        // e.g. 'https://github.com/sponsors/you'
  },

  ads: {
    // 'none'       -> shows a small "support OpsMask" card instead of an ad
    // 'carbon'     -> Carbon Ads (needs approval: carbonads.net)
    // 'ethicalads' -> EthicalAds (needs approval: ethicalads.io)
    // 'adsense'    -> Google AdSense
    provider: 'adsense' as 'none' | 'carbon' | 'ethicalads' | 'adsense',
    adsense: {
      clientId: 'ca-pub-5270354142468855',
      slotId: '',
    },
    carbon: { serve: '', placement: '' },
    ethicalads: { publisher: '' },
  },
};

export const repoIssueUrl = (template?: string) =>
  `${SITE.repo}/issues/new${template ? `?template=${template}` : '/choose'}`;
export const repoEditUrl = (filePath?: string) =>
  filePath ? `${SITE.repo}/edit/${SITE.branch}/${filePath.replace(/^\.\//, '')}` : SITE.repo;
