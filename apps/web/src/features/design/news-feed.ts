import { check, choice, type DesignConfig, type DesignEvent, type ProductDesign, type ProductResult } from './product-types'

export function runNewsFeed(config: DesignConfig, commands: readonly string[]): ProductResult {
  interface Post { id: string; author: string; sequence: number; deleted: boolean }
  const posts: Post[] = []
  const followers: Record<string, string[]> = { friend: ['u1', 'u2'], celebrity: Array.from({ length: 12 }, (_, i) => `u${i + 1}`) }
  const inbox = Object.fromEntries(followers.celebrity!.map((id) => [id, [] as string[]]))
  const intents: string[] = []
  const jobs: { postId: string; cursor: number }[] = []
  const reads: { reader: string; actual: string[]; expected: string[] }[] = []
  const events: DesignEvent[] = []
  let online = true; let writes = 0; let examined = 0; let attempts = 0; let duplicateSkips = 0; let deleted = 0; let commitGaps = 0; let redeliveries = 0
  const isPushed = (post: Post) => config.strategy === 'push' || (config.strategy === 'hybrid' && followers[post.author]!.length <= 4)
  const deliver = (budget: number) => {
    let work = 0
    while (jobs.length && work < budget) {
      const job = jobs[0]!; const post = posts.find((p) => p.id === job.postId)!
      const audience = followers[post.author]!
      const reader = audience[job.cursor++]!
      attempts++; work++
      if (config.dedup === 'on' && inbox[reader]!.includes(post.id)) duplicateSkips++
      else { inbox[reader]!.push(post.id); writes++ }
      if (job.cursor >= audience.length) jobs.shift()
    }
    return work
  }
  for (const [index, command] of commands.entries()) {
    let detail = ''
    if (command === 'publish-friend' || command === 'publish-celebrity' || command === 'publish-gap') {
      if (!online || posts.length >= 16) detail = '写入服务不可用或达到 16 篇上限；未产生帖子。'
      else {
        const author = command === 'publish-celebrity' ? 'celebrity' : 'friend'
        const post: Post = { id: `p${posts.length + 1}`, author, sequence: posts.length + 1, deleted: false }
        posts.push(post)
        if (isPushed(post) && config.outbox === 'atomic') intents.push(post.id)
        if (command === 'publish-gap') { online = false; commitGaps++; detail = `${post.id} 已提交到作者日志，进程在发布前崩溃；${intents.includes(post.id) ? '持久发送意图仍存在' : '没有发送意图'}。` }
        else { if (isPushed(post) && config.outbox === 'direct') jobs.push({ postId: post.id, cursor: 0 }); detail = `${post.id} 已发布；${isPushed(post) ? `需要向 ${followers[author]!.length} 个收件箱分发` : '读取时合并作者日志'}。` }
      }
    } else if (command === 'restart') { online = true; detail = '写入进程恢复；不会凭空补出缺失的发送意图。' }
    else if (command === 'relay') {
      const count = intents.length
      for (const id of intents.splice(0)) jobs.push({ postId: id, cursor: 0 })
      detail = `独立发布器读取持久 Outbox，发送 ${count} 个分发任务。本步假设 broker 确认成功。`
    } else if (command === 'deliver' || command === 'drain') detail = `消费 ${deliver(command === 'deliver' ? 4 : 192)} 个收件人工作项；剩余 ${jobs.length} 个帖子分发任务。`
    else if (command === 'redeliver') {
      const post = posts.filter(isPushed).at(-1)
      redeliveries++
      if (post) { jobs.push({ postId: post.id, cursor: 0 }); detail = `${post.id} 同一业务事件再次投递，保留原 postId。` }
      else detail = '当前方案没有需要分发的帖子；没有伪造分发任务。'
    } else if (command === 'delete-friend') {
      const post = posts.find((p) => p.author === 'friend' && !p.deleted)
      if (post) { post.deleted = true; deleted++; detail = `${post.id} 在作者存储中标记删除，收件箱中的旧 ID 尚未清理。` } else detail = '没有可删除的普通作者帖子。'
    } else if (command === 'read' || command === 'read-outsider') {
      const reader = command === 'read' ? 'u1' : 'u12'
      const followed = Object.keys(followers).filter((author) => followers[author]!.includes(reader))
      const pushed = inbox[reader]!.map((id) => posts.find((p) => p.id === id)!)
      const pulled = posts.filter((p) => followed.includes(p.author) && !isPushed(p) && !p.deleted)
      examined += pushed.length + posts.filter((p) => followed.includes(p.author) && !isPushed(p)).length
      const candidates = [...pushed, ...pulled].filter((p) => config.hydrate !== 'source' || (!p.deleted && followed.includes(p.author)))
      const actual = candidates.sort((a, b) => b.sequence - a.sequence).map((p) => p.id)
      const expected = posts.filter((p) => !p.deleted && followed.includes(p.author)).sort((a, b) => b.sequence - a.sequence).map((p) => p.id)
      reads.push({ reader, actual, expected }); detail = `${reader} 读取 [${actual.join(', ')}]；当前作者日志与关注关系对应 [${expected.join(', ')}]。`
    } else throw new Error(`Unknown feed action: ${command}`)
    events.push({ step: index + 1, action: command, detail })
  }
  const last = reads.filter((r) => r.reader === 'u1').at(-1)
  const outsider = reads.filter((r) => r.reader === 'u12').at(-1)
  const correct = (read: typeof last) => !!read && JSON.stringify(read.actual) === JSON.stringify(read.expected)
  return {
    events,
    metrics: { posts: posts.length, celebrityPosts: posts.filter((p) => p.author === 'celebrity').length, ordinaryPosts: posts.filter((p) => p.author === 'friend').length, fanoutWrites: writes, deliveryAttempts: attempts, duplicateSkips, readExamined: examined, pending: jobs.reduce((sum, j) => sum + followers[posts.find((p) => p.id === j.postId)!.author]!.length - j.cursor, 0) + intents.length, reads: reads.length, correctRead: Number(correct(last)), correctOutsider: Number(correct(outsider)), deleted, commitGaps, redeliveries },
    tables: [
      { title: '作者日志（权威数据）', columns: ['Post ID', '作者', '版本顺序', '删除'], rows: posts.map((p) => [p.id, p.author, p.sequence, p.deleted ? '是' : '否']) },
      { title: '物化收件箱', columns: ['用户', 'Post IDs'], rows: Object.entries(inbox).map(([user, ids]) => [user, ids.join(', ') || '空']) },
      { title: '分发任务', columns: ['来源', 'Post ID', '进度'], rows: [...intents.map((id) => ['Outbox', id, '未发布']), ...jobs.map((j) => ['队列', j.postId, j.cursor])] },
      { title: '读取证据', columns: ['用户', '实际结果', '对照结果'], rows: reads.map((r) => [r.reader, r.actual.join(', ') || '空', r.expected.join(', ') || '空']) },
    ],
  }
}

