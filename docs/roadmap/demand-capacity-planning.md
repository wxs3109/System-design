# Demand and Capacity Planning Roadmap

> Status: proposed. This roadmap adds explainable demand estimation, resource sizing, bottleneck simulation, and capacity-boundary analysis to the existing generic workbench. It is not specific to video delivery or any other example.

## 1. Outcome

The workbench must support one closed planning loop:

1. Describe business demand using inputs such as population, activity frequency, peak shape, concurrent sessions, payload sizes, retention, and growth.
2. Derive average and peak request rates, concurrency, ingress and egress bandwidth, internal amplification, daily writes, and retained data.
3. Recommend an explainable starting resource envelope for the existing topology, including replicas, servers, workers, partitions, link bandwidth, and storage.
4. Preview and apply those recommendations as normal editable project configuration.
5. Let the user change demand or manually tune every supported node capacity, such as replica count, server count, per-server throughput, concurrency, bandwidth, and storage.
6. Run the design and show where capacity is exhausted: service queues grow, workers fall behind, broker backlog accumulates, shared bandwidth congests, storage exceeds its planning horizon, or an SLO is missed.
7. Compare the current design, the generated recommendation, and manual alternatives, including the maximum supported demand under explicit pass criteria.

The feature is intended for learning and order-of-magnitude planning. Every number must expose its formula, units, input assumptions, and provenance. No output is a production capacity promise.

## 2. Product contract

### 2.1 Required behavior

- Demand inputs are project data, not fields hard-coded for a named example.
- A large population is converted into rates and distributions. The simulator does not create one event for every real user.
- Existing API, Interaction, Operation Workload, topology, component, policy, and fault contracts remain the source of architectural meaning.
- Internal calls, fan-out, asynchronous work, cache branches, event copies, retries, and replication are counted once and attributed to the node or link that handles them.
- Current capacity and recommended capacity are shown side by side. Applying a recommendation is explicit, undoable, and produces an ordinary project edit.
- Every capacity knob can be locked. The solver must preserve locked and unsupported values and report an unmet constraint instead of silently overriding them.
- Analytic estimates and discrete simulation results remain visibly distinct. A formula can predict saturation; only a run can claim measured queue growth or failures in the modeled runtime.
- Recommendations cite their limiting dimensions. For example, a Service can be limited by request rate, concurrency, or server NIC capacity, while an Object Storage node can be limited by bytes, read throughput, write throughput, or request rate.
- Unknown inputs remain unknown or use a clearly labeled teaching default. They are never presented as measured facts.

### 2.2 Non-goals

- Automatically inventing an architecture or adding component types to the Canvas. The first version sizes the topology the user designed. Structural review can separately suggest that a capability is missing.
- Provisioning real cloud resources, choosing vendor SKUs, or estimating current vendor prices.
- Treating DAU as concurrency or simulating billions of individual requests.
- Packet-level networking, TCP congestion control, operating-system scheduling, a database optimizer, or a storage-engine benchmark.
- Hiding uncertainty behind an AI score or one unexplained "recommended" number.
- Optimizing for cost before a versioned cost catalog and an explicit objective exist.

## 3. Current baseline and gaps

The existing platform already provides useful execution foundations:

- constant and Poisson request arrivals;
- operation-aware interactions and internal action paths;
- finite component concurrency and bounded queues;
- replicas multiplied by per-replica concurrency for Services;
- Queue, Stream, Topic, cache, CDN, database, Object Storage, Realtime Gateway, Workflow, and routing behavior;
- queue depth, utilization, latency, failures, stream lag, Topic backlog, cache behavior, hot shards, and retry evidence;
- a saturation finding when utilization remains at least 80 percent while a queue grows;
- saved run comparison and deterministic replay.

The following gaps prevent the requested planning loop:

1. Business scale such as DAU cannot yet compile into an `OperationWorkload`.
2. Components do not expose one common, versioned capacity-planning contract.
3. The product does not calculate replicas, servers, consumers, bandwidth, or storage requirements.
4. Network, CDN, and Object Storage transfer times do not yet contend for a shared aggregate byte-rate resource. Concurrent requests can therefore each appear to receive the configured throughput.
5. Response bytes are not fully executed on operation paths, and full-run edge byte metrics do not exist.
6. Retention and physical storage amplification are not projected over a planning horizon.
7. There is no automatic demand sweep or search for the first failing capacity boundary.
8. Very large rates cannot be represented efficiently by creating one discrete runtime request per real request.

