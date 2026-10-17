import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import { brandAssets, brands } from '../../server/db/schema'
import { BrandError, type BrandErrorKind } from '../../server/utils/brand-errors'
import { addBrandAssets, deleteBrandAsset, updateBrandAsset } from '../../server/utils/brand-assets'
import { getBrandDetail, type BrandDeps } from '../../server/utils/brands'
import { BrandDNA } from '../../shared/schemas/brand-dna'
import { MAX_PRODUCT_PHOTOS } from '../../shared/schemas/brand'
import { useTestDatabase, useTestMedia } from './helpers'

const MB = 1024 * 1024
const T0 = 1_800_000_000_000

const testDb = useTestDatabase()
const testMedia = useTestMedia()

const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0])
const WEBP_HEAD = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBPVP8 ')])

const image = (head = PNG_HEAD, size = 64, fill = 7) => ({
  data: Buffer.concat([head, Buffer.alloc(Math.max(size - head.length, 0), fill)])
})
const html = () => ({ data: Buffer.from('<html><body>not an image</body></html>') })

const deps = (): BrandDeps => ({
  db: testDb.db,
  mediaDir: testMedia.dir,
  now: () => T0,
  dispatch: () => Promise.reject(new Error('not used in these tests'))
})

function makeBrand(): string {
  const id = `brd_${Math.random().toString(36).slice(2, 10)}`
  testDb.db.insert(brands).values({
    id,
    name: 'Brand',
    sourceType: 'manual',
    sourceUrl: null,
    sourceAssetId: null,
    dnaJson: JSON.stringify(BrandDNA.parse({
      identity: { name: 'Brand', summary: '' },
      audience: { targetAudience: '' },
      voice: { toneOfVoice: '' },
      offer: {},
      visual: {},
      social: {}
    })),
    status: 'ready',
    createdAt: T0,
    updatedAt: T0
  }).run()
  return id
}

const assetRows = (brandId: string) => testDb.db.select().from(brandAssets).where(eq(brandAssets.brandId, brandId)).all()
const productsDir = (brandId: string) => join(testMedia.dir, 'brands', brandId, 'products')

