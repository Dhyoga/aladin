import { describe, expect, it } from 'vitest'
import {
  completeJob,
  createJob,
  expireStaleJobs,
  failJob,
  getJob,
  getJobWithTimeout,
  isTimedOut,
  markRunning,
  toJobDto,
  updateStage
} from '../../server/utils/jobs'
import { useTestDatabase } from './helpers'

const MINUTE = 60_000
const T0 = 1_800_000_000_000

const testDb = useTestDatabase()

describe('createJob', () => {
  it('creates a queued job with timestamps and no foreign keys', () => {
    const job = createJob(testDb.db, { type: 'post', brandId: 'b1' }, T0)

    expect(job.id).toMatch(/^job_[\w-]{16}$/)
    expect(job).toMatchObject({
      type: 'post',
      brandId: 'b1',
      generationId: null,
      status: 'queued',
      stage: null,
      error: null,
      startedAt: null,
      finishedAt: null,
      createdAt: T0,
      updatedAt: T0
    })
    expect(getJob(testDb.db, job.id)).toEqual(job)
  })

  it('accepts a brand id that does not exist anywhere (no foreign key)', () => {
    expect(() => createJob(testDb.db, { type: 'video', brandId: 'ghost', generationId: 'ghost' })).not.toThrow()
  })

  it('generates unique ids', () => {
    const ids = new Set(Array.from({ length: 50 }, () => createJob(testDb.db, { type: 'post' }).id))
    expect(ids.size).toBe(50)
  })
})

describe('status transitions', () => {
  it('moves queued -> running and records started_at', () => {
    const { id } = createJob(testDb.db, { type: 'post' }, T0)
    expect(markRunning(testDb.db, id, T0 + 1000)).toBe(true)
    expect(getJob(testDb.db, id)).toMatchObject({ status: 'running', startedAt: T0 + 1000, updatedAt: T0 + 1000 })
  })

  it('sets the stage together with running when asked', () => {
    const { id } = createJob(testDb.db, { type: 'video' }, T0)
    markRunning(testDb.db, id, T0 + 1, 'script')
    expect(getJob(testDb.db, id)).toMatchObject({ status: 'running', stage: 'script' })
  })

  it('only updates the stage of a running job', () => {
    const queued = createJob(testDb.db, { type: 'post' }, T0)
    expect(updateStage(testDb.db, queued.id, 'image', T0)).toBe(false)

    markRunning(testDb.db, queued.id, T0)
    expect(updateStage(testDb.db, queued.id, 'image', T0 + 5)).toBe(true)
    expect(getJob(testDb.db, queued.id)).toMatchObject({ stage: 'image', updatedAt: T0 + 5 })
  })

  it('completes a running job', () => {
    const { id } = createJob(testDb.db, { type: 'post' }, T0)
    markRunning(testDb.db, id, T0 + 1)
    expect(completeJob(testDb.db, id, T0 + 2)).toBe(true)
    expect(getJob(testDb.db, id)).toMatchObject({ status: 'completed', error: null, finishedAt: T0 + 2 })
  })

  it('lets a callback complete a job that is still queued and fills started_at', () => {
    const { id } = createJob(testDb.db, { type: 'post' }, T0)
    expect(completeJob(testDb.db, id, T0 + 3)).toBe(true)
    expect(getJob(testDb.db, id)).toMatchObject({ status: 'completed', startedAt: T0 + 3 })
  })

  it('fails a job with a truncated error', () => {
    const { id } = createJob(testDb.db, { type: 'post' }, T0)
    expect(failJob(testDb.db, id, 'x'.repeat(2000), T0 + 1)).toBe(true)
    const job = getJob(testDb.db, id)!
    expect(job.status).toBe('failed')
    expect(job.error).toHaveLength(500)
    expect(job.finishedAt).toBe(T0 + 1)
  })

  it('never changes a final job', () => {
    const done = createJob(testDb.db, { type: 'post' }, T0)
    completeJob(testDb.db, done.id, T0 + 1)
    expect(failJob(testDb.db, done.id, 'late', T0 + 2)).toBe(false)
    expect(markRunning(testDb.db, done.id, T0 + 2)).toBe(false)
    expect(updateStage(testDb.db, done.id, 'x', T0 + 2)).toBe(false)
    expect(getJob(testDb.db, done.id)).toMatchObject({ status: 'completed', error: null })

    const failed = createJob(testDb.db, { type: 'post' }, T0)
    failJob(testDb.db, failed.id, 'first', T0 + 1)
    expect(completeJob(testDb.db, failed.id, T0 + 2)).toBe(false)
    expect(failJob(testDb.db, failed.id, 'second', T0 + 2)).toBe(false)
    expect(getJob(testDb.db, failed.id)).toMatchObject({ status: 'failed', error: 'first' })
  })

  it('applies only the first of two competing transitions', () => {
    const { id } = createJob(testDb.db, { type: 'post' }, T0)
    markRunning(testDb.db, id, T0)
    expect(completeJob(testDb.db, id, T0 + 1)).toBe(true)
    expect(failJob(testDb.db, id, 'timeout', T0 + 2)).toBe(false)
    expect(getJob(testDb.db, id)!.status).toBe('completed')
  })

  it('does not regress a job a callback already completed when dispatch marks it running', () => {
    const { id } = createJob(testDb.db, { type: 'post' }, T0)
    completeJob(testDb.db, id, T0 + 1)
    expect(markRunning(testDb.db, id, T0 + 2)).toBe(false)
    expect(getJob(testDb.db, id)!.status).toBe('completed')
  })
})

