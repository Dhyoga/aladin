import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import { brandAssets, brands, generations, jobs } from '../../server/db/schema'
import { GenerationError, type GenerationErrorKind } from '../../server/utils/generation-errors'
import {
  createGeneration,
  deriveVideo,
  getGeneration,
  patchGeneration,
  type GenerationDeps
} from '../../server/utils/generations'
import { startJob } from '../../server/utils/job-dispatch'
import { completeJob, failJob, updateStage } from '../../server/utils/jobs'
import { createN8nClient, type N8nClient } from '../../server/utils/n8n-client'
import { createVideo } from '../../server/utils/video-generation'
import { BrandDNA } from '../../shared/schemas/brand-dna'
import { useTestDatabase, useTestMedia } from './helpers'

const MINUTE = 60_000
const T0 = 1_800_000_000_000

const testDb = useTestDatabase()
const testMedia = useTestMedia()

const dna = BrandDNA.parse({
  identity: { name: 'Kopi Senja', summary: 'Kedai kopi' },
  audience: { targetAudience: 'Mahasiswa' },
  voice: { toneOfVoice: 'Santai' },
  offer: {},
  visual: {},
  social: {}
})

const script = { scenes: [{ start: 0, end: 2, visual: 'close-up', voice_over: 'Halo' }] }

function setup() {
  const clock = { now: T0 }
  const client = { dispatch: vi.fn(async () => {}) }
  const deps: GenerationDeps = {
    db: testDb.db,
    mediaDir: testMedia.dir,
    now: () => clock.now,
    dispatch: input => startJob({ db: testDb.db, client: client as unknown as N8nClient, now: () => clock.now }, input)
  }
  return { deps, clock, client }
}

let counter = 0
function makeBrand(over: Partial<typeof brands.$inferInsert> = {}) {
  const id = `brd_${++counter}`
  testDb.db.insert(brands).values({
    id, name: 'Kopi Senja', sourceType: 'manual', sourceUrl: null, sourceAssetId: null,
    dnaJson: JSON.stringify(dna), status: 'ready', createdAt: T0, updatedAt: T0, ...over
  }).run()
  return id
}

function addAsset(brandId: string, kind: 'logo' | 'product_photo', over: Partial<typeof brandAssets.$inferInsert> = {}) {
  const id = `ast_${++counter}`
  testDb.db.insert(brandAssets).values({
    id, brandId, kind, path: `brands/${brandId}/${kind}-${id}.png`, mime: 'image/png', sizeBytes: 1,
    label: null, sortOrder: 0, createdAt: T0, ...over
  }).run()
  return id
}

/** A brand with a logo and two photos, and a post that is finished. */
async function finishedPost(deps: GenerationDeps, { logo = true, photoCount = 2 } = {}) {
  const brandId = makeBrand()
  const logoId = logo ? addAsset(brandId, 'logo', { mime: 'image/webp' }) : null
  const photos = Array.from({ length: photoCount }, (_, i) => addAsset(brandId, 'product_photo', { label: i === 0 ? 'botol depan' : null }))
  const created = await createGeneration(deps, { brandId, prompt: 'promo ramadan', aspectRatio: '4:5', assetIds: photos })
  testDb.db.update(generations)
    .set({ caption: 'Caption post', hashtagsJson: '["#a","#b"]', imagePath: `generations/${created.id}/post.png` })
    .where(eq(generations.id, created.id)).run()
  completeJob(testDb.db, created.jobId!, T0 + 1)
  return { id: created.id, brandId, logoId, photos }
}

const videoJobs = () => testDb.db.select().from(jobs).where(eq(jobs.type, 'video')).all()
const row = (id: string) => testDb.db.select().from(generations).where(eq(generations.id, id)).get()!

async function rejects(promise: Promise<unknown>, kind: GenerationErrorKind, message?: RegExp) {
  await expect(promise).rejects.toBeInstanceOf(GenerationError)
  await expect(promise).rejects.toMatchObject({ kind })
  if (message) await expect(promise).rejects.toThrow(message)
}

