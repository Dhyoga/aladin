import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { BrandDNA } from '../../shared/schemas/brand-dna'
import { COMPLETED_PAYLOAD_SCHEMAS } from '../../shared/schemas/n8n-contracts'
import type { JobType } from '../../shared/schemas/job'
import { startJob } from '../../server/utils/job-dispatch'
import { applyJobCallback, type ParsedCallback } from '../../server/utils/job-callback'
import { createHandlerRegistry, type CallbackFile } from '../../server/utils/job-handlers'
import { createJob, getJob, markRunning } from '../../server/utils/jobs'
import { buildWebhookRequest, createN8nClient, type DispatchInput } from '../../server/utils/n8n-client'
import { createFixtureLoader, createMockRunner, MOCK_DELAYS } from '../../server/utils/n8n-mock'
import { useTestDatabase } from './helpers'

const fixturesDir = fileURLToPath(new URL('../../server/fixtures', import.meta.url))
const loadFixture = createFixtureLoader(fixturesDir)

const testDb = useTestDatabase()

const brandDna = BrandDNA.parse({
  identity: { name: 'Contoh', summary: 'Ringkasan.' },
  audience: { targetAudience: 'Mahasiswa' },
  voice: { toneOfVoice: 'Santai' },
  offer: {},
  visual: {},
  social: {}
})

const inputs: Record<string, DispatchInput> = {
  url: { source_type: 'url', url: 'https://example.com' },
  pdf: { source_type: 'pdf', pdf_asset_id: 'ast_1' },
  post: { brand_dna: brandDna, prompt: 'promo', aspect_ratio: '4:5', assets: [] } as DispatchInput,
  failingPost: { brand_dna: brandDna, prompt: 'promo mock:fail', aspect_ratio: '1:1', assets: [] } as DispatchInput,
  video: {
    brand_dna: brandDna,
    prompt: 'iklan',
    post: { caption: 'Halo', hashtags: ['#a'] },
    assets: []
  } as DispatchInput
}

interface Observed {
  event: ParsedCallback['event']
  stage: string | undefined
  jobStage: string | null
  files: string[]
}

/** Runs a scenario against the real callback core and records what happened. */
async function runScenario(type: JobType, input: DispatchInput) {
  const registry = createHandlerRegistry()
  const job = createJob(testDb.db, { type })
  markRunning(testDb.db, job.id)

  const observed: Observed[] = []
  const delays: number[] = []
  const completed = vi.fn()
  const progressed = vi.fn()
  registry.register(type, { onCompleted: completed, onProgress: progressed } as never)

  const runner = createMockRunner({
    loadFixture,
    sleep: async (ms) => {
      delays.push(ms)
    },
    applyCallback: async (callback) => {
      const outcome = await applyJobCallback({ db: testDb.db, registry }, callback)
      observed.push({
        event: callback.event,
        stage: callback.stage,
        jobStage: getJob(testDb.db, job.id)!.stage,
        files: Object.keys(callback.files)
      })
      return outcome
    }
  })

  await runner.run(job, buildWebhookRequest(type, job.id, 'http://localhost:3000', input))
  return { job, observed, delays, completed, progressed, read: () => getJob(testDb.db, job.id)! }
}

