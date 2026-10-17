<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useClipboard } from '@vueuse/core'
import { Check, Copy, Download, LoaderCircle, Pencil, RefreshCw, TriangleAlert } from '@lucide/vue'
import { MAX_CAPTION_LENGTH, type GenerationDetail } from '~~/shared/schemas/generation'
import { errorMessage } from '~/utils/api-error'
import { captionToClipboard, downloadName, friendlyGenerationError } from '~/utils/studio'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'

const props = defineProps<{ generationId: string }>()
const emit = defineEmits<{
  /** The generation changed (it finished, or was edited): the history should be reloaded. */
  changed: []
  /** Regenerate or Retry made a new generation, which should now be shown. */
  regenerated: [generation: GenerationDetail]
}>()

const { getGeneration, patchGeneration, regenerate } = useGenerations()
const { activeBrand } = useActiveBrand()
const polling = useJobPolling({ intervalMs: 2000 })
const { copy, copied, isSupported: canCopy } = useClipboard({ copiedDuring: 1800 })

const detail = ref<GenerationDetail | null>(null)
const loading = ref(true)
const loadError = ref<string | null>(null)
const actionError = ref<string | null>(null)
const busy = ref(false)

const editing = ref(false)
const draft = ref('')
const saving = ref(false)
const editProblem = ref<string | null>(null)

async function load(id: string) {
  polling.stop()
  editing.value = false
  actionError.value = null
  loadError.value = null
  // Reloading the same generation keeps what is on screen; another one must not show (or act on) the old one.
  if (detail.value?.id !== id) detail.value = null
  loading.value = detail.value === null
  try {
    const loaded = await getGeneration(id)
    if (id !== props.generationId) return // another generation was picked meanwhile
    detail.value = loaded
    // A running post is followed through its job; the generation is reloaded when the job ends.
    if (loaded.status === 'running' && loaded.jobId) polling.start(loaded.jobId)
  } catch (error) {
    if (id !== props.generationId) return
    detail.value = null
    loadError.value = errorMessage(error, 'Could not load this post')
  } finally {
    loading.value = false
  }
}

/**
 * Reloads the detail without resetting anything else: an open caption editor, a pending action.
 * Used when the video reports something new (a stage, the storyboard, the end).
 */
async function refreshDetail() {
  const id = props.generationId
  try {
    const loaded = await getGeneration(id)
    if (id === props.generationId) detail.value = loaded
  } catch {
    // The next event tries again; what is on screen stays.
  }
}

watch(() => props.generationId, load, { immediate: true })

watch(polling.status, async (status) => {
  if (status !== 'completed' && status !== 'failed') return
  await load(props.generationId)
  emit('changed')
})

const STEPS = [
  { key: 'caption', label: 'Caption' },
  { key: 'image', label: 'Image' }
] as const

const currentStage = computed(() => polling.stage.value ?? detail.value?.stage ?? null)
const currentStep = computed(() => STEPS.findIndex(step => step.key === currentStage.value))

const brand = computed(() => activeBrand.value)
const ratioStyle = computed(() => ({ aspectRatio: detail.value?.aspectRatio === '1:1' ? '1 / 1' : '4 / 5' }))

async function copyCaption() {
  const current = detail.value
  if (!current?.caption) return
  actionError.value = null
  try {
    await copy(captionToClipboard(current.caption, current.hashtags))
  } catch {
    actionError.value = 'Could not copy. Select the text and copy it by hand.'
  }
}

function startEdit() {
  draft.value = detail.value?.caption ?? ''
  editProblem.value = null
  editing.value = true
}

function cancelEdit() {
  editing.value = false
  editProblem.value = null
}

async function saveEdit() {
  const current = detail.value
  if (!current) return
  const caption = draft.value.trim()
  if (caption === '') {
    editProblem.value = 'The caption cannot be empty.'
    return
  }
  if (caption.length > MAX_CAPTION_LENGTH) {
    editProblem.value = `The caption can be at most ${MAX_CAPTION_LENGTH} characters.`
    return
  }
  if (caption === current.caption) {
    cancelEdit()
    return
  }

  saving.value = true
  editProblem.value = null
  try {
    detail.value = await patchGeneration(current.id, { caption })
    editing.value = false
    emit('changed')
  } catch (error) {
    editProblem.value = errorMessage(error, 'Could not save the caption')
  } finally {
    saving.value = false
  }
}

