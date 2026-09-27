import { expect,test,type Page } from '@playwright/test'
async function save(page:Page,reads:string){await page.getByLabel('实验预测',{exact:true}).selectOption('unknown');await page.getByLabel('逻辑读取次数作答').fill(reads);await page.getByLabel('实际回源次数作答').fill('2');await page.getByLabel('过时读取次数作答').fill('0');await page.getByLabel('缓存保证的边界').selectOption('freshness-and-inflight');await page.getByRole('button',{name:'核对并保存实验',exact:true}).click();await expect(page.getByTestId('experiment-feedback')).toContainText('本关实验验证通过');await expect(page.getByTestId('experiment-save-status')).toHaveText('当前操作已保存')}
test('explains stale fills and request coalescing through actual reads and restores evidence',async({page})=>{
  await page.goto('/learn/caching');await page.locator('#labs a[href="/practice/cache-coherence"]').click();await expect(page.getByTestId('experiment-save-status')).toHaveText('当前操作已保存')
  const run=page.getByRole('button',{name:'运行完整实验示例',exact:true});await run.click();await expect(page.getByTestId('coherence-stale')).toHaveText('1')
  await page.getByLabel('缓存更新策略').selectOption('invalidate');await run.click();await save(page,'2')
  await page.getByRole('button',{name:'迟到的旧回填',exact:true}).click();await run.click();await expect(page.getByTestId('coherence-stale')).toHaveText('1')
  await page.getByLabel('缓存更新策略').selectOption('versioned');await run.click();await save(page,'2')
  await page.getByRole('button',{name:'同时过期与回源',exact:true}).click();await run.click();await expect(page.getByTestId('coherence-origin')).toHaveText('4')
  await page.getByLabel('同键在途合并').selectOption('true');await run.click();await expect(page.getByTestId('coherence-origin')).toHaveText('2');await save(page,'4')
  await page.reload();await expect(page.getByLabel('实验学习进度',{exact:true})).toContainText('3 / 3')
  await page.goto('/learn/sync-async-boundaries');await expect(page.getByRole('region',{name:'从需求选择机制'})).toContainText('有限排队与背压');await expect(page.locator('#labs a[href="/practice/ack-checkpoint"]')).toBeVisible()
})
