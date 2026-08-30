# Design Maps & Navigation System

## Case portrait

| Dimensions | Focus |
|---|---|
| Primary Archetype | Geospatial Query / Realtime Stream |
| Core Invariants | Map, road network, and index versions must be identifiable; route calculations must be based on internally consistent versions of the data |
| Quality attribute priority | Low Latency → Availability → Traffic Freshness |
| Traffic / Data Shape | Massive map tile reading, expensive route query, high-frequency location and traffic updates |
| Failure strategy | Real-time traffic failure can be degraded to historical traffic or static routes; weak networks can use offline maps |
| Security Boundary | Location Privacy, API Key Abuse, Location History Retention, and Data Poisoning |
| Key Patterns | Map Tiles、CDN、Geospatial Index、Hierarchical Routing、Stream Aggregation、Versioned Dataset |

## Functional boundaries
- The basic version completes map tile display, location search and static road network path planning.
- Real-time traffic, dynamic ETA and offline maps are used as evolved versions, reusing the same versioned map and road network model.

## Acceptable NFR (Design Assumptions)

- Designed for global peaks of 10,000,000 Tile Request/s (primarily hitting CDN), 200,000 Place Query/s, 100,000 Route Query/s and 2,000,000 Location Event/s.
- Map tiles are provided through CDN, with cache hit time of P99 < 100 ms and monthly availability of 99.99%.
- Route API monthly availability target 99.95%; normal intra-city route query P95 < 1 second, ultra-large range query uses Deadline and allows explicit approximate or degraded results.
- Only compatible map, road network and traffic versions can be used for a route calculation, and unverified versions should not be mixed.
- Ordinary map editing can enter the published Snapshot within 24 hours; emergency road closures will take effect within 5 minutes through Versioned Overlay.
- After entering the real-time traffic version, major road events will enter the routing within 2 minutes; when the stream processing fails, it will fall back to historical traffic or static routes.

## Core business closed loop

1. Offline Pipeline ingests roads, locations, boundaries, satellites/mapping and audits Edit, performs Schema, topology, permissions and quality verification and then writes Versioned Map Fact.
2. Build Workflow generates Vector/Raster Tile, Place Index, Geocoding Index, Routing Graph and hierarchical shortcut structure from consistent Source Snapshot; Artifact comes with Dataset Version and compatibility information.
3. Publisher atomically switches Release Manifest after completing coverage and path regression checks; CDN Cache Key contains Version, and the old Client continues to read the complete old version within the compatibility window.
4. Map Client requests Tile by Viewport/Zoom; static bytes are provided from CDN, and Control API is only responsible for configuration, version and access policy.
5. Place Query first performs text and geographical candidate recall, and then combines distance, language and business rule ranking; the results clearly carry the data version and freshness.
6. Route Service Snaps the start and end points to a compatible Road Graph, searches for candidate routes within Region/Hierarchy, and calculates ETA based on static weights, restrictions, and Traffic Overlay.
7. Device / Partner Location Event enters Stream through dedicated Ingestion; the aggregator generates Traffic State with TTL, confidence and version according to Road Segment and Event Time.
8. Navigation Session subscribes to route-related road closures and traffic changes; Reroute is triggered when the revenue exceeds the threshold, and falls back to Historical Traffic or Static Weight when stream processing exceptions occur.
9. Emergency road closure is quickly released as an audited Versioned Overlay; subsequent offline Snapshot absorbs the change to avoid long-term maintenance of two sets of conflicting facts.

## Core topics
- Map Fact, Edit Validation, Snapshot, Release Manifest, Compatibility Window and Rollback.
- Vector / Raster Tile, multi-level scaling, Generalization, versioned Cache Key and CDN.
- Geocoding, Reverse Geocoding, Place Index, Nearby Search, Language and Ranking.
- Road Graph, Turn Restriction, Map Matching, Dijkstra/A*, hierarchical graphs and precomputation.
- Graph Partition, span query, deadline, approximate path, Partial Result and Overload Protection.
- Location Event, Event Time, Map Matching, Traffic Aggregation, Confidence, TTL and ETA.
- Incident / Closure Overlay, incremental update, Reroute, Offline Map, weak network and version convergence.
- Location Privacy, Consent, Retention, API Key / Tenant Quota and data poisoning protection.

