# Timeout and Safe Retry

## 1. Timeout does not equal failure

A remote call has at least these stages:

1. The client makes a request;
2. The server receives and executes;
3. The server submits the results;
4. The response is returned to the client.

If the request or response is lost at any stage, the client may only see `timeout`. Therefore, timeout can only mean "no response was received within the deadline", but cannot prove that the operation did not occur.

### Example: The payment result is unknown

Suppose Alice wants to pay 100 yuan for the order `order-123`:

1. The client requests payment for the first time and carries the idempotent key `pay-order-123`.
2. The payment service deducts 100 yuan, saves the payment result `payment-789: SUCCESS` together with the idempotent key, and then returns a successful response.
3. The successful response is lost in the network and Alice's client only sees `timeout`. At this time, the client does not know whether the deduction has occurred.
4. If the client mistakenly believes that the payment failed and uses the new idempotent key `pay-order-123-retry-1` to request again, the server will treat it as a new payment, and Alice may be deducted 100 yuan again.
5. The correct approach is to try again using the original idempotent key `pay-order-123`. The server finds that the key has been successfully processed and returns directly to the original `payment-789: SUCCESS` without any further deductions.

Therefore, after the client sees the timeout, it should regard the payment status as "unknown" instead of "failed"; when retrying, it must reuse the idempotent key of the first request, or query the status of the original payment.

## 2. When can you try again?

Retries are suitable for transient failures and must meet two conditions: the operation can be safely repeated and the total deadline is still budgeted.

| Results | Common Strategies | Reasons |
|---|---|---|
| The connection establishment failed and the confirmation request was not sent | Limited retry is possible | The server most likely did not execute |
| `408`, partial `429` | Retry by `Retry-After` and budget | Possible temporary timeout or throttling |
| `500`, `502`, `503`, `504` | Only limited retries for idempotent operations | Whether the server executes may be unknown |
| Network timeout, connection reset | The result is unknown; only idempotent cases can be retried | The request may have already been submitted |
| `400`, `401`, `403`, `404` | Usually do not automatically retry | Requests or permissions will not succeed without changing |
| Optimistic lock conflict `409` | Reread and decide according to business rules | Unable to retry infinitely |
| Schema/Deserialization Errors | Entering DLQ or Quarantine | Permanent error retries will not self-heal |
| Disk full, quota exhausted | Stop bleeding and repair capacity first | Tight retries amplify failures |

Do not wrap all exceptions as `500`; callers need to distinguish between transient failures that can be retried and permanent failures that require correction of the request.

## 3. First set the end-to-end deadline

Timeout is the upper limit of a single attempt, and Deadline is the remaining time for the entire user operation. The downstream must inherit and shorten the remaining budget of the upstream. For example, the total client budget is 3 seconds:

| Hierarchy | Upper limit example |
|---|---:|
| Client | 3,000 ms |
| Gateway | 2,500 ms |
| Service | 2,000 ms |
| Database | 1,500 ms |

The remaining budget should be checked before the second attempt; if only 80 ms are left and a normal call would take 200 ms, fail immediately. After the upstream cancels, the downstream should also try to cancel the work to avoid "ghost requests".

The timeout value should refer to the delay distribution, service deadline and network jitter of each dependency. Too long will fill up threads, connections, and memory; too short will turn healthy but slightly slower requests into retry storms.

## 4. Exponential Backoff with Jitter

The upper limit of Exponential Backoff can be written as:

$$
B_n=\min(B_{max}, B_0 \times 2^n)
$$

When using Full Jitter, wait $n$th time:

$$
W_n \sim U(0,B_n)
$$

Without jitter (random jitter), a large number of clients would request again at the same time, creating periodic traffic spikes. The server should respect it first when returning `Retry-After`, and superimpose a small amount of randomization.

## 5. Limit attempts and Retry Budget

Each layer of Client, Gateway, and Service is tried three times, and the worst-case scenario is:

$$
3 \times 3 \times 3=27
$$

The most downstream call. You should specify a primary retry tier and set a Retry Budget for the service, such as "Retry traffic no more than 5% of normal calls." When error rates continue to rise or downstream is overloaded, it is more important to stop retrying than to continue applying pressure.

## 6. Hedged Request is only suitable for a small number of read requests

For cancelable, side-effect-free reads, if P95 has not been returned yet, a backup request can be issued to another replica, and the other replica can be canceled after the first successful result is returned. It reduces tail latency but increases downstream traffic, cannot be used for non-idempotent writes, and cannot be used without budget when the overall load is overloaded.

## 7. Checklist

- Is the operation safe to repeat? If the result is unknown, can I check the original status?
- Which errors are transient and which are permanent?
- What are the total deadline, single timeout and maximum number of attempts?
- Who is the only primary retry layer? What is the retry traffic budget?
- Use backoff, dither and respect `Retry-After`?
- Stop retrying and fail fast when downstream is overloaded?

[Return to detailed directory](README.md)
