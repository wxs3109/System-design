import { experiments } from '../../experiments/registry'
export const designExercises = experiments.entries.filter(e => e.kind === 'design').map(e => e.definition)
export const getDesignExercise = (id: string) => designExercises.find(d => d.id === id)
