import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import { brandAssets, brands, type BrandRow } from '../../server/db/schema'
import { createBrandExtractHandler } from '../../server/utils/brand-extraction'
import { applyJobCallback, type ParsedCallback } from '../../server/utils/job-callback'
import { createHandlerRegistry, type CallbackFile } from '../../server/utils/job-handlers'
import { createJob, getJob, markRunning } from '../../server/utils/jobs'
import { saveMediaFile } from '../../server/utils/media-storage'
import { BrandDNA } from '../../shared/schemas/brand-dna'
import { useTestDatabase, useTestMedia } from './helpers'

const MB = 1024 * 1024
const T0 = 1_800_000_000_000

const testDb = useTestDatabase()
const testMedia = useTestMedia()

const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const png = (size = 64) => Buffer.concat([PNG_HEAD, Buffer.alloc(size - PNG_HEAD.length, 1)])

const dna = (name: string, extra: Record<string, unknown> = {}) => BrandDNA.parse({
  identity: { name, summary: `Tentang ${name}`, ...extra },
  audience: { targetAudience: 'Mahasiswa' },
  voice: { toneOfVoice: 'Santai' },
  offer: {},
  visual: {},
  social: {}
})

const logoFile = (data: Buffer): CallbackFile => ({ field: 'logo', filename: 'logo.png', mime: 'image/png', data })

function setup(brandOver: Partial<BrandRow> = {}, { withBrandOnJob = true } = {}) {
  const brand: BrandRow = {
    id: 'brd_test',
    name: 'host.example',
    sourceType: 'url',
    sourceUrl: 'https://host.example',
    sourceAssetId: null,
    dnaJson: null,
    status: 'extracting',
    createdAt: T0,
    updatedAt: T0,
    ...brandOver
  }
  testDb.db.insert(brands).values(brand).run()

  const job = createJob(testDb.db, { type: 'brand_extract', brandId: withBrandOnJob ? brand.id : null }, T0)
  markRunning(testDb.db, job.id, T0)

  const registry = createHandlerRegistry()
  registry.register('brand_extract', createBrandExtractHandler({ db: testDb.db, mediaDir: testMedia.dir, now: () => T0 + 1000 }))

  const complete = (payload: object, files: ParsedCallback['files'] = {}) =>
    applyJobCallback(
      { db: testDb.db, registry, now: () => T0 + 1000 },
      { jobId: job.id, event: 'completed', payload: JSON.stringify(payload), files }
    )

  const brandRow = () => testDb.db.select().from(brands).where(eq(brands.id, brand.id)).get()
  const logos = () => testDb.db.select().from(brandAssets).where(eq(brandAssets.brandId, brand.id)).all().filter(a => a.kind === 'logo')
  const brandFolder = () => join(testMedia.dir, 'brands', brand.id)

  return { brand, job, registry, complete, brandRow, logos, brandFolder }
}

describe('brand_extract result handler', () => {
  it('stores the DNA, syncs the name and marks the brand ready', async () => {
    const { complete, brandRow, job } = setup()
    await complete({ brand_dna: dna('Kopi Senja') })

    expect(brandRow()).toMatchObject({ name: 'Kopi Senja', status: 'ready', updatedAt: T0 + 1000 })
    expect(JSON.parse(brandRow()!.dnaJson!).identity.name).toBe('Kopi Senja')
    expect(getJob(testDb.db, job.id)!.status).toBe('completed')
  })

  it('replaces a previous DNA in full', async () => {
    const old = dna('Lama', { tagline: 'tagline lama' })
    const { complete, brandRow } = setup({ dnaJson: JSON.stringify(old) })

    await complete({ brand_dna: dna('Baru') })

    const stored = JSON.parse(brandRow()!.dnaJson!)
    expect(stored.identity.name).toBe('Baru')
    expect(stored.identity.tagline).toBeUndefined()
  })

  it('fills the website from the source URL when the result has none', async () => {
    const { complete, brandRow } = setup()
    await complete({ brand_dna: dna('Kopi Senja') })
    expect(JSON.parse(brandRow()!.dnaJson!).identity.website).toBe('https://host.example')
  })

  it('keeps a website that was extracted', async () => {
    const { complete, brandRow } = setup()
    await complete({ brand_dna: dna('Kopi Senja', { website: 'https://other.example' }) })
    expect(JSON.parse(brandRow()!.dnaJson!).identity.website).toBe('https://other.example')
  })

  it('leaves the website empty for a PDF brand without a source URL', async () => {
    const { complete, brandRow } = setup({ sourceType: 'pdf', sourceUrl: null })
    await complete({ brand_dna: dna('Dari PDF') })
    expect(JSON.parse(brandRow()!.dnaJson!).identity.website).toBeUndefined()
  })
})