## 4. Three separate outputs

The UI and data contracts must not collapse these outputs into one result.

### 4.1 Derived demand

Deterministic formulas translate user assumptions into normalized load dimensions:

- average and peak root operations per second;
- peak concurrent requests or sessions;
- request, response, sustained ingress, sustained egress, and internal bytes per second;
- operation and message amplification by action, node, and connection;
- records and logical bytes created per day;
- logical and physical retained bytes at the selected horizon.

### 4.2 Resource recommendations

The sizing solver compares derived demand with per-node capacity profiles and returns a previewable set of configuration patches. Each recommendation contains:

- current value and proposed value;
- demand dimension and required capacity;
- per-unit capacity and target utilization;
- failure or growth headroom;
- exact formula and rounded result;
- assumption provenance;
- limiting dimension;
- confidence state: `measured`, `user-assumed`, `teaching-default`, or `unknown`;
- any lock, incompatibility, or unsatisfied constraint.

Recommendations do not modify the project until applied. A recommendation result is not reused after its input hash, topology revision, or formula-engine version changes.

### 4.3 Simulation evidence

The runtime reports what happened under a concrete project snapshot and experiment:

- achieved throughput and latency;
- utilization and queue growth;
- accepted, rejected, timed-out, and unfinished work;
- broker and worker backlog plus drain rate;
- shared-link utilization, byte backlog, transfer wait, and dropped bytes;
- storage capacity crossing within the selected horizon;
- evidence-backed bottlenecks and the first violated pass criterion.

The result view must label formula outputs as `estimated` and runtime outputs as `simulated`.

## 5. Generic demand model

ProjectFile v4 adds a versioned planning catalog and an optional planning-scenario reference on each experiment. Importing v3 creates an empty planning catalog and preserves existing execution exactly.

The contract should represent business concepts without naming products:

```typescript
interface DemandModelV1 {
  schemaVersion: 1
  id: string
  name: string
  actorGroups: ActorGroup[]
  activities: DemandActivity[]
  persistence: PersistenceProjection[]
}

interface ActorGroup {
  id: string
  name: string
  population: number
  annualGrowthRate?: number
}

type ActivityVolume =
  | { kind: 'per-actor'; actorGroupId: string; participatingFraction: number; occurrencesPerActor: number; periodSeconds: number }
  | { kind: 'absolute-count'; occurrences: number; periodSeconds: number }
  | { kind: 'arrival-rate'; averagePerSecond: number }
  | { kind: 'concurrent-sessions'; concurrentSessions: number; averageSessionSeconds: number }

interface DemandActivity {
  id: string
  name: string
  binding: OperationBinding | CapacityWorkloadBinding
  volume: ActivityVolume
  rootRequestsPerOccurrence: number
  trafficShape: TrafficShape
  transfer: TransferDemand
  assumptionOverrides: PlanningAssumption[]
}
```

An activity binds either to a named API operation and Interaction or to a capacity-only Traffic Generator. This keeps one demand engine usable by both current project modes.

### 5.1 Traffic shape

Traffic shape distinguishes sustained load from a short burst:

- `factor`: average rate, peak factor, peak duration, optional burst factor, and burst duration;
- `phases`: explicit time windows with a multiplier or absolute rate;
- `trace`: a future imported aggregate time series, not raw user requests.

The compiler materializes factor or phase inputs into existing arrival phases. A burst that lasts less than the configured simulation sampling interval must produce a warning.

### 5.2 Transfer demand

Each activity can declare:

- request and response payload bytes per root operation;
- sustained ingress or egress bits per second per active session;
- protocol-overhead ratio as an explicit optional assumption;
- compression ratio where the topology applies compression;
- a size distribution when average size would hide an important long tail.

Transactional transfer and sustained-session transfer are separate. A long-lived media stream or socket is calculated from active sessions and bitrate, not from one request payload.

