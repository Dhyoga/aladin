import { describe, expect, it } from 'vitest'
import {
  CreateGenerationBody,
  GenerationDetail,
  VideoDto,
  PatchGenerationBody,
  normalizeHashtags
} from '../../shared/schemas/generation'

const valid = { brandId: 'brd_1', prompt: 'promo ramadan', aspectRatio: '4:5', assetIds: ['ast_1'] }
const issues = (result: { success: boolean, error?: { issues: { path: PropertyKey[] }[] } }) =>
  result.error?.issues.map(issue => issue.path.join('.')) ?? []

describe('CreateGenerationBody', () => {
  it('accepts a valid body and trims the prompt', () => {
    const parsed = CreateGenerationBody.parse({ ...valid, prompt: '  promo ramadan  ' })
    expect(parsed.prompt).toBe('promo ramadan')
  })

  it('accepts a prompt of exactly 2000 characters and rejects 2001', () => {
    expect(CreateGenerationBody.safeParse({ ...valid, prompt: 'x'.repeat(2000) }).success).toBe(true)
    expect(CreateGenerationBody.safeParse({ ...valid, prompt: 'x'.repeat(2001) }).success).toBe(false)
  })

  it.each(['', '   ', '\n\t'])('rejects the prompt %j', (prompt) => {
    expect(issues(CreateGenerationBody.safeParse({ ...valid, prompt }))).toContain('prompt')
  })

  it('accepts both ratios and nothing else', () => {
    expect(CreateGenerationBody.safeParse({ ...valid, aspectRatio: '1:1' }).success).toBe(true)
    expect(issues(CreateGenerationBody.safeParse({ ...valid, aspectRatio: '16:9' }))).toContain('aspectRatio')
    expect(CreateGenerationBody.safeParse({ ...valid, aspectRatio: '9:16' }).success).toBe(false)
  })

  it.each([
    [[], false],
    [['a'], true],
    [['a', 'b', 'c'], true],
    [['a', 'b', 'c', 'd'], false]
  ])('photo ids %j valid=%s', (assetIds, ok) => {
    expect(CreateGenerationBody.safeParse({ ...valid, assetIds }).success).toBe(ok)
  })

  it('rejects the same photo twice', () => {
    expect(issues(CreateGenerationBody.safeParse({ ...valid, assetIds: ['a', 'a'] }))).toContain('assetIds')
  })

  it('rejects a missing brand id', () => {
    const { brandId: _omit, ...rest } = valid
    expect(CreateGenerationBody.safeParse(rest).success).toBe(false)
  })
})

