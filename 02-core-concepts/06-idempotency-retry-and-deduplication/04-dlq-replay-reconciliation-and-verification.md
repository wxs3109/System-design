# DLQ, Replay, Reconciliation and Verification

## 1. What goes into DLQ

Messages that exceed the automatic retry budget, have illegal message formats, permanently missing references, or violate business invariants should enter the DLQ. DLQ retains at least:

- Original `event_id`, business ID, idempotent key;
- Producer and Schema version;
- First/latest failure time, number of attempts;
- Error code, target fragment and Trace ID.

DLQ is not a permanent trash can. Alert, Owner, Repair Workflow and Retention Policy are required. Reuse the original Business Identity, Rate Limit and observe Downstream Capacity during Replay; generating a new Event ID will bypass Deduplication protection.

## 2. Why do you need Reconciliation when you have Retry?

Monitoring only sees known failures. If the Producer performs a Silent Drop task before Publish, or the error code is an ACK message, there will be no Retryable objects in the Queue. **Reconciliation** should derive the expected result from the Source of Truth and compare it to the Derived Data:

| Source of fact | Derived result | Reconciliation action |
|---|---|---|
| Post + Outbox | Author Timeline | Fill in missing Timeline item |
| WRITE Post + Valid Follow | FeedItem | Supplement or amend FeedItem |
| Payment Ledger | Order payment status | Modify order or transfer to manual review |

The Reconciliation Job itself must also be Idempotent, Rate-limited, pauseable, and support Read-only Audit before enabling Auto Repair.

## 3. End-to-end case: News Feed posting

After Alice posts, the Post Service saves the Post and `PostCreated` Outbox in the same local transaction. Relay may crash when "the message was sent successfully but the Outbox has not been marked yet", so the same event is repeated.

Timeline Worker uses `UNIQUE(author_id, post_id)`; Fan-out Worker uses `UNIQUE(user_id, post_id)`. The message is acknowledged only after the storage transaction is committed. Temporary database failures use backoff with jitter, and permanent format errors enter the DLQ. After the fault is repaired, replay according to the original `event_id/job_id/batch_id` speed limit, and finally reconcile the Post and Follow fact tables.

For complete implementation, see [News Feed: Write Reliability](../../06-case-design/02-specific-application-system/03-news-feed/08-resumable-production-version-news-feed/09-write-reliability.md). How to avoid retry amplification at the entry layer, see [API Gateway: Timeout Retry and Failure Degradation] (../../06-Case Design/01-General Basic System/02-api-gateway/04-Timeout Retry and Failure Degradation.md).

## 4. What to monitor

- Retry rate grouped by dependency, error code and number of attempts;
- Retry success rate and additional load added by retry;
- Idempotent key hits, conflicts and `IN_PROGRESS` age;
- Queue lag, oldest message age, repeat delivery rate;
- Number of DLQs, oldest DLQ age and replay rate;
- Reconcile discrepancy numbers, not just process error rates.

## 5. Which faults to inject?

1. The server disconnects after submission and before response;
2. The consumer crashes after submitting the database but before ACK;
3. The same idempotent key arrives concurrently;
4. The same key carries different request bodies;
5. Old events arrive later than new events;
6. Replay deduplication records when they are about to expire;
7. A large number of clients retry at the same time when the downstream is overloaded.

What is verified is not that "the system does not report an error", but that the business only produces an effect once, the backlog finally decreases, the DLQ can be located, the reconciliation difference is reset to zero, or it enters the clear manual queue.

## 6. Recovery Checklist

- Does the DLQ have alerts, owners, retention periods and runbooks?
- After fixing the root cause, is it replayed using the original event and business ID?
- Does replay share the capacity budget with online traffic and can be paused?
- How to determine the impact time windows, shards, tenants and business objects?
- Which source of fact leads to the correct derived result?
- Should the reconciliation be read-only and audited first, and then fixed at a limited speed?
- How to prove that there are no duplicate effects or silent omissions after the fix?

[Return to detailed directory](README.md)
