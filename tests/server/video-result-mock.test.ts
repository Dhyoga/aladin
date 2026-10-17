import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { brandAssets, brands } from '../../server/db/schema'
import { createGeneration, getGeneration, patchGeneration, type GenerationDeps } from '../../server/utils/generations'
import { applyJobCallback } from '../../server/utils/job-callback'
import { createHandlerRegistry } from '../../server/utils/job-handlers'
import { startJob } from '../../server/utils/job-dispatch'
import { createN8nClient } from '../../server/utils/n8n-client'
import { createFixtureLoader, createMockRunner } from '../../server/utils/n8n-mock'
import { createPostResultHandler } from '../../server/utils/post-result'
import { createVideo } from '../../server/utils/video-generation'
import { createVideoResultHandler } from '../../server/utils/video-result'
import { BrandDNA } from '../../shared/schemas/brand-dna'
import { useTestDatabase, useTestMedia } from './helpers'

const testDb = useTestDatabase()
const testMedia = useTestMedia()

const FIXTURES = fileURLToPath(new URL('../../server/fixtures', import.meta.url))
const loadFixture = createFixtureLoader(FIXTURES)

const dna = BrandDNA.parse({
  identity: { name: 'Kopi Senja', summary: 'Kedai kopi' },
  audience: { targetAudience: 'Mahasiswa' },
  voice: { toneOfVoice: 'Santai' },
  offer: {},
  visual: {},
  social: {}
})

/** The real pipeline: mock n8n, the real callback core, both real result handlers, the real services. */
function setup() {
  const gate = { on: false, pauses: [] as (() => void)[] }
  const registry = createHandlerRegistry()
  registry.register('post', createPostResultHandler({ db: testDb.db, mediaDir: testMedia.dir }))
  registry.register('video', createVideoResultHandler({ db: testDb.db, mediaDir: testMedia.dir }))

  const runner = createMockRunner({
    loadFixture,
    // no real waiting; while the gate is on, every pause of the scenario waits for the test
    sleep: () => (gate.on ? new Promise<void>(resolve => gate.pauses.push(resolve)) : Promise.resolve()),
    applyCallback: callback => applyJobCallback({ db: testDb.db, registry }, callback)
  })
  const fetchFn = vi.fn(() => {
    throw new Error('mock mode must not use the network')
  }) as unknown as typeof fetch
  const client = createN8nClient({
    mode: 'mock', baseUrl: '', secret: 's', appInternalUrl: 'http://localhost:3000', mockRunner: runner, fetchFn
  })

  testDb.db.insert(brands).values({
    id: 'brd_1', name: 'Kopi Senja', sourceType: 'manual', sourceUrl: null, sourceAssetId: null,
    dnaJson: JSON.stringify(dna), status: 'ready', createdAt: 1, updatedAt: 1
  }).run()
  testDb.db.insert(brandAssets).values({
    id: 'ast_photo', brandId: 'brd_1', kind: 'product_photo', path: 'brands/brd_1/products/ast_photo.png',
    mime: 'image/png', sizeBytes: 1, label: null, sortOrder: 0, createdAt: 1
  }).run()

  const deps: GenerationDeps = {
    db: testDb.db,
    mediaDir: testMedia.dir,
    dispatch: input => startJob({ db: testDb.db, client }, input)
  }
  return { deps, gate, fetchFn }
}

/** A finished post made by the mock itself. */
async function finishedPost(deps: GenerationDeps) {
  const created = await createGeneration(deps, { brandId: 'brd_1', prompt: 'promo ramadan', aspectRatio: '4:5', assetIds: ['ast_photo'] })
  await vi.waitFor(() => expect(getGeneration(deps, created.id).status).toBe('completed'))
  return created.id
}

const folderOf = (id: string) => join(testMedia.dir, 'generations', id)
const filesOf = (id: string) => (existsSync(folderOf(id)) ? readdirSync(folderOf(id)).sort() : [])

