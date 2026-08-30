# Optional: algorithm and atomic implementation

This article is only read when you need to confirm algorithm semantics or achieve atomicity. It is not a prerequisite for completing the main line.

## 1. Fixed Window and Token Bucket

| Algorithm | Fit | Main Boundaries |
|---|---|---|
| Fixed Window | Coarse-grained Quota such as hours/days | The window boundary can be close to $2L$ in a short time |
| Token Bucket | Rate + Burst for Online API | Requires correct handling of complementation, time and numerical precision |

Sliding Window is smoother but has higher state or computational cost; Leaky Bucket is more like bounded queuing and traffic shaping. The core design does not need to implement all algorithms.

## 2. Token Bucket formula

The bucket capacity is $B$, the replenishment rate is $r$ per millisecond, the old state is $(T_{old},t_{old})$, and the current controlled server time is $t$:

$$
T_{available}=\min(B,T_{old}+\max(0,t-t_{old})r)
$$

If $T_{available} \ge cost$:

$$
T_{new}=T_{available}-cost
$$

Otherwise, it will not be consumed and returned:

$$
retryAfter=\left\lceil\frac{cost-T_{available}}{r}\right\rceil
$$

The empty state is usually initialized to a full bucket, allowing normal bursting of new keys.

## 3. Minimal semantics of atomic scripts

```text
Input: counterKey, capacity, refillRate, cost

Read current tokens and lastRefill
Read the controlled server time
Calculate available
if available >= cost:
save available-cost
Return ALLOW, remaining
else:
Save the replenished available, but do not consume the cost
Return DENY, remaining, retryAfter
Update TTL
```

The entire process must be performed as an atomic operation within the Counter Store. The application layer `GET → Judge → SET` will cause multiple RLS to consume the last Token at the same time.

## 4. Time and TTL

- Client time is not accepted as the basis for release.
- Use Redis side or controlled server time; elapsed is at least truncated to zero when the clock is set back.
- Token Bucket TTL should cover the time to recover from an empty bucket to a full bucket, with a margin.
- Fixed Window TTL adds a shorter Grace Period to the remaining time of the window.
- Rely on TTL recycling after deleting the Rule, and do not fully scan the Counter in the hot path.

After TTL recycling, Key will appear again from the full bucket. This is semantically explicit and is not suitable for financial amounts that need to be persisted.

## 5. Numerical precision warning

Don't pretend to have solved the accuracy problem by:

```text
refillPerMs = integer(refillTokens * scale / refillPeriodMs)
```

Low rates may be truncated to zero, resulting in never replenishing or dividing by zero when calculating `retryAfter`; advancing `lastRefill` on every request may also continually lose fractional margin. Options include saving the fractional margin, or calculating in numerator/denominator and only normalizing on writeback.

Common numerical types in Redis Lua are not equivalent to arbitrary precision `int64` / BigInt. Using microTokens does not automatically eliminate IEEE-754 security scope issues. If you implement a fixed-point algorithm, you must define parameter upper limits, scale, overflow checks, and cross-language consistency testing.

Core learning only requires mastering formulas, atomicity, and precision risks, without having to choose the final numerical format.

## 6. Implementation boundaries of Hot Key

The same strict Counter Key must be processed by an authoritative order, therefore:

- Ordinary Shard can only disperse different Keys;
- Pipeline and batching can reduce network costs but cannot eliminate single-key serial boundaries;
- Isolating the Hot Key can protect other tenants and prevent the Key from unlimited expansion;
- Local Token Lease can improve throughput, but will introduce calculable over-issuance.

Only after the business gives `maxOvershoot`, the Lease size should be deduced from the upper bound.

## 7. Stopping point

Can explain algorithm selection, atomic scripts, time/TTL, numerical precision, and stop after Hot Key boundaries. No further design of the complete Redis Key format, Lua source code, Cluster client or benchmark parameters will be conducted.
