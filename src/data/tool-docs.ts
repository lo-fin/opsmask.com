// Substantive, per-tool engineering documentation, operational use cases, security notes, and FAQs.
// Rendered automatically by ToolShell.astro alongside any tool-specific <slot name="notes" />.

export type ToolFaq = {
  question: string;
  answer: string;
};

export type ToolDoc = {
  howItWorks: string;
  useCases: string[];
  securityNotes: string[];
  faq: ToolFaq[];
  relatedTools: string[];
};

export const TOOL_DOCS: Record<string, ToolDoc> = {
  'text-lines': {
    howItWorks:
      'This utility processes line-delimited text entirely in browser memory using deterministic string operations—supporting case-sensitive or case-insensitive deduplication, alphabetical and natural sorting, whitespace trimming, regex/substring filtering, and list formatting such as SQL IN clauses or CSV strings. Because nothing is uploaded to a server, you can safely clean production hostnames, user IDs, IP lists, or log excerpts.',
    useCases: [
      'Deduplicating and sorting IP addresses, pod names, or container image tags extracted from kubectl or Terraform output.',
      'Converting a column of database IDs or order numbers from a spreadsheet into a quoted SQL IN (\'...\', \'...\') clause or JSON array.',
      'Stripping blank lines, trailing spaces, and comment lines from .env files, firewall allowlists, or host files before committing to Git.',
    ],
    securityNotes: [
      'When cleaning lists of emails, account IDs, or internal hostnames, running locally prevents accidental PII exposure to third-party web servers.',
      'Be mindful of case sensitivity when deduplicating: Linux paths and Kubernetes labels are case-sensitive, whereas DNS hostnames and SQL identifiers are typically case-insensitive.',
    ],
    faq: [
      {
        question: 'Does deduplication preserve the original line order?',
        answer: 'Yes. Deduplication keeps the first occurrence of each line in its original order unless you explicitly enable sorting.',
      },
      {
        question: 'How do I turn a list of IDs into a SQL IN clause?',
        answer: 'Paste one ID per line, trim whitespace, remove empty lines, add single quotes as prefix and suffix, and join with a comma and space.',
      },
      {
        question: 'Can this tool handle thousands of lines without lagging?',
        answer: 'Yes. Standard JavaScript Set and Array operations process tens of thousands of lines in a few milliseconds directly inside your browser tab.',
      },
    ],
    relatedTools: ['text-line-strip', 'text-diff', 'text-escape'],
  },

  'text-line-strip': {
    howItWorks:
      'The line character stripper slices a fixed number of leading or trailing characters from every line in your input, or strips common log prefixes such as RFC3339 timestamps and syslog headers. Clicking directly on the live character ruler sets the exact column offset so you never have to count spaces or characters manually.',
    useCases: [
      'Removing ISO-8601 timestamps, Kubernetes pod prefixes, or Docker Compose service names from copied log streams so diffs and stack traces are readable.',
      'Dedenting YAML or JSON blocks copied from nested manifests or terminal output by stripping a fixed number of leading spaces.',
      'Trimming fixed-width columns or trailing status markers from CLI table output before pasting into documentation or spreadsheets.',
    ],
    securityNotes: [
      'Log prefixes often sit right next to request IDs, internal IP addresses, or bearer tokens. Strip noise locally here, then run the result through the Kubernetes Redactor before sharing externally.',
      'Cutting by character count operates on UTF-16 code units; verify lines containing multi-byte emoji or tabs if exact column alignment matters.',
    ],
    faq: [
      {
        question: 'How does the interactive character ruler work?',
        answer: 'The ruler displays the first non-empty line with character indices above each column. Clicking any character immediately updates the cut count and previews the stripped output.',
      },
      {
        question: 'What happens if a line is shorter than N characters?',
        answer: 'Lines shorter than the strip count become empty rather than throwing an error, and you can optionally skip empty lines.',
      },
      {
        question: 'Can I strip characters from the end of each line instead of the start?',
        answer: 'Yes. Switch the direction control to strip the last N characters—useful for removing trailing commas, semicolons, or timestamps appended at line endings.',
      },
    ],
    relatedTools: ['text-lines', 'text-diff', 'k8s-redactor'],
  },

  'text-diff': {
    howItWorks:
      'The diff workbench compares two blocks of text line by line in your browser using a longest-common-subsequence (LCS) algorithm, highlighting exact additions, removals, and unchanged context lines. Everything stays in client memory so you can safely diff production configs, Helm values, or Kubernetes manifests containing sensitive parameters.',
    useCases: [
      'Comparing staging vs. production Kubernetes ConfigMaps, NGINX configs, or Terraform plan outputs to pinpoint configuration drift.',
      'Verifying what changed between two exported JSON payloads, API responses, or database schema dumps during an incident.',
      'Reviewing Helm-rendered YAML before and after a chart version bump to confirm no unexpected replicas or securityContext fields changed.',
    ],
    securityNotes: [
      'Never paste production .env files or Kubernetes Secrets into cloud-hosted diff tools that store snippets under shareable URLs. OpsMask computes diffs strictly locally with no server storage.',
      'Normalize key ordering or whitespace first (for example using YAML to JSON) when comparing structured files that differ only in formatting.',
    ],
    faq: [
      {
        question: 'Is there a file size limit for comparing two texts?',
        answer: 'There is no artificial server limit because the diff runs in your browser. Typical config files and manifests up to several thousand lines compare almost instantaneously.',
      },
      {
        question: 'Why do identical-looking lines sometimes show as changed?',
        answer: 'Hidden trailing spaces, tabs vs. spaces, or Windows (CRLF) vs. Unix (LF) line endings can cause lines to differ. Trim trailing whitespace or normalize line endings if you only care about content changes.',
      },
      {
        question: 'Can I compare Kubernetes manifests exported from two clusters?',
        answer: 'Yes. For cleaner results, run each exported manifest through kubectl neat first to remove cluster-specific fields like uid, resourceVersion, and managedFields.',
      },
    ],
    relatedTools: ['k8s-neat', 'yaml-json', 'text-lines'],
  },

  'text-case': {
    howItWorks:
      'The case converter tokenizes identifiers across camelCase, PascalCase, snake_case, SCREAMING_SNAKE_CASE, kebab-case, dot.case, and Title Case by detecting word boundaries on separators, underscores, hyphens, and capitalization transitions. It converts single identifiers or bulk multi-line lists locally in real time.',
    useCases: [
      'Converting JSON API fields (camelCase) into environment variable names (SCREAMING_SNAKE_CASE) or Kubernetes resource names (kebab-case).',
      'Standardizing Terraform variables, Prometheus metric names (snake_case), and Helm chart values across teams.',
      'Renaming database columns or Go/TypeScript/Python model properties consistently during migrations.',
    ],
    securityNotes: [
      'Kubernetes resource names (Deployments, Services, Ingresses) must follow RFC 1123 DNS subdomain rules: lowercase alphanumeric characters and hyphens only (kebab-case), never underscores.',
      'Environment variable names in POSIX shells and Kubernetes env blocks should use SCREAMING_SNAKE_CASE and avoid hyphens.',
    ],
    faq: [
      {
        question: 'How does the converter handle acronyms like HTTPServer or userID?',
        answer: 'The tokenizer recognizes consecutive uppercase letters followed by a lowercase letter so identifiers like HTTPServer split cleanly into http_server or http-server.',
      },
      {
        question: 'Can I convert an entire list of keys at once?',
        answer: 'Yes. Paste multiple lines and the tool converts every line simultaneously while preserving line breaks.',
      },
      {
        question: 'Which naming convention should I use for Kubernetes labels and resources?',
        answer: 'Use kebab-case (lowercase with hyphens) for Kubernetes object names, label keys, and namespaces to satisfy DNS-1123 validation.',
      },
    ],
    relatedTools: ['text-lines', 'env-suggest', 'text-escape'],
  },

  'text-escape': {
    howItWorks:
      'This encoder/decoder transforms strings between raw text and escaped formats required by JSON payloads, POSIX shell arguments, URL query parameters (percent-encoding), and HTML entities. All encoding uses standard browser APIs (JSON.stringify, encodeURIComponent, and strict character maps) locally without transmitting sensitive strings.',
    useCases: [
      'Escaping multiline private keys, certificates, or JSON blobs so they can be embedded safely inside a JSON configuration field or Terraform variable.',
      'URL-encoding database passwords containing special characters (@, :, /, ?, #) before embedding them in PostgreSQL, Redis, or MongoDB connection URIs.',
      'Safely single-quoting arbitrary strings for bash or zsh commands to prevent accidental variable expansion or shell injection.',
    ],
    securityNotes: [
      'Unescaped special characters in database connection strings (especially @, #, %, and &) frequently break URI parsers or truncate passwords silently.',
      'HTML entity encoding here is for static markup inspection; always use your web framework’s context-aware auto-escaping in production applications to prevent XSS.',
    ],
    faq: [
      {
        question: 'What is the difference between encodeURI and encodeURIComponent?',
        answer: 'encodeURIComponent escapes reserved URI delimiters like /, ?, &, =, and +, making it the right choice for query parameter values and credentials inside connection strings.',
      },
      {
        question: 'How do I put a multiline PEM certificate into a single-line JSON string?',
        answer: 'Paste the PEM block and select JSON string escape—newlines become \\n so the resulting string is valid inside any JSON object.',
      },
      {
        question: 'Why does shell escaping wrap strings in single quotes?',
        answer: 'In POSIX shells (sh, bash, zsh), single quotes disable all variable expansion ($VAR), command substitution ($(...)), and globbing, making single-quoting the safest way to pass literal secrets.',
      },
    ],
    relatedTools: ['base64', 'json-values', 'text-case'],
  },

  'password-generator': {
    howItWorks:
      'Every password, cryptographic key, API token, and passphrase is generated using the browser’s hardware-backed Web Crypto API (crypto.getRandomValues) with rejection sampling to eliminate modulo bias. Unlike Math.random(), Web Crypto provides cryptographically secure pseudorandom numbers (CSPRNG) directly inside your browser without touching any network.',
    useCases: [
      'Generating 256-bit (32-byte) Hex or Base64 signing keys for JWT HMAC secrets, webhook verification (whsec_), session encryption, or AES-256 keys.',
      'Creating high-entropy service account passwords and database credentials that avoid ambiguous characters or shell-breaking symbols.',
      'Generating memorable diceware-style passphrases for break-glass admin accounts, disk encryption, or password manager master keys.',
    ],
    securityNotes: [
      'Never generate production secrets on a website that calls a backend API—server logs or proxies could retain the generated key. Verify zero network traffic in DevTools.',
      'Store generated secrets immediately in a secret manager (Vault, Azure Key Vault, AWS Secrets Manager, or 1Password) rather than committing them to Git or chat logs.',
    ],
    faq: [
      {
        question: 'How much entropy is recommended for API keys and JWT secrets?',
        answer: 'Use at least 128 bits for standard tokens and 256 bits (32 random bytes, which equals 64 hex characters or 44 Base64 characters) for HMAC-SHA256 signing keys and encryption keys.',
      },
      {
        question: 'Why does the generator use crypto.getRandomValues instead of Math.random?',
        answer: 'Math.random() is a predictable PRNG unsuitable for security. crypto.getRandomValues() draws entropy from the operating system’s cryptographic random source.',
      },
      {
        question: 'Are generated passwords ever saved to localStorage or sent anywhere?',
        answer: 'No. Generated values exist only in the active DOM until you close or refresh the tab.',
      },
    ],
    relatedTools: ['uuid-generator', 'base64', 'k8s-secret'],
  },

  'uuid-generator': {
    howItWorks:
      'This generator creates standards-compliant RFC 9562 UUID v4 (random), UUID v7 (Unix millisecond timestamp-ordered), 26-character Crockford Base32 ULIDs, URL-safe NanoIDs, and Kubernetes-compatible DNS-1123 resource slugs using Web Crypto (crypto.getRandomValues) entirely client-side.',
    useCases: [
      'Generating time-sortable UUID v7 or ULID primary keys for PostgreSQL, MySQL, and distributed event logs to avoid B-tree index fragmentation.',
      'Creating bulk correlation IDs, test fixture identifiers, or idempotency keys for integration tests and API requests.',
      'Producing lowercase alphanumeric Kubernetes job or pod suffixes that strictly satisfy RFC 1123 label rules.',
    ],
    securityNotes: [
      'UUID v7 and ULID embed a millisecond-precision creation timestamp in their leading bits. Do not use them if the creation time of a record must remain confidential; use UUID v4 or NanoID instead.',
      'Never use sequential integers or predictable UUID v1 (MAC-address based) for public-facing security tokens.',
    ],
    faq: [
      {
        question: 'When should I choose UUID v7 over UUID v4?',
        answer: 'Choose UUID v7 for database primary keys and event streams because its timestamp prefix keeps inserts sequential in B-tree indexes, dramatically reducing page splits and write amplification compared to random UUID v4.',
      },
      {
        question: 'What is the difference between UUID v7 and ULID?',
        answer: 'Both embed a 48-bit Unix millisecond timestamp followed by 74–80 bits of randomness. UUID v7 fits native 128-bit UUID database columns (36 chars with hyphens), while ULID uses 26-character URL-safe Base32 strings.',
      },
      {
        question: 'Are NanoIDs collision-resistant enough for production IDs?',
        answer: 'A 21-character NanoID using the default 64-character URL-safe alphabet provides 126 bits of entropy—comparable to UUID v4 (122 random bits).',
      },
    ],
    relatedTools: ['password-generator', 'text-case', 'text-lines'],
  },

  'json-values': {
    howItWorks:
      'The JSON value extractor parses arbitrary nested JSON objects and arrays in your browser, flattens every leaf path using dot/bracket notation, and unwraps embedded JSON strings (such as double-serialized payloads inside appsettings.json or cloud secret JSON blobs) so you can search and copy any value with a single click.',
    useCases: [
      'Extracting individual connection strings, client IDs, or API endpoints from .NET appsettings.json, AWS Secrets Manager JSON blobs, or GCP service account keys.',
      'Auditing deeply nested API responses or Kubernetes JSON output without manually writing complex jq filters.',
      'Comparing or migrating key-value pairs from JSON configs into Kubernetes Secrets, ConfigMaps, or GitHub Actions repository secrets.',
    ],
    securityNotes: [
      'Cloud credential JSON files (such as GCP service account keys or Azure service principal outputs) contain private keys and client secrets. Parsing them locally ensures credentials never touch a remote server.',
      'Always clear your clipboard after copying sensitive secrets, or use a clipboard manager that auto-expires sensitive entries.',
    ],
    faq: [
      {
        question: 'What does embedded JSON unwrapping do?',
        answer: 'Many logging pipelines and secret managers store a JSON object as an escaped string inside another JSON field. Unwrapping automatically detects and parses those inner JSON strings so you can inspect their keys cleanly.',
      },
      {
        question: 'Can I copy the flattened path as well as the value?',
        answer: 'Yes. Each extracted row displays its full flattened key path alongside a one-click copy button for the exact unquoted leaf value.',
      },
      {
        question: 'What if my JSON has trailing commas or syntax errors?',
        answer: 'Standard JSON (RFC 8259) forbids trailing commas and single quotes. The tool reports the exact parser error so you can fix malformed payloads quickly.',
      },
    ],
    relatedTools: ['xml-values', 'yaml-json', 'env-suggest'],
  },

  'xml-values': {
    howItWorks:
      'This tool parses XML documents locally using the browser’s native DOMParser, walks every element and attribute, and presents all leaf values with their XPath-like hierarchy and one-click copy controls. It is tailored for .NET web.config/app.config files, Maven pom.xml, SAML assertions, and legacy SOAP payloads.',
    useCases: [
      'Extracting connectionStrings and appSettings values from .NET Framework web.config or app.config files during cloud or Kubernetes migrations.',
      'Inspecting SAML 2.0 metadata XML, Identity Provider certificates, and Assertion Consumer Service URLs when debugging SSO.',
      'Auditing Maven pom.xml properties, dependency versions, or Spring XML bean configurations quickly.',
    ],
    securityNotes: [
      'XML configuration files frequently contain database passwords, machine keys, and SMTP credentials. Because DOMParser runs purely client-side without external entity resolution (XXE), your files never leave your browser.',
      'When migrating XML appSettings to Kubernetes ConfigMaps or Secrets, separate non-sensitive flags from credentials so secrets stay in Secret objects or an external secret store.',
    ],
    faq: [
      {
        question: 'Does the extractor read XML attributes as well as element text?',
        answer: 'Yes. Both element text content and attributes (such as key="..." and value="..." in .NET appSettings) are extracted and listed cleanly.',
      },
      {
        question: 'Why does XML parsing fail on unescaped ampersands?',
        answer: 'In valid XML, literal & characters inside URLs or passwords must be written as &amp;. If a snippet fails to parse, check for raw & characters in connection strings.',
      },
      {
        question: 'Can I paste SOAP envelopes with XML namespaces?',
        answer: 'Yes. Namespaced tags (for example soap:Envelope or saml:Assertion) are parsed and displayed with their full element names.',
      },
    ],
    relatedTools: ['json-values', 'yaml-json', 'env-suggest'],
  },

  'yaml-json': {
    howItWorks:
      'Powered by js-yaml running client-side, this converter translates between YAML and JSON bidirectionally, including multi-document Kubernetes YAML files separated by --- markers (which convert cleanly to a JSON array of objects and back).',
    useCases: [
      'Converting Kubernetes manifests or Helm values.yaml into JSON so you can query them with jq or validate them against JSON Schema.',
      'Turning raw JSON API output (such as kubectl get -o json or AWS CLI responses) into readable YAML for documentation or GitOps repositories.',
      'Debugging subtle YAML indentation bugs, Norway problem booleans (yes/no/on/off), or multi-document separator issues.',
    ],
    securityNotes: [
      'The converter uses js-yaml safe loading (no arbitrary code execution tags) and runs completely inside your browser tab.',
      'Watch out for YAML 1.1 implicit typing: unquoted values like yes, no, on, off, or version numbers like 1.10 can be parsed as booleans or floats instead of strings unless quoted.',
    ],
    faq: [
      {
        question: 'How does it handle multi-document YAML separated by ---?',
        answer: 'Multi-document YAML files (such as rendered Helm templates containing a Deployment, Service, and Ingress) are parsed into an array of JSON objects and can be converted back cleanly.',
      },
      {
        question: 'Are YAML comments preserved when converting to JSON?',
        answer: 'No. Standard JSON does not support comments, so YAML comments are stripped during YAML-to-JSON conversion.',
      },
      {
        question: 'Why did my port number or version string change format?',
        answer: 'In YAML, unquoted values like 0800 or 2.10 may be interpreted as numbers. Wrap values that must stay strings (like image tags or Kubernetes Secret keys) in double quotes.',
      },
    ],
    relatedTools: ['k8s-manifest-checker', 'json-values', 'k8s-neat'],
  },

  'env-suggest': {
    howItWorks:
      'The Env & ConfigMap/Secret suggester analyzes configuration dumps from your existing environments (such as dev, staging, and prod), infers naming patterns, URL host transformations, and namespace conventions, and suggests ready-to-review values for a new target environment while automatically masking secrets on screen.',
    useCases: [
      'Bootstrapping ConfigMaps, Secrets, or .env files for a brand-new QA, UAT, or regional production environment without manually editing dozens of keys.',
      'Spotting missing environment variables that exist in staging but were accidentally omitted in production manifests.',
      'Auditing configuration drift across multiple namespaces before a release cutover.',
    ],
    securityNotes: [
      'Sensitive keys (passwords, tokens, API keys, connection strings) are masked visually by default and never sent over the network.',
      'Never reuse production secrets in staging or development environments—always replace suggested secret placeholders with freshly generated credentials.',
    ],
    faq: [
      {
        question: 'What input formats does the suggester accept?',
        answer: 'It accepts Kubernetes ConfigMap and Secret YAML, standard .env (KEY=value) files, and JSON key-value maps.',
      },
      {
        question: 'Does it automatically decode Base64 values in Kubernetes Secrets?',
        answer: 'Yes. Base64-encoded Secret data fields are decoded locally in memory for comparison and kept masked on screen.',
      },
      {
        question: 'Should I blindly apply suggested values to production?',
        answer: 'No. Treat suggestions as a fast starting template—always review endpoints, feature flags, replica counts, and credentials before committing to Git or applying to a cluster.',
      },
    ],
    relatedTools: ['k8s-secret', 'json-values', 'password-generator'],
  },

  'k8s-manifest-checker': {
    howItWorks:
      'This static analyzer parses single or multi-document Kubernetes YAML locally in your browser and evaluates every workload against production readiness and security rules—checking resource requests/limits, image tags, securityContext hardening, liveness/readiness probes, service account token mounting, and host namespace exposure.',
    useCases: [
      'Running an instant pre-PR security and reliability check on Deployment, StatefulSet, DaemonSet, and CronJob manifests.',
      'Auditing third-party Helm charts (after running helm template) to catch privileged containers, root users, or missing memory limits before deploying.',
      'Teaching junior engineers why fields like allowPrivilegeEscalation: false and readOnlyRootFilesystem: true matter in production.',
    ],
    securityNotes: [
      'Static manifest checks catch misconfigurations before deployment, but they complement—rather than replace—cluster admission controllers like Kyverno, OPA Gatekeeper, or Pod Security Admission.',
      'Running containers as root with capabilities intact dramatically increases blast radius if an application vulnerability leads to remote code execution.',
    ],
    faq: [
      {
        question: 'Why does the checker warn about :latest or untagged images?',
        answer: 'Mutable tags like :latest make deployments non-reproducible and break rollbacks because two nodes can pull different digests at different times. Always pin immutable semantic versions or SHA-256 digests.',
      },
      {
        question: 'Should I set both CPU requests and CPU limits?',
        answer: 'Always set CPU requests so the scheduler places pods accurately. For CPU limits, many SRE teams either set generous limits or omit CPU limits on latency-sensitive services to avoid CFS throttling—while ALWAYS setting memory limits equal to memory requests to prevent OOM node instability.',
      },
      {
        question: 'Can I paste multi-document Helm output into this tool?',
        answer: 'Yes. Paste the entire output of helm template and the checker evaluates every document separated by ---.',
      },
    ],
    relatedTools: ['k8s-neat', 'k8s-redactor', 'k8s-resource-calculator'],
  },

  'k8s-pod-status': {
    howItWorks:
      'The Pod Status Explainer parses raw kubectl describe pod output directly in your browser—extracting container states, termination exit codes, OOMKilled flags, image pull errors, probe failures, and scheduler events—and maps them to plain-English root causes and copy-ready diagnostic commands.',
    useCases: [
      'Triaging CrashLoopBackOff, ImagePullBackOff, CreateContainerConfigError, Pending, or Evicted pods rapidly during an on-call page.',
      'Decoding Linux container exit codes (such as 137 for SIGKILL/OOMKilled, 143 for SIGTERM, 126/127 for entrypoint issues) without looking them up manually.',
      'Generating the exact next kubectl logs --previous or kubectl get events command to confirm the root cause.',
    ],
    securityNotes: [
      'kubectl describe pod output can include internal container registry URLs, node IPs, and environment variable names. Analyzing it locally keeps internal cluster topology private.',
      'If you still need deeper AI assistance after local triage, use the linked CrashLoopBackOff AI prompt which automatically masks IPs and tokens before copying.',
    ],
    faq: [
      {
        question: 'What does Exit Code 137 mean in Kubernetes?',
        answer: 'Exit code 137 (128 + 9) means the process received SIGKILL. In Kubernetes, this almost always indicates the container exceeded its memory limit (OOMKilled) or failed to exit gracefully within terminationGracePeriodSeconds.',
      },
      {
        question: 'Why is a pod stuck in Pending with no container logs?',
        answer: 'A Pending pod has not been scheduled onto a node yet, so no container has started. Check the Events section for Insufficient cpu/memory, node affinity mismatches, unbound PVCs, or untolerated taints.',
      },
      {
        question: 'What causes ImagePullBackOff?',
        answer: 'Common causes include a misspelled image tag, a private registry missing an imagePullSecret, expired registry credentials, or rate limiting (e.g., Docker Hub anonymous pull limits).',
      },
    ],
    relatedTools: ['kubectl-builder', 'k8s-manifest-checker', 'k8s-resource-calculator'],
  },

  'k8s-neat': {
    howItWorks:
      'Inspired by the kubectl-neat plugin, this browser tool strips runtime noise injected by the Kubernetes API server—including status, metadata.managedFields, uid, resourceVersion, generation, creationTimestamp, cluster-assigned clusterIPs, and defaulted fields—leaving a clean, GitOps-ready manifest you can commit or diff.',
    useCases: [
      'Exporting an existing cluster workload via kubectl get -o yaml and turning it into a clean manifest for GitOps (ArgoCD or Flux).',
      'Preparing readable YAML before comparing two environments in a diff tool or attaching a manifest to a pull request.',
      'Cloning a production Deployment into a staging namespace without carrying over stale clusterIPs, nodeNames, or controller UIDs.',
    ],
    securityNotes: [
      'Cleaning metadata does not redact Secret data values or hardcoded environment passwords. If you plan to share the cleaned YAML externally, run it through the Kubernetes Redactor afterward.',
      'Always review cleaned Service manifests if you intentionally rely on a static clusterIP or loadBalancerIP.',
    ],
    faq: [
      {
        question: 'Why does kubectl get -o yaml include so much extra metadata?',
        answer: 'The Kubernetes API server tracks server-side apply ownership in managedFields, optimistic concurrency in resourceVersion, and live controller state in status. None of these fields belong in source-controlled manifests.',
      },
      {
        question: 'Does this support multi-document YAML lists (kind: List)?',
        answer: 'Yes. It cleans both standard --- multi-document YAML streams and Kubernetes List objects.',
      },
      {
        question: 'Can I apply the cleaned manifest directly to another cluster?',
        answer: 'Usually yes—just double-check namespace, Ingress hostnames, StorageClass names, and Secret references before applying.',
      },
    ],
    relatedTools: ['k8s-redactor', 'k8s-manifest-checker', 'text-diff'],
  },

  'k8s-resource-calculator': {
    howItWorks:
      'This calculator converts Kubernetes CPU quantities (millicores vs. cores) and memory units (binary Mi/Gi vs. decimal M/G), calculates how many pod replicas fit on a node after accounting for kubelet/system reservations, and sums total requests and limits across pasted multi-document manifests.',
    useCases: [
      'Right-sizing node pools on AKS, EKS, or GKE by verifying exact pod packing density per VM SKU (for example, 4 vCPU / 16 GiB nodes).',
      'Preventing Pending pods during rolling updates by checking whether your cluster has enough allocatable headroom for maxSurge replicas.',
      'Auditing total CPU and memory commitments across all Deployments in a namespace before setting ResourceQuotas.',
    ],
    securityNotes: [
      'Remember that cloud nodes reserve a portion of CPU and memory for the OS, kubelet, and container runtime—allocatable capacity is always lower than raw VM specs.',
      'Confusing decimal MB (10^6 bytes) with binary MiB (2^20 bytes) causes subtle ~5–7% calculation discrepancies in memory limits and OOM thresholds.',
    ],
    faq: [
      {
        question: 'What is the difference between 1000m CPU and 1 CPU?',
        answer: 'They are identical. Kubernetes measures CPU in millicores (m), where 1000m equals 1 full vCPU/core, 250m equals 0.25 cores, and 500m equals half a core.',
      },
      {
        question: 'What is the difference between Gi and G in Kubernetes memory?',
        answer: 'Gi is gibibytes (1024^3 = 1,073,741,824 bytes), while G is gigabytes (1000^3 = 1,000,000,000 bytes). Standard Kubernetes convention is binary units (Mi and Gi).',
      },
      {
        question: 'Why do fewer pods fit on my node than raw CPU/RAM math predicts?',
        answer: 'In addition to kube-reserved and system-reserved overhead, DaemonSets (logging, monitoring, CNI plugins) consume requests on every node, and cloud CNIs impose a maximum pods-per-node limit.',
      },
    ],
    relatedTools: ['k8s-manifest-checker', 'k8s-pod-status', 'cidr-calculator'],
  },

  'k8s-secret': {
    howItWorks:
      'The Kubernetes Secret Decoder parses Secret YAML locally in your browser, Base64-decodes every key under data: at once (including nested .dockerconfigjson payloads), flags accidental trailing newlines that break authentication, and lets you generate clean Secret manifests from plain KEY=value lines.',
    useCases: [
      'Inspecting every key inside a Kubernetes Secret YAML in one view instead of running repetitive kubectl jsonpath | base64 -d commands.',
      'Debugging mysterious 401/authentication failures caused by echo "secret" | base64 appending a hidden trailing newline (\\n).',
      'Converting a local .env file into a valid Kubernetes Secret YAML (using data: or stringData:) without installing extra CLI plugins.',
    ],
    securityNotes: [
      'Base64 is encoding, not encryption. Anyone with RBAC get/list access to Secrets in a namespace can decode them instantly unless you enable KMS encryption at rest and restrict RBAC.',
      'Decoded values remain strictly inside your browser tab; OpsMask never transmits pasted Secret manifests over the network.',
    ],
    faq: [
      {
        question: 'Why do trailing newlines break Kubernetes Secrets?',
        answer: 'Running echo "my-pass" | base64 encodes a trailing newline character. When an application reads that Secret as a password or API key, authentication fails even though the value looks right when printed. Always use echo -n or stringData.',
      },
      {
        question: 'When should I use stringData instead of data?',
        answer: 'Use stringData in write-only templates when you want Kubernetes to handle Base64 encoding automatically upon apply. Note that Kubernetes never returns stringData when you read the Secret back—it merges everything into data.',
      },
      {
        question: 'Can this tool decode imagePullSecrets (.dockerconfigjson)?',
        answer: 'Yes. It decodes the Base64 .dockerconfigjson blob so you can verify registry URLs and usernames locally.',
      },
    ],
    relatedTools: ['base64', 'k8s-redactor', 'env-suggest'],
  },

  'k8s-redactor': {
    howItWorks:
      'The Kubernetes Manifest & Kubeconfig Redactor parses YAML structures and scans raw text locally to mask Secret data values, kubeconfig client-certificate-data/tokens, bearer credentials, connection strings, cluster API endpoints, internal IPs, and optional emails or GUIDs—producing a clean, safe version you can paste into AI chats or vendor support tickets.',
    useCases: [
      'Sanitizing kubectl get -o yaml outputs, Helm values, or kubeconfig files before asking ChatGPT or Claude to help debug a cluster issue.',
      'Stripping production passwords, AWS/Azure keys, and private IP ranges from incident logs before attaching them to Jira tickets or GitHub issues.',
      'Verifying whether a config snippet contains hidden credentials before sharing it in Slack or Microsoft Teams.',
    ],
    securityNotes: [
      'Automated pattern redaction catches standard formats (Kubernetes Secret fields, kubeconfig tokens, JWTs, PEM blocks, common key=value secrets, IPs), but proprietary token formats can still slip through—always review the highlighted output before copying.',
      'If a production secret has already been pasted into an external chat or public repo, rotate it immediately rather than relying on message deletion.',
    ],
    faq: [
      {
        question: 'Does redacting a manifest keep it valid YAML?',
        answer: 'Yes. For Kubernetes Secret and kubeconfig fields, the redactor replaces sensitive values with readable placeholders while preserving YAML structure so AI models and linters still understand the manifest.',
      },
      {
        question: 'Are the original secrets ever sent to a server during redaction?',
        answer: 'No. All parsing and regex redaction run 100% client-side in your browser tab.',
      },
      {
        question: 'Can I choose whether to mask IP addresses or emails?',
        answer: 'Yes. You can toggle individual redaction categories (secrets/tokens, IP addresses, and emails/identifiers) depending on what your ticket or AI prompt needs.',
      },
    ],
    relatedTools: ['k8s-neat', 'k8s-secret', 'jwt-decoder'],
  },

  'k8s-label-selector': {
    howItWorks:
      'This tester evaluates Kubernetes equality-based selectors (app=api, env!=dev), set-based expressions (env in (prod,staging)), and YAML matchLabels/matchExpressions blocks against pod label tables (such as kubectl get pods --show-labels), explaining exactly why each pod matched or failed.',
    useCases: [
      'Debugging a Kubernetes Service with empty Endpoints by checking whether its spec.selector actually matches your Deployment pod template labels.',
      'Testing complex NetworkPolicy podSelector or PodAffinity matchExpressions before applying them to a production namespace.',
      'Verifying kubectl -l label queries before running bulk deletes or rollouts.',
    ],
    securityNotes: [
      'An empty label selector ({}) in a Kubernetes NetworkPolicy matches ALL pods in the namespace—which can accidentally expose or block traffic if misconfigured.',
      'Always test selectors against a list of real pod labels before running destructive commands like kubectl delete pods -l ...',
    ],
    faq: [
      {
        question: 'How are multiple conditions in matchLabels and matchExpressions combined?',
        answer: 'All requirements in a Kubernetes selector are logically ANDed together. A pod must satisfy every key-value pair in matchLabels and every rule in matchExpressions to match.',
      },
      {
        question: 'Why does my Service have no endpoints even though pods are Running?',
        answer: 'The two most common causes are a typo in spec.selector vs. pod metadata.labels, or pods failing their readinessProbe (unready pods are removed from Service endpoints).',
      },
      {
        question: 'Can I paste the raw output of kubectl get pods --show-labels?',
        answer: 'Yes. The tool parses standard kubectl --show-labels output directly as well as YAML pod specs.',
      },
    ],
    relatedTools: ['k8s-networkpolicy', 'kubectl-builder', 'k8s-manifest-checker'],
  },

  'k8s-rbac-explainer': {
    howItWorks:
      'The RBAC Explainer parses Kubernetes Role, ClusterRole, RoleBinding, and ClusterRoleBinding YAML locally, maps subjects (Users, Groups, ServiceAccounts) to their exact API groups, resources, and verbs, and flags high-risk privilege escalation paths such as wildcard permissions, secrets read access, or pods/exec.',
    useCases: [
      'Auditing third-party Helm chart ClusterRoles before installing operators or monitoring agents into a production cluster.',
      'Reviewing CI/CD ServiceAccount permissions to enforce least-privilege access scoped to a single namespace.',
      'Preparing security compliance evidence by translating complex RBAC YAML into human-readable access summaries.',
    ],
    securityNotes: [
      'Granting get or list on secrets at the cluster scope effectively grants cluster-admin in many clusters because ServiceAccount tokens or cloud credentials can be harvested.',
      'Watch out for verbs like escalate, bind, impersonate, and create on pods/exec or roles—these enable direct privilege escalation.',
    ],
    faq: [
      {
        question: 'What is the difference between a Role and a ClusterRole?',
        answer: 'A Role grants permissions strictly within a single namespace. A ClusterRole can grant permissions to cluster-scoped resources (like Nodes or PersistentVolumes) or across all namespaces when paired with a ClusterRoleBinding.',
      },
      {
        question: 'Can a RoleBinding reference a ClusterRole?',
        answer: 'Yes. Binding a reusable ClusterRole (like view or edit) with a namespaced RoleBinding restricts those permissions strictly to the RoleBinding’s namespace.',
      },
      {
        question: 'Why is wildcard (*) in apiGroups or resources risky?',
        answer: 'Wildcards automatically grant access to sensitive resources like secrets, pods/exec, and future CRDs installed in the cluster. Always enumerate explicit apiGroups, resources, and verbs.',
      },
    ],
    relatedTools: ['k8s-kubeconfig', 'k8s-networkpolicy', 'k8s-manifest-checker'],
  },

  'k8s-kubeconfig': {
    howItWorks:
      'This generator builds a clean, auditable shell script and least-privilege RBAC manifest that creates a dedicated Kubernetes ServiceAccount, binds scoped permissions, requests a time-bound token via kubectl create token (Kubernetes 1.24+), and writes a standalone kubeconfig file locally on your machine—so cluster credentials never touch this web page.',
    useCases: [
      'Generating scoped, short-lived kubeconfigs for GitHub Actions, GitLab CI, or Azure DevOps deployment pipelines.',
      'Granting a developer or contractor read-only access to a single staging namespace without sharing cluster-admin credentials.',
      'Replacing legacy long-lived Secret-based ServiceAccount tokens with modern bound, expiring TokenRequest tokens.',
    ],
    securityNotes: [
      'Prefer OIDC Workload Identity Federation (AWS IRSA, Azure Workload Identity, GCP Workload Identity) over static kubeconfigs whenever your CI/CD platform supports it.',
      'When static kubeconfigs are unavoidable, scope permissions to a single namespace RoleBinding and set the shortest practical token expiration (--duration).',
    ],
    faq: [
      {
        question: 'Why does the tool generate a script instead of asking for my cluster token?',
        answer: 'Because your cluster credentials should never leave your terminal. Generating a script lets you inspect every kubectl command and run it directly against your cluster.',
      },
      {
        question: 'Why does Kubernetes 1.24+ no longer auto-create Secret tokens for ServiceAccounts?',
        answer: 'Long-lived, non-expiring Secret tokens posed a major security risk if leaked. Kubernetes 1.24+ recommends short-lived, audience-bound tokens generated via kubectl create token.',
      },
      {
        question: 'How do I revoke a ServiceAccount kubeconfig if it leaks?',
        answer: 'Deleting the ServiceAccount (or deleting its RoleBinding) immediately invalidates all tokens issued for that ServiceAccount.',
      },
    ],
    relatedTools: ['k8s-rbac-explainer', 'k8s-redactor', 'kubectl-builder'],
  },

  'k8s-networkpolicy': {
    howItWorks:
      'The NetworkPolicy Explainer parses Kubernetes networking.k8s.io/v1 NetworkPolicy manifests locally, translates complex podSelector, namespaceSelector, and ipBlock rules into plain English, and lets you simulate whether traffic between a source pod and destination pod is allowed or blocked.',
    useCases: [
      'Verifying default-deny ingress and egress NetworkPolicies before rolling them out to production so you do not accidentally block CoreDNS (UDP/TCP 53).',
      'Troubleshooting microservice connection timeouts in Calico, Cilium, or Azure CNI clusters by checking whether both egress (source) and ingress (destination) allow the flow.',
      'Reviewing multi-tenant namespace isolation policies during security audits.',
    ],
    securityNotes: [
      'Kubernetes NetworkPolicies are additive and require a CNI plugin that enforces them (Calico, Cilium, Antrea, Weave). Default kubenet or basic CNIs silently ignore NetworkPolicy objects.',
      'A classic YAML gotcha: putting podSelector and namespaceSelector in the same list item (- ...) ANDs them together, whereas putting them in separate list items ORs them.',
    ],
    faq: [
      {
        question: 'Why did my pods lose DNS resolution after adding a default-deny egress policy?',
        answer: 'Default-deny egress blocks all outbound traffic, including DNS queries to kube-dns/CoreDNS. Always add an explicit egress rule allowing UDP and TCP port 53 to the kube-system namespace.',
      },
      {
        question: 'Are NetworkPolicies stateful for return traffic?',
        answer: 'Yes. If ingress is allowed from Pod A to Pod B on port 8080, the TCP response packets from Pod B back to Pod A are automatically permitted without a separate egress rule.',
      },
      {
        question: 'What happens if a pod is matched by multiple NetworkPolicies?',
        answer: 'Policies are combined via union (OR). If any matching policy allows a connection, the traffic is permitted—there is no explicit "deny" rule in standard Kubernetes NetworkPolicy.',
      },
    ],
    relatedTools: ['k8s-label-selector', 'k8s-rbac-explainer', 'network-commands'],
  },

  'kubectl-builder': {
    howItWorks:
      'The kubectl Command Builder constructs syntactically valid, copy-ready kubectl commands for logs, exec, ephemeral debug containers, port-forwarding, rollouts, resource inspection, and dry-run manifest generation—explaining every flag inline so you understand what runs before hitting Enter.',
    useCases: [
      'Building complex kubectl logs, field-selector, or jsonpath commands without memorizing exact flag syntax during an outage.',
      'Generating safe kubectl debug ephemeral container commands for distroless images that lack a shell.',
      'Teaching team members standard kubectl flags for rollouts, label filtering, and dry-run YAML exports.',
    ],
    securityNotes: [
      'Always double-check your active context (kubectl config current-context) and namespace (-n) before running write commands like rollout undo, scale, or delete.',
      'In GitOps-managed clusters (ArgoCD/Flux), manual kubectl edits will be reverted automatically unless you commit the change to Git.',
    ],
    faq: [
      {
        question: 'How do I view logs from a container that already crashed?',
        answer: 'Add the --previous (or -p) flag to kubectl logs to retrieve stdout/stderr from the previous terminated container instance.',
      },
      {
        question: 'What is the difference between kubectl exec and kubectl debug?',
        answer: 'kubectl exec runs a command inside an existing container (requiring a shell or binary inside that image). kubectl debug attaches a temporary sidecar container with debugging tools to a running pod without restarting it.',
      },
      {
        question: 'How do I preview a manifest without creating it in the cluster?',
        answer: 'Append --dry-run=client -o yaml to kubectl create commands to generate clean YAML locally.',
      },
    ],
    relatedTools: ['k8s-pod-status', 'k8s-neat', 'k8s-label-selector'],
  },

  'jwt-decoder': {
    howItWorks:
      'The JWT Decoder splits a Base64URL-encoded JSON Web Token (header.payload.signature) locally in your browser, decodes the UTF-8 JSON header and claims, converts Unix epoch timestamps (iat, nbf, exp) into UTC and local human-readable dates, and immediately tells you whether the token is expired or still active.',
    useCases: [
      'Debugging OAuth 2.0 / OIDC login issues with Microsoft Entra ID (Azure AD), Auth0, Okta, Keycloak, or AWS Cognito by inspecting aud, iss, scp, and roles claims.',
      'Checking whether a 401 Unauthorized API error is caused by an expired exp claim, clock skew on nbf, or a missing permission scope.',
      'Verifying token signing algorithms (alg, kid) in the JOSE header when rotating JWKS signing keys.',
    ],
    securityNotes: [
      'Decoding a JWT does NOT verify its cryptographic signature. Never trust decoded claims in backend authorization logic without validating the signature against the issuer’s JWKS endpoint and checking iss, aud, and exp.',
      'Production bearer tokens grant live access until they expire—never paste them into server-backed online JWT decoders that log HTTP requests.',
    ],
    faq: [
      {
        question: 'Can this tool decode a JWT that starts with "Bearer "?',
        answer: 'Yes. It automatically strips a leading Bearer prefix so you can paste directly from an Authorization HTTP header.',
      },
      {
        question: 'Why can anyone read the contents of a JWT without the secret key?',
        answer: 'Standard JWTs (JWS) are digitally signed to guarantee integrity, not encrypted for confidentiality. Header and payload are merely Base64URL-encoded JSON. Never put passwords or sensitive PII inside a JWT payload.',
      },
      {
        question: 'What are the most common JWT claims to check when debugging 401/403 errors?',
        answer: 'Check exp (expiration time), nbf (not before), aud (audience—must match your API identifier), iss (issuer URL), and scp/roles (granted permissions).',
      },
    ],
    relatedTools: ['base64', 'k8s-redactor', 'password-generator'],
  },

  'base64': {
    howItWorks:
      'This encoder/decoder converts between UTF-8 text and standard RFC 4648 Base64 or URL-safe Base64URL (- and _ without padding) directly inside your browser using TextEncoder/TextDecoder, ensuring international characters and emojis encode reliably without corruption.',
    useCases: [
      'Encoding and decoding Kubernetes Secret data fields, HTTP Basic Authentication headers (username:password), and webhook payloads.',
      'Decoding URL-safe Base64URL segments from JWTs, SAML parameters, or OAuth PKCE code challenges.',
      'Batch encoding or decoding line-by-line lists of tokens or configuration values using per-line mode.',
    ],
    securityNotes: [
      'Base64 provides zero confidentiality—it is a reversible binary-to-text encoding, not encryption.',
      'When encoding secrets from a terminal, always use echo -n (or printf "%s") to avoid encoding a hidden trailing newline character.',
    ],
    faq: [
      {
        question: 'What is the difference between standard Base64 and URL-safe Base64?',
        answer: 'Standard Base64 uses + and / with = padding, which can break URLs and filenames. URL-safe Base64 (Base64URL) replaces + with -, / with _, and omits trailing = padding.',
      },
      {
        question: 'Why does standard browser atob() fail on UTF-8 characters like accented letters or emoji?',
        answer: 'Legacy atob/btoa operate on Latin-1 byte strings. OpsMask wraps them with TextEncoder and TextDecoder so all UTF-8 text encodes and decodes losslessly.',
      },
      {
        question: 'Why did my decoded Kubernetes Secret have an extra blank line?',
        answer: 'Whoever created the Secret likely piped echo "value" | base64 without -n, encoding a newline at the end. Use our Kubernetes Secret Decoder to spot trailing newlines automatically.',
      },
    ],
    relatedTools: ['k8s-secret', 'jwt-decoder', 'text-escape'],
  },

  'cidr-calculator': {
    howItWorks:
      'The CIDR & Subnet Calculator performs bitwise IPv4 math locally to compute the network address, broadcast address, first and last usable host IPs, subnet mask, wildcard mask, and cloud-provider usable counts (such as Azure VNet’s 5 reserved addresses per subnet), plus interactive subnet splitting.',
    useCases: [
      'Sizing VPC and Azure VNet subnets for AKS/EKS clusters (where Azure CNI assigns a real subnet IP to every pod and node).',
      'Splitting a larger CIDR block (for example, 10.20.0.0/16) into non-overlapping subnets for public ingress, private workloads, and managed databases.',
      'Writing accurate firewall rules, AWS Security Groups, or Kubernetes NetworkPolicy ipBlock CIDR ranges without off-by-one errors.',
    ],
    securityNotes: [
      'AWS VPC, Azure VNet, and GCP reserve 5 IP addresses per subnet (network, gateway, two DNS/cloud internal IPs, and broadcast)—not just 2. Underestimating this on small /28 or /27 subnets causes unexpected IP exhaustion.',
      'Avoid overlapping RFC 1918 ranges (especially 10.0.0.0/16 or 192.168.0.0/16) across environments if you ever plan to peer VNets/VPCs or connect via VPN.',
    ],
    faq: [
      {
        question: 'How many usable IPs are in a /24 subnet on Azure or AWS?',
        answer: 'A /24 subnet has 256 total IP addresses. Standard networking reserves 2 (254 usable), while AWS and Azure reserve 5 addresses, leaving 251 usable host/pod IPs.',
      },
      {
        question: 'What is the smallest subnet size recommended for Kubernetes nodes?',
        answer: 'With Azure CNI or AWS VPC CNI where every pod consumes a subnet IP, a /24 (251 usable IPs) fills up quickly once you account for rolling upgrade surge pods. Plan /22 (1,019 usable) or /21 subnets for production node pools.',
      },
      {
        question: 'What does a /32 CIDR mean?',
        answer: 'A /32 CIDR matches one exact IPv4 address (1 host), commonly used in firewall allowlists and NetworkPolicy ipBlock rules.',
      },
    ],
    relatedTools: ['network-commands', 'k8s-networkpolicy', 'k8s-resource-calculator'],
  },

  'network-commands': {
    howItWorks:
      'This cross-platform troubleshooting command builder generates copy-ready commands for ICMP reachability, TCP port checks, traceroute/MTR, DNS lookups, HTTP/TLS inspection, listening sockets, routing tables, MTU discovery, and packet capture across Linux, macOS, and Windows PowerShell—with every flag explained.',
    useCases: [
      'Diagnosing "Connection refused" vs. "Connection timed out" errors between microservices, load balancers, and managed databases.',
      'Checking DNS propagation, CNAME chains, and internal split-horizon resolution using dig, nslookup, or Resolve-DnsName.',
      'Testing TLS handshakes, SNI certificates, and HTTP/2 redirects from a jump host or ephemeral debug container.',
    ],
    securityNotes: [
      'Packet captures (tcpdump, pktmon) can record unencrypted credentials and session cookies. Filter strictly by host and port, and delete .pcap files once triage is complete.',
      'Only run port scans and packet captures on networks and hosts you are authorized to operate.',
    ],
    faq: [
      {
        question: 'What is the difference between "Connection refused" and "Connection timed out"?',
        answer: 'Connection refused means your packets reached the target host and it actively replied with TCP RST because nothing is listening on that port. Connection timed out usually indicates a firewall, Security Group, NetworkPolicy, or routing blackhole silently dropping packets.',
      },
      {
        question: 'How do I test a TCP port on Windows without installing telnet or nc?',
        answer: 'Use PowerShell’s built-in Test-NetConnection -ComputerName <host> -Port <port> (or tnc for short).',
      },
      {
        question: 'Why does curl work on HTTP but fail on HTTPS behind a proxy or ingress?',
        answer: 'Check SNI hostnames, missing intermediate certificates, or corporate root CAs using curl -vI or openssl s_client -servername.',
      },
    ],
    relatedTools: ['cidr-calculator', 'k8s-networkpolicy', 'kubectl-builder'],
  },

  'cron-explainer': {
    howItWorks:
      'The Cron Expression Explainer parses standard 5-field Unix and Kubernetes CronJob schedules (minute, hour, day-of-month, month, day-of-week) locally in your browser, translates them into plain English, and computes upcoming execution timestamps in both UTC and your local timezone.',
    useCases: [
      'Verifying Kubernetes CronJob, GitHub Actions schedule, and Linux crontab expressions before deploying to production.',
      'Checking how UTC-scheduled jobs map to local business hours and avoiding surprise runs during Daylight Saving Time transitions.',
      'Debugging subtle Cron pitfalls like combining day-of-month and day-of-week fields (which Cron ORs together rather than ANDing).',
    ],
    securityNotes: [
      'Kubernetes CronJobs default to the kube-controller-manager timezone (almost always UTC) unless you explicitly configure spec.timeZone (Kubernetes 1.27+).',
      'Always set concurrencyPolicy: Forbid (or Replace) and startingDeadlineSeconds on Kubernetes CronJobs so slow runs do not pile up and exhaust cluster resources.',
    ],
    faq: [
      {
        question: 'What happens if I set both day-of-month and day-of-week in a cron expression?',
        answer: 'In standard Vixie cron and Kubernetes CronJobs, if both day-of-month and day-of-week are restricted (not *), the job runs when EITHER condition matches (logical OR), not both.',
      },
      {
        question: 'Does */15 in the minute field mean every 15 minutes from now?',
        answer: 'No. */15 means at minutes 0, 15, 30, and 45 of every hour. Similarly, */7 runs at 0, 7, 14, 21, 28, 35, 42, 49, and 56—leaving only a 4-minute gap between :56 and :00.',
      },
      {
        question: 'What timezone do GitHub Actions and Kubernetes CronJobs use?',
        answer: 'GitHub Actions always uses UTC. Kubernetes CronJobs use UTC by default unless spec.timeZone is set to an IANA timezone name like America/New_York or Asia/Tokyo.',
      },
    ],
    relatedTools: ['k8s-manifest-checker', 'kubectl-builder', 'k8s-pod-status'],
  },
};
