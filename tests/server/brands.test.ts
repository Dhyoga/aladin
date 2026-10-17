import { chmodSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import { brandAssets, brands, jobs, type BrandRow } from '../../server/db/schema'
import { BrandError, type BrandErrorKind } from '../../server/utils/brand-errors'
import {
  brandNameFromFilename,
  createManualBrand,
  createPdfBrand,
  createUrlBrand,
  deleteBrand,
  getBrandDetail,
  listBrands,
  reExtractBrand,
  updateBrandDna,
  type BrandDeps
} from '../../server/utils/brands'
import { startJob } from '../../server/utils/job-dispatch'
import { failJob, updateStage } from '../../server/utils/jobs'
import type { N8nClient } from '../../server/utils/n8n-client'
import { BrandDNA } from '../../shared/schemas/brand-dna'
import { useTestDatabase, useTestMedia } from './helpers'

const MINUTE = 60_000
const MB = 1024 * 1024
const T0 = 1_800_000_000_000

const testDb = useTestDatabase()
const testMedia = useTestMedia()

const PDF = Buffer.from('%PDF-1.7\n% test pdf\n')

function setup() {
  const clock = { now: T0 }
  const client = { dispatch: vi.fn(async () => {}) }
  const deps: BrandDeps = {
    db: testDb.db,
    mediaDir: testMedia.dir,
    now: () => clock.now,
    dispatch: input => startJob({ db: testDb.db, client: client as unknown as N8nClient, now: () => clock.now }, input)
  }
  return { deps, clock, client }
}

const dnaWith = (name: string) => BrandDNA.parse({
  identity: { name, summary: 'Ringkasan' },
  audience: { targetAudience: 'Mahasiswa' },
  voice: { toneOfVoice: 'Santai' },
  offer: {},
  visual: {},
  social: {}
})

function insertBrand(over: Partial<BrandRow> = {}): BrandRow {
  const row: BrandRow = {
    id: `brd_${Math.random().toString(36).slice(2, 10)}`,
    name: 'Brand',
    sourceType: 'url',
    sourceUrl: 'https://example.com',
    sourceAssetId: null,
    dnaJson: JSON.stringify(dnaWith('Brand')),
    status: 'ready',
    createdAt: T0,
    updatedAt: T0,
    ...over
  }
  testDb.db.insert(brands).values(row).run()
  return row
}

function insertAsset(brandId: string, over: Partial<typeof brandAssets.$inferInsert> = {}) {
  const id = over.id ?? `ast_${Math.random().toString(36).slice(2, 10)}`
  testDb.db.insert(brandAssets).values({
    id,
    brandId,
    kind: 'product_photo',
    path: `brands/${brandId}/products/${id}.png`,
    mime: 'image/png',
    sizeBytes: 1,
    label: null,
    sortOrder: 0,
    createdAt: T0,
    ...over
  }).run()
  return id
}

function expectKind(fn: () => unknown, kind: BrandErrorKind) {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(BrandError)
    expect((error as BrandError).kind).toBe(kind)
    return
  }
  throw new Error(`expected a BrandError of kind ${kind}`)
}

const rejectsWithKind = async (promise: Promise<unknown>, kind: BrandErrorKind) => {
  await expect(promise).rejects.toBeInstanceOf(BrandError)
  await expect(promise).rejects.toMatchObject({ kind })
}

const brandCount = () => testDb.db.select().from(brands).all().length
const jobsOf = (brandId: string) => testDb.db.select().from(jobs).where(eq(jobs.brandId, brandId)).all()

describe('createManualBrand', () => {
  it('creates a ready brand with a valid empty DNA and no job', async () => {
    const { deps } = setup()
    const detail = await createManualBrand(deps, { name: '  Warung Kita  ' })

    expect(detail).toMatchObject({ name: 'Warung Kita', status: 'ready', sourceType: 'manual', extraction: null, logo: null, photos: [] })
    expect(detail.dna?.identity.name).toBe('Warung Kita')
    expect(detail.dna?.audience.targetAudience).toBe('')
    expect(detail.dna?.offer.features).toEqual([])
    expect(testDb.db.select().from(jobs).all()).toHaveLength(0)
  })

  it.each(['', '   ', 'x'.repeat(101)])('rejects the name %j', async (name) => {
    const { deps } = setup()
    await rejectsWithKind(createManualBrand(deps, { name }), 'invalid')
    expect(brandCount()).toBe(0)
  })

  it('accepts a name of exactly 100 characters', async () => {
    const { deps } = setup()
    expect((await createManualBrand(deps, { name: 'x'.repeat(100) })).name).toHaveLength(100)
  })
})

