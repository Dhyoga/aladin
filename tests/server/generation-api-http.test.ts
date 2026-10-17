import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { brandAssets, generations, jobs } from '../../server/db/schema'
import { completeJob } from '../../server/utils/jobs'
import { form, jpeg, png, useBrandApi } from './brand-api-harness'

const api = useBrandApi()

interface Asset { id: string }
interface Brand { id: string, status: string }
interface Generation {
  id: string
  brandId: string
  prompt: string
  aspectRatio: string
  assetIds: string[]
  status: string
  stage: string | null
  error: string | null
  caption: string | null
  hashtags: string[] | null
  imageUrl: string | null
  jobId: string | null
  updatedAt: number
}

interface ErrorBody { statusCode: number, message: string }

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body)
})

/** A ready brand (manual, so it is ready at once) with N product photos and a logo. */
async function brandWithPhotos(count = 2, { logo = true } = {}) {
  const created = (await api.post('/api/brands', form({ source_type: 'manual', name: 'Kopi Senja' }))).body as unknown as Brand
  const upload = async (kind: string, files: ReturnType<typeof png>[]) =>
    ((await api.post(`/api/brands/${created.id}/assets`, form({ kind }, files.map((data, i) => ({
      name: 'files', filename: `f${i}.png`, type: 'image/png', data
    }))))).body as unknown as { assets: Asset[] }).assets
  const photos = await upload('product_photo', Array.from({ length: count }, (_, i) => png(64 + i)))
  if (logo) await upload('logo', [png(80)])
  return { brandId: created.id, photos: photos.map(p => p.id) }
}

const create = (brandId: string, assetIds: string[], over: Record<string, unknown> = {}) =>
  api.json<Generation & ErrorBody>('/api/generations', json({ brandId, prompt: 'promo ramadan', aspectRatio: '4:5', assetIds, ...over }))

describe('POST /api/generations', () => {
  it('creates a generation and starts a post job linked to it', async () => {
    const { brandId, photos } = await brandWithPhotos()
    const res = await create(brandId, photos)

    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      brandId,
      prompt: 'promo ramadan',
      aspectRatio: '4:5',
      assetIds: photos,
      status: 'running',
      caption: null,
      imageUrl: null
    })
    const [job] = api.db.select().from(jobs).where(eq(jobs.generationId, res.body.id)).all()
    expect(job).toMatchObject({ type: 'post', brandId, status: 'running' })
    expect(res.body.jobId).toBe(job!.id)
  })

  it('sends the logo first and then the photos in the order chosen', async () => {
    const { brandId, photos } = await brandWithPhotos(2)
    await create(brandId, [photos[1]!, photos[0]!])

    const [, input] = api.dispatch.mock.calls[0] as unknown as [unknown, { assets: { id: string, kind: string }[] }]
    expect(input.assets.map(a => a.kind)).toEqual(['logo', 'product_photo', 'product_photo'])
    expect(input.assets.slice(1).map(a => a.id)).toEqual([photos[1], photos[0]])
  })

  it('answers 201 with a failed generation when n8n refuses the job', async () => {
    const { brandId, photos } = await brandWithPhotos(1)
    api.dispatch.mockRejectedValueOnce(new Error('n8n responded 500'))

    const res = await create(brandId, photos)
    expect(res.status).toBe(201)
    expect(res.body.status).toBe('failed')
    expect(res.body.error).toMatch(/^dispatch_failed/)
  })

  it.each([
    ['an empty prompt', { prompt: '' }, /Write what the post should be about/],
    ['a prompt over 2000 characters', { prompt: 'x'.repeat(2001) }, /at most 2000/],
    ['an unknown ratio', { aspectRatio: '16:9' }, undefined],
    ['no photos', { assetIds: [] }, /at least one product photo/],
    ['four photos', { assetIds: ['a', 'b', 'c', 'd'] }, /at most 3/],
    ['the same photo twice', { assetIds: ['a', 'a'] }, /only once/]
  ])('answers 400 for %s, with a readable message, and creates nothing', async (_label, over, message) => {
    const { brandId, photos } = await brandWithPhotos(1)
    const res = await create(brandId, photos, over)

    expect(res.status).toBe(400)
    if (message) expect(res.body.message).toMatch(message)
    expect(api.db.select().from(generations).all()).toHaveLength(0)
    expect(api.db.select().from(jobs).all()).toHaveLength(0)
  })

  it('answers 400 for a photo of another brand and for the logo', async () => {
    const mine = await brandWithPhotos(1)
    const other = await brandWithPhotos(1)
    const logoId = api.db.select().from(brandAssets).all()
      .find(a => a.brandId === mine.brandId && a.kind === 'logo')!.id

    for (const bad of [other.photos[0]!, logoId, 'ast_ghost']) {
      const res = await create(mine.brandId, [mine.photos[0]!, bad])
      expect(res.status).toBe(400)
      expect(res.body.message).toMatch(/does not belong to this brand/)
    }
    expect(api.db.select().from(generations).all()).toHaveLength(0)
  })

  it('answers 404 for an unknown brand and 409 for a brand that is not ready', async () => {
    expect((await create('brd_ghost', ['ast_1'])).status).toBe(404)

    const extracting = (await api.post('/api/brands', form({ source_type: 'url', url: 'https://example.com' }))).body as unknown as Brand
    const res = await create(extracting.id, ['ast_1'])
    expect(res.status).toBe(409)
    expect(res.body.message).toMatch(/not ready/)
  })

  it('answers 400 when the body is not JSON or not an object', async () => {
    const notJson = await api.json<ErrorBody>('/api/generations', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops'
    })
    expect(notJson.status).toBe(400)
    const empty = await api.json<ErrorBody>('/api/generations', { method: 'POST' })
    expect(empty.status).toBe(400)
  })
})

