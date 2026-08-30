# Reliability, cost and subsequent evolution

## Critical failure scenarios

| Failure | User Impact | Processing |
|---|---|---|
| Upload Session created successfully but not uploaded | No public content | TTL + orphan cleanup |
| File upload completed but event lost | Always PROCESSING | Storage Inventory / Metadata Reconciliation (difference check and repair) reissue |
| A certain variation of the image failed | Some clients do not have the appropriate size | Try again independently, publishing the existing safe variant first |
| The video part rendition failed | The highest image quality is missing | Release the low bit rate first and make up for it in the background |
| Worker repeated execution | Repeated objects or state rollback | generation + variant idempotent keys, CAS state machine |
| CDN available but Metadata Store down | New authorization failed | Public media continues CDN hit; protected media fail closed |
| Counter Queue backlog | Count stale | Fact interaction still correct, impression count downgraded |
| Notification Worker re-submission | Duplicate notification | event_id deduplication and aggregation window |
| Delete event delay | Derived index still has candidates | Post/Policy read-time filtering, CDN permissions or purge |

## Reconciliation Task

- READY Media must have the required variants and objects.
- Overaged, unreferenced objects in Object Storage should be recycled.
- PROCESSING Media that exceeds the threshold fails to be requeued or marked.
- Recalculate when the difference between Interaction fact and Counter exceeds the threshold.
- Reply Post and Conversation Index missing items are checked against each other.
- DELETED/BLOCKED Media cannot continue to obtain new broadcast authorizations.

## Cost bulk

| Cost | Main means of control |
|---|---|
| Object storage | Life cycle, cold storage, orphan deletion, multi-copy strategy |
| Video transcoding | On-demand ladder, task priority, hardware encoder, avoid invalid upscale |
| CDN export | High hit rate, suitable compression, segment size, multi-CDN negotiation |
| Feed Hydration | Batch RPC, local/request cache, avoid copying highly variable fields |
| Review | Hierarchical model, frame extraction, risk priority, manual review queue |

## Indicators that need to be monitored

- Upload success rate, part retry rate, session abandon rate;
- PROCESSING each status age and queue lag;
- Success rate of each variant of pictures/videos;
- time-to-first-playable, play the first frame, rebuffer ratio;
- CDN hit ratio, origin egress, purge delay;
- Feed hydration P95/P99 and downstream batch size;
- Counter/Notification lag and de-rehit;
- Remove invisible end-to-end delays to API, feed, and CDN;
- Daily orphan object bytes and recycling volume.

## Suggestions for subsequent versions

| Release Candidates | Core Issues |
|---|---|
| 10 Recommendation and Discovery Edition | For You candidate generation, ranking, feature store, feedback loop |
| 11 Search and Trend Edition | Inverted index, real-time index, trending window, anti-manipulation |
| 12 private message version | inbox, end-to-end delivery, group chat, device synchronization, encryption |
| 13 Spaces / Live version | Real-time audio and video, SFU, low latency, recording and review |
| 14 Community and Lists version | membership, role, moderation, exclusive feed |
| 15 Community Notes Edition | Collaborative Contributions, Ratings, Bridging Consensus, Presentation Eligibility |
| 16 Commercial version | Ads, subscription, payment, accounting, anti-fraud |

If you want to continue the main line of News Feed in the next step, give priority to 10 recommendations and discovery; if you want to continue the main line of media, design a separate live broadcast system.

[Return to the ninth edition directory](README.md)