describe('createUrlBrand', () => {
  it('creates an extracting brand named after the host and starts the job', async () => {
    const { deps, client } = setup()
    const detail = await createUrlBrand(deps, { url: 'https://www.kopisenja.example/about' })

    expect(detail).toMatchObject({
      name: 'kopisenja.example',
      status: 'extracting',
      sourceType: 'url',
      sourceUrl: 'https://www.kopisenja.example/about',
      dna: null
    })
    expect(detail.extraction).toMatchObject({ status: 'running', error: null })

    const [job] = jobsOf(detail.id)
    expect(job).toMatchObject({ type: 'brand_extract', brandId: detail.id })
    expect(detail.extraction!.jobId).toBe(job!.id)
    expect(client.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ id: job!.id }),
      { source_type: 'url', url: 'https://www.kopisenja.example/about' }
    )
  })

  it.each(['ftp://example.com', 'javascript:alert(1)', 'not a url', '', 'file:///etc/passwd'])(
    'rejects %j without creating anything',
    async (url) => {
      const { deps } = setup()
      await rejectsWithKind(createUrlBrand(deps, { url }), 'invalid')
      expect(brandCount()).toBe(0)
      expect(testDb.db.select().from(jobs).all()).toHaveLength(0)
    }
  )

  it('shows a failed brand when n8n rejects the job at dispatch', async () => {
    const { deps, client } = setup()
    client.dispatch.mockRejectedValueOnce(new Error('n8n responded 500'))

    const detail = await createUrlBrand(deps, { url: 'https://example.com' })
    expect(detail.status).toBe('failed')
    expect(detail.extraction?.error).toMatch(/^dispatch_failed.*n8n responded 500/)
  })
})

describe('createPdfBrand', () => {
  it('stores the PDF, names the brand after the file and starts the job with the asset id', async () => {
    const { deps, client } = setup()
    const detail = await createPdfBrand(deps, { file: { filename: 'Profil Kopi Senja.pdf', data: PDF } })

    expect(detail).toMatchObject({ name: 'Profil Kopi Senja', status: 'extracting', sourceType: 'pdf', dna: null })

    const [asset] = testDb.db.select().from(brandAssets).where(eq(brandAssets.brandId, detail.id)).all()
    expect(asset).toMatchObject({ kind: 'source_pdf', mime: 'application/pdf', sizeBytes: PDF.length })
    expect(asset!.path).toMatch(new RegExp(`^brands/${detail.id}/source/ast_[\\w-]+\\.pdf$`))
    expect(existsSync(join(testMedia.dir, asset!.path))).toBe(true)
    expect(testDb.db.select().from(brands).where(eq(brands.id, detail.id)).get()!.sourceAssetId).toBe(asset!.id)

    expect(client.dispatch).toHaveBeenCalledWith(expect.anything(), { source_type: 'pdf', pdf_asset_id: asset!.id })
  })

  it('rejects a file that is not a PDF and leaves nothing behind', async () => {
    const { deps } = setup()
    await rejectsWithKind(
      createPdfBrand(deps, { file: { filename: 'x.pdf', data: Buffer.from('<html>not a pdf</html>') } }),
      'invalid'
    )
    expect(brandCount()).toBe(0)
    expect(testDb.db.select().from(brandAssets).all()).toHaveLength(0)
    expect(existsSync(join(testMedia.dir, 'brands'))).toBe(false)
  })

  it('rejects a PDF over 20 MB', async () => {
    const { deps } = setup()
    const big = Buffer.concat([PDF, Buffer.alloc(20 * MB)])
    await rejectsWithKind(createPdfBrand(deps, { file: { filename: 'big.pdf', data: big } }), 'too_large')
    expect(brandCount()).toBe(0)
  })

  it('accepts a PDF of exactly 20 MB', async () => {
    const { deps } = setup()
    const exact = Buffer.concat([PDF, Buffer.alloc(20 * MB - PDF.length)])
    expect((await createPdfBrand(deps, { file: { filename: 'exact.pdf', data: exact } })).status).toBe('extracting')
  })
})

