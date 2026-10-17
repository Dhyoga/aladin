import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { brandAssets, brands, generations, jobs, type BrandAssetRow, type BrandRow, type JobRow } from '../db/schema'
import { BrandDNA } from '../../shared/schemas/brand-dna'
import {
  MAX_BRAND_NAME_LENGTH,
  MAX_PDF_BYTES,
  type AssetDto,
  type BrandDetail,
  type BrandListItem,
  type ExtractionDto
} from '../../shared/schemas/brand'
import { BrandError } from './brand-errors'
import type { AppDatabase } from './db'
import { sniffFileType } from '../../shared/utils/file-type'
import type { StartJobInput } from './job-dispatch'
import { getJobWithTimeout } from './jobs'
import { removeMediaPath, saveMediaFile } from './media-storage'

type Db = AppDatabase['db']

export interface BrandDeps {
  db: Db
  mediaDir: string
  /** Starts a job (production: dispatchJob). Injected so tests can use their own client. */
  dispatch: (input: StartJobInput) => Promise<JobRow>
  now?: () => number
}

/** An `extracting` brand with no job at all, older than this, is considered failed. */
export const NO_JOB_GRACE_MS = 60_000

const nowOf = (deps: { now?: () => number }) => (deps.now ?? Date.now)()

// ---------- reading ----------

export function readBrand(db: Db, id: string): BrandRow | undefined {
  return db.select().from(brands).where(eq(brands.id, id)).get()
}

function requireBrand(db: Db, id: string): BrandRow {
  const row = readBrand(db, id)
  if (!row) throw new BrandError('not_found', 'Brand not found')
  return row
}

/** Parses the stored DNA. Corrupt data must fail loudly, never be passed on silently. */
export function parseStoredDna(row: BrandRow): BrandDNA | null {
  if (row.dnaJson === null) return null
  try {
    return BrandDNA.parse(JSON.parse(row.dnaJson))
  } catch {
    throw new BrandError('corrupt', 'Stored Brand DNA is invalid')
  }
}

export function latestExtractionJob(db: Db, brandId: string): JobRow | undefined {
  return db
    .select()
    .from(jobs)
    .where(and(eq(jobs.brandId, brandId), eq(jobs.type, 'brand_extract')))
    .orderBy(desc(jobs.createdAt), sql`rowid desc`)
    .limit(1)
    .get()
}

/**
 * Brand status is derived from its extraction job when read (the pipeline has no
 * "failed" hook, and a job can fail in many ways: dispatch, n8n, validation, handler,
 * timeout). An `extracting` brand whose latest job failed becomes `failed`; so does one
 * that has no job at all after a grace period (the process died between the two inserts).
 * Returns the (possibly updated) brand and the latest job as it is now.
 */
export function reconcileBrand(db: Db, brand: BrandRow, now = Date.now()): { brand: BrandRow, job: JobRow | undefined } {
  // A ready brand has nothing to reconcile and nothing to show about extraction.
  if (brand.status === 'ready') return { brand, job: undefined }

  const latest = latestExtractionJob(db, brand.id)
  const job = latest ? getJobWithTimeout(db, latest.id, now) : undefined
  if (brand.status !== 'extracting') return { brand, job }

  const shouldFail = job ? job.status === 'failed' : now - brand.createdAt > NO_JOB_GRACE_MS
  if (!shouldFail) return { brand, job }

  db.update(brands)
    .set({ status: 'failed', updatedAt: now })
    .where(and(eq(brands.id, brand.id), eq(brands.status, 'extracting')))
    .run()
  return { brand: readBrand(db, brand.id) ?? brand, job }
}

// ---------- DTOs ----------

export function toAssetDto(row: BrandAssetRow): AssetDto {
  return {
    id: row.id,
    kind: row.kind,
    url: `/media/${row.path}`,
    mime: row.mime,
    sizeBytes: row.sizeBytes,
    label: row.label,
    sortOrder: row.sortOrder
  }
}

function toExtractionDto(job: JobRow | undefined): ExtractionDto | null {
  return job ? { jobId: job.id, status: job.status, stage: job.stage, error: job.error } : null
}

export function listAssets(db: Db, brandId: string, kind: BrandAssetRow['kind']): BrandAssetRow[] {
  return db
    .select()
    .from(brandAssets)
    .where(and(eq(brandAssets.brandId, brandId), eq(brandAssets.kind, kind)))
    .orderBy(asc(brandAssets.sortOrder), asc(brandAssets.createdAt), sql`rowid asc`)
    .all()
}

