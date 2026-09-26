import { expect, test } from '@playwright/test'
import { concepts, getConcept, learningPaths } from '../src/features/learning/catalog'
import { conceptBodies } from '../src/features/learning/content'
import { practiceCatalog } from '../src/features/practice/catalog'

test.use({ actionTimeout: 15000 })

test('opens knowledge from Practice, searches concepts, and reads explanations without fake Lab links', async ({ page }) => {
  await page.goto('/practice')
  await page.getByRole('link', { name: '基础知识', exact: true }).click()
  await expect(page).toHaveURL(/\/learn$/)
  await expect(page.getByTestId('concept-count')).toHaveText(`${concepts.length} 篇讲解`)
  await expect(page.getByRole('link', { name: /^阅读：/ })).toHaveCount(concepts.length)
  const search = page.getByRole('searchbox', { name: '搜索基础概念', exact: true })
  await search.fill('Heartbeat')
  await expect(page.getByRole('link', { name: '阅读：Heartbeat 与故障怀疑', exact: true })).toBeVisible()
  await search.fill('IDEMPOTENCY')
  const link = page.getByRole('link', { name: '阅读：幂等与重复业务效果', exact: true })
  await link.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/learn\/idempotency$/)
  await expect(page.getByRole('heading', { level: 1, name: '幂等与重复业务效果', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '一个最小例子', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '保证成立的条件', exact: true })).toBeVisible()
  await expect(page.getByText(conceptBodies.idempotency!.check.answer, { exact: true })).toBeHidden()
  await page.getByText('展开参考解释', { exact: true }).click()
  await expect(page.getByText(conceptBodies.idempotency!.check.answer, { exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: '相关实验', exact: true })).toContainText('可运行 Lab')
  await expect(page.locator('a[href="/practice/retry-idempotency"]')).toHaveCount(1)
  await expect(page.getByRole('region', { name: '应用案例', exact: true })).toContainText('设计题待实现')
  await expect(page.getByRole('link', { name: '本地事务与 ACID', exact: true })).toBeVisible()
  await page.goto('/learn/heartbeat')
  await expect(page.getByRole('region', { name: '相关实验', exact: true })).toContainText('可运行 Lab')
  await expect(page.locator('a[href="/practice/heartbeat"]')).toHaveCount(1)
})

test('every published concept renders its body and unknown concepts return 404', async ({ page }) => {
  test.setTimeout(90000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  for (const concept of concepts) {
    const response = await page.goto(`/learn/${concept.id}`)
    expect(response?.status()).toBe(200)
    await expect(page.getByRole('heading', { name: concept.title, exact: true, level: 1 })).toBeVisible()
    await expect(page.locator('article')).toContainText(conceptBodies[concept.id]!.counterexample)
    await expect(page.locator('article a[target="_blank"]').first()).toHaveAttribute('href', /^https:\/\//)
  }
  const missing = await page.goto('/learn/not-a-published-concept')
  expect(missing?.status()).toBe(404)
  expect(errors).toEqual([])
})

test('navigates learning paths, filters by group, and keeps the reading layout usable on mobile', async ({ page }) => {
  for (const path of learningPaths) {
    await page.goto(`/learn?path=${path.id}`)
    await expect(page.getByRole('region', { name: `${path.title}学习顺序`, exact: true })).toBeVisible()
    const expected = new Set(path.steps.flatMap((step) => step.conceptIds)).size
    await expect(page.getByTestId('concept-count')).toHaveText(`${expected} 篇讲解`)
  }
  await page.goto('/learn')
  await page.getByRole('combobox', { name: '按知识组筛选', exact: true }).selectOption('coordination')
  await expect(page.getByRole('link', { name: /^阅读：/ })).toHaveCount(3)
  await page.getByRole('searchbox', { name: '搜索基础概念', exact: true }).fill('no-match-123')
  await expect(page.getByRole('heading', { name: '没有找到匹配的概念', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '清除筛选', exact: true }).click()
  await expect(page.getByTestId('concept-count')).toHaveText(`${concepts.length} 篇讲解`)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.locator('main').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/learning-index-mobile.png' })
  await page.goto('/learn/heartbeat')
  await expect(page.getByRole('heading', { level: 1, name: 'Heartbeat 与故障怀疑', exact: true })).toBeVisible()
  expect(await page.locator('main').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.getByText('展开参考解释', { exact: true }).click()
  await expect(page.getByText(conceptBodies.heartbeat!.check.answer, { exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/learning-article-mobile.png' })
})

test('links all existing Labs back to canonical concepts and preserves simulation attempts through reading', async ({ page }) => {
  test.setTimeout(90000)
  for (const lab of practiceCatalog) {
    await page.goto(`/practice/${lab.id}`)
    const concept = getConcept(lab.conceptIds[0]!)!
    await page.getByRole('region', { name: '本题相关基础知识', exact: true }).getByRole('link', { name: `${concept.title} ↗`, exact: true }).click()
    await expect(page).toHaveURL(`/learn/${concept.id}`)
    await expect(page.locator(`#labs a[href="/practice/${lab.id}"]`)).toBeVisible()
  }
  await page.goto('/learn/capacity-and-queues')
  await page.locator('#labs a[href="/practice/service-queue-replicas"]').click()
  await page.getByRole('button', { name: '3 个副本', exact: true }).click()
  await page.getByRole('button', { name: '运行并检查', exact: true }).click()
  await expect(page.getByTestId('exercise-feedback')).toContainText('目标已达成')
  await expect(page.getByTestId('exercise-attempts')).toContainText('3 个副本')
  await page.getByRole('region', { name: '本题相关基础知识', exact: true }).getByRole('link', { name: '容量、排队与瓶颈 ↗', exact: true }).click()
  await page.locator('#labs a[href="/practice/service-queue-replicas"]').click()
  await expect(page.getByRole('button', { name: '3 个副本', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('exercise-feedback')).toContainText('已恢复上次保存的运行证据')
  await expect(page.getByTestId('exercise-attempts')).toContainText('3 个副本')
})
