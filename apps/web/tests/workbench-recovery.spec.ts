import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'

test.use({ actionTimeout: 15000 })
async function stored(page: Page) {
  return page.evaluate(() => new Promise<{ head: { version: number; revision: number; projectId: string; projectRevisionId: string }; project: { topology: { nodes: { id: string; name: string }[] } } }>((resolve, reject) => {
    const request = indexedDB.open('system-design-simulator')
    request.onsuccess = () => {
      const db = request.result; const tx = db.transaction(['workspaceHeads', 'projectRevisions'])
      const read = tx.objectStore('workspaceHeads').get('active')
      read.onsuccess = () => { const head = read.result; if (!head) { db.close(); resolve(undefined as never); return }; const revision = tx.objectStore('projectRevisions').get(head.projectRevisionId); revision.onsuccess = () => { db.close(); resolve({ head, project: revision.result.project }) } }
      tx.onerror = () => reject(tx.error)
    }; request.onerror = () => reject(request.error)
  }))
}
async function openDirect(page: Page) {
  await page.goto('/')
  const picker = page.getByRole('button', { name: 'Load example', exact: true })
  await expect(picker).toBeEnabled(); await picker.click()
  await page.getByRole('button', { name: /^Direct service/ }).click()
  await expect.poll(async () => (await stored(page))?.head.projectId).toBe('direct-service')
}
async function renameService(page: Page, name: string) {
  await expect(page.getByRole('button', { name: 'Run simulation', exact: true })).toBeEnabled()
  await page.getByTestId('rf__node-service-direct').click()
  const show = page.getByRole('button', { name: 'Show properties panel', exact: true })
  if (await show.count()) await show.click()
  await page.getByLabel('Name', { exact: true }).fill(name)
}
test('canvas tabs preserve a winning save and export the unsaved branch before explicit reload', async ({ page, context }) => {
  await openDirect(page)
  const other = await context.newPage(); await other.goto('/')
  await expect(other.getByTestId('rf__node-service-direct')).toBeVisible()
  await expect(other.getByRole('button', { name: 'Run simulation', exact: true })).toBeEnabled()
  await renameService(page, 'A saved')
  await expect.poll(async () => (await stored(page)).project.topology.nodes.find(n => n.id === 'service-direct')?.name).toBe('A saved')
  await renameService(other, 'B unsaved')
  await expect(other.locator('.workbench-storage-banner')).toContainText('另一个标签页已更新')
  await expect(other.getByTestId('workbench-editing-surface')).toHaveAttribute('inert', '')
  expect((await stored(page)).project.topology.nodes.find(n => n.id === 'service-direct')?.name).toBe('A saved')
  const event = other.waitForEvent('download'); await other.getByRole('button', { name: '导出本页记录', exact: true }).click()
  const file = await event; const backup = JSON.parse(await readFile((await file.path())!, 'utf8'))
  expect(backup.format).toBe('system-design-workbench-recovery')
  expect(backup.project.topology.nodes.find((n: { id: string }) => n.id === 'service-direct').name).toBe('B unsaved')
  await other.getByRole('button', { name: '舍弃本页未保存修改并重新读取', exact: true }).click()
  await expect(other.getByRole('button', { name: 'Run simulation', exact: true })).toBeEnabled()
  await other.getByTestId('rf__node-service-direct').click()
  await expect(other.getByLabel('Name', { exact: true })).toHaveValue('A saved')
})
test('a canvas read failure pauses editing and retries reading without replacing the original project', async ({ page }) => {
  await page.addInitScript(() => {
    const get = IDBObjectStore.prototype.get
    IDBObjectStore.prototype.get = function (...args: Parameters<typeof get>) { if (this.name === 'workspaceHeads' && sessionStorage.getItem('failCanvasReads') === 'yes') throw new DOMException('temporary canvas read failure', 'UnknownError'); return get.apply(this, args) }
  })
  await openDirect(page); const original = await stored(page)
  await page.evaluate(() => sessionStorage.setItem('failCanvasReads', 'yes')); await page.reload()
  await expect(page.locator('.workbench-storage-banner')).toContainText('temporary canvas read failure')
  await expect(page.getByTestId('workbench-editing-surface')).toHaveAttribute('inert', '')
  await page.evaluate(() => sessionStorage.removeItem('failCanvasReads'))
  expect(await stored(page)).toEqual(original)
  await page.getByRole('button', { name: '重试读取记录', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Run simulation', exact: true })).toBeEnabled()
  await expect(page.getByTestId('rf__node-service-direct')).toBeVisible()
})
test('an unknown workspace head is retained and exported instead of reset by retry', async ({ page }) => {
  await openDirect(page)
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('system-design-simulator')
    request.onsuccess = () => { const db = request.result; const tx = db.transaction('workspaceHeads', 'readwrite'); const table = tx.objectStore('workspaceHeads'); const read = table.get('active'); read.onsuccess = () => table.put({ ...read.result, version: 99 }); tx.oncomplete = () => { db.close(); resolve() }; tx.onerror = () => reject(tx.error) }
  }))
  await page.reload()
  await expect(page.locator('.workbench-storage-banner')).toContainText('版本未知')
  await page.getByRole('button', { name: '重试读取记录', exact: true }).click()
  await expect(page.locator('.workbench-storage-banner')).toContainText('版本未知')
  expect((await stored(page)).head.version).toBe(99)
  const event = page.waitForEvent('download'); await page.getByRole('button', { name: '导出恢复记录', exact: true }).click()
  const file = await event; const backup = JSON.parse(await readFile((await file.path())!, 'utf8'))
  expect(backup.persistedSource.active.head.version).toBe(99)
})
