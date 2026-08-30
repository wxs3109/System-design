# Why pre-generate feeds

## Fundamental limitations of version 3

Read replicas and Redis increase available resources, but do not reduce the calculation required for a feed cache miss:

```text
Following(Bob) → Find each author’s Post → Merge sort → Return 20 items
```

Every time Bob refreshes, the system repeatedly calculates "which posts belong to Bob's homepage".

## Move calculations after writing

After Alice posts, the system already knows which fans this Post may belong to. You can write in advance in the background:

```text
FeedItem(Bob, post-123)
FeedItem(Carol, post-123)
FeedItem(Dave, post-123)
```

In the future, when Bob opens the homepage, he only needs to query his own FeedItem partition.

## Read and write trade-offs

| Plan | Post | Home Page Reading |
|---|---|---|
| Third Edition: fan-out on read | Cheap | Every live JOIN and aggregation |
| Fifth Edition: fan-out on write | Write one for each fan | Single-user partition sequential reading |

Feeds typically read more than they write, so more background writes are traded for a shorter, more stable synchronous read path.

## Why is asynchronous needed?

Alice's post request cannot be made to wait for all fans to finish writing:

- The response time will increase with the number of fans;
- A fan partition failure will slow down posting;
- After the request times out, it is difficult to determine who has written.

So the synchronization boundary continues to use 04 verified Post + Outbox; 05 only adds downstream FeedItem tasks.

[Return to the fifth edition directory](README.md)
