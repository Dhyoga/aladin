## Context

Repo baru berisi dokumen (`AGENTS.md`, `design.md` di root, `docker-compose.yml`, `.env.example`) dan belum ada kode. Change ini membangun fondasi yang dipakai change 2–5: scaffold, design system, shell, konfigurasi, SQLite, dan route media.

Batasan yang berlaku (lihat `AGENTS.md` dan `design.md` di root, selanjutnya "design root"):

- Lokal: `pnpm dev`, **tanpa Docker**, tanpa n8n, `n8nMode = mock` (design root §2 "Dev vs prod").
- Stack tetap: Nuxt 4 `ssr: false`, shadcn-vue + Tailwind, SQLite via `better-sqlite3` + Drizzle, Zod, pnpm, Node 22.
- Tidak ada auth, queue, Pinia, atau ORM berat.
- Mesin lokal saat ini memakai Node v24.16 dan pnpm 11.5, sedangkan target adalah Node 22.

## Goals / Non-Goals

**Goals:**

- Proyek yang bisa `pnpm install`, `pnpm dev`, `pnpm build && pnpm preview`, `pnpm lint`, `pnpm typecheck`, dan `pnpm test` tanpa konfigurasi tambahan.
- Design tokens Bagian B (design root) tersedia sebagai CSS variables dan ikut dipakai komponen shadcn-vue.
- App shell responsif dengan dua halaman kosong.
- Fondasi server yang teruji: konfigurasi, DB + migrasi, dan route `/media` (Range, path traversal).

**Non-Goals:**

- Dockerfile, `docker-compose.yml` (change `deploy-to-vps`).
- Tabel bisnis (`jobs`, `brands`, `generations`), klien n8n, endpoint callback.
- Isi halaman Studio dan Brand DNA, light mode, tema yang bisa diganti.
- Menyajikan file dari `public/` (tidak bisa untuk file runtime, lihat Gotcha di `AGENTS.md`).

## Decisions

### 1. Scaffold dan versi

`nuxi init` (Nuxt 4, srcDir `app/`), pnpm, TypeScript strict. Node dikunci ke 22 lewat `.nvmrc` (`22`), `engines.node` `>=22 <23`, dan `engine-strict=true` di `.npmrc`, supaya install di Node lain gagal jelas, bukan membuat binary `better-sqlite3` untuk ABI yang salah.

Versi paket diambil yang terbaru saat apply dan diverifikasi ke dokumentasi resminya (tanggal hari ini 2026-10-17, ekosistem Nuxt/Tailwind/shadcn-vue cepat berubah). `package.json` memakai versi eksak yang terpasang (lockfile di-commit).

*Alternatif*: tidak mengunci Node. Ditolak karena mesin lokal v24 dan target v22, dan modul native sensitif terhadap versi.

### 2. Tailwind v4 lewat plugin Vite, tokens di CSS

Pakai Tailwind CSS v4 dengan `@tailwindcss/vite` yang didaftarkan di `nuxt.config.ts` (`vite.plugins`), dan konfigurasi tema lewat `@theme` di `app/assets/css/main.css`, bukan `tailwind.config.js`. Ini jalur yang didukung shadcn-vue untuk Nuxt. Kalau saat apply ternyata shadcn-vue mensyaratkan jalur lain, ikuti dokumentasi shadcn-vue dan catat di tasks.

*Alternatif*: modul `@nuxtjs/tailwindcss`. Ditolak karena menambah lapisan dan pada praktiknya mengikuti v3.

### 3. Dua lapis token: token proyek dipetakan ke token shadcn

`main.css` mendefinisikan token dari Bagian B (`--bg`, `--surface`, `--surface-2`, `--border`, `--border-strong`, `--text`, `--text-muted`, `--text-subtle`, `--accent`, `--accent-gradient`, `--info`, `--success`, `--danger`) di `:root`. Variabel semantik shadcn (`--background`, `--card`, `--primary`, `--border`, `--input`, `--ring`, dst.) diisi dengan merujuk token proyek (`--background: var(--bg)`, dll.), jadi komponen shadcn otomatis mengikuti design system tanpa override per komponen.

Dark only: nilai dark didefinisikan langsung di `:root` dan `<html class="dark">` dipasang permanen lewat `app.head`. Tidak ada blok light dan tidak ada toggle. Warna latar memakai gradien radial `--bg-glow` di `body`.

Komponen shadcn yang di-generate dengan CLI pada change ini hanya yang dipakai shell: `button`, `sheet` (drawer mobile), `separator`, `skeleton`. Komponen lain ditambah oleh change yang memerlukannya.

### 4. App shell