describe('brandNameFromFilename', () => {
  it.each([
    ['Profil Kopi Senja.pdf', 'Profil Kopi Senja'],
    ['../../etc/Laporan.pdf', 'Laporan'],
    ['C:\\temp\\Katalog 2026.PDF', 'Katalog 2026'],
    ['Laporan\u0000\u0007.pdf', 'Laporan'],
    ['.pdf', 'Untitled brand'],
    ['', 'Untitled brand'],
    ['   .pdf', 'Untitled brand'],
    ['no-extension', 'no-extension']
  ])('turns %j into %j', (input, expected) => {
    expect(brandNameFromFilename(input)).toBe(expected)
  })

  it('caps the name at 100 characters', () => {
    expect(brandNameFromFilename(`${'a'.repeat(300)}.pdf`)).toHaveLength(100)
  })
})

describe('status reconciliation', () => {
  it('turns an extracting brand into failed when its job failed, with the job error', async () => {
    const { deps } = setup()
    const { id, extraction } = await createUrlBrand(deps, { url: 'https://example.com' })
    failJob(testDb.db, extraction!.jobId, 'Gemini quota exceeded', T0 + 1000)

    const detail = getBrandDetail(deps, id)
    expect(detail.status).toBe('failed')
    expect(detail.extraction).toMatchObject({ status: 'failed', error: 'Gemini quota exceeded' })
    expect(testDb.db.select().from(brands).where(eq(brands.id, id)).get()!.status).toBe('failed')
  })

  it('fails the brand with timeout when the job ran too long', async () => {
    const { deps, clock } = setup()
    const { id } = await createUrlBrand(deps, { url: 'https://example.com' })

    clock.now = T0 + 6 * MINUTE
    const detail = getBrandDetail(deps, id)
    expect(detail.status).toBe('failed')
    expect(detail.extraction?.error).toBe('timeout')
  })

  it('keeps the brand extracting while the job runs and exposes the stage', async () => {
    const { deps, clock } = setup()
    const { id, extraction } = await createUrlBrand(deps, { url: 'https://example.com' })
    updateStage(testDb.db, extraction!.jobId, 'structuring', T0 + 5)

    clock.now = T0 + MINUTE
    const detail = getBrandDetail(deps, id)
    expect(detail.status).toBe('extracting')
    expect(detail.extraction).toMatchObject({ status: 'running', stage: 'structuring' })
  })

  it('fails an extracting brand without any job after the grace period', () => {
    const { deps } = setup()
    const old = insertBrand({ status: 'extracting', dnaJson: null, createdAt: T0 - 2 * MINUTE })
    expect(getBrandDetail(deps, old.id)).toMatchObject({ status: 'failed', extraction: null })
  })

  it('leaves a brand without a job alone right after creation', () => {
    const { deps } = setup()
    const fresh = insertBrand({ status: 'extracting', dnaJson: null, createdAt: T0 - 5000 })
    expect(getBrandDetail(deps, fresh.id).status).toBe('extracting')
  })

  it('is idempotent: a failed brand stays failed and still shows the job error', async () => {
    const { deps } = setup()
    const { id, extraction } = await createUrlBrand(deps, { url: 'https://example.com' })
    failJob(testDb.db, extraction!.jobId, 'boom', T0 + 1)

    const first = getBrandDetail(deps, id)
    const second = getBrandDetail(deps, id)
    expect(second.status).toBe('failed')
    expect(second.extraction?.error).toBe('boom')
    expect(second.updatedAt).toBe(first.updatedAt)
  })

  it('does not look at jobs of ready brands', async () => {
    const { deps } = setup()
    const ready = insertBrand()
    expect(getBrandDetail(deps, ready.id)).toMatchObject({ status: 'ready', extraction: null })
  })
})

