# Case study and design checklist

This section does not start from components, but derives solutions from SLOs, work amplification, and bottlenecks. Figures are assumptions used to demonstrate methods and actual designs should be replaced with measured values.

## Case 1: Why did API Gateway’s P99 suddenly deteriorate?

### Scenario and goal

Assuming the ingress peak is 20,000 QPS, after Gateway adds authentication, current limiting, and routing, its own P99 target is 30 ms; the end-to-end API P99 is 500 ms. During a certain downstream failure, the Gateway CPU was only at 45%, but the end-to-end P99 increased to 4 seconds.

### Do not add an instance first

Trace shows that the Gateway itself takes only 8 ms to calculate, and a large number of requests are waiting for the Upstream connection. Normal average response is 100 ms, average in transit is approximately:

$$
20{,}000\times0.1=2{,}000
$$

After slowing down to 2 s downstream, the same arrival rate results in about 40,000 requests in transit. They fill up the connection pool and memory, and then healthy routes start to be queued. Low CPU does not mean that the system has margin. Connections and waiting queues are saturated resources.

### design

1. Gateway 500 ms Deadline propagates downward, and Upstream Timeout leaves a margin for error return, such as no more than 400 ms.
2. Set the connection pool and concurrent bulkhead according to the backend. Slow backends cannot occupy all entry resources.
3. The queue only retains requests that can be started within the deadline, and will quickly return `503` if the limit is exceeded.
4. Only perform limited retries at a single layer for idempotent requests that still have budget, and set a Retry Budget.
5. Non-critical enrichment will be skipped if it times out; the results of authentication and payment callbacks cannot be guessed.
6. Long export returns `202 + job_id`, which does not account for the number of ordinary API connections.

### Trade-off

Fast rejection will make the error rate immediately visible, but protect other routing and recovery capabilities; unbounded waiting may seem to return fewer errors, but will actually cause the request to timeout on the client and amplify the site-wide failure. Shorter Timeout reduces resource usage and may accidentally kill healthy slow requests, so it must be calibrated by routing SLO and dependency distribution.

### verify

- Inject a 2 s delay into one backend to confirm that other backends P99 are still within the target;
- Confirm that downstream work and connections are released as soon as possible after upstream cancellation;
- Compare the number of external requests and the number of internal attempts to check retry amplification;
- Monitor Gateway own time, Upstream time, pool wait, queue wait, and per-route rejection rate.

See [API Gateway: Timeout Retry and Failure Degradation] (../../06-Case Design/01-General Basic System/02-api-gateway/04-Timeout Retry and Failure Degradation.md).

## Case 2: Fan-out on Read and Fan-out on Write of News Feed

### Scenario and goal

The homepage peak is about 200,000 QPS, and the P99 target is 500 ms. The average user follows 200 people, but a few users follow tens of thousands; while an average author has hundreds of followers, Celebrity Author may have hundreds of millions of followers.

### Fan-out on Read Questions

Every time you open the home page, many author timelines are read in real time, and then merged, sorted, and completed. The benefits are that posting is cheap and the results are fresh; the cost is that the workload of the homepage increases with the number of followers, and the Scatter-Gather amplifies the tail delay. Caching can reduce duplicate reads, but misses and superuser still decide P99.

Applicable stage: The traffic is small, the number of followers is limited, or the product updates frequently and the pre-calculated hit value is low. The upgrade signal is not "there are many users", but cache miss P99, scan volume, and the slowest shard can no longer hold the SLO.

### Fan-out on Write problem

After posting, FeedItem is written asynchronously for fans, and the homepage becomes read in the order of user partitions, with stable read latency; the cost is Write Amplification, storage and freshness delays. Assume that there are 100 million Posts per day and each ordinary Post is distributed to an average of 200 people:

$$
10^8\times200=2\times10^{10}\text{ FeedItem/day}
$$

The average is about 230,000 logic writes/s, with peaks higher. If Fan-out on Write is also implemented for Celebrity Author with hundreds of millions of fans, a single Post will cause huge spikes and long tail backlogs.

### Hybrid design

- Ordinary authors use Fan-out on Write to batch write to user Shard through Queue;
- Celebrity Author retains the Author Timeline and performs Fan-out on Read;
- Parallel reading of pre-generated feeds and a small number of large timelines on the home page, and bounded merging;
- Feed Head cache ID, do not copy the text in each user cache;
- Select a small number of candidates. If a certain text fails to be completed, it will be skipped and replaced; permissions and deletion status must still be verified.

### Trade-off

The hybrid mode simultaneously assumes two sets of paths and switching semantics, but limits extreme Write Amplification to a few authors and wide-read Fan-out to a small number of Celebrity Accounts. The threshold should be derived from the expected workload per post, queue freshness SLO and Read Amplification, not just the fixed number of fans.

### verify

- Separately observe P99 of cache hit/miss, ordinary/super author and attention bucket;
- Monitor the end-to-end P95/P99 visible from Post to FeedItem, instead of just looking at the Queue length;
- Simulate posts by popular authors to confirm that they will not crowd out all ordinary author tasks;
- Slow down a timeline shard, verify deadline, partial fill and degrade status.

See [News Feed Evolution and Upgrade Signals](../../06-case-design/02-specific-application-system/03-news-feed/README.md).

