import {
  createError,
  getValidatedQuery,
  getValidatedRouterParams,
  isError,
  readBody,
  setResponseStatus,
  type H3Event
} from 'h3'
import { z } from 'zod'
import { createVideo } from './video-generation'
import { GENERATION_ERROR_STATUS, GenerationError } from './generation-errors'
import {
  createGeneration,
  deleteGeneration,
  getGeneration,
  listGenerations,
  patchGeneration,
  type GenerationDeps
} from './generations'

const STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  404: 'Not Found',
  409: 'Conflict',
  500: 'Internal Server Error'
}

/** Maps domain errors to HTTP errors; errors that are already HTTP errors pass through. */
function toHttpError(error: unknown): unknown {
  if (isError(error)) return error
  if (error instanceof GenerationError) {
    const statusCode = GENERATION_ERROR_STATUS[error.kind]
    return createError({ statusCode, statusMessage: STATUS_TEXT[statusCode], message: error.message })
  }
  return error
}

const guard = <T>(handler: (event: H3Event) => Promise<T>) => async (event: H3Event): Promise<T> => {
  try {
    return await handler(event)
  } catch (error) {
    throw toHttpError(error)
  }
}

const IdParams = z.object({ id: z.string().min(1).max(64) })
const ListQuery = z.object({ brandId: z.string().max(64).optional() })

/** The HTTP handlers of the generations API. Each one is ready to be used as a route handler. */
export function generationRequestHandlers(deps: GenerationDeps) {
  return {
    list: guard(async (event) => {
      const { brandId } = await getValidatedQuery(event, query => ListQuery.parse(query))
      return listGenerations(deps, brandId)
    }),

    // The body is parsed by the service, so the user gets its readable message (not a Zod dump).
    create: guard(async (event) => {
      const body = await readBody(event).catch(() => {
        throw new GenerationError('invalid', 'The request body must be JSON')
      })
      const generation = await createGeneration(deps, body)
      setResponseStatus(event, 201)
      return generation
    }),

    get: guard(async (event) => {
      const { id } = await getValidatedRouterParams(event, params => IdParams.parse(params))
      return getGeneration(deps, id)
    }),

    patch: guard(async (event) => {
      const { id } = await getValidatedRouterParams(event, params => IdParams.parse(params))
      const body = await readBody(event).catch(() => {
        throw new GenerationError('invalid', 'The request body must be JSON')
      })
      return patchGeneration(deps, id, body ?? {})
    }),

    // Starts the video of a finished post (about $1). 409 for every case where it must not start.
    video: guard(async (event) => {
      const { id } = await getValidatedRouterParams(event, params => IdParams.parse(params))
      const generation = await createVideo(deps, id)
      setResponseStatus(event, 201)
      return generation
    }),

    remove: guard(async (event) => {
      const { id } = await getValidatedRouterParams(event, params => IdParams.parse(params))
      await deleteGeneration(deps, id)
      setResponseStatus(event, 204)
      return null
    })
  }
}

export type GenerationHandlers = ReturnType<typeof generationRequestHandlers>
