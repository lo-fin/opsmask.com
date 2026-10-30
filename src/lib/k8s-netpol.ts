// Explains NetworkPolicies in plain words and evaluates whether a connection is allowed.
import { matchesSelector, type LabelSelector, type Labels } from './k8s-selector';

export type PolicyText = { id: string; ns: string; appliesTo: string; ingress: string[]; egress: string[]; notes: string[] };
export type Endpoint = { ns: string; labels: Labels; nsLabels: Labels };
export type Verdict = { allowed: boolean; reasons: string[] };

const isEmpty = (sel?: LabelSelector | null) => !!sel && !Object.keys(sel.matchLabels ?? {}).length && !(sel.matchExpressions ?? []).length;

export function selectorText(sel?: LabelSelector | null): string {
  const parts = [
    ...Object.entries(sel?.matchLabels ?? {}).map(([k, v]) => `${k}=${v}`),
    ...(sel?.matchExpressions ?? []).map((r) => {
      const v = (r.values ?? []).join(',');
      return { In: `${r.key} in (${v})`, NotIn: `${r.key} notin (${v})`, Exists: `has ${r.key}`, DoesNotExist: `no ${r.key}` }[r.operator] ?? r.key;
    }),
  ];
  return parts.join(', ');
}

function peerText(p: any, dir: 'from' | 'to'): string {
  if (p?.ipBlock) {
    const except = p.ipBlock.except?.length ? ` except ${p.ipBlock.except.join(', ')}` : '';
    return `${dir} IP range ${p.ipBlock.cidr}${except}`;
  }
  const pods = p?.podSelector ? (isEmpty(p.podSelector) ? 'any pod' : `pods with ${selectorText(p.podSelector)}`) : null;
  if (p?.namespaceSelector) {
    const nss = isEmpty(p.namespaceSelector) ? 'any namespace' : `namespaces with ${selectorText(p.namespaceSelector)}`;
    return `${dir} ${pods ?? 'any pod'} in ${nss}`;
  }
  return `${dir} ${pods ?? 'any pod'} in the same namespace`;
}

function portsText(ports?: any[]): string {
  if (!ports?.length) return 'on any port';
  return 'on ' + ports.map((p) => {
    const proto = p?.protocol ?? 'TCP';
    if (p?.port == null) return `any ${proto} port`;
    return `${proto} ${p.port}${p.endPort ? `–${p.endPort}` : ''}`;
  }).join(', ');
}

const policyTypes = (spec: any): string[] => spec?.policyTypes ?? ['Ingress', ...(spec?.egress ? ['Egress'] : [])];

function directionText(spec: any, type: 'Ingress' | 'Egress'): string[] {
  if (!policyTypes(spec).includes(type)) return [];
  const key = type === 'Ingress' ? 'ingress' : 'egress';
  const peerKey = type === 'Ingress' ? 'from' : 'to';
  const rules: any[] = spec?.[key] ?? [];
  if (!rules.length) return [`All ${key} traffic is denied.`];
  return rules.map((r) => {
    const peers: any[] = r?.[peerKey] ?? [];
    const who = peers.length ? peers.map((p) => peerText(p, peerKey)).join('; or ') : `${peerKey} anywhere`;
    return `Allowed ${who}, ${portsText(r?.ports)}.`;
  });
}

const allowsDns = (spec: any) => (spec?.egress ?? []).some((r: any) =>
  !r?.ports?.length || r.ports.some((p: any) => p?.port == null || Number(p.port) === 53 || p.port === 'dns' || p.port === 'dns-tcp'));

function policyNotes(spec: any, dnsAllowedElsewhere: boolean): string[] {
  const notes: string[] = [];
  for (const [key, peerKey] of [['ingress', 'from'], ['egress', 'to']] as const) {
    for (const r of spec?.[key] ?? []) {
      const peers: any[] = r?.[peerKey] ?? [];
      const nsOnly = peers.some((p) => p?.namespaceSelector && !p.podSelector);
      const podOnly = peers.some((p) => p?.podSelector && !p.namespaceSelector);
      if (nsOnly && podOnly)
        notes.push(`An ${key} rule lists namespaceSelector and podSelector as separate items, which means either one (OR). To allow only matching pods inside matching namespaces, put both selectors in the same list item.`);
    }
  }
  if (policyTypes(spec).includes('Egress') && !dnsAllowedElsewhere && !allowsDns(spec))
    notes.push('Egress is restricted and no policy here allows port 53, so DNS lookups will fail. Allow UDP and TCP 53 to kube-dns.');
  if ((spec?.ingress ?? []).concat(spec?.egress ?? []).some((r: any) => (r?.from ?? r?.to ?? []).some((p: any) => p?.ipBlock)))
    notes.push('ipBlock is meant for traffic outside the cluster. Pod IPs change, so select pods with labels instead.');
  return notes;
}

