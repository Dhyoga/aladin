import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { brandAssets, generations, jobs, type GenerationRow, type JobRow } from '../db/schema'
import {
  CreateGenerationBody,
  GENERATION_HISTORY_LIMIT,
  PatchGenerationBody,
  type GenerationDetail,
  type GenerationListItem,
  type GenerationStatus,
  type VideoDto
} from '../../shared/schemas/generation'
import { VideoScript } from '../../shared/schemas/n8n-contracts'
import { GenerationError } from './generation-errors'
import { NO_JOB_GRACE_MS, listAssets, parseStoredDna, readBrand, reconcileBrand, type BrandDeps } from './brands'
import type { PostInput } from './n8n-client'
import { getJobWithTimeout } from './jobs'
import { removeMediaPath } from './media-storage'

type Db = BrandDeps['db']

/** The same dependencies as the brand services: db, media folder, job dispatch, clock. */
export type GenerationDeps = BrandDeps

const nowOf = (deps: { now?: () => number }) => (deps.now ?? Date.now)()

export interface DerivedStatus {
  status: GenerationStatus
  stage: string | null
  error: string | null
}

/**
 * A generation stores no status: it comes from its post job (the pipeline has no
 * "failed" hook, and a job can fail in many ways). `job` must already have the timeout
 * rule applied. With no job at all the process may have died between the two inserts, so
 * after a grace period that counts as failed.
 */
export function deriveStatus(generation: Pick<GenerationRow, 'createdAt'>, job: JobRow | undefined, now: number): DerivedStatus {
  if (!job) {
    return now - generation.createdAt > NO_JOB_GRACE_MS
      ? { status: 'failed', stage: null, error: 'The generation did not start.' }
      : { status: 'running', stage: null, error: null }
  }
  switch (job.status) {
    case 'completed':
      return { status: 'completed', stage: null, error: null }
    case 'failed':
      return { status: 'failed', stage: null, error: job.error ?? 'The generation failed.' }
    default:
      return { status: 'running', stage: job.stage, error: null }
  }
}

export function latestPostJob(db: Db, generationId: string): JobRow | undefined {
  return db
    .select()
    .from(jobs)
    .where(and(eq(jobs.generationId, generationId), eq(jobs.type, 'post')))
    .orderBy(desc(jobs.createdAt), sql`rowid desc`)
    .limit(1)
    .get()
}

/** The latest `video` job of a generation. A generation can have several: a failed one, then a retry. */
export function latestVideoJob(db: Db, generationId: string): JobRow | undefined {
  return db
    .select()
    .from(jobs)
    .where(and(eq(jobs.generationId, generationId), eq(jobs.type, 'video')))
    .orderBy(desc(jobs.createdAt), sql`rowid desc`)
    .limit(1)
    .get()
}

export function readGeneration(db: Db, id: string): GenerationRow | undefined {
  return db.select().from(generations).where(eq(generations.id, id)).get()
}

function requireGeneration(db: Db, id: string): GenerationRow {
  const row = readGeneration(db, id)
  if (!row) throw new GenerationError('not_found', 'Generation not found')
  return row
}

const StringList = z.array(z.string())

/** Stored JSON that no longer parses must fail loudly, never be passed on silently. */
function parseStoredList(text: string | null, what: string): string[] | null {
  if (text === null) return null
  try {
    return StringList.parse(JSON.parse(text))
  } catch {
    throw new GenerationError('corrupt', `Stored ${what} are invalid`)
  }
}

const mediaUrl = (path: string | null) => (path ? `/media/${path}` : null)

/** The stored video script. Corrupt data must fail loudly, never be passed on silently. */
function parseStoredScript(text: string | null): VideoDto['script'] {
  if (text === null) return null
  try {
    return VideoScript.parse(JSON.parse(text))
  } catch {
    throw new GenerationError('corrupt', 'Stored video script is invalid')
  }
}

/**
 * The video of a generation, from its latest video job (timeout rule already applied).
 * `null` when a video was never requested. Like the post, the video has no stored status.
 * The script and the storyboard are included while the video is still running: they arrive first.
 */
export function deriveVideo(row: GenerationRow, job: JobRow | undefined): VideoDto | null {
  if (!job) return null
  return {
    status: job.status === 'completed' ? 'completed' : job.status === 'failed' ? 'failed' : 'running',
    stage: job.status === 'queued' || job.status === 'running' ? job.stage : null,
    error: job.status === 'failed' ? (job.error ?? 'The video failed.') : null,
    jobId: job.id,
    script: parseStoredScript(row.videoScriptJson),
    storyboardUrl: mediaUrl(row.storyboardPath),
    videoUrl: mediaUrl(row.videoPath)
  }
}

