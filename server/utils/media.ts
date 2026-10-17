import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import {
  createError,
  getRequestHeader,
  send,
  sendStream,
  setResponseHeader,
  setResponseStatus,
  type H3Event
} from 'h3'

/** Thrown by `resolveMediaPath` for any path that must not be served. */
export class MediaPathError extends Error {}

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf'
}

export function contentTypeFor(file: string): string {
  return CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * Maps a request path (still percent-encoded) to an absolute file inside
 * `mediaDir`. Rejects null bytes, `..` segments and anything that resolves
 * outside `mediaDir` (including sibling folders sharing the same prefix).
 */
export function resolveMediaPath(mediaDir: string, relPath: string): string {
  let decoded: string
  try {
    decoded = decodeURIComponent(relPath)
  } catch {
    throw new MediaPathError('Invalid path encoding')
  }
  if (decoded.includes('\0')) throw new MediaPathError('Invalid path')

  const segments = decoded.split(/[\\/]+/).filter(Boolean)
  if (segments.includes('..')) throw new MediaPathError('Invalid path')

  const root = resolve(mediaDir)
  const full = resolve(root, ...segments)
  if (full !== root && !full.startsWith(root + sep)) throw new MediaPathError('Invalid path')
  return full
}

export type ParsedRange
  = | { kind: 'none' }
    | { kind: 'unsatisfiable' }
    | { kind: 'range', start: number, end: number }

/**
 * Parses a single `Range: bytes=...` header against a file of `size` bytes.
 * Multiple ranges and malformed headers are ignored (`none`), so the caller
 * falls back to a full 200 response.
 */
export function parseRange(header: string | undefined, size: number): ParsedRange {
  if (!header) return { kind: 'none' }

  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim())
  if (!match) return { kind: 'none' }

  const [, startStr = '', endStr = ''] = match
  if (startStr === '' && endStr === '') return { kind: 'none' }

  // Suffix range: the last N bytes.
  if (startStr === '') {
    const length = Number(endStr)
    if (!Number.isSafeInteger(length)) return { kind: 'none' }
    if (length === 0 || size === 0) return { kind: 'unsatisfiable' }
    return { kind: 'range', start: Math.max(size - length, 0), end: size - 1 }
  }

  const start = Number(startStr)
  if (!Number.isSafeInteger(start)) return { kind: 'none' }

  let end = size - 1
  if (endStr !== '') {
    const requestedEnd = Number(endStr)
    if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) return { kind: 'none' }
    end = Math.min(requestedEnd, size - 1)
  }

  if (start >= size) return { kind: 'unsatisfiable' }
  return { kind: 'range', start, end }
}

/**
 * Serves `relPath` (relative to `mediaDir`) with Range support, streaming the
 * file instead of loading it into memory.
 */
export async function serveMedia(event: H3Event, mediaDir: string, relPath: string) {
  let file: string
  try {
    file = resolveMediaPath(mediaDir, relPath)
  } catch (error) {
    if (error instanceof MediaPathError) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid media path' })
    }
    throw error
  }

  const info = await stat(file).catch(() => null)
  if (!info?.isFile()) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  const size = info.size
  setResponseHeader(event, 'Accept-Ranges', 'bytes')
  setResponseHeader(event, 'Content-Type', contentTypeFor(file))
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')
  setResponseHeader(event, 'Last-Modified', info.mtime.toUTCString())
  setResponseHeader(event, 'Cache-Control', 'private, max-age=300')

  const range = parseRange(getRequestHeader(event, 'range'), size)

  if (range.kind === 'unsatisfiable') {
    setResponseStatus(event, 416)
    setResponseHeader(event, 'Content-Range', `bytes */${size}`)
    return send(event, '')
  }

  if (range.kind === 'range') {
    setResponseStatus(event, 206)
    setResponseHeader(event, 'Content-Range', `bytes ${range.start}-${range.end}/${size}`)
    setResponseHeader(event, 'Content-Length', range.end - range.start + 1)
    return sendStream(event, createReadStream(file, { start: range.start, end: range.end }))
  }

  setResponseHeader(event, 'Content-Length', size)
  return sendStream(event, createReadStream(file))
}
