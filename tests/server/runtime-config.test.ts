import { describe, expect, it } from 'vitest'
import { assertRuntimeConfig } from '../../server/utils/runtime-config'
import { DEFAULT_SHARED_SECRET } from '../../shared/schemas/runtime-config'

const base = {
  databasePath: './data/aladin.db',
  mediaDir: './data/media',
  n8nMode: 'mock',
  n8nBaseUrl: '',
  appInternalUrl: 'http://localhost:3000',
  sharedSecret: DEFAULT_SHARED_SECRET
}

const goodSecret = 'x'.repeat(32)

describe('assertRuntimeConfig', () => {
  it('accepts the local defaults outside production', () => {
    expect(assertRuntimeConfig(base, { production: false })).toMatchObject({ n8nMode: 'mock' })
  })

  it('ignores unrelated keys such as Nuxt internals', () => {
    expect(() => assertRuntimeConfig({ ...base, app: { baseURL: '/' } }, { production: false })).not.toThrow()
  })

  it('rejects an invalid n8nMode and names the key', () => {
    expect(() => assertRuntimeConfig({ ...base, n8nMode: 'banana' }, { production: false }))
      .toThrow(/n8nMode/)
  })

  it('rejects missing keys and names them', () => {
    const { mediaDir: _omit, ...rest } = base
    expect(() => assertRuntimeConfig(rest, { production: false })).toThrow(/mediaDir/)
  })

  it('requires valid URLs in live mode', () => {
    expect(() => assertRuntimeConfig({ ...base, n8nMode: 'live' }, { production: false }))
      .toThrow(/n8nBaseUrl/)
    expect(() => assertRuntimeConfig(
      { ...base, n8nMode: 'live', n8nBaseUrl: 'http://n8n:5678', appInternalUrl: 'http://aladin:3000' },
      { production: false }
    )).not.toThrow()
  })

  describe('production secret', () => {
    it('rejects the default secret', () => {
      expect(() => assertRuntimeConfig(base, { production: true })).toThrow(/NUXT_SHARED_SECRET/)
    })

    it('rejects a 20-character secret', () => {
      expect(() => assertRuntimeConfig({ ...base, sharedSecret: 'x'.repeat(20) }, { production: true }))
        .toThrow(/NUXT_SHARED_SECRET/)
    })

    it('accepts a 32-character non-default secret', () => {
      expect(() => assertRuntimeConfig({ ...base, sharedSecret: goodSecret }, { production: true })).not.toThrow()
    })

    it('accepts the default secret in development', () => {
      expect(() => assertRuntimeConfig(base, { production: false })).not.toThrow()
    })
  })
})
