# Load Balancer：Parking Lot

The following topics are not required for completion of this case. Reopen only when real demand or measurement bottlenecks arise.

## 1. Global entrance and multiple Regions

Reopening conditions: Inlets need to be selected among multiple Regions based on latency, compliance, capacity or fault status.

It will then need to be redefined:

- Selection boundaries for DNS, Anycast, Global Proxy or Client Routing.
- Failure window caused by Region Health, traffic transfer speed and client cache.
- The relationship between Active-active/Active-passive, data availability and business failover.
- Cross-region egress, capacity reservation and backend contract after failover.

Intra-regional Endpoint Selection cannot automatically launch global traffic scheduling.

## 2. L4 Fast Path and underlying network implementation

Reopening conditions: HTTP semantics are not required, or measurements prove that Packet Rate, Connection Rate, proxy copy, and TLS have become the dominant bottlenecks.

Then compare:

- NAT, Full Proxy, DSR and Passthrough.
- VIP announcement, ECMP, Anycast and fault convergence.
- Kernel Proxy, eBPF, DPDK / Kernel Bypass and hardware offloading.
- Source IP, Port Exhaustion, MTU, Fragmentation and Flow Affinity.

These details change the data surface model and should be learned as independent variants rather than being shoehorned into the current L7 mainline.

## 3. Complete protocol and certificate platform

Reopening conditions: Target products must uniformly support HTTP/3, QUIC, UDP, bidirectional Streams, large-scale certificate hosting, or mTLS identities.

At that time, protocol negotiation, certificate distribution and rotation, Secret isolation, session recovery, revocation propagation and compatibility matrix will be redesigned. The first learning only retains the TLS termination position and trust header boundaries.

## 4. Advanced scheduling and global load view

Reopening conditions: Stress testing or production measurements demonstrate that the local Weight + In-flight / Latency selection cannot meet tail latency or utilization goals.

Only then will we study:

- Parameters and stability of EWMA, Peak EWMA, Power of Two Choices.
- Consistent hashing, remapping properties of Rendezvous and Maglev.
- Global Load Report, Subset Routing and Locality-aware Routing.
- Queue-aware, Cost-aware or predictive scheduling.

Load units and failure signals must be stated first; algorithm names are not substituted for Workload measurements.

## 5. Fully managed Load Balancer product

Conditions for reopening: The goal changes from learning cases to a real multi-tenant platform.

Then redesign:

- Listener / Route / Pool CRUD, Approvals, RBAC, Auditing and Tenant Quota.
- Certificates, domain names, static IPs, billing, console and migration.
- Complete log query, SLO, alarm, runbook, upgrade and disaster recovery.
- Configuration compatibility, API Version, tenant isolation and product SLA.

API authentication, business authorization, Rate Limit and Request Transformation still belong to API Gateway, rather than being annexed by expanding the LB product.

## 6. Reopening rules

The Parking Lot theme will enter the main design line only if it meets the following conditions:

1. Real demand or measurement bottleneck occurs.
2. It changes the architecture, invariants, dominant capacity, fault semantics, or call contract.
3. Can explain the specific scenario in which it will fail if you don’t do it.
4. Set new completion standards and stopping points for it.

Otherwise, the Parking Lot status remains.
