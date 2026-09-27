/** Application composition root. Client renderers import leaf definitions, never this catalog. */
import { createElement, type ComponentType } from 'react'
import { experimentRegistry, type ExperimentCapabilities, type ExperimentKind, type RegisteredExperiment } from '../core/experiments/registry'
import { exercises } from '../features/practice/exercises'
import { hashingExercise } from '../features/practice/distribution/lesson'
import { hotKeyExercise } from '../features/practice/hot-key/lesson'
import { retryExercise } from '../features/practice/retry-idempotency/lesson'
import { messageExercises } from '../features/practice/message-flow/lesson'
import { exercises as coordinationExercises } from '../features/practice/coordination/lesson'
import { sagaExercise } from '../features/practice/saga/lesson'
import { concurrentExercise } from '../features/practice/concurrent-update/lesson'
import { overloadExercise } from '../features/practice/overload/lesson'
import { exercises as replicationExercises } from '../features/practice/replication/lesson'
import { exercise as raftExercise } from '../features/practice/raft/lesson'
import { exercise as commitExercise } from '../features/practice/two-phase-commit/lesson'
import { exercise as durabilityExercise } from '../features/practice/durability/lesson'
import { shortLinkExercise } from '../features/design/short-link'
import { newsFeedDesign } from '../features/design/news-feed'
import { objectStorageDesign } from '../features/design/object-storage'
import { mapsDesign } from '../features/design/maps'
import { dispatchDesign } from '../features/design/dispatch'
import { cloudDriveDesign } from '../features/design/cloud-drive'
import { exercise as qualityGoalsExercise } from '../features/practice/quality-goals/lesson'
import { exercise as resourceBudgetExercise } from '../features/practice/resource-budget/lesson'
import { exercise as dataAccessExercise } from '../features/practice/data-access/lesson'
import { exercise as statePlacementExercise } from '../features/practice/state-placement/lesson'
import { exercise as cacheCoherenceExercise } from '../features/practice/cache-coherence/lesson'
import { exercise as authorizationExercise } from '../features/practice/authorization-boundaries/lesson'
import { exercise as tenantIsolationExercise } from '../features/practice/tenant-isolation/lesson'
import { exercise as evolutionExercise } from '../features/practice/safe-evolution/lesson'

