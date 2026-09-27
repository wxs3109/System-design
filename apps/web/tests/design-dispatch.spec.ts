import { expect, test } from '@playwright/test'

test('reproduces double dispatch and validates competition, stale positions, lease and retry guards', async ({ page }) => {
  await page.goto('/practice/design-dispatch')
  await expect(page.getByRole('button', { name: '执行本关场景', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '执行本关场景', exact: true }).click()
  await page.getByRole('button', { name: '核验并保存设计', exact: true }).click()
  await expect(page.getByTestId('product-feedback')).toContainText('本关目标尚未满足')
  await page.getByLabel('位置新鲜度', { exact: true }).selectOption('1000')
  await page.getByLabel('司机预占', { exact: true }).selectOption('cas')
  await page.getByLabel('确认时所有权检查', { exact: true }).selectOption('check')
  await page.getByLabel('匹配确认幂等', { exact: true }).selectOption('trip')
  for (const name of ['两个乘客竞争同一司机', '司机移动与旧位置', '过期 Offer 迟到确认', '匹配确认重试']) {
    await page.getByRole('button', { name, exact: true }).click()
    await page.getByRole('button', { name: '执行本关场景', exact: true }).click()
    await page.getByRole('button', { name: '核验并保存设计', exact: true }).click()
    await expect(page.getByTestId('product-feedback')).toContainText('本关设计验证通过')
  }
  await expect(page.getByRole('table', { name: '实际指派账本', exact: true }).locator('tbody tr')).toHaveCount(1)
  await expect(page.getByTestId('product-save-status')).toHaveText('当前操作已保存')
  await page.reload()
  await expect(page.getByTestId('product-progress')).toContainText('4 / 4')
  await expect(page.getByTestId('product-feedback')).toContainText('本关设计验证通过')
  await page.getByRole('link', { name: 'Lease 与 Fencing →', exact: true }).click()
  await expect(page).toHaveURL(/\/practice\/lease-fencing$/)
})
