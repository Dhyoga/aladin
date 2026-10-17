export type GenerationErrorKind = 'not_found' | 'invalid' | 'conflict' | 'corrupt'

/**
 * A domain error from the generation services. The HTTP layer maps `kind` to a status:
 * not_found 404, invalid 400, conflict 409, corrupt 500.
 */
export class GenerationError extends Error {
  readonly kind: GenerationErrorKind

  constructor(kind: GenerationErrorKind, message: string) {
    super(message)
    this.name = 'GenerationError'
    this.kind = kind
  }
}

export const GENERATION_ERROR_STATUS: Record<GenerationErrorKind, number> = {
  not_found: 404,
  invalid: 400,
  conflict: 409,
  corrupt: 500
}