## Case 3: When tickets go on sale, can the queue prevent oversold?

### Scenario and goal

At the moment of sale, there were 100,000 requests/s for lock seats, and the inventory service stably processed 15,000/s. Business requirements are never oversold, and users should know within 2 seconds whether they are "qualified for processing, sold out, or the system is busy"; payment must be completed within 5 minutes after locking the seat.

### Wrong solution: Put all into the unbounded queue

That’s a net increase of 85,000 requests in the first second. Even if the spike subsequently ends, users at the back of the queue may wait until seats are sold out before receiving a failure. Queues do not create inventory or processing capacity and do not replace conditional writes on the same seat.

### Hierarchical Admission and fact submission

1. Edge limits traffic by account, device and activity to block robots and duplicate submissions.
2. Admission Service issues bounded queuing qualifications based on the activity processing budget; requests that exceed the redeemable window are rejected as early as possible.
3. Implement a single authoritative condition write for a specific seat or inventory bucket, and only it determines whether to lock or not; the queue order itself does not equal overbooking prevention.
4. After success, the hold ID and expiration time are returned, and the payment goes through an idempotent state machine.
5. Notification, analysis and candidate advancement are asynchronous and do not belong to the synchronization boundary of successful locking.
6. Set independent quotas for different activities and seating areas to prevent one popular activity from occupying all Workers.

If a virtual waiting room is used, it must be made clear that "entering the queue" only means that you have obtained a queue position, not that your seat has been locked. Client polling should jitter or use push, otherwise status query will cause a second traffic peak.

### Trade-off

Admission will reject some real users, but make it more likely that the admitted ones will get a definite result within the promised time, and protect the inventory authority. Strict FIFO seems fair, but disconnection recovery, bots, multiple accounts, and requests with different costs make it not inherently fair; it requires signed queuing credentials, rate limiting, and clear expiration semantics.

### verify

- Using the open model to generate a burst of 100,000/s, confirm that the queue is still bounded after completing the throughput platform;
- Verify that at most one concurrent request for the same seat is successful, and the query can restore the determined state after Timeout;
- Record admission rejects, expected/actual waits, locking condition conflicts, and per-activity fairness;
- After the pressure is over, measure the recovery and clearing backlog time to confirm that retrying does not create a second wave of peaks.

See [Ticket Booking](../../06-case-design/02-specific-application-system/08-ticket-booking/README.md).

## Case 4: Why can’t YouTube just watch QPS?

QPS for video platform control plane upload completion, metadata, and playback authorization may be much lower than media distribution requests, but capacity is often dominated by byte throughput, concurrent playback, and egress costs.

If 1 million people watch simultaneously at 5 Mbit/s, the media outlet is approximately:

$$
10^6\times5\text{ Mbit/s}=5\text{ Tbit/s}
$$

A normal API Gateway should not proxy all media bytes. The client obtains shards from CDN, and Origin is hosted by object storage; Gateway is only responsible for authorization and Signed URL. Popular content uses CDN hits to reduce Origin bandwidth, while cold content and cache invalidation must be protected by Origin.

The performance target is not just API P99: the first frame time, freezing rate, bitrate switching and playback failure are closer to the user experience. High bit rate improves image quality, but increases bandwidth, weak network lag, and cost; ABR uses fragmented download throughput and buffer to dynamically choose between these goals.

See [YouTube](../../06-case-design/02-specific-application-system/05-video-streaming/README.md).

## Design template

```text
Scenarios and users:
End-to-end measurement boundaries:
SLO: Availability / P50 / P95 / P99 / Freshness
Average and peak arrival rates:
Request and response size distribution:
Read-write ratio and single-request work amplification:
Hot spots, big objects and big tenants:
Serial Critical Path vs. Parallel Fan-out:
Deadline and budget for each stage:
CPU / IOPS / Bandwidth / Connection / Memory Dominance:
Single node safety capacity and failure margin:
Queue ceiling and maximum acceptable wait:
Admission, current limit, fairness and downgrade order:
Cache Hit/Miss semantics and Origin Protection:
Stress testing model, fault injection and upgrade signals:
```

## Review questions

- Where do the metrics start and end, and are timeouts and errors counted?
- Why the P95/P99 target and which user action does it correspond to?
- How are average, peak and activity spikes converted, and what is the internal working amplification?
- Does the single-machine benchmark use real TLS, object sizes, hotspots, and cache hit rates?
- Which resources become saturated first, and will adding application instances just overwhelm shared dependencies?
- P99 Is the slowness caused by queuing, calculation, IO, locks, GC, connections or a certain shard?
- How wide is the synchronous fan-out and do I have to wait for all branches?
- Is the deadline propagated? Can the downstream be canceled after the caller gives up?
- How long can the queue absorb the peak value, and how long does it take to catch up to the latest Queue Offset after the peak? What is the oldest task age target?
- Who should be rejected first and who should be retained when overload occurs? How can tenants be fair?
- How much internal traffic will be amplified by Retry, Hedge, Reconnect and Cache Database Fallback?
- What SLOs can be maintained against single zone failures, cache full invalidations, and backfill operations?
- When do you need to evolve from read-time computation to precomputation, sharding or asynchronous?

[Previous section: Queuing and overload](05-queueing-backpressure-and-overload-protection.md) · [Return to the entrance of this chapter](README.md)
