# Demand, Capacity and SLO

## Functional requirements

### Rich Media

- A Post can contain multiple images, a GIF, or a video.
- Supports image alt text, video cover and subtitle metadata.
- The client supports multipart upload, resume upload, cancellation and retry.
- Videos play adaptively based on network conditions.

### Interaction

- Replies, Continuous Threads, Repost, Quote Post, Like, Bookmark and Poll Vote.
- Display near-real-time reply, repost, quote, like, and view counts.
- Bookmark can only be read by the user himself.

## Non-functional goals

| Capabilities | Initial Goals |
|---|---|
| Create Upload Session | P95 < 200 ms |
| Image processing completed | 99% < 10 seconds |
| The first playable version of short video | 95% < 30 seconds, 99% < 2 minutes |
| CDN Image Availability | 99.99% |
| First frame of video | P95 < 2 seconds when CDN hits |
| Post | P95 < 300 ms, excluding file upload time |
| Interaction count Freshness (data visibility delay) | 99% < 10 seconds |
| Invisible after deletion | API/Feed 99% < 5 seconds; CDN expires by policy |

## Interview estimation skeleton

Follow the assumption of `10^8` Posts per day in the eighth edition. During the interview, state the following estimates first, and then calculate:

| Parameters | Estimated values ​​for easy calculation |
|---|---:|
| Posts with pictures | 20% |
| Pictures per post | 2 pictures |
| Original image per image | 1.5 MB |
| Post with video | 2% |
| Total original and transcoded products per video | 30 MB |

Daily picture raw data:

$$
10^8 	imes 20% 	imes 2 	imes 1.5	ext{ MB} = 60	ext{ TB/day}
$$

Daily video data:

$$
10^8 	imes 2% 	imes 30	ext{ MB} = 60	ext{ TB/day}
$$

This is before adding image variations, cross-region replicas, and CDN caching. The bottom line is more important than precise numbers: media costs are dominated by object storage, transcoding, and egress bandwidth, and you can't put binaries into the Post database.

## Numbers that need to be filled in during detailed design

- Image size, compression rate and number of variations;
- Video duration distribution, bit rate ladder and completion play rate;
- Daily media play times and CDN hit rate;
- Hot/cold storage retention period;
- Upload failure rate, transcoding failure rate and orphan object ratio.

[Return to the ninth edition directory](README.md)
