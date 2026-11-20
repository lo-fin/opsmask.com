// Parses key/value input for building a Kubernetes Secret. Detects the format:
// .env (with multi-line quoted values), docker-compose "- KEY=value" lists, JSON
// (including AWS Secrets Manager and Vault KV v2 output, .NET appsettings.json with
// comments and Azure Functions local.settings.json) and YAML maps.
import yaml from 'js-yaml';

export type Pair = [string, string];
/** How nested objects become keys: KEY__SUB (.NET / env vars), KEY.SUB, a JSON string, or the whole input as one file. */
export type NestedMode = 'env' | 'dot' | 'json' | 'file';
export type ParseOptions = { nested?: NestedMode };
/** nested: the input had nested objects or arrays. suggested: the mode that fits this input best. */
/** notes: format-specific hints, such as keys that were renamed. */
export type Parsed = { format: string; pairs: Pair[]; nested: boolean; suggested: NestedMode; fileKey?: string; notes?: string[] };
export type KeyIssue = { key: string; level: 'error' | 'warn'; message: string };
export type DecodedRow = { key: string; text?: string; bytes: Uint8Array };
export type DecodedSecret = { secret: Record<string, any>; rows: DecodedRow[]; isSnippet?: boolean };
export type DecodedExportFormat = 'yaml-kv' | 'dotenv' | 'json-nested' | 'stringdata';

const KEY = /^[-._a-zA-Z0-9]+$/;
export const SECRET_MAX_BYTES = 1024 * 1024;

/**
 * Normalizes uneven leading indentation when a user copy-pastes a flat list of
 * `KEY: value` lines (or a `data:` / `stringData:` block) from a terminal or IDE
 * where the first line lost its leading spaces.
 */
export function normalizeFlatYamlLines(text: string): string {
  const lines = text.split(/\r?\n/);
  const active = lines.filter((l) => l.trim() && !l.trim().startsWith('#'));
  if (!active.length) return text;

  const isKeyScalarLine = (l: string) => {
    const t = l.trim();
    if (t.startsWith('-') || t === '---' || t === '...') return false;
    const m = /^([-._a-zA-Z0-9:]+|"[^"]+"|'[^']+')\s*:\s*(.+)$/.exec(t);
    if (!m) return false;
    const val = m[2].trim();
    return Boolean(val) && !/^[|>][-+]?(\s*#.*)?$/.test(val);
  };

  if (active.every(isKeyScalarLine)) {
    return lines.map((l) => (l.trim() && !l.trim().startsWith('#') ? l.trimStart() : l)).join('\n');
  }

  const firstTrim = active[0].trim();
  if (/^(data|stringData)\s*:\s*(#.*)?$/.test(firstTrim) && active.slice(1).every(isKeyScalarLine)) {
    let seenHeader = false;
    return lines
      .map((l) => {
        const t = l.trim();
        if (!t || t.startsWith('#')) return l;
        if (!seenHeader) {
          seenHeader = true;
          return t;
        }
        return '  ' + t;
      })
      .join('\n');
  }

  return text;
}

/** Decodes a Base64 or URL-safe Base64 string into raw bytes and optional fatal UTF-8 text. */
export function b64Decode(s: string): { text?: string; bytes: Uint8Array } {
  let clean = String(s).replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (clean.length % 4 === 1) throw new Error('Invalid Base64 length.');
  if (clean.length % 4 !== 0) {
    clean = clean.padEnd(Math.ceil(clean.length / 4) * 4, '=');
  }
  const bytes = Uint8Array.from(atob(clean), (c) => c.charCodeAt(0));
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), bytes };
  } catch {
    return { bytes };
  }
}

/**
 * Returns the decoded UTF-8 string when `s` looks like a Base64-encoded Kubernetes
 * Secret value (and not an ordinary plain-text word, number, or boolean).
 */
