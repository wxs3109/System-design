import { notFound } from 'next/navigation'
import { experiments } from '@/experiments/registry'
import { ExperimentBoundary } from '@/components/experiments/recovery-boundary'

export default async function ExercisePage({ params }: { params: Promise<{ exerciseId: string }> }) {
  const { exerciseId } = await params
  const entry = experiments.get(exerciseId)
  if (!entry) notFound()
  const Renderer = await entry.loadRenderer()
  return <ExperimentBoundary key={exerciseId}><Renderer exerciseId={exerciseId} /></ExperimentBoundary>
}