export function getBrandDetail(deps: BrandDeps, id: string): BrandDetail {
  const { db } = deps
  const { brand, job } = reconcileBrand(db, requireBrand(db, id), nowOf(deps))

  const logo = listAssets(db, brand.id, 'logo')[0]
  return {
    id: brand.id,
    name: brand.name,
    status: brand.status,
    sourceType: brand.sourceType,
    sourceUrl: brand.sourceUrl,
    dna: parseStoredDna(brand),
    logo: logo ? toAssetDto(logo) : null,
    photos: listAssets(db, brand.id, 'product_photo').map(toAssetDto),
    extraction: brand.status === 'ready' ? null : toExtractionDto(job),
    createdAt: brand.createdAt,
    updatedAt: brand.updatedAt
  }
}

export function listBrands(deps: BrandDeps): BrandListItem[] {
  const { db } = deps
  const now = nowOf(deps)
  const rows = db.select().from(brands).orderBy(desc(brands.createdAt), sql`rowid desc`).all()
  if (rows.length === 0) return []

  const logos = db
    .select()
    .from(brandAssets)
    .where(and(eq(brandAssets.kind, 'logo'), inArray(brandAssets.brandId, rows.map(row => row.id))))
    .all()
  const logoByBrand = new Map(logos.map(logo => [logo.brandId, logo]))

  return rows.map((row) => {
    const brand = row.status === 'extracting' ? reconcileBrand(db, row, now).brand : row
    const logo = logoByBrand.get(brand.id)
    return {
      id: brand.id,
      name: brand.name,
      status: brand.status,
      sourceType: brand.sourceType,
      logoUrl: logo ? `/media/${logo.path}` : null,
      updatedAt: brand.updatedAt
    }
  })
}

// ---------- creating ----------

const httpUrl = z.url({ protocol: /^https?$/ })

function emptyDna(name: string): BrandDNA {
  return BrandDNA.parse({
    identity: { name, summary: '' },
    audience: { targetAudience: '' },
    voice: { toneOfVoice: '' },
    offer: {},
    visual: {},
    social: {}
  })
}

/** A display name from a file name: no path, no extension, no control characters. */
export function brandNameFromFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? ''
  const withoutExtension = base.replace(/\.[^.]{1,10}$/, '')
  // eslint-disable-next-line no-control-regex
  const cleaned = withoutExtension.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_BRAND_NAME_LENGTH).trim()
  return cleaned || 'Untitled brand'
}

export async function createManualBrand(deps: BrandDeps, input: { name: string }): Promise<BrandDetail> {
  const name = input.name.trim()
  if (name.length < 1 || name.length > MAX_BRAND_NAME_LENGTH) {
    throw new BrandError('invalid', `Name must be 1 to ${MAX_BRAND_NAME_LENGTH} characters`)
  }

  const now = nowOf(deps)
  const id = `brd_${nanoid(12)}`
  deps.db.insert(brands).values({
    id,
    name,
    sourceType: 'manual',
    sourceUrl: null,
    sourceAssetId: null,
    dnaJson: JSON.stringify(emptyDna(name)),
    status: 'ready',
    createdAt: now,
    updatedAt: now
  }).run()

  return getBrandDetail(deps, id)
}

export async function createUrlBrand(deps: BrandDeps, input: { url: string }): Promise<BrandDetail> {
  const parsed = httpUrl.safeParse(input.url.trim())
  if (!parsed.success) throw new BrandError('invalid', 'URL must be a valid http or https address')
  const url = parsed.data

  const now = nowOf(deps)
  const id = `brd_${nanoid(12)}`
  const hostname = new URL(url).hostname.replace(/^www\./, '')
  // Insert the brand and start the job without an `await` in between, so a reader can
  // never see an `extracting` brand without its job.
  deps.db.insert(brands).values({
    id,
    name: hostname.slice(0, MAX_BRAND_NAME_LENGTH),
    sourceType: 'url',
    sourceUrl: url,
    sourceAssetId: null,
    dnaJson: null,
    status: 'extracting',
    createdAt: now,
    updatedAt: now
  }).run()

  await deps.dispatch({ type: 'brand_extract', brandId: id, input: { source_type: 'url', url } })
  return getBrandDetail(deps, id)
}

