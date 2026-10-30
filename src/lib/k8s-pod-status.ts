// Explains why a pod is not healthy, from `kubectl describe pod` output or
// `kubectl get pod -o yaml|json`. Rules rely on exit codes, kubelet reasons and
// scheduler messages, which are stable across Kubernetes releases.

export type State = { kind: 'waiting' | 'running' | 'terminated'; reason?: string; message?: string; exitCode?: number; signal?: number };
export type ContainerInfo = { name: string; init: boolean; image?: string; state?: State; last?: State; ready?: boolean; restarts: number };
export type PodEvent = { type: string; reason: string; message: string; age?: string };
export type PodInfo = {
  name: string; namespace?: string; phase?: string; reason?: string; message?: string;
  conditions: { type: string; status: string; reason?: string; message?: string }[];
  containers: ContainerInfo[]; events: PodEvent[];
  deleting: boolean; finalizers: string[]; owner?: string; source: 'describe' | 'yaml';
};
export type Diagnosis = { severity: 'error' | 'warn' | 'info' | 'ok'; title: string; detail: string; next: string[] };
export type PodReport = { pod: PodInfo; summary: string; diagnoses: Diagnosis[] };

// ---------- parsing ----------

function stateFromObject(s: any): State | undefined {
  if (!s || typeof s !== 'object') return undefined;
  if (s.waiting) return { kind: 'waiting', reason: s.waiting.reason, message: s.waiting.message };
  if (s.terminated) return { kind: 'terminated', reason: s.terminated.reason, message: s.terminated.message, exitCode: s.terminated.exitCode, signal: s.terminated.signal };
  if (s.running) return { kind: 'running' };
  return undefined;
}

export function fromObject(pod: any): PodInfo {
  const st = pod.status ?? {};
  const containers = (list: any[] | undefined, init: boolean): ContainerInfo[] => (list ?? []).map((c) => ({
    name: c.name, init, image: c.image, state: stateFromObject(c.state), last: stateFromObject(c.lastState),
    ready: c.ready, restarts: c.restartCount ?? 0,
  }));
  return {
    name: pod.metadata?.name ?? '?', namespace: pod.metadata?.namespace,
    phase: st.phase, reason: st.reason, message: st.message,
    conditions: (st.conditions ?? []).map((c: any) => ({ type: c.type, status: c.status, reason: c.reason, message: c.message })),
    containers: [...containers(st.initContainerStatuses, true), ...containers(st.containerStatuses, false)],
    events: [], deleting: !!pod.metadata?.deletionTimestamp, finalizers: pod.metadata?.finalizers ?? [],
    owner: pod.metadata?.ownerReferences?.[0] ? `${pod.metadata.ownerReferences[0].kind}/${pod.metadata.ownerReferences[0].name}` : undefined,
    source: 'yaml',
  };
}

const indentOf = (l: string) => l.length - l.trimStart().length;
const field = (l: string) => /^\s*([A-Za-z][\w ./-]*?):\s*(.*)$/.exec(l);

