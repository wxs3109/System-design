import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { initialDraft, runAttempt } from '../src/features/practice/concurrent-update/lesson'

test('pages older history, archives it, and restores a complete lab backup in a clean browser', async ({ page, browser }) => {
  await page.goto('/practice/concurrent-update')
  await expect(page.getByTestId('experiment-save-status')).toHaveText('当前操作已保存')
  await page.getByRole('button', { name: '读取 A', exact: true }).click()
  await expect(page.getByTestId('experiment-save-status')).toHaveText('当前操作已保存')
  const template = runAttempt(initialDraft())
  const rows = Array.from({ length: 31 }, (_, i) => ({ id: `backup-${i}`, scope: 'concurrent-update:v1', createdAt: i + 1, archived: 0, attempt: { ...template, id: `backup-${i}`, createdAt: i + 1 } }))
  await page.evaluate(rows => new Promise<void>((resolve, reject) => { const request = indexedDB.open('system-design-algorithm-labs'); request.onsuccess = () => { const db = request.result; const tx = db.transaction('attempts', 'readwrite'); for (const row of rows) tx.objectStore('attempts').put(row); tx.oncomplete = () => { db.close(); resolve() }; tx.onerror = () => reject(tx.error) } }), rows)
  await page.reload()
  await expect(page.getByText('进度仅含已载入核验的历史；其余记录可在“历史管理与备份”中查看。')).toBeVisible()
  const manager = page.locator('.experiment-history-tools')
  await manager.getByText('历史管理与备份', { exact: true }).click()
  await expect(manager).toContainText('31 条 · 第 1 页')
  await manager.getByRole('button', { name: '下一页历史' }).click()
  const older = manager.getByRole('listitem').filter({ hasText: 'backup-20' })
  await older.getByRole('button', { name: '归档', exact: true }).click()
  await manager.getByLabel('显示已归档历史').check()
  await expect(manager).toContainText('1 条 · 第 1 页')
  const downloading = page.waitForEvent('download'); await manager.getByRole('button', { name: '导出完整实验备份' }).click()
  const file = await downloading; const content = await readFile((await file.path())!, 'utf8')
  expect(JSON.parse(content).records).toHaveLength(31)
  const context = await browser.newContext(); const target = await context.newPage()
  try {
    await target.goto('/practice/concurrent-update'); await expect(target.getByTestId('experiment-save-status')).toHaveText('当前操作已保存')
    const tools = target.locator('.experiment-history-tools'); await tools.getByText('历史管理与备份', { exact: true }).click()
    await tools.getByLabel('预览实验备份').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(content) })
    await expect(tools).toContainText('将导入 31 条历史')
    await expect(target.getByTestId('concurrent-A')).not.toHaveText('已有本地快照')
    await tools.getByRole('button', { name: '确认导入并替换当前草稿' }).click()
    await expect(target.getByTestId('concurrent-A')).toHaveText('已有本地快照')
    await target.reload(); await expect(target.getByTestId('concurrent-A')).toHaveText('已有本地快照')
    await tools.getByText('历史管理与备份', { exact: true }).click(); await tools.getByLabel('显示已归档历史').check()
    await expect(tools).toContainText('backup-20')
    await tools.getByRole('button', { name: '永久删除', exact: true }).click()
    await expect(tools).toContainText('此操作不可撤销。')
    await tools.getByRole('button', { name: '确认永久删除此条' }).click(); await expect(tools).toContainText('0 条')
  } finally { await context.close() }
})

test('exports a workbench recovery file and restores it through a checked preview', async ({ page, browser }) => {
  await page.goto('/'); await expect(page.getByTestId('workbench-editing-surface')).not.toHaveAttribute('inert')
  await page.getByRole('button', { name: 'Load example', exact: true }).click(); await page.getByRole('button', { name: /^Direct service/ }).click()
  await page.getByRole('button', { name: 'History', exact: true }).click()
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: '导出工作台备份' }).click()
  const file = await downloading; const content = await readFile((await file.path())!, 'utf8')
  const context = await browser.newContext(); const target = await context.newPage()
  try {
    await target.goto('/'); await expect(target.getByTestId('workbench-editing-surface')).not.toHaveAttribute('inert')
    await target.getByRole('button', { name: 'History', exact: true }).click()
    await target.getByLabel('预览工作台备份').setInputFiles({ name: 'workspace.json', mimeType: 'application/json', buffer: Buffer.from(content) })
    await target.getByRole('button', { name: '确认恢复工作台备份' }).click()
    await expect(target.getByTestId('rf__node-service-direct')).toBeVisible()
    await target.reload(); await expect(target.getByTestId('rf__node-service-direct')).toBeVisible()
  } finally { await context.close() }
})
