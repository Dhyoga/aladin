import { z } from 'zod'
import {
  AssetDto,
  BrandDetail,
  BrandListItem,
  PatchAssetBody,
  PatchBrandBody
} from '~~/shared/schemas/brand'
import type { BrandDNA } from '~~/shared/schemas/brand-dna'

export type CreateBrandInput
  = | { source_type: 'url', url: string }
    | { source_type: 'pdf', file: File }
    | { source_type: 'manual', name: string }

/** Client for the brand API. Every response is parsed, so a contract change fails loudly. */
export function useBrands() {
  // Shared by the sidebar switcher and the Brand DNA page.
  const brands = useState<BrandListItem[]>('brands', () => [])

  async function listBrands(): Promise<BrandListItem[]> {
    const data = z.array(BrandListItem).parse(await $fetch('/api/brands'))
    brands.value = data
    return data
  }

  async function getBrand(id: string): Promise<BrandDetail> {
    return BrandDetail.parse(await $fetch(`/api/brands/${id}`))
  }

  async function createBrand(input: CreateBrandInput): Promise<BrandDetail> {
    const body = new FormData()
    body.append('source_type', input.source_type)
    if (input.source_type === 'url') body.append('url', input.url)
    if (input.source_type === 'pdf') body.append('file', input.file)
    if (input.source_type === 'manual') body.append('name', input.name)

    return BrandDetail.parse(await $fetch('/api/brands', { method: 'POST', body }))
  }

  async function updateBrandDna(id: string, dna: BrandDNA): Promise<BrandDetail> {
    const body = PatchBrandBody.parse({ dna })
    return BrandDetail.parse(await $fetch(`/api/brands/${id}`, { method: 'PATCH', body }))
  }

  async function reExtractBrand(id: string): Promise<BrandDetail> {
    return BrandDetail.parse(await $fetch(`/api/brands/${id}/re-extract`, { method: 'POST' }))
  }

  async function deleteBrand(id: string): Promise<void> {
    await $fetch(`/api/brands/${id}`, { method: 'DELETE' })
  }

  async function uploadAssets(brandId: string, kind: 'logo' | 'product_photo', files: File[]): Promise<AssetDto[]> {
    const body = new FormData()
    body.append('kind', kind)
    for (const file of files) body.append('files', file)

    const data = z.object({ assets: z.array(AssetDto) }).parse(
      await $fetch(`/api/brands/${brandId}/assets`, { method: 'POST', body })
    )
    return data.assets
  }

  async function updateAsset(brandId: string, assetId: string, patch: PatchAssetBody): Promise<AssetDto> {
    const body = PatchAssetBody.parse(patch)
    return AssetDto.parse(await $fetch(`/api/brands/${brandId}/assets/${assetId}`, { method: 'PATCH', body }))
  }

  async function deleteAsset(brandId: string, assetId: string): Promise<void> {
    await $fetch(`/api/brands/${brandId}/assets/${assetId}`, { method: 'DELETE' })
  }

  return {
    brands,
    listBrands,
    getBrand,
    createBrand,
    updateBrandDna,
    reExtractBrand,
    deleteBrand,
    uploadAssets,
    updateAsset,
    deleteAsset
  }
}
