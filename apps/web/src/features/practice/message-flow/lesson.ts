import { sameAssessment, sameTimelineEvidence } from '../../../core/experiments/timeline-evidence'
import { defaultConfig, parseCommand, parseConfig, runModel, unsettled, MAX_COMMANDS, type Command, type Config, type State } from './model'

export type LabId = 'ack-checkpoint' | 'transactional-outbox'
export const messageExercises = [
  { kind: 'protocol' as const, id: 'ack-checkpoint' as const, version: 1, title: 'Worker 崩溃后，消息会丢还是重做？', category: '消息可靠性', difficulty: '基础', estimatedMinutes: 25, summary: '亲手投递消息、选择 ACK 与 Checkpoint 时机，制造崩溃和 ACK 丢失，再观察重投、重复效果与安全恢复。', flow: ['生产消息', '消费效果', '崩溃重投', '核对进度'] },
  { kind: 'protocol' as const, id: 'transactional-outbox' as const, version: 1, title: '任务保存了，转码事件去哪了？', category: '可靠事件发布', difficulty: '基础', estimatedMinutes: 25, summary: '比较直接双写与事务 Outbox，在业务提交、消息接纳、发送标记和消费之间崩溃，查看漏发、重复与恢复。', flow: ['提交任务', '记录发送意图', '发布与确认', '恢复消费'] },
]
export const scenarioLabels = {
  'before-effect': '处理前崩溃', 'after-effect': '效果后立刻崩溃', 'lost-ack': '消费 ACK 丢失',
  'commit-gap': '提交后、发布前崩溃', 'confirm-gap': '发布后、标记前崩溃', 'consumer-gap': '消费效果后崩溃', manual: '自由实验',
} as const
export type Scenario = keyof typeof scenarioLabels
export const scenariosFor = (lab: LabId): Scenario[] => lab === 'ack-checkpoint' ? ['before-effect', 'after-effect', 'lost-ack', 'manual'] : ['commit-gap', 'confirm-gap', 'consumer-gap', 'manual']
export interface Draft { labId: LabId; scenario: Scenario; config: Config; commands: Command[]; prediction: string; effectAnswer: string; checkpointAnswer: string; ackAnswer: string; reasonAnswer: string; reflection: string }
export interface Evaluation { evidence: boolean; faultObserved: boolean; noDuplicates: boolean; allEffects: boolean; allCheckpoints: boolean; allAcknowledged: boolean; intentRecorded: boolean; settled: boolean; explanation: boolean; status: 'pass' | 'fail' | 'inconclusive'; messages: string[] }
export interface Attempt { id: string; exerciseId: LabId; exerciseVersion: 1; createdAt: number; draft: Draft; result: State; evaluation: Evaluation }
export function initialDraft(labId: LabId): Draft {
  return { labId, scenario: labId === 'ack-checkpoint' ? 'before-effect' : 'commit-gap', config: { ...defaultConfig(), consumer: labId === 'ack-checkpoint' ? 'early' : 'atomic' }, commands: [], prediction: '', effectAnswer: '', checkpointAnswer: '', ackAnswer: '', reasonAnswer: '', reflection: '' }
}
export function parseDraft(value: unknown, expectedId: LabId): Draft {
  const draft = value as Draft | null
  if (!draft || draft.labId !== expectedId || !scenariosFor(expectedId).includes(draft.scenario) || !Array.isArray(draft.commands) || draft.commands.length > MAX_COMMANDS) throw new Error('消息实验版本、场景或操作记录无效。')
  for (const key of ['prediction', 'effectAnswer', 'checkpointAnswer', 'ackAnswer', 'reasonAnswer', 'reflection'] as const) if (typeof draft[key] !== 'string' || draft[key].length > 4000) throw new Error('作答内容无效。')
  return { labId: expectedId, scenario: draft.scenario, config: parseConfig(draft.config), commands: Array.from(draft.commands, parseCommand), prediction: draft.prediction, effectAnswer: draft.effectAnswer, checkpointAnswer: draft.checkpointAnswer, ackAnswer: draft.ackAnswer, reasonAnswer: draft.reasonAnswer, reflection: draft.reflection }
}
export const identity = (draft: Draft) => JSON.stringify([draft.labId, draft.scenario, draft.config, draft.commands])
export const answersIdentity = (draft: Draft) => JSON.stringify([draft.prediction, draft.effectAnswer, draft.checkpointAnswer, draft.ackAnswer, draft.reasonAnswer, draft.reflection])

export function productionCommands(config: Config, existing: Command[]): Command[] {
  const commands = [...existing, { type: 'create-task' as const }]
  const state = runModel(config, commands)
  commands.push({ type: 'publish', taskId: state.tasks.at(-1)!.id })
  const publication = runModel(config, commands).publications.at(-1)!
  commands.push({ type: 'accept-publication', publicationId: publication.id }, { type: 'deliver-confirm', publicationId: publication.id })
  if (config.producer === 'outbox') commands.push({ type: 'mark-sent', publicationId: publication.id })
  return commands
}

