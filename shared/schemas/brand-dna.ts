import { z } from 'zod'

export const Feature = z.object({
  name: z.string(),
  description: z.string(),
  tier: z.enum(['anchor', 'supporting', 'variety'])
})

// Logo and product photos are not part of this schema; they live in brand_assets.
export const BrandDNA = z.object({
  identity: z.object({
    name: z.string().min(1),
    website: z.url().optional(),
    tagline: z.string().optional(),
    summary: z.string(), // 2-5 sentences
    category: z.string().optional(), // e.g. "browser extension", "minuman"
    instagramHandle: z.string().optional()
  }),
  audience: z.object({
    targetAudience: z.string(),
    region: z.string().optional(), // e.g. "Indonesia"
    painPoints: z.array(z.string()).default([])
  }),
  voice: z.object({
    toneOfVoice: z.string(),
    addressing: z.enum(['kamu', 'Anda', 'kalian', 'lo']).default('kamu'),
    contentLanguage: z.enum(['id', 'en']).default('id'),
    emojiLevel: z.enum(['none', 'light', 'heavy']).default('light'),
    wordsToUse: z.array(z.string()).default([]),
    wordsToAvoid: z.array(z.string()).default([])
  }),
  offer: z.object({
    keyBenefits: z.array(z.string()).default([]),
    features: z.array(Feature).default([]),
    featureSamplingGuidance: z.string().optional(),
    defaultCta: z.string().optional(), // e.g. "Install gratis di Chrome"
    priceOrPromo: z.string().optional()
  }),
  visual: z.object({
    colors: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).default([]),
    fonts: z.array(z.string()).default([]),
    styleKeywords: z.array(z.string()).default([]), // e.g. "natural light", "minimalis"
    avoid: z.array(z.string()).default([]) // e.g. "tanpa orang", "tanpa neon"
  }),
  social: z.object({
    defaultHashtags: z.array(z.string()).default([])
  }),
  notes: z.string().optional() // free-form note from the user
})

export type BrandDNA = z.infer<typeof BrandDNA>
export type Feature = z.infer<typeof Feature>
