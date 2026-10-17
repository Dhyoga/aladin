import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { brandAssets, brands } from '../../server/db/schema'
import { useTestDatabase } from './helpers'

const testDb = useTestDatabase()

const brand = (id: string) => ({
  id,
  name: `Brand ${id}`,
  sourceType: 'manual' as const,
  sourceUrl: null,
  sourceAssetId: null,
  dnaJson: null,
  status: 'ready' as const,
  createdAt: 1,
  updatedAt: 1
})

const asset = (id: string, brandId: string) => ({
  id,
  brandId,
  kind: 'product_photo' as const,
  path: `brands/${brandId}/products/${id}.png`,
  mime: 'image/png',
  sizeBytes: 10,
  label: null,
  sortOrder: 0,
  createdAt: 1
})

describe('brand tables', () => {
  it('are created by the migration next to jobs', () => {
    const names = testDb.sqlite
      .prepare("select name from sqlite_master where type in ('table', 'index') order by name")
      .all()
      .map(row => (row as { name: string }).name)

    expect(names).toEqual(expect.arrayContaining([
      'jobs', 'brands', 'brand_assets', 'brand_assets_brand_idx', 'jobs_brand_idx', 'jobs_status_idx'
    ]))
  })

  it('cascade: deleting a brand deletes its assets and only its assets', () => {
    testDb.db.insert(brands).values([brand('b1'), brand('b2')]).run()
    testDb.db.insert(brandAssets).values([asset('a1', 'b1'), asset('a2', 'b1'), asset('a3', 'b2')]).run()

    testDb.db.delete(brands).where(eq(brands.id, 'b1')).run()

    const left = testDb.db.select().from(brandAssets).all().map(row => row.id)
    expect(left).toEqual(['a3'])
  })

  it('foreign key: an asset for a brand that does not exist is rejected', () => {
    expect(() => testDb.db.insert(brandAssets).values(asset('a1', 'ghost')).run()).toThrow(/FOREIGN KEY/i)
  })

  it('sort_order defaults to 0 and label may be null', () => {
    testDb.db.insert(brands).values(brand('b1')).run()
    testDb.sqlite
      .prepare('insert into brand_assets (id, brand_id, kind, path, mime, size_bytes, created_at) values (?,?,?,?,?,?,?)')
      .run('a1', 'b1', 'logo', 'brands/b1/logo-a1.png', 'image/png', 5, 1)

    const row = testDb.db.select().from(brandAssets).get()!
    expect(row).toMatchObject({ sortOrder: 0, label: null })
  })
})
