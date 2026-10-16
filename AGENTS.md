# AGENTS.md — Aladin

> Panduan untuk AI coding agent (Claude Code + OpenSpec). Baca file ini dan `design.md` sebelum membuat proposal atau menulis kode.
> Jika `openspec init` menambahkan blok terkelola (managed block) ke file ini, biarkan blok itu tetap ada. Isi di bawah adalah konteks proyek.

## Ringkasan proyek

Aladin adalah webapp internal untuk membuat konten Instagram dari "Brand DNA". Alurnya:

1. **Brand DNA**: user memasukkan URL website atau PDF. n8n meng-crawl atau membaca dokumen, lalu AI menyusun Brand DNA terstruktur. User bisa mengedit semua field, upload logo, dan upload foto produk.
2. **Studio**: user memilih brand, menulis prompt, dan memilih foto produk. Hasilnya ada dua:
   - **Result 1 (Post)**: caption + hashtag + gambar single-image feed (1:1 atau 4:5).
   - **Result 2 (Video)**: video iklan vertikal 9:16 berdurasi 10 detik dengan voice over. Pipeline-nya meniru alur manual "script → storyboard → video".

Domain production: `https://aladin.serdadu.dev` (VPS, Docker, Traefik).

## Prinsip yang tidak boleh dilanggar

- **Semua urusan AI generatif ada di n8n.** App tidak boleh memanggil Gemini atau API AI lain secara langsung. App hanya mengirim job ke webhook n8n dan menerima hasil lewat callback.
- **Tidak ada auth user.** Proteksi akses dilakukan di level Traefik (BasicAuth middleware), bukan di kode app. Jangan menambahkan sistem login.
- **Database: SQLite saja**, satu file di `data/aladin.db`.
- **Semua file media disimpan di filesystem proyek** (`data/media/`), bukan di URL eksternal. URL dari Google atau layanan lain bersifat sementara.
- **Tidak ada auto-post ke Instagram.** Output cukup bisa dicopy dan didownload.
- **Fokus Instagram, single image + video Reels.** Carousel dan platform lain di luar scope.
- **Sederhana dulu.** Jangan menambah queue, Redis, Pinia, ORM berat, atau microservice. Kalau ragu, pilih solusi yang lebih sedikit bagian bergeraknya.

## Tech stack

| Area | Pilihan |
|---|---|
| Framework | **Nuxt 4** (Vue 3, `<script setup lang="ts">`, Composition API) + Nitro sebagai backend. TypeScript strict |
| Rendering | `ssr: false` (SPA + API Nitro). Ini tool internal tanpa kebutuhan SEO, jadi tidak perlu SSR beserta masalah hydration-nya |
| UI | Tailwind CSS + **shadcn-vue** (komponen berbasis Reka UI), dark mode only. Lihat `design.md` Bagian B |
| Ikon | `lucide-vue-next` |
| Font | `@nuxt/fonts` (Geist Sans, Geist Mono) |
| Utilitas | VueUse (`@vueuse/nuxt`), mis. `useIntervalFn` untuk polling dan `useClipboard` untuk copy caption |
| DB | SQLite via `better-sqlite3` + Drizzle ORM (+ drizzle-kit untuk migrasi) |
| Validasi | Zod. Schema disimpan di `shared/` supaya dipakai bersama oleh client dan server |
| Package manager | pnpm |
| Lint & test | `@nuxt/eslint`, Vitest + `@nuxt/test-utils` |
| Runtime deploy | Docker, Node 22 LTS, output Nitro `node-server` (`.output/server/index.mjs`) |
| Orkestrasi AI | n8n (sudah berjalan di VPS, network Docker `n8n-compose_default`) |
| Model AI | Google Gemini API (Interactions API). Detail di `design.md` §3 |

Jangan memakai Nuxt UI sekaligus dengan shadcn-vue. Pilih satu saja, yaitu shadcn-vue.

## Struktur folder (konvensi Nuxt 4)

