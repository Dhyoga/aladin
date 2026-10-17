import { and, eq, ne, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { brandAssets, type BrandAssetRow } from '../db/schema'
import {
  MAX_IMAGE_BYTES,
  MAX_PRODUCT_PHOTOS,
  type AssetDto,
  type PatchAssetBody
} from '../../shared/schemas/brand'
import { BrandError } from './brand-errors'
import { readBrand, toAssetDto, type BrandDeps } from './brands'
import { extensionFor, isImageType, mimeFor, sniffFileType, type ImageType } from '../../shared/utils/file-type'
import { removeMediaPath, saveMediaFile } from './media-storage'

type UploadKind = 'logo' | 'product_photo'

const nowOf = (deps: BrandDeps) => (deps.now ?? Date.now)()

function requireBrandRow(deps: BrandDeps, brandId: string) {
  const brand = readBrand(deps.db, brandId)
  if (!brand) throw new BrandError('not_found', 'Brand not found')
  return brand
}

/** An asset of this brand that the API may change or delete (never the source PDF). */
function findManagedAsset(deps: BrandDeps, brandId: string, assetId: string): BrandAssetRow {
  const row = deps.db
    .select()
    .from(brandAssets)
    .where(and(eq(brandAssets.id, assetId), eq(brandAssets.brandId, brandId), ne(brandAssets.kind, 'source_pdf')))
    .get()
  if (!row) throw new BrandError('not_found', 'Asset not found')
  return row
}

function countPhotos(deps: BrandDeps, brandId: string): number {
  const row = deps.db
    .select({ count: sql<number>`count(*)` })
    .from(brandAssets)
    .where(and(eq(brandAssets.brandId, brandId), eq(brandAssets.kind, 'product_photo')))
    .get()
  return row?.count ?? 0
}

function nextSortOrder(deps: BrandDeps, brandId: string, kind: UploadKind): number {
  const row = deps.db
    .select({ max: sql<number | null>`max(${brandAssets.sortOrder})` })
    .from(brandAssets)
    .where(and(eq(brandAssets.brandId, brandId), eq(brandAssets.kind, kind)))
    .get()
  return row?.max === null || row?.max === undefined ? 0 : row.max + 1
}

interface PreparedImage {
  id: string
  type: ImageType
  path: string
  data: Buffer
}

/**
 * Adds a logo (replacing the current one) or product photos to a brand.
 * All files are validated first and the whole request is rejected if any is invalid
 * or the photo limit would be exceeded: nothing is stored in that case.
 * The type comes from the file content; the client's file name and MIME type are ignored.
 */
export async function addBrandAssets(
  deps: BrandDeps,
  brandId: string,
  kind: UploadKind,
  files: { data: Buffer }[]
): Promise<AssetDto[]> {
  requireBrandRow(deps, brandId)

  if (files.length === 0) throw new BrandError('invalid', 'No files were sent')
  if (kind === 'logo' && files.length > 1) throw new BrandError('invalid', 'A brand has a single logo')

  const prepared: PreparedImage[] = files.map((file) => {
    if (file.data.length > MAX_IMAGE_BYTES) throw new BrandError('too_large', 'Images can be at most 10 MB')
    const type = sniffFileType(file.data)
    if (!isImageType(type)) throw new BrandError('invalid', 'Only PNG, JPEG and WebP images are accepted')

    const id = `ast_${nanoid(12)}`
    const name = kind === 'logo' ? `logo-${id}` : `products/${id}`
    return { id, type, path: `brands/${brandId}/${name}.${extensionFor(type)}`, data: file.data }
  })

  if (kind === 'product_photo' && countPhotos(deps, brandId) + prepared.length > MAX_PRODUCT_PHOTOS) {
    throw new BrandError('invalid', `A brand can have at most ${MAX_PRODUCT_PHOTOS} product photos`)
  }

  const written: string[] = []
  const cleanUp = () => Promise.all(written.map(path => removeMediaPath(deps.mediaDir, path).catch(() => {})))

  let created: BrandAssetRow[] = []
  let replacedPaths: string[] = []
  try {
    for (const image of prepared) {
      await saveMediaFile(deps.mediaDir, image.path, image.data)
      written.push(image.path)
    }

    const now = nowOf(deps)
    deps.db.transaction((tx) => {
      // Checked again inside the transaction: two uploads can pass the early check at the same time.
      if (kind === 'product_photo' && countPhotos(deps, brandId) + prepared.length > MAX_PRODUCT_PHOTOS) {
        throw new BrandError('invalid', `A brand can have at most ${MAX_PRODUCT_PHOTOS} product photos`)
      }

      if (kind === 'logo') {
        const old = tx.select().from(brandAssets)
          .where(and(eq(brandAssets.brandId, brandId), eq(brandAssets.kind, 'logo'))).all()
        replacedPaths = old.map(row => row.path)
        tx.delete(brandAssets)
          .where(and(eq(brandAssets.brandId, brandId), eq(brandAssets.kind, 'logo'))).run()
      }

      const firstOrder = nextSortOrder(deps, brandId, kind)
      created = prepared.map((image, index) => ({
        id: image.id,
        brandId,
        kind,
        path: image.path,
        mime: mimeFor(image.type),
        sizeBytes: image.data.length,
        label: null,
        sortOrder: kind === 'logo' ? 0 : firstOrder + index,
        createdAt: now
      }))
      tx.insert(brandAssets).values(created).run()
    })
  } catch (error) {
    await cleanUp()
    throw error
  }

  // The old logo file goes only after the new logo is safely stored.
  for (const path of replacedPaths) {
    await removeMediaPath(deps.mediaDir, path).catch((error: unknown) => {
      console.warn(`[brand-assets] could not remove replaced logo ${path}:`, error)
    })
  }

  return created.map(toAssetDto)
}

/** Updates only the given fields of a logo or product photo. */
export function updateBrandAsset(
  deps: BrandDeps,
  brandId: string,
  assetId: string,
  patch: PatchAssetBody
): AssetDto {
  const current = findManagedAsset(deps, brandId, assetId)

  const changes: Partial<Pick<BrandAssetRow, 'label' | 'sortOrder'>> = {}
  if (patch.label !== undefined) changes.label = patch.label
  if (patch.sortOrder !== undefined) changes.sortOrder = patch.sortOrder

  if (Object.keys(changes).length > 0) {
    deps.db.update(brandAssets).set(changes).where(eq(brandAssets.id, current.id)).run()
  }
  return toAssetDto(findManagedAsset(deps, brandId, assetId))
}

/** Removes the row and the file of a logo or product photo. */
export async function deleteBrandAsset(deps: BrandDeps, brandId: string, assetId: string): Promise<void> {
  const row = findManagedAsset(deps, brandId, assetId)
  deps.db.delete(brandAssets).where(eq(brandAssets.id, row.id)).run()

  await removeMediaPath(deps.mediaDir, row.path).catch((error: unknown) => {
    console.warn(`[brand-assets] could not remove file ${row.path}:`, error)
  })
}
