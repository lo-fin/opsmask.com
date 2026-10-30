// Masks Kubernetes-specific secrets in YAML (Secret data, kubeconfig credentials, secret env
// values) line by line so the formatting survives, then runs the generic redact().
import { redact, type RedactOptions } from './redact';

export type K8sRedactOptions = RedactOptions & { endpoints: boolean };

const KUBECONFIG_KEY = /^(\s*(?:-\s+)?)(certificate-authority-data|client-certificate-data|client-key-data|token|id-token|refresh-token|access-token|client-secret|password)(:\s*)(\S.*)$/;
const SECRET_ENV_NAME = /pass(word)?|secret|token|api_?key|access_?key|conn(ection)?_?str|private_?key/i;
const BLOCK_SCALAR = /^[|>][+-]?\d*\s*$/;
const indentOf = (l: string) => l.length - l.trimStart().length;

function redactStructure(doc: string): { text: string; count: number } {
  const isSecret = /^kind:\s*["']?Secret["']?\s*$/m.test(doc);
  const out: string[] = [];
  let count = 0;
  let dataIndent = -1;     // inside a Secret's data/stringData block
  let skipIndent = -1;     // dropping the body of a masked block scalar
  let envValueUntil = -1;  // a "value:" up to this line belongs to a secret-named env var

  doc.split('\n').forEach((line, i) => {
    const ind = indentOf(line);
    const blank = !line.trim();
    if (skipIndent >= 0) {
      if (blank || ind > skipIndent) return;
      skipIndent = -1;
    }
    if (dataIndent >= 0 && !blank && ind <= dataIndent) dataIndent = -1;

    const mask = (prefix: string, value: string, label = 'REDACTED_SECRET') => {
      count++;
      if (BLOCK_SCALAR.test(value)) skipIndent = ind;
      out.push(`${prefix}[${label}]`);
    };
    let m: RegExpExecArray | null;
    if (isSecret && (m = /^(\s*)(data|stringData):\s*$/.exec(line))) { dataIndent = m[1].length; out.push(line); }
    else if (dataIndent >= 0 && (m = /^(\s*(?:"[^"]*"|'[^']*'|[^:#\s][^:#]*?):\s*)(\S.*)$/.exec(line))) mask(m[1], m[2]);
    else if ((m = KUBECONFIG_KEY.exec(line))) mask(`${m[1]}${m[2]}${m[3]}`, m[4]);
    else if ((m = /^(\s*kubectl\.kubernetes\.io\/last-applied-configuration:\s*)(\S.*)$/.exec(line))) mask(m[1], m[2], 'REDACTED_LAST_APPLIED');
    else if (i <= envValueUntil && (m = /^(\s*(?:-\s+)?value:\s*)(\S.*)$/.exec(line))) { envValueUntil = -1; mask(m[1], m[2]); }
    else {
      if ((m = /^\s*(?:-\s+)?name:\s*["']?([\w.-]+)["']?\s*$/.exec(line)) && SECRET_ENV_NAME.test(m[1])) envValueUntil = i + 3;
      out.push(line);
    }
  });
  return { text: out.join('\n'), count };
}

export function redactK8s(input: string, opts: K8sRedactOptions): { text: string; count: number } {
  let text = input, count = 0;
  if (opts.secrets) {
    // Each YAML document separately, so "kind: Secret" only affects its own document.
    text = input.split(/^(?=---(?:\s|$))/m).map((doc) => {
      const r = redactStructure(doc);
      count += r.count;
      return r.text;
    }).join('');
  }
  if (opts.endpoints) {
    const seen = new Map<string, string>();
    text = text.replace(/^(\s*(?:-\s+)?server:\s*["']?https?:\/\/)([^\s:/"']+)/gm, (_m, p, host) => {
      count++;
      if (!seen.has(host)) seen.set(host, `[CLUSTER_HOST_${seen.size + 1}]`);
      return p + seen.get(host);
    });
  }
  const generic = redact(text, opts);
  return { text: generic.text, count: count + generic.count };
}

export const K8S_MASK_PATTERN = /\[(?:REDACTED_[A-Z_]+|IP_\d+|EMAIL_\d+|GUID_\d+|CLUSTER_HOST_\d+)\]/g;
