import { BrandDNA } from '../../shared/schemas/brand-dna'

// The edit form works with plain strings (one text box per list). These helpers convert
// between that and the BrandDNA schema, which is the only thing sent to the server.

export type FeatureTier = 'anchor' | 'supporting' | 'variety'

export interface DnaForm {
  identity: { name: string, website: string, tagline: string, summary: string, category: string, instagramHandle: string }
  audience: { targetAudience: string, region: string, painPoints: string }
  voice: {
    toneOfVoice: string
    addressing: 'kamu' | 'Anda' | 'kalian' | 'lo'
    contentLanguage: 'id' | 'en'
    emojiLevel: 'none' | 'light' | 'heavy'
    wordsToUse: string
    wordsToAvoid: string
  }
  offer: {
    keyBenefits: string
    features: { name: string, description: string, tier: FeatureTier }[]
    featureSamplingGuidance: string
    defaultCta: string
    priceOrPromo: string
  }
  visual: { colors: string, fonts: string, styleKeywords: string, avoid: string }
  social: { defaultHashtags: string }
  notes: string
}

/** One entry per line (for sentences, which may contain commas). */
export const splitLines = (text: string): string[] =>
  text.split(/\r?\n/).map(part => part.trim()).filter(Boolean)

/** Entries separated by commas or new lines (for short tokens such as colors or hashtags). */
export const splitTokens = (text: string): string[] =>
  text.split(/[,\n]/).map(part => part.trim()).filter(Boolean)

const joinLines = (items: string[]) => items.join('\n')
const joinTokens = (items: string[]) => items.join(', ')

/** The form for a brand without a DNA yet. Built directly: an empty name is not valid DNA, but a valid form. */
export function emptyDnaForm(name = ''): DnaForm {
  return {
    identity: { name, website: '', tagline: '', summary: '', category: '', instagramHandle: '' },
    audience: { targetAudience: '', region: '', painPoints: '' },
    voice: {
      toneOfVoice: '',
      addressing: 'kamu',
      contentLanguage: 'id',
      emojiLevel: 'light',
      wordsToUse: '',
      wordsToAvoid: ''
    },
    offer: { keyBenefits: '', features: [], featureSamplingGuidance: '', defaultCta: '', priceOrPromo: '' },
    visual: { colors: '', fonts: '', styleKeywords: '', avoid: '' },
    social: { defaultHashtags: '' },
    notes: ''
  }
}

export function dnaToForm(dna: BrandDNA | null, fallbackName = ''): DnaForm {
  if (!dna) return emptyDnaForm(fallbackName)
  const source = dna

  return {
    identity: {
      name: source.identity.name,
      website: source.identity.website ?? '',
      tagline: source.identity.tagline ?? '',
      summary: source.identity.summary,
      category: source.identity.category ?? '',
      instagramHandle: source.identity.instagramHandle ?? ''
    },
    audience: {
      targetAudience: source.audience.targetAudience,
      region: source.audience.region ?? '',
      painPoints: joinLines(source.audience.painPoints)
    },
    voice: {
      toneOfVoice: source.voice.toneOfVoice,
      addressing: source.voice.addressing,
      contentLanguage: source.voice.contentLanguage,
      emojiLevel: source.voice.emojiLevel,
      wordsToUse: joinTokens(source.voice.wordsToUse),
      wordsToAvoid: joinTokens(source.voice.wordsToAvoid)
    },
    offer: {
      keyBenefits: joinLines(source.offer.keyBenefits),
      features: source.offer.features.map(feature => ({ ...feature })),
      featureSamplingGuidance: source.offer.featureSamplingGuidance ?? '',
      defaultCta: source.offer.defaultCta ?? '',
      priceOrPromo: source.offer.priceOrPromo ?? ''
    },
    visual: {
      colors: joinTokens(source.visual.colors),
      fonts: joinTokens(source.visual.fonts),
      styleKeywords: joinTokens(source.visual.styleKeywords),
      avoid: joinTokens(source.visual.avoid)
    },
    social: { defaultHashtags: joinTokens(source.social.defaultHashtags) },
    notes: source.notes ?? ''
  }
}

/** Empty optional text must be absent, not "": `website: ""` is not a valid URL. */
const optional = (text: string): string | undefined => {
  const trimmed = text.trim()
  return trimmed === '' ? undefined : trimmed
}

export type DnaFormResult
  = | { ok: true, dna: BrandDNA }
    | { ok: false, errors: string[] }

const FIELD_LABELS: Record<string, string> = {
  'identity.name': 'Brand name',
  'identity.website': 'Website',
  'identity.summary': 'Summary',
  'audience.targetAudience': 'Target audience',
  'voice.toneOfVoice': 'Tone of voice',
  'visual.colors': 'Colors'
}

export function formToDna(form: DnaForm): DnaFormResult {
  const parsed = BrandDNA.safeParse({
    identity: {
      name: form.identity.name.trim(),
      website: optional(form.identity.website),
      tagline: optional(form.identity.tagline),
      summary: form.identity.summary.trim(),
      category: optional(form.identity.category),
      instagramHandle: optional(form.identity.instagramHandle)
    },
    audience: {
      targetAudience: form.audience.targetAudience.trim(),
      region: optional(form.audience.region),
      painPoints: splitLines(form.audience.painPoints)
    },
    voice: {
      toneOfVoice: form.voice.toneOfVoice.trim(),
      addressing: form.voice.addressing,
      contentLanguage: form.voice.contentLanguage,
      emojiLevel: form.voice.emojiLevel,
      wordsToUse: splitTokens(form.voice.wordsToUse),
      wordsToAvoid: splitTokens(form.voice.wordsToAvoid)
    },
    offer: {
      keyBenefits: splitLines(form.offer.keyBenefits),
      // A row without a name is an unfinished row, not a feature.
      features: form.offer.features
        .filter(feature => feature.name.trim() !== '')
        .map(feature => ({ name: feature.name.trim(), description: feature.description.trim(), tier: feature.tier })),
      featureSamplingGuidance: optional(form.offer.featureSamplingGuidance),
      defaultCta: optional(form.offer.defaultCta),
      priceOrPromo: optional(form.offer.priceOrPromo)
    },
    visual: {
      colors: splitTokens(form.visual.colors),
      fonts: splitTokens(form.visual.fonts),
      styleKeywords: splitTokens(form.visual.styleKeywords),
      avoid: splitTokens(form.visual.avoid)
    },
    social: { defaultHashtags: splitTokens(form.social.defaultHashtags) },
    notes: optional(form.notes)
  })

  if (parsed.success) return { ok: true, dna: parsed.data }

  const errors = parsed.error.issues.map((issue) => {
    const path = issue.path.join('.')
    const label = FIELD_LABELS[path] ?? (path.startsWith('visual.colors') ? 'Colors' : path)
    return path.startsWith('visual.colors')
      ? `${label}: use 6-digit hex codes such as #F97316`
      : `${label}: ${issue.message}`
  })
  return { ok: false, errors: [...new Set(errors)] }
}
