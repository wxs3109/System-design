import type { ProjectFile } from '@system-design/model'
import type { Translate } from '@/lib/i18n'
import { canvasNodeSize } from '../lib/canvas-layout'
import { formatCanvasCount, type CanvasMetricProjection } from '../lib/canvas-metrics'

export function SimulationCanvasOverlay({ project, metrics, t }: { project: ProjectFile; metrics: CanvasMetricProjection; t: Translate }) {
  return <div className="simulation-canvas-overlay" aria-label={t('Simulation metrics overlay')}>{project.topology.nodes.flatMap((node) => {
    const metric = metrics.nodes.get(node.id)
    if (!metric) return []
    return <div key={node.id} className={`simulation-node-metric simulation-node-metric--${metric.severity}`} data-node-metric-id={node.id}
      style={{ transform: `translate(${node.position.x}px, ${node.position.y + canvasNodeSize.height + 4}px)`, width: canvasNodeSize.width }}>
      <span>{Math.round(metric.utilization * 100)}% {t('util.')}</span>
      <span>{formatCanvasCount(metric.processedRequests)} {t('processed')}</span>
      {metric.maxQueueLength > 0 ? <span>{t('queue')} {formatCanvasCount(metric.maxQueueLength)}</span> : null}
      {metric.failedRequests > 0 ? <strong>{formatCanvasCount(metric.failedRequests)} {t('failed')}</strong> : null}
    </div>
  })}</div>
}
