import type { DesignConfig, ProductResult } from './model-contracts'
import type { ExperimentVersions } from '../../core/experiments/versions'
import type { LegacyProductAttempt } from './compat/v1/attempt'
export type { DesignConfig, DesignEvent, ProductResult } from './model-contracts'
export interface DesignCheck { label: string; pass: boolean; detail: string }
export interface ProductView {
  events: { step: number; action: string; detail: string }[]
  tables: { title: string; columns: string[]; rows: (string | number)[][] }[]
  diagrams?: ProductDiagram[]
}
export interface ProductDiagram {
  title: string
  nodes: { id: string; label: string; x: number; y: number; selected?: boolean }[]
  edges: { from: string; to: string; label: string; closed?: boolean; selected?: boolean }[]
  circle?: { x: number; y: number; radius: number }
  grid?: { spacing: number; offsetX: number; offsetY: number }
}
export interface ProductScenario {
  id: string; title: string; goal: string; script: readonly string[]
  check: (result: ProductResult) => DesignCheck[]
}
export interface ProductDesign {
  versions: ExperimentVersions
  compatibility?: { versions: ExperimentVersions; verify: (value: unknown) => value is LegacyProductAttempt }
  id: string; kind: 'product-design'; title: string; summary: string; category: string; difficulty: string; estimatedMinutes: number
  pains: readonly string[]; requirements: readonly string[]; contracts: readonly { name: string; description: string }[]
  decisions: readonly string[]; boundary: readonly string[]; relatedLabs: readonly { id: string; title: string }[]
  fields: readonly { id: string; label: string; options: readonly { value: string; label: string }[] }[]
  initialConfig: DesignConfig
  metricLabels: readonly { key: string; label: string }[]
  actions: Readonly<Record<string, string>>
  scenarios: readonly ProductScenario[]
  alternatives: readonly { title: string; config: DesignConfig }[]
  architecture: (config: DesignConfig) => readonly string[]
  run: (config: DesignConfig, commands: readonly string[]) => ProductResult
  present: (result: ProductResult) => ProductView
}
export const check = (label: string, pass: boolean, detail: string): DesignCheck => ({ label, pass, detail })
export const choice = <const V extends string>(value: V, label: string) => ({ value, label })
