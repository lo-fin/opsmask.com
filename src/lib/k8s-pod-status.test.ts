import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { diagnose, fromDescribe, parsePods } from './k8s-pod-status';
import { CONFIG_ERROR_YAML, CRASH_OOM, IMAGE_PULL, LIVENESS, PENDING } from './k8s-pod-status.samples';

const loadAll = (t: string) => yaml.loadAll(t);
const report = (text: string) => diagnose(parsePods(text, loadAll)[0]);
const titles = (text: string) => report(text).diagnoses.map((d) => d.title);

describe('fromDescribe', () => {
  const pod = fromDescribe(CRASH_OOM);
  it('reads pod fields, container states and events', () => {
    expect(pod).toMatchObject({ name: 'api-7d9c8b6f5-2kq9x', namespace: 'prod', phase: 'Running', owner: 'ReplicaSet/api-7d9c8b6f5' });
    expect(pod.containers[0]).toMatchObject({
      name: 'api', image: 'myregistry.azurecr.io/api:1.4.2', ready: false, restarts: 6,
      state: { kind: 'waiting', reason: 'CrashLoopBackOff' },
      last: { kind: 'terminated', reason: 'OOMKilled', exitCode: 137 },
    });
    expect(pod.events.map((e) => e.reason)).toEqual(['Scheduled', 'Pulled', 'BackOff']);
    expect(pod.events[1].age).toBe('8m (x5 over 10m)');
  });
  it('ignores Limits and Environment blocks inside a container', () => {
    expect(pod.containers).toHaveLength(1);
    expect(pod.containers[0].state?.message).toBeUndefined();
  });
  it('reads conditions', () => {
    expect(fromDescribe(PENDING).conditions).toEqual([{ type: 'PodScheduled', status: 'False' }]);
  });
});

describe('diagnose', () => {
  it('explains OOMKilled with the previous logs command', () => {
    const r = report(CRASH_OOM);
    expect(r.summary).toBe('Running · CrashLoopBackOff');
    expect(r.diagnoses[0].title).toMatch(/OOMKilled/);
    expect(r.diagnoses[0].next[0]).toBe('kubectl logs api-7d9c8b6f5-2kq9x -n prod -c api --previous');
  });

  it('tells a missing tag from other pull errors', () => {
    expect(titles(IMAGE_PULL)[0]).toMatch(/Image not found: myregistry.azurecr.io\/web:1.4.3/);
    const denied = IMAGE_PULL.replace(/rpc error.*$/m, 'failed to authorize: 401 Unauthorized');
    expect(titles(denied)[0]).toMatch(/Registry refused/);
  });

  it('splits scheduler messages into causes', () => {
    const t = titles(PENDING);
    expect(t).toContain('Not enough cpu on any node');
    expect(t).toContain('Nodes are tainted');
    expect(report(PENDING).diagnoses.find((d) => d.title === 'Nodes are tainted')!.detail).toContain('dedicated: gpu');
  });

  it('recognises a liveness kill and suggests a startupProbe', () => {
    const d = report(LIVENESS).diagnoses[0];
    expect(d.title).toMatch(/liveness probe failed/);
    expect(d.detail).toMatch(/startupProbe/);
  });

  it('names the missing Secret from YAML input', () => {
    const d = report(CONFIG_ERROR_YAML).diagnoses[0];
    expect(d.title).toMatch(/configuration error/);
    expect(d.detail).toContain('secret “api-secrets”');
  });

  it('explains evictions, exit code 0 in a Deployment, and stuck termination', () => {
    const evicted = yaml.dump({ kind: 'Pod', metadata: { name: 'p' }, status: { phase: 'Failed', reason: 'Evicted', message: 'The node was low on resource: ephemeral-storage.' } });
    expect(titles(evicted)[0]).toBe('Evicted because the node ran low on ephemeral-storage');

    const exit0 = yaml.dump({ kind: 'Pod', metadata: { name: 'p' }, status: { phase: 'Running', containerStatuses: [{ name: 'c', restartCount: 4, state: { waiting: { reason: 'CrashLoopBackOff' } }, lastState: { terminated: { exitCode: 0, reason: 'Completed' } } }] } });
    expect(titles(exit0)[0]).toMatch(/exits with code 0/);

    const stuck = yaml.dump({ kind: 'Pod', metadata: { name: 'p', deletionTimestamp: '2026-10-30T00:00:00Z', finalizers: ['example.com/cleanup'] }, status: { phase: 'Running' } });
    expect(report(stuck).diagnoses[0].detail).toContain('example.com/cleanup');
  });

  it('does not report init containers that completed', () => {
    const ok = yaml.dump({ kind: 'Pod', metadata: { name: 'p' }, status: { phase: 'Running',
      initContainerStatuses: [{ name: 'migrate', restartCount: 1, state: { terminated: { exitCode: 0, reason: 'Completed' } } }],
      containerStatuses: [{ name: 'c', ready: true, restartCount: 0, state: { running: {} } }] } });
    expect(report(ok).diagnoses[0].severity).toBe('ok');
  });

  it('reads several pods from one describe output and from a List', () => {
    expect(parsePods(`${CRASH_OOM}\n${IMAGE_PULL}`, loadAll).map((p) => p.name)).toEqual(['api-7d9c8b6f5-2kq9x', 'web-5c9d4b7f8-qq1z']);
    const list = yaml.dump({ kind: 'List', items: [yaml.load(CONFIG_ERROR_YAML), yaml.load(CONFIG_ERROR_YAML)] });
    expect(parsePods(list, loadAll)).toHaveLength(2);
  });

  it('rejects input that is not a pod', () => {
    expect(() => parsePods('kind: Service\nmetadata: { name: x }', loadAll)).toThrow(/No pod found/);
  });
});

describe('scheduler resource names', () => {
  it('keeps dotted resource names and drops the sentence full stop', () => {
    const msg = PENDING.replace('2 Insufficient cpu.', '2 Insufficient nvidia.com/gpu, 1 Insufficient memory.');
    expect(titles(msg)).toContain('Not enough nvidia.com/gpu and memory on any node');
  });
});
