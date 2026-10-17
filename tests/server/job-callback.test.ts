import { describe, expect, it, vi } from 'vitest'
import {
  applyJobCallback,
  CallbackFieldsError,
  parseCallbackParts,
  type ParsedCallback,
  type RawPart
} from '../../server/utils/job-callback'
import { createHandlerRegistry, type CallbackFile } from '../../server/utils/job-handlers'
import { createJob, getJob, markRunning } from '../../server/utils/jobs'
import type { CallbackFileField } from '../../shared/schemas/n8n-contracts'
import type { JobType } from '../../shared/schemas/job'
import { useTestDatabase } from './helpers'

const MINUTE = 60_000
const MB = 1024 * 1024
const T0 = 1_800_000_000_000

const testDb = useTestDatabase()

const brandDna = {
  identity: { name: 'Contoh', summary: 'Ringkasan.' },
  audience: { targetAudience: 'Mahasiswa' },
  voice: { toneOfVoice: 'Santai' },
  offer: {},
  visual: {},
  social: {}
}

const postPayload = JSON.stringify({
  caption: 'Halo',
  hashtags: ['#a'],
  image_brief: { headline: 'Judul', scene: 'meja kayu' }
})

const scriptPayload = JSON.stringify({
  script: { scenes: [{ start: 0, end: 2, visual: 'close-up', voice_over: 'Halo' }] }
})

const file = (field: CallbackFileField, size = 8): CallbackFile => ({
  field,
  filename: `${field}.bin`,
  mime: 'application/octet-stream',
  data: Buffer.alloc(size, 1)
})

function setup(type: JobType = 'post', { running = true }: { running?: boolean } = {}) {
  const clock = { now: T0 }
  const registry = createHandlerRegistry()
  const job = createJob(testDb.db, { type }, T0)
  if (running) markRunning(testDb.db, job.id, T0)

  const deps = { db: testDb.db, registry, now: () => clock.now }
  const call = (callback: Partial<ParsedCallback> & Pick<ParsedCallback, 'event'>) =>
    applyJobCallback(deps, { jobId: job.id, files: {}, ...callback })
  const read = () => getJob(testDb.db, job.id)!

  return { job, registry, clock, call, read, deps }
}

describe('parseCallbackParts', () => {
  const text = (name: string, value: string): RawPart => ({ name, data: Buffer.from(value) })
  const upload = (name: string, filename: string, type?: string): RawPart => ({
    name,
    filename,
    type,
    data: Buffer.from('bytes')
  })

  it('reads text fields and whitelisted files', () => {
    const parsed = parseCallbackParts([
      text('job_id', 'job_1'),
      text('event', 'completed'),
      text('stage', 'image'),
      text('payload', '{"a":1}'),
      upload('image', 'post.png', 'image/png')
    ])

    expect(parsed).toMatchObject({ jobId: 'job_1', event: 'completed', stage: 'image', payload: '{"a":1}' })
    expect(parsed.files.image).toMatchObject({ field: 'image', filename: 'post.png', mime: 'image/png' })
    expect(parsed.files.image?.data.toString()).toBe('bytes')
  })

  it('ignores files with other names', () => {
    const parsed = parseCallbackParts([
      text('job_id', 'job_1'),
      text('event', 'progress'),
      upload('extra', 'x.bin')
    ])
    expect(parsed.files).toEqual({})
  })

  it('defaults the mime type of a file without one', () => {
    const parsed = parseCallbackParts([text('job_id', 'j'), text('event', 'progress'), upload('video', 'v.mp4')])
    expect(parsed.files.video?.mime).toBe('application/octet-stream')
  })

  it('treats empty optional text fields as absent', () => {
    const parsed = parseCallbackParts([
      text('job_id', 'job_1'),
      text('event', 'failed'),
      text('stage', ''),
      text('payload', ''),
      text('error', '')
    ])
    expect(parsed.stage).toBeUndefined()
    expect(parsed.payload).toBeUndefined()
    expect(parsed.error).toBeUndefined()
  })

  it('throws CallbackFieldsError for an unknown event or a missing job id', () => {
    expect(() => parseCallbackParts([text('job_id', 'j'), text('event', 'done')])).toThrow(CallbackFieldsError)
    expect(() => parseCallbackParts([text('event', 'failed')])).toThrow(CallbackFieldsError)
  })
})

