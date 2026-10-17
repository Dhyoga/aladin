import { describe, expect, it, vi } from 'vitest'
import { BrandDNA } from '../../shared/schemas/brand-dna'
import { startJob } from '../../server/utils/job-dispatch'
import { createJob, getJob } from '../../server/utils/jobs'
import {
  buildWebhookRequest,
  createN8nClient,
  type DispatchInput,
  type N8nClient
} from '../../server/utils/n8n-client'
import { useTestDatabase } from './helpers'

const SECRET = 'super-secret-shared-value-0123456789'
const T0 = 1_800_000_000_000

const testDb = useTestDatabase()

const brandDna = BrandDNA.parse({
  identity: { name: 'Contoh', summary: 'Ringkasan.' },
  audience: { targetAudience: 'Mahasiswa' },
  voice: { toneOfVoice: 'Santai' },
  offer: {},
  visual: {},
  social: {}
})

const postInput = {
  brand_dna: brandDna,
  prompt: 'promo ramadan',
  aspect_ratio: '4:5',
  assets: [{ id: 'ast_1', kind: 'product_photo', mime: 'image/jpeg', label: 'depan' }]
} as DispatchInput

function liveClient(overrides: Partial<Parameters<typeof createN8nClient>[0]> & { fetchFn: typeof fetch }) {
  return createN8nClient({
    mode: 'live',
    baseUrl: 'http://n8n:5678',
    secret: SECRET,
    appInternalUrl: 'http://aladin:3000',
    ...overrides
  })
}

const okResponse = () => new Response('{"message":"Workflow was started"}', { status: 200 })

describe('buildWebhookRequest', () => {
  it('derives callback and asset URLs from appInternalUrl without a double slash', () => {
    const body = buildWebhookRequest('post', 'job_1', 'http://aladin:3000/', postInput)
    expect(body).toMatchObject({
      job_id: 'job_1',
      callback_url: 'http://aladin:3000/api/n8n/callback',
      asset_base_url: 'http://aladin:3000/api/internal/assets'
    })
  })

  it('adds the fixed duration and aspect ratio for video', () => {
    const body = buildWebhookRequest('video', 'job_1', 'http://aladin:3000', {
      brand_dna: brandDna,
      prompt: 'iklan',
      post: { caption: 'Halo', hashtags: ['#a'] },
      assets: []
    })
    expect(body).toMatchObject({ duration_seconds: 10, aspect_ratio: '9:16' })
  })

  it('builds a brand extract body for a URL and for a PDF', () => {
    expect(buildWebhookRequest('brand_extract', 'j', 'http://a:1', { source_type: 'url', url: 'https://example.com' }))
      .toMatchObject({ source_type: 'url', url: 'https://example.com' })
    expect(buildWebhookRequest('brand_extract', 'j', 'http://a:1', { source_type: 'pdf', pdf_asset_id: 'ast_9' }))
      .toMatchObject({ source_type: 'pdf', pdf_asset_id: 'ast_9' })
  })

  it('throws a readable error for invalid input', () => {
    expect(() => buildWebhookRequest('post', 'j', 'http://a:1', { ...postInput, prompt: '' } as DispatchInput))
      .toThrow(/Invalid post dispatch input.*prompt/)
  })
})

describe('live client', () => {
  it('posts the validated body to the right webhook with the secret header', async () => {
    const fetchFn = vi.fn(async () => okResponse())
    const job = createJob(testDb.db, { type: 'post' }, T0)

    await liveClient({ fetchFn }).dispatch(job, postInput)

    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://n8n:5678/webhook/aladin-post-generate')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json', 'X-Aladin-Secret': SECRET })
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(JSON.parse(init.body as string)).toMatchObject({
      job_id: job.id,
      callback_url: 'http://aladin:3000/api/n8n/callback',
      asset_base_url: 'http://aladin:3000/api/internal/assets',
      prompt: 'promo ramadan',
      aspect_ratio: '4:5'
    })
  })

  it('uses the webhook path of each job type', async () => {
    const fetchFn = vi.fn(async () => okResponse())
    const client = liveClient({ fetchFn })

    await client.dispatch(createJob(testDb.db, { type: 'brand_extract' }, T0), { source_type: 'url', url: 'https://example.com' })
    await client.dispatch(createJob(testDb.db, { type: 'video' }, T0), {
      brand_dna: brandDna,
      prompt: 'x',
      post: { caption: 'c', hashtags: [] },
      assets: []
    })

    const urls = fetchFn.mock.calls.map(call => (call as unknown as [string])[0])
    expect(urls).toEqual([
      'http://n8n:5678/webhook/aladin-brand-extract',
      'http://n8n:5678/webhook/aladin-video-generate'
    ])
  })

  it('does not produce a double slash when the base URL has a trailing slash', async () => {
    const fetchFn = vi.fn(async () => okResponse())
    const job = createJob(testDb.db, { type: 'post' }, T0)

    await liveClient({ fetchFn, baseUrl: 'http://n8n:5678/' }).dispatch(job, postInput)
    expect((fetchFn.mock.calls[0] as unknown as [string])[0]).toBe('http://n8n:5678/webhook/aladin-post-generate')
  })

  it('rejects invalid input before sending anything', async () => {
    const fetchFn = vi.fn(async () => okResponse())
    const job = createJob(testDb.db, { type: 'post' }, T0)

    await expect(liveClient({ fetchFn }).dispatch(job, { ...postInput, prompt: '' } as DispatchInput))
      .rejects.toThrow(/Invalid post dispatch input/)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('throws with the status for a non-2xx response and never leaks the secret', async () => {
    const fetchFn = vi.fn(async () => new Response(`webhook not registered (header ${SECRET})`, { status: 404 }))
    const job = createJob(testDb.db, { type: 'post' }, T0)

    const error = await liveClient({ fetchFn }).dispatch(job, postInput).catch((e: Error) => e)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('404')
    expect((error as Error).message).not.toContain(SECRET)
  })

  it('throws with the cause on a network error', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError(`connect ECONNREFUSED 10.0.0.1:5678 while sending ${SECRET}`)
    })
    const job = createJob(testDb.db, { type: 'post' }, T0)

    const error = await liveClient({ fetchFn }).dispatch(job, postInput).catch((e: Error) => e)
    expect((error as Error).message).toContain('ECONNREFUSED')
    expect((error as Error).message).not.toContain(SECRET)
  })

  it('throws a timeout error when n8n does not answer in time', async () => {
    // Like real fetch: stays pending until the abort signal fires.
    const fetchFn = vi.fn((_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
      })
    ) as unknown as typeof fetch
    const job = createJob(testDb.db, { type: 'post' }, T0)

    await expect(liveClient({ fetchFn, timeoutMs: 20 }).dispatch(job, postInput))
      .rejects.toThrow(/timed out/)
  })
})

