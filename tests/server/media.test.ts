import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp, eventHandler, toWebHandler } from 'h3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  MediaPathError,
  parseRange,
  resolveMediaPath,
  serveMedia
} from '../../server/utils/media'

describe('resolveMediaPath', () => {
  const root = '/data/media'

  it('resolves a normal nested path', () => {
    expect(resolveMediaPath(root, 'brands/b1/logo-x.png')).toBe('/data/media/brands/b1/logo-x.png')
  })

  it('ignores leading slashes instead of treating the path as absolute', () => {
    expect(resolveMediaPath(root, '/etc/passwd')).toBe('/data/media/etc/passwd')
  })

  it('rejects plain traversal', () => {
    expect(() => resolveMediaPath(root, '../../etc/passwd')).toThrow(MediaPathError)
  })

  it('rejects percent-encoded traversal', () => {
    expect(() => resolveMediaPath(root, '..%2F..%2Fetc%2Fpasswd')).toThrow(MediaPathError)
    expect(() => resolveMediaPath(root, '%2e%2e/secret')).toThrow(MediaPathError)
  })

  it('rejects backslash traversal', () => {
    expect(() => resolveMediaPath(root, '..\\..\\etc\\passwd')).toThrow(MediaPathError)
  })

  it('rejects null bytes', () => {
    expect(() => resolveMediaPath(root, 'file.png%00.txt')).toThrow(MediaPathError)
  })

  it('rejects invalid percent-encoding', () => {
    expect(() => resolveMediaPath(root, '%E0%A4%A')).toThrow(MediaPathError)
  })

  it('rejects a sibling directory sharing the media dir prefix', () => {
    expect(() => resolveMediaPath(root, '../media-secret/file.txt')).toThrow(MediaPathError)
  })
})

describe('parseRange', () => {
  it('returns none without a header', () => {
    expect(parseRange(undefined, 1000)).toEqual({ kind: 'none' })
  })

  it('parses a bounded range', () => {
    expect(parseRange('bytes=0-99', 1000)).toEqual({ kind: 'range', start: 0, end: 99 })
  })

  it('parses an open-ended range', () => {
    expect(parseRange('bytes=900-', 1000)).toEqual({ kind: 'range', start: 900, end: 999 })
  })

  it('parses a suffix range', () => {
    expect(parseRange('bytes=-100', 1000)).toEqual({ kind: 'range', start: 900, end: 999 })
  })

  it('clamps a suffix larger than the file', () => {
    expect(parseRange('bytes=-5000', 1000)).toEqual({ kind: 'range', start: 0, end: 999 })
  })

  it('clamps an end beyond the file size', () => {
    expect(parseRange('bytes=900-5000', 1000)).toEqual({ kind: 'range', start: 900, end: 999 })
  })

  it('flags a start beyond the file as unsatisfiable', () => {
    expect(parseRange('bytes=2000-3000', 1000)).toEqual({ kind: 'unsatisfiable' })
    expect(parseRange('bytes=1000-', 1000)).toEqual({ kind: 'unsatisfiable' })
  })

  it('flags a zero-length suffix and any range on an empty file as unsatisfiable', () => {
    expect(parseRange('bytes=-0', 1000)).toEqual({ kind: 'unsatisfiable' })
    expect(parseRange('bytes=0-', 0)).toEqual({ kind: 'unsatisfiable' })
  })

  it('ignores multiple ranges', () => {
    expect(parseRange('bytes=0-10,20-30', 1000)).toEqual({ kind: 'none' })
  })

  it('ignores malformed headers', () => {
    expect(parseRange('bytes=abc', 1000)).toEqual({ kind: 'none' })
    expect(parseRange('bytes=-', 1000)).toEqual({ kind: 'none' })
    expect(parseRange('items=0-5', 1000)).toEqual({ kind: 'none' })
    expect(parseRange('bytes=50-10', 1000)).toEqual({ kind: 'none' })
  })
})

