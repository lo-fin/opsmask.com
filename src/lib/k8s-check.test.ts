import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { checkManifests, podSecurityLevel, RULES } from './k8s-check';

const check = (text: string, ignore: string[] = []) => checkManifests(yaml.loadAll(text), { ignore });
const rules = (text: string) => check(text).findings.map((f) => f.rule);

const deployment = (extra = '', container = '') => `
apiVersion: apps/v1
kind: Deployment
metadata: { name: api, namespace: prod }
spec:
  replicas: 1
  selector: { matchLabels: { app: api } }
  template:
    metadata: { labels: { app: api } }
    spec:
${extra}
      containers:
        - name: api
          image: api:1.2.3
          ports: [{ name: http, containerPort: 8080 }]
${container}`;

describe('checkManifests', () => {
  it('every rule has an entry in the catalogue', () => {
    const all = check(`
apiVersion: v1
kind: Pod
metadata: { name: p }
spec:
  hostNetwork: true
  containers: [{ name: c, image: x }]
`).findings;
    const ids = new Set(RULES.map((r) => r.id));
    for (const f of all) expect(ids.has(f.rule)).toBe(true);
  });

  it('does not ask cluster-scoped objects for a namespace', () => {
    const r = rules(`
apiVersion: v1
kind: PersistentVolume
metadata: { name: pv }
---
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata: { name: fast }
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata: { name: r }
rules: []
`);
    expect(r).not.toContain('no-namespace');
  });

  it('treats a non-zero runAsUser as non-root', () => {
    expect(rules(deployment('      securityContext: { runAsUser: 1000 }'))).not.toContain('run-as-root');
    expect(rules(deployment('      securityContext: { runAsUser: 0 }'))).toContain('run-as-root');
  });

  it('accepts limits without requests, since requests default to limits', () => {
    const r = rules(deployment('', '          resources: { limits: { cpu: 500m, memory: 256Mi } }'));
    expect(r).not.toContain('no-requests');
    expect(r).not.toContain('no-memory-limit');
  });

  it('flags a request above its limit', () => {
    const f = check(deployment('', '          resources: { requests: { memory: 1Gi }, limits: { memory: 512Mi } }')).findings;
    expect(f.find((x) => x.rule === 'request-over-limit')?.severity).toBe('error');
  });

  it('flags a selector that does not match the pod labels', () => {
    expect(rules(deployment().replace('labels: { app: api }', 'labels: { app: apix }'))).toContain('selector-mismatch');
  });

  it('flags plain-text secrets in env and args, but not env references', () => {
    const r = check(deployment('', `          env: [{ name: DB_PASSWORD, value: hunter2 }]
          args: ["--api-key=abc", "--token=$(TOKEN)"]`)).findings.filter((f) => f.rule === 'plaintext-secret');
    expect(r).toHaveLength(2);
  });

  it('flags probes on unknown named ports and identical probes', () => {
    const r = rules(deployment('', `          readinessProbe: { httpGet: { path: /h, port: web } }
          livenessProbe: { httpGet: { path: /h, port: web } }`));
    expect(r).toContain('probe-port');
    expect(r).toContain('same-probes');
  });

  it('checks Services, Ingresses and PDBs across documents', () => {
    const r = rules(`${deployment().replace('replicas: 1', 'replicas: 3')}
---
apiVersion: v1
kind: Service
metadata: { name: api, namespace: prod }
spec: { selector: { app: api }, ports: [{ port: 80, targetPort: web }] }
---
apiVersion: v1
kind: Service
metadata: { name: other, namespace: prod }
spec: { selector: { app: nothing }, ports: [{ port: 80 }] }
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata: { name: api, namespace: prod }
spec:
  tls: [{ hosts: [a] }]
  rules: [{ http: { paths: [{ path: /, pathType: Prefix, backend: { service: { name: missing, port: { number: 80 } } } }] } }]
`);
    expect(r).toContain('service-target-port');
    expect(r).toContain('service-no-match');
    expect(r).toContain('ingress-backend');
    expect(r).toContain('no-disruption-budget');
  });

  it('flags an HPA whose target has no requests', () => {
    expect(rules(`${deployment()}
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata: { name: api, namespace: prod }
spec: { scaleTargetRef: { kind: Deployment, name: api } }
`)).toContain('hpa-no-request');
  });

  it('honours the ignore option and the ignore annotation', () => {
    expect(check(deployment(), ['sa-token']).findings.map((f) => f.rule)).not.toContain('sa-token');
    const annotated = deployment().replace('metadata: { name: api, namespace: prod }', 'metadata: { name: api, namespace: prod, annotations: { opsmask.com/ignore: "sa-token, image-tag" } }');
    expect(rules(annotated)).not.toContain('sa-token');
  });

  it('sorts errors first', () => {
    const sev = check(deployment('      hostNetwork: true')).findings.map((f) => f.severity);
    expect(sev).toEqual([...sev].sort((a, b) => ['error', 'warn', 'info'].indexOf(a) - ['error', 'warn', 'info'].indexOf(b)));
  });
});

describe('podSecurityLevel', () => {
  const restricted = {
    securityContext: { runAsNonRoot: true, seccompProfile: { type: 'RuntimeDefault' } },
    containers: [{ name: 'c', securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ['ALL'] } } }],
  };
  it('recognises each level', () => {
    expect(podSecurityLevel(restricted).level).toBe('restricted');
    expect(podSecurityLevel({ containers: [{ name: 'c' }] }).level).toBe('baseline');
    expect(podSecurityLevel({ hostPID: true, containers: [{ name: 'c' }] }).level).toBe('privileged');
    expect(podSecurityLevel({ ...restricted, volumes: [{ name: 'h', hostPath: { path: '/' } }] }).level).toBe('privileged');
  });
  it('explains what blocks the next level', () => {
    expect(podSecurityLevel({ containers: [{ name: 'c' }] }).reasons).toContain('runAsNonRoot is not true');
  });
});
