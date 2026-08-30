# Load Balancer: review and practice

This article does not introduce new knowledge, but only tests whether the design can be re-derived without the document. Read [Progressive Design Mainline](./01-load-balancer-progressive-design-mainline.md) first, then close the document and complete it within 45–60 minutes.

Use the same framework for each answer:

```text
stress or malfunction
→ Why the current solution failed
→ Minimal new mechanism
→ Guarantee obtained
→ Cost and Boundary
→ a verification signal
```

There is no requirement for a cloud product feature matrix, load balancing algorithm code, kernel forwarding implementation, precise node count, or global traffic design.

## 1. Fixed learning contract

Limited to 5 minutes:

1. Use one sentence to describe the responsibilities of the Load Balancer in this case.
2. What do `NO_ROUTE`, `NO_ELIGIBLE_ENDPOINT`, `OVERLOADED` and `TIMEOUT / RESET` stand for respectively?
3. Why does Backend Response not equal business success?
4. Why can’t the write request Timeout be interpreted as “not executed”?
5. Why choose L7 for this case? What needs will switch to L4?

Passing criteria: LB is only responsible for request-level Route, Endpoint selection and proxy; by default, there is only one Backend Attempt per request, and the proxy results are not promoted to business facts.

## 2. Rebuild a single-node minimum system

Limited to 7 minutes:

1. Draw `Client → L7 Reverse Proxy → Backend Pool`.
2. Track TLS termination, Route matching, Endpoint selection, Backend connection reuse and response return.
3. Under what assumptions is Round Robin established?
4. In what three types of changes will the static Endpoint List fail?
5. What latency, capacity, and availability costs does a single agent add?

Passing criteria: being able to derive the smallest agent from a "stable entrance" instead of drawing a complete control surface, global entrance and algorithm set at the beginning.

## 3. Let pressure push out the structure

Don’t draw the final drawing first. Fill in the following:

| Stress or failure | Why current solutions fail | Minimal mechanisms | New guarantees | Costs/bounds |
|---|---|---|---|---|
| Endpoint scaling and rolling release | | | | |
| Endpoint hard failure or gray failure | | | | |
| The new instance receives its full share as soon as it is restored | | | | |
| Uneven request costs and instance capabilities | | | | |
| Requests, connections or bandwidth exceed single machine | | | | |
| Dynamic changes in Route and Membership | | | | |
| The entire Backend Pool slows down | | | | |

When completed, you should naturally get:

```text
Single L7 Proxy + Round Robin
→ Membership + Health + Draining
→ Slow Start + Partial Load Awareness
→ Across AZ Data Plane Fleet
→ Versioned Snapshot + Last Known Good
→ Bounded In-flight + Load Shedding + Retry Budget
```

Passing criteria: Each mechanism has a clear source of stress; "Envoy/Cloud LB generally has it" cannot be used as a reason.

## 4. Capacity estimation

Assume using this case: $Q=1{,}000{,}000$ Request/s, $CPS=100{,}000/s$, concurrent connections $C=2{,}000{,}000$, average response $B=10\ ext{KB}$.

1. Use $BW_{response}\approx QB$ to estimate the logical response bandwidth in the client direction. Why do Full Proxy's Backend inbound, Client outbound, request body, TLS, and cross-AZ traffic still need to be calculated separately by link?
2. If the rough calculation of each connection status and Buffer is $32\ ext{KB}$, use $M_{conn}\approx C\times32\ ext{KB}$ to estimate the memory level. Why doesn't this give the number of nodes directly?
3. Explain which resources are most likely to be exhausted first by Request/s, CPS, concurrent connections, and Bit/s.
4. Given the single-node safety upper limit obtained from the pressure test, write the four-axis node lower bound formula.
5. Why do we need to reserve a margin for AZ failures, rolling releases, and traffic surges?
6. Write the constraint that "after losing the maximum AZ, the remaining safe capacity still covers the peak demand".
7. What real measurements determine node count and Autoscaling Signal? Why can't separate pressure testing of the four capacity axes replace the combined load test?

Passing criteria: Only the response payload is about $10\ ext{GB/s}$, and the connection status is roughly calculated at about $64\ ext{GB}$; it can interpret the maximum value of the four axes, and then conduct fault margin verification, instead of just planning according to the average QPS.

## 5. Membership, Health and Publishing

