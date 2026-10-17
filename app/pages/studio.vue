<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useIntervalFn } from '@vueuse/core'
import type { GenerationDetail } from '~~/shared/schemas/generation'
import { errorMessage } from '~/utils/api-error'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

useHead({ title: 'Studio · Aladin' })

const { brands, listBrands } = useBrands()
const { activeBrand, syncActiveBrand } = useActiveBrand()
const { history, selectedId, loadHistory } = useGenerations()

const loading = ref(true)
const loadError = ref<string | null>(null)

const readyBrands = computed(() => brands.value.filter(brand => brand.status === 'ready'))

async function loadBrands() {
  loading.value = true
  loadError.value = null
  try {
    await syncActiveBrand(await listBrands())
  } catch (error) {
    loadError.value = errorMessage(error, 'Could not load your brands')
  } finally {
    loading.value = false
  }
}

onMounted(loadBrands)

async function refreshHistory() {
  const brand = activeBrand.value
  if (!brand) {
    history.value = []
    return
  }
  try {
    const list = await loadHistory(brand.id)
    // A selection that is no longer in the list (deleted, or another brand) must not linger.
    if (selectedId.value && !list.some(item => item.id === selectedId.value)) selectedId.value = null
  } catch {
    // The next refresh tries again; the history in the sidebar just stays as it was.
  }
}

watch(
  () => activeBrand.value?.id,
  (id, previous) => {
    if (previous !== undefined && id !== previous) {
      selectedId.value = null
      history.value = []
    }
    void refreshHistory()
  },
  { immediate: true }
)

// Posts take about a minute: the history follows them by itself while one is running.
// The page is the single owner of this polling, not each item.
const hasRunning = computed(() => history.value.some(item => item.status === 'running'))
const { pause, resume } = useIntervalFn(refreshHistory, 3000, { immediate: false })
watch(hasRunning, running => (running ? resume() : pause()), { immediate: true })

async function show(generation: GenerationDetail) {
  selectedId.value = generation.id
  await refreshHistory()
}
</script>

<template>
  <div class="mx-auto w-full max-w-[720px] px-4 py-10 sm:px-6">
    <header>
      <h1 class="text-[44px] leading-tight font-bold tracking-tight md:text-5xl">
        Studio
      </h1>
      <p class="mt-3 text-sm text-muted-foreground">
        Turn a brand and an idea into an Instagram post, ready to copy and download.
      </p>
    </header>

    <div class="mt-8 grid gap-8">
      <Skeleton
        v-if="loading"
        class="h-72 rounded-2xl"
      />

      <div
        v-else-if="loadError"
        class="rounded-2xl border border-danger/30 bg-danger/10 p-6 text-sm"
        role="alert"
      >
        <p class="text-danger">
          {{ loadError }}
        </p>
        <Button
          class="mt-4"
          variant="outline"
          @click="loadBrands"
        >
          Try again
        </Button>
      </div>

      <div
        v-else-if="brands.length === 0"
        class="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border-strong px-6 py-14 text-center"
      >
        <p class="text-lg font-semibold">
          Create a brand first
        </p>
        <p class="max-w-sm text-sm text-muted-foreground">
          Posts are written from a Brand DNA. Add a website or a PDF and we build it for you.
        </p>
        <Button as-child>
          <NuxtLink to="/brand-dna">
            Go to Brand DNA
          </NuxtLink>
        </Button>
      </div>

      <div
        v-else-if="readyBrands.length === 0"
        class="rounded-2xl border border-border bg-surface px-6 py-10 text-center text-sm text-muted-foreground"
      >
        No brand is ready yet. Brands that are still being extracted can be used as soon as their Brand DNA is ready.
        <NuxtLink
          to="/brand-dna"
          class="mt-3 block text-foreground underline underline-offset-4"
        >
          See the brands
        </NuxtLink>
      </div>

      <div
        v-else-if="!activeBrand"
        class="grid gap-4 rounded-2xl border border-border bg-surface p-6"
      >
        <p class="font-semibold">
          Pick a brand to start
        </p>
        <BrandPicker />
      </div>

      <template v-else>
        <StudioComposer
          :brand="activeBrand"
          @created="show"
        />

        <PostResult
          v-if="selectedId"
          :generation-id="selectedId"
          @changed="refreshHistory"
          @regenerated="show"
        />
      </template>
    </div>
  </div>
</template>
