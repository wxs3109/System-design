import { notFound } from 'next/navigation'
import { getExercise } from '@/features/practice/exercises'
import { PracticeWorkbench } from '@/features/practice/practice-workbench'

export default async function ExercisePage({ params }: { params: Promise<{ exerciseId: string }> }) {
  const { exerciseId } = await params
  if (!getExercise(exerciseId)) notFound()
  return <PracticeWorkbench exerciseId={exerciseId} />
}
