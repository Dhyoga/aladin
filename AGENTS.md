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

## Dev vs Prod

Ada dua lingkungan dengan peran yang berbeda. Jangan mencampurnya.

| | Lokal (dev) | VPS (prod) |
|---|---|---|
| Menjalankan app | `pnpm dev`, **tanpa Docker** | Docker Compose di belakang Traefik |
| Node | 22 (lihat `.nvmrc`) | 22 LTS (image Docker) |
| n8n (dari app) | **App tidak pernah menghubunginya.** `NUXT_N8N_MODE=mock` | `live`, lewat network Docker internal `http://n8n:5678` (mock dulu di change 7) |
| Fungsi | Membangun dan mendemokan seluruh UI + pipeline dengan fixture | Satu-satunya tempat tes live end-to-end (n8n + Gemini) |

Konsekuensinya:

- n8n (`https://n8n.serdadu.dev`) tidak bisa memanggil balik app di laptop (callback dan download aset butuh alamat yang terjangkau). Kita **tidak** memakai tunnel dan **app** di laptop tidak pernah menghubungi n8n. Jangan menambahkan konfigurasi untuk itu.
- Change 1–6 sepenuhnya lokal dengan mock. Mulai change 7 (`deploy-to-vps`) app naik di VPS; change 8 dan 9 membangun workflow n8n dan memverifikasinya live.
- Workflow n8n dibuat dan diuji Claude Code lewat **MCP n8n** (OAuth, dari laptop). App lokal tidak terlibat. Tes e2e (n8n memanggil callback app) hanya terjadi pada app yang berjalan di VPS.
- Claude Code hanya dijalankan di laptop. VPS menerima hasil lewat `git pull` dan `docker compose` yang dijalankan dari laptop via SSH; jangan mengedit kode di VPS. Commit dan push sebelum deploy.
- **Pagar n8n.** Instance n8n dipakai bersama dan memuat workflow produksi lain. Hanya buat, ubah, jalankan, dan publikasikan workflow berawalan `aladin-` (tidak ada folder khusus, awalan nama itulah batasnya). Jangan men-unpublish, meng-archive, atau mengubah workflow lain, dan matikan lagi *Available in MCP* untuknya bila sempat dinyalakan. Credential dibuat manual oleh user (Claude Code hanya mencari ID lewat `list_credentials`, tidak pernah melihat secret).
- **Pagar VPS.** Server dipakai bersama (Traefik, n8n, dan proyek lain di `$HOME`; RAM 3,6 GB). Akses SSH (`ubuntu`, sudo tanpa password, grup docker) dipakai hanya untuk `~/aladin` dan container `aladin`. Jangan menyentuh `~/n8n-compose` (restart atau `down` Traefik mematikan semua situs), proyek lain, `.env`, `.git-credentials`, atau `.bash_history`. Perintah yang mengubah server dikonfirmasi dulu ke user; membaca (log, `docker ps`, `ls`) bebas.
- Docker (`Dockerfile`, `docker-compose.yml`) hanya untuk VPS dan dibuat di change `deploy-to-vps`. Sebelum itu, build diperiksa lokal lewat `pnpm build && pnpm preview` (lihat Gotcha).

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
| Ikon | `@lucide/vue` (pengganti `lucide-vue-next`, yang sudah deprecated) |
| Font | `@nuxt/fonts` (Geist Sans, Geist Mono) |
| Utilitas | VueUse (`@vueuse/nuxt`), mis. `useIntervalFn` untuk polling dan `useClipboard` untuk copy caption |
| DB | SQLite via `better-sqlite3` + Drizzle ORM (+ drizzle-kit untuk migrasi) |
| Validasi | Zod. Schema disimpan di `shared/` supaya dipakai bersama oleh client dan server |
| Package manager | pnpm |
| Lint & test | `@nuxt/eslint`, Vitest + `@nuxt/test-utils`. Tes ada di `tests/` (bukan di samping kode: file di `server/utils` otomatis ter-import Nitro) |
| Runtime dev | Node 22 (`.nvmrc` + `engines` di `package.json`), `pnpm dev`, tanpa Docker |
| Runtime deploy | Docker (hanya di VPS), Node 22 LTS, output Nitro `node-server` (`.output/server/index.mjs`) |
| Orkestrasi AI | n8n di VPS (`https://n8n.serdadu.dev`, network Docker `n8n-compose_default`). Hanya dipakai di prod, tidak dari lokal |
| Model AI | Google Gemini API (Interactions API). Detail di `design.md` §3 |