export type ExperimentRenderer = ComponentType<{ exerciseId: string }>
interface CardSource { id: string; title: string; summary: string; category: string; difficulty: string; estimatedMinutes: number; version?: number; versions?: { definition: number }; flow?: readonly string[] }
function register<D extends CardSource, K extends ExperimentKind>(definition: D, kind: K, loadRenderer: () => Promise<ExperimentRenderer>, caseInfo?: { caseId: string; scope: string }, capabilities: Partial<ExperimentCapabilities> = {}) {
  return {
    kind, definition,
    metadata: { id: definition.id, title: definition.title, summary: definition.summary, category: definition.category, difficulty: definition.difficulty, estimatedMinutes: definition.estimatedMinutes, kind, definitionVersion: definition.versions?.definition ?? definition.version ?? 1, flow: definition.flow ?? [] },
    capabilities: { execution: kind === 'simulation' || kind === 'design' ? 'worker' as const : 'local' as const, step: kind === 'protocol' || kind === 'product-design', topology: kind === 'design', compare: true, restore: true, ...capabilities },
    loadRenderer, ...caseInfo,
  } satisfies RegisteredExperiment<ExperimentRenderer> & { kind: K; definition: D }
}
export const experiments = experimentRegistry([
  register(qualityGoalsExercise, 'algorithm', async () => (await import('../features/practice/quality-goals/quality-lab')).QualityGoalsLab, undefined, { step: true }),
  register(resourceBudgetExercise, 'algorithm', async () => (await import('../features/practice/resource-budget/resource-lab')).ResourceBudgetLab, undefined, { step: true }),
  register(dataAccessExercise, 'algorithm', async () => (await import('../features/practice/data-access/access-lab')).DataAccessLab, undefined, { step: true }),
  register(statePlacementExercise, 'algorithm', async () => (await import('../features/practice/state-placement/state-lab')).StatePlacementLab, undefined, { step: true }),
  register(cacheCoherenceExercise, 'protocol', async () => (await import('../features/practice/cache-coherence/cache-lab')).CacheCoherenceLab),
  register(authorizationExercise, 'protocol', async () => (await import('../features/practice/authorization-boundaries/authorization-lab')).AuthorizationLab),
  register(tenantIsolationExercise, 'protocol', async () => (await import('../features/practice/tenant-isolation/tenant-lab')).TenantIsolationLab),
  register(evolutionExercise, 'protocol', async () => (await import('../features/practice/safe-evolution/evolution-lab')).SafeEvolutionLab),
  ...exercises.map(exercise => register(exercise, 'simulation', async () => (await import('../features/practice/practice-workbench')).PracticeWorkbench)),
  register(hashingExercise, 'algorithm', async () => (await import('../features/practice/distribution/hashing-lab')).HashingLab),
  register(hotKeyExercise, 'algorithm', async () => (await import('../features/practice/hot-key/hot-lab')).HotKeyLab, undefined, { execution: 'worker' }),
  register(retryExercise, 'protocol', async () => (await import('../features/practice/retry-idempotency/retry-lab')).RetryIdempotencyLab),
  ...messageExercises.map(exercise => register(exercise, 'protocol', async () => { const { MessageLab } = await import('../features/practice/message-flow/message-lab'); return function MessageEntry() { return createElement(MessageLab, { labId: exercise.id }) } })),
  ...coordinationExercises.map(exercise => register(exercise, 'protocol', async () => { const { CoordinationLab } = await import('../features/practice/coordination/coordination-lab'); return function CoordinationEntry() { return createElement(CoordinationLab, { labId: exercise.id }) } })),
  register(sagaExercise, 'protocol', async () => (await import('../features/practice/saga/saga-lab')).SagaLab),
  register(concurrentExercise, 'protocol', async () => (await import('../features/practice/concurrent-update/concurrent-lab')).ConcurrentLab),
  register(overloadExercise, 'protocol', async () => (await import('../features/practice/overload/overload-lab')).OverloadLab),
  ...replicationExercises.map(exercise => register(exercise, 'protocol', async () => { const { ReplicationLab } = await import('../features/practice/replication/replication-lab'); return function ReplicationEntry() { return createElement(ReplicationLab, { labId: exercise.id }) } })),
  register(raftExercise, 'protocol', async () => (await import('../features/practice/raft/raft-lab')).RaftLab),
  register(commitExercise, 'protocol', async () => (await import('../features/practice/two-phase-commit/commit-lab')).CommitLab),
  register(durabilityExercise, 'protocol', async () => (await import('../features/practice/durability/durability-lab')).DurabilityLab),
  register(shortLinkExercise, 'design', async () => (await import('../features/design/entries/short-link')).default, { caseId: 'CASE-01', scope: '跳转读取路径' }),
  register(newsFeedDesign, 'product-design', async () => (await import('../features/design/entries/news-feed')).default, { caseId: 'CASE-02', scope: '分发、名人热点与故障恢复' }),
  register(objectStorageDesign, 'product-design', async () => (await import('../features/design/entries/object-storage')).default, { caseId: 'CASE-03', scope: '分片提交、持久性与版本读取' }),
  register(mapsDesign, 'product-design', async () => (await import('../features/design/entries/maps')).default, { caseId: 'CASE-04', scope: '附近查询、位置更新与道路寻路' }),
  register(dispatchDesign, 'product-design', async () => (await import('../features/design/entries/dispatch')).default, { caseId: 'CASE-05', scope: '位置新鲜度、竞争派单与迟到确认' }),
  register(cloudDriveDesign, 'product-design', async () => (await import('../features/design/entries/cloud-drive')).default, { caseId: 'CASE-12', scope: '文件、目录、同步、冲突、删除与分享' }),
])
