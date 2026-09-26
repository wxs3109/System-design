import { shortLinkExercise } from './short-link'
import type { DesignExercise } from './types'

export const designExercises: readonly DesignExercise[] = [shortLinkExercise]
export const getDesignExercise = (id: string) => designExercises.find((exercise) => exercise.id === id)