## Minimum data list

| Data | Roles | Consistency Focus |
|---|---|---|
| Map Fact / Edit | Authoritative inputs such as roads, locations, boundaries, etc. | Source, version, review status and change history traceability |
| Dataset Snapshot / Release Manifest | A set of release boundaries that are compatible with Artifacts | Atomic switching, rollback; no unverified versions mixed in one request |
| Tile Artifact | Immutable Derived Asset displayed on the map | Dataset Version enters the Cache Key and can be reconstructed by Snapshot |
| Place / Geocoding Index | Text and spatial retrieval structure | Associated with Map Fact version; supports incremental construction and full reconstruction |
| Routing Graph / Shortcut | Static topology and weights for path planning | Turn Restriction correct with partition boundaries; version compatible |
| Raw Location / Probe Event | Short-term input for real-time traffic | Event Time, Precision, Consent, Retention and De-Identification |
| Traffic State / Incident Overlay | Dynamic road segment weighting and road closures with TTL | Road Segment + Dataset Version alignment; recording Confidence and Freshness |
| Navigation Session | Current Route Version, progress and Reroute Cursor | Short-term state, recoverable; only exposed to authorized Clients |

## Key Trade-off

- Raster Tile's rendering results are stable and CDN-friendly, but styles and language variations will enlarge storage; Vector Tile allows Client to render flexibly, but increases device computing and data exposure.
- Publish full Snapshots more frequently to improve map freshness, but also increase Build/Validation costs and Cache Churn; Emergency Overlay can take effect quickly, but must eventually be merged back into the authoritative Snapshot.
- Online search of the complete road map can use the latest weights, but it is difficult to meet global low latency; hierarchical graphs and pre-computation significantly reduce query costs, but require incremental repair or rollback in the face of road changes.
- Smaller Graph Partition is easy to expand horizontally, but increases cross-partition Fan-out and boundary path errors; hierarchical Ownership and Deadline-aware Merge need to be designed together.
- The denser the real-time location sampling, the newer the Traffic Estimate, but the higher the device power, Ingestion cost and Privacy risk; adaptive sampling and aggregation should be based on road importance, speed and confidence.
- Forcing to wait for all Graph Shard returns improves optimality but increases Tail Latency; it is often more useful to return marked approximate routes or static routes under an explicit deadline.
- Server-side Routing facilitates the use of real-time global data, and Offline Client Routing is more reliable when the network is disconnected; the two must share compatible Dataset / Rule Version to explain the difference.

## Interview questions

- How quickly does a road closure affect ongoing navigation?
- How to prevent a passable but non-navigable hybrid version from being displayed when a new Tile is published and the Routing Graph build fails?
- Route Query spans multiple Graph Partitions and one of them times out. Should it return an approximate route, the old route, or fail?
- How will ETA, Reroute and map display be degraded respectively when Traffic Stream is delayed for ten minutes?
- An incorrect overlay has affected a large number of Sessions. How to roll back and allow Clients to converge quickly?
- How to aggregate reliable traffic speeds without long-term preservation of individual trajectories?

## Subsequent expansion sequence

1. Map Fact, Edit Workflow, Snapshot, Artifact Build, Publish and Rollback;
2. Tile, Zoom/Generalization, CDN, Versioning and Offline Package;
3. Place/Geocoding Index, Nearby Search, Ranking and API Quota;
4. Road Graph, Partition, Hierarchical Routing, Deadline, ETA and Reroute;
5. Location Stream, Traffic / Incident Overlay, Privacy, Recovery and Multi-region.