### 5.3 Internal amplification

The compiler derives amplification from executable architecture whenever possible:

- the Interaction defines API, service, data, cache, event, realtime, and workflow actions;
- topology routing defines weighted selection and fan-out;
- Topic subscription count defines publish fan-out;
- declared retry policy and intrinsic failure assumptions can produce an initial expected-attempt estimate;
- a completed simulation can replace branch and retry assumptions with observed values for a new, explicitly calibrated plan.

An override is allowed only when executable semantics cannot provide the value. It must name its target action or connection and show that it is an assumption. The compiler must detect and reject double counting, such as applying a manual fan-out factor to an Interaction that already declares the same fan-out.

For operation $o$ and node $n$, the analytic projection uses a visit coefficient $a_{o,n}$. If the peak root-operation rate is $\lambda_o$, then:

$$
\lambda_n = \sum_o \lambda_o a_{o,n}
$$

The same projection maintains separate coefficients for request bytes, response bytes, records, messages, and sustained sessions. Conditional actions require an explicit branch probability or a named observed calibration. Unknown branch probability makes affected recommendations incomplete rather than guessed.

## 6. Core formulas

All formulas use canonical internal units: seconds, requests, bytes, bits per second, and days. The UI may display convenient decimal or binary units but must show the conversion.

### 6.1 Activity rate

For a per-actor activity:

$$
N_{period}=P f u r
$$

$$
\lambda_{avg}=\frac{N_{period}}{T}, \qquad \lambda_{peak}=\lambda_{avg}k_{peak}
$$

where $P$ is population, $f$ is the participating fraction, $u$ is occurrences per actor, $r$ is root requests per occurrence, $T$ is the period in seconds, and $k_{peak}$ is the peak factor.

### 6.2 Concurrency

For transactional work, Little's Law provides the starting estimate:

$$
L=\lambda W
$$

where $W$ is mean service or end-to-end time in seconds. For long-lived sessions, concurrency comes directly from the session model or from session start rate multiplied by average duration. The product must not infer session concurrency from request latency.

### 6.3 Bandwidth

For transactional payloads:

$$
B_{bit/s}=8\lambda(S_{request}+S_{response})(1+h)
$$

where $h$ is optional protocol overhead. For sustained sessions:

$$
B_{bit/s}=C b
$$

where $C$ is active sessions and $b$ is bitrate per session. Ingress, egress, east-west, replication, and origin traffic remain separate dimensions.

### 6.4 Service replicas and servers

If a benchmark supplies sustainable per-replica throughput $q$, target utilization is $U$, and $F$ replicas must be tolerated as unavailable:

$$
R_{throughput}=\left\lceil\frac{\lambda_{peak}}{qU}\right\rceil+F
$$

When only concurrency and service time are known:

$$
R_{concurrency}=\left\lceil\frac{\lambda_{peak}W}{C_{replica}U}\right\rceil+F
$$

If replicas share servers, request handling is bounded by both replica and server envelopes. For $R$ replicas on $H$ servers:

$$
\mu_{effective}=\min(Rq_{replica},Hq_{server})
$$

The recommendation is the maximum count required by throughput, concurrency, memory, and NIC constraints. A per-server benchmark overrides a formula inferred from service time, but its provenance remains visible.

### 6.5 Queue and worker stability

For arrival rate $\lambda$, worker service rate $\mu_w$, and target utilization $U$:

$$
W_{required}=\left\lceil\frac{\lambda}{\mu_w U}\right\rceil
$$

An aggregate queue projection over interval $\Delta t$ is:

$$
Q_{t+\Delta t}=\max(0,Q_t+(\lambda_t-\mu_t)\Delta t)
$$

When $\lambda>\mu$, the plan reports positive backlog growth and estimated drain time. A finite queue additionally reports when rejection begins.

### 6.6 Storage

For successful records or objects created per day $N_d$, logical bytes per item $S$, retention days $D$, and growth function $g(d)$:

$$
S_{logical}=\sum_{d=1}^{D}N_d g(d)S
$$

With content amplification $A_c$, durability amplification $A_r$, backup amplification $A_b$, and headroom $H$:

