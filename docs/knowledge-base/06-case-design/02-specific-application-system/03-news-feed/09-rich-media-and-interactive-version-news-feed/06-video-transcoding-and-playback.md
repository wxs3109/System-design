#Video transcoding and playback

## What does a video have more than a picture?

The video does not end when a compressed file is generated. Requires detection, transcoding, slicing, cover, audio, subtitles, playlist and adaptive bit rate.

## Processing state machine

```text
UPLOADED
  → SCANNING
  → PROBING
  → TRANSCODING
  → PACKAGING
  → MODERATING
  → READY
```

Either step can enter RETRYING or FAILED. State transitions use version numbers or compare-and-set to prevent late workers from overwriting the new state back to the old state.

## Transcoding steps

1. Probe Worker reads the container, codec, duration, resolution and frame rate.
2. Transcode Coordinator selects the rendition ladder based on the source video.
3. Independent tasks generate different resolutions and code rates.
4. Packager cuts the output into HLS/DASH segments and generates a manifest.
5. Thumbnail Worker generates cover and preview frames.
6. Moderation Worker extracts frames and analyzes audio, text, and visual content.
7. Once all necessary products are complete, mark Media READY.

## Why use adaptive code rate

The client first requests the manifest and then selects the appropriate rendition based on the bandwidth. When the network changes, press segment to switch bitrate without restarting the entire video.

The example ladder should be determined based on the input and does not necessarily produce 1080p for a 360p source:

| Rendition | Typical uses |
|---|---|
| 240p / 360p | Weak network, fast start of first frame |
| 480p / 720p | Feed regular playback |
| 1080p | High quality detailed playback |

## Queue isolation

Don’t let one long video block all short videos:

- Divide into queues based on expected calculation volume or duration;
- Free and high-priority tasks can have different quotas, but share fair scheduling;
- Each rendition is retried independently;
- Coordinator summarizes the status of all subtasks.

## Play link

```text
Client → Playback API → signed manifest URL
Client → CDN → manifest + segments
CDN miss → Media Origin → Object Storage
```

The Playback API verifies Post visibility, region/age restrictions, and user permissions. Public videos can use long TTL; restricted videos use short-term tokens or Edge Authorization.

## Failure and downgrade

- High bitrate transcoding fails: Release the low bitrate version first, and then make up for it in the background.
- Cover failure: use safe default cover or reframe.
- CDN failure: Multiple CDNs or downgrade to an alternate domain, but keep Origin pressure under control.
- The video is still PROCESSING: Post display processing placeholder, does not return 404 repeatedly.
- Original file is damaged: Media flag FAILED, client can re-upload.

## Cost Control

- Determine whether to generate a high bitrate version based on the actual playback distribution.
- Unpopular videos will be transferred to cold storage and will be moved back when hot spots become hot again.
- Generate expensive renditions for long videos that are rarely played.
- Monitor transcoding CPU/GPU cost per minute of source video and egress cost per active playback.

[Return to the ninth edition directory](README.md)
