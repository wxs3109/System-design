# Design Recommendation System

## Case positioning

This case trains an end-to-end closed loop of personalized recommendations, rather than just discussing a certain machine learning model. The main chain is fixed as:

> Candidate Generation → Feature Retrieval → Ranking → Serving → Feedback Loop → Experimentation

The focus is on how to combine multiple candidates and features with different degrees of age under strict online deadlines to obtain recommendation results that are downgradeable, interpretable, and experimentally verifiable; while ensuring that behavioral feedback, experimental attribution, privacy, and policy filtering are not destroyed by system links.

## Case portrait

| Dimensions | Focus |
|---|---|
| Primary Archetype | Personalized Retrieval and Multi-stage Ranking |
| Core invariants | Do not return content that you are not authorized to display or that violates policies; the experimental bucketing of a request is stable and traceable; the attribution of exposure, clicks, and conversions cannot be contaminated by duplication or stringing |
| Design Drivers | Relevance、P99 Latency、Freshness、Availability、Experiment Integrity、Cost |
| Traffic / Data Shape | High read traffic, multi-channel parallel candidates, online feature checking, high-frequency behavioral events, coexistence of offline and real-time pipelines |
| Failed policy | Downgrade by deadline after candidate source or feature times out; policy filtering Fail-closed; return safe non-personalized results when personalization is not available |
| Security Boundary | Consent, PII, user portrait access, content security, brush volume and sorting manipulation, experimental data isolation |

## Scenario and scope

### Scope

- Generate multiplex candidates for users and contexts, merge, deduplicate and control the budget of each source.
- Obtain online/near-line features, perform rough and fine sorting, and return results within deadline.
- Perform qualification, permissions, content security, frequency control and business policy filtering before final response.
- Record Request, Experiment Assignment, Exposure, Click, Conversion and other events to support training, evaluation and experiment attribution.
- Supports versioned release, canary, rollback and fallback of models, features, rules and experiments.

### Out of scope

- No specific deep learning algorithm is derived, nor is the offline training platform completely redone.
- Not responsible for content production, social graph or search indexing itself; they are candidate sources or relied upon.
- Ad bidding, budget consumption and billing accuracy are not incorporated into this case.

## Must answer main chain

### 1. Candidate Generation

- Do candidates come from collaborative filtering, content similarity, attention relationships, Trending, rule recall or retrieval systems?
- How to define the Recall, Latency, Freshness, cost and quantity budget of each candidate?
- How to deal with multi-channel parallel timeout, insufficient results, duplicate content and single source crowding?

### 2. Feature Retrieval

- Who owns the user, content, context and cross-features respectively? How are online and offline features consistently defined?
- How are Feature Freshness, Missing Values, Default Values, Versions and Point-in-time Correctness expressed?
- When the Feature Store slows down or returns partial results, which features can be downgraded and which policy fields must be Fail-closed?

### 3. Ranking

- What goals are optimized for rough ranking, fine ranking and re-ranking, and how much Deadline and Compute Budget are allocated?
- How to deal with multi-objective trade-offs, content diversity, new content exploration, frequency control and policy constraints?
- How to bind Model / Feature / Rule Version and reproduce the results once?

### 4. Serving

- How are request-level deadlines propagated along candidate sources, features, and model calls and canceling overdue work?
- What is the fallback level for insufficient candidates, model failure, old features, or system overload?
- Can the cache cache candidates, embeddings, features or final results? How do personalization and permissions enter the Cache Key?

### 5. Feedback Loop

- What stable IDs are used to associate Request, Candidate, Rank, Exposure, Click, and Conversion?
- How does duplicate, late, out-of-order, bot or missing exposure affect labels and metrics?
- How to avoid Position Bias, Selection Bias, Feedback Loops and only reinforce existing popular content?

### 6. Experimentation

- Bucketing by User, Session or Request; how to handle cross-device, anonymous-to-login and experiment mutual exclusion?
- How is Assignment consistent and auditable across request paths, logs, and downstream metrics?
- What are Guardrail Metric, Sample Ratio Mismatch, Novelty Effect, Delayed Conversion and Rollback Conditions?

## Issues that must be quantified and accepted

- Break down the end-to-end P95/P99 Latency Budget and define the minimum quality of results that can still be returned after a timeout.
- Simultaneously measure online Relevance, Coverage, Diversity, Freshness, user long-term value and system cost, and cannot just give a single CTR.
- Define freshness / staleness upper bounds for candidates, features, models and behavioral events respectively.
- Account for peak size of recommendation requests, online feature reads, and behavioral ingestion, as well as major CPU/GPU, storage, and network costs.
- Verify policy filtering is not bypassed by Cache, Fallback, or legacy signatures; verify privacy removal and Consent change propagation.
- Exercise candidate source timeout, Feature Store partial failure, model service overload, event backlog, incorrect model release, and experiment contamination.
- Monitor the number of candidates, time spent at each stage, Fallback Rate, feature missing/outdated rate, model version, policy filtering rate, event completeness, experimental Sample Ratio and unit request cost.

## Differences from adjacent cases

| Adjacent Cases | Main Question of the Case | Differences in Recommendation |
|---|---|---|
| [News Feed](../03-news-feed/) | Content production, following relationships, Fan-out and Timeline derivation | Recommend recall from multiple sources and optimize personalized sorting, without requiring content to come from following relationships |
| [Search / Autocomplete](../11-search-and-autocomplete/) | Index retrieval, Fan-out and Ranking under user explicit Query | Recommendations usually do not have explicit Query and rely more on user portraits, exploration and feedback closed loops |
| [Ads / Clickstream Analytics](../13-ads-clickstream-analytics/) | Event-time aggregation, reporting and billing verification of behavioral events | Recommended consumption behavior signals to improve online decision-making, the core is low-latency service and experimentation, not billing facts |

## Pre-knowledge and dependency contracts

It is recommended to complete [News Feed](../03-news-feed/), [Search / Autocomplete](../11-search-and-autocomplete/), [Ads / Clickstream Analytics](../13-ads-clickstream-analytics/) and [Message Queue / Event Stream](../../01-common-basic-system/11-message-queue-event-stream/). When expanding, you must write down the freshness, deadline, failure, version, and responsibility boundaries of Feature Store, Model Serving, Event Stream, Cache, and policy services respectively.

## Review Question

- Will more real-time features definitely improve results; what online dependencies and costs does it add?
- How does the system ensure deadline, minimum result volume and diversity after a candidate source times out?
- Why is recording a click not enough to form a reliable training label?
- If the experiment is bucketed correctly, but the Exposure Event is lost, how will it contaminate the conclusion?
- Fallback Why must permissions, policies, and privacy filtering continue?
