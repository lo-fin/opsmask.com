// Suggests environment variable values for a target environment based on saved
// samples from one or more environments (exact normalized key match, fuzzy key +
// value-shape match, learned token substitution rules, unchanged constants, or
// needs-review fallback). Supports Kubernetes ConfigMap, Secret (auto Base64
// decode) and List manifests directly.
import yaml from 'js-yaml';
import { looksLikeBase64SecretValue, parseSecretInput, stripJsonComments, type Pair } from './secret-input';

export type EnvSample = { id: string; name: string; text: string };
export type Source = 'key' | 'fuzzy' | 'token' | 'unchanged' | 'review';
export type Alternative = { key: string; value: string; score: number };
export type Suggestion = {
  key: string;
  input: string;
  value: string;
  source: Source;
  score?: number;
  matchedKey?: string;
  alternatives?: Alternative[];
  note?: string;
  secret?: boolean;
};

export type ParsedEnvInput = {
  format: string;
  pairs: Pair[];
  secretKeys: Set<string>;
  detectedNamespace?: string;
};

export type ExportFormat = 'original' | 'dotenv' | 'k8s-cm' | 'k8s-secret-string' | 'k8s-secret-b64';
export type FetchOS = 'macos' | 'linux' | 'windows';

const IGNORED_K8S_SECRET_TYPES = new Set([
  'kubernetes.io/service-account-token',
  'helm.sh/release.v1',
  'kubernetes.io/tls',
]);

