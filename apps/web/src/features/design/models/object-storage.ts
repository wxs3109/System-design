import { ObjectReplicas, teachingChecksum } from '../object-replicas'
import { semanticMessage, type SemanticMessage } from '../../../core/experiments/evidence'
import type { DesignConfig, DesignEvent } from '../model-contracts'

export function runObjectStorage(config: DesignConfig, commands: readonly string[]) {
  interface Part { key: string; checksum: string }
  interface Upload { id: string; overwrite: boolean; parts: Record<number, Part>; version?: number }
  interface Version { id: number; uploadId: string; parts: Part[] }
  const blobs = new ObjectReplicas()
  const uploads: Upload[] = []; let active: Upload | undefined
  const versions: Version[] = []; const events: DesignEvent[] = []
  const reads: { targetVersion: number | null; status: SemanticMessage; body: string | null }[] = []
  let nextVersion = 1; let online = true; let pinned = 0; let lostAcks = 0; let failures = 0; let rejected = 0; let corruptParts = 0; let beforeCommitReads = 0; let partialReads = 0; let corruptReads = 0; let unavailable = 0; let completedReads = 0; let correctAfterLoss = 0; let lastCorrect = 0; let pinnedCorrect = 0; let pinnedDistinct = 0; let restarts = 0; let deduped = 0
  const copies = Number(config.copies)
  let lastMutation = 0; let lastReadStep = 0
  const intendedPart = (u: Upload, part: number) => part === 1 ? u.overwrite ? 'new ' : 'hello ' : 'world'
  const intendedObject = (id: string) => { const u = uploads.find((item) => item.id === id)!; return intendedPart(u, 1) + intendedPart(u, 2) }
  for (const [index, command] of commands.entries()) {
    if (!['get', 'read-pinned', 'pin'].includes(command)) lastMutation = index + 1
    let messages: SemanticMessage[] = []
    if (command === 'begin' || command === 'begin-overwrite') {
      if (!online || uploads.length >= 8) messages = [semanticMessage('object-storage.observation-001', [])]
      else { active = { id: `upload-${uploads.length + 1}`, overwrite: command === 'begin-overwrite', parts: {} }; uploads.push(active); messages = [semanticMessage('object-storage.observation-002', [active.id])] }
    } else if (command === 'part1' || command === 'part2' || command === 'part2-corrupt') {
      if (!active || active.version) messages = [semanticMessage('object-storage.observation-003', [])]
      else {
        const number = command === 'part1' ? 1 : 2
        const payload = command === 'part2-corrupt' ? 'wurld' : intendedPart(active, number)
        const checksum = teachingChecksum(intendedPart(active, number))
        const key = `${active.id}/part-${number}/${teachingChecksum(payload)}`
        if (command === 'part2-corrupt') corruptParts++
        if (blobs.write(key, payload, copies)) { active.parts[number] = { key, checksum }; messages = [semanticMessage('object-storage.observation-004', [number, copies])] }
        else messages = [semanticMessage('object-storage.observation-005', [copies])]
      }
    } else if (command === 'complete' || command === 'complete-lost') {
      if (!online || !active) messages = [semanticMessage('object-storage.observation-006', [])]
      else if (active.version && config.completion === 'idempotent') { deduped++; messages = [semanticMessage('object-storage.observation-007', [active.version])] }
      else {
        const parts = [active.parts[1], active.parts[2]]
        const complete = parts.every((part) => part && blobs.copies(part.key) >= copies)
        const valid = complete && parts.every((part) => config.checksum !== 'verify' || teachingChecksum(blobs.read(part!.key)!) === part!.checksum)
        if (!valid) { rejected++; messages = [semanticMessage('object-storage.observation-008', [])] }
        else {
          const version = { id: nextVersion++, uploadId: active.id, parts: parts.map((part) => ({ ...part! })) }
          if (config.versions === 'overwrite') versions.splice(0)
          versions.push(version); active.version = version.id
          messages = [semanticMessage('object-storage.observation-009', [version.id])]
          if (command === 'complete-lost') { lostAcks++; messages.push(semanticMessage('object-storage.observation-010', [])) }
        }
      }
    } else if (command === 'crash') { online = false; messages = [semanticMessage('object-storage.observation-011', [])] }
    else if (command === 'restart') { online = true; restarts++; messages = [semanticMessage('object-storage.observation-012', [])] }
    else if (command === 'lose-a') { blobs.lose('A'); failures++; messages = [semanticMessage('object-storage.observation-013', [])] }
    else if (command === 'recover-a') { blobs.recover('A'); messages = [semanticMessage('object-storage.observation-014', [])] }
    else if (command === 'repair') {
      const keys = new Set(versions.flatMap((v) => v.parts.map((p) => p.key)))
      let repaired = 0; for (const key of keys) if (blobs.repair(key, copies)) repaired++
      messages = [semanticMessage('object-storage.observation-015', [repaired, keys.size])]
    } else if (command === 'pin') { pinned = versions.at(-1)?.id ?? 0; messages = [semanticMessage('object-storage.observation-016', [pinned, ((pinned)) ? (pinned) : null])] }
    else if (command === 'get' || command === 'read-pinned') {
      const version = command === 'read-pinned' ? versions.find((v) => v.id === pinned) : versions.at(-1)
      const partial = command === 'get' && config.publication === 'early' && active && !active.version
      if (active && !active.version) beforeCommitReads++
      const parts = partial ? Object.values(active!.parts) : version?.parts
      let status = semanticMessage('object-storage.read.missing'); let body = ''; let good = false
      if (!online) { status = semanticMessage('object-storage.read.offline'); unavailable++ }
      else if (parts?.length) {
        const values = parts.map((p) => blobs.read(p.key))
        if (values.some((v) => v === undefined)) { status = semanticMessage('object-storage.read.lost'); unavailable++ }
        else if (config.checksum === 'verify' && parts.some((p, i) => teachingChecksum(values[i]!) !== p.checksum)) { status = semanticMessage('object-storage.read.corrupt'); unavailable++ }
        else {
          body = values.join(''); status = partial ? semanticMessage('object-storage.read.partial') : semanticMessage('object-storage.read.complete', [version!.id])
          if (partial) partialReads++
          else { completedReads++; good = body === intendedObject(version!.uploadId); if (!good) corruptReads++; if (good && failures > 0) correctAfterLoss++ }
        }
      }
      if (command === 'read-pinned') { pinnedCorrect = Number(good && version?.id === pinned); pinnedDistinct = Number(good && version && versions.at(-1) && version.id < versions.at(-1)!.id && body !== intendedObject(versions.at(-1)!.uploadId)) }
      else { lastCorrect = Number(good); lastReadStep = index + 1 }
      reads.push({ targetVersion: command === 'get' ? null : pinned, status, body: body || null })
      messages = [semanticMessage('object-storage.observation-017', [status, body, ((body)) ? (body) : null])]
    } else throw new Error(`Unknown object action: ${command}`)
    events.push({ step: index + 1, action: command, messages })
  }
  const allParts = versions.flatMap((v) => v.parts)
  if (lastReadStep < lastMutation) lastCorrect = 0
  return { modelVersion: 'object-storage-v1' as const, events, metrics: { versions: versions.length, uploads: uploads.length, lostAcks, failures, rejected, corruptParts, beforeCommitReads, partialReads, corruptReads, unavailable, completedReads, correctAfterLoss, lastCorrect, pinnedCorrect, pinnedDistinct, restarts, deduped, minimumCopies: allParts.length ? Math.min(...allParts.map((p) => blobs.copies(p.key))) : 0 }, state: { uploads, versions, reads, nodes: blobs.snapshot(), activeId: active?.id ?? null, online, pinned, nextVersion } }
}
