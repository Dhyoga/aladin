import { request as httpRequest, createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createApp, createRouter, eventHandler, toNodeListener } from 'h3'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleCallbackRequest } from '../../server/utils/callback-request'
import { createHandlerRegistry } from '../../server/utils/job-handlers'
import { handleJobStatusRequest } from '../../server/utils/job-status'
import { createJob, getJob, markRunning } from '../../server/utils/jobs'
import { MAX_CALLBACK_REQUEST_BYTES } from '../../shared/schemas/n8n-contracts'
import type { JobType } from '../../shared/schemas/job'
import { useTestDatabase } from './helpers'

const SECRET = 'a-very-long-shared-secret-of-32-chars!'
const MINUTE = 60_000

const testDb = useTestDatabase()

const registry = createHandlerRegistry()
let server: Server
let baseUrl: string

// The database is created per test, but the server lives for the whole file, so the
// routes look it up lazily.
beforeAll(async () => {
  const app = createApp()
  const router = createRouter()
  router.post('/api/n8n/callback', eventHandler(event =>
    handleCallbackRequest(event, { sharedSecret: SECRET, callbackDeps: { db: testDb.db, registry } })))
  router.get('/api/jobs/:id', eventHandler(event => handleJobStatusRequest(event, testDb.db)))
  app.use(router)

  server = createServer(toNodeListener(app))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()))
})

const postPayload = JSON.stringify({
  caption: 'Halo',
  hashtags: ['#a'],
  image_brief: { headline: 'Judul', scene: 'meja kayu' }
})

function startedJob(type: JobType = 'post') {
  const job = createJob(testDb.db, { type })
  markRunning(testDb.db, job.id)
  return job
}

function form(fields: Record<string, string>, files: Record<string, { name: string, type: string, data: string }> = {}) {
  const body = new FormData()
  for (const [key, value] of Object.entries(fields)) body.set(key, value)
  for (const [key, file] of Object.entries(files)) body.set(key, new Blob([file.data], { type: file.type }), file.name)
  return body
}

const callback = (body: BodyInit, headers: Record<string, string> = { 'x-aladin-secret': SECRET }) =>
  fetch(`${baseUrl}/api/n8n/callback`, { method: 'POST', headers, body })

describe('POST /api/n8n/callback: access control', () => {
  it('answers 404 when the request went through the public proxy, even with the right secret', async () => {
    const job = startedJob()
    const res = await callback(form({ job_id: job.id, event: 'failed', error: 'x' }), {
      'x-aladin-secret': SECRET,
      'x-forwarded-host': 'aladin.serdadu.dev'
    })
    expect(res.status).toBe(404)
    expect(getJob(testDb.db, job.id)!.status).toBe('running')
  })

  it.each([
    ['wrong', { 'x-aladin-secret': 'wrong' }],
    ['missing', {}],
    ['empty', { 'x-aladin-secret': '' }],
    ['a prefix of the real one', { 'x-aladin-secret': SECRET.slice(0, 12) }]
  ])('answers 401 for a %s secret and changes nothing', async (_name, headers) => {
    const job = startedJob()
    const res = await callback(form({ job_id: job.id, event: 'failed', error: 'x' }), headers)
    expect(res.status).toBe(401)
    expect(getJob(testDb.db, job.id)!.status).toBe('running')
  })

  it('answers 401 before looking at the body, even when the body is garbage', async () => {
    const res = await fetch(`${baseUrl}/api/n8n/callback`, {
      method: 'POST',
      headers: { 'x-aladin-secret': 'wrong', 'content-type': 'application/json' },
      body: '{not even json'
    })
    expect(res.status).toBe(401)
  })

  it('answers 413 when Content-Length is over the limit, before reading the body', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(`${baseUrl}/api/n8n/callback`, {
        method: 'POST',
        headers: {
          'x-aladin-secret': SECRET,
          'content-type': 'multipart/form-data; boundary=x',
          'content-length': String(MAX_CALLBACK_REQUEST_BYTES + 1)
        }
      }, (res) => {
        resolve(res.statusCode ?? 0)
        req.destroy()
      })
      req.on('error', (error) => {
        // destroying the request after the response is expected to surface as a reset
        if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(error)
      })
      req.flushHeaders()
    })
    expect(status).toBe(413)
  })
})

describe('POST /api/n8n/callback: validation', () => {
  it('answers 400 for an unknown event', async () => {
    const job = startedJob()
    expect((await callback(form({ job_id: job.id, event: 'done' }))).status).toBe(400)
  })

  it('answers 400 for a missing job_id', async () => {
    expect((await callback(form({ event: 'failed' }))).status).toBe(400)
  })

  it('answers 400 when the body is not multipart', async () => {
    const res = await fetch(`${baseUrl}/api/n8n/callback`, {
      method: 'POST',
      headers: { 'x-aladin-secret': SECRET, 'content-type': 'application/json' },
      body: JSON.stringify({ job_id: 'job_1', event: 'failed' })
    })
    expect(res.status).toBe(400)
  })

  it('answers 404 for an unknown job', async () => {
    expect((await callback(form({ job_id: 'job_missing', event: 'progress', stage: 'x' }))).status).toBe(404)
  })
})

