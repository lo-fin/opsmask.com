import { describe, expect, it } from 'vitest';
import { matchesLabels, matchesSelector, parseSelector } from './k8s-selector';

describe('parseSelector', () => {
  it('parses every operator', () => {
    expect(parseSelector('app=web, tier!=db, env in (prod,staging), track notin (canary), release, !legacy')).toEqual([
      { key: 'app', operator: 'In', values: ['web'] },
      { key: 'tier', operator: 'NotIn', values: ['db'] },
      { key: 'env', operator: 'In', values: ['prod', 'staging'] },
      { key: 'track', operator: 'NotIn', values: ['canary'] },
      { key: 'release', operator: 'Exists' },
      { key: 'legacy', operator: 'DoesNotExist' },
    ]);
  });
  it('accepts prefixed keys and ==', () => {
    expect(parseSelector('app.kubernetes.io/name==api')).toEqual([{ key: 'app.kubernetes.io/name', operator: 'In', values: ['api'] }]);
  });
  it('rejects bad input', () => {
    expect(() => parseSelector('env in (prod')).toThrow(/parentheses/);
    expect(() => parseSelector('a b c')).toThrow(/Cannot parse/);
  });
});

describe('matching', () => {
  const labels = { app: 'api', env: 'prod', version: 2 };
  it('matches equality maps, including non-string values', () => {
    expect(matchesLabels({ app: 'api', version: '2' }, labels)).toBe(true);
    expect(matchesLabels({ app: 'web' }, labels)).toBe(false);
  });
  it('treats != and notin as matching a missing label', () => {
    expect(matchesSelector({ matchExpressions: parseSelector('tier!=db') }, labels)).toBe(true);
  });
  it('empty selector matches everything, missing selector nothing', () => {
    expect(matchesSelector({}, labels)).toBe(true);
    expect(matchesSelector(undefined, labels)).toBe(false);
  });
  it('combines matchLabels and matchExpressions', () => {
    const sel = { matchLabels: { app: 'api' }, matchExpressions: parseSelector('env in (prod), !canary') };
    expect(matchesSelector(sel, labels)).toBe(true);
    expect(matchesSelector(sel, { ...labels, canary: 'true' })).toBe(false);
  });
});
