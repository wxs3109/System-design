import 'fake-indexeddb/auto'
import { afterEach, expect, it, vi } from 'vitest'
import { AlgorithmDatabase } from '../algorithm/repository'
import { replicaLesson, quorumLesson, scenarioCommands as replicaCommands } from '../replication/lesson'
import { lesson as raft, scenarioCommands as raftCommands } from '../raft/lesson'
import { lesson as commit, scenarioCommands as commitCommands } from '../two-phase-commit/lesson'
import { lesson as durability, scenarioCommands as durabilityCommands } from '../durability/lesson'
import type { LabContract } from '../algorithm/contracts'
import { LabRepository } from '../algorithm/repository'
const databases: AlgorithmDatabase[] = []
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(databases.splice(0).map((db) => db.delete())) })
it('keeps all five new scopes separate and preserves executable evidence', async () => {
  const db = new AlgorithmDatabase(`advanced-${crypto.randomUUID()}`); databases.push(db)
  async function save<D, A extends { id: string; createdAt: number }>(id: string, contract: LabContract<D, A>, draft: D) {
    const repository = new LabRepository(db, `${id}:v1`, contract); const a = contract.runAttempt(draft)
    await repository.save(draft, a.id, [a]); const loaded = await repository.load(); expect(loaded.attempts).toHaveLength(1); expect(loaded.draft).toEqual(draft)
    await db.attempts.add({ id: `${id}-future`, scope: repository.scope, attempt: { ...a, id: `${id}-future`, exerciseVersion: 2 } })
    expect((await repository.load()).rejected).toBe(1); expect(await db.attempts.get(`${id}-future`)).toBeDefined()
  }
  const r = replicaLesson.initial(); r.config.readPolicy = 'session'; r.commands = replicaCommands(r.config, r.scenario)
  await save('replica-consistency', replicaLesson, r)
  const q = quorumLesson.initial(); q.commands = replicaCommands(q.config, q.scenario); await save('quorum-reads', quorumLesson, q)
  const f = raft.initial(); f.commands = raftCommands(f.config, f.scenario); await save('raft-consensus', raft, f)
  const t = commit.initial(); t.commands = commitCommands(t.config, t.scenario); await save('two-phase-commit', commit, t)
  const d = durability.initial(); d.config.acknowledgement = 'wal'; d.commands = durabilityCommands(d.config, d.scenario); await save('durability-recovery', durability, d)
  expect(await db.drafts.count()).toBe(5)
})
it('keeps a failed Raft save in memory and can restore a midway protocol state', async () => {
  const db = new AlgorithmDatabase(`advanced-retry-${crypto.randomUUID()}`); databases.push(db)
  const session = raft.session(db); await session.load(); const d = raft.initial(); d.commands = [{ type: 'campaign', node: 'A' }]; session.edit(d); await session.save()
  const restored = raft.session(db); await restored.load(); expect(restored.getSnapshot().draft.commands).toEqual(d.commands)
  const failure = vi.spyOn(restored.repository, 'save').mockRejectedValue(new Error('quota'))
  restored.run(); await vi.waitFor(() => expect(restored.getSnapshot().storage).toBe('error'))
  expect(restored.getSnapshot().attempts).toHaveLength(1); failure.mockRestore(); await restored.save()
  const a = restored.getSnapshot().attempts[0]!
  await expect(restored.repository.save(a.draft, a.id, [{ ...a, draft: { ...a.draft, reflection: 'changed' } }])).rejects.toThrow('不能被覆盖')
})
