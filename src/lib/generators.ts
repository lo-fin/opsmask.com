// Cryptographically secure password, secret key, passphrase, UUID (v4/v7), ULID and NanoID generators using Web Crypto.

export type SecretMode = 'password' | 'hex' | 'base64' | 'base64url' | 'api-key' | 'passphrase';

export type PasswordOptions = {
  mode?: SecretMode;
  length: number;
  count?: number;
  uppercase?: boolean;
  lowercase?: boolean;
  digits?: boolean;
  symbols?: boolean;
  safeSymbolsOnly?: boolean;
  excludeAmbiguous?: boolean;
  prefix?: string;
  wordCount?: number;
  wordSeparator?: string;
  includeNumberInPassphrase?: boolean;
};

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const SYMBOLS_ALL = '!@#$%^&*()-_=+[]{}|;:,.<>?';
const SYMBOLS_SAFE = '-_.~';
const AMBIGUOUS = /[0O1lI]/g;
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const CROCKFORD32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const NANOID_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz-';
const K8S_SAFE_ALPHABET = 'bcdfghjklmnpqrstvwxz2456789';

const WORD_LIST = [
  'amber', 'anchor', 'apollo', 'arctic', 'aspire', 'atlas', 'autumn', 'avalon',
  'badger', 'barium', 'beacon', 'binary', 'bison', 'breeze', 'bridge', 'bronze',
  'canyon', 'carbon', 'castle', 'cedar', 'cinder', 'cipher', 'citadel', 'cobalt',
  'comet', 'compass', 'copper', 'coral', 'cosmos', 'crater', 'crimson', 'crystal',
  'dagger', 'delta', 'desert', 'dynamo', 'eclipse', 'ember', 'emerald', 'engine',
  'falcon', 'fathom', 'fjord', 'flint', 'forest', 'fossil', 'fusion', 'galaxy',
  'garnet', 'geyser', 'glacier', 'granite', 'gravity', 'harbor', 'harvest', 'helium',
  'horizon', 'hunter', 'ignite', 'indigo', 'iron', 'island', 'ivory', 'jasper',
  'jungle', 'jupiter', 'kernel', 'krypton', 'lagoon', 'lantern', '24k', 'legend',
  'lightning', 'lithium', 'lotus', 'lunar', 'magnet', 'mantle', 'marble', 'matrix',
  'meadow', 'mercury', 'meteor', 'mirage', 'monarch', 'monolith', 'nebula', 'nectar',
  'neon', 'neptune', 'nickel', 'nimbus', 'nitrogen', 'nomad', 'nova', 'obsidian',
  'ocean', 'omega', 'onyx', 'opal', 'orbit', 'orchid', 'origin', 'osprey',
  'oxygen', 'pacific', 'paladin', 'panther', 'paradox', 'pebble', 'pegasus', 'pelican',
  'phantom', 'phoenix', 'photon', 'pioneer', 'planet', 'plasma', 'platinum', 'polar',
  'polaris', 'portal', 'prism', 'pulsar', 'pyramid', 'python', 'quantum', 'quartz',
  'quasar', 'radium', 'raptor', 'raven', 'reactor', 'redwood', 'relay', 'ridge',
  'ripple', 'river', 'rocket', 'ruby', 'saffron', 'sahara', 'sapphire', 'saturn',
  'scarlet', 'scepter', 'sector', 'seismic', 'sentinel', 'sequoia', 'shadow', 'shield',
  'sierra', 'silicon', 'silver', 'SIRIUS'.toLowerCase(), 'solstice', 'sonar', 'spark', 'spectra',
  'sphinx', 'spider', 'spiral', 'spruce', 'starlight', 'stealth', 'stellar', 'stratus',
  'summit', 'sunrise', 'tempest', 'tensor', 'terra', 'thistle', 'thunder', 'timber',
  'titan', 'topaz', 'torrent', 'trident', 'tundra', 'turbine', 'twilight', 'typhoon',
  'umbra', 'utopia', 'valley', 'valor', 'vector', 'velvet', 'vertex', 'vessel',
  'vortex', 'voyager', 'vulcan', 'warden', 'whisper', 'wildfire', 'willow', 'winter',
  'xenon', 'zephyr', 'zenith', 'zircon',
];

