import { notFound } from 'next/navigation'
import { getPracticeEntry } from '@/features/practice/catalog'
import { HashingLab } from '@/features/practice/distribution/hashing-lab'
import { HotKeyLab } from '@/features/practice/hot-key/hot-lab'
import { PracticeWorkbench } from '@/features/practice/practice-workbench'
import { RetryIdempotencyLab } from '@/features/practice/retry-idempotency/retry-lab'
import { MessageLab } from '@/features/practice/message-flow/message-lab'
import { CoordinationLab } from '@/features/practice/coordination/coordination-lab'
import { SagaLab } from '@/features/practice/saga/saga-lab'
import { ConcurrentLab } from '@/features/practice/concurrent-update/concurrent-lab'
import { OverloadLab } from '@/features/practice/overload/overload-lab'
import { ReplicationLab } from '@/features/practice/replication/replication-lab'
import { RaftLab } from '@/features/practice/raft/raft-lab'
import { CommitLab } from '@/features/practice/two-phase-commit/commit-lab'
import { DurabilityLab } from '@/features/practice/durability/durability-lab'
import { DesignWorkbench } from '@/features/design/design-workbench'
import { ProductStudio } from '@/features/design/product-studio'

export default async function ExercisePage({ params }: { params: Promise<{ exerciseId: string }> }) {
  const { exerciseId } = await params
  const entry = getPracticeEntry(exerciseId)
  if (!entry) notFound()
  if (entry.kind === 'design') return <DesignWorkbench exerciseId={exerciseId} />
  if (entry.kind === 'product-design') return <ProductStudio exerciseId={exerciseId} />
  if (entry.kind === 'protocol') {
    if (entry.id === 'retry-idempotency') return <RetryIdempotencyLab />
    if (entry.id === 'ack-checkpoint' || entry.id === 'transactional-outbox') return <MessageLab labId={entry.id} />
    if (entry.id === 'heartbeat' || entry.id === 'lease-fencing') return <CoordinationLab labId={entry.id} />
    if (entry.id === 'saga-recovery') return <SagaLab />
    if (entry.id === 'concurrent-update') return <ConcurrentLab />
    if (entry.id === 'overload') return <OverloadLab />
    if (entry.id === 'replica-consistency' || entry.id === 'quorum-reads') return <ReplicationLab labId={entry.id} />
    if (entry.id === 'raft-consensus') return <RaftLab />
    if (entry.id === 'two-phase-commit') return <CommitLab />
    if (entry.id === 'durability-recovery') return <DurabilityLab />
    notFound()
  }
  if (entry.kind === 'algorithm') {
    if (entry.id === 'hot-key') return <HotKeyLab />
    if (entry.id === 'consistent-hashing') return <HashingLab />
    notFound()
  }
  return <PracticeWorkbench exerciseId={exerciseId} />
}
