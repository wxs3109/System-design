import { expect, test } from '@playwright/test'

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

test('filters request traces, renders a dependency waterfall and navigates a span to the canvas', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Load example' }).click()
  await page.getByRole('button', { name: /Direct service/ }).click()
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

test('migrates a v1 import and exports ProjectFile v2', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles({ name: 'legacy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(legacyScenario)) })
  await expect(page.getByText('2 components')).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export' }).click()
  const download = await downloadPromise
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  const project = JSON.parse(Buffer.concat(chunks).toString())
  expect(project.schemaVersion).toBe(2)
  expect(project.topology.nodes[0].componentVersion).toBe(1)
  expect(project.experiments[0].seed).toBe('legacy-seed')
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

  await page.getByRole('button', { name: /Cache Stores key-aware entries/ }).click()
  await expect(page.getByText('1 components')).toBeVisible()
  const cache = page.locator('.react-flow__node').filter({ hasText: 'Cache' })
  await expect(cache).toBeVisible()
  await cache.dispatchEvent('click')
  await page.getByLabel('Capacity (entries)').fill('42')
  await page.getByLabel('Eviction policy').selectOption('fifo')
  await expect(cache).toContainText('42 entries')

  await page.getByRole('button', { name: /Stream Partitions messages/ }).click()
  const streamNode = page.locator('.react-flow__node').filter({ hasText: 'Stream' })
  await streamNode.dispatchEvent('click')
  await page.getByLabel('Partitions').fill('8')
  await expect(streamNode).toContainText('8 partitions')

  await page.getByRole('button', { name: /Object Storage Models bounded/ }).click()
  const objectStorage = page.locator('.react-flow__node').filter({ hasText: 'Object Storage' })
  await objectStorage.dispatchEvent('click')
  await page.getByLabel('Read ratio (0–1)').fill('0.6')

  await page.getByRole('button', { name: /Database Routes keyed reads/ }).click()
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

test('schedules and edits a typed fault on the virtual-time timeline', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Load example' }).click()
  await page.getByRole('button', { name: /Direct service/ }).click()

  await page.getByRole('button', { name: 'Add fault' }).click()
  const editor = page.getByRole('region', { name: 'Fault laboratory' }).getByLabel('Selected fault editor')
  await expect(editor).toBeVisible()
  await expect(page.locator('.fault-timeline .vis-item')).toHaveCount(1)

  await editor.getByLabel('Fault type').selectOption('latency-spike')
  await editor.getByLabel('Target kind').selectOption('edge')
  await editor.getByLabel('Fault target').selectOption('edge-direct-2')
  await editor.getByLabel('Start (seconds)').fill('4')
  await editor.getByLabel('Duration (seconds)').fill('8')
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
