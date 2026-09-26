'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { AlgorithmDatabase, LabRepository } from '../practice/algorithm/repository'
import { LabSession } from '../practice/algorithm/session'
import { StorageNotice, storageLabel } from '../practice/algorithm/storage-notice'

interface Notes { requirements: string; decision: string; reflection: string }
const empty = (): Notes => ({ requirements: '', decision: '', reflection: '' })
function parse(value: unknown): Notes {
  const n = value as Notes | null
  if (!n || [n.requirements, n.decision, n.reflection].some((v) => typeof v !== 'string' || v.length > 4000)) throw new Error('设计笔记格式无效，原记录已保留。')
  return { requirements: n.requirements, decision: n.decision, reflection: n.reflection }
}
export function DesignNotebook({ exerciseId }: { exerciseId: string }) {
  const [session] = useState(() => new LabSession(new LabRepository<Notes, { id: string; exerciseId: string; exerciseVersion: number; createdAt: number; draft: Notes }>(new AlgorithmDatabase(), `${exerciseId}:notes:v1`, {
    initial: empty, parseDraft: parse, runAttempt: () => { throw new Error('笔记不自动评分。') }, verifyAttempt: (value): value is never => { void value; return false },
  })))
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot)
  useEffect(() => { void session.load() }, [session])
  return <section aria-label="设计笔记"><h2>设计笔记</h2><p>记录自己的推理；文字不参与自动评分。{storageLabel(state)}</p>
    <StorageNotice state={state} session={session} saveLabel="重试保存笔记" />
    {([{ key: 'requirements', label: '需求澄清：要解决什么，不解决什么？' }, { key: 'decision', label: '设计决策：为何选这些组件和连接？' }, { key: 'reflection', label: '复盘：哪条证据支持结论，还缺什么？' }] as const).map(({ key, label }) => <label key={key}>{label}<textarea maxLength={4000} disabled={!state.ready} value={state.draft[key]} onChange={(e) => session.edit({ ...state.draft, [key]: e.target.value })} /></label>)}
  </section>
}