- `app/layouts/default.vue`: grid sidebar tetap 260px + `<main>`. Konten halaman mengatur max-width sendiri (1100px Brand DNA, 720px Studio, per Bagian B) di halaman, bukan di layout.
- `app/components/AppSidebar.vue`: logo/nama "Aladin", item nav (Studio, Brand DNA) dengan ikon Lucide, state aktif dari route. Ada slot di bawah nav untuk History yang diisi change 4.
- Di bawah 1024px sidebar menjadi `Sheet` yang dibuka dari header tipis berisi tombol menu. Pemisahan breakpoint memakai kelas Tailwind (`lg:`) dan `useMediaQuery` dari VueUse hanya jika perlu mengganti komponen.
- `app/pages/index.vue` memakai `definePageMeta({ redirect: '/studio' })`. `studio.vue` dan `brand-dna.vue` hanya berisi judul halaman sesuai tipografi Bagian B dan teks placeholder pendek.
- Copy UI bahasa Inggris (konvensi `AGENTS.md`).

### 5. Konfigurasi: `runtimeConfig` + pemeriksaan di plugin Nitro

`nuxt.config.ts` mendefinisikan `runtimeConfig` server-only (tanpa `public`) dengan default lokal dari tabel di `AGENTS.md`: `databasePath: './data/aladin.db'`, `mediaDir: './data/media'`, `n8nMode: 'mock'`, `n8nBaseUrl: ''`, `appInternalUrl: 'http://localhost:3000'`, `sharedSecret: 'dev-secret'`. Env `NUXT_*` menimpanya saat runtime.

Zod schema konfigurasi (`shared/schemas/runtime-config.ts`) dipakai oleh `server/plugins/config-check.ts`, yang memvalidasi tipe (mis. `n8nMode` ∈ {`mock`, `live`}) dan, bila `NODE_ENV === 'production'`, menolak start (throw) kalau `sharedSecret` bernilai default atau kurang dari 32 karakter. Logika validasi berupa fungsi murni `assertRuntimeConfig(config, { production })` agar bisa diuji tanpa menjalankan Nitro.

Konsekuensi yang disadari: `pnpm preview` menjalankan build dengan `NODE_ENV=production`, jadi untuk smoke test lokal harus menyetel `NUXT_SHARED_SECRET` ke string ≥ 32 karakter. Ini didokumentasikan di tasks dan `.env.example` (blok lokal).

*Alternatif*: hanya memeriksa saat `n8nMode === 'live'`. Ditolak karena endpoint callback dan aset tetap terekspos di production apa pun mode-nya, dan aturannya di `AGENTS.md` sudah eksplisit.

### 6. Database: singleton lazy + migrator yang toleran folder kosong

- `server/utils/db.ts`: `getDb()` membuat koneksi `better-sqlite3` sekali (lazy) dari `useRuntimeConfig().databasePath`, membuat folder induknya bila belum ada, lalu `pragma journal_mode = WAL` dan `foreign_keys = ON`, dan membungkusnya dengan `drizzle()`. Fungsi inti `openDatabase(path)` murni (tanpa auto-import Nitro) agar bisa diuji.
- `server/db/schema.ts`: untuk sekarang hanya ekspor kosong. Tabel ditambahkan change 2–4.
- `drizzle.config.ts`: schema `server/db/schema.ts`, out `server/db/migrations`, dialect `sqlite`. Skrip `db:generate`.
- `server/plugins/migrate.ts`: menjalankan `migrate()` Drizzle saat start, dengan folder migrasi dari `resolve(process.cwd(), 'server/db/migrations')` (dapat ditimpa `NUXT_MIGRATIONS_DIR` untuk Docker nanti). Folder migrasi tidak ikut bundle Nitro, jadi path dirujuk absolut sesuai Gotcha di `AGENTS.md`. Jika folder ada tetapi `meta/_journal.json` tidak ada (belum ada migrasi), plugin mencatat log dan melewati langkah migrasi tanpa error. Jika foldernya sendiri tidak ada, plugin melempar error yang menyebut path dan `NUXT_MIGRATIONS_DIR`: ini misconfiguration (mis. folder tidak ikut ter-copy ke image), dan melewatinya diam-diam berarti app start dengan DB tanpa tabel. Temuan ini datang dari smoke test `nuxt preview`, yang menjalankan server dari `.output/` sehingga path relatif cwd salah.

Karena itu skrip `preview` tidak memakai `nuxt preview`, melainkan `NODE_ENV=production node --env-file-if-exists=.env .output/server/index.mjs` dari root proyek, sehingga cwd, `data/`, dan `server/db/migrations` identik dengan dev (dan dengan `/app` di Docker).

Karena belum ada tabel, pengujian migrator memakai folder migrasi fixture sementara (di `tmp`) yang dibuat oleh tes.

