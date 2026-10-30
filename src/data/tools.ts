// Registry of tools. Each entry needs a matching page in src/pages/tools/<slug>.astro
export type Tool = {
  slug: string;
  title: string;
  description: string;
  group: 'Kubernetes' | 'Network' | 'Encoding & crypto' | 'Scheduling' | 'Data formats';
  keywords: string[];
  relatedPrompts?: string[];
};

export const TOOL_GROUPS: Tool['group'][] = ['Kubernetes', 'Network', 'Encoding & crypto', 'Scheduling', 'Data formats'];

export const TOOLS: Tool[] = [
  {
    slug: 'k8s-manifest-checker',
    title: 'Kubernetes manifest checker',
    description: 'Paste YAML and get warnings for missing limits, :latest images, root containers and other common mistakes.',
    group: 'Kubernetes',
    keywords: ['kubernetes', 'k8s', 'yaml', 'lint', 'deployment', 'security', 'resources', 'aks'],
    relatedPrompts: ['review-k8s-manifest'],
  },
  {
    slug: 'yaml-json',
    title: 'YAML ↔ JSON converter',
    description: 'Convert YAML to JSON and back, including multi-document YAML.',
    group: 'Data formats',
    keywords: ['yaml', 'json', 'convert', 'helm', 'values'],
  },
  {
    slug: 'jwt-decoder',
    title: 'JWT decoder',
    description: 'Read the header and claims of a JSON Web Token and check when it expires.',
    group: 'Encoding & crypto',
    keywords: ['jwt', 'token', 'oauth', 'oidc', 'entra', 'azure ad', 'claims', 'decode'],
  },
  {
    slug: 'base64',
    title: 'Base64 encode / decode',
    description: 'Encode or decode Base64 with UTF-8 support, handy for Kubernetes Secret values.',
    group: 'Encoding & crypto',
    keywords: ['base64', 'encode', 'decode', 'secret', 'kubernetes'],
  },
  {
    slug: 'cidr-calculator',
    title: 'CIDR / subnet calculator',
    description: 'Network range, usable hosts (including Azure’s 5 reserved addresses) and subnet splits.',
    group: 'Network',
    keywords: ['cidr', 'subnet', 'ip', 'vnet', 'azure', 'network', 'netmask'],
  },
  {
    slug: 'cron-explainer',
    title: 'Cron expression explainer',
    description: 'Read a cron schedule in plain words and see the next run times in UTC or local time.',
    group: 'Scheduling',
    keywords: ['cron', 'cronjob', 'schedule', 'kubernetes', 'crontab', 'timer'],
    relatedPrompts: [],
  },
];

export const toolBySlug = (slug: string) => TOOLS.find((t) => t.slug === slug);
