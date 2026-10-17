import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import { brandAssets, brands, generations, jobs } from '../../server/db/schema'
import { deleteBrand } from '../../server/utils/brands'
import { GenerationError, type GenerationErrorKind } from '../../server/utils/generation-errors'
import {
  createGeneration,
  deleteGeneration,
  deriveStatus,
  getGeneration,
  listGenerations,
  patchGeneration,
  type GenerationDeps
} from '../../server/utils/generations'
import { startJob } from '../../server/utils/job-dispatch'
import { completeJob, createJob, failJob, markRunning, updateStage } from '../../server/utils/jobs'
import type { N8nClient } from '../../server/utils/n8n-client'
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
  const id = over.id ?? `brd_${++counter}`
  testDb.db.insert(brands).values({
    id,
    name: 'Kopi Senja',
    sourceType: 'manual',
    sourceUrl: null,
    sourceAssetId: null,
    dnaJson: JSON.stringify(dna),
    status: 'ready',
    createdAt: T0,
    updatedAt: T0,
    ...over
  }).run()
  return id
}

function addAsset(brandId: string, kind: 'logo' | 'product_photo' | 'source_pdf', over: Partial<typeof brandAssets.$inferInsert> = {}) {
  const id = over.id ?? `ast_${++counter}`
  testDb.db.insert(brandAssets).values({
    id,
    brandId,
    kind,
    path: `brands/${brandId}/${kind}-${id}.png`,
    mime: 'image/png',
    sizeBytes: 1,
    label: null,
    sortOrder: 0,
    createdAt: T0,
    ...over
  }).run()
  return id
}

const body = (brandId: string, assetIds: string[], over: Record<string, unknown> = {}) => ({
  brandId,
  prompt: 'promo ramadan',
  aspectRatio: '4:5',
  assetIds,
  ...over
})

async function rejects(promise: Promise<unknown>, kind: GenerationErrorKind, message?: RegExp) {
  await expect(promise).rejects.toBeInstanceOf(GenerationError)
  await expect(promise).rejects.toMatchObject({ kind })
  if (message) await expect(promise).rejects.toThrow(message)
}

function expectKind(fn: () => unknown, kind: GenerationErrorKind) {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(GenerationError)
    expect((error as GenerationError).kind).toBe(kind)
    return
  }
  throw new Error(`expected a GenerationError of kind ${kind}`)
}

const generationRows = () => testDb.db.select().from(generations).all()
const jobRows = () => testDb.db.select().from(jobs).all()

