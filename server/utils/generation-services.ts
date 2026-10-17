import { RuntimeConfigSchema } from '../../shared/schemas/runtime-config'
import { generationRequestHandlers, type GenerationHandlers } from './generation-requests'

let handlers: GenerationHandlers | undefined

/** The generation HTTP handlers, wired from runtimeConfig on first use. */
export function getGenerationHandlers(): GenerationHandlers {
  if (handlers) return handlers

  const config = RuntimeConfigSchema.parse(useRuntimeConfig())
  handlers = generationRequestHandlers({ db: getDb().db, mediaDir: config.mediaDir, dispatch: dispatchJob })
  return handlers
}