describe('getBrandDetail', () => {
  it('answers not_found for an unknown brand', () => {
    expectKind(() => getBrandDetail(setup().deps, 'brd_missing'), 'not_found')
  })

  it('fails loudly when the stored DNA is corrupt', () => {
    const { deps } = setup()
    const broken = insertBrand({ dnaJson: '{"identity": 1}' })
    expectKind(() => getBrandDetail(deps, broken.id), 'corrupt')

    const notJson = insertBrand({ dnaJson: 'not json' })
    expectKind(() => getBrandDetail(deps, notJson.id), 'corrupt')
  })

  it('returns the logo and the photos in order with media URLs', () => {
    const { deps } = setup()
    const brand = insertBrand()
    const logo = insertAsset(brand.id, { kind: 'logo', path: `brands/${brand.id}/logo-a.png` })
    const third = insertAsset(brand.id, { sortOrder: 2 })
    const first = insertAsset(brand.id, { sortOrder: 0, createdAt: T0 })
    const second = insertAsset(brand.id, { sortOrder: 0, createdAt: T0 + 1 })
    insertAsset(brand.id, { kind: 'source_pdf', path: `brands/${brand.id}/source/x.pdf`, mime: 'application/pdf' })

    const detail = getBrandDetail(deps, brand.id)
    expect(detail.logo).toMatchObject({ id: logo, kind: 'logo', url: `/media/brands/${brand.id}/logo-a.png` })
    expect(detail.photos.map(photo => photo.id)).toEqual([first, second, third])
    expect(detail.extraction).toBeNull()
  })
})

describe('listBrands', () => {
  it('is empty without brands', () => {
    expect(listBrands(setup().deps)).toEqual([])
  })

  it('lists newest first with the logo url', () => {
    const { deps } = setup()
    const older = insertBrand({ name: 'Older', createdAt: T0 })
    const newer = insertBrand({ name: 'Newer', createdAt: T0 + 10 })
    insertAsset(older.id, { kind: 'logo', path: `brands/${older.id}/logo-a.png` })

    const list = listBrands(deps)
    expect(list.map(item => item.name)).toEqual(['Newer', 'Older'])
    expect(list[0]).toMatchObject({ id: newer.id, logoUrl: null, status: 'ready', sourceType: 'url' })
    expect(list[1]!.logoUrl).toBe(`/media/brands/${older.id}/logo-a.png`)
  })

  it('reconciles extracting brands', async () => {
    const { deps } = setup()
    const { id, extraction } = await createUrlBrand(deps, { url: 'https://example.com' })
    failJob(testDb.db, extraction!.jobId, 'boom', T0 + 1)

    expect(listBrands(deps).find(item => item.id === id)!.status).toBe('failed')
  })
})

describe('updateBrandDna', () => {
  it('replaces the DNA, syncs the name and refreshes updated_at', () => {
    const { deps, clock } = setup()
    const brand = insertBrand({ name: 'Lama' })

    clock.now = T0 + 5000
    const detail = updateBrandDna(deps, brand.id, dnaWith('Nama Baru'))

    expect(detail).toMatchObject({ name: 'Nama Baru', status: 'ready', updatedAt: T0 + 5000 })
    expect(detail.dna?.identity.name).toBe('Nama Baru')
    expect(testDb.db.select().from(brands).where(eq(brands.id, brand.id)).get()!.name).toBe('Nama Baru')
  })

  it('answers conflict while the brand is extracting', async () => {
    const { deps } = setup()
    const { id } = await createUrlBrand(deps, { url: 'https://example.com' })
    expectKind(() => updateBrandDna(deps, id, dnaWith('X')), 'conflict')
    expect(getBrandDetail(deps, id)).toMatchObject({ status: 'extracting', dna: null })
  })

  it('lets the user take over a failed brand', async () => {
    const { deps } = setup()
    const { id, extraction } = await createUrlBrand(deps, { url: 'https://example.com' })
    failJob(testDb.db, extraction!.jobId, 'boom', T0 + 1)

    const detail = updateBrandDna(deps, id, dnaWith('Diisi Manual'))
    expect(detail).toMatchObject({ status: 'ready', name: 'Diisi Manual', extraction: null })
  })

  it('reconciles first, so a brand whose job failed is editable right away', async () => {
    const { deps, clock } = setup()
    const { id } = await createUrlBrand(deps, { url: 'https://example.com' })

    clock.now = T0 + 6 * MINUTE // job timed out, but nobody has read the brand since
    expect(updateBrandDna(deps, id, dnaWith('Tetap Bisa')).status).toBe('ready')
  })

  it('answers not_found for an unknown brand', () => {
    expectKind(() => updateBrandDna(setup().deps, 'brd_missing', dnaWith('X')), 'not_found')
  })
})

