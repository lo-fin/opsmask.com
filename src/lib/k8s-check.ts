// Lightweight best-practice checks for Kubernetes manifests. Not a replacement for
// kube-linter / Polaris / kubeconform, but instant and offline.

export type Severity = 'error' | 'warn' | 'info';
export type Finding = { severity: Severity; doc: string; where: string; message: string };

const WORKLOADS = ['Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet', 'Job', 'CronJob', 'Pod'];
const SECRET_NAME = /pass(word)?|secret|token|api_?key|access_?key|conn(ection)?_?str/i;

function podSpecOf(doc: any): any {
  switch (doc.kind) {
    case 'Pod': return doc.spec;
    case 'CronJob': return doc.spec?.jobTemplate?.spec?.template?.spec;
    default: return doc.spec?.template?.spec;
  }
}

export function checkManifests(docs: any[]): Finding[] {
  const out: Finding[] = [];
  docs.forEach((doc, i) => {
    if (!doc || typeof doc !== 'object') return;
    const id = `${doc.kind ?? 'Document'}/${doc.metadata?.name ?? `#${i + 1}`}`;
    const add = (severity: Severity, where: string, message: string) => out.push({ severity, doc: id, where, message });

    if (!doc.apiVersion) add('error', 'apiVersion', 'Missing apiVersion.');
    if (!doc.kind) add('error', 'kind', 'Missing kind.');
    if (!doc.metadata?.name) add('error', 'metadata.name', 'Missing metadata.name.');
    if (doc.metadata && !doc.metadata.namespace && doc.kind !== 'Namespace' && !String(doc.kind).startsWith('Cluster'))
      add('info', 'metadata.namespace', 'No namespace set. It will go to whatever namespace kubectl or ArgoCD targets.');

    if (doc.kind === 'Secret' && (doc.data || doc.stringData))
      add('warn', 'data', 'Secret values in a manifest end up in Git. Prefer External Secrets, Sealed Secrets or the Key Vault CSI driver.');
    if (doc.kind === 'Service' && doc.spec?.type === 'LoadBalancer')
      add('info', 'spec.type', 'LoadBalancer creates a public IP unless an internal annotation is set.');

    if (!WORKLOADS.includes(doc.kind)) return;
    const pod = podSpecOf(doc);
    if (!pod) { add('error', 'spec', 'Could not find the pod template spec.'); return; }
    const longRunning = !['Job', 'CronJob'].includes(doc.kind);

    if (['Deployment', 'StatefulSet'].includes(doc.kind) && (doc.spec?.replicas ?? 1) < 2)
      add('info', 'spec.replicas', 'Single replica. A node drain or upgrade will cause downtime.');
    if (pod.hostNetwork) add('error', 'hostNetwork', 'hostNetwork: true shares the node’s network namespace.');
    if (pod.hostPID || pod.hostIPC) add('error', 'hostPID/hostIPC', 'Sharing host PID or IPC namespaces breaks isolation.');
    if (pod.automountServiceAccountToken !== false)
      add('info', 'automountServiceAccountToken', 'The service account token is mounted. Set it to false if the app does not call the Kubernetes API.');

    const podNonRoot = pod.securityContext?.runAsNonRoot === true;
    const containers = [
      ...(pod.containers ?? []).map((c: any) => ({ c, init: false })),
      ...(pod.initContainers ?? []).map((c: any) => ({ c, init: true })),
    ];
    if (!containers.length) add('error', 'containers', 'No containers defined.');

    for (const { c, init } of containers) {
      const where = `${init ? 'initContainer' : 'container'} “${c.name ?? '?'}”`;
      const image: string = c.image ?? '';
      if (!image) add('error', where, 'No image set.');
      else if (!image.includes('@') && (!/:[^/]+$/.test(image) || image.endsWith(':latest')))
        add('warn', where, `Image “${image}” uses latest or no tag. Pin a version or digest so rollbacks are predictable.`);

      if (!c.resources?.requests) add('warn', where, 'No resource requests. The scheduler cannot place the pod sensibly.');
      if (!c.resources?.limits?.memory) add('warn', where, 'No memory limit. A leak can starve other pods on the node.');

      const sc = c.securityContext ?? {};
      if (sc.privileged) add('error', where, 'privileged: true gives the container full access to the node.');
      if (sc.allowPrivilegeEscalation !== false) add('warn', where, 'Set securityContext.allowPrivilegeEscalation: false.');
      if (!podNonRoot && sc.runAsNonRoot !== true) add('warn', where, 'May run as root. Set runAsNonRoot: true.');
      if (sc.readOnlyRootFilesystem !== true) add('info', where, 'Root filesystem is writable. Consider readOnlyRootFilesystem: true.');
      if (!sc.capabilities?.drop?.includes('ALL')) add('info', where, 'Capabilities are not dropped. Consider capabilities.drop: ["ALL"].');

      if (longRunning && !init) {
        if (!c.readinessProbe) add('warn', where, 'No readinessProbe. Traffic may reach the pod before it is ready.');
        if (!c.livenessProbe) add('info', where, 'No livenessProbe. A hung process will not be restarted.');
      }
      for (const e of c.env ?? []) {
        if (typeof e?.value === 'string' && e.value && SECRET_NAME.test(e.name ?? ''))
          add('error', where, `Env var ${e.name} has a plain-text value. Use valueFrom.secretKeyRef.`);
      }
    }
  });
  const rank = { error: 0, warn: 1, info: 2 } as const;
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
