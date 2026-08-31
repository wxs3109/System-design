# Modern X functional map and scope of this edition

## illustrate

The following is a classification of product capabilities for use in System Design learning, not an exact product contract for X. Specific features may vary over time, platform, region, account type and subscription level.

## Function map

| Field | Common capabilities of modern X-type products | 09 Whether to implement |
|---|---|---|
| Publish | Short text, long text, pictures, GIFs, videos, votes, mentions, tags | Implement pictures/GIF/videos/votes/mentions/tags; post long articles |
| Sessions | Replies, threads, reply permissions, collapsed sessions | Implementing core data and read paths |
| Communication | Repost, Quote Post, share links | Implement Repost and Quote |
| Interactions | Like, Bookmark, Views, Interaction Count | Implementation; Bookmark remains private |
| Feed | Following, For You, multiple timelines | Follow Following; For You post |
| Discovery | Search, Explore, Trends, Hashtag | Only publish index events; full system backend |
| Communities | Communities, Lists | Postfix |
| Real-time | Spaces, live broadcast | Post-processing |
| Private communication | DM, group chat, voice and video calls | Rear-mounted, independent communication system |
| Security | Protected Account, reply control, Mute, Block, Report, sensitive media tags | Implement the visibility and filtering skeleton required for the feed |
| Content context | Community Notes | Post-processing, collaborative review system |
| Creators | Subscriptions, rewards or revenue sharing, creator analysis | Post-processing, involving accounting and risk control |
| Commercialization | Ads, brand tools, business accounts | Post-processing |
| Account rights | Differentiated capabilities such as Premium, certification, editing, etc. | Only reserved for capability check |
| AI | AI assistant, content understanding or recommendation assistance | Posted, not included in the core posting link |

## Why 09 Choose rich media and public interaction

Images, videos, replies, retweets, and quotes all revolve around the same public Post and will change directly:

- Post data model;
- Posting API;
- Feed Hydration；
- Storage and CDN costs;
- Moderation, deletion and visibility;
- Notification and interaction counts.

They are suitable for discussion in one edition. DMs, Spaces, recommendations, and ads have completely different access patterns and reliability goals and should be separated.

User story for ## 09

- Alice uploads 4 images and posts with alt text.
- Alice uploads a video, and the system generates thumbnails and multi-bitrate playback versions.
- Bob replies to Post and posts to a thread continuously.
- Carol Repost, Dave posts a Quote Post with his own comments.
- Eve Like, Bookmark or vote.
- Feed Reader sees text, media, interaction counts and session context as you scroll the homepage.
- CDNs and caches will no longer expose content indefinitely when a Post is deleted, made invisible, or deemed sensitive.

## Success Criteria

1. Media upload failure will not produce a corrupted public post.
2. Slow video processing will not block ordinary text posting.
3. The Feed service does not proxy large file byte streams.
4. Repeating events will not increment the count or send notifications repeatedly.
5. Deletions and permission changes can quickly make Posts and media invisible.

[Return to the ninth edition directory](README.md)
