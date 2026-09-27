import { expect, test } from '@playwright/test'
import { legacyDesigns, legacyEvaluation } from '../src/features/design/compat/v1/attempt'

test('restores an existing v1 product attempt without rewriting it, then saves semantic v2 evidence', async ({ page }) => {
  const design = legacyDesigns.find(d => d.id === 'design-maps')!
  const draft = { scenario: design.scenarios[0]!.id, config: design.alternatives[0]!.config, commands: [...design.scenarios[0]!.script], prediction: '', answers: {}, reflection: '' }
  const result = design.run(draft.config, draft.commands)
  const attempt = { id: 'retained-product-v1', exerciseId: design.id, exerciseVersion: 1, createdAt: 100, draft, result, evaluation: legacyEvaluation(design.id, draft, result) }
  await page.goto('/practice')
  await page.evaluate(async ({ draft, attempt }) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('system-design-algorithm-labs', 20)
      request.onupgradeneeded = () => {
        for (const name of ['sessions', 'drafts']) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: 'scope' })
        if (!request.result.objectStoreNames.contains('attempts')) request.result.createObjectStore('attempts', { keyPath: 'id' }).createIndex('scope', 'scope')
      }
      request.onsuccess = () => {
        const db = request.result; const tx = db.transaction(['drafts', 'attempts'], 'readwrite')
        tx.objectStore('drafts').put({ scope: 'design-maps:v1', version: 1, draft, activeAttemptId: attempt.id })
        tx.objectStore('attempts').put({ scope: 'design-maps:v1', id: attempt.id, attempt })
        tx.oncomplete = () => { db.close(); resolve() }; tx.onerror = () => reject(tx.error)
      }
      request.onerror = () => reject(request.error)
    })
  }, { draft, attempt })
  await page.goto('/practice/design-maps')
  await expect(page.getByTestId('product-progress')).toContainText('1 / 4')
  await expect(page.getByTestId('product-feedback')).toContainText('本关设计验证通过')
  await page.getByTestId('product-history').locator('summary').click()
  await expect(page.getByTestId('product-history')).toContainText('旧格式记录')
  await page.getByRole('button', { name: '核验并保存设计', exact: true }).click()
  await expect(page.getByTestId('product-save-status')).toHaveText('当前操作已保存')
  await page.reload()
  await expect(page.getByTestId('product-history').locator('details')).toHaveCount(2)
  const records = await page.evaluate(() => new Promise<unknown[]>((resolve, reject) => {
    const request = indexedDB.open('system-design-algorithm-labs')
    request.onsuccess = () => { const db = request.result; const tx = db.transaction('attempts'); const read = tx.objectStore('attempts').getAll(); read.onsuccess = () => { db.close(); resolve(read.result.map((r: { attempt: unknown }) => r.attempt)) }; read.onerror = () => reject(read.error) }
  }))
  expect(records).toContainEqual(attempt)
  const current = records.find(r => (r as { formatVersion?: number }).formatVersion === 2) as { result: object }
  expect(current.result).toHaveProperty('state')
  expect(current.result).not.toHaveProperty('tables')
})