describe('normalizeHashtags', () => {
  it('adds one # and drops extra ones', () => {
    expect(normalizeHashtags(['promo', '#baru', '##lagi'])).toEqual(['#promo', '#baru', '#lagi'])
  })

  it('removes duplicates ignoring case and keeps the first spelling and the order', () => {
    expect(normalizeHashtags(['Promo', 'x', '#promo', '##PROMO'])).toEqual(['#Promo', '#x'])
  })

  it('trims entries', () => {
    expect(normalizeHashtags(['  kopi  '])).toEqual(['#kopi'])
  })

  it.each([[['kopi senja']], [['']], [['#']], [['  ']], [['a\tb']]])('rejects %j', (list) => {
    expect(() => normalizeHashtags(list)).toThrow()
  })

  it('accepts 100 characters including the # and rejects 101', () => {
    expect(normalizeHashtags(['x'.repeat(99)])[0]).toHaveLength(100)
    expect(() => normalizeHashtags(['x'.repeat(100)])).toThrow(/at most 100/)
  })

  it('accepts 30 hashtags and rejects 31', () => {
    const list = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`)
    expect(normalizeHashtags(list(30))).toHaveLength(30)
    expect(() => normalizeHashtags(list(31))).toThrow(/at most 30/)
  })

  it('counts the limit after removing duplicates', () => {
    const list = [...Array.from({ length: 30 }, (_, i) => `t${i}`), 'T0', 't1']
    expect(normalizeHashtags(list)).toHaveLength(30)
  })

  it('handles an empty list', () => {
    expect(normalizeHashtags([])).toEqual([])
  })
})

describe('PatchGenerationBody', () => {
  it('accepts an empty body (nothing to change)', () => {
    expect(PatchGenerationBody.parse({})).toEqual({})
  })

  it('accepts a caption of 2200 characters and rejects 2201', () => {
    expect(PatchGenerationBody.safeParse({ caption: 'x'.repeat(2200) }).success).toBe(true)
    expect(PatchGenerationBody.safeParse({ caption: 'x'.repeat(2201) }).success).toBe(false)
  })

  it.each(['', '   '])('rejects the caption %j', (caption) => {
    expect(issues(PatchGenerationBody.safeParse({ caption }))).toContain('caption')
  })

  it('trims the caption and normalizes the hashtags while parsing', () => {
    expect(PatchGenerationBody.parse({ caption: '  Halo  ', hashtags: ['promo', '#Promo', '##baru'] }))
      .toEqual({ caption: 'Halo', hashtags: ['#promo', '#baru'] })
  })

  it('rejects hashtags with a space and says why', () => {
    const result = PatchGenerationBody.safeParse({ hashtags: ['promo', 'kopi senja'] })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toMatch(/spaces/)
  })

  it('accepts clearing the hashtags with an empty list', () => {
    expect(PatchGenerationBody.parse({ hashtags: [] })).toEqual({ hashtags: [] })
  })
})

describe('GenerationDetail', () => {
  const running = {
    id: 'gen_1',
    brandId: 'brd_1',
    prompt: 'promo',
    aspectRatio: '4:5',
    status: 'running',
    stage: 'caption',
    imageUrl: null,
    createdAt: 1,
    assetIds: ['ast_1'],
    caption: null,
    hashtags: null,
    error: null,
    jobId: 'job_1',
    video: null,
    updatedAt: 1
  }

  it('accepts a generation that is not finished', () => {
    expect(GenerationDetail.safeParse(running).success).toBe(true)
  })

  it('accepts a finished one', () => {
    expect(GenerationDetail.safeParse({
      ...running, status: 'completed', stage: null, caption: 'Halo', hashtags: ['#a'], imageUrl: '/media/generations/gen_1/post.png'
    }).success).toBe(true)
  })

  it('rejects an unknown status', () => {
    expect(GenerationDetail.safeParse({ ...running, status: 'queued' }).success).toBe(false)
  })
})

describe('VideoDto', () => {
  const script = { scenes: [{ start: 0, end: 2, visual: 'close-up', voice_over: 'Halo' }] }
  const base = { status: 'running', stage: 'script', error: null, jobId: 'job_v1', script: null, storyboardUrl: null, videoUrl: null }

  it('accepts a running video with nothing yet', () => {
    expect(VideoDto.safeParse(base).success).toBe(true)
  })

  it('accepts a running video that already has its script and storyboard', () => {
    expect(VideoDto.safeParse({ ...base, stage: 'video', script, storyboardUrl: '/media/generations/g/storyboard.png' }).success).toBe(true)
  })

  it('accepts a completed and a failed video', () => {
    expect(VideoDto.safeParse({ ...base, status: 'completed', stage: null, script, videoUrl: '/media/generations/g/video.mp4' }).success).toBe(true)
    expect(VideoDto.safeParse({ ...base, status: 'failed', stage: null, error: 'timeout' }).success).toBe(true)
  })

  it('rejects an unknown status and a script without scenes', () => {
    expect(VideoDto.safeParse({ ...base, status: 'queued' }).success).toBe(false)
    expect(VideoDto.safeParse({ ...base, script: { scenes: [] } }).success).toBe(false)
  })

  it('is optional on the detail as null, and a detail may carry it', () => {
    const detail = {
      id: 'gen_1', brandId: 'b', prompt: 'p', aspectRatio: '4:5', status: 'completed', stage: null, imageUrl: '/media/x.png',
      createdAt: 1, assetIds: [], caption: 'c', hashtags: [], error: null, jobId: 'job_1', updatedAt: 1
    }
    expect(GenerationDetail.safeParse({ ...detail, video: null }).success).toBe(true)
    expect(GenerationDetail.safeParse({ ...detail, video: base }).success).toBe(true)
    expect(GenerationDetail.safeParse(detail).success).toBe(false) // the field must be present, even when null
  })
})
