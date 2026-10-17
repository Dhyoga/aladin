import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { brandAssets, brands, jobs } from '../../server/db/schema'
import { MAX_PRODUCT_PHOTOS } from '../../shared/schemas/brand'
import { delay, form, jpeg, pdf, png, useBrandApi, validDna } from './brand-api-harness'

const MB = 1024 * 1024

const api = useBrandApi()

interface Asset { id: string, kind: string, url: string, mime: string, sizeBytes: number, label: string | null, sortOrder: number }
interface Brand {
  id: string
  name: string
  status: string
  sourceType: string
  sourceUrl: string | null
  dna: { identity: { name: string, website?: string } } | null
  logo: Asset | null
  photos: Asset[]
  extraction: { jobId: string, status: string, stage: string | null, error: string | null } | null
  updatedAt: number
}

const image = (name = 'photo.png', data = png(), type = 'image/png') => ({ name: 'files', filename: name, type, data })

async function createManual(name = 'Warung Kita') {
  const res = await api.post('/api/brands', form({ source_type: 'manual', name }))
  expect(res.status).toBe(201)
  return res.body as unknown as Brand
}

async function upload(brandId: string, kind: string, files: ReturnType<typeof image>[]) {
  return api.post(`/api/brands/${brandId}/assets`, form({ kind }, files))
}

describe('GET /api/brands', () => {
  it('returns an empty array without brands', async () => {
    const res = await api.json('/api/brands')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('lists newest first with the logo url', async () => {
    const older = await createManual('Older')
    await delay(3)
    const newer = await createManual('Newer')
    const logo = await upload(older.id, 'logo', [image()])
    const logoUrl = ((logo.body as unknown as { assets: Asset[] }).assets[0])!.url

    const list = (await api.json<{ id: string, name: string, logoUrl: string | null, status: string }[]>('/api/brands')).body
    expect(list.map(item => item.name)).toEqual(['Newer', 'Older'])
    expect(list[0]).toMatchObject({ id: newer.id, logoUrl: null, status: 'ready' })
    expect(list[1]!.logoUrl).toBe(logoUrl)
  })
})

describe('POST /api/brands', () => {
  it('creates a manual brand', async () => {
    const res = await api.post('/api/brands', form({ source_type: 'manual', name: '  Warung Kita  ' }))
    const brand = res.body as unknown as Brand

    expect(res.status).toBe(201)
    expect(brand).toMatchObject({ name: 'Warung Kita', status: 'ready', sourceType: 'manual', extraction: null, logo: null, photos: [] })
    expect(brand.dna?.identity.name).toBe('Warung Kita')
    expect(api.dispatch).not.toHaveBeenCalled()
  })

  it('creates a website brand and starts an extraction job', async () => {
    const res = await api.post('/api/brands', form({ source_type: 'url', url: 'https://www.kopisenja.example/about' }))
    const brand = res.body as unknown as Brand

    expect(res.status).toBe(201)
    expect(brand).toMatchObject({
      name: 'kopisenja.example',
      status: 'extracting',
      sourceType: 'url',
      sourceUrl: 'https://www.kopisenja.example/about',
      dna: null
    })
    expect(brand.extraction).toMatchObject({ status: 'running' })
    expect(api.db.select().from(jobs).where(eq(jobs.brandId, brand.id)).all()).toHaveLength(1)
    expect(api.dispatch).toHaveBeenCalledWith(expect.anything(), { source_type: 'url', url: 'https://www.kopisenja.example/about' })
  })

  it('creates a PDF brand, stores the file and starts a job with the asset id', async () => {
    const res = await api.post('/api/brands', form(
      { source_type: 'pdf' },
      [{ name: 'file', filename: 'Profil Kopi Senja.pdf', type: 'application/pdf', data: pdf() }]
    ))
    const brand = res.body as unknown as Brand

    expect(res.status).toBe(201)
    expect(brand).toMatchObject({ name: 'Profil Kopi Senja', status: 'extracting', sourceType: 'pdf' })

    const [asset] = api.db.select().from(brandAssets).where(eq(brandAssets.brandId, brand.id)).all()
    expect(asset).toMatchObject({ kind: 'source_pdf', mime: 'application/pdf' })
    expect(existsSync(join(api.mediaDir, asset!.path))).toBe(true)
    expect(api.dispatch).toHaveBeenCalledWith(expect.anything(), { source_type: 'pdf', pdf_asset_id: asset!.id })
  })

  it.each([
    ['a missing source_type', {}],
    ['an unknown source_type', { source_type: 'docx' }],
    ['an ftp URL', { source_type: 'url', url: 'ftp://example.com' }],
    ['a missing URL', { source_type: 'url' }],
    ['a javascript URL', { source_type: 'url', url: 'javascript:alert(1)' }],
    ['an empty manual name', { source_type: 'manual', name: '   ' }],
    ['a missing manual name', { source_type: 'manual' }],
    ['a too long manual name', { source_type: 'manual', name: 'x'.repeat(101) }]
  ])('answers 400 for %s and creates nothing', async (_label, fields) => {
    const res = await api.post('/api/brands', form(fields))
    expect(res.status).toBe(400)
    expect(api.db.select().from(brands).all()).toHaveLength(0)
  })

  it('answers 400 when the PDF is missing', async () => {
    expect((await api.post('/api/brands', form({ source_type: 'pdf' }))).status).toBe(400)
  })

  it('answers 400 when the "PDF" is not a PDF, and leaves nothing behind', async () => {
    const res = await api.post('/api/brands', form(
      { source_type: 'pdf' },
      [{ name: 'file', filename: 'x.pdf', type: 'application/pdf', data: Buffer.from('<html>not a pdf</html>') }]
    ))
    expect(res.status).toBe(400)
    expect(api.db.select().from(brands).all()).toHaveLength(0)
    expect(existsSync(join(api.mediaDir, 'brands'))).toBe(false)
  })

  it('answers 400 when the body is not multipart', async () => {
    const res = await api.json('/api/brands', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source_type: 'manual', name: 'x' })
    })
    expect(res.status).toBe(400)
  })

  it('answers 413 when Content-Length is over 21 MB, before reading the body', async () => {
    expect(await api.declaredLength('/api/brands', 22 * MB)).toBe(413)
  })

  it('answers 413 for a PDF over 20 MB', async () => {
    const res = await api.post('/api/brands', form(
      { source_type: 'pdf' },
      [{ name: 'file', filename: 'big.pdf', type: 'application/pdf', data: pdf(20 * MB + 1) }]
    ))
    expect(res.status).toBe(413)
    expect(api.db.select().from(brands).all()).toHaveLength(0)
  })
})

