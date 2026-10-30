// Kubernetes resource.Quantity parsing and formatting (cpu: cores, memory: bytes).

const BINARY = { Ki: 2 ** 10, Mi: 2 ** 20, Gi: 2 ** 30, Ti: 2 ** 40, Pi: 2 ** 50, Ei: 2 ** 60 } as const;
const DECIMAL = { n: 1e-9, u: 1e-6, m: 1e-3, '': 1, k: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, E: 1e18 } as const;
const QUANTITY = /^([+-]?(?:\d+\.?\d*|\.\d+))(?:(Ki|Mi|Gi|Ti|Pi|Ei)|([eE][+-]?\d+)|(n|u|m|k|M|G|T|P|E))?$/;

/** Parses a quantity such as "500m", "1.5Gi", "2e3" or 4. Returns null if it is not valid. */
export function parseQuantity(q: unknown): number | null {
  if (typeof q === 'number') return Number.isFinite(q) ? q : null;
  if (typeof q !== 'string') return null;
  const m = QUANTITY.exec(q.trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (m[2]) return n * BINARY[m[2] as keyof typeof BINARY];
  if (m[3]) return n * 10 ** parseInt(m[3].slice(1), 10);
  return n * DECIMAL[(m[4] ?? '') as keyof typeof DECIMAL];
}

const trim = (n: number, digits = 2) => String(Number(n.toFixed(digits)));

/** Formats cores the way kubectl shows them: millicores below one core. */
export function formatCpu(cores: number): string {
  return cores < 1 ? `${trim(cores * 1000, 0)}m` : trim(cores, 3);
}

/** Formats bytes with binary suffixes (Ki, Mi, Gi, ...). */
export function formatBytes(bytes: number): string {
  const units = ['Ei', 'Pi', 'Ti', 'Gi', 'Mi', 'Ki'] as const;
  for (const u of units) if (Math.abs(bytes) >= BINARY[u]) return `${trim(bytes / BINARY[u])}${u}`;
  return trim(bytes, 0);
}

/** Formats bytes with decimal suffixes (k, M, G, ...). */
export function formatBytesDecimal(bytes: number): string {
  const units = ['E', 'P', 'T', 'G', 'M', 'k'] as const;
  for (const u of units) if (Math.abs(bytes) >= DECIMAL[u]) return `${trim(bytes / DECIMAL[u])}${u}`;
  return trim(bytes, 0);
}
