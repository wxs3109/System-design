import type { runNewsFeed } from '../models/news-feed'
import type { ProductView } from '../product-types'
import { messageFormatter, type MessageFormatters } from './format'

const messages: MessageFormatters = {
  'news-feed.observation-001': () => "写入服务不可用或达到 16 篇上限；未产生帖子。",
  'news-feed.observation-002': (values) => String("" + text(values[0]) + " 已提交到作者日志，进程在发布前崩溃；" + text((values[1] ? "持久发送意图仍存在" : "没有发送意图")) + "。"),
  'news-feed.observation-003': (values) => String("" + text(values[0]) + " 已发布；" + text((values[1] ? "需要向 " + text(values[2]) + " 个收件箱分发" : "读取时合并作者日志")) + "。"),
  'news-feed.observation-004': () => "写入进程恢复；不会凭空补出缺失的发送意图。",
  'news-feed.observation-005': (values) => String("独立发布器读取持久 Outbox，发送 " + text(values[0]) + " 个分发任务。本步假设 broker 确认成功。"),
  'news-feed.observation-006': (values) => String("消费 " + text(values[0]) + " 个收件人工作项；剩余 " + text(values[1]) + " 个帖子分发任务。"),
  'news-feed.observation-007': (values) => String("" + text(values[0]) + " 同一业务事件再次投递，保留原 postId。"),
  'news-feed.observation-008': () => "当前方案没有需要分发的帖子；没有伪造分发任务。",
  'news-feed.observation-009': (values) => String("" + text(values[0]) + " 在作者存储中标记删除，收件箱中的旧 ID 尚未清理。"),
  'news-feed.observation-010': () => "没有可删除的普通作者帖子。",
  'news-feed.observation-011': (values) => String("" + text(values[0]) + " 读取 [" + text(list(values[1], ', ')) + "]；当前作者日志与关注关系对应 [" + text(list(values[2], ', ')) + "]。"),
}
const { text, list, format } = messageFormatter(messages)

export function presentNewsFeed(result: ReturnType<typeof runNewsFeed>): ProductView {
  const { posts, inbox, intents, jobs, reads } = result.state
  return { events: result.events.map((e) => ({ step: e.step, action: e.action, detail: e.messages.map(format).join('') })), tables: [
      { title: '作者日志（权威数据）', columns: ['Post ID', '作者', '版本顺序', '删除'], rows: posts.map((p) => [p.id, p.author, p.sequence, p.deleted ? '是' : '否']) },
      { title: '物化收件箱', columns: ['用户', 'Post IDs'], rows: Object.entries(inbox).map(([user, ids]) => [user, ids.join(', ') || '空']) },
      { title: '分发任务', columns: ['来源', 'Post ID', '进度'], rows: [...intents.map((id) => ['Outbox', id, '未发布']), ...jobs.map((j) => ['队列', j.postId, j.cursor])] },
      { title: '读取证据', columns: ['用户', '实际结果', '对照结果'], rows: reads.map((r) => [r.reader, r.actual.join(', ') || '空', r.expected.join(', ') || '空']) },
    ] }
}
