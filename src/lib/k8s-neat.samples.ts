// Typical `kubectl get -o yaml` output, shared by the tests and the tool's examples.

export const DEPLOYMENT_AND_SERVICE = `apiVersion: v1
items:
- apiVersion: apps/v1
  kind: Deployment
  metadata:
    annotations:
      deployment.kubernetes.io/revision: "7"
      kubectl.kubernetes.io/last-applied-configuration: |
        {"apiVersion":"apps/v1","kind":"Deployment","metadata":{"annotations":{},"name":"api","namespace":"prod"}}
      meta.helm.sh/release-name: api
      meta.helm.sh/release-namespace: prod
    creationTimestamp: "2026-09-02T08:14:51Z"
    generation: 12
    labels:
      app: api
      app.kubernetes.io/managed-by: Helm
    name: api
    namespace: prod
    resourceVersion: "48211907"
    uid: 6f1c2e3d-4a5b-4c6d-8e9f-0a1b2c3d4e5f
    managedFields:
    - apiVersion: apps/v1
      fieldsType: FieldsV1
      manager: helm
      operation: Update
  spec:
    progressDeadlineSeconds: 600
    replicas: 3
    revisionHistoryLimit: 10
    selector:
      matchLabels:
        app: api
    strategy:
      rollingUpdate:
        maxSurge: 25%
        maxUnavailable: 25%
      type: RollingUpdate
    template:
      metadata:
        annotations:
          kubectl.kubernetes.io/restartedAt: "2026-10-29T10:02:11+07:00"
        creationTimestamp: null
        labels:
          app: api
      spec:
        containers:
        - image: myregistry.azurecr.io/api:1.4.2
          imagePullPolicy: IfNotPresent
          livenessProbe:
            failureThreshold: 3
            httpGet:
              path: /healthz
              port: http
              scheme: HTTP
            periodSeconds: 10
            successThreshold: 1
            timeoutSeconds: 1
          name: api
          ports:
          - containerPort: 8080
            name: http
            protocol: TCP
          resources:
            limits:
              memory: 512Mi
            requests:
              cpu: 250m
              memory: 512Mi
          terminationMessagePath: /dev/termination-log
          terminationMessagePolicy: File
        dnsPolicy: ClusterFirst
        restartPolicy: Always
        schedulerName: default-scheduler
        securityContext: {}
        terminationGracePeriodSeconds: 60
  status:
    availableReplicas: 3
    observedGeneration: 12
    readyReplicas: 3
    replicas: 3
- apiVersion: v1
  kind: Service
  metadata:
    creationTimestamp: "2026-09-02T08:14:51Z"
    labels:
      app: api
    name: api
    namespace: prod
    resourceVersion: "41200311"
    uid: 0a1b2c3d-1111-2222-3333-444455556666
  spec:
    clusterIP: 10.0.143.27
    clusterIPs:
    - 10.0.143.27
    internalTrafficPolicy: Cluster
    ipFamilies:
    - IPv4
    ipFamilyPolicy: SingleStack
    ports:
    - name: http
      port: 80
      protocol: TCP
      targetPort: http
    selector:
      app: api
    sessionAffinity: None
    type: ClusterIP
  status:
    loadBalancer: {}
kind: List
metadata:
  resourceVersion: ""
`;

export const JOB = `apiVersion: batch/v1
kind: Job
metadata:
  creationTimestamp: "2026-10-30T02:00:00Z"
  generation: 1
  labels:
    batch.kubernetes.io/controller-uid: 7d2e9f10-aaaa-bbbb-cccc-0123456789ab
    batch.kubernetes.io/job-name: nightly-report
    controller-uid: 7d2e9f10-aaaa-bbbb-cccc-0123456789ab
    job-name: nightly-report
  name: nightly-report
  namespace: jobs
  resourceVersion: "48300001"
  uid: 7d2e9f10-aaaa-bbbb-cccc-0123456789ab
spec:
  backoffLimit: 6
  completionMode: NonIndexed
  completions: 1
  manualSelector: false
  parallelism: 1
  podReplacementPolicy: TerminatingOrFailed
  selector:
    matchLabels:
      batch.kubernetes.io/controller-uid: 7d2e9f10-aaaa-bbbb-cccc-0123456789ab
  suspend: false
  template:
    metadata:
      creationTimestamp: null
      labels:
        batch.kubernetes.io/controller-uid: 7d2e9f10-aaaa-bbbb-cccc-0123456789ab
        batch.kubernetes.io/job-name: nightly-report
        controller-uid: 7d2e9f10-aaaa-bbbb-cccc-0123456789ab
        job-name: nightly-report
    spec:
      containers:
      - image: reporter:3.1.0
        imagePullPolicy: IfNotPresent
        name: report
        resources: {}
        terminationMessagePath: /dev/termination-log
        terminationMessagePolicy: File
      dnsPolicy: ClusterFirst
      restartPolicy: OnFailure
      schedulerName: default-scheduler
      securityContext: {}
      terminationGracePeriodSeconds: 30
status:
  succeeded: 1
`;

export const POD = `apiVersion: v1
kind: Pod
metadata:
  creationTimestamp: "2026-10-30T03:12:03Z"
  generateName: api-7d9c8b6f5-
  labels:
    app: api
    pod-template-hash: 7d9c8b6f5
  name: api-7d9c8b6f5-2kq9x
  namespace: prod
  ownerReferences:
  - apiVersion: apps/v1
    blockOwnerDeletion: true
    controller: true
    kind: ReplicaSet
    name: api-7d9c8b6f5
    uid: 11111111-2222-3333-4444-555555555555
  resourceVersion: "48211990"
  uid: 99999999-8888-7777-6666-555555555555
spec:
  containers:
  - image: myregistry.azurecr.io/api:latest
    imagePullPolicy: Always
    name: api
    volumeMounts:
    - mountPath: /var/run/secrets/kubernetes.io/serviceaccount
      name: kube-api-access-x7k2p
      readOnly: true
  enableServiceLinks: true
  nodeName: aks-nodepool1-12345678-vmss000001
  preemptionPolicy: PreemptLowerPriority
  priority: 0
  serviceAccount: default
  serviceAccountName: default
  tolerations:
  - effect: NoExecute
    key: node.kubernetes.io/not-ready
    operator: Exists
    tolerationSeconds: 300
  - effect: NoExecute
    key: node.kubernetes.io/unreachable
    operator: Exists
    tolerationSeconds: 300
  volumes:
  - name: kube-api-access-x7k2p
    projected:
      sources:
      - serviceAccountToken:
          path: token
status:
  phase: Running
`;

export const EXAMPLES: Record<string, { label: string; text: string }> = {
  deploy: { label: 'Deployment and Service (List)', text: DEPLOYMENT_AND_SERVICE },
  job: { label: 'Job', text: JOB },
  pod: { label: 'Pod', text: POD },
};