describe('mock mode', () => {
  it('makes no network request and hands the validated request to the runner', async () => {
    const fetchFn = vi.fn(() => {
      throw new Error('fetch must not be called in mock mode')
    }) as unknown as typeof fetch
    const run = vi.fn(async () => {})
    const client = createN8nClient({
      mode: 'mock',
      baseUrl: '',
      secret: SECRET,
      appInternalUrl: 'http://localhost:3000',
      fetchFn,
      mockRunner: { run }
    })
    const job = createJob(testDb.db, { type: 'post' }, T0)

    await client.dispatch(job, postInput)

    expect(fetchFn).not.toHaveBeenCalled()
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0]).toEqual([job, expect.objectContaining({ job_id: job.id, prompt: 'promo ramadan' })])
  })

  it('resolves without waiting for the scenario', async () => {
    let finished = false
    const run = vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 30))
      finished = true
    })
    const client = createN8nClient({
      mode: 'mock', baseUrl: '', secret: SECRET, appInternalUrl: 'http://localhost:3000', mockRunner: { run }
    })

    await client.dispatch(createJob(testDb.db, { type: 'post' }, T0), postInput)
    expect(finished).toBe(false)
    await vi.waitFor(() => expect(finished).toBe(true))
  })

  it('still validates input in mock mode', async () => {
    const run = vi.fn(async () => {})
    const client = createN8nClient({
      mode: 'mock', baseUrl: '', secret: SECRET, appInternalUrl: 'http://localhost:3000', mockRunner: { run }
    })

    await expect(client.dispatch(createJob(testDb.db, { type: 'post' }, T0), { ...postInput, prompt: '' } as DispatchInput))
      .rejects.toThrow(/Invalid post dispatch input/)
    expect(run).not.toHaveBeenCalled()
  })

  it('needs a runner', async () => {
    const client = createN8nClient({ mode: 'mock', baseUrl: '', secret: SECRET, appInternalUrl: 'http://localhost:3000' })
    await expect(client.dispatch(createJob(testDb.db, { type: 'post' }, T0), postInput)).rejects.toThrow(/mock runner/)
  })
})

describe('startJob', () => {
  const clientThatResolves = (): N8nClient => ({ dispatch: vi.fn(async () => {}) })

  it('marks the job running with started_at when n8n accepts it', async () => {
    const client = clientThatResolves()
    const job = await startJob(
      { db: testDb.db, client, now: () => T0 + 10 },
      { type: 'post', brandId: 'b1', input: postInput }
    )

    expect(job).toMatchObject({ type: 'post', brandId: 'b1', status: 'running', startedAt: T0 + 10 })
    expect(client.dispatch).toHaveBeenCalledWith(expect.objectContaining({ id: job.id, status: 'queued' }), postInput)
  })

  it('marks the job failed with dispatch_failed when n8n rejects it', async () => {
    const client: N8nClient = {
      dispatch: vi.fn(async () => {
        throw new Error('n8n responded 500')
      })
    }
    const job = await startJob({ db: testDb.db, client, now: () => T0 + 10 }, { type: 'post', input: postInput })

    expect(job.status).toBe('failed')
    expect(job.error).toMatch(/^dispatch_failed/)
    expect(job.error).toContain('n8n responded 500')
    expect(job.finishedAt).toBe(T0 + 10)
  })

  it('does not regress a job that a callback completed before dispatch returned', async () => {
    const client: N8nClient = {
      dispatch: vi.fn(async (job) => {
        // n8n answered and already called back before the app handled the webhook response
        const { completeJob } = await import('../../server/utils/jobs')
        completeJob(testDb.db, job.id, T0 + 5)
      })
    }

    const job = await startJob({ db: testDb.db, client, now: () => T0 + 10 }, { type: 'post', input: postInput })
    expect(job.status).toBe('completed')
    expect(getJob(testDb.db, job.id)!.status).toBe('completed')
  })
})
