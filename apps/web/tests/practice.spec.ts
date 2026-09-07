import { expect, test, type Page } from '@playwright/test'
import { parseProjectFile } from '@system-design/model'
import { databaseBottleneckExercise } from '../src/features/practice/database-bottleneck'
import { cachePressureExercise } from '../src/features/practice/cache-pressure'
import type { ExerciseDefinition } from '../src/features/practice/exercise-types'

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

async function openDefinedExercise(page: Page, exercise: ExerciseDefinition) {
  await expect(page.getByRole('heading', { name: '系统设计练习', level: 1 })).toBeVisible()
  const card = page.getByRole('link', { name: exercise.title, exact: true })
  await expect(card).toContainText(exercise.category)
  await expect(card).toContainText(exercise.difficulty)
  await expect(card).toContainText(exercise.summary)
  await expect(card).toContainText(`约 ${exercise.estimatedMinutes} 分钟`)
  for (const step of exercise.flow) await expect(card).toContainText(step)
  await card.click()
  await expect(page).toHaveURL(new RegExp(`/practice/${exercise.id}$`))
  await expect(page.getByRole('heading', { name: exercise.title, level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: '运行并检查', exact: true })).toBeEnabled()

  const sidebar = page.getByRole('complementary', { name: '练习任务与反馈' })
  await expect(sidebar).toContainText(exercise.introduction)
  await expect(sidebar).toContainText(exercise.prompt)
  await expect(sidebar).toContainText(exercise.observationNote)
  await expect(sidebar).toContainText(exercise.boundary)
  const givens = page.locator('[aria-label="固定实验条件"] > div')
  await expect(givens).toHaveCount(exercise.givens.length)
  for (const given of exercise.givens) {
    const block = givens.filter({ hasText: given.label })
    await expect(block).toContainText(given.value)
    if (given.unit) await expect(block).toContainText(given.unit)
  }
  for (const objective of exercise.objectives) await expect(sidebar).toContainText(objective)
  for (const parameter of exercise.parameters) {
    const group = page.getByRole('group', { name: parameter.label, exact: true })
    await expect(group.getByRole('button')).toHaveCount(parameter.choices.length)
    for (const choice of parameter.choices) await expect(group.getByRole('button', { name: choice.label, exact: true })).toBeEnabled()
  }
  await sidebar.locator('details > summary').click()
  for (const hint of exercise.hints) await expect(sidebar.getByText(hint, { exact: true })).toBeVisible()
  await sidebar.locator('details > summary').click()
}

function parameterChoice(page: Page, exercise: ExerciseDefinition, parameterId: string, value: number) {
  const parameter = exercise.parameters.find((candidate) => candidate.id === parameterId)!
  const choice = parameter.choices.find((candidate) => candidate.value === value)!
  return page.getByRole('group', { name: parameter.label, exact: true }).getByRole('button', { name: choice.label, exact: true })
}

async function chooseParameter(page: Page, exercise: ExerciseDefinition, parameterId: string, value: number) {
  const button = parameterChoice(page, exercise, parameterId, value)
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
}

async function runDefinedExercise(page: Page, expectedStatus: 'pass' | 'fail') {
  const items = page.getByTestId('exercise-attempts').locator('ol > li')
  const priorCount = await items.count()
  await page.getByRole('button', { name: '运行并检查', exact: true }).click()
  await expect(items).toHaveCount(priorCount + 1, { timeout: 30_000 })
  await expect(page.getByRole('button', { name: '运行并检查', exact: true })).toBeEnabled()
  await expect(page.getByTestId('exercise-feedback')).toContainText(expectedStatus === 'pass' ? '目标已达成' : '继续调整')
}

const metricNumber = (text: string) => Number(text.replaceAll(',', '').match(/[\d]+(?:\.\d+)?/)?.[0])

async function readMetric(page: Page, exercise: ExerciseDefinition, key: string) {
  const display = exercise.resultMetrics.find((metric) => metric.key === key)!
  const value = page.getByTestId('exercise-feedback').getByText(display.label, { exact: true }).first().locator('..').locator('strong')
  await expect(value).not.toHaveText('—')
  return metricNumber(await value.innerText())
}

async function comparisonValues(page: Page, exercise: ExerciseDefinition, key: string) {
  const comparison = page.getByTestId('exercise-comparison')
  await expect(comparison).toContainText('与上次有效运行对比')
  const display = exercise.resultMetrics.find((metric) => metric.key === key)!
  const cells = comparison.locator('tbody tr').filter({ hasText: display.label }).locator('td')
  await expect(cells).toHaveCount(2)
  return (await cells.allInnerTexts()).map(metricNumber)
}