describe('createVideo', () => {
  it('starts a video job linked to the generation and the brand', async () => {
    const { deps } = setup()
    const post = await finishedPost(deps)

    const detail = await createVideo(deps, post.id)

    const [job] = videoJobs()
    expect(job).toMatchObject({ type: 'video', generationId: post.id, brandId: post.brandId, status: 'running' })
    expect(detail.video).toMatchObject({ status: 'running', jobId: job!.id, error: null, script: null, storyboardUrl: null, videoUrl: null })
    expect(detail.status).toBe('completed') // the post itself is untouched
  })

  it('sends the DNA, the prompt, the post, and the assets: logo first, then the photos in order', async () => {
    const { deps, client } = setup()
    const post = await finishedPost(deps)

    await createVideo(deps, post.id)

    const [, input] = client.dispatch.mock.calls.at(-1) as unknown as [unknown, Record<string, unknown>]
    expect(input).toEqual({
      brand_dna: dna,
      prompt: 'promo ramadan',
      post: { caption: 'Caption post', hashtags: ['#a', '#b'] },
      assets: [
        { id: post.logoId, kind: 'logo', mime: 'image/webp' },
        { id: post.photos[0], kind: 'product_photo', mime: 'image/png', label: 'botol depan' },
        { id: post.photos[1], kind: 'product_photo', mime: 'image/png' }
      ]
    })
  })

  it('uses the caption as it is now: an edit by the user is what the video agrees with', async () => {
    const { deps, client } = setup()
    const post = await finishedPost(deps)
    patchGeneration(deps, post.id, { caption: 'Teks baru', hashtags: ['promo'] })

    await createVideo(deps, post.id)

    const [, input] = client.dispatch.mock.calls.at(-1) as unknown as [unknown, { post: unknown }]
    expect(input.post).toEqual({ caption: 'Teks baru', hashtags: ['#promo'] })
  })

  it('sends only the photos when the brand has no logo', async () => {
    const { deps, client } = setup()
    const post = await finishedPost(deps, { logo: false })

    await createVideo(deps, post.id)

    const [, input] = client.dispatch.mock.calls.at(-1) as unknown as [unknown, { assets: { kind: string }[] }]
    expect(input.assets.map(a => a.kind)).toEqual(['product_photo', 'product_photo'])
  })

  it('leaves out a photo that was deleted since the post and keeps going with the rest', async () => {
    const { deps, client } = setup()
    const post = await finishedPost(deps)
    testDb.db.delete(brandAssets).where(eq(brandAssets.id, post.photos[0]!)).run()

    await createVideo(deps, post.id)

    const [, input] = client.dispatch.mock.calls.at(-1) as unknown as [unknown, { assets: { id: string }[] }]
    expect(input.assets.map(a => a.id)).toEqual([post.logoId, post.photos[1]])
  })

  it('builds a request the n8n contract accepts, with the fixed duration and ratio', async () => {
    const { deps, clock } = setup()
    const fetchFn = vi.fn(async () => new Response('{}', { status: 200 }))
    const client = createN8nClient({
      mode: 'live', baseUrl: 'http://n8n:5678', secret: 'secret', appInternalUrl: 'http://aladin:3000', fetchFn: fetchFn as unknown as typeof fetch
    })
    const real: GenerationDeps = { ...deps, dispatch: input => startJob({ db: testDb.db, client, now: () => clock.now }, input) }
    const post = await finishedPost(real)

    await createVideo(real, post.id)

    const [url, init] = fetchFn.mock.calls.at(-1) as unknown as [string, RequestInit]
    expect(url).toBe('http://n8n:5678/webhook/aladin-video-generate')
    expect(JSON.parse(init.body as string)).toMatchObject({
      duration_seconds: 10,
      aspect_ratio: '9:16',
      post: { caption: 'Caption post' },
      prompt: 'promo ramadan'
    })
  })

  it('shows a failed video, and still answers, when n8n refuses the job', async () => {
    const { deps, client } = setup()
    const post = await finishedPost(deps)
    client.dispatch.mockRejectedValueOnce(new Error('n8n responded 500'))

    const detail = await createVideo(deps, post.id)

    expect(detail.video?.status).toBe('failed')
    expect(detail.video?.error).toMatch(/^dispatch_failed.*n8n responded 500/)
  })
})

