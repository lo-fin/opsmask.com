// Kubernetes label selectors: the object form (matchLabels / matchExpressions) used in
// manifests, and the string form used by `kubectl get -l`.

export type Operator = 'In' | 'NotIn' | 'Exists' | 'DoesNotExist';
export type Requirement = { key: string; operator: Operator; values?: string[] };
export type LabelSelector = { matchLabels?: Record<string, unknown>; matchExpressions?: Requirement[] };
export type Labels = Record<string, unknown>;

const has = (labels: Labels, k: string) => Object.prototype.hasOwnProperty.call(labels, k);

/** Equality-only selector, as used by Service.spec.selector. */
export function matchesLabels(want: Labels | undefined, labels: Labels = {}): boolean {
  return Object.entries(want ?? {}).every(([k, v]) => has(labels, k) && String(labels[k]) === String(v));
}

export function matchesRequirement(r: Requirement, labels: Labels = {}): boolean {
  const values = (r.values ?? []).map(String);
  switch (r.operator) {
    case 'In': return has(labels, r.key) && values.includes(String(labels[r.key]));
    case 'NotIn': return !has(labels, r.key) || !values.includes(String(labels[r.key]));
    case 'Exists': return has(labels, r.key);
    case 'DoesNotExist': return !has(labels, r.key);
    default: return false;
  }
}

/** An empty selector ({}) matches everything; a missing one matches nothing. */
export function matchesSelector(sel: LabelSelector | undefined | null, labels: Labels = {}): boolean {
  if (!sel || typeof sel !== 'object') return false;
  return matchesLabels(sel.matchLabels, labels) && (sel.matchExpressions ?? []).every((r) => matchesRequirement(r, labels));
}

/**
 * Parses the kubectl string form into requirements:
 *   app=web, tier!=db, env in (prod,staging), track notin (canary), release, !legacy
 */
export function parseSelector(input: string): Requirement[] {
  const out: Requirement[] = [];
  // Split on commas that are not inside parentheses.
  const parts: string[] = [];
  let depth = 0, cur = '';
  for (const ch of input) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  if (depth !== 0) throw new Error('Unbalanced parentheses.');
  parts.push(cur);

  for (const raw of parts) {
    const p = raw.trim();
    if (!p) continue;
    let m: RegExpExecArray | null;
    if ((m = /^([\w./-]+)\s+(in|notin)\s*\(([^)]*)\)$/i.exec(p))) {
      const values = m[3].split(',').map((v) => v.trim()).filter(Boolean);
      out.push({ key: m[1], operator: m[2].toLowerCase() === 'in' ? 'In' : 'NotIn', values });
    } else if ((m = /^([\w./-]+)\s*(==|=|!=)\s*([\w.-]*)$/.exec(p))) {
      out.push({ key: m[1], operator: m[2] === '!=' ? 'NotIn' : 'In', values: [m[3]] });
    } else if ((m = /^!\s*([\w./-]+)$/.exec(p))) {
      out.push({ key: m[1], operator: 'DoesNotExist' });
    } else if ((m = /^([\w./-]+)$/.exec(p))) {
      out.push({ key: m[1], operator: 'Exists' });
    } else {
      throw new Error(`Cannot parse “${p}”.`);
    }
  }
  return out;
}
