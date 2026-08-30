# 09 Rich media and interactive version: News Feed

> Scale and restoration base inherited from 08. This version changes product functionality for the first time: adding Likes, images, GIFs, videos, reply threads, retweets, trackbacks, bookmarks, votes, and interaction counts.

## Reading order

1. [Modern X functional map and scope of this edition] (01-X functional map and scope of this edition.md)
2. [Demand, Capacity and SLO](02-demand-capacity-and-slo.md)
3. [Post type and interactive data model](03-post-type-and-interactive-data-model.md)
4. [General process of media upload](04-general-media-upload-process.md)
5. [Image Processing and Delivery](05-image-processing-and-delivery.md)
6. [Video transcoding and playback](06-video-transcoding-and-playback.md)
7. [Reply, thread, forwarding and citation](07-replies-threads-forwards-and-quotes.md)
8. [Feed Assembly, Notification and Counting](08-feed-assembly-notification-and-counting.md)
9. [Visibility, review and deletion](09-visibility-moderation-and-deletion.md)
10. [Role, component and data list](10-list-of-roles-components-and-data.md)
11. [Reliability, cost and subsequent evolution] (11-Reliability cost and subsequent evolution.md)
12. [Function and data migration from 08 to 09] (12-Function and data migration.md)

## Core design of this version

- Post Store only saves text, relationships, and Media IDs, not image or video binaries.
- Clients use Upload Session and pre-signed URLs to directly upload media to object storage.
- Pictures are asynchronously generated thumbnails and modern formats; videos are asynchronously transcoded into multi-bitrate slices.
- The CDN is responsible for media download traffic, and the application server only performs authentication, metadata and playback authorization.
- FeedItem still only saves `post_id`, and the media information is assembled in batches during the Feed Hydration stage.
- Replies and quotes are Posts; Repost, Like, and Bookmark are the relationships between users and Posts.
- All public interactions generate events that asynchronously drive counting, notifications, search indexing and feed distribution.

## Boundary with 01–08

01–08 only extends the same minimal set of features, explicitly without Like. 09 is the new feature version: Like Store, Interaction API, interaction count and notifications all start from here, the initial state is empty, and no historical Likes are faked.

## This version explicitly does not do

- For You recommendation ranking model;
- Full text search, explore and trend calculation;
- Private messages, group chats and audio and video calls;
- Spaces and live streaming;
- Communities、Lists；
- Community Notes；
- Advertising, subscriptions, revenue sharing and payments;
- Premium rights and account authentication system.

These capabilities have been registered in the functional map and should be used as subsequent independent versions or independent cases, rather than continuing to expand an architecture diagram.

[Return to News Feed evolution path](../README.md)
