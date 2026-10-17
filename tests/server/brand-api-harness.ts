import { request as httpRequest, createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { createApp, createRouter, eventHandler, send, setResponseHeader, setResponseStatus, toNodeListener } from 'h3'
import { afterAll, beforeAll, beforeEach, vi, type Mock } from 'vitest'
import { brandRequestHandlers } from '../../server/utils/brand-requests'
import { generationRequestHandlers } from '../../server/utils/generation-requests'
import { createPostResultHandler } from '../../server/utils/post-result'
import { createVideoResultHandler } from '../../server/utils/video-result'
import { createBrandExtractHandler } from '../../server/utils/brand-extraction'
import { applyJobCallback } from '../../server/utils/job-callback'
import { createHandlerRegistry } from '../../server/utils/job-handlers'
import { startJob } from '../../server/utils/job-dispatch'
import { serveMedia } from '../../server/utils/media'
import { createN8nClient, type N8nClient } from '../../server/utils/n8n-client'
import { createFixtureLoader, createMockRunner } from '../../server/utils/n8n-mock'
import { useTestDatabase, useTestMedia } from './helpers'

export const SECRET = 'a-very-long-shared-secret-of-32-chars!'

export const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
export const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0])
export const png = (size = 64, fill = 7) => Buffer.concat([PNG_HEAD, Buffer.alloc(size - PNG_HEAD.length, fill)])
export const jpeg = (size = 64) => Buffer.concat([JPEG_HEAD, Buffer.alloc(size - JPEG_HEAD.length, 9)])
export const pdf = (size = 64) => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(size - 9, 0x20)])

export const validDna = (name = 'Kopi Senja') => ({
  identity: { name, summary: 'Ringkasan' },
  audience: { targetAudience: 'Mahasiswa' },
  voice: { toneOfVoice: 'Santai' },
  offer: {},
  visual: {},
  social: {}
})

interface UploadFile { name: string, filename: string, type: string, data: Buffer }

export function form(fields: Record<string, string> = {}, files: UploadFile[] = []) {
  const body = new FormData()
  for (const [key, value] of Object.entries(fields)) body.set(key, value)
  for (const file of files) body.append(file.name, new Blob([new Uint8Array(file.data)], { type: file.type }), file.filename)
  return body
}

const fixturesLoader = createFixtureLoader(fileURLToPath(new URL('../../server/fixtures', import.meta.url)))

/**
 * A real HTTP server with the brand routes, backed by a fresh database and media folder
 * per test. By default jobs go to a fake n8n that never calls back (so brands stay
 * `extracting` and nothing runs in the background); `useMockPipeline()` switches to the
 * real mock n8n with the real result handler.
 */
