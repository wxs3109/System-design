import { serviceQueueExercise } from './service-queue'
import { databaseBottleneckExercise } from './database-bottleneck'
import { cachePressureExercise } from './cache-pressure'
import type { ExerciseDefinition } from './exercise-types'

export * from './exercise-types'
export { serviceQueueExercise, databaseBottleneckExercise, cachePressureExercise }
export const exercises: readonly ExerciseDefinition[] = [serviceQueueExercise, databaseBottleneckExercise, cachePressureExercise]
export const getExercise = (id: string): ExerciseDefinition | undefined => exercises.find((exercise) => exercise.id === id)