$$
S_{physical}=S_{logical}A_cA_rA_b(1+H)
$$

Each factor is decomposed in the UI into metadata, indexes, derived data, replication or erasure coding, backups, and free-space headroom. Deletion and TTL reduce retained logical data before physical amplification. Storage sizing also checks read throughput, write throughput, IOPS, and rebuild headroom; fitting on disk alone is not a passing plan.

## 7. Capacity profiles and component adapters

Capacity planning must not use a central switch statement that knows every component's configuration. Each registered behavior version can provide an optional `CapacityAdapter` next to its runtime behavior:

```typescript
interface CapacityAdapter {
  describeKnobs(node: ComponentNode): CapacityKnob[]
  deriveCurrentEnvelope(node: ComponentNode, profile: NodeCapacityProfile): CapacityEnvelope
  projectDemand(context: PlanningContext, node: ComponentNode): CapacityDemand[]
  recommend(context: SolverContext): CapacityRecommendation[]
  toConfigPatch(recommendation: CapacityRecommendation): JsonPatchOperation[]
}
```

Canonical demand dimensions include:

- requests or operations per second;
- concurrent requests, jobs, workflows, or connections;
- messages per second and retained messages;
- ingress, egress, read, and write bits per second;
- queued requests, queued messages, and queued bytes;
- logical and physical storage bytes;
- read and write IOPS;
- memory or cache working-set bytes;
- shards, partitions, consumers, replicas, servers, and failure-domain reserve.

### 7.1 Node capacity profile

A planning profile stores assumptions that do not belong in the executable component config:

- server count and replica placement;
- sustainable request rate per replica or server;
- concurrency, connections, CPU work, memory, NIC, storage, IOPS, and byte throughput per server;
- target utilization and maximum storage fill;
- reserved replicas or servers for failure tolerance;
- provenance and optional calibration note for every limit;
- locked solver knobs.

Executable node config remains authoritative during simulation. The adapter maps applicable planning changes to fields such as `replicas`, `consumers`, `shardCount`, `replicasPerShard`, `partitions`, `bandwidthMbps`, or new aggregate storage limits. A planning-only value that cannot affect runtime must be labeled as such.

### 7.2 Initial adapter coverage

| Behavior | Primary demand dimensions | Recommended knobs | Important constraints |
|---|---|---|---|
| Service / Worker | requests, concurrency, handler work, ingress/egress | replicas, servers, concurrency per replica | per-server benchmark, NIC, failure reserve |
| Load Balancer / Global Router | routing rate, concurrent lookups | capacity, servers | target distribution and failover headroom |
| Queue | arrival rate, delivery rate, depth | consumers, max depth, servers | stability and burst absorption |
| Stream / Topic | publish rate, consume rate, bytes, retention | partitions, consumers, publish capacity, retained messages | slowest group/subscription and partition skew |
| Cache | operations, working set, bytes | nodes/servers, capacity entries, request concurrency | hit rate, item overhead, replication, hot keys |
| CDN | active delivery, edge/origin bytes, working set | POP count, edge/origin bandwidth, cache capacity | byte hit ratio and regional distribution |
| Database / Search Index | reads, writes, concurrency, data, IOPS | shards, replicas, connections, servers | read/write split, indexes, hot partitions, replication |
| Object Storage | read/write operations, bytes, retained data | servers, request concurrency, read/write bandwidth, storage bytes | durability and rebuild headroom |
| Realtime Gateway | active connections, fan-out, outbound bytes | servers, connection/message capacity, bandwidth | slow clients and per-connection backlog |
| Workflow / Scheduler | starts, active instances, scheduled bursts | servers, concurrent instances/runs, pending depth | retries, long duration, missed-run policy |
| Network | ingress/egress bytes and active flows | links/servers, aggregate bandwidth, parallelism | shared contention and directional capacity |

An unsupported behavior can still run, but the planner reports `no capacity adapter` and does not invent a recommendation.

## 8. Explainable sizing solver

The solver is deterministic and constraint based. It is not a machine-learning model.

