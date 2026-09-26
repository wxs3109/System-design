/** Shared display contract. Models provide facts; the timeline does not infer them. */
export interface TimelineEvent { index: number; at: number; kind: string; from: string; to: string; subject: string | null; detail: string }
