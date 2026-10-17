import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BrandDNA } from '../../shared/schemas/brand-dna'
import { dnaToForm, formToDna, splitLines, splitTokens } from '../../app/utils/brand-dna-form'

const fixture = BrandDNA.parse(JSON.parse(readFileSync(new URL('../../server/fixtures/brand-dna.json', import.meta.url), 'utf8')))

describe('splitLines / splitTokens', () => {
  it('splits sentences by line only, keeping commas', () => {
    expect(splitLines('Murah, cepat\n\n  Mudah dipakai  \r\nAman')).toEqual(['Murah, cepat', 'Mudah dipakai', 'Aman'])
  })

  it('splits tokens by comma or line and drops blanks', () => {
    expect(splitTokens('#a, #b\n#c,, ,')).toEqual(['#a', '#b', '#c'])
    expect(splitTokens('')).toEqual([])
  })
})

describe('dnaToForm / formToDna', () => {
  it('round-trips a full DNA without losing or inventing anything', () => {
    const result = formToDna(dnaToForm(fixture))
    expect(result).toEqual({ ok: true, dna: fixture })
  })

  it('builds an empty form from no DNA and no name without throwing (the dialog does this on setup)', () => {
    const form = dnaToForm(null)
    expect(form.identity.name).toBe('')
    expect(form.offer.features).toEqual([])
    // an empty form is a valid form, but not valid DNA yet
    expect(formToDna(form).ok).toBe(false)
  })

  it('builds an empty form from no DNA, using the brand name', () => {
    const form = dnaToForm(null, 'Warung Kita')
    expect(form.identity.name).toBe('Warung Kita')
    expect(form.identity.website).toBe('')
    expect(form.offer.features).toEqual([])
    expect(form.voice).toMatchObject({ addressing: 'kamu', contentLanguage: 'id', emojiLevel: 'light' })
  })

  it('turns empty optional fields into absent ones (an empty website is not a valid URL)', () => {
    const form = dnaToForm(null, 'Warung Kita')
    form.identity.summary = 'Ringkasan'
    form.audience.targetAudience = 'Semua orang'
    form.voice.toneOfVoice = 'Santai'

    const result = formToDna(form)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.dna.identity).toEqual({ name: 'Warung Kita', summary: 'Ringkasan' })
    // what actually goes over the wire has no website key at all
    expect(JSON.parse(JSON.stringify(result.dna.identity))).toEqual({ name: 'Warung Kita', summary: 'Ringkasan' })
    expect(result.dna.notes).toBeUndefined()
  })

  it('reports a missing name in plain words', () => {
    const form = dnaToForm(fixture)
    form.identity.name = '   '
    const result = formToDna(form)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.join(' ')).toMatch(/Brand name/)
  })

  it('reports a bad website and bad colors once each, readably', () => {
    const form = dnaToForm(fixture)
    form.identity.website = 'not a url'
    form.visual.colors = '#123456, red, #fff'
    const result = formToDna(form)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.filter(e => e.startsWith('Website'))).toHaveLength(1)
    expect(result.errors.filter(e => e.startsWith('Colors'))).toEqual(['Colors: use 6-digit hex codes such as #F97316'])
  })

  it('drops feature rows without a name and keeps the others', () => {
    const form = dnaToForm(fixture)
    form.offer.features.push({ name: '  ', description: 'half typed', tier: 'variety' })
    form.offer.features[0]!.name = '  Single Origin  '

    const result = formToDna(form)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.dna.offer.features).toHaveLength(fixture.offer.features.length)
    expect(result.dna.offer.features[0]!.name).toBe('Single Origin')
  })

  it('parses list boxes: lines for sentences, commas for tokens', () => {
    const form = dnaToForm(fixture)
    form.audience.painPoints = 'Mahal, rumit\nSulit dicari'
    form.social.defaultHashtags = '#a, #b'
    form.visual.colors = '#ABCDEF'

    const result = formToDna(form)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.dna.audience.painPoints).toEqual(['Mahal, rumit', 'Sulit dicari'])
    expect(result.dna.social.defaultHashtags).toEqual(['#a', '#b'])
    expect(result.dna.visual.colors).toEqual(['#ABCDEF'])
  })
})
