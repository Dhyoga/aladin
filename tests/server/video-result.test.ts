import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { brands, generations } from '../../server/db/schema'
import { getGeneration, type GenerationDeps } from '../../server/utils/generations'
import { applyJobCallback, type ParsedCallback } from '../../server/utils/job-callback'
import { createHandlerRegistry, type CallbackFile } from '../../server/utils/job-handlers'
import { createJob, getJob, markRunning } from '../../server/utils/jobs'
import { createVideoResultHandler } from '../../server/utils/video-result'
import { useTestDatabase, useTestMedia } from './helpers'

const T0 = 1_800_000_000_000

const testDb = useTestDatabase()
const testMedia = useTestMedia()

const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0])
const WEBP_HEAD = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBPVP8 ')])
const padded = (head: Buffer, size = 64, fill = 5) => Buffer.concat([head, Buffer.alloc(size - head.length, fill)])
const mp4 = (size = 400, fill = 7) => padded(Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom')]), size, fill)

const file = (field: CallbackFile['field'], data: Buffer, mime = 'application/octet-stream'): CallbackFile =>
  ({ field, filename: 'whatever.bin', mime, data })

const scriptOf = (visual: string) => ({
  script: { scenes: [{ start: 0, end: 2, visual, on_screen_text: 'Halo', voice_over: 'Halo dunia' }] }
})

function setup({ withGeneration = true }: { withGeneration?: boolean } = {}) {
  testDb.db.insert(brands).values({
    id: 'brd_1', name: 'Kopi Senja', sourceType: 'manual', sourceUrl: null, sourceAssetId: null,
    dnaJson: null, status: 'ready', createdAt: T0, updatedAt: T0
  }).run()
  if (withGeneration) {
    testDb.db.insert(generations).values({
      id: 'gen_1', brandId: 'brd_1', prompt: 'promo', aspectRatio: '4:5', assetIdsJson: '["ast_1"]',
      caption: 'Halo', hashtagsJson: '[]', imagePath: 'generations/gen_1/post.png', createdAt: T0, updatedAt: T0
    }).run()
  }
  const job = createJob(testDb.db, { type: 'video', brandId: 'brd_1', generationId: withGeneration ? 'gen_1' : null }, T0 + 1)
  markRunning(testDb.db, job.id, T0 + 1)

  const registry = createHandlerRegistry()
  registry.register('video', createVideoResultHandler({ db: testDb.db, mediaDir: testMedia.dir, now: () => T0 + 1000 }))

  const send = (callback: Omit<ParsedCallback, 'jobId' | 'files'> & { files?: ParsedCallback['files'] }) =>
    applyJobCallback({ db: testDb.db, registry, now: () => T0 + 1000 }, { jobId: job.id, files: {}, ...callback })
  const progress = (stage: string, extra: { payload?: unknown, files?: ParsedCallback['files'] } = {}) =>
    send({
      event: 'progress',
      stage,
      ...(extra.payload === undefined ? {} : { payload: JSON.stringify(extra.payload) }),
      ...(extra.files ? { files: extra.files } : {}) // an explicit `files: undefined` would replace the default {}
    })
  const complete = (payload: unknown, files: ParsedCallback['files']) =>
    send({ event: 'completed', payload: JSON.stringify(payload), files })

  const deps: GenerationDeps = { db: testDb.db, mediaDir: testMedia.dir, now: () => T0 + 2000, dispatch: () => Promise.reject(new Error('unused')) }
  const row = () => testDb.db.select().from(generations).where(eq(generations.id, 'gen_1')).get()
  const folder = join(testMedia.dir, 'generations', 'gen_1')
  const files = () => (existsSync(folder) ? readdirSync(folder).sort() : [])
  const video = () => getGeneration(deps, 'gen_1').video
  return { job, progress, complete, row, folder, files, video, deps }
}

describe('progress events', () => {
  it('stores the script at the script stage and shows it while the video is still running', async () => {
    const { progress, row, video } = setup()

    await progress('script', { payload: scriptOf('close-up') })

    expect(JSON.parse(row()!.videoScriptJson!)).toEqual(scriptOf('close-up').script)
    expect(video()).toMatchObject({ status: 'running', stage: 'script', script: scriptOf('close-up').script, storyboardUrl: null, videoUrl: null })
  })

  it.each([
    ['PNG', PNG_HEAD, 'png'],
    ['JPEG', JPEG_HEAD, 'jpg'],
    ['WebP', WEBP_HEAD, 'webp']
  ])('stores a %s storyboard under an extension taken from the content', async (_name, head, ext) => {
    const { progress, row, files, video } = setup()
    const data = padded(head, 300, 9)

    await progress('storyboard', { files: { storyboard: file('storyboard', data) } })

    expect(row()!.storyboardPath).toBe(`generations/gen_1/storyboard.${ext}`)
    expect(readFileSync(join(testMedia.dir, row()!.storyboardPath!)).equals(data)).toBe(true)
    expect(files()).toEqual([`storyboard.${ext}`])
    expect(video()).toMatchObject({ status: 'running', stage: 'storyboard', storyboardUrl: `/media/generations/gen_1/storyboard.${ext}`, videoUrl: null })
  })

  it('removes a storyboard of another type, so one generation never keeps two', async () => {
    const { progress, row, files } = setup()
    await progress('storyboard', { files: { storyboard: file('storyboard', padded(PNG_HEAD)) } })
    expect(files()).toEqual(['storyboard.png'])

    await progress('storyboard', { files: { storyboard: file('storyboard', padded(JPEG_HEAD)) } })

    expect(files()).toEqual(['storyboard.jpg'])
    expect(row()!.storyboardPath).toBe('generations/gen_1/storyboard.jpg')
  })

  it('stores nothing at the video stage', async () => {
    const { progress, row } = setup()
    const before = row()

    await progress('video')

    expect(row()).toEqual(before)
  })

  it('is idempotent: the same event twice gives the same result', async () => {
    const { progress, row, files } = setup()
    const send = async () => {
      await progress('script', { payload: scriptOf('close-up') })
      await progress('storyboard', { files: { storyboard: file('storyboard', padded(PNG_HEAD)) } })
    }
    await send()
    const once = { ...row(), updatedAt: 0 }
    await send()

    expect({ ...row(), updatedAt: 0 }).toEqual(once)
    expect(files()).toEqual(['storyboard.png'])
  })

  it('keeps the script while the storyboard arrives, and the other way around', async () => {
    const { progress, video } = setup()
    await progress('script', { payload: scriptOf('close-up') })
    await progress('storyboard', { files: { storyboard: file('storyboard', padded(PNG_HEAD)) } })

    expect(video()).toMatchObject({ script: scriptOf('close-up').script, storyboardUrl: '/media/generations/gen_1/storyboard.png' })
  })

  it('fails the job, without writing, when the storyboard is not an image', async () => {
    const { progress, job, row, files } = setup()

    await progress('storyboard', { files: { storyboard: file('storyboard', Buffer.from('<html>no</html>')) } })

    expect(getJob(testDb.db, job.id)).toMatchObject({ status: 'failed' })
    expect(getJob(testDb.db, job.id)!.error).toMatch(/^handler_failed.*not a PNG, JPEG or WebP/)
    expect(row()!.storyboardPath).toBeNull()
    expect(files()).toEqual([])
  })

  it('fails the job when the generation was deleted, leaving no file', async () => {
    const { progress, job, files } = setup()
    testDb.db.delete(generations).where(eq(generations.id, 'gen_1')).run()

    await progress('storyboard', { files: { storyboard: file('storyboard', padded(PNG_HEAD)) } })

    expect(getJob(testDb.db, job.id)!.error).toMatch(/^handler_failed.*generation not found/)
    expect(files()).toEqual([])
  })

  it('fails the job when it has no generation', async () => {
    const { progress, job } = setup({ withGeneration: false })
    await progress('script', { payload: scriptOf('x') })
    expect(getJob(testDb.db, job.id)!.error).toMatch(/^handler_failed.*no generation/)
  })

  it('removes the file when the generation disappears while it is being written', async () => {
    const { job, files } = setup()
    const handler = createVideoResultHandler({ db: testDb.db, mediaDir: testMedia.dir })

    // runs up to its first await (writing the file); delete the generation before it resumes
    const pending = handler.onProgress!({
      job: getJob(testDb.db, job.id)!,
      stage: 'storyboard',
      payload: undefined,
      files: { storyboard: file('storyboard', padded(PNG_HEAD)) }
    })
    testDb.db.delete(generations).where(eq(generations.id, 'gen_1')).run()

    await expect(pending).rejects.toThrow(/generation not found/)
    expect(files()).toEqual([])
  })
})

describe('completion', () => {
  it('saves the video with its exact bytes and completes the job', async () => {
    const { complete, row, job, folder, video } = setup()
    const data = mp4(1000, 3)

    await complete(scriptOf('final'), { video: file('video', data, 'video/mp4') })

    expect(row()!.videoPath).toBe('generations/gen_1/video.mp4')
    expect(readFileSync(join(folder, 'video.mp4')).equals(data)).toBe(true)
    expect(getJob(testDb.db, job.id)).toMatchObject({ status: 'completed', error: null })
    expect(video()).toMatchObject({ status: 'completed', videoUrl: '/media/generations/gen_1/video.mp4' })
  })

  it('does not trust the name or type the sender gave: only the content', async () => {
    const { complete, row } = setup()
    await complete(scriptOf('final'), { video: { field: 'video', filename: 'clip.webm', mime: 'video/webm', data: mp4() } })
    expect(row()!.videoPath).toBe('generations/gen_1/video.mp4')
  })

  it('lets the final script replace the one stored at progress', async () => {
    const { progress, complete, row } = setup()
    await progress('script', { payload: scriptOf('from progress') })

    await complete(scriptOf('final version'), { video: file('video', mp4()) })

    expect(JSON.parse(row()!.videoScriptJson!)).toEqual(scriptOf('final version').script)
  })

  it('saves a storyboard that is only sent with the completion', async () => {
    const { complete, row, files } = setup()

    await complete(scriptOf('x'), { video: file('video', mp4()), storyboard: file('storyboard', padded(JPEG_HEAD, 200)) })

    expect(row()!.storyboardPath).toBe('generations/gen_1/storyboard.jpg')
    expect(files()).toEqual(['storyboard.jpg', 'video.mp4'])
  })

  it('keeps the storyboard that was saved at progress when the completion has none', async () => {
    const { progress, complete, row, files } = setup()
    await progress('storyboard', { files: { storyboard: file('storyboard', padded(PNG_HEAD)) } })

    await complete(scriptOf('x'), { video: file('video', mp4()) })

    expect(row()!.storyboardPath).toBe('generations/gen_1/storyboard.png')
    expect(files()).toEqual(['storyboard.png', 'video.mp4'])
  })

  it.each([
    ['a PNG', padded(PNG_HEAD)],
    ['text', Buffer.from('this is not a video')],
    ['a WebM', padded(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))],
    ['an empty file', Buffer.alloc(0)]
  ])('fails the job, writing nothing, when the video is %s', async (_label, data) => {
    const { progress, complete, row, job, files } = setup()
    await progress('script', { payload: scriptOf('from progress') })

    await complete(scriptOf('final'), { video: file('video', data) })

    expect(getJob(testDb.db, job.id)).toMatchObject({ status: 'failed' })
    expect(getJob(testDb.db, job.id)!.error).toMatch(/^handler_failed.*not an MP4/)
    expect(row()!.videoPath).toBeNull()
    expect(JSON.parse(row()!.videoScriptJson!)).toEqual(scriptOf('from progress').script) // not replaced
    expect(files()).toEqual([])
  })

  it('checks everything before writing: a bad storyboard stops a good video from being saved', async () => {
    const { complete, row, job, files } = setup()

    await complete(scriptOf('x'), { video: file('video', mp4()), storyboard: file('storyboard', Buffer.from('<html>')) })

    expect(getJob(testDb.db, job.id)!.error).toMatch(/^handler_failed.*storyboard/)
    expect(row()!.videoPath).toBeNull()
    expect(files()).toEqual([])
  })

  it('fails the job, leaving no file, when the generation was deleted while the video ran', async () => {
    const { complete, job, files } = setup()
    testDb.db.delete(generations).where(eq(generations.id, 'gen_1')).run()

    await complete(scriptOf('x'), { video: file('video', mp4()) })

    expect(getJob(testDb.db, job.id)!.error).toMatch(/^handler_failed.*generation not found/)
    expect(files()).toEqual([])
  })

  it('removes both files when the generation disappears while they are being written', async () => {
    const { job, files } = setup()
    const handler = createVideoResultHandler({ db: testDb.db, mediaDir: testMedia.dir })

    const pending = handler.onCompleted({
      job: getJob(testDb.db, job.id)!,
      stage: 'video',
      payload: scriptOf('x'),
      files: { video: file('video', mp4()), storyboard: file('storyboard', padded(PNG_HEAD)) }
    })
    testDb.db.delete(generations).where(eq(generations.id, 'gen_1')).run()

    await expect(pending).rejects.toThrow(/generation not found/)
    expect(files()).toEqual([])
  })

  it('fails the job when it has no generation', async () => {
    const { complete, job } = setup({ withGeneration: false })
    await complete(scriptOf('x'), { video: file('video', mp4()) })
    expect(getJob(testDb.db, job.id)!.error).toMatch(/^handler_failed.*no generation/)
  })

  it('overwrites the video of an earlier attempt', async () => {
    const { complete, folder } = setup()
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'video.mp4'), 'old')

    const fresh = mp4(500, 1)
    await complete(scriptOf('x'), { video: file('video', fresh) })

    expect(readFileSync(join(folder, 'video.mp4')).equals(fresh)).toBe(true)
  })
})
