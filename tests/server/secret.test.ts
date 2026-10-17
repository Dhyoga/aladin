import { createApp, eventHandler, toWebHandler } from 'h3'
import { describe, expect, it, vi } from 'vitest'
import { createHandlerRegistry } from '../../server/utils/job-handlers'
import { assertInternalRequest, safeEqualSecret } from '../../server/utils/secret'

const SECRET = 'a-very-long-shared-secret-of-32-chars!'

describe('safeEqualSecret', () => {
  it('accepts equal secrets', () => {
    expect(safeEqualSecret(SECRET, SECRET)).toBe(true)
  })

  it('rejects different secrets, prefixes, longer values and empty strings', () => {
    expect(safeEqualSecret('nope', SECRET)).toBe(false)
    expect(safeEqualSecret(SECRET.slice(0, 10), SECRET)).toBe(false)
    expect(safeEqualSecret(`${SECRET}x`, SECRET)).toBe(false)
    expect(safeEqualSecret('', SECRET)).toBe(false)
  })

  it('compares by value only, so callers must reject empty secrets themselves', () => {
    // assertInternalRequest does: an empty header is a 401 (see below)
    expect(safeEqualSecret('', '')).toBe(true)
  })
})

describe('assertInternalRequest', () => {
  const app = createApp()
  app.use(eventHandler((event) => {
    assertInternalRequest(event, SECRET)
    return 'ok'
  }))
  const handle = toWebHandler(app)
  const call = (headers: Record<string, string>) =>
    handle(new Request('http://localhost/', { headers }))

  it('lets a request with the right secret through', async () => {
    const res = await call({ 'x-aladin-secret': SECRET })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('ok')
  })

  it('answers 401 for a missing secret', async () => {
    expect((await call({})).status).toBe(401)
  })

  it('answers 401 for a wrong secret and for a prefix of the real one', async () => {
    expect((await call({ 'x-aladin-secret': 'wrong' })).status).toBe(401)
    expect((await call({ 'x-aladin-secret': SECRET.slice(0, 12) })).status).toBe(401)
  })

  it('answers 401 for an empty secret header', async () => {
    expect((await call({ 'x-aladin-secret': '' })).status).toBe(401)
  })

  it('answers 404 when the request went through the public proxy, even with the right secret', async () => {
    const res = await call({ 'x-aladin-secret': SECRET, 'x-forwarded-host': 'aladin.serdadu.dev' })
    expect(res.status).toBe(404)
  })
})

describe('handler registry', () => {
  it('returns undefined when nothing is registered', () => {
    expect(createHandlerRegistry().get('post')).toBeUndefined()
  })

  it('returns the registered handler per type', () => {
    const registry = createHandlerRegistry()
    const post = { onCompleted: vi.fn() }
    const video = { onCompleted: vi.fn() }
    registry.register('post', post)
    registry.register('video', video)

    expect(registry.get('post')).toBe(post)
    expect(registry.get('video')).toBe(video)
    expect(registry.get('brand_extract')).toBeUndefined()
  })

  it('replaces the handler when registering the same type twice', () => {
    const registry = createHandlerRegistry()
    const first = { onCompleted: vi.fn() }
    const second = { onCompleted: vi.fn() }
    registry.register('post', first)
    registry.register('post', second)

    expect(registry.get('post')).toBe(second)
  })
})
