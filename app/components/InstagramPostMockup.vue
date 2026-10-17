<script setup lang="ts">
import { computed } from 'vue'
import { Bookmark, Ellipsis, Heart, MessageCircle, Send } from '@lucide/vue'
import type { AspectRatio } from '~~/shared/schemas/generation'

const props = defineProps<{
  brandName: string
  /** Shown in the header; the brand name is used when the brand has no Instagram handle. */
  handle?: string | null
  logoUrl?: string | null
  imageUrl: string
  aspectRatio: AspectRatio
  caption: string
  hashtags: readonly string[]
}>()

const displayHandle = computed(() => props.handle?.trim().replace(/^@/, '') || props.brandName)
const ratio = computed(() => (props.aspectRatio === '1:1' ? '1 / 1' : '4 / 5'))
</script>

<template>
  <article
    class="overflow-hidden rounded-xl border border-border bg-black text-white"
    aria-label="Instagram post preview"
  >
    <header class="flex items-center gap-3 px-3 py-2.5">
      <div class="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-2 text-xs font-semibold">
        <img
          v-if="logoUrl"
          :src="logoUrl"
          :alt="`${brandName} logo`"
          class="size-full object-cover"
        >
        <span v-else>{{ brandName.charAt(0).toUpperCase() }}</span>
      </div>
      <span class="min-w-0 flex-1 truncate text-sm font-semibold">{{ displayHandle }}</span>
      <Ellipsis
        class="size-5 text-white/70"
        aria-hidden="true"
      />
    </header>

    <img
      :src="imageUrl"
      alt="The generated post"
      class="block w-full bg-surface object-cover"
      :style="{ aspectRatio: ratio }"
    >

    <div class="flex items-center gap-4 px-3 pt-3">
      <Heart
        class="size-6"
        aria-hidden="true"
      />
      <MessageCircle
        class="size-6"
        aria-hidden="true"
      />
      <Send
        class="size-6"
        aria-hidden="true"
      />
      <Bookmark
        class="ml-auto size-6"
        aria-hidden="true"
      />
    </div>

    <div class="px-3 pt-2 pb-4 text-sm leading-relaxed">
      <slot name="caption">
        <p class="break-words whitespace-pre-wrap">
          <span class="font-semibold">{{ displayHandle }}</span>
          {{ ' ' }}{{ caption }}
        </p>
      </slot>
      <p
        v-if="hashtags.length > 0"
        class="mt-2 break-words text-info"
      >
        {{ hashtags.join(' ') }}
      </p>
    </div>
  </article>
</template>
