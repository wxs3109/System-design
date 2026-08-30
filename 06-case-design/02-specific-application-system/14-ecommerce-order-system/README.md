# Design E-commerce Order system

## Case portrait

| Dimensions | Focus |
|---|---|
| Primary Archetype | Long-running Business Workflow |
| Core invariants | Inventory cannot be increased or deducted repeatedly without basis; the same Checkout cannot generate duplicate fund effects; Order, Inventory, Payment and Fulfillment must be traceable |
| Quality attribute priority | Workflow Correctness → Availability → Auditability |
| Traffic / Data Shape | Read more and write less, Flash Sale Hotspot, multiple SKU Order, external Payment / Warehouse / Carrier |
| Failure strategy | Catalog can be stale; Fail-closed when Inventory cannot be confirmed; Query and Reconciliation when external results are unknown; Long processes are allowed Pending |
| Security Boundary | Account Takeover, Payment Data, PII, Coupon Abuse, Bot, Seller / Tenant Isolation |
| Key Patterns | Inventory Reservation、Order State Machine、Idempotency、Outbox、Saga、Compensation、Reconciliation |

## Functional boundaries

- Browse products, add to cart, checkout, reserve inventory, pay, ship, cancel and refund.
- Supports one Order containing multiple SKUs; Marketplace split orders, complex promotions and cross-border tax as subsequent expansions.
- Catalog search and recommendation are only external reading dependencies. The main line of this case focuses on Checkout, Inventory, Payment and Fulfillment.

## Acceptable NFR (Design Assumptions)

- Normal Checkout P99 < 2 seconds to enter explicit Confirmed / Pending / Rejected state; does not wait for full fulfillment to end.
- Any retry cannot re-create Order or fund effects; Inventory Reservation uses conditional writing to prevent unwarranted overselling.
- Catalog allows minute-level obsolescence, and Price is solidified during Checkout; it is Fail-closed when the inventory cannot be confirmed.
- Order, Payment and Inventory Events are confirmed to meet RPO < 1 minute; Saga long-term Pending is detected by Reconciliation.

## Core business closed loop

1. User browses Catalog and adds SKU and quantity to Cart;
2. Checkout Service solidifies prices, offers, addresses and Idempotency Key;
3. Inventory Service creates a time-limited Reservation for each SKU;
4. Order Service creates a Pending Order and requests Payment;
5. After the payment is successful, confirm the Order and inventory deduction, and publish the Fulfillment Event;
6. Warehouse executes Pick/Pack/Ship, and Carrier updates Shipment;
7. Cancellations, out-of-stocks, payment failures and returns are handled through explicit State Machine and Compensation.

## Core topics

- Fact boundaries for Product, SKU, Price, Cart, Reservation, Order, Payment, Fulfillment and Shipment.
- Price Snapshot, Inventory Reservation, TTL, Overselling and Flash Sale Waiting Room.
- Checkout / Payment Idempotency, Unknown Outcome and Duplicate Callback.
- Order State Machine, Saga, Compensation, Partial Fulfillment and Partial Refund.
- Outbox, Event Ordering, Downstream Retry, DLQ and Reconciliation.
- Isolation of Catalog Cache, Search, Recommendation and core transaction links.

## Minimum data list

| Data | Source of Truth | Consistency Focus |
|---|---|---|
| Product/SKU | Catalog Store | Allow caching and bounded staleness |
| Price Snapshot | Checkout / Order Store | After placing an order, it cannot be silently changed by the Catalog |
| Inventory / Reservation | Inventory Store | Conditional Update, Prevent Overselling |
| Order | Order Store | Legal State Transition, Idempotency |
| Payment | Payment Processing System | Unknown Outcome、Reconciliation |
| Fulfillment / Shipment | Warehouse / Shipping Store | External Event Ordering and Status Mapping |

## Key Trade-off

- Synchronous waiting for Inventory, Payment and Warehouse will extend Latency and amplify failures; asynchronous Workflow will introduce Pending State and compensation.
- Doing global transactions for all SKUs is difficult to scale; Reservation + Saga is more practical, but requires clear Partial Failure.
- Forcing real-time Catalog and Price will reduce Availability; Checkout should solidify auditable Price Snapshot.
- Longer Reservation TTL improves payment completion rates, but also reduces inventory utilization and increases malicious occupation.

## Interview questions

- Only two of the three SKUs of an Order are successfully reserved. Should the entire order be failed, a partial order placed, or the order split?
- When Payment is successful but Inventory Reservation has expired, who is responsible for enquiry, refund and reconciliation?
- How to protect a small number of popular SKUs in Flash Sale without affecting normal catalog traffic?

## Subsequent expansion sequence

1. Catalog, Cart, Checkout and Price Snapshot;
2. Inventory, Reservation, Hotspot and Waiting Room;
3. Order, Payment, Idempotency and Unknown Outcome;
4. Saga, Fulfillment, Cancellation, Return and Partial Refund;
5. Reconciliation, Audit, Disaster Recovery and Multi-region.
