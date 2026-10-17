import { createApp, eventHandler, toWebHandler } from 'h3'
import { describe, expect, it } from 'vitest'
import { parseUploadParts, rejectIfTooLarge } from '../../server/utils/upload'

const MB = 1024 * 1024

describe('parseUploadParts', () => {
  const text = (name: string, value: string) => ({ name, data: Buffer.from(value) })
  const file = (name: string, filename: string, data = 'bytes') => ({ name, filename, data: Buffer.from(data) })

  it('splits text fields from files', () => {
    const parsed = parseUploadParts([text('kind', 'product_photo'), file('files', 'a.png', 'A'), file('files', 'b.png', 'B')])

    expect(parsed.fields).toEqual({ kind: 'product_photo' })
    expect(parsed.files.map(f => [f.name, f.filename, f.data.toString()])).toEqual([
      ['files', 'a.png', 'A'],
      ['files', 'b.png', 'B']
    ])
  })

  it('keeps hostile file names as data only', () => {
    const parsed = parseUploadParts([file('file', '../../etc/passwd')])
    expect(parsed.files[0]!.filename).toBe('../../etc/passwd')
  })

  it('drops the empty file part a browser sends when no file was chosen', () => {
    const parsed = parseUploadParts([text('source_type', 'url'), { name: 'file', filename: '', data: Buffer.alloc(0) }])
    expect(parsed.files).toEqual([])
    expect(parsed.fields).toEqual({ source_type: 'url' })
  })

  it('keeps a named file even when it is empty', () => {
    expect(parseUploadParts([file('file', 'empty.pdf', '')]).files).toHaveLength(1)
  })

  it('ignores parts without a name', () => {
    expect(parseUploadParts([{ data: Buffer.from('x') }])).toEqual({ fields: {}, files: [] })
  })
})

describe('rejectIfTooLarge', () => {
  const app = createApp()
  app.use(eventHandler((event) => {
    rejectIfTooLarge(event, 21 * MB)
    return 'ok'
  }))
  const handle = toWebHandler(app)
  const call = (headers: Record<string, string> = {}) => handle(new Request('http://localhost/', { headers }))

  it('answers 413 when the declared length is over the limit', async () => {
    expect((await call({ 'content-length': String(22 * MB) })).status).toBe(413)
  })

  it('lets a request at or below the limit through', async () => {
    expect((await call({ 'content-length': String(21 * MB) })).status).toBe(200)
    expect((await call({ 'content-length': '10' })).status).toBe(200)
  })

  it('lets a request without Content-Length through', async () => {
    expect((await call()).status).toBe(200)
  })
})
