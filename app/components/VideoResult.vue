<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Check, Clapperboard, Download, LoaderCircle, RefreshCw, TriangleAlert } from '@lucide/vue'
import { VIDEO_COST_LABEL, type GenerationDetail } from '~~/shared/schemas/generation'
import { errorMessage } from '~/utils/api-error'
import { downloadName, friendlyVideoError, sceneRange } from '~/utils/studio'
import { Button } from '@/components/ui/button'

const props = defineProps<{
  /** A finished post. The video section is only shown for those. */
  detail: GenerationDetail
}>()

const emit = defineEmits<{
  /** Something new arrived (a stage, the storyboard, the end): the parent should reload the detail. */
  refresh: []
  /** A video was started: this is the new detail. */
  updated: [detail: GenerationDetail]
}>()

const { createVideo } = useGenerations()
const { activeBrand } = useActiveBrand()
// 4 seconds for a video, 2 for a post (design.md section 2): a video takes minutes.
const polling = useJobPolling({ intervalMs: 4000 })

const video = computed(() => props.detail.video)
const brand = computed(() => activeBrand.value)

const confirmOpen = ref(false)
const isRetry = ref(false)
const busy = ref(false)
const actionError = ref<string | null>(null)

const STEPS = [
  { key: 'script', label: 'Script' },
  { key: 'storyboard', label: 'Storyboard' },
  { key: 'video', label: 'Video' }
] as const

const currentStage = computed(() => polling.stage.value ?? video.value?.stage ?? null)
const currentStep = computed(() => STEPS.findIndex(step => step.key === currentStage.value))

// Follow the job while the video runs. Two separate sources: a refreshed detail with the same
// job must not restart the polling.
watch(
  [() => video.value?.status, () => video.value?.jobId],
  ([status, jobId]) => {
    if (status === 'running' && jobId) polling.start(jobId)
    else polling.stop()
  },
  { immediate: true }
)

// A new stage means a new result (the script, then the storyboard): show it without waiting for the end.
watch(polling.stage, (stage) => {
  if (stage) emit('refresh')
})
watch(polling.status, (status) => {
  if (status === 'completed' || status === 'failed') emit('refresh')
})

function ask(retry: boolean) {
  isRetry.value = retry
  actionError.value = null
  confirmOpen.value = true
}

async function start() {
  busy.value = true
  actionError.value = null
  try {
    emit('updated', await createVideo(props.detail.id))
    confirmOpen.value = false
  } catch (error) {
    confirmOpen.value = false
    actionError.value = errorMessage(error, 'Could not start the video')
    emit('refresh') // the state may have changed under us (a video is already running, for instance)
  } finally {
    busy.value = false
  }
}

const videoName = computed(() =>
  video.value?.videoUrl ? downloadName(brand.value?.name ?? 'post', props.detail.id, video.value.videoUrl) : ''
)
const storyboardName = computed(() =>
  video.value?.storyboardUrl ? downloadName(brand.value?.name ?? 'post', props.detail.id, video.value.storyboardUrl, '-storyboard') : ''
)
</script>

