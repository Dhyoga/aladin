import { describe, expect, it } from 'vitest'
import {
  CALLBACK_FILE_LIMITS_BYTES,
  CallbackFields,
  COMPLETED_PAYLOAD_SCHEMAS,
  JOB_STAGES,
  MAX_CALLBACK_REQUEST_BYTES,
  N8N_WEBHOOK_PATHS,
  REQUIRED_COMPLETED_FILES,
  VideoScript,
  WEBHOOK_REQUEST_SCHEMAS,
  WebhookEnvelope
} from '../../shared/schemas/n8n-contracts'

const envelope = {
  job_id: 'job_1',
  callback_url: 'http://aladin:3000/api/n8n/callback',
  asset_base_url: 'http://aladin:3000/api/internal/assets'
}

const brandDna = {
  identity: { name: 'Contoh', summary: 'Ringkasan.' },
  audience: { targetAudience: 'Mahasiswa' },
  voice: { toneOfVoice: 'Santai' },
  offer: {},
  visual: {},
  social: {}
}

const asset = { id: 'ast_1', kind: 'product_photo', mime: 'image/jpeg', label: 'depan' }

const paths = (result: { success: boolean, error?: { issues: { path: PropertyKey[] }[] } }) =>
  result.error?.issues.map(issue => issue.path.join('.')) ?? []

describe('webhook paths', () => {
  it('maps each job type to its webhook path', () => {
    expect(N8N_WEBHOOK_PATHS).toEqual({
      brand_extract: 'aladin-brand-extract',
      post: 'aladin-post-generate',
      video: 'aladin-video-generate'
    })
  })
})

describe('envelope', () => {
  it('requires callback_url', () => {
    const { callback_url: _omit, ...rest } = envelope
    expect(paths(WebhookEnvelope.safeParse(rest))).toContain('callback_url')
  })

  it('requires valid URLs and a job id', () => {
    expect(WebhookEnvelope.safeParse({ ...envelope, asset_base_url: 'nope' }).success).toBe(false)
    expect(WebhookEnvelope.safeParse({ ...envelope, job_id: '' }).success).toBe(false)
  })
})

describe('brand extract request', () => {
  const schema = WEBHOOK_REQUEST_SCHEMAS.brand_extract

  it('accepts a URL source', () => {
    expect(schema.safeParse({ ...envelope, source_type: 'url', url: 'https://example.com' }).success).toBe(true)
  })

  it('accepts a PDF source with an asset id', () => {
    expect(schema.safeParse({ ...envelope, source_type: 'pdf', pdf_asset_id: 'ast_9' }).success).toBe(true)
  })

  it('rejects a PDF source without an asset id', () => {
    expect(paths(schema.safeParse({ ...envelope, source_type: 'pdf' }))).toContain('pdf_asset_id')
  })

  it('rejects an unknown source type', () => {
    expect(schema.safeParse({ ...envelope, source_type: 'docx' }).success).toBe(false)
  })
})

describe('post request', () => {
  const schema = WEBHOOK_REQUEST_SCHEMAS.post
  const valid = { ...envelope, brand_dna: brandDna, prompt: 'promo', aspect_ratio: '4:5', assets: [asset] }

  it('accepts a valid request', () => {
    expect(schema.safeParse(valid).success).toBe(true)
  })

  it('rejects an unsupported aspect ratio', () => {
    expect(paths(schema.safeParse({ ...valid, aspect_ratio: '16:9' }))).toContain('aspect_ratio')
  })

  it('rejects an empty prompt', () => {
    expect(schema.safeParse({ ...valid, prompt: '' }).success).toBe(false)
  })

  it('rejects more than 4 assets', () => {
    expect(schema.safeParse({ ...valid, assets: Array.from({ length: 5 }, () => asset) }).success).toBe(false)
  })

  it('rejects an invalid Brand DNA', () => {
    expect(schema.safeParse({ ...valid, brand_dna: { identity: {} } }).success).toBe(false)
  })
})

describe('video request', () => {
  const schema = WEBHOOK_REQUEST_SCHEMAS.video
  const valid = {
    ...envelope,
    brand_dna: brandDna,
    prompt: 'iklan',
    post: { caption: 'Halo', hashtags: ['#a'] },
    assets: [asset],
    duration_seconds: 10,
    aspect_ratio: '9:16'
  }

  it('accepts a valid request', () => {
    expect(schema.safeParse(valid).success).toBe(true)
  })

  it('rejects a duration other than 10', () => {
    expect(schema.safeParse({ ...valid, duration_seconds: 15 }).success).toBe(false)
  })

  it('rejects an aspect ratio other than 9:16', () => {
    expect(schema.safeParse({ ...valid, aspect_ratio: '1:1' }).success).toBe(false)
  })
})

