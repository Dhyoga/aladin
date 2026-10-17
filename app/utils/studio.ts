import { MAX_GENERATION_PHOTOS } from '../../shared/schemas/generation'

/** What Copy caption puts on the clipboard: the caption, an empty line, then the hashtags. */
export function captionToClipboard(caption: string, hashtags: readonly string[] | null): string {
  const tags = (hashtags ?? []).join(' ')
  return tags ? `${caption}\n\n${tags}` : caption
}

const MEDIA_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'mp4'])

/**
 * A safe file name for a download: brand name, generation id, an optional suffix such as
 * `-storyboard`, and the extension of the file itself.
 */
export function downloadName(brandName: string, generationId: string, fileUrl: string, suffix = ''): string {
  const slug = brandName
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')

  const extension = fileUrl.split('?')[0]?.split('.').pop()?.toLowerCase() ?? ''
  return `${slug || 'post'}-${generationId}${suffix}.${MEDIA_EXTENSIONS.has(extension) ? extension : 'png'}`
}

/**
 * The photos for Regenerate: the ones of the original that still exist (photos can be
 * deleted afterwards), at most 3; when none are left, the first photo of the brand.
 */
export function regeneratePhotoIds(sourceIds: readonly string[], currentPhotoIds: readonly string[]): string[] {
  const current = new Set(currentPhotoIds)
  const kept = sourceIds.filter(id => current.has(id)).slice(0, MAX_GENERATION_PHOTOS)
  if (kept.length > 0) return kept
  const first = currentPhotoIds[0]
  return first ? [first] : []
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** A short relative time for the history: "just now", "5 min ago", "3 h ago", "2 d ago", then a date. */
export function timeAgo(timestamp: number, now = Date.now()): string {
  const elapsed = Math.max(0, now - timestamp)
  if (elapsed < MINUTE) return 'just now'
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min ago`
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} h ago`
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)} d ago`
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(timestamp)
}

/**
 * What the user reads when something failed. Codes from the pipeline (`dispatch_failed: n8n
 * responded 500`, `handler_failed: …`, `timeout`) mean nothing to them, so they are turned into
 * a sentence; a reason that already is a sentence (from n8n or the mock) is kept.
 */
function friendlyError(error: string | null | undefined, words: { generic: string, unreachable: string, notSaved: string }): string {
  const text = (error ?? '').trim()
  if (text === '' || text === 'no_result_handler' || text === 'unknown_error') return words.generic
  if (text === 'timeout') return 'It took too long, so it was stopped.'
  if (text.startsWith('dispatch_failed')) return words.unreachable
  if (text.startsWith('handler_failed')) return words.notSaved
  if (text.startsWith('invalid_payload')) return 'The result came back in a form we could not use.'
  return text.length > 200 ? `${text.slice(0, 197)}…` : text
}

/** The reason shown when a post could not be created. */
export function friendlyGenerationError(error: string | null | undefined): string {
  return friendlyError(error, {
    generic: 'Something went wrong while creating this post.',
    unreachable: 'The generation service could not be reached.',
    notSaved: 'The finished post could not be saved.'
  })
}

/** The reason shown when a video could not be created. */
export function friendlyVideoError(error: string | null | undefined): string {
  return friendlyError(error, {
    generic: 'Something went wrong while creating this video.',
    unreachable: 'The video service could not be reached.',
    notSaved: 'The finished video could not be saved.'
  })
}

/** A scene's time range for the script, e.g. `0–2 s` or `2.5–4 s`. */
export function sceneRange(start: number, end: number): string {
  const format = (seconds: number) => (Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1))
  return `${format(start)}–${format(end)} s`
}
