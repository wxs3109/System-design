'use client'
import Link from 'next/link'
import { Component, Fragment, createContext, useContext, useState, type ReactNode } from 'react'
import { downloadRecovery } from './history-tools'

export interface RecoverySource {
  scope: string
  label: string
  snapshot(): unknown
  export(): Promise<unknown>
  reload(): Promise<unknown>
  cancel(): void
}
/** Kept above the throwing subtree, so retries reuse its current in-memory input. */
class RecoveryResources {
  private values = new Map<string, unknown>()
  readonly sources = new Map<string, RecoverySource>()
  get<T>(key: string, create: () => T): T { if (!this.values.has(key)) this.values.set(key, create()); return this.values.get(key) as T }
}
const Context = createContext<RecoveryResources | null>(null)
export function useRecoveryResource<T>(key: string, create: () => T, source: (value: T) => RecoverySource): T {
  const registry = useContext(Context)
  const [value] = useState(() => {
    const resource = registry ? registry.get(key, create) : create()
    if (registry) registry.sources.set(key, source(resource))
    return resource
  })
  return value
}
class Boundary extends Component<{ resources: RecoveryResources; children: ReactNode }, { error: string | null; retry: number; message: string; busy: boolean }> {
  state = { error: null as string | null, retry: 0, message: '', busy: false }
  static getDerivedStateFromError(error: unknown) { return { error: error instanceof Error ? error.message : '实验页面无法显示。' } }
  componentDidCatch() { for (const source of this.props.resources.sources.values()) source.cancel() }
  private async export(source: RecoverySource) {
    this.setState({ busy: true, message: '' })
    try { downloadRecovery(await source.export(), source.scope); this.setState({ message: '恢复文件已导出。' }) }
    catch (cause) {
      try { downloadRecovery({ ...Object(source.snapshot()), incomplete: true, storageError: cause instanceof Error ? cause.message : '读取存储失败' }, source.scope); this.setState({ message: '完整备份导出失败，已导出本页内存中的输入；文件不包含尚未读取的历史。' }) }
      catch { this.setState({ message: '导出失败，当前输入仍留在本页。' }) }
    } finally { this.setState({ busy: false }) }
  }
  render() {
    if (!this.state.error) return <Fragment key={this.state.retry}>{this.props.children}</Fragment>
    const sources = [...this.props.resources.sources.values()]
    return <main className="experiment-recovery" role="alert"><h1>实验暂时无法显示</h1><p>{this.state.error}</p><p>当前输入保留在本页。可以先导出，再重试显示；只有选择读取已保存版本时，才会替换本页修改。</p>
      <button disabled={this.state.busy} onClick={() => this.setState(state => ({ error: null, retry: state.retry + 1, message: '' }))}>保留输入并重试显示</button>
      {sources.map(source => <section key={source.scope}><strong>{source.label}</strong><button disabled={this.state.busy} onClick={() => void this.export(source)}>导出{source.label}</button><button disabled={this.state.busy} onClick={() => { this.setState({ busy: true }); void source.reload().then(() => this.setState(state => ({ error: null, retry: state.retry + 1, message: '' }))).catch(cause => this.setState({ message: cause instanceof Error ? cause.message : '读取失败，当前输入仍保留。' })).finally(() => this.setState({ busy: false })) }}>放弃本页修改并读取已保存的{source.label}</button></section>)}
      {this.state.message ? <p role="status">{this.state.message}</p> : null}<p><Link href="/practice">返回练习目录</Link></p>
    </main>
  }
}
export function ExperimentBoundary({ children }: { children: ReactNode }) {
  const [resources] = useState(() => new RecoveryResources())
  return <Context.Provider value={resources}><Boundary resources={resources}>{children}</Boundary></Context.Provider>
}