describe('GET /media handler', () => {
  let tmp: string
  let handle: (request: Request) => Promise<Response>
  const file = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256))

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'aladin-media-'))
    const mediaDir = join(tmp, 'media')
    mkdirSync(join(mediaDir, 'dir'), { recursive: true })
    mkdirSync(join(tmp, 'media-secret'))
    writeFileSync(join(mediaDir, 'file.bin'), file)
    writeFileSync(join(mediaDir, 'clip.mp4'), 'fake-mp4')
    writeFileSync(join(mediaDir, 'pic.png'), 'fake-png')
    writeFileSync(join(mediaDir, 'thing.xyz'), 'whatever')
    writeFileSync(join(tmp, 'media-secret', 'file.txt'), 'secret')

    const app = createApp()
    // Mimics the Nitro route: the raw (still encoded) path after /media/.
    app.use(eventHandler((event) => {
      const rel = (event.path.split('?')[0] ?? '').replace(/^\/media\//, '')
      return serveMedia(event, mediaDir, rel)
    }))
    handle = toWebHandler(app)
  })

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  // Always drains the body: an unread stream would still be opening the file
  // when afterAll removes the temp directory.
  const get = async (path: string, range?: string) => {
    const res = await handle(new Request(`http://localhost/media/${path}`, range ? { headers: { range } } : undefined))
    return { status: res.status, headers: res.headers, body: Buffer.from(await res.arrayBuffer()) }
  }

  it('serves an existing file with 200 and the right headers', async () => {
    const res = await get('file.bin')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-length')).toBe('1000')
    expect(res.headers.get('accept-ranges')).toBe('bytes')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('last-modified')).toBeTruthy()
    expect(res.headers.get('cache-control')).toBe('private, max-age=300')
    expect(res.body.equals(file)).toBe(true)
  })

  it('serves a bounded range as 206', async () => {
    const res = await get('file.bin', 'bytes=0-99')
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 0-99/1000')
    expect(res.headers.get('content-length')).toBe('100')
    expect(res.body.equals(file.subarray(0, 100))).toBe(true)
  })

  it('serves an open-ended range', async () => {
    const res = await get('file.bin', 'bytes=900-')
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 900-999/1000')
    expect(res.headers.get('content-length')).toBe('100')
    expect(res.body.equals(file.subarray(900))).toBe(true)
  })

  it('serves a suffix range', async () => {
    const res = await get('file.bin', 'bytes=-100')
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 900-999/1000')
    expect(res.body.equals(file.subarray(900))).toBe(true)
  })

  it('clamps an end beyond the file size', async () => {
    const res = await get('file.bin', 'bytes=900-5000')
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 900-999/1000')
  })

  it('answers 416 for an unsatisfiable range', async () => {
    const res = await get('file.bin', 'bytes=2000-3000')
    expect(res.status).toBe(416)
    expect(res.headers.get('content-range')).toBe('bytes */1000')
  })

  it('ignores multiple ranges and returns the full file', async () => {
    const res = await get('file.bin', 'bytes=0-10,20-30')
    expect(res.status).toBe(200)
    expect(res.body.equals(file)).toBe(true)
  })

  it('ignores a malformed range and returns the full file', async () => {
    const res = await get('file.bin', 'bytes=abc')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-length')).toBe('1000')
  })

  it('answers 404 for a missing file', async () => {
    expect((await get('nope.png')).status).toBe(404)
  })

  it('answers 404 for a directory', async () => {
    expect((await get('dir')).status).toBe(404)
  })

  it('answers 400 for encoded traversal', async () => {
    expect((await get('..%2F..%2Fetc%2Fpasswd')).status).toBe(400)
  })

  it('answers 400 for a null byte', async () => {
    expect((await get('file.bin%00.png')).status).toBe(400)
  })

  it('answers 400 for a sibling directory with a shared prefix', async () => {
    expect((await get('..%2Fmedia-secret%2Ffile.txt')).status).toBe(400)
  })

  it('sets Content-Type from the extension', async () => {
    expect((await get('clip.mp4')).headers.get('content-type')).toBe('video/mp4')
    expect((await get('pic.png')).headers.get('content-type')).toBe('image/png')
  })

  it('falls back to octet-stream for unknown extensions', async () => {
    expect((await get('thing.xyz')).headers.get('content-type')).toBe('application/octet-stream')
  })
})
