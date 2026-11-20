// Explains Kubernetes RBAC objects in plain words and flags risky permissions.

export type Risk = { level: 'high' | 'medium'; text: string };
export type RuleText = { text: string; risks: Risk[] };
export type RoleInfo = { id: string; kind: string; name: string; scope: string; rules: RuleText[]; aggregated: boolean };
export type Subject = { kind: string; name: string; namespace?: string };
export type BindingInfo = { id: string; subjects: Subject[]; role: string; scope: string; ns?: string; risks: Risk[] };
export type SubjectAccess = { subject: string; grants: { role: string; scope: string; risks: Risk[]; known: boolean }[] };

const READ = ['get', 'list', 'watch'];
const WRITE = ['create', 'update', 'patch', 'delete', 'deletecollection'];
const WORKLOAD_RESOURCES = ['pods', 'deployments', 'statefulsets', 'daemonsets', 'replicasets', 'jobs', 'cronjobs', 'replicationcontrollers'];

export const BUILT_IN: Record<string, string> = {
  'cluster-admin': 'Full control of every resource in every namespace.',
  admin: 'Full control inside a namespace, including Roles and RoleBindings, but not the namespace itself or resource quotas.',
  edit: 'Read and write most objects in a namespace, including Secrets and running pods. Cannot change RBAC.',
  view: 'Read-only access to most objects in a namespace. Cannot read Secrets.',
};
const BUILT_IN_RISK: Record<string, Risk[]> = {
  'cluster-admin': [{ level: 'high', text: 'cluster-admin can do anything' }],
  admin: [{ level: 'high', text: 'can read Secrets and grant roles in the namespace' }],
  edit: [{ level: 'high', text: 'can read Secrets and run any pod' }],
};

const list = (xs: string[]) => xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
const groupName = (g: string) => (g === '' ? 'core' : g === '*' ? 'all API groups' : g);

function verbsText(verbs: string[]): string {
  if (verbs.includes('*')) return 'do anything with';
  const v = new Set(verbs);
  const parts: string[] = [];
  if (READ.every((x) => v.has(x))) { parts.push('read'); READ.forEach((x) => v.delete(x)); }
  if (WRITE.every((x) => v.has(x))) { parts.push('write'); WRITE.forEach((x) => v.delete(x)); }
  return list([...parts, ...v]);
}

export function ruleRisks(rule: any): Risk[] {
  const verbs: string[] = rule?.verbs ?? [];
  const res: string[] = rule?.resources ?? [];
  const groups: string[] = rule?.apiGroups ?? [];
  const any = (vs: string[]) => verbs.includes('*') || vs.some((x) => verbs.includes(x));
  const on = (r: string) => res.includes('*') || res.includes(r);
  const risks: Risk[] = [];
  const named = (rule?.resourceNames ?? []).length > 0;

  if (verbs.includes('*') && res.includes('*')) risks.push({ level: 'high', text: 'full access to every resource in scope' });
  else {
    if (res.includes('*')) risks.push({ level: 'high', text: '“*” resources includes Secrets and any future CRD' });
    if (verbs.includes('*')) risks.push({ level: 'medium', text: '“*” verbs includes delete, escalate and any future verb' });
  }
  if (groups.includes('*')) risks.push({ level: 'medium', text: '“*” apiGroups matches every API group, including CRDs' });
  if (on('secrets') && any(['get', 'list', 'watch']))
    risks.push({ level: 'high', text: named ? 'can read the named Secrets' : `can read Secrets${any(['list', 'watch']) ? ' (list returns every value)' : ''}` });
  if ((on('pods/exec') || on('pods/attach')) && any(['create', 'get']))
    risks.push({ level: 'high', text: 'can exec into pods and act as their service account' });
  if (WORKLOAD_RESOURCES.some(on) && any(['create', 'update', 'patch']) && !named)
    risks.push({ level: 'high', text: 'can run pods, which can mount any Secret or service account in the namespace' });
  if ((on('roles') || on('clusterroles')) && any(['escalate']))
    risks.push({ level: 'high', text: 'escalate: can grant permissions it does not hold' });
  if ((on('roles') || on('clusterroles')) && any(['bind']))
    risks.push({ level: 'high', text: 'bind: can bind roles with more permissions than it holds' });
  if ((on('rolebindings') || on('clusterrolebindings')) && any(['create', 'update', 'patch']))
    risks.push({ level: 'medium', text: 'can create role bindings' });
  if (any(['impersonate'])) risks.push({ level: 'high', text: 'can impersonate users, groups or service accounts' });
  if (on('nodes/proxy') && any(['get', 'create'])) risks.push({ level: 'high', text: 'nodes/proxy gives direct access to the kubelet API' });
  if (on('serviceaccounts/token') && any(['create'])) risks.push({ level: 'high', text: 'can mint tokens for service accounts' });
  if ((on('certificatesigningrequests/approval') || on('signers')) && any(['update', 'approve', 'sign']))
    risks.push({ level: 'high', text: 'can approve certificates, including client certs for any user' });
  if ((on('mutatingwebhookconfigurations') || on('validatingwebhookconfigurations')) && any(['create', 'update', 'patch']))
    risks.push({ level: 'high', text: 'can change admission webhooks, which see every request' });
  if (on('persistentvolumes') && any(['create'])) risks.push({ level: 'medium', text: 'can create PersistentVolumes, including hostPath' });
  if (on('namespaces') && any(['delete'])) risks.push({ level: 'medium', text: 'can delete namespaces and everything in them' });
  if (on('configmaps') && any(['update', 'patch']) && rule?.resourceNames?.includes('aws-auth'))
    risks.push({ level: 'high', text: 'can edit aws-auth, which maps IAM roles to cluster access' });
  return risks;
}

