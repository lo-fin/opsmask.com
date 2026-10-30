import { describe, expect, it } from 'vitest';
import { formatBytes, formatBytesDecimal, formatCpu, parseQuantity } from './k8s-quantity';

describe('parseQuantity', () => {
  it.each([
    ['500m', 0.5],
    ['2', 2],
    [2, 2],
    ['1.5Gi', 1.5 * 2 ** 30],
    ['512Mi', 512 * 2 ** 20],
    ['1G', 1e9],
    ['2e3', 2000],
    ['1E', 1e18],
    ['128m', 0.128],
  ])('%s', (q, expected) => {
    expect(parseQuantity(q)).toBeCloseTo(expected);
  });

  it.each(['abc', '1GB', '1K', '', undefined, null, {}])('rejects %s', (q) => {
    expect(parseQuantity(q)).toBeNull();
  });
});

describe('formatting', () => {
  it('shows CPU like kubectl', () => {
    expect(formatCpu(0.25)).toBe('250m');
    expect(formatCpu(2)).toBe('2');
  });
  it('uses binary and decimal suffixes', () => {
    expect(formatBytes(1.5 * 2 ** 30)).toBe('1.5Gi');
    expect(formatBytesDecimal(1.5e9)).toBe('1.5G');
    expect(formatBytes(100)).toBe('100');
  });
});
