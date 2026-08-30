# Idempotent API and External Side Effect

## 1. What is idempotence?

An operation performed once and performed multiple times has the same final business effect on the system, which is called idempotent. It does not require that every response be exactly the same, nor does it mean that the request is costless.

| Operation | Is it usually idempotent | Reason |
|---|---|---|
| `GET /users/42` | Yes | Do not modify business status |
| `DELETE /users/42` | Yes | In the end, the target does not exist; subsequent responses may become 404 |
| `PUT /profiles/42` sets the complete state | usually | repeatedly sets to the same target state |
| `POST /payments` Deduction | Default No | Each call may generate new deductions |
| `POST /payments` + server-side idempotent key | Can be done | Multiple requests are mapped to the same business operation |
| `balance = balance + 100` | No | Repeated execution will accumulate |

The HTTP method is just a protocol layer prompt and is not enough to prove the security of the business implementation. A `GET` if written as a side effect, a `PUT` if appending new records each time may still produce duplicate results.

There are also three levels to distinguish:

- **Request Idempotence**: The same logical request only creates one business result.
- **Data writing is idempotent**: Repeated writing will not produce a second record.
- **Side effects are idempotent**: External actions such as emails, text messages, and refunds are not repeated.

## 2. The client generates stable idempotent keys

The client generates an unpredictable and unique key for a logical operation and reuses it when the result is unknown:

```http
POST /payments HTTP/1.1
Idempotency-Key: 01J5M7...
Content-Type: application/json

{"order_id": "order-123", "amount": 5000, "currency": "CAD"}
```

When the user clicks again, the client restarts, or the network retries, the original key must be used as long as it is still the same logical payment. Really new payments use new keys. Keys should have explicit scope:

> `(tenant_id, operation_type, idempotency_key)`

## 3. Bind request fingerprint

The server saves a hash of the normalized request, such as order, amount, currency, and payee. Same key but different fingerprints should return a conflict:

> `409 Idempotency-Key reused with different request`

Otherwise a client bug could submit an 80 CAD request with a 50 CAD paid key, only for the system to return the old success result. Do not put fields that change each time such as timestamps and Trace IDs into business fingerprints; you must also specify the normalization method for JSON field order, default values, and amount units.

## 4. Place atoms before side effects

Typical idempotent records include:

| Field | Purpose |
|---|---|
| `scope` + `idempotency_key` | Unique constraint |
| `request_hash` | Detecting different requests for the same key |
| `status` | `IN_PROGRESS`、`SUCCEEDED`、`FAILED_FINAL` |
| `resource_id` | Associated payment, order and other business objects |
| `response_code/body` | Replay completed results |
| `created_at/expires_at` | Lifecycle and Cleanup |

In the same database, idempotent records and business writes should be placed in one transaction:

```sql
BEGIN;

INSERT INTO idempotency_request(scope, idem_key, request_hash, status)
VALUES (:scope, :key, :hash, 'IN_PROGRESS')
ON CONFLICT (scope, idem_key) DO NOTHING;

--Only the executor who successfully inserted the placeholder creates a business record.
INSERT INTO payment(payment_id, order_id, amount, status)
VALUES (:payment_id, :order_id, :amount, 'AUTHORIZED');

UPDATE idempotency_request
SET status = 'SUCCEEDED', resource_id = :payment_id, response_code = 201
WHERE scope = :scope AND idem_key = :key;

COMMIT;
```

Concurrent requests that do not obtain a placeholder should read existing records:

- `SUCCEEDED`: Returns the saved result;
- `IN_PROGRESS`: Wait briefly, return `202`, or prompt to query later;
- Same key but different `request_hash`: return `409`;
- Clearly non-retryable business failures: return to the saved final state.

There will be a race condition if only "check first to see if there is any, then insert"; two requests may not be found and executed at the same time. The unique executor must be determined using unique constraints, conditional writing, or compare-and-set.

## 5. External side effects cannot be wrapped by local transactions

The local database cannot override the external payment gateway with normal transaction atomicity. Common practices:

1. Local transactions save business status and Outbox commands;
2. Relay sends the command at least once;
3. When calling the external gateway, use the stable business ID as the other party's idempotent key;
4. The callback is deduplicated according to the external event ID and updated with state machine conditions;
5. Regularly query or reconcile unknown status.

If the other party does not support idempotent keys, automatic retry has a real risk of repeated side effects. At this time, you should query the status, switch to manual processing, or introduce an adaptation layer that provides idempotent semantics instead of blindly retrying.

## 6. Checklist

- Who generates stable business identities, and under what circumstances are they reused or renewed?
- How to detect different requests for the same key?
- Does the unique constraint really cover concurrency races?
- Are business records and idempotent records submitted atomically?
- Who will take over or inquire after `IN_PROGRESS` is stuck?
- Does the external system accept the same idempotent key, and is the callback deduplicated?
- After the deduplication record expires, are business invariants still protected by a permanent unique key?

[Return to detailed directory](README.md)
