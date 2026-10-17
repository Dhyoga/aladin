import { describe, expect, it } from 'vitest'
import { extensionFor, isImageType, mimeFor, sniffFileType } from '../../shared/utils/file-type'

const bytes = (...values: number[]) => Buffer.from(values)
const withPadding = (head: Buffer, size = 32) => Buffer.concat([head, Buffer.alloc(size)])

const PNG = withPadding(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))
const JPEG = withPadding(bytes(0xff, 0xd8, 0xff, 0xe0))
const WEBP = Buffer.concat([Buffer.from('RIFF'), bytes(0x24, 0, 0, 0), Buffer.from('WEBPVP8 '), Buffer.alloc(16)])
const PDF = withPadding(Buffer.from('%PDF-1.7\n'))
const mp4 = (brand = 'isom') => Buffer.concat([bytes(0, 0, 0, 0x20), Buffer.from('ftyp'), Buffer.from(brand), Buffer.alloc(40)])
const MP4 = mp4()

describe('sniffFileType', () => {
  it.each([
    ['png', PNG],
    ['jpeg', JPEG],
    ['webp', WEBP],
    ['pdf', PDF],
    ['mp4', MP4]
  ] as const)('detects %s', (type, data) => {
    expect(sniffFileType(data)).toBe(type)
  })

  it('does not trust the content that merely looks like text', () => {
    expect(sniffFileType(Buffer.from('<html><script>alert(1)</script></html>'))).toBeNull()
    expect(sniffFileType(Buffer.from('GIF89a......'))).toBeNull()
  })

  it('returns null for empty and too-short buffers', () => {
    expect(sniffFileType(Buffer.alloc(0))).toBeNull()
    expect(sniffFileType(bytes(0x89, 0x50))).toBeNull()
    expect(sniffFileType(bytes(0xff, 0xd8))).toBeNull()
    expect(sniffFileType(Buffer.from('%PDF'))).toBeNull()
  })

  it('rejects a RIFF container that is not WebP', () => {
    const wave = Buffer.concat([Buffer.from('RIFF'), bytes(0x24, 0, 0, 0), Buffer.from('WAVEfmt '), Buffer.alloc(16)])
    expect(sniffFileType(wave)).toBeNull()
  })

  it('rejects a RIFF header that is too short to contain the WEBP tag', () => {
    expect(sniffFileType(Buffer.from('RIFF1234'))).toBeNull()
  })

  it('needs the signature at the very start', () => {
    expect(sniffFileType(Buffer.concat([Buffer.from(' '), PNG]))).toBeNull()
  })
})

describe('mime types and extensions', () => {
  it('provides canonical values', () => {
    expect(mimeFor('png')).toBe('image/png')
    expect(mimeFor('jpeg')).toBe('image/jpeg')
    expect(mimeFor('webp')).toBe('image/webp')
    expect(mimeFor('pdf')).toBe('application/pdf')
    expect(mimeFor('mp4')).toBe('video/mp4')
    expect(extensionFor('png')).toBe('png')
    expect(extensionFor('jpeg')).toBe('jpg')
    expect(extensionFor('webp')).toBe('webp')
    expect(extensionFor('pdf')).toBe('pdf')
    expect(extensionFor('mp4')).toBe('mp4')
  })

  it('tells images from everything else', () => {
    expect(isImageType('png')).toBe(true)
    expect(isImageType('jpeg')).toBe(true)
    expect(isImageType('webp')).toBe(true)
    expect(isImageType('pdf')).toBe(false)
    expect(isImageType('mp4')).toBe(false)
    expect(isImageType(null)).toBe(false)
  })
})

describe('MP4 detection', () => {
  it.each(['isom', 'mp42', 'avc1', 'M4V ', 'qt  '])('recognizes the brand %j', (brand) => {
    expect(sniffFileType(mp4(brand))).toBe('mp4')
  })

  it('does not recognize other video containers', () => {
    const webm = Buffer.concat([bytes(0x1a, 0x45, 0xdf, 0xa3), Buffer.alloc(40)])
    const avi = Buffer.concat([Buffer.from('RIFF'), bytes(0x24, 0, 0, 0), Buffer.from('AVI LIST'), Buffer.alloc(16)])
    expect(sniffFileType(webm)).toBeNull()
    expect(sniffFileType(avi)).toBeNull()
  })

  it('needs the ftyp box in bytes 4 to 8', () => {
    expect(sniffFileType(Buffer.from('ftypisom........'))).toBeNull() // at the start
    expect(sniffFileType(Buffer.concat([bytes(0, 0, 0), Buffer.from('ftyp'), Buffer.alloc(8)]))).toBeNull() // one byte early
  })

  it('does not recognize a buffer that is too short to hold the box', () => {
    expect(sniffFileType(bytes(0, 0, 0, 0x20, 0x66, 0x74, 0x79))).toBeNull() // 7 bytes
  })

  it('does not change what is recognized for the other types', () => {
    expect(sniffFileType(PNG)).toBe('png')
    expect(sniffFileType(PDF)).toBe('pdf')
    expect(sniffFileType(WEBP)).toBe('webp')
  })
})
