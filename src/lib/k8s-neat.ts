// Turns `kubectl get -o yaml` output back into a clean manifest: drops status and
// server-managed metadata, values the cluster assigned, and fields set to their default.
// Defaults are only removed when they match exactly, so nothing the author set is lost.

export type NeatOptions = {
  defaults: boolean;   // fields equal to the API default
  assigned: boolean;   // clusterIP, nodePort, nodeName, PVC volumeName
  helm: boolean;       // Helm release labels and annotations
};
export type NeatResult = { docs: any[]; removed: string[]; notes: string[] };

const SERVER_METADATA = ['uid', 'resourceVersion', 'generation', 'creationTimestamp', 'deletionTimestamp', 'deletionGracePeriodSeconds', 'selfLink', 'managedFields', 'ownerReferences'];
const SERVER_ANNOTATIONS = [
  'kubectl.kubernetes.io/last-applied-configuration', 'deployment.kubernetes.io/revision',
  'pv.kubernetes.io/bind-completed', 'pv.kubernetes.io/bound-by-controller', 'pv.kubernetes.io/provisioned-by',
  'volume.beta.kubernetes.io/storage-provisioner', 'volume.kubernetes.io/storage-provisioner', 'volume.kubernetes.io/selected-node',
  'control-plane.alpha.kubernetes.io/leader', 'endpoints.kubernetes.io/last-change-trigger-time',
];
const TEMPLATE_ANNOTATIONS = ['kubectl.kubernetes.io/restartedAt'];
const GENERATED_LABELS = ['pod-template-hash', 'controller-revision-hash', 'pod-template-generation', 'statefulset.kubernetes.io/pod-name',
  'apps.kubernetes.io/pod-index', 'controller-uid', 'job-name', 'batch.kubernetes.io/controller-uid', 'batch.kubernetes.io/job-name', 'batch.kubernetes.io/job-completion-index'];
const HELM_LABELS = ['app.kubernetes.io/managed-by', 'helm.sh/chart'];
const HELM_ANNOTATIONS = ['meta.helm.sh/release-name', 'meta.helm.sh/release-namespace'];

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const isEmpty = (v: unknown) => v == null || (isObj(v) && !Object.keys(v).length) || (Array.isArray(v) && !v.length);
// Deep equality that ignores key order: kubectl sorts keys, our defaults do not.
function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b))
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => same(x, b[i]));
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => k in b && same(a[k], b[k]));
  }
  return a === b;
}

