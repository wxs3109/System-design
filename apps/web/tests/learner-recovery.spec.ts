import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { initialDraft } from '../src/features/practice/concurrent-update/lesson'
test.use({ actionTimeout: 15000 })
const click = (p: Page, name: string) => p.getByRole('button', { name, exact: true }).click()
const saved = (p: Page) => expect(p.getByTestId('experiment-save-status')).toHaveText('当前操作已保存')
async function open(p: Page, id = 'concurrent-update') { await p.goto(`/practice/${id}`); await saved(p) }
async function stored(p: Page) {
  return p.evaluate(() => new Promise<{ version: number; revision?: number; draft: { commands: unknown[] } }>((resolve, reject) => {
    const request = indexedDB.open('system-design-algorithm-labs')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => { const db = request.result; const tx = db.transaction('drafts'); const get = tx.objectStore('drafts').get('concurrent-update:v1'); get.onsuccess = () => resolve(get.result); get.onerror = () => reject(get.error); tx.oncomplete = () => db.close() }
  }))
}

test('an unsupported saved version cannot be erased by retry or editing', async ({ page }) => {
  await open(page); await click(page, '读取 A'); await saved(page)
  const original = await stored(page)
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('system-design-algorithm-labs'); request.onerror = () => reject(request.error)
    request.onsuccess = () => { const db = request.result; const tx = db.transaction('drafts', 'readwrite'); const store = tx.objectStore('drafts'); const get = store.get('concurrent-update:v1'); get.onsuccess = () => store.put({ ...get.result, version: 99 }); tx.oncomplete = () => { db.close(); resolve() }; tx.onerror = () => reject(tx.error) }
  }))
  await page.reload()
  await expect(page.locator('main').getByRole('alert')).toContainText('版本未知')
  await expect(page.getByRole('button', { name: '读取 A', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '重试保存实验', exact: true })).toHaveCount(0)
  await click(page, '重试读取记录')
  await expect(page.getByTestId('experiment-save-status')).toHaveText('读取失败 · 原记录已保留')
  expect(await stored(page)).toEqual({ ...original, version: 99 })
})

test('a temporary read failure retries recovery and brings back the original work', async ({ page }) => {
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.get
    IDBObjectStore.prototype.get = function (...args: Parameters<typeof original>) {
      if (this.name === 'drafts' && sessionStorage.getItem('failLabReads') === 'yes') throw new DOMException('temporary read unavailable', 'UnknownError')
      return original.apply(this, args)
    }
  })
  await open(page); await click(page, '读取 A'); await saved(page)
  await page.evaluate(() => sessionStorage.setItem('failLabReads', 'yes')); await page.reload()
  await expect(page.getByTestId('experiment-save-status')).toHaveText('读取失败 · 原记录已保留')
  await expect(page.getByRole('button', { name: '读取 B', exact: true })).toBeDisabled()
  await page.evaluate(() => sessionStorage.removeItem('failLabReads')); await click(page, '重试读取记录'); await saved(page)
  await expect(page.getByTestId('concurrent-A')).toHaveText('已有本地快照')
  expect((await stored(page)).draft.commands).toEqual([{ type: 'read', worker: 'A' }])
  await click(page, '提交 A'); await expect(page.getByTestId('concurrent-reservations')).toHaveText('1')
})

test('two tabs cannot silently overwrite each other and the unsaved branch can be exported', async ({ page, context }) => {
  test.setTimeout(60000)
  const other = await context.newPage()
  await open(page); await open(other)
  await click(page, '读取 A'); await saved(page)
  await click(other, '读取 B')
  await expect(other.getByTestId('experiment-save-status')).toHaveText('其他标签页已更新 · 本页未保存')
  await expect(other.locator('main').getByRole('alert')).toContainText('未覆盖已保存的记录')
  expect((await stored(page)).draft.commands).toEqual([{ type: 'read', worker: 'A' }])
  await expect(other.getByTestId('concurrent-B')).toHaveText('已有本地快照')
  await expect(other.getByRole('button', { name: '提交 B', exact: true })).toBeDisabled()
  await other.setViewportSize({ width: 390, height: 844 })
  expect(await other.locator('main').evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true)
  await other.screenshot({ path: 'test-results/learner-storage-conflict-mobile.png' })
  const downloadEvent = other.waitForEvent('download'); await click(other, '导出本页记录'); const download = await downloadEvent
  const backup = JSON.parse(await readFile((await download.path())!, 'utf8'))
  expect(backup).toMatchObject({ format: 'system-design-lab-recovery', scope: 'concurrent-update:v1', draft: { commands: [{ type: 'read', worker: 'B' }] } })
  await click(other, '舍弃本页未保存修改并重新读取'); await saved(other)
  await expect(other.getByTestId('concurrent-A')).toHaveText('已有本地快照'); await expect(other.getByTestId('concurrent-B')).toHaveText('等待读取')
  await click(other, '读取 B'); await saved(other)
  expect((await stored(page)).draft.commands).toEqual([{ type: 'read', worker: 'A' }, { type: 'read', worker: 'B' }])
  await page.reload(); await saved(page); await expect(page.getByTestId('concurrent-B')).toHaveText('已有本地快照')
  await other.close()
})

