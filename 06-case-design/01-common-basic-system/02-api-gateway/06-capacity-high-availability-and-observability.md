# Capacity, high availability and observability

## What to estimate first

The capacity of the Gateway should not only be determined by QPS, but also should be considered at the same time:

- Peak QPS and number of policies per request;
- Average and P99 Request / Response size;
- Number of concurrent connections and number of new connections per second;
- TLS Handshake ratio;
- CPU cost for JWT validation, JSON conversion or compression;
- HTTP/2, WebSocket and other long-term connections occupy;
- Access log and trace write bandwidth.

The peak ingress bandwidth can be roughly estimated as:

$$
B_{in} = QPS_{peak} \times S_{request}
$$

The egress bandwidth is:

$$
B_{out} = QPS_{peak} \times S_{response}
$$

The number of instances should take the maximum value among the three constraints of QPS, bandwidth and number of connections, and retain fault capacity:

$$
N = \max\left(
\frac{QPS_{peak}}{QPS_{node}},
\frac{B_{peak}}{B_{node}},
\frac{C_{peak}}{C_{node}}
\right) \times H
$$

where $H$ is the capacity margin. The node benchmark must use close to real TLS, authentication and log configuration stress testing, and cannot just use pure forwarding data.

## High availability design

- Gateway instances are stateless and deployed across at least three Availability Zones.
- Load Balancer only sends new requests to instances that are healthy and have a valid configuration loaded.
- Each Availability Zone reserves sufficient capacity so that it can still bear traffic after a failure in one Availability Zone.
- Scale down and release first stop accepting new connections, and then drain ongoing requests.
- Configuration, certificates, public keys, and service discovery information have last known available caches.
- The control plane and data plane are expanded and released separately.
- Regional failures are switched by the upper-layer Global Traffic Manager, and a single Gateway is not allowed to decide cross-regional traffic on its own.

Just pressing CPU auto-scaling is not enough. Long connections may exhaust memory and the number of connections first, and network requests may reach bandwidth first. A combination of CPU, memory, number of connections, RPS, queue length, and latency should be used.

## Must-see indicators

| Type | Indicator | Question to answer |
|---|---|---|
| Traffic | QPS, concurrent connections, new connection rate, request bytes | Does the current pressure come from the number of requests or the number of bytes? |
| Delay | Gateway total delay, Gateway's own processing time, Upstream delay | Is the slowness at the entrance or the business service? |
| Errors | Error rate by Route, Tenant, Status | What types of callers and routes are affected? |
| Policy | Auth failure, flow limit rejection, WAF rejection | Is it an attack, configuration issue, or a normal incident? |
| Backends | Active Connections, Timeout, Retry, Circuit Open | Which backend is dragging down the entry? |
| Configuration | Current version, ACK rate, configuration age, number of rollbacks | Are all instances running the same stable configuration? |
| Resources | CPU, memory, network, file descriptors, connection pools | What resources are exhausted first? |

## Logs and Traces

Each access log contains at least:

- Time, Request ID and Trace ID;
- Route ID, configuration version and Gateway instance;
- Desensitized caller, tenant and client network information;
- Status code, request/response bytes and total time taken;
- Upstream Service, Upstream time consumption and number of retries;
- Whether the current limit, Circuit Breaker (circuit breaker) or degradation is hit.

When tracking, it is necessary to distinguish between the gateway's own time consumption and the upstream time consumption. Otherwise, you will see the entrance P99 rising, but you will not be able to determine whether authentication, queuing, network or business services are slowing down.

## Recommended SLO

Gateway SLO should only measure failures and delays caused by the Gateway itself, and avoid counting business `4xx` explicitly returned by the backend as Gateway unavailability. While retaining the end-to-end API SLO, measure the complete link from the user's perspective.