export function looksLikeBase64SecretValue(s: string): string | null {
  const clean = s.trim();
  if (clean.length < 4 || clean.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) return null;
  if (/^\d+$/.test(clean) || /^(true|false|yes|no|null|none)$/i.test(clean)) return null;

  let decoded: string | undefined;
  try {
    decoded = b64Decode(clean).text;
  } catch {
    return null;
  }
  if (!decoded || !/^[\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]+$/.test(decoded)) return null;

  // Padded Base64 (ends with = or ==) that decodes to printable UTF-8 is unambiguously Base64.
  if (clean.endsWith('=')) return decoded;

  // For unpadded Base64 (length is a multiple of 4, >= 8 chars):
  if (clean.length < 8) return null;
  if (!/^[\x09\x0a\x0d\x20-\x7e]+$/.test(decoded)) return null;

  // Decoded string contains punctuation/spaces/URL characters that cannot appear in Base64 alphabet.
  if (/[^A-Za-z0-9+/]/.test(decoded)) return decoded;

  // Or encoded string mixes upper, lower, and digits while decoded text is clean printable ASCII.
  const hasUpper = /[A-Z]/.test(clean);
  const hasLower = /[a-z]/.test(clean);
  const hasDigit = /\d/.test(clean);
  if (hasUpper && hasLower && hasDigit) return decoded;

  return null;
}

const str = (v: unknown) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

