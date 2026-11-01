// Pure text manipulation utilities for the Text tool suite.

export type LineTransformOptions = {
  trimLines?: boolean;
  removeEmpty?: boolean;
  dedupe?: boolean;
  caseInsensitiveDedupe?: boolean;
  sort?: 'none' | 'asc' | 'desc' | 'natural' | 'length';
  filterContains?: string;
  filterExclude?: string;
  prefix?: string;
  suffix?: string;
  joinWith?: 'newline' | 'comma' | 'comma-quote' | 'space';
};

export type TextStats = {
  chars: number;
  bytes: number;
  words: number;
  lines: number;
  nonEmptyLines: number;
  uniqueLines: number;
};

export function getTextStats(text: string): TextStats {
  if (!text) {
    return { chars: 0, bytes: 0, words: 0, lines: 0, nonEmptyLines: 0, uniqueLines: 0 };
  }
  const linesArr = text.split(/\r?\n/);
  const nonEmpty = linesArr.filter((l) => l.trim().length > 0);
  const unique = new Set(linesArr).size;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const bytes = new TextEncoder().encode(text).length;
  return {
    chars: text.length,
    bytes,
    words,
    lines: linesArr.length,
    nonEmptyLines: nonEmpty.length,
    uniqueLines: unique,
  };
}

