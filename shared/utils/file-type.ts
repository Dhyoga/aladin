export type FileType = 'png' | 'jpeg' | 'webp' | 'pdf' | 'mp4'
export type ImageType = Exclude<FileType, 'pdf' | 'mp4'>

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG = [0xff, 0xd8, 0xff]
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d] // %PDF-
const RIFF = [0x52, 0x49, 0x46, 0x46]
const WEBP = [0x57, 0x45, 0x42, 0x50]
const FTYP = [0x66, 0x74, 0x79, 0x70] // "ftyp": the first box of an MP4 (ISO base media file)

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  bytes.length >= offset + signature.length && signature.every((byte, i) => bytes[offset + i] === byte)

/**
 * Detects the type of a file from its first bytes. The name and MIME type sent by the
 * client are never trusted. Returns null for anything that is not PNG, JPEG, WebP, PDF or MP4.
 * Other containers (WebM, AVI, ...) are deliberately not recognized.
 */
export function sniffFileType(bytes: Uint8Array): FileType | null {
  if (startsWith(bytes, PNG)) return 'png'
  if (startsWith(bytes, JPEG)) return 'jpeg'
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) return 'webp'
  if (startsWith(bytes, PDF)) return 'pdf'
  if (startsWith(bytes, FTYP, 4)) return 'mp4'
  return null
}

const MIME: Record<FileType, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  pdf: 'application/pdf',
  mp4: 'video/mp4'
}

const EXTENSION: Record<FileType, string> = { png: 'png', jpeg: 'jpg', webp: 'webp', pdf: 'pdf', mp4: 'mp4' }

export const mimeFor = (type: FileType): string => MIME[type]
export const extensionFor = (type: FileType): string => EXTENSION[type]
export const isImageType = (type: FileType | null): type is ImageType => type !== null && type !== 'pdf' && type !== 'mp4'
