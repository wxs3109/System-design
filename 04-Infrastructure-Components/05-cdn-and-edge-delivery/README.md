# CDN and Edge Delivery

A CDN caches deliverable content at edge nodes near users so requests do not have to cross regions to reach the origin every time. It primarily reduces user latency, origin bandwidth, and hot-read pressure.

```text
Client -> DNS / Anycast -> Edge PoP -> Origin Shield (optional) -> Origin
                              | hit
                              +----> response
```

This section uses a CDN only as an external component: how requests hit the edge, which configurations alter caching and security semantics, and how failures surface. How objects are organized at the origin belongs in [Large Objects and Object Storage](../../03-data-and-storage/06-large-object-and-object-storage/). Complete video-upload, transcoding, and playback flows belong in [Case Studies](../../06-case-design/).

## The Immediate Problem It Solves

A CDN is appropriate for workloads where:

- byte content such as images, scripts, installers, and video segments is read repeatedly worldwide or across regions;
- network RTT from users to a single origin is high;
- popular objects may overload origin bandwidth or request capacity;
- content can be cached by an explicit key and permits controlled staleness;
- delivery requires capabilities such as range requests, signed URLs, edge TLS, or basic DDoS protection.

It does not automatically optimize responses that are uncacheable, unique to every user, or generated in real time. If content serves only one internal region and reuse is low, CDN configuration and cost may exceed its benefit.

## External Contract of One Request

1. The user reaches an edge PoP through a domain name.
2. The edge looks up an available object by cache key.
3. On a hit, the edge responds directly.
4. On a miss or when the object is unavailable, the edge makes an origin fetch from the origin or origin shield.
5. Response headers and CDN rules determine whether and how long the edge caches the response.
6. Later requests with the same cache key may hit that copy.

“The same request” is determined entirely by cache-key configuration, not by a natural-language judgment. A CDN accepting a purge does not mean that every edge node worldwide deletes the object at the same instant.

## Cache Keys Are Central to Correctness

A cache key may include:

- host and path;
- all query parameters, an allowlist, normalization and sorting, or rules that ignore them;
- selected headers, such as content encoding, language, or device type;
- all cookies, an allowlist, or rules that ignore them.

A key that is too coarse mixes responses that must not be shared and, in the worst case, leaks data across users or tenants. A key that is too fine makes nearly every request a distinct object, driving the hit rate toward zero.

| Scenario | Possible key dimensions | Risk |
|---|---|---|
| Versioned static file | Host + path | If a file is overwritten under the same name, old copies remain |
| Image resizing | Host + path + controlled size parameters | Arbitrary parameter combinations cause cache explosion |
| Multilingual page | Host + path + normalized language | Omitting language returns the wrong version |
| Private file | Object identity + a security boundary corresponding to the authorization result | User-specific content is cached for other users |
| Signed URL | Object identity, with the signature validated at the edge | Including every signature in the key reduces hits; before ignoring it, verify the security-validation order |

Do not add every header, cookie, and query parameter to the key. Include only dimensions that truly alter response content or an authorization boundary, and constrain the accepted values.

## TTL, Cache-Control, and Stale Content

Edge retention may be influenced simultaneously by the origin's Cache-Control header, CDN behavior rules, default TTL, minimum and maximum TTL, and error-caching policy. Determine who has final authority.

Operational meanings of common response directives:

| Directive | Meaning in use |
|---|---|
| max-age | How long a browser or shared cache may use the response; exact interpretation depends on context |
| s-maxage | Specifies retention for a shared cache |
| no-store | The response should not be stored |
| private | A shared cache should not reuse the response for other users |
| stale-while-revalidate | Allows a stale response briefly while refreshing it in the background |
| stale-if-error | Allows stale content for a bounded period when the origin fails |

Products differ in directive support and override rules. A single header is insufficient to infer final behavior. Permission revocation, deletion, and legal obligations require stricter policies and must not rely only on “the TTL will eventually expire.”

## Updates and Invalidation

There are two main ways to update edge content.

### Versioned URLs

When content changes, write a new object at a new path, for example:

```text
/assets/app.8f31c2.js
/video/9001/hls/build-17/segment-0042.ts
```

Old objects can use a long TTL, and the new version cannot be confused with the old cache. This is best for write-once immutable static assets and media outputs.

### Purge / Invalidate

Actively ask the CDN to delete or bypass an old object. This suits content that must retain a fixed URL, emergency withdrawal, and permission changes. Define:

- whether invalidation is by URL, prefix, tag, or the entire site;
- request quotas, cost, and propagation-completion time;
- whether concurrent misses during invalidation can overwhelm the origin;
- how to verify that target regions no longer return the old version;
- whether browsers, proxies, and local application caches retain copies.

Versioned URLs are the default update mechanism. Purging is a control operation that requires observation and origin protection. They can be combined.

## Origin and Origin Protection

Reducing normal traffic does not mean the origin can be provisioned for nearly zero traffic. All of these events can suddenly raise the origin-fetch rate:

- first access to new content;
- many objects expiring together;
- deployment of an incorrect cache key or caching rule;
- a full purge;
- a new PoP or cold region beginning to serve traffic;
- a miss on a popular object;
- CDN bypass, partial failure, or a provider switch.

An origin shield lets multiple edge PoPs fetch through one shared caching layer, reducing duplicate requests for the same object to the origin. It still has finite capacity. The application should also configure origin-fetch timeouts, concurrency limits, request coalescing, bandwidth budgets, and overload degradation.

Where possible, the origin should accept requests only from the trusted CDN, preventing an attacker from bypassing the edge and directly attacking a public address. Depending on product capabilities, this may use a private network connection, origin access identity, mTLS, signed headers, or firewall allowlists.

## Range Requests and Large Objects