describe('when a video may be started', () => {
  it('answers not_found for an unknown generation', async () => {
    await rejects(createVideo(setup().deps, 'gen_ghost'), 'not_found')
  })

  it('answers conflict while the post is running, and after it failed', async () => {
    const { deps } = setup()
    const brandId = makeBrand()
    const photo = addAsset(brandId, 'product_photo')
    const running = await createGeneration(deps, { brandId, prompt: 'x', aspectRatio: '1:1', assetIds: [photo] })
    await rejects(createVideo(deps, running.id), 'conflict', /post has to be finished first/)

    failJob(testDb.db, running.jobId!, 'boom', T0 + 1)
    await rejects(createVideo(deps, running.id), 'conflict', /post has to be finished first/)
    expect(videoJobs()).toHaveLength(0)
  })

  it('answers conflict while a video is running, and creates no second job', async () => {
    const { deps } = setup()
    const post = await finishedPost(deps)
    await createVideo(deps, post.id)

    await rejects(createVideo(deps, post.id), 'conflict', /already being created/)
    expect(videoJobs()).toHaveLength(1)
  })

  it('answers conflict once the video is done, and leaves it untouched', async () => {
    const { deps } = setup()
    const post = await finishedPost(deps)
    await createVideo(deps, post.id)
    testDb.db.update(generations).set({ videoPath: `generations/${post.id}/video.mp4` }).where(eq(generations.id, post.id)).run()
    completeJob(testDb.db, videoJobs()[0]!.id, T0 + 5)

    await rejects(createVideo(deps, post.id), 'conflict', /already has a video/)
    expect(row(post.id).videoPath).toBe(`generations/${post.id}/video.mp4`)
    expect(videoJobs()).toHaveLength(1)
  })

  it('may be retried after a failure', async () => {
    const { deps } = setup()
    const post = await finishedPost(deps)
    const first = await createVideo(deps, post.id)
    failJob(testDb.db, first.video!.jobId, 'boom', T0 + 5)

    const second = await createVideo(deps, post.id)

    expect(second.video).toMatchObject({ status: 'running' })
    expect(second.video!.jobId).not.toBe(first.video!.jobId)
    expect(videoJobs()).toHaveLength(2)
  })

  it('may be retried after a timeout of 20 minutes', async () => {
    const { deps, clock } = setup()
    const post = await finishedPost(deps)
    await createVideo(deps, post.id)

    clock.now = T0 + 19 * MINUTE
    await rejects(createVideo(deps, post.id), 'conflict', /already being created/) // still within its limit

    clock.now = T0 + 21 * MINUTE
    const retried = await createVideo(deps, post.id)
    expect(retried.video?.status).toBe('running')
    expect(videoJobs()).toHaveLength(2)
  })

  it.each(['extracting', 'failed'] as const)('answers conflict when the brand is %s', async (status) => {
    const { deps } = setup()
    const post = await finishedPost(deps)
    testDb.db.update(brands).set({ status }).where(eq(brands.id, post.brandId)).run()

    await rejects(createVideo(deps, post.id), 'conflict', /not ready/)
    expect(videoJobs()).toHaveLength(0)
  })

  it('answers conflict when every photo of the post is gone, without starting a job', async () => {
    const { deps } = setup()
    const post = await finishedPost(deps)
    testDb.db.delete(brandAssets).where(eq(brandAssets.kind, 'product_photo')).run()

    await rejects(createVideo(deps, post.id), 'conflict', /no longer exist/)
    expect(videoJobs()).toHaveLength(0)
  })
})

describe('one click never starts two videos', () => {
  it('two simultaneous requests start exactly one job', async () => {
    const { deps } = setup()
    const post = await finishedPost(deps)

    const results = await Promise.allSettled([createVideo(deps, post.id), createVideo(deps, post.id)])

    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect(rejected).toHaveLength(1)
    expect(rejected[0]!.reason).toMatchObject({ kind: 'conflict' })
    expect(videoJobs()).toHaveLength(1)
  })

  it('also holds for many requests at once', async () => {
    const { deps } = setup()
    const post = await finishedPost(deps)

    const results = await Promise.allSettled(Array.from({ length: 10 }, () => createVideo(deps, post.id)))

    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(videoJobs()).toHaveLength(1)
  })
})

describe('a new attempt clears the previous one', () => {
  it('empties the script, the storyboard and the video path before the retry runs', async () => {
    const { deps } = setup()
    const post = await finishedPost(deps)
    const first = await createVideo(deps, post.id)
    testDb.db.update(generations).set({
      videoScriptJson: JSON.stringify(script),
      storyboardPath: `generations/${post.id}/storyboard.png`
    }).where(eq(generations.id, post.id)).run()
    failJob(testDb.db, first.video!.jobId, 'boom', T0 + 5)
    expect(getGeneration(deps, post.id).video).toMatchObject({ status: 'failed', script, storyboardUrl: `/media/generations/${post.id}/storyboard.png` })

    const retried = await createVideo(deps, post.id)

    expect(retried.video).toMatchObject({ status: 'running', script: null, storyboardUrl: null, videoUrl: null })
    expect(row(post.id)).toMatchObject({ videoScriptJson: null, storyboardPath: null, videoPath: null })
  })

  it('leaves the post alone', async () => {
    const { deps } = setup()
    const post = await finishedPost(deps)
    await createVideo(deps, post.id)

    expect(row(post.id)).toMatchObject({ caption: 'Caption post', imagePath: `generations/${post.id}/post.png` })
  })
})