1. What questions do Membership, Readiness, Active Health Check and Passive Ejection answer respectively?
2. Why can’t Health prove that the next business request will be successful?
3. What are the consequences of the detection threshold being too sensitive and too conservative?
4. Why does local passive Ejection not need to be synchronized to a strongly consistent global state?
5. Why might it be worse to continue removing instances when the entire Pool is slow?
6. How do Draining, Application Grace Period and Deadline cooperate when planning to release?
7. When the LB node or Endpoint suddenly crashes, which existing requests cannot be "drained"?

Passing criteria: New requests are only sent to Endpoints in the Snapshot that are locally healthy and accept traffic; windows, misjudgments, partial views, and non-lossless Draining can be clearly discovered.

## 6. Scheduling and long connection boundaries

1. Why does Round Robin become unbalanced when the request cost difference is large?
2. What do the static Weight and dynamic load signals express respectively?
3. Why can randomly sampling a small number of candidates and then selecting the better ones avoid full scanning? What doesn't it guarantee?
4. Why might Least Connections be misleading under HTTP/2 / gRPC Multiplexing?
5. Why can’t Local In-flight / Latency View provide global precise optimization?
6. What can Sticky / Hash Routing solve? Why can’t it save the unique Session state?

Passing criteria: The algorithm is selected from the load model; it does not confuse the number of connections, the number of requests and the business cost, nor does it turn affinity into correctness dependence.

## 7. Fleet, configuration and control plane failures

1. Why don’t data plane nodes share per-request status? Which state remains local?
2. After a single Data Plane or single AZ fails, what is the difference between new connections and existing connections?
3. Why should Route, Pool and Endpoint be published as complete Snapshots instead of modified field by field?
4. What does atomic installation guarantee? Why doesn't it equal Fleet global simultaneous switching?
5. What error and latency signals should be observed for grayscale and rollback?
6. What can LKG keep after the Control Plane loses contact? What happens to new members, emergency removals, and Route updates?

Passing criteria: The control plane does not enter the per-request path; only self-consistent versions are installed on each data plane, while version skew and stale configuration windows are recognized.

## 8. Overload, Deadline and Retry

Given the entrance arrival rate $\lambda=1{,}000{,}000/s$:

1. Use $L=\lambda W$ to calculate the in-flight when the average dwell time increases from $20\ ext{ms}$ to $200\ ext{ms}$.
2. Why does unbounded queue worsen memory, deadline and tail latency at the same time?
3. What do in-flight caps, short queues, and load shedding each protect?
4. If 20% of requests require an additional retry, use $Q_{attempt}=Q_{request}(1+A_{retry})$ to calculate Backend Attempt/s.
5. What conditions must be met for automatic retry? Why is it still unsafe to just add an idempotent key to the header that is not recognized by downstream?
6. Why should there be only one Retry Policy Owner for a call?
7. Why is small traffic detection and Slow Start needed when Backend is just restored?

Passing criteria: In-flight increases from approximately $20{,}000$ to $200{,}000$; 20% one retry brings Attempt Rate to $1{,}200{,}000/s$. Ability to choose explicit deny to protect recovery instead of treating Queue and Retry as free reliability.

## 9. Boundary judgment and completion judgment

Determine whether the following changes should be entered into Optional, Parking Lot, or a separate case, and indicate which contract it changes:

1. Requires proxy bidirectional gRPC Stream and hours WebSocket.
2. Requires TCP Passthrough and end-to-end TLS.
3. It is necessary to select routes based on delay and compliance among the three Regions.
4. Authentication, Quota, API Version, Request Transformation and Developer Key are required.
5. The user login status only exists in a certain Backend process, and Sticky is required to never change.
6. DSR/eBPF must be used to achieve measured per-packet throughput targets.
7. Emergency security revocation requires that all Data Planes take effect simultaneously within one second.

Finally, give ten minutes of dictation:

1. 2 min: Contracts, minimal agency, and outcome semantics.
2. 2 minutes: Membership, Health, Draining and Scheduling.
3. 2 min: Quad Capacity and Cross-AZ Fleet.
4. 2 minutes: Snapshot, LKG and control plane failure.
5. 2 minutes: Overload, retries, three trade-offs, and stopping points.

After everything is satisfied, this case ends:

- Ability to derive components from pressure rather than memorize algorithms or product topology.
- A visible window that explains fault discovery, draining, node failures, and configuration propagation.
- Can do four-axis estimation of QPS, CPS, connection and bandwidth.
- Able to distinguish between Request and Attempt, and limit overload and retry amplification.
- Ability to leave Global Entry, L4 Fast Path, API Governance and the full product out of scope.

Stop after final dictation; no more Load Balancer product details are added without new real contracts or measurement bottlenecks.