describe('GET /api/generations/:id', () => {
  it('returns the detail', async () => {
    const { brandId, photos } = await brandWithPhotos(1)
    const created = (await create(brandId, photos)).body

    const res = await api.json<Generation>(`/api/generations/${created.id}`)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ id: created.id, status: 'running', jobId: created.jobId })
  })

  it('answers 404 for an unknown id and 400 for an over-long one', async () => {
    expect((await api.json('/api/generations/gen_ghost')).status).toBe(404)
    expect((await api.json(`/api/generations/${'x'.repeat(65)}`)).status).toBe(400)
  })

  it('answers 500 with a clear message when the stored data is corrupt', async () => {
    const { brandId, photos } = await brandWithPhotos(1)
    const created = (await create(brandId, photos)).body
    api.sqlite.prepare('update generations set asset_ids_json = ? where id = ?').run('{"no":1}', created.id)

    const res = await api.json<ErrorBody>(`/api/generations/${created.id}`)
    expect(res.status).toBe(500)
    expect(res.body.message).toMatch(/are invalid/)
  })
})

describe('GET /api/generations', () => {
  it('needs a brand id', async () => {
    expect((await api.json('/api/generations')).status).toBe(400)
  })

  it('lists the generations of a brand, newest first, and nothing of other brands', async () => {
    const mine = await brandWithPhotos(1)
    const other = await brandWithPhotos(1)
    const a = (await create(mine.brandId, mine.photos, { prompt: 'eerste' })).body
    await new Promise(resolve => setTimeout(resolve, 3))
    const b = (await create(mine.brandId, mine.photos, { prompt: 'tweede' })).body
    await create(other.brandId, other.photos, { prompt: 'andere' })

    const res = await api.json<{ id: string, prompt: string }[]>(`/api/generations?brandId=${mine.brandId}`)
    expect(res.status).toBe(200)
    expect(res.body.map(item => item.id)).toEqual([b.id, a.id])
  })

  it('is empty for a brand without generations', async () => {
    const { brandId } = await brandWithPhotos(1)
    expect((await api.json(`/api/generations?brandId=${brandId}`)).body).toEqual([])
  })
})

describe('PATCH /api/generations/:id', () => {
  /** A generation that is completed and has a caption, without waiting for the mock. */
  async function completed() {
    const { brandId, photos } = await brandWithPhotos(1)
    const created = (await create(brandId, photos)).body
    api.db.update(generations)
      .set({ caption: 'Caption lama', hashtagsJson: '["#lama"]', imagePath: `generations/${created.id}/post.png` })
      .where(eq(generations.id, created.id)).run()
    completeJob(api.db, created.jobId!)
    return created
  }

  it('edits the caption and normalizes the hashtags', async () => {
    const created = await completed()
    const res = await api.patch(`/api/generations/${created.id}`, { caption: '  Teks baru  ', hashtags: ['promo', '#Promo', '##baru'] })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ caption: 'Teks baru', hashtags: ['#promo', '#baru'] })
    expect((await api.json<Generation>(`/api/generations/${created.id}`)).body.caption).toBe('Teks baru')
  })

  it('answers 400 for an invalid caption or hashtag and keeps what was stored', async () => {
    const created = await completed()
    for (const bad of [{ caption: '' }, { caption: '   ' }, { caption: 'x'.repeat(2201) }, { hashtags: ['kopi senja'] }]) {
      const res = await api.patch(`/api/generations/${created.id}`, bad)
      expect(res.status).toBe(400)
      expect(res.body).toHaveProperty('message')
    }
    expect((await api.json<Generation>(`/api/generations/${created.id}`)).body).toMatchObject({ caption: 'Caption lama', hashtags: ['#lama'] })
  })

  it('answers 200 and changes nothing for an empty body', async () => {
    const created = await completed()
    const res = await api.patch(`/api/generations/${created.id}`, {})
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ caption: 'Caption lama' })
  })

  it('answers 409 while the post is still running', async () => {
    const { brandId, photos } = await brandWithPhotos(1)
    const created = (await create(brandId, photos)).body
    expect((await api.patch(`/api/generations/${created.id}`, { caption: 'x' })).status).toBe(409)
  })

  it('answers 404 for an unknown id', async () => {
    expect((await api.patch('/api/generations/gen_ghost', { caption: 'x' })).status).toBe(404)
  })
})