function b64DecodeUtf8(s: string): string | null {
  try {
    const clean = String(s).replace(/\s+/g, '');
    const bytes = Uint8Array.from(atob(clean), (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function b64EncodeUtf8(s: string): string {
  let bin = '';
  new TextEncoder().encode(s).forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

const SENSITIVE_KEY_RE = /(?:^|[-_.:])(pass|password|pwd|secret|token|apikey|api_key|private|credential|credentials|connstr|connectionstring|dsn|auth|jwt|cert|client_secret)(?:$|[-_.:])/i;
const SENSITIVE_SUBSTR_RE = /(password|passwd|secret|token|apikey|privatekey|connectionstring|connstr|clientsecret)/i;

/** Returns true when a key name or value looks like a secret/credential that should be masked by default. */
export function isSensitiveKey(key: string, value = ''): boolean {
  if (SENSITIVE_KEY_RE.test(key) || SENSITIVE_SUBSTR_RE.test(key)) return true;
  const v = value.trim();
  if (!v) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/i.test(v)) return true;
  if (/(?:^|;)\s*(?:password|pwd|secret|accountkey|sharedaccesskey)\s*=/i.test(v)) return true;
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(v) || /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(v)) return true;
  return false;
}

/** Replaces sensitive values in sample text with `<secret>` before persisting to localStorage when requested. */
export function scrubSecretsInText(text: string): string {
  const parsed = parseEnvInputSafe(text);
  if (!parsed || !parsed.pairs.length) return text;
  const map = new Map<string, string>();
  for (const [k, v] of parsed.pairs) {
    map.set(k, parsed.secretKeys.has(k) || isSensitiveKey(k, v) ? '<secret>' : v);
  }
  return serialize(parsed.format, text, map);
}

export type KubectlFetchBundle = {
  commands: {
    id: string;
    label: string;
    cmd: string;
    hint: string;
  }[];
  install: [string, string][];
};

/**
 * Generates copy-ready kubectl commands to pull ConfigMaps and Secrets from a
 * namespace, with optional direct clipboard piping and per-OS tool installation hints.
 */
export function buildKubectlFetchCommands(
  namespace = 'default',
  os: FetchOS = 'macos',
  pipeToClipboard = true,
): KubectlFetchBundle {
  const ns = namespace.trim() || 'default';
  const safeNs = /^[a-z0-9-]+$/i.test(ns) ? ns : `'${ns.replace(/'/g, `'\\''`)}'`;

  const clipSuffix = !pipeToClipboard
    ? ''
    : os === 'macos'
      ? ' | pbcopy'
      : os === 'windows'
        ? ' | Set-Clipboard'
        : ' | xclip -selection clipboard';

  const jqCmd =
    os === 'windows'
      ? `kubectl get cm,secret -n ${safeNs} -o json | jq -r '.items[] | select(.type != \\"kubernetes.io/service-account-token\\" and .type != \\"helm.sh/release.v1\\") | (.data // {}) | to_entries[] | \\"\\(.key)=\\(.value | try @base64d catch .)\\"'${clipSuffix}`
      : `kubectl get cm,secret -n ${safeNs} -o json | jq -r '.items[] | select(.type != "kubernetes.io/service-account-token" and .type != "helm.sh/release.v1") | (.data // {}) | to_entries[] | "\\(.key)=\\(.value | try @base64d catch .)"'${clipSuffix}`;

  const commands = [
    {
      id: 'yaml-all',
      label: 'ConfigMap + Secret (YAML)',
      cmd: `kubectl get configmap,secret -n ${safeNs} -o yaml${clipSuffix}`,
      hint: pipeToClipboard
        ? 'Copies the full YAML list directly to your clipboard — paste it into Sample Data below (auto-filters system tokens and decodes Base64).'
        : 'Paste the YAML output directly into Sample Data below (auto-filters system tokens and decodes Base64).',
    },
    {
      id: 'jq-dotenv',
      label: 'Flat KEY=VALUE (with jq)',
      cmd: jqCmd,
      hint: 'Extracts all ConfigMap and Secret keys as decoded KEY=VALUE lines.',
    },
    {
      id: 'pod-env',
      label: 'From a running Pod',
      cmd: `kubectl exec -n ${safeNs} deploy/my-app -- env${clipSuffix}`,
      hint: 'Reads the live environment variables injected into a running container.',
    },
  ];

  const install: [string, string][] =
    os === 'macos'
      ? [
          ['brew install kubectl jq', 'macOS (Homebrew) — pbcopy is built in'],
        ]
      : os === 'windows'
        ? [
            ['winget install -e --id Kubernetes.kubectl && winget install -e --id jqlang.jq', 'Windows (winget) — Set-Clipboard is built in'],
          ]
        : [
            ['sudo apt-get update && sudo apt-get install -y kubectl jq xclip', 'Debian / Ubuntu (or use wl-copy on Wayland)'],
            ['sudo dnf install -y kubernetes-client jq xclip', 'RHEL / Fedora'],
            ['apk add kubectl jq xclip', 'Alpine'],
          ];

  return { commands, install };
}

function extractK8sDocs(docs: unknown[]): ParsedEnvInput | null {
  const items: any[] = [];
  for (const d of docs) {
    if (!d || typeof d !== 'object') continue;
    const obj = d as Record<string, any>;
    if (obj.kind === 'List' && Array.isArray(obj.items)) {
      items.push(...obj.items);
    } else if (obj.kind === 'ConfigMap' || obj.kind === 'Secret') {
      items.push(obj);
    }
  }
  if (!items.length) return null;

  const pairs: Pair[] = [];
  const secretKeys = new Set<string>();
  const namespaces = new Set<string>();
  let cmCount = 0;
  let secCount = 0;

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const ns = typeof item.metadata?.namespace === 'string' ? item.metadata.namespace.trim() : '';
    if (ns) namespaces.add(ns);
    if (item.kind === 'ConfigMap') {
      if (item.metadata?.name === 'kube-root-ca.crt') continue;
      cmCount++;
      for (const [k, v] of Object.entries(item.data ?? {})) {
        const sVal = String(v ?? '');
        pairs.push([k, sVal]);
        if (isSensitiveKey(k, sVal)) secretKeys.add(k);
      }
    } else if (item.kind === 'Secret') {
      if (IGNORED_K8S_SECRET_TYPES.has(String(item.type ?? ''))) continue;
      secCount++;
      for (const [k, v] of Object.entries(item.data ?? {})) {
        const decoded = b64DecodeUtf8(String(v ?? ''));
        if (decoded !== null) {
          pairs.push([k, decoded]);
          secretKeys.add(k);
        }
      }
      for (const [k, v] of Object.entries(item.stringData ?? {})) {
        pairs.push([k, String(v ?? '')]);
        secretKeys.add(k);
      }
    }
  }

  const parts: string[] = [];
  if (cmCount) parts.push(`${cmCount} ConfigMap`);
  if (secCount) parts.push(`${secCount} Secret`);
  const label = parts.length ? `Kubernetes (${parts.join(', ')})` : 'Kubernetes YAML';
  const detectedNamespace = namespaces.size === 1 ? [...namespaces][0] : undefined;
  return { format: label, pairs, secretKeys, detectedNamespace };
}

/**
 * Parses `.env`, docker-compose lists, JSON, YAML, or Kubernetes `ConfigMap` /
 * `Secret` / `List` manifests (automatically decoding Base64 `Secret.data`).
 */
export function parseEnvInput(text: string): ParsedEnvInput {
  const t = text.trim();
  if (!t) return { format: '', pairs: [], secretKeys: new Set() };

  if (/(?:^|\n)\s*kind\s*:\s*(?:Secret|ConfigMap|List)\b/.test(t) || /"kind"\s*:\s*"(?:Secret|ConfigMap|List)"/.test(t)) {
    try {
      const docs = t.startsWith('{')
        ? [JSON.parse(stripJsonComments(t))]
        : yaml.loadAll(t);
      const k8s = extractK8sDocs(docs);
      if (k8s) return k8s;
    } catch {
      // Fall through to standard parser for clear error reporting
    }
  }

  const parsed = parseSecretInput(t, { nested: 'env' });
  let pairs = parsed.pairs;
  let unwrappedDataBlock = false;
  if (pairs.length > 0 && pairs.every(([k]) => k.startsWith('data__'))) {
    pairs = pairs.map(([k, v]) => [k.slice(6), v] as Pair);
    unwrappedDataBlock = true;
  } else if (pairs.length > 0 && pairs.every(([k]) => k.startsWith('stringData__'))) {
    pairs = pairs.map(([k, v]) => [k.slice(12), v] as Pair);
  }

  const secretKeys = new Set<string>();
  let decodedB64Count = 0;
  const decodedPairs: Pair[] = pairs.map(([k, v]) => {
    const b64 = looksLikeBase64SecretValue(v) ?? (unwrappedDataBlock ? b64DecodeUtf8(v) : null);
    if (b64 !== null) {
      decodedB64Count++;
      secretKeys.add(k);
      return [k, b64];
    }
    if (isSensitiveKey(k, v)) secretKeys.add(k);
    return [k, v];
  });

  const format =
    decodedB64Count > 0 && decodedB64Count === pairs.filter(([, v]) => v.trim() !== '').length
      ? 'YAML (Secret Base64)'
      : parsed.format;

  return { format, pairs: decodedPairs, secretKeys };
}

function parseEnvInputSafe(text: string): ParsedEnvInput | null {
  try {
    return parseEnvInput(text);
  } catch {
    return null;
  }
}

/** Normalizes a config key so DB_HOST, db.host, Db__Host and db:host match. */
export function normalizeKey(k: string): string {
  return k.toLowerCase().replace(/[-_.:]/g, '');
}

/** Splits a string into alternating word/number tokens and separators, preserving exact text when joined. */
export function tokenize(v: string): string[] {
  return v.match(/[a-zA-Z0-9]+|[^a-zA-Z0-9]+/g) ?? [];
}

const isWord = (t: string) => /^[a-zA-Z0-9]+$/.test(t);

const SYNONYM_GROUPS: [string, string[]][] = [
  ['db', ['db', 'database']],
  ['host', ['host', 'hostname', 'server', 'addr', 'address']],
  ['url', ['url', 'uri', 'dsn', 'endpoint', 'connection', 'conn', 'connstr', 'connectionstring']],
  ['user', ['user', 'username', 'login']],
  ['pass', ['pass', 'password', 'pwd', 'secret']],
  ['port', ['port']],
  ['key', ['key', 'apikey', 'token']],
];

const SYNONYM_MAP = new Map<string, string>();
for (const [canon, words] of SYNONYM_GROUPS) {
  for (const w of words) SYNONYM_MAP.set(w, canon);
}

/**
 * Splits a key into canonicalized lowercase words along `_`, `.`, `-`, `:`, `__`
 * and camelCase / PascalCase boundaries. Deduplicates words after synonym mapping.
 */
export function keyWords(k: string): string[] {
  const raw = k
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[-_.:/\s]+/)
    .map((w) => w.toLowerCase())
    .filter(Boolean);

  const merged: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const cur = raw[i];
    const next = raw[i + 1];
    if (cur === 'api' && next === 'key') {
      merged.push('apikey');
      i++;
    } else if ((cur === 'conn' || cur === 'connection') && (next === 'str' || next === 'string')) {
      merged.push('connectionstring');
      i++;
    } else {
      merged.push(cur);
    }
  }

  const out: string[] = [];
  const seen = new Set<string>();
  for (const w of merged) {
    const canon = SYNONYM_MAP.get(w) ?? w;
    if (!seen.has(canon)) {
      seen.add(canon);
      out.push(canon);
    }
  }
  return out;
}

export type ValueShape =
  | `url:${string}`
  | 'hostname'
  | 'ip'
  | 'host:port'
  | 'number/port'
  | 'bool'
  | 'email'
  | 'connection-string'
  | 'json'
  | 'text'
  | 'empty';

const PLACEHOLDER_RE = /^(?:changeme|change[-_]?me|todo|tbd|xxx+|none|null|undefined|<[^>]+>|\$\{[^}]+\}|\{\{[^}]+\}\})$/i;

/** Classifies a config value by its structural shape. Empty or placeholder values return `'empty'`. */
export function valueShape(v: string): ValueShape {
  const s = v.trim();
  if (!s || PLACEHOLDER_RE.test(s)) return 'empty';
  if (/^(true|false|yes|no)$/i.test(s)) return 'bool';
  if (/^\d+$/.test(s)) return 'number/port';

  const urlMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/\S+$/.exec(s);
  if (urlMatch) return `url:${urlMatch[1].toLowerCase()}`;

  if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
    try {
      JSON.parse(s);
      return 'json';
    } catch {}
  }

  if (/^[a-zA-Z0-9_. -]+=[^;]+(;[\s]*[a-zA-Z0-9_. -]+=[^;]*)+;?$/.test(s)) {
    return 'connection-string';
  }

  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return 'email';

  const ipPort = /^(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{1,5}))?$/.exec(s);
  if (ipPort) {
    const octetsOk = ipPort[1].split('.').every((o) => Number(o) <= 255);
    if (octetsOk) return ipPort[2] ? 'host:port' : 'ip';
  }

  if (/^(?:localhost|[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+):\d{1,5}$/.test(s)) {
    return 'host:port';
  }

  if (
    s === 'localhost' ||
    (/^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/.test(s) && /[a-zA-Z]/.test(s.split('.').pop()!))
  ) {
    return 'hostname';
  }

  return 'text';
}

const HOST_FAMILY = new Set<ValueShape>(['hostname', 'ip', 'host:port']);

function scoreShape(a: ValueShape, b: ValueShape): number | null {
  if (a === 'empty' || b === 'empty') return null;
  if (a === b) return 1.0;
  if (a.startsWith('url:') && b.startsWith('url:')) return 0.4;
  if (HOST_FAMILY.has(a) && HOST_FAMILY.has(b)) return 0.7;
  return 0;
}

function commonPrefixLen(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

/** Builds IDF weights for canonical key words across a list of keys. */
export function buildIdf(allKeys: string[]): Map<string, number> {
  const df = new Map<string, number>();
  const total = Math.max(1, allKeys.length);
  for (const k of allKeys) {
    for (const w of new Set(keyWords(k))) {
      df.set(w, (df.get(w) ?? 0) + 1);
    }
  }
  const idf = new Map<string, number>();
  for (const [w, count] of df) {
    idf.set(w, 1 + Math.log((total + 1) / (count + 1)) * 0.5);
  }
  return idf;
}

/**
 * Computes weighted Dice similarity between two keys `a` and `b` using `idf` weights.
 * Exact canonical word matches count 1.0; non-identical words sharing a ≥4-char prefix count 0.8.
 */
export function scoreKey(a: string, b: string, idf: Map<string, number> = new Map()): number {
  const wordsA = keyWords(a);
  const wordsB = keyWords(b);
  if (!wordsA.length || !wordsB.length) return 0;

  const w = (word: string) => idf.get(word) ?? 1;
  const sumA = wordsA.reduce((acc, x) => acc + w(x), 0);
  const sumB = wordsB.reduce((acc, x) => acc + w(x), 0);
  if (sumA + sumB === 0) return 0;

  const usedB = new Set<number>();
  let shared = 0;

  for (const wa of wordsA) {
    const idx = wordsB.findIndex((wb, j) => !usedB.has(j) && wb === wa);
    if (idx >= 0) {
      usedB.add(idx);
      shared += 2 * w(wa);
    }
  }

  for (const wa of wordsA) {
    if (wordsB.some((wb) => wb === wa)) continue;
    let bestIdx = -1;
    for (let j = 0; j < wordsB.length; j++) {
      if (usedB.has(j)) continue;
      if (commonPrefixLen(wa, wordsB[j]) >= 4) {
        bestIdx = j;
        break;
      }
    }
    if (bestIdx >= 0) {
      usedB.add(bestIdx);
      shared += 0.8 * (w(wa) + w(wordsB[bestIdx]));
    }
  }

  return shared / (sumA + sumB);
}

export type KeyMatchResult = {
  key: string;
  match?: { key: string; value: string };
  score: number;
  exact?: boolean;
  alternatives: Alternative[];
};

const FUZZY_THRESHOLD = 0.55;

/**
 * Matches `input` pairs against `sample` pairs using 1-to-1 greedy assignment for
 * fuzzy matches (after locking in exact normalized matches).
 */
export function matchKeys(
  input: Pair[],
  sample: Pair[],
  extraKeysForIdf: string[] = [],
): KeyMatchResult[] {
  const idf = buildIdf([
    ...sample.map(([k]) => k),
    ...extraKeysForIdf,
  ]);

  const sampleByNorm = new Map<string, { key: string; value: string }>();
  for (const [k, v] of sample) sampleByNorm.set(normalizeKey(k), { key: k, value: v });

  const results: KeyMatchResult[] = input.map(([k]) => ({
    key: k,
    score: 0,
    alternatives: [],
  }));

  const usedSampleIdx = new Set<number>();
  const unresolvedInputIdx: number[] = [];

  input.forEach(([k], idx) => {
    const norm = normalizeKey(k);
    const exact = sampleByNorm.get(norm);
    if (exact) {
      results[idx] = {
        key: k,
        match: exact,
        score: 1,
        exact: true,
        alternatives: [],
      };
      sample.forEach(([sk], sIdx) => {
        if (normalizeKey(sk) === norm) usedSampleIdx.add(sIdx);
      });
    } else {
      unresolvedInputIdx.push(idx);
    }
  });

  type Candidate = { inIdx: number; sIdx: number; score: number };
  const allCandidatesByInput = new Map<number, Candidate[]>();
  const flatCandidates: Candidate[] = [];

  for (const inIdx of unresolvedInputIdx) {
    const [inKey, inVal] = input[inIdx];
    const inShape = valueShape(inVal);
    const list: Candidate[] = [];

    for (let sIdx = 0; sIdx < sample.length; sIdx++) {
      const [sKey, sVal] = sample[sIdx];
      const kScore = scoreKey(inKey, sKey, idf);
      if (kScore === 0) continue;

      const sShape = valueShape(sVal);
      const shScore = scoreShape(inShape, sShape);
      const total = shScore === null ? kScore : 0.7 * kScore + 0.3 * shScore;

      if (total >= FUZZY_THRESHOLD) {
        const cand = { inIdx, sIdx, score: total };
        list.push(cand);
        if (!usedSampleIdx.has(sIdx)) flatCandidates.push(cand);
      }
    }

    list.sort((a, b) => b.score - a.score || sample[a.sIdx][0].length - sample[b.sIdx][0].length);
    allCandidatesByInput.set(inIdx, list);
  }

  flatCandidates.sort(
    (a, b) => b.score - a.score || sample[a.sIdx][0].length - sample[b.sIdx][0].length,
  );

  const assignedInput = new Set<number>();
  for (const cand of flatCandidates) {
    if (assignedInput.has(cand.inIdx) || usedSampleIdx.has(cand.sIdx)) continue;
    assignedInput.add(cand.inIdx);
    usedSampleIdx.add(cand.sIdx);

    const [sKey, sVal] = sample[cand.sIdx];
    const alts = (allCandidatesByInput.get(cand.inIdx) ?? [])
      .filter((c) => c.sIdx !== cand.sIdx)
      .slice(0, 2)
      .map((c) => ({
        key: sample[c.sIdx][0],
        value: sample[c.sIdx][1],
        score: Math.round(c.score * 100) / 100,
      }));

    results[cand.inIdx] = {
      key: input[cand.inIdx][0],
      match: { key: sKey, value: sVal },
      score: Math.round(cand.score * 100) / 100,
      exact: false,
      alternatives: alts,
    };
  }

  return results;
}

/**
 * Learns token-level replacements from `from` pairs to `to` pairs where normalized
 * keys match, values differ, and both values tokenize into the exact same structure.
 * Any source token that maps to two different target tokens is discarded.
 */
export function learnRules(from: Pair[], to: Pair[]): Map<string, string> {
  const toByNorm = new Map<string, string>();
  for (const [k, v] of to) toByNorm.set(normalizeKey(k), v);

  const candidates = new Map<string, string>();
  const conflicts = new Set<string>();

  for (const [k, fromVal] of from) {
    const toVal = toByNorm.get(normalizeKey(k));
    if (toVal === undefined || toVal === fromVal) continue;
    const fToks = tokenize(fromVal);
    const tToks = tokenize(toVal);
    if (fToks.length !== tToks.length) continue;

    let aligned = true;
    for (let i = 0; i < fToks.length; i++) {
      if (isWord(fToks[i]) !== isWord(tToks[i]) || (!isWord(fToks[i]) && fToks[i] !== tToks[i])) {
        aligned = false;
        break;
      }
    }
    if (!aligned) continue;

    for (let i = 0; i < fToks.length; i++) {
      const f = fToks[i];
      const t = tToks[i];
      if (!isWord(f) || f === t) continue;
      const prev = candidates.get(f);
      if (prev !== undefined && prev !== t) {
        conflicts.add(f);
      } else {
        candidates.set(f, t);
      }
    }
  }

  for (const c of conflicts) candidates.delete(c);
  return candidates;
}

function safeParsePairs(text: string): Pair[] {
  return parseEnvInputSafe(text)?.pairs ?? [];
}

/** Finds the saved environment (other than `targetId`) whose values overlap most with `input`. */
export function detectSource(input: Pair[], envs: EnvSample[], targetId: string): EnvSample | null {
  let best: EnvSample | null = null;
  let bestScore = 0;

  for (const env of envs) {
    if (env.id === targetId) continue;
    const pairs = safeParsePairs(env.text);
    if (!pairs.length) continue;

    const byKey = new Map<string, string>();
    const allVals = new Set<string>();
    for (const [k, v] of pairs) {
      if (!v) continue;
      byKey.set(normalizeKey(k), v);
      allVals.add(v);
    }

    let score = 0;
    for (const [k, v] of input) {
      if (!v) continue;
      if (byKey.get(normalizeKey(k)) === v) score += 2;
      else if (allVals.has(v)) score += 1;
    }

    if (score > bestScore) {
      bestScore = score;
      best = env;
    }
  }

  if (best) return best;
  return envs.find((e) => e.id !== targetId && safeParsePairs(e.text).length > 0) ?? null;
}

function matchCase(sourceToken: string, replacement: string): string {
  if (sourceToken.length > 1 && sourceToken === sourceToken.toUpperCase()) return replacement.toUpperCase();
  if (sourceToken === sourceToken.toLowerCase()) return replacement.toLowerCase();
  if (sourceToken[0] === sourceToken[0].toUpperCase() && sourceToken.slice(1) === sourceToken.slice(1).toLowerCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1).toLowerCase();
  }
  return replacement;
}

/** Suggests values for every key in `input` targeting `targetId`. */
export function suggest(
  input: Pair[],
  envs: EnvSample[],
  targetId: string,
  inputSecretKeys: Set<string> = new Set(),
): Suggestion[] {
  const targetEnv = envs.find((e) => e.id === targetId);
  const targetParsed = targetEnv ? parseEnvInputSafe(targetEnv.text) : null;
  const targetPairs = targetParsed?.pairs ?? [];
  const targetSecretNorms = new Set(
    [...(targetParsed?.secretKeys ?? [])].map((k) => normalizeKey(k)),
  );

  const parsedEnvs = envs
    .map((env) => ({ env, pairs: safeParsePairs(env.text) }))
    .filter((x) => x.pairs.length > 0);

  const extraKeys = parsedEnvs
    .filter((x) => x.env.id !== targetId)
    .flatMap((x) => x.pairs.map(([k]) => k));
  const keyMatches = matchKeys(input, targetPairs, extraKeys);

  const sourceEnv = detectSource(input, envs, targetId);
  const sourcePairs = sourceEnv ? safeParsePairs(sourceEnv.text) : [];
  const learned = sourceEnv && targetEnv ? learnRules(sourcePairs, targetPairs) : new Map<string, string>();

  const srcName = sourceEnv?.name.trim() ?? '';
  const tgtName = targetEnv?.name.trim() ?? '';
  const canUseNameRule = isWord(srcName) && isWord(tgtName) && srcName.toLowerCase() !== tgtName.toLowerCase();

  return input.map(([key, inVal], idx) => {
    const norm = normalizeKey(key);
    const km = keyMatches[idx];
    const checkSecret = (val: string, matchedKey?: string) =>
      inputSecretKeys.has(key) ||
      targetSecretNorms.has(norm) ||
      (matchedKey ? targetSecretNorms.has(normalizeKey(matchedKey)) : false) ||
      isSensitiveKey(key, val) ||
      (matchedKey ? isSensitiveKey(matchedKey, val) : false);

    // 1. Exact normalized key match in target environment
    if (km?.match && km.exact) {
      return {
        key,
        input: inVal,
        value: km.match.value,
        source: 'key',
        matchedKey: km.match.key,
        score: 1,
        note: `Matched key ${km.match.key} in ${targetEnv?.name ?? 'target'}`,
        secret: checkSecret(km.match.value, km.match.key),
      };
    }

    // 1b. Fuzzy key + value-shape match in target environment
    if (km?.match && !km.exact) {
      const pct = Math.round(km.score * 100);
      return {
        key,
        input: inVal,
        value: km.match.value,
        source: 'fuzzy',
        score: km.score,
        matchedKey: km.match.key,
        alternatives: km.alternatives,
        note: `Fuzzy match ${pct}% → ${km.match.key}`,
        secret: checkSecret(km.match.value, km.match.key),
      };
    }

    // 2. Token substitution from learned rules + env name rule
    if (inVal && (learned.size > 0 || canUseNameRule)) {
      const toks = tokenize(inVal);
      const usedRules: string[] = [];
      const outToks = toks.map((tok) => {
        if (!isWord(tok)) return tok;
        const direct = learned.get(tok);
        if (direct !== undefined && direct !== tok) {
          const r = `${tok}→${direct}`;
          if (!usedRules.includes(r)) usedRules.push(r);
          return direct;
        }
        const lower = tok.toLowerCase();
        for (const [fromTok, toTok] of learned) {
          if (fromTok.toLowerCase() === lower) {
            const cased = matchCase(tok, toTok);
            if (cased !== tok) {
              const r = `${tok}→${cased}`;
              if (!usedRules.includes(r)) usedRules.push(r);
              return cased;
            }
          }
        }
        if (canUseNameRule && lower === srcName.toLowerCase()) {
          const cased = matchCase(tok, tgtName);
          if (cased !== tok) {
            const r = `${tok}→${cased}`;
            if (!usedRules.includes(r)) usedRules.push(r);
            return cased;
          }
        }
        return tok;
      });

      const nextVal = outToks.join('');
      if (nextVal !== inVal) {
        return {
          key,
          input: inVal,
          value: nextVal,
          source: 'token',
          note: usedRules.join(', '),
          secret: checkSecret(nextVal),
        };
      }
    }

    // 3. Unchanged across all saved environments that have this key
    if (parsedEnvs.length >= 2) {
      const matchingVals: string[] = [];
      for (const { pairs } of parsedEnvs) {
        for (const [k, v] of pairs) {
          if (normalizeKey(k) === norm) matchingVals.push(v);
        }
      }
      if (matchingVals.length >= 2 && matchingVals.every((v) => v === inVal)) {
        return {
          key,
          input: inVal,
          value: inVal,
          source: 'unchanged',
          note: 'Identical across saved environments',
          secret: checkSecret(inVal),
        };
      }
    }

    // 4. Needs review
    return {
      key,
      input: inVal,
      value: inVal,
      source: 'review',
      note: 'No matching key or token rule found',
      secret: checkSecret(inVal),
    };
  });
}

function formatEnvValue(val: string, origRaw: string): string {
  const trimmed = origRaw.trim();
  const wasDouble = trimmed.startsWith('"') && trimmed.endsWith('"');
  const wasSingle = trimmed.startsWith("'") && trimmed.endsWith("'");
  if (wasSingle && !val.includes("'") && !val.includes('\n')) return `'${val}'`;
  if (wasDouble || /[\s#"'\n]/.test(val)) {
    const escaped = val
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
    return `"${escaped}"`;
  }
  return val;
}

function unflatten(values: Map<string, string>): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const [rawKey, val] of values) {
    const parts = rawKey.includes('__') ? rawKey.split('__') : [rawKey];
    let cur: Record<string, unknown> = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (typeof cur[p] !== 'object' || cur[p] === null || Array.isArray(cur[p])) {
        cur[p] = {};
      }
      cur = cur[p] as Record<string, unknown>;
    }
    cur[parts[parts.length - 1]] = val;
  }
  return root;
}

/**
 * Exports key/value pairs in the chosen target format (`original`, `dotenv`,
 * `k8s-cm`, `k8s-secret-string`, or `k8s-secret-b64`).
 */
export function serializeAs(
  exportMode: ExportFormat,
  detectedFormat: string,
  original: string,
  values: Map<string, string>,
  meta: { name?: string; namespace?: string } = {},
): string {
  const name = meta.name?.trim() || 'app-config';
  const namespace = meta.namespace?.trim() || 'default';

  if (exportMode === 'dotenv') {
    return [...values.entries()].map(([k, v]) => `${k}=${formatEnvValue(v, '')}`).join('\n');
  }
  if (exportMode === 'k8s-cm') {
    return yaml
      .dump(
        {
          apiVersion: 'v1',
          kind: 'ConfigMap',
          metadata: { name, namespace },
          data: Object.fromEntries(values),
        },
        { lineWidth: -1 },
      )
      .trimEnd();
  }
  if (exportMode === 'k8s-secret-string') {
    return yaml
      .dump(
        {
          apiVersion: 'v1',
          kind: 'Secret',
          metadata: { name, namespace },
          type: 'Opaque',
          stringData: Object.fromEntries(values),
        },
        { lineWidth: -1 },
      )
      .trimEnd();
  }
  if (exportMode === 'k8s-secret-b64') {
    const encoded: Record<string, string> = {};
    for (const [k, v] of values) encoded[k] = b64EncodeUtf8(v);
    return yaml
      .dump(
        {
          apiVersion: 'v1',
          kind: 'Secret',
          metadata: { name, namespace },
          type: 'Opaque',
          data: encoded,
        },
        { lineWidth: -1 },
      )
      .trimEnd();
  }
  return serialize(detectedFormat, original, values);
}

/** Serializes updated key/value pairs back into the original input format. */
export function serialize(format: string, original: string, values: Map<string, string>): string {
  if (format === '.env' || format === 'docker-compose list') {
    const lines = original.split(/\r?\n/);
    const out: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const m = /^(\s*(?:export\s+|-\s+)?)([^=\s#]+)(\s*=\s*)(.*)$/.exec(line);
      if (!m) {
        out.push(line);
        continue;
      }
      const [, prefix, key, eq, rest] = m;
      const q = rest[0];
      let comment = '';
      let rawVal = rest;
      if (q === '"' || q === "'") {
        let body = rest.slice(1);
        const closes = (s: string) => (q === "'" ? /'\s*(#.*)?$/.test(s) : /(^|[^\\])(\\\\)*"\s*(#.*)?$/.test(s));
        while (!closes(body) && i + 1 < lines.length) {
          body += '\n' + lines[++i];
        }
        const cm = (q === '"' ? /^([\s\S]*")(\s*#.*)?$/ : /^([\s\S]*')(\s*#.*)?$/).exec(body);
        rawVal = q + (cm ? cm[1] : body);
        comment = cm?.[2] ?? '';
      } else {
        const cm = /^([^\s#]*|\S.*?\S)(\s+#.*)$/.exec(rest);
        if (cm) {
          rawVal = cm[1];
          comment = cm[2];
        }
      }
      const nextVal = values.get(key);
      if (nextVal === undefined) {
        out.push(line);
      } else {
        out.push(`${prefix}${key}${eq}${formatEnvValue(nextVal, rawVal)}${comment}`);
      }
    }
    return out.join('\n');
  }

  if (format.startsWith('Kubernetes')) {
    try {
      const updateK8sItem = (item: any) => {
        if (!item || typeof item !== 'object') return false;
        if (item.kind === 'Secret') {
          if (IGNORED_K8S_SECRET_TYPES.has(String(item.type ?? ''))) return true;
          if (item.data && typeof item.data === 'object') {
            for (const k of Object.keys(item.data)) {
              const nextVal = values.get(k);
              if (nextVal !== undefined) item.data[k] = b64EncodeUtf8(nextVal);
            }
          }
          if (item.stringData && typeof item.stringData === 'object') {
            for (const k of Object.keys(item.stringData)) {
              const nextVal = values.get(k);
              if (nextVal !== undefined) item.stringData[k] = nextVal;
            }
          }
          if (!item.data && !item.stringData) {
            const encoded: Record<string, string> = {};
            for (const [k, v] of values) encoded[k] = b64EncodeUtf8(v);
            item.data = encoded;
          }
          return true;
        }
        if (item.kind === 'ConfigMap') {
          if (item.metadata?.name === 'kube-root-ca.crt') return true;
          if (item.data && typeof item.data === 'object') {
            for (const k of Object.keys(item.data)) {
              const nextVal = values.get(k);
              if (nextVal !== undefined) item.data[k] = nextVal;
            }
          } else {
            item.data = Object.fromEntries(values);
          }
          return true;
        }
        return false;
      };

      const doc = yaml.load(original) as any;
      if (doc && typeof doc === 'object') {
        if (doc.kind === 'List' && Array.isArray(doc.items)) {
          doc.items.forEach(updateK8sItem);
          return yaml.dump(doc, { lineWidth: -1 }).trimEnd();
        }
        if (updateK8sItem(doc)) {
          return yaml.dump(doc, { lineWidth: -1 }).trimEnd();
        }
      }
    } catch {}
    return [...values.entries()].map(([k, v]) => `${k}=${formatEnvValue(v, '')}`).join('\n');
  }

  if (format.startsWith('JSON')) {
    const hasNested = [...values.keys()].some((k) => k.includes('__'));
    const obj = hasNested ? unflatten(values) : Object.fromEntries(values);
    return JSON.stringify(obj, null, 2);
  }

  if (format === 'YAML (Secret Base64)') {
    const encodedMap = new Map<string, string>();
    for (const [k, v] of values) encodedMap.set(k, b64EncodeUtf8(v));
    const lines = original.split(/\r?\n/);
    let replaced = 0;
    const out = lines.map((line) => {
      const m = /^(\s*)([^:\s#]+)(\s*:\s*)(\S.*?)(\s+#.*)?$/.exec(line);
      if (!m) return line;
      const [, indent, key, colon, , comment = ''] = m;
      const nextB64 = encodedMap.get(key);
      if (nextB64 === undefined) return line;
      replaced++;
      return `${indent}${key}${colon}${nextB64}${comment}`;
    });
    if (replaced > 0) return out.join('\n');
    return yaml.dump(Object.fromEntries(encodedMap), { lineWidth: -1 }).trimEnd();
  }

  if (format.startsWith('YAML')) {
    const hasNested = [...values.keys()].some((k) => k.includes('__'));
    if (hasNested) {
      return yaml.dump(unflatten(values), { lineWidth: -1 }).trimEnd();
    }
    const lines = original.split(/\r?\n/);
    let replaced = 0;
    const out = lines.map((line) => {
      const m = /^(\s*)([^:\s#]+)(\s*:\s*)(.*?)(\s+#.*)?$/.exec(line);
      if (!m) return line;
      const [, indent, key, colon, rawVal, comment = ''] = m;
      const nextVal = values.get(key);
      if (nextVal === undefined) return line;
      replaced++;
      const dumped = yaml.dump(nextVal, { lineWidth: -1 }).trim();
      const needsQuote = /^['"]/.test(rawVal.trim()) && !/^['"]/.test(dumped);
      const formatted = needsQuote ? JSON.stringify(nextVal) : dumped;
      return `${indent}${key}${colon}${formatted}${comment}`;
    });
    if (replaced > 0) return out.join('\n');
    return yaml.dump(Object.fromEntries(values), { lineWidth: -1 }).trimEnd();
  }

  return [...values.entries()].map(([k, v]) => `${k}=${formatEnvValue(v, '')}`).join('\n');
}