test('existing version-one browser records migrate intact before the learner continues', async ({ page }) => {
  await page.goto('/learn')
  const draft = initialDraft(); draft.commands = [{ type: 'read', worker: 'A' }]
  await page.evaluate((draft) => new Promise<void>((resolve, reject) => {
    // Dexie 1 maps to IndexedDB version 10. This is the previous production schema.
    const request = indexedDB.open('system-design-algorithm-labs', 10)
    request.onupgradeneeded = () => { const db = request.result; db.createObjectStore('sessions', { keyPath: 'scope' }); const attempts = db.createObjectStore('attempts', { keyPath: 'id' }); attempts.createIndex('scope', 'scope') }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => { const db = request.result; const tx = db.transaction('sessions', 'readwrite'); tx.objectStore('sessions').put({ scope: 'concurrent-update:v1', version: 1, draft, activeAttemptId: null }); tx.oncomplete = () => { db.close(); resolve() }; tx.onerror = () => reject(tx.error) }
  }), draft)
  await open(page)
  await expect(page.getByTestId('concurrent-A')).toHaveText('已有本地快照')
  expect((await stored(page)).draft.commands).toEqual(draft.commands)
  await click(page, '读取 B'); await saved(page)
  expect((await stored(page)).draft.commands).toEqual([...draft.commands, { type: 'read', worker: 'B' }])
})

test('switching a five-node Raft experiment to three nodes resets removed selections', async ({ page }) => {
  await open(page, 'raft-consensus')
  await page.getByRole('combobox', { name: 'Raft 节点数', exact: true }).selectOption('5')
  await page.getByRole('combobox', { name: 'Raft 发送节点', exact: true }).selectOption('D')
  await page.getByRole('combobox', { name: 'Raft 复制目标', exact: true }).selectOption('E')
  await page.getByRole('combobox', { name: 'Raft 节点数', exact: true }).selectOption('3')
  await click(page, '运行完整实验示例')
  await expect(page.getByRole('combobox', { name: 'Raft 发送节点', exact: true })).toHaveValue('A')
  await expect(page.getByRole('combobox', { name: 'Raft 复制目标', exact: true })).toHaveValue('B')
  await expect(page.getByTestId('raft-role-A')).toHaveText('leader')
  await expect(page.getByRole('button', { name: '追加并发送提案', exact: true })).toBeEnabled()
  await page.getByRole('textbox', { name: 'Raft 提案值', exact: true }).fill('v2'); await click(page, '追加并发送提案')
  await expect(page.getByTestId('raft-log-A')).toContainText('v2')
})

test('a learner can read a concept, validate a lab, and continue after navigating and refreshing', async ({ page }) => {
  test.setTimeout(60000)
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/practice'); await page.getByRole('link', { name: '基础知识', exact: true }).click()
  await page.getByRole('searchbox', { name: '搜索基础概念', exact: true }).fill('heartbeat')
  await page.getByRole('link', { name: '阅读：Heartbeat 与故障怀疑', exact: true }).click()
  await page.locator('#labs a[href="/practice/heartbeat"]').click()
  await click(page, '运行完整协调故障示例')
  await page.getByRole('combobox', { name: '协调实验预测', exact: true }).selectOption('uncertain')
  await page.getByRole('combobox', { name: '观察者判断作答', exact: true }).selectOption('suspected')
  await page.getByRole('combobox', { name: '真实状态作答', exact: true }).selectOption('paused')
  await page.getByRole('combobox', { name: '协调边界解释', exact: true }).selectOption('observation-not-proof')
  await click(page, '核对并保存协调结果'); await expect(page.getByTestId('coordination-save-status')).toHaveText('当前操作已保存')
  await page.getByRole('link', { name: '相关原理', exact: true }).click(); await page.locator('#labs a[href="/practice/heartbeat"]').click()
  await expect(page.getByTestId('coordination-feedback')).toContainText('本关协调验证通过')
  await click(page, '网络分区'); await click(page, '发送 A 心跳'); await click(page, '分区 A')
  await expect(page.getByTestId('coordination-save-status')).toHaveText('当前操作已保存'); await page.reload()
  await expect(page.getByRole('button', { name: '连通 A', exact: true })).toBeEnabled()
  await expect(page.getByTestId('coordination-history').locator('details')).toHaveCount(1)
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.locator('main').evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true)
  expect(errors).toEqual([])
})
