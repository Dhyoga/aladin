import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { brands, generations, jobs } from '../../server/db/schema'
import { form, png, useBrandApi } from './brand-api-harness'

const api = useBrandApi()

interface Video {
  status: string
  stage: string | null
  error: string | null
  jobId: string
  script: { scenes: { start: number, end: number, visual: string, voice_over: string }[] } | null
  storyboardUrl: string | null
  videoUrl: string | null
}
interface Generation { id: string, status: string, caption: string | null, video: Video | null }
interface ErrorBody { statusCode: number, message: string }
interface Brand { id: string }
interface Asset { id: string }

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) })
})

/** A ready brand with a logo and photos, and a post that the mock pipeline has finished. */
async function finishedPost(promptSuffix = '') {
  const brand = (await api.post('/api/brands', form({ source_type: 'manual', name: 'Kopi Senja' }))).body as unknown as Brand
  const photos = ((await api.post(`/api/brands/${brand.id}/assets`, form({ kind: 'product_photo' }, [1, 2].map(i => ({
    name: 'files', filename: `p${i}.png`, type: 'image/png', data: png(64 + i)
  }))))).body as unknown as { assets: Asset[] }).assets.map(a => a.id)
  await api.post(`/api/brands/${brand.id}/assets`, form({ kind: 'logo' }, [{ name: 'files', filename: 'l.png', type: 'image/png', data: png(90) }]))

  api.useMockPipeline()
  const created = (await api.json<Generation>('/api/generations', json('POST', {
    brandId: brand.id, prompt: `promo ramadan${promptSuffix}`, aspectRatio: '4:5', assetIds: photos
  }))).body
  await expect.poll(async () => (await detail(created.id)).status).toBe('completed')
  return { brandId: brand.id, id: created.id, photos }
}

const detail = async (id: string) => (await api.json<Generation>(`/api/generations/${id}`)).body
const startVideo = (id: string) => api.json<Generation & ErrorBody>(`/api/generations/${id}/video`, { method: 'POST' })
const videoJobs = () => api.db.select().from(jobs).where(eq(jobs.type, 'video')).all()

describe('POST /api/generations/:id/video', () => {
  it('starts a video job for a finished post and answers 201 with the video running', async () => {
    const post = await finishedPost()

    const res = await startVideo(post.id)

    expect(res.status).toBe(201)
    expect(res.body.video).toMatchObject({ status: 'running', error: null, videoUrl: null })
    expect(res.body.status).toBe('completed') // the post is untouched
    expect(videoJobs()).toHaveLength(1)
    expect(videoJobs()[0]).toMatchObject({ generationId: post.id, brandId: post.brandId })
  })

  it('goes to completed, and the script and the video are there with proper media URLs', async () => {
    const post = await finishedPost()
    await startVideo(post.id)

    await expect.poll(async () => (await detail(post.id)).video?.status).toBe('completed')

    const { video } = await detail(post.id)
    expect(video!.script!.scenes.length).toBeGreaterThan(0)
    expect(video!.storyboardUrl).toBe(`/media/generations/${post.id}/storyboard.png`)
    expect(video!.videoUrl).toBe(`/media/generations/${post.id}/video.mp4`)

    const storyboard = await api.fetch(video!.storyboardUrl!)
    expect(storyboard.status).toBe(200)
    expect(storyboard.headers.get('content-type')).toBe('image/png')

    const whole = await api.fetch(video!.videoUrl!)
    expect(whole.status).toBe(200)
    expect(whole.headers.get('content-type')).toBe('video/mp4')
    expect(whole.headers.get('accept-ranges')).toBe('bytes')
    const size = Number(whole.headers.get('content-length'))
    expect(size).toBeGreaterThan(1000)
  })

  it('serves the video in parts, so it can be seeked (Range)', async () => {
    const post = await finishedPost()
    await startVideo(post.id)
    await expect.poll(async () => (await detail(post.id)).video?.status).toBe('completed')
    const url = (await detail(post.id)).video!.videoUrl!

    const part = await api.fetch(url, { headers: { range: 'bytes=0-9' } })
    expect(part.status).toBe(206)
    expect(part.headers.get('content-range')).toMatch(/^bytes 0-9\/\d+$/)
    expect(part.headers.get('content-type')).toBe('video/mp4')
    expect((await part.arrayBuffer()).byteLength).toBe(10)

    const tail = await api.fetch(url, { headers: { range: 'bytes=-100' } })
    expect(tail.status).toBe(206)
    expect((await tail.arrayBuffer()).byteLength).toBe(100)
  })

  it('answers 404 for an unknown generation', async () => {
    expect((await startVideo('gen_ghost')).status).toBe(404)
    expect((await api.json(`/api/generations/${'x'.repeat(65)}/video`, { method: 'POST' })).status).toBe(400)
  })

  it('answers 409 while the post is still running', async () => {
    const brand = (await api.post('/api/brands', form({ source_type: 'manual', name: 'K' }))).body as unknown as Brand
    const photo = ((await api.post(`/api/brands/${brand.id}/assets`, form({ kind: 'product_photo' }, [{ name: 'files', filename: 'p.png', type: 'image/png', data: png() }]))).body as unknown as { assets: Asset[] }).assets[0]!.id
    const running = (await api.json<Generation>('/api/generations', json('POST', { brandId: brand.id, prompt: 'x', aspectRatio: '1:1', assetIds: [photo] }))).body

    const res = await startVideo(running.id)
    expect(res.status).toBe(409)
    expect(res.body.message).toMatch(/post has to be finished first/)
    expect(videoJobs()).toHaveLength(0)
  })

  it('answers 409 while a video is running and once it is done, with readable messages', async () => {
    const post = await finishedPost()
    expect((await startVideo(post.id)).status).toBe(201)

    const duplicate = await startVideo(post.id)
    expect(duplicate.status).toBe(409)
    expect(duplicate.body.message).toMatch(/already being created/)

    await expect.poll(async () => (await detail(post.id)).video?.status).toBe('completed')
    const again = await startVideo(post.id)
    expect(again.status).toBe(409)
    expect(again.body.message).toMatch(/already has a video/)
    expect(videoJobs()).toHaveLength(1)
  })

  it('answers 409 when the brand is not ready any more', async () => {
    const post = await finishedPost()
    api.db.update(brands).set({ status: 'extracting' }).where(eq(brands.id, post.brandId)).run()

    const res = await startVideo(post.id)
    expect(res.status).toBe(409)
    expect(res.body.message).toMatch(/not ready/)
  })

  it('starts exactly one video when two requests arrive at the same moment', async () => {
    const post = await finishedPost()

    const statuses = (await Promise.all([startVideo(post.id), startVideo(post.id)])).map(res => res.status).sort()

    expect(statuses).toEqual([201, 409])
    expect(videoJobs()).toHaveLength(1)
  })
})