describe('video generation in mock mode', () => {
  it('goes through script, storyboard and video one step at a time, then completes', async () => {
    const { deps, gate, fetchFn } = setup()
    const id = await finishedPost(deps)

    gate.on = true // from here on every pause of the scenario waits for the test
    await createVideo(deps, id)
    const video = () => getGeneration(deps, id).video!

    const step = async (expected: Record<string, unknown>) => {
      await vi.waitFor(() => expect(gate.pauses).toHaveLength(1))
      gate.pauses.shift()!()
      await vi.waitFor(() => expect(video()).toMatchObject(expected))
    }

    expect(video()).toMatchObject({ status: 'running', stage: null, script: null, storyboardUrl: null, videoUrl: null })

    await step({ status: 'running', stage: 'script', storyboardUrl: null, videoUrl: null })
    const script = JSON.parse(readFileSync(join(FIXTURES, 'video-script.json'), 'utf8')) as { script: unknown }
    expect(video().script).toEqual(script.script) // the script is there before anything else

    await step({ status: 'running', stage: 'storyboard', storyboardUrl: `/media/generations/${id}/storyboard.png`, videoUrl: null })
    expect(filesOf(id)).toContain('storyboard.png') // the storyboard is shown while the video is still to come
    expect(filesOf(id)).not.toContain('video.mp4')

    await step({ status: 'running', stage: 'video', videoUrl: null })

    await step({ status: 'completed', stage: null, videoUrl: `/media/generations/${id}/video.mp4` })
    expect(readFileSync(join(folderOf(id), 'video.mp4')).equals(readFileSync(join(FIXTURES, 'video.mp4')))).toBe(true)
    expect(readFileSync(join(folderOf(id), 'storyboard.png')).equals(readFileSync(join(FIXTURES, 'storyboard.png')))).toBe(true)
    expect(getGeneration(deps, id)).toMatchObject({ status: 'completed', caption: expect.any(String) }) // the post is untouched
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('ends failed when the caption asks for a failure, and a retry after fixing the caption completes', async () => {
    const { deps } = setup()
    const id = await finishedPost(deps)
    patchGeneration(deps, id, { caption: 'Caption dengan mock:fail di dalamnya' })

    await createVideo(deps, id)
    await vi.waitFor(() => expect(getGeneration(deps, id).video?.status).toBe('failed'))

    const failed = getGeneration(deps, id).video!
    expect(failed.error).toMatch(/mock:fail/)
    expect(failed.videoUrl).toBeNull()
    expect(filesOf(id)).not.toContain('video.mp4')

    patchGeneration(deps, id, { caption: 'Caption yang sudah benar' })
    const retried = await createVideo(deps, id)
    // a new attempt starts clean: what the failed one had delivered is gone from the detail
    expect(retried.video).toMatchObject({ status: 'running', script: null, storyboardUrl: null })

    await vi.waitFor(() => expect(getGeneration(deps, id).video?.status).toBe('completed'))
    expect(getGeneration(deps, id).video).toMatchObject({ error: null, videoUrl: `/media/generations/${id}/video.mp4` })
    expect(filesOf(id)).toEqual(['post.png', 'storyboard.png', 'video.mp4'])
  })

  it('a prompt that fails the post never gets as far as a video', async () => {
    const { deps } = setup()
    const created = await createGeneration(deps, { brandId: 'brd_1', prompt: 'promo mock:fail', aspectRatio: '1:1', assetIds: ['ast_photo'] })
    await vi.waitFor(() => expect(getGeneration(deps, created.id).status).toBe('failed'))

    await expect(createVideo(deps, created.id)).rejects.toMatchObject({ kind: 'conflict' })
  })

  it('refuses a second video once the first is done', async () => {
    const { deps } = setup()
    const id = await finishedPost(deps)
    await createVideo(deps, id)
    await vi.waitFor(() => expect(getGeneration(deps, id).video?.status).toBe('completed'))

    await expect(createVideo(deps, id)).rejects.toMatchObject({ kind: 'conflict' })
  })
})
