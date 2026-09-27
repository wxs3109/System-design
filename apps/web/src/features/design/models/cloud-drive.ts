import { ObjectReplicas } from '../object-replicas'
import { semanticMessage, type SemanticMessage } from '../../../core/experiments/evidence'
import type { DesignConfig, DesignEvent } from '../model-contracts'

export function runCloudDrive(config: DesignConfig, commands: readonly string[]) {
  interface File { id: string; parent: string; name: string; revision: number; blob: string; deleted: boolean }
  interface Change { sequence: number; file: File }
  interface Edit { fileId: string; operationId: string; baseRevision: number; blob: string; content: string }
  interface Device { files: Map<string, File>; cursor: number; pending?: Change; edit?: Edit; edits: number }
  const blobs = new ObjectReplicas(); blobs.write('initial-blob', 'initial content', 2)
  const initial: File = { id: 'f1', parent: 'docs', name: 'report.txt', revision: 1, blob: 'initial-blob', deleted: false }
  const files = new Map([['f1', { ...initial }]])
  const folders = new Map([['root', { name: '/', parent: null as string | null }], ['docs', { name: 'docs', parent: 'root' }]])
  const devices: Record<string, Device> = { A: { files: new Map([['f1', { ...initial }]]), cursor: 0, edits: 0 }, B: { files: new Map([['f1', { ...initial }]]), cursor: 0, edits: 0 } }
  const changes: Change[] = []; const history: File[] = [{ ...initial }]
  const versionIndex = new Map<string, File[]>([['f1', [{ ...initial }]]])
  const completed = new Map<string, { fileId: string; revision: number }>(); const effects: { operation: string; file: string }[] = []
  type ResponseStatus = 'replayed' | 'deleted' | 'missing-content' | 'conflict' | 'lost-response' | 'forked' | 'committed'
  const responses: { operationId: string; status: ResponseStatus; fileId: string; revision: number | null }[] = []
  type DownloadStatus = 'unavailable' | 'not-visible' | 'missing-content' | 'current' | 'previous' | 'authorized' | 'leaked' | 'rejected'
  const downloads: { actor: 'B' | 'Guest'; status: DownloadStatus; revision: number | null; body: string | null; blob: string | null }[] = []
  const events: DesignEvent[] = []
  // Observer history is not consulted to reconstruct missing server metadata or bytes.
  const retired = new Set<string>()
  let online = true; let step = 0; let lastMutation = 0; let share = false; let bearer = false
  let missingRejected = 0; let danglingReads = 0; let conflicts = 0; let conflictCopies = 0; let silentOverwrites = 0; let commitGaps = 0; let replays = 0; let deviceCrashes = 0; let deletes = 0; let restores = 0; let resurrections = 0; let grants = 0; let revocations = 0; let guestAllowed = 0; let guestDeniedAfterRevoke = 0; let leaks = 0; let moved = 0; let editAttempts = 0
  let lastDownload: { file: File; body: string; step: number } | undefined
  let previousDownloads = 0; let versionRestores = 0
  let deletedWriteRejected = 0; let bVersionConflicts = 0; let crashesWithPending = 0
  const install = (file: File, gap = false) => {
    files.set(file.id, { ...file }); history.push({ ...file }); lastMutation = step
    versionIndex.set(file.id, [...(versionIndex.get(file.id) ?? []), { ...file }])
    if (config.changefeed === 'atomic' || !gap) changes.push({ sequence: changes.length + 1, file: { ...file } })
  }
  const receive = (device: Device) => {
    if (!online || device.pending) return
    const entry = changes.find((c) => c.sequence > device.cursor)
    if (!entry) return
    device.pending = structuredClone(entry)
    if (config.checkpoint === 'early') device.cursor = entry.sequence
  }
  const apply = (device: Device) => {
    if (!device.pending) return
    const entry = device.pending; const current = device.files.get(entry.file.id)
    if (!current || entry.file.revision > current.revision) device.files.set(entry.file.id, { ...entry.file })
    device.cursor = Math.max(device.cursor, entry.sequence); delete device.pending
  }
  const sync = (device: Device) => {
    let count = 0
    for (let i = 0; i < 256; i++) { receive(device); if (!device.pending) break; apply(device); count++ }
    return count
  }
  for (const [index, command] of commands.entries()) {
    step = index + 1; let messages: SemanticMessage[] = []
    if (!online && ['create-folder', 'rename-move', 'delete', 'restore', 'restore-previous', 'share', 'revoke', 'guest-get'].includes(command)) {
      if (command === 'guest-get') downloads.push({ actor: 'Guest', status: 'unavailable', revision: null, body: null, blob: null })
      events.push({ step, action: command, messages: [semanticMessage('cloud-drive.observation-001', [])] })
      continue
    }
    if (command === 'prepare-a' || command === 'prepare-b' || command === 'prepare-new-a') {
      const name = command.endsWith('a') ? 'A' : 'B'; const device = devices[name]!; const view = device.files.get('f1')
      const creating = command === 'prepare-new-a'
      if ((!creating && (!view || view.deleted)) || device.edits >= 6) messages = [semanticMessage('cloud-drive.observation-002', [])]
      else { const number = ++device.edits; device.edit = { fileId: creating ? 'f2' : 'f1', operationId: `${name}-${number}`, baseRevision: creating ? 0 : view!.revision, blob: `edit-${name}-${number}`, content: `${name} edit ${number}` }; messages = [semanticMessage('cloud-drive.observation-003', [name, creating, (!(creating)) ? (view!.revision) : null, device.edit.operationId])] }
    } else if (command === 'upload-a' || command === 'upload-b') {
      const name = command.endsWith('a') ? 'A' : 'B'; const edit = devices[name]!.edit
      if (!edit) messages = [semanticMessage('cloud-drive.observation-004', [])]
      else { blobs.write(edit.blob, edit.content, 2); messages = [semanticMessage('cloud-drive.observation-005', [edit.operationId])] }
    } else if (command === 'commit-a' || command === 'commit-b' || command === 'commit-a-gap') {
      const name = command === 'commit-b' ? 'B' : 'A'; const edit = devices[name]!.edit; const current = edit ? files.get(edit.fileId) : undefined
      editAttempts++
      if (!online || !edit) messages = [semanticMessage('cloud-drive.observation-006', [])]
      else if (config.idempotency === 'key' && completed.has(edit.operationId)) { replays++; responses.push({ operationId: edit.operationId, status: 'replayed', ...completed.get(edit.operationId)! }); messages = [semanticMessage('cloud-drive.observation-007', [edit.operationId])] }
      else if (current?.deleted) { conflicts++; deletedWriteRejected++; responses.push({ operationId: edit.operationId, status: 'deleted', fileId: edit.fileId, revision: null }); messages = [semanticMessage('cloud-drive.observation-008', [])] }
      else if (config.publication === 'durable' && blobs.read(edit.blob) === undefined) { missingRejected++; responses.push({ operationId: edit.operationId, status: 'missing-content', fileId: 'f1', revision: null }); messages = [semanticMessage('cloud-drive.observation-009', [])] }
      else if (current && current.revision !== edit.baseRevision && config.conflict === 'reject') { conflicts++; if (name === 'B') bVersionConflicts++; responses.push({ operationId: edit.operationId, status: 'conflict', fileId: edit.fileId, revision: null }); messages = [semanticMessage('cloud-drive.observation-010', [current.revision, edit.baseRevision])] }
      else {
        const conflict = !!current && current.revision !== edit.baseRevision
        const copy = conflict && config.conflict === 'copy'
        const id = copy ? `${edit.fileId}-conflict-${edit.operationId}` : edit.fileId
        const file: File = { id, parent: current?.parent ?? 'docs', name: copy ? `report (conflict ${edit.operationId}).txt` : current?.name ?? (edit.fileId === 'f2' ? 'notes.txt' : 'report.txt'), revision: copy ? 1 : (current?.revision ?? edit.baseRevision) + 1, blob: edit.blob, deleted: false }
        if (copy) { conflicts++; conflictCopies++; if (name === 'B') bVersionConflicts++ }
        else if (conflict) silentOverwrites++
        if (!current && retired.has(edit.fileId)) resurrections++
        const gap = command === 'commit-a-gap'
        install(file, gap); completed.set(edit.operationId, { fileId: id, revision: file.revision }); effects.push({ operation: edit.operationId, file: id })
        if (gap) { online = false; commitGaps++; responses.push({ operationId: edit.operationId, status: 'lost-response', fileId: id, revision: null }); messages = [semanticMessage('cloud-drive.observation-011', [id, file.revision, config.changefeed === 'atomic'])] }
        else { responses.push({ operationId: edit.operationId, status: copy ? 'forked' : 'committed', fileId: id, revision: file.revision }); messages = [semanticMessage('cloud-drive.observation-012', [id, file.revision, copy, (!(copy)) ? (conflict) : null])] }
      }
    } else if (command === 'restart-server') { online = true; messages = [semanticMessage('cloud-drive.observation-013', [])] }
    else if (command === 'sync-a' || command === 'sync-b') {
      const name = command.endsWith('a') ? 'A' : 'B'; const count = sync(devices[name]!); messages = [semanticMessage('cloud-drive.observation-014', [name, count, devices[name]!.cursor])]
    } else if (command === 'receive-b') { receive(devices.B!); messages = [semanticMessage('cloud-drive.observation-015', [devices.B!.pending, ((devices.B!.pending)) ? (devices.B!.pending.sequence) : null, ((devices.B!.pending)) ? (devices.B!.cursor) : null])] }
    else if (command === 'apply-b') { apply(devices.B!); messages = [semanticMessage('cloud-drive.observation-016', [devices.B!.cursor])] }
    else if (command === 'crash-b') { if (devices.B!.pending) crashesWithPending++; delete devices.B!.pending; deviceCrashes++; messages = [semanticMessage('cloud-drive.observation-017', [])] }
    else if (command === 'download-b' || command === 'download-new-b') {
      const fileId = command === 'download-b' ? 'f1' : 'f2'
      const file = devices.B!.files.get(fileId); const authoritative = files.get(fileId)
      if (!file || file.deleted || !authoritative || authoritative.deleted) { downloads.push({ actor: 'B', status: 'not-visible', revision: null, body: null, blob: null }); lastDownload = undefined; messages = [semanticMessage('cloud-drive.observation-018', [])] }
      else { const body = blobs.read(file.blob); if (body === undefined) { danglingReads++; lastDownload = undefined; downloads.push({ actor: 'B', status: 'missing-content', revision: null, body: null, blob: file.blob }); messages = [semanticMessage('cloud-drive.observation-019', [])] } else { lastDownload = { file: { ...file }, body, step }; downloads.push({ actor: 'B', status: 'current', revision: file.revision, body, blob: file.blob }); messages = [semanticMessage('cloud-drive.observation-020', [file.revision, body])] } }
    } else if (command === 'download-previous' || command === 'restore-previous') {
      const current = files.get('f1')
      const previous = current && !current.deleted ? versionIndex.get('f1')?.filter((f) => !f.deleted && f.blob !== current.blob).at(-1) : undefined
      const body = previous ? blobs.read(previous.blob) : undefined
      if (!online || !previous || body === undefined || !current) messages = [semanticMessage('cloud-drive.observation-021', [])]
      else if (command === 'download-previous') { previousDownloads++; downloads.push({ actor: 'B', status: 'previous', revision: previous.revision, body, blob: previous.blob }); messages = [semanticMessage('cloud-drive.observation-022', [previous.revision, body])] }
      else { install({ ...current, blob: previous.blob, revision: current.revision + 1 }); versionRestores++; messages = [semanticMessage('cloud-drive.observation-023', [previous.blob])] }
    } else if (command === 'create-folder') { if (!folders.has('archive')) folders.set('archive', { name: 'archive', parent: 'root' }); messages = [semanticMessage('cloud-drive.observation-024', [])] }
    else if (command === 'rename-move') {
      const file = files.get('f1')
      if (!online || !file || file.deleted || !folders.has('archive')) messages = [semanticMessage('cloud-drive.observation-025', [])]
      else { install({ ...file, parent: 'archive', name: 'report-final.txt', revision: file.revision + 1 }); moved++; messages = [semanticMessage('cloud-drive.observation-026', [])] }
    } else if (command === 'delete') {
      const file = files.get('f1')
      if (!online || !file || file.deleted) messages = [semanticMessage('cloud-drive.observation-027', [])]
      else { install({ ...file, deleted: true, revision: file.revision + 1 }); if (config.deletion === 'forget') { files.delete('f1'); versionIndex.delete('f1') }; retired.add('f1'); deletes++; messages = [semanticMessage('cloud-drive.observation-028', [config.deletion === 'tombstone'])] }
    } else if (command === 'restore') {
      const file = files.get('f1')
      if (!online || !file?.deleted) messages = [semanticMessage('cloud-drive.observation-029', [])]
      else { install({ ...file, deleted: false, revision: file.revision + 1 }); retired.delete('f1'); restores++; messages = [semanticMessage('cloud-drive.observation-030', [])] }
    } else if (command === 'share') { share = true; bearer = true; grants++; messages = [semanticMessage('cloud-drive.observation-031', [])] }
    else if (command === 'revoke') { share = false; revocations++; messages = [semanticMessage('cloud-drive.observation-032', [])] }
    else if (command === 'guest-get') {
      const file = files.get('f1'); const allowed = share || (config.sharing === 'bearer' && bearer)
      const body = file && !file.deleted && allowed ? blobs.read(file.blob) : undefined
      if (body !== undefined) { guestAllowed++; if (!share) leaks++; downloads.push({ actor: 'Guest', status: share ? 'authorized' : 'leaked', revision: null, body, blob: file!.blob }); messages = [semanticMessage('cloud-drive.observation-033', [share, body])] }
      else { if (revocations > 0 && !share && !allowed && file && !file.deleted && blobs.read(file.blob) !== undefined) guestDeniedAfterRevoke++; downloads.push({ actor: 'Guest', status: 'rejected', revision: null, body: null, blob: null }); messages = [semanticMessage('cloud-drive.observation-034', [])] }
    } else throw new Error(`Unknown drive action: ${command}`)
    events.push({ step, action: command, messages })
  }
  const visible = (entries: Map<string, File>) => JSON.stringify([...entries.values()].filter((f) => !f.deleted).sort((a, b) => a.id.localeCompare(b.id)))
  const current = files.get('f1'); const currentBody = current && !current.deleted ? blobs.read(current.blob) : undefined
  const downloadedFile = lastDownload ? files.get(lastDownload.file.id) : undefined
  const downloadCurrent = !!lastDownload && !!downloadedFile && lastDownload.step >= lastMutation && JSON.stringify(lastDownload.file) === JSON.stringify(downloadedFile) && lastDownload.body === blobs.read(downloadedFile.blob)
  const namespaceUnique = new Set([...files.values()].filter((f) => !f.deleted).map((f) => `${f.parent}/${f.name}`)).size === [...files.values()].filter((f) => !f.deleted).length
  const wrongReferences = [...files.values()].filter((f) => !f.deleted && blobs.read(f.blob) === undefined).length
  return { modelVersion: 'cloud-drive-v1' as const, events, metrics: { missingRejected, danglingReads, conflicts, conflictCopies, silentOverwrites, commitGaps, replays, deviceCrashes, crashesWithPending, bVersionConflicts, deletedWriteRejected, deletes, restores, resurrections, grants, revocations, guestAllowed, guestDeniedAfterRevoke, leaks, moved, editAttempts, previousDownloads, versionRestores, newFileDownloaded: Number(downloadCurrent && lastDownload?.file.id === 'f2' && lastDownload.body === devices.A!.edit?.content), editEffects: effects.length, duplicateEffects: effects.length - new Set(effects.map((e) => e.operation)).size, changes: changes.length, versions: history.length, fileCount: [...files.values()].filter((f) => !f.deleted).length, wrongReferences, namespaceUnique: Number(namespaceUnique), deviceACurrent: Number(visible(devices.A!.files) === visible(files)), deviceBCurrent: Number(visible(devices.B!.files) === visible(files)), downloadCurrent: Number(downloadCurrent), canonicalDownloaded: Number(downloadCurrent && lastDownload?.file.id === 'f1'), canonicalMatchesA: Number(!!devices.A!.edit && currentBody === devices.A!.edit.content), canonicalDeleted: Number(!current || current.deleted), archivePath: Number(current?.parent === 'archive' && current.name === 'report-final.txt' && !current.deleted), cursorB: devices.B!.cursor }, state: { files: [...files.values()], folders: Object.fromEntries(folders), devices: Object.fromEntries(Object.entries(devices).map(([id, d]) => [id, { files: [...d.files.values()], cursor: d.cursor, pending: d.pending ?? null, edit: d.edit ?? null }])), changes, history, versionIndex: [...versionIndex.values()].flat(), completed: Object.fromEntries(completed), effects, responses, downloads, nodes: blobs.snapshot(), online, share, bearer } }
}
