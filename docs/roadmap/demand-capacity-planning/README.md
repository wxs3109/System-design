# Demand and Capacity Planning Roadmap

> Status: proposed; specification split completed on 2026-09-06. All 20 implementation parts are not started. M1 (DP-01 through DP-04) delivers the first usable planning loop.

## 1. Outcome

The workbench connects business demand to an editable design and observable results:

1. Describe population, activity frequency, traffic shape, payloads, sessions, retention, and growth.
2. Inspect derived operation rates, resource occupancy, bytes, amplification, and retained data with formulas and assumptions.
3. Preview an explainable capacity recommendation for the topology the user designed.
4. Apply it as an ordinary undoable project edit, or change supported capacity controls manually.
5. Run the current design and compare offered demand, achieved throughput, queues, failures, and bottlenecks.
6. Repeat manually from the first milestone; later automate bounded demand searches and calibration.

This is a learning and order-of-magnitude planning feature. Components execute simplified simulation models without requiring real services, databases, or brokers. Numbers describe declared assumptions and modeled runtime behavior, not production capacity guarantees. The schema and algorithms must work without example-name branches.

Read the [shared contracts](./shared-contracts.md) alongside every part: they define the learning-model boundary, formulas, runtime evidence, compatibility, integration, and completion requirements.

## 2. Delivery structure

Each linked spec defines its scope, dependencies, input/output contract, execution rules, acceptance cases, and completion evidence. IDs identify implementation parts, not new component types. A dependency means that part's contract and acceptance gate must be complete first. Independent extension parts need not block one another or the first milestone.

| Part | Spec and concrete deliverable | Depends on | Status |
|---|---|---|---|
| DP-01 | [Demand data and formulas](./01-demand-data-and-formulas.md): versioned source data, rates, units, formula records | Existing v3 model | Not started |
| DP-02 | [Workload compilation and projection](./02-workload-compilation.md): executable phases and attributed node demand | DP-01 | Not started |
| DP-03 | [Service capacity contract and sizing](./03-service-capacity.md): first adapter and replica proposals | DP-02 | Not started |
| DP-04 | [Transactional planning loop](./04-transactional-loop.md): editor, apply/undo, run comparison, evidence verdict | DP-03 | Not started |
| DP-05 | [Queue and Worker planning](./05-queue-and-workers.md): delivery versus processing capacity and backlog | DP-04 | Not started |
| DP-06 | [Shared rate resource](./06-shared-rate-resource.md): deterministic aggregate work scheduling | DP-04 | Not started |
| DP-07 | [Directional transfers and edge metrics](./07-directional-transfers.md): request/response execution and Network sizing | DP-06 | Not started |
| DP-08 | [Sessions, CDN, and Object Storage transfer](./08-sustained-delivery.md): sustained delivery and shared endpoint throughput | DP-07 | Not started |
| DP-09 | [Logical storage horizon](./09-storage-horizon.md): existing data, successful writes, retention, deletion | DP-04 | Not started |
| DP-10 | [Physical storage envelopes](./10-physical-storage.md): physical pools, backups, fill limits, storage proposals | DP-08, DP-09 | Not started |
| DP-11 | [Servers and failure reserve](./11-servers-and-failures.md): executable server envelopes and placement | DP-07 | Not started |
| DP-12 | [Stream and Topic planning](./12-stream-and-topic.md): independent delivery groups, skew, retention | DP-05, DP-10 | Not started |
| DP-13 | [Routing capacity](./13-routing-capacity.md): Load Balancer and Global Router limits | DP-04 | Not started |
| DP-14 | [Cache capacity](./14-cache-capacity.md): working set, entry limits, hit assumptions | DP-04 | Not started |
| DP-15 | [Database and Search capacity](./15-data-and-search-capacity.md): partition, copy, read/write, storage constraints | DP-07, DP-10 | Not started |
| DP-16 | [Realtime capacity](./16-realtime-capacity.md): connections, fan-out, slow clients, egress | DP-08 | Not started |
| DP-17 | [Workflow and Scheduler capacity](./17-workflow-and-scheduler.md): active work, scheduled bursts, pending work | DP-05 | Not started |
| DP-18 | [Aggregate capacity runtime](./18-aggregate-runtime.md): bounded full-rate conservation model | DP-05, DP-07 | Not started |
| DP-19 | [Capacity boundary search](./19-capacity-search.md): reproducible pass/fail brackets and inconclusive points | DP-04 | Not started |
| DP-20 | [Calibration and sensitivity](./20-calibration-and-sensitivity.md): explicit evidence reuse and recorded iteration | DP-19 | Not started |

### Milestone acceptance

| Milestone | Required parts | User-visible exit condition |
|---|---|---|
| M1: Transactional loop | DP-01 through DP-04 | Change business demand, inspect a Service proposal, apply or manually tune replicas, run, compare, undo |
| M2: Asynchronous processing | DP-05 | Distinguish delivery and Worker bottlenecks, observe backlog and recovery |
| M3: Transfer contention | DP-06 through DP-08 | Payloads and sessions consume aggregate bandwidth; adding bandwidth changes runtime evidence |
| M4: Storage horizon | DP-09 and DP-10 | Explain retained logical data, provisioned physical capacity, and the first projected capacity crossing |
| M5: Broader adapters | DP-11 through DP-17, individually | Each added behavior has an explicit supported-dimension table and executable or estimated evidence |
| M6: Large-rate execution | DP-18 | Full-rate queue/byte accounting runs within a bucket budget without claiming unsupported latency tails |
| M7: Automated exploration | DP-19 and DP-20 | Search eligible demand ranges, retain unknown points, compare assumptions, and inspect recorded iterations |

Default delivery order is M1, M2, M3, M4, incremental M5, M6, then M7. DP-19 can run earlier on eligible discrete scenarios after M1; it does not require all adapters or aggregate execution. M1 is a usable release and does not wait for any later part.
