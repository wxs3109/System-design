'use client'

import { useMemo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { componentPresetRegistry, componentRegistry, policyRegistry } from '@system-design/components'
import { Activity, Archive, CalendarClock, Cloud, Database, GitFork, Globe2, HardDrive, Layers3, RadioTower, Search, Server, Workflow, type LucideIcon } from 'lucide-react'
import { useWorkbenchStore, type WorkbenchNode } from '@/lib/store'
import { localizedValue, useI18n, type Translate } from '@/lib/i18n'

export const componentIcons: Record<string, LucideIcon> = { globe: Globe2, activity: Activity, 'calendar-clock': CalendarClock, workflow: Workflow, 'git-fork': GitFork, server: Server, layers: Layers3, database: Database, 'hard-drive': HardDrive, 'radio-tower': RadioTower, archive: Archive, cloud: Cloud, search: Search }

const localizedSummary = (node: WorkbenchNode['data'], t: Translate, fallback: string) => {
  const config = node.config as Record<string, string | number>
  switch (node.type) {
    case 'traffic': return t('summary.workload-source', {}, fallback)
    case 'scheduler': return t('summary.scheduler', { runs: config.scheduleMode === 'batch' ? config.batchSize! : 1, interval: config.intervalMs!, concurrency: config.concurrencyLimit!, policy: localizedValue(t, String(config.missedRunPolicy)) }, fallback)
    case 'workflow': return t('summary.workflow', { executions: config.maxConcurrentInstances!, persistence: config.persistenceTimeMs! }, fallback)
    case 'network': return t('summary.network', { latency: config.latencyMs!, bandwidth: config.bandwidthMbps! }, fallback)
    case 'load-balancer': return t('summary.load-balancer', { algorithm: localizedValue(t, String(config.algorithm)), capacity: config.capacity! }, fallback)
    case 'global-router': return t('summary.global-router', { policy: localizedValue(t, String(config.routingPolicy)), ttl: config.decisionTtlMs!, delay: config.failoverDelayMs! }, fallback)
    case 'realtime-gateway': return t('summary.realtime-gateway', { connections: config.maxConnections!, channels: config.defaultChannelCount!, policy: localizedValue(t, String(config.overflowPolicy)) }, fallback)
    case 'service': return t('summary.service', { replicas: config.replicas!, concurrency: config.concurrencyPerReplica! }, fallback)
    case 'queue': return t('summary.queue', { consumers: config.consumers!, depth: config.maxDepth! }, fallback)
    case 'cache': return t('summary.cache', { entries: config.capacityEntries!, ttl: config.ttlMs!, policy: localizedValue(t, String(config.evictionPolicy)) }, fallback)
    case 'cdn': return t('summary.cdn', { pops: config.popCount!, selection: localizedValue(t, String(config.popSelection)), entries: config.capacityEntriesPerPop! }, fallback)
    case 'search-index': return t('summary.search-index', { shards: config.shardCount!, replicas: config.replicasPerShard!, refresh: config.refreshIntervalMs! }, fallback)
    case 'stream': return t('summary.stream', { partitions: config.partitions!, groups: config.consumerGroups!, batch: config.batchSize! }, fallback)
    case 'topic': return t('summary.topic', { subscriptions: config.subscriptionCount!, retention: config.retentionMs!, batch: config.batchSize! }, fallback)
    case 'object-storage': return t('summary.object-storage', { concurrency: config.maxConcurrentRequests!, read: config.readThroughputMbps!, write: config.writeThroughputMbps! }, fallback)
    case 'database': return 'shardCount' in config
      ? t('summary.sharded-database', { shards: config.shardCount!, replicas: config.replicasPerShard!, preference: localizedValue(t, String(config.readPreference)) }, fallback)
      : t('summary.database', { connections: config.maxConnections!, queryTime: config.queryTimeMs! }, fallback)
    default: return fallback
  }
}

export function ComponentNode({ data, selected }: NodeProps<WorkbenchNode>) {
  const { t } = useI18n()
  const manifest = componentRegistry.get(data.type, data.componentVersion)
  const preset = data.rolePreset ? componentPresetRegistry.find(data.rolePreset.id, data.rolePreset.version) : undefined
  const allPolicies = useWorkbenchStore((state) => state.project.topology.policies)
  const policies = useMemo(() => allPolicies
    .filter((policy) => policy.target.kind === 'node' && policy.target.id === data.id)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id)), [allPolicies, data.id])
  const Icon = componentIcons[preset?.iconToken ?? manifest.iconToken] ?? Server
  const inputs = manifest.ports.filter((port) => port.direction === 'input')
  const outputs = manifest.ports.filter((port) => port.direction === 'output')
  const portTitle = (port: (typeof manifest.ports)[number]) => `${t(port.label)} · ${port.semantic}`
  const summary = localizedSummary(data, t, componentRegistry.describeNode(data))
  return (
    <div className={`component-node${selected ? ' is-selected' : ''}`} style={{ '--node-color': manifest.color } as React.CSSProperties}>
      {inputs.map((port, index) => <Handle key={port.id} id={port.id} type="target" position={Position.Left} title={portTitle(port)} aria-label={`${t(port.label)} ${t('Input port')}`} style={{ top: `${((index + 1) / (inputs.length + 1)) * 100}%` }} />)}
      <div className="component-node__icon"><Icon size={18} aria-hidden="true" /></div>
      <div className="component-node__copy"><strong title={data.name}>{data.name}</strong><span title={t(`component.${data.type}`, {}, manifest.label)}>{t(`component.${data.type}`, {}, manifest.label)}</span>{preset ? <em>{t('Template: {name}', { name: t(`preset.${preset.label}`, {}, preset.label) })}</em> : null}<small title={summary}>{summary}</small>{policies.length ? <div className="component-node__policies" aria-label={t('Attached policies')}>{policies.map((policy) => <span key={policy.id} className={policy.enabled ? undefined : 'is-disabled'}>{policyRegistry.get(policy.type, policy.version).label}</span>)}</div> : null}</div>
      {outputs.map((port, index) => <Handle key={port.id} id={port.id} type="source" position={Position.Right} title={portTitle(port)} aria-label={`${t(port.label)} ${t('Output port')}`} style={{ top: `${((index + 1) / (outputs.length + 1)) * 100}%` }} />)}
    </div>
  )
}
