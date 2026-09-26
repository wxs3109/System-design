import { exercises } from './exercises'
import { hashingExercise } from './distribution/lesson'
import { hotKeyExercise } from './hot-key/lesson'
import { retryExercise } from './retry-idempotency/lesson'
import { messageExercises } from './message-flow/lesson'
import { exercises as coordinationExercises } from './coordination/lesson'
import { sagaExercise } from './saga/lesson'
import { concurrentExercise } from './concurrent-update/lesson'
import { overloadExercise } from './overload/lesson'
import { exercises as replicationExercises } from './replication/lesson'
import { exercise as raftExercise } from './raft/lesson'
import { exercise as commitExercise } from './two-phase-commit/lesson'
import { exercise as durabilityExercise } from './durability/lesson'
import { conceptsForLab } from '../learning/catalog'
import { designExercises } from '../design/catalog'

export const practiceCatalog = [...exercises.map((exercise) => ({ ...exercise, kind: 'simulation' as const })), hashingExercise, hotKeyExercise, retryExercise, ...messageExercises, ...coordinationExercises, sagaExercise, concurrentExercise, overloadExercise, ...replicationExercises, raftExercise, commitExercise, durabilityExercise].map((exercise) => ({ ...exercise, conceptIds: conceptsForLab(exercise.id).map((concept) => concept.id) }))
export const getPracticeEntry = (id: string) => practiceCatalog.find((entry) => entry.id === id) ?? designExercises.find((entry) => entry.id === id)
