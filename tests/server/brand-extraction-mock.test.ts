import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { createBrandExtractHandler } from '../../server/utils/brand-extraction'
import { createPdfBrand, createUrlBrand, getBrandDetail, type BrandDeps } from '../../server/utils/brands'
import { startJob } from '../../server/utils/job-dispatch'
import { applyJobCallback } from '../../server/utils/job-callback'
import { createHandlerRegistry } from '../../server/utils/job-handlers'
import { createN8nClient } from '../../server/utils/n8n-client'
import { createFixtureLoader, createMockRunner } from '../../server/utils/n8n-mock'
import { useTestDatabase, useTestMedia } from './helpers'

const testDb = useTestDatabase()
const testMedia = useTestMedia()

const loadFixture = createFixtureLoader(fileURLToPath(new URL('../../server/fixtures', import.meta.url)))
const PDF = Buffer.from('%PDF-1.7\n% mock\n')

/** The real pipeline end to end: mock n8n, real callback core, real brand handler, real service. */
function setup() {
  const registry = createHandlerRegistry()
  registry.register('brand_extract', createBrandExtractHandler({ db: testDb.db, mediaDir: testMedia.dir }))

  const runner = createMockRunner({
    loadFixture,
    sleep: async () => {}, // no real waiting
    applyCallback: callback => applyJobCallback({ db: testDb.db, registry }, callback)
  })
  const fetchFn = vi.fn(() => {
    throw new Error('mock mode must not use the network')
  }) as unknown as typeof fetch
  const client = createN8nClient({
    mode: 'mock', baseUrl: '', secret: 's', appInternalUrl: 'http://localhost:3000', mockRunner: runner, fetchFn
  })

  const deps: BrandDeps = {
    db: testDb.db,
    mediaDir: testMedia.dir,
    dispatch: input => startJob({ db: testDb.db, client }, input)
  }
  return { deps, fetchFn }
}

describe('brand extraction in mock mode', () => {
  it('takes a URL brand to ready with the fixture DNA and logo', async () => {
    const { deps, fetchFn } = setup()
    const created = await createUrlBrand(deps, { url: 'https://example.com' })
    expect(created.status).toBe('extracting')

    await vi.waitFor(() => expect(getBrandDetail(deps, created.id).status).toBe('ready'))

    const brand = getBrandDetail(deps, created.id)
    expect(brand.name).toBe('Kopi Senja')
    expect(brand.dna?.identity.website).toBe('https://example.com')
    expect(brand.dna?.offer.features).toHaveLength(3)
    expect(brand.extraction).toBeNull()
    expect(brand.logo).toMatchObject({ kind: 'logo', mime: 'image/png' })
    expect(existsSync(join(testMedia.dir, brand.logo!.url.replace('/media/', '')))).toBe(true)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('takes a PDF brand to ready', async () => {
    const { deps } = setup()
    const created = await createPdfBrand(deps, { file: { filename: 'Profil.pdf', data: PDF } })

    await vi.waitFor(() => expect(getBrandDetail(deps, created.id).status).toBe('ready'))

    const brand = getBrandDetail(deps, created.id)
    expect(brand.name).toBe('Kopi Senja')
    expect(brand.dna?.identity.website).toBe('https://kopisenja.example')
    expect(brand.logo).not.toBeNull()
  })

  it('ends failed with the mock error when the URL asks for a failure', async () => {
    const { deps } = setup()
    const created = await createUrlBrand(deps, { url: 'https://example.com/?x=mock:fail' })

    await vi.waitFor(() => expect(getBrandDetail(deps, created.id).status).toBe('failed'))

    const brand = getBrandDetail(deps, created.id)
    expect(brand.extraction?.error).toMatch(/mock:fail/)
    expect(brand.dna).toBeNull()
    expect(brand.logo).toBeNull()
  })
})