describe('createGeneration', () => {
  it('creates the generation and starts a post job linked to both', async () => {
    const { deps, client } = setup()
    const brandId = makeBrand()
    const photo = addAsset(brandId, 'product_photo')

    const created = await createGeneration(deps, body(brandId, [photo]))

    expect(created).toMatchObject({
      brandId,
      prompt: 'promo ramadan',
      aspectRatio: '4:5',
      assetIds: [photo],
      status: 'running',
      caption: null,
      hashtags: null,
      imageUrl: null,
      error: null
    })
    expect(created.id).toMatch(/^gen_[\w-]{12}$/)

    const [job] = jobRows()
    expect(job).toMatchObject({ type: 'post', brandId, generationId: created.id, status: 'running' })
    expect(created.jobId).toBe(job!.id)
    expect(client.dispatch).toHaveBeenCalledTimes(1)
  })

  it('sends the DNA, the trimmed prompt, the ratio and the assets: logo first, then the photos in the order chosen', async () => {
    const { deps, client } = setup()
    const brandId = makeBrand()
    const logo = addAsset(brandId, 'logo', { mime: 'image/webp' })
    const first = addAsset(brandId, 'product_photo', { label: 'botol depan' })
    const second = addAsset(brandId, 'product_photo', { mime: 'image/jpeg' })

    await createGeneration(deps, body(brandId, [second, first], { prompt: '  promo ramadan  ', aspectRatio: '1:1' }))

    const [, input] = client.dispatch.mock.calls[0] as unknown as [unknown, Record<string, unknown>]
    expect(input).toEqual({
      brand_dna: dna,
      prompt: 'promo ramadan',
      aspect_ratio: '1:1',
      assets: [
        { id: logo, kind: 'logo', mime: 'image/webp' },
        { id: second, kind: 'product_photo', mime: 'image/jpeg' },
        { id: first, kind: 'product_photo', mime: 'image/png', label: 'botol depan' }
      ]
    })
  })

  it('sends only the photos when the brand has no logo, and leaves out an empty label (not null)', async () => {
    const { deps, client } = setup()
    const brandId = makeBrand()
    const photo = addAsset(brandId, 'product_photo')

    await createGeneration(deps, body(brandId, [photo]))

    const [, input] = client.dispatch.mock.calls[0] as unknown as [unknown, { assets: Record<string, unknown>[] }]
    expect(input.assets).toEqual([{ id: photo, kind: 'product_photo', mime: 'image/png' }])
    expect('label' in input.assets[0]!).toBe(false)
  })

  it('stores a failed generation when n8n refuses the job, and still answers', async () => {
    const { deps, client } = setup()
    client.dispatch.mockRejectedValueOnce(new Error('n8n responded 500'))
    const brandId = makeBrand()
    const photo = addAsset(brandId, 'product_photo')

    const created = await createGeneration(deps, body(brandId, [photo]))

    expect(created.status).toBe('failed')
    expect(created.error).toMatch(/^dispatch_failed.*n8n responded 500/)
    expect(generationRows()).toHaveLength(1)
  })

  describe('rejections create nothing and start no job', () => {
    const none = () => {
      expect(generationRows()).toHaveLength(0)
      expect(jobRows()).toHaveLength(0)
    }

    it.each([
      ['an empty prompt', { prompt: '' }],
      ['a prompt of only spaces', { prompt: '   ' }],
      ['a prompt over 2000 characters', { prompt: 'x'.repeat(2001) }],
      ['an unknown ratio', { aspectRatio: '16:9' }],
      ['no photos', { assetIds: [] }],
      ['four photos', { assetIds: ['a', 'b', 'c', 'd'] }],
      ['the same photo twice', { assetIds: ['a', 'a'] }]
    ])('answers invalid for %s', async (_label, over) => {
      const { deps } = setup()
      const brandId = makeBrand()
      await rejects(createGeneration(deps, { ...body(brandId, [addAsset(brandId, 'product_photo')]), ...over }), 'invalid')
      none()
    })

    it('says in plain words what is wrong', async () => {
      const { deps } = setup()
      const brandId = makeBrand()
      const photo = addAsset(brandId, 'product_photo')
      await rejects(createGeneration(deps, body(brandId, [photo], { prompt: ' ' })), 'invalid', /Write what the post should be about/)
      await rejects(createGeneration(deps, body(brandId, [])), 'invalid', /at least one product photo/)
    })

    it('rejects a photo of another brand, the logo, the source PDF, and an id that does not exist', async () => {
      const { deps } = setup()
      const mine = makeBrand()
      const other = makeBrand()
      const ok = addAsset(mine, 'product_photo')
      const foreign = addAsset(other, 'product_photo')
      const logo = addAsset(mine, 'logo')
      const pdf = addAsset(mine, 'source_pdf')

      for (const bad of [foreign, logo, pdf, 'ast_ghost']) {
        await rejects(createGeneration(deps, body(mine, [ok, bad])), 'invalid', /does not belong to this brand/)
      }
      none()
    })

    it('answers not_found for an unknown brand', async () => {
      const { deps } = setup()
      await rejects(createGeneration(deps, body('brd_ghost', ['ast_1'])), 'not_found')
      none()
    })

    it.each(['extracting', 'failed'] as const)('answers conflict for a brand that is %s', async (status) => {
      const { deps } = setup()
      const brandId = makeBrand({ status, dnaJson: null })
      await rejects(createGeneration(deps, body(brandId, [addAsset(brandId, 'product_photo')])), 'conflict', /not ready/)
      none()
    })

    it('reconciles first: a brand whose extraction already failed is not treated as ready to start', async () => {
      const { deps, clock } = setup()
      const brandId = makeBrand({ status: 'extracting', dnaJson: null })
      const photo = addAsset(brandId, 'product_photo')
      clock.now = T0 + 5 * MINUTE // no job at all, created long ago

      await rejects(createGeneration(deps, body(brandId, [photo])), 'conflict')
      none()
    })

    it('answers conflict for a ready brand that lost its DNA', async () => {
      const { deps } = setup()
      const brandId = makeBrand({ dnaJson: null })
      await rejects(createGeneration(deps, body(brandId, [addAsset(brandId, 'product_photo')])), 'conflict')
      none()
    })

    it('answers invalid for a body that is not an object', async () => {
      const { deps } = setup()
      await rejects(createGeneration(deps, null), 'invalid')
      await rejects(createGeneration(deps, 'nope'), 'invalid')
      none()
    })
  })
})

