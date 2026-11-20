import { describe, expect, it } from 'vitest';
import { calculateEntropyBits, generatePassword, generatePasswords, generateUuids } from './generators';

describe('generatePasswords & secret modes', () => {
  it('generates passwords of the requested length containing each enabled pool', () => {
    const pwd = generatePassword({
      length: 24,
      uppercase: true,
      lowercase: true,
      digits: true,
      symbols: true,
    });
    expect(pwd).toHaveLength(24);
    expect(pwd).toMatch(/[A-Z]/);
    expect(pwd).toMatch(/[a-z]/);
    expect(pwd).toMatch(/[0-9]/);
    expect(pwd).toMatch(/[^A-Za-z0-9]/);
  });

  it('respects excludeAmbiguous and safeSymbolsOnly', () => {
    const list = generatePasswords({
      length: 32,
      count: 10,
      excludeAmbiguous: true,
      safeSymbolsOnly: true,
    });
    expect(list).toHaveLength(10);
    for (const p of list) {
      expect(p).not.toMatch(/[0O1lI]/);
      expect(p).toMatch(/^[A-Za-z2-9\-_.~]+$/);
    }
  });

  it('supports hex, base64, base64url, api-key and passphrase modes', () => {
    const hex = generatePassword({ mode: 'hex', length: 32 });
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
    expect(calculateEntropyBits({ mode: 'hex', length: 32 })).toBe(256);

    const b64url = generatePassword({ mode: 'base64url', length: 32 });
    expect(b64url).toMatch(/^[A-Za-z0-9_-]+$/);

    const apiKey = generatePassword({ mode: 'api-key', length: 24, prefix: 'whsec_' });
    expect(apiKey).toMatch(/^whsec_[A-Za-z0-9]{24}$/);

    const phrase = generatePassword({ mode: 'passphrase', length: 24, wordCount: 4, wordSeparator: '-' });
    expect(phrase.split('-')).toHaveLength(5); // 4 words + 2-digit number
  });

  it('calculates entropy bits and throws if no charset is enabled', () => {
    expect(calculateEntropyBits({ length: 20, uppercase: false, lowercase: false, digits: true, symbols: false })).toBe(66);
    expect(() =>
      generatePassword({ length: 16, uppercase: false, lowercase: false, digits: false, symbols: false }),
    ).toThrow(/Select at least one/);
  });
});

describe('generateUuids (UUID v4, v7, ULID, NanoID, K8s)', () => {
  it('generates valid RFC 9562 UUID v4 and v7 values', () => {
    const v4s = generateUuids({ version: 'v4', count: 5 });
    expect(v4s).toHaveLength(5);
    for (const u of v4s) {
      expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }

    const v7s = generateUuids({ version: 'v7', count: 5 });
    for (const u of v7s) {
      expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
    expect([...v7s].sort()).toEqual(v7s);
  });

  it('generates sortable 26-char ULIDs, NanoIDs and K8s names', () => {
    const ulids = generateUuids({ version: 'ulid', count: 5 });
    for (const u of ulids) {
      expect(u).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    }

    const nanoids = generateUuids({ version: 'nanoid', count: 3, nanoidLength: 16 });
    for (const n of nanoids) {
      expect(n).toHaveLength(16);
    }

    const k8s = generateUuids({ version: 'k8s', count: 3 });
    for (const k of k8s) {
      expect(k).toMatch(/^[a-z0-9]+-[a-z0-9]+-[a-z0-9]{5}$/);
    }
  });

  it('formats without hyphens, uppercase and braces', () => {
    const [u] = generateUuids({ version: 'v4', count: 1, hyphens: false, uppercase: true, braces: true });
    expect(u).toMatch(/^\{[0-9A-F]{32}\}$/);

    const [nil] = generateUuids({ version: 'nil' });
    expect(nil).toBe('00000000-0000-0000-0000-000000000000');
  });
});
