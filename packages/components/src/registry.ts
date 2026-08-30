import type { z } from 'zod'
import type { Fault, PolicyAttachment, PortSemantic, Position, ProjectComponentNode, ProjectFileV2 } from '@system-design/model'

export type PortDirection = 'input' | 'output'

export interface ComponentPort {
  id: string
  label: string
  direction: PortDirection
  semantic: PortSemantic
  required?: boolean
  multiple?: boolean
}

export interface NumberConfigField {
  kind: 'number'
  key: string
  label: string
  min?: number
  max?: number
  step?: number
  description?: string
}

export interface SelectConfigField {
  kind: 'select'
  key: string
  label: string
  options: readonly { value: string; label: string }[]
  description?: string
}

export interface TextConfigField {
  kind: 'text'
  key: string
  label: string
  description?: string
}

export type ConfigField = NumberConfigField | SelectConfigField | TextConfigField

export interface ComponentManifest<TConfig extends Record<string, unknown> = Record<string, unknown>> {
  type: string
  version: number
  label: string
  description: string
  category: 'traffic' | 'network' | 'routing' | 'compute' | 'data' | 'async'
  iconToken: string
  color: string
  configSchema: z.ZodType<TConfig>
  createDefaultConfig: (context: { nodeId: string; workloadId: string }) => TConfig
  configFields: readonly ConfigField[]
  ports: readonly ComponentPort[]
  capabilities: readonly string[]
  emittedMetrics: readonly string[]
  supportedFaults: readonly Fault['type'][]
  runtimeBehavior: string
  describeConfig: (config: TConfig) => string
}

export interface RegistryNode {
  id: string
  name: string
  type: string
  componentVersion: number
  position: Position
  disabled?: boolean
  config: Record<string, unknown>
}

const manifestKey = (type: string, version: number) => `${type}@${version}`

export class ComponentRegistry {
  private readonly manifests = new Map<string, ComponentManifest>()
  private readonly latestVersions = new Map<string, number>()

  constructor(manifests: readonly ComponentManifest[] = []) {
    manifests.forEach((manifest) => this.register(manifest))
  }

  register<TConfig extends Record<string, unknown>>(manifest: ComponentManifest<TConfig>) {
    if (!Number.isInteger(manifest.version) || manifest.version < 1) throw new Error(`Invalid component version for ${manifest.type}.`)
    const key = manifestKey(manifest.type, manifest.version)
    if (this.manifests.has(key)) throw new Error(`Component ${key} is already registered.`)
    this.manifests.set(key, manifest as ComponentManifest)
    this.latestVersions.set(manifest.type, Math.max(manifest.version, this.latestVersions.get(manifest.type) ?? 0))
    return this
  }

  get(type: string, version = this.latestVersions.get(type)): ComponentManifest {
    if (version === undefined) throw new Error(`Unknown component type: ${type}`)
    const manifest = this.manifests.get(manifestKey(type, version))
    if (!manifest) throw new Error(`Unknown component: ${manifestKey(type, version)}`)
    return manifest
  }

  list(): ComponentManifest[] {
    return [...this.latestVersions].map(([type, version]) => this.get(type, version))
  }

  createNode(type: string, id: string, position: Position, workloadId = `${id}-workload`): RegistryNode {
    const manifest = this.get(type)
    return {
      id,
      name: manifest.label,
      type,
      componentVersion: manifest.version,
      position,
      config: manifest.configSchema.parse(manifest.createDefaultConfig({ nodeId: id, workloadId })),
    }
  }

  validateNode(node: ProjectComponentNode): ProjectComponentNode {
    const manifest = this.get(node.type, node.componentVersion)
    return { ...node, config: manifest.configSchema.parse(node.config) }
  }

  validateProject(project: ProjectFileV2): ProjectFileV2 {
    return {
      ...project,
      topology: {
        ...project.topology,
        nodes: project.topology.nodes.map((node) => this.validateNode(node)),
      },
    }
  }

  describeNode(node: Pick<RegistryNode, 'type' | 'componentVersion' | 'config'>): string {
    const manifest = this.get(node.type, node.componentVersion)
    return manifest.describeConfig(manifest.configSchema.parse(node.config))
  }

  getPort(node: Pick<RegistryNode, 'type' | 'componentVersion'>, portId: string, direction?: PortDirection): ComponentPort | undefined {
    return this.get(node.type, node.componentVersion).ports.find((port) => port.id === portId && (direction === undefined || port.direction === direction))
  }

