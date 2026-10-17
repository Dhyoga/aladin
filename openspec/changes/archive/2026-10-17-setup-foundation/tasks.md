## 1. Prasyarat dan scaffold

- [x] 1.1 Pastikan Node 22 aktif (`node -v` menampilkan v22.x). Jika belum, install lewat nvm/fnm/mise sebelum lanjut
- [x] 1.2 Scaffold Nuxt 4 di root repo dengan `nuxi init` (pnpm, srcDir `app/`) tanpa menimpa `AGENTS.md`, `design.md`, `docker-compose.yml`, `.env.example`, dan folder `openspec/`/`.claude/`
- [x] 1.3 Tambah `.nvmrc` (`22`), `engines.node` `>=22 <23` di `package.json`, dan `.npmrc` dengan `engine-strict=true`
- [x] 1.4 Set `ssr: false` dan TypeScript strict di `nuxt.config.ts`; hapus boilerplate bawaan scaffold (welcome page, dll.)
- [x] 1.5 Tulis `.gitignore` (`node_modules`, `.nuxt`, `.output`, `data/`, `.env`, `.env.*` kecuali `.env.example`, `*.log`)
- [x] 1.6 Verifikasi: `pnpm install` berhasil di Node 22 dan `pnpm dev` menyala tanpa error

## 2. Tooling: lint, test, skrip

- [x] 2.1 Pasang dan konfigurasi `@nuxt/eslint`
- [x] 2.2 Pasang `vitest` dan `@nuxt/test-utils`, buat `vitest.config.ts` (environment `node`, tanpa akses jaringan)
- [x] 2.3 Pasang `zod` dan buat folder `shared/schemas/`
- [x] 2.4 Atur skrip `package.json`: `dev`, `build`, `preview`, `lint`, `typecheck` (`nuxi typecheck`, pasang `vue-tsc` + `typescript`), `test` (`vitest run`), `db:generate` (`drizzle-kit generate`)
- [x] 2.5 Verifikasi: `pnpm lint`, `pnpm typecheck`, dan `pnpm test` (boleh 0 tes pada tahap ini, atau satu tes placeholder yang dihapus nanti) berjalan tanpa error

## 3. Design system

- [x] 3.1 Pasang Tailwind CSS v4 dengan `@tailwindcss/vite` dan daftarkan di `nuxt.config.ts`; buat `app/assets/css/main.css` dan daftarkan sebagai CSS global. Cek dokumentasi resmi terbaru untuk jalur yang didukung shadcn-vue di Nuxt dan catat penyimpangan bila ada
- [x] 3.2 Definisikan token Bagian B (`--bg`, `--bg-glow`, `--surface`, `--surface-2`, `--border`, `--border-strong`, `--text`, `--text-muted`, `--text-subtle`, `--accent`, `--accent-gradient`, `--info`, `--success`, `--danger`) di `:root` pada `main.css`, hanya nilai dark, dan petakan ke utilitas Tailwind lewat `@theme`
- [x] 3.3 Pasang dan inisialisasi shadcn-vue (CLI) dengan komponen di `app/components/ui`; petakan variabel semantik shadcn (`--background`, `--card`, `--primary`, `--border`, `--input`, `--ring`, dst.) ke token proyek (primary = tombol pill putih `#FAFAFA` dengan teks hitam)
- [x] 3.4 Tambah komponen shadcn yang dibutuhkan shell: `button`, `sheet`, `separator`, `skeleton`
- [x] 3.5 Pasang `@lucide/vue` (`lucide-vue-next` sudah deprecated), `@vueuse/nuxt`, dan `@nuxt/fonts`; konfigurasi Geist Sans dan Geist Mono dengan fallback Inter/`system-ui`
- [x] 3.6 Pasang `<html class="dark">` permanen lewat `app.head`, latar `body` memakai `--bg` + gradien radial `--bg-glow` (oranye `rgba(234,88,12,0.10)` di kanan bawah), dan atur `color-scheme: dark`
- [x] 3.7 Verifikasi: halaman kosong tampil hitam dengan glow, token terbaca di DevTools, dan tidak ada tampilan terang saat OS memakai light mode

## 4. App shell