describe('deriveStatus', () => {
  const gen = { createdAt: T0 }
  const job = (over: Partial<ReturnType<typeof createJob>>) => ({ ...createJob(testDb.db, { type: 'post' }, T0), ...over })

  it('is running with the stage of a queued or running job', () => {
    expect(deriveStatus(gen, job({ status: 'queued' }), T0)).toEqual({ status: 'running', stage: null, error: null })
    expect(deriveStatus(gen, job({ status: 'running', stage: 'image' }), T0)).toEqual({ status: 'running', stage: 'image', error: null })
  })

  it('is completed for a completed job, and failed with the error of a failed one', () => {
    expect(deriveStatus(gen, job({ status: 'completed', stage: 'image' }), T0)).toEqual({ status: 'completed', stage: null, error: null })
    expect(deriveStatus(gen, job({ status: 'failed', error: 'Gemini quota exceeded' }), T0))
      .toEqual({ status: 'failed', stage: null, error: 'Gemini quota exceeded' })
  })

  it('says something readable when a failed job has no error', () => {
    expect(deriveStatus(gen, job({ status: 'failed', error: null }), T0).error).toBe('The generation failed.')
  })

  it('without a job: running for the first 60 seconds, failed after that', () => {
    expect(deriveStatus(gen, undefined, T0 + 5000).status).toBe('running')
    expect(deriveStatus(gen, undefined, T0 + 60_000).status).toBe('running')
    expect(deriveStatus(gen, undefined, T0 + 60_001)).toEqual({ status: 'failed', stage: null, error: 'The generation did not start.' })
  })
})

