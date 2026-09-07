import { expect, test, type Page } from '@playwright/test'
import { parseProjectFile } from '@system-design/model'

const exerciseTitle = '增加副本能否解决排队？'

async function openExercise(page: Page) {
  await expect(page.getByRole('heading', { name: '系统设计练习', level: 1 })).toBeVisible()
  await page.getByRole('link', { name: exerciseTitle, exact: true }).click()
  await expect(page).toHaveURL(/\/practice\/service-queue-replicas$/)
  await expect(page.getByRole('heading', { name: exerciseTitle, level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: '运行并检查', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Clear canvas', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Load example', exact: true })).toHaveCount(0)
  await expect.poll(async () => {
    const canvas = await page.locator('.canvas-stage').boundingBox()
    const node = await page.getByTestId('rf__node-practice-service').boundingBox()
    return !!canvas && !!node && node.width > 100 && node.x >= canvas.x && node.y >= canvas.y + 40 && node.x + node.width <= canvas.x + canvas.width && node.y + node.height <= canvas.y + canvas.height
  }).toBe(true)
}

async function exportProject(page: Page) {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const stream = await (await downloadPromise).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return parseProjectFile(JSON.parse(Buffer.concat(chunks).toString()))
}

test('practices queue capacity with run evidence, persistent attempts, stale feedback and reset', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/practice')
  await openExercise(page)
  const replicaButton = (replicas: number) => page.getByRole('button', { name: `${replicas} 个副本`, exact: true })
  const runButton = page.getByRole('button', { name: '运行并检查', exact: true })
  const feedback = page.getByTestId('exercise-feedback')
  const attempts = page.getByTestId('exercise-attempts')

  await expect(replicaButton(1)).toHaveAttribute('aria-pressed', 'true')
  await runButton.click()
  await expect(feedback).toContainText('继续调整', { timeout: 15_000 })
  const baselineText = await feedback.innerText()
  const baselineQueue = baselineText.match(/采样队列最大\s+([\d,]+)/)
  expect(baselineQueue, 'Baseline feedback must expose the measured arrival-window queue').not.toBeNull()
  expect(Number(baselineQueue![1]!.replaceAll(',', ''))).toBeGreaterThan(0)
  await expect(attempts).toContainText('1 个副本')

  await replicaButton(3).click()
  await expect(replicaButton(3)).toHaveAttribute('aria-pressed', 'true')
  await expect(feedback).toContainText('有未运行的修改')
  await runButton.click()
  await expect(feedback).toContainText('目标已达成', { timeout: 15_000 })
  await expect(attempts).toContainText('3 个副本')

  await page.reload()
  await expect(replicaButton(3)).toHaveAttribute('aria-pressed', 'true')
  await expect(attempts).toContainText('1 个副本')
  await expect(attempts).toContainText('3 个副本')
  const priorSuccessfulAttempts = ((await attempts.innerText()).match(/3 个副本/g) ?? []).length
  await expect(feedback).toContainText('已恢复上次保存的运行证据')
  await expect(page.getByText('No simulation yet', { exact: true })).toHaveCount(0)
  await expect(runButton).toBeEnabled()
  await runButton.click()
  await expect.poll(async () => ((await attempts.innerText()).match(/3 个副本/g) ?? []).length, { timeout: 15_000 }).toBe(priorSuccessfulAttempts + 1)
  await expect(feedback).toContainText('目标已达成')

  await replicaButton(2).click()
  await expect(replicaButton(2)).toHaveAttribute('aria-pressed', 'true')
  await expect(replicaButton(3)).toHaveAttribute('aria-pressed', 'false')
  await expect(feedback).toContainText('有未运行的修改')
  await expect(feedback).not.toContainText('目标已达成')

  await page.getByRole('button', { name: '重新开始', exact: true }).click()
  await expect(replicaButton(1)).toHaveAttribute('aria-pressed', 'true')
  await expect(replicaButton(2)).toHaveAttribute('aria-pressed', 'false')
  await expect(feedback).not.toContainText('目标已达成')
})

test('keeps the free-workbench project intact while navigating to and running a practice attempt', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/')
  const examplePicker = page.getByRole('button', { name: 'Load example', exact: true })
  await expect.poll(async () => {
    if (await examplePicker.getAttribute('aria-expanded') !== 'true') await examplePicker.click()
    return examplePicker.getAttribute('aria-expanded')
  }).toBe('true')
  await page.getByRole('button', { name: /Direct service/ }).click()
  await expect(page.getByTestId('rf__node-service-direct')).toBeVisible()
  await expect(page.locator('.react-flow__node')).toHaveCount(4)

  const historyButton = page.getByRole('button', { name: 'History', exact: true })
  await historyButton.click()
  const history = page.getByRole('dialog', { name: 'Local project history' })
  await expect(history.getByRole('button').filter({ hasText: 'Direct service' }).filter({ hasText: 'autosave ·' }).first()).toBeVisible()
  await historyButton.click()
  const originalProject = await exportProject(page)
  expect(originalProject.name).toBe('Direct service')

  await page.getByRole('link', { name: 'Practice →', exact: true }).click()
  await expect(page).toHaveURL(/\/practice$/)
  await openExercise(page)
  await page.getByRole('button', { name: '3 个副本', exact: true }).click()
  await page.getByRole('button', { name: '运行并检查', exact: true }).click()
  await expect(page.getByTestId('exercise-feedback')).toContainText('目标已达成', { timeout: 15_000 })
  await expect(page.getByTestId('exercise-attempts')).toContainText('3 个副本')

  await page.getByRole('link', { name: '自由工作台', exact: true }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByTestId('rf__node-service-direct')).toBeVisible()
  await expect(page.locator('.react-flow__node')).toHaveCount(4)
  await expect(page.getByRole('button', { name: 'Run simulation', exact: true })).toBeEnabled()
  expect(await exportProject(page)).toEqual(originalProject)
  await expect(page.getByTestId('rf__node-practice-service')).toHaveCount(0)
})

test('keeps the exercise topology inside a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/practice/service-queue-replicas')
  await expect(page.getByRole('button', { name: '运行并检查', exact: true })).toBeEnabled()
  await page.locator('.canvas-stage').scrollIntoViewIfNeeded()
  await expect.poll(async () => {
    const canvas = await page.locator('.canvas-stage').boundingBox()
    const nodes = await Promise.all(['practice-traffic', 'practice-service'].map((id) => page.getByTestId(`rf__node-${id}`).boundingBox()))
    return !!canvas && nodes.every((node) => node && node.width > 80 && node.x >= canvas.x && node.x + node.width <= canvas.x + canvas.width)
  }).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
