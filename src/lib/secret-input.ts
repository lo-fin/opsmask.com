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

const KEY = /^[-._a-zA-Z0-9]+$/;
export const SECRET_MAX_BYTES = 1024 * 1024;

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
  try { doc = yaml.load(text); } catch (e) { throw new Error(`YAML: ${(e as Error).message.split('\n')[0]}`); }
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
  return result(format, doc, text, opts, 'config.yaml');
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
