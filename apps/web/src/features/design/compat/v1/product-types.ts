export type DesignConfig = Record<string, string>
export interface DesignEvent { step: number; action: string; detail: string }
export interface DesignCheck { label: string; pass: boolean; detail: string }
export interface ProductResult {
  events: DesignEvent[]
  metrics: Record<string, number>
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
}
export const check = (label: string, pass: boolean, detail: string): DesignCheck => ({ label, pass, detail })
export const choice = (value: string, label: string) => ({ value, label })