- [x] 4.1 Buat `app/app.vue` dengan `<NuxtLayout><NuxtPage /></NuxtLayout>`
- [x] 4.2 Buat `app/components/AppSidebar.vue`: nama "Aladin", item nav Studio dan Brand DNA (ikon Lucide, tinggi 40px, radius 10px, state aktif dengan latar `--surface-2` + border oranye tipis dan glow lembut), dan slot di bawah nav untuk konten khusus halaman
- [x] 4.3 Buat `app/layouts/default.vue`: sidebar 260px (border kanan, latar `#0D0D0D`) di ≥1024px; di <1024px sidebar disembunyikan dan diganti header tipis dengan tombol menu yang membuka `Sheet` berisi navigasi yang sama, tertutup otomatis saat item dipilih
- [x] 4.4 Buat `app/pages/index.vue` dengan `definePageMeta({ redirect: '/studio' })`
- [x] 4.5 Buat `app/pages/studio.vue` dan `app/pages/brand-dna.vue`: judul halaman (44–48px bold, tracking rapat) + teks placeholder singkat, tanpa fitur; copy dalam bahasa Inggris
- [x] 4.6 Verifikasi manual di browser: `/` berakhir di `/studio`, state aktif nav benar, sidebar menjadi drawer di <1024px, dan tidak ada scroll horizontal di lebar 375px

## 5. Konfigurasi runtime

- [x] 5.1 Definisikan `runtimeConfig` di `nuxt.config.ts` tanpa `public`, dengan default lokal: `databasePath: './data/aladin.db'`, `mediaDir: './data/media'`, `n8nMode: 'mock'`, `n8nBaseUrl: ''`, `appInternalUrl: 'http://localhost:3000'`, `sharedSecret: 'dev-secret'`
- [x] 5.2 Buat `shared/schemas/runtime-config.ts`: schema Zod konfigurasi (`n8nMode` ∈ `mock`/`live`) dan konstanta default secret
- [x] 5.3 Buat fungsi murni `assertRuntimeConfig(config, { production })` (di `server/utils/`, tanpa auto-import Nitro): validasi schema; di production tolak `sharedSecret` default atau < 32 karakter dengan pesan yang menyebut `NUXT_SHARED_SECRET`; pesan error invalid menyebut key yang salah
- [x] 5.4 Buat `server/plugins/config-check.ts` yang memanggil `assertRuntimeConfig` dengan `NODE_ENV === 'production'` dan men-throw sehingga server gagal start
- [x] 5.5 Tes Vitest untuk `assertRuntimeConfig`: default lokal valid; `n8nMode` tidak valid ditolak dengan menyebut `n8nMode`; production + secret default ditolak; production + secret 20 karakter ditolak; production + secret 32 karakter non-default diterima; development + secret default diterima

## 6. Database

- [x] 6.1 Pasang `better-sqlite3`, `drizzle-orm`, `drizzle-kit`, `@types/better-sqlite3`; daftarkan `better-sqlite3` di `pnpm.onlyBuiltDependencies` (atau mekanisme setara di versi pnpm terpasang) dan pastikan binary native terpasang di Node 22
- [x] 6.2 Buat `server/db/schema.ts` (ekspor kosong), `drizzle.config.ts` (dialect `sqlite`, schema `server/db/schema.ts`, out `server/db/migrations`), dan folder `server/db/migrations/`
- [x] 6.3 Buat `server/utils/db.ts`: fungsi murni `openDatabase(path)` (buat folder induk, `journal_mode = WAL`, `foreign_keys = ON`, kembalikan instance Drizzle + koneksi) dan `getDb()` yang membuat koneksi lazy sekali dari `useRuntimeConfig().databasePath`
- [x] 6.4 Buat fungsi murni `runMigrations(db, migrationsDir)`: lempar error jika foldernya tidak ada (sebut path dan `NUXT_MIGRATIONS_DIR`); lewati dengan log jika `meta/_journal.json` tidak ada; selain itu jalankan `migrate()` Drizzle dan biarkan error merambat
- [x] 6.5 Buat `server/plugins/migrate.ts`: tentukan `migrationsDir` = `NUXT_MIGRATIONS_DIR` atau `resolve(process.cwd(), 'server/db/migrations')`, panggil `runMigrations`; kegagalan membuat server gagal start
- [x] 6.6 Tes Vitest memakai direktori sementara: `openDatabase` membuat folder + file dan pragma `wal`/`foreign_keys=1`; `getDb`-style accessor mengembalikan instance sama; `runMigrations` melewati folder tanpa journal; menerapkan migrasi fixture; idempoten pada run kedua; error pada migrasi SQL rusak merambat
- [x] 6.7 Verifikasi: `pnpm dev` membuat `data/aladin.db` dan log menyatakan belum ada migrasi

