// Realistic `kubectl describe pod` and `get -o yaml` outputs, shared by the tests and the
// tool's "Load example" menu. Names and IDs are made up.

export const CRASH_OOM = `Name:             api-7d9c8b6f5-2kq9x
Namespace:        prod
Priority:         0
Service Account:  default
Node:             aks-nodepool1-12345678-vmss000001/10.224.0.5
Labels:           app=api
                  pod-template-hash=7d9c8b6f5
Annotations:      <none>
Status:           Running
IP:               10.244.1.23
Controlled By:  ReplicaSet/api-7d9c8b6f5
Containers:
  api:
    Container ID:   containerd://3f1c
    Image:          myregistry.azurecr.io/api:1.4.2
    Port:           8080/TCP
    State:          Waiting
      Reason:       CrashLoopBackOff
    Last State:     Terminated
      Reason:       OOMKilled
      Exit Code:    137
      Started:      Fri, 30 Oct 2026 09:20:11 +0700
      Finished:     Fri, 30 Oct 2026 09:20:45 +0700
    Ready:          False
    Restart Count:  6
    Limits:
      memory:  256Mi
    Requests:
      cpu:        100m
      memory:     128Mi
    Environment:
      DB_HOST:  postgres
Conditions:
  Type                        Status
  PodReadyToStartContainers   True
  Initialized                 True
  Ready                       False
  ContainersReady             False
  PodScheduled                True
QoS Class:                   Burstable
Events:
  Type     Reason     Age                 From               Message
  ----     ------     ----                ----               -------
  Normal   Scheduled  10m                 default-scheduler  Successfully assigned prod/api-7d9c8b6f5-2kq9x to aks-nodepool1-12345678-vmss000001
  Normal   Pulled     8m (x5 over 10m)    kubelet            Container image "myregistry.azurecr.io/api:1.4.2" already present on machine
  Warning  BackOff    2m (x25 over 9m)    kubelet            Back-off restarting failed container api in pod api-7d9c8b6f5-2kq9x_prod(5d1e)
`;

export const IMAGE_PULL = `Name:             web-5c9d4b7f8-qq1z
Namespace:        prod
Status:           Pending
Controlled By:  ReplicaSet/web-5c9d4b7f8
Containers:
  web:
    Container ID:
    Image:          myregistry.azurecr.io/web:1.4.3
    State:          Waiting
      Reason:       ImagePullBackOff
    Ready:          False
    Restart Count:  0
Conditions:
  Type              Status
  Initialized       True
  Ready             False
  PodScheduled      True
Events:
  Type     Reason     Age                From               Message
  ----     ------     ----               ----               -------
  Normal   Scheduled  5m                 default-scheduler  Successfully assigned prod/web-5c9d4b7f8-qq1z to aks-nodepool1-12345678-vmss000002
  Normal   Pulling    3m (x4 over 5m)    kubelet            Pulling image "myregistry.azurecr.io/web:1.4.3"
  Warning  Failed     3m (x4 over 5m)    kubelet            Failed to pull image "myregistry.azurecr.io/web:1.4.3": rpc error: code = NotFound desc = failed to resolve reference "myregistry.azurecr.io/web:1.4.3": myregistry.azurecr.io/web:1.4.3: not found
  Warning  Failed     3m (x4 over 5m)    kubelet            Error: ErrImagePull
  Warning  Failed     2m (x6 over 5m)    kubelet            Error: ImagePullBackOff
`;

export const PENDING = `Name:             worker-6c4d-9fj2k
Namespace:        jobs
Status:           Pending
Controlled By:  ReplicaSet/worker-6c4d
Containers:
  worker:
    Image:      worker:2.0.1
    Requests:
      cpu:        4
      memory:     8Gi
Conditions:
  Type           Status
  PodScheduled   False
Events:
  Type     Reason            Age                From               Message
  ----     ------            ----               ----               -------
  Warning  FailedScheduling  2m (x3 over 7m)    default-scheduler  0/3 nodes are available: 1 node(s) had untolerated taint {dedicated: gpu}, 2 Insufficient cpu. preemption: 0/3 nodes are available: 1 Preemption is not helpful for scheduling, 2 No preemption victims found for incoming pod.
`;

export const LIVENESS = `Name:         api-6f7b-x2x
Namespace:    prod
Status:       Running
Containers:
  api:
    Image:          api:1.4.2
    State:          Running
      Started:      Fri, 30 Oct 2026 10:01:00 +0700
    Last State:     Terminated
      Reason:       Error
      Exit Code:    137
    Ready:          False
    Restart Count:  3
Conditions:
  Type              Status
  Ready             False
  PodScheduled      True
Events:
  Type     Reason     Age                From     Message
  ----     ------     ----               ----     -------
  Warning  Unhealthy  1m (x9 over 4m)    kubelet  Liveness probe failed: Get "http://10.244.1.9:8080/healthz": context deadline exceeded (Client.Timeout exceeded while awaiting headers)
  Normal   Killing    1m (x3 over 4m)    kubelet  Container api failed liveness probe, will be restarted
`;

export const CONFIG_ERROR_YAML = `apiVersion: v1
kind: Pod
metadata:
  name: api-55c8-p0o9i
  namespace: prod
status:
  phase: Pending
  containerStatuses:
    - name: api
      image: api:1.4.2
      ready: false
      restartCount: 0
      state:
        waiting:
          reason: CreateContainerConfigError
          message: secret "api-secrets" not found
`;

export const EXAMPLES: Record<string, { label: string; text: string }> = {
  crash: { label: 'CrashLoopBackOff (OOMKilled)', text: CRASH_OOM },
  pull: { label: 'ImagePullBackOff', text: IMAGE_PULL },
  pending: { label: 'Pending (cannot schedule)', text: PENDING },
  liveness: { label: 'Restarted by liveness probe', text: LIVENESS },
  config: { label: 'CreateContainerConfigError (YAML)', text: CONFIG_ERROR_YAML },
};