1. Validate all units, references, bounds, and assumption provenance.
2. Normalize activities into average, peak, and burst demand phases.
3. Compile bound activities into generated `OperationWorkload` or capacity workload snapshots.
4. Project each operation through its Interaction and topology into per-node and per-connection demand vectors.
5. Ask each behavior adapter for its current capacity envelope and candidate knobs.
6. Calculate the minimum integer setting for every independent constraint.
7. Take the maximum requirement across dimensions, then add explicit failure and growth reserve.
8. Respect locked knobs and schema bounds. Report an infeasible plan when no supported patch satisfies the constraints.
9. Return a patch preview and a formula audit trail. Do not mutate the project.
10. After explicit apply, run the normal simulator and compare predicted demand with observed runtime evidence.

The first solver does not search for a globally cheapest topology. Coupled effects such as cache-hit changes, overload failures, retries, and routing are resolved by the later closed loop: size analytically, simulate, inspect observed amplification, and iterate with a bounded number of recorded steps.

### 8.1 Assumption precedence

When multiple values exist, precedence is:

1. a selected measured benchmark;
2. an explicit user value;
3. an observed value from a compatible saved run, when the user chooses to calibrate from it;
4. a built-in teaching default;
5. unknown.

A higher-precedence value never deletes lower-precedence history. The formula inspector shows which value won and why.

### 8.2 Recommendation safety

- Applying all recommendations is one undoable transaction.
- Individual rows can be applied or ignored.
- A stale recommendation cannot be applied after the project revision changes without recalculation.
- Solver patches cannot add, remove, reconnect, enable, or disable topology nodes.
- A decrease in current resources requires separate confirmation because it can reduce availability.
- If a target SLO has no executable metric, the solver reports it as unverified.

## 9. Shared bandwidth and high-scale runtime

### 9.1 Shared byte-rate resources

The runtime needs a reusable work-conserving `RateResource` in addition to the existing concurrent-unit resource. It owns a capacity in work units per second, a bounded waiting workload, and full-run metrics. For network use, the work unit is a byte.

At minimum, the following pools become aggregate resources:

- Network ingress and egress;
- CDN edge delivery and origin transfer;
- Object Storage read and write throughput;
- Search indexing throughput;
- Realtime Gateway aggregate outbound bandwidth.

Transactional transfers enqueue byte jobs. Concurrent jobs share one configured aggregate capacity instead of each receiving the full bandwidth. Sustained sessions reserve or demand a byte rate for their active duration. When offered rate exceeds capacity, the runtime records byte backlog, added wait, achieved bitrate, and rejection or degradation according to the component policy.

Capacity pools can initially be node-local. A later optional `capacityPoolId` allows several nodes or connections to share one server NIC, regional egress limit, or origin link without merging the topology nodes.

### 9.2 Direction and response bytes

Request and response transfer are separate runtime work. The operation compiler must consume the existing response-size estimate or workload override. A forward request consumes capacity in the forward direction; the response consumes the reverse direction. Full duplex and shared duplex are explicit pool modes.

### 9.3 Authoritative connection metrics

`SimulationResult` adds full-run connection aggregates rather than deriving them from trace-retained events:

- calls and failures;
- request and response bytes;
- achieved bits per second;
- utilization;
- average and peak queued bytes;
- average and maximum transfer wait;
- rejected or dropped bytes.

Canvas congestion styling and bottleneck findings must use these aggregates. Trace samples remain supporting evidence, not totals.

### 9.4 Hybrid scale model

The analytic planner handles arbitrarily large business counts with formulas. Discrete-event simulation remains useful for request ordering, retries, faults, cache state, and latency at a bounded event count. It must not attempt to generate every request implied by a billion-user plan.

For rates above the configured event budget, the run offers one of two explicit modes:

- `representative`: preserve the demand ratios in a shorter or scaled window and label absolute queue conclusions as sampled;
- `aggregate-capacity`: advance rate resources and queues in deterministic time buckets using arrival and service rates, while retaining a bounded sample of requests for traces.

Aggregate mode owns full-rate queue, backlog, byte, and utilization metrics. Sampled traces do not drive totals. The UI shows the chosen mode, scale factor, bucket size, and which detailed component semantics were approximated.

## 10. Capacity boundary and sensitivity analysis

