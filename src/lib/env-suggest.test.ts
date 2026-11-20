import { describe, expect, it } from 'vitest';
import {
  buildKubectlFetchCommands,
  detectSource,
  isSensitiveKey,
  keyWords,
  learnRules,
  matchKeys,
  normalizeKey,
  parseEnvInput,
  scoreKey,
  scrubSecretsInText,
  serialize,
  serializeAs,
  suggest,
  tokenize,
  valueShape,
  type EnvSample,
} from './env-suggest';
import type { Pair } from './secret-input';

describe('normalizeKey', () => {
  it('treats DB_HOST, db.host, Db__Host and db:host as equal', () => {
    expect(normalizeKey('DB_HOST')).toBe('dbhost');
    expect(normalizeKey('db.host')).toBe('dbhost');
    expect(normalizeKey('Db__Host')).toBe('dbhost');
    expect(normalizeKey('db:host')).toBe('dbhost');
    expect(normalizeKey('db-host')).toBe('dbhost');
  });
});

describe('tokenize', () => {
  it('splits on punctuation boundaries while preserving separators', () => {
    const t = tokenize('https://dev-api.internal.net:8443/v1');
    expect(t.join('')).toBe('https://dev-api.internal.net:8443/v1');
    expect(t).toContain('dev');
    expect(t).toContain('api');
    expect(t).toContain('8443');
  });
});

describe('keyWords & valueShape', () => {
  it('splits camelCase, __, ., - and deduplicates canonical synonyms', () => {
    expect(keyWords('redisConnectionUrl')).toEqual(['redis', 'url']);
    expect(keyWords('REDIS_CONNECTION_URL')).toEqual(['redis', 'url']);
    expect(keyWords('Database__Server__Address')).toEqual(['db', 'host']);
    expect(keyWords('api.secret_password')).toEqual(['api', 'pass']);
  });

  it('classifies value shapes accurately and ignores placeholders', () => {
    expect(valueShape('redis://dev-cache.internal.net:6379')).toBe('url:redis');
    expect(valueShape('https://api.example.com/v1')).toBe('url:https');
    expect(valueShape('dev-db.internal.net')).toBe('hostname');
    expect(valueShape('10.0.0.12')).toBe('ip');
    expect(valueShape('10.0.0.12:5432')).toBe('host:port');
    expect(valueShape('redis.internal.net:6379')).toBe('host:port');
    expect(valueShape('5432')).toBe('number/port');
    expect(valueShape('true')).toBe('bool');
    expect(valueShape('Host=pg.internal;Port=5432;Database=app')).toBe('connection-string');
    expect(valueShape('admin@example.com')).toBe('email');
    expect(valueShape('{"a":1}')).toBe('json');
    expect(valueShape('changeme')).toBe('empty');
    expect(valueShape('<secret>')).toBe('empty');
    expect(valueShape('')).toBe('empty');
    expect(valueShape('json')).toBe('text');
  });

  it('computes weighted Dice score for keys', () => {
    expect(scoreKey('redis_connection_url', 'REDIS_URL')).toBe(1);
    const s = scoreKey('host', 'DB_HOST');
    expect(s).toBeGreaterThanOrEqual(0.6);
    expect(s).toBeLessThanOrEqual(0.7);
  });
});

