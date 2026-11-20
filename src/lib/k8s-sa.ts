// Generates a ServiceAccount with RBAC, and a bash script that creates it and writes a
// kubeconfig on the user's machine. The token never passes through the page.
import yaml from 'js-yaml';

export type Preset = 'rollout' | 'deploy' | 'view' | 'edit' | 'admin' | 'custom';
export type SaOptions = {
  name: string;
  namespace: string;
  scope: 'namespace' | 'cluster';
  preset: Preset;
  customRules?: string;   // YAML list of PolicyRules, for preset 'custom'
  token: 'short' | 'long';
  duration: string;       // for short-lived tokens, e.g. 24h
  context?: string;       // empty: the current context, confirmed at run time
  output?: string;        // kubeconfig file name
};
export type SaResult = { manifests: string; script: string; cleanup: string; rbacYaml: string; warnings: string[] };

const R = (apiGroups: string[], resources: string[], verbs: string[]) => ({ apiGroups, resources, verbs });
const READ = ['get', 'list', 'watch'];

export const PRESETS: Record<Preset, { label: string; description: string; rules?: object[]; builtIn?: string }> = {
  rollout: {
    label: 'Rollout only',
    description: 'Change images and restart existing Deployments (kubectl set image, rollout restart/status). Cannot create or delete anything.',
    rules: [
      R(['apps'], ['deployments'], [...READ, 'patch']),
      R(['apps'], ['replicasets'], READ),
      R([''], ['pods', 'pods/log', 'events'], READ),
    ],
  },
  deploy: {
    label: 'Deploy manifests (CI/CD)',
    description: 'kubectl apply for common app objects. No access to Secrets, RBAC or exec, and no delete.',
    rules: [
      R(['apps'], ['deployments', 'statefulsets', 'daemonsets'], [...READ, 'create', 'update', 'patch']),
      R(['apps'], ['replicasets'], READ),
      R([''], ['services', 'configmaps', 'serviceaccounts'], [...READ, 'create', 'update', 'patch']),
      R([''], ['pods', 'pods/log', 'events'], READ),
      R(['networking.k8s.io'], ['ingresses'], [...READ, 'create', 'update', 'patch']),
      R(['autoscaling'], ['horizontalpodautoscalers'], [...READ, 'create', 'update', 'patch']),
      R(['batch'], ['jobs', 'cronjobs'], [...READ, 'create', 'update', 'patch']),
      R(['policy'], ['poddisruptionbudgets'], [...READ, 'create', 'update', 'patch']),
    ],
  },
  view: { label: 'view (built-in)', description: 'Read most objects. Cannot read Secrets.', builtIn: 'view' },
  edit: { label: 'edit (built-in)', description: 'Read and write most objects, including Secrets and running pods. Cannot change RBAC.', builtIn: 'edit' },
  admin: { label: 'admin (built-in)', description: 'Everything in the namespace, including Roles and RoleBindings.', builtIn: 'admin' },
  custom: { label: 'Custom rules', description: 'Paste the rules list of a Role.' },
};

const DNS_SUBDOMAIN = /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/;
const DNS_LABEL = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const DURATION = /^(\d+(\.\d+)?(h|m|s))+$/;
const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const dump = (o: object) => yaml.dump(o, { lineWidth: -1, noRefs: true, flowLevel: 3 }).trimEnd();

