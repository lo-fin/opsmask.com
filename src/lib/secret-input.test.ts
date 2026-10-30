import { describe, expect, it } from 'vitest';
import { checkPairs, parseSecretInput, stripJsonComments } from './secret-input';

describe('.env', () => {
  it('handles export, quotes, escapes and inline comments', () => {
    const r = parseSecretInput(`# comment
export DB_USER=app
DB_PASSWORD="pa#ss \\"q\\"" # trailing
PLAIN=abc # c`);
    expect(r.format).toBe('.env');
    expect(r.pairs).toEqual([['DB_USER', 'app'], ['DB_PASSWORD', 'pa#ss "q"'], ['PLAIN', 'abc']]);
  });
  it('reads quoted values over several lines', () => {
    const r = parseSecretInput(`KEY="-----BEGIN PRIVATE KEY-----\nMIIEv\n-----END PRIVATE KEY-----"\nNEXT=1`);
    expect(r.pairs).toEqual([['KEY', '-----BEGIN PRIVATE KEY-----\nMIIEv\n-----END PRIVATE KEY-----'], ['NEXT', '1']]);
  });
  it('reports an unterminated quote', () => {
    expect(() => parseSecretInput('K="abc\nX=1')).toThrow(/missing closing/);
  });
  it('reads docker-compose lists', () => {
    expect(parseSecretInput('- A=1\n- B=x=y').pairs).toEqual([['A', '1'], ['B', 'x=y']]);
  });
});

describe('JSON', () => {
  it('reads AWS Secrets Manager and Vault KV v2 output', () => {
    const aws = parseSecretInput(JSON.stringify({ Name: 'prod/db', SecretString: JSON.stringify({ username: 'u' }) }));
    expect(aws.format).toMatch(/AWS/);
    expect(aws.pairs).toEqual([['username', 'u']]);
    const plain = parseSecretInput(JSON.stringify({ Name: 'prod/token', SecretString: 'abc' }));
    expect(plain.pairs).toEqual([['token', 'abc']]);
    const vault = parseSecretInput(JSON.stringify({ data: { data: { api_key: 'k' } } }));
    expect(vault.pairs).toEqual([['api_key', 'k']]);
  });

  it('refuses a Secret, which belongs in Decode', () => {
    expect(() => parseSecretInput('{"kind":"Secret","data":{}}')).toThrow(/already a Secret/);
  });
});

describe('.NET', () => {
  const appsettings = `{
  // comment
  "Urls": "http://10.0.0.1:6869",
  "ConnectionStrings": { "Db": "Server=db;Password=x//y;" /* prod */ },
  "Logging:LogLevel:Default": "Warning",
  "AllowedOrigins": ["https://a", "https://b"],
}`;

  it('strips comments and trailing commas but not // inside strings', () => {
    expect(JSON.parse(stripJsonComments(appsettings)).ConnectionStrings.Db).toBe('Server=db;Password=x//y;');
  });

  it('flattens appsettings with __ by default, including arrays and colon keys', () => {
    const r = parseSecretInput(appsettings);
    expect(r.format).toMatch(/\.NET appsettings/);
    expect(r.nested).toBe(true);
    expect(r.pairs).toEqual([
      ['Urls', 'http://10.0.0.1:6869'],
      ['ConnectionStrings__Db', 'Server=db;Password=x//y;'],
      ['Logging__LogLevel__Default', 'Warning'],
      ['AllowedOrigins__0', 'https://a'],
      ['AllowedOrigins__1', 'https://b'],
    ]);
  });

  it('supports the other nested modes', () => {
    expect(parseSecretInput(appsettings, { nested: 'dot' }).pairs[1]).toEqual(['ConnectionStrings.Db', 'Server=db;Password=x//y;']);
    expect(parseSecretInput(appsettings, { nested: 'json' }).pairs[1]).toEqual(['ConnectionStrings', '{"Db":"Server=db;Password=x//y;"}']);
    const file = parseSecretInput(appsettings, { nested: 'file' });
    expect(file.pairs).toHaveLength(1);
    expect(file.pairs[0][0]).toBe('appsettings.json');
  });

  it('reads Azure Functions local.settings.json', () => {
    const r = parseSecretInput(JSON.stringify({
      IsEncrypted: false,
      Values: { AzureWebJobsStorage: 'UseDevelopmentStorage=true', FUNCTIONS_WORKER_RUNTIME: 'dotnet-isolated', 'A:B:C': 515 },
      Host: { LocalHttpPort: 7071 },
    }));
    expect(r.format).toMatch(/Azure Functions/);
    expect(r.pairs).toEqual([['AzureWebJobsStorage', 'UseDevelopmentStorage=true'], ['FUNCTIONS_WORKER_RUNTIME', 'dotnet-isolated'], ['A__B__C', '515']]);
    expect(r.notes?.join(' ')).toMatch(/Azurite/);
    expect(r.notes?.join(' ')).toMatch(/Host section/);
    expect(() => parseSecretInput('{"IsEncrypted": true, "Values": {"x": "y"}}')).toThrow(/func settings decrypt/);
  });
});

describe('YAML', () => {
  it('reads maps and compose environment blocks', () => {
    expect(parseSecretInput('A: 1\nB: two').pairs).toEqual([['A', '1'], ['B', 'two']]);
    expect(parseSecretInput('environment:\n  - A=1').format).toMatch(/docker-compose/);
    expect(parseSecretInput('db:\n  host: x').pairs).toEqual([['db__host', 'x']]);
  });
  it('rejects plain text', () => {
    expect(() => parseSecretInput('just some text')).toThrow(/Expected/);
  });
});

describe('checkPairs', () => {
  const levels = (pairs: [string, string][]) => checkPairs(pairs).map((i) => `${i.level}:${i.key}`);
  it('flags invalid keys, duplicates, empty values and whitespace', () => {
    expect(levels([['MY KEY', '1'], ['A', '1'], ['A', '2'], ['E', ''], ['S', 'x ']])).toEqual(['error:MY KEY', 'warn:A', 'warn:E', 'warn:S']);
  });
  it('allows a trailing newline on multi-line values', () => {
    expect(checkPairs([['CERT', 'line1\nline2\n']])).toEqual([]);
  });
  it('enforces the 1 MiB Secret limit after Base64', () => {
    expect(levels([['big', 'x'.repeat(800_000)]])).toEqual(['error:']);
  });
});
