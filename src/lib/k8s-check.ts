// Lightweight best-practice checks for Kubernetes manifests. Not a replacement for
// kube-linter / Polaris / kubeconform, but instant and offline.
import { parseQuantity } from './k8s-quantity';
import { matchesLabels, matchesSelector } from './k8s-selector';

export type Severity = 'error' | 'warn' | 'info';
export type Rule = { id: string; severity: Severity; title: string; why: string; fix?: string };
export type Finding = {
  rule: string; severity: Severity; message: string;
  doc: string; docIndex: number; where: string; container?: string;
};
export type PssLevel = 'privileged' | 'baseline' | 'restricted';
export type PssResult = { doc: string; docIndex: number; level: PssLevel; reasons: string[] };
export type Report = { findings: Finding[]; podSecurity: PssResult[] };
export type Options = { ignore?: Iterable<string> };

/** Annotation listing rule IDs to skip for one object, e.g. "image-tag, no-liveness". */
export const IGNORE_ANNOTATION = 'opsmask.com/ignore';

const SECURE_CONTEXT = `securityContext:
  runAsNonRoot: true
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities:
    drop: ["ALL"]
  seccompProfile:
    type: RuntimeDefault`;
const RESOURCES = `resources:
  requests:
    cpu: 100m
    memory: 128Mi
  limits:
    memory: 256Mi`;