*Alternatif*: menambahkan satu tabel dummy supaya migrasi "terlihat jalan". Ditolak: menambah skema yang harus dibuang, dan tabel nyata datang di change berikutnya.

### 7. Route `/media` dengan logika di util yang bisa diuji

Route `server/routes/media/[...path].get.ts` hanya memanggil `serveMedia(event, mediaDir)` dari `server/utils/media.ts`. Util ini mengimpor `h3` secara eksplisit (bukan auto-import) supaya bisa diuji dengan `h3` `createApp` + `toWebHandler` tanpa membangun Nuxt.

Perilaku:

- **Path**: dekode, tolak byte null dan segmen `..`, `resolve` terhadap `mediaDir`, lalu pastikan hasilnya berada di dalam `mediaDir` (cek prefix dengan pemisah). Pelanggaran → 400. File tidak ada atau berupa direktori → 404.
- **Content-Type** dari ekstensi (whitelist: png, jpg/jpeg, webp, mp4, pdf; selain itu `application/octet-stream`). Selalu `X-Content-Type-Options: nosniff`.
- **Range**: dukung satu range `bytes=a-b`, `bytes=a-`, dan `bytes=-n` → 206 dengan `Content-Range` dan `Content-Length` yang benar. Range di luar ukuran file → 416 dengan `Content-Range: bytes */<size>`. Header `Range` multi-range atau tidak terbaca → diabaikan, balas 200 penuh. Semua respons file membawa `Accept-Ranges: bytes`.
- **Streaming** dengan `createReadStream(path, { start, end })`, tidak membaca seluruh file ke memori (video bisa besar).
- **Cache**: `Last-Modified` dan `Cache-Control: private, max-age=300`. Dukungan request kondisional (304) belum dibuat.

Parser Range adalah fungsi murni `parseRange(header, size)` agar tiap kasus tepi punya tes sendiri.

### 8. Strategi pengujian

Vitest dengan environment `node`. Semua logika yang diuji ditulis sebagai fungsi murni atau fungsi yang menerima dependensi sebagai argumen (path, config, mediaDir), sehingga tes tidak perlu menjalankan Nitro. `@nuxt/test-utils` terpasang (dibutuhkan change berikutnya untuk tes handler) tetapi tidak dipakai di change ini. Tidak ada tes yang memakai jaringan.

Cakupan minimum: `resolveMediaPath` (traversal, byte null, encoded `..`), `parseRange` (semua bentuk + invalid), handler media (200/206/416/404/400 dan header), `assertRuntimeConfig` (dev vs production, secret pendek/default/valid), `openDatabase` (membuat folder + pragma), dan migrator (folder kosong dilewati, folder fixture dijalankan).

### 9. Higiene repo

`.gitignore` berisi `node_modules`, `.nuxt`, `.output`, `data/`, `.env`, `.env.*` (kecuali `.env.example`), dan `*.log`. Direktori `data/` dibuat otomatis saat runtime dan tidak di-commit. Change ini tidak membuat commit kecuali diminta.

## Risks / Trade-offs

- **[pnpm 11 memblokir build script paket native]** `better-sqlite3` butuh build/download binary saat install → daftarkan di `pnpm.onlyBuiltDependencies` (atau mekanisme setara di versi pnpm terpasang), dan verifikasi dengan tes `openDatabase` di Node 22.
- **[Node lokal v24, target v22]** `engine-strict` akan menolak `pnpm install` di Node 24 → tugas pertama memastikan Node 22 aktif (mis. nvm/fnm/mise); kalau belum ada, install dulu sebelum apply.
- **[Versi Tailwind v4/shadcn-vue/Nuxt berubah cepat]** CLI shadcn-vue bisa menghasilkan struktur berbeda dari asumsi di sini → ikuti dokumentasi resmi terbaru, pertahankan prinsip (tokens dua lapis, komponen di `app/components/ui`) dan catat penyimpangan di tasks.
- **[`pnpm preview` butuh secret panjang]** pengecekan production membuat preview gagal tanpa env → didokumentasikan; kegagalannya jelas (pesan error menyebut `NUXT_SHARED_SECRET`).
- **[Binary native dan migrasi baru teruji lokal, belum di Docker]** → smoke test `pnpm build && pnpm preview` memeriksa bundling di luar Docker; sisa risiko Docker ditangani di change `deploy-to-vps`.
- **[Range handler menyimpang untuk klien yang tidak biasa]** (multi-range, header rusak) → fallback ke 200 penuh, aman untuk semua pemutar.
- **[`@nuxt/fonts` mengunduh font saat build]** butuh jaringan saat `pnpm build` → hasilnya disajikan lokal oleh app, tanpa permintaan font eksternal saat runtime.
