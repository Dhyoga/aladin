import tailwindcss from '@tailwindcss/vite'
import { DEFAULT_SHARED_SECRET } from './shared/schemas/runtime-config'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ['@nuxt/eslint', '@nuxt/fonts', '@vueuse/nuxt', 'shadcn-nuxt'],
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  ssr: false,
  typescript: { strict: true },
  // Server-only (nothing under `public`). Defaults are for local dev; production
  // overrides them with NUXT_* env vars (see AGENTS.md).
  runtimeConfig: {
    databasePath: './data/aladin.db',
    mediaDir: './data/media',
    n8nMode: 'mock',
    n8nBaseUrl: '',
    appInternalUrl: 'http://localhost:3000',
    sharedSecret: DEFAULT_SHARED_SECRET
  },
  css: ['~/assets/css/main.css'],
  vite: {
    plugins: [tailwindcss()]
  },
  shadcn: {
    prefix: '',
    componentDir: '@/components/ui'
  },
  fonts: {
    families: [
      { name: 'Geist', provider: 'google', weights: [400, 500, 600, 700] },
      { name: 'Geist Mono', provider: 'google', weights: [400, 500] }
    ]
  },
  app: {
    head: {
      htmlAttrs: { class: 'dark', lang: 'en' },
      meta: [{ name: 'color-scheme', content: 'dark' }]
    }
  }
})
