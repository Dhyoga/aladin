import { describe, expect, it } from 'vitest'
import { BrandDetail, BrandListItem, PatchAssetBody, PatchBrandBody } from '../../shared/schemas/brand'

const dna = {
  identity: { name: 'Contoh', summary: 'Ringkasan.' },
  audience: { targetAudience: 'Mahasiswa' },
  voice: { toneOfVoice: 'Santai' },
  offer: {},
  visual: {},
  social: {}
}

const asset = {
  id: 'ast_1',
  kind: 'product_photo',
  url: '/media/brands/b/products/ast_1.png',
  mime: 'image/png',
  sizeBytes: 10,
  label: null,
  sortOrder: 0
}

describe('PatchBrandBody', () => {
  it('accepts a valid DNA', () => {
    expect(PatchBrandBody.safeParse({ dna }).success).toBe(true)
  })

  it('rejects an invalid color', () => {
    expect(PatchBrandBody.safeParse({ dna: { ...dna, visual: { colors: ['red'] } } }).success).toBe(false)
  })

  it('rejects a missing dna', () => {
    expect(PatchBrandBody.safeParse({}).success).toBe(false)
  })
})

describe('PatchAssetBody', () => {
  it('accepts a label of 60 characters and rejects 61', () => {
    expect(PatchAssetBody.safeParse({ label: 'x'.repeat(60) }).success).toBe(true)
    expect(PatchAssetBody.safeParse({ label: 'x'.repeat(61) }).success).toBe(false)
  })

  it('accepts null to clear a label', () => {
    expect(PatchAssetBody.parse({ label: null })).toEqual({ label: null })
  })

  it('accepts only non-negative integer sort orders', () => {
    expect(PatchAssetBody.safeParse({ sortOrder: 0 }).success).toBe(true)
    expect(PatchAssetBody.safeParse({ sortOrder: 3 }).success).toBe(true)
    expect(PatchAssetBody.safeParse({ sortOrder: -1 }).success).toBe(false)
    expect(PatchAssetBody.safeParse({ sortOrder: 1.5 }).success).toBe(false)
  })

  it('accepts an empty body (nothing to change)', () => {
    expect(PatchAssetBody.parse({})).toEqual({})
  })
})

describe('BrandDetail', () => {
  const base = {
    id: 'brd_1',
    name: 'Contoh',
    status: 'extracting',
    sourceType: 'url',
    sourceUrl: 'https://example.com',
    dna: null,
    logo: null,
    photos: [],
    extraction: { jobId: 'job_1', status: 'running', stage: 'crawling', error: null },
    createdAt: 1,
    updatedAt: 2
  }

  it('accepts a brand that has no DNA yet', () => {
    expect(BrandDetail.safeParse(base).success).toBe(true)
  })

  it('accepts a ready brand with assets and no extraction', () => {
    const result = BrandDetail.safeParse({
      ...base,
      status: 'ready',
      dna,
      logo: { ...asset, kind: 'logo' },
      photos: [asset],
      extraction: null
    })
    expect(result.success).toBe(true)
  })

  it('rejects an unknown status', () => {
    expect(BrandDetail.safeParse({ ...base, status: 'broken' }).success).toBe(false)
  })
})

describe('BrandListItem', () => {
  it('accepts a brand without logo', () => {
    expect(BrandListItem.safeParse({
      id: 'brd_1', name: 'X', status: 'ready', sourceType: 'manual', logoUrl: null, updatedAt: 1
    }).success).toBe(true)
  })
})
