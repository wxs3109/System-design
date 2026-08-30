# Image processing and delivery

## Image processing pipeline

1. Verify magic bytes, file size, total pixel count, and decoding budget.
2. Scan for malicious files and remove unnecessary EXIF ​​and privacy metadata.
3. Automatically rotate and generate a standard color space version.
4. Generate thumbnail, small, medium, large and other sizes.
5. Generate JPEG/WebP/AVIF and other formats according to client capabilities.
6. Save width, height, bytes, format, and object_key for each variant.
7. Publish MediaReady, updating the MediaAsset state.

## Why pregenerate limited variants

If each request is of arbitrary width and height, an attacker can create unlimited transformation combinations and the cache hit rate will be poor. The system only allows predefined size and cropping strategies:

| Variations | Usage |
|---|---|
| thumb | Notifications, quote cards, small previews |
| small | low bandwidth or small screen |
| medium | Feed general display |
| large | Details page and enlarged view |

## Object Key

Do not use user-original filenames. Example:

```text
media/{media_id}/v{generation}/{variant}.{format}
```

`generation` is incremented on each reprocessing. Long immutable CDN TTLs can be used after URL changes without having to overwrite the old object.

## CDN cache

- Cache key contains media_id, generation, variant and format.
- When Edge selects a format based on the Accept header, it needs to normalize the headers that participate in the cache key.
- Traffic for popular images is borne by CDN; Origin only accesses object storage on misses.
- With Origin Access Control, clients cannot bypass CDN enumeration of buckets.

## Deletion and permission changes

Simply removing the database reference is not enough, the CDN may continue to cache the image.

Processing order:

1. Post/Media metadata first enters the invisible or DELETED state.
2. Feed and details API no longer returns media URLs.
3. Send a CDN purge for high-risk deletions.
4. The object storage is deleted asynchronously or enters the retention period.
5. The old signed URL expires and Edge Authorization rejects protected content.

Public, long TTL, irrevocable URLs are the cheapest, but have the weakest permission revocation; sensitive or protected media requires an authorization layer and cannot just rely on random URLs.

## Image Security

- Limit decompressed pixels to prevent decompression bomb.
- Decode untrusted formats in isolated workers.
- Record checksums for the original file and the derived graph separately.
- Content security model and manual review results are written into moderation_state.
- Users actively flag sensitive media and the feed is blurred or hidden based on viewer settings.

[Return to the ninth edition directory](README.md)
