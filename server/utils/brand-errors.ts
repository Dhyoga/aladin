export type BrandErrorKind = 'not_found' | 'invalid' | 'conflict' | 'too_large' | 'corrupt'

/**
 * A domain error from the brand services. The HTTP layer maps `kind` to a status:
 * not_found 404, invalid 400, conflict 409, too_large 413, corrupt 500.
 */
export class BrandError extends Error {
  readonly kind: BrandErrorKind

  constructor(kind: BrandErrorKind, message: string) {
    super(message)
    this.name = 'BrandError'
    this.kind = kind
  }
}

export const BRAND_ERROR_STATUS: Record<BrandErrorKind, number> = {
  not_found: 404,
  invalid: 400,
  conflict: 409,
  too_large: 413,
  corrupt: 500
}
