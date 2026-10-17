import { describe, expect, it } from 'vitest'
import {
  captionToClipboard,
  downloadName,
  friendlyGenerationError,
  friendlyVideoError,
  regeneratePhotoIds,
  sceneRange,
  timeAgo
} from '../../app/utils/studio'

describe('captionToClipboard', () => {
  it('puts an empty line between the caption and the hashtags', () => {
    expect(captionToClipboard('Halo dunia', ['#a', '#b'])).toBe('Halo dunia\n\n#a #b')
  })

  it('keeps the line breaks of the caption itself', () => {
    expect(captionToClipboard('Baris 1\n\nBaris 2', ['#a'])).toBe('Baris 1\n\nBaris 2\n\n#a')
  })

  it('is only the caption without hashtags', () => {
    expect(captionToClipboard('Halo', [])).toBe('Halo')
    expect(captionToClipboard('Halo', null)).toBe('Halo')
  })
})

describe('downloadName', () => {
  it('uses the brand name, the generation id and the extension of the file', () => {
    expect(downloadName('Kopi Senja', 'gen_abc123', '/media/generations/gen_abc123/post.png')).toBe('kopi-senja-gen_abc123.png')
    expect(downloadName('Kopi Senja', 'gen_1', '/media/generations/gen_1/post.jpg')).toBe('kopi-senja-gen_1.jpg')
    expect(downloadName('Kopi Senja', 'gen_1', '/media/generations/gen_1/post.webp')).toBe('kopi-senja-gen_1.webp')
  })

  it('makes a safe name from odd brand names', () => {
    expect(downloadName('  Café "Müller" / Sons!!  ', 'gen_1', 'x.png')).toBe('cafe-muller-sons-gen_1.png')
    expect(downloadName('../../etc/passwd', 'gen_1', 'x.png')).toBe('etc-passwd-gen_1.png')
  })

  it('falls back to "post" when nothing usable is left', () => {
    expect(downloadName('日本語', 'gen_1', 'x.png')).toBe('post-gen_1.png')
    expect(downloadName('', 'gen_1', 'x.png')).toBe('post-gen_1.png')
    expect(downloadName('!!!', 'gen_1', 'x.png')).toBe('post-gen_1.png')
  })

  it('shortens a very long name without leaving a dash at the cut', () => {
    const name = downloadName(`${'a'.repeat(39)} bbbbbbbb`, 'gen_1', 'x.png')
    expect(name).toBe(`${'a'.repeat(39)}-gen_1.png`)
  })

  it('ignores a query string and falls back to png for an unknown extension', () => {
    expect(downloadName('K', 'gen_1', '/media/x/post.jpg?v=3')).toBe('k-gen_1.jpg')
    expect(downloadName('K', 'gen_1', '/media/x/post.exe')).toBe('k-gen_1.png')
    expect(downloadName('K', 'gen_1', '/media/x/post')).toBe('k-gen_1.png')
  })
})

describe('regeneratePhotoIds', () => {
  it('keeps the photos of the original that still exist, in their order', () => {
    expect(regeneratePhotoIds(['b', 'a'], ['a', 'b', 'c'])).toEqual(['b', 'a'])
  })

  it('drops photos that were deleted since', () => {
    expect(regeneratePhotoIds(['a', 'gone', 'b'], ['a', 'b'])).toEqual(['a', 'b'])
  })

  it('falls back to the first photo of the brand when none of them is left', () => {
    expect(regeneratePhotoIds(['gone1', 'gone2'], ['x', 'y'])).toEqual(['x'])
  })

  it('is empty when the brand has no photos at all', () => {
    expect(regeneratePhotoIds(['a'], [])).toEqual([])
  })

  it('never returns more than 3', () => {
    expect(regeneratePhotoIds(['a', 'b', 'c', 'd'], ['a', 'b', 'c', 'd'])).toEqual(['a', 'b', 'c'])
  })
})

describe('timeAgo', () => {
  const now = 1_800_000_000_000
  const ago = (ms: number) => timeAgo(now - ms, now)

  it.each([
    [0, 'just now'],
    [59_000, 'just now'],
    [60_000, '1 min ago'],
    [5 * 60_000, '5 min ago'],
    [59 * 60_000, '59 min ago'],
    [60 * 60_000, '1 h ago'],
    [23 * 3_600_000, '23 h ago'],
    [24 * 3_600_000, '1 d ago'],
    [6 * 24 * 3_600_000, '6 d ago']
  ])('%d ms ago is "%s"', (ms, expected) => {
    expect(ago(ms)).toBe(expected)
  })

  it('shows a date after a week', () => {
    expect(ago(8 * 24 * 3_600_000)).toMatch(/\d{4}/)
  })

  it('does not go negative when the clock of the server is ahead', () => {
    expect(timeAgo(now + 10_000, now)).toBe('just now')
  })
})

