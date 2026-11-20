import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { explainRbac, ruleRisks } from './k8s-rbac';

const risks = (rule: object) => ruleRisks(rule).map((r) => r.text).join(' | ');

describe('ruleRisks', () => {
  it('flags reading Secrets, and stresses list', () => {
    expect(risks({ apiGroups: [''], resources: ['secrets'], verbs: ['get'] })).toMatch(/can read Secrets/);
    expect(risks({ apiGroups: [''], resources: ['secrets'], verbs: ['list'] })).toMatch(/list returns every value/);
  });
  it('flags escalation paths', () => {
    expect(risks({ apiGroups: [''], resources: ['pods/exec'], verbs: ['create'] })).toMatch(/exec into pods/);
    expect(risks({ apiGroups: ['apps'], resources: ['deployments'], verbs: ['patch'] })).toMatch(/can run pods/);
    expect(risks({ apiGroups: ['rbac.authorization.k8s.io'], resources: ['roles'], verbs: ['escalate', 'bind'] })).toMatch(/escalate.*bind/);
    expect(risks({ apiGroups: [''], resources: ['users'], verbs: ['impersonate'] })).toMatch(/impersonate/);
    expect(risks({ apiGroups: ['*'], resources: ['*'], verbs: ['*'] })).toMatch(/full access/);
  });
  it('says nothing about plain read access', () => {
    expect(ruleRisks({ apiGroups: [''], resources: ['pods', 'pods/log'], verbs: ['get', 'list', 'watch'] })).toEqual([]);
  });
});

describe('explainRbac', () => {
  const { roles, bindings, access } = explainRbac(yaml.loadAll(`
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata: { name: deployer, namespace: prod }
rules:
  - { apiGroups: [apps], resources: [deployments], verbs: [get, list, watch, update, patch] }
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata: { name: ci, namespace: prod }
subjects: [{ kind: ServiceAccount, name: gha, namespace: ci }]
roleRef: { kind: Role, name: deployer }
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata: { name: everyone-view }
subjects: [{ kind: Group, name: system:authenticated }]
roleRef: { kind: ClusterRole, name: view }
`));

  it('writes rules as sentences', () => {
    expect(roles[0].rules[0].text).toBe('Can read, update and patch deployments in the apps API group.');
  });
  it('explains binding scope and risky subjects', () => {
    expect(bindings[0].scope).toBe('namespace prod');
    expect(bindings[1].scope).toMatch(/cluster-wide/);
    expect(bindings[1].risks[0].text).toMatch(/every authenticated user/);
  });
  it('groups access by subject, including built-in roles not in the input', () => {
    const sa = access.find((a) => a.subject === 'ServiceAccount ci/gha')!;
    expect(sa.grants[0].risks.map((r) => r.text).join(' ')).toMatch(/can run pods/);
    const group = access.find((a) => a.subject === 'Group system:authenticated')!;
    expect(group.grants[0].known).toBe(true);
  });
});
