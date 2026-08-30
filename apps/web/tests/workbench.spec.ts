import { expect, test, type Page } from '@playwright/test'
import { createOrderSystemContractFixture, createScheduledReportContractFixture } from '@system-design/model'

async function openComponentCategory(page: Page, name: string) {
  const category = page.locator('.category-toggle').filter({ hasText: name })
  await expect(category).toBeVisible()
  if (await category.getAttribute('aria-expanded') !== 'true') await category.click()
  await expect(category).toHaveAttribute('aria-expanded', 'true')
}

const legacyScenario = {
  schemaVersion: 1, id: 'legacy-project', name: 'Legacy import', seed: 'legacy-seed',
  nodes: [
    { id: 'traffic', name: 'Legacy traffic', position: { x: 0, y: 0 }, type: 'traffic', config: { workloadId: 'load' } },
    { id: 'service', name: 'Legacy service', position: { x: 250, y: 0 }, type: 'service', config: { replicas: 1, concurrencyPerReplica: 5, serviceTimeMs: 10, jitterMs: 0, errorRate: 0, maxQueueSize: 100 } },
  ],
  edges: [{ id: 'edge', source: 'traffic', target: 'service', sourcePort: 'out', targetPort: 'in', weight: 1 }],
  workloads: [{ id: 'load', name: 'Legacy load', sourceNodeId: 'traffic', requestsPerSecond: 10, startAtSeconds: 0, durationSeconds: 2, pattern: 'constant', requestBytes: 100 }],
  faults: [], simulation: { durationSeconds: 2, sampleIntervalMs: 1_000, maxRequests: 100, traceLimit: 20, maxHops: 10 },
}

const legacyPresetProject = {
  schemaVersion: 2, id: 'legacy-preset-project', name: 'Legacy preset import', activeExperimentId: 'experiment',
  topology: {
    nodes: [{
      id: 'legacy-sql', name: 'Legacy SQL store', type: 'database', componentVersion: 2,
      rolePreset: { id: 'sql-store', version: 1 }, position: { x: 120, y: 80 },
      config: { maxConnections: 100, queryTimeMs: 12, jitterMs: 3, errorRate: 0.001, maxQueueSize: 10_000, shardCount: 1, replicasPerShard: 1, readPreference: 'primary', replicationDelayMs: 100, writeRatio: 0.5, keySpaceSize: 1_000_000, hotKeyProbability: 0 },
    }],
    edges: [], groups: [], policies: [],
  },
  experiments: [{
    id: 'experiment', name: 'Experiment', workloads: [], faults: [], seed: 'legacy-preset-seed',
    simulation: { durationSeconds: 1, sampleIntervalMs: 100, maxRequests: 10, traceLimit: 10, maxHops: 10 },
  }],
}

test('switches theme and preserves it after reload', async ({ page }) => {
  await page.goto('/')
  const themeToggle = page.getByRole('button', { name: /Switch to (light|dark) theme/ })
  await expect(themeToggle).toBeVisible()
  const initialTheme = await page.locator('html').getAttribute('data-theme')
  await themeToggle.click()
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', initialTheme ?? '')
  const selectedTheme = await page.locator('html').getAttribute('data-theme')
  expect(selectedTheme).toMatch(/^(dark|light)$/)
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', selectedTheme!)
})

test('hides, restores and persists adaptable workbench panels', async ({ page }) => {
  await page.goto('/')
  const cases = [
    { toggle: /Hide fault laboratory/, show: /Show fault laboratory/, panel: page.getByRole('region', { name: 'Fault laboratory' }) },
    { toggle: /Hide simulation output/, show: /Show simulation output/, panel: page.getByText('No simulation yet') },
    { toggle: /Hide properties panel/, show: /Show properties panel/, panel: page.getByText('Select a component to configure') },
  ]

  for (const entry of cases) {
    await expect(entry.panel).toBeVisible()
    const toggle = page.getByRole('button', { name: entry.toggle }).first()
    await toggle.click()
    await expect(entry.panel).toBeHidden()
    await page.getByRole('button', { name: entry.show }).click()
    await expect(entry.panel).toBeVisible()
  }

  await page.getByRole('button', { name: /Hide properties panel/ }).first().click()
  await page.reload()
  await expect(page.getByRole('button', { name: /Show properties panel/ })).toBeVisible()
  await expect(page.getByText('Select a component to configure')).toBeHidden()
})

test('resizes workbench panels with an accessible keyboard separator and persists layout', async ({ page }) => {
  await page.goto('/')
  const separator = page.getByRole('separator', { name: 'Resize properties panel' })
  await expect(separator).toBeVisible()
  const initial = await separator.getAttribute('aria-valuenow')
  await separator.focus()
  await page.keyboard.press('ArrowLeft')
  await expect(separator).not.toHaveAttribute('aria-valuenow', initial ?? '')
  const resized = await separator.getAttribute('aria-valuenow')
  await page.waitForTimeout(150)
  await page.reload()
  await expect(page.getByRole('separator', { name: 'Resize properties panel' })).toHaveAttribute('aria-valuenow', resized!)
})