export function useBrandApi() {
  const testDb = useTestDatabase()
  const testMedia = useTestMedia()

  const state: { client: N8nClient, dispatch: Mock } = {
    client: { dispatch: async () => {} },
    dispatch: vi.fn(async () => {})
  }
  let server: Server
  let baseUrl = ''

  beforeEach(() => {
    state.dispatch = vi.fn(async () => {})
    state.client = { dispatch: state.dispatch as unknown as N8nClient['dispatch'] }
  })

  const handlers = () => brandRequestHandlers({
    brand: {
      db: testDb.db,
      mediaDir: testMedia.dir,
      dispatch: input => startJob({ db: testDb.db, client: state.client }, input)
    },
    sharedSecret: SECRET
  })

  const generationHandlers = () => generationRequestHandlers({
    db: testDb.db,
    mediaDir: testMedia.dir,
    dispatch: input => startJob({ db: testDb.db, client: state.client }, input)
  })

  beforeAll(async () => {
    // Plain h3 only puts statusCode and statusMessage in an error body. Nitro's error handler
    // also adds `message` (and `data`), which is what the UI reads, so mirror that here.
    const app = createApp({
      onError: (error, event) => {
        setResponseStatus(event, error.statusCode)
        setResponseHeader(event, 'content-type', 'application/json')
        return send(event, JSON.stringify({
          statusCode: error.statusCode,
          statusMessage: error.statusMessage,
          message: error.message,
          data: error.data
        }))
      }
    })
    const router = createRouter()
    router.get('/api/brands', eventHandler(event => handlers().list(event)))
    router.post('/api/brands', eventHandler(event => handlers().create(event)))
    router.get('/api/brands/:id', eventHandler(event => handlers().get(event)))
    router.patch('/api/brands/:id', eventHandler(event => handlers().patch(event)))
    router.delete('/api/brands/:id', eventHandler(event => handlers().remove(event)))
    router.post('/api/brands/:id/re-extract', eventHandler(event => handlers().reExtract(event)))
    router.post('/api/brands/:id/assets', eventHandler(event => handlers().uploadAssets(event)))
    router.patch('/api/brands/:id/assets/:assetId', eventHandler(event => handlers().patchAsset(event)))
    router.delete('/api/brands/:id/assets/:assetId', eventHandler(event => handlers().deleteAsset(event)))
    router.get('/api/generations', eventHandler(event => generationHandlers().list(event)))
    router.post('/api/generations', eventHandler(event => generationHandlers().create(event)))
    router.get('/api/generations/:id', eventHandler(event => generationHandlers().get(event)))
    router.patch('/api/generations/:id', eventHandler(event => generationHandlers().patch(event)))
    router.delete('/api/generations/:id', eventHandler(event => generationHandlers().remove(event)))
    router.post('/api/generations/:id/video', eventHandler(event => generationHandlers().video(event)))
    router.get('/api/internal/assets/:id', eventHandler(event => handlers().internalAsset(event)))
    router.get('/media/**', eventHandler((event) => {
      const rel = (event.path.split('?')[0] ?? '').replace(/^\/media\//, '')
      return serveMedia(event, testMedia.dir, rel)
    }))
    app.use(router)

    server = createServer(toNodeListener(app))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()))
  })

  const api = {
    get url() { return baseUrl },
    get db() { return testDb.db },
    get sqlite() { return testDb.sqlite },
    get mediaDir() { return testMedia.dir },
    get dispatch() { return state.dispatch },

    fetch: (path: string, init?: RequestInit) => fetch(`${baseUrl}${path}`, init),

    async json<T = Record<string, unknown>>(path: string, init?: RequestInit): Promise<{ status: number, body: T, headers: Headers }> {
      const res = await fetch(`${baseUrl}${path}`, init)
      const text = await res.text()
      return { status: res.status, body: (text ? JSON.parse(text) : null) as T, headers: res.headers }
    },

    post: (path: string, body: BodyInit) => api.json(path, { method: 'POST', body }),

    patch: (path: string, body: unknown) => api.json(path, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }),

    /** Sends a request that only declares a huge Content-Length (the body is never sent). */
    declaredLength(path: string, length: number, headers: Record<string, string> = {}): Promise<number> {
      return new Promise((resolve, reject) => {
        const req = httpRequest(`${baseUrl}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'multipart/form-data; boundary=x', 'content-length': String(length), ...headers }
        }, (res) => {
          resolve(res.statusCode ?? 0)
          req.destroy()
        })
        req.on('error', (error) => {
          if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(error)
        })
        req.flushHeaders()
      })
    },

    /** Makes created brands and generations go through the real mock n8n and the real result handlers. */
    useMockPipeline() {
      const registry = createHandlerRegistry()
      registry.register('brand_extract', createBrandExtractHandler({ db: testDb.db, mediaDir: testMedia.dir }))
      registry.register('post', createPostResultHandler({ db: testDb.db, mediaDir: testMedia.dir }))
      registry.register('video', createVideoResultHandler({ db: testDb.db, mediaDir: testMedia.dir }))
      const runner = createMockRunner({
        loadFixture: fixturesLoader,
        sleep: async () => {},
        applyCallback: callback => applyJobCallback({ db: testDb.db, registry }, callback)
      })
      state.client = createN8nClient({
        mode: 'mock', baseUrl: '', secret: 's', appInternalUrl: 'http://localhost:3000', mockRunner: runner
      })
    }
  }
  return api
}

export type BrandApi = ReturnType<typeof useBrandApi>

export const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