describe('timeout', () => {
  const startedJob = (type: 'post' | 'video' | 'brand_extract', startedAt: number) => {
    const job = createJob(testDb.db, { type }, startedAt - 1000)
    markRunning(testDb.db, job.id, startedAt)
    return job
  }

  it('fails a post job that has run for 6 minutes', () => {
    const job = startedJob('post', T0)
    const read = getJobWithTimeout(testDb.db, job.id, T0 + 6 * MINUTE)!
    expect(read).toMatchObject({ status: 'failed', error: 'timeout' })
    expect(getJob(testDb.db, job.id)).toMatchObject({ status: 'failed', error: 'timeout' })
  })

  it('applies the 5 minute limit to brand_extract too', () => {
    const job = startedJob('brand_extract', T0)
    expect(getJobWithTimeout(testDb.db, job.id, T0 + 5 * MINUTE + 1)!.status).toBe('failed')
  })

  it('keeps a video job running after 10 minutes but fails it after 21', () => {
    const job = startedJob('video', T0)
    expect(getJobWithTimeout(testDb.db, job.id, T0 + 10 * MINUTE)!.status).toBe('running')
    expect(getJobWithTimeout(testDb.db, job.id, T0 + 21 * MINUTE)!.status).toBe('failed')
  })

  it('is not timed out exactly at the limit', () => {
    const job = startedJob('post', T0)
    expect(isTimedOut(getJob(testDb.db, job.id)!, T0 + 5 * MINUTE)).toBe(false)
    expect(isTimedOut(getJob(testDb.db, job.id)!, T0 + 5 * MINUTE + 1)).toBe(true)
  })

  it('fails a job stuck in queued, measuring from created_at', () => {
    const job = createJob(testDb.db, { type: 'post' }, T0)
    expect(getJobWithTimeout(testDb.db, job.id, T0 + 6 * MINUTE)).toMatchObject({ status: 'failed', error: 'timeout' })
  })

  it('never touches a final job', () => {
    const job = startedJob('post', T0)
    completeJob(testDb.db, job.id, T0 + 1000)
    expect(getJobWithTimeout(testDb.db, job.id, T0 + 60 * MINUTE)!.status).toBe('completed')
  })

  it('returns undefined for an unknown job', () => {
    expect(getJobWithTimeout(testDb.db, 'job_missing', T0)).toBeUndefined()
  })

  it('expires only stale jobs in bulk', () => {
    const stale = startedJob('post', T0)
    const fresh = startedJob('post', T0 + 5 * MINUTE)
    const longVideo = startedJob('video', T0)
    const done = startedJob('post', T0)
    completeJob(testDb.db, done.id, T0 + 1000)

    expect(expireStaleJobs(testDb.db, T0 + 6 * MINUTE)).toBe(1)
    expect(getJob(testDb.db, stale.id)).toMatchObject({ status: 'failed', error: 'timeout' })
    expect(getJob(testDb.db, fresh.id)!.status).toBe('running')
    expect(getJob(testDb.db, longVideo.id)!.status).toBe('running')
    expect(getJob(testDb.db, done.id)!.status).toBe('completed')
  })
})

describe('toJobDto', () => {
  it('maps columns to camelCase fields', () => {
    const job = createJob(testDb.db, { type: 'video', brandId: 'b1', generationId: 'g1' }, T0)
    expect(toJobDto(job)).toEqual({
      id: job.id,
      type: 'video',
      status: 'queued',
      stage: null,
      error: null,
      brandId: 'b1',
      generationId: 'g1',
      createdAt: T0,
      startedAt: null,
      finishedAt: null,
      updatedAt: T0
    })
  })
})
