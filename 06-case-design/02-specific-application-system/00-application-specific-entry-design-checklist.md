# Application-specific entry design checklist

The specific application does not need to redesign the API Gateway, but it must explain which traffic passes through it, which special policies are used, and which large traffic uses the Direct Data Path (data direct transmission path).

For general principles, see [API Gateway Case](../01-common-basic-system/02-api-gateway/README.md).

## Entry selection for each case

| Application | Through ordinary API Gateway | Direct Data Path or dedicated entrance | Special attention |
|---|---|---|---|
| URL Shortener | Create, manage and count APIs | Popular jumps can go to the edge or dedicated Redirect Service | The traffic limiting strategies for jumps and management APIs are different |
| Pastebin | Creation, permissions and metadata API | Direct transfer/read of large text using Object Storage | Abuse protection for anonymous creation |
| News Feed | Post, follow, unfollow and read Feed | Direct transfer of pictures/videos to Object Storage, read through CDN | Write API and transfer Idempotency Key |
| Chat | Login, session and historical message API | WebSocket using Connection Gateway | Long connection authentication, renewal and Connection Draining |
| Video Streaming | Video metadata, upload session and permission API | Video direct transfer to Object Storage, playback through CDN | Gateway does not proxy video bytes |
| Maps & Navigation | Search, route planning and user data API | Map tiles go through CDN, location flow is dedicated to Ingestion | The cost of different APIs varies greatly, and the flow is limited by Route |
| File Sync | File metadata, directory and sharing API | File block direct transfer/direct read Object Storage | Signed URL must limit Object Key and validity period |
| Ticket Booking | Search, seat lock, order and cancellation API | Popular sales can go through the Waiting Room first | Seat lock write requests cannot be retried at will by the Gateway |
| Payment Processing | Payment Intent, confirmation, refund and callback portals | Internal clearing files use independent secure channels | mTLS/signing, auditing, idempotent, strict fail-closed |
| Ride Dispatch | Ride-hailing, order-taking, itinerary and account API | Dedicated for high-frequency location reporting and departure Location Ingestion | Location update and order writing use different entry strategies |
| Search / Autocomplete | Query, Filter, management and indexing task API | Large-scale documents through Event / Batch Ingestion; Query can go through dedicated Search Gateway | Query cost difference is large; permission filtering and Partial Result must be explicit |
| Collaborative Editor | Documents, ACLs, sharing and historical version API | Realtime Operation using Connection Gateway | Long connection renewal, Operation Idempotency and revocation propagation |
| Ads / Clickstream Analytics | Schema, Reporting and Management API | Event uses private Ingestion Endpoint / SDK | Quotas by Producer and Tenant; Event Forgery, Consent and PII |
| E-commerce Order | Catalog, Cart, Checkout, Order and Return API | Flash Sale can go through Waiting Room; Payment Callback uses a separate entrance | Checkout Idempotency, Bot, inventory Hotspot and sensitive write Fail-closed |
| Recommendation System | Common APIs for obtaining recommendations, feedback preferences, and managing experiment configurations | Dedicated Ingestion Endpoint/SDK for behavioral events such as Exposure, Click, and Conversion | End-to-end Deadline, timeout Fallback, Consent/Privacy, stable experiment bucketing, and event deduplication |

## Seven questions to answer for each specific case

1. Who is the external caller: an anonymous user, a logged-in user, a partner, or a device?
2. Which APIs require authentication, and authorization is completed by Gateway or business services?
3. Is Rate Limiting performed by IP, User, Tenant, Route or globally?
4. Which requests are safe to retry, and which ones must rely on the Idempotency Key?
5. Which large files, static content, long connections or high-frequency data should take dedicated paths?
6. How to downgrade when Gateway, authentication, Rate Limiting or target service failure?
7. What audit fields need to be recorded, and what sensitive data must not be entered into the log?

It is not necessary to expand the internal components of the Gateway in the application architecture diagram, just indicate the entrance, key policies and Direct Data Path.