describe('getGeneration', () => {
  it('shows the stage of the running job and its id', async () => {
    const { deps } = setup()
    const brandId = makeBrand()
    const created = await createGeneration(deps, body(brandId, [addAsset(brandId, 'product_photo')]))
    updateStage(testDb.db, created.jobId!, 'image', T0 + 5)

    expect(getGeneration(deps, created.id)).toMatchObject({ status: 'running', stage: 'image', jobId: created.jobId })
  })

  it('shows the error of a failed job', async () => {
    const { deps } = setup()
    const brandId = makeBrand()
    const created = await createGeneration(deps, body(brandId, [addAsset(brandId, 'product_photo')]))
    failJob(testDb.db, created.jobId!, 'Gemini quota exceeded', T0 + 1)

    expect(getGeneration(deps, created.id)).toMatchObject({ status: 'failed', error: 'Gemini quota exceeded' })
  })

  it('fails with timeout after 5 minutes, without writing to the generations table', async () => {
    const { deps, clock } = setup()
    const brandId = makeBrand()
    const created = await createGeneration(deps, body(brandId, [addAsset(brandId, 'product_photo')]))
    const before = generationRows()

    clock.now = T0 + 6 * MINUTE
    expect(getGeneration(deps, created.id)).toMatchObject({ status: 'failed', error: 'timeout' })
    expect(generationRows()).toEqual(before)
  })

  it('fails a generation that never got a job, once the grace period is over', () => {
    const { deps, clock } = setup()
    const brandId = makeBrand()
    testDb.db.insert(generations).values({
      id: 'gen_orphan', brandId, prompt: 'x', aspectRatio: '1:1', assetIdsJson: '[]',
      caption: null, hashtagsJson: null, imagePath: null, createdAt: T0, updatedAt: T0
    }).run()

    expect(getGeneration(deps, 'gen_orphan').status).toBe('running')
    clock.now = T0 + 2 * MINUTE
    expect(getGeneration(deps, 'gen_orphan')).toMatchObject({ status: 'failed', jobId: null })
  })

  it('uses the latest post job of the generation', async () => {
    const { deps, clock } = setup()
    const brandId = makeBrand()
    const created = await createGeneration(deps, body(brandId, [addAsset(brandId, 'product_photo')]))
    failJob(testDb.db, created.jobId!, 'first attempt failed', T0 + 1)

    clock.now = T0 + 10
    const second = createJob(testDb.db, { type: 'post', brandId, generationId: created.id }, T0 + 10)
    markRunning(testDb.db, second.id, T0 + 10)

    expect(getGeneration(deps, created.id)).toMatchObject({ status: 'running', jobId: second.id })
  })

  it('exposes the image url and the stored caption and hashtags', () => {
    const { deps } = setup()
    const brandId = makeBrand()
    testDb.db.insert(generations).values({
      id: 'gen_done', brandId, prompt: 'x', aspectRatio: '1:1', assetIdsJson: '["a"]',
      caption: 'Halo', hashtagsJson: '["#a","#b"]', imagePath: 'generations/gen_done/post.png', createdAt: T0, updatedAt: T0
    }).run()
    const job = createJob(testDb.db, { type: 'post', brandId, generationId: 'gen_done' }, T0)
    completeJob(testDb.db, job.id, T0 + 1)

    expect(getGeneration(deps, 'gen_done')).toMatchObject({
      status: 'completed',
      caption: 'Halo',
      hashtags: ['#a', '#b'],
      imageUrl: '/media/generations/gen_done/post.png',
      assetIds: ['a']
    })
  })

  it('answers not_found for an unknown id', () => {
    expectKind(() => getGeneration(setup().deps, 'gen_ghost'), 'not_found')
  })

  it('fails loudly when the stored JSON is corrupt', () => {
    const { deps } = setup()
    const brandId = makeBrand()
    const row = (id: string, assets: string, tags: string | null) => testDb.db.insert(generations).values({
      id, brandId, prompt: 'x', aspectRatio: '1:1', assetIdsJson: assets,
      caption: null, hashtagsJson: tags, imagePath: null, createdAt: T0, updatedAt: T0
    }).run()
    row('gen_a', '{"not":"a list"}', null)
    row('gen_b', 'not json', null)
    row('gen_c', '[]', '[1,2]')

    for (const id of ['gen_a', 'gen_b', 'gen_c']) expectKind(() => getGeneration(deps, id), 'corrupt')
  })
})

describe('listGenerations', () => {
  it('needs a brand id', () => {
    expectKind(() => listGenerations(setup().deps, undefined), 'invalid')
    expectKind(() => listGenerations(setup().deps, ''), 'invalid')
  })

  it('is empty for a brand without generations and for an unknown brand', () => {
    const { deps } = setup()
    expect(listGenerations(deps, makeBrand())).toEqual([])
    expect(listGenerations(deps, 'brd_ghost')).toEqual([])
  })

  it('lists newest first, only the requested brand, with status, stage and image url', async () => {
    const { deps, clock } = setup()
    const mine = makeBrand()
    const other = makeBrand()
    const first = await createGeneration(deps, body(mine, [addAsset(mine, 'product_photo')], { prompt: 'eerste' }))
    clock.now = T0 + 1000
    const second = await createGeneration(deps, body(mine, [addAsset(mine, 'product_photo')], { prompt: 'tweede' }))
    await createGeneration(deps, body(other, [addAsset(other, 'product_photo')], { prompt: 'andere' }))
    updateStage(testDb.db, second.jobId!, 'image', T0 + 1001)
    failJob(testDb.db, first.jobId!, 'boom', T0 + 1002)

    const list = listGenerations(deps, mine)
    expect(list.map(item => item.prompt)).toEqual(['tweede', 'eerste'])
    expect(list[0]).toMatchObject({ id: second.id, status: 'running', stage: 'image', imageUrl: null })
    expect(list[1]).toMatchObject({ id: first.id, status: 'failed' })
  })

  it('reports a saved image as completed without needing its job', () => {
    const { deps } = setup()
    const brandId = makeBrand()
    testDb.db.insert(generations).values({
      id: 'gen_done', brandId, prompt: 'x', aspectRatio: '4:5', assetIdsJson: '[]',
      caption: 'c', hashtagsJson: '[]', imagePath: 'generations/gen_done/post.jpg', createdAt: T0, updatedAt: T0
    }).run()

    expect(listGenerations(deps, brandId)[0]).toMatchObject({ status: 'completed', imageUrl: '/media/generations/gen_done/post.jpg' })
  })

  it('applies the timeout to running ones', async () => {
    const { deps, clock } = setup()
    const brandId = makeBrand()
    await createGeneration(deps, body(brandId, [addAsset(brandId, 'product_photo')]))

    clock.now = T0 + 6 * MINUTE
    expect(listGenerations(deps, brandId)[0]).toMatchObject({ status: 'failed' })
  })

  it('returns at most 100, the newest ones', () => {
    const { deps } = setup()
    const brandId = makeBrand()
    for (let i = 0; i < 120; i++) {
      testDb.db.insert(generations).values({
        id: `gen_${String(i).padStart(3, '0')}`, brandId, prompt: `p${i}`, aspectRatio: '1:1', assetIdsJson: '[]',
        caption: null, hashtagsJson: null, imagePath: 'generations/x/post.png', createdAt: T0 + i, updatedAt: T0 + i
      }).run()
    }

    const list = listGenerations(deps, brandId)
    expect(list).toHaveLength(100)
    expect(list[0]!.prompt).toBe('p119')
    expect(list.at(-1)!.prompt).toBe('p20')
  })
})

