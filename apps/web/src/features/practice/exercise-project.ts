import { projectFileV3Schema, type ProjectFile } from '@system-design/model'
import type { ExerciseCheck, ExerciseCheckStatus, ExerciseEvaluation, ExerciseMetrics, ExerciseParameter } from './exercise-types'

export const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
  return JSON.stringify(value)
}

export const readExerciseParameter = (project: ProjectFile, parameter: ExerciseParameter): number | undefined => {
  const config = project.topology.nodes.find((node) => node.id === parameter.nodeId)?.config as Record<string, unknown> | undefined
  const value = config && Object.hasOwn(config, parameter.field) ? config[parameter.field] : undefined
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Edits only one declared numeric field; the normal project command validates the full edit. */
export const withExerciseParameter = (project: ProjectFile, parameter: ExerciseParameter, value: number): ProjectFile => {
  if (!parameter.choices.some((choice) => choice.value === value) || !Number.isFinite(value)) throw new Error('请选择题目允许的参数值。')
  const next = structuredClone(project)
  const config = next.topology.nodes.find((node) => node.id === parameter.nodeId)?.config as Record<string, unknown> | undefined
  if (!config || !Object.hasOwn(config, parameter.field) || typeof config[parameter.field] !== 'number') throw new Error('找不到题目指定的数值参数，请重新开始。')
  config[parameter.field] = value
  return projectFileV3Schema.parse(next)
}

const executionShape = (project: ProjectFile) => ({
  ...project, name: '',
  topology: {
    ...project.topology,
    nodes: project.topology.nodes.map((node) => ({ ...node, name: '', position: { x: 0, y: 0 } })),
    edges: project.topology.edges.map((edge) => ({ ...edge, name: '' })),
    groups: project.topology.groups.map((group) => ({ ...group, name: '' })),
  },
})

/** Semantic shape for authored exercise constraints; session freshness uses the full snapshot. */
export const exerciseProjectFingerprint = (project: ProjectFile) => stableJson(executionShape(project))

const constraintFingerprint = (project: ProjectFile) => {
  const shape = executionShape(project)
  shape.topology.nodes.sort((a, b) => a.id.localeCompare(b.id))
  shape.topology.edges.sort((a, b) => a.id.localeCompare(b.id))
  return stableJson(shape)
}

export const checkExerciseConstraints = (project: ProjectFile, baseline: ProjectFile, parameters: readonly ExerciseParameter[]): ExerciseCheck => {
  const normalized = structuredClone(project)
  let allowed = true
  for (const parameter of parameters) {
    const value = readExerciseParameter(project, parameter)
    const original = readExerciseParameter(baseline, parameter)
    allowed &&= value !== undefined && parameter.choices.some((choice) => choice.value === value) && original !== undefined
    const config = normalized.topology.nodes.find((node) => node.id === parameter.nodeId)?.config as Record<string, unknown> | undefined
    if (config && original !== undefined) config[parameter.field] = original
  }
  // Constraints compare graph identities. Evidence freshness also preserves
  // declaration order, which can affect the runtime's seeded execution order.
  const matches = allowed && constraintFingerprint(normalized) === constraintFingerprint(baseline)
  return { id: 'constraints', label: '题目约束', status: matches ? 'pass' : 'fail', message: matches ? '只修改了题目允许的参数，其他实验条件保持不变。' : `本题只允许调整${parameters.map((parameter) => parameter.label).join('、')}；请恢复其他流量、拓扑和运行设置。` }
}

export const makeExerciseEvaluation = (checks: ExerciseCheck[], metrics: ExerciseMetrics, passSummary: string): ExerciseEvaluation => {
  const status: ExerciseCheckStatus = checks.some((check) => check.status === 'fail') ? 'fail' : checks.some((check) => check.status === 'inconclusive') ? 'inconclusive' : 'pass'
  return { status, checks, metrics, summary: status === 'pass' ? passSummary : status === 'inconclusive' ? '运行证据不足，请完整运行当前设计后再检查。' : '还有目标未满足。根据下方证据调整设计，再运行验证。' }
}
