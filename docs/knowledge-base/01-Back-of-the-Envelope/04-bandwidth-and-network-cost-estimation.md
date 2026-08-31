# Bandwidth and network cost estimation

## 1. Basic formula

$$\text{Bandwidth} = \text{Requests per Second}\times\text{Average Bytes per Request}$$

Estimate separately:

- Ingress uploaded by the client;
- Return the user's egress;
- east-west traffic between services;
- Database replication and shard migration;
- Cross-AZ, cross-region and CDN Origin Traffic.

## 2. byte/s and bit/s

If the system sends 500 MB per second:

$$500\text{ MB/s}\times8=4,000\text{ Mbit/s}=4\text{ Gbit/s}$$

Just multiply by 8 during the interview. Real-world links also consider protocol overhead such as TCP/TLS/HTTP, retransmissions, packet sizes, and bidirectional traffic, so payload throughput will not equal the nominal link capacity.

## 3. Common API example

Assume a peak read of 100,000 QPS and an average response payload of 20 KB:

$$10^5\times2\times10^4=2\times10^9\text{ B/s}=2\text{ GB/s}$$

That is, the payload outbound is about 16 Gbit/s. If compressed to an average of 8 KB, this drops to approximately 6.4 Gbit/s. In reality, response size distribution and compression ratio need to be measured, and P99 large responses may affect Tail Latency and memory.

## 4. Media streaming example

Media is more suitable to use bitrate directly. If 1 million users watch video at an average of 4 Mbit/s simultaneously:

$$10^6\times4\text{ Mbit/s}=4\text{ Tbit/s}$$

This illustrates the need for global edge distribution. If the CDN Byte Hit Ratio is 95%, the theoretical Origin Payload Traffic is approximately:

$$4\text{ Tbit/s}\times(1-0.95)=200\text{ Gbit/s}$$

In reality, Origin Traffic is also affected by Request Hit Ratio, content popularity, Range Request, Cache Key, Pre-warming, Invalidation and multi-bitrate switching.

## 5. Two hit rates of CDN

- **Request hit ratio**: How many requests are handled directly by the edge;
- **Byte hit ratio**: How many transmitted bytes are provided by the edge.

When small objects hit a lot but large videos access Origin frequently, the Request Hit Ratio may be high, but the Byte Hit Ratio is not ideal. Estimating bandwidth and cost should prioritize Byte Hit Ratio.

$$\text{Origin Egress}=\text{User Egress}\times(1-\text{Byte Hit Ratio})$$

## 6. Internal traffic amplification

The user writes 1 byte, which may occur internally:

- Three copies of writing;
- Logging, indexing and event streaming;
- Replication across availability zones;
- Data verification and background processing.

Define network amplification factor:

$$\text{Internal Traffic}=\text{External Payload}\times\text{Amplification Factor}$$

During the interview you can tentatively set $3\times$ or $5\times$ and list the sources; realistic values ​​come from network telemetry and architectural topology measurements.

## 7. Delay lower limit and distance

The propagation speed of light in optical fiber is about $2\times10^8$ m/s, which is a one-way theoretical speed of about 200 km/ms; the actual path is not a straight line and also passes through routing and equipment. So cross-continental RTT is typically tens to hundreds of milliseconds.

This means:

- Cross-continental synchronous calls cannot meet single-digit millisecond response;
- Multiple serial cross-regional round trips will accumulate delays;
- Global systems should consider nearby reads, data placement and asynchronous replication.

For interviews, the same-region RTT $\sim1$ ms and cross-continent RTT $\sim100$–$200$ ms can be used as orders of magnitude. In reality, P50/P95/P99 should be measured from the target area.

## 8. Bandwidth charges

Cloud network prices vary by provider, region, direction, contract, and CDN tier and should not be tied to a permanent price per gigabyte. Realistic cost models distinguish at least:

- Internet egress;
- Cross-region and cross-AZ traffic;
- CDN request and byte charges;
- Dedicated line, load balancing and NAT processing fees;
- Free quota or tiered prices.

If the question in the interview focuses on cost, you can state an example unit price of $c$ USD/GB:

$$\text{Monthly Cost}=\text{Monthly Egress in GB}\times c$$

The key is to identify where egress or cross-region replication may become a major cost, rather than guessing at current vendor pricing.

## 9. The link capacity cannot be full.

Real-world networks must leave room for bursts, retransmissions, node failures, and traffic migration. Long-term utilization goals depend on the speed of expansion and failure models. During the interview, you can assume that only 50%–70% of nominal capacity is being used and make this clear.

For example, a 40 Gbit/s payload is required, and the target utilization is 60%:

$$\frac{40}{0.6}\approx67\text{ Gbit/s provisioned}$$

Afterwards, it is necessary to verify the path capacity after single-node network card, switching layer, and availability zone failures.

## 10. Checklist

- [ ] Are bit and byte converted correctly?
- [ ] Are ingress, egress and internal traffic separated?
- [ ] Use average object size, or take the long tail into account?
- [ ] Are peak concurrency and media bit rates included?
- [ ] Does CDN look at request hit rate or byte hit rate?
- [ ] Is replication, replay, migration, and repair traffic missing?
- [ ] Do cross-region delays and costs impact the architecture?
