import { eq } from 'drizzle-orm'
import { generations, type GenerationRow } from '../db/schema'
import { extensionFor, isImageType, sniffFileType } from '../../shared/utils/file-type'
import { VideoCompleted } from '../../shared/schemas/n8n-contracts'
import type { AppDatabase } from './db'
import { readGeneration } from './generations'
import type { CallbackFile, JobResultHandler } from './job-handlers'
import { removeMediaPath, saveMediaFile } from './media-storage'

export interface VideoResultDeps {
  db: AppDatabase['db']
  mediaDir: string
  now?: () => number
}

const STORYBOARD_EXTENSIONS = ['png', 'jpg', 'webp'] as const

/**
 * Stores what a video job produces, as it arrives: the script and the storyboard on progress
 * events (so the user sees them while the video is still being made), the script again and
 * the MP4 on completion. Throws, so the pipeline fails the job with `handler_failed`, when the
 * generation is gone, when a storyboard is not an image, or when the video is not an MP4.
 * Everything is checked before anything is written, and files are removed again when the
 * row cannot be updated.
 */
export function createVideoResultHandler(deps: VideoResultDeps): JobResultHandler<'video'> {
  const { db } = deps
  const now = () => (deps.now ?? Date.now)()

  const requireGeneration = (generationId: string | null): GenerationRow => {
    if (!generationId) throw new Error('job has no generation')
    const generation = readGeneration(db, generationId)
    if (!generation) throw new Error('generation not found')
    return generation
  }

  /** Throws unless the file is an image; returns the path it will be saved under. */
  const storyboardPathFor = (generation: GenerationRow, file: CallbackFile): string => {
    const type = sniffFileType(file.data)
    if (!isImageType(type)) throw new Error('the storyboard is not a PNG, JPEG or WebP image')
    return `generations/${generation.id}/storyboard.${extensionFor(type)}`
  }

  const checkVideo = (file: CallbackFile | undefined): CallbackFile => {
    if (!file) throw new Error('the video is missing')
    if (sniffFileType(file.data) !== 'mp4') throw new Error('the video is not an MP4 file')
    return file
  }

  /** Storyboards of the same generation with another extension must not pile up. */
  const removeOtherStoryboards = async (generationId: string, keep: string) => {
    for (const extension of STORYBOARD_EXTENSIONS) {
      const path = `generations/${generationId}/storyboard.${extension}`
      if (path !== keep) await removeMediaPath(deps.mediaDir, path).catch(() => {})
    }
  }

  /** Writes the row; true when it still existed. */
  const update = (generationId: string, set: Partial<Pick<GenerationRow, 'videoScriptJson' | 'storyboardPath' | 'videoPath'>>): boolean =>
    db.update(generations).set({ ...set, updatedAt: now() }).where(eq(generations.id, generationId)).run().changes > 0

  return {
    async onProgress({ job, stage, payload, files }) {
      const generation = requireGeneration(job.generationId)

      const storyboard = files.storyboard
      const storyboardPath = storyboard ? storyboardPathFor(generation, storyboard) : null
      // Only the `script` stage carries a script; the pipeline already rejected an invalid one.
      const script = stage === 'script' ? VideoCompleted.safeParse(payload) : null

      if (storyboard && storyboardPath) {
        await saveMediaFile(deps.mediaDir, storyboardPath, storyboard.data)
        if (!update(generation.id, { storyboardPath })) {
          await removeMediaPath(deps.mediaDir, storyboardPath).catch(() => {})
          throw new Error('generation not found')
        }
        await removeOtherStoryboards(generation.id, storyboardPath)
      }

      if (script?.success) {
        if (!update(generation.id, { videoScriptJson: JSON.stringify(script.data.script) })) {
          throw new Error('generation not found')
        }
      }
    },

    async onCompleted({ job, payload, files }) {
      const generation = requireGeneration(job.generationId)

      // Check everything first: nothing is written for a file that is not what it should be.
      const video = checkVideo(files.video)
      const storyboard = files.storyboard
      const storyboardPath = storyboard ? storyboardPathFor(generation, storyboard) : null

      const videoPath = `generations/${generation.id}/video.mp4`
      const written: string[] = []
      try {
        await saveMediaFile(deps.mediaDir, videoPath, video.data)
        written.push(videoPath)
        if (storyboard && storyboardPath) {
          await saveMediaFile(deps.mediaDir, storyboardPath, storyboard.data)
          written.push(storyboardPath)
        }

        const saved = update(generation.id, {
          // The script of the completion is the final one and replaces the one stored at progress.
          videoScriptJson: JSON.stringify(payload.script),
          videoPath,
          ...(storyboardPath ? { storyboardPath } : {})
        })
        if (!saved) throw new Error('generation not found')
      } catch (error) {
        for (const path of written) await removeMediaPath(deps.mediaDir, path).catch(() => {})
        throw error
      }

      if (storyboardPath) await removeOtherStoryboards(generation.id, storyboardPath)
    }
  }
}