function ruleText(rule: any): string {
  const verbs = verbsText(rule?.verbs ?? []);
  if (rule?.nonResourceURLs?.length) return `Can ${verbs} the URLs ${list(rule.nonResourceURLs.map((u: string) => `${u}`))}.`;
  const res: string[] = rule?.resources ?? [];
  const what = res.includes('*') ? 'all resources' : list(res);
  const groups: string[] = rule?.apiGroups ?? [''];
  const names: string[] = rule?.resourceNames ?? [];
  return `Can ${verbs} ${what}${names.length ? ` named ${list(names)}` : ''} in the ${list(groups.map(groupName))} API group${groups.length > 1 ? 's' : ''}.`;
}

const subjectId = (s: Subject, bindingNs?: string) =>
  s.kind === 'ServiceAccount' ? `ServiceAccount ${s.namespace ?? bindingNs ?? 'default'}/${s.name}` : `${s.kind} ${s.name}`;

export function explainRbac(docs: any[]) {
  const objs = docs.flatMap((d) => (Array.isArray(d?.items) ? d.items : [d])).filter((d) => d && typeof d === 'object');
  const roles: RoleInfo[] = objs.filter((d) => d.kind === 'Role' || d.kind === 'ClusterRole').map((d) => ({
    id: `${d.kind}/${d.metadata?.name}`,
    kind: d.kind, name: d.metadata?.name,
    scope: d.kind === 'ClusterRole' ? 'cluster-wide or per namespace, depending on the binding' : `namespace ${d.metadata?.namespace ?? '(not set)'}`,
    aggregated: !!d.aggregationRule,
    rules: (d.rules ?? []).map((r: any) => ({ text: ruleText(r), risks: ruleRisks(r) })),
  }));

  const roleByRef = (kind: string, name: string, ns?: string) =>
    objs.find((d) => d.kind === kind && d.metadata?.name === name && (kind === 'ClusterRole' || !ns || !d.metadata?.namespace || d.metadata.namespace === ns));

  const bindings: BindingInfo[] = objs.filter((d) => d.kind === 'RoleBinding' || d.kind === 'ClusterRoleBinding').map((d) => {
    const ns = d.metadata?.namespace;
    const ref = d.roleRef ?? {};
    const scope = d.kind === 'ClusterRoleBinding' ? 'every namespace (cluster-wide)' : `namespace ${ns ?? '(not set)'}`;
    const subjects: Subject[] = (d.subjects ?? []).map((s: any) => ({ kind: s.kind, name: s.name, namespace: s.namespace }));
    const risks: Risk[] = [];
    for (const s of subjects) {
      if (['system:authenticated', 'system:unauthenticated', 'system:anonymous'].includes(s.name))
        risks.push({ level: 'high', text: `${s.name} means ${s.name === 'system:authenticated' ? 'every authenticated user and service account' : 'anyone, without logging in'}` });
      if (s.kind === 'ServiceAccount' && s.name === 'default') risks.push({ level: 'medium', text: 'the default service account is used by every pod that does not set one' });
      if (s.kind === 'Group' && s.name === 'system:serviceaccounts') risks.push({ level: 'high', text: 'system:serviceaccounts is every service account in the cluster' });
    }
    if (ref.name === 'cluster-admin' && d.kind === 'ClusterRoleBinding') risks.push({ level: 'high', text: 'cluster-admin across the whole cluster' });
    return { id: `${d.kind}/${d.metadata?.name}`, subjects, role: `${ref.kind}/${ref.name}`, scope, risks, ns };
  });

  const access = new Map<string, SubjectAccess>();
  for (const b of bindings) {
    const [kind, name] = b.role.split('/');
    const role = roleByRef(kind, name, b.ns);
    const risks = role ? (role.rules ?? []).flatMap(ruleRisks) : BUILT_IN_RISK[name] ?? [];
    const uniq = [...new Map([...risks, ...b.risks].map((r) => [r.text, r])).values()];
    for (const s of b.subjects) {
      const id = subjectId(s, b.ns);
      if (!access.has(id)) access.set(id, { subject: id, grants: [] });
      access.get(id)!.grants.push({ role: b.role, scope: b.scope, risks: uniq, known: !!role || name in BUILT_IN });
    }
  }
  return { roles, bindings, access: [...access.values()] };
}