describe('callback fields', () => {
  it('accepts an unknown stage name', () => {
    expect(CallbackFields.safeParse({ job_id: 'job_1', event: 'progress', stage: 'anything-new' }).success).toBe(true)
  })

  it('rejects an unknown event', () => {
    expect(paths(CallbackFields.safeParse({ job_id: 'job_1', event: 'done' }))).toContain('event')
  })

  it('rejects a missing or empty job id', () => {
    expect(CallbackFields.safeParse({ event: 'failed' }).success).toBe(false)
    expect(CallbackFields.safeParse({ job_id: '', event: 'failed' }).success).toBe(false)
  })

  it('rejects an over-long stage', () => {
    expect(CallbackFields.safeParse({ job_id: 'j', event: 'progress', stage: 'x'.repeat(51) }).success).toBe(false)
  })

  it('lists the stages the UI knows per job type', () => {
    expect(JOB_STAGES.brand_extract).toEqual(['crawling', 'reading', 'structuring'])
    expect(JOB_STAGES.post).toEqual(['caption', 'image'])
    expect(JOB_STAGES.video).toEqual(['script', 'storyboard', 'video'])
  })
})

describe('completed payloads', () => {
  const scene = { start: 0, end: 2, visual: 'close-up', voice_over: 'Halo' }

  it('accepts a brand extract payload', () => {
    expect(COMPLETED_PAYLOAD_SCHEMAS.brand_extract.safeParse({ brand_dna: brandDna }).success).toBe(true)
  })

  it('accepts a post payload and defaults chips', () => {
    const result = COMPLETED_PAYLOAD_SCHEMAS.post.safeParse({
      caption: 'Halo',
      hashtags: ['#a', '#b'],
      image_brief: { headline: 'Judul', scene: 'meja kayu' }
    })
    expect(result.success).toBe(true)
    expect(result.data?.image_brief.chips).toEqual([])
  })

  it('preserves extra keys in image_brief', () => {
    const result = COMPLETED_PAYLOAD_SCHEMAS.post.parse({
      caption: 'Halo',
      hashtags: [],
      image_brief: { headline: 'J', scene: 's', mood: 'hangat' }
    })
    expect(result.image_brief).toMatchObject({ mood: 'hangat' })
  })

  it('rejects an empty caption and more than 3 chips', () => {
    const brief = { headline: 'J', scene: 's' }
    expect(COMPLETED_PAYLOAD_SCHEMAS.post.safeParse({ caption: '', hashtags: [], image_brief: brief }).success).toBe(false)
    expect(COMPLETED_PAYLOAD_SCHEMAS.post.safeParse({
      caption: 'x',
      hashtags: [],
      image_brief: { ...brief, chips: ['1', '2', '3', '4'] }
    }).success).toBe(false)
  })

  it('accepts a video script and rejects reversed times', () => {
    expect(COMPLETED_PAYLOAD_SCHEMAS.video.safeParse({ script: { scenes: [scene] } }).success).toBe(true)
    expect(VideoScript.safeParse({ scenes: [{ ...scene, start: 4, end: 2 }] }).success).toBe(false)
  })

  it('rejects a video script without scenes', () => {
    expect(COMPLETED_PAYLOAD_SCHEMAS.video.safeParse({ script: { scenes: [] } }).success).toBe(false)
  })
})

describe('callback files', () => {
  it('lists the files each completed callback requires', () => {
    expect(REQUIRED_COMPLETED_FILES).toEqual({ brand_extract: [], post: ['image'], video: ['video'] })
  })

  it('exposes the size limits', () => {
    expect(CALLBACK_FILE_LIMITS_BYTES.video).toBe(104_857_600)
    expect(CALLBACK_FILE_LIMITS_BYTES.logo).toBe(10 * 1024 * 1024)
    expect(CALLBACK_FILE_LIMITS_BYTES.image).toBe(20 * 1024 * 1024)
    expect(CALLBACK_FILE_LIMITS_BYTES.storyboard).toBe(20 * 1024 * 1024)
    expect(MAX_CALLBACK_REQUEST_BYTES).toBe(130 * 1024 * 1024)
  })
})
