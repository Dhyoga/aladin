import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { brands, generations } from '../../server/db/schema'
import { applyJobCallback } from '../../server/utils/job-callback'
import { createHandlerRegistry, type CallbackFile } from '../../server/utils/job-handlers'
import { createJob, getJob, markRunning } from '../../server/utils/jobs'
import { cleanGeneratedHashtags, createPostResultHandler } from '../../server/utils/post-result'
import { useTestDatabase, useTestMedia } from './helpers'

const T0 = 1_800_000_000_000

const testDb = useTestDatabase()
const testMedia = useTestMedia()

const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0])
const WEBP_HEAD = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBPVP8 ')])
const image = (head: Buffer, size = 64, fill = 5) => Buffer.concat([head, Buffer.alloc(size - head.length, fill)])

const imageFile = (data: Buffer): CallbackFile => ({ field: 'image', filename: 'whatever.bin', mime: 'application/octet-stream', data })

const payload = (over: Record<string, unknown> = {}) => JSON.stringify({
  caption: 'Halo dari Kopi Senja',
  hashtags: ['#a', '#b'],
  image_brief: { headline: 'J', scene: 's' },
  ...over
})

function setup({ withGeneration = true }: { withGeneration?: boolean } = {}) {
  testDb.db.insert(brands).values({
    id: 'brd_1', name: 'Kopi Senja', sourceType: 'manual', sourceUrl: null, sourceAssetId: null,
    dnaJson: null, status: 'ready', createdAt: T0, updatedAt: T0
  }).run()
  if (withGeneration) {
    testDb.db.insert(generations).values({
      id: 'gen_1', brandId: 'brd_1', prompt: 'promo', aspectRatio: '4:5', assetIdsJson: '["ast_1"]',
      caption: null, hashtagsJson: null, imagePath: null, createdAt: T0, updatedAt: T0
    }).run()
  }

  const job = createJob(testDb.db, { type: 'post', brandId: 'brd_1', generationId: withGeneration ? 'gen_1' : null }, T0)
  markRunning(testDb.db, job.id, T0)

  const registry = createHandlerRegistry()
  registry.register('post', createPostResultHandler({ db: testDb.db, mediaDir: testMedia.dir, now: () => T0 + 1000 }))

  const complete = (body: string, files: { image?: CallbackFile } = {}) =>
    applyJobCallback({ db: testDb.db, registry, now: () => T0 + 1000 }, { jobId: job.id, event: 'completed', payload: body, files })

  const row = () => testDb.db.select().from(generations).where(eq(generations.id, 'gen_1')).get()
  const folder = join(testMedia.dir, 'generations', 'gen_1')
  const files = () => (existsSync(folder) ? readdirSync(folder) : [])
  return { job, complete, row, folder, files, registry }
}

