import { expect, test } from '@playwright/test'
import { experiments } from '../src/experiments/registry'

test('every registered experiment loads its renderer and unknown IDs return 404', async ({ page }) => {
  test.setTimeout(120000)
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  for (const entry of experiments.entries) {
    const response = await page.goto(`/practice/${entry.metadata.id}`)
    expect(response?.status()).toBe(200)
    await expect(page.getByRole('heading', { level: 1, name: entry.metadata.title, exact: true })).toBeVisible()
  }
  expect((await page.goto('/practice/unregistered-experiment'))?.status()).toBe(404)
  expect(errors).toEqual([])
})
