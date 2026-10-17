<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  videoUrl: string
  brandName: string
  /** Shown over the video; the brand name is used when the brand has no Instagram handle. */
  handle?: string | null
  logoUrl?: string | null
  caption: string
}>()

const displayHandle = computed(() => props.handle?.trim().replace(/^@/, '') || props.brandName)
// Just the beginning of the caption, like the collapsed caption of a Reel.
const snippet = computed(() => {
  const line = props.caption.split('\n')[0]?.trim() ?? ''
  return line.length > 90 ? `${line.slice(0, 87)}…` : line
})
</script>

<template>
  <figure
    class="relative mx-auto w-full max-w-[320px] overflow-hidden rounded-[28px] border border-border bg-black"
    style="aspect-ratio: 9 / 16"
    aria-label="Reel preview"
  >
    <video
      :src="videoUrl"
      class="absolute inset-0 size-full object-cover"
      controls
      playsinline
      preload="metadata"
      aria-label="The generated video"
    />

    <!-- Above the native control bar (about 48px), so the controls stay usable. The overlay itself never takes clicks. -->
    <figcaption class="pointer-events-none absolute inset-x-0 bottom-12 flex items-end gap-3 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-4 pt-16 pb-3 text-white">
      <span class="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/15 text-xs font-semibold">
        <img
          v-if="logoUrl"
          :src="logoUrl"
          :alt="`${brandName} logo`"
          class="size-full object-cover"
        >
        <template v-else>{{ brandName.charAt(0).toUpperCase() }}</template>
      </span>
      <span class="min-w-0 text-sm leading-snug">
        <span class="block truncate font-semibold">{{ displayHandle }}</span>
        <span
          v-if="snippet"
          class="line-clamp-2 text-white/85"
        >{{ snippet }}</span>
      </span>
    </figcaption>
  </figure>
</template>
