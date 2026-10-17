<script setup lang="ts">
import { computed, ref } from 'vue'
import { errorMessage } from '~/utils/api-error'

const { brands, getBrand } = useBrands()
const { activeBrand, setActiveBrand } = useActiveBrand()

const ready = computed(() => brands.value.filter(brand => brand.status === 'ready'))
const error = ref<string | null>(null)
const loading = ref(false)

// Changing the brand here changes the active brand of the sidebar too: it is the same state.
async function onChange(event: Event) {
  const id = (event.target as HTMLSelectElement).value
  if (!id || id === activeBrand.value?.id) return
  loading.value = true
  error.value = null
  try {
    setActiveBrand(await getBrand(id))
  } catch (err) {
    error.value = errorMessage(err, 'Could not switch brand')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-w-0">
    <label class="sr-only" for="studio-brand">Brand</label>
    <select
      id="studio-brand"
      class="h-8 w-full max-w-[16rem] truncate rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
      :value="activeBrand?.id ?? ''"
      :disabled="loading"
      @change="onChange"
    >
      <option
        value=""
        disabled
      >
        Choose a brand
      </option>
      <option
        v-for="brand in ready"
        :key="brand.id"
        :value="brand.id"
        class="bg-popover"
      >
        {{ brand.name }}
      </option>
    </select>
    <p
      v-if="error"
      class="mt-1 text-xs text-danger"
      role="alert"
    >
      {{ error }}
    </p>
  </div>
</template>