Jangan memakai Nuxt UI sekaligus dengan shadcn-vue. Pilih satu saja, yaitu shadcn-vue.

## Struktur folder (konvensi Nuxt 4)

```
.
├── AGENTS.md
├── design.md
├── .nvmrc                             # 22
├── docker-compose.yml                 # hanya VPS (change deploy-to-vps)
├── Dockerfile                         # hanya VPS (change deploy-to-vps)
├── .env.example                       # variabel VPS (compose) + variabel lokal opsional
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
│   │   ├── internal/assets/[id].get.ts  # dipakai n8n untuk download aset (wajib secret; dibuat di change add-brand-dna)
│   │   └── n8n/callback.post.ts       # endpoint callback dari n8n (wajib secret)
│   ├── routes/media/[...path].get.ts  # serve file dari data/media (dukung Range); .head.ts memakai logika yang sama
│   ├── plugins/migrate.ts             # jalankan migrasi Drizzle saat server start
│   ├── db/schema.ts, db/migrations/
│   ├── utils/                         # auto-import di server: db, jobs, job-*, n8n-client, n8n-mock, secret, media, media-storage, upload, brands, brand-assets, brand-extraction, brand-requests, generations, post-result, generation-requests, video-generation, video-result
│   └── fixtures/                      # file contoh untuk mock mode
├── shared/                            # dipakai client + server (auto-import Nuxt 4)
│   ├── utils/file-type.ts             # deteksi PNG/JPEG/WebP/PDF dari isi file (server dan browser)
│   └── schemas/
│       ├── brand-dna.ts               # Zod BrandDNA
│       └── n8n-contracts.ts           # Zod request & callback n8n
├── n8n/
│   ├── README.md                      # credential, MCP, tangga tes (change 8)
│   └── workflows/                     # kode @n8n/workflow-sdk, bukan JSON (bentuk final ditetapkan di change 8)
│       ├── aladin-brand-extract.ts
│       ├── aladin-post-generate.ts    # change 8
│       └── aladin-video-generate.ts   # change 9
└── data/                              # gitignored: aladin.db + media/
```

## Perintah

```bash
pnpm install
pnpm dev                 # dev server lokal, selalu mode mock (default n8nMode = mock)
pnpm build               # nuxt build → .output/
pnpm preview             # jalankan .output/server/index.mjs dari root proyek dengan NODE_ENV=production (butuh NUXT_SHARED_SECRET >= 32 karakter)
pnpm lint
pnpm typecheck           # nuxi typecheck (butuh vue-tsc)
pnpm test
pnpm db:generate         # drizzle-kit generate
```

Hanya di VPS:

```bash
docker compose up -d --build
```

## Konfigurasi dan environment variables

Semua konfigurasi dibaca lewat `runtimeConfig` di `nuxt.config.ts` (server-only, **tidak ada yang `public`**), lalu diakses dengan `useRuntimeConfig(event)`. Saat runtime, nilainya ditimpa oleh env berprefix `NUXT_`:

