export interface ConceptGroup { id: string; title: string; question: string }
export interface Concept {
  id: string
  groupId: string
  title: string
  aliases: readonly string[]
  question: string
  summary: string
  prerequisiteIds: readonly string[]
  capabilityIds: readonly string[]
  labIds: readonly string[]
  caseIds: readonly string[]
}
/** Authored teaching content, deliberately separate from model or grading code. */
export interface ConceptBody {
  problem: string
  example: readonly string[]
  mechanism: readonly string[]
  conditions: readonly string[]
  counterexample: string
  check: { question: string; answer: string }
  sourceIds: readonly string[]
}
export interface LearningPath {
  id: string
  title: string
  description: string
  steps: readonly { question: string; conceptIds: readonly string[] }[]
}