test('starts blank and rejects an unconnected design', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Start with an empty canvas')).toBeVisible()
  await expect(page.getByText('0 components')).toBeVisible()
  await expect(page.getByLabel('Project modeling mode: Capacity-only')).toBeVisible()
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

test('filters request traces, renders a dependency waterfall and navigates a span to the canvas', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Load example' }).click()
  await page.getByRole('button', { name: /Direct service/ }).click()
  await page.getByTestId('rf__node-service-direct').dispatchEvent('click')
  await page.getByLabel('Error rate (0–1)').fill('1')
  await page.getByRole('button', { name: 'Run simulation' }).click()

  const explorer = page.getByRole('region', { name: 'Trace explorer' })
  await expect(explorer).toBeVisible({ timeout: 15_000 })
  await expect(explorer.getByRole('img', { name: /Dependency waterfall with/ })).toBeVisible()
  await expect(explorer.locator('.trace-list [role=option]').first()).toContainText('Request')

  await explorer.getByLabel('Trace component').selectOption('service-direct')
  await expect(explorer.getByText(/of .* requests/)).toBeVisible()
  await explorer.getByRole('button', { name: /Show .* on canvas/ }).click()
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(1)

  await explorer.getByLabel('Trace status').selectOption('error')
  await expect(explorer.getByText(/of .* requests/)).toContainText(/\d+ of/)
  await expect(explorer.locator('.trace-list [role=option]').first()).toContainText(/intrinsic error|Request/)
})

test('shows evidence-backed bottleneck claims and links their request evidence to the trace explorer', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Load example' }).click()
  await page.getByRole('button', { name: /Data platform/ }).click()
  await page.getByRole('button', { name: 'Run simulation' }).click()

  const explanations = page.getByRole('region', { name: 'Evidence-based explanations' })
  await expect(explanations).toBeVisible({ timeout: 15_000 })
  await expect(explanations.getByText(/misses drove load|routed disproportionate traffic/).first()).toBeVisible()
  const traceLink = explanations.getByRole('button', { name: /^trace-/ }).first()
  await expect(traceLink).toBeVisible()
  const traceId = await traceLink.innerText()
  await traceLink.click()
  await expect(page.getByRole('region', { name: 'Trace explorer' }).getByText(traceId, { exact: true })).toBeVisible()
})

test('runs the reusable data-platform topology and exposes domain metrics', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Load example' }).click()
  await page.getByRole('button', { name: /Data platform/ }).click()
  await expect(page.getByText('7 components')).toBeVisible()
  await page.getByRole('button', { name: 'Run simulation' }).click()
  await expect(page.getByText('Throughput over virtual time')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.domain-metrics').filter({ hasText: 'hit' })).toBeVisible()
  await expect(page.locator('.domain-metrics').filter({ hasText: 'hot shard' })).toBeVisible()
  await expect(page.locator('.domain-metrics').filter({ hasText: /^lag / })).toBeVisible()
  await expect(page.locator('.domain-metrics').filter({ hasText: 'bytes/s' })).toBeVisible()
})

test('loads a scheduled batch pipeline and exposes executable Scheduler metrics', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Load example' }).click()
  await page.getByRole('button', { name: /Scheduled batch/ }).click()
  await expect(page.getByTestId('rf__node-batch-scheduler')).toContainText('Scheduler')
  await expect(page.getByTestId('rf__node-batch-scheduler')).toContainText('8 runs every 1000 ms')

  await page.getByRole('button', { name: 'Run simulation' }).click()
  await expect(page.getByText('released 80 · skipped 0 · pending 0')).toBeVisible({ timeout: 15_000 })
  const results = page.getByRole('table')
  await expect(results.getByText('Nightly release', { exact: true })).toBeVisible()
  await expect(results.getByText('Reporting database', { exact: true })).toBeVisible()
})

test('loads video delivery and exposes executable CDN controls and metrics', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Load example' }).click()
  await page.getByRole('button', { name: /Video delivery/ }).click()
  await expect(page.getByText('4 components')).toBeVisible()
  await page.getByTestId('rf__node-video-cdn').dispatchEvent('click')
  await expect(page.getByLabel('POP count')).toHaveValue('4')
  await expect(page.getByLabel('POP selection')).toHaveValue('consistent-hash')
  await expect(page.getByLabel('Edge bandwidth (Mbps)')).toHaveValue('1000')
  await expect(page.getByLabel('Origin round trip (ms)')).toHaveValue('80')

  await page.getByRole('button', { name: 'Run simulation' }).click()
  await expect(page.getByText('Throughput over virtual time')).toBeVisible({ timeout: 15_000 })
  const row = page.getByRole('row').filter({ hasText: 'Edge CDN' })
  await expect(row.getByText(/CDN hit/)).toBeVisible()
  await expect(row.getByText(/origin fetches/)).toBeVisible()
})

test('loads product search and exposes executable Search Index contracts, controls, and metrics', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Load example' }).click()
  await page.getByRole('button', { name: /Product search/ }).click()
  await expect(page.getByText('5 components')).toBeVisible()
  await page.getByTestId('rf__node-product-search-index').dispatchEvent('click')
  await expect(page.getByLabel('Primary shards')).toHaveValue('4')
  await expect(page.getByLabel('Replicas / shard')).toHaveValue('1')
  await expect(page.getByLabel('Refresh interval (ms)')).toHaveValue('500')
  await expect(page.getByLabel('Merge / candidate (ms)')).toHaveValue('0.01')

  await page.getByRole('button', { name: 'Definitions' }).click()
  const explorer = page.getByRole('navigation', { name: 'Project definitions' })
  await explorer.getByRole('button', { name: /Product search documents/ }).click()
  const editor = page.getByLabel('Definition editor')
  await expect(editor.getByRole('textbox', { name: 'Collection ID' })).toHaveValue('products')
  await expect(editor.getByRole('textbox', { name: 'Index ID' })).toHaveValue('ix-product-text')
  await expect(editor.locator('input[value="product_text_and_facets"]')).toBeVisible()

  await page.getByRole('button', { name: 'Run simulation' }).click()
  await expect(page.getByText('Throughput over virtual time')).toBeVisible({ timeout: 15_000 })
  const row = page.getByRole('row').filter({ hasText: 'Product search index' })
  await expect(row.getByText(/stale queries/)).toBeVisible()
  await expect(row.getByText(/index backlog/)).toBeVisible()
  await expect(row.getByText(/replica backlog/)).toBeVisible()
  await expect(page.getByRole('table', { name: 'Action metrics' }).getByText(/fan-out 4 · candidates 96 · results 24/).first()).toBeVisible()
})