describe('matchKeys', () => {
  const sample: Pair[] = [
    ['DB_HOST', 'dev-db.internal.net'],
    ['REDIS_URL', 'redis://dev-cache.internal.net:6379'],
    ['LOG_FORMAT', 'json'],
  ];

  it('matches host -> DB_HOST, redis_connection_url -> REDIS_URL and leaves LOG_FORMAT untouched', () => {
    const input: Pair[] = [
      ['host', 'abc.net'],
      ['redis_connection_url', 'redis://123.com'],
    ];
    const m = matchKeys(input, sample);
    expect(m[0].match).toEqual({ key: 'DB_HOST', value: 'dev-db.internal.net' });
    expect(m[0].score).toBeGreaterThanOrEqual(0.55);
    expect(m[1].match).toEqual({ key: 'REDIS_URL', value: 'redis://dev-cache.internal.net:6379' });
    expect(m[1].score).toBe(1);
  });

  it('matches database_hostname, redisConnectionUrl and leaves unrelated api_key unmatched', () => {
    const input: Pair[] = [
      ['database_hostname', 'changeme'],
      ['redisConnectionUrl', 'redis://localhost:6379'],
      ['api_key', 'plain-text-value'],
    ];
    const m = matchKeys(input, sample);
    expect(m[0].match?.key).toBe('DB_HOST');
    expect(m[1].match?.key).toBe('REDIS_URL');
    expect(m[2].match).toBeUndefined();
  });

  it('enforces 1-to-1 greedy assignment when two input keys compete for DB_HOST', () => {
    const input: Pair[] = [
      ['database_host', 'db1.internal.net'],
      ['server_host', 'db2.internal.net'],
    ];
    const m = matchKeys(input, sample);
    const matched = m.filter((x) => x.match?.key === 'DB_HOST');
    expect(matched).toHaveLength(1);
    expect(m[0].match?.key).toBe('DB_HOST');
    expect(m[1].match).toBeUndefined();
  });
});

describe('learnRules', () => {
  it('learns dev -> prod from aligned values and drops conflicting tokens', () => {
    const from: Pair[] = [
      ['DB_HOST', 'dev-db.internal'],
      ['REDIS_HOST', 'dev-redis.internal'],
      ['CONFLICT_A', 'us-east-1'],
      ['CONFLICT_B', 'us-west-2'],
    ];
    const to: Pair[] = [
      ['db.host', 'prod-db.internal'],
      ['REDIS__HOST', 'prod-redis.internal'],
      ['CONFLICT_A', 'eu-east-1'],
      ['CONFLICT_B', 'ap-west-2'],
    ];
    const rules = learnRules(from, to);
    expect(rules.get('dev')).toBe('prod');
    expect(rules.has('us')).toBe(false);
  });
});

describe('detectSource & suggest', () => {
  const envs: EnvSample[] = [
    {
      id: 'dev',
      name: 'dev',
      text: [
        'DB_HOST=dev-db.internal.net',
        'REDIS_URL=redis://dev-cache.internal.net:6379',
        'LOG_FORMAT=json',
      ].join('\n'),
    },
    {
      id: 'prod',
      name: 'prod',
      text: [
        'DB_HOST=prod-db.internal.net',
        'REDIS_URL=redis://prod-cache.internal.net:6379',
        'LOG_FORMAT=json',
      ].join('\n'),
    },
  ];

  it('detects the source environment with the highest value overlap', () => {
    const input: Pair[] = [
      ['DB_HOST', 'dev-db.internal.net'],
      ['NEW_SERVICE_URL', 'https://dev-orders.internal.net'],
    ];
    expect(detectSource(input, envs, 'prod')?.id).toBe('dev');
  });

  it('produces all 5 suggestion sources (key, fuzzy, token, unchanged, review)', () => {
    const input: Pair[] = [
      ['db.host', 'dev-db.internal.net'], // 1. exact key match in staging
      ['redis_connection_url', 'redis://123.com'], // 1b. fuzzy match -> REDIS_URL
      ['QUEUE_URL', 'https://dev-queue.internal.net'], // 2. token substitution (dev -> stg)
      ['LOG_FORMAT', 'json'], // 3. unchanged across dev & prod
      ['API_SECRET', 'random-opaque-value-xyz'], // 4. review
    ];

    const envsWithStaging: EnvSample[] = [
      ...envs,
      {
        id: 'staging',
        name: 'staging',
        text: 'DB_HOST=stg-db.internal.net\nREDIS_URL=redis://stg-cache.internal.net:6379',
      },
    ];

    const res = suggest(input, envsWithStaging, 'staging');
    expect(res[0]).toMatchObject({ key: 'db.host', value: 'stg-db.internal.net', source: 'key' });
    expect(res[1]).toMatchObject({
      key: 'redis_connection_url',
      value: 'redis://stg-cache.internal.net:6379',
      source: 'fuzzy',
      matchedKey: 'REDIS_URL',
    });
    expect(res[2]).toMatchObject({
      key: 'QUEUE_URL',
      value: 'https://stg-queue.internal.net',
      source: 'token',
      note: 'dev→stg',
    });
    expect(res[3]).toMatchObject({ key: 'LOG_FORMAT', value: 'json', source: 'unchanged' });
    expect(res[4]).toMatchObject({ key: 'API_SECRET', value: 'random-opaque-value-xyz', source: 'review', secret: true });
  });

  it('applies environment name token rule when no other sample keys overlap', () => {
    const minimalEnvs: EnvSample[] = [
      { id: '1', name: 'dev', text: 'PORT=3000' },
      { id: '2', name: 'prod', text: 'PORT=8080' },
    ];
    const res = suggest([['AUTH_ISSUER', 'https://dev.auth.example.com']], minimalEnvs, '2');
    expect(res[0]).toMatchObject({
      key: 'AUTH_ISSUER',
      value: 'https://prod.auth.example.com',
      source: 'token',
      note: 'dev→prod',
    });
  });
});