/** Regenerate and Retry: a new generation with the same prompt, ratio and the photos that still exist. */
async function again() {
  const current = detail.value
  if (!current || busy.value) return
  busy.value = true
  actionError.value = null
  try {
    const next = await regenerate(current, brand.value?.photos.map(photo => photo.id) ?? [])
    emit('regenerated', next)
  } catch (error) {
    actionError.value = errorMessage(error, 'Could not start a new post')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section
    aria-live="polite"
    aria-label="Result"
  >
    <Skeleton
      v-if="loading && !detail"
      class="h-96 rounded-2xl"
    />

    <div
      v-else-if="loadError"
      class="rounded-2xl border border-danger/30 bg-danger/10 p-5 text-sm"
      role="alert"
    >
      <p class="text-danger">
        {{ loadError }}
      </p>
      <Button
        class="mt-3"
        variant="outline"
        @click="load(generationId)"
      >
        Try again
      </Button>
    </div>

    <!-- Running -->
    <div
      v-else-if="detail?.status === 'running'"
      class="grid gap-3"
    >
      <h2 class="text-sm font-medium text-muted-foreground">
        Creating your post…
      </h2>
      <div
        class="relative flex w-full items-center justify-center overflow-hidden rounded-xl border border-border bg-surface"
        :style="ratioStyle"
      >
        <Skeleton class="absolute inset-0 rounded-none" />
        <ol
          class="relative z-10 grid gap-2 rounded-xl bg-black/60 px-5 py-4 text-sm backdrop-blur"
          aria-label="Progress"
        >
          <li
            v-for="(step, index) in STEPS"
            :key="step.key"
            class="flex items-center gap-2"
            :class="index > currentStep ? 'text-subtle' : 'text-foreground'"
          >
            <Check
              v-if="index < currentStep"
              class="size-4 text-success"
            />
            <LoaderCircle
              v-else-if="index === currentStep"
              class="size-4 animate-spin text-brand"
            />
            <span
              v-else
              class="size-4 rounded-full border border-border-strong"
            />
            <span :aria-current="index === currentStep ? 'step' : undefined">{{ step.label }}</span>
          </li>
          <li
            v-if="currentStep === -1"
            class="text-xs text-subtle"
          >
            Starting…
          </li>
        </ol>
      </div>
    </div>

    <!-- Failed -->
    <div
      v-else-if="detail?.status === 'failed'"
      class="grid gap-4 rounded-2xl border border-danger/30 bg-danger/5 p-5"
      role="alert"
    >
      <div class="flex items-start gap-3">
        <TriangleAlert class="mt-0.5 size-5 shrink-0 text-danger" />
        <div>
          <h2 class="font-semibold">
            We couldn't create this post
          </h2>
          <p class="mt-1 text-sm text-muted-foreground">
            {{ friendlyGenerationError(detail.error) }}
          </p>
        </div>
      </div>
      <p class="line-clamp-2 text-xs text-subtle">
        “{{ detail.prompt }}”
      </p>
      <div>
        <Button
          :disabled="busy"
          @click="again"
        >
          <RefreshCw :class="busy ? 'animate-spin' : ''" />
          {{ busy ? 'Starting…' : 'Retry' }}
        </Button>
      </div>
      <p
        v-if="actionError"
        class="text-sm text-danger"
      >
        {{ actionError }}
      </p>
    </div>

    <!-- Completed -->
    <div
      v-else-if="detail && detail.imageUrl && detail.caption !== null"
      class="grid gap-4"
    >
      <h2 class="text-sm font-medium text-muted-foreground">
        This is what your followers will see
      </h2>

      <InstagramPostMockup
        :brand-name="brand?.name ?? 'Your brand'"
        :handle="brand?.dna?.identity.instagramHandle"
        :logo-url="brand?.logo?.url"
        :image-url="detail.imageUrl"
        :aspect-ratio="detail.aspectRatio"
        :caption="detail.caption"
        :hashtags="detail.hashtags ?? []"
      >
        <template
          v-if="editing"
          #caption
        >
          <div class="grid gap-2">
            <label
              class="sr-only"
              for="edit-caption"
            >Caption</label>
            <Textarea
              id="edit-caption"
              v-model="draft"
              rows="6"
              class="border-white/20 bg-white/5 text-sm text-white"
              :aria-invalid="editProblem !== null"
            />
            <div class="flex items-center justify-between gap-2 text-xs">
              <span :class="draft.length > MAX_CAPTION_LENGTH ? 'text-danger' : 'text-white/50'">
                {{ draft.length }} / {{ MAX_CAPTION_LENGTH }}
              </span>
              <span class="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  :disabled="saving"
                  @click="cancelEdit"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  :disabled="saving"
                  @click="saveEdit"
                >
                  {{ saving ? 'Saving…' : 'Save' }}
                </Button>
              </span>
            </div>
            <p
              v-if="editProblem"
              class="text-xs text-danger"
              role="alert"
            >
              {{ editProblem }}
            </p>
          </div>
        </template>
      </InstagramPostMockup>

      <div class="flex flex-wrap gap-2">
        <Button
          variant="outline"
          :disabled="!canCopy"
          @click="copyCaption"
        >
          <Check v-if="copied" />
          <Copy v-else />
          {{ copied ? 'Copied' : 'Copy caption' }}
        </Button>
        <Button
          variant="outline"
          :disabled="editing"
          @click="startEdit"
        >
          <Pencil /> Edit caption
        </Button>
        <Button
          as="a"
          variant="outline"
          :href="detail.imageUrl"
          :download="downloadName(brand?.name ?? 'post', detail.id, detail.imageUrl)"
        >
          <Download /> Download image
        </Button>
        <Button
          variant="outline"
          :disabled="busy"
          @click="again"
        >
          <RefreshCw :class="busy ? 'animate-spin' : ''" />
          {{ busy ? 'Starting…' : 'Regenerate' }}
        </Button>
      </div>

      <p
        v-if="actionError"
        class="text-sm text-danger"
        role="alert"
      >
        {{ actionError }}
      </p>

      <VideoResult
        :detail="detail"
        @refresh="refreshDetail"
        @updated="detail = $event"
      />
    </div>
  </section>
</template>