<template>
  <section
    class="grid gap-4 rounded-2xl border border-border bg-surface p-5"
    aria-labelledby="video-title"
  >
    <!-- No video yet -->
    <template v-if="!video">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div class="min-w-0">
          <h2
            id="video-title"
            class="flex items-center gap-2 font-semibold"
          >
            <Clapperboard class="size-4 text-brand" />
            Turn this post into a 10-second Reel
          </h2>
          <p class="mt-1 text-sm text-muted-foreground">
            A vertical video ad with a voice over, made from this post and its photos.
          </p>
        </div>
        <Button
          size="lg"
          @click="ask(false)"
        >
          Generate Video
          <span
            class="ml-1 rounded-full bg-black/10 px-2 py-0.5 text-xs font-medium"
            aria-label="Estimated cost"
          >{{ VIDEO_COST_LABEL }}</span>
        </Button>
      </div>
    </template>

    <!-- Running -->
    <template v-else-if="video.status === 'running'">
      <h2
        id="video-title"
        class="font-semibold"
      >
        Creating your video…
      </h2>

      <ol
        class="flex items-center"
        aria-label="Progress"
      >
        <li
          v-for="(step, index) in STEPS"
          :key="step.key"
          class="flex items-center"
          :class="index < STEPS.length - 1 ? 'flex-1' : ''"
        >
          <span
            class="flex items-center gap-2 text-sm"
            :class="index > currentStep ? 'text-subtle' : 'text-foreground'"
          >
            <span
              class="flex size-6 shrink-0 items-center justify-center rounded-full border"
              :class="index < currentStep
                ? 'border-success bg-success/15 text-success'
                : index === currentStep
                  ? 'animate-pulse border-brand bg-brand/20 text-brand'
                  : 'border-border-strong'"
            >
              <Check
                v-if="index < currentStep"
                class="size-3.5"
              />
              <LoaderCircle
                v-else-if="index === currentStep"
                class="size-3.5 animate-spin"
              />
            </span>
            <span :aria-current="index === currentStep ? 'step' : undefined">{{ step.label }}</span>
          </span>
          <span
            v-if="index < STEPS.length - 1"
            class="mx-3 h-px flex-1"
            :class="index < currentStep ? 'bg-success/50' : 'bg-border-strong'"
            aria-hidden="true"
          />
        </li>
      </ol>

      <p
        v-if="currentStep === -1"
        class="text-xs text-subtle"
      >
        Starting…
      </p>
      <p class="text-xs text-subtle">
        This takes a few minutes. You can leave this page; the video keeps going.
      </p>

      <figure
        v-if="video.storyboardUrl"
        class="grid gap-2"
      >
        <img
          :src="video.storyboardUrl"
          alt="The storyboard of the video"
          class="max-h-72 w-auto max-w-full justify-self-start rounded-lg border border-border"
        >
        <figcaption class="text-xs text-subtle">
          Storyboard. The video is being made from it.
        </figcaption>
      </figure>
    </template>

    <!-- Completed -->
    <template v-else-if="video.status === 'completed' && video.videoUrl">
      <h2
        id="video-title"
        class="font-semibold"
      >
        Your Reel
      </h2>

      <ReelsMockup
        :video-url="video.videoUrl"
        :brand-name="brand?.name ?? 'Your brand'"
        :handle="brand?.dna?.identity.instagramHandle"
        :logo-url="brand?.logo?.url"
        :caption="detail.caption ?? ''"
      />

      <div class="flex flex-wrap justify-center gap-2">
        <Button
          as="a"
          variant="outline"
          :href="video.videoUrl"
          :download="videoName"
        >
          <Download /> Download video
        </Button>
        <Button
          v-if="video.storyboardUrl"
          as="a"
          variant="outline"
          :href="video.storyboardUrl"
          :download="storyboardName"
        >
          <Download /> Download storyboard
        </Button>
      </div>

      <figure
        v-if="video.storyboardUrl"
        class="grid gap-2"
      >
        <img
          :src="video.storyboardUrl"
          alt="The storyboard of the video"
          class="max-h-72 w-auto max-w-full justify-self-center rounded-lg border border-border"
        >
        <figcaption class="text-center text-xs text-subtle">
          Storyboard
        </figcaption>
      </figure>

      <details
        v-if="video.script"
        class="rounded-xl border border-border bg-surface-2 px-4 py-3"
      >
        <summary class="cursor-pointer text-sm font-medium">
          Script · {{ video.script.scenes.length }} scenes
        </summary>
        <ol class="mt-3 grid gap-3">
          <li
            v-for="(scene, index) in video.script.scenes"
            :key="index"
            class="grid gap-1 border-t border-border pt-3 text-sm first:border-t-0 first:pt-0"
          >
            <span class="text-xs uppercase tracking-[0.12em] text-subtle">
              Scene {{ index + 1 }} · {{ sceneRange(scene.start, scene.end) }}
            </span>
            <span><span class="text-muted-foreground">Visual:</span> {{ scene.visual }}</span>
            <span v-if="scene.on_screen_text"><span class="text-muted-foreground">On screen:</span> {{ scene.on_screen_text }}</span>
            <span><span class="text-muted-foreground">Voice over:</span> {{ scene.voice_over }}</span>
          </li>
        </ol>
      </details>
    </template>

    <!-- Failed (or completed without a file, which only a broken store can produce) -->
    <template v-else>
      <div
        class="grid gap-4"
        role="alert"
      >
        <div class="flex items-start gap-3">
          <TriangleAlert class="mt-0.5 size-5 shrink-0 text-danger" />
          <div>
            <h2
              id="video-title"
              class="font-semibold"
            >
              We couldn't create this video
            </h2>
            <p class="mt-1 text-sm text-muted-foreground">
              {{ friendlyVideoError(video.status === 'failed' ? video.error : null) }}
            </p>
          </div>
        </div>
        <div>
          <Button
            :disabled="busy"
            @click="ask(true)"
          >
            <RefreshCw /> Retry
            <span class="ml-1 rounded-full bg-black/10 px-2 py-0.5 text-xs font-medium">{{ VIDEO_COST_LABEL }}</span>
          </Button>
        </div>
      </div>
    </template>

    <p
      v-if="actionError"
      class="text-sm text-danger"
      role="alert"
    >
      {{ actionError }}
    </p>

    <ConfirmDialog
      v-model:open="confirmOpen"
      :title="isRetry ? 'Try the video again?' : 'Create the video?'"
      :description="isRetry
        ? `A new attempt costs about $1 again and takes a few minutes. It is made from this post and its photos.`
        : `Creating a video costs about $1 and takes a few minutes. It is made from this post and its photos.`"
      confirm-label="Generate video"
      :busy="busy"
      @confirm="start"
    />
  </section>
</template>