test('loads log search as a distinct streaming-ingest Search Index system', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Load example' }).click()
  await page.getByRole('button', { name: /Log search/ }).click()
  await expect(page.getByText('7 components')).toBeVisible()
  await expect(page.getByTestId('rf__node-log-stream')).toContainText('Stream')
  await page.getByTestId('rf__node-log-search-index').dispatchEvent('click')
  await expect(page.getByLabel('Primary shards')).toHaveValue('8')
  await expect(page.getByLabel('Replicas / shard')).toHaveValue('2')
  await expect(page.getByLabel('Index-write ratio (0–1)')).toHaveValue('0.8')

  await page.getByRole('button', { name: 'Run simulation' }).click()
  await expect(page.getByText('Throughput over virtual time')).toBeVisible({ timeout: 15_000 })
  const row = page.getByRole('row').filter({ hasText: 'Log search index' })
  await expect(row.getByText(/stale queries/)).toBeVisible()
  await expect(row.getByText(/index backlog/)).toBeVisible()
})

test('loads order event fan-out and exposes Topic subscriptions and acknowledgements', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Load example' }).click()
  await page.getByRole('button', { name: /Order event fan-out/ }).click()
  await expect(page.getByText('5 components')).toBeVisible()
  await expect(page.getByTestId('rf__node-fulfillment-subscription')).toContainText('Fulfillment subscription')
  await expect(page.getByTestId('rf__node-email-subscription')).toContainText('Email subscription')
  await page.getByTestId('rf__node-order-events-topic').dispatchEvent('click')
  await expect(page.getByLabel('Subscriptions')).toHaveValue('2')
  await expect(page.getByLabel('Acknowledgement')).toHaveValue('explicit')
  await expect(page.getByLabel('Retention (ms)')).toHaveValue('60000')

  await page.getByRole('button', { name: 'Run simulation' }).click()
  await expect(page.getByText('Throughput over virtual time')).toBeVisible({ timeout: 15_000 })
  const row = page.getByRole('row').filter({ hasText: 'Order events topic' })
  await expect(row.getByText(/fan-out copies/)).toBeVisible()
  await expect(row.getByText(/acknowledged/)).toBeVisible()
  await expect(row.getByText(/expired 0/)).toBeVisible()
})

test('loads incident fan-out and exposes independent Topic retention expiry', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Load example' }).click()
  await page.getByRole('button', { name: /Incident fan-out/ }).click()
  await expect(page.getByText('6 components')).toBeVisible()
  await page.getByTestId('rf__node-incident-topic').dispatchEvent('click')
  await expect(page.getByLabel('Subscriptions')).toHaveValue('3')
  await expect(page.getByLabel('Delivery batch size')).toHaveValue('10')
  await expect(page.getByLabel('Retention (ms)')).toHaveValue('250')

  await page.getByRole('button', { name: 'Run simulation' }).click()
  await expect(page.getByText('Throughput over virtual time')).toBeVisible({ timeout: 15_000 })
  const row = page.getByRole('row').filter({ hasText: 'Incident topic' })
  await expect(row.getByText(/fan-out copies/)).toBeVisible()
  await expect(row.getByText(/acknowledged/)).toBeVisible()
  await expect(row.getByText(/expired [1-9]/)).toBeVisible()
})

test('shows Scheduler timing instead of editable arrival phases for a scheduled operation workload', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles({
    name: 'scheduled-report.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(createScheduledReportContractFixture())),
  })
  await page.getByRole('button', { name: 'Definitions' }).click()
  const explorer = page.getByRole('navigation', { name: 'Project definitions' })
  await explorer.getByRole('button', { name: /Scheduled order report/ }).click()
  const editor = page.getByLabel('Definition editor')
  await expect(editor.getByText('Scheduler-controlled timing')).toBeVisible()
  await expect(editor.getByText(/Stored arrival phases .* are not executed/)).toBeVisible()
  await expect(editor.getByText('Arrival phases', { exact: true })).toHaveCount(0)
  await expect(editor.getByLabel('Requests / second')).toHaveCount(0)
})

test('does not offer faults or node policies that Scheduler cannot execute', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Load example' }).click()
  await page.getByRole('button', { name: /Scheduled batch/ }).click()

  await page.getByTestId('rf__node-batch-scheduler').dispatchEvent('click')
  await expect(page.getByLabel('Policy for selected node')).toBeDisabled()
  await expect(page.getByLabel('Policy for selected node')).toHaveValue('')
  await expect(page.getByLabel('Policy for selected node').locator('option')).toHaveText(['No supported policies'])

  await page.getByRole('button', { name: 'Add fault' }).click()
  const editor = page.getByLabel('Selected fault editor')
  await expect(editor.getByLabel('Fault target')).not.toHaveValue('batch-scheduler')
  await expect(editor.getByLabel('Fault target').locator('option', { hasText: 'Nightly release' })).toHaveCount(0)
})

