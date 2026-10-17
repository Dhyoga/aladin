import type { JobRow } from '../db/schema'
import type { JobType } from '../../shared/schemas/job'
import type { AppDatabase } from './db'
import { createJob, failJob, getJob, markRunning } from './jobs'
import type { DispatchInput, N8nClient } from './n8n-client'

export interface DispatchDeps {
  db: AppDatabase['db']
  client: N8nClient
  now?: () => number
}

export interface StartJobInput {
  type: JobType
  brandId?: string | null
  generationId?: string | null
  input: DispatchInput
}

/**
 * Creates a job (queued), sends it to n8n, then marks it running, or failed with
 * `dispatch_failed` when n8n did not accept it. Returns the job as stored.
 */
export async function startJob(deps: DispatchDeps, input: StartJobInput): Promise<JobRow> {
  const now = deps.now ?? Date.now
  const job = createJob(deps.db, { type: input.type, brandId: input.brandId, generationId: input.generationId }, now())

  try {
    await deps.client.dispatch(job, input.input)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    failJob(deps.db, job.id, `dispatch_failed: ${reason}`, now())
    return getJob(deps.db, job.id) ?? job
  }

  // A callback may already have moved the job forward (n8n answers before we get here);
  // markRunning only applies while the job is still queued.
  markRunning(deps.db, job.id, now())
  return getJob(deps.db, job.id) ?? job
}
