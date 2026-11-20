import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { neat, type NeatOptions } from './k8s-neat';
import { DEPLOYMENT_AND_SERVICE, JOB, POD } from './k8s-neat.samples';

const ALL: NeatOptions = { defaults: true, assigned: true, helm: false };
const run = (text: string, opts: NeatOptions = ALL) => neat(yaml.loadAll(text), opts);

describe('neat', () => {
  it('reduces a Deployment to what the author wrote', () => {
    const [deploy] = run(DEPLOYMENT_AND_SERVICE).docs;
    expect(deploy).toEqual({
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: {
        annotations: { 'meta.helm.sh/release-name': 'api', 'meta.helm.sh/release-namespace': 'prod' },
        labels: { app: 'api', 'app.kubernetes.io/managed-by': 'Helm' },
        name: 'api',
        namespace: 'prod',
      },
      spec: {
        replicas: 3,
        selector: { matchLabels: { app: 'api' } },
        template: {
          metadata: { labels: { app: 'api' } },
          spec: {
            containers: [{
              image: 'myregistry.azurecr.io/api:1.4.2',
              livenessProbe: { httpGet: { path: '/healthz', port: 'http' } },
              name: 'api',
              ports: [{ containerPort: 8080, name: 'http' }],
              resources: { limits: { memory: '512Mi' }, requests: { cpu: '250m', memory: '512Mi' } },
            }],
            // 60 is not the default, so it stays.
            terminationGracePeriodSeconds: 60,
          },
        },
      },
    });
  });

  it('removes assigned addresses and defaults from a Service', () => {
    const [, svc] = run(DEPLOYMENT_AND_SERVICE).docs;
    expect(svc.spec).toEqual({ ports: [{ name: 'http', port: 80, targetPort: 'http' }], selector: { app: 'api' } });
  });

  it('keeps assigned values and defaults when asked', () => {
    const [deploy, svc] = run(DEPLOYMENT_AND_SERVICE, { defaults: false, assigned: false, helm: false }).docs;
    expect(svc.spec.clusterIP).toBe('10.0.143.27');
    expect(deploy.spec.revisionHistoryLimit).toBe(10);
    expect(deploy.status).toBeUndefined();
    expect(deploy.metadata.uid).toBeUndefined();
  });

  it('drops Helm metadata only when asked', () => {
    const [deploy] = run(DEPLOYMENT_AND_SERVICE, { ...ALL, helm: true }).docs;
    expect(deploy.metadata.annotations).toBeUndefined();
    expect(deploy.metadata.labels).toEqual({ app: 'api' });
  });

  it('removes the generated Job selector and labels but keeps restartPolicy OnFailure', () => {
    const [job] = run(JOB).docs;
    expect(job.metadata).toEqual({ name: 'nightly-report', namespace: 'jobs' });
    expect(job.spec.selector).toBeUndefined();
    expect(job.spec.template.metadata).toBeUndefined();
    expect(job.spec.template.spec).toEqual({ containers: [{ image: 'reporter:3.1.0', name: 'report' }], restartPolicy: 'OnFailure' });
    expect(Object.keys(job.spec)).toEqual(['template']);
  });

  it('keeps a manual Job selector', () => {
    const manual = JOB.replace('manualSelector: false', 'manualSelector: true');
    expect(run(manual).docs[0].spec.selector).toBeDefined();
  });

  it('cleans a Pod and suggests exporting its controller', () => {
    const r = run(POD);
    const [pod] = r.docs;
    expect(pod.spec).toEqual({ containers: [{ image: 'myregistry.azurecr.io/api:latest', name: 'api' }], serviceAccountName: 'default' });
    expect(pod.metadata.labels).toEqual({ app: 'api' });
    expect(r.notes.join(' ')).toMatch(/Export the Deployment/);
    expect(r.removed).toContain('Pod/api-7d9c8b6f5-2kq9x: spec.volumes.kube-api-access-x7k2p (injected service account token)');
  });

  it('only drops imagePullPolicy when it matches the default for the tag', () => {
    const pinned = POD.replace('api:latest', 'api:1.0.0');
    expect(run(pinned).docs[0].spec.containers[0].imagePullPolicy).toBe('Always');
  });

  it('keeps headless Services headless', () => {
    const headless = yaml.dump({ apiVersion: 'v1', kind: 'Service', metadata: { name: 'db' }, spec: { clusterIP: 'None', ports: [{ port: 5432 }] } });
    expect(run(headless).docs[0].spec.clusterIP).toBe('None');
  });

  it('warns about Secret values and lists what it removed', () => {
    const secret = yaml.dump({ apiVersion: 'v1', kind: 'Secret', metadata: { name: 's', uid: 'x' }, data: { a: 'Yg==' } });
    const r = run(secret);
    expect(r.notes[0]).toMatch(/still contains Secret values/);
    expect(r.removed).toEqual(['Secret/s: metadata.uid']);
  });

  it('does not change its input', () => {
    const docs = yaml.loadAll(POD);
    const before = JSON.stringify(docs);
    neat(docs, ALL);
    expect(JSON.stringify(docs)).toBe(before);
  });
});

describe('default matching', () => {
  it('ignores key order but not values', () => {
    const custom = DEPLOYMENT_AND_SERVICE.replace('maxSurge: 25%', 'maxSurge: 1');
    expect(run(custom).docs[0].spec.strategy).toEqual({ rollingUpdate: { maxSurge: 1, maxUnavailable: '25%' }, type: 'RollingUpdate' });
  });
});