describe('patchGeneration', () => {
  async function completed(deps: GenerationDeps) {
    const brandId = makeBrand()
    const created = await createGeneration(deps, body(brandId, [addAsset(brandId, 'product_photo')]))
    testDb.db.update(generations)
      .set({ caption: 'Caption lama', hashtagsJson: '["#lama"]', imagePath: `generations/${created.id}/post.png` })
      .where(eq(generations.id, created.id)).run()
    completeJob(testDb.db, created.jobId!, T0 + 1)
    return created
  }

  it('replaces the caption and refreshes updated_at', async () => {
    const { deps, clock } = setup()
    const created = await completed(deps)

    clock.now = T0 + 5000
    const patched = patchGeneration(deps, created.id, { caption: '  Teks baru  ' })

    expect(patched).toMatchObject({ caption: 'Teks baru', hashtags: ['#lama'], updatedAt: T0 + 5000 })
  })

  it('normalizes and deduplicates hashtags', async () => {
    const { deps } = setup()
    const created = await completed(deps)
    expect(patchGeneration(deps, created.id, { hashtags: ['promo', '#Promo', '##baru'] }).hashtags).toEqual(['#promo', '#baru'])
  })

  it('can clear the hashtags', async () => {
    const { deps } = setup()
    const created = await completed(deps)
    expect(patchGeneration(deps, created.id, { hashtags: [] }).hashtags).toEqual([])
  })

  it('refuses a hashtag with a space and changes nothing', async () => {
    const { deps } = setup()
    const created = await completed(deps)
    expectKind(() => patchGeneration(deps, created.id, { hashtags: ['promo', 'kopi senja'] }), 'invalid')
    expect(getGeneration(deps, created.id).hashtags).toEqual(['#lama'])
  })

  it('accepts a caption of 2200 characters and refuses empty, blank and 2201', async () => {
    const { deps } = setup()
    const created = await completed(deps)
    expect(patchGeneration(deps, created.id, { caption: 'x'.repeat(2200) }).caption).toHaveLength(2200)
    for (const caption of ['', '   ', 'x'.repeat(2201)]) {
      expectKind(() => patchGeneration(deps, created.id, { caption }), 'invalid')
    }
    expect(getGeneration(deps, created.id).caption).toHaveLength(2200)
  })

  it('changes nothing for an empty body', async () => {
    const { deps, clock } = setup()
    const created = await completed(deps)
    clock.now = T0 + 9000
    expect(patchGeneration(deps, created.id, {})).toMatchObject({ caption: 'Caption lama', updatedAt: created.updatedAt })
  })

  it('answers conflict while the post is running or after it failed', async () => {
    const { deps } = setup()
    const brandId = makeBrand()
    const running = await createGeneration(deps, body(brandId, [addAsset(brandId, 'product_photo')]))
    expectKind(() => patchGeneration(deps, running.id, { caption: 'x' }), 'conflict')

    failJob(testDb.db, running.jobId!, 'boom', T0 + 1)
    expectKind(() => patchGeneration(deps, running.id, { caption: 'x' }), 'conflict')
  })

  it('answers not_found for an unknown id', () => {
    expectKind(() => patchGeneration(setup().deps, 'gen_ghost', { caption: 'x' }), 'not_found')
  })
})

