// Minimal 5-field cron parser (minute hour day-of-month month day-of-week),
// matching Vixie cron / Kubernetes CronJob semantics.

type FieldSpec = { name: string; min: number; max: number; names?: string[] };

export const FIELDS: FieldSpec[] = [
  { name: 'Minute', min: 0, max: 59 },
  { name: 'Hour', min: 0, max: 23 },
  { name: 'Day of month', min: 1, max: 31 },
  { name: 'Month', min: 1, max: 12, names: ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] },
  { name: 'Day of week', min: 0, max: 6, names: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] },
];

const MACROS: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

export type ParsedField = { values: number[]; any: boolean; raw: string };
export type Parsed = { fields: ParsedField[]; expression: string };

function parseValue(token: string, spec: FieldSpec): number {
  const t = token.toLowerCase();
  if (spec.names) {
    const i = spec.names.indexOf(t);
    if (i >= 0) return i + spec.min;
  }
  if (!/^\d+$/.test(t)) throw new Error(`“${token}” is not a valid ${spec.name.toLowerCase()} value`);
  let n = Number(t);
  if (spec.name === 'Day of week' && n === 7) n = 0; // 7 = Sunday
  if (n < spec.min || n > spec.max) throw new Error(`${spec.name} must be between ${spec.min} and ${spec.max}, got ${n}`);
  return n;
}

function parseField(raw: string, spec: FieldSpec): ParsedField {
  const set = new Set<number>();
  for (const part of raw.split(',')) {
    const [range, stepStr] = part.split('/');
    const step = stepStr === undefined ? 1 : Number(stepStr);
    if (!Number.isInteger(step) || step < 1) throw new Error(`Invalid step “/${stepStr}” in ${spec.name.toLowerCase()}`);
    let lo: number, hi: number;
    if (range === '*' || range === '?') { lo = spec.min; hi = spec.max; }
    else if (range.includes('-')) {
      const [a, b] = range.split('-');
      lo = parseValue(a, spec);
      hi = parseValue(b, spec);
      if (spec.name === 'Day of week' && b === '7') hi = 6, set.add(0);
      if (lo > hi) throw new Error(`Range ${range} in ${spec.name.toLowerCase()} goes backwards`);
    } else {
      lo = parseValue(range, spec);
      hi = stepStr === undefined ? lo : spec.max;
    }
    for (let v = lo; v <= hi; v += step) set.add(v);
  }
  const values = [...set].sort((a, b) => a - b);
  return { values, any: raw === '*' || raw === '?', raw };
}

export function parseCron(expr: string): Parsed {
  let e = expr.trim().replace(/\s+/g, ' ');
  if (MACROS[e.toLowerCase()]) e = MACROS[e.toLowerCase()];
  const parts = e.split(' ');
  if (parts.length !== 5) throw new Error(`Expected 5 fields (minute hour day month weekday), found ${parts.length}`);
  return { fields: parts.map((p, i) => parseField(p, FIELDS[i])), expression: e };
}

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function compress(values: number[], label: (n: number) => string): string {
  const out: string[] = [];
  for (let i = 0; i < values.length; i++) {
    let j = i;
    while (j + 1 < values.length && values[j + 1] === values[j] + 1) j++;
    out.push(j - i >= 2 ? `${label(values[i])} through ${label(values[j])}` : j > i ? `${label(values[i])}, ${label(values[j])}` : label(values[i]));
    i = j;
  }
  return out.join(', ');
}

export function describeField(f: ParsedField, idx: number): string {
  const spec = FIELDS[idx];
  if (f.any) return `every ${spec.name.toLowerCase()}`;
  const step = f.raw.match(/^\*\/(\d+)$/);
  if (step) return `every ${step[1]} ${spec.name.toLowerCase()}s`.replace('day of months', 'days').replace('day of weeks', 'days');
  const label = idx === 3 ? (n: number) => MON[n - 1] : idx === 4 ? (n: number) => DOW[n] : (n: number) => String(n);
  return compress(f.values, label);
}

