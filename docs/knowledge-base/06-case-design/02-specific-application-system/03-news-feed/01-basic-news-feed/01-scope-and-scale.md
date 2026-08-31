# Scope and scale

## Goals of this version

This version defines a minimal News Feed that is learnable and implementable. First clarify the product boundaries and scale, and then use a relational database to complete the implementation.

The goal is to make the solution simple enough while retaining clear performance bottlenecks as a starting point for subsequent step-by-step evolution.

## Functional requirements

- Users can publish text-only posts.
- Users can follow or unfollow other users.
- The homepage displays posts posted by followed users in reverse chronological order.
- Users can delete their own posts.

## Not supported yet

- Like, comment and retweet.
- Recommended content or personalized sorting.
- advertise.
- Picture or video.
- Edit post.
- Complex privacy rules such as group visibility and only friends visibility.
- Real-time push and multi-regional deployment.

## Scale Assumptions

| Project | First Version Hypothesis |
|---|---|
| Daily active users | About 100,000 |
| Each active user reads the homepage | approximately 20 times per day |
| Home page reads | About 2 million times/day, average about 23 QPS |
| Peak traffic | Estimated at 5 to 10 times the average, the homepage is about 120 to 230 QPS |
| Overall peak value | Including posts and follows, about hundreds of times per second |

This version does not have real-time long connections. "Thousands of people online at the same time" does not equal thousands of QPS, so the request volume and peak QPS are mainly used to plan capacity.

A set of stateless application instances, plus a relational database, can serve as a starting point for this magnitude. The second edition will first cover data replication and backup; Read Replica and Redis will be left to the third edition.

## Scale issues not solved in this version

- One billion users and massive Posts.
- Celebrity Account's huge number of followers.
- Cross-database sharding and global multi-region traffic.
- Pre-generated home page for each user.
- Recommendation sorting and complex content review.

Subsequent versions handle data reliability, read expansion, asynchronous indexing, pre-generated feeds, Celebrity Account, sharding and production recovery step by step.

[Return to the first version directory](README.md)
