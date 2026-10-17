import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MediaPathError } from '../../server/utils/media'
import { removeMediaPath, saveMediaFile } from '../../server/utils/media-storage'

let root: string
let mediaDir: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aladin-storage-'))
  mediaDir = join(root, 'media')
  mkdirSync(mediaDir)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('saveMediaFile', () => {
  it('creates nested folders and writes exactly the given bytes', async () => {
    const data = Buffer.from([1, 2, 3, 4])
    const file = await saveMediaFile(mediaDir, 'brands/b1/products/x.png', data)

    expect(file).toBe(join(mediaDir, 'brands/b1/products/x.png'))
    expect(readFileSync(file).equals(data)).toBe(true)
  })

  it('replaces an existing file', async () => {
    await saveMediaFile(mediaDir, 'a.bin', Buffer.from('old'))
    await saveMediaFile(mediaDir, 'a.bin', Buffer.from('new'))
    expect(readFileSync(join(mediaDir, 'a.bin'), 'utf8')).toBe('new')
  })

  it.each([
    '../outside.txt',
    'brands/../../outside.txt',
    '..%2Foutside.txt',
    'file.png%00.txt',
    '../media-evil/x.txt'
  ])('rejects the path %s and writes nothing outside the media dir', async (path) => {
    await expect(saveMediaFile(mediaDir, path, Buffer.from('x'))).rejects.toThrow(MediaPathError)
    expect(existsSync(join(root, 'outside.txt'))).toBe(false)
    expect(existsSync(join(root, 'media-evil'))).toBe(false)
  })

  it.each(['', '.', '/'])('refuses to write at the media root (%j)', async (path) => {
    await expect(saveMediaFile(mediaDir, path, Buffer.from('x'))).rejects.toThrow(MediaPathError)
  })
})

describe('removeMediaPath', () => {
  it('removes a file', async () => {
    const file = await saveMediaFile(mediaDir, 'a/b.png', Buffer.from('x'))
    await removeMediaPath(mediaDir, 'a/b.png')
    expect(existsSync(file)).toBe(false)
  })

  it('removes a folder recursively and leaves siblings alone', async () => {
    await saveMediaFile(mediaDir, 'brands/b1/logo.png', Buffer.from('1'))
    await saveMediaFile(mediaDir, 'brands/b1/products/p.png', Buffer.from('2'))
    await saveMediaFile(mediaDir, 'brands/b2/logo.png', Buffer.from('3'))

    await removeMediaPath(mediaDir, 'brands/b1')

    expect(existsSync(join(mediaDir, 'brands/b1'))).toBe(false)
    expect(readFileSync(join(mediaDir, 'brands/b2/logo.png'), 'utf8')).toBe('3')
  })

  it('succeeds for a path that does not exist', async () => {
    await expect(removeMediaPath(mediaDir, 'nope/never.png')).resolves.toBeUndefined()
  })

  it.each(['', '.', '/'])('refuses to remove the media root (%j)', async (path) => {
    writeFileSync(join(mediaDir, 'keep.txt'), 'keep')
    await expect(removeMediaPath(mediaDir, path)).rejects.toThrow(MediaPathError)
    expect(existsSync(join(mediaDir, 'keep.txt'))).toBe(true)
  })

  it('rejects traversal without touching files outside', async () => {
    writeFileSync(join(root, 'outside.txt'), 'keep')
    await expect(removeMediaPath(mediaDir, '../outside.txt')).rejects.toThrow(MediaPathError)
    await expect(removeMediaPath(mediaDir, 'a/../../outside.txt')).rejects.toThrow(MediaPathError)
    expect(existsSync(join(root, 'outside.txt'))).toBe(true)
  })
})