describe('deleteGeneration', () => {
  it('removes the row and the folder, but not the job', async () => {
    const { deps } = setup()
    const brandId = makeBrand()
    const created = await createGeneration(deps, body(brandId, [addAsset(brandId, 'product_photo')]))
    const folder = join(testMedia.dir, 'generations', created.id)
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'post.png'), 'x')

    await deleteGeneration(deps, created.id)

    expect(generationRows()).toHaveLength(0)
    expect(existsSync(folder)).toBe(false)
    expect(jobRows()).toHaveLength(1)
  })

  it('leaves the other generations and their files alone', async () => {
    const { deps } = setup()
    const brandId = makeBrand()
    const photo = addAsset(brandId, 'product_photo')
    const a = await createGeneration(deps, body(brandId, [photo]))
    const b = await createGeneration(deps, body(brandId, [photo]))
    for (const g of [a, b]) {
      mkdirSync(join(testMedia.dir, 'generations', g.id), { recursive: true })
      writeFileSync(join(testMedia.dir, 'generations', g.id, 'post.png'), 'x')
    }

    await deleteGeneration(deps, a.id)

    expect(existsSync(join(testMedia.dir, 'generations', b.id, 'post.png'))).toBe(true)
    expect(getGeneration(deps, b.id).id).toBe(b.id)
  })

  it('does not fail when the files cannot be removed', async () => {
    const { deps } = setup()
    const brandId = makeBrand()
    const created = await createGeneration(deps, body(brandId, [addAsset(brandId, 'product_photo')]))
    const parent = join(testMedia.dir, 'generations')
    mkdirSync(join(parent, created.id), { recursive: true })
    writeFileSync(join(parent, created.id, 'post.png'), 'x')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    chmodSync(parent, 0o555) // makes removing a child fail (unless the tests run as root)
    try {
      await expect(deleteGeneration(deps, created.id)).resolves.toBeUndefined()
    } finally {
      chmodSync(parent, 0o755)
      warn.mockRestore()
    }
    expect(generationRows()).toHaveLength(0)
  })

  it('answers not_found for an unknown id', async () => {
    await rejects(deleteGeneration(setup().deps, 'gen_ghost'), 'not_found')
  })
})

describe('deleteBrand and generations', () => {
  it('removes the generations of the brand and their folders, and nobody else\'s', async () => {
    const { deps } = setup()
    const mine = makeBrand()
    const other = makeBrand()
    const a = await createGeneration(deps, body(mine, [addAsset(mine, 'product_photo')]))
    const b = await createGeneration(deps, body(mine, [addAsset(mine, 'product_photo')]))
    const c = await createGeneration(deps, body(other, [addAsset(other, 'product_photo')]))
    for (const g of [a, b, c]) {
      mkdirSync(join(testMedia.dir, 'generations', g.id), { recursive: true })
      writeFileSync(join(testMedia.dir, 'generations', g.id, 'post.png'), 'x')
    }

    await deleteBrand(deps, mine)

    expect(generationRows().map(row => row.id)).toEqual([c.id])
    expect(existsSync(join(testMedia.dir, 'generations', a.id))).toBe(false)
    expect(existsSync(join(testMedia.dir, 'generations', b.id))).toBe(false)
    expect(existsSync(join(testMedia.dir, 'generations', c.id, 'post.png'))).toBe(true)
    expect(jobRows()).toHaveLength(3) // jobs are never deleted
  })

  it('still works for a brand without generations', async () => {
    const { deps } = setup()
    const brandId = makeBrand()
    await expect(deleteBrand(deps, brandId)).resolves.toBeUndefined()
  })
})
