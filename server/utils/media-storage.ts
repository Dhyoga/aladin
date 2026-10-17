import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { MediaPathError, resolveMediaPath } from './media'

/** Resolves a relative path inside mediaDir and refuses the media root itself. */
function resolveInside(mediaDir: string, relPath: string): string {
  const target = resolveMediaPath(mediaDir, relPath)
  if (target === resolve(mediaDir)) throw new MediaPathError('Path points at the media root')
  return target
}

/**
 * Writes `data` to `relPath` under mediaDir, creating folders and replacing an existing
 * file. The path is checked with the same rules as media serving. Returns the absolute path.
 */
export async function saveMediaFile(mediaDir: string, relPath: string, data: Uint8Array): Promise<string> {
  const file = resolveInside(mediaDir, relPath)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, data)
  return file
}

/**
 * Removes a file or a whole folder under mediaDir. A path that does not exist is fine.
 * Refuses to remove mediaDir itself.
 */
export async function removeMediaPath(mediaDir: string, relPath: string): Promise<void> {
  await rm(resolveInside(mediaDir, relPath), { recursive: true, force: true })
}