describe('Kubernetes ConfigMap & Secret parsing + security helpers', () => {
  it('parses a Kubernetes List with ConfigMap and Base64 Secret, ignoring system secrets', () => {
    const k8sListYaml = `
apiVersion: v1
kind: List
items:
  - apiVersion: v1
    kind: ConfigMap
    metadata:
      name: app-cm
      namespace: brand
    data:
      DB_HOST: prod-pg.internal.net
      LOG_FORMAT: json
  - apiVersion: v1
    kind: Secret
    metadata:
      name: app-secret
    type: Opaque
    data:
      DB_PASSWORD: ${Buffer.from('super-secret-prod').toString('base64')}
  - apiVersion: v1
    kind: Secret
    metadata:
      name: default-token
    type: kubernetes.io/service-account-token
    data:
      token: ${Buffer.from('ignore-me').toString('base64')}
`;
    const parsed = parseEnvInput(k8sListYaml);
    expect(parsed.format).toBe('Kubernetes (1 ConfigMap, 1 Secret)');
    expect(parsed.detectedNamespace).toBe('brand');
    expect(parsed.pairs).toEqual([
      ['DB_HOST', 'prod-pg.internal.net'],
      ['LOG_FORMAT', 'json'],
      ['DB_PASSWORD', 'super-secret-prod'],
    ]);
    expect(parsed.secretKeys.has('DB_PASSWORD')).toBe(true);
    expect(parsed.secretKeys.has('DB_HOST')).toBe(false);
  });

  it('identifies sensitive keys and scrubs them before saving when requested', () => {
    expect(isSensitiveKey('DB_PASSWORD', '123')).toBe(true);
    expect(isSensitiveKey('STRIPE_API_KEY', 'sk_live_123')).toBe(true);
    expect(isSensitiveKey('DATABASE_URL', 'postgres://app:my-pass@db.internal:5432/app')).toBe(true);
    expect(isSensitiveKey('DB_HOST', 'db.internal')).toBe(false);

    const raw = 'DB_HOST=prod-db.internal\nDB_PASSWORD=real-secret';
    expect(scrubSecretsInText(raw)).toBe('DB_HOST=prod-db.internal\nDB_PASSWORD=<secret>');

    const k8sList = `apiVersion: v1
kind: List
items:
  - apiVersion: v1
    kind: ConfigMap
    metadata:
      name: billing-config
      namespace: prod
    data:
      DB_HOST: prod-pg.internal.net
  - apiVersion: v1
    kind: Secret
    metadata:
      name: billing-secrets
      namespace: prod
    type: Opaque
    data:
      DB_PASSWORD: ${Buffer.from('real-secret').toString('base64')}`;
    const scrubbedList = scrubSecretsInText(k8sList);
    expect(scrubbedList).toContain('kind: List');
    expect(scrubbedList).toContain('DB_HOST: prod-pg.internal.net');
    expect(scrubbedList).toContain(`DB_PASSWORD: ${Buffer.from('<secret>').toString('base64')}`);
  });

  it('builds kubectl fetch commands with OS clipboard pipe and install hints, and exports K8s ConfigMap / Secret YAML', () => {
    const mac = buildKubectlFetchCommands('brand', 'macos', true);
    expect(mac.commands[0].cmd).toBe('kubectl get configmap,secret -n brand -o yaml | pbcopy');
    expect(mac.install[0][0]).toContain('brew install kubectl jq');

    const linux = buildKubectlFetchCommands('brand', 'linux', true);
    expect(linux.commands[0].cmd).toBe('kubectl get configmap,secret -n brand -o yaml | xclip -selection clipboard');
    expect(linux.install.map((i) => i[0]).join('\n')).toContain('xclip');

    const win = buildKubectlFetchCommands('brand', 'windows', true);
    expect(win.commands[0].cmd).toBe('kubectl get configmap,secret -n brand -o yaml | Set-Clipboard');

    const raw = buildKubectlFetchCommands('brand', 'macos', false);
    expect(raw.commands[0].cmd).toBe('kubectl get configmap,secret -n brand -o yaml');

    const vals = new Map([
      ['DB_HOST', 'prod-db.internal'],
      ['DB_PASSWORD', 's3cr3t'],
    ]);
    const cmYaml = serializeAs('k8s-cm', '.env', '', vals, { name: 'my-cm', namespace: 'prod' });
    expect(cmYaml).toContain('kind: ConfigMap');
    expect(cmYaml).toContain('DB_HOST: prod-db.internal');

    const secB64 = serializeAs('k8s-secret-b64', '.env', '', vals, { name: 'my-sec', namespace: 'prod' });
    expect(secB64).toContain('kind: Secret');
    expect(secB64).toContain(`DB_PASSWORD: ${Buffer.from('s3cr3t').toString('base64')}`);
  });

  it('auto-decodes bare KEY: Base64 Kubernetes Secret snippets and re-encodes on match-input export', () => {
    const snippet = `  Blob__AccessTier: Q29vbA==
  Blob__AccountUrl: aHR0cHM6Ly9zdGJyYW5kc2FuZGJveDAwMDIuYmxvYi5jb3JlLndpbmRvd3MubmV0`;
    const parsed = parseEnvInput(snippet);
    expect(parsed.format).toBe('YAML (Secret Base64)');
    expect(parsed.pairs).toEqual([
      ['Blob__AccessTier', 'Cool'],
      ['Blob__AccountUrl', 'https://stbrandsandbox0002.blob.core.windows.net'],
    ]);
    expect(parsed.secretKeys.has('Blob__AccessTier')).toBe(true);

    const updated = new Map<string, string>([
      ['Blob__AccessTier', 'Hot'],
      ['Blob__AccountUrl', 'https://stbrandprod0001.blob.core.windows.net'],
    ]);
    const serialized = serialize(parsed.format, snippet, updated);
    expect(serialized).toBe(
      `  Blob__AccessTier: ${Buffer.from('Hot').toString('base64')}\n  Blob__AccountUrl: ${Buffer.from('https://stbrandprod0001.blob.core.windows.net').toString('base64')}`,
    );
  });
});