describe('GET /api/brands/:id', () => {
  it('returns the brand detail', async () => {
    const created = await createManual()
    const res = await api.json<Brand>(`/api/brands/${created.id}`)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ id: created.id, name: 'Warung Kita', status: 'ready' })
  })

  it('answers 404 for an unknown brand', async () => {
    expect((await api.json('/api/brands/brd_missing')).status).toBe(404)
  })

  it('answers 400 for an over-long id', async () => {
    expect((await api.json(`/api/brands/${'x'.repeat(65)}`)).status).toBe(400)
  })

  it('answers 500 with a clear message when the stored DNA is corrupt', async () => {
    const created = await createManual()
    api.sqlite.prepare('update brands set dna_json = ? where id = ?').run('{"identity": 1}', created.id)

    const res = await api.json<{ message: string }>(`/api/brands/${created.id}`)
    expect(res.status).toBe(500)
    expect(res.body.message).toMatch(/Stored Brand DNA is invalid/)
  })
})

describe('PATCH /api/brands/:id', () => {
  it('replaces the DNA, syncs the name and answers 200', async () => {
    const created = await createManual()
    const res = await api.patch(`/api/brands/${created.id}`, { dna: validDna('Nama Baru') })
    const brand = res.body as unknown as Brand

    expect(res.status).toBe(200)
    expect(brand).toMatchObject({ name: 'Nama Baru', status: 'ready' })
    expect(brand.dna?.identity.name).toBe('Nama Baru')
    expect(brand.updatedAt).toBeGreaterThanOrEqual(created.updatedAt)
  })

  it('answers 400 for an invalid DNA and keeps the stored one', async () => {
    const created = await createManual()
    const res = await api.patch(`/api/brands/${created.id}`, { dna: { ...validDna(), visual: { colors: ['red'] } } })

    expect(res.status).toBe(400)
    expect((await api.json<Brand>(`/api/brands/${created.id}`)).body.dna?.identity.name).toBe('Warung Kita')
  })

  it('answers 400 for a body without dna', async () => {
    const created = await createManual()
    expect((await api.patch(`/api/brands/${created.id}`, {})).status).toBe(400)
  })

  it('answers 409 while the brand is extracting', async () => {
    const created = (await api.post('/api/brands', form({ source_type: 'url', url: 'https://example.com' }))).body as unknown as Brand
    expect((await api.patch(`/api/brands/${created.id}`, { dna: validDna() })).status).toBe(409)
  })

  it('answers 404 for an unknown brand', async () => {
    expect((await api.patch('/api/brands/brd_missing', { dna: validDna() })).status).toBe(404)
  })
})

