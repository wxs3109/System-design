export type ProducerMode = 'direct' | 'outbox'
export type ConsumerMode = 'early' | 'split' | 'atomic'
export const consumerLabels: Record<ConsumerMode, string> = { early: '收到就 ACK', split: '效果与 Checkpoint 分开提交', atomic: '效果 + Checkpoint 原子提交' }
export const producerLabels: Record<ProducerMode, string> = { direct: '写任务后直接发布', outbox: '任务 + Outbox 原子提交' }
export interface Config { modelVersion: 'message-flow-v1'; producer: ProducerMode; consumer: ConsumerMode; visibilityMs: number; maxDeliveries: number; prefetch: number }
export const defaultConfig = (): Config => ({ modelVersion: 'message-flow-v1', producer: 'direct', consumer: 'split', visibilityMs: 500, maxDeliveries: 3, prefetch: 1 })
export interface Task { id: string; messageId: string; sequence: number; createdAt: number }
export interface OutboxRecord { messageId: string; taskId: string; status: 'pending' | 'sent' }
export interface Publication { id: string; messageId: string; taskId: string; epoch: number; status: 'network' | 'accepted' | 'dropped'; confirm: 'none' | 'network' | 'delivered' | 'dropped' | 'ignored' }
export interface Copy { id: string; messageId: string; taskId: string; sequence: number; status: 'pending' | 'in-flight' | 'acked' | 'dead-letter'; activeDelivery: string | null; attempts: number; totalAttempts: number; redrives: number }
export interface Delivery { id: string; copyId: string; messageId: string; taskId: string; sequence: number; expiresAt: number; status: 'in-flight' | 'acked' | 'expired'; location: 'network' | 'worker' | 'gone'; epoch: number | null; work: 'todo' | 'effect' | 'checkpoint' | 'replayed' | 'failed' }
export interface Ack { id: string; deliveryId: string; status: 'network' | 'delivered' | 'dropped' | 'ignored' }
export interface Effect { id: string; messageId: string; deliveryId: string; taskId: string; at: number }
export interface Checkpoint { messageId: string; sequence: number; taskId: string; at: number }
export interface Event { index: number; at: number; kind: string; from: Actor; to: Actor; subject: string | null; detail: string }
export type Actor = 'producer' | 'broker' | 'worker' | 'store'
export interface State {
  now: number; producerOnline: boolean; producerEpoch: number; workerOnline: boolean; workerEpoch: number; consuming: boolean
  tasks: Task[]; outbox: OutboxRecord[]; publications: Publication[]; copies: Copy[]; deliveries: Delivery[]; acks: Ack[]
  effects: Effect[]; checkpoints: Checkpoint[]; events: Event[]
}
export type Command =
  | { type: 'create-task' | 'relay' | 'start-consumer' | 'pause-consumer' | 'crash-worker' | 'restart-worker' | 'crash-producer' | 'restart-producer' }
  | { type: 'publish'; taskId: string }
  | { type: 'accept-publication' | 'drop-publication' | 'deliver-confirm' | 'drop-confirm' | 'mark-sent'; publicationId: string }
  | { type: 'deliver-work' | 'drop-work' | 'process' | 'checkpoint' | 'resend-ack' | 'fail-work'; deliveryId: string }
  | { type: 'deliver-ack' | 'drop-ack'; ackId: string }
  | { type: 'redrive'; copyId: string }
  | { type: 'advance'; ms: number }