describe('the video in the generation detail', () => {
  it('is null when no video was ever requested', async () => {
    const { deps } = setup()
    const post = await finishedPost(deps)
    expect(getGeneration(deps, post.id).video).toBeNull()
  })

  it('shows the stage of the running job', async () => {
    const { deps } = setup()
    const post = await finishedPost(deps)
    const started = await createVideo(deps, post.id)
    updateStage(testDb.db, started.video!.jobId, 'storyboard', T0 + 5)

    expect(getGeneration(deps, post.id).video).toMatchObject({ status: 'running', stage: 'storyboard' })
  })

  it('shows the script and the storyboard while the video is still running, but no video yet', async () => {
    const { deps } = setup()
    const post = await finishedPost(deps)
    await createVideo(deps, post.id)
    testDb.db.update(generations).set({
      videoScriptJson: JSON.stringify(script),
      storyboardPath: `generations/${post.id}/storyboard.jpg`
    }).where(eq(generations.id, post.id)).run()

    expect(getGeneration(deps, post.id).video).toMatchObject({
      status: 'running',
      script,
      storyboardUrl: `/media/generations/${post.id}/storyboard.jpg`,
      videoUrl: null
    })
  })

  it('shows the finished video', async () => {
    const { deps } = setup()
    const post = await finishedPost(deps)
    const started = await createVideo(deps, post.id)
    testDb.db.update(generations).set({ videoPath: `generations/${post.id}/video.mp4`, videoScriptJson: JSON.stringify(script) })
      .where(eq(generations.id, post.id)).run()
    completeJob(testDb.db, started.video!.jobId, T0 + 9)

    expect(getGeneration(deps, post.id).video).toMatchObject({
      status: 'completed', stage: null, error: null, videoUrl: `/media/generations/${post.id}/video.mp4`, script
    })
  })

  it('shows the error of a failed job, and a timeout after 20 minutes', async () => {
    const { deps, clock } = setup()
    const post = await finishedPost(deps)
    const started = await createVideo(deps, post.id)

    clock.now = T0 + 10 * MINUTE
    expect(getGeneration(deps, post.id).video?.status).toBe('running') // a video may take far longer than a post (5 minutes)

    clock.now = T0 + 21 * MINUTE
    expect(getGeneration(deps, post.id).video).toMatchObject({ status: 'failed', error: 'timeout' })
    expect(testDb.db.select().from(jobs).where(eq(jobs.id, started.video!.jobId)).get()).toMatchObject({ error: 'timeout' })
  })

  it('does not write to the generations table when it derives the status', async () => {
    const { deps, clock } = setup()
    const post = await finishedPost(deps)
    await createVideo(deps, post.id)
    const before = row(post.id)

    clock.now = T0 + 25 * MINUTE
    getGeneration(deps, post.id)
    expect(row(post.id)).toEqual(before)
  })

  it('follows the latest video job', async () => {
    const { deps } = setup()
    const post = await finishedPost(deps)
    const first = await createVideo(deps, post.id)
    failJob(testDb.db, first.video!.jobId, 'first failed', T0 + 5)
    const second = await createVideo(deps, post.id)

    expect(getGeneration(deps, post.id).video).toMatchObject({ status: 'running', jobId: second.video!.jobId })
  })

  it('fails loudly when the stored script is corrupt', async () => {
    const { deps } = setup()
    const post = await finishedPost(deps)
    await createVideo(deps, post.id)

    for (const broken of ['{"scenes":[]}', 'not json', '{"scenes":[{"start":4,"end":2,"visual":"x","voice_over":"y"}]}']) {
      testDb.db.update(generations).set({ videoScriptJson: broken }).where(eq(generations.id, post.id)).run()
      expect(() => getGeneration(deps, post.id)).toThrow(GenerationError)
      expect(() => getGeneration(deps, post.id)).toThrow(/video script is invalid/)
    }
  })

  it('deriveVideo says a readable thing when a failed job has no error', () => {
    const generation = { videoScriptJson: null, storyboardPath: null, videoPath: null } as Parameters<typeof deriveVideo>[0]
    const job = { id: 'job_1', status: 'failed', error: null, stage: null } as Parameters<typeof deriveVideo>[1]
    expect(deriveVideo(generation, job)?.error).toBe('The video failed.')
    expect(deriveVideo(generation, undefined)).toBeNull()
  })

  it('does not change the history or the post status of the generation', async () => {
    const { deps } = setup()
    const post = await finishedPost(deps)
    await createVideo(deps, post.id)

    expect(getGeneration(deps, post.id)).toMatchObject({ status: 'completed', caption: 'Caption post' })
  })
})
