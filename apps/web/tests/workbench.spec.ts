import { expect, test } from '@playwright/test'

test('starts blank and rejects an unconnected design', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Start with an empty canvas')).toBeVisible()
  await expect(page.getByText('0 components')).toBeVisible()
  await page.getByRole('button', { name: 'Run simulation' }).click()
  await expect(page.locator('.error-toast')).toContainText('Add at least one enabled component')
})

test('runs the direct and async examples through the worker', async ({ page }) => {
  await page.goto('/')
  const loadExample = page.getByRole('button', { name: 'Load example' })
  await loadExample.click()
  await page.getByRole('button', { name: /Direct service/ }).click()
  await expect(page.getByText('4 components')).toBeVisible()
  await page.getByRole('button', { name: 'Run simulation' }).click()
  await expect(page.getByText('Throughput over virtual time')).toBeVisible({ timeout: 15_000 })
  const directThroughput = await page.locator('.metrics-grid > div').first().locator('strong').innerText()
  expect(Number.parseFloat(directThroughput)).toBeGreaterThan(0)

  await loadExample.click()
  await page.getByRole('button', { name: /Async pipeline/ }).click()
  await expect(page.getByText('5 components')).toBeVisible()
  await page.getByRole('button', { name: 'Run simulation' }).click()
  await expect(page.getByText('Throughput over virtual time')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('table').getByText('Queue', { exact: true })).toBeVisible()
})