The user can select one or more demand inputs and ask, "How much can this design carry?" A pass predicate is explicit and versioned. It can include:

- p95 or p99 latency below an operation SLO;
- error or rejection rate below a threshold;
- node and link utilization below a target;
- no sustained positive queue, byte-backlog, or consumer-lag slope;
- no queue overflow;
- storage below maximum fill at the selected horizon;
- survival of a selected node, zone, or capacity-drop fault.

For a scalar demand multiplier $x$, the runner first finds a passing and failing bracket, then uses bounded binary search:

$$
x_{next}=\frac{x_{pass}+x_{fail}}{2}
$$

The search stops at configured relative tolerance or run budget and stores every tested point. Results include the last passing point, first failing point, first violated criterion, and newly observed bottleneck.

Some systems are non-monotonic because of caching, routing, timeouts, retry storms, or finite-duration bursts. The search verifies nearby points. If pass/fail behavior is not monotonic, it returns the sampled intervals and does not claim one exact maximum. Optional repeated seeded runs can report a range, but one deterministic seed remains individually reproducible.

Sensitivity analysis initially varies one input at a time and plots demand, recommendation, and simulation outputs. Multi-dimensional optimization remains deferred until there is a clear objective and bounded search budget.

## 11. User workflow

### 11.1 Demand

The Capacity view starts with editable actor groups and activities. Numeric controls always show units. Changing DAU, participation, operations per user, peak factor, session duration, bitrate, object size, retention, or growth immediately recalculates derived demand without running the simulator.

### 11.2 Estimate

The derived-demand table can be grouped by activity, operation, node, connection, and dimension. Selecting a number opens its formula tree and highlights the contributing business path on the Canvas. Warnings identify missing branch probabilities, unbound activities, unsupported adapters, and assumptions that use teaching defaults.

### 11.3 Size

The resource table shows `Current`, `Required`, `Recommended`, `Headroom`, and `Limiting dimension`. Users can lock values, edit per-server assumptions, apply one proposal, or apply the complete proposal. Replica, server, shard, partition, consumer, connection, bandwidth, and storage controls remain available in the selected node's Properties panel.

### 11.4 Simulate

Running the experiment uses the generated workload snapshot and the current, possibly manually edited topology configuration. Canvas overlays show node saturation, queues and lag, plus link utilization and congestion. Result details compare analytic demand with achieved throughput and explain material differences.

### 11.5 Explore

A demand slider scales a selected input or the complete demand model. `Find limit` runs the bounded capacity search. Saved comparisons show what changed, which bottleneck moved, and whether added resources created a new downstream constraint.

The interface must teach through visible calculations and cause-and-effect comparisons. It should not include static tutorial prose that obscures the work surface.

## 12. Data ownership and reproducibility

ProjectFile v4 stores source inputs and planning assumptions, not mutable cached totals as authority. Derived values are recomputed by a versioned formula engine. A saved planning result contains:

- project revision and experiment ID;
- demand, topology, and capacity-profile hashes;
- formula, compiler, solver, and simulation engine versions;
- canonical normalized inputs;
- derived-demand rows and formula references;
- recommendation patches and constraints;
- optional simulation run IDs used for validation or calibration;
- warnings and unsupported dimensions.

Existing saved simulation runs remain immutable. Applying a recommendation creates a new project revision; it never rewrites an earlier run. Export remains one JSON ProjectFile. OpenAPI and DBML continue to be format adapters for API and data definitions, not capacity-plan formats.

## 13. Delivery stages

Each stage is implemented, tested, documented with results and explicit boundaries, committed, and pushed to `main` before the next stage begins. The stage log belongs in this file under the relevant status section.

### Stage 1 - Demand model and formula engine

Deliverables:

- [ ] ProjectFile v4 planning catalog and deterministic v3 migration;
- [ ] actor, activity, traffic-shape, transfer, persistence, and provenance schemas;
- [ ] unit-safe formula engine for rates, concurrency, bandwidth, and basic retained logical bytes;
- [ ] Demand editor and inspectable formula tree;
- [ ] stale-result hashing and validation errors;
- [ ] one transaction, one session, and one batch fixture using only generic fields.

