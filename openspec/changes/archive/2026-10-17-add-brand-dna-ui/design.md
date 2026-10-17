## Context

API sisi brand (`add-brand-api`) sudah siap: `GET/POST/PATCH/DELETE /api/brands`, aset via `/api/brands/:id/assets`, result handler `brand_extract`, dan status brand direkonsiliasi saat dibaca. Namun halaman `/brand-dna` masih stub ("Coming soon"), dan belum ada composable klien (`useJobPolling`, `useBrands`, `useActiveBrand`) maupun brand switcher di sidebar. Change ini membangun lapisan UI brand di atas API yang sudah ada, bekerja dalam mode mock (default lokal) tanpa memanggil AI secara langsung.

## Goals / Non-Goals

**Goals:**

- Pengguna bisa membuat brand dari URL website, PDF, atau manual melalui dialog New Brand.
- Pengguna bisa melihat daftar brand dalam tampilan kartu dengan status, logo, dan waktu update.
- Pengguna bisa mengedit Brand DNA, upload logo dan foto produk, re-extract, dan hapus brand.
- Brand switcher di sidebar memungkinkan pergantian brand aktif.
- Semua interaksi melalui API REST yang sudah ada; tidak ada panggilan AI langsung dari app.
- Bekerja dalam mode mock (default) dan live (produksi) tanpa perubahan kode UI.

**Non-Goals:**

- Halaman Studio dan generate post/video (change 5–6).
- Autentikasi pengguna atau multi-user (di luar scope project).
- Auto-post ke Instagram.
- Carousel atau platform selain Instagram.

## Decisions

### Composable via `useState` (bukan Pinia)

AGENTS.md melarang Pinia; state global cukup `useState` bawaan Nuxt. `useActiveBrand` menyimpan brand aktif sebagai `useState<BrandDetail | null>('activeBrand')`.

### `useJobPolling` dipindahkan dari change 2

`useJobPolling` adalah konsumen UI pertama (per design.md Bagian C). Dipesat dari change 2 ke sini, polling `GET /api/jobs/:id` interval 2 detik sampai status final (`completed`/`failed`), lalu berhenti otomatis.

### Dialog New Brand dengan 3 mode (URL/PDF/manual)

Satu dialog dengan tab conditional berdasarkan `source_type`, bukan 3 dialog terpisah. API beda per mode (url = field `url`, pdf = file `file`, manual = field `name`), jadi satu dialog dengan form yang berubah-ubah lebih rapi.

### Mode edit Brand DNA via dialog terpisah

Brand DNA punya banyak field (identity, audience, voice, offer, visual, social, notes). Edit dilakukan via dialog terpisah dari kartu brand, bukan inline di halaman utama, agar tidak membebani tampilan kartu.

### Upload aset melalui `Sheet` (drawer)

Upload logo/foto produk menggunakan komponen `Sheet` yang sudah ada di `app/components/ui/sheet`, konsisten dengan pola drawer mobile di `default.vue`.

### Komponen UI tambahan (shadcn-vue)

Sebelumnya hanya `button`, `separator`, `sheet`, `skeleton`. Ditambahkan: `dialog`, `input`, `label`, `textarea`, `badge`. Yang semula direncanakan tetapi tidak dipakai: `form`, `select` (memakai `<select>` native bergaya sama), `card`, `avatar`, `toast` (kesalahan tampil inline). Semua berbasis Reka UI, dark mode only.

### Copy UI berbahasa Inggris

`AGENTS.md` mewajibkan copy UI berbahasa Inggris (konten yang di-generate yang berbahasa Indonesia). Seluruh teks UI change ini berbahasa Inggris; contoh "New brand", bukan "Buat Brand Baru".

### Polling per kartu, bukan per halaman

`useJobPolling` menyimpan state lokal (bukan `useState` bersama) dan berhenti saat scope-nya dibuang. Setiap kartu brand yang `extracting` memiliki `ExtractionProgress` sendiri yang membaca detail brand, mengambil `extraction.jobId`, lalu mem-polling job-nya. Dengan begitu beberapa brand bisa mengekstrak sekaligus, dan halaman yang dimuat ulang saat ada ekstraksi berjalan tetap menampilkan tahapnya. Saat job final, kartu meminta halaman memuat ulang daftar. Kartu `failed` memakai komponen yang sama hanya untuk menampilkan alasan kegagalan.

### Form edit memakai string, bukan skema

Form edit bekerja dengan teks biasa (satu kotak per daftar) lewat `app/utils/brand-dna-form.ts`, lalu dikonversi ke `BrandDNA` dengan Zod saat disimpan. Teks kosong pada field opsional menjadi *tidak ada* (bukan `""`: `website: ""` bukan URL yang valid dan `PATCH` akan menjawab 400). Kalimat dipisah per baris (boleh berkoma), token pendek (warna, hashtag, kata) dipisah koma atau baris.

### Deteksi tipe file dipindah ke `shared/`

Validasi gambar di browser memakai `sniffFileType` yang sama dengan server, jadi `file-type.ts` pindah dari `server/utils/` ke `shared/utils/`.

## Risks / Trade-offs

| Risiko | Mitigasi |
|---|---|
| `useJobPolling` interval 2 detik bisa terlalu sering untuk post/video (5–20 menit) | Interval disesuaikan per tipe job (2 detik brand, 4 detik post/video) menurut design.md §2 |
| Dialog New Brand dengan 3 mode dalam satu file bisa menjadi besar | Pecah ke sub-komponen per mode (NewBrandUrl, NewBrandPdf, NewBrandManual) |
| File upload via Sheet tanpa drag-and-drop | Cukup untuk MVP; drag-and-drop ditangguhkan ke change berikutnya |
| Mode mock tidak ada jaringan asli, semua data dari fixture | Harus diuji dengan `mock:fail` untuk memastikan error path berjalan |

## Migration Plan

Tidak ada migrasi database. Change ini hanya menambahkan file UI dan composable baru; API brand sudah ada dari change sebelumnya. Build dan smoke test lokal dengan `pnpm build && pnpm preview` wajib sebelum archive.

## Open Questions

Diputuskan saat implementasi:

- Brand switcher ada di sidebar utama (`AppSidebar`), di bawah navigasi, dan hanya menampilkan brand `ready` sebagai pilihan (brand yang masih diekstrak atau gagal tampil redup). Brand aktif diingat lewat cookie `last_brand_id`.
- Validasi form edit dilakukan saat submit; pesan lama dihapus begitu form diubah.
