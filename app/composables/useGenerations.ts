import { z } from 'zod'
import {
  GenerationDetail,
  GenerationListItem,
  type AspectRatio,
  type PatchGenerationBody
} from '~~/shared/schemas/generation'
import { regeneratePhotoIds } from '~/utils/studio'

export interface CreateGenerationInput {
  brandId: string
  prompt: string
  aspectRatio: AspectRatio
  assetIds: string[]
}

/** Client for the generations API. Every response is parsed, so a contract change fails loudly. */
export function useGenerations() {
  // Shared by the Studio page (which loads and refreshes it) and the sidebar (which shows it).
  const history = useState<GenerationListItem[]>('generationHistory', () => [])
  // The generation shown in the result area.
  const selectedId = useState<string | null>('studioSelectedGeneration', () => null)

  async function loadHistory(brandId: string): Promise<GenerationListItem[]> {
    const data = z.array(GenerationListItem).parse(await $fetch('/api/generations', { query: { brandId } }))
    history.value = data
    return data
  }

  async function getGeneration(id: string): Promise<GenerationDetail> {
    const url: string = `/api/generations/${id}`
    return GenerationDetail.parse(await $fetch(url))
  }

  async function createGeneration(input: CreateGenerationInput): Promise<GenerationDetail> {
    return GenerationDetail.parse(await $fetch('/api/generations', { method: 'POST', body: input }))
  }

  async function patchGeneration(id: string, patch: PatchGenerationBody): Promise<GenerationDetail> {
    const url: string = `/api/generations/${id}`
    return GenerationDetail.parse(await $fetch(url, { method: 'PATCH', body: patch }))
  }

  /** Starts the video of a finished post (about $1; the caller asks the user first). */
  async function createVideo(id: string): Promise<GenerationDetail> {
    const url: string = `/api/generations/${id}/video`
    return GenerationDetail.parse(await $fetch(url, { method: 'POST' }))
  }

  async function deleteGeneration(id: string): Promise<void> {
    const url: string = `/api/generations/${id}`
    await $fetch(url, { method: 'DELETE' })
  }

  /**
   * A new generation with the prompt and ratio of `source`, and the photos of the original
   * that still exist (the first photo of the brand when none do). Retry on a failed
   * generation is the same thing.
   */
  async function regenerate(source: GenerationDetail, currentPhotoIds: readonly string[]): Promise<GenerationDetail> {
    const assetIds = regeneratePhotoIds(source.assetIds, currentPhotoIds)
    if (assetIds.length === 0) throw new Error('This brand has no product photos left. Upload one on the Brand DNA page.')
    return createGeneration({
      brandId: source.brandId,
      prompt: source.prompt,
      aspectRatio: source.aspectRatio,
      assetIds
    })
  }

  return { history, selectedId, loadHistory, getGeneration, createGeneration, patchGeneration, createVideo, deleteGeneration, regenerate }
}