export async function createPdfBrand(
  deps: BrandDeps,
  input: { file: { filename: string, data: Buffer } }
): Promise<BrandDetail> {
  const { filename, data } = input.file
  if (data.length > MAX_PDF_BYTES) throw new BrandError('too_large', 'PDF is larger than 20 MB')
  if (sniffFileType(data) !== 'pdf') throw new BrandError('invalid', 'File is not a PDF')

  const now = nowOf(deps)
  const id = `brd_${nanoid(12)}`
  const assetId = `ast_${nanoid(12)}`
  const path = `brands/${id}/source/${assetId}.pdf`

  // The file goes first; the rows are written in one transaction. If that fails the file is removed.
  await saveMediaFile(deps.mediaDir, path, data)
  try {
    deps.db.transaction((tx) => {
      tx.insert(brands).values({
        id,
        name: brandNameFromFilename(filename),
        sourceType: 'pdf',
        sourceUrl: null,
        sourceAssetId: assetId,
        dnaJson: null,
        status: 'extracting',
        createdAt: now,
        updatedAt: now
      }).run()
      tx.insert(brandAssets).values({
        id: assetId,
        brandId: id,
        kind: 'source_pdf',
        path,
        mime: 'application/pdf',
        sizeBytes: data.length,
        label: null,
        sortOrder: 0,
        createdAt: now
      }).run()
    })
  } catch (error) {
    await removeMediaPath(deps.mediaDir, `brands/${id}`).catch(() => {})
    throw error
  }

  await deps.dispatch({ type: 'brand_extract', brandId: id, input: { source_type: 'pdf', pdf_asset_id: assetId } })
  return getBrandDetail(deps, id)
}

// ---------- updating ----------

/** Replaces the whole DNA. Allowed unless the brand is extracting; a failed brand becomes ready. */
export function updateBrandDna(deps: BrandDeps, id: string, dna: BrandDNA): BrandDetail {
  const { db } = deps
  const now = nowOf(deps)
  // Reconcile first so a brand whose extraction already failed can be taken over right away.
  const { brand } = reconcileBrand(db, requireBrand(db, id), now)
  if (brand.status === 'extracting') {
    throw new BrandError('conflict', 'The brand is being extracted; try again when it has finished')
  }

  const result = db
    .update(brands)
    .set({ name: dna.identity.name, dnaJson: JSON.stringify(dna), status: 'ready', updatedAt: now })
    .where(and(eq(brands.id, id), inArray(brands.status, ['ready', 'failed'])))
    .run()
  if (result.changes === 0) {
    throw new BrandError('conflict', 'The brand is being extracted; try again when it has finished')
  }

  return getBrandDetail(deps, id)
}

/** Starts a new extraction from the original source. The previous DNA stays until a result replaces it. */
export async function reExtractBrand(deps: BrandDeps, id: string): Promise<BrandDetail> {
  const { db } = deps
  const now = nowOf(deps)
  const { brand } = reconcileBrand(db, requireBrand(db, id), now)

  if (brand.sourceType === 'manual') {
    throw new BrandError('invalid', 'A manual brand has no source to extract from')
  }
  const input = brand.sourceType === 'url' && brand.sourceUrl
    ? ({ source_type: 'url', url: brand.sourceUrl } as const)
    : brand.sourceType === 'pdf' && brand.sourceAssetId
      ? ({ source_type: 'pdf', pdf_asset_id: brand.sourceAssetId } as const)
      : undefined
  if (!input) throw new BrandError('invalid', 'The brand has no source to extract from')

  // Atomic claim: of two quick clicks only one wins.
  const claimed = db
    .update(brands)
    .set({ status: 'extracting', updatedAt: now })
    .where(and(eq(brands.id, id), inArray(brands.status, ['ready', 'failed'])))
    .run()
  if (claimed.changes === 0) throw new BrandError('conflict', 'The brand is already being extracted')

  await deps.dispatch({ type: 'brand_extract', brandId: id, input })
  return getBrandDetail(deps, id)
}

// ---------- deleting ----------

export async function deleteBrand(deps: BrandDeps, id: string): Promise<void> {
  requireBrand(deps.db, id)
  // The generations go with the brand too (ON DELETE CASCADE), so their ids are read first:
  // their files live under generations/<id>/, not under the brand folder.
  const generationIds = deps.db
    .select({ id: generations.id })
    .from(generations)
    .where(eq(generations.brandId, id))
    .all()
    .map(row => row.id)

  // Asset and generation rows go with the brand (ON DELETE CASCADE). Jobs are left alone.
  deps.db.delete(brands).where(eq(brands.id, id)).run()

  for (const folder of [`brands/${id}`, ...generationIds.map(generationId => `generations/${generationId}`)]) {
    try {
      await removeMediaPath(deps.mediaDir, folder)
    } catch (error) {
      // The data is already gone; a leftover folder is better than a brand that cannot be deleted.
      console.warn(`[brands] could not remove ${folder} of brand ${id}:`, error)
    }
  }
}