export function explainPolicies(docs: any[]): PolicyText[] {
  const policies = docs.filter((d) => d?.kind === 'NetworkPolicy');
  const dns = policies.some((d) => allowsDns(d.spec));
  return policies.map((d) => {
    const ns = d.metadata?.namespace ?? 'default';
    const sel = d.spec?.podSelector;
    return {
      id: `NetworkPolicy/${d.metadata?.name ?? '?'}`,
      ns,
      appliesTo: !sel || isEmpty(sel) ? `every pod in namespace ${ns}` : `pods with ${selectorText(sel)} in namespace ${ns}`,
      ingress: directionText(d.spec, 'Ingress'),
      egress: directionText(d.spec, 'Egress'),
      notes: policyNotes(d.spec, dns),
    };
  });
}

// Namespaces always carry this label, so selectors on it work without setup.
const withNameLabel = (e: Endpoint): Labels => ({ 'kubernetes.io/metadata.name': e.ns, ...e.nsLabels });

function peerMatches(p: any, policyNs: string, other: Endpoint): boolean {
  if (p?.ipBlock) return false;
  const podOk = p?.podSelector ? matchesSelector(p.podSelector, other.labels) : true;
  if (p?.namespaceSelector) return podOk && matchesSelector(p.namespaceSelector, withNameLabel(other));
  return podOk && other.ns === policyNs;
}

function portMatches(ports: any[] | undefined, port: string, proto: string): boolean {
  if (!ports?.length) return true;
  return ports.some((p) => {
    if ((p?.protocol ?? 'TCP') !== proto) return false;
    if (p?.port == null) return true;
    if (String(p.port) === port) return true;
    const n = Number(port);
    return p.endPort != null && Number.isFinite(n) && n >= Number(p.port) && n <= p.endPort;
  });
}

function side(docs: any[], self: Endpoint, other: Endpoint, type: 'Ingress' | 'Egress', port: string, proto: string): Verdict {
  const key = type === 'Ingress' ? 'ingress' : 'egress';
  const peerKey = type === 'Ingress' ? 'from' : 'to';
  const policies = docs.filter((d) => d?.kind === 'NetworkPolicy'
    && (d.metadata?.namespace ?? 'default') === self.ns
    && matchesSelector(d.spec?.podSelector ?? {}, self.labels)
    && policyTypes(d.spec).includes(type));
  if (!policies.length) return { allowed: true, reasons: [`No ${type.toLowerCase()} policy selects the ${type === 'Ingress' ? 'destination' : 'source'} pod, so ${key} is open.`] };
  const allowing = policies.filter((d) => (d.spec?.[key] ?? []).some((r: any) =>
    (!(r?.[peerKey]?.length) || r[peerKey].some((p: any) => peerMatches(p, self.ns, other))) && portMatches(r?.ports, port, proto)));
  const names = (ps: any[]) => ps.map((d) => d.metadata?.name).join(', ');
  return allowing.length
    ? { allowed: true, reasons: [`${type} allowed by ${names(allowing)}.`] }
    : { allowed: false, reasons: [`${type} blocked: ${names(policies)} select${policies.length === 1 ? 's' : ''} the ${type === 'Ingress' ? 'destination' : 'source'} pod but no rule allows this ${type === 'Ingress' ? 'source' : 'destination'} and port.`] };
}

/** Is a connection from `src` to `dst` on `port`/`proto` allowed by the given policies? */
export function evaluate(docs: any[], src: Endpoint, dst: Endpoint, port: string, proto = 'TCP'): Verdict {
  const egress = side(docs, src, dst, 'Egress', port, proto);
  const ingress = side(docs, dst, src, 'Ingress', port, proto);
  return { allowed: egress.allowed && ingress.allowed, reasons: [...egress.reasons, ...ingress.reasons] };
}
