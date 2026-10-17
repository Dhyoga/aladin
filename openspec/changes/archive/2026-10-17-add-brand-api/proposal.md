## Why

Brand DNA adalah dasar semua konten: Studio memerlukan brand yang punya DNA, logo, dan foto produk. Pipeline job sudah ada (change `add-job-pipeline`), tetapi belum ada brand yang bisa dibuat, diekstrak, disimpan, atau diunggah asetnya, dan belum ada jalur bagi n8n untuk mengunduh PDF sumber maupun foto produk. Change ini membangun seluruh sisi server untuk brand, sehingga UI (`add-brand-dna-ui`) dan Studio (change berikutnya) dapat dibangun di atas API yang sudah teruji.

Change 3 di `design.md` Bagian C dipecah dua karena backend dan UI berbeda sifat (tes server vs verifikasi browser) dan digabung akan menjadi sekitar 80 task. Backend lebih dulu karena UI bergantung pada kontrak API-nya.

## What Changes

- Tambah tabel **`brands`** dan **`brand_assets`** (Drizzle + migrasi kedua; `brand_assets.brand_id` foreign key dengan cascade).
- Tambah **API brand**: `GET /api/brands` (daftar), `POST /api/brands` (multipart: `source_type` + `url` | `file` | `name`; membuat brand dan, untuk URL/PDF, job `brand_extract` lewat `dispatchJob`), `GET/PATCH/DELETE /api/brands/:id`, dan `POST /api/brands/:id/re-extract`. `PATCH` mengganti seluruh Brand DNA (divalidasi Zod) dan menyamakan `brands.name` dengan `identity.name`; `DELETE` menghapus baris beserta file media-nya.
- Tambah **API aset**: `POST /api/brands/:id/assets` (logo atau foto produk, multipart, JPG/PNG/WebP maksimal 10 MB per file, divalidasi dengan magic bytes, nama file dan path dibuat server), `PATCH` (label/urutan), dan `DELETE`.
- Tambah **`GET /api/internal/assets/:id`**: dipakai n8n untuk mengunduh PDF sumber dan foto/logo; wajib secret dan internal-only (`assertInternalRequest`), menyajikan file lewat `serveMedia`. Digeser dari change `add-job-pipeline`.
- Tambah **result handler `brand_extract`** (Nitro plugin) yang menyimpan Brand DNA hasil ekstraksi, menyamakan nama brand, mengisi `website` dari URL sumber bila kosong, menyimpan logo hasil ekstraksi hanya bila brand belum punya logo, dan menandai brand `ready`.
- **Status brand direkonsiliasi saat dibaca**: brand `extracting` yang job-nya sudah `failed` (gagal dispatch, callback `failed`, payload tidak valid, handler gagal, atau timeout) otomatis menjadi `failed`, dengan pesan error dari job. Sejalan dengan timeout lazy di pipeline, tidak ada hook baru di pipeline.
- Tambah **util penyimpanan media** (`saveMediaFile`, `removeMediaPath`) yang aman terhadap path traversal, plus **validasi tipe file dengan magic bytes** (PNG, JPEG, WebP, PDF) dan parser upload multipart bersama.
- Tambah **skema bersama** `shared/schemas/brand.ts`: DTO list/detail/aset, body `PATCH`, dan konstanta batas (ukuran, jumlah foto, panjang label).
- Tambah **unit/HTTP test** (Vitest), termasuk alur mock penuh di level service (brand dari URL, PDF, dan manual sampai `ready`/`failed`).
- Perbarui `design.md` Bagian C: change 3 dipecah menjadi `add-brand-api` dan `add-brand-dna-ui`, `useJobPolling` digeser ke change UI, nomor change berikutnya bergeser.
- **Tidak termasuk**: halaman `/brand-dna`, komponen UI apa pun, composable client (`useJobPolling`, `useBrands`, `useActiveBrand`), dan tabel `generations`.

## Capabilities

### New Capabilities

- `brand-management`: daftar, pembuatan (URL, PDF, manual), detail, pembaruan DNA, penghapusan, dan ekstraksi ulang brand, beserta aturan nama dan status.
- `brand-extraction`: result handler `brand_extract` dan rekonsiliasi status brand dari job-nya.
- `brand-assets`: unggah, validasi, penyimpanan, label/urutan, dan penghapusan logo dan foto produk.
- `internal-assets`: endpoint unduhan aset untuk n8n (secret, internal-only).
- `media-storage`: penulisan dan penghapusan file di `data/media` secara aman, dan deteksi tipe file dari isinya.

### Modified Capabilities

<!-- Tidak ada. Persyaratan spec yang sudah ada (n8n-callback, job-lifecycle, media-serving, dll.) tidak berubah. -->

## Impact

- **Kode baru**: `server/db/schema.ts` (+ migrasi kedua), `server/utils/` (brands, brand-assets, brand-extraction, file-type, upload, media-storage), `server/api/brands/**`, `server/api/internal/assets/[id].get.ts`, `server/plugins/brand-extract-handler.ts`, `shared/schemas/brand.ts`, `tests/`.
- **Dependensi**: tidak ada yang baru (`nanoid`, `zod`, `h3`, `drizzle-orm` sudah ada).
- **Konfigurasi**: tidak ada key baru. Memakai `mediaDir`, `sharedSecret`, `n8nMode`.
- **Database**: migrasi kedua (`brands`, `brand_assets`), diterapkan otomatis saat server start.
- **Media**: file baru di `data/media/brands/<brandId>/…` (logo, products, source), disajikan oleh route `/media` yang sudah ada.
- **Dokumen**: `design.md` Bagian C dan §7 (tabel API), `AGENTS.md` bila ada yang menyimpang.
- **Sistem eksternal**: tidak ada yang dihubungi saat development lokal. Mode mock menjalankan ekstraksi dengan fixture. Unduhan PDF oleh n8n baru teruji di VPS (change `deploy-to-vps`).
- **Referensi**: `design.md` §4.1 (alur halaman), §5 (Brand DNA), §6 (tabel dan lokasi file), §7 (API), §8 (kontrak `brand_extract`), §10 (validasi upload), Bagian C (change 3).