  canConnect(source: Pick<RegistryNode, 'id' | 'type' | 'componentVersion'> | undefined, target: Pick<RegistryNode, 'id' | 'type' | 'componentVersion'> | undefined, sourcePortId?: string | null, targetPortId?: string | null): { valid: false; reason: string } | { valid: true; sourceSemantic: PortSemantic; targetSemantic: PortSemantic } {
    if (!source || !target) return { valid: false, reason: 'Both endpoints must exist.' }
    if (source.id === target.id) return { valid: false, reason: 'A node cannot connect directly to itself.' }
    const sourceManifest = this.get(source.type, source.componentVersion)
    const targetManifest = this.get(target.type, target.componentVersion)
    const outputs = sourceManifest.ports.filter((port) => port.direction === 'output' && (!sourcePortId || port.id === sourcePortId))
    const inputs = targetManifest.ports.filter((port) => port.direction === 'input' && (!targetPortId || port.id === targetPortId))
    if (outputs.length === 0) return { valid: false as const, reason: sourcePortId ? `${sourceManifest.label} has no output port named ${sourcePortId}.` : `${sourceManifest.label} has no output port.` }
    if (inputs.length === 0) return { valid: false as const, reason: targetPortId ? `${targetManifest.label} has no input port named ${targetPortId}.` : `${targetManifest.label} has no input port.` }
    const pair = outputs.flatMap((output) => inputs.map((input) => ({ output, input }))).find(({ output, input }) => arePortSemanticsCompatible(output.semantic, input.semantic))
    if (!pair) return { valid: false as const, reason: 'The selected ports use incompatible semantics.' }
    return { valid: true as const, sourceSemantic: pair.output.semantic, targetSemantic: pair.input.semantic }
  }
}

export const arePortSemanticsCompatible = (source: PortSemantic, target: PortSemantic): boolean => {
  if (source === 'publish') return target === 'consume'
  if (source === 'hit' || source === 'miss' || source === 'success' || source === 'failure') return target === 'request'
  return source === target
}

export interface PolicyManifest<TConfig extends Record<string, unknown> = Record<string, unknown>> {
  type: string
  version: number
  label: string
  description: string
  targets: readonly ('node' | 'edge' | 'group')[]
  configSchema: z.ZodType<TConfig>
  defaultConfig: TConfig
  configFields: readonly ConfigField[]
  runtimeBehavior: string
  singletonPerTarget?: boolean
}

export class PolicyRegistry {
  private readonly policies = new Map<string, PolicyManifest>()

  constructor(policies: readonly PolicyManifest[] = []) {
    policies.forEach((policy) => this.register(policy))
  }

  register<TConfig extends Record<string, unknown>>(policy: PolicyManifest<TConfig>) {
    if (!Number.isInteger(policy.version) || policy.version < 1) throw new Error(`Invalid policy version for ${policy.type}.`)
    if (policy.targets.length === 0) throw new Error(`Policy ${policy.type} must support at least one target kind.`)
    const key = manifestKey(policy.type, policy.version)
    if (this.policies.has(key)) throw new Error(`Policy ${key} is already registered.`)
    policy.configSchema.parse(policy.defaultConfig)
    this.policies.set(key, policy as PolicyManifest)
    return this
  }

  get(type: string, version: number): PolicyManifest {
    const policy = this.policies.get(manifestKey(type, version))
    if (!policy) throw new Error(`Unknown policy: ${manifestKey(type, version)}`)
    return policy
  }

  list(): PolicyManifest[] {
    return [...this.policies.values()]
  }

  validateAttachment(attachment: PolicyAttachment): PolicyAttachment {
    const manifest = this.get(attachment.type, attachment.version)
    if (!manifest.targets.includes(attachment.target.kind)) {
      throw new Error(`Policy ${attachment.type}@${attachment.version} cannot target ${attachment.target.kind}.`)
    }
    return { ...attachment, config: manifest.configSchema.parse(attachment.config) }
  }

  validateOrder(attachments: readonly PolicyAttachment[]): PolicyAttachment[] {
    const ordered = [...attachments].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    const positions = new Set<string>()
    const singletons = new Set<string>()
    for (const attachment of ordered) {
      this.validateAttachment(attachment)
      const positionKey = `${attachment.target.kind}:${attachment.target.id}:${attachment.order}`
      if (positions.has(positionKey)) throw new Error(`Policy order ${attachment.order} is duplicated for ${attachment.target.kind} ${attachment.target.id}.`)
      positions.add(positionKey)
      const manifest = this.get(attachment.type, attachment.version)
      const singletonKey = `${attachment.type}@${attachment.version}:${attachment.target.kind}:${attachment.target.id}`
      if (manifest.singletonPerTarget && singletons.has(singletonKey)) throw new Error(`Policy ${attachment.type}@${attachment.version} may only be attached once per target.`)
      singletons.add(singletonKey)
    }
    return ordered
  }
}

export type BuiltInComponentNode = ProjectComponentNode
