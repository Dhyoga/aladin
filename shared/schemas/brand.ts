import { z } from 'zod'
import { BrandDNA } from './brand-dna'
import { JOB_STATUSES } from './job'

export const BRAND_STATUSES = ['extracting', 'ready', 'failed'] as const
export const BRAND_SOURCE_TYPES = ['url', 'pdf', 'manual'] as const
export const ASSET_KINDS = ['logo', 'product_photo', 'source_pdf'] as const

export type BrandStatus = (typeof BRAND_STATUSES)[number]
export type BrandSourceType = (typeof BRAND_SOURCE_TYPES)[number]
export type AssetKind = (typeof ASSET_KINDS)[number]

const MB = 1024 * 1024

// Limits (design.md section 8 / AGENTS.md). One place, so they are easy to change.
export const MAX_IMAGE_BYTES = 10 * MB
export const MAX_PDF_BYTES = 20 * MB
export const MAX_BRAND_CREATE_REQUEST_BYTES = 21 * MB
export const MAX_ASSET_UPLOAD_REQUEST_BYTES = 60 * MB
export const MAX_PRODUCT_PHOTOS = 20
export const MAX_LABEL_LENGTH = 60
export const MAX_BRAND_NAME_LENGTH = 100

export const AssetDto = z.object({
  id: z.string(),
  kind: z.enum(ASSET_KINDS),
  url: z.string(),
  mime: z.string(),
  sizeBytes: z.number(),
  label: z.string().nullable(),
  sortOrder: z.number()
})

/** The latest brand_extract job of a brand, shown while extracting or after a failure. */
export const ExtractionDto = z.object({
  jobId: z.string(),
  status: z.enum(JOB_STATUSES),
  stage: z.string().nullable(),
  error: z.string().nullable()
})

export const BrandListItem = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(BRAND_STATUSES),
  sourceType: z.enum(BRAND_SOURCE_TYPES),
  logoUrl: z.string().nullable(),
  updatedAt: z.number()
})

export const BrandDetail = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(BRAND_STATUSES),
  sourceType: z.enum(BRAND_SOURCE_TYPES),
  sourceUrl: z.string().nullable(),
  dna: BrandDNA.nullable(),
  logo: AssetDto.nullable(),
  photos: z.array(AssetDto),
  extraction: ExtractionDto.nullable(),
  createdAt: z.number(),
  updatedAt: z.number()
})

export const PatchBrandBody = z.object({ dna: BrandDNA })

export const PatchAssetBody = z.object({
  label: z.string().max(MAX_LABEL_LENGTH).nullable().optional(),
  sortOrder: z.number().int().min(0).optional()
})

export type AssetDto = z.infer<typeof AssetDto>
export type ExtractionDto = z.infer<typeof ExtractionDto>
export type BrandListItem = z.infer<typeof BrandListItem>
export type BrandDetail = z.infer<typeof BrandDetail>
export type PatchBrandBody = z.infer<typeof PatchBrandBody>
export type PatchAssetBody = z.infer<typeof PatchAssetBody>