function unquoteDouble(s: string) {
  return s.replace(/\\(n|r|t|"|\\)/g, (_m, c) => ({ n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\' })[c as 'n']);
}

/** .env lines. Quoted values may span several lines, as in dotenv. */
export function parseEnv(text: string): Pair[] {
  const out: Pair[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].replace(/^\s*(export\s+|-\s+)/, '').trim();
    if (!l || l.startsWith('#')) continue;
    const m = /^([^=\s]+)\s*=\s*(.*)$/.exec(l);
    if (!m) throw new Error(`Line ${i + 1}: expected KEY=value.`);
    let v = m[2];
    const q = v[0];
    if (q === '"' || q === "'") {
      // Collect lines until the closing quote (not escaped, for double quotes).
      const start = i;
      let body = v.slice(1);
      const closes = (s: string) => (q === "'" ? /'\s*(#.*)?$/.test(s) : /(^|[^\\])(\\\\)*"\s*(#.*)?$/.test(s));
      while (!closes(body)) {
        if (++i >= lines.length) throw new Error(`Line ${start + 1}: missing closing ${q}.`);
        body += '\n' + lines[i];
      }
      // Everything up to the last quote; a comment may follow it.
      body = (q === '"' ? /^([\s\S]*)"\s*(#.*)?$/ : /^([\s\S]*)'\s*(#.*)?$/).exec(body)![1];
      v = q === '"' ? unquoteDouble(body) : body;
    } else {
      v = v.replace(/\s+#.*$/, '');
    }
    out.push([m[1], v]);
  }
  return out;
}

const isNested = (obj: Record<string, unknown>) => Object.values(obj).some((v) => v != null && typeof v === 'object');

function flatten(value: unknown, sep: string, prefix: string, out: Pair[]): Pair[] {
  if (value != null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) flatten(v, sep, prefix ? `${prefix}${sep}${k}` : k, out);
  } else {
    out.push([prefix, str(value)]);
  }
  return out;
}

function fromObject(obj: Record<string, unknown>, mode: NestedMode): Pair[] {
  const pairs: Pair[] = mode === 'env' ? flatten(obj, '__', '', [])
    : mode === 'dot' ? flatten(obj, '.', '', [])
    : Object.entries(obj).map(([k, v]) => [k, str(v)]);
  // .NET config keys use ":" for nesting, which is not allowed in Secret keys or env var names.
  const sep = mode === 'dot' ? '.' : '__';
  return pairs.map(([k, v]) => [k.replace(/:/g, sep), v]);
}

// Sections that only a .NET appsettings file tends to have.
const DOTNET_KEYS = ['ConnectionStrings', 'Logging', 'AllowedHosts', 'Kestrel', 'Urls', 'Serilog'];
const isDotnet = (obj: Record<string, unknown>) => DOTNET_KEYS.some((k) => k in obj);

/** Removes // and /* *\/ comments and trailing commas outside strings, as .NET's JSON reader allows them. */
export function stripJsonComments(text: string): string {
  let out = '', i = 0, inStr = false;
  while (i < text.length) {
    const c = text[i], n = text[i + 1];
    if (inStr) {
      out += c;
      if (c === '\\') { out += n ?? ''; i += 2; continue; }
      if (c === '"') inStr = false;
      i++;
    } else if (c === '"') { inStr = true; out += c; i++; }
    else if (c === '/' && n === '/') { while (i < text.length && text[i] !== '\n') i++; }
    else if (c === '/' && n === '*') { const end = text.indexOf('*/', i + 2); i = end < 0 ? text.length : end + 2; }
    else { out += c; i++; }
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

function result(format: string, obj: Record<string, unknown>, text: string, opts: ParseOptions, fileKey: string, notes: string[] = []): Parsed {
  const nested = isNested(obj);
  const mode = nested ? (opts.nested ?? 'env') : 'json';
  const pairs = mode === 'file' ? [[fileKey, text.trim() + '\n'] as Pair] : fromObject(obj, mode);
  if (mode !== 'file' && Object.keys(obj).some((k) => k.includes(':')))
    notes.push(`Keys with “:” were renamed to use “${mode === 'dot' ? '.' : '__'}”. .NET reads both the same way.`);
  return { format, pairs, nested, suggested: 'env', fileKey, notes };
}

/** Azure Functions local.settings.json: only Values (and ConnectionStrings) are app settings. */
function functionsSettings(obj: any, opts: ParseOptions): Parsed {
  if (obj.IsEncrypted === true) throw new Error('local.settings.json is encrypted. Run “func settings decrypt” first.');
  const values = { ...(obj.Values ?? {}), ...(obj.ConnectionStrings && { ConnectionStrings: obj.ConnectionStrings }) };
  const notes: string[] = [];
  if (Object.values(obj.Values ?? {}).some((v) => /UseDevelopmentStorage=true/i.test(String(v))))
    notes.push('UseDevelopmentStorage=true points at the local Azurite emulator. Use a real storage connection string in the cluster.');
  if (obj.Host) notes.push('The Host section (local port, CORS) only applies to func start and was left out.');
  return result('JSON (Azure Functions local.settings.json)', values, JSON.stringify(values, null, 2), opts, 'local.settings.json', notes);
}

function parseJson(text: string, opts: ParseOptions): Parsed {
  let obj: any;
  try { obj = JSON.parse(stripJsonComments(text)); } catch (e) { throw new Error(`JSON: ${(e as Error).message}`); }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('JSON must be an object of key/value pairs.');
  if (typeof obj.SecretString === 'string') {
    try {
      const inner = JSON.parse(obj.SecretString);
      if (inner && typeof inner === 'object') return result('JSON (AWS Secrets Manager)', inner, obj.SecretString, opts, 'secret.json');
    } catch {}
    const key = String(obj.Name ?? 'value').split('/').pop()!.replace(/[^-._a-zA-Z0-9]/g, '-') || 'value';
    return { format: 'JSON (AWS Secrets Manager, plain string)', pairs: [[key, obj.SecretString]], nested: false, suggested: 'json' };
  }
  if (obj.data?.data && typeof obj.data.data === 'object') return result('JSON (Vault KV v2)', obj.data.data, JSON.stringify(obj.data.data, null, 2), opts, 'secret.json');
  if (obj.kind === 'Secret') throw new Error('This is already a Secret. Use Decode a Secret instead.');
  if (obj.Values && typeof obj.Values === 'object' && ('IsEncrypted' in obj || 'Host' in obj || 'FUNCTIONS_WORKER_RUNTIME' in obj.Values))
    return functionsSettings(obj, opts);
  if (isDotnet(obj)) return result('JSON (.NET appsettings)', obj, text, opts, 'appsettings.json');
  return result('JSON', obj, text, opts, 'config.json');
}

function parseYaml(text: string, opts: ParseOptions): Parsed {
  let doc: any;
  const normalized = normalizeFlatYamlLines(text);
  try { doc = yaml.load(normalized); } catch (e) { throw new Error(`YAML: ${(e as Error).message.split('\n')[0]}`); }
  if (doc?.kind === 'Secret') throw new Error('This is already a Secret. Use Decode a Secret instead.');
  let format = 'YAML';
  if (doc && typeof doc === 'object' && !Array.isArray(doc) && doc.environment) { doc = doc.environment; format = 'YAML (docker-compose environment)'; }
  if (Array.isArray(doc)) {
    return { format, nested: false, suggested: 'json', pairs: doc.map((x, i) => {
      const s = str(x), n = s.indexOf('=');
      if (n < 1) throw new Error(`Item ${i + 1}: expected KEY=value.`);
      return [s.slice(0, n), s.slice(n + 1)] as Pair;
    }) };
  }
  if (!doc || typeof doc !== 'object') throw new Error('Expected KEY=value lines, a JSON object or a YAML map.');
  return result(format, doc, normalized, opts, 'config.yaml');
}

export function parseSecretInput(text: string, opts: ParseOptions = {}): Parsed {
  const t = text.trim();
  const flat = (format: string, pairs: Pair[]): Parsed => ({ format, pairs, nested: false, suggested: 'json' });
  if (!t) return flat('', []);
  if (t.startsWith('{') || t.startsWith('//') || t.startsWith('/*')) return parseJson(t, opts);
  const first = t.split(/\r?\n/).find((l) => l.trim() && !l.trim().startsWith('#')) ?? '';
  if (/^\s*-\s*[^=\s:]+=/.test(first)) return flat('docker-compose list', parseEnv(t));
  if (/^\s*(export\s+)?[^=\s:]+\s*=/.test(first)) return flat('.env', parseEnv(t));
  return parseYaml(t, opts);
}

/**
 * Parses and Base64-decodes a Kubernetes `Secret` manifest, `kind: List`, `data:` block,
 * or bare `KEY: <base64>` / `KEY=<base64>` key-value snippet.
 */
export function decodeSecretInput(raw: string): DecodedSecret[] {
  const t = raw.trim();
  if (!t) return [];

  const first = t.split(/\r?\n/).find((l) => l.trim() && !l.trim().startsWith('#')) ?? '';
  let docs: any[];
  if (!t.startsWith('{') && (/^\s*-\s*[^=\s:]+=/.test(first) || /^\s*(export\s+)?[^=\s:]+\s*=/.test(first))) {
    const pairs = parseEnv(t);
    docs = [
      {
        apiVersion: 'v1',
        kind: 'Secret',
        metadata: { name: 'app-secrets' },
        type: 'Opaque',
        data: Object.fromEntries(pairs),
        __isSnippet: true,
      },
    ];
  } else {
    const normalized = normalizeFlatYamlLines(t);
    try {
      docs = yaml.loadAll(normalized).filter((d) => d && typeof d === 'object');
    } catch (e) {
      throw new Error(`YAML error: ${(e as Error).message.split('\n')[0]}`);
    }
  }

  const expanded = docs.flatMap((d) => (Array.isArray(d.items) ? d.items : [d])).filter((d) => d && typeof d === 'object' && !Array.isArray(d));
  const secrets: { doc: any; isSnippet: boolean }[] = [];

  for (const d of expanded) {
    if (d.__isSnippet) {
      const { __isSnippet, ...rest } = d;
      secrets.push({ doc: rest, isSnippet: true });
    } else if (d.kind === 'Secret' || d.data || d.stringData) {
      secrets.push({
        doc: d.kind ? d : { apiVersion: 'v1', kind: 'Secret', metadata: { name: 'app-secrets' }, type: 'Opaque', ...d },
        isSnippet: d.kind !== 'Secret',
      });
    } else if (!d.kind && Object.keys(d).length > 0 && Object.values(d).every((v) => v == null || typeof v !== 'object')) {
      secrets.push({
        doc: {
          apiVersion: 'v1',
          kind: 'Secret',
          metadata: { name: 'app-secrets' },
          type: 'Opaque',
          data: d,
        },
        isSnippet: true,
      });
    }
  }

  if (!secrets.length) {
    throw new Error('No Secret or key/value data found. Paste a Secret YAML/JSON or KEY: Base64 lines.');
  }

  try {
    return secrets.map(({ doc, isSnippet }) => ({
      secret: doc,
      isSnippet,
      rows: [
        ...Object.entries(doc.data ?? {}).map(([key, v]) => ({ key, ...b64Decode(String(v ?? '')) })),
        ...Object.entries(doc.stringData ?? {}).map(([key, v]) => ({
          key,
          text: String(v),
          bytes: new TextEncoder().encode(String(v)),
        })),
      ],
    }));
  } catch {
    throw new Error('A value under data: is not valid Base64.');
  }
}

function formatDotenvVal(val: string): string {
  if (/[\s#"'\n\r\t]/.test(val)) {
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

function unflattenDecodedPairs(pairs: Pair[]): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const [rawKey, val] of pairs) {
    const parts = rawKey.includes('__') ? rawKey.split('__') : rawKey.includes(':') ? rawKey.split(':') : [rawKey];
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

/** Formats decoded Secrets as `yaml-kv`, `dotenv`, `json-nested` (.NET appsettings), or `stringdata` Secret manifest. */
export function formatDecodedSecrets(decoded: DecodedSecret[], format: DecodedExportFormat): string {
  if (!decoded.length) return '';
  const textPairs: Pair[] = decoded.flatMap(({ rows }) =>
    rows.filter((r) => r.text != null).map((r) => [r.key, r.text!] as Pair),
  );

  if (format === 'yaml-kv') {
    if (!textPairs.length) return '';
    return yaml.dump(Object.fromEntries(textPairs), { lineWidth: -1, noRefs: true }).trimEnd();
  }

  if (format === 'dotenv') {
    return textPairs.map(([k, v]) => `${k}=${formatDotenvVal(v)}`).join('\n');
  }

  if (format === 'json-nested') {
    return JSON.stringify(unflattenDecodedPairs(textPairs), null, 2);
  }

  // format === 'stringdata'
  const plain = decoded.map(({ secret, rows }) => {
    const { data, stringData, ...rest } = secret;
    if (rest.metadata) {
      const { managedFields, resourceVersion, uid, creationTimestamp, ...meta } = rest.metadata;
      if (meta.annotations) {
        const annotations = { ...meta.annotations };
        delete annotations['kubectl.kubernetes.io/last-applied-configuration'];
        if (Object.keys(annotations).length) meta.annotations = annotations;
        else delete meta.annotations;
      }
      rest.metadata = meta;
    }
    const binary = rows.filter((r) => r.text == null);
    return yaml.dump(
      {
        ...rest,
        ...(rows.some((r) => r.text != null) && {
          stringData: Object.fromEntries(rows.filter((r) => r.text != null).map((r) => [r.key, r.text])),
        }),
        ...(binary.length && { data: Object.fromEntries(binary.map((r) => [r.key, data[r.key]])) }),
      },
      { lineWidth: -1, noRefs: true },
    );
  });
  return plain.join('---\n').trimEnd();
}

/** Problems the API server would reject, or that are probably mistakes. */
export function checkPairs(pairs: Pair[]): KeyIssue[] {
  const issues: KeyIssue[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const [k, v] of pairs) {
    const bytes = new TextEncoder().encode(v).length;
    total += bytes;
    if (!KEY.test(k)) issues.push({ key: k, level: 'error', message: 'Keys may only contain letters, digits, “-”, “_” and “.”.' });
    if (seen.has(k)) issues.push({ key: k, level: 'warn', message: 'Defined more than once. The last value wins.' });
    if (!v) issues.push({ key: k, level: 'warn', message: 'Empty value.' });
    // A trailing newline is normal for multi-line values such as PEM files.
    else if (v !== v.trimStart() || (!v.trimEnd().includes('\n') && v !== v.trimEnd()))
      issues.push({ key: k, level: 'warn', message: 'Leading or trailing whitespace or newline.' });
    seen.add(k);
  }
  // Base64 grows the stored size by a third.
  const stored = Math.ceil(total / 3) * 4;
  if (stored > SECRET_MAX_BYTES) issues.push({ key: '', level: 'error', message: `About ${Math.round(stored / 1024)} KiB after Base64. Secrets are limited to 1 MiB.` });
  else if (stored > SECRET_MAX_BYTES * 0.9) issues.push({ key: '', level: 'warn', message: `About ${Math.round(stored / 1024)} KiB after Base64, close to the 1 MiB limit.` });
  return issues;
}