describe('post result handler', () => {
  it('stores the caption, the hashtags and the image, and completes the job', async () => {
    const { complete, row, job, folder } = setup()
    const data = image(PNG_HEAD, 300, 42)

    await complete(payload(), { image: imageFile(data) })

    expect(row()).toMatchObject({
      caption: 'Halo dari Kopi Senja',
      hashtagsJson: '["#a","#b"]',
      imagePath: 'generations/gen_1/post.png',
      updatedAt: T0 + 1000
    })
    expect(readFileSync(join(folder, 'post.png')).equals(data)).toBe(true)
    expect(getJob(testDb.db, job.id)).toMatchObject({ status: 'completed', error: null })
  })

  it.each([
    ['PNG', PNG_HEAD, 'png'],
    ['JPEG', JPEG_HEAD, 'jpg'],
    ['WebP', WEBP_HEAD, 'webp']
  ])('takes the extension from the content: %s -> .%s', async (_name, head, ext) => {
    const { complete, row, files } = setup()
    await complete(payload(), { image: imageFile(image(head)) }) // the file is called whatever.bin, as sent
    expect(row()!.imagePath).toBe(`generations/gen_1/post.${ext}`)
    expect(files()).toEqual([`post.${ext}`])
  })

  it('rejects something that is not an image: the job fails, nothing is saved', async () => {
    const { complete, row, job, files } = setup()

    await complete(payload(), { image: imageFile(Buffer.from('<html>not an image</html>')) })

    expect(getJob(testDb.db, job.id)).toMatchObject({ status: 'failed' })
    expect(getJob(testDb.db, job.id)!.error).toMatch(/^handler_failed.*not a PNG, JPEG or WebP/)
    expect(row()).toMatchObject({ caption: null, hashtagsJson: null, imagePath: null })
    expect(files()).toEqual([])
  })

  it('rejects a PDF and a GIF as images', async () => {
    for (const data of [Buffer.from('%PDF-1.7\nxxxx'), Buffer.from('GIF89a......')]) {
      const { complete, job, row } = setup()
      await complete(payload(), { image: imageFile(data) })
      expect(getJob(testDb.db, job.id)!.error).toMatch(/^handler_failed/)
      expect(row()!.imagePath).toBeNull()
      testDb.sqlite.exec('delete from jobs; delete from generations; delete from brands')
    }
  })

  it('fails the job when the generation was deleted while it ran, leaving no file', async () => {
    const { complete, job, files } = setup()
    testDb.db.delete(generations).where(eq(generations.id, 'gen_1')).run()

    await complete(payload(), { image: imageFile(image(PNG_HEAD)) })

    expect(getJob(testDb.db, job.id)!.error).toMatch(/^handler_failed.*generation not found/)
    expect(files()).toEqual([])
  })

  it('fails the job when the job has no generation', async () => {
    const { complete, job } = setup({ withGeneration: false })
    await complete(payload(), { image: imageFile(image(PNG_HEAD)) })
    expect(getJob(testDb.db, job.id)!.error).toMatch(/^handler_failed.*no generation/)
  })

  it('removes the file when the generation disappears while the file is being written', async () => {
    const { job, row, files } = setup()
    const handler = createPostResultHandler({ db: testDb.db, mediaDir: testMedia.dir })

    // runs up to its first await (writing the file); delete the generation before it resumes
    const pending = handler.onCompleted({
      job: getJob(testDb.db, job.id)!,
      stage: undefined,
      payload: { caption: 'x', hashtags: [], image_brief: { headline: 'h', scene: 's', chips: [] } },
      files: { image: imageFile(image(PNG_HEAD)) }
    })
    testDb.db.delete(generations).where(eq(generations.id, 'gen_1')).run()

    await expect(pending).rejects.toThrow(/generation not found/)
    expect(row()).toBeUndefined()
    expect(files()).toEqual([])
  })

  it('replaces an older image that had another extension, so no old file stays behind', async () => {
    const { complete, row, files, folder } = setup()
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'post.png'), 'old')
    testDb.db.update(generations).set({ imagePath: 'generations/gen_1/post.png' }).where(eq(generations.id, 'gen_1')).run()

    await complete(payload(), { image: imageFile(image(JPEG_HEAD)) })

    expect(row()!.imagePath).toBe('generations/gen_1/post.jpg')
    expect(files()).toEqual(['post.jpg'])
  })

  it('overwrites an older image with the same extension', async () => {
    const { complete, folder } = setup()
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'post.png'), 'old')
    testDb.db.update(generations).set({ imagePath: 'generations/gen_1/post.png' }).where(eq(generations.id, 'gen_1')).run()

    const fresh = image(PNG_HEAD, 100, 9)
    await complete(payload(), { image: imageFile(fresh) })

    expect(readFileSync(join(folder, 'post.png')).equals(fresh)).toBe(true)
  })

  it('cleans the hashtags from the model instead of failing on them', async () => {
    const { complete, row, job } = setup()
    await complete(payload({ hashtags: ['kopi senja', '#Kopi', '##kopi', '', '   ', '#ok'] }), { image: imageFile(image(PNG_HEAD)) })

    expect(getJob(testDb.db, job.id)!.status).toBe('completed')
    expect(JSON.parse(row()!.hashtagsJson!)).toEqual(['#kopisenja', '#Kopi', '#ok'])
  })

  it('cuts a caption that is longer than Instagram allows', async () => {
    const { complete, row } = setup()
    await complete(payload({ caption: 'x'.repeat(3000) }), { image: imageFile(image(PNG_HEAD)) })
    expect(row()!.caption).toHaveLength(2200)
  })
})

describe('cleanGeneratedHashtags', () => {
  it('drops whitespace inside a tag and a repeated #', () => {
    expect(cleanGeneratedHashtags(['kopi senja', '##baru', ' #x '])).toEqual(['#kopisenja', '#baru', '#x'])
  })

  it('removes duplicates ignoring case and keeps the first spelling and the order', () => {
    expect(cleanGeneratedHashtags(['Promo', 'x', '#promo'])).toEqual(['#Promo', '#x'])
  })

  it('drops empty entries and a lone #', () => {
    expect(cleanGeneratedHashtags(['', '#', '  ', '##', 'ok'])).toEqual(['#ok'])
  })

  it('caps a tag at 100 characters and the list at 30', () => {
    expect(cleanGeneratedHashtags(['x'.repeat(500)])[0]).toHaveLength(100)
    expect(cleanGeneratedHashtags(Array.from({ length: 50 }, (_, i) => `t${i}`))).toHaveLength(30)
  })

  it('handles an empty list', () => {
    expect(cleanGeneratedHashtags([])).toEqual([])
  })
})
