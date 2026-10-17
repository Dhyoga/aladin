<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Plus, Trash2 } from '@lucide/vue'
import type { BrandDetail } from '~~/shared/schemas/brand'
import { dnaToForm, formToDna, type DnaForm, type FeatureTier } from '~/utils/brand-dna-form'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'

const props = defineProps<{ brandId: string | null }>()

const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ saved: [brand: BrandDetail] }>()

const { getBrand, updateBrandDna } = useBrands()

// Always a form (empty until the DNA is loaded) so `v-model` never sees null; `loaded` gates the UI.
const form = ref<DnaForm>(dnaToForm(null))
const loaded = ref(false)
const brandName = ref('')
const loading = ref(false)
const submitting = ref(false)
const loadError = ref<string | null>(null)
const problems = ref<string[]>([])
const submitError = ref<string | null>(null)

// Load the current DNA every time the dialog opens, so a stale list never overwrites newer data.
watch(
  () => [open.value, props.brandId] as const,
  async ([isOpen, brandId]) => {
    if (!isOpen || !brandId) return
    loaded.value = false
    loadError.value = null
    problems.value = []
    submitError.value = null
    loading.value = true
    try {
      const brand = await getBrand(brandId)
      brandName.value = brand.name
      form.value = dnaToForm(brand.dna, brand.name)
      loaded.value = true
    } catch (error) {
      loadError.value = errorMessage(error, 'Could not load the Brand DNA')
    } finally {
      loading.value = false
    }
  },
  { immediate: true }
)

// A validation message describes the form as it was when saved; once it changes, it is stale.
watch(form, () => {
  problems.value = []
}, { deep: true })

const TIERS: { value: FeatureTier, label: string }[] = [
  { value: 'anchor', label: 'Tier 1 · Anchor' },
  { value: 'supporting', label: 'Tier 2 · Supporting' },
  { value: 'variety', label: 'Tier 3 · Variety' }
]

const selectClass = 'h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'

const canSubmit = computed(() => loaded.value && !loading.value && !submitting.value)

function addFeature() {
  form.value.offer.features.push({ name: '', description: '', tier: 'supporting' })
}

function removeFeature(index: number) {
  form.value.offer.features.splice(index, 1)
}