async function rejectsWith(promise: Promise<unknown>, kind: BrandErrorKind) {
  await expect(promise).rejects.toBeInstanceOf(BrandError)
  await expect(promise).rejects.toMatchObject({ kind })
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

describe('addBrandAssets: photos', () => {
  it('stores several photos with generated paths, detected mime and sizes', async () => {
    const brandId = makeBrand()
    const created = await addBrandAssets(deps(), brandId, 'product_photo', [
      image(PNG_HEAD, 100),
      image(JPEG_HEAD, 200),
      image(WEBP_HEAD, 300)
    ])

    expect(created.map(a => [a.kind, a.mime, a.sizeBytes])).toEqual([
      ['product_photo', 'image/png', 100],
      ['product_photo', 'image/jpeg', 200],
      ['product_photo', 'image/webp', 300]
    ])
    for (const asset of created) {
      expect(asset.url).toMatch(new RegExp(`^/media/brands/${brandId}/products/ast_[\\w-]+\\.(png|jpg|webp)$`))
      expect(existsSync(join(testMedia.dir, asset.url.replace('/media/', '')))).toBe(true)
    }
    expect(created.map(a => a.url.split('.').pop())).toEqual(['png', 'jpg', 'webp'])
  })

  it('takes the extension and mime from the content, not from the client', async () => {
    const brandId = makeBrand()
    // the client calls it picture.png, but it is a JPEG; the name is never even passed in
    const [asset] = await addBrandAssets(deps(), brandId, 'product_photo', [image(JPEG_HEAD)])
    expect(asset).toMatchObject({ mime: 'image/jpeg' })
    expect(asset!.url.endsWith('.jpg')).toBe(true)
  })

  it('writes the exact bytes that were uploaded', async () => {
    const brandId = makeBrand()
    const file = image(PNG_HEAD, 500, 42)
    const [asset] = await addBrandAssets(deps(), brandId, 'product_photo', [file])
    expect(readFileSync(join(testMedia.dir, asset!.url.replace('/media/', ''))).equals(file.data)).toBe(true)
  })

  it('rejects a file that only pretends to be an image, and stores nothing', async () => {
    const brandId = makeBrand()
    await rejectsWith(addBrandAssets(deps(), brandId, 'product_photo', [html()]), 'invalid')
    expect(assetRows(brandId)).toHaveLength(0)
    expect(existsSync(productsDir(brandId))).toBe(false)
  })

  it('rejects a PDF as a photo', async () => {
    const brandId = makeBrand()
    await rejectsWith(addBrandAssets(deps(), brandId, 'product_photo', [{ data: Buffer.from('%PDF-1.7\nx') }]), 'invalid')
  })

  it('rejects an image over 10 MB but accepts exactly 10 MB', async () => {
    const brandId = makeBrand()
    await rejectsWith(addBrandAssets(deps(), brandId, 'product_photo', [image(PNG_HEAD, 10 * MB + 1)]), 'too_large')
    expect(assetRows(brandId)).toHaveLength(0)

    const created = await addBrandAssets(deps(), brandId, 'product_photo', [image(PNG_HEAD, 10 * MB)])
    expect(created[0]!.sizeBytes).toBe(10 * MB)
  })

  it('is all-or-nothing: one bad file among good ones stores nothing', async () => {
    const brandId = makeBrand()
    await rejectsWith(
      addBrandAssets(deps(), brandId, 'product_photo', [image(), html(), image()]),
      'invalid'
    )
    expect(assetRows(brandId)).toHaveLength(0)
    expect(existsSync(productsDir(brandId))).toBe(false)
  })

  it('refuses an empty upload', async () => {
    const brandId = makeBrand()
    await rejectsWith(addBrandAssets(deps(), brandId, 'product_photo', []), 'invalid')
  })

  it('answers not_found for an unknown brand', async () => {
    await rejectsWith(addBrandAssets(deps(), 'brd_missing', 'product_photo', [image()]), 'not_found')
  })

  it('appends sort orders in upload order across requests', async () => {
    const brandId = makeBrand()
    const first = await addBrandAssets(deps(), brandId, 'product_photo', [image(), image()])
    const second = await addBrandAssets(deps(), brandId, 'product_photo', [image()])

    expect([...first, ...second].map(a => a.sortOrder)).toEqual([0, 1, 2])
    expect(getBrandDetail(deps(), brandId).photos.map(p => p.id)).toEqual([...first, ...second].map(a => a.id))
  })
})

describe('addBrandAssets: photo limit', () => {
  const fillPhotos = (brandId: string, count: number) => {
    for (let i = 0; i < count; i++) {
      testDb.db.insert(brandAssets).values({
        id: `ast_seed_${brandId}_${i}`,
        brandId,
        kind: 'product_photo',
        path: `brands/${brandId}/products/seed-${i}.png`,
        mime: 'image/png',
        sizeBytes: 1,
        label: null,
        sortOrder: i,
        createdAt: T0
      }).run()
    }
  }

  it('allows going exactly to the limit', async () => {
    const brandId = makeBrand()
    fillPhotos(brandId, MAX_PRODUCT_PHOTOS - 1)
    await addBrandAssets(deps(), brandId, 'product_photo', [image()])
    expect(assetRows(brandId)).toHaveLength(MAX_PRODUCT_PHOTOS)
  })

  it('rejects an upload that would exceed the limit, storing none of it', async () => {
    const brandId = makeBrand()
    fillPhotos(brandId, MAX_PRODUCT_PHOTOS - 1)
    await rejectsWith(addBrandAssets(deps(), brandId, 'product_photo', [image(), image()]), 'invalid')
    expect(assetRows(brandId)).toHaveLength(MAX_PRODUCT_PHOTOS - 1)
    expect(existsSync(productsDir(brandId))).toBe(false)
  })

  it('does not count the logo towards the photo limit', async () => {
    const brandId = makeBrand()
    fillPhotos(brandId, MAX_PRODUCT_PHOTOS - 1)
    await addBrandAssets(deps(), brandId, 'logo', [image()])
    await addBrandAssets(deps(), brandId, 'product_photo', [image()])
    expect(assetRows(brandId)).toHaveLength(MAX_PRODUCT_PHOTOS + 1)
  })

  it('holds under two concurrent uploads that each pass the early check', async () => {
    const brandId = makeBrand()
    const eleven = () => Array.from({ length: 11 }, () => image())

    const results = await Promise.allSettled([
      addBrandAssets(deps(), brandId, 'product_photo', eleven()),
      addBrandAssets(deps(), brandId, 'product_photo', eleven())
    ])

    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1)
    expect(assetRows(brandId)).toHaveLength(11)
    // the losing request left no files behind
    expect(readdirSync(productsDir(brandId))).toHaveLength(11)
  })
})