/** Presets emit real commands through the same reducer as the manual controls. */
export function scenarioCommands(config: Config, scenario: Exclude<Scenario, 'manual'>): Command[] {
  const commands: Command[] = []
  const state = () => runModel(config, commands)
  const add = (...items: Command[]) => { commands.push(...items); state() }
  const publishCurrent = (mark: boolean, relay = false) => {
    add(relay ? { type: 'relay' } : { type: 'publish', taskId: state().tasks[0]!.id })
    const publicationId = state().publications.at(-1)!.id
    add({ type: 'accept-publication', publicationId }, { type: 'deliver-confirm', publicationId })
    if (mark && config.producer === 'outbox') add({ type: 'mark-sent', publicationId })
  }
  const drain = () => {
    for (let i = 0; i < 70; i++) {
      const s = state()
      const ack = s.acks.find((a) => a.status === 'network')
      if (ack) { add({ type: 'deliver-ack', ackId: ack.id }); continue }
      const publication = s.publications.find((p) => p.confirm === 'network')
      if (publication) { add({ type: 'deliver-confirm', publicationId: publication.id }); continue }
      const work = s.deliveries.find((d) => d.location === 'worker' && ['todo', 'effect'].includes(d.work))
      if (work) { add({ type: work.work === 'todo' ? 'process' : 'checkpoint', deliveryId: work.id }); continue }
      const delivery = s.deliveries.find((d) => d.location === 'network')
      if (delivery) { add({ type: 'deliver-work', deliveryId: delivery.id }); continue }
      return
    }
    throw new Error('示例未在操作预算内排空。')
  }
  add({ type: 'create-task' })
  if (scenario === 'commit-gap') {
    add({ type: 'crash-producer' }, { type: 'restart-producer' })
    if (config.producer === 'outbox') publishCurrent(true, true)
    drain(); return commands
  }
  if (scenario === 'confirm-gap') {
    publishCurrent(false)
    add({ type: 'crash-producer' }, { type: 'restart-producer' })
    if (config.producer === 'outbox') publishCurrent(true, true)
    drain(); return commands
  }
  publishCurrent(true)
  const first = state().deliveries[0]!
  add({ type: 'deliver-work', deliveryId: first.id })
  if (scenario === 'before-effect') {
    for (const ack of state().acks.filter((a) => a.status === 'network')) add({ type: 'deliver-ack', ackId: ack.id })
    add({ type: 'crash-worker' }, { type: 'advance', ms: config.visibilityMs }, { type: 'restart-worker' })
  } else if (scenario === 'after-effect' || scenario === 'consumer-gap') {
    if (config.consumer === 'early') for (const ack of state().acks.filter((a) => a.status === 'network')) add({ type: 'deliver-ack', ackId: ack.id })
    add({ type: 'process', deliveryId: first.id }, { type: 'crash-worker' }, { type: 'advance', ms: config.visibilityMs }, { type: 'restart-worker' })
  } else {
    add({ type: 'process', deliveryId: first.id })
    if (state().deliveries[0]!.work === 'effect') add({ type: 'checkpoint', deliveryId: first.id })
    for (const ack of state().acks.filter((a) => a.status === 'network')) add({ type: 'drop-ack', ackId: ack.id })
    add({ type: 'advance', ms: config.visibilityMs })
  }
  drain()
  return commands
}
export function evaluate(draft: Draft, result: State): Evaluation {
  const invalid: Evaluation = { evidence: false, faultObserved: false, noDuplicates: false, allEffects: false, allCheckpoints: false, allAcknowledged: false, intentRecorded: false, settled: false, explanation: false, status: 'inconclusive', messages: ['输入与完整事件无法重算核对，不能判定。'] }
  try { if (!sameTimelineEvidence(runModel(draft.config, draft.commands), result)) return invalid } catch { return invalid }
  const events = result.events
  const index = (kind: string) => events.find((e) => e.kind === kind)?.index
  const crash = index('worker-crashed')
  const received = index('delivery-received')
  const effect = events.find((e) => e.kind === 'effect-written' || e.kind === 'atomic-effect')?.index
  const producerCrash = index('producer-crashed')
  const sent = index('publish-sent')
  const accepted = index('broker-accepted')
  const marked = index('outbox-sent')
  const committed = index('task-commit')
  const faultObserved = draft.scenario === 'manual' ? true : draft.scenario === 'before-effect' ? crash !== undefined && received !== undefined && received < crash && (effect === undefined || effect > crash) : draft.scenario === 'after-effect' || draft.scenario === 'consumer-gap' ? crash !== undefined && effect !== undefined && effect < crash : draft.scenario === 'lost-ack' ? index('ack-dropped') !== undefined : draft.scenario === 'commit-gap' ? producerCrash !== undefined && committed !== undefined && committed < producerCrash && (sent === undefined || producerCrash < sent) : producerCrash !== undefined && accepted !== undefined && accepted < producerCrash && (marked === undefined || marked > producerCrash)
  const noDuplicates = result.tasks.every((task) => result.effects.filter((effect) => effect.messageId === task.messageId).length <= 1)
  const allEffects = result.tasks.length > 0 && result.tasks.every((task) => result.effects.some((effect) => effect.messageId === task.messageId))
  const allCheckpoints = result.tasks.length > 0 && result.tasks.every((task) => result.checkpoints.some((checkpoint) => checkpoint.messageId === task.messageId))
  const allAcknowledged = result.copies.length > 0 && result.copies.every((copy) => copy.status === 'acked')
  const intentRecorded = draft.labId !== 'transactional-outbox' || result.tasks.length > 0 && result.tasks.every((task) => result.outbox.some((record) => record.taskId === task.id && record.status === 'sent'))
  const settled = unsettled(result) === 0
  const numeric = (text: string, value: number) => /^\d+$/.test(text) && Number(text) === value
  const explanation = draft.prediction.length > 0 && numeric(draft.effectAnswer, result.effects.length) && numeric(draft.checkpointAnswer, result.checkpoints.length) && numeric(draft.ackAnswer, result.copies.filter((copy) => copy.status === 'acked').length) && draft.reasonAnswer === 'separate-boundaries'
  const status = !noDuplicates ? 'fail' : !settled ? 'inconclusive' : faultObserved && allEffects && allCheckpoints && allAcknowledged && intentRecorded ? 'pass' : 'fail'
  return { evidence: true, faultObserved, noDuplicates, allEffects, allCheckpoints, allAcknowledged, intentRecorded, settled, explanation, status, messages: [
    `${result.tasks.length} 个业务任务，${result.copies.length} 份队列副本，${result.deliveries.length} 次投递；实际业务效果 ${result.effects.length} 次，Checkpoint ${result.checkpoints.length} 条。`,
    noDuplicates ? '尚未出现同一逻辑消息的重复效果。' : '同一逻辑消息产生了重复业务效果；事后保存 Checkpoint 不能撤回已经重复的效果。',
    allEffects ? '每个已提交任务都有业务效果。' : '仍有任务没有业务效果；队列变空或 ACK 成功不能替代这项检查。',
    allCheckpoints ? '每个任务都有持久消费进度。' : '还有已提交任务缺少消费 Checkpoint，恢复时可能漏做或重做。',
    allAcknowledged ? '所有队列副本都由有效投递凭据完成确认。' : '还有队列副本未确认、待投递或已进入死信；死信不等于完成。',
    ...(draft.labId === 'transactional-outbox' ? [intentRecorded ? '业务提交附带的可靠发送意图已推进到已发送。' : '缺少业务事务中的发送意图，或 Outbox 发送进度尚未提交。'] : []),
    settled ? '当前网络消息与本地待执行工作已结算。' : '仍有在途消息或待处理工作，继续操作后结果可能改变。',
    faultObserved ? '已观察到本场景要求的故障边界。' : '尚未执行所选故障时序。',
    explanation ? '计数与边界解释符合证据；预测允许出错，自由复盘不自动判分。' : '请分别填写效果、Checkpoint 和已确认队列副本数，并解释三个边界。',
  ] }
}
export function runAttempt(value: Draft, id: LabId): Attempt {
  const draft = parseDraft(value, id)
  const result = runModel(draft.config, draft.commands)
  return { id: crypto.randomUUID(), exerciseId: id, exerciseVersion: 1, createdAt: Date.now(), draft: structuredClone(draft), result, evaluation: evaluate(draft, result) }
}
export function verifyAttempt(value: unknown, id: LabId): value is Attempt {
  try {
    const attempt = value as Attempt
    if (attempt.exerciseId !== id || attempt.exerciseVersion !== 1 || typeof attempt.id !== 'string' || !Number.isFinite(attempt.createdAt)) return false
    const draft = parseDraft(attempt.draft, id)
    const evaluation = evaluate(draft, attempt.result)
    return evaluation.evidence && sameAssessment(evaluation, attempt.evaluation)
  } catch { return false }
}
export const progress = (attempts: Attempt[], id: LabId) => scenariosFor(id).filter((scenario) => scenario !== 'manual' && attempts.some((attempt) => attempt.exerciseId === id && attempt.draft.scenario === scenario && attempt.evaluation.status === 'pass' && attempt.evaluation.explanation))