export const RULES: Rule[] = [
  { id: 'missing-field', severity: 'error', title: 'Required field missing', why: 'apiVersion, kind, metadata.name, a selector and a container image are required. The API server rejects the object without them.' },
  { id: 'selector-mismatch', severity: 'error', title: 'Selector does not match pod labels', why: 'spec.selector must match spec.template.metadata.labels, otherwise the API server rejects the workload.' },
  { id: 'no-namespace', severity: 'info', title: 'No namespace', why: 'The object lands in whatever namespace kubectl, Helm or Argo CD targets, which can differ between people and pipelines.' },
  { id: 'secret-in-git', severity: 'warn', title: 'Secret values in the manifest', why: 'Base64 is encoding, not encryption. Anyone with access to the repo can read the value. Use External Secrets Operator, Sealed Secrets or the Secrets Store CSI driver.' },
  { id: 'plaintext-secret', severity: 'error', title: 'Plain-text secret in env or args', why: 'The value is visible in Git, in kubectl describe and in the pod spec.', fix: `env:
  - name: DB_PASSWORD
    valueFrom:
      secretKeyRef:
        name: app-secrets
        key: db-password` },
  { id: 'public-load-balancer', severity: 'info', title: 'Public LoadBalancer', why: 'A LoadBalancer Service gets a public IP unless the cloud-specific internal annotation is set.', fix: `metadata:
  annotations:
    service.beta.kubernetes.io/azure-load-balancer-internal: "true"
    # AWS: service.beta.kubernetes.io/aws-load-balancer-scheme: internal
    # GKE: networking.gke.io/load-balancer-type: Internal` },
  { id: 'node-port', severity: 'info', title: 'NodePort Service', why: 'NodePort opens the port on every node. Prefer ClusterIP behind an Ingress or an internal LoadBalancer.' },
  { id: 'ingress-no-tls', severity: 'info', title: 'Ingress without TLS', why: 'Traffic to the Ingress is plain HTTP unless TLS is terminated somewhere in front of it.', fix: `spec:
  tls:
    - hosts: [app.example.com]
      secretName: app-tls` },
  { id: 'rbac-wildcard', severity: 'warn', title: 'Wildcard in RBAC rule', why: '“*” in verbs, resources or apiGroups grants access to things that do not exist yet, including future CRDs. List what is needed.' },
  { id: 'single-replica', severity: 'info', title: 'Single replica', why: 'A node drain, cluster upgrade or crash causes downtime while the only pod is rescheduled.' },
  { id: 'no-disruption-budget', severity: 'info', title: 'No PodDisruptionBudget', why: 'Without a PDB a node drain can evict every replica at the same time.', fix: `apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: app
spec:
  maxUnavailable: 1
  selector:
    matchLabels: { app: app }` },
  { id: 'no-spread', severity: 'info', title: 'Replicas not spread', why: 'Without topology spread or anti-affinity the scheduler may put every replica on the same node or zone.', fix: `topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: topology.kubernetes.io/zone
    whenUnsatisfiable: ScheduleAnyway
    labelSelector:
      matchLabels: { app: app }` },
  { id: 'host-namespace', severity: 'error', title: 'Host namespace shared', why: 'hostNetwork, hostPID and hostIPC remove the isolation between the pod and the node.' },
  { id: 'host-path', severity: 'warn', title: 'hostPath volume', why: 'hostPath exposes the node filesystem to the pod and is a common container escape route.' },
  { id: 'sa-token', severity: 'info', title: 'Service account token mounted', why: 'Most apps never call the Kubernetes API. A mounted token is useful to an attacker who gets into the pod.', fix: 'automountServiceAccountToken: false' },
  { id: 'no-seccomp', severity: 'info', title: 'No seccomp profile', why: 'RuntimeDefault blocks dangerous syscalls and is required by the Restricted Pod Security Standard.', fix: `securityContext:
  seccompProfile:
    type: RuntimeDefault` },
  { id: 'duplicate-name', severity: 'error', title: 'Duplicate name', why: 'Container names must be unique in a pod. Duplicate env var names silently keep the last value.' },
  { id: 'image-tag', severity: 'warn', title: 'Image uses latest or no tag', why: 'The same manifest can pull different code on different days, and rollbacks are not predictable. Pin a version or digest.' },
  { id: 'no-requests', severity: 'warn', title: 'No resource requests', why: 'The scheduler cannot place the pod sensibly, HPA cannot compute utilisation, and the pod is first to be evicted.', fix: RESOURCES },
  { id: 'no-memory-limit', severity: 'warn', title: 'No memory limit', why: 'A memory leak can starve other pods on the node. CPU limits are optional and often cause throttling.', fix: RESOURCES },
  { id: 'request-over-limit', severity: 'error', title: 'Request larger than limit', why: 'The API server rejects a container whose request is above its limit.' },
  { id: 'privileged', severity: 'error', title: 'Privileged container', why: 'privileged: true gives the container full access to the node.' },
  { id: 'privilege-escalation', severity: 'warn', title: 'Privilege escalation allowed', why: 'Without allowPrivilegeEscalation: false a process can gain more privileges than its parent through setuid binaries.', fix: SECURE_CONTEXT },
  { id: 'run-as-root', severity: 'warn', title: 'May run as root', why: 'If the image runs as root, a container escape lands as root on the node.', fix: SECURE_CONTEXT },
  { id: 'writable-root-fs', severity: 'info', title: 'Writable root filesystem', why: 'A read-only root filesystem stops an attacker from dropping tools into the container. Mount an emptyDir for paths the app writes to.', fix: SECURE_CONTEXT },
  { id: 'capabilities', severity: 'info', title: 'Capabilities not dropped', why: 'Containers get a default set of Linux capabilities most apps never use.', fix: SECURE_CONTEXT },
  { id: 'no-readiness', severity: 'warn', title: 'No readinessProbe', why: 'Traffic reaches the pod as soon as the process starts, before the app is ready.', fix: `readinessProbe:
  httpGet: { path: /ready, port: http }
  periodSeconds: 5` },
  { id: 'no-liveness', severity: 'info', title: 'No livenessProbe', why: 'A hung process is not restarted. Keep it cheap and do not check dependencies in it.', fix: `livenessProbe:
  httpGet: { path: /healthz, port: http }
  periodSeconds: 10
  failureThreshold: 3` },
  { id: 'same-probes', severity: 'warn', title: 'Liveness and readiness are identical', why: 'When a dependency is down, both fail together and Kubernetes restarts pods that only needed to stop taking traffic.' },
  { id: 'probe-port', severity: 'error', title: 'Probe uses an unknown port name', why: 'A named probe port must match a name in the container’s ports, otherwise the probe always fails.' },
  { id: 'slow-start', severity: 'info', title: 'Long initialDelaySeconds', why: 'A startupProbe protects slow starts without delaying liveness checks for the rest of the pod’s life.', fix: `startupProbe:
  httpGet: { path: /healthz, port: http }
  periodSeconds: 5
  failureThreshold: 30   # up to 150s to start` },
  { id: 'job-ttl', severity: 'info', title: 'Job never cleaned up', why: 'Finished Jobs and their pods stay in the cluster until deleted.', fix: 'ttlSecondsAfterFinished: 86400' },
  { id: 'cronjob-concurrency', severity: 'info', title: 'CronJob runs may overlap', why: 'The default concurrencyPolicy is Allow, so a slow run overlaps the next one.', fix: 'concurrencyPolicy: Forbid' },
  { id: 'cronjob-deadline', severity: 'info', title: 'No startingDeadlineSeconds', why: 'If the controller misses more than 100 schedules (for example during an outage) the CronJob stops scheduling.', fix: 'startingDeadlineSeconds: 300' },
  { id: 'service-no-match', severity: 'warn', title: 'Service selects no pods', why: 'No workload in the pasted manifests has labels matching the Service selector, so it will have no endpoints.' },
  { id: 'service-target-port', severity: 'error', title: 'Service targetPort not found', why: 'targetPort must match a containerPort (or a port name) on the selected pods.' },
  { id: 'ingress-backend', severity: 'warn', title: 'Ingress backend not found', why: 'The Ingress points at a Service that is not in the pasted manifests. Requests return 503 if it does not exist in the cluster.' },
  { id: 'hpa-no-request', severity: 'warn', title: 'HPA target has no requests', why: 'Utilisation is measured against requests. Without them the HPA reports <unknown> and never scales.' },
];
const RULE_BY_ID = Object.fromEntries(RULES.map((r) => [r.id, r]));