Video, audio, and large files generally need not be downloaded in full every time. HTTP Range lets a client request a byte interval. Verify:

- whether the origin correctly supports Range;
- whether the CDN caches the complete object or intervals;
- whether different ranges create excessive fragmentation and low hit rates;
- whether ETag, length, and version remain consistent after an object update;
- how a resumed download identifies the same object version.

Video platforms often go further by producing stable, immutable short segments for the CDN to cache by segment URL, instead of allowing arbitrary ranges to form an unbounded combination. Transcoding and manifest design are not covered here.

## Private Content and Access Control

A CDN can restrict access using signed URLs, signed cookies, short-lived tokens, or edge authorization functions, but the application remains responsible for authorization facts and revocation semantics.

Answer:

- who issues an access capability and whether it binds an object, user, tenant, or path scope;
- the token lifetime, clock skew, and replay window;
- whether the CDN validates authorization before or after the cache lookup;
- whether cached objects may be shared among authorized users;
- how long old tokens and edge copies remain usable after a user's permission is revoked;
- whether the origin rejects access that bypasses the CDN.

“The URL is hard to guess” is not authorization. Object keys and signed URLs must not replace ownership records in the business database.

## Failure and Misconfiguration Behavior

| Situation | What the user or origin observes | Required handling |
|---|---|---|
| Edge PoP fails | Connection failure, increased latency, or routing to another PoP | Healthy routing, timeouts, and provider-status monitoring |
| Origin slows or becomes unavailable | Misses fail; stale content may be returned if allowed | Explicit stale-if-error boundary and degradation for critical content |
| Cache key too fine | Hit rate falls; origin QPS and cost rise | Audit key dimensions and roll back the release |
| Cache key too coarse | Users receive the wrong version or private data leaks | Block immediately, purge, audit, and repair the authorization boundary |
| Purge storm | Origin fetches rise worldwide at once | Staged purging, request coalescing, and origin capacity protection |
| Signature or certificate failure | Widespread 403, TLS errors, or unavailable content | Overlap key rotations and alert before certificate expiration |
| Incorrect caching in one geography | Only some users or PoPs reproduce the issue | Observe by PoP/region and inspect response headers |

A CDN failure may affect only one geography, ISP, object version, or PoP. Global average success rates easily hide the issue.

## Capacity, Metrics, and Cost

At minimum, estimate and observe:

- edge request count, bandwidth, and response-size distribution;
- cache-hit ratio and byte-hit ratio;
- origin-fetch request count, byte count, and origin P95/P99 latency;
- 2xx, 3xx, 4xx, and 5xx responses, distinguishing edge-generated from origin-generated responses;
- time to first byte, download throughput, and user-geography distribution;
- purge count, propagation time, and failures;
- top-K popular objects and hit-rate differences among PoPs;
- traffic and request charges from edge to user and edge to origin;
- additional costs for logs, edge computing, WAF, and cross-region origins.

A high request hit rate but low byte-hit ratio may mean small files hit while large videos continually cause origin fetches. Conversely, hits on a few large objects may save substantial bandwidth. Examine both metrics.

## Common Product Forms

CloudFront, Cloudflare, Fastly, Azure Front Door/CDN, and Google Cloud CDN all provide edge delivery, but differ in routing entry points, purging, logging, edge computing, private origin access, WAF, price, and geographic coverage.

When selecting a product, focus on:

- required user geographies and actual network performance;
- capabilities for cache keys, headers, cookies, query parameters, and tag-based purging;
- private origins, signed access, and key rotation;
- limits on object size, ranges, request headers, and response headers;
- log latency, metric granularity, and per-PoP troubleshooting;
- traffic commitments, origin-fetch charges, purge charges, and edge-compute charges;
- configuration deployment, rollback, and multi-account isolation.

Do not select a provider solely by its claimed number of PoPs. Test with your own object sizes, geographies, hit rates, and origin paths.

## Is Multi-CDN Necessary?

Multiple CDNs can improve provider-level fault isolation, coverage in particular geographies, and pricing leverage, but add:

- DNS or global-traffic failover complexity;
- two sets of cache-key, purge, signing, and logging semantics;
- the cost of keeping both caches warm;
- cold-cache pressure on the origin after failover;
- configuration drift and harder troubleshooting.

Introduce multi-CDN only when the failure risk or geographic differences of one CDN exceed these costs. The corresponding topic in this chapter owns the DNS and global-entry contract.

## Remaining Application Responsibilities

- Decide which responses may be shared and which must be private or no-store.
- Design a stable and secure cache key.
- Define TTL, versioned URLs, purging, and the deletion-completion point.
- Protect the origin and retain capacity for cold caches and full invalidation.
- Maintain object ownership, authorization facts, and short-lived access credentials.
- Validate combined behavior across browser, CDN, origin, and other cache layers.
- Observe by geography, PoP, object, and version instead of only global averages.

## Interview Checklist

- [ ] Explained what the CDN caches and what the origin is.
- [ ] Included correctness dimensions in the cache key without unbounded growth.
- [ ] Defined TTL, versioned URLs, purging, and the staleness window.
- [ ] Authorized private content at a safe point and prevented arbitrary origin bypass.
- [ ] Explained segmentation or range behavior for video or large files.
- [ ] Estimated hit rate, byte-hit ratio, origin-fetch bandwidth, and cost.
- [ ] Considered cold caches, purge storms, origin failure, and geographic errors.
- [ ] Introduced multi-CDN only for an explicit provider-level requirement.

## Not Covered in Depth Here

- internal CDN routing, cache eviction, and consistency protocols;
- object-store data models and lifecycle;
- complete architectures for video upload, transcoding, recommendation, and playback;
- detailed contracts for DNS, load balancers, and API gateways;
- designing a CDN itself as a globally distributed system.