| runtimeConfig | Env | Default (lokal) | Production |
|---|---|---|---|
| `databasePath` | `NUXT_DATABASE_PATH` | `./data/aladin.db` | `/app/data/aladin.db` |
| `mediaDir` | `NUXT_MEDIA_DIR` | `./data/media` | `/app/data/media` |
| `n8nMode` | `NUXT_N8N_MODE` | `mock` | `live` (diset eksplisit di compose) |
| `n8nBaseUrl` | `NUXT_N8N_BASE_URL` | kosong (tidak dipakai di mock) | `http://n8n:5678` |
| `appInternalUrl` | `NUXT_APP_INTERNAL_URL` | `http://localhost:3000` (tidak dipakai di mock) | `http://aladin:3000` |
| `sharedSecret` | `NUXT_SHARED_SECRET` | `dev-secret` | dari `.env`, minimal 32 karakter |

Default `n8nMode` sengaja `mock`, jadi lokal aman tanpa konfigurasi apa pun: tidak ada panggilan ke n8n dan tidak ada biaya API. Di production, server menolak start jika `sharedSecret` masih default atau kurang dari 32 karakter.

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
- `better-sqlite3` adalah native module. Build dan runtime Docker harus memakai base image yang sama (jangan build di Alpine lalu jalan di Debian slim). Pastikan binary-nya ikut di `.output/server/node_modules`. `better-sqlite3` v13 membawa binary prebuilt multi-platform di `prebuilds/` (termasuk `linux-x64` glibc dan `linuxmusl-x64`), tetapi tetap pakai base image yang sama di build dan runtime.
- **pnpm 11 memblokir build script dependensi** sampai disetujui. Persetujuan disimpan di `pnpm-workspace.yaml` (`allowBuilds`), bukan `onlyBuiltDependencies`. `esbuild` dan `better-sqlite3` sudah diizinkan; dependensi native baru harus ditambahkan di sana.
- Folder migrasi Drizzle tidak ikut di-bundle Nitro. Copy secara eksplisit ke image dan rujuk dengan path absolut di plugin migrasi.
- Karena Docker baru dicoba saat deploy, **smoke test build lokal wajib** sebelum change ditandai selesai: `pnpm build && NUXT_SHARED_SECRET=<32+ karakter> pnpm preview` (skrip `preview` sengaja bukan `nuxt preview`: itu menjalankan server dari `.output/`, sehingga path relatif cwd untuk `data/` dan folder migrasi salah), lalu cek bahwa migrasi jalan, `better-sqlite3` termuat, dan `/media` melayani file. Ini menangkap sebagian besar masalah bundling yang akan muncul di Docker.
- Container berjalan sebagai user non-root (uid 1000). Folder `./data` di host harus bisa ditulis uid 1000.
- Generate video bisa memakan beberapa menit. Jangan pernah menunggu hasil n8n secara sinkron di request HTTP. Selalu pakai pola job + callback + polling (lihat `design.md` §2).
- Job yang macet (n8n crash, callback tidak datang) harus ditandai `failed` berdasarkan timeout saat status dibaca.
- Callback bisa datang lebih dari sekali (retry n8n). Handler harus idempotent: abaikan callback untuk job yang sudah `completed`/`failed`.
- `readMultipartFormData` memuat seluruh file ke memori. Ini aman untuk ukuran kita (video 10 detik 720p hanya beberapa MB), tapi tetap batasi ukuran upload (foto 10 MB, PDF 20 MB, callback video 100 MB).
- **Job pipeline** (`server/utils/job-*.ts`, `n8n-client.ts`): semua perubahan status job lewat `UPDATE … WHERE status IN (…)` (lihat `jobs.ts`), jangan menulis status dengan cara lain. Callback boleh datang sebelum app menandai `running`, dan boleh datang dobel.
- **Job dibuat lewat `dispatchJob({ type, brandId, generationId, input })`** (`job-services.ts`). Hasil job disimpan oleh result handler yang didaftarkan fitur lewat `registerJobHandler(type, { onProgress?, onCompleted })` di sebuah Nitro plugin. Job `completed` tanpa handler menjadi `failed` (`no_result_handler`).
- **Pipeline mengasumsikan satu proses Nitro** (timer mock, set `completing` untuk callback dobel, SQLite satu penulis). Jangan menjalankan lebih dari satu instance tanpa merancang ulang klaim di DB.
- **Mock mode**: fixture di `server/fixtures/` (dibaca relatif cwd, lihat README di folder itu). Isi URL atau prompt dengan teks `mock:fail` untuk mensimulasikan job gagal. Restart server mematikan skenario yang sedang berjalan, dan jobnya berakhir `failed` (`timeout`) saat dibaca.
- **Brand** (`server/utils/brand*.ts`): logika ada di service murni yang menerima `{ db, mediaDir, dispatch, now }`; route hanya memanggil `getBrandHandlers()`. Service melempar `BrandError` (`not_found` 404, `invalid` 400, `conflict` 409, `too_large` 413, `corrupt` 500), dipetakan ke HTTP di `brand-requests.ts`. Body error Nitro berisi `statusCode`, `statusMessage`, dan `message` (teks yang boleh ditampilkan UI).
- **Upload**: tipe file ditentukan dari isinya (`sniffFileType`), bukan dari nama atau MIME klien. Nama dan path file dibuat server (`brands/<brandId>/…`), tidak pernah dari input user. Unggah banyak file bersifat semua-atau-tidak. Tulis dan hapus file hanya lewat `saveMediaFile`/`removeMediaPath`.
- **Status brand diturunkan dari job ekstraksinya saat dibaca** (`reconcileBrand`), karena pipeline tidak punya hook gagal. Jangan menambah tempat lain yang menulis `failed` ke brand. Hasil ekstraksi tidak menimpa logo yang sudah ada, dan ekstraksi ulang tidak menghapus DNA lama sampai hasil baru sukses.
- **Generations** (`server/utils/generation*.ts`, `post-result.ts`): tabel `generations` tidak punya kolom status maupun job id. Status (`running`/`completed`/`failed`) diturunkan dari job `post` terbarunya lewat `jobs.generation_id` (`deriveStatus`), jadi jangan menambah kolom status. Service melempar `GenerationError` (`not_found` 404, `invalid` 400, `conflict` 409, `corrupt` 500) dan mem-parse body dengan Zod sendiri supaya pesannya terbaca user. Brand harus `ready` dan foto harus milik brand itu (1–3) sebelum job dikirim, karena tiap generate berbiaya. Gambar disimpan sebagai `generations/<id>/post.<ext>` dengan ekstensi dari isi file. Hashtag dari model dibersihkan (`cleanGeneratedHashtags`), tidak ditolak; hashtag dari user divalidasi (`normalizeHashtags`).
- **Video** (`video-generation.ts`, `video-result.ts`): status video diturunkan dari job `video` terbaru (`deriveVideo`), tanpa kolom status. `createVideo` menolak (409) bila post belum selesai, video sedang berjalan atau sudah selesai, brand/DNA belum siap, atau foto sudah terhapus; video `failed` boleh diulang. **Jangan menaruh `await` di antara pengecekan itu dan pembuatan job** (yang terjadi sinkron di dalam `dispatch`), karena video berbiaya ~US$1 dan klik ganda akan membuat dua job. Result handler menyimpan script dan storyboard saat progress, dan `video.mp4` saat selesai (MP4 dideteksi dari `ftyp` di `sniffFileType`); file divalidasi sebelum ditulis. Di mock mode, simulasikan video gagal dengan menulis `mock:fail` di **caption** post (prompt yang berisi teks itu sudah menggagalkan post-nya), lalu perbaiki caption dan Retry.
- **Studio**: halaman Studio memiliki polling history (satu pemilik, tiap 3 detik selama ada item `running`); `StudioHistory` di sidebar hanya membaca state bersama dan tampil hanya di `/studio`. `PostResult` mengikuti job generation yang dipilih lewat `useJobPolling`. Pesan gagal ke user lewat `friendlyGenerationError` (jangan tampilkan kode seperti `dispatch_failed`). Id di komponen sidebar harus dari `useId()` karena sidebar dirender dua kali (desktop dan laci mobile).
- Menghapus brand tidak menghapus job-nya, tetapi menghapus generations-nya beserta folder `generations/<id>/`. Job yang masih berjalan berakhir `failed` (`handler_failed`) saat callback tiba.
- `/api/n8n/callback` dan `/api/internal/*` menjawab 404 untuk request ber-header `X-Forwarded-Host` (artinya datang lewat Traefik). n8n harus memanggil `http://aladin:3000` langsung, bukan domain publik.
- **CLI shadcn-vue (`shadcn-vue add …`) menimpa `app/assets/css/main.css`** (menambah lagi `@import` Google Fonts dan blok `@layer base` ganda) dan, dengan `--overwrite`, `ui/button/index.ts` (varian pill proyek). Cadangkan keduanya sebelum menjalankannya dan pulihkan sesudahnya. Jalankan non-interaktif (`< /dev/null`), karena prompt overwrite membuatnya menggantung.
- **UI brand**: `useJobPolling` punya state lokal per pemakai (jangan diganti `useState`), dan form edit DNA bekerja lewat `app/utils/brand-dna-form.ts` (teks kosong pada field opsional harus menjadi *tidak ada*, bukan `""`). Pesan error API dibaca dengan `errorMessage()` (`app/utils/api-error.ts`), bukan `error.message` dari `$fetch`.
- Model Omni Flash secara resmi baru dievaluasi untuk bahasa Inggris. Voice over bahasa Indonesia bisa bervariasi kualitasnya. Ini urusan prompt di n8n, bukan app.