const CLUSTER_SCOPED = new Set([
  'Namespace', 'Node', 'PersistentVolume', 'StorageClass', 'CSIDriver', 'CSINode', 'VolumeAttachment',
  'CustomResourceDefinition', 'APIService', 'IngressClass', 'PriorityClass', 'RuntimeClass',
  'MutatingWebhookConfiguration', 'ValidatingWebhookConfiguration', 'ValidatingAdmissionPolicy',
  'ValidatingAdmissionPolicyBinding', 'CertificateSigningRequest', 'FlowSchema', 'PriorityLevelConfiguration',
  'PodSecurityPolicy', 'ComponentStatus',
]);
const WORKLOADS = ['Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet', 'Job', 'CronJob', 'Pod'];
const SELECTOR_REQUIRED = ['Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet'];
const SECRET_NAME = /pass(word)?|secret|token|api_?key|access_?key|conn(ection)?_?str/i;
const SECRET_ARG = /(pass(word)?|secret|token|api[_-]?key|access[_-]?key)=(?!\$)\S+/i;
const SAFE_SECCOMP = ['RuntimeDefault', 'Localhost'];
const BASELINE_CAPS = new Set(['AUDIT_WRITE', 'CHOWN', 'DAC_OVERRIDE', 'FOWNER', 'FSETID', 'KILL', 'MKNOD', 'NET_BIND_SERVICE', 'SETFCAP', 'SETGID', 'SETPCAP', 'SETUID', 'SYS_CHROOT']);
const RESTRICTED_VOLUMES = ['configMap', 'csi', 'downwardAPI', 'emptyDir', 'ephemeral', 'persistentVolumeClaim', 'projected', 'secret'];

export function podSpecOf(doc: any): any {
  switch (doc.kind) {
    case 'Pod': return doc.spec;
    case 'CronJob': return doc.spec?.jobTemplate?.spec?.template?.spec;
    default: return doc.spec?.template?.spec;
  }
}
function podLabelsOf(doc: any): Record<string, unknown> {
  switch (doc.kind) {
    case 'Pod': return doc.metadata?.labels ?? {};
    case 'CronJob': return doc.spec?.jobTemplate?.spec?.template?.metadata?.labels ?? {};
    default: return doc.spec?.template?.metadata?.labels ?? {};
  }
}
const allContainers = (pod: any): any[] => [...(pod.containers ?? []), ...(pod.initContainers ?? [])];
const portNames = (c: any): string[] => (c.ports ?? []).map((p: any) => p?.name).filter(Boolean);
const probePort = (p: any) => p?.httpGet?.port ?? p?.tcpSocket?.port ?? p?.grpc?.port;
const sameNs = (a?: string, b?: string) => !a || !b || a === b;
const isRoot = (uid: unknown) => uid === 0 || uid === '0';