describe('brand_extract result handler: logo', () => {
  it('saves a valid logo when the brand has none', async () => {
    const { complete, logos, brandFolder, brand } = setup()
    await complete({ brand_dna: dna('Kopi Senja') }, { logo: logoFile(png(80)) })

    const [logo] = logos()
    expect(logo).toMatchObject({ kind: 'logo', mime: 'image/png', sizeBytes: 80 })
    expect(logo!.path).toMatch(new RegExp(`^brands/${brand.id}/logo-ast_[\\w-]+\\.png$`))
    expect(existsSync(join(testMedia.dir, logo!.path))).toBe(true)
    expect(readdirSync(brandFolder())).toHaveLength(1)
  })

  it('never replaces a logo the brand already has', async () => {
    const { complete, logos, brand, brandRow } = setup()
    const existingPath = `brands/${brand.id}/logo-ast_user.png`
    await saveMediaFile(testMedia.dir, existingPath, png(10))
    testDb.db.insert(brandAssets).values({
      id: 'ast_user', brandId: brand.id, kind: 'logo', path: existingPath, mime: 'image/png',
      sizeBytes: 10, label: null, sortOrder: 0, createdAt: T0
    }).run()

    await complete({ brand_dna: dna('Kopi Senja') }, { logo: logoFile(png(99)) })

    expect(logos().map(a => a.id)).toEqual(['ast_user'])
    expect(readdirSync(join(testMedia.dir, 'brands', brand.id))).toEqual(['logo-ast_user.png'])
    expect(brandRow()!.status).toBe('ready')
  })

  it('ignores a logo that is not an image, warns, and still completes the extraction', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { complete, logos, brandRow, brandFolder } = setup()

    await complete({ brand_dna: dna('Kopi Senja') }, { logo: logoFile(Buffer.from('<html>nope</html>')) })

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ignoring the extracted logo'))
    warn.mockRestore()
    expect(logos()).toHaveLength(0)
    expect(existsSync(brandFolder())).toBe(false)
    expect(brandRow()!.status).toBe('ready')
  })

  it('is stopped by the pipeline before the handler when the logo is over 10 MB', async () => {
    // The callback limit for `logo` (10 MB) fails the job with invalid_payload, so the
    // handler is never called; the brand is then reported as failed when it is read.
    const { complete, logos, brandRow, job } = setup()

    await complete({ brand_dna: dna('Kopi Senja') }, { logo: logoFile(png(10 * MB + 1)) })

    expect(getJob(testDb.db, job.id)!.error).toMatch(/^invalid_payload.*"logo"/)
    expect(logos()).toHaveLength(0)
    expect(brandRow()!.status).toBe('extracting') // reconciled to failed on the next read
  })

  it('also ignores an oversized logo when the handler is called directly (second line of defense)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { brand, job, logos, brandRow } = setup()
    const handler = createBrandExtractHandler({ db: testDb.db, mediaDir: testMedia.dir })

    await handler.onCompleted({
      job: getJob(testDb.db, job.id)!,
      stage: undefined,
      payload: { brand_dna: dna('Kopi Senja') },
      files: { logo: logoFile(png(10 * MB + 1)) }
    })
    warn.mockRestore()

    expect(logos()).toHaveLength(0)
    expect(brandRow()).toMatchObject({ id: brand.id, status: 'ready' })
  })

  it('completes without a logo file', async () => {
    const { complete, logos, brandRow } = setup()
    await complete({ brand_dna: dna('Kopi Senja') })
    expect(logos()).toHaveLength(0)
    expect(brandRow()!.status).toBe('ready')
  })
})

