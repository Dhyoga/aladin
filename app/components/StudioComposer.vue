<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Sparkles } from '@lucide/vue'
import type { BrandDetail } from '~~/shared/schemas/brand'
import {
  ASPECT_RATIOS,
  DEFAULT_ASPECT_RATIO,
  MAX_GENERATION_PHOTOS,
  MAX_PROMPT_LENGTH,
  POST_COST_LABEL,
  type AspectRatio,
  type GenerationDetail
} from '~~/shared/schemas/generation'
import { errorMessage } from '~/utils/api-error'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

const props = defineProps<{ brand: BrandDetail }>()
const emit = defineEmits<{ created: [generation: GenerationDetail] }>()

const { createGeneration } = useGenerations()

// The draft survives moving to another page and back.
const prompt = useState('studioPrompt', () => '')
const aspectRatio = useState<AspectRatio>('studioAspectRatio', () => DEFAULT_ASPECT_RATIO)

const selected = ref<string[]>([])
const limitReached = ref(false)
const submitting = ref(false)
const error = ref<string | null>(null)

// Photos can change under us (uploaded or deleted on the Brand DNA page, or another brand picked):
// drop the ones that are gone, and preselect the first photo when nothing is left selected.
watch(
  () => props.brand.photos.map(photo => photo.id).join(','),
  () => {
    const available = new Set(props.brand.photos.map(photo => photo.id))
    selected.value = selected.value.filter(id => available.has(id))
    const first = props.brand.photos[0]
    if (selected.value.length === 0 && first) selected.value = [first.id]
    limitReached.value = false
  },
  { immediate: true }
)

function togglePhoto(id: string) {
  limitReached.value = false
  if (selected.value.includes(id)) {
    selected.value = selected.value.filter(other => other !== id)
  } else if (selected.value.length >= MAX_GENERATION_PHOTOS) {
    limitReached.value = true
  } else {
    selected.value = [...selected.value, id]
  }
}

const RATIO_LABELS: Record<AspectRatio, string> = { '1:1': 'Square 1:1', '4:5': 'Portrait 4:5' }

const trimmed = computed(() => prompt.value.trim())
const blocker = computed(() => {
  if (props.brand.photos.length === 0) return 'Add a product photo to this brand first.'
  if (selected.value.length === 0) return 'Choose at least one product photo.'
  return null
})
const canSubmit = computed(() => !submitting.value && trimmed.value !== '' && selected.value.length > 0)

async function submit() {
  if (!canSubmit.value) return
  submitting.value = true
  error.value = null
  try {
    const generation = await createGeneration({
      brandId: props.brand.id,
      prompt: trimmed.value,
      aspectRatio: aspectRatio.value,
      assetIds: selected.value
    })
    emit('created', generation)
  } catch (err) {
    error.value = errorMessage(err, 'Could not start the post')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <form
    class="grid gap-5 rounded-2xl border border-border bg-surface p-5"
    novalidate
    @submit.prevent="submit"
  >
    <div class="flex flex-wrap items-center justify-between gap-3">
      <span class="text-xs uppercase tracking-[0.12em] text-subtle">Create with</span>
      <BrandPicker />
    </div>

    <div class="grid gap-2">
      <label
        class="sr-only"
        for="studio-prompt"
      >What do you want to post about?</label>
      <Textarea
        id="studio-prompt"
        v-model="prompt"
        rows="4"
        :maxlength="MAX_PROMPT_LENGTH"
        placeholder="Tell your agent what you want to post about."
        class="min-h-28 resize-y"
      />
      <p
        v-if="prompt.length > MAX_PROMPT_LENGTH - 200"
        class="text-right text-xs text-subtle"
      >
        {{ prompt.length }} / {{ MAX_PROMPT_LENGTH }}
      </p>
    </div>

    <fieldset class="grid gap-2">
      <legend class="mb-1 text-xs uppercase tracking-[0.12em] text-subtle">
        Product photos
        <span class="normal-case tracking-normal">· up to {{ MAX_GENERATION_PHOTOS }}</span>
      </legend>

      <p
        v-if="brand.photos.length === 0"
        class="rounded-lg border border-dashed border-border-strong px-3 py-4 text-sm text-muted-foreground"
      >
        This brand has no product photos yet. They make sure your real product appears in the post.
        <NuxtLink
          to="/brand-dna"
          class="text-foreground underline underline-offset-4"
        >Add photos on the Brand DNA page</NuxtLink>.
      </p>

      <ul
        v-else
        class="flex flex-wrap gap-2"
      >
        <li
          v-for="(photo, index) in brand.photos"
          :key="photo.id"
        >
          <button
            type="button"
            class="relative block size-16 overflow-hidden rounded-lg border-2 bg-surface-2 transition-colors"
            :class="selected.includes(photo.id) ? 'border-brand' : 'border-transparent hover:border-border-strong'"
            :aria-pressed="selected.includes(photo.id)"
            :aria-label="`Photo ${index + 1}${photo.label ? `: ${photo.label}` : ''}`"
            :title="photo.label ?? `Photo ${index + 1}`"
            @click="togglePhoto(photo.id)"
          >
            <img
              :src="photo.url"
              :alt="photo.label ?? `Product photo ${index + 1}`"
              class="size-full object-cover"
            >
            <span
              v-if="selected.includes(photo.id)"
              class="absolute top-0.5 right-0.5 flex size-4 items-center justify-center rounded-full bg-brand text-[10px] font-semibold text-black"
            >{{ selected.indexOf(photo.id) + 1 }}</span>
          </button>
        </li>
      </ul>

      <p
        v-if="limitReached"
        class="text-xs text-amber-300"
        role="status"
      >
        You can choose up to {{ MAX_GENERATION_PHOTOS }} photos. Deselect one to pick another.
      </p>
    </fieldset>

    <fieldset class="grid gap-2">
      <legend class="mb-1 text-xs uppercase tracking-[0.12em] text-subtle">
        Image shape
      </legend>
      <div
        class="inline-grid w-fit grid-cols-2 gap-1 rounded-full bg-surface-2 p-1"
        role="radiogroup"
        aria-label="Image shape"
      >
        <button
          v-for="ratio in ASPECT_RATIOS"
          :key="ratio"
          type="button"
          role="radio"
          :aria-checked="aspectRatio === ratio"
          class="h-8 rounded-full px-4 text-sm transition-colors"
          :class="aspectRatio === ratio ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'"
          @click="aspectRatio = ratio"
        >
          {{ RATIO_LABELS[ratio] }}
        </button>
      </div>
    </fieldset>

    <p
      v-if="error"
      class="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
      role="alert"
    >
      {{ error }}
    </p>

    <div class="flex flex-wrap items-center justify-between gap-3">
      <p
        class="text-xs text-subtle"
        :class="blocker ? 'text-amber-300' : ''"
      >
        {{ blocker ?? 'Takes about a minute.' }}
      </p>
      <Button
        type="submit"
        size="lg"
        :disabled="!canSubmit"
      >
        <Sparkles />
        {{ submitting ? 'Starting…' : 'Generate Post' }}
        <span
          class="ml-1 rounded-full bg-black/10 px-2 py-0.5 text-xs font-medium"
          aria-label="Estimated cost"
        >{{ POST_COST_LABEL }}</span>
      </Button>
    </div>
  </form>
</template>
