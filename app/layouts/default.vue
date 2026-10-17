<script setup lang="ts">
import { Menu } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'

const drawerOpen = ref(false)
</script>

<template>
  <div class="min-h-screen">
    <!-- Desktop (>= 1024px): permanent sidebar -->
    <aside class="fixed inset-y-0 left-0 z-20 hidden w-[260px] border-r border-sidebar-border bg-sidebar lg:block">
      <AppSidebar>
        <slot name="sidebar" />
      </AppSidebar>
    </aside>

    <!-- Mobile (< 1024px): header with a menu button that opens the drawer -->
    <header class="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-sidebar-border bg-sidebar/80 px-4 backdrop-blur lg:hidden">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Open menu"
        @click="drawerOpen = true"
      >
        <Menu />
      </Button>
      <span class="text-base font-semibold tracking-tight">Aladin</span>
    </header>

    <Sheet v-model:open="drawerOpen">
      <SheetContent
        side="left"
        class="w-[260px] border-sidebar-border bg-sidebar p-0 sm:max-w-[260px]"
        :show-close-button="false"
      >
        <SheetTitle class="sr-only">
          Navigation
        </SheetTitle>
        <SheetDescription class="sr-only">
          Main navigation
        </SheetDescription>
        <AppSidebar @navigate="drawerOpen = false">
          <slot name="sidebar" />
        </AppSidebar>
      </SheetContent>
    </Sheet>

    <main class="lg:pl-[260px]">
      <slot />
    </main>
  </div>
</template>
