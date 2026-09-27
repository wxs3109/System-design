'use client'
import { useRef, useState } from 'react'
import { MAX_BACKUP_BYTES, type BackupPreview } from '../../core/experiments/history'
import { downloadRecovery } from './history-tools'
export interface BackupRecovery {
  recoverySnapshot(): { scope: string }
  exportRecovery(): Promise<unknown>
  previewRecovery(value: unknown): Promise<BackupPreview>
  importRecovery(value: BackupPreview): Promise<void>
}
export function BackupTools({ recovery, ready }: { recovery: BackupRecovery; ready: boolean }) {
  const [preview, setPreview] = useState<BackupPreview | null>(null)
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false); const active = useRef(false)
  const act = async (fn: () => Promise<void>) => {
    if (active.current) return; active.current = true; setBusy(true); setMessage('')
    try { await fn() } catch (error) { setMessage(error instanceof Error ? error.message : '备份操作失败。') }
    finally { setBusy(false); active.current = false }
  }
  return <div className="experiment-history-tools"><strong>工作台备份与恢复</strong><p>备份包含当前项目和本项目的历史；导入前预览，原草稿保留为历史版本。导入的运行结果不计入练习通过，需要重新运行。</p>
    <button disabled={busy} onClick={() => void act(async () => { downloadRecovery(await recovery.exportRecovery(), recovery.recoverySnapshot().scope); setMessage('工作台备份已导出。') })}>导出工作台备份</button>
    <label>预览工作台备份<input type="file" accept="application/json" disabled={busy || !ready} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; setPreview(null); if (file) void act(async () => { if (file.size > MAX_BACKUP_BYTES) throw new Error('备份超过 50 MiB。'); setPreview(await recovery.previewRecovery(JSON.parse(await file.text()))) }) }} /></label>
    {preview ? <><p>{preview.records} 条历史；其中 {preview.retained} 条不支持当前版本，将保留原记录。</p><button disabled={busy || !ready} onClick={() => void act(async () => { await recovery.importRecovery(preview); setPreview(null); setMessage('工作台已恢复，运行历史需重新执行后才能计入练习通过。') })}>确认恢复工作台备份</button><button disabled={busy} onClick={() => setPreview(null)}>取消导入</button></> : null}
    {busy ? <p role="status">正在处理备份…</p> : null}{message ? <p role="status">{message}</p> : null}
  </div>
}
