import { CircleAlert, Info, ShieldAlert, TriangleAlert, X } from 'lucide-react'
import type { Translate } from '@/lib/i18n'
import type { ArchitectureFinding, ArchitectureFindingRule } from '../lib/architecture-review'

const findingCopy: Record<ArchitectureFindingRule, { title: string; detail: string }> = {
  'isolated-node': { title: 'Isolated component', detail: '{name} has no enabled connections.' },
  'unreachable-node': { title: 'Unreachable component', detail: '{name} cannot be reached from an active workload or scheduler.' },
  'broker-no-consumer': { title: 'No downstream consumer', detail: '{name} has no outgoing consumer connection.' },
  'cache-no-miss-path': { title: 'Cache has no miss path', detail: '{name} has neither a topology miss path nor an Interaction cache-miss handler.' },
  'cdn-no-origin': { title: 'CDN has no origin', detail: '{name} requires a connected miss path to an origin.' },
  'single-replica-service': { title: 'Single-replica service', detail: '{name} loses all service capacity when its only replica is unavailable.' },
  'database-no-replica': { title: 'Database has no replicas', detail: '{name} has zero replicas per shard.' },
  'router-no-target': { title: 'Router has no target', detail: '{name} has no synchronous route target.' },
  'router-single-target': { title: 'Router has one target', detail: '{name} cannot route around a target failure.' },
  'retry-without-timeout': { title: 'Retry has no timeout', detail: '{source} to {target} retries failures without a bounded timeout.' },
  'cross-region-edge': { title: 'Cross-region dependency', detail: '{source} in {sourceRegion} calls {target} in {targetRegion}.' },
}

const severityIcon = { error: CircleAlert, warning: TriangleAlert, info: Info } as const

export function ArchitectureReviewPanel({ findings, t, onSelect, onClose }: { findings: ArchitectureFinding[]; t: Translate; onSelect: (finding: ArchitectureFinding) => void; onClose: () => void }) {
  const counts = { error: findings.filter((finding) => finding.severity === 'error').length, warning: findings.filter((finding) => finding.severity === 'warning').length, info: findings.filter((finding) => finding.severity === 'info').length }
  return <section className="architecture-review-panel" role="dialog" aria-label={t('Architecture review')}>
    <header><div><ShieldAlert size={15} /><span><strong>{t('Architecture review')}</strong><small>{t('{count} findings', { count: findings.length })}</small></span></div><button type="button" aria-label={t('Close architecture review')} onClick={onClose}><X size={14} /></button></header>
    <div className="architecture-review-summary"><span className="is-error">{counts.error} {t('errors')}</span><span className="is-warning">{counts.warning} {t('warnings')}</span><span>{counts.info} {t('notes')}</span></div>
    <div className="architecture-review-list">{findings.length === 0 ? <div className="architecture-review-empty"><ShieldAlert size={20} /><strong>{t('No structural risks found')}</strong><span>{t('Current static review rules passed.')}</span></div> : findings.map((finding) => {
      const Icon = severityIcon[finding.severity]
      const copy = findingCopy[finding.rule]
      return <button type="button" key={finding.id} className={`architecture-review-finding is-${finding.severity}`} onClick={() => onSelect(finding)}>
        <Icon size={14} aria-hidden="true" /><span><strong>{t(copy.title)}</strong><small>{t(copy.detail, finding.values)}</small></span>
      </button>
    })}</div>
  </section>
}