/** Classifies a pod spec against the Pod Security Standards. reasons explain what blocks the next level. */
export function podSecurityLevel(pod: any): { level: PssLevel; reasons: string[] } {
  const baseline = new Set<string>(), restricted = new Set<string>();
  const psc = pod.securityContext ?? {};
  if (pod.hostNetwork || pod.hostPID || pod.hostIPC) baseline.add('host namespaces');
  if (psc.seccompProfile?.type === 'Unconfined') baseline.add('seccomp Unconfined');
  for (const v of pod.volumes ?? []) {
    const type = Object.keys(v ?? {}).find((k) => k !== 'name');
    if (type === 'hostPath') baseline.add('hostPath volume');
    else if (type && !RESTRICTED_VOLUMES.includes(type)) restricted.add(`${type} volume`);
  }
  for (const c of [...allContainers(pod), ...(pod.ephemeralContainers ?? [])]) {
    const sc = c?.securityContext ?? {};
    const added: string[] = sc.capabilities?.add ?? [];
    if (sc.privileged) baseline.add('privileged container');
    for (const cap of added) if (!BASELINE_CAPS.has(cap)) baseline.add(`capability ${cap}`);
    if ((c?.ports ?? []).some((p: any) => p?.hostPort)) baseline.add('hostPort');
    if (sc.seccompProfile?.type === 'Unconfined') baseline.add('seccomp Unconfined');
    if (sc.procMount === 'Unmasked') baseline.add('procMount Unmasked');

    if (sc.allowPrivilegeEscalation !== false) restricted.add('allowPrivilegeEscalation is not false');
    if ((sc.runAsNonRoot ?? psc.runAsNonRoot) !== true) restricted.add('runAsNonRoot is not true');
    if (isRoot(sc.runAsUser ?? psc.runAsUser)) restricted.add('runAsUser is 0');
    if (!SAFE_SECCOMP.includes(sc.seccompProfile?.type ?? psc.seccompProfile?.type)) restricted.add('no RuntimeDefault seccomp profile');
    if (!sc.capabilities?.drop?.includes('ALL')) restricted.add('capabilities not dropped');
    if (added.some((cap) => cap !== 'NET_BIND_SERVICE')) restricted.add('capabilities added');
  }
  if (baseline.size) return { level: 'privileged', reasons: [...baseline] };
  if (restricted.size) return { level: 'baseline', reasons: [...restricted] };
  return { level: 'restricted', reasons: [] };
}

type Add = (rule: string, where: string, message: string, extra?: { severity?: Severity; container?: string }) => void;
type Workload = { add: Add; kind: string; name?: string; ns?: string; labels: Record<string, unknown>; pod: any; replicas: number };