describe('POST /api/brands/:id/re-extract', () => {
  const markReady = (id: string) => api.sqlite.prepare("update brands set status = 'ready' where id = ?").run(id)

  it('starts a new job and answers extracting; a second request is a 409', async () => {
    const created = (await api.post('/api/brands', form({ source_type: 'url', url: 'https://example.com' }))).body as unknown as Brand
    markReady(created.id)

    const first = await api.json<Brand>(`/api/brands/${created.id}/re-extract`, { method: 'POST' })
    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({ status: 'extracting', extraction: { status: 'running' } })

    const second = await api.json(`/api/brands/${created.id}/re-extract`, { method: 'POST' })
    expect(second.status).toBe(409)
    expect(api.db.select().from(jobs).where(eq(jobs.brandId, created.id)).all()).toHaveLength(2)
  })

  it('answers 400 for a manual brand', async () => {
    const manual = await createManual()
    expect((await api.json(`/api/brands/${manual.id}/re-extract`, { method: 'POST' })).status).toBe(400)
  })

  it('answers 404 for an unknown brand', async () => {
    expect((await api.json('/api/brands/brd_missing/re-extract', { method: 'POST' })).status).toBe(404)
  })
})

describe('DELETE /api/brands/:id', () => {
  it('answers 204 and removes rows and files', async () => {
    const created = await createManual()
    await upload(created.id, 'product_photo', [image()])
    expect(existsSync(join(api.mediaDir, 'brands', created.id))).toBe(true)

    const res = await api.fetch(`/api/brands/${created.id}`, { method: 'DELETE' })
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
    expect(api.db.select().from(brands).all()).toHaveLength(0)
    expect(api.db.select().from(brandAssets).all()).toHaveLength(0)
    expect(existsSync(join(api.mediaDir, 'brands', created.id))).toBe(false)
  })

  it('answers 404 for an unknown brand', async () => {
    expect((await api.fetch('/api/brands/brd_missing', { method: 'DELETE' })).status).toBe(404)
  })
})

