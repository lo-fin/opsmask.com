// Masks secrets and identifying values before text is pasted into an AI chat.
// Pure function, runs client-side only.

export type RedactOptions = { secrets: boolean; ips: boolean; identifiers: boolean };

export type RedactResult = { text: string; count: number };

const SECRET_KEYS =
  'password|passwd|pwd|secret|client_secret|token|access_token|refresh_token|api_key|apikey|accountkey|sharedaccesskey|access_key|secret_key|private_key|connectionstring';

export function redact(input: string, opts: RedactOptions): RedactResult {
  let text = input;
  let count = 0;
  const sub = (re: RegExp, fn: (...m: string[]) => string) => {
    text = text.replace(re, (...m: any[]) => {
      count++;
      return fn(...m);
    });
  };

  if (opts.secrets) {
    sub(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, () => '[REDACTED_PRIVATE_KEY]');
    sub(/\beyJ[\w-]{8,}\.eyJ[\w-]{8,}\.[\w-]+/g, () => '[REDACTED_JWT]');
    sub(/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/g, () => '[REDACTED_GITHUB_TOKEN]');
    sub(/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, () => '[REDACTED_AWS_KEY]');
    sub(/\bsk-[A-Za-z0-9_-]{20,}\b/g, () => '[REDACTED_API_KEY]');
    sub(/(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, (_m, p) => `${p}[REDACTED_TOKEN]`);
    sub(/([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/gi, (_m, p) => `${p}[REDACTED_SECRET]@`);
    // key=value / key: value / "key": "value"
    sub(
      new RegExp(`(["']?(?:${SECRET_KEYS})["']?\\s*[:=]\\s*["']?)(?!\\[REDACTED)([^"'\\s;,}]{3,})`, 'gi'),
      (_m, p) => `${p}[REDACTED_SECRET]`,
    );
  }

  const numbered = (re: RegExp, label: string) => {
    const seen = new Map<string, string>();
    sub(re, (m) => {
      if (!seen.has(m)) seen.set(m, `[${label}_${seen.size + 1}]`);
      return seen.get(m)!;
    });
  };

  if (opts.ips) {
    numbered(/\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g, 'IP');
  }
  if (opts.identifiers) {
    numbered(/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, 'EMAIL');
    numbered(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, 'GUID');
  }

  return { text, count };
}

export const MASK_PATTERN = /\[(?:REDACTED_[A-Z_]+|IP_\d+|EMAIL_\d+|GUID_\d+)\]/g;
