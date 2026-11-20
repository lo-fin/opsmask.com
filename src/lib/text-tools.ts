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
  joinWith?: 'newline' | 'comma' | 'comma-quote' | 'sql-in' | 'space';
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

export type LineTransformResult = {
  /** Final output after prefix/suffix and joining. */
  text: string;
  /** Number of lines in the input. */
  inputLines: number;
  /** Number of items in the output (before joining, so it is correct for comma/space joins). */
  items: number;
  /** How many lines each step dropped. */
  removed: { empty: number; filtered: number; duplicates: number };
};

/** Transforms lines and reports what each step changed. */
export function transformLinesDetailed(text: string, opts: LineTransformOptions = {}): LineTransformResult {
  const removed = { empty: 0, filtered: 0, duplicates: 0 };
  if (!text) return { text: '', inputLines: 0, items: 0, removed };
  let lines = text.split(/\r?\n/);
  const inputLines = lines.length;

  if (opts.trimLines) {
    lines = lines.map((l) => l.trim());
  }
  if (opts.removeEmpty) {
    const before = lines.length;
    lines = lines.filter((l) => l.trim().length > 0);
    removed.empty = before - lines.length;
  }
  const beforeFilter = lines.length;
  if (opts.filterContains) {
    const q = opts.filterContains.toLowerCase();
    lines = lines.filter((l) => l.toLowerCase().includes(q));
  }
  if (opts.filterExclude) {
    const q = opts.filterExclude.toLowerCase();
    lines = lines.filter((l) => !l.toLowerCase().includes(q));
  }
  removed.filtered = beforeFilter - lines.length;
  if (opts.dedupe) {
    const before = lines.length;
    const seen = new Set<string>();
    lines = lines.filter((l) => {
      const k = opts.caseInsensitiveDedupe ? l.toLowerCase() : l;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    removed.duplicates = before - lines.length;
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

  const items = lines.length;
  const quoted = () => lines.map((l) => `'${l.replace(/'/g, "''")}'`).join(', ');
  const joinWith = opts.joinWith ?? 'newline';
  let out: string;
  if (joinWith === 'comma') out = lines.join(', ');
  else if (joinWith === 'comma-quote') out = quoted();
  else if (joinWith === 'sql-in') out = items ? `IN (${quoted()})` : '';
  else if (joinWith === 'space') out = lines.join(' ');
  else out = lines.join('\n');
  return { text: out, inputLines, items, removed };
}

export function transformLines(text: string, opts: LineTransformOptions = {}): string {
  return transformLinesDetailed(text, opts).text;
}

/** Returns `n word` or `n words`. */
export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? word : pluralWord}`;
}

/** Human summary such as "7 lines in → 4 out · 2 duplicates, 1 empty removed". */
export function summarizeTransform(r: LineTransformResult): string {
  if (!r.inputLines) return '';
  const parts: string[] = [];
  if (r.removed.duplicates) parts.push(plural(r.removed.duplicates, 'duplicate'));
  if (r.removed.empty) parts.push(`${r.removed.empty.toLocaleString('en-US')} empty`);
  if (r.removed.filtered) parts.push(`${r.removed.filtered.toLocaleString('en-US')} filtered`);
  const head = `${plural(r.inputLines, 'line')} in → ${r.items.toLocaleString('en-US')} out`;
  return parts.length ? `${head} · removed ${parts.join(', ')}` : `${head} · nothing removed`;
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

export type LineStripOptions = {
  /** Number of leading characters (code points) to remove from each line. */
  stripStart?: number;
  /** Number of trailing characters (code points) to remove from each line. */
  stripEnd?: number;
  /** Optional delimiter string: strip everything up to and including the first occurrence on each line. */
  stripBeforeDelimiter?: string;
  /** Leave lines shorter than stripStart + stripEnd untouched instead of emptying them. */
  keepShortLines?: boolean;
  /** Trim leading and trailing whitespace on each line after stripping. */
  trimRemaining?: boolean;
  /** Remove lines that are empty after stripping. */
  removeEmpty?: boolean;
};

export type LineStripPreviewItem = {
  lineNumber: number;
  raw: string;
  cutPrefix: string;
  kept: string;
  cutSuffix: string;
};

export type LineStripResult = {
  text: string;
  inputLines: number;
  outputLines: number;
  linesModified: number;
  totalCharsRemoved: number;
  emptyRemoved: number;
  firstNonEmptyLine: string;
  preview: LineStripPreviewItem[];
};

export function stripLineCharsDetailed(text: string, opts: LineStripOptions = {}): LineStripResult {
  if (!text) {
    return {
      text: '',
      inputLines: 0,
      outputLines: 0,
      linesModified: 0,
      totalCharsRemoved: 0,
      emptyRemoved: 0,
      firstNonEmptyLine: '',
      preview: [],
    };
  }

  const lines = text.split(/\r?\n/);
  const inputLines = lines.length;
  const firstNonEmptyLine = lines.find((l) => l.length > 0) ?? '';
  const stripStart = Math.max(0, Math.floor(opts.stripStart ?? 0));
  const stripEnd = Math.max(0, Math.floor(opts.stripEnd ?? 0));
  const delim = opts.stripBeforeDelimiter ?? '';

  let linesModified = 0;
  let totalCharsRemoved = 0;
  const preview: LineStripPreviewItem[] = [];
  const processed: string[] = [];

  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx];
    let working = raw;
    let delimPrefix = '';

    if (delim) {
      const pos = working.indexOf(delim);
      if (pos !== -1) {
        delimPrefix = working.slice(0, pos + delim.length);
        working = working.slice(pos + delim.length);
      }
    }

    const chars = Array.from(working);
    let startCut = '';
    let endCut = '';
    let middle = working;

    if (stripStart > 0 || stripEnd > 0) {
      if (opts.keepShortLines && chars.length < stripStart + stripEnd) {
        middle = working;
      } else {
        const sCount = Math.min(stripStart, chars.length);
        startCut = chars.slice(0, sCount).join('');
        const rem = chars.slice(sCount);
        const eCount = Math.min(stripEnd, rem.length);
        endCut = eCount > 0 ? rem.slice(rem.length - eCount).join('') : '';
        middle = eCount > 0 ? rem.slice(0, rem.length - eCount).join('') : rem.join('');
      }
    }

    if (opts.trimRemaining) {
      middle = middle.trim();
    }

    const rawLen = Array.from(raw).length;
    const keptLen = Array.from(middle).length;
    const removedHere = Math.max(0, rawLen - keptLen);
    if (removedHere > 0 || middle !== raw) {
      linesModified++;
      totalCharsRemoved += removedHere;
    }

    if (preview.length < 12) {
      preview.push({
        lineNumber: idx + 1,
        raw,
        cutPrefix: delimPrefix + startCut,
        kept: middle,
        cutSuffix: endCut,
      });
    }

    processed.push(middle);
  }

  let emptyRemoved = 0;
  let finalLines = processed;
  if (opts.removeEmpty) {
    const before = finalLines.length;
    finalLines = finalLines.filter((l) => l.trim().length > 0);
    emptyRemoved = before - finalLines.length;
  }

  return {
    text: finalLines.join('\n'),
    inputLines,
    outputLines: finalLines.length,
    linesModified,
    totalCharsRemoved,
    emptyRemoved,
    firstNonEmptyLine,
    preview,
  };
}

export function stripLineChars(text: string, opts: LineStripOptions = {}): string {
  return stripLineCharsDetailed(text, opts).text;
}

export function summarizeLineStrip(r: LineStripResult): string {
  if (!r.inputLines) return '';
  const parts: string[] = [
    `${plural(r.totalCharsRemoved, 'char')} removed across ${plural(r.linesModified, 'line')}`,
  ];
  if (r.emptyRemoved > 0) {
    parts.push(`${r.emptyRemoved.toLocaleString('en-US')} empty dropped`);
  }
  return `${plural(r.inputLines, 'line')} in → ${r.outputLines.toLocaleString('en-US')} out · ${parts.join(', ')}`;
}

export function buildLineStripCommands(stripStart: number, stripEnd = 0): {
  macos: string;
  linux: string;
  windows: string;
} {
  const s = Math.max(0, Math.floor(stripStart));
  const e = Math.max(0, Math.floor(stripEnd));
  if (e === 0) {
    const col = s + 1;
    return {
      macos: s === 0 ? 'pbpaste | pbcopy' : `pbpaste | cut -c ${col}- | pbcopy`,
      linux: s === 0 ? 'xclip -o -selection clipboard | xclip -selection clipboard' : `xclip -o -selection clipboard | cut -c ${col}- | xclip -selection clipboard`,
      windows:
        s === 0
          ? 'Get-Clipboard | Set-Clipboard'
          : `Get-Clipboard | ForEach-Object { if ($_.Length -gt ${s}) { $_.Substring(${s}) } else { "" } } | Set-Clipboard`,
    };
  }
  const col = s + 1;
  const awkBody = `awk '{ l = length($0); s = ${col}; e = l - ${e}; print (e >= s ? substr($0, s, e - s + 1) : "") }'`;
  return {
    macos: `pbpaste | ${awkBody} | pbcopy`,
    linux: `xclip -o -selection clipboard | ${awkBody} | xclip -selection clipboard`,
    windows: `Get-Clipboard | ForEach-Object { $n = $_.Length - ${s} - ${e}; if ($n -gt 0) { $_.Substring(${s}, $n) } else { "" } } | Set-Clipboard`,
  };
}

