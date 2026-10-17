<script setup lang="ts">
import { ref, useId } from 'vue'
import type { BrandListItem } from '~~/shared/schemas/brand'
import { errorMessage } from '~/utils/api-error'

defineProps<{ brands: BrandListItem[] }>()
const emit = defineEmits<{ selected: [] }>()

const titleId = useId()
const { getBrand } = useBrands()
const { activeBrand, setActiveBrand } = useActiveBrand()

const loadingId = ref<string | null>(null)
const error = ref<string | null>(null)

async function select(brand: BrandListItem) {
  if (brand.status !== 'ready' || loadingId.value || activeBrand.value?.id === brand.id) return
  loadingId.value = brand.id
  error.value = null
  try {
    setActiveBrand(await getBrand(brand.id))
    emit('selected')
  } catch (err) {
    error.value = errorMessage(err, 'Could not switch brand')
  } finally {
    loadingId.value = null
  }
}
</script>

<template>
  <section :aria-labelledby="titleId">
    <h2
      :id="titleId"
      class="mb-2 px-2 text-xs uppercase tracking-[0.12em] text-subtle"
    >
      Active brand
    </h2>

    <ul class="flex flex-col gap-1">
      <li
        v-for="brand in brands"
        :key="brand.id"
      >
        <button
          type="button"
          class="flex h-10 w-full items-center gap-3 rounded-[10px] border px-3 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          :class="activeBrand?.id === brand.id
            ? 'border-brand/40 bg-surface-2 text-foreground'
            : 'border-transparent text-muted-foreground hover:bg-surface-2 hover:text-foreground'"
          :aria-pressed="activeBrand?.id === brand.id"
          :disabled="brand.status !== 'ready' || loadingId !== null"
          :title="brand.status === 'ready' ? undefined : 'Available once the Brand DNA is ready'"
          @click="select(brand)"
        >
          <span class="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-2 text-xs font-medium">
            <img
              v-if="brand.logoUrl"
              :src="brand.logoUrl"
              alt=""
              class="size-full object-cover"
            >
            <template v-else>{{ brand.name.charAt(0).toUpperCase() }}</template>
          </span>
          <span class="min-w-0 flex-1 truncate">{{ brand.name }}</span>
          <span
            v-if="brand.status !== 'ready'"
            class="text-xs text-subtle"
          >{{ brand.status === 'extracting' ? 'Extracting' : 'Failed' }}</span>
          <span
            v-else-if="activeBrand?.id === brand.id"
            class="size-2 shrink-0 rounded-full bg-brand"
            aria-label="Active"
          />
        </button>
      </li>
    </ul>

    <p
      v-if="error"
      class="mt-2 px-2 text-xs text-danger"
      role="alert"
    >
      {{ error }}
    </p>
  </section>
</template>
