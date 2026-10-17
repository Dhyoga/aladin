import { describe, expect, it } from 'vitest'
import { BrandDNA } from '../../shared/schemas/brand-dna'

const minimal = {
  identity: { name: 'Contoh', summary: 'Ringkasan.' },
  audience: { targetAudience: 'Mahasiswa' },
  voice: { toneOfVoice: 'Santai' },
  offer: {},
  visual: {},
  social: {}
}

const paths = (result: ReturnType<typeof BrandDNA.safeParse>) =>
  result.success ? [] : result.error.issues.map(issue => issue.path.join('.'))

describe('BrandDNA', () => {
  it('accepts a minimal Brand DNA', () => {
    expect(BrandDNA.safeParse(minimal).success).toBe(true)
  })

  it('fails with a path when a required field is missing', () => {
    const { name: _omit, ...identity } = minimal.identity
    const result = BrandDNA.safeParse({ ...minimal, identity })
    expect(result.success).toBe(false)
    expect(paths(result)).toContain('identity.name')
  })

  it('rejects an empty name', () => {
    expect(BrandDNA.safeParse({ ...minimal, identity: { ...minimal.identity, name: '' } }).success).toBe(false)
  })

  it('fills defaults', () => {
    const parsed = BrandDNA.parse(minimal)
    expect(parsed.voice).toMatchObject({ addressing: 'kamu', contentLanguage: 'id', emojiLevel: 'light', wordsToUse: [], wordsToAvoid: [] })
    expect(parsed.audience.painPoints).toEqual([])
    expect(parsed.offer).toMatchObject({ keyBenefits: [], features: [] })
    expect(parsed.visual).toEqual({ colors: [], fonts: [], styleKeywords: [], avoid: [] })
    expect(parsed.social.defaultHashtags).toEqual([])
  })

  it('rejects an invalid feature tier with the full path', () => {
    const result = BrandDNA.safeParse({
      ...minimal,
      offer: { features: [{ name: 'A', description: 'B', tier: 'premium' }] }
    })
    expect(paths(result)).toContain('offer.features.0.tier')
  })

  it('accepts every tier', () => {
    const features = (['anchor', 'supporting', 'variety'] as const).map(tier => ({ name: tier, description: '', tier }))
    expect(BrandDNA.safeParse({ ...minimal, offer: { features } }).success).toBe(true)
  })

  it.each(['red', '#fff', '#12345', '#GGGGGG', 'F97316'])('rejects the color %s', (color) => {
    expect(BrandDNA.safeParse({ ...minimal, visual: { colors: [color] } }).success).toBe(false)
  })

  it('accepts valid colors and website', () => {
    const result = BrandDNA.safeParse({
      ...minimal,
      identity: { ...minimal.identity, website: 'https://example.com' },
      visual: { colors: ['#F97316', '#0a0a0a'] }
    })
    expect(result.success).toBe(true)
  })

  it('rejects an invalid website with its path', () => {
    const result = BrandDNA.safeParse({ ...minimal, identity: { ...minimal.identity, website: 'not a url' } })
    expect(paths(result)).toContain('identity.website')
  })

  it('rejects unsupported voice enums', () => {
    expect(BrandDNA.safeParse({ ...minimal, voice: { toneOfVoice: 'x', addressing: 'bro' } }).success).toBe(false)
    expect(BrandDNA.safeParse({ ...minimal, voice: { toneOfVoice: 'x', contentLanguage: 'fr' } }).success).toBe(false)
    expect(BrandDNA.safeParse({ ...minimal, voice: { toneOfVoice: 'x', emojiLevel: 'lots' } }).success).toBe(false)
  })
})