async function submit() {
  if (!props.brandId || !canSubmit.value) return
  submitError.value = null

  const result = formToDna(form.value)
  if (!result.ok) {
    problems.value = result.errors
    return
  }
  problems.value = []

  submitting.value = true
  try {
    const brand = await updateBrandDna(props.brandId, result.dna)
    open.value = false
    emit('saved', brand)
  } catch (error) {
    submitError.value = errorMessage(error, 'Could not save the Brand DNA')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="flex max-h-[90vh] flex-col gap-4 sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>Edit Brand DNA</DialogTitle>
        <DialogDescription>
          {{ brandName || 'Loading…' }}. Everything here is used when posts and videos are generated.
        </DialogDescription>
      </DialogHeader>

      <div
        v-if="loading"
        class="grid gap-3"
      >
        <Skeleton class="h-8" />
        <Skeleton class="h-20" />
        <Skeleton class="h-8" />
      </div>

      <p
        v-else-if="loadError"
        class="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
        role="alert"
      >
        {{ loadError }}
      </p>

      <form
        v-else-if="loaded"
        id="edit-dna-form"
        class="grid min-h-0 gap-6 overflow-y-auto pr-1"
        novalidate
        @submit.prevent="submit"
      >
        <fieldset class="grid gap-3">
          <legend class="mb-1 text-xs uppercase tracking-[0.12em] text-subtle">
            Identity
          </legend>
          <div class="grid gap-2">
            <Label for="dna-name">Brand name</Label>
            <Input
              id="dna-name"
              v-model="form.identity.name"
            />
          </div>
          <div class="grid gap-2 sm:grid-cols-2 sm:gap-3">
            <div class="grid gap-2">
              <Label for="dna-website">Website</Label>
              <Input
                id="dna-website"
                v-model="form.identity.website"
                placeholder="https://example.com"
              />
            </div>
            <div class="grid gap-2">
              <Label for="dna-handle">Instagram handle</Label>
              <Input
                id="dna-handle"
                v-model="form.identity.instagramHandle"
                placeholder="@brand"
              />
            </div>
          </div>
          <div class="grid gap-2 sm:grid-cols-2 sm:gap-3">
            <div class="grid gap-2">
              <Label for="dna-tagline">Tagline</Label>
              <Input
                id="dna-tagline"
                v-model="form.identity.tagline"
              />
            </div>
            <div class="grid gap-2">
              <Label for="dna-category">Category</Label>
              <Input
                id="dna-category"
                v-model="form.identity.category"
                placeholder="coffee shop, browser extension…"
              />
            </div>
          </div>
          <div class="grid gap-2">
            <Label for="dna-summary">Summary</Label>
            <Textarea
              id="dna-summary"
              v-model="form.identity.summary"
              rows="3"
            />
          </div>
        </fieldset>

        <fieldset class="grid gap-3">
          <legend class="mb-1 text-xs uppercase tracking-[0.12em] text-subtle">
            Audience
          </legend>
          <div class="grid gap-2">
            <Label for="dna-audience">Target audience</Label>
            <Textarea
              id="dna-audience"
              v-model="form.audience.targetAudience"
              rows="2"
            />
          </div>
          <div class="grid gap-2">
            <Label for="dna-region">Region</Label>
            <Input
              id="dna-region"
              v-model="form.audience.region"
              placeholder="Indonesia"
            />
          </div>
          <div class="grid gap-2">
            <Label for="dna-pain">Pain points <span class="text-subtle">(one per line)</span></Label>
            <Textarea
              id="dna-pain"
              v-model="form.audience.painPoints"
              rows="3"
            />
          </div>
        </fieldset>

        <fieldset class="grid gap-3">
          <legend class="mb-1 text-xs uppercase tracking-[0.12em] text-subtle">
            Voice
          </legend>
          <div class="grid gap-2">
            <Label for="dna-tone">Tone of voice</Label>
            <Textarea
              id="dna-tone"
              v-model="form.voice.toneOfVoice"
              rows="2"
            />
          </div>
          <div class="grid gap-3 sm:grid-cols-3">
            <div class="grid gap-2">
              <Label for="dna-addressing">Addressing</Label>
              <select
                id="dna-addressing"
                v-model="form.voice.addressing"
                :class="selectClass"
              >
                <option value="kamu">
                  kamu
                </option>
                <option value="Anda">
                  Anda
                </option>
                <option value="kalian">
                  kalian
                </option>
                <option value="lo">
                  lo
                </option>
              </select>
            </div>
            <div class="grid gap-2">
              <Label for="dna-language">Content language</Label>
              <select
                id="dna-language"
                v-model="form.voice.contentLanguage"
                :class="selectClass"
              >
                <option value="id">
                  Indonesian
                </option>
                <option value="en">
                  English
                </option>
              </select>
            </div>
            <div class="grid gap-2">
              <Label for="dna-emoji">Emoji</Label>
              <select
                id="dna-emoji"
                v-model="form.voice.emojiLevel"
                :class="selectClass"
              >
                <option value="none">
                  None
                </option>
                <option value="light">
                  Light
                </option>
                <option value="heavy">
                  Heavy
                </option>
              </select>
            </div>
          </div>
          <div class="grid gap-3 sm:grid-cols-2">
            <div class="grid gap-2">
              <Label for="dna-use">Words to use <span class="text-subtle">(comma separated)</span></Label>
              <Input
                id="dna-use"
                v-model="form.voice.wordsToUse"
              />
            </div>
            <div class="grid gap-2">
              <Label for="dna-avoid">Words to avoid <span class="text-subtle">(comma separated)</span></Label>
              <Input
                id="dna-avoid"
                v-model="form.voice.wordsToAvoid"
              />
            </div>
          </div>
        </fieldset>

        <fieldset class="grid gap-3">
          <legend class="mb-1 text-xs uppercase tracking-[0.12em] text-subtle">
            Offer
          </legend>
          <div class="grid gap-2">
            <Label for="dna-benefits">Key benefits <span class="text-subtle">(one per line)</span></Label>
            <Textarea
              id="dna-benefits"
              v-model="form.offer.keyBenefits"
              rows="3"
            />
          </div>

          <div class="grid gap-2">
            <div class="flex items-center justify-between">
              <Label>Features</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                @click="addFeature"
              >
                <Plus /> Add feature
              </Button>
            </div>
            <p
              v-if="form.offer.features.length === 0"
              class="text-xs text-subtle"
            >
              Tier 1 features are used most often; tier 2 and 3 are mixed in so content stays varied.
            </p>
            <div
              v-for="(feature, index) in form.offer.features"
              :key="index"
              class="grid gap-2 rounded-lg border border-border bg-surface-2 p-3"
            >
              <div class="grid gap-2 sm:grid-cols-[1fr_11rem] sm:gap-3">
                <Input
                  v-model="feature.name"
                  placeholder="Feature name"
                  :aria-label="`Feature ${index + 1} name`"
                />
                <select
                  v-model="feature.tier"
                  :class="selectClass"
                  :aria-label="`Feature ${index + 1} tier`"
                >
                  <option
                    v-for="tier in TIERS"
                    :key="tier.value"
                    :value="tier.value"
                  >
                    {{ tier.label }}
                  </option>
                </select>
              </div>
              <div class="flex items-start gap-2">
                <Textarea
                  v-model="feature.description"
                  rows="2"
                  placeholder="What it does"
                  :aria-label="`Feature ${index + 1} description`"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  :aria-label="`Remove feature ${index + 1}`"
                  @click="removeFeature(index)"
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
          </div>

          <div class="grid gap-3 sm:grid-cols-2">
            <div class="grid gap-2">
              <Label for="dna-cta">Default call to action</Label>
              <Input
                id="dna-cta"
                v-model="form.offer.defaultCta"
              />
            </div>
            <div class="grid gap-2">
              <Label for="dna-price">Price or promo</Label>
              <Input
                id="dna-price"
                v-model="form.offer.priceOrPromo"
              />
            </div>
          </div>
          <div class="grid gap-2">
            <Label for="dna-sampling">Feature guidance</Label>
            <Input
              id="dna-sampling"
              v-model="form.offer.featureSamplingGuidance"
              placeholder="How features should be picked for content"
            />
          </div>
        </fieldset>

        <fieldset class="grid gap-3">
          <legend class="mb-1 text-xs uppercase tracking-[0.12em] text-subtle">
            Visual
          </legend>
          <div class="grid gap-3 sm:grid-cols-2">
            <div class="grid gap-2">
              <Label for="dna-colors">Colors <span class="text-subtle">(hex, comma separated)</span></Label>
              <Input
                id="dna-colors"
                v-model="form.visual.colors"
                placeholder="#3B2314, #F4A261"
              />
            </div>
            <div class="grid gap-2">
              <Label for="dna-fonts">Fonts</Label>
              <Input
                id="dna-fonts"
                v-model="form.visual.fonts"
              />
            </div>
            <div class="grid gap-2">
              <Label for="dna-style">Style keywords</Label>
              <Input
                id="dna-style"
                v-model="form.visual.styleKeywords"
                placeholder="natural light, minimal"
              />
            </div>
            <div class="grid gap-2">
              <Label for="dna-visual-avoid">Visuals to avoid</Label>
              <Input
                id="dna-visual-avoid"
                v-model="form.visual.avoid"
                placeholder="neon, crowded layouts"
              />
            </div>
          </div>
        </fieldset>

        <fieldset class="grid gap-3">
          <legend class="mb-1 text-xs uppercase tracking-[0.12em] text-subtle">
            Social
          </legend>
          <div class="grid gap-2">
            <Label for="dna-hashtags">Default hashtags <span class="text-subtle">(comma separated)</span></Label>
            <Input
              id="dna-hashtags"
              v-model="form.social.defaultHashtags"
              placeholder="#brand, #product"
            />
          </div>
          <div class="grid gap-2">
            <Label for="dna-notes">Notes</Label>
            <Textarea
              id="dna-notes"
              v-model="form.notes"
              rows="3"
            />
          </div>
        </fieldset>
      </form>

      <div
        v-if="problems.length > 0 || submitError"
        class="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
        role="alert"
      >
        <p v-if="submitError">
          {{ submitError }}
        </p>
        <ul
          v-if="problems.length > 0"
          class="list-inside list-disc"
        >
          <li
            v-for="problem in problems"
            :key="problem"
          >
            {{ problem }}
          </li>
        </ul>
      </div>

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
          form="edit-dna-form"
          :disabled="!canSubmit"
        >
          {{ submitting ? 'Saving…' : 'Save changes' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
