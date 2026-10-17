<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { BrandDetail } from '~~/shared/schemas/brand'
import { MAX_BRAND_NAME_LENGTH, MAX_PDF_BYTES } from '~~/shared/schemas/brand'
import { sniffFileType } from '~~/shared/utils/file-type'
import { errorMessage } from '~/utils/api-error'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Mode = 'url' | 'pdf' | 'manual'

const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ created: [brand: BrandDetail] }>()

const { createBrand } = useBrands()

const MODES: { value: Mode, label: string }[] = [
  { value: 'url', label: 'Website' },
  { value: 'pdf', label: 'PDF' },
  { value: 'manual', label: 'Manual' }
]

const mode = ref<Mode>('url')
const url = ref('')
const name = ref('')
const file = ref<File | null>(null)
const fileProblem = ref<string | null>(null)
const submitting = ref(false)
const error = ref<string | null>(null)

function reset() {
  mode.value = 'url'
  url.value = ''
  name.value = ''
  file.value = null
  fileProblem.value = null
  error.value = null
  submitting.value = false
}

// Start clean every time the dialog opens.
watch(open, (isOpen) => {
  if (isOpen) reset()
})

const urlProblem = computed(() => {
  if (url.value.trim() === '') return null
  try {
    const { protocol } = new URL(url.value.trim())
    return protocol === 'http:' || protocol === 'https:' ? null : 'The address must start with http:// or https://'
  } catch {
    return 'Enter a full address, for example https://example.com'
  }
})

const nameProblem = computed(() =>
  name.value.trim().length > MAX_BRAND_NAME_LENGTH ? `Use at most ${MAX_BRAND_NAME_LENGTH} characters` : null
)

const canSubmit = computed(() => {
  if (submitting.value) return false
  if (mode.value === 'url') return url.value.trim() !== '' && urlProblem.value === null
  if (mode.value === 'manual') return name.value.trim() !== '' && nameProblem.value === null
  return file.value !== null && fileProblem.value === null
})

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const chosen = input.files?.[0] ?? null
  file.value = chosen
  fileProblem.value = null
  if (!chosen) return

  // The server decides from the content too; checking here saves an upload.
  if (chosen.size > MAX_PDF_BYTES) {
    fileProblem.value = 'The PDF is larger than 20 MB'
  } else if (sniffFileType(new Uint8Array(await chosen.slice(0, 16).arrayBuffer())) !== 'pdf') {
    fileProblem.value = 'This file is not a PDF'
  }
}

async function submit() {
  if (!canSubmit.value) return
  submitting.value = true
  error.value = null
  try {
    const brand = mode.value === 'url'
      ? await createBrand({ source_type: 'url', url: url.value.trim() })
      : mode.value === 'pdf'
        ? await createBrand({ source_type: 'pdf', file: file.value! })
        : await createBrand({ source_type: 'manual', name: name.value.trim() })
    open.value = false
    emit('created', brand)
  } catch (err) {
    error.value = errorMessage(err, 'Could not create the brand')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>New brand</DialogTitle>
        <DialogDescription>
          Build a Brand DNA from a website or a PDF, or start from a name and fill it in yourself.
        </DialogDescription>
      </DialogHeader>

      <div
        class="grid grid-cols-3 gap-1 rounded-full bg-surface-2 p-1"
        role="tablist"
        aria-label="Source"
      >
        <button
          v-for="option in MODES"
          :key="option.value"
          type="button"
          role="tab"
          :aria-selected="mode === option.value"
          class="h-8 rounded-full text-sm transition-colors"
          :class="mode === option.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'"
          @click="mode = option.value; error = null"
        >
          {{ option.label }}
        </button>
      </div>

      <form
        class="grid gap-4"
        novalidate
        @submit.prevent="submit"
      >
        <div
          v-if="mode === 'url'"
          class="grid gap-2"
        >
          <Label for="new-brand-url">Website address</Label>
          <Input
            id="new-brand-url"
            v-model="url"
            type="url"
            inputmode="url"
            placeholder="https://example.com"
            autocomplete="off"
            :aria-invalid="urlProblem !== null"
          />
          <p
            v-if="urlProblem"
            class="text-xs text-danger"
          >
            {{ urlProblem }}
          </p>
          <p
            v-else
            class="text-xs text-subtle"
          >
            We read the page and a few related ones. Pages that need JavaScript to show content may give thin results.
          </p>
        </div>

        <div
          v-else-if="mode === 'pdf'"
          class="grid gap-2"
        >
          <Label for="new-brand-pdf">PDF file</Label>
          <Input
            id="new-brand-pdf"
            type="file"
            accept="application/pdf"
            :aria-invalid="fileProblem !== null"
            @change="onFileChange"
          />
          <p
            v-if="fileProblem"
            class="text-xs text-danger"
          >
            {{ fileProblem }}
          </p>
          <p
            v-else
            class="text-xs text-subtle"
          >
            A company profile, deck or brand book. Up to 20 MB.
          </p>
        </div>

        <div
          v-else
          class="grid gap-2"
        >
          <Label for="new-brand-name">Brand name</Label>
          <Input
            id="new-brand-name"
            v-model="name"
            placeholder="Warung Kopi Senja"
            autocomplete="off"
            :aria-invalid="nameProblem !== null"
          />
          <p
            v-if="nameProblem"
            class="text-xs text-danger"
          >
            {{ nameProblem }}
          </p>
          <p
            v-else
            class="text-xs text-subtle"
          >
            You fill in the rest of the Brand DNA yourself.
          </p>
        </div>

        <p
          v-if="error"
          class="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
          role="alert"
        >
          {{ error }}
        </p>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            :disabled="submitting"
            @click="open = false"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            :disabled="!canSubmit"
          >
            {{ submitting ? 'Creating…' : 'Create brand' }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
