import type { z } from 'zod'
import type { Fault, PolicyAttachment, PortSemantic, Position, ProjectComponentNode, ProjectFile, ProjectFileV2 } from '@system-design/model'

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

/**
 * A palette-level architectural building block. Categories organize discovery
 * only; executable semantics always come from a behavior variant.
 */
export interface ComponentCategoryManifest {
  id: string
  label: string
  description: string
  iconToken: string
  color: string
  order: number
}

export interface BehaviorVariantManifest<TConfig extends Record<string, unknown> = Record<string, unknown>> {
  type: string
  version: number
  label: string
  description: string
  /** Stable owning category ID. This manifest is the executable variant. */
  category: string
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

/** @deprecated Use BehaviorVariantManifest. */
export type ComponentManifest<TConfig extends Record<string, unknown> = Record<string, unknown>> = BehaviorVariantManifest<TConfig>

export interface RegistryNode {
  id: string
  name: string
  type: string
  componentVersion: number
  position: Position
  disabled?: boolean
  rolePreset?: { id: string; version: number }
  config: Record<string, unknown>
}

export interface ComponentPresetManifest {
  id: string
  version: number
  label: string
  description: string
  iconToken: string
  behavior: { type: string; version: number }
  configOverrides: Record<string, unknown>
  /** Legacy presets remain resolvable for imports but cannot be newly selected. */
  availability?: 'active' | 'legacy'
}

/** @deprecated Use ComponentPresetManifest. */
export type RolePresetManifest = ComponentPresetManifest

const manifestKey = (type: string, version: number) => `${type}@${version}`

export class ComponentCategoryRegistry {
  private readonly categories = new Map<string, ComponentCategoryManifest>()

  constructor(categories: readonly ComponentCategoryManifest[] = []) {
    categories.forEach((category) => this.register(category))
  }

  register(category: ComponentCategoryManifest) {
    if (!category.id.trim() || !category.label.trim() || !Number.isInteger(category.order) || category.order < 0) {
      throw new Error(`Invalid component category: ${category.id}.`)
    }
    if (this.categories.has(category.id)) throw new Error(`Component category ${category.id} is already registered.`)
    this.categories.set(category.id, category)
    return this
  }

  get(id: string): ComponentCategoryManifest {
    const category = this.categories.get(id)
    if (!category) throw new Error(`Unknown component category: ${id}`)
    return category
  }

  find(id: string): ComponentCategoryManifest | undefined { return this.categories.get(id) }

  list(): ComponentCategoryManifest[] {
    return [...this.categories.values()].sort((left, right) => left.order - right.order || left.label.localeCompare(right.label))
  }
}

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

  listAll(): ComponentManifest[] { return [...this.manifests.values()] }

  listByCategory(categoryId: string): ComponentManifest[] {
    return this.list().filter((manifest) => manifest.category === categoryId)
  }

  createNode(type: string, id: string, position: Position, workloadId = `${id}-workload`): RegistryNode {
    return this.createNodeAtVersion(type, this.get(type).version, id, position, workloadId)
  }