export const MAX_COMMANDS = 150
export const MAX_TIME = 120000
export const MAX_TOTAL_DELIVERIES = 30
export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9-]{1,60}$/.test(value)
export function parseConfig(value: unknown): Config {
  const c = value as Config | null
  if (!c || c.modelVersion !== 'message-flow-v1' || !['direct', 'outbox'].includes(c.producer) || !['early', 'split', 'atomic'].includes(c.consumer)) throw new Error('未知消息模型或策略。')
  if (![100, 500, 1000].includes(c.visibilityMs) || ![2, 3, 5].includes(c.maxDeliveries) || ![1, 2].includes(c.prefetch)) throw new Error('消息参数超出范围。')
  return { modelVersion: c.modelVersion, producer: c.producer, consumer: c.consumer, visibilityMs: c.visibilityMs, maxDeliveries: c.maxDeliveries, prefetch: c.prefetch }
}
export function parseCommand(value: unknown): Command {
  if (!value || typeof value !== 'object') throw new Error('消息操作无效。')
  const c = value as Command
  switch (c.type) {
    case 'create-task': case 'relay': case 'start-consumer': case 'pause-consumer': case 'crash-worker': case 'restart-worker': case 'crash-producer': case 'restart-producer': return { type: c.type }
    case 'publish': if (!identifier(c.taskId)) throw new Error('任务 ID 无效。'); return { type: c.type, taskId: c.taskId }
    case 'accept-publication': case 'drop-publication': case 'deliver-confirm': case 'drop-confirm': case 'mark-sent':
      if (!identifier(c.publicationId)) throw new Error('发布 ID 无效。'); return { type: c.type, publicationId: c.publicationId }
    case 'deliver-work': case 'drop-work': case 'process': case 'checkpoint': case 'resend-ack': case 'fail-work':
      if (!identifier(c.deliveryId)) throw new Error('投递 ID 无效。'); return { type: c.type, deliveryId: c.deliveryId }
    case 'deliver-ack': case 'drop-ack': if (!identifier(c.ackId)) throw new Error('ACK ID 无效。'); return { type: c.type, ackId: c.ackId }
    case 'redrive': if (!identifier(c.copyId)) throw new Error('队列副本 ID 无效。'); return { type: c.type, copyId: c.copyId }
    case 'advance': if (!Number.isInteger(c.ms) || c.ms < 1 || c.ms > MAX_TIME) throw new Error('时间推进无效。'); return { type: c.type, ms: c.ms }
    default: throw new Error('未知消息操作。')
  }
}
export const initialState = (): State => ({ now: 0, producerOnline: true, producerEpoch: 1, workerOnline: true, workerEpoch: 1, consuming: true, tasks: [], outbox: [], publications: [], copies: [], deliveries: [], acks: [], effects: [], checkpoints: [], events: [] })
function event(s: State, kind: string, from: Actor, to: Actor, detail: string, subject: string | null = null) { s.events.push({ index: s.events.length + 1, at: s.now, kind, from, to, subject, detail }) }
export function contiguousCheckpoint(s: State): number {
  const done = new Set(s.checkpoints.map((checkpoint) => checkpoint.sequence))
  let position = 0
  while (done.has(position + 1)) position++
  return position
}
export const nextTimer = (s: State): number | null => {
  const active = s.deliveries.filter((d) => d.status === 'in-flight')
  return active.length ? Math.min(...active.map((d) => d.expiresAt)) : null
}
/** Broker credit depends on active receipts, not producer activity. An expired
 * receipt does not cancel a Worker that may still be executing. */