test('locates the database bottleneck, compares actual evidence and accepts multiple connection choices', async ({ page }) => {
  test.setTimeout(90_000)
  const exercise = databaseBottleneckExercise
  const feedback = page.getByTestId('exercise-feedback')
  const attempts = page.getByTestId('exercise-attempts')
  await page.goto('/practice')
  await openDefinedExercise(page, exercise)
  await expect(parameterChoice(page, exercise, 'service-replicas', 1)).toHaveAttribute('aria-pressed', 'true')
  await expect(parameterChoice(page, exercise, 'database-connections', 4)).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('group', { name: cachePressureExercise.parameters[0]!.label, exact: true })).toHaveCount(0)
  await runDefinedExercise(page, 'fail')
  const baselineQueue = await readMetric(page, exercise, 'databaseArrivalMaxQueue')
  const baselineLatency = await readMetric(page, exercise, 'latencyP95Ms')
  expect(baselineQueue).toBeGreaterThan(300)
  expect(await readMetric(page, exercise, 'serviceArrivalMaxQueue')).toBe(0)
  expect(baselineLatency).toBeGreaterThan(1_000)
  await expect(page.getByTestId('exercise-comparison')).toHaveCount(0)

  await chooseParameter(page, exercise, 'service-replicas', 4)
  await expect(feedback).toContainText('有未运行的修改')
  await runDefinedExercise(page, 'fail')
  expect(await readMetric(page, exercise, 'databaseArrivalMaxQueue')).toBe(baselineQueue)
  expect(await readMetric(page, exercise, 'latencyP95Ms')).toBe(baselineLatency)
  expect(await comparisonValues(page, exercise, 'databaseArrivalMaxQueue')).toEqual([baselineQueue, baselineQueue])

  await chooseParameter(page, exercise, 'database-connections', 12)
  await expect(page.getByTestId('exercise-comparison')).toHaveCount(0)
  await runDefinedExercise(page, 'pass')
  expect(await readMetric(page, exercise, 'databaseArrivalMaxQueue')).toBe(0)
  expect(await readMetric(page, exercise, 'latencyP95Ms')).toBe(120)
  expect(await comparisonValues(page, exercise, 'databaseArrivalMaxQueue')).toEqual([baselineQueue, 0])

  await chooseParameter(page, exercise, 'database-connections', 16)
  await expect(feedback).not.toContainText('目标已达成')
  await runDefinedExercise(page, 'pass')
  expect(await comparisonValues(page, exercise, 'databaseArrivalMaxQueue')).toEqual([0, 0])
  await expect(attempts.locator('ol > li')).toHaveCount(4)
  await expect(attempts).toContainText(exercise.parameters[1]!.choices.find((choice) => choice.value === 12)!.label)
  await expect(attempts).toContainText(exercise.parameters[1]!.choices.find((choice) => choice.value === 16)!.label)

  await page.reload()
  await expect(page.getByRole('button', { name: '运行并检查', exact: true })).toBeEnabled()
  await expect(parameterChoice(page, exercise, 'service-replicas', 4)).toHaveAttribute('aria-pressed', 'true')
  await expect(parameterChoice(page, exercise, 'database-connections', 16)).toHaveAttribute('aria-pressed', 'true')
  await expect(feedback).toContainText('目标已达成')
  await expect(feedback).toContainText('已恢复上次保存的运行证据')
  await expect(attempts.locator('ol > li')).toHaveCount(4)
  expect(await readMetric(page, exercise, 'latencyP95Ms')).toBe(120)
})

