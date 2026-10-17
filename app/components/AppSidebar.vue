<script setup lang="ts">
import { onMounted } from 'vue'
import { Dna, Sparkles } from '@lucide/vue'

const emit = defineEmits<{ navigate: [] }>()

const route = useRoute()

const items = [
  { label: 'Studio', to: '/studio', icon: Sparkles },
  { label: 'Brand DNA', to: '/brand-dna', icon: Dna }
] as const

const { brands, listBrands } = useBrands()
const { syncActiveBrand } = useActiveBrand()

function isActive(to: string) {
  return route.path === to || route.path.startsWith(`${to}/`)
}

// Brands are shared state: the Brand DNA page refreshes them, this list follows.
onMounted(async () => {
  try {
    await syncActiveBrand(await listBrands())
  } catch {
    // The page that needs the list shows its own error; the sidebar just stays without brands.
  }
})
</script>

<template>
  <div class="flex h-full flex-col gap-6 p-4">
    <div class="px-2 pt-2 text-lg font-semibold tracking-tight">
      Aladin
    </div>

    <nav
      class="flex flex-col gap-1"
      aria-label="Main"
    >
      <NuxtLink
        v-for="item in items"
        :key="item.to"
        :to="item.to"
        :aria-current="isActive(item.to) ? 'page' : undefined"
        class="flex h-10 items-center gap-3 rounded-[10px] border px-3 text-sm transition-colors"
        :class="isActive(item.to)
          ? 'border-brand/40 bg-surface-2 text-foreground shadow-[0_0_24px_-8px_rgba(249,115,22,0.45)]'
          : 'border-transparent text-muted-foreground hover:bg-surface-2 hover:text-foreground'"
        @click="emit('navigate')"
      >
        <component
          :is="item.icon"
          class="size-4"
          :class="isActive(item.to) ? 'text-brand' : ''"
        />
        {{ item.label }}
      </NuxtLink>
    </nav>

    <div class="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto">
      <BrandSwitcher
        v-if="brands.length > 0"
        :brands="brands"
        @selected="emit('navigate')"
      />

      <!-- The history is the Studio's own; the page keeps it loaded and up to date. -->
      <StudioHistory
        v-if="route.path === '/studio'"
        @select="emit('navigate')"
      />

      <slot />
    </div>
  </div>
</template>