/** Parses one pod's `kubectl describe pod` output. */
export function fromDescribe(text: string): PodInfo {
  const lines = text.replace(/\r/g, '').split('\n');
  const pod: PodInfo = { name: '?', conditions: [], containers: [], events: [], deleting: false, finalizers: [], source: 'describe' };
  let section = '';
  let current: ContainerInfo | null = null;
  let stateSlot: 'state' | 'last' | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const ind = indentOf(line);
    const m = field(line);

    if (ind === 0) {
      section = m?.[1] ?? '';
      current = null;
      const v = m?.[2]?.trim() ?? '';
      if (section === 'Name') pod.name = v;
      else if (section === 'Namespace') pod.namespace = v;
      else if (section === 'Status') {
        pod.phase = v.split(/\s/)[0];
        if (v.startsWith('Terminating')) pod.deleting = true;
      }
      else if (section === 'Reason') pod.reason = v;
      else if (section === 'Message') pod.message = v;
      else if (section === 'Controlled By') pod.owner = v;
      else if (section === 'Finalizers') pod.finalizers = v.replace(/[[\]]/g, '').split(/[\s,]+/).filter(Boolean);
      else if (section === 'Events' && lines[i + 1]?.trim().startsWith('Type')) i += 2; // header and dashes
      continue;
    }

    if (section === 'Containers' || section === 'Init Containers') {
      if (ind === 2 && /^\s{2}\S.*:\s*$/.test(line)) {
        current = { name: line.trim().slice(0, -1), init: section === 'Init Containers', restarts: 0 };
        pod.containers.push(current);
        stateSlot = null;
        continue;
      }
      if (!current || !m) continue;
      const key = m[1], val = m[2].trim();
      if (ind === 4) {
        stateSlot = null;
        if (key === 'State' || key === 'Last State') {
          stateSlot = key === 'State' ? 'state' : 'last';
          const kind = val.toLowerCase() as State['kind'];
          if (['waiting', 'running', 'terminated'].includes(kind)) current[stateSlot] = { kind };
        } else if (key === 'Ready') current.ready = val === 'True';
        else if (key === 'Restart Count') current.restarts = parseInt(val, 10) || 0;
        else if (key === 'Image') current.image = val;
      } else if (ind >= 6 && stateSlot && current[stateSlot]) {
        const s = current[stateSlot]!;
        if (key === 'Reason') s.reason = val;
        else if (key === 'Message') s.message = val;
        else if (key === 'Exit Code') s.exitCode = parseInt(val, 10);
        else if (key === 'Signal') s.signal = parseInt(val, 10);
      }
      continue;
    }

    if (section === 'Conditions') {
      const cols = line.trim().split(/\s+/);
      if (cols[0] !== 'Type' && !cols[0].startsWith('-') && cols.length >= 2) pod.conditions.push({ type: cols[0], status: cols[1] });
      continue;
    }

    if (section === 'Events') {
      const cols = line.trim().split(/\s{2,}/);
      if (cols.length >= 5 && /^(Normal|Warning)$/.test(cols[0])) {
        pod.events.push({ type: cols[0], reason: cols[1], age: cols[2], message: cols.slice(4).join('  ') });
      } else if (pod.events.length && ind > 2) {
        pod.events[pod.events.length - 1].message += ` ${line.trim()}`;
      }
    }
  }
  return pod;
}

/** Accepts describe output (one or many pods), or YAML/JSON of a Pod or a List. */
export function parsePods(text: string, loadYaml: (t: string) => unknown[]): PodInfo[] {
  const t = text.trim();
  if (!t) return [];
  if (/^Name:\s+\S/m.test(t) && /^(Namespace|Status|Containers):/m.test(t)) {
    return t.split(/^(?=Name:\s)/m).filter((chunk) => chunk.trim()).map(fromDescribe);
  }
  const docs = loadYaml(t).flatMap((d: any) => (Array.isArray(d?.items) ? d.items : [d]));
  const pods = docs.filter((d: any) => d?.kind === 'Pod' || (d?.status?.containerStatuses && d?.metadata));
  if (!pods.length) throw new Error('No pod found. Paste kubectl describe pod output, or kubectl get pod -o yaml.');
  return pods.map(fromObject);
}

// ---------- diagnosis ----------

const has = (s: string | undefined, re: RegExp) => !!s && re.test(s);

function exitCodeMeaning(code: number): string {
  if (code === 0) return 'the process finished successfully';
  if (code === 1) return 'a general application error';
  if (code === 126) return 'the command exists but cannot be executed (permissions or wrong format)';
  if (code === 127) return 'the command was not found in the image';
  if (code === 137) return 'killed with SIGKILL (out of memory, or killed after a failed liveness probe or shutdown timeout)';
  if (code === 139) return 'a segmentation fault (SIGSEGV)';
  if (code === 143) return 'stopped with SIGTERM, usually a normal shutdown';
  if (code > 128 && code < 160) return `killed by signal ${code - 128}`;
  return 'an application-specific error';
}

