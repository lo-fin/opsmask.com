// Registry of tools. Each entry needs a matching page in src/pages/tools/<slug>.astro
export type Tool = {
  slug: string;
  title: string;
  description: string;
  group: 'Text' | 'Data formats' | 'Kubernetes' | 'Network' | 'Encoding & crypto' | 'Scheduling';
  keywords: string[];
  relatedPrompts?: string[];
};

export const TOOL_GROUPS: Tool['group'][] = ['Text', 'Data formats', 'Kubernetes', 'Network', 'Encoding & crypto', 'Scheduling'];

export const TOOLS: Tool[] = [
  {
    slug: 'text-lines',
    title: 'Text line sorter, deduplicator & cleaner',
    description: 'Remove duplicate lines, sort, trim, filter, add prefixes/suffixes or join lines with commas and quotes.',
    group: 'Text',
    keywords: ['text', 'lines', 'sort', 'dedupe', 'duplicate', 'unique', 'trim', 'join', 'split', 'count', 'words', 'sql in'],
  },
  {
    slug: 'text-line-strip',
    title: 'Line character stripper (cut first N chars)',
    description: 'Strip the first N (or last N) characters from every line, click on a live character ruler to pick the exact cut point, or strip log prefixes.',
    group: 'Text',
    keywords: ['text', 'line', 'strip', 'cut', 'remove', 'first n characters', 'leading characters', 'prefix', 'column', 'slice', 'substring', 'timestamp', 'logs', 'indentation'],
  },
  {
    slug: 'text-diff',
    title: 'Text diff & compare',
    description: 'Compare two blocks of text, configs or logs line by line and spot additions and removals instantly.',
    group: 'Text',
    keywords: ['text', 'diff', 'compare', 'difference', 'config', 'yaml', 'json', 'patch'],
  },
  {
    slug: 'text-case',
    title: 'Case & naming converter',
    description: 'Convert text or identifiers between camelCase, PascalCase, snake_case, SCREAMING_SNAKE_CASE, kebab-case and dot.case.',
    group: 'Text',
    keywords: ['text', 'case', 'camelcase', 'pascalcase', 'snake_case', 'kebab-case', 'uppercase', 'lowercase', 'convert'],
  },
  {
    slug: 'text-escape',
    title: 'String escape / unescape & URL encode',
    description: 'Escape or unescape JSON strings, shell quotes, URL components and HTML entities with one-click copy.',
    group: 'Text',
    keywords: ['text', 'escape', 'unescape', 'json string', 'url encode', 'urlencode', 'urldecode', 'html entities', 'quotes', 'newline'],
  },
  {
    slug: 'password-generator',
    title: 'Password, secret & API key generator',
    description: 'Generate random passwords, 256-bit Hex / Base64 keys, prefixed API tokens (sk_, whsec_) and memorable passphrases.',
    group: 'Text',
    keywords: ['password', 'secret', 'generate', 'random', 'token', 'key', 'hex', 'base64', 'api key', 'passphrase', 'openssl rand', 'entropy'],
  },
  {
    slug: 'uuid-generator',
    title: 'UUID, ULID & NanoID generator',
    description: 'Generate UUID v4, time-ordered UUID v7, 26-char ULIDs, URL-safe NanoIDs and Kubernetes-style resource slugs in bulk.',
    group: 'Text',
    keywords: ['uuid', 'guid', 'ulid', 'nanoid', 'v4', 'v7', 'generate', 'random', 'id', 'identifier', 'slug'],
  },
  {
    slug: 'json-values',
    title: 'JSON value extractor',
    description: 'Paste JSON to list every key and value with one-click copy buttons, nested path flattening and embedded JSON unwrapping.',
    group: 'Data formats',
    keywords: ['json', 'value', 'key', 'copy', 'extract', 'flatten', 'appsettings', 'secret', 'env', 'parse'],
  },
  {
    slug: 'xml-values',
    title: 'XML value extractor',
    description: 'Paste XML (web.config, pom.xml, SOAP or custom configs) to list every element and attribute value with one-click copy buttons.',
    group: 'Data formats',
    keywords: ['xml', 'value', 'key', 'copy', 'extract', 'xpath', 'web.config', 'app.config', 'appsettings', 'connectionstrings', 'pom', 'soap', 'attribute'],
  },
  {
    slug: 'yaml-json',
    title: 'YAML ↔ JSON converter',
    description: 'Convert YAML to JSON and back, including multi-document YAML.',
    group: 'Data formats',
    keywords: ['yaml', 'json', 'convert', 'helm', 'values'],
  },
  {
    slug: 'env-suggest',
    title: 'Env & Kubernetes ConfigMap/Secret value suggester',
    description: 'Dump ConfigMaps and Secrets from each environment, then automatically match, adapt and mask values for a new environment or namespace.',
    group: 'Kubernetes',
    keywords: ['kubernetes', 'k8s', 'configmap', 'secret', 'env', 'dotenv', 'config', 'environment', 'staging', 'production', 'appsettings', 'migrate'],
  },
  {
    slug: 'k8s-manifest-checker',
    title: 'Kubernetes manifest checker',
    description: 'Paste YAML and get warnings for missing limits, :latest images, root containers and other common mistakes.',
    group: 'Kubernetes',
    keywords: ['kubernetes', 'k8s', 'yaml', 'lint', 'deployment', 'security', 'resources', 'aks'],
    relatedPrompts: ['review-k8s-manifest'],
  },
  {
    slug: 'k8s-pod-status',
    title: 'Pod status explainer',
    description: 'Paste kubectl describe pod and find out why it is in CrashLoopBackOff, ImagePullBackOff, Pending or OOMKilled, and what to run next.',
    group: 'Kubernetes',
    keywords: ['kubernetes', 'k8s', 'pod', 'crashloopbackoff', 'imagepullbackoff', 'oomkilled', 'pending', 'evicted', 'exit code 137', 'troubleshoot', 'describe'],
    relatedPrompts: ['debug-crashloopbackoff'],
  },
  {
    slug: 'k8s-neat',
    title: 'kubectl neat: clean exported YAML',
    description: 'Strip status, managedFields, cluster-assigned IPs and default values from kubectl get -o yaml, and get a manifest you can commit.',
    group: 'Kubernetes',
    keywords: ['kubernetes', 'k8s', 'kubectl neat', 'export', 'managedfields', 'clean yaml', 'get -o yaml', 'gitops', 'manifest'],
    relatedPrompts: ['review-k8s-manifest'],
  },
  {
    slug: 'k8s-resource-calculator',
    title: 'Kubernetes resource calculator',
    description: 'Convert CPU and memory quantities, see how many pods fit on a node, and total the requests in your manifests.',
    group: 'Kubernetes',
    keywords: ['kubernetes', 'k8s', 'cpu', 'memory', 'millicores', 'mi', 'gi', 'requests', 'limits', 'capacity', 'node', 'aks'],
  },
  {
    slug: 'k8s-secret',
    title: 'Kubernetes Secret decoder',
    description: 'Decode every value in a Secret at once, spot trailing newlines, or create a Secret from KEY=value lines.',
    group: 'Kubernetes',
    keywords: ['kubernetes', 'k8s', 'secret', 'base64', 'decode', 'encode', 'stringdata', 'dockerconfigjson', 'env'],
  },
  {
    slug: 'k8s-redactor',
    title: 'Kubernetes manifest & kubeconfig redactor',
    description: 'Mask Secret values, kubeconfig tokens, cluster endpoints and IPs before you paste YAML into an AI chat or a ticket.',
    group: 'Kubernetes',
    keywords: ['kubernetes', 'k8s', 'kubeconfig', 'redact', 'mask', 'secret', 'token', 'chatgpt', 'sanitize'],
    relatedPrompts: ['review-k8s-manifest', 'debug-crashloopbackoff'],
  },
  {
    slug: 'k8s-label-selector',
    title: 'Label selector tester',
    description: 'Check which pods a selector matches, and why the others do not. Accepts kubectl --show-labels output.',
    group: 'Kubernetes',
    keywords: ['kubernetes', 'k8s', 'label', 'selector', 'matchlabels', 'matchexpressions', 'service', 'kubectl -l'],
  },
  {
    slug: 'k8s-rbac-explainer',
    title: 'RBAC explainer',
    description: 'Read Roles and bindings in plain words: who can do what, where, and which permissions are risky.',
    group: 'Kubernetes',
    keywords: ['kubernetes', 'k8s', 'rbac', 'role', 'clusterrole', 'rolebinding', 'permissions', 'security', 'serviceaccount'],
  },
  {
    slug: 'k8s-kubeconfig',
    title: 'Service account kubeconfig generator',
    description: 'Get a script that creates a service account with the right RBAC and writes a kubeconfig for it. The token never touches this page.',
    group: 'Kubernetes',
    keywords: ['kubernetes', 'k8s', 'kubeconfig', 'service account', 'serviceaccount', 'token', 'rbac', 'ci', 'cd', 'github actions', 'create token'],
  },
  {
    slug: 'k8s-networkpolicy',
    title: 'NetworkPolicy explainer',
    description: 'See what a NetworkPolicy allows in plain words, and test whether one pod can reach another.',
    group: 'Kubernetes',
    keywords: ['kubernetes', 'k8s', 'networkpolicy', 'network policy', 'ingress', 'egress', 'calico', 'cilium', 'firewall'],
  },
  {
    slug: 'kubectl-builder',
    title: 'kubectl command builder',
    description: 'Build kubectl commands for logs, exec, port-forward, rollouts, debugging and more, with each flag explained.',
    group: 'Kubernetes',
    keywords: ['kubectl', 'kubernetes', 'k8s', 'logs', 'exec', 'port-forward', 'rollout', 'debug', 'command'],
    relatedPrompts: ['debug-crashloopbackoff'],
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
    slug: 'network-commands',
    title: 'Network troubleshooting commands',
    description: 'Get the ping, port, traceroute, DNS, curl, TLS, routing, MTU and packet capture commands for Linux, macOS or Windows, with each flag explained.',
    group: 'Network',
    keywords: ['network', 'troubleshoot', 'ping', 'port', 'nc', 'telnet', 'test-netconnection', 'traceroute', 'mtr', 'tracert', 'dig', 'nslookup', 'dns', 'curl', 'tls', 'openssl', 'ss', 'netstat', 'lsof', 'route', 'mtu', 'tcpdump', 'pktmon', 'firewall', 'connection refused', 'timeout'],
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