describe('friendlyGenerationError', () => {
  it.each([
    ['timeout', 'It took too long, so it was stopped.'],
    ['dispatch_failed: n8n responded 500', 'The generation service could not be reached.'],
    ['dispatch_failed: n8n request failed: connect ECONNREFUSED', 'The generation service could not be reached.'],
    ['handler_failed: disk full', 'The finished post could not be saved.'],
    ['invalid_payload: caption: Required', 'The result came back in a form we could not use.'],
    ['no_result_handler', 'Something went wrong while creating this post.'],
    ['unknown_error', 'Something went wrong while creating this post.']
  ])('turns %j into a sentence', (code, sentence) => {
    expect(friendlyGenerationError(code)).toBe(sentence)
  })

  it('never shows a status code or a stack to the user', () => {
    for (const code of ['dispatch_failed: n8n responded 500', 'handler_failed: ENOSPC at /app/x.js:12', 'invalid_payload: path 3']) {
      expect(friendlyGenerationError(code)).not.toMatch(/\d{3}|ENOSPC|\.js|path/)
    }
  })

  it('keeps a reason that already is a sentence', () => {
    expect(friendlyGenerationError('Gemini quota exceeded')).toBe('Gemini quota exceeded')
    expect(friendlyGenerationError('Mock failure requested (mock:fail)')).toBe('Mock failure requested (mock:fail)')
    expect(friendlyGenerationError('The generation did not start.')).toBe('The generation did not start.')
  })

  it('has a fallback for an empty reason', () => {
    expect(friendlyGenerationError(null)).toBe('Something went wrong while creating this post.')
    expect(friendlyGenerationError('   ')).toBe('Something went wrong while creating this post.')
    expect(friendlyGenerationError(undefined)).toBe('Something went wrong while creating this post.')
  })

  it('shortens a very long reason', () => {
    const out = friendlyGenerationError('x'.repeat(500))
    expect(out).toHaveLength(198)
    expect(out.endsWith('…')).toBe(true)
  })
})

describe('downloadName for a video and its storyboard', () => {
  it('names the video and the storyboard after the brand and the generation', () => {
    expect(downloadName('Kopi Senja', 'gen_abc', '/media/generations/gen_abc/video.mp4')).toBe('kopi-senja-gen_abc.mp4')
    expect(downloadName('Kopi Senja', 'gen_abc', '/media/generations/gen_abc/storyboard.png', '-storyboard')).toBe('kopi-senja-gen_abc-storyboard.png')
    expect(downloadName('Kopi Senja', 'gen_abc', '/media/generations/gen_abc/storyboard.jpg', '-storyboard')).toBe('kopi-senja-gen_abc-storyboard.jpg')
  })

  it('does not change the name of an image download', () => {
    expect(downloadName('Kopi Senja', 'gen_abc', '/media/generations/gen_abc/post.webp')).toBe('kopi-senja-gen_abc.webp')
  })

  it('still falls back to png for an extension it does not know', () => {
    expect(downloadName('K', 'gen_1', '/media/x/video.mov')).toBe('k-gen_1.png')
  })
})

describe('friendlyVideoError', () => {
  it.each([
    ['timeout', 'It took too long, so it was stopped.'],
    ['dispatch_failed: n8n responded 500', 'The video service could not be reached.'],
    ['handler_failed: the video is not an MP4 file', 'The finished video could not be saved.'],
    ['invalid_payload: scenes: Too small', 'The result came back in a form we could not use.'],
    ['no_result_handler', 'Something went wrong while creating this video.'],
    ['unknown_error', 'Something went wrong while creating this video.']
  ])('turns %j into a sentence about the video', (code, sentence) => {
    expect(friendlyVideoError(code)).toBe(sentence)
  })

  it('never shows a status code or a stack to the user', () => {
    for (const code of ['dispatch_failed: n8n responded 502', 'handler_failed: ENOSPC at /app/x.js:12']) {
      expect(friendlyVideoError(code)).not.toMatch(/\d{3}|ENOSPC|\.js/)
    }
  })

  it('keeps a reason that already is a sentence, and has a fallback for none', () => {
    expect(friendlyVideoError('Mock failure requested (mock:fail)')).toBe('Mock failure requested (mock:fail)')
    expect(friendlyVideoError('Gemini rejected the image: it shows a public figure')).toBe('Gemini rejected the image: it shows a public figure')
    expect(friendlyVideoError(null)).toBe('Something went wrong while creating this video.')
    expect(friendlyVideoError('  ')).toBe('Something went wrong while creating this video.')
  })

  it('does not change the messages about a post', () => {
    expect(friendlyGenerationError('dispatch_failed: x')).toBe('The generation service could not be reached.')
    expect(friendlyGenerationError(null)).toBe('Something went wrong while creating this post.')
  })
})

describe('sceneRange', () => {
  it.each([
    [0, 2, '0–2 s'],
    [2, 4, '2–4 s'],
    [8, 10, '8–10 s'],
    [0.5, 2, '0.5–2 s'],
    [2.5, 4.25, '2.5–4.3 s']
  ])('%d to %d is "%s"', (start, end, expected) => {
    expect(sceneRange(start, end)).toBe(expected)
  })
})
