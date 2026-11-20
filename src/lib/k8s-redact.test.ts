import { describe, expect, it } from 'vitest';
import { redactK8s } from './k8s-redact';

const all = { secrets: true, ips: true, identifiers: true, endpoints: true };

// The point of this tool is that nothing sensitive survives, so each case asserts
// on the absence of the original value.
describe('redactK8s', () => {
  it('masks kubeconfig credentials and the API server host', () => {
    const { text } = redactK8s(`apiVersion: v1
kind: Config
clusters:
  - cluster:
      certificate-authority-data: LS0tLS1CRUdJTiBDRVJU
      server: https://aks-prod-dns-1a2b.hcp.westeurope.azmk8s.io:443
users:
  - user:
      client-key-data: LS0tLS1CRUdJTiBSU0E=
      token: abcdef0123456789`, all);
    for (const s of ['LS0tLS1CRUdJTiBDRVJU', 'LS0tLS1CRUdJTiBSU0E=', 'abcdef0123456789', 'aks-prod-dns-1a2b']) expect(text).not.toContain(s);
    expect(text).toContain('server: https://[CLUSTER_HOST_1]:443');
  });

  it('masks every Secret value, including block scalars, but not ConfigMap data', () => {
    const { text } = redactK8s(`apiVersion: v1
kind: Secret
metadata:
  name: s
  annotations:
    kubectl.kubernetes.io/last-applied-configuration: |
      {"data":{"x":"eHl6"}}
data:
  DB_PASSWORD: czNjcjN0
  tls.crt: |
    LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0t
    MIIBkTCB
type: Opaque
---
apiVersion: v1
kind: ConfigMap
data:
  LOG_LEVEL: debug`, all);
    for (const s of ['czNjcjN0', 'LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0t', 'MIIBkTCB', 'eHl6']) expect(text).not.toContain(s);
    expect(text).toContain('LOG_LEVEL: debug');
    expect(text).toContain('type: Opaque');
  });

  it('masks env values whose name looks secret, and numbers repeated IPs consistently', () => {
    const { text } = redactK8s(`env:
  - name: STORAGE_CONNECTION_STRING
    value: AccountKey=abc123==
  - name: HOST
    value: 10.1.2.3
  - name: OTHER
    value: 10.1.2.3`, all);
    expect(text).not.toContain('abc123');
    expect(text.match(/\[IP_1\]/g)).toHaveLength(2);
  });

  it('counts each masked value once', () => {
    expect(redactK8s('password: hunter22', all).count).toBe(1);
  });

  it('leaves text alone when every option is off', () => {
    const input = 'token: abc\nserver: https://x.example.com';
    expect(redactK8s(input, { secrets: false, ips: false, identifiers: false, endpoints: false }).text).toBe(input);
  });
});
