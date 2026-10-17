## Why

Brand DNA sudah bisa dibuat dan diedit, dan pipeline job sudah teruji, tetapi belum ada yang dibuat dari DNA itu. Studio adalah inti produk: user menulis prompt, memilih foto produk, lalu mendapat post Instagram (caption, hashtag, gambar) yang bisa disalin dan diunduh. Change ini membangun Result 1 (Post) dari ujung ke ujung dalam mode mock, memakai `dispatchJob` dan result handler yang sudah disiapkan untuk ini. Result 2 (Video) menyusul di change berikutnya di atas fondasi yang sama.

## What Changes

- Tambah tabel **`generations`** (Drizzle + migrasi ketiga): satu baris per prompt di Studio, `brand_id` foreign key dengan cascade. Status generate **tidak disimpan**: diturunkan dari job `post`-nya saat dibaca (pola yang sama dengan status brand), lewat indeks baru `jobs(generation_id)`.
- Tambah **API generations**: `POST /api/generations` (validasi brand `ready`, foto milik brand, 1–3 foto, prompt 1–2000 karakter, rasio `1:1`/`4:5`; membuat generation dan job `post` lewat `dispatchJob` dengan Brand DNA, logo, dan foto terpilih), `GET /api/generations?brandId=` (history, terbaru dulu), `GET /api/generations/:id`, `PATCH /api/generations/:id` (edit caption dan hashtag, hanya setelah post selesai), dan `DELETE /api/generations/:id` (membersihkan history beserta filenya).
- Tambah **result handler `post`** (Nitro plugin) yang menyimpan caption, hashtag, dan gambar hasil ke `generations/<id>/post.<ext>` (tipe dari isi file, bukan dari nama), dan gagal dengan jelas bila gambar bukan gambar atau generation sudah dihapus.
- Ubah **hapus brand** agar ikut membersihkan baris dan folder `generations/<id>/` milik brand itu (sebelumnya hanya `brands/<id>/`), supaya file hasil tidak menjadi yatim.
- Tambah **halaman `/studio`**: composer (brand aktif, textarea prompt, pemilih foto produk maks 3, toggle rasio `1:1`/`4:5` default `4:5`, tombol **Generate Post** dengan label biaya ~$0.04), **Result 1** berupa mockup post Instagram (avatar logo, handle, gambar sesuai rasio, ikon aksi, caption dan hashtag berwarna `--info`), aksi **Copy caption**, **Edit caption** (inline, tersimpan), **Download image**, dan **Regenerate**, progres tahap `Caption → Image` lewat `useJobPolling`, dan kartu gagal dengan pesan ramah serta **Retry**.
- Tambah **History di sidebar** (thumbnail, potongan prompt, waktu, status) untuk brand aktif, yang hanya tampil di `/studio` dan ikut memperbarui dirinya selama ada generate yang berjalan.
- Tambah composable `useGenerations` dan skema bersama `shared/schemas/generation.ts` (DTO dan body request).
- Tambah **unit/HTTP test** (Vitest), termasuk alur mock penuh di level service (generate sampai `completed`, `mock:fail` sampai `failed`), dan smoke test browser di mode mock.
- Perbarui `design.md`: §6 (kolom `generations` untuk post saja sekarang, tanpa `post_job_id`; kolom video datang di change video) dan §7 (tambahan `GET`/`DELETE`).
- **Tidak termasuk**: Result 2 (Video) beserta kolom video, endpoint video, dan UI-nya; mengubah gambar atau memberi reaksi pada caption selain edit teks; auto-post ke Instagram.

## Capabilities

### New Capabilities

- `generation-management`: tabel `generations`, pembuatan generation dan job `post`, validasi input, history, detail, edit caption/hashtag, penghapusan, dan status yang diturunkan dari job.
- `post-result`: result handler `post` yang menyimpan caption, hashtag, dan gambar hasil ke generation.
- `studio-ui`: halaman Studio (composer, mockup Instagram, aksi hasil, Regenerate, Retry, progres) dan history di sidebar.

### Modified Capabilities

- `brand-management`: persyaratan "Delete a brand" diperluas agar ikut menghapus generations milik brand beserta foldernya.

## Impact

- **Kode baru**: `server/db/schema.ts` (+ migrasi ketiga), `server/utils/` (generations, post-result, generation-requests, generation-services), `server/api/generations/**`, `server/plugins/post-result-handler.ts`, `shared/schemas/generation.ts`, `app/composables/useGenerations.ts`, komponen Studio dan history, `app/pages/studio.vue`, `tests/`.
- **Kode berubah**: `server/utils/brands.ts` (`deleteBrand`), `app/components/AppSidebar.vue` (history), `design.md`, `AGENTS.md`.
- **Dependensi**: tidak ada yang baru.
- **Konfigurasi**: tidak ada key baru.
- **Database**: migrasi ketiga (`generations` dan indeks `jobs_generation_idx`), diterapkan otomatis saat server start.
- **Media**: file baru di `data/media/generations/<generationId>/`, disajikan oleh route `/media` yang sudah ada.
- **Sistem eksternal**: tidak ada yang dihubungi saat development lokal. Hasil nyata dari workflow `aladin-post-generate` baru teruji di VPS (change `deploy-to-vps`).
- **Referensi**: `design.md` §4.2 (UX Studio), §6 (tabel dan lokasi file), §7 (API), §8 (kontrak `post`), §9.2 (workflow), Bagian B (design system), Bagian C (change 5).
