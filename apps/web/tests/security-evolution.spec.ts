import { expect,test,type Page } from '@playwright/test'
async function confirm(page:Page,answers:Record<string,string>,reasonLabel:string,reason:string){await page.getByLabel('实验预测',{exact:true}).selectOption('unknown');for(const [label,value] of Object.entries(answers))await page.getByLabel(label,{exact:true}).fill(value);await page.getByLabel(reasonLabel,{exact:true}).selectOption(reason);await page.getByRole('button',{name:'核对并保存实验',exact:true}).click();await expect(page.getByTestId('experiment-feedback')).toContainText('本关实验验证通过');await expect(page.getByTestId('experiment-save-status')).toHaveText('当前操作已保存')}
test('binds permissions to objects and observes revocation rather than trusting cached identity',async({page})=>{
  await page.goto('/learn/security-boundaries');await page.locator('#labs a[href="/practice/authorization-boundaries"]').click();await expect(page.getByTestId('experiment-save-status')).toHaveText('当前操作已保存')
  const run=page.getByRole('button',{name:'运行完整实验示例',exact:true});const answers={'授权读取次数':'4','错误授权决定数':'0','权威授权检查次数':'3'}
  await run.click();await expect(page.getByTestId('auth-wrong')).toHaveText('1');await page.getByLabel('授权检查范围').selectOption('resource');await run.click();await confirm(page,answers,'授权边界解释','resource-and-revocation')
  await page.getByRole('button',{name:'撤销后的旧授权',exact:true}).click();await run.click();await expect(page.getByTestId('auth-wrong')).toHaveText('1');await page.getByLabel('授权缓存策略').selectOption('version');await run.click();await confirm(page,answers,'授权边界解释','resource-and-revocation')
  await page.getByRole('button',{name:'授权缓存的键',exact:true}).click();await run.click();await expect(page.getByTestId('auth-wrong')).toHaveText('1');await page.getByLabel('授权缓存键').selectOption('resource');await run.click();await confirm(page,answers,'授权边界解释','resource-and-revocation')
  await page.reload();await expect(page.getByLabel('实验学习进度',{exact:true})).toContainText('3 / 3')
})
test('protects a small tenant with both admission and scheduling while exposing rejected work',async({page})=>{
  await page.goto('/practice/tenant-isolation');await expect(page.getByTestId('experiment-save-status')).toHaveText('当前操作已保存');const run=page.getByRole('button',{name:'运行完整实验示例',exact:true});const answers={'A 完成数作答':'3','B 完成数作答':'2','全部拒绝数作答':'5'}
  await run.click();await expect(page.getByTestId('tenant-B')).toHaveText('0 / 2');await page.getByLabel('队列接纳策略').selectOption('reserved');await run.click();await confirm(page,answers,'租户保护依据','admission-and-scheduling')
  await page.getByRole('button',{name:'接纳后仍可能等太久',exact:true}).click();await run.click();await page.getByRole('button',{name:'核对并保存实验',exact:true}).click();await expect(page.getByTestId('experiment-feedback')).toContainText('运行目标尚未满足')
  await page.getByLabel('租户调度策略').selectOption('round-robin');await run.click();await confirm(page,answers,'租户保护依据','admission-and-scheduling')
  await page.reload();await expect(page.getByLabel('实验学习进度',{exact:true})).toContainText('2 / 2')
})
test('checks per-version errors and validates data compatibility before rollback',async({page})=>{
  await page.goto('/learn/safe-evolution-design');await page.locator('#labs a[href="/practice/safe-evolution"]').click();await expect(page.getByTestId('experiment-save-status')).toHaveText('当前操作已保存');const run=page.getByRole('button',{name:'运行完整实验示例',exact:true})
  const answers=(a:string,b:string)=>({'旧读者正确次数':a,'旧读者总次数':a,'新读者正确次数':b,'新读者总次数':b})
  await run.click();await expect(page.getByTestId('evolution-new')).toHaveText('0 / 2');await page.getByLabel('v2 读取兼容策略').selectOption('compatible');await run.click();await confirm(page,answers('8','2'),'安全演进依据','compatibility-before-rollback')
  await page.getByRole('button',{name:'回滚遇到新写入',exact:true}).click();await run.click();await expect(page.getByTestId('evolution-old')).toHaveText('0 / 1');await page.getByLabel('v2 写入格式').selectOption('dual');await run.click();await confirm(page,answers('1','1'),'安全演进依据','compatibility-before-rollback')
  await page.getByRole('button',{name:'迁移时的新旧共存',exact:true}).click();await page.getByLabel('字段迁移策略').selectOption('expand');await run.click();await confirm(page,answers('1','1'),'安全演进依据','compatibility-before-rollback')
  await page.reload();await expect(page.getByLabel('实验学习进度',{exact:true})).toContainText('3 / 3');await page.setViewportSize({width:390,height:844});expect(await page.locator('main').evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true)
})
