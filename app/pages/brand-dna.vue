<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Plus } from '@lucide/vue'
import type { BrandDetail, BrandListItem } from '~~/shared/schemas/brand'
import { errorMessage } from '~/utils/api-error'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

useHead({ title: 'Brand DNA · Aladin' })

const { brands, listBrands, reExtractBrand, deleteBrand } = useBrands()
const { activeBrand, setActiveBrand, clearActiveBrand, refreshActiveBrand } = useActiveBrand()

const loading = ref(true)
const loadError = ref<string | null>(null)
const actionError = ref<string | null>(null)

const newBrandOpen = ref(false)

const editBrandId = ref<string | null>(null)
const editOpen = ref(false)

const uploadBrand = ref<BrandListItem | null>(null)
const uploadOpen = ref(false)

const reExtractTarget = ref<BrandListItem | null>(null)
const reExtractOpen = ref(false)
const deleteTarget = ref<BrandListItem | null>(null)
const deleteOpen = ref(false)
const busy = ref(false)

async function load() {
  loadError.value = null
  try {
    await listBrands()
  } catch (error) {
    loadError.value = errorMessage(error, 'Could not load your brands')
  } finally {
    loading.value = false
  }
}

onMounted(load)

/** After anything changed: reload the list (the sidebar follows) and the active brand. */
async function refresh(brandId?: string) {
  await load()
  await refreshActiveBrand(brandId)
}

async function onCreated(brand: BrandDetail) {
  await load()
  // The first brand that is ready to use becomes the active one.
  if (!activeBrand.value && brand.status === 'ready') setActiveBrand(brand)
}

function openEdit(brand: BrandListItem) {
  editBrandId.value = brand.id
  editOpen.value = true
}

function openUpload(brand: BrandListItem) {
  uploadBrand.value = brand
  uploadOpen.value = true
}

function askReExtract(brand: BrandListItem) {
  reExtractTarget.value = brand
  reExtractOpen.value = true
}

function askDelete(brand: BrandListItem) {
  deleteTarget.value = brand
  deleteOpen.value = true
}

async function confirmReExtract() {
  const brand = reExtractTarget.value
  if (!brand) return
  busy.value = true
  actionError.value = null
  try {
    await reExtractBrand(brand.id)
    reExtractOpen.value = false
    await refresh(brand.id)
  } catch (error) {
    reExtractOpen.value = false
    actionError.value = errorMessage(error, 'Could not start the extraction')
    await load()
  } finally {
    busy.value = false
  }
}

async function confirmDelete() {
  const brand = deleteTarget.value
  if (!brand) return
  busy.value = true
  actionError.value = null
  try {
    await deleteBrand(brand.id)
    if (activeBrand.value?.id === brand.id) clearActiveBrand()
    deleteOpen.value = false
    await load()
  } catch (error) {
    deleteOpen.value = false
    actionError.value = errorMessage(error, 'Could not delete the brand')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="mx-auto w-full max-w-[1100px] px-4 py-10 sm:px-6">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-[44px] leading-tight font-bold tracking-tight md:text-5xl">
          Brand DNA
        </h1>
        <p class="mt-3 text-sm text-muted-foreground">
          Brands, their DNA, logos and product photos. Everything Studio creates starts here.
        </p>
      </div>
      <Button @click="newBrandOpen = true">
        <Plus /> New brand
      </Button>
    </header>

    <p
      v-if="actionError"
      class="mt-6 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger"
      role="alert"
    >
      {{ actionError }}
    </p>

    <section
      class="mt-8"
      aria-label="Brands"
    >
      <div
        v-if="loading"
        class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        <Skeleton
          v-for="n in 3"
          :key="n"
          class="h-40 rounded-2xl"
        />
      </div>

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
          @click="load"
        >
          Try again
        </Button>
      </div>

      <div
        v-else-if="brands.length === 0"
        class="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border-strong px-6 py-16 text-center"
      >
        <p class="text-lg font-semibold">
          No brands yet
        </p>
        <p class="max-w-sm text-sm text-muted-foreground">
          Add a website or a PDF and we build the Brand DNA for you, or start from a name and write it yourself.
        </p>
        <Button @click="newBrandOpen = true">
          <Plus /> New brand
        </Button>
      </div>

      <div
        v-else
        class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        <BrandCard
          v-for="brand in brands"
          :key="brand.id"
          :brand="brand"
          :active="activeBrand?.id === brand.id"
          @edit="openEdit(brand)"
          @upload="openUpload(brand)"
          @re-extract="askReExtract(brand)"
          @delete="askDelete(brand)"
          @extraction-finished="refresh(brand.id)"
        />
      </div>
    </section>

    <NewBrandDialog
      v-model:open="newBrandOpen"
      @created="onCreated"
    />

    <EditBrandDnaDialog
      v-model:open="editOpen"
      :brand-id="editBrandId"
      @saved="(brand) => refresh(brand.id)"
    />

    <AssetUpload
      v-if="uploadBrand"
      v-model:open="uploadOpen"
      :brand-id="uploadBrand.id"
      :brand-name="uploadBrand.name"
      @uploaded="refresh(uploadBrand.id)"
    />

    <ConfirmDialog
      v-model:open="reExtractOpen"
      title="Extract again?"
      :description="`The Brand DNA of ${reExtractTarget?.name ?? 'this brand'} is rebuilt from its original source and replaces what is there now, including your edits. The current DNA stays until the new one is ready.`"
      confirm-label="Extract again"
      :busy="busy"
      @confirm="confirmReExtract"
    />

    <ConfirmDialog
      v-model:open="deleteOpen"
      title="Delete this brand?"
      :description="`${deleteTarget?.name ?? 'This brand'}, its Brand DNA, logo and product photos are removed for good.`"
      confirm-label="Delete brand"
      destructive
      :busy="busy"
      @confirm="confirmDelete"
    />
  </div>
</template>
