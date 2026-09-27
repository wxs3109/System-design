export interface ExecutionLease { readonly signal: AbortSignal; owns(): boolean; isCurrent(): boolean; finish(): void }
/** Shared ownership/cancellation for synchronous lessons and asynchronous worker runs. */
export class ExecutionCoordinator {
  private generation = 0
  private active: AbortController | null = null
  begin(isUnchanged: () => boolean = () => true): ExecutionLease {
    this.cancel()
    const generation = ++this.generation; const controller = new AbortController(); this.active = controller
    let finished = false
    const owns = () => !finished && generation === this.generation && this.active === controller && !controller.signal.aborted
    return {
      signal: controller.signal,
      owns,
      isCurrent: () => owns() && isUnchanged(),
      finish: () => { finished = true; if (this.active === controller) this.active = null },
    }
  }
  cancel() { const prior = this.active; this.active = null; this.generation++; prior?.abort() }
}
/** One pure replay cache, shared by validation and rendering. No lesson or UI knowledge. */
export class ModelPreview<I, O> {
  private key: string | undefined
  private result: O | undefined
  private populated = false
  constructor(private readonly compute: (input: I) => O) {}
  read(input: I): O {
    const key = JSON.stringify(input)
    if (this.populated && this.key === key) return this.result!
    const result = this.compute(structuredClone(input))
    this.result = result; this.key = key; this.populated = true
    return result
  }
}
