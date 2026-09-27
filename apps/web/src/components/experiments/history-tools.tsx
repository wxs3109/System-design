'use client'
import { useRef, useState } from 'react'
import { MAX_BACKUP_BYTES, type BackupPreview, type HistoryPage, type HistoryRecovery } from '../../core/experiments/history'

export function downloadRecovery(value: unknown, scope: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a'); link.href = url; link.download = `${scope.replace(/[^a-zA-Z0-9-]/g, '-')}-recovery.json`
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function HistoryTools({ session, ready }: { session: HistoryRecovery & { recoverySnapshot(): { scope: string } }; ready: boolean }) {
  const [history, setHistory] = useState<HistoryPage | null>(null)
  const [archived, setArchived] = useState(false)
  const [preview, setPreview] = useState<BackupPreview | null>(null)
  const [error, setError] = useState(''); const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false); const busyRef = useRef(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const perform = async (action: () => Promise<void>) => {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setError(''); setNotice('')
    try { await action() } catch (cause) { setError(cause instanceof Error ? cause.message : '历史操作失败，原记录已保留。') }
    finally { busyRef.current = false; setBusy(false) }
  }
  const refresh = async (page = history?.page ?? 0, archive = archived) => { setHistory(await session.historyPage(page, archive)); setDeleting(null) }
  return <details className="experiment-history-tools" onToggle={event => { if (event.currentTarget.open && !history) void perform(() => refresh(0)) }}>
    <summary>历史管理与备份</summary>
    <p>页面进度只统计已载入并核验的记录。较早历史按需核验；归档不删除数据，永久删除仅作用于你选中的已归档记录。</p>
    <div><button disabled={busy} onClick={() => void perform(async () => { downloadRecovery(await session.exportRecovery(), session.recoverySnapshot().scope); setNotice('备份已导出，包含归档和未能核验的记录。') })}>导出完整实验备份</button>
      <label>预览实验备份<input type="file" accept="application/json" disabled={busy || !ready} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; setPreview(null); if (file) void perform(async () => { if (file.size > MAX_BACKUP_BYTES) throw new Error('备份超过 50 MiB。'); setPreview(await session.previewRecovery(JSON.parse(await file.text()))) }) }} /></label></div>
    {preview ? <div><p>将导入 {preview.records} 条历史，其中 {preview.retained} 条无法核验，将原样保留并排除评分。当前草稿会作为恢复材料保留。</p><button disabled={busy || !ready} onClick={() => void perform(async () => { await session.importRecovery(preview); setPreview(null); await refresh(0); setNotice('备份已恢复。') })}>确认导入并替换当前草稿</button><button disabled={busy} onClick={() => setPreview(null)}>取消导入</button></div> : null}
    <label><input type="checkbox" checked={archived} disabled={busy} onChange={event => { const next = event.target.checked; setArchived(next); void perform(() => refresh(0, next)) }} />显示已归档历史</label>
    {history ? <><p>{history.total} 条 · 第 {history.page + 1} 页</p><ul>{history.entries.map(entry => <li key={entry.id}><time>{new Date(entry.createdAt).toLocaleString()}</time> <code>{entry.id.slice(0, 12)}</code>
      <button disabled={busy || !ready} onClick={() => void perform(async () => { await session.inspectHistory(entry.id); setNotice('历史已核验并恢复到当前草稿。') })}>核验并恢复</button>
      <button disabled={busy || !ready} onClick={() => void perform(async () => { await session.archiveHistory(entry.id, !archived); await refresh(); })}>{archived ? '取消归档' : '归档'}</button>
      {archived ? <button disabled={busy || !ready} onClick={() => setDeleting(entry.id)}>永久删除</button> : null}
      {deleting === entry.id ? <span>此操作不可撤销。<button disabled={busy || !ready} onClick={() => void perform(async () => { await session.deleteHistory(entry.id); await refresh(); })}>确认永久删除此条</button><button onClick={() => setDeleting(null)}>取消</button></span> : null}
    </li>)}</ul><button disabled={busy || history.page === 0} onClick={() => void perform(() => refresh(history.page - 1))}>上一页历史</button><button disabled={busy || (history.page + 1) * 10 >= history.total} onClick={() => void perform(() => refresh(history.page + 1))}>下一页历史</button><button disabled={busy} onClick={() => void perform(() => refresh())}>刷新历史列表</button></> : null}
    {busy ? <p role="status">正在处理历史记录…</p> : null}{notice ? <p role="status">{notice}</p> : null}{error ? <p role="alert">{error}</p> : null}
  </details>
}
