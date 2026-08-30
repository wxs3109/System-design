import { z } from 'zod'
import {
  connectionSchema,
  faultSchema,
  scenarioSchema,
  simulationConfigSchema,
  workloadSchema,
  positionSchema,
  type Scenario,
} from './schema'

const projectIdSchema = z.string().trim().min(1).max(120)
const projectNameSchema = z.string().trim().min(1).max(120)

export const projectComponentNodeSchema = z.object({
  id: projectIdSchema,
  name: z.string().trim().min(1).max(80),
  type: projectIdSchema,
  componentVersion: z.number().int().positive(),
  position: positionSchema,
  disabled: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).default({}),
})

export const topologyGroupSchema = z.object({
  id: projectIdSchema,
  name: z.string().trim().min(1).max(80),
  kind: z.enum(['group', 'zone', 'region']).default('group'),
  nodeIds: z.array(projectIdSchema).max(10_000).default([]),
})

export const policyAttachmentSchema = z.object({
  id: projectIdSchema,
  type: projectIdSchema,
  version: z.number().int().positive(),
  target: z.object({
    kind: z.enum(['node', 'edge', 'group']),
    id: projectIdSchema,
  }),
  order: z.number().int().min(0).default(0),
  enabled: z.boolean().default(true),
  config: z.record(z.string(), z.unknown()).default({}),
})

export const topologySchema = z.object({
  nodes: z.array(projectComponentNodeSchema).max(10_000),
  edges: z.array(connectionSchema).max(50_000),
  groups: z.array(topologyGroupSchema).max(10_000).default([]),
  policies: z.array(policyAttachmentSchema).max(50_000).default([]),
})

export const experimentSchema = z.object({
  id: projectIdSchema,
  name: z.string().trim().min(1).max(120),
  workloads: z.array(workloadSchema).max(1_000),
  faults: z.array(faultSchema).max(10_000).default([]),
  simulation: simulationConfigSchema,
  seed: z.string().min(1).max(120),
})

const addDuplicateIssue = (
  context: z.RefinementCtx,
  path: (string | number)[],
  kind: string,
  id: string,
) => context.addIssue({ code: 'custom', path, message: `Duplicate ${kind} id: ${id}` })

export const projectFileV2Schema = z.object({
  schemaVersion: z.literal(2),
  id: projectIdSchema,
  name: projectNameSchema,
  topology: topologySchema,
  experiments: z.array(experimentSchema).min(1).max(1_000),
  activeExperimentId: projectIdSchema,
}).superRefine((project, context) => {
  const nodeIds = new Set<string>()
  const edgeIds = new Set<string>()
  const groupIds = new Set<string>()
  const policyIds = new Set<string>()
  const experimentIds = new Set<string>()

  project.topology.nodes.forEach((node, index) => {
    if (nodeIds.has(node.id)) addDuplicateIssue(context, ['topology', 'nodes', index, 'id'], 'node', node.id)
    nodeIds.add(node.id)
  })
  project.topology.edges.forEach((edge, index) => {
    if (edgeIds.has(edge.id)) addDuplicateIssue(context, ['topology', 'edges', index, 'id'], 'edge', edge.id)
    edgeIds.add(edge.id)
    if (!nodeIds.has(edge.source)) context.addIssue({ code: 'custom', path: ['topology', 'edges', index, 'source'], message: `Unknown source node: ${edge.source}` })
    if (!nodeIds.has(edge.target)) context.addIssue({ code: 'custom', path: ['topology', 'edges', index, 'target'], message: `Unknown target node: ${edge.target}` })
    if (edge.source === edge.target) context.addIssue({ code: 'custom', path: ['topology', 'edges', index], message: 'A node cannot connect directly to itself' })
  })
  project.topology.groups.forEach((group, index) => {
    if (groupIds.has(group.id)) addDuplicateIssue(context, ['topology', 'groups', index, 'id'], 'group', group.id)
    groupIds.add(group.id)
    group.nodeIds.forEach((nodeId, nodeIndex) => {
      if (!nodeIds.has(nodeId)) context.addIssue({ code: 'custom', path: ['topology', 'groups', index, 'nodeIds', nodeIndex], message: `Unknown group member: ${nodeId}` })
    })
  })
  project.topology.policies.forEach((policy, index) => {
    if (policyIds.has(policy.id)) addDuplicateIssue(context, ['topology', 'policies', index, 'id'], 'policy', policy.id)
    policyIds.add(policy.id)
    const targets = policy.target.kind === 'node' ? nodeIds : policy.target.kind === 'edge' ? edgeIds : groupIds
    if (!targets.has(policy.target.id)) context.addIssue({ code: 'custom', path: ['topology', 'policies', index, 'target', 'id'], message: `Unknown ${policy.target.kind} policy target: ${policy.target.id}` })
  })

  project.experiments.forEach((experiment, experimentIndex) => {
    if (experimentIds.has(experiment.id)) addDuplicateIssue(context, ['experiments', experimentIndex, 'id'], 'experiment', experiment.id)
    experimentIds.add(experiment.id)
    const workloadIds = new Set<string>()
    const faultIds = new Set<string>()
    experiment.workloads.forEach((workload, workloadIndex) => {
      if (workloadIds.has(workload.id)) addDuplicateIssue(context, ['experiments', experimentIndex, 'workloads', workloadIndex, 'id'], 'workload', workload.id)
      workloadIds.add(workload.id)
      const source = project.topology.nodes.find((node) => node.id === workload.sourceNodeId)
      if (!source) context.addIssue({ code: 'custom', path: ['experiments', experimentIndex, 'workloads', workloadIndex, 'sourceNodeId'], message: `Unknown workload source: ${workload.sourceNodeId}` })
      else if (source.type !== 'traffic') context.addIssue({ code: 'custom', path: ['experiments', experimentIndex, 'workloads', workloadIndex, 'sourceNodeId'], message: 'A workload source must be a Traffic Generator' })
    })
    project.topology.nodes.forEach((node, nodeIndex) => {
      if (node.type === 'traffic' && !experiment.workloads.some((workload) => workload.sourceNodeId === node.id)) {
        context.addIssue({ code: 'custom', path: ['topology', 'nodes', nodeIndex], message: `Traffic node ${node.id} must have a workload in experiment ${experiment.id}` })
      }
    })
    experiment.faults.forEach((fault, faultIndex) => {
      if (faultIds.has(fault.id)) addDuplicateIssue(context, ['experiments', experimentIndex, 'faults', faultIndex, 'id'], 'fault', fault.id)
      faultIds.add(fault.id)
      if (!nodeIds.has(fault.targetNodeId)) context.addIssue({ code: 'custom', path: ['experiments', experimentIndex, 'faults', faultIndex, 'targetNodeId'], message: `Unknown fault target: ${fault.targetNodeId}` })
    })
  })

  if (!experimentIds.has(project.activeExperimentId)) {
    context.addIssue({ code: 'custom', path: ['activeExperimentId'], message: `Unknown active experiment: ${project.activeExperimentId}` })
  }
})

