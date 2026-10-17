## Why

Aladin belum punya kode sama sekali. Change berikutnya (job pipeline, Brand DNA, Studio) semuanya butuh fondasi yang sama: scaffold Nuxt 4, design system, app shell, SQLite, konfigurasi, dan penyajian file media. Mengerjakannya sekali di awal, lokal-first tanpa Docker dan tanpa n8n, membuat change 2–5 bisa dikembangkan dan didemokan penuh dengan mock mode (lihat `design.md` Bagian C dan `AGENTS.md` bagian "Dev vs Prod").

## What Changes

- Scaffold proyek **Nuxt 4** (`ssr: false`, TypeScript strict) dengan pnpm, Node 22 (`.nvmrc` + `engines`), `@nuxt/eslint`, Vitest + `@nuxt/test-utils`, dan skrip `dev`, `build`, `preview`, `lint`, `typecheck`, `test`, `db:generate`.
- Pasang **Tailwind CSS + shadcn-vue**, `@lucide/vue` (`lucide-vue-next` sudah deprecated), `@nuxt/fonts` (Geist Sans/Mono), dan `@vueuse/nuxt`. Dark mode only.
- Terapkan **design tokens** `design.md` Bagian B sebagai CSS variables di `app/assets/css/main.css` (warna, tipografi, radius kartu, glow latar).
- Bangun **app shell**: layout default dengan sidebar 260px (drawer di bawah 1024px), item nav Studio dan Brand DNA, `/` redirect ke `/studio`, dan dua halaman kosong `/studio` dan `/brand-dna`.
- Tambah **`runtimeConfig`** server-only (tanpa `public`) dengan default lokal (`n8nMode = mock`), dan pengecekan di production: server menolak start jika `sharedSecret` default atau kurang dari 32 karakter.
- Tambah **SQLite + Drizzle**: koneksi `better-sqlite3` ke `data/aladin.db`, `drizzle.config.ts`, folder migrasi, dan Nitro plugin yang menjalankan migrasi saat server start. Belum ada tabel bisnis (tabel datang bersama change yang memerlukannya).
- Tambah route **`GET /media/[...path]`** yang menyajikan file dari `data/media` dengan header `Range` (206), `Content-Type` yang benar, dan penolakan path traversal.
- Perbarui `.gitignore` (`data/`, `.output/`, `.nuxt/`, `.env`).
- **Tidak termasuk**: Dockerfile dan `docker-compose.yml` (change `deploy-to-vps`), tabel `jobs`/`brands`/`generations`, klien n8n, dan fitur halaman apa pun selain shell kosong.

## Capabilities

### New Capabilities

- `app-shell`: layout, sidebar, navigasi, routing dasar, dan design tokens dark-only yang dipakai seluruh halaman.
- `runtime-config`: konfigurasi server-only lewat `runtimeConfig` dan env `NUXT_*`, default aman untuk lokal, dan validasi secret di production.
- `database`: koneksi SQLite via Drizzle dan migrasi otomatis saat server start.
- `media-serving`: penyajian file runtime dari `data/media` lewat `/media/*` dengan dukungan `Range` dan proteksi path traversal.

### Modified Capabilities

<!-- Tidak ada. Belum ada spec di openspec/specs/. -->

## Impact

- **Kode baru**: seluruh scaffold (`nuxt.config.ts`, `app/`, `server/`, `shared/`, `drizzle.config.ts`, `package.json`, `.nvmrc`, config ESLint/Vitest/Tailwind).
- **Dependensi**: `nuxt`, `tailwindcss`, `shadcn-vue` (+ `reka-ui`), `@lucide/vue` (`lucide-vue-next` sudah deprecated), `@nuxt/fonts`, `@vueuse/nuxt`, `better-sqlite3`, `drizzle-orm`, `drizzle-kit`, `zod`, `vitest`, `@nuxt/test-utils`, `@nuxt/eslint`.
- **Dokumen**: `design.md` dan `AGENTS.md` sudah diperbarui sebelum change ini (topologi dev vs prod, urutan change). Tidak ada perubahan dokumen lanjutan kecuali ditemukan ketidaksesuaian saat implementasi.
- **Sistem eksternal**: tidak ada. Tidak ada koneksi ke n8n atau API AI.
- **Referensi**: `design.md` §2 (dev vs prod, mock default), §6 (lokasi file), §10 (secret, path traversal), Bagian B (design system), Bagian C (change 1).
