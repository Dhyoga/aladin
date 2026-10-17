import { createError, getRequestHeader, type H3Event } from 'h3'
import type { RawPart } from './job-callback'

export interface UploadFile {
  /** The form field name (e.g. `files`, `file`). */
  name: string
  /** The name the client sent. Untrusted: never use it to build a path. */
  filename: string
  data: Buffer
}

export interface ParsedUpload {
  fields: Record<string, string>
  files: UploadFile[]
}

/**
 * Splits multipart parts into text fields (no filename) and files (with a filename).
 * A browser sends an empty file part when no file was chosen; that part is dropped.
 */
export function parseUploadParts(parts: RawPart[]): ParsedUpload {
  const fields: Record<string, string> = {}
  const files: UploadFile[] = []

  for (const part of parts) {
    if (!part.name) continue
    if (part.filename === undefined) {
      fields[part.name] = part.data.toString('utf8')
    } else if (!(part.filename === '' && part.data.length === 0)) {
      files.push({ name: part.name, filename: part.filename, data: part.data })
    }
  }

  return { fields, files }
}

/**
 * Answers 413 when the declared Content-Length is over `maxBytes`, before the body is read.
 * A missing Content-Length (chunked) passes; callers still check the real sizes afterwards.
 */
export function rejectIfTooLarge(event: H3Event, maxBytes: number): void {
  const declared = Number(getRequestHeader(event, 'content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw createError({ statusCode: 413, statusMessage: 'Payload Too Large' })
  }
}