describe('applyJobCallback: lookup and idempotency', () => {
  it('reports an unknown job', async () => {
    const { deps } = setup()
    const result = await applyJobCallback(deps, { jobId: 'job_missing', event: 'progress', stage: 'x', files: {} })
    expect(result).toEqual({ outcome: 'not_found' })
  })

  it('ignores a duplicate completed callback and runs the handler once', async () => {
    const { registry, call, read } = setup()
    const onCompleted = vi.fn()
    registry.register('post', { onCompleted })

    const first = await call({ event: 'completed', payload: postPayload, files: { image: file('image') } })
    const second = await call({ event: 'completed', payload: postPayload, files: { image: file('image') } })

    expect(first.outcome).toBe('applied')
    expect(second.outcome).toBe('ignored')
    expect(onCompleted).toHaveBeenCalledTimes(1)
    expect(read().status).toBe('completed')
  })

  it('ignores a progress callback for a failed job and keeps its error', async () => {
    const { call, read } = setup()
    await call({ event: 'failed', error: 'boom' })

    const result = await call({ event: 'progress', stage: 'image' })
    expect(result.outcome).toBe('ignored')
    expect(read()).toMatchObject({ status: 'failed', error: 'boom', stage: null })
  })

  it('ignores a completed callback after the job timed out and runs no handler', async () => {
    const { registry, call, read, clock } = setup()
    const onCompleted = vi.fn()
    registry.register('post', { onCompleted })

    clock.now = T0 + 6 * MINUTE
    const result = await call({ event: 'completed', payload: postPayload, files: { image: file('image') } })

    expect(result.outcome).toBe('ignored')
    expect(onCompleted).not.toHaveBeenCalled()
    expect(read()).toMatchObject({ status: 'failed', error: 'timeout' })
  })

  it('runs the handler only once for two concurrent completed callbacks', async () => {
    const { registry, call, read } = setup()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const onCompleted = vi.fn(() => gate)
    registry.register('post', { onCompleted })

    const args = { event: 'completed' as const, payload: postPayload, files: { image: file('image') } }
    const first = call(args)
    const second = await call(args)
    expect(second.outcome).toBe('ignored')

    release()
    expect((await first).outcome).toBe('applied')
    expect(onCompleted).toHaveBeenCalledTimes(1)
    expect(read().status).toBe('completed')
  })
})

