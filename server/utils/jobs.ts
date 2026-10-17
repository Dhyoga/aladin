import { and, eq, inArray, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { jobs, type JobRow } from '../db/schema'
import { JOB_TIMEOUTS_MS, JOB_TYPES, isFinalStatus, type JobDto, type JobType } from '../../shared/schemas/job'
import type { AppDatabase } from './db'

type Db = AppDatabase['db']

const MAX_ERROR_LENGTH = 500
const OPEN = ['queued', 'running'] as const

export interface NewJob {
  type: JobType
  brandId?: string | null
  generationId?: string | null
}

export function createJob(db: Db, input: NewJob, now = Date.now()): JobRow {
  const row: JobRow = {
    id: `job_${nanoid(16)}`,
    type: input.type,
    brandId: input.brandId ?? null,
    generationId: input.generationId ?? null,
    status: 'queued',
    stage: null,
    error: null,
    createdAt: now,
    startedAt: null,
    finishedAt: null,
    updatedAt: now
  }
  db.insert(jobs).values(row).run()
  return row
}

export function getJob(db: Db, id: string): JobRow | undefined {
  return db.select().from(jobs).where(eq(jobs.id, id)).get()
}

// Every transition below is a guarded UPDATE: it only applies while the job is in a
// status the transition may start from, and returns whether it applied. better-sqlite3
// is synchronous with a single writer, so this decides races (callback vs callback vs
// timeout) without locks, and final jobs can never change.

/** queued -> running. Never regresses a job that a callback already moved forward. */
export function markRunning(db: Db, id: string, now = Date.now(), stage?: string): boolean {
  const result = db
    .update(jobs)
    .set({ status: 'running', startedAt: now, updatedAt: now, ...(stage ? { stage } : {}) })
    .where(and(eq(jobs.id, id), eq(jobs.status, 'queued')))
    .run()
  return result.changes > 0
}

export function updateStage(db: Db, id: string, stage: string, now = Date.now()): boolean {
  const result = db
    .update(jobs)
    .set({ stage, updatedAt: now })
    .where(and(eq(jobs.id, id), eq(jobs.status, 'running')))
    .run()
  return result.changes > 0
}

/** queued | running -> completed. */
export function completeJob(db: Db, id: string, now = Date.now()): boolean {
  const result = db
    .update(jobs)
    .set({
      status: 'completed',
      error: null,
      startedAt: sql`coalesce(${jobs.startedAt}, ${now})`,
      finishedAt: now,
      updatedAt: now
    })
    .where(and(eq(jobs.id, id), inArray(jobs.status, OPEN)))
    .run()
  return result.changes > 0
}

/** queued | running -> failed. The error is truncated to 500 characters. */
export function failJob(db: Db, id: string, error: string, now = Date.now()): boolean {
  const result = db
    .update(jobs)
    .set({
      status: 'failed',
      error: error.slice(0, MAX_ERROR_LENGTH),
      finishedAt: now,
      updatedAt: now
    })
    .where(and(eq(jobs.id, id), inArray(jobs.status, OPEN)))
    .run()
  return result.changes > 0
}

/** Timed out = not final and older than the limit for its type (since started_at, else created_at). */
export function isTimedOut(job: JobRow, now = Date.now()): boolean {
  if (isFinalStatus(job.status)) return false
  return now - (job.startedAt ?? job.createdAt) > JOB_TIMEOUTS_MS[job.type]
}

/** Reads a job, failing it with `timeout` first when it has run too long. */
export function getJobWithTimeout(db: Db, id: string, now = Date.now()): JobRow | undefined {
  const job = getJob(db, id)
  if (!job) return undefined
  if (!isTimedOut(job, now)) return job

  failJob(db, id, 'timeout', now)
  return getJob(db, id)
}

/** Bulk version of the timeout rule for list endpoints. Returns how many jobs were expired. */
export function expireStaleJobs(db: Db, now = Date.now()): number {
  let expired = 0
  for (const type of JOB_TYPES) {
    const cutoff = now - JOB_TIMEOUTS_MS[type]
    const result = db
      .update(jobs)
      .set({ status: 'failed', error: 'timeout', finishedAt: now, updatedAt: now })
      .where(and(
        eq(jobs.type, type),
        inArray(jobs.status, OPEN),
        sql`coalesce(${jobs.startedAt}, ${jobs.createdAt}) < ${cutoff}`
      ))
      .run()
    expired += result.changes
  }
  return expired
}

export function toJobDto(job: JobRow): JobDto {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    stage: job.stage,
    error: job.error,
    brandId: job.brandId,
    generationId: job.generationId,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    updatedAt: job.updatedAt
  }
}
