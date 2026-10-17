import { createError, getValidatedRouterParams, setResponseHeader, type H3Event } from 'h3'
import { z } from 'zod'
import type { JobDto } from '../../shared/schemas/job'
import type { AppDatabase } from './db'
import { getJobWithTimeout, toJobDto } from './jobs'

const ParamsSchema = z.object({ id: z.string().min(1).max(64) })

/** GET /api/jobs/:id. Applies the lazy timeout before answering. */
export async function handleJobStatusRequest(
  event: H3Event,
  db: AppDatabase['db'],
  now = Date.now()
): Promise<JobDto> {
  const { id } = await getValidatedRouterParams(event, params => ParamsSchema.parse(params))

  const job = getJobWithTimeout(db, id, now)
  if (!job) {
    throw createError({ statusCode: 404, statusMessage: 'Job not found' })
  }

  // The UI polls this; it must never be served from a cache.
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return toJobDto(job)
}