describe('fixtures', () => {
  it('JSON fixtures conform to the contracts', async () => {
    const brand = JSON.parse((await loadFixture('brand-dna.json')).toString())
    const post = JSON.parse((await loadFixture('post.json')).toString())
    const script = JSON.parse((await loadFixture('video-script.json')).toString())

    expect(BrandDNA.safeParse(brand).success).toBe(true)
    expect(COMPLETED_PAYLOAD_SCHEMAS.post.safeParse(post).success).toBe(true)
    expect(COMPLETED_PAYLOAD_SCHEMAS.video.safeParse(script).success).toBe(true)
    expect(COMPLETED_PAYLOAD_SCHEMAS.brand_extract.safeParse({ brand_dna: brand }).success).toBe(true)
  })

  it.each(['logo.png', 'post.png', 'storyboard.png'])('%s is a PNG', async (name) => {
    const data = await loadFixture(name)
    expect(data.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  })

  it('video.mp4 is an MP4 with the moov atom before the media data', async () => {
    const data = await loadFixture('video.mp4')
    expect(data.length).toBeGreaterThan(1000)
    expect(data.subarray(4, 8).toString()).toBe('ftyp')
    expect(data.indexOf('moov')).toBeGreaterThan(0)
    expect(data.indexOf('moov')).toBeLessThan(data.indexOf('mdat'))
  })

  it('keeps every fixture below 1 MB', async () => {
    for (const name of ['logo.png', 'post.png', 'storyboard.png', 'video.mp4']) {
      expect((await loadFixture(name)).length).toBeLessThan(1024 * 1024)
    }
  })
})

describe('post scenario', () => {
  it('goes caption -> image -> completed and delivers the image to the handler', async () => {
    const run = await runScenario('post', inputs.post!)

    expect(run.observed.map(o => [o.event, o.stage])).toEqual([
      ['progress', 'caption'],
      ['progress', 'image'],
      ['completed', undefined]
    ])
    expect(run.observed[1]!.jobStage).toBe('image')
    expect(run.read().status).toBe('completed')
    expect(run.delays).toEqual([...MOCK_DELAYS.post])

    const context = run.completed.mock.calls[0]![0]
    expect(context.payload.caption).toMatch(/Kopi Senja/)
    const image = context.files.image as CallbackFile
    expect(image.mime).toBe('image/png')
    expect(image.data.subarray(0, 4).toString('hex')).toBe('89504e47')
  })
})

describe('video scenario', () => {
  it('goes script -> storyboard -> video -> completed', async () => {
    const run = await runScenario('video', inputs.video!)

    expect(run.observed.map(o => [o.event, o.stage])).toEqual([
      ['progress', 'script'],
      ['progress', 'storyboard'],
      ['progress', 'video'],
      ['completed', undefined]
    ])
    expect(run.observed[1]!.files).toEqual(['storyboard'])
    expect(run.observed[3]!.files).toEqual(['video'])
    expect(run.read().status).toBe('completed')
  })

  it('sends the script with the script stage and the storyboard with the storyboard stage', async () => {
    const run = await runScenario('video', inputs.video!)

    const [script, storyboard] = run.progressed.mock.calls.map(call => call[0])
    expect(script.stage).toBe('script')
    expect(script.payload.script.scenes.length).toBeGreaterThan(0)
    expect(storyboard.stage).toBe('storyboard')
    expect(storyboard.files.storyboard.data.length).toBeGreaterThan(0)

    const done = run.completed.mock.calls[0]![0]
    expect(done.files.video.data.subarray(4, 8).toString()).toBe('ftyp')
    expect(done.payload.script.scenes).toHaveLength(5)
  })
})

describe('brand_extract scenario', () => {
  it('starts with crawling for a URL and sets the website to that URL', async () => {
    const run = await runScenario('brand_extract', inputs.url!)

    expect(run.observed.map(o => o.stage)).toEqual(['crawling', 'structuring', undefined])
    expect(run.read().status).toBe('completed')
    const context = run.completed.mock.calls[0]![0]
    expect(context.payload.brand_dna.identity.website).toBe('https://example.com')
    expect(context.files.logo.data.length).toBeGreaterThan(0)
  })

  it('starts with reading for a PDF', async () => {
    const run = await runScenario('brand_extract', inputs.pdf!)
    expect(run.observed[0]!.stage).toBe('reading')
    expect(run.read().status).toBe('completed')
  })
})

describe('forced failure', () => {
  it('delivers the first progress event and then fails, without calling the handler', async () => {
    const run = await runScenario('post', inputs.failingPost!)

    expect(run.observed.map(o => [o.event, o.stage])).toEqual([
      ['progress', 'caption'],
      ['failed', undefined]
    ])
    expect(run.read().status).toBe('failed')
    expect(run.read().error).toMatch(/mock:fail/)
    expect(run.completed).not.toHaveBeenCalled()
  })
})

describe('mock through the n8n client', () => {
  it('resolves dispatch before the first event is delivered', async () => {
    const registry = createHandlerRegistry()
    registry.register('post', { onCompleted: vi.fn() })
    const delivered = vi.fn()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    const runner = createMockRunner({
      loadFixture,
      sleep: () => gate,
      applyCallback: async (callback) => {
        delivered(callback.event)
        return applyJobCallback({ db: testDb.db, registry }, callback)
      }
    })
    const client = createN8nClient({
      mode: 'mock', baseUrl: '', secret: 's', appInternalUrl: 'http://localhost:3000', mockRunner: runner
    })

    const job = await startJob({ db: testDb.db, client }, { type: 'post', input: inputs.post! })
    expect(job.status).toBe('running')
    expect(delivered).not.toHaveBeenCalled()

    release()
    await vi.waitFor(() => expect(getJob(testDb.db, job.id)!.status).toBe('completed'))
  })

  it('reaches completed even when events race with the dispatch bookkeeping', async () => {
    const registry = createHandlerRegistry()
    registry.register('video', { onCompleted: vi.fn(), onProgress: vi.fn() })
    const runner = createMockRunner({
      loadFixture,
      sleep: async () => {}, // no real waiting: events fire as early as possible
      applyCallback: callback => applyJobCallback({ db: testDb.db, registry }, callback)
    })
    const client = createN8nClient({
      mode: 'mock', baseUrl: '', secret: 's', appInternalUrl: 'http://localhost:3000', mockRunner: runner
    })

    const job = await startJob({ db: testDb.db, client }, { type: 'video', input: inputs.video! })
    await vi.waitFor(() => expect(getJob(testDb.db, job.id)!.status).toBe('completed'))
    expect(getJob(testDb.db, job.id)!.error).toBeNull()
  })
})
