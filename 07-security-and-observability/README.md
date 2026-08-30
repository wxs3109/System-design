# Security and Observability

The goal: to enable systems to not only run, but also be protected, measured, diagnosed, and recovered. In the first round, only problem maps are built.

## 1. Authentication and authorization

- User, service and device identities
- Session、Token、OAuth、API Key
- RBAC, ABAC and least privilege
- Multi-tenant isolation and permission auditing

## 2. Encryption and key management

- Encryption of data in transit and at rest
- Key generation, storage, rotation and revocation
- Secret management, certificates and trust boundaries
- Sensitive data classification and desensitization

## 3. Abuse prevention and current limiting

- User, IP, Token and resource dimension current limiting
- Bots, crawlers, spam and fraud
- WAF, DDoS protection and quotas
- Killings, downgrades and appeal paths

## 4. Logs, indicators and Tracing

- What questions do Logs, Metrics, and Traces answer?
- Correlation ID and cross-service context
- RED, USE and business metrics
- Sampling, retention, cost and privacy

## 5. SLI, SLO and SLA

- Availability, latency, correctness and freshness metrics
- Error Budget and release decisions
- The difference between user perspective and component perspective
-Multi-window alarm

## 6. Alarm and incident response

- Actionable Alert and Alert Fatigue
- On-call, grading, escalation and communication
- Runbook, rollback, downgrade and recovery verification
- Blameless Postmortem and improvement tracking

## Subsequent expansion

- Split independent notes for each topic.
- Supplement threat model, Dashboard and SLO for cases.
- Added real fault drills and review templates.
