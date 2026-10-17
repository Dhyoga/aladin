import { eq } from 'drizzle-orm'
import { generations } from '../db/schema'
import { MAX_CAPTION_LENGTH, MAX_HASHTAG_LENGTH, MAX_HASHTAGS } from '../../shared/schemas/generation'
import { extensionFor, isImageType, sniffFileType } from '../../shared/utils/file-type'
import type { AppDatabase } from './db'
import { readGeneration } from './generations'
import type { JobResultHandler } from './job-handlers'
import { removeMediaPath, saveMediaFile } from './media-storage'

export interface PostResultDeps {
  db: AppDatabase['db']
  mediaDir: string
  now?: () => number
}

/**
 * Hashtags written by the model are cleaned, not judged: one bad tag must not throw away a
 * finished post. Whitespace inside a tag is dropped, a single leading `#` is kept, empty and
 * duplicate (ignoring case) tags go, and the list and each tag are capped.
 */
export function cleanGeneratedHashtags(input: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const raw of input) {
    const word = raw.replace(/\s+/g, '').replace(/^#+/, '')
    if (word === '') continue
    const tag = `#${word}`.slice(0, MAX_HASHTAG_LENGTH)
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(tag)
    if (result.length === MAX_HASHTAGS) break
  }
  return result
}

/**
 * Stores what a post job produced on its generation: the caption, the hashtags and the
 * image (type taken from the content, never from the name). Throws, so the pipeline fails
 * the job with `handler_failed`, when the generation is gone or the image is not an image.
 */
export function createPostResultHandler(deps: PostResultDeps): JobResultHandler<'post'> {
  const { db } = deps

  return {
    async onCompleted({ job, payload, files }) {
      if (!job.generationId) throw new Error('job has no generation')
      const generation = readGeneration(db, job.generationId)
      if (!generation) throw new Error('generation not found')

      const image = files.image
      if (!image) throw new Error('the image is missing')
      const type = sniffFileType(image.data)
      if (!isImageType(type)) throw new Error('the image is not a PNG, JPEG or WebP file')

      const path = `generations/${generation.id}/post.${extensionFor(type)}`
      await saveMediaFile(deps.mediaDir, path, image.data)

      const updated = db
        .update(generations)
        .set({
          caption: payload.caption.slice(0, MAX_CAPTION_LENGTH),
          hashtagsJson: JSON.stringify(cleanGeneratedHashtags(payload.hashtags)),
          imagePath: path,
          updatedAt: (deps.now ?? Date.now)()
        })
        .where(eq(generations.id, generation.id))
        .run()

      if (updated.changes === 0) {
        // The generation was deleted while the file was being written.
        await removeMediaPath(deps.mediaDir, path).catch(() => {})
        throw new Error('generation not found')
      }

      // A previous image with another extension must not stay behind.
      if (generation.imagePath && generation.imagePath !== path) {
        await removeMediaPath(deps.mediaDir, generation.imagePath).catch(() => {})
      }
    }
  }
}