describe('brand_extract result handler: errors fail the job', () => {
  it('fails when the brand was deleted while extracting', async () => {
    const { complete, job, brand } = setup()
    testDb.db.delete(brands).where(eq(brands.id, brand.id)).run()

    await complete({ brand_dna: dna('Kopi Senja') })
    expect(getJob(testDb.db, job.id)).toMatchObject({ status: 'failed' })
    expect(getJob(testDb.db, job.id)!.error).toMatch(/^handler_failed.*brand not found/)
  })

  it('fails and changes nothing when the brand is not extracting', async () => {
    const stored = JSON.stringify(dna('Handmade'))
    const { complete, job, brandRow, logos } = setup({ status: 'ready', dnaJson: stored, name: 'Handmade' })

    await complete({ brand_dna: dna('Kopi Senja') }, { logo: logoFile(png()) })

    expect(getJob(testDb.db, job.id)!.error).toMatch(/^handler_failed.*no longer extracting/)
    expect(brandRow()).toMatchObject({ name: 'Handmade', dnaJson: stored, status: 'ready' })
    expect(logos()).toHaveLength(0)
  })

  it('fails when the job is not linked to a brand', async () => {
    const { complete, job } = setup({}, { withBrandOnJob: false })
    await complete({ brand_dna: dna('Kopi Senja') })
    expect(getJob(testDb.db, job.id)!.error).toMatch(/^handler_failed.*no brand/)
  })

  it('leaves no logo file behind when the brand stops extracting while the logo is being written', async () => {
    const { brand, job, brandRow, brandFolder } = setup()
    const handler = createBrandExtractHandler({ db: testDb.db, mediaDir: testMedia.dir })

    // The handler runs up to its first await (writing the logo); flip the brand before it resumes.
    const pending = handler.onCompleted({
      job: getJob(testDb.db, job.id)!,
      stage: undefined,
      payload: { brand_dna: dna('Kopi Senja') },
      files: { logo: logoFile(png()) }
    })
    testDb.db.update(brands).set({ status: 'ready' }).where(eq(brands.id, brand.id)).run()

    await expect(pending).rejects.toThrow(/no longer extracting/)
    expect(brandRow()!.status).toBe('ready')
    expect(existsSync(brandFolder()) ? readdirSync(brandFolder()) : []).toEqual([])
  })

  it('discards the extracted logo when the user uploaded one while it was being written', async () => {
    const { brand, job, logos } = setup()
    const handler = createBrandExtractHandler({ db: testDb.db, mediaDir: testMedia.dir })

    const pending = handler.onCompleted({
      job: getJob(testDb.db, job.id)!,
      stage: undefined,
      payload: { brand_dna: dna('Kopi Senja') },
      files: { logo: logoFile(png()) }
    })
    const userPath = `brands/${brand.id}/logo-ast_user.png`
    testDb.db.insert(brandAssets).values({
      id: 'ast_user', brandId: brand.id, kind: 'logo', path: userPath, mime: 'image/png',
      sizeBytes: 1, label: null, sortOrder: 0, createdAt: T0
    }).run()
    await saveMediaFile(testMedia.dir, userPath, png(10))

    await pending

    expect(logos().map(a => a.id)).toEqual(['ast_user'])
    expect(readdirSync(join(testMedia.dir, 'brands', brand.id))).toEqual(['logo-ast_user.png'])
  })
})
