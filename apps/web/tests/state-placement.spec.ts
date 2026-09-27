import { expect,test,type Page } from '@playwright/test'
async function save(page:Page,good:string,bad:string){await page.getByLabel('实验预测',{exact:true}).selectOption('unknown');await page.getByLabel('正确连续读取次数').fill(good);await page.getByLabel('未满足连续性次数').fill(bad);await page.getByLabel('确认值缺失数').fill('0');await page.getByLabel('状态扩展边界').selectOption('state-owner');await page.getByRole('button',{name:'核对并保存实验',exact:true}).click();await expect(page.getByTestId('experiment-feedback')).toContainText('本关实验验证通过');await expect(page.getByTestId('experiment-save-status')).toHaveText('当前操作已保存')}
test('observes routing, process loss and shared recovery before selecting guarantees',async({page})=>{
  await page.goto('/learn/state-and-scaling');await page.locator('#labs a[href="/practice/state-placement"]').click();await expect(page.getByTestId('experiment-save-status')).toHaveText('当前操作已保存')
  const run=page.getByRole('button',{name:'运行完整实验示例',exact:true});await run.click();await expect(page.getByTestId('placement-bad')).toHaveText('1')
  await page.getByLabel('会话路由').selectOption('sticky');await run.click();await save(page,'2','0')
  await page.getByRole('button',{name:'服务实例崩溃',exact:true}).click();await run.click();await expect(page.getByTestId('placement-missing')).toHaveText('1')
  await page.getByLabel('会话状态位置').selectOption('shared');await run.click();await save(page,'2','0')
  await page.getByRole('button',{name:'共享存储重启',exact:true}).click();await run.click();await expect(page.getByTestId('placement-bad')).toHaveText('2')
  await page.getByLabel('共享状态确认条件').selectOption('stable');await run.click();await save(page,'1','1')
  await page.reload();await expect(page.getByLabel('实验学习进度',{exact:true})).toContainText('3 / 3')
  await page.setViewportSize({width:390,height:844});expect(await page.locator('main').evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true)
})