describe('addBrandAssets: logo', () => {
  it('stores the logo under a generated path', async () => {
    const brandId = makeBrand()
    const [logo] = await addBrandAssets(deps(), brandId, 'logo', [image(PNG_HEAD, 80)])
    expect(logo).toMatchObject({ kind: 'logo', mime: 'image/png', sizeBytes: 80 })
    expect(logo!.url).toMatch(new RegExp(`^/media/brands/${brandId}/logo-ast_[\\w-]+\\.png$`))
  })

  it('refuses more than one file for a logo and stores nothing', async () => {
    const brandId = makeBrand()
    await rejectsWith(addBrandAssets(deps(), brandId, 'logo', [image(), image()]), 'invalid')
    expect(assetRows(brandId)).toHaveLength(0)
  })

  it('replaces the existing logo: one row, new file only', async () => {
    const brandId = makeBrand()
    const [first] = await addBrandAssets(deps(), brandId, 'logo', [image(PNG_HEAD, 50)])
    const [second] = await addBrandAssets(deps(), brandId, 'logo', [image(JPEG_HEAD, 60)])

    const logos = assetRows(brandId).filter(a => a.kind === 'logo')
    expect(logos.map(a => a.id)).toEqual([second!.id])
    expect(existsSync(join(testMedia.dir, first!.url.replace('/media/', '')))).toBe(false)
    expect(existsSync(join(testMedia.dir, second!.url.replace('/media/', '')))).toBe(true)
    expect(getBrandDetail(deps(), brandId).logo?.id).toBe(second!.id)
  })

  it('keeps the old logo when the new one is invalid', async () => {
    const brandId = makeBrand()
    const [first] = await addBrandAssets(deps(), brandId, 'logo', [image()])
    await rejectsWith(addBrandAssets(deps(), brandId, 'logo', [html()]), 'invalid')
    expect(assetRows(brandId).map(a => a.id)).toEqual([first!.id])
    expect(existsSync(join(testMedia.dir, first!.url.replace('/media/', '')))).toBe(true)
  })

  it('does not touch photos when the logo changes', async () => {
    const brandId = makeBrand()
    await addBrandAssets(deps(), brandId, 'product_photo', [image(), image()])
    await addBrandAssets(deps(), brandId, 'logo', [image()])
    await addBrandAssets(deps(), brandId, 'logo', [image()])
    expect(assetRows(brandId).filter(a => a.kind === 'product_photo')).toHaveLength(2)
  })
})

