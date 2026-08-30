# DNS and Global Traffic Entry

DNS and global traffic entry solve the question: which public entry point should a user contact on the first visit to a service?

This article treats them only as off-the-shelf components and focuses on what an application can configure and what a client can observe. It does not cover DNS message formats, recursive algorithms, BGP routing algorithms, or revisit the principles of cross-region disaster recovery.

## 1. Position in the System

    Client
      → Recursive DNS Resolver
      → Authoritative DNS / Global Traffic Manager
      → Regional public endpoint
      → Load Balancer

DNS returns “where to connect”; it does not proxy subsequent requests. After receiving an address, the client establishes a connection to the regional entry point, load balancer, or edge network.

Some products select a region through DNS responses. Some expose an Anycast IP and let the network direct connections to a nearby entry point. Others combine both approaches. A design depends on their external contracts; it does not need to design their internal routing protocols.

## 2. Input, Output, and Success Semantics

| Item | Description |
|---|---|
| Input | Domain name, record type, resolver location, routing policy, and endpoint health |
| Output | An IP address, another domain name, or no result; the response usually includes a TTL |
| DNS success | The resolver obtained an answer permitted by the current policy |
| Does not mean | The target is reachable, the application is healthy, the request will succeed, or traffic necessarily enters the nearest region |

Only the purposes of common records need to be understood: A and AAAA return IP addresses; CNAME points to another name; cloud vendors' Alias-like features can point an apex domain to a managed entry point, subject to product-specific restrictions.

## 3. TTL Is a Cache Contract

TTL tells resolvers and clients how long an answer may be cached. Even with a TTL of 60 seconds, changing a record cannot promise that “all users will complete the switch within 60 seconds”:

- resolvers with cached data may continue using the old answer;
- established TCP, TLS, or other long-lived connections do not migrate automatically when DNS changes;
- applications, operating systems, and proxies may have their own caches and connection pools;
- failover also includes health-detection, configuration-propagation, and client-reconnection time.

A shorter TTL generally lets new queries observe changes sooner, but increases authoritative queries and reliance on the DNS control plane. A longer TTL improves cache hits and resilience to brief failures, but leaves incorrect addresses in use longer.

## 4. Global Routing Capabilities

| Policy | Suitable for | Primary limitation |
|---|---|---|
| Weighted | Canaries, migrations, and proportional traffic splitting | Controls the proportion of DNS answers, not an exact proportion of every request |
| Latency | Selecting a region with lower estimated network latency | Resolver location may differ from user location; a fast network does not imply a fast application |
| Geo | Data residency, authorization scope, and localization | IP geolocation is imprecise; a default rule must be defined |
| Failover | Simple primary/standby entry points | Subject to probe and cache delay; does not prevent conflicting business writes |
| Multi-value | Returning multiple healthy addresses | Client selection is not fully controllable and is not complete load balancing |

With Anycast, multiple locations announce the same IP address and the network usually routes a connection to a reachable location with a nearby path. An application cannot rely on “always entering the geographically nearest data center,” nor assume that a path change will preserve an existing connection.

The global entry point selects a region or edge entry point. Instance selection within a region belongs to [Load Balancers and Reverse Proxies](../02-load-balancers-and-reverse-proxies/).

## 5. Health-Probe Contract

When selecting a product, verify:

- where probes originate and which protocol they use;
- probe interval, timeout, failure threshold, and recovery threshold;
- whether the probe checks only the entry process or a bounded path through critical dependencies;
- how long a status change takes to propagate into actual routing;
- whether the product returns the last known endpoint, a standby endpoint, or no answer when every endpoint is unhealthy.

A probe that is too shallow can retain a region that cannot serve traffic. A probe with dependencies that are too deep can let a noncritical dependency failure trigger endpoint removal in every region. A health endpoint should answer, “Can this entry point safely accept requests?”

## 6. Configuration, Capacity, and Cost

| Item | Why it matters |
|---|---|
| TTL and negative caching | How long successful or nonexistent answers remain cached |
| Routing-rule priority | Combining policies can produce an unexpected default route or fallback |
| Probe parameters | Overly aggressive probes can remove endpoints incorrectly; slow probes delay failover |
| Record and policy quotas | Large numbers of tenant domains and ephemeral environments may reach limits |
| Query and probe charges | Often billed separately from application traffic |
| DNSSEC and change permissions | Incorrect keys, delegation, or permissions can make an entire domain unresolvable |

Do not treat application QPS as DNS QPS. Resolutions are cached, and many users may share a recursive resolver.

## 7. Failure Behavior

| Failure | What a caller may observe |
|---|---|
| Authoritative DNS is briefly unavailable | Users with cached answers continue; new resolutions or expired caches time out |
| A record is deleted accidentally | New queries receive NXDOMAIN; negative caching temporarily hides the repair |
| A regional entry point fails | Old entry points may still be returned until probes and answers update |
| A Geo rule is wrong | Some regions receive no answer, enter the wrong region, or violate residency requirements |
| An Anycast path changes | New connections enter another location; existing connections may be re-established |

DNS failures often appear as “only some users fail.” Troubleshooting must examine authoritative records, resolution results from multiple regions, TTLs, endpoint health, and actual connection targets together.

## 8. Common Products and Selection

| Product form | Examples | Verify first |
|---|---|---|
| Authoritative DNS | Route 53, Azure DNS, Google Cloud DNS, Cloudflare DNS | Record, DNSSEC, query, and change quotas |
| DNS-based global traffic management | Route 53 Routing, Azure Traffic Manager | Routing, probes, and failover behavior under caching |
| Proxy-based global entry | Azure Front Door, Google Cloud Load Balancing, Cloudflare | Anycast, TLS, L7 proxying, and origin capabilities |

Product capabilities change. Verify the current contract for the target geography, SKU, and protocol.

## 9. Remaining Application Responsibilities

- The standby region must have the required data, keys, configuration, and capacity.
- Define how existing connections, write requests, and background tasks behave during failover.
- Change weights in stages and prepare a rollback.
- Monitor actual resolution and end-to-end success rates, not just the DNS control plane.
- Prevent misconfiguration and retain approvals, version history, and recovery paths.

DNS can direct new connections to another entry point, but it cannot solve data replication or write conflicts. For the relevant principles, see [CAP and Consistency Models](../../02-core-concepts/03-cap-and-consistency-model/) and [Fault Tolerance and Disaster Recovery](../../02-core-concepts/07-fault-tolerance-graceful-degradation-and-disaster-recovery/).

## 10. Small Case Study and Checklist

Suppose there is one region in North America and one in Europe. North America can initially remain the default entry point, a small traffic weight can validate Europe, and then Geo routing can direct European users there. The design must state that TTLs and existing connections prevent an instantaneous switch, and confirm that the European region's data and capacity are ready.

Before selection, answer:

- Is a DNS policy needed, or a proxy-based Anycast entry point?
- Is routing based on latency, location, weight, health, or compliance?
- Is the TTL compatible with the actual failover target?
- How does the product respond when every endpoint is unhealthy?
- How do established connections reconnect?
- How will actual results be validated from multiple regions?
