# Design Ride Dispatch System

## Case portrait

| Dimensions | Focus |
|---|---|
| Primary Archetype | Geospatial Realtime Marketplace |
| Core invariants | The same Driver or Trip cannot be in conflicting valid allocation states at the same time; the trip state must evolve legally |
| Quality attribute priority | Matching Latency → Availability → Safety / Privacy |
| Traffic / Data Shape | High-frequency location streams, regional supply and demand Hotspot, real-time matching, and Transactional Trip State |
| Failure strategy | Stale locations can be discarded; orders can be re-dispatched if matching fails; confirmed itineraries and billing events must be persisted |
| Security Boundaries | Real-time Location, Driver and Passenger Identity, Personal Security, Fraud and Location History Retention |
| Key Patterns | Geospatial Partitioning、Location Stream、Matching、Lease / Conditional Update、Trip State Machine、Push |

## Functional boundaries
- The basic version completes location reporting, taxi calling, driver matching, trip status, pricing and payment.
- Dynamic pricing, ride-sharing and complex dispatch optimization as evolving capabilities.

## Acceptable NFR (Design Assumptions)

- Designed with 5,000,000 simultaneous online drivers, peak location updates of approximately 1,500,000 times/s and 100,000 Ride Requests/s, and fault isolation and capacity by Region.
- Active drivers report locations every 3–5 seconds; 95% of locations available for dispatch are updated within 10 seconds, and stale or out-of-order locations are discarded according to the Event Time.
- 95% of normal area matching is completed within 10 seconds; timeout can expand the search range or redispatch the order.
- The same driver cannot accept two valid Trips at the same time; use Lease / Conditional Update for matching.
- Regional Ride Request API monthly availability target 99.99%; real-time location is only exposed to authorized parties and restricted retention; confirmed Trip and Fare Event meet RPO < 1 minute.

## Core business closed loop

1. Driver App establishes an online session and periodically reports Location Event with Event Time, Sequence Number and accuracy.
2. Location Ingestion completes device authentication, Schema/speed verification and current limiting, and partitions events by Region/Geo Cell; Latest Location and spatial index are expirable Derived State.
3. Rider submits Pickup, Destination and idempotent Request ID; the system generates Quote and solidifies price, service type and validity period into Snapshot.
4. Dispatch Service reads nearby available Drivers, sorts them based on ETA, car model, status and fairness, and creates a Dispatch Round/Offer with deadline.
5. Driver and Trip are atomically bound through Lease/Conditional Update when accepting an order; late or repeated Accept can only see the confirmed result and cannot form a second valid allocation.
6. Arriving, Picked Up, In Trip, Completed / Cancelled evolve through explicit Trip State Machine; participants subscribe to location and status updates within the authorization scope.
7. After completion, generate Fare Event based on Quote, actual mileage/duration and rules, and then call Payment asynchronously; payment Pending should not erase the completed Trip fact.
8. Driver disconnection, offer timeout or cancellation trigger re-dispatch or compensation; abnormal status is converged by Reconciliation and manual operation entrance.

## Core topics

- Event Time, Sequence Number, TTL, out-of-order discard, backpressure and downsampling for Location Event.
- Geo Cell/Region partitioning, boundary expansion, spatial index, nearby search and hotspot cell splitting.
- ETA, Candidate Ranking, Batch / Sequential Offer, fairness, Lease, timeout and redispatch.
- Driver Availability and Trip Assignment’s atomic constraints, idempotent Accept and cross-Region Handoff.
- Trip State Machine, route offset, real-time push, disconnection Catch-up and Safety Event.
- Quote Snapshot, Dynamic Pricing, Fare Calculation, Payment Pending and Reconciliation.
- Regional fault isolation, supply and demand hotspots, location minimization, access auditing and retention periods.

## Minimum data list

| Data | Source of Truth / Role | Consistency Focus |
|---|---|---|
| Driver Session / Availability | Driver State Store | Online status with Lease; the same Driver cannot be bound to two valid Trips at the same time |
| Raw Location Event | Short-term Event Stream | Ordered by Driver / Session, carrying Event Time and Sequence Number |
| Latest Location / Geo Index | Expired Derived Store | TTL, version checked, updateable from location stream; does not count as confirmed trip fact |
| Ride Request / Dispatch Offer | Dispatch Store | Request Idempotency, Offer Deadline, Accept results are auditable |
| Trip | Trip Store | Legal status migration; valid allocation of Driver and Rider is unique |
| Quote / Pricing Snapshot | Pricing / Trip Store | Record the rule version, validity period and price semantics confirmed by the user |
| Fare / Payment Reference | Billing Record | Can be recalculated, associated with Trip, and remains Pending when paying Unknown |
| Safety / Access Audit | Audit Store | Log sensitive location access, emergency events and controlled operations |

## Key Trade-off

- Higher location reporting frequency improves ETA and matching freshness, but increases power, bandwidth, stream processing costs and privacy risks; adaptive sampling should be based on motion status, front and back stages, and travel stages.
- Smaller Geo Cells reduce the number of single candidates, but increase boundary queries and hotspot tilt; adjacency expansion, hotspot cell splitting and Region Ownership need to be designed together.
- Broadcasting Offers to more Drivers at the same time can reduce Rider waiting time, but increase driver competition, cancellation rate and repeated Accept pressure; sequential or small batch Offers are more controllable but have higher latency.
- Enhancing consistent writing of global driver status is too expensive; limiting Assignment Authority to a single Home Region can use local conditional writing, and cross-region movement requires explicit Ownership Handoff.
- Using an older location can maintain the ability to call rides when stream processing is degraded, but may give incorrect ETA or unsafe matching; when the location exceeds the Freshness Budget, the circle should be expanded, refreshed or stopped.
- More complex global matching algorithms can improve overall efficiency, but increase the difficulty of calculating deadlines and interpretation; online order dispatch usually requires bounded candidate sets and approximate strategies that can be quickly recalculated.

## Interview questions

- How to deal with regional traffic peaks when large-scale events end?
- Two Dispatch Workers assign the same Driver to different Riders at the same time. Which write point prevents double allocation?
- The driver's order response timed out but was actually successful. How can I avoid generating two valid trips by re-dispending the order?
- When Location Stream is delayed for 30 seconds, which functions are degraded, and when must dispatch be stopped?
- When the driver crosses Region boundaries and the original Region fails, how can Assignment Ownership be safely transferred?

## Subsequent expansion sequence

1. Location Contract, Ingestion, Partition, Latest Location and Geo Index;
2. Ride Request, Candidate Search, ETA, Ranking and Dispatch Round;
3. Lease, Conditional Update, Driver Ownership and Trip State Machine;
4. Realtime Push, Dynamic Pricing, Fare, Payment and Cancellation;
5. Hotspot, Fairness, Privacy, Safety, Regional Recovery and Reconciliation.