/** Unbiased random integer in [0, max) using rejection sampling. */
function randomInt(max: number): number {
  if (max <= 1) return 0;
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / max) * max;
  while (true) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % max;
  }
}

function randomBytes(byteLen: number): Uint8Array {
  const bytes = new Uint8Array(Math.max(1, Math.min(256, Math.floor(byteLen))));
  crypto.getRandomValues(bytes);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array, urlSafe = false): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin);
  return urlSafe ? b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : b64;
}

export function buildCharsetPools(opts: PasswordOptions): string[] {
  const strip = (s: string) => (opts.excludeAmbiguous ? s.replace(AMBIGUOUS, '') : s);
  const pools: string[] = [];
  if (opts.uppercase ?? true) pools.push(strip(UPPER));
  if (opts.lowercase ?? true) pools.push(strip(LOWER));
  if (opts.digits ?? true) pools.push(strip(DIGITS));
  if (opts.symbols ?? true) {
    pools.push(opts.safeSymbolsOnly ? SYMBOLS_SAFE : SYMBOLS_ALL);
  }
  return pools.filter((p) => p.length > 0);
}

export function calculateEntropyBits(opts: PasswordOptions): number {
  const mode = opts.mode ?? 'password';
  if (mode === 'hex' || mode === 'base64' || mode === 'base64url') {
    const byteLen = Math.max(4, Math.min(128, Math.floor(opts.length || 32)));
    return byteLen * 8;
  }
  if (mode === 'api-key') {
    const len = Math.max(8, Math.min(128, Math.floor(opts.length || 32)));
    return Math.round(len * Math.log2(BASE62.length));
  }
  if (mode === 'passphrase') {
    const words = Math.max(3, Math.min(10, Math.floor(opts.wordCount ?? 4)));
    const extra = opts.includeNumberInPassphrase !== false ? Math.log2(90) : 0;
    return Math.round(words * Math.log2(WORD_LIST.length) + extra);
  }
  const pools = buildCharsetPools(opts);
  const uniqueChars = new Set(pools.join('')).size;
  if (uniqueChars <= 1 || opts.length <= 0) return 0;
  return Math.round(opts.length * Math.log2(uniqueChars));
}