const settled = (r: ProductResult) => [check('读结果正确', r.metrics.correctRead === 1, '最后一次 u1 读取必须与当时作者日志、关注关系、删除状态和顺序一致。'), check('待处理工作排空', r.metrics.pending === 0, `剩余 ${r.metrics.pending} 项；不能只读到局部结果便结束。`)]
export const newsFeedDesign: ProductDesign = {
  id: 'design-news-feed', kind: 'product-design', category: '综合设计', difficulty: '进阶', estimatedMinutes: 40,
  title: 'News Feed 设计：分发与名人热点', summary: '实际发布帖子、分发收件箱并读取 Feed，比较推、拉和混合策略，重现双写中断与重复投递。',
  pains: ['普通用户和名人的粉丝数差异巨大，统一推送会制造写放大。', '帖子提交和分发事件发送之间崩溃，可能让关注者永远看不到帖子。', '重投可能造成重复内容；只读旧收件箱还可能展示已经删除的帖子。'],
  requirements: ['按关注关系返回倒序 Feed，不能重复或混入未关注作者。', '普通作者有 2 个关注者，名人有 12 个；固定小数据集用于逐项检查。', '热点关要求完整结果且最多 6 次物化收件箱写入；容量单位是工作项，不是生产 QPS。', '发布中断后能够恢复可见性；重复事件不改变业务结果；删除后的读取不返回旧内容。'],
  contracts: [{ name: 'POST /posts → postId', description: '作者日志是事实来源；需要分发时，决定是否将发送意图与帖子一起提交。' }, { name: 'GET /feed?cursor', description: '本关以发布序号倒序合并有限帖子。真实分页游标、推荐排序和权限系统未实现。' }, { name: 'Post / Follow / Inbox / Outbox', description: 'Inbox 存 postId；同一 Post ID 的重投与另一篇新帖子是不同情况。' }],
  decisions: ['推送节省了什么读取工作，为什么名人不一定适合推送？', '拉取方案无需物化分发，发布中断还会导致同样的缺失吗？', '收件箱保留旧 ID 时，应在何处执行删除和可见性判断？'],
  boundary: ['12 个读者、最多 16 篇帖子、120 步；单个权威作者日志与固定关注关系，不实现推荐模型或真实消息系统。', '每个分发步骤实际推进收件人队列，写放大来自真实收件箱写入。一个普通步骤处理 4 项，排空操作最多处理 192 项。', 'Outbox 本地提交视为原子；发布器确认窗口的更细交错在基础消息 Lab 中研究。这里允许显式重投同一个事件。', '最终读结果与权威数据逐项比较；通过有限场景不证明生产系统在所有故障下正确。'],
  relatedLabs: [{ id: 'transactional-outbox', title: 'Transactional Outbox' }, { id: 'ack-checkpoint', title: 'ACK 与 Checkpoint' }, { id: 'hot-key', title: 'Hot Key' }],
  fields: [
    { id: 'strategy', label: '分发策略', options: [choice('push', '全部推送'), choice('pull', '读取时拉取'), choice('hybrid', '混合：普通推送，名人拉取')] },
    { id: 'outbox', label: '发布可靠性', options: [choice('direct', '提交后直接发送'), choice('atomic', '帖子与 Outbox 原子提交')] },
    { id: 'dedup', label: '收件箱写入', options: [choice('off', '每次投递直接追加'), choice('on', '按用户 + Post ID 去重')] },
    { id: 'hydrate', label: '读取可见性', options: [choice('timeline', '相信收件箱旧条目'), choice('source', '按作者存储校验删除与关注')] },
  ],
  initialConfig: { strategy: 'push', outbox: 'direct', dedup: 'off', hydrate: 'timeline' },
  metricLabels: [{ key: 'posts', label: '已提交帖子' }, { key: 'fanoutWrites', label: '收件箱写入' }, { key: 'readExamined', label: '读取检查条目' }, { key: 'pending', label: '待处理工作' }, { key: 'duplicateSkips', label: '跳过的重复写入' }],
  actions: { 'publish-friend': '普通作者发布', 'publish-celebrity': '名人发布', 'publish-gap': '提交帖子后、发送前崩溃', restart: '恢复发布进程', relay: '发送 Outbox', deliver: '消费 4 个收件人', drain: '排空分发队列', redeliver: '重复投递最后一个分发事件', 'delete-friend': '删除普通作者帖子', read: 'u1 读取 Feed', 'read-outsider': 'u12 读取 Feed' },
  scenarios: [
    { id: 'celebrity', title: '名人写放大', goal: '两位作者各发布一篇，正确服务两类读者；物化写入最多 6 次。', script: ['publish-friend', 'publish-celebrity', 'relay', 'drain', 'read', 'read-outsider'], check: (r) => [...settled(r), check('覆盖两类作者', r.metrics.ordinaryPosts! > 0 && r.metrics.celebrityPosts! > 0, `${r.metrics.ordinaryPosts} 篇普通帖子、${r.metrics.celebrityPosts} 篇名人帖子。`), check('关注边界', r.metrics.correctOutsider === 1, 'u12 只关注名人，结果必须与该关系一致。'), check('物化写入预算', r.metrics.fanoutWrites! <= 6, `实际 ${r.metrics.fanoutWrites} 次；目标 ≤ 6。`)] },
    { id: 'gap', title: '提交与发布中断', goal: '帖子提交后崩溃，恢复后读者仍能读到它。', script: ['publish-gap', 'restart', 'relay', 'drain', 'read'], check: (r) => [...settled(r), check('真实崩溃窗口', r.metrics.commitGaps! > 0 && r.metrics.posts! > 0, `${r.metrics.commitGaps} 次提交后崩溃，${r.metrics.posts} 篇已提交帖子。`)] },
    { id: 'duplicate', title: '同一事件重投', goal: '同一分发事件再次消费，Feed 中不重复。', script: ['publish-friend', 'relay', 'drain', 'redeliver', 'drain', 'read'], check: (r) => [...settled(r), check('重投场景', r.metrics.redeliveries! > 0 && r.metrics.posts! > 0, `已执行 ${r.metrics.redeliveries} 次重投检查。`)] },
    { id: 'deletion', title: '删除与旧收件箱', goal: '删除作者日志中的帖子后，即使收件箱留有旧 ID，也不再返回。', script: ['publish-friend', 'relay', 'drain', 'delete-friend', 'read'], check: (r) => [...settled(r), check('删除已发生', r.metrics.deleted! > 0, `${r.metrics.deleted} 篇已删除。`)] },
  ],
  alternatives: [
    { title: '全部推送 + 可靠分发', config: { strategy: 'push', outbox: 'atomic', dedup: 'on', hydrate: 'source' } },
    { title: '混合分发 + 可靠分发', config: { strategy: 'hybrid', outbox: 'atomic', dedup: 'on', hydrate: 'source' } },
    { title: '读取时拉取', config: { strategy: 'pull', outbox: 'direct', dedup: 'off', hydrate: 'source' } },
  ],
  architecture: (c) => c.strategy === 'pull' ? ['作者 API → 作者日志', 'Feed API → 关注关系 → 拉取作者日志 → 合并排序'] : ['作者 API → 作者日志' + (c.outbox === 'atomic' ? ' + Outbox' : ''), '发布器 → 分发队列 → 收件箱', `Feed API → 收件箱${c.strategy === 'hybrid' ? ' + 名人作者日志' : ''} → ${c.hydrate === 'source' ? '校验可见性 → ' : ''}合并排序`],
  run: runNewsFeed,
}
