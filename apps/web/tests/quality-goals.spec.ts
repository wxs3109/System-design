import { expect, test, type Page } from '@playwright/test'

async function runExample(page: Page) { await page.getByRole('button', { name: '运行完整实验示例', exact: true }).click() }
async function answer(page: Page, good: number, reason: string) {
  await page.getByLabel('实验预测', { exact: true }).selectOption('unknown')
  await page.getByLabel('本次请求数', { exact: true }).fill('4')
  await page.getByLabel('满足请求合同的次数', { exact: true }).fill(String(good))
  await page.getByLabel('已确认但缺失的记录数', { exact: true }).fill('0')
  await page.getByLabel('本关保证成立的原因', { exact: true }).selectOption(reason)
  await page.getByRole('button', { name: '核对并保存实验', exact: true }).click()
  await expect(page.getByTestId('experiment-feedback')).toContainText('本关实验验证通过')
  await expect(page.getByTestId('experiment-save-status')).toHaveText('当前操作已保存')
}

test('learns quality goals from the foundation path and verifies different guarantees through actual failures', async ({ page }) => {
  await page.goto('/practice')
  await page.getByRole('link', { name: /从基础设计决策开始/ }).click()
  const path = page.getByRole('region', { name: '基础设计决策学习顺序', exact: true })
  await path.getByRole('link', { name: '把可靠、可用和持久变成明确目标', exact: true }).click()
  await expect(page.getByRole('region', { name: '从需求选择机制', exact: true })).toContainText('稳定提交边界')
  await expect(page.getByRole('region', { name: '应用案例', exact: true })).toHaveCount(0)
  await page.locator('#labs a[href="/practice/quality-goals"]').click()
  await expect(page.getByTestId('experiment-save-status')).toHaveText('当前操作已保存')
  await expect(page.getByTestId('quality-good')).toHaveText('0 / 0')
  await runExample(page); await expect(page.getByTestId('quality-good')).toHaveText('2 / 4')
  await page.getByRole('button', { name: '核对并保存实验', exact: true }).click()
  await expect(page.getByTestId('experiment-feedback')).toContainText('运行目标尚未满足')
  await page.getByLabel('目标实验服务实例数').selectOption('2'); await runExample(page)
  await expect(page.getByTestId('quality-good')).toHaveText('2 / 4')
  await page.getByLabel('目标实验实例放置').selectOption('separate'); await runExample(page)
  await expect(page.getByTestId('quality-good')).toHaveText('4 / 4')
  await answer(page, 4, 'failure-domains')
  await page.getByRole('button', { name: '运行策略对照', exact: true }).click()
  await expect(page.getByRole('row').filter({ hasText: '同域双实例' })).toContainText('2 / 4')

  await page.getByRole('button', { name: '确认以后数据还在', exact: true }).click(); await runExample(page)
  await expect(page.getByTestId('quality-missing')).toHaveText('2')
  await page.getByLabel('目标实验确认边界').selectOption('stable'); await runExample(page)
  await expect(page.getByTestId('quality-missing')).toHaveText('0')
  await expect(page.getByTestId('quality-good')).toHaveText('3 / 4')
  await answer(page, 3, 'commit-boundary')

  await page.getByRole('button', { name: '附加依赖失败', exact: true }).click(); await runExample(page)
  await expect(page.getByTestId('quality-good')).toHaveText('2 / 4')
  await page.getByLabel('目标实验依赖策略').selectOption('degrade'); await runExample(page)
  await expect(page.getByTestId('quality-good')).toHaveText('4 / 4')
  await expect(page.getByTestId('quality-full')).toHaveText('2')
  await answer(page, 4, 'allowed-degradation')
  await expect(page.getByLabel('实验学习进度', { exact: true })).toContainText('3 / 3')
  await page.reload(); await expect(page.getByLabel('实验学习进度', { exact: true })).toContainText('3 / 3')
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.locator('main').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/quality-goals-mobile.png' })
})

test('exposes storage, resource and state decisions as reusable knowledge without pretending pending labs exist', async ({ page }) => {
  for (const [query, id] of [['数据库选型', 'storage-access-patterns'], ['Stateless', 'state-and-scaling'], ['容量估算', 'capacity-estimation'], ['Bandwidth', 'resource-constraints']]) {
    await page.goto('/learn'); await page.getByRole('searchbox', { name: '搜索基础概念' }).fill(query!)
    await page.locator(`a[href="/learn/${id}"]`).click()
    await expect(page.getByRole('region', { name: '从需求选择机制', exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: '相关实验', exact: true })).toContainText('可运行 Lab')
  }
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/learn/storage-access-patterns')
  expect(await page.locator('main').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/foundation-reading-mobile.png' })
})
