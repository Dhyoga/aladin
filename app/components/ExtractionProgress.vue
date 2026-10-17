<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { LoaderCircle } from '@lucide/vue'
import { errorMessage } from '~/utils/api-error'

const props = defineProps<{
  brandId: string
  /** Status of the brand in the list: `extracting` follows the job, `failed` shows why. */
  status: 'extracting' | 'failed'
}>()

const emit = defineEmits<{ finished: [] }>()

const { getBrand } = useBrands()
const polling = useJobPolling({ intervalMs: 2000 })

const loadError = ref<string | null>(null)
const failedReason = ref<string | null>(null)

const STAGE_LABELS: Record<string, string> = {
  crawling: 'Reading the website',
  reading: 'Reading the PDF',
  structuring: 'Structuring the Brand DNA'
}

const label = computed(() => {
  if (!polling.stage.value) return 'Starting…'
  return STAGE_LABELS[polling.stage.value] ?? `${polling.stage.value.charAt(0).toUpperCase()}${polling.stage.value.slice(1)}…`
})

onMounted(async () => {
  try {
    const detail = await getBrand(props.brandId)

    // The list was stale: the brand is no longer extracting.
    if (props.status === 'extracting' && detail.status !== 'extracting') {
      emit('finished')
      return
    }

    if (!detail.extraction) {
      failedReason.value = props.status === 'failed' ? 'The extraction did not start.' : null
      if (props.status === 'extracting') emit('finished')
      return
    }

    if (props.status === 'failed') {
      failedReason.value = detail.extraction.error ?? 'The extraction failed.'
      return
    }
    polling.start(detail.extraction.jobId)
  } catch (error) {
    loadError.value = errorMessage(error, 'Could not load the extraction status')
  }
})

// A job that reached a final state means the brand changed: let the page refresh the list.
watch(polling.status, (status) => {
  if (props.status === 'extracting' && (status === 'completed' || status === 'failed')) emit('finished')
})
</script>

<template>
  <p
    v-if="loadError"
    class="text-xs text-danger"
    role="alert"
  >
    {{ loadError }}
  </p>

  <p
    v-else-if="status === 'failed'"
    class="text-xs text-danger"
    role="alert"
  >
    {{ failedReason ?? 'Loading…' }}
  </p>

  <p
    v-else
    class="flex items-center gap-2 text-xs text-muted-foreground"
    role="status"
    aria-live="polite"
  >
    <LoaderCircle class="size-3.5 animate-spin text-brand" />
    {{ label }}
  </p>
</template>
