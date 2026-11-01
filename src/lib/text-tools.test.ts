import { describe, expect, it } from 'vitest';
import { convertCases, convertEscapes, diffLines, getTextStats, transformLines } from './text-tools';

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