describe('POST /api/brands/:id/assets', () => {
  it('uploads several photos and answers 201', async () => {
    const brand = await createManual()
    const res = await upload(brand.id, 'product_photo', [image('a.png'), image('b.jpg', jpeg(), 'image/jpeg'), image('c.png')])
    const { assets } = res.body as unknown as { assets: Asset[] }

    expect(res.status).toBe(201)
    expect(assets.map(a => [a.kind, a.mime, a.sortOrder])).toEqual([
      ['product_photo', 'image/png', 0],
      ['product_photo', 'image/jpeg', 1],
      ['product_photo', 'image/png', 2]
    ])
  })

  it('serves an uploaded asset from its url with the detected content type and exact bytes', async () => {
    const brand = await createManual()
    const data = png(300, 42)
    const { assets } = (await upload(brand.id, 'product_photo', [image('photo.jpg', data, 'image/jpeg')])).body as unknown as { assets: Asset[] }

    const res = await api.fetch(assets[0]!.url)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(await res.arrayBuffer()).equals(data)).toBe(true)
  })

  it('uploads a logo and shows it in the brand detail', async () => {
    const brand = await createManual()
    const res = await upload(brand.id, 'logo', [image('logo.png')])
    expect(res.status).toBe(201)
    expect((await api.json<Brand>(`/api/brands/${brand.id}`)).body.logo?.kind).toBe('logo')
  })

  it('answers 400 for several files as a logo', async () => {
    const brand = await createManual()
    expect((await upload(brand.id, 'logo', [image(), image()])).status).toBe(400)
  })

  it('answers 400 for a missing or unknown kind', async () => {
    const brand = await createManual()
    expect((await api.post(`/api/brands/${brand.id}/assets`, form({}, [image()]))).status).toBe(400)
    expect((await upload(brand.id, 'source_pdf', [image()])).status).toBe(400)
  })

  it('answers 400 without any file', async () => {
    const brand = await createManual()
    expect((await api.post(`/api/brands/${brand.id}/assets`, form({ kind: 'product_photo' }))).status).toBe(400)
  })

  it('answers 400 for a file that only pretends to be an image, and stores nothing', async () => {
    const brand = await createManual()
    const res = await upload(brand.id, 'product_photo', [image('photo.png', Buffer.from('<html>x</html>'))])
    expect(res.status).toBe(400)
    expect(api.db.select().from(brandAssets).all()).toHaveLength(0)
  })

  it('answers 413 for an image over 10 MB', async () => {
    const brand = await createManual()
    const res = await upload(brand.id, 'product_photo', [image('big.png', png(10 * MB + 1))])
    expect(res.status).toBe(413)
    expect(api.db.select().from(brandAssets).all()).toHaveLength(0)
  })

  it('answers 413 when Content-Length is over 60 MB, before reading the body', async () => {
    const brand = await createManual()
    expect(await api.declaredLength(`/api/brands/${brand.id}/assets`, 61 * MB)).toBe(413)
  })

  it('answers 404 for an unknown brand, even before looking at the body size', async () => {
    expect((await upload('brd_missing', 'product_photo', [image()])).status).toBe(404)
    expect(await api.declaredLength('/api/brands/brd_missing/assets', 61 * MB)).toBe(404)
  })

  it('enforces the photo limit', async () => {
    const brand = await createManual()
    const many = (count: number) => Array.from({ length: count }, (_, i) => image(`p${i}.png`))

    expect((await upload(brand.id, 'product_photo', many(MAX_PRODUCT_PHOTOS - 1))).status).toBe(201)
    expect((await upload(brand.id, 'product_photo', many(2))).status).toBe(400)
    expect((await upload(brand.id, 'product_photo', many(1))).status).toBe(201)
    expect((await api.json<Brand>(`/api/brands/${brand.id}`)).body.photos).toHaveLength(MAX_PRODUCT_PHOTOS)
  })
})

