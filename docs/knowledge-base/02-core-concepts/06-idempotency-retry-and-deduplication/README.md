# Idempotency, Retry and Deduplication

The most difficult thing to deal with in distributed calls is not the clear failure, but the "unknown result": the client times out, but the server may have completed the deduction; the consumer crashes, but the message may have been written to the database. A reliable system should allow requests or messages to arrive repeatedly while ensuring that business results are not executed repeatedly.

## Learning sequence

1. [Timeout and Safe Retry](01-timeout-and-safe-retry.md)
2. [Idempotent API and external side effects](02-idempotent-api-and-external-side-effect.md)
3. [Message idempotence, deduplication and out-of-order](./03-message-idempotency-deduplication-and-out-of-order.md)
4. [DLQ, Replay, Reconciliation and Verification](04-dlq-replay-reconciliation-and-verification.md)

## Remember four points first

- Timeout only means that the response was not received in time and does not prove that the operation failed.
- Prove the operation is idempotent before retrying, and confirm that the end-to-end deadline still has budget.
- The transport layer allows at least one delivery, and the business layer uses unique constraints, state machines or Inbox to ensure one-time effect.
- Known failures rely on Retry and Replay, and silent omissions rely on Source of Truth for Reconciliation.

## Through the case

- Payment request timeout: The server may have deducted the payment, and the client must reuse the original idempotent key query or try again.
- News Feed consumer crash: The database has been written but the message has not been confirmed. The Broker will deliver it repeatedly, and the business unique key eliminates the duplication effect.
- Silent omission of derived indexes: There are no failed messages in the queue to retry, and reconciliation needs to be done from fact sources such as Post and Follow.

[Return to core concept entrance](../)
