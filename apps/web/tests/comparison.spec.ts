import { expect, test } from '@playwright/test'

test('compares two topology revisions under one immutable experiment', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Load example' }).click()
  await page.getByRole('button', { name: /Direct service/ }).click()

  await page.getByRole('button', { name: 'Run simulation' }).click()
  await expect(page.getByRole('tab', { name: /Compare runs 1/ })).toBeVisible({ timeout: 15_000 })

  await page.getByTestId('rf__node-service-direct').dispatchEvent('click')
  await page.getByLabel('Replicas').fill('4')
  await page.getByRole('button', { name: 'Run simulation' }).click()
  const compareTab = page.getByRole('tab', { name: /Compare runs 2/ })
  await expect(compareTab).toBeVisible({ timeout: 15_000 })
  await compareTab.click()

  const comparison = page.getByRole('region', { name: 'Baseline and candidate run comparison' })
  await expect(comparison).toContainText('Same experiment verified')
  await expect(comparison.getByRole('columnheader', { name: 'Candidate − baseline' })).toBeVisible()
  await expect(comparison.getByRole('cell', { name: 'P95 latency' })).toBeVisible()
  await expect(comparison.getByRole('img', { name: /Aligned baseline, candidate and Throughput delta/ })).toBeVisible()

  await comparison.getByLabel('Comparison chart metric').selectOption('latencyP95Ms')
  await expect(comparison.getByRole('img', { name: /P95 latency delta/ })).toBeVisible()

  await page.getByRole('tab', { name: 'Run details' }).click()
  await page.getByLabel('Random seed').fill('different-experiment-seed')
  await page.getByRole('button', { name: 'Run simulation' }).click()
  const compareThreeRuns = page.getByRole('tab', { name: /Compare runs 3/ })
  await expect(compareThreeRuns).toBeVisible({ timeout: 15_000 })
  await compareThreeRuns.click()
  await expect(page.getByRole('region', { name: 'Baseline and candidate run comparison' }).getByRole('alert')).toContainText('Random seeds differ.')
})
