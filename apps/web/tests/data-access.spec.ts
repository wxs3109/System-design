import { expect, test, type Page } from '@playwright/test'
async function save(page:Page, rows:string, examined:string) {
  await page.getByLabel('实验预测',{exact:true}).selectOption('unknown')
  await page.getByLabel('末次返回记录数').fill(rows); await page.getByLabel('末次读取记录数').fill(examined); await page.getByLabel('历史不完整查询数').fill('0')
  await page.getByLabel('访问路径选择依据').selectOption('access-and-maintenance'); await page.getByRole('button',{name:'核对并保存实验',exact:true}).click()
  await expect(page.getByTestId('experiment-feedback')).toContainText('本关实验验证通过'); await expect(page.getByTestId('experiment-save-status')).toHaveText('当前操作已保存')
}
test('chooses paths for point/range/update/payload demands without hiding stale results',async({page})=>{
  await page.goto('/learn/storage-access-patterns'); await page.locator('#labs a[href="/practice/data-access-paths"]').click()
  await expect(page.getByTestId('experiment-save-status')).toHaveText('当前操作已保存')
  const run=page.getByRole('button',{name:'运行完整实验示例',exact:true})
  await run.click(); await expect(page.getByTestId('access-examined')).toHaveText('16')
  await page.getByLabel('访问路径',{exact:true}).selectOption('primary'); await run.click(); await expect(page.getByTestId('access-examined')).toHaveText('1'); await save(page,'1','1')
  await page.getByRole('button',{name:'按用户和时间列出',exact:true}).click(); await page.getByLabel('访问路径',{exact:true}).selectOption('ordered'); await run.click(); await save(page,'4','4')
  await page.getByRole('button',{name:'更新后的索引',exact:true}).click(); await page.getByLabel('访问路径',{exact:true}).selectOption('ordered'); await page.getByLabel('二级索引维护').selectOption('deferred'); await run.click(); await expect(page.getByTestId('access-wrong')).toHaveText('1')
  await page.getByLabel('二级索引维护').selectOption('inline'); await run.click(); await save(page,'5','5')
  await page.getByRole('button',{name:'只需要元数据',exact:true}).click(); await page.getByLabel('访问路径',{exact:true}).selectOption('ordered'); await page.getByLabel('记录载荷布局').selectOption('split'); await run.click(); await save(page,'4','4')
  await page.reload(); await expect(page.getByLabel('实验学习进度',{exact:true})).toContainText('4 / 4')
  await page.setViewportSize({width:390,height:844}); expect(await page.locator('main').evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true)
})