```
.
├── AGENTS.md
├── design.md
├── docker-compose.yml
├── Dockerfile
├── .env.example
├── nuxt.config.ts
├── drizzle.config.ts
├── app/                               # sisi client (srcDir Nuxt 4)
│   ├── app.vue
│   ├── assets/css/main.css            # Tailwind + design tokens (CSS variables)
│   ├── layouts/default.vue            # shell: sidebar + main
│   ├── pages/
│   │   ├── index.vue                  # redirect ke /studio
│   │   ├── brand-dna.vue              # Halaman 1
│   │   └── studio.vue                 # Halaman 2
│   ├── components/                    # komponen UI (shadcn-vue di components/ui)
│   └── composables/                   # useBrands, useJobPolling, useActiveBrand, dll.
├── server/                            # Nitro (backend)
│   ├── api/
│   │   ├── brands/...                 # CRUD brand, upload aset, re-extract
│   │   ├── generations/...            # buat post, buat video, edit caption, history
│   │   ├── jobs/[id].get.ts           # status job (dipolling UI)
│   │   ├── internal/assets/[id].get.ts  # dipakai n8n untuk download aset (wajib secret)
│   │   └── n8n/callback.post.ts       # endpoint callback dari n8n (wajib secret)
│   ├── routes/media/[...path].get.ts  # serve file dari data/media (dukung Range)
│   ├── plugins/migrate.ts             # jalankan migrasi Drizzle saat server start
│   ├── db/schema.ts, db/migrations/
│   ├── utils/                         # auto-import di server: db, jobs, media, n8n-client, secret
│   └── fixtures/                      # file contoh untuk mock mode
├── shared/                            # dipakai client + server (auto-import Nuxt 4)
│   └── schemas/
│       ├── brand-dna.ts               # Zod BrandDNA
│       └── n8n-contracts.ts           # Zod request & callback n8n
├── n8n/
│   ├── README.md                      # cara import, credential, env
│   └── workflows/
│       ├── aladin-brand-extract.json
│       ├── aladin-post-generate.json
│       └── aladin-video-generate.json
└── data/                              # gitignored: aladin.db + media/
```

## Perintah

```bash
pnpm install
pnpm dev                 # dev server (pakai NUXT_N8N_MODE=mock kalau n8n belum siap)
pnpm build               # nuxt build → .output/
pnpm preview             # jalankan hasil build secara lokal
pnpm lint
pnpm typecheck           # nuxi typecheck (butuh vue-tsc)
pnpm test
pnpm db:generate         # drizzle-kit generate
docker compose up -d --build
```

## Konfigurasi dan environment variables

Semua konfigurasi dibaca lewat `runtimeConfig` di `nuxt.config.ts` (server-only, **tidak ada yang `public`**), lalu diakses dengan `useRuntimeConfig(event)`. Saat runtime, nilainya ditimpa oleh env berprefix `NUXT_`:

| runtimeConfig | Env | Production |
|---|---|---|
| `databasePath` | `NUXT_DATABASE_PATH` | `/app/data/aladin.db` |
| `mediaDir` | `NUXT_MEDIA_DIR` | `/app/data/media` |
| `n8nMode` | `NUXT_N8N_MODE` | `live` (`mock` untuk dev) |
| `n8nBaseUrl` | `NUXT_N8N_BASE_URL` | `http://n8n:5678` |
| `appInternalUrl` | `NUXT_APP_INTERNAL_URL` | `http://aladin:3000` |
| `sharedSecret` | `NUXT_SHARED_SECRET` | dari `.env` |

`BASIC_AUTH_USERS` hanya dipakai label Traefik di docker-compose, bukan oleh app.

## Konvensi kode

