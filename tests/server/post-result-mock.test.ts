import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { brandAssets, brands } from '../../server/db/schema'
import { createGeneration, getGeneration, type GenerationDeps } from '../../server/utils/generations'
import { applyJobCallback } from '../../server/utils/job-callback'
import { createHandlerRegistry } from '../../server/utils/job-handlers'
import { startJob } from '../../server/utils/job-dispatch'
import { createN8nClient } from '../../server/utils/n8n-client'
import { createFixtureLoader, createMockRunner } from '../../server/utils/n8n-mock'
import { createPostResultHandler } from '../../server/utils/post-result'
import { BrandDNA } from '../../shared/schemas/brand-dna'
import { useTestDatabase, useTestMedia } from './helpers'

const testDb = useTestDatabase()
const testMedia = useTestMedia()

const loadFixture = createFixtureLoader(fileURLToPath(new URL('../../server/fixtures', import.meta.url)))

const dna = BrandDNA.parse({
  identity: { name: 'Kopi Senja', summary: 'Kedai kopi' },
  audience: { targetAudience: 'Mahasiswa' },
  voice: { toneOfVoice: 'Santai' },
  offer: {},
  visual: {},
  social: {}
})

/** The real pipeline: mock n8n, the real callback core, the real post handler, the real service. */
function setup({ sleep = async () => {} }: { sleep?: (ms: number) => Promise<void> } = {}) {
  const registry = createHandlerRegistry()
  registry.register('post', createPostResultHandler({ db: testDb.db, mediaDir: testMedia.dir }))

  const runner = createMockRunner({
    loadFixture,
    sleep, // by default no real waiting
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
  return { deps, fetchFn }
}

const generate = (deps: GenerationDeps, prompt: string) =>
  createGeneration(deps, { brandId: 'brd_1', prompt, aspectRatio: '4:5', assetIds: ['ast_photo'] })

describe('post generation in mock mode', () => {
  it('goes from running to completed with the fixture caption, hashtags and image', async () => {
    const { deps, fetchFn } = setup()
    const created = await generate(deps, 'promo ramadan')
    expect(created.status).toBe('running')

    await vi.waitFor(() => expect(getGeneration(deps, created.id).status).toBe('completed'))

    const done = getGeneration(deps, created.id)
    expect(done.caption).toMatch(/Kopi Senja/)
    expect(done.hashtags).toEqual(['#KopiSenja', '#NgopiSantai', '#KopiLokal', '#SingleOrigin', '#JedaSejenak'])
    expect(done.imageUrl).toBe(`/media/generations/${created.id}/post.png`)
    expect(done.error).toBeNull()

    const file = join(testMedia.dir, 'generations', created.id, 'post.png')
    expect(existsSync(file)).toBe(true)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('follows the stages caption, then image, then completed, one step at a time', async () => {
    // every pause of the mock scenario waits until the test lets it go
    const pauses: (() => void)[] = []
    const { deps } = setup({ sleep: () => new Promise<void>(resolve => pauses.push(resolve)) })
    const created = await generate(deps, 'promo')

    const step = async (expected: { status: string, stage: string | null }) => {
      const release = pauses.shift()
      if (!release) throw new Error('the mock scenario is not waiting')
      release()
      await vi.waitFor(() => expect(getGeneration(deps, created.id)).toMatchObject(expected))
    }

    expect(getGeneration(deps, created.id)).toMatchObject({ status: 'running', stage: null })
    await vi.waitFor(() => expect(pauses).toHaveLength(1))
    await step({ status: 'running', stage: 'caption' })
    await vi.waitFor(() => expect(pauses).toHaveLength(1))
    await step({ status: 'running', stage: 'image' })
    await vi.waitFor(() => expect(pauses).toHaveLength(1))
    expect(getGeneration(deps, created.id).imageUrl).toBeNull()
    await step({ status: 'completed', stage: null })
    expect(getGeneration(deps, created.id).imageUrl).not.toBeNull()
  })

  it('ends failed with the mock error when the prompt asks for a failure, with no caption and no image', async () => {
    const { deps } = setup()
    const created = await generate(deps, 'promo mock:fail')

    await vi.waitFor(() => expect(getGeneration(deps, created.id).status).toBe('failed'))

    const failed = getGeneration(deps, created.id)
    expect(failed.error).toMatch(/mock:fail/)
    expect(failed.caption).toBeNull()
    expect(failed.imageUrl).toBeNull()
    expect(existsSync(join(testMedia.dir, 'generations'))).toBe(false)
  })

  it('a regenerate is a separate generation that finishes on its own', async () => {
    const { deps } = setup()
    const first = await generate(deps, 'promo')
    const second = await generate(deps, 'promo')

    await vi.waitFor(() => {
      expect(getGeneration(deps, first.id).status).toBe('completed')
      expect(getGeneration(deps, second.id).status).toBe('completed')
    })
    expect(getGeneration(deps, first.id).imageUrl).not.toBe(getGeneration(deps, second.id).imageUrl)
  })
})
