/** Preserve array/declaration order: it can affect deterministic execution. */
export const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
