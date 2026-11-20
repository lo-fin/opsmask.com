import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { evaluate, explainPolicies } from './k8s-netpol';

const docs = yaml.loadAll(`
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: default-deny, namespace: prod }
spec: { podSelector: {}, policyTypes: [Ingress, Egress] }
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: api-allow-web, namespace: prod }
spec:
  podSelector: { matchLabels: { app: api } }
  ingress:
    - from:
        - podSelector: { matchLabels: { app: web } }
        - namespaceSelector: { matchLabels: { team: monitoring } }
      ports: [{ protocol: TCP, port: 8080 }]
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: web-egress, namespace: prod }
spec:
  podSelector: { matchLabels: { app: web } }
  policyTypes: [Egress]
  egress:
    - to: [{ podSelector: { matchLabels: { app: api } } }]
      ports: [{ protocol: TCP, port: 8080 }]
`) as any[];

const ep = (ns: string, labels: Record<string, string>, nsLabels: Record<string, string> = {}) => ({ ns, labels, nsLabels });

describe('evaluate', () => {
  it('needs egress at the source and ingress at the destination', () => {
    expect(evaluate(docs, ep('prod', { app: 'web' }), ep('prod', { app: 'api' }), '8080').allowed).toBe(true);
    expect(evaluate(docs, ep('prod', { app: 'web' }), ep('prod', { app: 'api' }), '9090').allowed).toBe(false);
    expect(evaluate(docs, ep('prod', { app: 'api' }), ep('prod', { app: 'web' }), '80').allowed).toBe(false);
  });
  it('matches namespace selectors, including the automatic name label', () => {
    expect(evaluate(docs, ep('monitoring', { app: 'prom' }, { team: 'monitoring' }), ep('prod', { app: 'api' }), '8080').allowed).toBe(true);
    expect(evaluate(docs, ep('dev', { app: 'web' }), ep('prod', { app: 'api' }), '8080').allowed).toBe(false);
    const byName = yaml.loadAll(`
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: p, namespace: prod }
spec:
  podSelector: {}
  ingress: [{ from: [{ namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: ops } } }] }]
`) as any[];
    expect(evaluate(byName, ep('ops', {}), ep('prod', {}), '80').allowed).toBe(true);
  });
  it('leaves pods open when no policy selects them', () => {
    expect(evaluate(docs, ep('dev', {}), ep('dev', {}), '80').allowed).toBe(true);
  });
});

describe('explainPolicies', () => {
  const p = explainPolicies(docs);
  it('describes deny-all and allow rules', () => {
    expect(p[0].ingress).toEqual(['All ingress traffic is denied.']);
    expect(p[1].ingress[0]).toMatch(/from pods with app=web in the same namespace; or from any pod in namespaces with team=monitoring, on TCP 8080/);
  });
  it('warns about the OR between separate selectors and about blocked DNS', () => {
    expect(p[1].notes.join(' ')).toMatch(/either one \(OR\)/);
    expect(p[2].notes.join(' ')).toMatch(/port 53/);
  });
  it('does not warn about DNS when another policy allows it', () => {
    const withDns = [...docs, ...(yaml.loadAll(`
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: dns, namespace: prod }
spec: { podSelector: {}, policyTypes: [Egress], egress: [{ ports: [{ protocol: UDP, port: 53 }] }] }
`) as any[])];
    expect(explainPolicies(withDns).flatMap((x) => x.notes).join(' ')).not.toMatch(/port 53/);
  });
});
