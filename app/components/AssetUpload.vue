<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { X } from '@lucide/vue'
import type { AssetDto } from '~~/shared/schemas/brand'
import { MAX_IMAGE_BYTES, MAX_PRODUCT_PHOTOS } from '~~/shared/schemas/brand'
import { isImageType, sniffFileType } from '~~/shared/utils/file-type'
import { errorMessage } from '~/utils/api-error'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'

type Kind = 'logo' | 'product_photo'

interface Picked {
  file: File
  preview: string
  problem: string | null
}

const props = defineProps<{
  brandId: string
  brandName: string
}>()

const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ uploaded: [assets: AssetDto[]] }>()

const { uploadAssets } = useBrands()

const KINDS: { value: Kind, label: string }[] = [
  { value: 'logo', label: 'Logo' },
  { value: 'product_photo', label: 'Product photos' }
]

const kind = ref<Kind>('logo')
const picked = ref<Picked[]>([])
const submitting = ref(false)
const error = ref<string | null>(null)
const inputKey = ref(0)

function release(items: Picked[]) {
  for (const item of items) URL.revokeObjectURL(item.preview)
}

function reset() {
  release(picked.value)
  picked.value = []
  kind.value = 'logo'
  error.value = null
  submitting.value = false
  inputKey.value++
}

watch(open, (isOpen) => {
  if (isOpen) reset()
})
watch(kind, () => {
  release(picked.value)
  picked.value = []
  error.value = null
  inputKey.value++
})
watch(() => props.brandId, reset)
onBeforeUnmount(() => release(picked.value))

async function inspect(file: File): Promise<string | null> {
  if (file.size > MAX_IMAGE_BYTES) return 'Larger than 10 MB'
  // By content, not by the name or type the browser reports (the server does the same).
  const type = sniffFileType(new Uint8Array(await file.slice(0, 16).arrayBuffer()))
  return isImageType(type) ? null : 'Not a PNG, JPEG or WebP image'
}

async function onFilesChange(event: Event) {
  const input = event.target as HTMLInputElement
  const chosen = Array.from(input.files ?? [])
  if (chosen.length === 0) return

  const next = kind.value === 'logo' ? chosen.slice(0, 1) : [...picked.value.map(item => item.file), ...chosen]
  release(picked.value)
  picked.value = await Promise.all(next.map(async file => ({
    file,
    preview: URL.createObjectURL(file),
    problem: await inspect(file)
  })))
  error.value = null
  inputKey.value++ // lets the same file be chosen again after removing it
}

function remove(index: number) {
  const [removed] = picked.value.splice(index, 1)
  if (removed) URL.revokeObjectURL(removed.preview)
  error.value = null
}

const tooMany = computed(() => kind.value === 'product_photo' && picked.value.length > MAX_PRODUCT_PHOTOS)
const hasProblem = computed(() => picked.value.some(item => item.problem !== null))
// The server accepts all files or none, so one bad file blocks the whole upload.
const canSubmit = computed(() =>
  !submitting.value && picked.value.length > 0 && !hasProblem.value && !tooMany.value
)

async function submit() {
  if (!canSubmit.value) return
  submitting.value = true
  error.value = null
  try {
    const assets = await uploadAssets(props.brandId, kind.value, picked.value.map(item => item.file))
    open.value = false
    emit('uploaded', assets)
  } catch (err) {
    error.value = errorMessage(err, 'Could not upload the files')
  } finally {
    submitting.value = false
  }
}

const sizeLabel = (bytes: number) => bytes >= 1024 * 1024
  ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
  : `${Math.max(1, Math.round(bytes / 1024))} KB`
</script>

<template>
  <Sheet v-model:open="open">
    <SheetContent
      side="right"
      class="w-full gap-4 sm:max-w-md"
    >
      <SheetHeader>
        <SheetTitle>Upload images</SheetTitle>
        <SheetDescription>
          For {{ brandName }}. PNG, JPEG or WebP, up to 10 MB each.
        </SheetDescription>
      </SheetHeader>

      <div class="grid gap-4 overflow-y-auto px-4">
        <div
          class="grid grid-cols-2 gap-1 rounded-full bg-surface-2 p-1"
          role="tablist"
          aria-label="Kind of image"
        >
          <button
            v-for="option in KINDS"
            :key="option.value"
            type="button"
            role="tab"
            :aria-selected="kind === option.value"
            class="h-8 rounded-full text-sm transition-colors"
            :class="kind === option.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'"
            @click="kind = option.value"
          >
            {{ option.label }}
          </button>
        </div>

        <div class="grid gap-2">
          <Label for="asset-files">
            {{ kind === 'logo' ? 'Logo file' : `Photos (up to ${MAX_PRODUCT_PHOTOS} per brand)` }}
          </Label>
          <Input
            id="asset-files"
            :key="inputKey"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            :multiple="kind === 'product_photo'"
            @change="onFilesChange"
          />
          <p class="text-xs text-subtle">
            {{ kind === 'logo' ? 'A new logo replaces the current one.' : 'Photos are added to the ones the brand already has.' }}
          </p>
        </div>

        <ul
          v-if="picked.length > 0"
          class="grid gap-2"
        >
          <li
            v-for="(item, index) in picked"
            :key="`${item.file.name}-${index}`"
            class="flex items-center gap-3 rounded-lg border bg-surface-2 p-2"
            :class="item.problem ? 'border-danger/40' : 'border-border'"
          >
            <img
              :src="item.preview"
              alt=""
              class="size-12 shrink-0 rounded-md bg-surface object-cover"
            >
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm">
                {{ item.file.name }}
              </p>
              <p
                class="text-xs"
                :class="item.problem ? 'text-danger' : 'text-subtle'"
              >
                {{ item.problem ?? sizeLabel(item.file.size) }}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              :aria-label="`Remove ${item.file.name}`"
              @click="remove(index)"
            >
              <X />
            </Button>
          </li>
        </ul>

        <p
          v-if="tooMany"
          class="text-xs text-danger"
        >
          Choose at most {{ MAX_PRODUCT_PHOTOS }} photos at a time.
        </p>
        <p
          v-if="hasProblem"
          class="text-xs text-danger"
        >
          Remove the files marked in red. Files are uploaded together or not at all.
        </p>
        <p
          v-if="error"
          class="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
          role="alert"
        >
          {{ error }}
        </p>
      </div>

      <SheetFooter class="flex-row justify-end">
        <Button
          variant="outline"
          :disabled="submitting"
          @click="open = false"
        >
          Cancel
        </Button>
        <Button
          :disabled="!canSubmit"
          @click="submit"
        >
          {{ submitting ? 'Uploading…' : picked.length > 1 ? `Upload ${picked.length} files` : 'Upload' }}
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
