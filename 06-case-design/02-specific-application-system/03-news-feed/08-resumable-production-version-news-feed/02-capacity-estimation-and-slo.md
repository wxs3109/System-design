# Capacity estimation and SLO

## Why estimate first?

"One billion users" alone does not dictate architecture. What really affects the design are active users, read frequency, post volume, average number of people distributed, and data retention time.

The following numbers are order-of-magnitude assumptions to facilitate interview calculations and do not represent public data for a real product.

## Users and read traffic

| Project | Hypothesis |
|---|---|
| Registered users | 1 billion |
| Daily active users | 300 million |
| Feed opened per DAU per day | 20 times |
| Each return | 20 items |
| Peak factor | 3 times the average |

Daily feed requests:

$$
3 \times 10^8 \times 20 = 6 \times 10^9
$$

Average feed QPS:

$$
\frac{6 \times 10^9}{86{,}400} \approx 70{,}000
$$

Peak feed QPS:

$$
70{,}000 \times 3 \approx 210{,}000
$$

Therefore, the homepage path needs to support about 200,000 peak QPS, rather than directly deriving 1 billion QPS from 1 billion registered users.

## Posting and Writing to FeedItem

Assume 100 million posts are generated every day. For Posts with Fan-out on Write, assume that FeedItems are generated to an average of 200 currently active fans.

Daily FeedItem:

$$
10^8 \times 200 = 2 \times 10^{10}
$$

Average FeedItem write rate:

$$
\frac{2 \times 10^{10}}{86{,}400} \approx 230{,}000\text{ writes/s}
$$

Based on a 3x peak estimate, approximately 700,000 FeedItem logical writes are required per second. The worker will write in batches according to the target shards and will not send a separate network request for each row.

This order of magnitude explains:

- FeedItem must be sharded by user;
- fan-out must be processed asynchronously in batches;
- Celebrity Account cannot use Fan-out on Write;
- Queues and Workers must scale horizontally.

## Storage estimate

### Post

Assume a plain text Post with row and index overhead of about 1 KB:

$$
10^8 \times 1\text{ KB} = 100\text{ GB/day}
$$

Approximately 36.5 TB of raw data per year, excluding replicas and indexes.

### FeedItem

Assuming that FeedItem only saves ID, time, version of concern and necessary row overhead, about 64 B:

$$
2 \times 10^{10} \times 64\text{ B} \approx 1.28\text{ TB/day}
$$

Hot data is retained for 30 days:

$$
1.28\text{ TB/day} \times 30 \approx 38\text{ TB}
$$

About 115 TB after using 3 replicas. Older FeedItems can expire; Post and Author Timelines still preserve content facts and author history.

### Follow

Assuming that each registered user follows an average of 200 people, there are about 200 billion relationships in total. Both the Follow fact record and the Followers reverse index will become primary storage, so they must be sharded and support lifecycle management and Reconciliation (difference checking and repair).

## SLOs and consistency goals

| Abilities | Goals |
|---|---|
| GET /feed availability | 99.95% |
| GET /feed delay | P95 < 200 ms, P99 < 500 ms |
| Regular Author FeedItem Freshness (data visibility delay) | 99% visible within 10 seconds, 99.9% visible within 60 seconds |
| Celebrity Account new posts Freshness | 99% entered within 5 seconds Author Timeline |
| Deletion is invisible | 99% effective within 5 seconds |
| Invisible when disabled | 99% effective within 5 seconds |
| Data persistence | Confirmed Post and Follow will not be lost due to single machine failure |

Normal author distribution uses Eventual Consistency. The success of the posting interface means that the Post and subsequent tasks have been reliably saved, but it does not mean that all fans have received the FeedItem simultaneously.

Priority is given to deleting posts and unfollowing them to ensure their invisibility; even if the derived index is not physically cleaned, the homepage will be filtered according to the current Post and Follow status when assembling it.

## How numbers influence design

| Numbers | Corresponding design decisions |
|---|---|
| About 200,000 peak Feed QPS | FeedItem single-shard read, cache, read-only copy |
| Approximately 700,000 peak FeedItem writes/s | Queue, batch, and sharding rate limits |
| Celebrity Account hundreds of millions of fans | Fan-out on Read |
| FeedItem ~1.28 TB per day | Limited retention, sharding and lifecycle cleanup |
| 5~10 seconds Freshness target | Asynchronous is acceptable, but end-to-end latency must be monitored |

[Return to the eighth edition directory](README.md)