describe('reExtractBrand', () => {
  it('starts a new job, sets the status and keeps the old DNA', async () => {
    const { deps, client } = setup()
    const brand = insertBrand({ sourceUrl: 'https://example.com' })
    const before = brand.dnaJson

    const detail = await reExtractBrand(deps, brand.id)

    expect(detail.status).toBe('extracting')
    expect(detail.extraction).toMatchObject({ status: 'running' })
    expect(jobsOf(brand.id)).toHaveLength(1)
    expect(testDb.db.select().from(brands).where(eq(brands.id, brand.id)).get()!.dnaJson).toBe(before)
    expect(client.dispatch).toHaveBeenCalledWith(expect.anything(), { source_type: 'url', url: 'https://example.com' })
  })

  it('lets only one of two quick requests through', async () => {
    const { deps } = setup()
    const brand = insertBrand()

    await reExtractBrand(deps, brand.id)
    await rejectsWithKind(reExtractBrand(deps, brand.id), 'conflict')
    expect(jobsOf(brand.id)).toHaveLength(1)
  })

  it('refuses a manual brand', async () => {
    const { deps } = setup()
    const manual = await createManualBrand(deps, { name: 'Manual' })
    await rejectsWithKind(reExtractBrand(deps, manual.id), 'invalid')
    expect(jobsOf(manual.id)).toHaveLength(0)
  })

  it('retries a failed PDF brand with the id of its source PDF', async () => {
    const { deps, client } = setup()
    const created = await createPdfBrand(deps, { file: { filename: 'katalog.pdf', data: PDF } })
    failJob(testDb.db, created.extraction!.jobId, 'boom', T0 + 1)
    const asset = testDb.db.select().from(brandAssets).where(eq(brandAssets.brandId, created.id)).get()!

    const detail = await reExtractBrand(deps, created.id)

    expect(detail.status).toBe('extracting')
    expect(client.dispatch).toHaveBeenLastCalledWith(expect.anything(), { source_type: 'pdf', pdf_asset_id: asset.id })
    expect(jobsOf(created.id)).toHaveLength(2)
  })

  it('retries a brand whose job already timed out without anyone reading it', async () => {
    const { deps, clock } = setup()
    const { id } = await createUrlBrand(deps, { url: 'https://example.com' })

    clock.now = T0 + 6 * MINUTE
    expect((await reExtractBrand(deps, id)).status).toBe('extracting')
    expect(jobsOf(id)).toHaveLength(2)
  })

  it('refuses a URL brand that lost its source and leaves the status alone', async () => {
    const { deps } = setup()
    const broken = insertBrand({ sourceUrl: null })
    await rejectsWithKind(reExtractBrand(deps, broken.id), 'invalid')
    expect(getBrandDetail(deps, broken.id).status).toBe('ready')
  })

  it('answers not_found for an unknown brand', async () => {
    await rejectsWithKind(reExtractBrand(setup().deps, 'brd_missing'), 'not_found')
  })
})

describe('deleteBrand', () => {
  it('removes the rows, the assets and the folder, but not the jobs', async () => {
    const { deps } = setup()
    const created = await createPdfBrand(deps, { file: { filename: 'katalog.pdf', data: PDF } })
    expect(existsSync(join(testMedia.dir, 'brands', created.id))).toBe(true)

    await deleteBrand(deps, created.id)

    expect(brandCount()).toBe(0)
    expect(testDb.db.select().from(brandAssets).all()).toHaveLength(0)
    expect(existsSync(join(testMedia.dir, 'brands', created.id))).toBe(false)
    expect(jobsOf(created.id)).toHaveLength(1)
  })

  it('leaves other brands and their files alone', async () => {
    const { deps } = setup()
    const a = await createPdfBrand(deps, { file: { filename: 'a.pdf', data: PDF } })
    const b = await createPdfBrand(deps, { file: { filename: 'b.pdf', data: PDF } })

    await deleteBrand(deps, a.id)

    expect(readdirSync(join(testMedia.dir, 'brands'))).toEqual([b.id])
    expect(getBrandDetail(deps, b.id).name).toBe('b')
  })

  it('does not fail when the files cannot be removed', async () => {
    const { deps } = setup()
    const created = await createPdfBrand(deps, { file: { filename: 'katalog.pdf', data: PDF } })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const parent = join(testMedia.dir, 'brands')

    chmodSync(parent, 0o555) // makes removing a child fail (unless the tests run as root)
    try {
      await expect(deleteBrand(deps, created.id)).resolves.toBeUndefined()
    } finally {
      chmodSync(parent, 0o755)
      warn.mockRestore()
    }
    expect(brandCount()).toBe(0)
  })

  it('answers not_found for an unknown brand', async () => {
    await rejectsWithKind(deleteBrand(setup().deps, 'brd_missing'), 'not_found')
  })
})
