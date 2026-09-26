import { notFound } from 'next/navigation'
import { concepts, getConcept } from '@/features/learning/catalog'
import { ConceptPage } from '@/features/learning/concept-page'

export function generateStaticParams() { return concepts.map((concept) => ({ conceptId: concept.id })) }
export async function generateMetadata({ params }: { params: Promise<{ conceptId: string }> }) {
  const concept = getConcept((await params).conceptId)
  return concept ? { title: `${concept.title} · System Design Lab`, description: concept.summary } : { title: '未找到概念 · System Design Lab' }
}
export default async function KnowledgePage({ params }: { params: Promise<{ conceptId: string }> }) {
  const concept = getConcept((await params).conceptId)
  if (!concept) notFound()
  return <ConceptPage concept={concept} />
}
