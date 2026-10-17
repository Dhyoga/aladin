<script setup lang="ts">
import { computed } from 'vue'
import { ImagePlus, Pencil, RefreshCw, Trash2 } from '@lucide/vue'
import type { BrandListItem } from '~~/shared/schemas/brand'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

const props = defineProps<{
  brand: BrandListItem
  active?: boolean
}>()

const emit = defineEmits<{
  edit: []
  upload: []
  reExtract: []
  delete: []
  extractionFinished: []
}>()

const STATUS = {
  extracting: { label: 'Extracting', class: 'border-amber-500/30 bg-amber-500/10 text-amber-300' },
  ready: { label: 'Ready', class: 'border-success/30 bg-success/10 text-success' },
  failed: { label: 'Failed', class: 'border-danger/30 bg-danger/10 text-danger' }
} as const

const status = computed(() => STATUS[props.brand.status])
const busy = computed(() => props.brand.status === 'extracting')
const canReExtract = computed(() => props.brand.sourceType !== 'manual' && !busy.value)

const SOURCE_LABELS = { url: 'Website', pdf: 'PDF', manual: 'Manual' } as const

const updated = computed(() =>
  new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(props.brand.updatedAt)
)
</script>

<template>
  <article
    class="flex flex-col gap-4 rounded-2xl border bg-surface p-5 transition-colors"
    :class="active ? 'border-brand/40' : 'border-border'"
    :aria-label="brand.name"
  >
    <header class="flex items-start gap-3">
      <div class="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-surface-2 text-lg font-semibold text-muted-foreground">
        <img
          v-if="brand.logoUrl"
          :src="brand.logoUrl"
          :alt="`${brand.name} logo`"
          class="size-full object-cover"
        >
        <span v-else>{{ brand.name.charAt(0).toUpperCase() }}</span>
      </div>

      <div class="min-w-0 flex-1">
        <h3 class="truncate text-base font-semibold leading-tight">
          {{ brand.name }}
        </h3>
        <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Badge
            variant="outline"
            :class="status.class"
          >
            {{ status.label }}
          </Badge>
          <Badge variant="outline">
            {{ SOURCE_LABELS[brand.sourceType] }}
          </Badge>
          <Badge
            v-if="active"
            variant="outline"
            class="border-brand/40 text-brand"
          >
            Active
          </Badge>
        </div>
      </div>
    </header>

    <ExtractionProgress
      v-if="brand.status !== 'ready'"
      :key="`${brand.id}-${brand.status}`"
      :brand-id="brand.id"
      :status="brand.status"
      @finished="emit('extractionFinished')"
    />

    <footer class="mt-auto flex items-center justify-between gap-2">
      <time
        class="text-xs text-subtle"
        :datetime="new Date(brand.updatedAt).toISOString()"
      >
        Updated {{ updated }}
      </time>

      <div class="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Edit Brand DNA"
          title="Edit Brand DNA"
          :disabled="busy"
          @click="emit('edit')"
        >
          <Pencil />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Upload logo or product photos"
          title="Upload logo or product photos"
          @click="emit('upload')"
        >
          <ImagePlus />
        </Button>
        <Button
          v-if="brand.sourceType !== 'manual'"
          variant="ghost"
          size="icon-sm"
          aria-label="Extract again"
          title="Extract again"
          :disabled="!canReExtract"
          @click="emit('reExtract')"
        >
          <RefreshCw />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Delete brand"
          title="Delete brand"
          @click="emit('delete')"
        >
          <Trash2 />
        </Button>
      </div>
    </footer>
  </article>
</template>
