import { z } from 'zod'

export const JOB_TYPES = ['brand_extract', 'post', 'video'] as const
export const JOB_STATUSES = ['queued', 'running', 'completed', 'failed'] as const

export type JobType = (typeof JOB_TYPES)[number]
export type JobStatus = (typeof JOB_STATUSES)[number]

const MINUTE = 60_000

/** A non-final job older than this (since started_at, or created_at) is failed with `timeout`. */
export const JOB_TIMEOUTS_MS: Record<JobType, number> = {
  brand_extract: 5 * MINUTE,
  post: 5 * MINUTE,
  video: 20 * MINUTE
}

export function isFinalStatus(status: JobStatus): boolean {
  return status === 'completed' || status === 'failed'
}

/** Shape returned by GET /api/jobs/:id. */
export const JobDtoSchema = z.object({
  id: z.string(),
  type: z.enum(JOB_TYPES),
  status: z.enum(JOB_STATUSES),
  stage: z.string().nullable(),
  error: z.string().nullable(),
  brandId: z.string().nullable(),
  generationId: z.string().nullable(),
  createdAt: z.number(),
  startedAt: z.number().nullable(),
  finishedAt: z.number().nullable(),
  updatedAt: z.number()
})

export type JobDto = z.infer<typeof JobDtoSchema>
