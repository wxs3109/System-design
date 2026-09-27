import type { ProductDiagram } from './product-types'
import styles from './product.module.css'

export function Diagram({ diagram }: { diagram: ProductDiagram }) {
  return <figure className={styles.diagram}><figcaption>{diagram.title}</figcaption><svg viewBox="0 0 620 310" role="img" aria-label={diagram.title}>
    {diagram.grid ? <g stroke="var(--border)" strokeWidth="1">{Array.from({ length: Math.ceil(620 / diagram.grid.spacing) }, (_, i) => <line key={`x${i}`} x1={diagram.grid!.offsetX + i * diagram.grid!.spacing} x2={diagram.grid!.offsetX + i * diagram.grid!.spacing} y1={0} y2={310} />)}{Array.from({ length: Math.ceil(310 / diagram.grid.spacing) }, (_, i) => <line key={`y${i}`} y1={diagram.grid!.offsetY + i * diagram.grid!.spacing} y2={diagram.grid!.offsetY + i * diagram.grid!.spacing} x1={0} x2={620} />)}</g> : null}
    {diagram.circle ? <circle cx={diagram.circle.x} cy={diagram.circle.y} r={diagram.circle.radius} fill="none" stroke="var(--cyan-deep)" strokeDasharray="5 4" /> : null}
    {diagram.edges.map((edge, i) => { const a = diagram.nodes.find((n) => n.id === edge.from)!; const b = diagram.nodes.find((n) => n.id === edge.to)!; return <g key={i}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={edge.closed ? 'var(--danger)' : edge.selected ? 'var(--cyan-deep)' : 'var(--border-bright)'} strokeWidth={edge.selected ? 4 : 2} strokeDasharray={edge.closed ? '5 4' : undefined} /><text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 10} textAnchor="middle" fill="var(--muted-bright)" fontSize="12">{edge.label}</text></g> })}
    {diagram.nodes.map((node) => <g key={node.id}><circle cx={node.x} cy={node.y} r={node.selected ? 8 : 6} fill={node.selected ? 'var(--cyan-deep)' : 'var(--muted)'} /><text x={node.x + 10} y={node.y - 10} fill="var(--text)" fontSize="12">{node.label}</text></g>)}
  </svg></figure>
}