export function checkManifests(docs: any[], opts: Options = {}): Report {
  const ignored = new Set(opts.ignore ?? []);
  const findings: Finding[] = [];
  const podSecurity: PssResult[] = [];
  const workloads: Workload[] = [];
  const pdbs: any[] = [];
  const services: { doc: any; add: Add }[] = [];
  const ingresses: { doc: any; add: Add }[] = [];
  const hpas: { doc: any; add: Add }[] = [];

  docs.forEach((doc, i) => {
    if (!doc || typeof doc !== 'object') return;
    const id = `${doc.kind ?? 'Document'}/${doc.metadata?.name ?? `#${i + 1}`}`;
    const skip = new Set(String(doc.metadata?.annotations?.[IGNORE_ANNOTATION] ?? '').split(/[\s,]+/).filter(Boolean));
    const add: Add = (rule, where, message, extra = {}) => {
      if (ignored.has(rule) || skip.has(rule)) return;
      findings.push({ rule, severity: extra.severity ?? RULE_BY_ID[rule].severity, message, doc: id, docIndex: i, where, container: extra.container });
    };
    const ns: string | undefined = doc.metadata?.namespace;

    if (!doc.apiVersion) add('missing-field', 'apiVersion', 'Missing apiVersion.');
    if (!doc.kind) add('missing-field', 'kind', 'Missing kind.');
    if (!doc.metadata?.name && !doc.metadata?.generateName) add('missing-field', 'metadata.name', 'Missing metadata.name.');
    if (doc.metadata && !ns && doc.kind && !CLUSTER_SCOPED.has(doc.kind) && !String(doc.kind).startsWith('Cluster'))
      add('no-namespace', 'metadata.namespace', 'No namespace set. It will go to whatever namespace kubectl or Argo CD targets.');

    switch (doc.kind) {
      case 'Secret':
        if (doc.data || doc.stringData)
          add('secret-in-git', 'data', 'Secret values in a manifest end up in Git. Prefer External Secrets, Sealed Secrets or the Secrets Store CSI driver.');
        break;
      case 'Service':
        if (doc.spec?.type === 'LoadBalancer' && !/internal/i.test(JSON.stringify(doc.metadata?.annotations ?? {})))
          add('public-load-balancer', 'spec.type', 'LoadBalancer creates a public IP unless an internal annotation is set.');
        if (doc.spec?.type === 'NodePort') add('node-port', 'spec.type', 'NodePort opens this port on every node.');
        services.push({ doc, add });
        break;
      case 'Ingress':
        if (!doc.spec?.tls?.length) add('ingress-no-tls', 'spec.tls', 'No TLS section. Traffic is plain HTTP unless TLS is terminated in front of the Ingress.');
        ingresses.push({ doc, add });
        break;
      case 'PodDisruptionBudget':
        pdbs.push(doc);
        break;
      case 'HorizontalPodAutoscaler':
        hpas.push({ doc, add });
        break;
      case 'Role':
      case 'ClusterRole':
        (doc.rules ?? []).forEach((r: any, n: number) => {
          const wild = (['verbs', 'resources', 'apiGroups'] as const).filter((k) => r?.[k]?.includes('*'));
          if (wild.length) add('rbac-wildcard', `rules[${n}]`, `“*” in ${wild.join(', ')}. List the specific ${wild.join(' and ')} instead.`);
        });
        break;
    }

    if (!WORKLOADS.includes(doc.kind)) return;
    const pod = podSpecOf(doc);
    if (!pod) { add('missing-field', 'spec', 'Could not find the pod template spec.'); return; }
    const labels = podLabelsOf(doc);
    const replicas = doc.kind === 'DaemonSet' ? 0 : (doc.spec?.replicas ?? 1);
    const longRunning = !['Job', 'CronJob'].includes(doc.kind);
    workloads.push({ add, kind: doc.kind, name: doc.metadata?.name, ns, labels, pod, replicas });
    podSecurity.push({ doc: id, docIndex: i, ...podSecurityLevel(pod) });

    if (SELECTOR_REQUIRED.includes(doc.kind)) {
      if (!doc.spec?.selector) add('missing-field', 'spec.selector', 'spec.selector is required.');
      else if (!matchesSelector(doc.spec.selector, labels))
        add('selector-mismatch', 'spec.selector', 'spec.selector does not match spec.template.metadata.labels. The API server will reject this.');
    }
    if (['Deployment', 'StatefulSet'].includes(doc.kind)) {
      if (replicas < 2) add('single-replica', 'spec.replicas', 'Single replica. A node drain or upgrade will cause downtime.');
      else if (!pod.topologySpreadConstraints?.length && !pod.affinity?.podAntiAffinity)
        add('no-spread', 'spec.template.spec', `${replicas} replicas with no topologySpreadConstraints or podAntiAffinity. They may all land on one node.`);
    }
    if (doc.kind === 'Job' && doc.spec?.ttlSecondsAfterFinished == null)
      add('job-ttl', 'spec.ttlSecondsAfterFinished', 'Finished Job and its pods are never cleaned up. Set ttlSecondsAfterFinished.');
    if (doc.kind === 'CronJob') {
      if (!doc.spec?.concurrencyPolicy) add('cronjob-concurrency', 'spec.concurrencyPolicy', 'concurrencyPolicy defaults to Allow, so slow runs overlap. Consider Forbid or Replace.');
      if (doc.spec?.startingDeadlineSeconds == null) add('cronjob-deadline', 'spec.startingDeadlineSeconds', 'No startingDeadlineSeconds. After 100 missed schedules the CronJob stops scheduling.');
    }

    if (pod.hostNetwork) add('host-namespace', 'hostNetwork', 'hostNetwork: true shares the node’s network namespace.');
    if (pod.hostPID || pod.hostIPC) add('host-namespace', 'hostPID', 'Sharing host PID or IPC namespaces breaks isolation.');
    for (const v of pod.volumes ?? [])
      if (v?.hostPath) add('host-path', 'volumes', `Volume “${v.name}” mounts ${v.hostPath.path ?? 'a path'} from the node.`);
    if (pod.automountServiceAccountToken !== false)
      add('sa-token', 'automountServiceAccountToken', 'The service account token is mounted. Set it to false if the app does not call the Kubernetes API.');

    const psc = pod.securityContext ?? {};
    const podNonRoot = psc.runAsNonRoot === true || (psc.runAsUser != null && !isRoot(psc.runAsUser));
    const containers = [
      ...(pod.containers ?? []).map((c: any) => ({ c: c ?? {}, init: false })),
      ...(pod.initContainers ?? []).map((c: any) => ({ c: c ?? {}, init: true })),
    ];
    if (!pod.containers?.length) add('missing-field', 'containers', 'No containers defined.');
    if (!SAFE_SECCOMP.includes(psc.seccompProfile?.type) && containers.some(({ c }) => !SAFE_SECCOMP.includes(c.securityContext?.seccompProfile?.type)))
      add('no-seccomp', 'securityContext', 'No seccomp profile. Set securityContext.seccompProfile.type: RuntimeDefault on the pod.');

    const seen = new Set<string>();
    for (const { c, init } of containers) {
      const where = `${init ? 'initContainer' : 'container'} “${c.name ?? '?'}”`;
      const at = (rule: string, message: string, severity?: Severity) => add(rule, where, message, { severity, container: c.name });

      if (!c.name) at('missing-field', 'Container has no name.');
      else if (seen.has(c.name)) at('duplicate-name', `Container name “${c.name}” is used more than once.`);
      seen.add(c.name);

      const image: string = c.image ?? '';
      if (!image) at('missing-field', 'No image set.');
      else if (!image.includes('@') && (!/:[^/]+$/.test(image) || image.endsWith(':latest')))
        at('image-tag', `Image “${image}” uses latest or no tag. Pin a version or digest so rollbacks are predictable.`);

      // Requests default to limits when only limits are set.
      const req = c.resources?.requests ?? c.resources?.limits;
      if (!req) at('no-requests', 'No resource requests. The scheduler cannot place the pod sensibly.');
      if (!c.resources?.limits?.memory) at('no-memory-limit', 'No memory limit. A leak can starve other pods on the node.');
      for (const r of ['cpu', 'memory']) {
        const rq = parseQuantity(c.resources?.requests?.[r]), lim = parseQuantity(c.resources?.limits?.[r]);
        if (rq != null && lim != null && rq > lim)
          at('request-over-limit', `${r} request ${c.resources.requests[r]} is larger than the limit ${c.resources.limits[r]}.`);
      }

      const sc = c.securityContext ?? {};
      const nonRoot = sc.runAsNonRoot === true || (sc.runAsUser != null ? !isRoot(sc.runAsUser) : podNonRoot);
      if (sc.privileged) at('privileged', 'privileged: true gives the container full access to the node.');
      if (sc.allowPrivilegeEscalation !== false) at('privilege-escalation', 'Set securityContext.allowPrivilegeEscalation: false.');
      if (!nonRoot) at('run-as-root', 'May run as root. Set runAsNonRoot: true or a non-zero runAsUser.');
      if (sc.readOnlyRootFilesystem !== true) at('writable-root-fs', 'Root filesystem is writable. Consider readOnlyRootFilesystem: true.');
      if (!sc.capabilities?.drop?.includes('ALL')) at('capabilities', 'Capabilities are not dropped. Consider capabilities.drop: ["ALL"].');

      if (longRunning && !init) {
        if (!c.readinessProbe) at('no-readiness', 'No readinessProbe. Traffic may reach the pod before it is ready.');
        if (!c.livenessProbe) at('no-liveness', 'No livenessProbe. A hung process will not be restarted.');
        if (c.readinessProbe && c.livenessProbe && JSON.stringify(c.readinessProbe) === JSON.stringify(c.livenessProbe))
          at('same-probes', 'livenessProbe and readinessProbe are identical. A failing dependency will restart the pod instead of just removing it from the Service.');
        if ((c.livenessProbe?.initialDelaySeconds ?? 0) >= 60 && !c.startupProbe)
          at('slow-start', `livenessProbe.initialDelaySeconds is ${c.livenessProbe.initialDelaySeconds}. Use a startupProbe instead.`);
      }
      for (const kind of ['readinessProbe', 'livenessProbe', 'startupProbe']) {
        const port = probePort(c[kind]);
        if (typeof port === 'string' && !portNames(c).includes(port))
          at('probe-port', `${kind} uses port “${port}”, but the container has no port with that name.`);
      }

      const envNames = new Set<string>();
      for (const e of c.env ?? []) {
        if (e?.name && envNames.has(e.name)) at('duplicate-name', `Env var ${e.name} is defined more than once. The last value wins.`, 'warn');
        envNames.add(e?.name);
        if (typeof e?.value === 'string' && e.value && SECRET_NAME.test(e.name ?? ''))
          at('plaintext-secret', `Env var ${e.name} has a plain-text value. Use valueFrom.secretKeyRef.`);
      }
      for (const arg of [...(c.command ?? []), ...(c.args ?? [])])
        if (typeof arg === 'string' && SECRET_ARG.test(arg))
          at('plaintext-secret', `A command argument contains a plain-text secret (“${arg.replace(/=.*/, '=…')}”). Pass it through an env var from a Secret.`);
    }
  });

  // Checks that need more than one document.
  for (const w of workloads) {
    if (!['Deployment', 'StatefulSet'].includes(w.kind) || w.replicas < 2) continue;
    if (!pdbs.some((p) => sameNs(p.metadata?.namespace, w.ns) && matchesSelector(p.spec?.selector, w.labels)))
      w.add('no-disruption-budget', 'spec.replicas', 'No PodDisruptionBudget in these manifests selects this workload.');
  }

  for (const { doc, add } of services) {
    const sel = doc.spec?.selector;
    if (!sel || !Object.keys(sel).length || !workloads.length) continue;
    const matched = workloads.filter((w) => sameNs(w.ns, doc.metadata?.namespace) && matchesLabels(sel, w.labels));
    if (!matched.length) { add('service-no-match', 'spec.selector', 'No workload in these manifests has labels matching this selector.'); continue; }
    const containers = matched.flatMap((w) => w.pod.containers ?? []);
    const declared = containers.flatMap((c: any) => (c?.ports ?? []).map((p: any) => p?.containerPort));
    for (const p of doc.spec?.ports ?? []) {
      const tp = p?.targetPort ?? p?.port;
      if (typeof tp === 'string' && !/^\d+$/.test(tp)) {
        if (!containers.some((c: any) => portNames(c).includes(tp)))
          add('service-target-port', 'spec.ports', `targetPort “${tp}” is not a port name on the selected pods.`);
      } else if (declared.length && !declared.includes(Number(tp))) {
        add('service-target-port', 'spec.ports', `targetPort ${tp} is not a declared containerPort (${[...new Set(declared)].join(', ')}).`, { severity: 'warn' });
      }
    }
  }

  if (services.length) {
    for (const { doc, add } of ingresses) {
      const backends = [
        doc.spec?.defaultBackend?.service?.name ?? doc.spec?.backend?.serviceName,
        ...(doc.spec?.rules ?? []).flatMap((r: any) => (r?.http?.paths ?? []).map((p: any) => p?.backend?.service?.name ?? p?.backend?.serviceName)),
      ].filter(Boolean);
      for (const name of new Set(backends))
        if (!services.some((s) => s.doc.metadata?.name === name && sameNs(s.doc.metadata?.namespace, doc.metadata?.namespace)))
          add('ingress-backend', 'spec.rules', `Backend Service “${name}” is not in these manifests.`);
    }
  }

  for (const { doc, add } of hpas) {
    const ref = doc.spec?.scaleTargetRef ?? {};
    const w = workloads.find((x) => x.kind === ref.kind && x.name === ref.name && sameNs(x.ns, doc.metadata?.namespace));
    if (!w) continue;
    const metrics: any[] = doc.spec?.metrics ?? [];
    const uses = (r: string) => metrics.some((m) => (m?.resource ?? m?.containerResource)?.name === r);
    const need = [
      ...(uses('cpu') || doc.spec?.targetCPUUtilizationPercentage != null || !metrics.length ? ['cpu'] : []),
      ...(uses('memory') ? ['memory'] : []),
    ];
    for (const r of need) {
      const missing = (w.pod.containers ?? []).filter((c: any) => (c?.resources?.requests ?? c?.resources?.limits)?.[r] == null);
      if (missing.length)
        add('hpa-no-request', 'spec.scaleTargetRef', `Scales on ${r}, but container${missing.length > 1 ? 's' : ''} ${missing.map((c: any) => `“${c.name}”`).join(', ')} in ${ref.kind}/${ref.name} ha${missing.length > 1 ? 've' : 's'} no ${r} request.`);
    }
  }

  const rank = { error: 0, warn: 1, info: 2 } as const;
  findings.sort((a, b) => rank[a.severity] - rank[b.severity] || a.docIndex - b.docIndex);
  return { findings, podSecurity };
}
