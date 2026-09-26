import { defaultConfig, MAX_COMMANDS, parseCommand, parseConfig, runModel, same, type Command, type Config, type State, type WorkerId } from './model'
export const concurrentExercise = { kind: 'protocol' as const, id: 'concurrent-update', version: 1, title: '两个任务争抢名额，库存没负数就安全吗？', category: '并发正确性', difficulty: '基础', estimatedMinutes: 25, summary: '交错读取与提交，观察超卖和丢失更新，比较幂等去重、版本 CAS 与行锁，并在提交前制造崩溃。', flow: ['读取同一状态', '交错提交', '检查业务账本', '重读或串行化'] } as const
export const scenarioLabels = { 'last-slot': '争抢最后一个名额', 'lost-update': '两个名额的丢失更新', 'crash-before-commit': '提交前崩溃', manual: '自由实验' } as const
export type Scenario = keyof typeof scenarioLabels
export interface Draft { scenario: Scenario; config: Config; commands: Command[]; prediction: string; remainingAnswer: string; reservationsAnswer: string; invariantAnswer: string; reasonAnswer: string; reflection: string }
export interface Evaluation { evidence: boolean; task: boolean; explanation: boolean; status: 'pass' | 'fail' | 'inconclusive'; messages: string[] }
export interface Attempt { id: string; exerciseId: 'concurrent-update'; exerciseVersion: 1; createdAt: number; draft: Draft; result: State; evaluation: Evaluation }
export const initialDraft = (): Draft => ({ scenario: 'last-slot', config: defaultConfig(), commands: [], prediction: '', remainingAnswer: '', reservationsAnswer: '', invariantAnswer: '', reasonAnswer: '', reflection: '' })
export function parseDraft(value: unknown): Draft {
  const d = value as Draft | null
  if (!d || !Object.hasOwn(scenarioLabels, d.scenario) || !Array.isArray(d.commands) || d.commands.length > MAX_COMMANDS) throw new Error('并发实验记录无效。')
  for (const field of ['prediction', 'remainingAnswer', 'reservationsAnswer', 'invariantAnswer', 'reasonAnswer', 'reflection'] as const) if (typeof d[field] !== 'string' || d[field].length > 4000) throw new Error('并发作答无效。')
  return { ...d, config: parseConfig(d.config), commands: Array.from(d.commands, parseCommand) }
}
export function scenarioCommands(config: Config, scenario: Exclude<Scenario, 'manual'>): Command[] {
  const commands: Command[] = []
  const act = (type: Command['type'], worker: WorkerId) => { commands.push({ type, worker }); return runModel(config, commands) }
  const finish = (worker: WorkerId) => {
    let w = runModel(config, commands).workers.find((w) => w.id === worker)!
    if (w.status === 'idle' || w.status === 'conflict') w = act('read', worker).workers.find((w) => w.id === worker)!
    if (w.status === 'ready') w = act('commit', worker).workers.find((w) => w.id === worker)!
    if (w.status === 'conflict') { act('read', worker); act('commit', worker) }
  }
  act('read', 'A'); act('read', 'B')
  if (scenario === 'crash-before-commit') { act('crash', 'A'); finish('B'); act('restart', 'A'); finish('A') }
  else { finish('A'); finish('B') }
  return commands
}
export function invariant(c: Config, s: State): boolean {
  return s.remaining >= 0 && s.remaining + s.reservations.length === c.capacity && s.reservations.length <= c.capacity && new Set(s.reservations.map((r) => r.intent)).size === s.reservations.length
}
export function evaluate(d: Draft, s: State): Evaluation {
  try { if (!same(runModel(d.config, d.commands), s)) throw new Error('mismatch') } catch { return { evidence: false, task: false, explanation: false, status: 'inconclusive', messages: ['状态与事件无法完整重算。'] } }
  const safe = invariant(d.config, s)
  const settled = !s.lock && !s.waiting.length && s.workers.every((w) => w.status === 'committed' || w.status === 'sold-out')
  const aRead = s.events.find((e) => e.kind === 'read' && e.subject === 'A')
  const bReadOrWait = s.events.find((e) => (e.kind === 'read' || e.kind === 'lock-wait') && e.subject === 'B')
  const firstCommit = s.events.find((e) => e.kind === 'committed')
  const contended = !!aRead && !!bReadOrWait && !!firstCommit && aRead.index < firstCommit.index && bReadOrWait.index < firstCommit.index
  const crash = s.events.find((e) => e.kind === 'crashed' && e.subject === 'A')
  const recovered = !!crash && !!aRead && aRead.index < crash.index && !!firstCommit && crash.index < firstCommit.index && s.events.some((e) => e.kind === 'restarted' && e.subject === 'A' && e.index > crash.index)
  const expectedCapacity = d.scenario === 'lost-update' ? 2 : 1
  const task = d.scenario !== 'manual' && safe && settled && d.config.capacity === expectedCapacity && s.reservations.length === expectedCapacity && contended && (d.scenario !== 'crash-before-commit' || recovered)
  const number = (answer: string, value: number) => /^\d+$/.test(answer) && Number(answer) === value
  const explanation = !!d.prediction && number(d.remainingAnswer, s.remaining) && number(d.reservationsAnswer, s.reservations.length) && d.invariantAnswer === (safe ? 'safe' : 'broken') && d.reasonAnswer === 'different-boundaries'
  return { evidence: true, task, explanation, status: task ? 'pass' : d.commands.length ? 'fail' : 'inconclusive', messages: [
    `库存 ${s.remaining}，预订 ${s.reservations.length}，初始名额 ${d.config.capacity}。${safe ? '库存与业务账本守恒，每个意图最多一份预订。' : '库存与预订不守恒、发生超卖或同一意图重复预订；没有负数也不能说明安全。'}`,
    `提交冲突 ${s.workers.reduce((n, w) => n + w.conflicts, 0)} 次；${settled ? '两个任务均已得到业务结论，锁已释放。' : '还有任务或锁尚未收尾，不能靠拒绝全部工作通过。'}`,
    '每次提交都将库存和预订一起写入；先读后写仍可使用过时快照。幂等保护同一意图，版本或锁保护不同事务之间的竞争。',
    task ? '指定交错下的业务目标已满足。' : d.config.capacity !== expectedCapacity && d.scenario !== 'manual' ? `本关要求初始 ${expectedCapacity} 个名额；改变资源数量不算修复同一问题。` : '尚未完成本关要求的交错、故障恢复与业务目标；自由实验只保存证据。',
    explanation ? '计数、不变量与边界解释符合证据。' : '请分别核对库存、预订与不变量，再解释并发控制和幂等的不同职责。',
  ] }
}
export function runAttempt(value: Draft): Attempt { const draft = parseDraft(value); const result = runModel(draft.config, draft.commands); return { id: crypto.randomUUID(), exerciseId: 'concurrent-update', exerciseVersion: 1, createdAt: Date.now(), draft: structuredClone(draft), result, evaluation: evaluate(draft, result) } }
export function verifyAttempt(value: unknown): value is Attempt { try { const a = value as Attempt; if (a.exerciseId !== 'concurrent-update' || a.exerciseVersion !== 1 || typeof a.id !== 'string' || !Number.isFinite(a.createdAt)) return false; const d = parseDraft(a.draft); const e = evaluate(d, a.result); return e.evidence && same(e, a.evaluation) } catch { return false } }