test('migrates a v1 import and exports a capacity-only ProjectFile v3', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles({ name: 'legacy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(legacyScenario)) })
  await expect(page.getByText('2 components')).toBeVisible()
  await expect(page.getByLabel('Project modeling mode: Capacity-only')).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export' }).click()
  const download = await downloadPromise
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  const project = JSON.parse(Buffer.concat(chunks).toString())
  expect(project.schemaVersion).toBe(3)
  expect(project.modelingMode).toBe('capacity-only')
  expect(project.definitions).toEqual({
    schemaVersion: 1, jsonSchemas: [], apis: [], dataModels: [], events: [], cacheKeys: [], interactions: [],
  })
  expect(project.topology.nodes[0].componentVersion).toBe(1)
  expect(project.experiments[0].seed).toBe('legacy-seed')
  expect(project.experiments[0].operationWorkloads).toEqual([])
})

test('identifies an imported ProjectFile v3 with business contracts', async ({ page }) => {
  await page.goto('/')
  const fixture = createOrderSystemContractFixture()
  await page.locator('input[type=file]').setInputFiles({
    name: 'business-aware.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)),
  })
  await expect(page.getByLabel('Project modeling mode: Business-aware')).toBeVisible()
  await expect(page.getByText('6 components')).toBeVisible()
})

test('runs an operation workload and exposes operation and action execution metrics', async ({ page }) => {
  const fixture = createOrderSystemContractFixture()
  fixture.experiments[0]!.operationWorkloads[0]!.phases = [{ id: 'acceptance', startAtSeconds: 0, durationSeconds: 1, requestsPerSecond: 2, pattern: 'constant' }]
  fixture.experiments[0]!.simulation = { durationSeconds: 1, sampleIntervalMs: 500, maxRequests: 10, traceLimit: 10, maxHops: 64 }
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles({ name: 'operation-aware.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) })
  await page.getByRole('button', { name: 'Run simulation' }).click()

  const execution = page.getByRole('region', { name: 'Operation execution metrics' })
  await expect(execution).toBeVisible({ timeout: 15_000 })
  await expect(execution.getByRole('table', { name: 'Operation metrics' }).getByText('create-order', { exact: true })).toBeVisible()
  await expect(execution.getByRole('table', { name: 'Action metrics' }).getByText('write-order', { exact: true })).toBeVisible()
  await expect(execution.getByRole('table', { name: 'Action metrics' }).getByText('data-access', { exact: true }).first()).toBeVisible()
})

test('loads and runs the complete generic order-system vertical slice', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Load example' }).click()
  await page.getByRole('button', { name: /Order system/ }).click()
  await expect(page.getByLabel('Project modeling mode: Business-aware')).toBeVisible()
  await expect(page.getByText('6 components')).toBeVisible()

  await page.getByRole('button', { name: 'Definitions' }).click()
  const explorer = page.getByRole('navigation', { name: 'Project definitions' })
  await expect(explorer.getByRole('button', { name: /Orders API/ })).toBeVisible()
  await expect(explorer.getByRole('button', { name: /Orders relational model/ })).toContainText('relational · 2 objects')
  await expect(explorer.getByRole('button', { name: /Get order with cache aside/ })).toBeVisible()
  await expect(explorer.getByRole('button', { name: /List customer orders by index/ })).toBeVisible()
  await explorer.getByRole('button', { name: /Orders API/ }).click()
  await expect(page.getByLabel('Definition editor').getByLabel('Operation ID')).toHaveCount(3)
  await explorer.getByRole('button', { name: /Orders relational model/ }).click()
  const tableIds = page.getByLabel('Definition editor').getByLabel('Table ID', { exact: true })
  await expect(tableIds).toHaveCount(2)
  await expect(tableIds.nth(0)).toHaveValue('orders-table')
  await expect(tableIds.nth(1)).toHaveValue('order-items-table')

  await page.getByRole('button', { name: 'Run simulation' }).click()
  const execution = page.getByRole('region', { name: 'Operation execution metrics' })
  const operationTable = execution.getByRole('table', { name: 'Operation metrics' })
  const actionTable = execution.getByRole('table', { name: 'Action metrics' })
  await expect(execution).toBeVisible({ timeout: 20_000 })
  for (const operation of ['create-order', 'get-order', 'list-customer-orders']) await expect(operationTable.getByText(operation, { exact: true })).toBeVisible()
  for (const action of ['write-order-items', 'read-order', 'read-customer-orders']) await expect(actionTable.getByText(action, { exact: true })).toBeVisible()
  await expect(actionTable.getByText(/B-tree index lookup examines/)).toBeVisible()
  const trace = page.getByRole('region', { name: 'Trace explorer' })
  await expect(trace.locator('.trace-list [role=option]').first()).toContainText(/create-order|get-order|list-customer-orders/)
  await expect(trace.locator('.trace-span-detail code').first()).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const stream = await (await downloadPromise).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  const exportedBuffer = Buffer.concat(chunks)
  const exported = JSON.parse(exportedBuffer.toString())
  expect(exported).toMatchObject({ schemaVersion: 3, modelingMode: 'business-aware' })
  expect(exported.definitions.apis[0].operations).toHaveLength(3)
  expect(exported.definitions.dataModels[0].tables).toHaveLength(2)
  expect(exported.definitions.interactions).toHaveLength(3)
  expect(exported.experiments[0].operationWorkloads[0].operationMix).toHaveLength(3)

  await page.locator('input[type=file]').setInputFiles({ name: 'order-system-round-trip.json', mimeType: 'application/json', buffer: exportedBuffer })
  await expect(page.getByLabel('Project modeling mode: Business-aware')).toBeVisible()
  const replayDownloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const replayStream = await (await replayDownloadPromise).createReadStream()
  const replayChunks: Buffer[] = []
  for await (const chunk of replayStream) replayChunks.push(Buffer.from(chunk))
  expect(JSON.parse(Buffer.concat(replayChunks).toString())).toEqual(exported)
})

test('edits business definitions in one ProjectFile with inline validation, undo and reload persistence', async ({ page }) => {
  await page.goto('/')
  const fixture = createOrderSystemContractFixture()
  await page.locator('input[type=file]').setInputFiles({
    name: 'business-aware-editor.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)),
  })
  await page.getByRole('button', { name: 'Definitions' }).click()
  const explorer = page.getByRole('navigation', { name: 'Project definitions' })
  await expect(explorer).toBeVisible()
  await expect(explorer.getByText('Orders API')).toBeVisible()

  await explorer.getByRole('button', { name: /Orders API/ }).click()
  const editor = page.getByLabel('Definition editor')
  const createOrderOperation = editor.locator('details.definition-card').first()
  await expect(createOrderOperation.getByLabel('Operation ID')).toHaveValue('create-order')
  await expect(page.getByTestId('rf__node-orders-service')).toHaveClass(/is-definition-binding/)
  await createOrderOperation.getByLabel('Handler time (ms)').fill('17')
  await expect(editor.getByText('Saved to project · undo available')).toBeVisible()

  await editor.getByLabel('Owning service').selectOption('fulfillment-worker')
  await expect(editor.getByRole('alert')).toContainText('API operation is owned by node fulfillment-worker, not orders-service')
  await editor.getByLabel('Owning service').selectOption('orders-service')
  await expect(editor.getByText('Saved to project · undo available')).toBeVisible()

  await page.keyboard.press('Control+z')
  await expect(createOrderOperation.getByLabel('Handler time (ms)')).toHaveValue('5')
  await page.keyboard.press('Control+Shift+z')
  await expect(createOrderOperation.getByLabel('Handler time (ms)')).toHaveValue('17')
  await page.waitForTimeout(500)
  const historyButton = page.getByRole('button', { name: 'History' })
  await historyButton.click()
  await expect(page.getByRole('dialog', { name: 'Local project history' }).getByText(/^autosave ·/).first()).toBeVisible()
  await historyButton.click()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export' }).click()
  const download = await downloadPromise
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  const exported = JSON.parse(Buffer.concat(chunks).toString())
  expect(exported.definitions.apis[0].operations[0].handlerTimeMs).toBe(17)

  await page.reload()
  await page.getByRole('button', { name: 'Definitions' }).click()
  await page.getByRole('navigation', { name: 'Project definitions' }).getByRole('button', { name: /Orders API/ }).click()
  await expect(page.getByLabel('Definition editor').locator('details.definition-card').first().getByLabel('Handler time (ms)')).toHaveValue('17')

  const reloadedDownloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const reloadedStream = await (await reloadedDownloadPromise).createReadStream()
  const reloadedChunks: Buffer[] = []
  for await (const chunk of reloadedStream) reloadedChunks.push(Buffer.from(chunk))
  expect(JSON.parse(Buffer.concat(reloadedChunks).toString())).toEqual(exported)
})

test('navigates definitions by keyboard and edits data, event, interaction and workload contracts', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles({
    name: 'business-aware-models.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(createOrderSystemContractFixture())),
  })
  await page.getByRole('button', { name: 'Definitions' }).click()
  const explorer = page.getByRole('navigation', { name: 'Project definitions' })
  const first = explorer.locator('.definition-item').first()
  await first.focus()
  await page.keyboard.press('ArrowDown')
  await expect(explorer.locator('.definition-item').nth(1)).toBeFocused()

  await explorer.getByRole('button', { name: /Orders relational model/ }).click()
  const editor = page.getByLabel('Definition editor')
  const ordersTable = editor.locator('details.definition-card').first()
  await expect(ordersTable.getByRole('strong').filter({ hasText: /^Columns$/ })).toBeVisible()
  await ordersTable.getByLabel('Estimated rows').fill('12000000')
  await ordersTable.getByLabel('Key columns').fill('missing-column')
  await expect(editor.getByRole('alert')).toContainText('Unknown table column: missing-column')
  await ordersTable.getByLabel('Key columns').fill('customer-id')
  await expect(editor.getByText('Saved to project · undo available')).toBeVisible()

  await explorer.getByRole('button', { name: /Order documents/ }).click()
  await expect(editor.getByText('Secondary indexes')).toBeVisible()
  await editor.getByLabel('Estimated documents').fill('11000000')

  await explorer.getByRole('button', { name: /Order key value/ }).click()
  await expect(editor.getByText('Key distribution')).toBeVisible()
  await editor.getByLabel('Estimated value bytes').fill('768')
  await editor.getByLabel('Key-space size').fill('20000000')

  await explorer.getByRole('button', { name: /^OrderCreated / }).click()
  await editor.getByLabel('Estimated payload bytes').fill('768')
  await editor.getByLabel('Delivery').selectOption('at-most-once')
  await expect(page.getByTestId('rf__node-fulfillment-worker')).toHaveClass(/is-definition-binding/)

  await explorer.getByRole('button', { name: /Order cache key/ }).click()
  await editor.getByLabel('TTL seconds').fill('600')

  await explorer.getByRole('button', { name: /Create order flow/ }).click()
  const writeAction = editor.locator('details.definition-card').nth(1)
  await expect(writeAction.getByLabel('Action ID')).toHaveValue('write-order')
  await writeAction.locator('label').filter({ hasText: /^Operation/ }).getByRole('combobox').selectOption('scan')
  await writeAction.getByLabel('Estimated rows').fill('25')
  await expect(page.getByTestId('rf__node-orders-db')).toHaveClass(/is-definition-binding/)

  await explorer.getByRole('button', { name: /Order operations/ }).click()
  await expect(editor.getByText('Arrival phases')).toBeVisible()
  await editor.getByLabel('Requests / second').first().fill('30')
  await editor.getByLabel('Weight').first().fill('3')

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const stream = await (await downloadPromise).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  const exported = JSON.parse(Buffer.concat(chunks).toString())
  expect(exported.definitions.dataModels[0].tables[0]).toMatchObject({ estimatedRows: 12000000, indexes: [expect.objectContaining({ columnIds: ['customer-id'] })] })
  expect(exported.definitions.dataModels[1].collections[0].estimatedDocuments).toBe(11000000)
  expect(exported.definitions.dataModels[2].namespaces[0]).toMatchObject({ estimatedValueBytes: 768, keyDistribution: expect.objectContaining({ keySpaceSize: 20000000 }) })
  expect(exported.definitions.events[0]).toMatchObject({ estimatedPayloadBytes: 768, delivery: 'at-most-once' })
  expect(exported.definitions.cacheKeys[0].ttlSeconds).toBe(600)
  expect(exported.definitions.interactions[0].actions[1]).toMatchObject({ operation: 'scan', estimatedRows: 25 })
  expect(exported.experiments[0].operationWorkloads[0].phases[0]).toMatchObject({ requestsPerSecond: 30 })
  expect(exported.experiments[0].operationWorkloads[0].operationMix[0]).toMatchObject({ weight: 3 })
})

test('imports and exports OpenAPI and DBML through validated server adapters', async ({ page }) => {
  const fixture = createOrderSystemContractFixture()
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles({ name: 'business-aware-formats.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) })
  await page.getByRole('button', { name: 'Definitions' }).click()

  await page.getByRole('button', { name: 'OpenAPI' }).click()
  const openApiDialog = page.getByRole('dialog', { name: 'OpenAPI 3.1 adapter' })
  await openApiDialog.getByRole('tab', { name: 'Export' }).click()
  const openApiDownload = page.waitForEvent('download')
  await openApiDialog.getByRole('button', { name: 'Export file' }).click()
  const openApiStream = await (await openApiDownload).createReadStream()
  const openApiChunks: Buffer[] = []
  for await (const chunk of openApiStream) openApiChunks.push(Buffer.from(chunk))
  const openApi = JSON.parse(Buffer.concat(openApiChunks).toString())
  expect(openApi.openapi).toBe('3.1.0')
  expect(openApi.paths['/orders'].post.operationId).toBe('create-order')
  await openApiDialog.getByRole('button', { name: 'Close format dialog' }).click()

  await page.getByRole('navigation', { name: 'Project definitions' }).getByRole('button', { name: /Orders relational model/ }).click()
  await page.getByRole('button', { name: 'DBML' }).click()
  const dbmlDialog = page.getByRole('dialog', { name: 'DBML adapter' })
  await dbmlDialog.getByRole('tab', { name: 'Export' }).click()
  const dbmlDownload = page.waitForEvent('download')
  await dbmlDialog.getByRole('button', { name: 'Export file' }).click()
  const dbmlStream = await (await dbmlDownload).createReadStream()
  const dbmlChunks: Buffer[] = []
  for await (const chunk of dbmlStream) dbmlChunks.push(Buffer.from(chunk))
  expect(Buffer.concat(dbmlChunks).toString()).toContain('Table orders')
  await dbmlDialog.getByRole('button', { name: 'Close format dialog' }).click()

  await page.getByRole('button', { name: 'DBML' }).click()
  await page.getByRole('dialog', { name: 'DBML adapter' }).getByLabel('Paste DBML').fill('Table inventory {\n id uuid [pk, not null]\n sku varchar(64) [not null]\n}')
  await page.getByRole('dialog', { name: 'DBML adapter' }).getByRole('button', { name: 'Validate and import' }).click()
  await expect(page.getByRole('navigation', { name: 'Project definitions' }).getByRole('button', { name: /Imported relational model/ })).toBeVisible()
})

test('attaches and configures manifest-driven reliability policies', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Load example' }).click()
  await page.getByRole('button', { name: /Direct service/ }).click()

  const serviceNode = page.getByTestId('rf__node-service-direct')
  await expect(serviceNode).toBeVisible()
  await serviceNode.dispatchEvent('click')
  await page.getByLabel('Policy for selected node').selectOption({ label: 'Rate Limit' })
  await page.locator('.policy-add').getByRole('button', { name: 'Add' }).click()
  await expect(page.getByRole('region', { name: 'Rate Limit policy' })).toBeVisible()
  await page.getByLabel('Bucket capacity').fill('25')
  await expect(serviceNode.locator('.component-node__policies')).toContainText('Rate Limit')

  const rateLimitEditor = page.getByRole('region', { name: 'Rate Limit policy' })
  await rateLimitEditor.getByRole('checkbox').uncheck()
  await expect(serviceNode.locator('.component-node__policies span', { hasText: 'Rate Limit' })).toHaveClass(/is-disabled/)
  await rateLimitEditor.getByRole('checkbox').check()

  await page.getByLabel('Policy for selected node').selectOption({ label: 'Backpressure' })
  await page.locator('.policy-add').getByRole('button', { name: 'Add' }).click()
  await page.getByRole('button', { name: 'Remove Backpressure' }).click()
  await expect(page.getByRole('region', { name: 'Backpressure policy' })).toHaveCount(0)

  const serviceEdge = page.getByTestId('rf__edge-edge-direct-2')
  await expect(serviceEdge).toBeVisible()
  await serviceEdge.dispatchEvent('click')
  await page.getByLabel('Policy for selected edge').selectOption({ label: 'Timeout' })
  await page.locator('.policy-add').getByRole('button', { name: 'Add' }).click()
  await page.getByLabel('Timeout (ms)').fill('250')
  await page.getByLabel('Policy for selected edge').selectOption({ label: 'Retry' })
  await page.locator('.policy-add').getByRole('button', { name: 'Add' }).click()
  await page.getByRole('button', { name: 'Move Retry earlier' }).click()
  await expect(serviceEdge).toContainText('Retry · Timeout')

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export' }).click()
  const download = await downloadPromise
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  const project = JSON.parse(Buffer.concat(chunks).toString())
  expect(project.topology.policies).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'rate-limit', target: { kind: 'node', id: 'service-direct' }, enabled: true, config: expect.objectContaining({ capacity: 25 }) }),
    expect.objectContaining({ type: 'timeout', target: { kind: 'edge', id: 'edge-direct-2' }, order: 1, config: expect.objectContaining({ timeoutMs: 250 }) }),
    expect.objectContaining({ type: 'retry', target: { kind: 'edge', id: 'edge-direct-2' }, order: 0 }),
  ]))
  expect(project.topology.policies).toHaveLength(3)
})

