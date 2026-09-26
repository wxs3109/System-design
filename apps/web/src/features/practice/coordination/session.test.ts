import 'fake-indexeddb/auto'
import { afterEach, expect, it } from 'vitest'
import { AlgorithmDatabase } from '../algorithm/repository'
import { CoordinationRepository, CoordinationSession } from './session'
import { initialDraft, scenarioCommands } from './lesson'
const databases: AlgorithmDatabase[] = []
afterEach(async () => { await Promise.all(databases.splice(0).map((db) => db.delete())) })
it('isolates heartbeat and lease histories, restoring delayed writes and immutable evidence', async () => {
  const db = new AlgorithmDatabase(`coordination-test-${crypto.randomUUID()}`); databases.push(db)
  const repo = new CoordinationRepository('lease-fencing', db)
  const heartbeats = new CoordinationRepository('heartbeat', db)
  const session = new CoordinationSession('lease-fencing', repo)
  await session.load()
  const d = initialDraft('lease-fencing'); d.config.fencing = true
  d.commands = scenarioCommands(d.config, 'stale-write').slice(0, 3)
  session.edit(d); session.run(); await session.save()
  const restored = new CoordinationSession('lease-fencing', repo); await restored.load()
  expect(restored.getSnapshot().draft.commands).toEqual(d.commands)
  expect(restored.getSnapshot().attempts[0]!.result.writes[0]!.status).toBe('network')
  expect((await heartbeats.load()).attempts).toHaveLength(0)
  restored.edit({ ...d, commands: [...d.commands, { type: 'advance', ms: 1500 }] }); restored.undo()
  expect(restored.getSnapshot().draft.commands).toEqual(d.commands)
  restored.redo(); await restored.save()
  const a = restored.getSnapshot().attempts[0]!
  await expect(repo.save(a.draft, a.id, [{ ...a, draft: { ...a.draft, reflection: 'mutated' } }])).rejects.toThrow('不能被覆盖')
  await db.attempts.add({ id: 'future', scope: repo.scope, attempt: { ...a, id: 'future', exerciseVersion: 2 } })
  expect((await repo.load()).rejected).toBe(1)
  expect(await db.attempts.get('future')).toBeDefined()
})