Exit criteria: changing a population, frequency, peak factor, payload, session duration, or bitrate produces the expected deterministic derived values and formula trail without running the simulator. Existing v3 projects execute unchanged after migration.

Status: not started.

### Stage 2 - Demand to executable workload compiler

Deliverables:

- [ ] bind activities to operation-aware or capacity-only workloads;
- [ ] generate average, peak, and burst arrival phases;
- [ ] project Interaction and topology amplification by node and connection;
- [ ] model explicit conditional branch assumptions without double counting;
- [ ] preview generated workload snapshots and execute them through the existing Worker;
- [ ] compare expected root operations with generated runtime operations.

Exit criteria: a generic demand model compiles to existing executable workloads, and changing an operation mix or fan-out changes downstream demand without any example-specific compiler branch.

Status: not started.

### Stage 3 - Capacity adapters and resource sizing

Deliverables:

- [ ] versioned `CapacityAdapter`, capacity-dimension, node-profile, and recommendation contracts;
- [ ] adapters for Service/Worker, routing, Queue/Stream/Topic, Cache/CDN, Database/Search, Object Storage, Realtime, Workflow/Scheduler, and Network;
- [ ] deterministic sizing solver with utilization, growth, and failure headroom;
- [ ] current-versus-recommended resource table, locks, formula inspection, and undoable patch application;
- [ ] manual server, replica, per-server capability, shard, consumer, bandwidth, and storage editing where supported;
- [ ] infeasible and unsupported constraint reporting.

Exit criteria: the solver calculates an assumption-backed starting configuration for every supported node in ordinary order, asynchronous processing, and media-delivery fixtures. Manual overrides remain authoritative in the next run.

Status: not started.

### Stage 4 - Shared bandwidth contention

Deliverables:

- [ ] deterministic shared `RateResource` with byte backlog and transfer wait;
- [ ] aggregate directional bandwidth for Network, CDN, Object Storage, Search indexing, and Realtime egress;
- [ ] execution of request and response bytes plus sustained-session demand;
- [ ] authoritative full-run connection metrics;
- [ ] bandwidth congestion findings and Canvas overlays;
- [ ] bandwidth-drop and failure behavior composed with shared capacity.

Exit criteria: two simultaneous transfers share aggregate capacity; increasing payload or concurrency can grow byte backlog and latency; adding bandwidth removes that bottleneck and can reveal the next constrained node.

Status: not started.

### Stage 5 - Storage growth and physical capacity

Deliverables:

- [ ] persistence projections bound to successful data actions or explicit capacity workloads;
- [ ] retention, deletion, growth, metadata, index, derived-data, durability, backup, and headroom factors;
- [ ] hot/warm/cold optional tiers with separate capacity assumptions;
- [ ] storage, throughput, IOPS, working-set, and rebuild constraints in relevant adapters;
- [ ] horizon charts and storage-capacity findings;
- [ ] safeguards against counting declared database rows and projected writes twice.

Exit criteria: the planner can separately show logical daily growth, retained logical data, physical provisioned bytes, and the first storage-related limiting dimension. Changing retention or replication changes only the justified terms.

Status: not started.

### Stage 6 - Closed-loop validation and capacity search

Deliverables:

- [ ] aggregate-capacity runtime mode for rates above the discrete event budget;
- [ ] explicit pass predicates and analytic-versus-simulated reconciliation;
- [ ] bounded solver/simulator iteration with every proposal and run recorded;
- [ ] scalar demand boundary search with monotonicity checks;
- [ ] one-input sensitivity charts and saved comparison integration;
- [ ] bottleneck transition explanations after each manual or automatic adjustment.

Exit criteria: a user can increase a generic business input, find the last passing and first failing demand levels, inspect the evidence-backed bottleneck, change a node capacity manually or apply a recommendation, rerun, and observe the bottleneck move downstream.

Status: not started.

## 14. Verification strategy

