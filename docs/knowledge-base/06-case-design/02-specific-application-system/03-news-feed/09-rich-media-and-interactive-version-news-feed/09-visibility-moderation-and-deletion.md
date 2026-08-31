# Visibility, moderation and deletion

## Visibility is not a boolean value

Whether it can be finally displayed requires a combination of judgment:

- Post visibility；
- Whether the author's account is protected;
- Follow relationship;
- Block and Mute;
- Reply policy；
- Post and Media moderation_state;
- Age, regional and legal restrictions;
- Whether Post/Media has been deleted.

Feed, details, notifications, search, and media playback must use the same set of Policy Service semantics and cannot implement one each.

## Synchronous and asynchronous auditing

### Synchronous access control

- File type, size, malicious content and known hashes;
- Explicitly prohibited texts or account statuses;
- User quotas and abuse rate limits.

### Asynchronous review

- Visual classification of images;
- Video frame extraction, audio transcription and text analysis;
- User reports;
- Manual review and appeal.

The audit result may be allowed, sensitive, limited, or blocked. Sensitive content can be retained but is blurred by default; Blocked content is no longer distributed and played.

## Deletion is a workflow

The fact transaction to delete Post is completed first:

1. Write `deleted_at` and Delete Outbox.
2. The read path is immediately filtered by the Post fact.
3. Clean FeedItem, Conversation Index, Search Index and cache asynchronously.
4. Media enters the deleted state when it has no other valid references.
5. CDN purge or authorization denial invalidates edge cache.
6. Delay physical removal of objects based on retention, appeals, and legal policies.

## Repost and Quote propagation revocation

- After the original Post is deleted, all Reposts will no longer be able to display the original content.
- Quote cards are not available, but the Quote author's own text is retained per product rules.
- Notifications and search results need to receive deletion events synchronously.

## Protected account

Only show posts to approved followers. Media URLs cannot be made permanently public:

- Feed/Detail does relationship authorization first;
- Playback/Image requests use short-term signature or Edge Authorization;
- After unfollowing, removing a follower or converting an account to protected, new authorization will be immediately rejected;
- Old signatures expire within a short period of time.

## Reporting and Auditing

The Report Store saves the reporter, target, reason, time, evidence citations, and disposition status. Audit operations go into an immutable audit log, recording who changed visibility when and according to what policy.

[Return to the ninth edition directory](README.md)