export function transformLines(text: string, opts: LineTransformOptions = {}): string {
  if (!text) return '';
  let lines = text.split(/\r?\n/);

  if (opts.trimLines) {
    lines = lines.map((l) => l.trim());
  }
  if (opts.removeEmpty) {
    lines = lines.filter((l) => l.trim().length > 0);
  }
  if (opts.filterContains) {
    const q = opts.filterContains.toLowerCase();
    lines = lines.filter((l) => l.toLowerCase().includes(q));
  }
  if (opts.filterExclude) {
    const q = opts.filterExclude.toLowerCase();
    lines = lines.filter((l) => !l.toLowerCase().includes(q));
  }
  if (opts.dedupe) {
    const seen = new Set<string>();
    lines = lines.filter((l) => {
      const k = opts.caseInsensitiveDedupe ? l.toLowerCase() : l;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  const sort = opts.sort ?? 'none';
  if (sort === 'asc') {
    lines = [...lines].sort((a, b) => a.localeCompare(b));
  } else if (sort === 'desc') {
    lines = [...lines].sort((a, b) => b.localeCompare(a));
  } else if (sort === 'natural') {
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    lines = [...lines].sort((a, b) => collator.compare(a, b));
  } else if (sort === 'length') {
    lines = [...lines].sort((a, b) => a.length - b.length || a.localeCompare(b));
  }

  if (opts.prefix || opts.suffix) {
    const pre = opts.prefix ?? '';
    const suf = opts.suffix ?? '';
    lines = lines.map((l) => `${pre}${l}${suf}`);
  }

  const joinWith = opts.joinWith ?? 'newline';
  if (joinWith === 'comma') return lines.join(', ');
  if (joinWith === 'comma-quote') return lines.map((l) => `'${l.replace(/'/g, "''")}'`).join(', ');
  if (joinWith === 'space') return lines.join(' ');
  return lines.join('\n');
}

export type CaseItem = {
  id: string;
  label: string;
  value: string;
};

export function splitWords(input: string): string[] {
  const trimmed = input.trim();
  if (!trimmed) return [];
  return trimmed
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean);
}

function splitWordsLine(line: string): string[] {
  return splitWords(line);
}

function mapLines(input: string, fn: (words: string[], rawLine: string) => string): string {
  if (!input.trim()) return '';
  return input
    .split(/\r?\n/)
    .map((line) => {
      if (!line.trim()) return '';
      const words = splitWordsLine(line);
      return words.length ? fn(words, line) : line;
    })
    .join('\n');
}

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

export function convertCases(input: string): CaseItem[] {
  if (!input.trim()) return [];
  return [
    {
      id: 'camel',
      label: 'camelCase',
      value: mapLines(input, (w) => w[0].toLowerCase() + w.slice(1).map(cap).join('')),
    },
    {
      id: 'pascal',
      label: 'PascalCase',
      value: mapLines(input, (w) => w.map(cap).join('')),
    },
    {
      id: 'snake',
      label: 'snake_case',
      value: mapLines(input, (w) => w.map((x) => x.toLowerCase()).join('_')),
    },
    {
      id: 'screaming-snake',
      label: 'SCREAMING_SNAKE_CASE',
      value: mapLines(input, (w) => w.map((x) => x.toUpperCase()).join('_')),
    },
    {
      id: 'kebab',
      label: 'kebab-case',
      value: mapLines(input, (w) => w.map((x) => x.toLowerCase()).join('-')),
    },
    {
      id: 'screaming-kebab',
      label: 'SCREAMING-KEBAB-CASE',
      value: mapLines(input, (w) => w.map((x) => x.toUpperCase()).join('-')),
    },
    {
      id: 'dot',
      label: 'dot.case',
      value: mapLines(input, (w) => w.map((x) => x.toLowerCase()).join('.')),
    },
    {
      id: 'path',
      label: 'path/case',
      value: mapLines(input, (w) => w.map((x) => x.toLowerCase()).join('/')),
    },
    {
      id: 'lower',
      label: 'lowercase',
      value: input.toLowerCase(),
    },
    {
      id: 'upper',
      label: 'UPPERCASE',
      value: input.toUpperCase(),
    },
    {
      id: 'title',
      label: 'Title Case',
      value: mapLines(input, (w) => w.map(cap).join(' ')),
    },
  ];
}

export type DiffOp = {
  type: 'equal' | 'add' | 'del';
  lineA?: number;
  lineB?: number;
  text: string;
};

export type DiffOptions = {
  ignoreWhitespace?: boolean;
  ignoreCase?: boolean;
};

export type DiffResult = {
  ops: DiffOp[];
  added: number;
  removed: number;
  unchanged: number;
};

export function diffLines(left: string, right: string, opts: DiffOptions = {}): DiffResult {
  const aLines = left === '' ? [] : left.split(/\r?\n/);
  const bLines = right === '' ? [] : right.split(/\r?\n/);

  const norm = (s: string) => {
    let r = s;
    if (opts.ignoreWhitespace) r = r.trim().replace(/\s+/g, ' ');
    if (opts.ignoreCase) r = r.toLowerCase();
    return r;
  };

  const aNorm = aLines.map(norm);
  const bNorm = bLines.map(norm);
  const n = aLines.length;
  const m = bLines.length;

  // LCS dynamic programming table
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (aNorm[i] === bNorm[j]) {
        dp[i][j] = 1 + dp[i + 1][j + 1];
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  let added = 0;
  let removed = 0;
  let unchanged = 0;

  while (i < n && j < m) {
    if (aNorm[i] === bNorm[j]) {
      ops.push({ type: 'equal', lineA: i + 1, lineB: j + 1, text: bLines[j] });
      unchanged++;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'del', lineA: i + 1, text: aLines[i] });
      removed++;
      i++;
    } else {
      ops.push({ type: 'add', lineB: j + 1, text: bLines[j] });
      added++;
      j++;
    }
  }
  while (i < n) {
    ops.push({ type: 'del', lineA: i + 1, text: aLines[i] });
    removed++;
    i++;
  }
  while (j < m) {
    ops.push({ type: 'add', lineB: j + 1, text: bLines[j] });
    added++;
    j++;
  }

  return { ops, added, removed, unchanged };
}

export type EscapeItem = {
  id: string;
  label: string;
  value: string;
};

function unescapeJsonString(s: string): string {
  const t = s.trim();
  try {
    if (t.startsWith('"') && t.endsWith('"')) {
      return JSON.parse(t);
    }
    return JSON.parse(`"${s.replace(/(^|[^\\])"/g, '$1\\"')}"`);
  } catch {
    return s
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
}

export function convertEscapes(input: string): EscapeItem[] {
  if (!input) return [];
  const jsonEscaped = JSON.stringify(input).slice(1, -1);
  const jsonQuoted = JSON.stringify(input);
  const jsonUnescaped = unescapeJsonString(input);
  const shellSingle = `'${input.replace(/'/g, `'\\''`)}'`;
  const urlEncoded = encodeURIComponent(input);
  let urlDecoded = input;
  try {
    urlDecoded = decodeURIComponent(input.replace(/\+/g, '%20'));
  } catch {}
  const htmlEscaped = input.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  const htmlUnescaped = input.replace(/&(amp|lt|gt|quot|#39|apos);/g, (m, code) => ({
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    '#39': "'",
    apos: "'",
  })[code as 'amp'] ?? m);

  return [
    { id: 'json-escape', label: 'JSON escaped (no outer quotes)', value: jsonEscaped },
    { id: 'json-quoted', label: 'JSON string literal ("…")', value: jsonQuoted },
    { id: 'json-unescape', label: 'JSON unescaped (\\n → newline, \\" → ")', value: jsonUnescaped },
    { id: 'shell-quote', label: 'Shell single-quoted', value: shellSingle },
    { id: 'url-encode', label: 'URL encoded (encodeURIComponent)', value: urlEncoded },
    { id: 'url-decode', label: 'URL decoded', value: urlDecoded },
    { id: 'html-escape', label: 'HTML entities escaped', value: htmlEscaped },
    { id: 'html-unescape', label: 'HTML entities unescaped', value: htmlUnescaped },
  ];
}