describe('PATCH and DELETE /api/brands/:id/assets/:assetId', () => {
  async function brandWithPhoto() {
    const brand = await createManual()
    const { assets } = (await upload(brand.id, 'product_photo', [image()])).body as unknown as { assets: Asset[] }
    return { brand, photo: assets[0]! }
  }

  it('updates the label and the sort order', async () => {
    const { brand, photo } = await brandWithPhoto()

    const labeled = await api.patch(`/api/brands/${brand.id}/assets/${photo.id}`, { label: 'botol depan' })
    expect(labeled.status).toBe(200)
    expect(labeled.body).toMatchObject({ id: photo.id, label: 'botol depan', sortOrder: photo.sortOrder })

    const moved = await api.patch(`/api/brands/${brand.id}/assets/${photo.id}`, { sortOrder: 5, label: null })
    expect(moved.body).toMatchObject({ label: null, sortOrder: 5 })
  })

  it('answers 400 for a label of 61 characters or a negative sort order', async () => {
    const { brand, photo } = await brandWithPhoto()
    expect((await api.patch(`/api/brands/${brand.id}/assets/${photo.id}`, { label: 'x'.repeat(61) })).status).toBe(400)
    expect((await api.patch(`/api/brands/${brand.id}/assets/${photo.id}`, { sortOrder: -1 })).status).toBe(400)
  })

  it('answers 404 for an asset of another brand and for an unknown asset', async () => {
    const { photo } = await brandWithPhoto()
    const other = await createManual('Other')
    expect((await api.patch(`/api/brands/${other.id}/assets/${photo.id}`, { label: 'x' })).status).toBe(404)
    expect((await api.patch(`/api/brands/${other.id}/assets/ast_nope`, { label: 'x' })).status).toBe(404)
  })

  it('deletes a photo: 204, row and file gone', async () => {
    const { brand, photo } = await brandWithPhoto()
    const path = photo.url.replace('/media/', '')
    expect(existsSync(join(api.mediaDir, path))).toBe(true)

    const res = await api.fetch(`/api/brands/${brand.id}/assets/${photo.id}`, { method: 'DELETE' })
    expect(res.status).toBe(204)
    expect(existsSync(join(api.mediaDir, path))).toBe(false)
    expect((await api.json<Brand>(`/api/brands/${brand.id}`)).body.photos).toHaveLength(0)
  })

  it('answers 404 when deleting an asset of another brand or an unknown one', async () => {
    const { photo } = await brandWithPhoto()
    const other = await createManual('Other')
    expect((await api.fetch(`/api/brands/${other.id}/assets/${photo.id}`, { method: 'DELETE' })).status).toBe(404)
    expect((await api.fetch(`/api/brands/${other.id}/assets/ast_nope`, { method: 'DELETE' })).status).toBe(404)
  })

  it('protects the source PDF from both endpoints', async () => {
    const created = (await api.post('/api/brands', form(
      { source_type: 'pdf' },
      [{ name: 'file', filename: 'k.pdf', type: 'application/pdf', data: pdf() }]
    ))).body as unknown as Brand
    const asset = api.db.select().from(brandAssets).where(eq(brandAssets.brandId, created.id)).get()!

    expect((await api.patch(`/api/brands/${created.id}/assets/${asset.id}`, { label: 'x' })).status).toBe(404)
    expect((await api.fetch(`/api/brands/${created.id}/assets/${asset.id}`, { method: 'DELETE' })).status).toBe(404)
    expect(existsSync(join(api.mediaDir, asset.path))).toBe(true)
  })
})

describe('the whole flow through the real mock n8n', () => {
  it('takes a website brand from extracting to ready', async () => {
    api.useMockPipeline()
    const created = (await api.post('/api/brands', form({ source_type: 'url', url: 'https://example.com' }))).body as unknown as Brand
    expect(created.status).toBe('extracting')

    await expect.poll(async () => (await api.json<Brand>(`/api/brands/${created.id}`)).body.status).toBe('ready')

    const brand = (await api.json<Brand>(`/api/brands/${created.id}`)).body
    expect(brand.name).toBe('Kopi Senja')
    expect(brand.logo).not.toBeNull()
    const logo = await api.fetch(brand.logo!.url)
    expect(logo.status).toBe(200)
    expect(readFileSync(join(api.mediaDir, brand.logo!.url.replace('/media/', ''))).length).toBeGreaterThan(0)
  })

  it('shows a failed brand with the error, then retries it to ready', async () => {
    api.useMockPipeline()
    const created = (await api.post('/api/brands', form({ source_type: 'url', url: 'https://example.com/?x=mock:fail' }))).body as unknown as Brand
    await expect.poll(async () => (await api.json<Brand>(`/api/brands/${created.id}`)).body.status).toBe('failed')

    const failed = (await api.json<Brand>(`/api/brands/${created.id}`)).body
    expect(failed.extraction?.error).toMatch(/mock:fail/)

    // fix the source and take the failed brand over by hand
    const taken = await api.patch(`/api/brands/${created.id}`, { dna: validDna('Isi Manual') })
    expect(taken.body).toMatchObject({ status: 'ready', name: 'Isi Manual' })
  })
})
