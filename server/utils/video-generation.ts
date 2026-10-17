import { and, eq, inArray } from 'drizzle-orm'
import { brandAssets, generations } from '../db/schema'
import type { GenerationDetail } from '../../shared/schemas/generation'
import { listAssets, parseStoredDna, readBrand, reconcileBrand } from './brands'
import { GenerationError } from './generation-errors'
import { getGeneration, type GenerationDeps } from './generations'
import type { VideoInput } from './n8n-client'

/**
 * Starts a video for a finished post.
 *
 * IMPORTANT: from the first check to the call of `deps.dispatch` there must be no `await`.
 * The dispatch creates the job synchronously, so a second request (a double click, ~US$1 each)
 * only runs after the first job exists, sees it running, and gets a 409. Adding an `await`
 * in between breaks that; a test with two simultaneous requests guards it.
 */
export async function createVideo(deps: GenerationDeps, generationId: string): Promise<GenerationDetail> {
  const { db } = deps
  const now = (deps.now ?? Date.now)()

  const current = getGeneration(deps, generationId) // 404 when unknown; timeouts are applied
  if (current.status !== 'completed' || current.caption === null) {
    throw new GenerationError('conflict', 'The post has to be finished first')
  }
  if (current.video?.status === 'running') {
    throw new GenerationError('conflict', 'A video is already being created')
  }
  if (current.video?.status === 'completed') {
    throw new GenerationError('conflict', 'This post already has a video')
  }
  // Left: no video yet, or the last attempt failed (including by timeout): a new one may start.

  const found = readBrand(db, current.brandId)
  if (!found) throw new GenerationError('not_found', 'Brand not found')
  const brand = reconcileBrand(db, found, now).brand
  const dna = brand.status === 'ready' ? parseStoredDna(brand) : null
  if (!dna) throw new GenerationError('conflict', 'The Brand DNA is not ready yet')

  // The photos of the post that still exist, in the order that was chosen: photos can be deleted afterwards.
  const photos = db
    .select()
    .from(brandAssets)
    .where(and(
      eq(brandAssets.brandId, brand.id),
      eq(brandAssets.kind, 'product_photo'),
      inArray(brandAssets.id, current.assetIds)
    ))
    .all()
  const byId = new Map(photos.map(photo => [photo.id, photo]))
  const remaining = current.assetIds.flatMap(id => byId.get(id) ?? [])
  if (remaining.length === 0) {
    throw new GenerationError('conflict', 'The photos of this post no longer exist')
  }

  const logo = listAssets(db, brand.id, 'logo')[0]
  const input: VideoInput = {
    brand_dna: dna,
    prompt: current.prompt,
    // The caption as it is now: an edit by the user is what the video should agree with.
    post: { caption: current.caption, hashtags: current.hashtags ?? [] },
    assets: [
      ...(logo ? [{ id: logo.id, kind: 'logo' as const, mime: logo.mime }] : []),
      ...remaining.map(photo => ({
        id: photo.id,
        kind: 'product_photo' as const,
        mime: photo.mime,
        ...(photo.label ? { label: photo.label } : {})
      }))
    ].slice(0, 4)
  }

  // A new attempt starts clean: nothing of an earlier failed one may show next to it.
  // (The files stay; the handler overwrites them, and deleting would need an `await` here.)
  db.update(generations)
    .set({ videoScriptJson: null, storyboardPath: null, videoPath: null, updatedAt: now })
    .where(eq(generations.id, generationId))
    .run()

  // A failed dispatch does not throw: the job is stored as failed, and the video shows it.
  await deps.dispatch({ type: 'video', brandId: brand.id, generationId, input })
  return getGeneration(deps, generationId)
}