- TypeScript strict, tanpa `any`. Semua data dari luar (form, n8n, kolom JSON di DB) di-parse dengan Zod dari `shared/schemas`.
- Komponen Vue: `<script setup lang="ts">`, props/emit bertipe. Tidak memakai Options API.
- State global cukup `useState` bawaan Nuxt atau composable. Tidak memakai Pinia.
- Data fetching di client memakai `useFetch` / `$fetch`. Polling status job lewat satu composable `useJobPolling(jobId)` yang berhenti otomatis saat status final.
- Handler server: nama file mengikuti method (`[id].patch.ts`), pakai `readValidatedBody` / `getValidatedQuery` dengan Zod, dan `createError` untuk error.
- Upload dan callback n8n dibaca dengan `readMultipartFormData`.
- Nama file kebab-case, kecuali komponen Vue yang memakai PascalCase. Kolom DB snake_case.
- Copy UI berbahasa Inggris. Konten yang di-generate default bahasa Indonesia (mengikuti `voice.contentLanguage` di Brand DNA).
- Jangan menulis prompt AI di app. Prompt hidup di workflow n8n. App hanya mengirim data mentah (Brand DNA, prompt user, opsi).

## Gotcha yang sudah diketahui

- **Env harus berprefix `NUXT_`** agar menimpa `runtimeConfig` di production. Env tanpa prefix tidak terbaca setelah build.
- **File runtime tidak bisa disajikan dari `public/`**, karena isinya di-copy saat build. Sajikan lewat `server/routes/media/[...path].get.ts`: cek path traversal, set `Content-Type`, dan **dukung header `Range` (206)**. Tanpa Range, video tidak bisa di-seek dan bisa gagal diputar di Safari/iOS.
- `better-sqlite3` adalah native module. Build dan runtime Docker harus memakai base image yang sama (jangan build di Alpine lalu jalan di Debian slim). Pastikan binary-nya ikut di `.output/server/node_modules`.
- Folder migrasi Drizzle tidak ikut di-bundle Nitro. Copy secara eksplisit ke image dan rujuk dengan path absolut di plugin migrasi.
- Container berjalan sebagai user non-root (uid 1000). Folder `./data` di host harus bisa ditulis uid 1000.
- Generate video bisa memakan beberapa menit. Jangan pernah menunggu hasil n8n secara sinkron di request HTTP. Selalu pakai pola job + callback + polling (lihat `design.md` §2).
- Job yang macet (n8n crash, callback tidak datang) harus ditandai `failed` berdasarkan timeout saat status dibaca.
- Callback bisa datang lebih dari sekali (retry n8n). Handler harus idempotent: abaikan callback untuk job yang sudah `completed`/`failed`.
- `readMultipartFormData` memuat seluruh file ke memori. Ini aman untuk ukuran kita (video 10 detik 720p hanya beberapa MB), tapi tetap batasi ukuran upload (foto 10 MB, PDF 20 MB, callback video 100 MB).
- Model Omni Flash secara resmi baru dievaluasi untuk bahasa Inggris. Voice over bahasa Indonesia bisa bervariasi kualitasnya. Ini urusan prompt di n8n, bukan app.

## Testing

- Unit test (Vitest) untuk: Zod contracts, handler callback (idempotency, secret salah, job tidak ditemukan), timeout job, dan route media (Range, path traversal).
- **Mock mode wajib berfungsi**: dengan `NUXT_N8N_MODE=mock`, seluruh alur UI (extract brand, post, video beserta progress stage) harus bisa didemokan tanpa n8n dan tanpa biaya API, memakai file di `server/fixtures/`.
- Sebelum menandai task selesai: `pnpm lint && pnpm typecheck && pnpm test` harus lolos.

## Alur kerja OpenSpec

- `design.md` adalah sumber kebenaran untuk arsitektur, kontrak n8n, skema data, dan design system. Proposal OpenSpec harus merujuk ke bagian yang relevan dan tidak boleh bertentangan dengannya. Jika perlu mengubah keputusan di `design.md`, ubah lewat proposal dan perbarui `design.md` di change yang sama.
- Urutan change yang disarankan ada di `design.md` Bagian C. Kerjakan satu change sampai selesai dan diarsipkan sebelum change berikutnya.
- Workflow n8n (`n8n/workflows/*.json`) diperlakukan sebagai kode: ada spec-nya sendiri, dan kontraknya harus cocok dengan `shared/schemas/n8n-contracts.ts`.
