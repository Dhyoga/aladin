import type { BrandDetail, BrandListItem } from '~~/shared/schemas/brand'

/**
 * The brand the Studio works with. The detail lives in `useState`; only the id is
 * remembered across reloads (cookie `last_brand_id`, design.md section 4).
 */
export function useActiveBrand() {
  const activeBrand = useState<BrandDetail | null>('activeBrand', () => null)
  const lastBrandId = useCookie<string | null>('last_brand_id', {
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    default: () => null
  })
  const { getBrand } = useBrands()

  function setActiveBrand(brand: BrandDetail | null) {
    activeBrand.value = brand
    lastBrandId.value = brand?.id ?? null
  }

  function clearActiveBrand() {
    setActiveBrand(null)
  }

  /** Re-reads the active brand, after it was edited or extracted again. */
  async function refreshActiveBrand(id?: string) {
    const current = activeBrand.value
    if (!current || (id && current.id !== id)) return
    try {
      activeBrand.value = await getBrand(current.id)
    } catch {
      // gone, or the server is unreachable: the next list refresh sorts it out
    }
  }

  /**
   * Keeps the active brand consistent with the list: restores the remembered brand after
   * a reload, and drops it when it no longer exists.
   */
  async function syncActiveBrand(list: BrandListItem[]) {
    const current = activeBrand.value
    if (current && !list.some(item => item.id === current.id)) {
      clearActiveBrand()
    }
    if (!activeBrand.value && lastBrandId.value && list.some(item => item.id === lastBrandId.value)) {
      try {
        activeBrand.value = await getBrand(lastBrandId.value)
      } catch {
        lastBrandId.value = null
      }
    }
  }

  return { activeBrand, setActiveBrand, clearActiveBrand, refreshActiveBrand, syncActiveBrand }
}