describe('applyJobCallback: progress', () => {
  it('sets the stage and keeps the job running', async () => {
    const { call, read } = setup('video')
    await call({ event: 'progress', stage: 'storyboard' })
    expect(read()).toMatchObject({ status: 'running', stage: 'storyboard' })
  })

  it('accepts a progress callback for a job that is still queued', async () => {
    const { call, read } = setup('post', { running: false })
    expect(read().status).toBe('queued')

    await call({ event: 'progress', stage: 'caption' })
    expect(read()).toMatchObject({ status: 'running', stage: 'caption', startedAt: T0 })
  })

  it('passes stage, payload and files to the progress hook', async () => {
    const { registry, call } = setup('video')
    const onProgress = vi.fn()
    registry.register('video', { onProgress, onCompleted: vi.fn() })

    const storyboard = file('storyboard')
    await call({ event: 'progress', stage: 'storyboard', files: { storyboard } })

    expect(onProgress).toHaveBeenCalledTimes(1)
    const context = onProgress.mock.calls[0]![0]
    expect(context.stage).toBe('storyboard')
    expect(context.files.storyboard).toBe(storyboard)
    expect(context.job).toMatchObject({ status: 'running', stage: 'storyboard' })
  })

  it('validates and passes the script payload of a video script stage', async () => {
    const { registry, call, read } = setup('video')
    const onProgress = vi.fn()
    registry.register('video', { onProgress, onCompleted: vi.fn() })

    await call({ event: 'progress', stage: 'script', payload: scriptPayload })
    expect(read().status).toBe('running')
    expect(onProgress.mock.calls[0]![0].payload).toMatchObject({ script: { scenes: [expect.any(Object)] } })
  })

  it('fails the job when the video script payload is invalid', async () => {
    const { registry, call, read } = setup('video')
    const onProgress = vi.fn()
    registry.register('video', { onProgress, onCompleted: vi.fn() })

    await call({ event: 'progress', stage: 'script', payload: JSON.stringify({ script: { scenes: [] } }) })
    expect(read().status).toBe('failed')
    expect(read().error).toMatch(/^invalid_payload/)
    expect(onProgress).not.toHaveBeenCalled()
  })

  it('fails the job when a progress payload is not JSON', async () => {
    const { call, read } = setup('video')
    await call({ event: 'progress', stage: 'script', payload: 'not json' })
    expect(read()).toMatchObject({ status: 'failed' })
    expect(read().error).toMatch(/^invalid_payload/)
  })

  it('does not validate payloads of other stages', async () => {
    const { call, read } = setup('video')
    await call({ event: 'progress', stage: 'video', payload: '{"anything":true}' })
    expect(read()).toMatchObject({ status: 'running', stage: 'video' })
  })

  it('fails the job when the progress hook throws', async () => {
    const { registry, call, read } = setup('video')
    registry.register('video', {
      onProgress: () => {
        throw new Error('cannot store storyboard')
      },
      onCompleted: vi.fn()
    })

    await call({ event: 'progress', stage: 'storyboard', files: { storyboard: file('storyboard') } })
    expect(read().status).toBe('failed')
    expect(read().error).toMatch(/^handler_failed.*cannot store storyboard/)
  })

  it('fails the job when a progress file is too large', async () => {
    const { call, read } = setup('video')
    await call({ event: 'progress', stage: 'storyboard', files: { storyboard: file('storyboard', 20 * MB + 1) } })
    expect(read().status).toBe('failed')
    expect(read().error).toMatch(/^invalid_payload.*storyboard/)
  })
})