/** Splits "0/3 nodes are available: 2 Insufficient cpu, 1 node(s) had untolerated taint ..." into causes. */
function schedulingCauses(msg: string): Diagnosis[] {
  const out: Diagnosis[] = [];
  const add = (title: string, detail: string, next: string[] = []) => out.push({ severity: 'error', title, detail, next });
  // Resource names may contain dots (nvidia.com/gpu) but the message ends sentences with one.
  const res = [...msg.matchAll(/Insufficient ([\w./-]*[\w/])/gi)].map((x) => x[1]);
  if (res.length) {
    add(`Not enough ${[...new Set(res)].join(' and ')} on any node`, 'The pod’s requests are larger than what is left on every node. Lower the requests, free capacity, or add nodes (check that the cluster autoscaler can scale this node pool).',
      ['kubectl describe nodes | grep -A 8 "Allocated resources"', 'kubectl top nodes']);
  }
  if (/untolerated taint|had taint/i.test(msg)) {
    const taints = [...msg.matchAll(/taint \{([^}]*)\}/g)].map((x) => x[1]);
    add('Nodes are tainted', `Some nodes have taints the pod does not tolerate${taints.length ? ` (${[...new Set(taints)].join('; ')})` : ''}. Add a matching toleration, or schedule onto another node pool.`,
      ['kubectl get nodes -o custom-columns=NAME:.metadata.name,TAINTS:.spec.taints']);
  }
  if (/didn't match (Pod's )?node affinity|node\(s\) didn't match node selector|didn't match Pod's node affinity\/selector/i.test(msg))
    add('No node matches the nodeSelector or node affinity', 'Check the labels the pod asks for against the labels on your nodes. A typo or a removed node pool is the usual cause.',
      ['kubectl get nodes --show-labels']);
  if (/unbound immediate PersistentVolumeClaims|persistentvolumeclaim .* not found/i.test(msg))
    add('PersistentVolumeClaim is not bound', 'The pod waits for its volume. Check that the PVC exists, its StorageClass exists and can provision volumes.',
      ['kubectl get pvc', 'kubectl describe pvc <name>']);
  if (/volume node affinity conflict/i.test(msg))
    add('Volume is in another zone', 'The disk exists in a zone where no suitable node is available. Zonal disks cannot move: add nodes in that zone, or use a StorageClass with volumeBindingMode: WaitForFirstConsumer for new volumes.');
  if (/Too many pods/i.test(msg))
    add('Nodes are at their pod limit', 'Each node accepts a maximum number of pods. Add nodes, or raise max pods per node for new node pools.');
  if (/anti-affinity/i.test(msg))
    add('Pod anti-affinity cannot be satisfied', 'There are more replicas than nodes (or zones) that satisfy the anti-affinity rule. Use preferredDuringScheduling, topologySpreadConstraints with ScheduleAnyway, or add nodes.');
  if (/node\(s\) were unschedulable/i.test(msg))
    add('Nodes are cordoned', 'Some nodes are marked unschedulable, usually during an upgrade or drain.', ['kubectl get nodes']);
  if (/didn't have free ports/i.test(msg))
    add('Host port already in use', 'The pod asks for a hostPort that is taken on every node. Avoid hostPort, or run fewer replicas than nodes.');
  return out;
}

function diagnoseImagePull(c: ContainerInfo, text: string): Diagnosis {
  const next = [`kubectl describe pod ${'<pod>'} | grep -A 3 -i "failed to pull"`];
  const base = { severity: 'error' as const, next };
  if (/not found|manifest unknown|does not exist/i.test(text))
    return { ...base, title: `Image not found: ${c.image ?? ''}`, detail: 'The registry has no image with this name or tag. Check for typos, and that the build pushed this tag.' };
  if (/unauthorized|authentication required|401|403|denied|pull access denied/i.test(text))
    return { ...base, title: 'Registry refused the pull', detail: 'The node is not allowed to pull this image. Add imagePullSecrets to the pod or its service account, or give the cluster’s identity pull access to the registry (on AKS: az aks update --attach-acr).' };
  if (/toomanyrequests|rate limit/i.test(text))
    return { ...base, title: 'Registry rate limit', detail: 'Docker Hub limits anonymous pulls. Authenticate, or mirror the image into your own registry.' };
  if (/no match for platform|exec format/i.test(text))
    return { ...base, title: 'Image built for another CPU architecture', detail: 'The image has no variant for the node’s architecture (for example arm64 nodes and an amd64-only image). Build a multi-arch image, or schedule onto matching nodes.' };
  if (/i\/o timeout|no such host|dial tcp|connection refused|TLS handshake/i.test(text))
    return { ...base, title: 'Node cannot reach the registry', detail: 'Network or DNS problem between the node and the registry. Check egress firewall rules, private endpoints and DNS for the registry host.' };
  return { ...base, title: `Cannot pull image ${c.image ?? ''}`, detail: 'Read the full pull error in the events for the exact cause.' };
}

