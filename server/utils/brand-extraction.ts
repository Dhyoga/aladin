import { and, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { brandAssets, brands, type BrandAssetRow } from '../db/schema'
import { MAX_IMAGE_BYTES } from '../../shared/schemas/brand'
import { readBrand } from './brands'
import type { AppDatabase } from './db'
import { extensionFor, isImageType, mimeFor, sniffFileType } from '../../shared/utils/file-type'
import type { JobResultHandler } from './job-handlers'
import { removeMediaPath, saveMediaFile } from './media-storage'

export interface BrandExtractDeps {
  db: AppDatabase['db']
  mediaDir: string
  now?: () => number
}

/**
 * Stores what a brand_extract job produced: the Brand DNA (replacing any previous one),
 * the brand name, and the logo if the brand has none yet. Throws (so the pipeline fails
 * the job with `handler_failed`) when the brand is gone or no longer extracting.
 */
export function createBrandExtractHandler(deps: BrandExtractDeps): JobResultHandler<'brand_extract'> {
  const { db } = deps
  const hasLogo = (brandId: string) =>
    db.select().from(brandAssets).where(and(eq(brandAssets.brandId, brandId), eq(brandAssets.kind, 'logo'))).get() !== undefined

  return {
    async onCompleted({ job, payload, files }) {
      if (!job.brandId) throw new Error('job has no brand')
      const brand = readBrand(db, job.brandId)
      if (!brand) throw new Error('brand not found')
      if (brand.status !== 'extracting') throw new Error('brand is no longer extracting')

      let dna = payload.brand_dna
      if (!dna.identity.website && brand.sourceUrl) {
        dna = { ...dna, identity: { ...dna.identity, website: brand.sourceUrl } }
      }

      // A logo the user already has is never replaced, and a bad logo never fails the extraction.
      let logo: BrandAssetRow | undefined
      const file = files.logo
      if (file && !hasLogo(brand.id)) {
        const type = sniffFileType(file.data)
        if (isImageType(type) && file.data.length <= MAX_IMAGE_BYTES) {
          const id = `ast_${nanoid(12)}`
          const path = `brands/${brand.id}/logo-${id}.${extensionFor(type)}`
          await saveMediaFile(deps.mediaDir, path, file.data)
          logo = {
            id,
            brandId: brand.id,
            kind: 'logo',
            path,
            mime: mimeFor(type),
            sizeBytes: file.data.length,
            label: null,
            sortOrder: 0,
            createdAt: (deps.now ?? Date.now)()
          }
        } else {
          console.warn(`[brand-extract] ignoring the extracted logo of brand ${brand.id}: not a valid image within the size limit`)
        }
      }

      let discardLogo = false
      try {
        db.transaction((tx) => {
          const now = (deps.now ?? Date.now)()
          const updated = tx
            .update(brands)
            .set({ dnaJson: JSON.stringify(dna), name: dna.identity.name, status: 'ready', updatedAt: now })
            .where(and(eq(brands.id, brand.id), eq(brands.status, 'extracting')))
            .run()
          if (updated.changes === 0) throw new Error('brand is no longer extracting')

          if (logo) {
            // The user may have uploaded a logo while the file was being written.
            if (hasLogo(brand.id)) discardLogo = true
            else tx.insert(brandAssets).values(logo).run()
          }
        })
      } catch (error) {
        if (logo) await removeMediaPath(deps.mediaDir, logo.path).catch(() => {})
        throw error
      }

      if (logo && discardLogo) await removeMediaPath(deps.mediaDir, logo.path).catch(() => {})
    }
  }
}
