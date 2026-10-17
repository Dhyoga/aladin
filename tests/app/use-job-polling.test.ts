import { effectScope } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useJobPolling } from '../../app/composables/useJobPolling'

const job = (over: Record<string, unknown> = {}) => ({
  id: 'job_1',
  type: 'brand_extract',
  status: 'running',
  stage: null,
  error: null,
  brandId: 'b1',
  generationId: null,
  createdAt: 1,
  startedAt: 1,
  finishedAt: null,
  updatedAt: 1,
  ...over
})

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useJobPolling', () => {
  it('polls right away, then every interval, and stops by itself on a final status', async () => {
    const replies = [job({ stage: 'crawling' }), job({ stage: 'structuring' }), job({ status: 'completed', finishedAt: 5 })]
    const fetchJob = vi.fn(async () => replies.shift())
    const polling = useJobPolling({ intervalMs: 2000, fetchJob })

    polling.start('job_1')
    expect(polling.isPolling.value).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(polling.stage.value).toBe('crawling')

    await vi.advanceTimersByTimeAsync(2000)
    expect(polling.stage.value).toBe('structuring')
    expect(polling.status.value).toBe('running')

    await vi.advanceTimersByTimeAsync(2000)
    expect(polling.status.value).toBe('completed')
    expect(polling.isPolling.value).toBe(false)

    await vi.advanceTimersByTimeAsync(20_000)
    expect(fetchJob).toHaveBeenCalledTimes(3)
  })

  it('stops on failed and exposes the error of the job', async () => {
    const fetchJob = vi.fn(async () => job({ status: 'failed', error: 'timeout' }))
    const polling = useJobPolling({ fetchJob })

    polling.start('job_1')
    await vi.advanceTimersByTimeAsync(0)

    expect(polling.status.value).toBe('failed')
    expect(polling.error.value).toBe('timeout')
    expect(polling.isPolling.value).toBe(false)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchJob).toHaveBeenCalledTimes(1)
  })

  it('keeps trying after a failed request and recovers', async () => {
    const fetchJob = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(job({ status: 'completed' }))
    const polling = useJobPolling({ intervalMs: 1000, fetchJob })

    polling.start('job_1')
    await vi.advanceTimersByTimeAsync(0)
    expect(polling.error.value).toBe('Could not load the job status')
    expect(polling.isPolling.value).toBe(true)

    await vi.advanceTimersByTimeAsync(1000)
    expect(polling.status.value).toBe('completed')
    expect(polling.error.value).toBeNull()
  })

  it('does not stack requests: the next poll waits for the previous answer', async () => {
    let release!: (value: unknown) => void
    const fetchJob = vi.fn(() => new Promise(resolve => (release = resolve)))
    const polling = useJobPolling({ intervalMs: 1000, fetchJob })

    polling.start('job_1')
    await vi.advanceTimersByTimeAsync(10_000) // far longer than the interval, answer still pending
    expect(fetchJob).toHaveBeenCalledTimes(1)

    release(job({ status: 'completed' }))
    await vi.advanceTimersByTimeAsync(0)
    expect(polling.status.value).toBe('completed')
  })

  it('stop() ends polling and ignores an answer that arrives afterwards', async () => {
    let release!: (value: unknown) => void
    const fetchJob = vi.fn(() => new Promise(resolve => (release = resolve)))
    const polling = useJobPolling({ fetchJob })

    polling.start('job_1')
    polling.stop()
    release(job({ status: 'completed' }))
    await vi.advanceTimersByTimeAsync(5000)

    expect(polling.isPolling.value).toBe(false)
    expect(polling.status.value).toBeNull()
    expect(fetchJob).toHaveBeenCalledTimes(1)
  })

  it('start() on another job drops the old one', async () => {
    const answers: Record<string, unknown> = {
      job_a: job({ id: 'job_a', stage: 'a' }),
      job_b: job({ id: 'job_b', stage: 'b' })
    }
    const fetchJob = vi.fn(async (id: string) => answers[id])
    const polling = useJobPolling({ intervalMs: 1000, fetchJob })

    polling.start('job_a')
    await vi.advanceTimersByTimeAsync(0)
    polling.start('job_b')
    await vi.advanceTimersByTimeAsync(3000)

    expect(polling.stage.value).toBe('b')
    expect(fetchJob.mock.calls.slice(-3).every(([id]) => id === 'job_b')).toBe(true)
  })

  it('stops when its scope is disposed', async () => {
    const fetchJob = vi.fn(async () => job())
    const scope = effectScope()
    const polling = scope.run(() => useJobPolling({ intervalMs: 1000, fetchJob }))!

    polling.start('job_1')
    await vi.advanceTimersByTimeAsync(0)
    scope.stop()
    const calls = fetchJob.mock.calls.length
    await vi.advanceTimersByTimeAsync(10_000)

    expect(fetchJob).toHaveBeenCalledTimes(calls)
    expect(polling.isPolling.value).toBe(false)
  })

  it('treats an unexpected response shape as an error instead of trusting it', async () => {
    const fetchJob = vi.fn(async () => ({ nope: true }))
    const polling = useJobPolling({ fetchJob })

    polling.start('job_1')
    await vi.advanceTimersByTimeAsync(0)
    expect(polling.error.value).toBe('Could not load the job status')
    expect(polling.status.value).toBeNull()
    polling.stop()
  })
})