describe('applyJobCallback: completed', () => {
  it('passes the validated payload and files to the handler and completes the job', async () => {
    const { registry, call, read } = setup()
    const onCompleted = vi.fn()
    registry.register('post', { onCompleted })
    const image = file('image')

    const result = await call({ event: 'completed', stage: 'image', payload: postPayload, files: { image } })

    expect(result.outcome).toBe('applied')
    const context = onCompleted.mock.calls[0]![0]
    expect(context.payload).toMatchObject({ caption: 'Halo', hashtags: ['#a'], image_brief: { chips: [] } })
    expect(context.files.image).toBe(image)
    expect(read()).toMatchObject({ status: 'completed', error: null })
  })

  it('does not require files for brand_extract', async () => {
    const { registry, call, read } = setup('brand_extract')
    registry.register('brand_extract', { onCompleted: vi.fn() })

    await call({ event: 'completed', payload: JSON.stringify({ brand_dna: brandDna }) })
    expect(read().status).toBe('completed')
  })

  it('fails with invalid_payload when the payload misses a field, without calling the handler', async () => {
    const { registry, call, read } = setup()
    const onCompleted = vi.fn()
    registry.register('post', { onCompleted })

    await call({
      event: 'completed',
      payload: JSON.stringify({ hashtags: [], image_brief: { headline: 'J', scene: 's' } }),
      files: { image: file('image') }
    })

    expect(read().status).toBe('failed')
    expect(read().error).toMatch(/^invalid_payload.*caption/)
    expect(onCompleted).not.toHaveBeenCalled()
  })

  it('fails with invalid_payload when the payload is not JSON', async () => {
    const { registry, call, read } = setup()
    registry.register('post', { onCompleted: vi.fn() })

    await call({ event: 'completed', payload: '{oops', files: { image: file('image') } })
    expect(read().error).toMatch(/^invalid_payload.*JSON/)
  })

  it('fails with invalid_payload when the payload is absent', async () => {
    const { registry, call, read } = setup()
    registry.register('post', { onCompleted: vi.fn() })

    await call({ event: 'completed', files: { image: file('image') } })
    expect(read().error).toMatch(/^invalid_payload.*payload is required/)
  })

  it('fails when a required file is missing and names it', async () => {
    const { registry, call, read } = setup('video')
    const onCompleted = vi.fn()
    registry.register('video', { onCompleted })

    await call({ event: 'completed', payload: scriptPayload })
    expect(read().status).toBe('failed')
    expect(read().error).toMatch(/^invalid_payload.*"video"/)
    expect(onCompleted).not.toHaveBeenCalled()
  })

  it('fails when a file exceeds its limit and names it', async () => {
    const { registry, call, read } = setup()
    registry.register('post', { onCompleted: vi.fn() })

    await call({ event: 'completed', payload: postPayload, files: { image: file('image', 20 * MB + 1) } })
    expect(read().status).toBe('failed')
    expect(read().error).toMatch(/^invalid_payload.*"image".*20 MB/)
  })

  it('accepts a file exactly at its limit', async () => {
    const { registry, call, read } = setup()
    registry.register('post', { onCompleted: vi.fn() })

    await call({ event: 'completed', payload: postPayload, files: { image: file('image', 20 * MB) } })
    expect(read().status).toBe('completed')
  })

  it('fails with handler_failed and the message when the handler throws', async () => {
    const { registry, call, read } = setup()
    registry.register('post', {
      onCompleted: () => {
        throw new Error('disk full')
      }
    })

    await call({ event: 'completed', payload: postPayload, files: { image: file('image') } })
    expect(read().status).toBe('failed')
    expect(read().error).toMatch(/^handler_failed.*disk full/)
  })

  it('fails with handler_failed when an async handler rejects', async () => {
    const { registry, call, read } = setup()
    registry.register('post', { onCompleted: () => Promise.reject(new Error('rejected later')) })

    await call({ event: 'completed', payload: postPayload, files: { image: file('image') } })
    expect(read().error).toMatch(/^handler_failed.*rejected later/)
  })

  it('fails with no_result_handler when nothing is registered for the type', async () => {
    const { call, read } = setup()
    await call({ event: 'completed', payload: postPayload, files: { image: file('image') } })
    expect(read()).toMatchObject({ status: 'failed', error: 'no_result_handler' })
  })

  it('uses a replaced handler', async () => {
    const { registry, call } = setup()
    const first = vi.fn()
    const second = vi.fn()
    registry.register('post', { onCompleted: first })
    registry.register('post', { onCompleted: second })

    await call({ event: 'completed', payload: postPayload, files: { image: file('image') } })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})

describe('applyJobCallback: failed', () => {
  it('stores the error from n8n', async () => {
    const { call, read } = setup()
    const result = await call({ event: 'failed', error: 'Gemini quota exceeded' })
    expect(result.outcome).toBe('applied')
    expect(read()).toMatchObject({ status: 'failed', error: 'Gemini quota exceeded' })
  })

  it('falls back to unknown_error', async () => {
    const { call, read } = setup()
    await call({ event: 'failed' })
    expect(read().error).toBe('unknown_error')
  })

  it('falls back to unknown_error for a blank message', async () => {
    const { call, read } = setup()
    await call({ event: 'failed', error: '   ' })
    expect(read().error).toBe('unknown_error')
  })

  it('truncates a long error to 500 characters', async () => {
    const { call, read } = setup()
    await call({ event: 'failed', error: 'x'.repeat(2000) })
    expect(read().error).toHaveLength(500)
  })

  it('fails a job that is still queued', async () => {
    const { call, read } = setup('post', { running: false })
    await call({ event: 'failed', error: 'early failure' })
    expect(read()).toMatchObject({ status: 'failed', error: 'early failure' })
  })
})