export function diagnose(pod: PodInfo): PodReport {
  const d: Diagnosis[] = [];
  const ns = pod.namespace ? ` -n ${pod.namespace}` : '';
  const P = pod.name;
  const warnings = pod.events.filter((e) => e.type === 'Warning');
  const eventText = (re: RegExp) => warnings.filter((e) => re.test(e.reason)).map((e) => e.message).join(' ');
  const logs = (c: ContainerInfo, previous = false) => `kubectl logs ${P}${ns} -c ${c.name}${previous ? ' --previous' : ''}`;

  // Pod-level problems first: they explain everything else.
  if (pod.reason === 'Evicted') {
    const res = /low on resource: ([\w-]+)/.exec(pod.message ?? '')?.[1];
    d.push({ severity: 'error', title: `Evicted${res ? ` because the node ran low on ${res}` : ''}`,
      detail: res === 'ephemeral-storage'
        ? 'The pod (or others on the node) wrote too much to local disk: logs, emptyDir or the container filesystem. Set ephemeral-storage requests and limits, and write large files to a volume.'
        : 'The kubelet evicted pods to protect the node. Pods using more than they request are evicted first: set memory requests close to real usage.',
      next: [`kubectl get pods${ns} --field-selector=status.phase=Failed`, `kubectl delete pods${ns} --field-selector=status.phase=Failed  # clean up evicted pods`] });
  }
  if (pod.reason === 'DeadlineExceeded')
    d.push({ severity: 'error', title: 'Job ran past activeDeadlineSeconds', detail: 'The pod was stopped because the Job’s deadline passed. Raise activeDeadlineSeconds or make the job faster.', next: [] });
  if (pod.reason === 'NodeLost' || pod.phase === 'Unknown')
    d.push({ severity: 'error', title: 'Node is not responding', detail: 'The kubelet on this pod’s node stopped reporting. The pod is replaced after the eviction timeout.', next: ['kubectl get nodes'] });

  const scheduled = pod.conditions.find((c) => c.type === 'PodScheduled');
  const schedMsg = [scheduled?.message, eventText(/FailedScheduling/)].filter(Boolean).join(' ');
  if ((scheduled?.status === 'False' || /FailedScheduling/.test(warnings.map((e) => e.reason).join(' '))) && pod.phase === 'Pending') {
    const causes = schedulingCauses(schedMsg);
    d.push(...(causes.length ? causes : [{ severity: 'error' as const, title: 'Pod cannot be scheduled', detail: schedMsg || 'The scheduler found no node for this pod. Run describe to see the scheduler’s message.', next: [`kubectl describe pod ${P}${ns}`] }]));
  }

  if (pod.deleting) {
    d.push({ severity: 'warn', title: 'Stuck in Terminating',
      detail: pod.finalizers.length
        ? `The pod has finalizers (${pod.finalizers.join(', ')}). It is removed only after the controller that owns them clears them.`
        : 'The node may be unreachable, so the kubelet cannot confirm the container stopped. Check the node before forcing deletion.',
      next: ['kubectl get nodes', `kubectl delete pod ${P}${ns} --grace-period=0 --force  # only if the node is gone`] });
  }

  // Volume and sandbox problems show up as events while the pod is ContainerCreating.
  const mount = eventText(/FailedMount|FailedAttachVolume/);
  if (/Multi-Attach/i.test(mount))
    d.push({ severity: 'error', title: 'Volume is still attached to another node', detail: 'A ReadWriteOnce disk can be attached to one node at a time. The old pod or node has not released it yet; it usually clears after a few minutes. Deployments with RWO volumes should use strategy: Recreate.', next: [`kubectl get volumeattachments | grep <pv-name>`] });
  else if (/secret .* not found|configmap .* not found/i.test(mount)) {
    const what = /(secret|configmap) "?([\w.-]+)"? not found/i.exec(mount);
    d.push({ severity: 'error', title: `Missing ${what ? `${what[1]} “${what[2]}”` : 'Secret or ConfigMap'} for a volume`, detail: 'A volume refers to an object that does not exist in this namespace.', next: [`kubectl get secrets,configmaps${ns}`] });
  } else if (mount)
    d.push({ severity: 'error', title: 'Volume cannot be mounted', detail: mount.slice(0, 400), next: ['kubectl get pvc', 'kubectl get events --field-selector reason=FailedMount'] });
  const sandbox = eventText(/FailedCreatePodSandBox/);
  if (sandbox)
    d.push({ severity: 'error', title: 'Pod network could not be set up', detail: /no IP addresses available|failed to allocate|IP exhaustion|subnet/i.test(sandbox)
      ? 'The CNI ran out of IP addresses. The node subnet (or pod CIDR) is full: use a larger subnet, lower max pods per node, or move to an overlay network mode.'
      : `The CNI plugin failed: ${sandbox.slice(0, 300)}`, next: ['kubectl get pods -n kube-system -o wide | grep -iE "cni|azure|calico|cilium"'] });

  for (const c of pod.containers) {
    const where = `${c.init ? 'Init container' : 'Container'} “${c.name}”`;
    const s = c.state, last = c.last;
    const reason = s?.reason ?? '';
    const pullText = `${s?.message ?? ''} ${eventText(/Failed|BackOff|ErrImagePull/)}`;

    if (/ImagePullBackOff|ErrImagePull|InvalidImageName/.test(reason)) {
      const x = reason === 'InvalidImageName'
        ? { severity: 'error' as const, title: `Invalid image name: ${c.image ?? ''}`, detail: 'The image reference is malformed (upper-case letters, spaces, or a stray character).', next: [] }
        : diagnoseImagePull(c, pullText);
      d.push({ ...x, title: `${where}: ${x.title}`, next: x.next.map((n) => n.replace('<pod>', `${P}${ns}`)) });
      continue;
    }
    if (reason === 'CreateContainerConfigError') {
      const msg = s?.message ?? eventText(/Failed/);
      const missing = /(secret|configmap) "?([\w.-]+)"? not found|couldn't find key ([\w.-]+) in (Secret|ConfigMap) ([\w./-]+)/i.exec(msg);
      d.push({ severity: 'error', title: `${where}: configuration error`,
        detail: /runAsNonRoot/i.test(msg)
          ? 'runAsNonRoot is set but the image runs as root. Set runAsUser to a non-zero UID, or build the image with a USER.'
          : missing
            ? `The pod refers to ${missing[1] ? `${missing[1]} “${missing[2]}”` : `key “${missing[3]}” in ${missing[4]} “${missing[5]}”`}, which does not exist in this namespace.`
            : msg || 'An env var or volume refers to a Secret or ConfigMap that is missing.',
        next: [`kubectl get secrets,configmaps${ns}`] });
      continue;
    }
    if (reason === 'CreateContainerError' || reason === 'RunContainerError') {
      const msg = s?.message ?? eventText(/Failed/);
      d.push({ severity: 'error', title: `${where}: container could not start`,
        detail: /executable file not found|no such file or directory/i.test(msg)
          ? 'The command or entrypoint does not exist in the image. Check command/args in the manifest against the image.'
          : msg || 'The runtime could not create the container.', next: [`kubectl describe pod ${P}${ns}`] });
      continue;
    }

    // An init container that finished is fine, even if it needed retries.
    if (c.init && s?.kind === 'terminated' && s.exitCode === 0) continue;
    const crashing = reason === 'CrashLoopBackOff';
    const term = s?.kind === 'terminated' ? s : last?.kind === 'terminated' ? last : undefined;
    if (crashing || (term && (term.exitCode ?? 0) !== 0) || (term && c.restarts > 0)) {
      const code = term?.exitCode;
      const oom = term?.reason === 'OOMKilled';
      const unhealthy = eventText(/Unhealthy/);
      const livenessKill = /Liveness probe failed/i.test(unhealthy) || eventText(/Killing/).includes('liveness');
      let title: string, detail: string;
      const next = [logs(c, true)];
      if (oom) {
        title = 'killed for using more memory than its limit (OOMKilled)';
        detail = 'Raise the memory limit, or find the leak. For JVM or .NET apps, check that the heap limit follows the container limit.';
        next.push(`kubectl top pod ${P}${ns} --containers`);
      } else if (code === 137 && livenessKill) {
        title = 'killed after its liveness probe failed';
        detail = `The kubelet restarted the container because the liveness probe kept failing${unhealthy ? `: ${unhealthy.slice(0, 200)}` : ''}. Often the app is slow to start: add a startupProbe, or check that the probe path and port are right.`;
      } else if (code === 0 && !c.init) {
        title = 'exits with code 0 and is restarted';
        detail = 'The process finishes successfully, but Deployments expect it to keep running. Make the command a long-running process, or use a Job for one-off work.';
      } else if (code != null) {
        title = `exits with code ${code}`;
        detail = `Exit code ${code} means ${exitCodeMeaning(code)}. The previous container’s logs show why.`;
      } else {
        title = 'keeps crashing';
        detail = 'The container exits soon after starting. The previous container’s logs show why.';
      }
      if (c.init) detail += ' Init containers must succeed before the app containers start.';
      d.push({ severity: 'error', title: `${where} ${title}`, detail: `${detail}${c.restarts ? ` Restarted ${c.restarts} times.` : ''}`, next });
      continue;
    }

    if (s?.kind === 'running' && c.ready === false && !c.init) {
      const unhealthy = eventText(/Unhealthy/);
      d.push({ severity: 'warn', title: `${where} is running but not ready`,
        detail: unhealthy ? `The readiness probe fails: ${unhealthy.slice(0, 250)}. The pod gets no traffic from Services until it passes.` : 'Its readiness probe is failing, so Services send it no traffic. Check the probe path, port and timeout.',
        next: [logs(c), `kubectl describe pod ${P}${ns} | grep -A 3 Readiness`] });
    } else if (s?.kind === 'waiting' && reason === 'PodInitializing') {
      // Covered by the init container entries.
    } else if (s?.kind === 'waiting' && reason === 'ContainerCreating' && !d.length) {
      d.push({ severity: 'info', title: `${where} is being created`, detail: 'Usually pulling the image or mounting volumes. If it stays here, run describe and check the events.', next: [`kubectl describe pod ${P}${ns}`] });
    } else if (c.restarts > 0 && s?.kind === 'running') {
      d.push({ severity: 'info', title: `${where} restarted ${c.restarts} time${c.restarts > 1 ? 's' : ''}`, detail: 'It is running now. The previous run’s logs show why it stopped.', next: [logs(c, true)] });
    }
  }

  if (!d.length) {
    const healthy = pod.phase === 'Running' || pod.phase === 'Succeeded';
    d.push(healthy
      ? { severity: 'ok', title: 'No problem found', detail: pod.source === 'yaml' ? 'Container states look healthy. Paste kubectl describe output to include recent events.' : 'Containers are running and no warning events were found.', next: [] }
      : { severity: 'info', title: `Phase: ${pod.phase ?? 'unknown'}`, detail: 'No known pattern matched. Check the events and logs.', next: [`kubectl describe pod ${P}${ns}`, `kubectl get events${ns} --sort-by=.lastTimestamp`] });
  }

  const states = pod.containers.map((c) => c.state?.reason ?? (c.state?.kind === 'running' ? (c.ready === false ? 'NotReady' : 'Running') : c.state?.kind)).filter(Boolean);
  const summary = [pod.deleting ? 'Terminating' : pod.reason ?? pod.phase, ...new Set(states)].filter(Boolean).join(' · ');
  return { pod, summary, diagnoses: d };
}