function toDetail(row: GenerationRow, job: JobRow | undefined, videoJob: JobRow | undefined, now: number): GenerationDetail {
  const derived = deriveStatus(row, job, now)
  return {
    id: row.id,
    brandId: row.brandId,
    prompt: row.prompt,
    aspectRatio: row.aspectRatio,
    assetIds: parseStoredList(row.assetIdsJson, 'photo ids') ?? [],
    caption: row.caption,
    hashtags: parseStoredList(row.hashtagsJson, 'hashtags'),
    imageUrl: mediaUrl(row.imagePath),
    status: derived.status,
    stage: derived.stage,
    error: derived.error,
    jobId: job?.id ?? null,
    video: deriveVideo(row, videoJob),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

/** The job as it is now (timeout rule applied), or undefined. */
function currentJob(db: Db, generationId: string, now: number): JobRow | undefined {
  const latest = latestPostJob(db, generationId)
  return latest ? getJobWithTimeout(db, latest.id, now) : undefined
}

function currentVideoJob(db: Db, generationId: string, now: number): JobRow | undefined {
  const latest = latestVideoJob(db, generationId)
  return latest ? getJobWithTimeout(db, latest.id, now) : undefined
}

export function getGeneration(deps: GenerationDeps, id: string): GenerationDetail {
  const now = nowOf(deps)
  const row = requireGeneration(deps.db, id)
  return toDetail(row, currentJob(deps.db, id, now), currentVideoJob(deps.db, id, now), now)
}

/** A readable message for the first problem Zod found. */
function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Invalid request'
}

export async function createGeneration(deps: GenerationDeps, body: unknown): Promise<GenerationDetail> {
  const parsed = CreateGenerationBody.safeParse(body)
  if (!parsed.success) throw new GenerationError('invalid', firstIssue(parsed.error))
  const { brandId, prompt, aspectRatio, assetIds } = parsed.data

  const { db } = deps
  const now = nowOf(deps)
  const found = readBrand(db, brandId)
  if (!found) throw new GenerationError('not_found', 'Brand not found')

  // A brand whose extraction already failed must not look ready; reconcile before judging.
  const brand = reconcileBrand(db, found, now).brand
  const dna = brand.status === 'ready' ? parseStoredDna(brand) : null
  if (!dna) throw new GenerationError('conflict', 'The Brand DNA is not ready yet')

  // Only product photos of this very brand: another brand's photo, the logo or a made-up id
  // would send n8n something the user never chose.
  const photos = db
    .select()
    .from(brandAssets)
    .where(and(eq(brandAssets.brandId, brandId), eq(brandAssets.kind, 'product_photo'), inArray(brandAssets.id, assetIds)))
    .all()
  const byId = new Map(photos.map(photo => [photo.id, photo]))
  if (assetIds.some(id => !byId.has(id))) {
    throw new GenerationError('invalid', 'One of the chosen photos does not belong to this brand')
  }

  const logo = listAssets(db, brandId, 'logo')[0]
  const input: PostInput = {
    brand_dna: dna,
    prompt,
    aspect_ratio: aspectRatio,
    assets: [
      ...(logo ? [{ id: logo.id, kind: 'logo' as const, mime: logo.mime }] : []),
      // `label` is optional in the contract, so it is left out (not null) when there is none
      ...assetIds.map((id) => {
        const photo = byId.get(id)!
        return { id, kind: 'product_photo' as const, mime: photo.mime, ...(photo.label ? { label: photo.label } : {}) }
      })
    ]
  }

  const id = `gen_${nanoid(12)}`
  db.insert(generations).values({
    id,
    brandId,
    prompt,
    aspectRatio,
    assetIdsJson: JSON.stringify(assetIds),
    caption: null,
    hashtagsJson: null,
    imagePath: null,
    createdAt: now,
    updatedAt: now
  }).run()

  // A failed dispatch does not throw: the job is stored as failed, and the generation shows it.
  await deps.dispatch({ type: 'post', brandId, generationId: id, input })
  return getGeneration(deps, id)
}

export function listGenerations(deps: GenerationDeps, brandId: string | undefined): GenerationListItem[] {
  if (!brandId) throw new GenerationError('invalid', 'brandId is required')

  const now = nowOf(deps)
  const rows = deps.db
    .select()
    .from(generations)
    .where(eq(generations.brandId, brandId))
    .orderBy(desc(generations.createdAt), sql`rowid desc`)
    .limit(GENERATION_HISTORY_LIMIT)
    .all()

  return rows.map((row) => {
    // A saved image means the post is done; only unfinished rows need their job read.
    const derived: DerivedStatus = row.imagePath
      ? { status: 'completed', stage: null, error: null }
      : deriveStatus(row, currentJob(deps.db, row.id, now), now)
    return {
      id: row.id,
      brandId: row.brandId,
      prompt: row.prompt,
      aspectRatio: row.aspectRatio,
      status: derived.status,
      stage: derived.stage,
      imageUrl: mediaUrl(row.imagePath),
      createdAt: row.createdAt
    }
  })
}

/** Edits the caption and/or hashtags of a finished post. An empty body changes nothing. */
export function patchGeneration(deps: GenerationDeps, id: string, body: unknown): GenerationDetail {
  const parsed = PatchGenerationBody.safeParse(body)
  if (!parsed.success) throw new GenerationError('invalid', firstIssue(parsed.error))

  const current = getGeneration(deps, id)
  if (current.status !== 'completed') {
    throw new GenerationError('conflict', 'The post is not finished yet')
  }

  const { caption, hashtags } = parsed.data
  if (caption === undefined && hashtags === undefined) return current

  deps.db
    .update(generations)
    .set({
      ...(caption !== undefined ? { caption } : {}),
      ...(hashtags !== undefined ? { hashtagsJson: JSON.stringify(hashtags) } : {}),
      updatedAt: nowOf(deps)
    })
    .where(eq(generations.id, id))
    .run()

  return getGeneration(deps, id)
}

/** Removes the row and its files. Jobs are left alone, like when a brand is deleted. */
export async function deleteGeneration(deps: GenerationDeps, id: string): Promise<void> {
  requireGeneration(deps.db, id)
  deps.db.delete(generations).where(eq(generations.id, id)).run()

  try {
    await removeMediaPath(deps.mediaDir, `generations/${id}`)
  } catch (error) {
    // The row is gone already; a leftover folder is better than a generation that cannot be deleted.
    console.warn(`[generations] could not remove files of generation ${id}:`, error)
  }
}
