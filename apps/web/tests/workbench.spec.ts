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