describe('POST /api/n8n/callback: events', () => {
  beforeEach(() => {
    registry.register('post', { onCompleted: vi.fn() })
  })

  it('applies a progress event', async () => {
    const job = startedJob('video')
    const res = await callback(form({ job_id: job.id, event: 'progress', stage: 'storyboard' }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, status: 'running' })
    expect(getJob(testDb.db, job.id)).toMatchObject({ status: 'running', stage: 'storyboard' })
  })

  it('applies a completed event with a file and calls the handler with it', async () => {
    const onCompleted = vi.fn()
    registry.register('post', { onCompleted })
    const job = startedJob()

    const res = await callback(form(
      { job_id: job.id, event: 'completed', payload: postPayload },
      { image: { name: 'post.png', type: 'image/png', data: 'PNGDATA' } }
    ))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, status: 'completed' })
    expect(getJob(testDb.db, job.id)!.status).toBe('completed')

    const context = onCompleted.mock.calls[0]![0]
    expect(context.payload.caption).toBe('Halo')
    expect(context.files.image).toMatchObject({ field: 'image', filename: 'post.png', mime: 'image/png' })
    expect(context.files.image.data.toString()).toBe('PNGDATA')
  })

  it('answers 200 and fails the job for an invalid completed payload', async () => {
    const job = startedJob()
    const res = await callback(form(
      { job_id: job.id, event: 'completed', payload: '{"hashtags":[]}' },
      { image: { name: 'post.png', type: 'image/png', data: 'x' } }
    ))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, status: 'failed' })
    expect(getJob(testDb.db, job.id)!.error).toMatch(/^invalid_payload/)
  })

  it('applies a failed event', async () => {
    const job = startedJob()
    const res = await callback(form({ job_id: job.id, event: 'failed', error: 'Gemini quota exceeded' }))

    expect(res.status).toBe(200)
    expect(getJob(testDb.db, job.id)).toMatchObject({ status: 'failed', error: 'Gemini quota exceeded' })
  })

  it('ignores a file with an unknown name', async () => {
    const onProgress = vi.fn()
    registry.register('post', { onProgress, onCompleted: vi.fn() })
    const job = startedJob()

    const res = await callback(form(
      { job_id: job.id, event: 'progress', stage: 'caption' },
      { extra: { name: 'x.bin', type: 'application/octet-stream', data: 'x' } }
    ))

    expect(res.status).toBe(200)
    expect(onProgress.mock.calls[0]![0].files).toEqual({})
  })

  it('treats a duplicate completed callback as a no-op', async () => {
    const onCompleted = vi.fn()
    registry.register('post', { onCompleted })
    const job = startedJob()
    const send = () => callback(form(
      { job_id: job.id, event: 'completed', payload: postPayload },
      { image: { name: 'post.png', type: 'image/png', data: 'x' } }
    ))

    expect((await send()).status).toBe(200)
    const second = await send()
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual({ ok: true, status: 'completed' })
    expect(onCompleted).toHaveBeenCalledTimes(1)
  })
})

describe('GET /api/jobs/:id', () => {
  it('returns the job in camelCase with no-store', async () => {
    const job = createJob(testDb.db, { type: 'video', brandId: 'b1', generationId: 'g1' })
    markRunning(testDb.db, job.id, job.createdAt + 5, 'script')

    const res = await fetch(`${baseUrl}/api/jobs/${job.id}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({
      id: job.id,
      type: 'video',
      status: 'running',
      stage: 'script',
      error: null,
      brandId: 'b1',
      generationId: 'g1',
      createdAt: job.createdAt,
      startedAt: job.createdAt + 5,
      finishedAt: null,
      updatedAt: job.createdAt + 5
    })
  })

  it('answers 404 for an unknown job', async () => {
    expect((await fetch(`${baseUrl}/api/jobs/job_missing`)).status).toBe(404)
  })

  it('answers 400 for an over-long id', async () => {
    expect((await fetch(`${baseUrl}/api/jobs/${'x'.repeat(65)}`)).status).toBe(400)
  })

  it('fails a job that ran too long and reports the timeout', async () => {
    const job = createJob(testDb.db, { type: 'post' }, Date.now() - 6 * MINUTE)
    markRunning(testDb.db, job.id, Date.now() - 6 * MINUTE)

    const body = await (await fetch(`${baseUrl}/api/jobs/${job.id}`)).json()
    expect(body).toMatchObject({ status: 'failed', error: 'timeout' })
    expect(getJob(testDb.db, job.id)).toMatchObject({ status: 'failed', error: 'timeout' })
  })
})
