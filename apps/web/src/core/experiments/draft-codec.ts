import { LabStorageError } from './errors'
export function migrateDraft(value: unknown, from: number, target: number, migrations: Readonly<Record<number, (value: unknown) => unknown>> = {}): unknown {
  if (![from, target].every(v => Number.isSafeInteger(v) && v > 0) || from > target || target - from > 64) throw new LabStorageError('load', '草稿版本未知或高于当前版本，原记录已保留。')
  let draft = structuredClone(value)
  for (let version = from; version < target; version++) {
    const migrate = migrations[version]
    if (!migrate) throw new LabStorageError('load', `缺少草稿 v${version} → v${version + 1} 的迁移，原记录已保留。`)
    draft = migrate(draft)
  }
  return draft
}