test('builds and configures Phase 1 data components from the shared palette', async ({ page }) => {
  await page.goto('/')

  await openComponentCategory(page, 'Cache')
  await page.getByRole('button', { name: /Cache Stores key-aware entries/ }).click()
  await expect(page.getByText('1 components')).toBeVisible()
  const cache = page.locator('.react-flow__node').filter({ hasText: 'Cache' })
  await expect(cache).toBeVisible()
  await cache.dispatchEvent('click')
  await page.getByLabel('Capacity (entries)').fill('42')
  await page.getByLabel('Eviction policy').selectOption('fifo')
  await expect(cache).toContainText('42 entries')

  await openComponentCategory(page, 'Messaging')
  await page.getByRole('button', { name: /Stream Partitions messages/ }).click()
  const streamNode = page.locator('.react-flow__node').filter({ hasText: 'Stream' })
  await streamNode.dispatchEvent('click')
  await page.getByLabel('Partitions').fill('8')
  await expect(streamNode).toContainText('8 partitions')

  await openComponentCategory(page, 'Object Storage')
  await page.getByRole('button', { name: /Object Storage Models bounded/ }).click()
  const objectStorage = page.locator('.react-flow__node').filter({ hasText: 'Object Storage' })
  await objectStorage.dispatchEvent('click')
  await page.getByLabel('Read ratio (0–1)').fill('0.6')

  await openComponentCategory(page, 'Database')
  await page.getByRole('button', { name: /Database Routes generic keyed reads/ }).click()
  const database = page.locator('.react-flow__node').filter({ hasText: 'Database' })
  await database.dispatchEvent('click')
  await page.getByLabel('Shards').fill('4')
  await page.getByLabel('Replicas / shard').fill('2')
  await page.getByLabel('Read preference').selectOption('replica-preferred')
  await expect(database).toContainText('4 shards')

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export' }).click()
  const download = await downloadPromise
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  const exported = JSON.parse(Buffer.concat(chunks).toString())
  expect(exported.topology.nodes).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'cache', componentVersion: 1, config: expect.objectContaining({ capacityEntries: 42, evictionPolicy: 'fifo' }) }),
    expect.objectContaining({ type: 'stream', componentVersion: 1, config: expect.objectContaining({ partitions: 8 }) }),
    expect.objectContaining({ type: 'object-storage', componentVersion: 1, config: expect.objectContaining({ readRatio: 0.6 }) }),
    expect.objectContaining({ type: 'database', componentVersion: 2, config: expect.objectContaining({ shardCount: 4, replicasPerShard: 2, readPreference: 'replica-preferred' }) }),
  ]))
})