export function generate(o: SaOptions): SaResult {
  const warnings: string[] = [];
  const name = o.name.trim(), ns = o.namespace.trim();
  if (!DNS_SUBDOMAIN.test(name) || name.length > 253) throw new Error('Service account name: lower-case letters, digits, “-” and “.”, starting and ending with a letter or digit.');
  if (!DNS_LABEL.test(ns) || ns.length > 63) throw new Error('Namespace: lower-case letters, digits and “-”, at most 63 characters.');
  if (o.token === 'short' && !DURATION.test(o.duration.trim())) throw new Error('Duration: use a value such as 1h, 24h or 90m.');
  const out = (o.output?.trim() || `${name}.kubeconfig`);
  if (!/^[\w.@-]+$/.test(out)) throw new Error('File name: letters, digits, “.”, “-”, “_” and “@” only.');

  const preset = PRESETS[o.preset];
  const cluster = o.scope === 'cluster';
  // Cluster-wide objects need a name that will not clash with the same SA name in another namespace.
  const roleName = cluster ? `${ns}-${name}` : name;
  let rules: object[] | undefined = preset.rules;
  if (o.preset === 'custom') {
    let parsed: any;
    try { parsed = yaml.load(o.customRules ?? ''); } catch (e) { throw new Error(`Custom rules: ${(e as Error).message.split('\n')[0]}`); }
    if (parsed?.rules) parsed = parsed.rules;
    if (!Array.isArray(parsed) || !parsed.length) throw new Error('Custom rules: paste a YAML list of rules (apiGroups, resources, verbs).');
    parsed.forEach((r: any, i: number) => {
      if (!Array.isArray(r?.verbs) || !r.verbs.length) throw new Error(`Custom rules: rule ${i + 1} has no verbs.`);
      if (!r.nonResourceURLs && !Array.isArray(r?.resources)) throw new Error(`Custom rules: rule ${i + 1} has no resources.`);
    });
    rules = parsed;
  }
  if (cluster && o.preset === 'admin') warnings.push('admin bound cluster-wide gives admin in every namespace, including kube-system.');
  if (cluster && o.preset === 'edit') warnings.push('edit bound cluster-wide can read every Secret in every namespace.');
  if (o.token === 'long') warnings.push('A long-lived token never expires. Anyone who gets the kubeconfig keeps access until you delete the Secret.');

  const objs: any[] = [{ apiVersion: 'v1', kind: 'ServiceAccount', metadata: { name, namespace: ns } }];
  const roleRef = preset.builtIn
    ? { apiGroup: 'rbac.authorization.k8s.io', kind: 'ClusterRole', name: preset.builtIn }
    : { apiGroup: 'rbac.authorization.k8s.io', kind: cluster ? 'ClusterRole' : 'Role', name: roleName };
  if (!preset.builtIn) {
    objs.push({
      apiVersion: 'rbac.authorization.k8s.io/v1', kind: cluster ? 'ClusterRole' : 'Role',
      metadata: cluster ? { name: roleName } : { name: roleName, namespace: ns },
      rules,
    });
  }
  objs.push({
    apiVersion: 'rbac.authorization.k8s.io/v1', kind: cluster ? 'ClusterRoleBinding' : 'RoleBinding',
    metadata: cluster ? { name: roleName } : { name: roleName, namespace: ns },
    subjects: [{ kind: 'ServiceAccount', name, namespace: ns }],
    roleRef,
  });
  const rbacYaml = objs.map(dump).join('\n---\n') + '\n';
  if (o.token === 'long') {
    objs.push({
      apiVersion: 'v1', kind: 'Secret', type: 'kubernetes.io/service-account-token',
      metadata: { name: `${name}-token`, namespace: ns, annotations: { 'kubernetes.io/service-account.name': name } },
    });
  }
  const manifests = objs.map(dump).join('\n---\n') + '\n';

  const ctxLine = o.context?.trim()
    ? `CONTEXT=${shq(o.context.trim())}`
    : 'CONTEXT="${CONTEXT:-$(kubectl config current-context)}"';
  const tokenBlock = o.token === 'short'
    ? `# Short-lived token. The API server may cap the duration; check the exp claim if it matters.
TOKEN=$(k create token "$SA" -n "$NS" --duration=${o.duration.trim()})`
    : `# Long-lived token: the token controller fills in the Secret a moment after it is created.
TOKEN=""
for _ in $(seq 1 20); do
  TOKEN=$(k get secret "$SA-token" -n "$NS" -o jsonpath='{.data.token}' 2>/dev/null | base64 --decode || true)
  [ -n "$TOKEN" ] && break
  sleep 0.5
done
[ -n "$TOKEN" ] || { echo "The token was not created. Check: kubectl describe secret $SA-token -n $NS" >&2; exit 1; }`;

  const script = `#!/usr/bin/env bash
# Creates service account ${name} in namespace ${ns} with ${preset.label} access${cluster ? ' (cluster-wide)' : ''},
# then writes ${out}. Generated by OpsMask; review before running.
set -euo pipefail

${ctxLine}
NS=${ns}
SA=${name}
OUT=${out}
k() { kubectl --context "$CONTEXT" "$@"; }

echo "Cluster context: $CONTEXT"
echo "API server:      $(k config view --minify -o jsonpath='{.clusters[0].cluster.server}')"
if [ "\${YES:-}" != "1" ]; then
  read -r -p "Create $SA in $NS on this cluster? [y/N] " answer
  [[ "$answer" == [yY] ]] || { echo "Cancelled."; exit 1; }
fi

k get namespace "$NS" >/dev/null || { echo "Namespace $NS does not exist." >&2; exit 1; }

k apply -f - <<'YAML'
${manifests}YAML

${tokenBlock}

# Cluster address and CA from the current kubeconfig.
CLUSTER=$(k config view --minify -o jsonpath='{.clusters[0].name}')
SERVER=$(k config view --minify -o jsonpath='{.clusters[0].cluster.server}')
CA=$(k config view --minify --raw -o jsonpath='{.clusters[0].cluster.certificate-authority-data}')
if [ -z "$CA" ]; then
  CA_FILE=$(k config view --minify -o jsonpath='{.clusters[0].cluster.certificate-authority}')
  if [ -n "$CA_FILE" ]; then CA=$(base64 < "$CA_FILE" | tr -d '\\n'); fi
fi
CA_LINE=""
if [ -n "$CA" ]; then CA_LINE="      certificate-authority-data: $CA"; fi

umask 077
cat > "$OUT" <<EOF
apiVersion: v1
kind: Config
clusters:
  - name: $CLUSTER
    cluster:
      server: $SERVER
$CA_LINE
users:
  - name: $SA
    user:
      token: $TOKEN
contexts:
  - name: $SA@$CLUSTER
    context:
      cluster: $CLUSTER
      namespace: $NS
      user: $SA
current-context: $SA@$CLUSTER
EOF
chmod 600 "$OUT"

echo "Wrote $OUT. What it can do in $NS:"
kubectl --kubeconfig "$OUT" auth can-i --list -n "$NS"
`;

  const ctxFlag = o.context?.trim() ? ` --context ${shq(o.context.trim())}` : '';
  const kc = `kubectl${ctxFlag}`;
  const cleanup = [
    ...(ctxFlag ? [] : ['# Runs against your current context. Add --context <name> if that is not the cluster you used.']),
    `${kc} delete ${cluster ? 'clusterrolebinding' : 'rolebinding'} ${roleName}${cluster ? '' : ` -n ${ns}`}`,
    ...(preset.builtIn ? [] : [`${kc} delete ${cluster ? 'clusterrole' : 'role'} ${roleName}${cluster ? '' : ` -n ${ns}`}`]),
    ...(o.token === 'long' ? [`${kc} delete secret ${name}-token -n ${ns}`] : []),
    `${kc} delete serviceaccount ${name} -n ${ns}`,
    `rm -f ${out}`,
  ].join('\n') + '\n';

  return { manifests, script, cleanup, rbacYaml, warnings };
}
