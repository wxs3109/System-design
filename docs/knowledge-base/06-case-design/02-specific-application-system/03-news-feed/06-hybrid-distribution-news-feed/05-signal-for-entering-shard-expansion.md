# Signal for entering shard expansion

06 solves the Write Amplification of a single Celebrity Account, which does not mean that the entire system can already host one billion users.

Signal to enter 07:

- The capacity utilization of a Post, Follow, FeedItem or Timeline single cluster is close to the preset safety threshold;
- The write throughput of a single primary partition reaches the upper limit;
- There is a persistent hot key in Followers or FeedItem;
- Data retention and replication costs require independent expansion by partition;
- The fault domain of a single cluster is too large and the blast radius needs to be reduced.

The next version will only solve data and traffic fragmentation, and will not invent new feed algorithms at the same time.

[Enter 07 sharding extended version](../07-sharding-extension-news-feed/README.md)

[Return to the sixth edition directory](README.md)