export type ProjectComponentNode = z.infer<typeof projectComponentNodeSchema>
export type TopologyGroup = z.infer<typeof topologyGroupSchema>
export type PolicyAttachment = z.infer<typeof policyAttachmentSchema>
export type Topology = z.infer<typeof topologySchema>
export type Experiment = z.infer<typeof experimentSchema>
export type ProjectFileV2 = z.infer<typeof projectFileV2Schema>

export class UnsupportedProjectVersionError extends Error {
  constructor(readonly version: unknown) {
    super(`Unsupported project schemaVersion: ${String(version)}. This version can open schemaVersion 1 or 2.`)
    this.name = 'UnsupportedProjectVersionError'
  }
}

const defaultExperimentId = 'default-experiment'

export const migrateScenarioV1ToProjectV2 = (input: Scenario | unknown): ProjectFileV2 => {
  const scenario = scenarioSchema.parse(input)
  return projectFileV2Schema.parse({
    schemaVersion: 2,
    id: scenario.id,
    name: scenario.name,
    topology: {
      nodes: scenario.nodes.map((node) => ({
        ...node,
        componentVersion: 1,
        config: node.type === 'traffic' ? {} : node.config,
      })),
      edges: scenario.edges,
      groups: [],
      policies: [],
    },
    experiments: [{
      id: defaultExperimentId,
      name: 'Default experiment',
      workloads: scenario.workloads,
      faults: scenario.faults,
      simulation: scenario.simulation,
      seed: scenario.seed,
    }],
    activeExperimentId: defaultExperimentId,
  })
}

export const parseProjectFile = (input: unknown): ProjectFileV2 => {
  if (typeof input !== 'object' || input === null || !('schemaVersion' in input)) {
    throw new UnsupportedProjectVersionError(undefined)
  }
  const version = (input as { schemaVersion?: unknown }).schemaVersion
  if (version === 1) return migrateScenarioV1ToProjectV2(input)
  if (version === 2) return projectFileV2Schema.parse(input)
  throw new UnsupportedProjectVersionError(version)
}

export const getActiveExperiment = (project: ProjectFileV2): Experiment => {
  const experiment = project.experiments.find((candidate) => candidate.id === project.activeExperimentId)
  if (!experiment) throw new Error(`Active experiment ${project.activeExperimentId} does not exist.`)
  return experiment
}

export const setActiveExperiment = (input: ProjectFileV2, experimentId: string): ProjectFileV2 => projectFileV2Schema.parse({
  ...input,
  activeExperimentId: experimentId,
})

export const projectToScenario = (input: ProjectFileV2, experimentId = input.activeExperimentId): Scenario => {
  const project = projectFileV2Schema.parse(input)
  const experiment = project.experiments.find((candidate) => candidate.id === experimentId)
  if (!experiment) throw new Error(`Experiment ${experimentId} does not exist.`)
  return scenarioSchema.parse({
    schemaVersion: 1,
    id: project.id,
    name: project.name,
    seed: experiment.seed,
    nodes: project.topology.nodes.map(({ componentVersion: _componentVersion, ...node }) => node.type === 'traffic'
      ? { ...node, type: 'traffic', config: { workloadId: experiment.workloads.find((workload) => workload.sourceNodeId === node.id)?.id ?? `${node.id}-workload` } }
      : node),
    edges: project.topology.edges,
    workloads: experiment.workloads,
    faults: experiment.faults,
    simulation: experiment.simulation,
  })
}

export const createEmptyProject = (id = 'untitled-system'): ProjectFileV2 => projectFileV2Schema.parse({
  schemaVersion: 2,
  id,
  name: 'Untitled system',
  topology: { nodes: [], edges: [], groups: [], policies: [] },
  experiments: [{
    id: defaultExperimentId,
    name: 'Default experiment',
    workloads: [],
    faults: [],
    simulation: { durationSeconds: 30, sampleIntervalMs: 1_000, maxRequests: 100_000, traceLimit: 200, maxHops: 64 },
    seed: 'system-design',
  }],
  activeExperimentId: defaultExperimentId,
})