describe('DELETE /api/generations/:id', () => {
  it('answers 204 and removes the row and the folder, but not the job', async () => {
    const { brandId, photos } = await brandWithPhotos(1)
    api.useMockPipeline()
    const created = (await create(brandId, photos)).body
    await expect.poll(async () => (await api.json<Generation>(`/api/generations/${created.id}`)).body.status).toBe('completed')
    const folder = join(api.mediaDir, 'generations', created.id)
    expect(existsSync(folder)).toBe(true)

    const res = await api.fetch(`/api/generations/${created.id}`, { method: 'DELETE' })
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
    expect(existsSync(folder)).toBe(false)
    expect(api.db.select().from(generations).all()).toHaveLength(0)
    expect(api.db.select().from(jobs).where(eq(jobs.generationId, created.id)).all()).toHaveLength(1)
  })

  it('answers 404 for an unknown id', async () => {
    expect((await api.fetch('/api/generations/gen_ghost', { method: 'DELETE' })).status).toBe(404)
  })
})

describe('deleting a brand', () => {
  it('removes its generations and their files', async () => {
    const { brandId, photos } = await brandWithPhotos(1)
    api.useMockPipeline()
    const created = (await create(brandId, photos)).body
    await expect.poll(async () => (await api.json<Generation>(`/api/generations/${created.id}`)).body.status).toBe('completed')

    expect((await api.fetch(`/api/brands/${brandId}`, { method: 'DELETE' })).status).toBe(204)

    expect(api.db.select().from(generations).all()).toHaveLength(0)
    expect(existsSync(join(api.mediaDir, 'generations', created.id))).toBe(false)
  })
})

describe('the whole flow through the real mock n8n', () => {
  it('goes from running to completed and serves the image', async () => {
    const { brandId, photos } = await brandWithPhotos(1)
    api.useMockPipeline()
    const created = (await create(brandId, photos)).body
    expect(created.status).toBe('running')

    await expect.poll(async () => (await api.json<Generation>(`/api/generations/${created.id}`)).body.status).toBe('completed')

    const done = (await api.json<Generation>(`/api/generations/${created.id}`)).body
    expect(done.caption).toMatch(/Kopi Senja/)
    expect(done.hashtags!.length).toBeGreaterThan(0)
    const image = await api.fetch(done.imageUrl!)
    expect(image.status).toBe(200)
    expect(image.headers.get('content-type')).toBe('image/png')

    const list = (await api.json<{ id: string, status: string, imageUrl: string }[]>(`/api/generations?brandId=${brandId}`)).body
    expect(list[0]).toMatchObject({ id: created.id, status: 'completed', imageUrl: done.imageUrl })
  })

  it('ends failed, with the reason, when the prompt asks for a failure, and Retry (a new generation) can succeed', async () => {
    const { brandId, photos } = await brandWithPhotos(1)
    api.useMockPipeline()
    const failing = (await create(brandId, photos, { prompt: 'promo mock:fail' })).body
    await expect.poll(async () => (await api.json<Generation>(`/api/generations/${failing.id}`)).body.status).toBe('failed')
    expect((await api.json<Generation>(`/api/generations/${failing.id}`)).body.error).toMatch(/mock:fail/)

    const retry = (await create(brandId, photos, { prompt: 'promo' })).body
    await expect.poll(async () => (await api.json<Generation>(`/api/generations/${retry.id}`)).body.status).toBe('completed')
    // the failed one stays in the history
    expect((await api.json<unknown[]>(`/api/generations?brandId=${brandId}`)).body).toHaveLength(2)
  })

  it('refuses a photo that was deleted in the meantime (Regenerate with an old id)', async () => {
    const { brandId, photos } = await brandWithPhotos(1)
    await api.fetch(`/api/brands/${brandId}/assets/${photos[0]}`, { method: 'DELETE' })

    const res = await create(brandId, photos)
    expect(res.status).toBe(400)
  })

  it('keeps a JPEG too: the extension follows the content', async () => {
    // the mock always sends a PNG; here the result handler is fed a JPEG through the same route as n8n would
    const { brandId, photos } = await brandWithPhotos(1)
    const created = (await create(brandId, photos)).body
    const { createPostResultHandler } = await import('../../server/utils/post-result')
    const handler = createPostResultHandler({ db: api.db, mediaDir: api.mediaDir })
    await handler.onCompleted({
      job: api.db.select().from(jobs).where(eq(jobs.generationId, created.id)).get()!,
      stage: undefined,
      payload: { caption: 'Halo', hashtags: ['#a'], image_brief: { headline: 'h', scene: 's', chips: [] } },
      files: { image: { field: 'image', filename: 'x.bin', mime: 'application/octet-stream', data: jpeg(100) } }
    })

    const detail = (await api.json<Generation>(`/api/generations/${created.id}`)).body
    expect(detail.imageUrl).toBe(`/media/generations/${created.id}/post.jpg`)
    expect((await api.fetch(detail.imageUrl!)).headers.get('content-type')).toBe('image/jpeg')
  })
})