describe('serialize', () => {
  it('preserves .env comments, export prefixes, line order and quoting', () => {
    const original = [
      '# Database settings',
      'export DB_HOST=dev-db.internal # main db',
      'GREETING="hello dev world"',
      'UNCHANGED=123',
    ].join('\n');
    const values = new Map([
      ['DB_HOST', 'prod-db.internal'],
      ['GREETING', 'hello prod world'],
      ['UNCHANGED', '123'],
    ]);
    expect(serialize('.env', original, values)).toBe(
      [
        '# Database settings',
        'export DB_HOST=prod-db.internal # main db',
        'GREETING="hello prod world"',
        'UNCHANGED=123',
      ].join('\n'),
    );
  });

  it('unflattens A__B keys when serializing nested JSON', () => {
    const values = new Map([
      ['Database__Host', 'prod-db.internal'],
      ['Database__Port', '5432'],
      ['AllowedHosts', '*'],
    ]);
    const out = JSON.parse(serialize('JSON (.NET appsettings)', '{}', values));
    expect(out).toEqual({
      Database: {
        Host: 'prod-db.internal',
        Port: '5432',
      },
      AllowedHosts: '*',
    });
  });

  it('updates flat YAML values in place', () => {
    const original = 'db_host: dev-db.internal # comment\nlog_level: debug';
    const values = new Map([
      ['db_host', 'prod-db.internal'],
      ['log_level', 'info'],
    ]);
    expect(serialize('YAML', original, values)).toBe(
      'db_host: prod-db.internal # comment\nlog_level: info',
    );
  });
});