test('drags an executable variant from its category onto the canvas', async ({ page }) => {
  await page.goto('/')
  await openComponentCategory(page, 'Network')
  await page.getByRole('button', { name: /Network Link Adds transfer time/ }).dragTo(page.locator('.canvas-stage'), { targetPosition: { x: 500, y: 240 } })
  await expect(page.getByText('1 components')).toBeVisible()
  await expect(page.locator('.react-flow__node').filter({ hasText: 'Network Link' })).toBeVisible()
})

test('creates a nested preset through its component category and exports the resolved variant', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByText('Components', { exact: true })).toBeVisible()
  await expect(page.getByText('Role presets', { exact: true })).toHaveCount(0)
  await expect(page.getByText(/SQL Store|NoSQL Store|API Gateway/)).toHaveCount(0)
  const databaseCategory = page.locator('.category-toggle').filter({ hasText: 'Database' })
  await databaseCategory.focus()
  await page.keyboard.press('Enter')
  await expect(databaseCategory).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('#category-database')).toContainText('Database')
  await expect(page.locator('#category-database .variant-presets button')).toHaveCount(0)
  const serviceCategory = page.locator('.category-toggle').filter({ hasText: 'Service' })
  if (await serviceCategory.getAttribute('aria-expanded') !== 'true') await serviceCategory.click()
  await expect(page.getByLabel('Service presets')).toContainText('Worker')
  await page.getByRole('button', { name: 'Worker', exact: true }).click()

  const worker = page.locator('.react-flow__node').filter({ hasText: 'Worker' })
  await expect(worker).toContainText('Service')
  await expect(worker).toContainText('Template: Worker')
  await worker.dispatchEvent('click')
  await expect(page.locator('.preset-disclosure')).toContainText('Worker is a configuration template for the Service variant')
  await page.getByLabel('Replicas').fill('6')

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export' }).click()
  const download = await downloadPromise
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  const exported = JSON.parse(Buffer.concat(chunks).toString())
  expect(exported.topology.nodes[0]).toMatchObject({
    type: 'service', componentVersion: 1, rolePreset: { id: 'worker', version: 1 }, config: { replicas: 6 },
  })
})

