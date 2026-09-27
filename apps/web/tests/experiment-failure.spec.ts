import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

test('retains an unsaved lab draft across a rendering failure, export and retry', async ({ page }) => {
  await page.addInitScript(() => {
    const format = Date.prototype.toLocaleString
    Date.prototype.toLocaleString = function (...args) { if (sessionStorage.getItem('failRender') === 'yes') throw new Error('test rendering failure'); return format.apply(this, args) }
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) { if (this.name === 'drafts' && sessionStorage.getItem('failWrites') === 'yes') throw new DOMException('test quota failure', 'QuotaExceededError'); return put.apply(this, args) }
  })
  await page.goto('/practice/concurrent-update')
  await expect(page.getByTestId('experiment-save-status')).toHaveText('当前操作已保存')
  await page.getByRole('button', { name: '读取 A', exact: true }).click()
  await page.getByRole('button', { name: '核对并保存实验', exact: true }).click()
  await expect(page.getByTestId('experiment-save-status')).toHaveText('当前操作已保存')
  await page.evaluate(() => { sessionStorage.setItem('failWrites', 'yes'); sessionStorage.setItem('failRender', 'yes') })
  const reflection = page.getByRole('textbox', { name: /复盘/ })
  await reflection.fill('keep my unsaved reasoning')
  await expect(page.getByRole('heading', { name: '实验暂时无法显示' })).toBeVisible()
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: '导出实验输入', exact: true }).click()
  const file = await downloading; const backup = JSON.parse(await readFile((await file.path())!, 'utf8'))
  expect(backup.draft.reflection).toBe('keep my unsaved reasoning')
  await page.evaluate(() => sessionStorage.removeItem('failRender'))
  await page.getByRole('button', { name: '保留输入并重试显示' }).click()
  await expect(reflection).toHaveValue('keep my unsaved reasoning')
  await page.evaluate(() => sessionStorage.removeItem('failWrites'))
  await page.getByRole('button', { name: '重试保存实验', exact: true }).click()
  await expect(page.getByTestId('experiment-save-status')).toHaveText('当前操作已保存')
  await page.reload(); await expect(reflection).toHaveValue('keep my unsaved reasoning')
})

test('keeps Hot Key responsive when a worker hangs, cancels it, and recovers after timeout', async ({ page }) => {
  await page.addInitScript(() => {
    const Original = window.Worker
    window.Worker = class extends Original {
      override postMessage(value: unknown, options?: StructuredSerializeOptions) {
        if (sessionStorage.getItem('hangHotWorker') === 'yes' && (value as { operation?: string }).operation === 'run') return
        super.postMessage(value, options)
      }
    }
  })
  await page.goto('/practice/hot-key')
  await expect(page.getByTestId('hot-save-status')).toHaveText('已保存到此浏览器')
  await page.getByRole('combobox', { name: '热点实验预测', exact: true }).selectOption('balanced')
  await page.evaluate(() => sessionStorage.setItem('hangHotWorker', 'yes'))
  await page.getByRole('button', { name: '运行热点实验', exact: true }).click()
  await page.getByRole('textbox', { name: '热点复盘', exact: true }).fill('UI remains editable')
  await expect(page.getByRole('button', { name: '取消实验计算' })).toHaveCount(0)
  await page.getByRole('button', { name: '运行热点实验', exact: true }).click()
  await expect(page.getByText('实验计算超过时间预算，已停止；输入保留，可以减少数据后重试。')).toBeVisible({ timeout: 8000 })
  await expect(page.getByRole('textbox', { name: '热点复盘', exact: true })).toHaveValue('UI remains editable')
  await page.evaluate(() => sessionStorage.removeItem('hangHotWorker'))
  await page.getByRole('button', { name: '重试实验计算' }).click()
  await expect(page.getByTestId('hot-backend-count')).toHaveText('10,000')
  await expect(page.getByTestId('hot-save-status')).toHaveText('已保存到此浏览器')
})

test('a workbench rendering retry preserves a project whose autosave failed', async ({ page }) => {
  await page.addInitScript(() => {
    const format = Date.prototype.toLocaleString
    Date.prototype.toLocaleString = function (...args) { if (sessionStorage.getItem('failCanvasRender') === 'yes') throw new Error('test canvas rendering failure'); return format.apply(this, args) }
    const add = IDBObjectStore.prototype.add
    IDBObjectStore.prototype.add = function (...args: Parameters<typeof add>) { if (this.name === 'projectRevisions' && sessionStorage.getItem('failCanvasWrites') === 'yes') throw new DOMException('test canvas quota', 'QuotaExceededError'); return add.apply(this, args) }
  })
  await page.goto('/'); await expect(page.getByTestId('workbench-editing-surface')).not.toHaveAttribute('inert')
  await page.getByRole('button', { name: 'Load example', exact: true }).click(); await page.getByRole('button', { name: /^Direct service/ }).click()
  await page.getByRole('button', { name: 'History', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Local project history' })).toContainText('Direct service')
  await page.getByRole('button', { name: 'History', exact: true }).click()
  await page.getByTestId('rf__node-service-direct').click()
  await page.evaluate(() => sessionStorage.setItem('failCanvasWrites', 'yes'))
  await page.getByLabel('Name', { exact: true }).fill('unsaved canvas input')
  await expect(page.locator('.workbench-storage-banner')).toContainText('test canvas quota')
  await page.evaluate(() => sessionStorage.setItem('failCanvasRender', 'yes'))
  await page.getByRole('button', { name: 'History', exact: true }).click()
  await expect(page.getByRole('heading', { name: '实验暂时无法显示' })).toBeVisible()
  await page.evaluate(() => sessionStorage.removeItem('failCanvasRender'))
  await page.getByRole('button', { name: '保留输入并重试显示' }).click()
  await expect(page.getByTestId('rf__node-service-direct')).toContainText('unsaved canvas input')
  await expect(page.locator('.workbench-storage-banner')).toContainText('test canvas quota')
  await page.evaluate(() => sessionStorage.removeItem('failCanvasWrites'))
  await page.getByRole('button', { name: '重试保存工作台', exact: true }).click()
  await expect(page.locator('.workbench-storage-banner')).toHaveCount(0)
  await page.reload(); await expect(page.getByTestId('rf__node-service-direct')).toContainText('unsaved canvas input')
})
