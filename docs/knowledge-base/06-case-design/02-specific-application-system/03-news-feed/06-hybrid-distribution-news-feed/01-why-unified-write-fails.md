#Why unified WRITE fails

## Fifth Edition of Write Amplification

The average author has 500 followers, and one Post generates about 500 FeedItems. Celebrity Account has 100 million fans, and one post may generate 100 million logical writes.

This leaves a small number of authors in charge:

- Queue backlog；
- FeedItem writing cost;
- Distribution Freshness (data visibility delay) P99;
- Invalid copy count for inactive fans.

## Trigger criteria

Don’t just judge by the number of fans, but estimate the distribution cost of a Post:

```text
expected writes = active followers × posts per window
```

The author enters READ mode when writes are expected to exceed the single-Post budget, or significantly push up the global Queue age.

Use different thresholds for entry and exit to avoid frequent switching at critical points.

## New trade-offs

| Mode | After posting | Home page read |
|---|---|---|
| WRITE | Write FeedItem for fans | Read FeedItem directly |
| READ | No large-scale fan-out | Pull from Author Timeline and merge |

READ saves writing, but increases fan-in when reading, so it is only used by authors whose distribution costs are particularly high.

[Return to the sixth edition directory](README.md)
