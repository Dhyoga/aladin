import { rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { brandAssets } from '../../server/db/schema'
import { form, pdf, png, SECRET, useBrandApi } from './brand-api-harness'

const api = useBrandApi()

const withSecret = (extra: Record<string, string> = {}) => ({ 'x-aladin-secret': SECRET, ...extra })

async function pdfBrand(data = pdf(200)) {
  const res = await api.post('/api/brands', form(
    { source_type: 'pdf' },
    [{ name: 'file', filename: 'katalog.pdf', type: 'application/pdf', data }]
  ))
  const brand = res.body as unknown as { id: string }
  const asset = api.db.select().from(brandAssets).where(eq(brandAssets.brandId, brand.id)).get()!
  return { brand, asset, data }
}

describe('GET /api/internal/assets/:id', () => {
  it('returns the source PDF with its content type and exact bytes', async () => {
    const { asset, data } = await pdfBrand(pdf(500))

    const res = await api.fetch(`/api/internal/assets/${asset.id}`, { headers: withSecret() })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-length')).toBe('500')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(Buffer.from(await res.arrayBuffer()).equals(data)).toBe(true)
  })

  it('supports ranges like the media route', async () => {
    const { asset, data } = await pdfBrand(pdf(500))

    const res = await api.fetch(`/api/internal/assets/${asset.id}`, { headers: withSecret({ range: 'bytes=0-9' }) })
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 0-9/500')
    expect(Buffer.from(await res.arrayBuffer()).equals(data.subarray(0, 10))).toBe(true)
  })

  it('also serves logos and photos, by asset id', async () => {
    const created = (await api.post('/api/brands', form({ source_type: 'manual', name: 'X' }))).body as unknown as { id: string }
    const photo = png(120, 3)
    const upload = await api.post(`/api/brands/${created.id}/assets`, form(
      { kind: 'product_photo' },
      [{ name: 'files', filename: 'p.png', type: 'image/png', data: photo }]
    ))
    const [asset] = (upload.body as unknown as { assets: { id: string }[] }).assets

    const res = await api.fetch(`/api/internal/assets/${asset!.id}`, { headers: withSecret() })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(await res.arrayBuffer()).equals(photo)).toBe(true)
  })

  it.each([
    ['a wrong secret', { 'x-aladin-secret': 'wrong' }],
    ['no secret', {}],
    ['an empty secret', { 'x-aladin-secret': '' }],
    ['a prefix of the real secret', { 'x-aladin-secret': SECRET.slice(0, 12) }]
  ])('answers 401 for %s and returns no file', async (_label, headers) => {
    const { asset } = await pdfBrand()
    const res = await api.fetch(`/api/internal/assets/${asset.id}`, { headers })
    expect(res.status).toBe(401)
    expect(res.headers.get('content-type')).not.toBe('application/pdf')
  })

  it('answers 404 for a request that went through the public proxy, even with the secret', async () => {
    const { asset } = await pdfBrand()
    const res = await api.fetch(`/api/internal/assets/${asset.id}`, {
      headers: withSecret({ 'x-forwarded-host': 'aladin.serdadu.dev' })
    })
    expect(res.status).toBe(404)
  })

  it('answers 404 for an unknown id', async () => {
    const res = await api.fetch('/api/internal/assets/ast_missing', { headers: withSecret() })
    expect(res.status).toBe(404)
  })

  it('answers 404 when the row exists but the file is gone', async () => {
    const { asset } = await pdfBrand()
    rmSync(join(api.mediaDir, asset.path))

    const res = await api.fetch(`/api/internal/assets/${asset.id}`, { headers: withSecret() })
    expect(res.status).toBe(404)
  })

  it('does not touch the database before the secret and proxy checks', async () => {
    const { asset } = await pdfBrand()
    api.sqlite.exec('drop table brand_assets') // any query would now fail with a 500

    expect((await api.fetch(`/api/internal/assets/${asset.id}`, { headers: { 'x-aladin-secret': 'wrong' } })).status).toBe(401)
    expect((await api.fetch(`/api/internal/assets/${asset.id}`, {
      headers: withSecret({ 'x-forwarded-host': 'aladin.serdadu.dev' })
    })).status).toBe(404)
    // sanity check: with the right secret the missing table does surface as an error
    expect((await api.fetch(`/api/internal/assets/${asset.id}`, { headers: withSecret() })).status).toBe(500)
  })

  it('serves the same bytes that were stored on disk', async () => {
    const { asset, data } = await pdfBrand(pdf(300))
    expect(readFileSync(join(api.mediaDir, asset.path)).equals(data)).toBe(true)
  })
})