- Schema tests cover invalid units, duplicate IDs, broken bindings, unknown capacity dimensions, locked knobs, migrations, and JSON round trips.
- Formula unit tests use hand-calculated fixtures for per-actor rate, peak, Little's Law, transactional bandwidth, session bitrate, queue stability, storage retention, and headroom.
- Property tests assert nonnegative finite outputs and unit conversion invariants.
- Metamorphic tests assert directional behavior: increasing demand cannot lower a local requirement when all other assumptions are fixed; increasing per-server capacity cannot increase required server count; increasing retention cannot decrease storage; increasing bandwidth cannot increase transfer backlog in the isolated-link fixture.
- Compiler tests prove that Interaction fan-out, Topic copies, routing weights, and retries are attributed once.
- Adapter conformance tests require every recommendation to reference a supported config patch and every applied patch to pass component validation.
- Runtime tests cover aggregate bandwidth sharing, byte backlog, queue growth, worker lag, storage horizon crossing, faults, determinism, and trace-limit independence.
- Search tests cover exact boundaries, tolerance, run budgets, an infeasible locked design, and non-monotonic sampled output.
- Browser tests cover editing demand, inspecting a formula, applying and undoing recommendations, manually changing capacity, finding a limit, Canvas bottleneck focus, and saved comparison.
- Performance tests use billion-user input values to prove that analytic planning cost depends on model size rather than population size.
- Every stage runs its focused tests and the complete `pnpm check` gate before commit.

## 15. Generic acceptance scenarios

No acceptance test may dispatch on an example name. The same model and adapters must support at least:

1. **Transactional API:** population and actions per user derive peak API traffic; Service and Database sizing respond to latency, read/write mix, indexes, and replica assumptions.
2. **Asynchronous processing:** writes produce messages; inadequate consumers create growing broker backlog; increasing workers stabilizes the queue and exposes any downstream storage limit.
3. **Sustained delivery:** concurrent sessions and bitrate derive edge egress; byte hit ratio determines origin demand; shared bandwidth congestion appears independently from request concurrency.
4. **Long-term storage:** successful object or record creation, retention, derived data, indexes, and durability amplification produce a horizon requirement separate from online throughput.
5. **Failure headroom:** a recommendation sized for normal traffic is compared with one that must pass a configured replica, server, or zone capacity loss.

The existing video-delivery example is a useful end-to-end fixture because it exercises uploads, metadata, asynchronous workers, Object Storage, CDN, sustained egress, and retention. It is one consumer of the generic feature, not the feature's schema or algorithm.

## 16. Model boundaries and interpretation

- Formula results are estimates based on declared inputs. Per-server capacity should be calibrated with representative benchmarks at the target SLO.
- Target utilization and failure reserve are policy choices, not universal constants.
- Static projection cannot know an emergent cache hit rate, overload failure rate, or retry storm before execution. Such values remain assumptions until calibrated from compatible runtime evidence.
- Aggregate-capacity mode can show rate imbalance and backlog growth but cannot reproduce every per-request ordering or latency-tail effect. Discrete mode remains the detailed validation path within its event budget.
- Storage projection models capacity and selected throughput constraints, not filesystems, compaction algorithms, repair protocols, or durability probability.
- Shared bandwidth is an aggregate work-conserving approximation, not TCP, packet scheduling, or a physical network topology.
- A recommendation proves only that its declared analytic constraints are satisfied. The corresponding simulation and pass predicate provide separate validation evidence.
- The system must say `insufficient information` when a required capability is unknown. A neat number is not preferable to an honest gap.

## 17. Definition of done

- [ ] any supported example can express demand without example-specific fields;
- [ ] demand changes recalculate rates, concurrency, bandwidth, and storage with inspectable formulas;
- [ ] the solver produces previewable, assumption-backed, undoable resource patches;
- [ ] users can directly edit replica, server, per-server, shard, consumer, bandwidth, and storage assumptions supported by each node;
- [ ] shared byte resources can become congested and emit authoritative evidence;
- [ ] queues, workers, brokers, links, and storage can each be identified as the limiting resource;
- [ ] capacity search returns a reproducible passing/failing bracket and handles non-monotonic results honestly;
- [ ] billion-user inputs do not require billion-event simulation;
- [ ] ProjectFile migration, import/export, autosave, undo/redo, and saved-run comparison remain correct;
- [ ] formulas, runtime assumptions, verification evidence, and boundaries are documented after every stage;
- [ ] the complete repository check passes.