## 7. Route media

- [x] 7.1 Buat `resolveMediaPath(mediaDir, relPath)` di `server/utils/media.ts` (import `h3`/`node:*` eksplisit): dekode, tolak byte null dan segmen `..`, resolve terhadap `mediaDir`, pastikan hasil berada di dalam `mediaDir` dengan cek prefix berpemisah (`/data/media-secret` bukan di dalam `/data/media`); pelanggaran menghasilkan error yang dipetakan ke 400
- [x] 7.2 Buat `parseRange(header, size)` murni: satu range `a-b`, `a-`, `-n`; clamp akhir ke `size - 1`; mengembalikan `satisfiable`/`unsatisfiable`/`ignore` (multi-range atau malformed = ignore)
- [x] 7.3 Buat peta `Content-Type` (png, jpg/jpeg, webp, mp4, pdf, fallback `application/octet-stream`)
- [x] 7.4 Buat `serveMedia(event, mediaDir)`: 404 untuk file hilang atau direktori; header `Accept-Ranges`, `Content-Type`, `X-Content-Type-Options: nosniff`, `Last-Modified`, `Cache-Control: private, max-age=300`; 200 penuh, 206 dengan `Content-Range` dan `Content-Length` benar, atau 416 dengan `Content-Range: bytes */<size>`; isi dialirkan dengan `createReadStream(path, { start, end })`
- [x] 7.5 Buat `server/routes/media/[...path].get.ts` yang hanya memanggil `serveMedia(event, useRuntimeConfig(event).mediaDir)`
- [x] 7.6 Tes Vitest `resolveMediaPath`: path normal; `../../etc/passwd`; `..%2F` ter-encode; `%00`; kasus prefix saudara (`media-secret`)
- [x] 7.7 Tes Vitest `parseRange` untuk setiap skenario di spec (bounded, open-ended, suffix, akhir melebihi ukuran, unsatisfiable, multi-range, malformed)
- [x] 7.8 Tes Vitest handler (h3 `createApp` + `toWebHandler`, direktori sementara berisi file 1000 byte dan sebuah `.mp4`): 200 + header, 206 tiga bentuk, 416, 200 untuk multi-range dan malformed, 404 file hilang dan direktori, 400 traversal, `Content-Type` (`video/mp4`, `.xyz`), serta header `Last-Modified` dan `Cache-Control`
- [x] 7.9 Verifikasi manual: taruh file kecil di `data/media/` lalu `curl -i` dan `curl -i -H 'Range: bytes=0-9'` ke `/media/<file>` di `pnpm dev`

## 8. Verifikasi akhir

- [x] 8.1 Perbarui blok lokal `.env.example`: tambahkan catatan bahwa `pnpm preview` membutuhkan `NUXT_SHARED_SECRET` (≥ 32 karakter), dan `NUXT_MIGRATIONS_DIR` sebagai opsi
- [x] 8.2 Jalankan `pnpm lint && pnpm typecheck && pnpm test` sampai lolos
- [x] 8.3 Smoke test build: `pnpm build`, lalu `NUXT_SHARED_SECRET=<32+ karakter acak> pnpm preview` (skrip `preview` menjalankan `.output/server/index.mjs` dari root proyek); periksa bahwa server start, `data/aladin.db` terbentuk, `better-sqlite3` termuat dari `.output/server/node_modules`, `/` menampilkan app, dan `/media/<file>` melayani file (termasuk `Range`)
- [x] 8.4 Cek bahwa `pnpm preview` tanpa `NUXT_SHARED_SECRET` gagal start dengan pesan yang menyebut `NUXT_SHARED_SECRET`
- [x] 8.5 Cek bahwa tidak ada kode yang memanggil n8n atau API AI, dan bundle client tidak memuat `sharedSecret`
- [x] 8.6 Cocokkan hasil dengan `design.md` Bagian B dan perbarui `AGENTS.md`/`design.md` root hanya jika implementasi menyimpang dari yang tertulis
