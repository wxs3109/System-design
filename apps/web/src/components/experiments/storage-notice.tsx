'use client'
import { useState } from 'react'
import type { AttemptIdentity } from '../../core/experiments/contracts'
import type { LabSession, LabSessionState } from '../../core/experiments/session'

export function storageLabel(state: { storage: 'loading' | 'saving' | 'saved' | 'error'; errorKind: 'load' | 'save' | 'conflict' | null }, saved = '当前操作已保存') {
  if (state.storage === 'error' && state.errorKind === 'load') return '读取失败 · 原记录已保留'
  if (state.storage === 'error' && state.errorKind === 'conflict') return '其他标签页已更新 · 本页未保存'
  return ({ loading: '正在恢复…', saving: '正在保存…', saved, error: '未保存 · 结果暂留内存' })[state.storage]
}

export function StorageNotice<D, A extends AttemptIdentity & { draft: D }>({ state, session, className, saveLabel }: { state: LabSessionState<D, A>; session: LabSession<D, A>; className?: string | undefined; saveLabel: string }) {
  const [exportError, setExportError] = useState('')
  if (!state.error) return null
  const exportLocal = () => {
    setExportError('')
    try {
      const data = session.recoverySnapshot()
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
      const link = document.createElement('a'); link.href = url; link.download = `${data.scope.replace(/[^a-zA-Z0-9-]/g, '-')}-recovery.json`
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) { setExportError(e instanceof Error ? e.message : '无法导出本页记录。') }
  }
  return <div role="alert" className={className}>
    <p>{state.error}</p>
    {state.errorKind === 'load' ? <><p>成功读取之前暂停修改，原草稿和历史不会被初始状态覆盖。</p><button onClick={() => void session.load()}>重试读取记录</button></> : state.errorKind === 'conflict' ? <><p>可先导出本页记录，再读取另一标签页保存的版本。</p><button onClick={exportLocal}>导出本页记录</button><button onClick={() => void session.reload()}>舍弃本页未保存修改并重新读取</button></> : <><button onClick={() => void session.save()}>{saveLabel}</button><button onClick={exportLocal}>导出本页记录</button></>}
    {exportError ? <p>{exportError}</p> : null}
  </div>
}
