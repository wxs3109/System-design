import { expect, test, type Page } from '@playwright/test'
test.use({ actionTimeout: 15000 })
const click = (p: Page, name: string) => p.getByRole('button', { name, exact: true }).click()
const select = (p: Page, name: string, value: string) => p.getByRole('combobox', { name, exact: true }).selectOption(value)
const fill = (p: Page, name: string, value: string) => p.getByRole('textbox', { name, exact: true }).fill(value)
async function open(p: Page, id: string) { await p.goto(`/practice/${id}#experiment-state`); await expect(p.getByTestId('experiment-save-status')).toHaveText('当前操作已保存') }
async function save(p: Page) { await select(p, '实验预测', 'unknown'); await click(p, '核对并保存实验'); await expect(p.getByTestId('experiment-save-status')).toHaveText('当前操作已保存') }
async function drain(p: Page) {
  for (let i = 0; i < 180; i++) {
    let delivered = false
    for (const button of await p.getByRole('button', { name: /^递送 message-\d+$/ }).all()) if (await button.isEnabled()) { await button.click(); delivered = true; break }
    if (!delivered) return
  }
  throw new Error('UI message drain did not settle within the bounded protocol budget')
}
async function replicaAnswer(p: Page, value: string, history: string) { await fill(p, '最后读取结果作答', value); await fill(p, '未返回操作数作答', '0'); await select(p, '有限历史检查作答', history); await select(p, '复制保证边界', 'observed-evidence'); await save(p) }
test('replica reads preserve stale history and recover a held session-token read after refresh', async ({ page }) => {
  test.setTimeout(90000)
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/learn/replication-consistency'); await page.locator('#labs a[href="/practice/replica-consistency"]').click()
  await click(page, '发起写入'); await click(page, '递送 message-1'); await click(page, '递送 message-4'); await click(page, '发起读取'); await click(page, '递送 message-5'); await click(page, '递送 message-6')
  await expect(page.getByTestId('replica-read')).toHaveText('initial'); await expect(page.getByTestId('replica-history')).toHaveText('历史存在反例')
  await drain(page); await replicaAnswer(page, 'initial', 'violation'); await expect(page.getByTestId('experiment-feedback')).toContainText('运行目标尚未满足')
  await select(page, '复制读取策略', 'session'); await click(page, '发起写入'); await click(page, '递送 message-1'); await click(page, '递送 message-4'); await click(page, '发起读取'); await click(page, '递送 message-5')
  await expect(page.getByTestId('replica-read')).toHaveText('pending')
  await expect(page.getByText('副本等待版本', { exact: false })).toBeVisible()
  await expect(page.getByTestId('experiment-save-status')).toHaveText('当前操作已保存'); await page.reload()
  await expect(page.getByRole('button', { name: '递送 message-5', exact: true })).toBeDisabled()
  await click(page, '递送 message-2'); await drain(page); await replicaAnswer(page, 'v1', 'linearizable')
  await expect(page.getByTestId('experiment-feedback')).toContainText('本关实验验证通过')
  for (const scenario of ['先读新值再换副本', '副本分区与恢复']) { await click(page, scenario); await click(page, '运行完整实验示例'); await replicaAnswer(page, 'v1', 'linearizable') }
  await expect(page.getByLabel('实验学习进度')).toContainText('3 / 3')
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.locator('main').evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/replica-mobile.png' })
  await click(page, '自由实验'); await fill(page, '复制写入值', 'W'.repeat(30)); await click(page, '发起写入'); await click(page, '递送 message-1')
  expect(await page.locator('main').evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true)
  await page.locator('#experiment-state').evaluate((e) => e.scrollIntoView({ block: 'start' })); await page.screenshot({ path: 'test-results/replica-max-value-mobile.png' })
  expect(errors).toEqual([])
})
test('quorum replies and repair expose a non-linearizable completed history despite majority arithmetic', async ({ page }) => {
  test.setTimeout(60000)
  await open(page, 'quorum-reads'); await click(page, '运行完整实验示例'); await replicaAnswer(page, 'v1', 'linearizable')
  await click(page, '旧副本的读修复'); await select(page, '异步读修复', 'true'); await click(page, '运行完整实验示例'); await replicaAnswer(page, 'v1', 'linearizable')
  await expect(page.getByTestId('replica-C')).toContainText('v1')
  await click(page, '多数派也可能不是线性一致'); await click(page, '运行完整实验示例')
  await expect(page.getByTestId('replica-history')).toHaveText('历史存在反例')
  await expect(page.getByRole('table', { name: '复制操作历史', exact: true })).toContainText('write v2')
  await replicaAnswer(page, 'v1', 'violation'); await expect(page.getByLabel('实验学习进度')).toContainText('3 / 3')
  await click(page, '运行策略对照'); await expect(page.getByRole('table', { name: '实验策略对照表', exact: true }).getByRole('row')).toHaveCount(4)
  await open(page, 'replica-consistency'); await expect(page.getByTestId('experiment-history').locator('details')).toHaveCount(0)
  await open(page, 'quorum-reads'); await expect(page.getByTestId('experiment-history').locator('details')).toHaveCount(3)
})
async function raftAnswer(p: Page, leaders: string, committed: string) { await fill(p, '当前自认 Leader 作答（逗号分隔）', leaders); await fill(p, '曾确认提交的提案数作答', committed); await fill(p, '安全性反例数作答', '0'); await select(p, 'Raft 保证边界', 'term-and-prefix'); await save(p) }
test('Raft elects through actual votes, repairs conflicts and catches the old-term majority counterexample', async ({ page }) => {
  test.setTimeout(120000)
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message))
  await open(page, 'raft-consensus')
  for (const node of ['A', 'B', 'C']) await click(page, `触发 ${node} 选举超时`)
  await drain(page); await expect(page.getByTestId('raft-leaders')).toHaveText('none')
  await click(page, '触发 A 选举超时'); await drain(page); await expect(page.getByTestId('raft-role-A')).toHaveText('leader')
  await click(page, '追加并发送提案'); await drain(page); await expect(page.getByTestId('raft-index-A')).toHaveText('1')
  await raftAnswer(page, 'A', '1'); await expect(page.getByTestId('experiment-feedback')).toContainText('本关实验验证通过')
  await page.reload(); await expect(page.getByTestId('raft-log-A')).toContainText('v1')
  await click(page, '少数派旧 Leader'); await click(page, '运行完整实验示例'); await raftAnswer(page, 'B', '1')
  await click(page, '恢复冲突日志'); await click(page, '运行完整实验示例'); await raftAnswer(page, 'B', '2')
  await click(page, '旧任期已有多数副本'); await click(page, '运行完整实验示例'); await raftAnswer(page, 'A,C', '2')
  await expect(page.getByLabel('实验学习进度')).toContainText('4 / 4')
  await select(page, 'Raft 提交规则', 'any-term'); await click(page, '运行完整实验示例')
  expect(Number(await page.getByTestId('raft-violations').textContent())).toBeGreaterThan(0)
  await expect(page.locator('main').getByRole('alert')).toContainText('安全性反例')
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.locator('main').evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/raft-mobile.png' })
  expect(errors).toEqual([])
})
async function commitAnswer(p: Page, decision: string, prepared: string, effects: string) { await select(p, '持久决议作答', decision); await fill(p, '仍准备持锁的参与者数作答', prepared); await fill(p, '业务提交次数作答', effects); await select(p, '2PC 保证边界', 'durable-decision'); await save(p) }
test('2PC waits after prepare, restores stable decisions and does not double-apply a replay', async ({ page }) => {
  test.setTimeout(90000)
  await open(page, 'two-phase-commit'); await click(page, '创建转账事务'); await drain(page)
  await expect(page.getByTestId('commit-prepared')).toHaveText('2'); await expect(page.getByTestId('commit-effects')).toHaveText('0')
  await click(page, '崩溃协调者'); await click(page, '推进参与者等待超时'); await commitAnswer(page, 'unknown', '2', '0')
  await expect(page.getByTestId('experiment-feedback')).toContainText('运行目标尚未满足')
  await page.reload(); await expect(page.getByTestId('commit-prepared')).toHaveText('2')
  await click(page, '重启协调者'); await click(page, '重发准备请求'); await drain(page); await click(page, '按投票持久记录决议'); await click(page, '发送或重发决议'); await drain(page); await commitAnswer(page, 'commit', '0', '2')
  await expect(page.getByTestId('experiment-feedback')).toContainText('本关实验验证通过')
  await click(page, '决议只到达一个参与者'); await select(page, '2PC 超时策略', 'abort'); await click(page, '运行完整实验示例')
  await expect(page.getByTestId('commit-A')).toHaveText('已提交'); await expect(page.getByTestId('commit-B')).toHaveText('已中止')
  await select(page, '2PC 超时策略', 'wait'); await click(page, '运行完整实验示例'); await commitAnswer(page, 'commit', '0', '2')
  await click(page, '参与者恢复与重复决议'); await click(page, '运行完整实验示例'); await commitAnswer(page, 'commit', '0', '2')
  await click(page, '参与者拒绝准备'); await click(page, '运行完整实验示例'); await commitAnswer(page, 'abort', '0', '0')
  await expect(page.getByLabel('实验学习进度')).toContainText('4 / 4')
})
async function durableAnswer(p: Page, value: string, applied: string, missing: string) { await fill(p, '恢复后的值作答', value); await fill(p, '恢复事务数作答', applied); await fill(p, '确认但未恢复数作答', missing); await select(p, '持久恢复边界', 'durable-inputs'); await save(p) }
test('WAL recovery preserves confirmed commits, excludes uncommitted redo and detects damaged archives', async ({ page }) => {
  test.setTimeout(90000)
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message))
  await open(page, 'durability-recovery'); await click(page, '运行完整实验示例'); await durableAnswer(page, '0', '0', '1')
  await expect(page.getByTestId('experiment-feedback')).toContainText('运行目标尚未满足')
  await select(page, '持久确认策略', 'wal'); await click(page, '开始一个事务'); await click(page, '追加 update 日志'); await click(page, '追加 commit 日志'); await click(page, '应用到内存'); await click(page, '向客户端确认')
  await expect(page.locator('main').getByRole('alert')).toContainText('未刷盘')
  await click(page, '刷盘 WAL'); await click(page, '向客户端确认'); await click(page, '模拟进程崩溃'); await click(page, '从本地磁盘重启')
  await expect(page.getByTestId('durable-phase')).toHaveText('recovering')
  await expect(page.getByTestId('experiment-save-status')).toHaveText('当前操作已保存'); await page.reload()
  await click(page, '重放下一条记录'); await expect(page.getByTestId('durable-value')).toHaveText('0'); await click(page, '重放下一条记录'); await durableAnswer(page, '1', '1', '0')
  await expect(page.getByTestId('experiment-feedback')).toContainText('本关实验验证通过')
  for (const [scenario, value, applied, missing] of [['日志有更新但没有提交', '1', '1', '0'], ['检查点之后的日志重放', '3', '2', '0'], ['恢复到较早提交边界', '1', '1', '1'], ['归档损坏与备用副本', '3', '2', '0']]) {
    await click(page, scenario!); await click(page, '运行完整实验示例'); await durableAnswer(page, value!, applied!, missing!)
    await expect(page.getByTestId('experiment-feedback')).toContainText('本关实验验证通过')
  }
  await expect(page.getByLabel('实验学习进度')).toContainText('5 / 5')
  await expect(page.getByRole('table', { name: '完整消息事件表', exact: true })).toContainText('恢复材料无效')
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.locator('main').evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/durability-mobile.png' })
  expect(errors).toEqual([])
})
