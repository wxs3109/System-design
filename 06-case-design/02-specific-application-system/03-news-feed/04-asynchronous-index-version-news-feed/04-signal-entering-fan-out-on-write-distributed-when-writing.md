# Signal entering Fan-out on Write (distributed when writing)

Enter 05 only after the following conditions are met:

- Outbox oldest age and consumer lag are within budget in the long term;
- The Shadow Validation discrepancy rate of Timeline, Following, and Followers is lower than the target;
- Any derived partition can be cleared and rebuilt from fact data;
- DLQ has clear processing and Rate-limited Replay procedures;
- Read Replica JOIN is still the main performance bottleneck.

05 will create the FeedItem for the first time and switch `GET /feed`. Traffic Cutover in advance when the event pipeline is not yet stable will directly expose the background Missing Writes to user missed posts.

[Enter 05 Fan-out on Write version](../05-fan-out-on-write-news-feed/README.md)

[Return to the fourth edition directory](README.md)
