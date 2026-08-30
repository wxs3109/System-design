#case design

This catalog trains transferable System Design thinking through specific cases, rather than copying mature products or writing complete product specifications.

The value of a case lies in whether the learner can independently derive the architecture from requirements, scale, and failures, explain what key mechanisms protect, and clarify the costs, boundaries, and stopping points of the current design.

The general granularity principle is:

> Enter the core learning path only if it changes architectural choices, correctness invariants, dominant capacity bottlenecks, fault semantics, or external contracts.

The rest goes into Optional, Reference or Parking Lot.

## 1. Goals and non-goals

Each case should train the following abilities:

- Clarify core scenarios, actors, system boundaries and Out of scope.
- Translate scale, latency, availability and consistency requirements into architectural constraints.
- Start with a minimal system and let the components gradually emerge from real stress.
- Reasoning for correctness using invariants, state transitions, and failure windows.
- Make magnitude estimates sufficient to influence design choices.
- Explain alternatives, trade-offs, escalation signals and stopping conditions.
- Re-derive the design after leaving the document and migrate to adjacent problems.

Not pursued by default:

- Exhaust the functions, configuration items and abnormal branches of mature products.
- Determine the complete API, Schema, Key, error code or deployment parameters in advance.
- Replace system-level reasoning with code implementation.
- Iteratively designed complete RBAC, auditing, billing, console and runbooks for each case.
- Mechanically add caches, queues, multiple regions or complex control planes without real needs.
- Incorporate all possible future questions into the first study.

## 2. Case classification and knowledge boundaries

| Classification | Judgment Question | Main Caller | Example |
|---|---|---|---|
| [General Basic System](01-common-basic-system/) | Does it serve many different businesses independently? | Other service or platform teams | Load Balancer, Cache, Object Storage, Scheduler |
| [Specific application system](02-specific-application-system/) | Is a user or business closed loop completed? | End User or Business Participant | News Feed, Search, Booking, Payment |
| [Platform System](03-platform-system/) | Does it uniformly carry multiple types of workloads and resources? | Platform users, developers and Workload | Serverless, multi-tenant data platform |

Classified according to the main responsibilities of the system, not according to whether a certain component can be reused.

- The infrastructure-components section explains the usage contracts, common implementations, and selection of ready-made components.
- The general-design-patterns section illustrates recurring call and data paths across systems.
- The case-design section forms an end-to-end reasoning loop around a design object.

When the case requires common concepts, existing knowledge should be linked instead of recreating an encyclopedia for each directory.

## 3. Pressure-driven progressive mainline

The default is to start with a minimum viable system without first showing the final architecture including all production components:

```text
Clarify the scene and boundaries
→ Get through the minimum normal process
→ Exposed correctness issues
→ Dealing with dominant scale bottlenecks
→ Inject critical faults
→ Verify guarantees and costs
→ Summarize and stop
```

Each evolution uses the same structure:

> Pressure or failure → Why the current solution fails → Minimum new mechanism → Guarantees obtained → Costs and new boundaries

Follow the following principles when deducing:

1. No new components will be added unless requirements, bottlenecks or faults are clear.
2. Prioritize one dominant problem during an evolution.
3. First fix the calling contract and correctness, and then optimize performance.
4. Capacity figures are used to eliminate untenable solutions and are not used to create false accuracy.
5. Failure analysis must describe user-visible results, retry boundaries, and recovery methods.
6. The final architecture must be re-derivable from the minimal system.

## 4. Three-layer learning granularity

| Level | Function | Typical content |
|---|---|---|
| Core Layer | Establishing Transferable Design Models | Boundaries, Contracts, Invariants, Progressive Architecture, Dominant Capacity, Critical Failures and Trade-off |
| Optional | Digging into 2–3 case-specific challenges | Alternative mechanisms and failure windows that would change the guarantees or architecture |
| Reference / Parking Lot | Reserve future entrance | Implementation details, product capabilities, multi-region, complete governance and reopening conditions |

A detail must meet at least one of the following before entering the core layer:

- Removing it would make the core requirement untenable.
- It protects an invariant that must be declared.
- It determines the major capacity, latency or cost bottlenecks.
- It changes the results seen by the caller on failure.
- It is a semantic contract that the caller must understand.

Full fields, algorithm code, product feature matrices, and general production governance generally do not belong to the core layer. Security and observability will still need to address minimum contracts, but will not expand into independent platforms unless they are the dominant issues in the current case.

The default document structure is:

```text
README.md # Learning Contract, Scope, Contract, Architecture Map and Completion Conditions
01-Progressive Design Mainline.md # The only must-read knowledge mainline
02-Review and practice.md # Closed book derivation and acceptance
optional/ # 0–3 elective puzzles
PARKING-LOT.md # Non-current scope and real reopening conditions
REVIEW.md # Granularity and reconstruction review of this case
```

The number of files is not a hard requirement, but the default path must be clear, and Optional must not become an implicit must-read.

## 5. Minimum acceptance of core layer

The following content must be able to locate the answer in the case, but is not required to be arranged in fixed chapters:

1. **Learning Contract**: core scenarios, scale assumptions, goals, non-goals and completion conditions.
2. **External contracts and invariants**: What do success, failure, and timeout mean respectively; which results cannot occur.
3. **Progressive Architecture**: How does the normal path work, and what pressures are introduced by each component.
4. **Capacity Conclusion**: Use a few formulas to find out the dominant bottlenecks, hot spots and expansion directions.
5. **Critical Faults**: Select 2–3 categories of faults that best expose the semantics of this system, describing visible consequences, retries, degradation, and recovery.
6. **Trade-off and Validation**: What is selected, what is rejected, and what metrics or failure tests are used to prove the commitment.
7. **Boundary and Evolution**: In what scope does the current design hold, and what real signal triggers the next stage.

The general basic system must also clarify what it will not assume for the caller; specific applications must clearly depend on the basic system contract; the platform system must also explain tenant isolation, control plane/data plane and resource governance boundaries.

## 6. Completion and Stop

Case completion is determined by evidence of competency, not the number of pages of documentation. When not looking at documentation, learners should be able to:

- Draw the core architecture and explain the stress sources of the components in five minutes.
-Trace one normal process and at least two critical failure processes.
- Name 3–5 core invariants or system commitments.
- Complete a magnitude estimate and identify dominant bottlenecks.
- Explain at least three Trade-offs and one rejected offer.
- Explain Out of scope, precision bounds and upgrade signals.
- Determine which conclusions are reused in adjacent variants and which must be changed.

Once these conditions are met, the case is closed by default. The following situations are stop signals:

- New content only adds fields, enumerations, configuration options, or product features.
- Arguing about the exact number of nodes, timeouts, or shards when there is no basis for measurement.
- Each subsystem continues to recursively expand the control plane, operation and maintenance plane, and multiple regions.
- The new chapter does not change the architecture, invariants, capacities, fault semantics, or calling contracts.
- Core summaries are constantly postponed to the next version, the next Phase, or the next Step.

If the problem is not resolved, enter the Parking Lot and write down the actual reopening conditions. This general outline is also followed when AI-assisted learning: Prioritize questions and reviews, focus on a few high-value gaps in each round, and do not actively expand cases into product specifications.
