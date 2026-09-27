import type { ConceptBody } from './types'
import { fundamentals } from './content/fundamentals'
import { reliableExecution } from './content/reliable-execution'
import { coordination } from './content/coordination'
import { workflowsRecovery } from './content/workflows-recovery'
import { designFoundations } from './content/design-foundations'
import { decisionPatterns } from './content/decision-patterns'

export const conceptBodies: Readonly<Record<string, ConceptBody>> = { ...designFoundations, ...decisionPatterns, ...fundamentals, ...reliableExecution, ...coordination, ...workflowsRecovery }
export const readingSources: Readonly<Record<string, { title: string; url: string }>> = {
  authorization: { title: 'OWASP · Authorization Cheat Sheet', url: 'https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html' },
  canary: { title: 'Google SRE Workbook · Canarying Releases', url: 'https://sre.google/workbook/canarying-releases/' },
  asyncRequestReply: { title: 'Azure Architecture Center · Asynchronous Request-Reply', url: 'https://learn.microsoft.com/en-us/azure/architecture/patterns/asynchronous-request-reply' },
  slo: { title: 'Google SRE · Service Level Objectives', url: 'https://sre.google/sre-book/service-level-objectives/' },
  ddia: { title: 'Designing Data-Intensive Applications · Fundamental ideas and trade-offs', url: 'https://dataintensive.net/' },
  indexes: { title: 'PostgreSQL · Introduction to indexes', url: 'https://www.postgresql.org/docs/current/indexes-intro.html' },
  stateless: { title: 'AWS Well-Architected · Make systems stateless where possible', url: 'https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_mitigate_interaction_failure_stateless.html' },
  idempotency: { title: 'AWS Builders’ Library · Making retries safe with idempotent APIs', url: 'https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/' },
  retries: { title: 'AWS Builders’ Library · Timeouts, retries, and backoff with jitter', url: 'https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/' },
  acknowledgements: { title: 'RabbitMQ · Consumer acknowledgements and publisher confirms', url: 'https://www.rabbitmq.com/docs/confirms' },
  kafka: { title: 'Apache Kafka · Consumer position and message delivery semantics', url: 'https://kafka.apache.org/43/design/design/' },
  ordering: { title: 'Azure Architecture Center · Competing consumers', url: 'https://learn.microsoft.com/en-us/azure/architecture/patterns/competing-consumers' },
  deadLetter: { title: 'Amazon SQS · Dead-letter queues', url: 'https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html' },
  transactions: { title: 'PostgreSQL · Transaction isolation', url: 'https://www.postgresql.org/docs/current/transaction-iso.html' },
  heartbeats: { title: 'RabbitMQ · Heartbeats and failure detection', url: 'https://www.rabbitmq.com/docs/heartbeats' },
  chubby: { title: 'Mike Burrows · The Chubby lock service', url: 'https://static.usenix.org/events/osdi06/tech/full_papers/burrows/burrows_html/' },
  consistency: { title: 'Jepsen · Consistency models', url: 'https://jepsen.io/consistency/models' },
  quorum: { title: 'Apache Cassandra · Dynamo replication and consistency', url: 'https://cassandra.apache.org/doc/latest/cassandra/architecture/dynamo.html' },
  raft: { title: 'Ongaro & Ousterhout · In Search of an Understandable Consensus Algorithm', url: 'https://raft.github.io/raft.pdf' },
  outbox: { title: 'AWS Prescriptive Guidance · Transactional outbox', url: 'https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html' },
  compensation: { title: 'Azure Architecture Center · Compensating transaction', url: 'https://learn.microsoft.com/en-us/azure/architecture/patterns/compensating-transaction' },
  twoPhaseCommit: { title: 'PostgreSQL · PREPARE TRANSACTION', url: 'https://www.postgresql.org/docs/current/sql-prepare-transaction.html' },
  wal: { title: 'PostgreSQL · Write-ahead logging', url: 'https://www.postgresql.org/docs/current/wal-intro.html' },
  recovery: { title: 'Google SRE · Data integrity', url: 'https://sre.google/sre-book/data-integrity/' },
  overload: { title: 'Google SRE · Handling overload', url: 'https://sre.google/sre-book/handling-overload/' },
  caching: { title: 'Azure Architecture Center · Cache-aside', url: 'https://learn.microsoft.com/en-us/azure/architecture/patterns/cache-aside' },
  hashing: { title: 'Apache Cassandra · Dynamo partitioning', url: 'https://cassandra.apache.org/doc/latest/cassandra/architecture/dynamo.html' },
}