describe('a failed video and its retry', () => {
  it('fails when the caption asks for it, shows why, and a retry after fixing the caption completes', async () => {
    const post = await finishedPost()
    expect((await api.patch(`/api/generations/${post.id}`, { caption: 'Caption dengan mock:fail' })).status).toBe(200)

    await startVideo(post.id)
    await expect.poll(async () => (await detail(post.id)).video?.status).toBe('failed')
    expect((await detail(post.id)).video!.error).toMatch(/mock:fail/)

    expect((await api.patch(`/api/generations/${post.id}`, { caption: 'Caption yang benar' })).status).toBe(200)
    const retry = await startVideo(post.id)
    expect(retry.status).toBe(201)
    expect(retry.body.video).toMatchObject({ status: 'running', script: null, storyboardUrl: null })

    await expect.poll(async () => (await detail(post.id)).video?.status).toBe('completed')
    expect(videoJobs()).toHaveLength(2)
  })

  it('a failed video does not touch the post', async () => {
    const post = await finishedPost()
    await api.patch(`/api/generations/${post.id}`, { caption: 'mock:fail' })
    await startVideo(post.id)
    await expect.poll(async () => (await detail(post.id)).video?.status).toBe('failed')

    expect(await detail(post.id)).toMatchObject({ status: 'completed', caption: 'mock:fail' })
  })
})

describe('cleaning up', () => {
  it('deleting the generation removes the video and the storyboard from the disk', async () => {
    const post = await finishedPost()
    await startVideo(post.id)
    await expect.poll(async () => (await detail(post.id)).video?.status).toBe('completed')
    const folder = join(api.mediaDir, 'generations', post.id)
    expect(existsSync(join(folder, 'video.mp4'))).toBe(true)

    expect((await api.fetch(`/api/generations/${post.id}`, { method: 'DELETE' })).status).toBe(204)

    expect(existsSync(folder)).toBe(false)
    expect(api.db.select().from(generations).all()).toHaveLength(0)
  })

  it('deleting the brand removes them too', async () => {
    const post = await finishedPost()
    await startVideo(post.id)
    await expect.poll(async () => (await detail(post.id)).video?.status).toBe('completed')

    expect((await api.fetch(`/api/brands/${post.brandId}`, { method: 'DELETE' })).status).toBe(204)

    expect(existsSync(join(api.mediaDir, 'generations', post.id))).toBe(false)
  })
})
