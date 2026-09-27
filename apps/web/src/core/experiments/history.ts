export const HISTORY_PAGE_SIZE = 10
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024
export interface HistoryEntry { id: string; createdAt: number; archived: boolean }
export interface HistoryPage { entries: HistoryEntry[]; total: number; page: number }
export interface BackupPreview { records: number; retained: number; draft: unknown; data: unknown }
export interface HistoryRecovery {
  historyPage(page: number, archived: boolean): Promise<HistoryPage>
  inspectHistory(id: string): Promise<void>
  archiveHistory(id: string, archived: boolean): Promise<void>
  deleteHistory(id: string): Promise<void>
  exportRecovery(): Promise<unknown>
  previewRecovery(value: unknown): Promise<BackupPreview>
  importRecovery(preview: BackupPreview): Promise<void>
}
export function recoveryObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('备份格式无效。')
  return value as Record<string, unknown>
}
export function checkBackupSize(value: unknown) {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_BACKUP_BYTES) throw new Error('备份超过 50 MiB，请分实验导出。')
}