## Testing

- Unit test (Vitest) untuk: Zod contracts, handler callback (idempotency, secret salah, job tidak ditemukan), timeout job, dan route media (Range, path traversal).
- **Mock mode wajib berfungsi**: dengan `NUXT_N8N_MODE=mock`, seluruh alur UI (extract brand, post, video beserta progress stage) harus bisa didemokan tanpa n8n dan tanpa biaya API, memakai file di `server/fixtures/`.
- **App lokal tidak pernah menghubungi n8n.** Semua tes `pnpm test` memakai mock dan tidak boleh membutuhkan jaringan. Workflow n8n diuji lewat MCP dengan tangga murah ke mahal: `validate_workflow` → `test_workflow` dengan pin data (gratis) → `execute_workflow` manual (kena biaya Gemini, `callback_url` ke app di VPS) → generate dari UI app. Verifikasi e2e penuh (n8n + Gemini + callback ke app) dilakukan di VPS.
- Karena mock memakai handler callback yang sama dengan live, kontrak di sisi app terjamin lokal. Risiko yang tersisa hanya di sisi workflow n8n.
- Sebelum menandai task selesai: `pnpm lint && pnpm typecheck && pnpm test` harus lolos.

## Alur kerja OpenSpec

- `design.md` adalah sumber kebenaran untuk arsitektur, kontrak n8n, skema data, dan design system. Proposal OpenSpec harus merujuk ke bagian yang relevan dan tidak boleh bertentangan dengannya. Jika perlu mengubah keputusan di `design.md`, ubah lewat proposal dan perbarui `design.md` di change yang sama.
- Urutan change yang disarankan ada di `design.md` Bagian C. Kerjakan satu change sampai selesai dan diarsipkan sebelum change berikutnya.
- Workflow n8n (kode SDK di `n8n/workflows/`) diperlakukan sebagai kode: ada spec-nya sendiri, dan kontraknya harus cocok dengan `shared/schemas/n8n-contracts.ts`. Jangan mengedit workflow Aladin lewat UI n8n tanpa memindahkan perubahannya kembali ke kode di repo.
