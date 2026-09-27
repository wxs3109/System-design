import { notFound } from 'next/navigation'
import { experiments } from '@/experiments/registry'

export default async function ExercisePage({ params }: { params: Promise<{ exerciseId: string }> }) {
  const { exerciseId } = await params
  const entry = experiments.get(exerciseId)
  if (!entry) notFound()
  const Renderer = await entry.loadRenderer()
  return <Renderer key={exerciseId} exerciseId={exerciseId} />
}