test('imports and re-exports a legacy v2 preset as its resolved behavior', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles({ name: 'legacy-preset.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(legacyPresetProject)) })

  const legacyNode = page.locator('.react-flow__node').filter({ hasText: 'Legacy SQL store' })
  await expect(legacyNode).toBeVisible()
  await legacyNode.dispatchEvent('click')
  await expect(page.locator('.preset-disclosure')).toContainText('Legacy SQL capacity template is a configuration template for the Database variant')

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export' }).click()
  const download = await downloadPromise
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  const exported = JSON.parse(Buffer.concat(chunks).toString())
  expect(exported.topology.nodes[0]).toMatchObject({
    id: 'legacy-sql', type: 'database', componentVersion: 2, rolePreset: { id: 'sql-store', version: 1 },
    config: { shardCount: 1, replicasPerShard: 1, writeRatio: 0.5 },
  })
})

test('schedules and edits a typed fault on the virtual-time timeline', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Load example' }).click()
  await page.getByRole('button', { name: /Direct service/ }).click()

  await page.getByRole('button', { name: 'Add fault' }).click()
  const editor = page.getByRole('region', { name: 'Fault laboratory' }).getByLabel('Selected fault editor')
  await expect(editor).toBeVisible()
  const timelineEntry = page.getByLabel('Fault timeline entry')
  await expect(timelineEntry).toBeVisible()
  await timelineEntry.selectOption({ index: 1 })
  await expect(page.locator('.fault-timeline .vis-item')).toHaveCount(1)

  await editor.getByLabel('Fault type').selectOption('latency-spike')
  await editor.getByLabel('Target kind').selectOption('edge')
  await editor.getByLabel('Fault target').selectOption('edge-direct-2')
  await editor.getByLabel('Start (seconds)').focus()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type('4')
  await editor.getByLabel('Duration (seconds)').focus()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type('8')
  await editor.getByLabel('Latency multiplier').fill('5')
  await expect(page.getByTestId('rf__edge-edge-direct-2')).toHaveClass(/is-fault-target/)

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export' }).click()
  const download = await downloadPromise
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  const exported = JSON.parse(Buffer.concat(chunks).toString())
  expect(exported.experiments[0].faults).toEqual([expect.objectContaining({
    type: 'latency-spike', target: { kind: 'edge', id: 'edge-direct-2' }, startAtSeconds: 4, durationSeconds: 8, factor: 5, enabled: true,
  })])

  await page.getByRole('button', { name: 'Run simulation' }).click()
  await expect(page.getByRole('img', { name: 'Throughput over simulated time with 1 fault window' })).toBeVisible({ timeout: 15_000 })
  const evidence = page.getByRole('region', { name: 'Fault and trace evidence' })
  await expect(evidence).toContainText('4s started latency spike')
  await expect(evidence).toContainText('12s recovered latency spike')
})