  createNodeAtVersion(type: string, version: number, id: string, position: Position, workloadId = `${id}-workload`): RegistryNode {
    const manifest = this.get(type, version)
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

  validateProject<T extends ProjectFileV2 | ProjectFile>(project: T, presets?: ComponentPresetRegistry): T {
    return {
      ...project,
      topology: {
        ...project.topology,
        nodes: project.topology.nodes.map((node) => this.validateNode(presets?.validateReference(node) ?? node)),
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

/**
 * The complete creation hierarchy exposed to editors. Registration verifies
 * that every variant belongs to a known category and every preset belongs to
 * one exact, executable variant.
 */
export class ComponentCatalog {
  constructor(
    readonly categories: ComponentCategoryRegistry,
    readonly variants: ComponentRegistry,
    readonly presets: ComponentPresetRegistry,
  ) {
    this.validate()
  }

  private validate() {
    for (const variant of this.variants.listAll()) this.categories.get(variant.category)
    for (const preset of this.presets.list()) this.variants.get(preset.behavior.type, preset.behavior.version)
    return this
  }

  listCategories(): ComponentCategoryManifest[] {
    return this.categories.list().filter((category) => this.variants.listByCategory(category.id).length > 0)
  }

  listVariants(categoryId: string): ComponentManifest[] {
    this.categories.get(categoryId)
    return this.variants.listByCategory(categoryId)
  }

  listPresets(type: string, version?: number, options: { includeLegacy?: boolean } = {}): ComponentPresetManifest[] {
    return this.presets.listForVariant(type, version, options)
  }

  getCategoryForVariant(type: string, version?: number): ComponentCategoryManifest {
    return this.categories.get(this.variants.get(type, version).category)
  }

  createNode(categoryId: string, type: string, nodeId: string, position: Position, options: { version?: number; preset?: { id: string; version: number }; workloadId?: string } = {}): RegistryNode {
    const variant = this.variants.get(type, options.version)
    if (variant.category !== categoryId) throw new Error(`Behavior variant ${manifestKey(type, variant.version)} does not belong to category ${categoryId}.`)
    const workloadId = options.workloadId ?? `${nodeId}-workload`
    if (!options.preset) return this.variants.createNodeAtVersion(type, variant.version, nodeId, position, workloadId)
    const preset = this.presets.get(options.preset.id, options.preset.version)
    if (preset.availability === 'legacy') throw new Error(`Preset ${manifestKey(preset.id, preset.version)} is retained for compatibility and cannot create new components.`)
    if (preset.behavior.type !== variant.type || preset.behavior.version !== variant.version) {
      throw new Error(`Preset ${manifestKey(preset.id, preset.version)} does not belong to behavior variant ${manifestKey(variant.type, variant.version)}.`)
    }
    return this.presets.createNode(preset.id, preset.version, nodeId, position, workloadId)
  }
}

export class ComponentPresetRegistry {
  private readonly presets = new Map<string, ComponentPresetManifest>()

  constructor(private readonly components: ComponentRegistry, presets: readonly ComponentPresetManifest[] = []) {
    presets.forEach((preset) => this.register(preset))
  }

  register(preset: ComponentPresetManifest) {
    if (!preset.id.trim() || !Number.isInteger(preset.version) || preset.version < 1) throw new Error(`Invalid role preset: ${preset.id}.`)
    const key = manifestKey(preset.id, preset.version)
    if (this.presets.has(key)) throw new Error(`Role preset ${key} is already registered.`)
    const behavior = this.components.get(preset.behavior.type, preset.behavior.version)
    behavior.configSchema.parse({ ...behavior.createDefaultConfig({ nodeId: 'preset-validation', workloadId: 'preset-validation-workload' }), ...preset.configOverrides })
    this.presets.set(key, preset)
    return this
  }

  get(id: string, version: number): ComponentPresetManifest {
    const preset = this.presets.get(manifestKey(id, version))
    if (!preset) throw new Error(`Unknown role preset: ${manifestKey(id, version)}`)
    return preset
  }

  find(id: string, version: number): ComponentPresetManifest | undefined { return this.presets.get(manifestKey(id, version)) }

  list(): ComponentPresetManifest[] { return [...this.presets.values()] }

  listForVariant(type: string, version?: number, options: { includeLegacy?: boolean } = {}): ComponentPresetManifest[] {
    const resolvedVersion = version ?? this.components.get(type).version
    this.components.get(type, resolvedVersion)
    return this.list().filter((preset) => preset.behavior.type === type
      && preset.behavior.version === resolvedVersion
      && (options.includeLegacy || preset.availability !== 'legacy'))
  }

  createNode(id: string, version: number, nodeId: string, position: Position, workloadId = `${nodeId}-workload`): RegistryNode {
    const preset = this.get(id, version)
    if (preset.availability === 'legacy') {
      throw new Error(`Preset ${manifestKey(preset.id, preset.version)} is retained for compatibility and cannot create new components.`)
    }
    const behavior = this.components.get(preset.behavior.type, preset.behavior.version)
    const defaults = behavior.createDefaultConfig({ nodeId, workloadId })
    return {
      id: nodeId, name: preset.label, type: preset.behavior.type, componentVersion: preset.behavior.version, position,
      rolePreset: { id: preset.id, version: preset.version }, config: behavior.configSchema.parse({ ...defaults, ...preset.configOverrides }),
    }
  }

  validateReference(node: ProjectComponentNode, requireKnown = false): ProjectComponentNode {
    if (!node.rolePreset) return node
    const preset = this.find(node.rolePreset.id, node.rolePreset.version)
    if (!preset) {
      if (requireKnown) throw new Error(`Unknown role preset: ${manifestKey(node.rolePreset.id, node.rolePreset.version)}`)
      return node
    }
    if (node.type !== preset.behavior.type || node.componentVersion !== preset.behavior.version) throw new Error(`Role preset ${preset.id}@${preset.version} requires ${preset.behavior.type}@${preset.behavior.version}.`)
    return node
  }
}

/** @deprecated Use ComponentPresetRegistry. */
export { ComponentPresetRegistry as RolePresetRegistry }

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
