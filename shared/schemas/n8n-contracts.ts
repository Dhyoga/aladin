import { z } from 'zod'
import { BrandDNA } from './brand-dna'
import type { JobType } from './job'

// Wire format between the app and n8n (design.md section 8). Field names are snake_case.
// These schemas are the single source of truth: the request builder, the callback
// handler, the mock and the tests all use them.

// ---------- App -> n8n (webhook) ----------

export const N8N_WEBHOOK_PATHS = {
  brand_extract: 'aladin-brand-extract',
  post: 'aladin-post-generate',
  video: 'aladin-video-generate'
} as const satisfies Record<JobType, string>

export const WebhookEnvelope = z.object({
  job_id: z.string().min(1),
  callback_url: z.url(),
  asset_base_url: z.url()
})

export const AssetRef = z.object({
  id: z.string().min(1),
  kind: z.enum(['logo', 'product_photo']),
  mime: z.string().min(1),
  label: z.string().optional()
})

export const BrandExtractRequest = z.discriminatedUnion('source_type', [
  WebhookEnvelope.extend({ source_type: z.literal('url'), url: z.url() }),
  WebhookEnvelope.extend({ source_type: z.literal('pdf'), pdf_asset_id: z.string().min(1) })
])

export const PostAspectRatio = z.enum(['1:1', '4:5'])

export const PostRequest = WebhookEnvelope.extend({
  brand_dna: BrandDNA,
  prompt: z.string().min(1).max(2000),
  aspect_ratio: PostAspectRatio,
  assets: z.array(AssetRef).max(4)
})

export const VideoRequest = WebhookEnvelope.extend({
  brand_dna: BrandDNA,
  prompt: z.string().min(1).max(2000),
  post: z.object({ caption: z.string(), hashtags: z.array(z.string()) }),
  assets: z.array(AssetRef).max(4),
  duration_seconds: z.literal(10),
  aspect_ratio: z.literal('9:16')
})

export const WEBHOOK_REQUEST_SCHEMAS = {
  brand_extract: BrandExtractRequest,
  post: PostRequest,
  video: VideoRequest
} as const

// ---------- n8n -> App (callback) ----------

export const CALLBACK_EVENTS = ['progress', 'completed', 'failed'] as const

export const CallbackFields = z.object({
  job_id: z.string().min(1),
  event: z.enum(CALLBACK_EVENTS),
  // Free-form so n8n can add stages without an app change; JOB_STAGES lists the ones the UI knows.
  stage: z.string().min(1).max(50).optional(),
  payload: z.string().optional(),
  error: z.string().optional()
})

export const JOB_STAGES = {
  brand_extract: ['crawling', 'reading', 'structuring'],
  post: ['caption', 'image'],
  video: ['script', 'storyboard', 'video']
} as const satisfies Record<JobType, readonly string[]>

export const CALLBACK_FILE_FIELDS = ['logo', 'image', 'storyboard', 'video'] as const
export type CallbackFileField = (typeof CALLBACK_FILE_FIELDS)[number]

const MB = 1024 * 1024

export const CALLBACK_FILE_LIMITS_BYTES: Record<CallbackFileField, number> = {
  logo: 10 * MB,
  image: 20 * MB,
  storyboard: 20 * MB,
  video: 100 * MB
}

export const MAX_CALLBACK_REQUEST_BYTES = 130 * MB

/** Files a `completed` callback must carry, per job type. */
export const REQUIRED_COMPLETED_FILES = {
  brand_extract: [],
  post: ['image'],
  video: ['video']
} as const satisfies Record<JobType, readonly CallbackFileField[]>

// ---------- Completed / progress payloads ----------

export const BrandExtractCompleted = z.object({ brand_dna: BrandDNA })

export const ImageBrief = z.looseObject({
  headline: z.string(),
  subheadline: z.string().optional(),
  chips: z.array(z.string()).max(3).default([]),
  scene: z.string(),
  layout_notes: z.string().optional()
})

export const PostCompleted = z.object({
  caption: z.string().min(1),
  hashtags: z.array(z.string()),
  image_brief: ImageBrief
})

export const VideoScene = z
  .object({
    start: z.number(),
    end: z.number(),
    visual: z.string(),
    on_screen_text: z.string().optional(),
    voice_over: z.string()
  })
  .refine(scene => scene.end > scene.start, { path: ['end'], message: 'end must be greater than start' })

export const VideoScript = z.object({ scenes: z.array(VideoScene).min(1) })

export const VideoCompleted = z.object({ script: VideoScript })

export const COMPLETED_PAYLOAD_SCHEMAS = {
  brand_extract: BrandExtractCompleted,
  post: PostCompleted,
  video: VideoCompleted
} as const

export type CompletedPayloadByType = {
  [T in JobType]: z.infer<(typeof COMPLETED_PAYLOAD_SCHEMAS)[T]>
}

export type WebhookRequestByType = {
  [T in JobType]: z.infer<(typeof WEBHOOK_REQUEST_SCHEMAS)[T]>
}
