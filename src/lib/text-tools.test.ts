import { describe, expect, it } from 'vitest';
import {
  buildLineStripCommands,
  convertCases,
  convertEscapes,
  diffLines,
  getTextStats,
  plural,
  stripLineChars,
  stripLineCharsDetailed,
  summarizeLineStrip,
  summarizeTransform,
  transformLines,
  transformLinesDetailed,
} from './text-tools';

describe('transformLines & getTextStats', () => {
  it('trims, removes empty lines, deduplicates, sorts and joins lines', () => {
    const raw = '  pod-10 \n\npod-2\npod-10\npod-1 ';
    const out = transformLines(raw, {
      trimLines: true,
      removeEmpty: true,
      dedupe: true,
      sort: 'natural',
    });
    expect(out).toBe('pod-1\npod-2\npod-10');

    const sqlIn = transformLines(out, { joinWith: 'comma-quote' });
    expect(sqlIn).toBe("'pod-1', 'pod-2', 'pod-10'");
  });

  it('computes accurate text statistics', () => {
    const stats = getTextStats('alpha\nbeta\nalpha');
    expect(stats.lines).toBe(3);
    expect(stats.uniqueLines).toBe(2);
    expect(stats.words).toBe(3);
  });
});

describe('transformLinesDetailed', () => {
  const raw = 'pod-b\n\npod-a\npod-b\nPOD-A\nskip-me';
  const opts = { trimLines: true, removeEmpty: true, dedupe: true, caseInsensitiveDedupe: true, filterExclude: 'skip' };

  it('reports how many lines each step removed', () => {
    const r = transformLinesDetailed(raw, opts);
    expect(r.inputLines).toBe(6);
    expect(r.items).toBe(2);
    expect(r.removed).toEqual({ empty: 1, filtered: 1, duplicates: 2 });
  });

  it('counts items before joining so comma joins report the real item count', () => {
    const r = transformLinesDetailed(raw, { ...opts, joinWith: 'comma' });
    expect(r.text).toBe('pod-b, pod-a');
    expect(r.items).toBe(2);
  });

  it('wraps SQL-quoted values in an IN clause and escapes quotes', () => {
    expect(transformLines("a\nO'Brien", { joinWith: 'sql-in' })).toBe("IN ('a', 'O''Brien')");
    expect(transformLines('\n', { removeEmpty: true, joinWith: 'sql-in' })).toBe('');
  });

  it('summarizes the transform in plain English', () => {
    expect(summarizeTransform(transformLinesDetailed(raw, opts))).toBe(
      '6 lines in → 2 out · removed 2 duplicates, 1 empty, 1 filtered',
    );
    expect(summarizeTransform(transformLinesDetailed('a', {}))).toBe('1 line in → 1 out · nothing removed');
    expect(summarizeTransform(transformLinesDetailed('', {}))).toBe('');
  });

  it('pluralizes counts', () => {
    expect(plural(1, 'line')).toBe('1 line');
    expect(plural(1200, 'line')).toBe('1,200 lines');
  });
});

describe('convertCases', () => {
  it('converts identifiers across camel, pascal, snake, kebab and dot cases', () => {
    const cases = Object.fromEntries(convertCases('maxRetryCount_v2').map((c) => [c.id, c.value]));
    expect(cases.camel).toBe('maxRetryCountV2');
    expect(cases.pascal).toBe('MaxRetryCountV2');
    expect(cases.snake).toBe('max_retry_count_v2');
    expect(cases['screaming-snake']).toBe('MAX_RETRY_COUNT_V2');
    expect(cases.kebab).toBe('max-retry-count-v2');
    expect(cases.dot).toBe('max.retry.count.v2');
  });
});

describe('diffLines', () => {
  it('computes line additions, deletions and unchanged lines', () => {
    const res = diffLines('a\nb\nc', 'a\nx\nc\nd');
    expect(res.unchanged).toBe(2);
    expect(res.removed).toBe(1);
    expect(res.added).toBe(2);
  });
});

describe('convertEscapes', () => {
  it('escapes and unescapes JSON, shell, URL and HTML strings', () => {
    const map = Object.fromEntries(convertEscapes('hello "world"\nnext').map((e) => [e.id, e.value]));
    expect(map['json-escape']).toBe('hello \\"world\\"\\nnext');
    expect(map['json-quoted']).toBe('"hello \\"world\\"\\nnext"');

    const unesc = Object.fromEntries(convertEscapes('line1\\nline2').map((e) => [e.id, e.value]));
    expect(unesc['json-unescape']).toBe('line1\nline2');
  });
});

describe('stripLineChars & stripLineCharsDetailed', () => {
  it('strips the first N characters from every line', () => {
    const raw = '2026-10-30T02:14:07.123Z INFO server started\n2026-10-30T02:14:08.456Z WARN high memory';
    const out = stripLineChars(raw, { stripStart: 25 });
    expect(out).toBe('INFO server started\nWARN high memory');
  });

  it('strips both leading and trailing characters and handles Unicode code points safely', () => {
    const raw = '🚀🔥hello_world!!\n✨🎉alpha_beta??';
    const res = stripLineCharsDetailed(raw, { stripStart: 2, stripEnd: 2 });
    expect(res.text).toBe('hello_world\nalpha_beta');
    expect(res.linesModified).toBe(2);
    expect(res.totalCharsRemoved).toBe(8);
    expect(res.preview[0]).toEqual({
      lineNumber: 1,
      raw: '🚀🔥hello_world!!',
      cutPrefix: '🚀🔥',
      kept: 'hello_world',
      cutSuffix: '!!',
    });
  });

  it('supports stripping before a delimiter and keeping short lines', () => {
    const raw = 'pod-api-1 | 2026-10-30 GET /health\n---\npod-api-2 | 2026-10-30 POST /login';
    const res = stripLineCharsDetailed(raw, {
      stripBeforeDelimiter: '| ',
      stripStart: 11,
      keepShortLines: true,
    });
    expect(res.text).toBe('GET /health\n---\nPOST /login');
  });

  it('removes empty lines and trims remaining whitespace when requested', () => {
    const raw = '1234   hello  \n12\n1234   world  ';
    const res = stripLineCharsDetailed(raw, {
      stripStart: 4,
      trimRemaining: true,
      removeEmpty: true,
    });
    expect(res.text).toBe('hello\nworld');
    expect(res.emptyRemoved).toBe(1);
    expect(summarizeLineStrip(res)).toBe('3 lines in → 2 out · 20 chars removed across 3 lines, 1 empty dropped');
  });

  it('builds cross-platform CLI commands for macOS, Linux and Windows', () => {
    const cmdStartOnly = buildLineStripCommands(25, 0);
    expect(cmdStartOnly.macos).toContain('cut -c 26-');
    expect(cmdStartOnly.linux).toContain('cut -c 26-');
    expect(cmdStartOnly.windows).toContain('$_.Substring(25)');

    const cmdBoth = buildLineStripCommands(10, 4);
    expect(cmdBoth.macos).toContain('substr($0, s, e - s + 1)');
    expect(cmdBoth.windows).toContain('$_.Substring(10, $n)');
  });
});