function pump(s: State, c: Config) {
  while (s.consuming && s.deliveries.filter((d) => d.status === 'in-flight').length < c.prefetch && s.deliveries.length < MAX_TOTAL_DELIVERIES) {
    const copy = s.copies.find((item) => item.status === 'pending')
    if (!copy) break
    const id = `delivery-${s.deliveries.length + 1}`
    copy.status = 'in-flight'; copy.activeDelivery = id; copy.attempts++; copy.totalAttempts++
    s.deliveries.push({ id, copyId: copy.id, messageId: copy.messageId, taskId: copy.taskId, sequence: copy.sequence, expiresAt: s.now + c.visibilityMs, status: 'in-flight', location: 'network', epoch: null, work: 'todo' })
    event(s, 'dispatch', 'broker', 'worker', `${copy.messageId} 的第 ${copy.totalAttempts} 次投递 ${id} 已发出；凭据有效至 ${s.now + c.visibilityMs} ms。`, id)
  }
}
function sendAck(s: State, d: Delivery) {
  if (s.acks.some((ack) => ack.deliveryId === d.id && ack.status === 'network')) return
  const id = `ack-${s.acks.length + 1}`
  s.acks.push({ id, deliveryId: d.id, status: 'network' })
  event(s, 'ack-sent', 'worker', 'broker', `${id} 已发送，只确认投递凭据 ${d.id}；尚未到达 broker。`, id)
}
function publish(s: State, task: Task) {
  if (!s.producerOnline) throw new Error('生产者已离线。')
  if (s.publications.length >= 12) throw new Error('已达到发布次数上限。')
  const id = `publication-${s.publications.length + 1}`
  s.publications.push({ id, messageId: task.messageId, taskId: task.id, epoch: s.producerEpoch, status: 'network', confirm: 'none' })
  event(s, 'publish-sent', 'producer', 'broker', `发送 ${id}，逻辑消息身份保持为 ${task.messageId}。`, id)
}
function workerDelivery(s: State, id: string) {
  const d = s.deliveries.find((delivery) => delivery.id === id)
  if (!d || !s.workerOnline || d.location !== 'worker' || d.epoch !== s.workerEpoch) throw new Error('当前 Worker 没有这份可操作的本地投递。')
  return d
}
function appendEffect(s: State, d: Delivery) {
  s.effects.push({ id: `effect-${s.effects.length + 1}`, messageId: d.messageId, deliveryId: d.id, taskId: d.taskId, at: s.now })
}
function saveCheckpoint(s: State, d: Delivery) {
  if (!s.checkpoints.some((checkpoint) => checkpoint.messageId === d.messageId)) s.checkpoints.push({ messageId: d.messageId, sequence: d.sequence, taskId: d.taskId, at: s.now })
}
function apply(s: State, c: Config, command: Command) {
  switch (command.type) {
    case 'create-task': {
      if (!s.producerOnline || s.tasks.length >= 3) throw new Error('生产者离线或已达到 3 个任务的上限。')
      const sequence = s.tasks.length + 1
      const task: Task = { id: `task-${sequence}`, messageId: `event-${sequence}`, sequence, createdAt: s.now }
      s.tasks.push(task)
      if (c.producer === 'outbox') s.outbox.push({ taskId: task.id, messageId: task.messageId, status: 'pending' })
      event(s, 'task-commit', 'producer', 'store', c.producer === 'outbox' ? `原子提交 ${task.id} 与发送意图 ${task.messageId}；尚未发布到 broker。` : `只提交 ${task.id}，尚未建立可靠的消息发送意图。`, task.id)
      return
    }
    case 'publish': {
      const task = s.tasks.find((task) => task.id === command.taskId)
      if (!task) throw new Error('任务不存在。')
      publish(s, task); return
    }
    case 'relay': {
      if (c.producer !== 'outbox') throw new Error('直接发布策略没有 Outbox 待办。')
      const record = s.outbox.find((item) => item.status === 'pending')
      if (!record) throw new Error('没有待发送的 Outbox 记录。')
      publish(s, s.tasks.find((task) => task.id === record.taskId)!); return
    }
    case 'accept-publication': case 'drop-publication': case 'deliver-confirm': case 'drop-confirm': case 'mark-sent': {
      const publication = s.publications.find((item) => item.id === command.publicationId)
      if (!publication) throw new Error('发布消息不存在。')
      if (command.type === 'accept-publication' || command.type === 'drop-publication') {
        if (publication.status !== 'network') throw new Error('发布消息已离开网络。')
        if (command.type === 'drop-publication') {
          publication.status = 'dropped'; event(s, 'publish-dropped', 'producer', 'broker', `${publication.id} 未到达 broker。`, publication.id)
        } else {
          publication.status = 'accepted'; publication.confirm = 'network'
          const task = s.tasks.find((task) => task.id === publication.taskId)!
          s.copies.push({ id: `copy-${s.copies.length + 1}`, messageId: task.messageId, taskId: task.id, sequence: task.sequence, status: 'pending', activeDelivery: null, attempts: 0, totalAttempts: 0, redrives: 0 })
          event(s, 'broker-accepted', 'broker', 'store', `broker 接纳 ${publication.id}；保留 ${publication.messageId} 的一份队列副本并发送发布确认。`, publication.id)
          pump(s, c)
        }
      } else if (command.type === 'mark-sent') {
        if (!s.producerOnline || publication.epoch !== s.producerEpoch || publication.confirm !== 'delivered') throw new Error('必须先收到当前生产者进程的发布确认。')
        const record = s.outbox.find((record) => record.messageId === publication.messageId)
        if (!record || c.producer !== 'outbox') throw new Error('没有对应的 Outbox 记录。')
        if (record.status === 'sent') throw new Error('发送进度已经提交。')
        record.status = 'sent'; event(s, 'outbox-sent', 'producer', 'store', `${record.messageId} 的发送进度已提交；这不代表消费者已处理。`, record.messageId)
      } else {
        if (publication.confirm !== 'network') throw new Error('发布确认不在网络中。')
        if (command.type === 'drop-confirm') { publication.confirm = 'dropped'; event(s, 'confirm-dropped', 'broker', 'producer', '发布确认丢失，但 broker 中的副本仍然存在。', publication.id) }
        else {
          if (!s.producerOnline) throw new Error('生产者离线，暂时不能接收确认。')
          publication.confirm = publication.epoch === s.producerEpoch ? 'delivered' : 'ignored'
          event(s, publication.confirm === 'delivered' ? 'confirm-delivered' : 'confirm-stale', 'broker', 'producer', publication.confirm === 'delivered' ? '生产者收到发布确认；消费效果仍需单独核验。' : '旧进程的确认被忽略，不能推进新进程的发送状态。', publication.id)
        }
      }
      return
    }
    case 'start-consumer': case 'pause-consumer':
      s.consuming = command.type === 'start-consumer'
      event(s, s.consuming ? 'consumer-start' : 'consumer-pause', 'worker', 'broker', s.consuming ? '开启投递，已有积压可以继续排空，无需新增生产。' : '暂停发出新投递；在途工作和计时器继续存在。')
      pump(s, c); return
    case 'deliver-work': case 'drop-work': {
      const delivery = s.deliveries.find((item) => item.id === command.deliveryId)
      if (!delivery || delivery.location !== 'network') throw new Error('这份投递不在网络中。')
      if (command.type === 'drop-work') { delivery.location = 'gone'; event(s, 'delivery-dropped', 'broker', 'worker', '投递在网络中丢失；broker 仍等待 ACK 或可见性超时。', delivery.id); return }
      if (!s.workerOnline) throw new Error('Worker 离线，不能递送。')
      delivery.location = 'worker'; delivery.epoch = s.workerEpoch
      event(s, 'delivery-received', 'broker', 'worker', `Worker 收到 ${delivery.messageId}，凭据 ${delivery.id}${delivery.status === 'expired' ? ' 已过期，迟到 ACK 将被拒绝' : ''}。`, delivery.id)
      if (c.consumer === 'early') sendAck(s, delivery)
      return
    }
    case 'process': {
      const delivery = workerDelivery(s, command.deliveryId)
      if (delivery.work !== 'todo') throw new Error('这份本地投递已经执行或失败。')
      if (s.checkpoints.some((checkpoint) => checkpoint.messageId === delivery.messageId)) {
        delivery.work = 'replayed'; event(s, 'effect-skipped', 'worker', 'store', `${delivery.messageId} 已有持久 Checkpoint，跳过重复效果。`, delivery.id)
        if (c.consumer !== 'early') sendAck(s, delivery)
      } else if (c.consumer === 'atomic') {
        appendEffect(s, delivery); saveCheckpoint(s, delivery); delivery.work = 'checkpoint'
        event(s, 'atomic-effect', 'worker', 'store', `原子提交 ${delivery.messageId} 的业务效果与 Checkpoint；然后才发送 ACK。`, delivery.id); sendAck(s, delivery)
      } else {
        appendEffect(s, delivery); delivery.work = 'effect'
        event(s, 'effect-written', 'worker', 'store', `${delivery.messageId} 的业务效果已发生，但 Checkpoint 尚未保存。`, delivery.id)
      }
      return
    }
    case 'checkpoint': {
      const delivery = workerDelivery(s, command.deliveryId)
      if (c.consumer === 'atomic' || delivery.work !== 'effect') throw new Error('当前没有独立待提交的 Checkpoint。')
      saveCheckpoint(s, delivery); delivery.work = 'checkpoint'
      event(s, 'checkpoint-saved', 'worker', 'store', `记录 ${delivery.messageId} 已处理；连续完成位置为 ${contiguousCheckpoint(s)}。`, delivery.id)
      if (c.consumer !== 'early') sendAck(s, delivery)
      return
    }
    case 'resend-ack': {
      const delivery = workerDelivery(s, command.deliveryId)
      if (c.consumer !== 'early' && !['checkpoint', 'replayed'].includes(delivery.work)) throw new Error('此策略要求先完成 Checkpoint 才能 ACK。')
      if (s.acks.some((ack) => ack.deliveryId === delivery.id && ack.status === 'network')) throw new Error('已有 ACK 在网络中。')
      sendAck(s, delivery); return
    }
    case 'fail-work': {
      const delivery = workerDelivery(s, command.deliveryId)
      if (delivery.work !== 'todo') throw new Error('仅能让尚未处理的投递失败。')
      delivery.work = 'failed'; event(s, 'work-failed', 'worker', 'worker', '模拟处理错误，不执行效果；未确认的交付等待超时与重投。', delivery.id); return
    }
    case 'deliver-ack': case 'drop-ack': {
      const ack = s.acks.find((item) => item.id === command.ackId)
      if (!ack || ack.status !== 'network') throw new Error('ACK 不在网络中。')
      if (command.type === 'drop-ack') { ack.status = 'dropped'; event(s, 'ack-dropped', 'worker', 'broker', 'ACK 丢失，已提交的消费效果和进度不会回滚。', ack.id); return }
      const delivery = s.deliveries.find((delivery) => delivery.id === ack.deliveryId)!
      const copy = s.copies.find((copy) => copy.id === delivery.copyId)!
      if (delivery.status === 'in-flight' && copy.activeDelivery === delivery.id) {
        ack.status = 'delivered'; delivery.status = 'acked'; copy.status = 'acked'; copy.activeDelivery = null
        event(s, 'ack-accepted', 'worker', 'broker', `${delivery.id} 的 ACK 被接纳，释放投递额度；不是新业务效果。`, ack.id)
        pump(s, c)
      } else { ack.status = 'ignored'; event(s, 'ack-stale', 'worker', 'broker', `${delivery.id} 已失效；旧 ACK 不能确认另一份新投递。`, ack.id) }
      return
    }
    case 'crash-worker':
      if (!s.workerOnline) throw new Error('Worker 已离线。')
      s.workerOnline = false
      s.deliveries.filter((d) => d.location === 'worker').forEach((d) => { d.location = 'gone' })
      event(s, 'worker-crashed', 'worker', 'worker', 'Worker 崩溃：本地投递进度丢失，已提交的效果与 Checkpoint 保留；网络中的 ACK 不撤回。')
      return
    case 'restart-worker':
      if (s.workerOnline) throw new Error('Worker 已在线。')
      s.workerOnline = true; s.workerEpoch++
      event(s, 'worker-restarted', 'store', 'worker', '新 Worker 从持久 Checkpoint 判断是否需要重做。'); return
    case 'crash-producer':
      if (!s.producerOnline) throw new Error('生产者已离线。')
      s.producerOnline = false
      event(s, 'producer-crashed', 'producer', 'producer', '生产者崩溃：保留任务与 Outbox，丢失进程内确认知识；已发送消息仍可到达。'); return
    case 'restart-producer':
      if (s.producerOnline) throw new Error('生产者已在线。')
      s.producerOnline = true; s.producerEpoch++
      event(s, 'producer-restarted', 'store', 'producer', '生产者恢复；Outbox 待发送项仍可由发布者继续处理。'); return
    case 'redrive': {
      const copy = s.copies.find((copy) => copy.id === command.copyId)
      if (!copy || copy.status !== 'dead-letter' || s.deliveries.length >= MAX_TOTAL_DELIVERIES) throw new Error('没有可重放的死信或已耗尽全局投递预算。')
      copy.status = 'pending'; copy.attempts = 0; copy.redrives++
      event(s, 'redrive', 'broker', 'broker', '人工确认后重新投递同一逻辑消息；累计投递次数保留，业务效果不会被重置。', copy.id)
      pump(s, c); return
    }
    case 'advance': {
      const target = s.now + command.ms
      if (target > MAX_TIME) throw new Error('超出逻辑时间上限。')
      let timer: number | null
      while ((timer = nextTimer(s)) !== null && timer <= target) {
        s.now = timer
        for (const delivery of s.deliveries.filter((item) => item.status === 'in-flight' && item.expiresAt <= s.now)) {
          delivery.status = 'expired'
          const copy = s.copies.find((copy) => copy.id === delivery.copyId)!
          copy.activeDelivery = null
          copy.status = copy.attempts >= c.maxDeliveries ? 'dead-letter' : 'pending'
          event(s, copy.status === 'dead-letter' ? 'dead-letter' : 'visibility-expired', 'broker', 'broker', copy.status === 'dead-letter' ? `${copy.id} 达到本轮投递预算，隔离到死信；不等于业务成功。` : `${delivery.id} 可见性到期，允许重投；旧 Worker 或在途消息没有自动消失。`, delivery.id)
        }
        pump(s, c)
      }
      s.now = target; event(s, 'clock-advanced', 'broker', 'broker', `逻辑时间推进至 ${target} ms；先处理到期，再接受手动消息。`); return
    }
  }
}
export function runModel(value: Config, commands: readonly Command[]): State {
  const c = parseConfig(value)
  if (!Array.isArray(commands) || commands.length > MAX_COMMANDS) throw new Error('消息操作记录超出预算。')
  const state = initialState()
  Array.from(commands).forEach((raw, index) => {
    try { apply(state, c, parseCommand(raw)) } catch (cause) { throw new Error(`第 ${index + 1} 步：${cause instanceof Error ? cause.message : '无法执行。'}`) }
  })
  return state
}
export function unsettled(s: State): number {
  return s.publications.filter((p) => p.status === 'network' || p.confirm === 'network').length + s.deliveries.filter((d) => d.status === 'in-flight' || d.location === 'network' || (d.location === 'worker' && ['todo', 'effect'].includes(d.work))).length + s.acks.filter((a) => a.status === 'network').length + s.copies.filter((c) => c.status === 'pending').length
}
