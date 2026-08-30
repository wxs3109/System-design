# Optional: health status and configuration convergence

This article is only read when you need further explanation of "why different Data Planes make different decisions for a short period of time" and is not a requirement for first completion.

## 1. The three types of status cannot be mixed into one `healthy`

| Status | Primary Source | Semantics | Typical Aging |
|---|---|---|---|
| Membership | Registry / Control Plane | Whether Endpoint belongs to the current Pool | Configure propagation level |
| Readiness | Backend's own exposed readiness status | Whether the application declares that it has the minimum conditions to receive new requests | Life cycle / release level |
| Active Health | Data Plane active detection | Whether this Data Plane can successfully detect the Endpoint recently | Second level, local |
| Passive Health | Real request results | Whether the recent access to this Data Plane is abnormal | Request level, local |

Membership is the desired configuration, Readiness is the Backend statement, and Active/Passive Health is the imperfect observation of the Data Plane. After the Endpoint is deleted by the Registry, it should not receive new requests even if the last detection is successful; the Endpoint should not continue to be selected normally when it is still in Membership but not yet Ready, active detection fails, or the node fails to continuously connect.

Passive signals usually remain local because:

- The network path may be abnormal only for a certain Data Plane;
- Synchronizing all request results will amplify control traffic;
- Waiting for global consistency on the request path hurts availability and latency.

The cost is that different nodes temporarily choose different sets. The design goal is to limit the error window and Blast Radius, not to fabricate the instantaneous global truth.

## 2. Time budget for Health Check

If the detection is scheduled at a fixed starting interval $I$, the single timeout is $T$, the continuous failure threshold is $K$, and after a fault occurs, $T_{wait}$ is required to start the first failed detection, then the rough discovery time is:

$$
T_{detect}\approx T_{wait}+(K-1)I+T+T_{local\_apply},\qquad 0\le T_{wait}\le I
$$

If the detection must be serial and the interval is calculated from the last time it was completed, the formula will also include each round of waiting; we do not pursue false accurate values ​​here, but only require that the time between consecutive $K$ failures cannot be missed. $T_{local\_apply}$ only indicates the time when this Data Plane applies local judgment; the control plane propagation budget of Membership changes is calculated separately.

The specific schedule may be different, this formula is only used to expose Trade-off:

- Shorter intervals and lower thresholds: faster detection, higher detection costs and false picks.
- Longer intervals and higher thresholds: more resistant to jitter, longer true fault window.
- Only detect process survival: low cost, but may consider instances with unready dependencies as healthy.
- Execute full business query: more realistic, but may be expensive, have side effects or drain the full pool if a dependency fails.

The readiness endpoint should be cost-bounded, side-effect-free, and answer "can we accept new traffic now?" rather than trying to prove that all business paths are OK.

Passive signals must also be classified. Connection, TLS, protocol and proxy timeouts can usually reflect the Endpoint path; ordinary business `4xx` usually cannot, and general aggregation of all `5xx` may also misjudge request errors or common dependency failures as single machine failures.

## 3. Ejection, recovery and full pool failure

Passive Ejection requires a minimum of three boundaries:

1. Sample size and observation window: avoid an accidental error triggering removal.
2. Maximum Ejection ratio: To avoid ejecting all capacity when a common dependency fails.
3. Recovery detection and Slow Start: Prevent cold instances from being fully pushed back as soon as they are recovered.

When a few Endpoints are abnormal, Ejection can isolate gray faults; when all Endpoints are slow at the same time, the problem has changed from "selecting bad instances" to "Pool does not have enough capacity", and Admission Control and Load Shedding should be performed.

## 4. Snapshot generation and installation

The minimal relationship between configuration objects is:

```text
Listener → Route → Backend Pool → Endpoint Membership + Policies
```

The Control Plane should first construct the complete candidate Snapshot and then check:

- All reference objects exist, and there is no illegal conflict in Route.
- Listener, Route, Endpoint, and Object sizes do not exceed the maximum limit.
- TLS/Header trust boundaries and default routes comply with security constraints.
- The Version of the new Snapshot is monotonic and the content is verifiable; rollback is done by republishing the last known good content with a higher Version, rather than going backwards in version number.

The Data Plane builds the runtime structure in bypass mode after downloading; it is switched with an atomic reference only if it is completely successful. If it fails, continue to use LKG and report the NACK / Reject reason. Field-by-field modification in place will expose intermediate states and is not suitable for configuration semantics.

## 5. Version Skew is not an automatic error

Grayscale release means Fleet will briefly run $v$ and $v+1$ simultaneously. This is usually acceptable but requires:

- Statistics of requests, errors and delays by version.
- Limit the maximum propagation time and the proportion of lagging nodes.
- Use Expand / Contract or standalone Listener for cross-version incompatible changes.
- Know the worst-case stale window during emergency revocation, instead of just seeing if the publishing API was successful.

If the business requires all nodes to switch at the same instant, ordinary asynchronous configuration distribution cannot provide this promise; traffic isolation or switching protocols need to be redefined.

## 6. Control Plane fault matrix

| Scenario | What Data Plane can do | What it cannot do |
|---|---|---|
| Control Plane is temporarily unavailable | Use LKG to continue Route and proxy; maintain local health | Get new Routes, members, and policies |
| Registry updates stopped | Using last Membership with local probing | Reliably discover new instances or schedule deletions |
| The new Snapshot is invalid | Refuse to install, continue LKG | Splice some new fields into the old version |
| Some nodes are lagging behind | Continue to serve and expose Version Skew | Claim that Fleet has been globally and simultaneously switched |
| LKG too old | Continue, quarantine, or stop sensitive Routes according to predetermined policy | Temporarily guess security configuration |

The maximum age for LKG should be set based on risk. Ordinary member staleness may only increase failures; secure route or certificate revocation staleness may violate compliance, so a different fail-closed boundary may be required.

## 7. When to stop

Stop after you can explain the following questions:

- Why Membership and local Health exist at the same time.
- Why there must be a time window for fault detection and misjudgment of trade-off.
- Why Ejection is not a replacement for full pool overload protection.
- What Snapshot atomic installation guarantees and does not guarantee.
- What does LKG keep when the Control Plane loses contact, and what does it make obsolete.

Do not continue to expand Registry Consensus, Full Configuration Schema, Watch Protocol, and Managed Product Console.
