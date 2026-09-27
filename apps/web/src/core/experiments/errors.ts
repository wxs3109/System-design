export class LabStorageError extends Error {
  constructor(readonly kind: 'load' | 'conflict', message: string) { super(message); this.name = 'LabStorageError' }
}
