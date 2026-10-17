import { RuntimeConfigSchema } from '../../shared/schemas/runtime-config'
import { brandRequestHandlers, type BrandHandlers } from './brand-requests'

let handlers: BrandHandlers | undefined

/** The brand HTTP handlers, wired from runtimeConfig on first use. */
export function getBrandHandlers(): BrandHandlers {
  if (handlers) return handlers

  const config = RuntimeConfigSchema.parse(useRuntimeConfig())
  handlers = brandRequestHandlers({
    brand: { db: getDb().db, mediaDir: config.mediaDir, dispatch: dispatchJob },
    sharedSecret: config.sharedSecret
  })
  return handlers
}