test('creates a region in the workbench and schedules a region outage', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Load example' }).click()
  await page.getByRole('button', { name: /Direct service/ }).click()

  const regions = page.getByRole('region', { name: 'Regions and zones' })
  await regions.getByRole('button', { name: 'Add zone' }).click()
  await regions.getByRole('textbox', { name: 'Region / zone name' }).last().fill('Failover zone')
  await regions.getByLabel('Kind').last().selectOption('region')
  await regions.getByText('Service', { exact: true }).last().click()

  await page.getByRole('button', { name: 'Add fault' }).click()
  const editor = page.getByLabel('Selected fault editor')
  await editor.getByLabel('Fault type').selectOption('region-outage')
  await expect(editor.getByLabel('Target kind')).toHaveValue('group')
  await editor.getByLabel('Fault target').selectOption({ label: 'Failover zone' })
  await expect(page.getByTestId('rf__node-service-direct')).toHaveClass(/is-fault-target/)
})

test('undoes edits and restores local project and run history after refresh', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Load example' }).click()
  await page.getByRole('button', { name: /Direct service/ }).click()
  await expect(page.getByText('4 components')).toBeVisible()

  const serviceNode = page.getByTestId('rf__node-service-direct')
  await serviceNode.dispatchEvent('click')
  const name = page.getByRole('textbox', { name: 'Name', exact: true })
  await name.fill('Edited API')
  await expect(serviceNode).toContainText('Edited API')
  await page.getByRole('button', { name: 'Undo project change' }).click()
  await expect(serviceNode).toContainText('Service')
  await page.getByRole('button', { name: 'Redo project change' }).click()
  await expect(serviceNode).toContainText('Edited API')

  await page.getByRole('button', { name: 'Run simulation' }).click()
  await expect(page.getByText('Throughput over virtual time')).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'History' }).click()
  await expect(page.getByRole('dialog', { name: 'Local project history' })).toContainText('Simulation runs')
  await expect(page.getByRole('dialog', { name: 'Local project history' }).getByText(/completed ·/)).toBeVisible()

  await page.reload()
  await expect(page.getByText('4 components')).toBeVisible()
  await expect(page.getByTestId('rf__node-service-direct')).toContainText('Edited API')
  await page.getByRole('button', { name: 'History' }).click()
  await page.getByRole('dialog', { name: 'Local project history' }).getByText(/completed ·/).click()
  await expect(page.getByText('Throughput over virtual time')).toBeVisible()
})