export function generatePassword(opts: PasswordOptions): string {
  const mode = opts.mode ?? 'password';

  if (mode === 'hex') {
    const byteLen = Math.max(4, Math.min(128, Math.floor(opts.length || 32)));
    return Array.from(randomBytes(byteLen), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  if (mode === 'base64') {
    const byteLen = Math.max(4, Math.min(128, Math.floor(opts.length || 32)));
    return bytesToBase64(randomBytes(byteLen), false);
  }

  if (mode === 'base64url') {
    const byteLen = Math.max(4, Math.min(128, Math.floor(opts.length || 32)));
    return bytesToBase64(randomBytes(byteLen), true);
  }

  if (mode === 'api-key') {
    const len = Math.max(8, Math.min(128, Math.floor(opts.length || 32)));
    const prefix = opts.prefix ?? 'sk_live_';
    let body = '';
    for (let i = 0; i < len; i++) body += BASE62[randomInt(BASE62.length)];
    return `${prefix}${body}`;
  }

  if (mode === 'passphrase') {
    const count = Math.max(3, Math.min(10, Math.floor(opts.wordCount ?? 4)));
    const sep = opts.wordSeparator ?? '-';
    const words = Array.from({ length: count }, () => WORD_LIST[randomInt(WORD_LIST.length)]);
    if (opts.includeNumberInPassphrase !== false) {
      words.push(String(10 + randomInt(90)));
    }
    return words.join(sep);
  }

  const length = Math.max(4, Math.min(256, Math.floor(opts.length || 24)));
  const pools = buildCharsetPools(opts);
  if (pools.length === 0) {
    throw new Error('Select at least one character set (uppercase, lowercase, digits or symbols).');
  }
  const combined = Array.from(new Set(pools.join(''))).join('');
  const chars: string[] = [];

  for (let i = 0; i < pools.length && chars.length < length; i++) {
    const p = pools[i];
    chars.push(p[randomInt(p.length)]);
  }
  while (chars.length < length) {
    chars.push(combined[randomInt(combined.length)]);
  }

  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const tmp = chars[i];
    chars[i] = chars[j];
    chars[j] = tmp;
  }

  return chars.join('');
}

export function generatePasswords(opts: PasswordOptions): string[] {
  const count = Math.max(1, Math.min(100, Math.floor(opts.count ?? 5)));
  return Array.from({ length: count }, () => generatePassword(opts));
}

export type UuidVersion = 'v4' | 'v7' | 'ulid' | 'nanoid' | 'k8s' | 'nil';

export type UuidOptions = {
  version?: UuidVersion;
  count?: number;
  hyphens?: boolean;
  uppercase?: boolean;
  braces?: boolean;
  nanoidLength?: number;
};

function bytesToHex(bytes: Uint8Array, hyphens: boolean): string {
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  if (!hyphens) return hex;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function generateUlid(nowMs = Date.now()): string {
  // 48-bit timestamp encoded as 10 Crockford Base32 chars
  let time = nowMs;
  let timeChars = '';
  for (let i = 9; i >= 0; i--) {
    const mod = time % 32;
    timeChars = CROCKFORD32[mod] + timeChars;
    time = Math.floor(time / 32);
  }
  // 80 bits of randomness encoded as 16 Crockford Base32 chars
  let randChars = '';
  for (let i = 0; i < 16; i++) {
    randChars += CROCKFORD32[randomInt(32)];
  }
  return timeChars + randChars;
}

export function generateNanoId(size = 21): string {
  const len = Math.max(4, Math.min(64, Math.floor(size || 21)));
  let id = '';
  for (let i = 0; i < len; i++) {
    id += NANOID_ALPHABET[randomInt(NANOID_ALPHABET.length)];
  }
  return id;
}

export function generateK8sName(): string {
  const w1 = WORD_LIST[randomInt(WORD_LIST.length)];
  const w2 = WORD_LIST[randomInt(WORD_LIST.length)];
  let suffix = '';
  for (let i = 0; i < 5; i++) {
    suffix += K8S_SAFE_ALPHABET[randomInt(K8S_SAFE_ALPHABET.length)];
  }
  return `${w1}-${w2}-${suffix}`;
}

export function generateUuidBytes(version: UuidVersion = 'v4', nowMs = Date.now()): Uint8Array {
  const bytes = new Uint8Array(16);
  if (version === 'nil') return bytes;

  crypto.getRandomValues(bytes);

  if (version === 'v7') {
    let ts = BigInt(nowMs);
    for (let i = 5; i >= 0; i--) {
      bytes[i] = Number(ts & 0xffn);
      ts >>= 8n;
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x70;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return bytes;
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return bytes;
}

export function formatUuid(bytes: Uint8Array, opts: UuidOptions = {}): string {
  const hyphens = opts.hyphens ?? true;
  let out = bytesToHex(bytes, hyphens);
  if (opts.uppercase) out = out.toUpperCase();
  if (opts.braces) out = `{${out}}`;
  return out;
}

export function generateUuids(opts: UuidOptions = {}): string[] {
  const version = opts.version ?? 'v4';
  const count = version === 'nil' ? 1 : Math.max(1, Math.min(100, Math.floor(opts.count ?? 5)));
  const baseNow = Date.now();

  if (version === 'ulid') {
    return Array.from({ length: count }, (_, idx) => {
      const u = generateUlid(baseNow + idx);
      return opts.uppercase === false ? u.toLowerCase() : u;
    });
  }

  if (version === 'nanoid') {
    return Array.from({ length: count }, () => generateNanoId(opts.nanoidLength ?? 21));
  }

  if (version === 'k8s') {
    return Array.from({ length: count }, () => generateK8sName());
  }

  return Array.from({ length: count }, (_, idx) => {
    const bytes = generateUuidBytes(version, baseNow + idx);
    return formatUuid(bytes, opts);
  });
}
