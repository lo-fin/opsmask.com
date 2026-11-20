import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { generate, type SaOptions } from './k8s-sa';

const base: SaOptions = { name: 'ci-deployer', namespace: 'prod', scope: 'namespace', preset: 'deploy', token: 'short', duration: '24h' };

describe('generate', () => {
  it('creates a Role and RoleBinding for a namespace preset', () => {
    const kinds = yaml.loadAll(generate(base).manifests).map((d: any) => d.kind);
    expect(kinds).toEqual(['ServiceAccount', 'Role', 'RoleBinding']);
  });

  it('binds built-in roles cluster-wide without creating a role, and adds the token Secret', () => {
    const r = generate({ ...base, preset: 'view', scope: 'cluster', token: 'long' });
    const docs = yaml.loadAll(r.manifests) as any[];
    expect(docs.map((d) => d.kind)).toEqual(['ServiceAccount', 'ClusterRoleBinding', 'Secret']);
    expect(docs[1].roleRef).toMatchObject({ kind: 'ClusterRole', name: 'view' });
    expect(docs[1].metadata.name).toBe('prod-ci-deployer');
    expect(r.warnings.join(' ')).toMatch(/never expires/);
    expect(r.cleanup).toMatch(/delete secret ci-deployer-token -n prod/);
  });

  it('validates input', () => {
    expect(() => generate({ ...base, name: 'Bad Name' })).toThrow(/Service account name/);
    expect(() => generate({ ...base, namespace: 'a'.repeat(64) })).toThrow(/Namespace/);
    expect(() => generate({ ...base, duration: '1 day' })).toThrow(/Duration/);
    expect(() => generate({ ...base, preset: 'custom', customRules: '- resources: [pods]' })).toThrow(/no verbs/);
  });

  it('quotes the context in the script and the cleanup commands', () => {
    const r = generate({ ...base, context: "aks-prod's" });
    expect(r.script).toContain(`CONTEXT='aks-prod'\\''s'`);
    expect(r.cleanup).toContain(`kubectl --context 'aks-prod'\\''s' delete`);
  });
});

// Runs the generated script against a fake kubectl, so no cluster is needed.
const FAKE_KUBECTL = `#!/usr/bin/env bash
args=("$@")
if [ "\${args[0]}" = "--context" ]; then args=("\${args[@]:2}"); fi
cmd="\${args[*]}"
case "$cmd" in
  "config current-context") echo "test-ctx" ;;
  *"jsonpath={.clusters[0].name}"*) echo -n "test-cluster" ;;
  *"jsonpath={.clusters[0].cluster.server}"*) echo -n "https://api.example.com:443" ;;
  *"certificate-authority-data}"*) echo -n "Q0EtREFUQQ==" ;;
  "get namespace prod") ;;
  "get namespace"*) exit 1 ;;
  "apply -f -") cat > "$WORK/applied.yaml" ;;
  "create token"*) echo "short-token" ;;
  "get secret"*) n=$(cat "$WORK/polls" 2>/dev/null || echo 0); echo $((n + 1)) > "$WORK/polls"; [ "$n" -ge 2 ] && echo -n "bG9uZy10b2tlbg==" ;;
  "--kubeconfig"*) echo "can-i ok" ;;
  *) echo "unexpected: $cmd" >&2; exit 9 ;;
esac
`;

function runScript(opts: SaOptions, env: Record<string, string> = {}, input = '') {
  const work = mkdtempSync(join(tmpdir(), 'opsmask-sa-'));
  writeFileSync(join(work, 'kubectl'), FAKE_KUBECTL);
  chmodSync(join(work, 'kubectl'), 0o755);
  writeFileSync(join(work, 'create.sh'), generate(opts).script);
  const res = spawnSync('bash', ['create.sh'], {
    cwd: work, input, encoding: 'utf8',
    env: { ...process.env, PATH: `${work}:${process.env.PATH}`, WORK: work, ...env },
  });
  return { ...res, work };
}

describe.skipIf(process.platform === 'win32')('generated script', () => {
  it('is valid bash', () => {
    const work = mkdtempSync(join(tmpdir(), 'opsmask-sa-'));
    writeFileSync(join(work, 's.sh'), generate(base).script);
    expect(() => execFileSync('bash', ['-n', join(work, 's.sh')])).not.toThrow();
  });

  it('writes a private kubeconfig with a short-lived token', () => {
    const r = runScript(base, { YES: '1' });
    expect(r.status, r.stderr).toBe(0);
    const file = join(r.work, 'ci-deployer.kubeconfig');
    const cfg = yaml.load(readFileSync(file, 'utf8')) as any;
    expect(cfg['current-context']).toBe('ci-deployer@test-cluster');
    expect(cfg.users[0].user.token).toBe('short-token');
    expect(cfg.clusters[0].cluster).toEqual({ server: 'https://api.example.com:443', 'certificate-authority-data': 'Q0EtREFUQQ==' });
    expect(spawnSync('stat', process.platform === 'darwin' ? ['-f', '%Lp', file] : ['-c', '%a', file], { encoding: 'utf8' }).stdout.trim()).toBe('600');
    expect((yaml.loadAll(readFileSync(join(r.work, 'applied.yaml'), 'utf8')) as any[]).map((d) => d.kind)).toEqual(['ServiceAccount', 'Role', 'RoleBinding']);
  });

  it('waits for a long-lived token to be filled in', () => {
    const r = runScript({ ...base, token: 'long' }, { YES: '1' });
    expect(r.status, r.stderr).toBe(0);
    expect((yaml.load(readFileSync(join(r.work, 'ci-deployer.kubeconfig'), 'utf8')) as any).users[0].user.token).toBe('long-token');
  });

  it('stops when the user does not confirm, or the namespace is missing', () => {
    expect(runScript(base, {}, 'n\n').stdout).toContain('Cancelled.');
    const missing = runScript({ ...base, namespace: 'nope' }, { YES: '1' });
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain('Namespace nope does not exist.');
  });
});