describe('updateBrandAsset', () => {
  it('sets a label and leaves other fields alone', async () => {
    const brandId = makeBrand()
    const [photo] = await addBrandAssets(deps(), brandId, 'product_photo', [image(), image()])

    const updated = updateBrandAsset(deps(), brandId, photo!.id, { label: 'botol depan' })
    expect(updated).toEqual({ ...photo, label: 'botol depan' })
  })

  it('clears a label with null and changes the sort order independently', async () => {
    const brandId = makeBrand()
    const [photo] = await addBrandAssets(deps(), brandId, 'product_photo', [image()])
    updateBrandAsset(deps(), brandId, photo!.id, { label: 'x' })

    expect(updateBrandAsset(deps(), brandId, photo!.id, { label: null }).label).toBeNull()
    const moved = updateBrandAsset(deps(), brandId, photo!.id, { sortOrder: 9 })
    expect(moved).toMatchObject({ sortOrder: 9, label: null })
  })

  it('treats an empty patch as a no-op', async () => {
    const brandId = makeBrand()
    const [photo] = await addBrandAssets(deps(), brandId, 'product_photo', [image()])
    expect(updateBrandAsset(deps(), brandId, photo!.id, {})).toEqual(photo)
  })

  it('reorders the detail listing', async () => {
    const brandId = makeBrand()
    const [a, b] = await addBrandAssets(deps(), brandId, 'product_photo', [image(), image()])
    updateBrandAsset(deps(), brandId, a!.id, { sortOrder: 5 })
    expect(getBrandDetail(deps(), brandId).photos.map(p => p.id)).toEqual([b!.id, a!.id])
  })

  it('answers not_found for an asset of another brand', async () => {
    const mine = makeBrand()
    const other = makeBrand()
    const [photo] = await addBrandAssets(deps(), mine, 'product_photo', [image()])
    expectKind(() => updateBrandAsset(deps(), other, photo!.id, { label: 'x' }), 'not_found')
  })

  it('answers not_found for an unknown asset and for the source PDF', async () => {
    const brandId = makeBrand()
    testDb.db.insert(brandAssets).values({
      id: 'ast_pdf', brandId, kind: 'source_pdf', path: `brands/${brandId}/source/ast_pdf.pdf`,
      mime: 'application/pdf', sizeBytes: 1, label: null, sortOrder: 0, createdAt: T0
    }).run()

    expectKind(() => updateBrandAsset(deps(), brandId, 'ast_nope', { label: 'x' }), 'not_found')
    expectKind(() => updateBrandAsset(deps(), brandId, 'ast_pdf', { label: 'x' }), 'not_found')
  })
})

describe('deleteBrandAsset', () => {
  it('removes the row and the file', async () => {
    const brandId = makeBrand()
    const [photo, keep] = await addBrandAssets(deps(), brandId, 'product_photo', [image(), image()])

    await deleteBrandAsset(deps(), brandId, photo!.id)

    expect(assetRows(brandId).map(a => a.id)).toEqual([keep!.id])
    expect(existsSync(join(testMedia.dir, photo!.url.replace('/media/', '')))).toBe(false)
    expect(existsSync(join(testMedia.dir, keep!.url.replace('/media/', '')))).toBe(true)
  })

  it('can delete the logo', async () => {
    const brandId = makeBrand()
    const [logo] = await addBrandAssets(deps(), brandId, 'logo', [image()])
    await deleteBrandAsset(deps(), brandId, logo!.id)
    expect(getBrandDetail(deps(), brandId).logo).toBeNull()
  })

  it('still succeeds when the file is already gone', async () => {
    const brandId = makeBrand()
    const [photo] = await addBrandAssets(deps(), brandId, 'product_photo', [image()])
    await import('node:fs/promises').then(fs => fs.rm(join(testMedia.dir, photo!.url.replace('/media/', ''))))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(deleteBrandAsset(deps(), brandId, photo!.id)).resolves.toBeUndefined()
    warn.mockRestore()
    expect(assetRows(brandId)).toHaveLength(0)
  })

  it('answers not_found for another brand, an unknown id and the source PDF, and deletes nothing', async () => {
    const mine = makeBrand()
    const other = makeBrand()
    const [photo] = await addBrandAssets(deps(), mine, 'product_photo', [image()])
    testDb.db.insert(brandAssets).values({
      id: 'ast_pdf', brandId: mine, kind: 'source_pdf', path: `brands/${mine}/source/ast_pdf.pdf`,
      mime: 'application/pdf', sizeBytes: 1, label: null, sortOrder: 0, createdAt: T0
    }).run()

    await rejectsWith(deleteBrandAsset(deps(), other, photo!.id), 'not_found')
    await rejectsWith(deleteBrandAsset(deps(), mine, 'ast_nope'), 'not_found')
    await rejectsWith(deleteBrandAsset(deps(), mine, 'ast_pdf'), 'not_found')
    expect(assetRows(mine)).toHaveLength(2)
  })
})
