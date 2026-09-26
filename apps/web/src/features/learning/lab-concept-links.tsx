import Link from 'next/link'
import { BookOpen } from 'lucide-react'
import { conceptsForLab } from './catalog'
import styles from './learning.module.css'

/** Metadata only: safe to embed in both client workbenches without importing article bodies. */
export function LabConceptLinks({ labId }: { labId: string }) {
  const concepts = conceptsForLab(labId)
  if (!concepts.length) return null
  return <section className={styles.related} aria-label="本题相关基础知识"><div className={styles.relatedTitle}><BookOpen size={15} /><strong>相关基础知识</strong><Link href="/learn">全部知识</Link></div><div className={styles.relatedLinks}>{concepts.map((concept) => <Link key={concept.id} href={`/learn/${concept.id}`}>{concept.title} ↗</Link>)}</div></section>
}