test('reduces database reads through cache hits and accepts more than one adequate cache size', async ({ page }) => {
  test.setTimeout(90_000)
  const exercise = cachePressureExercise
  const feedback = page.getByTestId('exercise-feedback')
  const attempts = page.getByTestId('exercise-attempts')
  await page.goto('/practice')
  await openDefinedExercise(page, exercise)
  await expect(parameterChoice(page, exercise, 'cache-capacity', 8)).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('group', { name: databaseBottleneckExercise.parameters[0]!.label, exact: true })).toHaveCount(0)
  await runDefinedExercise(page, 'fail')
  const baselineReads = await readMetric(page, exercise, 'databaseReads')
  const baselineHits = await readMetric(page, exercise, 'cacheHitRate')
  expect(baselineReads).toBeGreaterThan(300)
  expect(baselineHits).toBeLessThan(85)
  expect(await readMetric(page, exercise, 'cacheEvictions')).toBeGreaterThan(0)

  await chooseParameter(page, exercise, 'cache-capacity', 64)
  await expect(feedback).toContainText('有未运行的修改')
  await runDefinedExercise(page, 'pass')
  const readsAt64 = await readMetric(page, exercise, 'databaseReads')
  const hitsAt64 = await readMetric(page, exercise, 'cacheHitRate')
  expect(readsAt64).toBeLessThanOrEqual(300)
  expect(readsAt64).toBeGreaterThan(0)
  expect(hitsAt64).toBeGreaterThanOrEqual(85)
  expect(await readMetric(page, exercise, 'cacheEvictions')).toBe(0)
  expect(await comparisonValues(page, exercise, 'databaseReads')).toEqual([baselineReads, readsAt64])
  expect(await comparisonValues(page, exercise, 'cacheHitRate')).toEqual([baselineHits, hitsAt64])

  await chooseParameter(page, exercise, 'cache-capacity', 128)
  await expect(feedback).not.toContainText('目标已达成')
  await runDefinedExercise(page, 'pass')
  expect(await readMetric(page, exercise, 'databaseReads')).toBe(readsAt64)
  expect(await readMetric(page, exercise, 'cacheHitRate')).toBe(hitsAt64)
  expect(await comparisonValues(page, exercise, 'databaseReads')).toEqual([readsAt64, readsAt64])
  await expect(attempts.locator('ol > li')).toHaveCount(3)
  for (const capacity of [8, 64, 128]) {
    await expect(attempts).toContainText(exercise.parameters[0]!.choices.find((choice) => choice.value === capacity)!.label)
  }

  await page.reload()
  await expect(page.getByRole('button', { name: '运行并检查', exact: true })).toBeEnabled()
  await expect(parameterChoice(page, exercise, 'cache-capacity', 128)).toHaveAttribute('aria-pressed', 'true')
  await expect(feedback).toContainText('目标已达成')
  await expect(attempts.locator('ol > li')).toHaveCount(3)
  expect(await readMetric(page, exercise, 'databaseReads')).toBe(readsAt64)
  await page.getByRole('button', { name: 'Properties', exact: true }).click()
  await page.getByLabel('Name', { exact: true }).fill('Cache for my study notes')
  await expect(feedback).toContainText('有未运行的修改')
  await expect(feedback).not.toContainText('目标已达成')
  await expect(page.getByTestId('exercise-comparison')).toHaveCount(0)
  await runDefinedExercise(page, 'pass')
  expect(await readMetric(page, exercise, 'databaseReads')).toBe(readsAt64)
})

test('keeps exercise controls, saved configurations and run histories separate across catalog navigation', async ({ page }) => {
  test.setTimeout(90_000)
  const database = databaseBottleneckExercise
  const cache = cachePressureExercise
  const attempts = page.getByTestId('exercise-attempts')
  const feedback = page.getByTestId('exercise-feedback')
  await page.goto('/practice')
  await openDefinedExercise(page, database)
  await chooseParameter(page, database, 'database-connections', 12)
  await runDefinedExercise(page, 'pass')

  await page.getByRole('link', { name: '全部练习', exact: true }).click()
  await openDefinedExercise(page, cache)
  await expect(parameterChoice(page, cache, 'cache-capacity', 8)).toHaveAttribute('aria-pressed', 'true')
  await expect(attempts.locator('ol > li')).toHaveCount(0)
  await expect(feedback).toContainText('等待第一次实验')
  for (const parameter of database.parameters) await expect(page.getByRole('group', { name: parameter.label, exact: true })).toHaveCount(0)
  await chooseParameter(page, cache, 'cache-capacity', 64)
  await runDefinedExercise(page, 'pass')

  await page.getByRole('link', { name: '全部练习', exact: true }).click()
  await openDefinedExercise(page, database)
  await expect(parameterChoice(page, database, 'service-replicas', 1)).toHaveAttribute('aria-pressed', 'true')
  await expect(parameterChoice(page, database, 'database-connections', 12)).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('group', { name: cache.parameters[0]!.label, exact: true })).toHaveCount(0)
  await expect(attempts.locator('ol > li')).toHaveCount(1)
  await expect(attempts).not.toContainText(cache.parameters[0]!.choices.find((choice) => choice.value === 64)!.label)
  await expect(feedback).toContainText('目标已达成')
  await expect(feedback).toContainText('已恢复上次保存的运行证据')
  expect(await readMetric(page, database, 'latencyP95Ms')).toBe(120)

  await page.getByRole('link', { name: '全部练习', exact: true }).click()
  await openDefinedExercise(page, cache)
  await expect(parameterChoice(page, cache, 'cache-capacity', 64)).toHaveAttribute('aria-pressed', 'true')
  await expect(attempts.locator('ol > li')).toHaveCount(1)
  await expect(attempts).not.toContainText(database.parameters[1]!.label)
  await expect(feedback).toContainText('目标已达成')
  await expect(feedback).toContainText('已恢复上次保存的运行证据')
  expect(await readMetric(page, cache, 'cacheHitRate')).toBeGreaterThanOrEqual(85)
  await expect(page.getByTestId('exercise-comparison')).toHaveCount(0)
})
