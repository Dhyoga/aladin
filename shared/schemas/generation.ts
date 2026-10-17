import { z } from 'zod'
import { VideoScript } from './n8n-contracts'

export const ASPECT_RATIOS = ['1:1', '4:5'] as const
export type AspectRatio = (typeof ASPECT_RATIOS)[number]
export const DEFAULT_ASPECT_RATIO: AspectRatio = '4:5'

// Limits. One place, so they are easy to change.
export const MAX_PROMPT_LENGTH = 2000 // the n8n contract allows 2000
export const MAX_CAPTION_LENGTH = 2200 // Instagram's own limit
export const MAX_HASHTAGS = 30 // Instagram's own limit
export const MAX_HASHTAG_LENGTH = 100
export const MIN_GENERATION_PHOTOS = 1
export const MAX_GENERATION_PHOTOS = 3
export const GENERATION_HISTORY_LIMIT = 100

/** Estimated cost of one post, shown on the Generate button (design.md section 3). */
export const POST_COST_LABEL = '~$0.04'
/** Estimated cost of one video: about $0.10 per second for 10 seconds (design.md section 3). */
export const VIDEO_COST_LABEL = '~$1'

export const GENERATION_STATUSES = ['running', 'completed', 'failed'] as const
export type GenerationStatus = (typeof GENERATION_STATUSES)[number]

/**
 * Cleans a list of hashtags: trimmed, exactly one leading `#`, no duplicates (ignoring
 * case, first one wins), order kept. Throws when an entry is empty after cleaning, contains
 * whitespace, or is too long, or when there are too many.
 */
export function normalizeHashtags(input: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const raw of input) {
    const word = raw.trim().replace(/^#+/, '')
    if (word === '') throw new Error('A hashtag cannot be empty')
    if (/\s/.test(word)) throw new Error(`A hashtag cannot contain spaces: "${raw.trim()}"`)
    const tag = `#${word}`
    if (tag.length > MAX_HASHTAG_LENGTH) throw new Error(`A hashtag can be at most ${MAX_HASHTAG_LENGTH} characters`)

    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(tag)
  }

  if (result.length > MAX_HASHTAGS) throw new Error(`Use at most ${MAX_HASHTAGS} hashtags`)
  return result
}

const Hashtags = z.array(z.string()).transform((list, ctx) => {
  try {
    return normalizeHashtags(list)
  } catch (error) {
    ctx.addIssue({ code: 'custom', message: error instanceof Error ? error.message : 'Invalid hashtags' })
    return z.NEVER
  }
})

const Caption = z.string().trim().min(1, 'The caption cannot be empty').max(MAX_CAPTION_LENGTH, `The caption can be at most ${MAX_CAPTION_LENGTH} characters`)

export const CreateGenerationBody = z.object({
  brandId: z.string().min(1).max(64),
  prompt: z.string().trim().min(1, 'Write what the post should be about').max(MAX_PROMPT_LENGTH, `The prompt can be at most ${MAX_PROMPT_LENGTH} characters`),
  aspectRatio: z.enum(ASPECT_RATIOS),
  assetIds: z
    .array(z.string().min(1).max(64))
    .min(MIN_GENERATION_PHOTOS, 'Choose at least one product photo')
    .max(MAX_GENERATION_PHOTOS, `Choose at most ${MAX_GENERATION_PHOTOS} product photos`)
    .refine(ids => new Set(ids).size === ids.length, 'Each photo can be chosen only once')
})

export const PatchGenerationBody = z.object({
  caption: Caption.optional(),
  hashtags: Hashtags.optional()
})

export const GenerationListItem = z.object({
  id: z.string(),
  brandId: z.string(),
  prompt: z.string(),
  aspectRatio: z.enum(ASPECT_RATIOS),
  status: z.enum(GENERATION_STATUSES),
  stage: z.string().nullable(),
  imageUrl: z.string().nullable(),
  createdAt: z.number()
})

/**
 * The video of a generation. `null` on the detail means a video was never requested.
 * `script` and `storyboardUrl` appear while the video is still running, as they arrive.
 */
export const VideoDto = z.object({
  status: z.enum(GENERATION_STATUSES),
  stage: z.string().nullable(),
  error: z.string().nullable(),
  jobId: z.string(),
  script: VideoScript.nullable(),
  storyboardUrl: z.string().nullable(),
  videoUrl: z.string().nullable()
})

export const GenerationDetail = GenerationListItem.extend({
  assetIds: z.array(z.string()),
  caption: z.string().nullable(),
  hashtags: z.array(z.string()).nullable(),
  error: z.string().nullable(),
  jobId: z.string().nullable(),
  video: VideoDto.nullable(),
  updatedAt: z.number()
})

export type CreateGenerationBody = z.infer<typeof CreateGenerationBody>
export type PatchGenerationBody = z.infer<typeof PatchGenerationBody>
export type GenerationListItem = z.infer<typeof GenerationListItem>
export type VideoDto = z.infer<typeof VideoDto>
export type GenerationDetail = z.infer<typeof GenerationDetail>