export function neat(input: any[], opts: NeatOptions): NeatResult {
  const removed: string[] = [];
  const notes: string[] = [];
  const objs = input.flatMap((d) => (Array.isArray(d?.items) && /List$/.test(d?.kind ?? 'List') ? d.items : [d])).filter(isObj);

  const docs = objs.map((src) => {
    const doc = structuredClone(src);
    const id = `${doc.kind ?? '?'}/${doc.metadata?.name ?? '?'}`;
    const drop = (o: any, key: string, path: string, when: (v: any) => boolean = () => true) => {
      if (isObj(o) && key in o && when(o[key])) { delete o[key]; removed.push(`${id}: ${path}`); }
    };
    const dropDefault = (o: any, key: string, path: string, value: unknown) => {
      if (opts.defaults) drop(o, key, path, (v) => same(v, value));
    };
    const cleanMeta = (m: any, base: string, template = false) => {
      if (!isObj(m)) return;
      for (const k of SERVER_METADATA) drop(m, k, `${base}.${k}`);
      if (template) drop(m, 'creationTimestamp', `${base}.creationTimestamp`);
      for (const k of [...SERVER_ANNOTATIONS, ...(template ? TEMPLATE_ANNOTATIONS : []), ...(opts.helm ? HELM_ANNOTATIONS : [])]) drop(m.annotations, k, `${base}.annotations.${k}`);
      for (const k of [...GENERATED_LABELS, ...(opts.helm ? HELM_LABELS : [])]) drop(m.labels, k, `${base}.labels.${k}`);
      if (isEmpty(m.annotations)) delete m.annotations;
      if (isEmpty(m.labels)) delete m.labels;
    };

    drop(doc, 'status', 'status');
    cleanMeta(doc.metadata, 'metadata');
    if (doc.kind === 'Secret' && (doc.data || doc.stringData))
      notes.push(`${id} still contains Secret values. Use the redactor before sharing it, and keep Secrets out of Git.`);

    const spec = doc.spec;
    const podSpec = (p: any, base: string, kind: string) => {
      if (!isObj(p)) return;
      drop(p, 'serviceAccount', `${base}.serviceAccount`, (v) => v === p.serviceAccountName); // deprecated alias
      if (opts.assigned) drop(p, 'nodeName', `${base}.nodeName`);
      if (kind === 'Pod') {
        // The token volume the API server injects into every pod.
        const injected = (p.volumes ?? []).filter((v: any) => /^kube-api-access-/.test(v?.name)).map((v: any) => v.name);
        if (injected.length) {
          p.volumes = p.volumes.filter((v: any) => !injected.includes(v.name));
          if (!p.volumes.length) delete p.volumes;
          for (const c of [...(p.containers ?? []), ...(p.initContainers ?? [])])
            if (c?.volumeMounts) { c.volumeMounts = c.volumeMounts.filter((m: any) => !injected.includes(m.name)); if (!c.volumeMounts.length) delete c.volumeMounts; }
          removed.push(`${id}: ${base}.volumes.${injected.join(', ')} (injected service account token)`);
        }
        drop(p, 'preemptionPolicy', `${base}.preemptionPolicy`, (v) => opts.defaults && v === 'PreemptLowerPriority');
        drop(p, 'priority', `${base}.priority`, (v) => opts.defaults && v === 0);
        drop(p, 'tolerations', `${base}.tolerations`, (v) => opts.defaults && Array.isArray(v)
          && v.every((t: any) => ['node.kubernetes.io/not-ready', 'node.kubernetes.io/unreachable'].includes(t?.key) && t?.tolerationSeconds === 300));
      }
      dropDefault(p, 'dnsPolicy', `${base}.dnsPolicy`, 'ClusterFirst');
      dropDefault(p, 'restartPolicy', `${base}.restartPolicy`, 'Always');
      dropDefault(p, 'schedulerName', `${base}.schedulerName`, 'default-scheduler');
      dropDefault(p, 'securityContext', `${base}.securityContext`, {});
      dropDefault(p, 'terminationGracePeriodSeconds', `${base}.terminationGracePeriodSeconds`, 30);
      dropDefault(p, 'enableServiceLinks', `${base}.enableServiceLinks`, true);
      for (const [list, name] of [[p.containers, 'containers'], [p.initContainers, 'initContainers']] as const) {
        (list ?? []).forEach((c: any) => {
          if (!isObj(c)) return;
          const cb = `${base}.${name}[${c.name}]`;
          dropDefault(c, 'terminationMessagePath', `${cb}.terminationMessagePath`, '/dev/termination-log');
          dropDefault(c, 'terminationMessagePolicy', `${cb}.terminationMessagePolicy`, 'File');
          dropDefault(c, 'resources', `${cb}.resources`, {});
          // The default pull policy depends on the tag: Always for :latest or no tag, IfNotPresent otherwise.
          const image = String(c.image ?? '');
          const latest = !image.includes('@') && (!/:[^/]+$/.test(image) || image.endsWith(':latest'));
          dropDefault(c, 'imagePullPolicy', `${cb}.imagePullPolicy`, latest ? 'Always' : 'IfNotPresent');
          for (const port of c.ports ?? []) if (opts.defaults && port?.protocol === 'TCP') { delete port.protocol; removed.push(`${id}: ${cb}.ports.protocol`); }
          for (const probe of ['livenessProbe', 'readinessProbe', 'startupProbe']) {
            const pr = c[probe];
            if (!isObj(pr)) continue;
            const pb = `${cb}.${probe}`;
            dropDefault(pr, 'timeoutSeconds', `${pb}.timeoutSeconds`, 1);
            dropDefault(pr, 'periodSeconds', `${pb}.periodSeconds`, 10);
            dropDefault(pr, 'successThreshold', `${pb}.successThreshold`, 1);
            dropDefault(pr, 'failureThreshold', `${pb}.failureThreshold`, 3);
            dropDefault(pr.httpGet, 'scheme', `${pb}.httpGet.scheme`, 'HTTP');
          }
        });
      }
    };

    switch (doc.kind) {
      case 'Pod':
        podSpec(spec, 'spec', 'Pod');
        if (src.metadata?.ownerReferences?.length)
          notes.push(`${id} was created by a controller. Export the Deployment, StatefulSet or Job instead of the pod.`);
        break;
      case 'Deployment':
        dropDefault(spec, 'progressDeadlineSeconds', 'spec.progressDeadlineSeconds', 600);
        dropDefault(spec, 'revisionHistoryLimit', 'spec.revisionHistoryLimit', 10);
        dropDefault(spec, 'strategy', 'spec.strategy', { type: 'RollingUpdate', rollingUpdate: { maxSurge: '25%', maxUnavailable: '25%' } });
        break;
      case 'StatefulSet':
        dropDefault(spec, 'podManagementPolicy', 'spec.podManagementPolicy', 'OrderedReady');
        dropDefault(spec, 'revisionHistoryLimit', 'spec.revisionHistoryLimit', 10);
        dropDefault(spec, 'updateStrategy', 'spec.updateStrategy', { type: 'RollingUpdate', rollingUpdate: { partition: 0 } });
        dropDefault(spec, 'persistentVolumeClaimRetentionPolicy', 'spec.persistentVolumeClaimRetentionPolicy', { whenDeleted: 'Retain', whenScaled: 'Retain' });
        for (const t of spec?.volumeClaimTemplates ?? []) {
          drop(t, 'status', `spec.volumeClaimTemplates[${t?.metadata?.name}].status`);
          cleanMeta(t?.metadata, `spec.volumeClaimTemplates[${t?.metadata?.name}].metadata`, true);
          if (t?.kind === 'PersistentVolumeClaim') { delete t.kind; delete t.apiVersion; }
          dropDefault(t?.spec, 'volumeMode', `spec.volumeClaimTemplates[${t?.metadata?.name}].spec.volumeMode`, 'Filesystem');
        }
        break;
      case 'DaemonSet':
        dropDefault(spec, 'revisionHistoryLimit', 'spec.revisionHistoryLimit', 10);
        dropDefault(spec, 'updateStrategy', 'spec.updateStrategy', { type: 'RollingUpdate', rollingUpdate: { maxSurge: 0, maxUnavailable: 1 } });
        break;
      case 'Job':
      case 'CronJob': {
        const job = doc.kind === 'Job' ? spec : spec?.jobTemplate?.spec;
        const jb = doc.kind === 'Job' ? 'spec' : 'spec.jobTemplate.spec';
        if (doc.kind === 'CronJob') {
          dropDefault(spec, 'concurrencyPolicy', 'spec.concurrencyPolicy', 'Allow');
          dropDefault(spec, 'failedJobsHistoryLimit', 'spec.failedJobsHistoryLimit', 1);
          dropDefault(spec, 'successfulJobsHistoryLimit', 'spec.successfulJobsHistoryLimit', 3);
          dropDefault(spec, 'suspend', 'spec.suspend', false);
          cleanMeta(spec?.jobTemplate?.metadata, 'spec.jobTemplate.metadata', true);
          if (isEmpty(spec?.jobTemplate?.metadata)) delete spec?.jobTemplate?.metadata;
        }
        // The Job controller generates the selector unless manualSelector is set.
        if (isObj(job) && job.manualSelector !== true) drop(job, 'selector', `${jb}.selector`);
        dropDefault(job, 'backoffLimit', `${jb}.backoffLimit`, 6);
        dropDefault(job, 'completions', `${jb}.completions`, 1);
        dropDefault(job, 'parallelism', `${jb}.parallelism`, 1);
        dropDefault(job, 'completionMode', `${jb}.completionMode`, 'NonIndexed');
        dropDefault(job, 'suspend', `${jb}.suspend`, false);
        dropDefault(job, 'podReplacementPolicy', `${jb}.podReplacementPolicy`, 'TerminatingOrFailed');
        dropDefault(job, 'manualSelector', `${jb}.manualSelector`, false);
        break;
      }
      case 'Service': {
        const headless = spec?.clusterIP === 'None';
        if (opts.assigned && !headless) {
          drop(spec, 'clusterIP', 'spec.clusterIP');
          drop(spec, 'clusterIPs', 'spec.clusterIPs');
        }
        if (opts.assigned) {
          for (const p of spec?.ports ?? []) if (p?.nodePort != null) { delete p.nodePort; removed.push(`${id}: spec.ports.nodePort`); }
          drop(spec, 'healthCheckNodePort', 'spec.healthCheckNodePort');
        }
        dropDefault(spec, 'type', 'spec.type', 'ClusterIP');
        dropDefault(spec, 'sessionAffinity', 'spec.sessionAffinity', 'None');
        dropDefault(spec, 'internalTrafficPolicy', 'spec.internalTrafficPolicy', 'Cluster');
        dropDefault(spec, 'externalTrafficPolicy', 'spec.externalTrafficPolicy', 'Cluster');
        dropDefault(spec, 'allocateLoadBalancerNodePorts', 'spec.allocateLoadBalancerNodePorts', true);
        if (opts.defaults && spec?.ipFamilyPolicy === 'SingleStack') {
          drop(spec, 'ipFamilyPolicy', 'spec.ipFamilyPolicy');
          drop(spec, 'ipFamilies', 'spec.ipFamilies', (v) => Array.isArray(v) && v.length === 1);
        }
        for (const p of spec?.ports ?? []) {
          if (opts.defaults && p?.protocol === 'TCP') { delete p.protocol; removed.push(`${id}: spec.ports.protocol`); }
          // targetPort defaults to port.
          if (opts.defaults && p?.targetPort != null && same(p.targetPort, p.port)) { delete p.targetPort; removed.push(`${id}: spec.ports.targetPort`); }
        }
        break;
      }
      case 'PersistentVolumeClaim':
        if (opts.assigned) drop(spec, 'volumeName', 'spec.volumeName');
        dropDefault(spec, 'volumeMode', 'spec.volumeMode', 'Filesystem');
        break;
    }

    const template = doc.kind === 'CronJob' ? spec?.jobTemplate?.spec?.template : spec?.template;
    const tb = doc.kind === 'CronJob' ? 'spec.jobTemplate.spec.template' : 'spec.template';
    if (isObj(template)) {
      cleanMeta(template.metadata, `${tb}.metadata`, true);
      if (isEmpty(template.metadata)) delete template.metadata;
      podSpec(template.spec, `${tb}.spec`, doc.kind);
    }
    return doc;
  });

  if (!docs.length) throw new Error('No Kubernetes objects found.');
  return { docs, removed, notes };
}
