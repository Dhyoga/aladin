<script setup lang="ts">
import { ref, useId } from 'vue'
import { LoaderCircle, Trash2, TriangleAlert } from '@lucide/vue'
import type { GenerationListItem } from '~~/shared/schemas/generation'
import { errorMessage } from '~/utils/api-error'
import { timeAgo } from '~/utils/studio'

const emit = defineEmits<{ select: [] }>()

// The sidebar exists twice (desktop, and the mobile drawer), so an id must be unique per instance.
const titleId = useId()

const { history, selectedId, loadHistory, deleteGeneration } = useGenerations()
const { activeBrand } = useActiveBrand()

const target = ref<GenerationListItem | null>(null)
const confirmOpen = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)

function choose(item: GenerationListItem) {
  selectedId.value = item.id
  emit('select')
}

function askDelete(item: GenerationListItem) {
  target.value = item
  confirmOpen.value = true
}

async function confirmDelete() {
  const item = target.value
  if (!item) return
  busy.value = true
  error.value = null
  try {
    await deleteGeneration(item.id)
    if (selectedId.value === item.id) selectedId.value = null
    confirmOpen.value = false
    if (activeBrand.value) await loadHistory(activeBrand.value.id)
  } catch (err) {
    confirmOpen.value = false
    error.value = errorMessage(err, 'Could not delete this post')
  } finally {
    busy.value = false
  }
}

const STATUS_LABEL = { running: 'Creating…', failed: 'Failed', completed: '' } as const
</script>

<template>
  <section
    v-if="activeBrand"
    :aria-labelledby="titleId"
  >
    <h2
      :id="titleId"
      class="mb-2 px-2 text-xs uppercase tracking-[0.12em] text-subtle"
    >
      History
    </h2>

    <p
      v-if="history.length === 0"
      class="px-2 text-xs text-subtle"
    >
      Posts you create for {{ activeBrand.name }} appear here.
    </p>

    <ul
      v-else
      class="flex flex-col gap-1"
    >
      <li
        v-for="item in history"
        :key="item.id"
        class="group relative"
      >
        <button
          type="button"
          class="flex w-full items-center gap-3 rounded-[10px] border p-2 pr-9 text-left transition-colors"
          :class="selectedId === item.id
            ? 'border-brand/40 bg-surface-2'
            : 'border-transparent hover:bg-surface-2'"
          :aria-pressed="selectedId === item.id"
          @click="choose(item)"
        >
          <span class="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-2">
            <img
              v-if="item.imageUrl"
              :src="item.imageUrl"
              alt=""
              class="size-full object-cover"
            >
            <LoaderCircle
              v-else-if="item.status === 'running'"
              class="size-4 animate-spin text-brand"
              aria-label="Creating"
            />
            <TriangleAlert
              v-else
              class="size-4 text-danger"
              aria-label="Failed"
            />
          </span>
          <span class="min-w-0 flex-1">
            <span class="line-clamp-2 text-xs leading-snug text-foreground">{{ item.prompt }}</span>
            <span class="mt-0.5 block text-[11px] text-subtle">
              {{ timeAgo(item.createdAt) }}<template v-if="STATUS_LABEL[item.status]"> · {{ STATUS_LABEL[item.status] }}</template>
            </span>
          </span>
        </button>
        <button
          type="button"
          class="absolute top-1/2 right-1.5 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-subtle transition hover:bg-surface hover:text-danger focus-visible:opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
          :aria-label="`Delete post: ${item.prompt.slice(0, 40)}`"
          @click="askDelete(item)"
        >
          <Trash2 class="size-3.5" />
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

    <ConfirmDialog
      v-model:open="confirmOpen"
      title="Delete this post?"
      description="The post and its image are removed for good. You cannot undo this."
      confirm-label="Delete post"
      destructive
      :busy="busy"
      @confirm="confirmDelete"
    />
  </section>
</template>
