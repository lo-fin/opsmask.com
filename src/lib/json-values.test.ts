import { describe, expect, it } from 'vitest';
import { extractJsonValues } from './json-values';

describe('extractJsonValues', () => {
  it('extracts flat and nested values in dot mode by default', () => {
    const json = `{
      // Database config
      "host": "db.internal",
      "port": 5432,
      "ssl": true,
      "empty": null,
      "credentials": {
        "username": "admin",
        "password": "s3cr3t-value",
      },
      "replicas": ["10.0.0.1", "10.0.0.2"]
    }`;
    const res = extractJsonValues(json);
    expect(res.hasNested).toBe(true);
    expect(res.items).toEqual([
      { key: 'host', value: 'db.internal', type: 'string' },
      { key: 'port', value: '5432', type: 'number' },
      { key: 'ssl', value: 'true', type: 'boolean' },
      { key: 'empty', value: '', type: 'null' },
      { key: 'credentials.username', value: 'admin', type: 'string' },
      { key: 'credentials.password', value: 's3cr3t-value', type: 'string' },
      { key: 'replicas[0]', value: '10.0.0.1', type: 'string' },
      { key: 'replicas[1]', value: '10.0.0.2', type: 'string' },
    ]);
  });

  it('supports env (__) and top-level flatten modes', () => {
    const json = JSON.stringify({
      'ConnectionStrings:Default': 'Server=tcp:sql',
      auth: { token: 'abc' },
      ports: [80, 443],
    });
    const envRes = extractJsonValues(json, { mode: 'env' });
    expect(envRes.items).toEqual([
      { key: 'ConnectionStrings__Default', value: 'Server=tcp:sql', type: 'string' },
      { key: 'auth__token', value: 'abc', type: 'string' },
      { key: 'ports__0', value: '80', type: 'number' },
      { key: 'ports__1', value: '443', type: 'number' },
    ]);

    const topRes = extractJsonValues(json, { mode: 'top' });
    expect(topRes.items).toEqual([
      { key: 'ConnectionStrings:Default', value: 'Server=tcp:sql', type: 'string' },
      { key: 'auth', value: '{"token":"abc"}', type: 'json' },
      { key: 'ports', value: '[80,443]', type: 'json' },
    ]);
  });

  it('unwraps embedded JSON strings such as AWS SecretString when enabled', () => {
    const raw = JSON.stringify({
      Name: 'prod/api',
      SecretString: JSON.stringify({ API_KEY: 'live_123', WEBHOOK_SECRET: 'whsec_456' }),
    });
    const unwrapped = extractJsonValues(raw, { unwrapJsonStrings: true });
    expect(unwrapped.items).toEqual([
      { key: 'Name', value: 'prod/api', type: 'string' },
      { key: 'SecretString.API_KEY', value: 'live_123', type: 'string' },
      { key: 'SecretString.WEBHOOK_SECRET', value: 'whsec_456', type: 'string' },
    ]);
    expect(unwrapped.notes[0]).toMatch(/embedded JSON/);

    const kept = extractJsonValues(raw, { unwrapJsonStrings: false });
    expect(kept.items).toHaveLength(2);
    expect(kept.items[1].key).toBe('SecretString');
  });

  it('unwraps a top-level quoted JSON string', () => {
    const quoted = JSON.stringify(JSON.stringify({ token: 'xyz' }));
    const res = extractJsonValues(quoted);
    expect(res.items).toEqual([{ key: 'token', value: 'xyz', type: 'string' }]);
    expect(res.notes[0]).toMatch(/Unwrapped quoted/);
  });

  it('throws on invalid JSON', () => {
    expect(() => extractJsonValues('{broken')).toThrow(/Invalid JSON/);
  });
});