export function describe(p: Parsed): string {
  const [mi, h, dom, mon, dow] = p.fields;
  const stepOf = (f: ParsedField) => f.raw.match(/^(?:\*|0)\/(\d+)$/)?.[1];
  const minPhrase = mi.any ? 'every minute' : stepOf(mi) ? `every ${stepOf(mi)} minutes` : `at minute ${compress(mi.values, String)}`;
  const hourPhrase = h.any ? '' : stepOf(h) ? `every ${stepOf(h)} hours` : `during hour ${compress(h.values, (n) => String(n).padStart(2, '0'))}`;
  let time: string;
  if (mi.values.length === 1 && h.values.length === 1) {
    time = `At ${String(h.values[0]).padStart(2, '0')}:${String(mi.values[0]).padStart(2, '0')}`;
  } else if (mi.values.length === 1 && h.any) {
    time = `At minute ${mi.values[0]} of every hour`;
  } else {
    const t = hourPhrase ? `${minPhrase}, ${hourPhrase}` : minPhrase;
    time = t[0].toUpperCase() + t.slice(1);
  }
  const parts = [time];
  if (!dom.any && !dow.any) parts.push(`on day ${describeField(dom, 2)} of the month or on ${describeField(dow, 4)}`);
  else if (!dom.any) parts.push(`on day ${describeField(dom, 2)} of the month`);
  else if (!dow.any) parts.push(`on ${describeField(dow, 4)}`);
  if (!mon.any) parts.push(`in ${describeField(mon, 3)}`);
  return parts.join(' ') + '.';
}

/** Next n run times. utc=true evaluates the schedule in UTC, otherwise in the browser's time zone. */
export function nextRuns(p: Parsed, n: number, utc: boolean, from = new Date()): Date[] {
  const [mi, h, dom, mon, dow] = p.fields;
  const sets = p.fields.map((f) => new Set(f.values));
  const g = utc
    ? { Y: (d: Date) => d.getUTCFullYear(), M: (d: Date) => d.getUTCMonth(), D: (d: Date) => d.getUTCDate(), W: (d: Date) => d.getUTCDay(), H: (d: Date) => d.getUTCHours(), m: (d: Date) => d.getUTCMinutes() }
    : { Y: (d: Date) => d.getFullYear(), M: (d: Date) => d.getMonth(), D: (d: Date) => d.getDate(), W: (d: Date) => d.getDay(), H: (d: Date) => d.getHours(), m: (d: Date) => d.getMinutes() };
  const make = (Y: number, M: number, D: number, H = 0, m = 0) => (utc ? new Date(Date.UTC(Y, M, D, H, m)) : new Date(Y, M, D, H, m));

  const dayMatches = (d: Date) => {
    const a = sets[2].has(g.D(d));
    const b = sets[4].has(g.W(d));
    if (dom.any && dow.any) return true;
    if (dom.any) return b;
    if (dow.any) return a;
    return a || b; // classic cron: either matches
  };

  const out: Date[] = [];
  let d = new Date(from.getTime() + 60000);
  d = make(g.Y(d), g.M(d), g.D(d), g.H(d), g.m(d));
  const limit = from.getTime() + 5 * 366 * 86400000;
  while (out.length < n && d.getTime() < limit) {
    if (!sets[3].has(g.M(d) + 1)) { d = make(g.Y(d), g.M(d) + 1, 1); continue; }
    if (!dayMatches(d)) { d = make(g.Y(d), g.M(d), g.D(d) + 1); continue; }
    if (!sets[1].has(g.H(d))) { d = make(g.Y(d), g.M(d), g.D(d), g.H(d) + 1); continue; }
    if (!sets[0].has(g.m(d))) { d = new Date(d.getTime() + 60000); continue; }
    out.push(d);
    d = new Date(d.getTime() + 60000);
  }
  void mi; void h; void mon;
  return out;
}
