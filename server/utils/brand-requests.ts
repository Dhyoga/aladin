import { eq } from 'drizzle-orm'
import {
  createError,
  getValidatedRouterParams,
  isError,
  readMultipartFormData,
  readValidatedBody,
  setResponseStatus,
  type H3Event
} from 'h3'
import { z } from 'zod'
import { brandAssets } from '../db/schema'
import {
  MAX_ASSET_UPLOAD_REQUEST_BYTES,
  MAX_BRAND_CREATE_REQUEST_BYTES,
  PatchAssetBody,
  PatchBrandBody
} from '../../shared/schemas/brand'
import { addBrandAssets, deleteBrandAsset, updateBrandAsset } from './brand-assets'
import { BRAND_ERROR_STATUS, BrandError } from './brand-errors'
import {
  createManualBrand,
  createPdfBrand,
  createUrlBrand,
  deleteBrand,
  getBrandDetail,
  listBrands,
  readBrand,
  reExtractBrand,
  updateBrandDna,
  type BrandDeps
} from './brands'
import { MediaPathError, serveMedia } from './media'
import { assertInternalRequest } from './secret'
import { parseUploadParts, rejectIfTooLarge, type ParsedUpload } from './upload'

export interface BrandRequestDeps {
  brand: BrandDeps
  sharedSecret: string
}

const STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  404: 'Not Found',
  409: 'Conflict',
  413: 'Payload Too Large',
  500: 'Internal Server Error'
}

/** Maps domain errors to HTTP errors; errors that are already HTTP errors pass through. */
function toHttpError(error: unknown): unknown {
  if (isError(error)) return error
  if (error instanceof BrandError) {
    const statusCode = BRAND_ERROR_STATUS[error.kind]
    return createError({ statusCode, statusMessage: STATUS_TEXT[statusCode], message: error.message })
  }
  if (error instanceof MediaPathError) {
    return createError({ statusCode: 400, statusMessage: STATUS_TEXT[400], message: error.message })
  }
  return error
}

const guard = <T>(handler: (event: H3Event) => Promise<T>) => async (event: H3Event): Promise<T> => {
  try {
    return await handler(event)
  } catch (error) {
    throw toHttpError(error)
  }
}

const badRequest = (message: string) =>
  createError({ statusCode: 400, statusMessage: STATUS_TEXT[400], message })

const IdParams = z.object({ id: z.string().min(1).max(64) })
const AssetParams = z.object({ id: z.string().min(1).max(64), assetId: z.string().min(1).max(64) })

async function readUpload(event: H3Event): Promise<ParsedUpload> {
  const parts = await readMultipartFormData(event)
  if (!parts) throw badRequest('Expected multipart/form-data')
  return parseUploadParts(parts)
}

const SourceType = z.enum(['url', 'pdf', 'manual'])
const UploadKind = z.enum(['logo', 'product_photo'])

/** The HTTP handlers of the brand API. Each one is ready to be used as a route handler. */
export function brandRequestHandlers(deps: BrandRequestDeps) {
  const { brand: brandDeps } = deps

  return {
    list: guard(async () => listBrands(brandDeps)),

    create: guard(async (event) => {
      rejectIfTooLarge(event, MAX_BRAND_CREATE_REQUEST_BYTES)
      const { fields, files } = await readUpload(event)

      const sourceType = SourceType.safeParse(fields.source_type)
      if (!sourceType.success) throw badRequest('source_type must be url, pdf or manual')

      let detail
      switch (sourceType.data) {
        case 'url':
          detail = await createUrlBrand(brandDeps, { url: fields.url ?? '' })
          break
        case 'pdf': {
          const file = files.find(candidate => candidate.name === 'file')
          if (!file) throw badRequest('A PDF file is required in the "file" field')
          detail = await createPdfBrand(brandDeps, { file })
          break
        }
        case 'manual':
          detail = await createManualBrand(brandDeps, { name: fields.name ?? '' })
          break
      }

      setResponseStatus(event, 201)
      return detail
    }),

    get: guard(async (event) => {
      const { id } = await getValidatedRouterParams(event, params => IdParams.parse(params))
      return getBrandDetail(brandDeps, id)
    }),

    patch: guard(async (event) => {
      const { id } = await getValidatedRouterParams(event, params => IdParams.parse(params))
      const body = await readValidatedBody(event, value => PatchBrandBody.parse(value))
      return updateBrandDna(brandDeps, id, body.dna)
    }),

    reExtract: guard(async (event) => {
      const { id } = await getValidatedRouterParams(event, params => IdParams.parse(params))
      return reExtractBrand(brandDeps, id)
    }),

    remove: guard(async (event) => {
      const { id } = await getValidatedRouterParams(event, params => IdParams.parse(params))
      await deleteBrand(brandDeps, id)
      setResponseStatus(event, 204)
      return null
    }),

    uploadAssets: guard(async (event) => {
      const { id } = await getValidatedRouterParams(event, params => IdParams.parse(params))
      // Do not buffer a large upload for a brand that does not exist.
      if (!readBrand(brandDeps.db, id)) throw new BrandError('not_found', 'Brand not found')
      rejectIfTooLarge(event, MAX_ASSET_UPLOAD_REQUEST_BYTES)

      const { fields, files } = await readUpload(event)
      const kind = UploadKind.safeParse(fields.kind)
      if (!kind.success) throw badRequest('kind must be logo or product_photo')

      const uploaded = files.filter(file => file.name === 'files' || file.name === 'file')
      // Content-Length can be absent (chunked), so the real size is checked as well.
      if (uploaded.reduce((total, file) => total + file.data.length, 0) > MAX_ASSET_UPLOAD_REQUEST_BYTES) {
        throw new BrandError('too_large', 'The upload is too large')
      }

      const assets = await addBrandAssets(brandDeps, id, kind.data, uploaded)
      setResponseStatus(event, 201)
      return { assets }
    }),

    patchAsset: guard(async (event) => {
      const { id, assetId } = await getValidatedRouterParams(event, params => AssetParams.parse(params))
      const patch = await readValidatedBody(event, value => PatchAssetBody.parse(value))
      return updateBrandAsset(brandDeps, id, assetId, patch)
    }),

    deleteAsset: guard(async (event) => {
      const { id, assetId } = await getValidatedRouterParams(event, params => AssetParams.parse(params))
      await deleteBrandAsset(brandDeps, id, assetId)
      setResponseStatus(event, 204)
      return null
    }),

    /** GET /api/internal/assets/:id, for n8n. Secret and proxy checks run before the database is touched. */
    internalAsset: guard(async (event) => {
      assertInternalRequest(event, deps.sharedSecret)
      const { id } = await getValidatedRouterParams(event, params => IdParams.parse(params))

      const asset = brandDeps.db.select().from(brandAssets).where(eq(brandAssets.id, id)).get()
      if (!asset) throw createError({ statusCode: 404, statusMessage: STATUS_TEXT[404] })

      return serveMedia(event, brandDeps.mediaDir, asset.path)
    })
  }
}

export type BrandHandlers = ReturnType<typeof brandRequestHandlers>
