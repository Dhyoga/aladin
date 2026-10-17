## Context

Yang sudah ada: fondasi (config, SQLite + Drizzle, `/media` dengan Range), pipeline job (`jobs`, `dispatchJob`, callback, registry result handler, mock mode dengan fixture, timeout lazy), skema Zod `BrandDNA`, dan helper `assertInternalRequest`. Belum ada tabel brand maupun jalur upload.

Batasan yang membentuk keputusan:

- Semua file media di `data/media` (`design.md` root §6), diserahkan lewat `/media`. Nama file dan path dibuat server, tidak pernah dari input user.
- n8n yang mengunduh PDF/foto (bukan app yang mengirimnya), jadi perlu endpoint unduhan internal.
- Hasil ekstraksi tiba lewat callback ke result handler yang didaftarkan fitur (kontrak dari `add-job-pipeline`).
- Satu proses Nitro dengan SQLite satu penulis; `readMultipartFormData` memuat seluruh file ke memori.
- Lokal tidak pernah menghubungi n8n. Mock harus bisa menjalankan seluruh alur brand sampai `ready`/`failed`.

## Goals / Non-Goals

**Goals:**

- API brand dan aset lengkap, dengan validasi ketat atas upload.
- Status brand yang selalu benar tanpa mengubah pipeline job, termasuk saat dispatch gagal, n8n gagal, atau timeout.
- Hasil ekstraksi tersimpan konsisten (DNA, nama, logo) dan tidak menimpa pekerjaan user tanpa sengaja.
- Teruji end-to-end di level service/HTTP dengan mock, tanpa UI.

**Non-Goals:**

- Halaman, komponen, dan composable client (`add-brand-dna-ui`).
- Tabel `generations` dan API Studio.
- Pemrosesan gambar (resize, thumbnail). File disajikan apa adanya.
- Pembersihan file yatim akibat crash di tengah operasi (dicatat sebagai risiko).

## Decisions

### 1. Service murni + handler HTTP yang dapat diuji

Mengikuti pola change sebelumnya: logika ditulis sebagai fungsi yang menerima dependensinya (`db`, `mediaDir`, `dispatch`, `now`) dengan import `h3`/`node:*` eksplisit, bukan auto-import Nitro. Berkas route tipis memanggil handler dari `brand-requests.ts`, yang dirakit oleh `brand-services.ts` dari `runtimeConfig`. Tes memasang handler yang sama ke router `h3` pada server `http` sungguhan dengan DB dan folder media sementara.

```
shared/schemas/brand.ts          DTO, body PATCH, batas ukuran/jumlah, enum
server/db/schema.ts              + brands, brand_assets
server/utils/file-type.ts        sniffFileType (png/jpeg/webp/pdf dari magic bytes)
server/utils/media-storage.ts    saveMediaFile, removeMediaPath (aman path)
server/utils/upload.ts           parseUploadParts, rejectIfTooLarge
server/utils/brands.ts           repository + service brand (+ rekonsiliasi status)
server/utils/brand-assets.ts     service aset (logo, foto, label, hapus)
server/utils/brand-extraction.ts createBrandExtractHandler (result handler)
server/utils/brand-requests.ts   handler HTTP semua endpoint brand + internal asset
server/utils/brand-services.ts   perakit dependensi dari runtimeConfig (adapter)
server/plugins/brand-extract-handler.ts   registerJobHandler('brand_extract', …)
server/api/brands/**, server/api/internal/assets/[id].get.ts   (tipis)
```

*Alternatif*: satu file route besar per endpoint berisi logika. Ditolak: tidak bisa diuji tanpa Nitro dan menyalahi pola yang sudah dipakai.

### 2. Skema tabel

`brands` sesuai `design.md` §6: `id` (`brd_` + nanoid), `name`, `source_type`, `source_url`, `source_asset_id`, `dna_json`, `status`, `created_at`, `updated_at`. `brand_assets`: `id` (`ast_` + nanoid), `brand_id` (**foreign key `ON DELETE CASCADE`**, `foreign_keys` sudah aktif), `kind`, `path`, `mime`, `size_bytes`, `label`, `sort_order`, `created_at`, dengan indeks `(brand_id, kind, sort_order)`. `brands.source_asset_id` adalah kolom biasa tanpa foreign key (menghindari referensi melingkar). `jobs` tetap tanpa foreign key ke brand.

### 3. Status brand direkonsiliasi saat dibaca

Pipeline job tidak punya hook gagal, dan kegagalan bisa datang dari banyak jalur: dispatch gagal, callback `failed`, `invalid_payload`, `handler_failed`, `no_result_handler`, dan timeout lazy. Daripada menambah hook di tiap jalur, status brand diturunkan dari job-nya saat dibaca (pola yang sama dengan timeout lazy):

1. Brand berstatus `extracting` → ambil job `brand_extract` terbaru untuk `brand_id` itu (urut `created_at` turun).
2. Baca lewat `getJobWithTimeout` (sehingga timeout ikut berlaku). Bila job `failed`, ubah brand menjadi `failed` dengan `UPDATE … WHERE status = 'extracting'`.
3. Brand `extracting` tanpa job sama sekali dan lebih tua dari 60 detik (proses mati di antara pembuatan brand dan job) → `failed`.

DTO detail memuat `extraction: { jobId, status, stage, error } | null` dari job terbaru untuk brand `extracting` dan `failed`, sehingga UI dapat menampilkan tahap dan pesan error tanpa kolom error baru. Daftar brand merekonsiliasi hanya brand `extracting`.

Urutan pembuatan brand lalu job dilakukan tanpa `await` di antaranya (insert brand sinkron, lalu `startJob` yang langsung `createJob` sinkron), jadi tidak ada jendela di mana brand `extracting` terbaca tanpa job pada proses yang sehat.

### 4. Pembuatan brand

`POST /api/brands` (multipart), `source_type`:

- `url`: `url` wajib, hanya `http`/`https`. Nama awal = hostname tanpa `www.`. `source_url` disimpan. Dispatch `{ source_type: 'url', url }`.
- `pdf`: `file` wajib, maksimal 20 MB, isi harus diawali `%PDF-`. File disimpan sebagai aset `source_pdf` di `brands/<brandId>/source/<assetId>.pdf`, `brands.source_asset_id` diisi. Nama awal = nama file asli tanpa ekstensi (dibersihkan dari karakter kontrol, maksimal 100 karakter, fallback `Untitled brand`). Dispatch `{ source_type: 'pdf', pdf_asset_id }`.
- `manual`: `name` wajib (1–100 karakter). Status langsung `ready` dengan DNA awal: nama terisi, field teks wajib berupa string kosong, daftar kosong.

Baris brand dan aset PDF dibuat dalam satu transaksi database; file ditulis sebelum commit dan dihapus bila transaksi gagal. Respons 201 berisi detail brand lengkap (termasuk job ekstraksi yang baru jalan).

*Catatan*: validasi URL hanya memastikan skema. n8n yang mengambil halaman, bukan app, dan tool ini di belakang BasicAuth, jadi tidak ada SSRF dari sisi app.

### 5. Ekstraksi ulang dan pembaruan DNA

- `POST /:id/re-extract`: ditolak 400 untuk brand `manual`. Brand harus `ready` atau `failed`; transisi `UPDATE … SET status='extracting' WHERE status IN ('ready','failed')` menentukan pemenang, sehingga klik ganda menghasilkan 409 pada klik kedua. Lalu `dispatchJob` dari sumber yang sama. DNA lama **tidak dihapus** selama ekstraksi, agar kegagalan tidak membuang data; DNA baru menggantikan seluruhnya saat selesai.
- `PATCH /:id` dengan `{ dna: BrandDNA }`: ditolak 409 saat `extracting`. Selain itu, mengganti seluruh DNA, menyamakan `brands.name` dengan `identity.name`, dan menjadikan status `ready`. Artinya brand `failed` bisa "diambil alih" user dengan mengisi DNA sendiri.
- Penyimpanan DNA: `dna_json` divalidasi Zod saat tulis. Saat baca yang tidak lolos Zod, request gagal 500 dengan pesan jelas (data rusak tidak boleh diam-diam diteruskan).

### 6. Aset: validasi, penyimpanan, batas

- **Tipe dari isi, bukan dari klien**: `sniffFileType` membaca magic bytes (PNG `89 50 4E 47`, JPEG `FF D8 FF`, WebP `RIFF….WEBP`, PDF `%PDF-`). MIME dan ekstensi yang dikirim klien diabaikan; `mime` dan ekstensi file disimpan dari hasil deteksi. Nama file dibuat server.
- **Path** (`design.md` §6): logo `brands/<brandId>/logo-<assetId>.<ext>`, foto `brands/<brandId>/products/<assetId>.<ext>`, PDF `brands/<brandId>/source/<assetId>.pdf`.
- **Batas**: gambar 10 MB per file, PDF 20 MB, maksimal 20 foto produk per brand, label maksimal 60 karakter, total request upload aset 60 MB, request pembuatan brand 21 MB (dicek lewat `Content-Length` sebelum body dibaca, dan ukuran sebenarnya setelah dibaca; 413 bila melebihi).
- **Semua-atau-tidak**: pada unggah banyak file, semua file divalidasi (tipe, ukuran) dan batas jumlah dicek dulu; satu file tidak valid membatalkan seluruh request (400) tanpa menyimpan apa pun.
- **Logo tunggal**: unggah logo baru menyimpan file baru, lalu dalam satu transaksi menghapus baris logo lama dan menambah yang baru, dan terakhir menghapus file lama.
- **Urutan**: `sort_order` terisi `max + 1` per brand dan jenis. `PATCH` menetapkan `sortOrder` yang diberikan tanpa menomori ulang; daftar diurut `(sort_order, created_at)`.
- Aset `source_pdf` tidak dapat diubah atau dihapus lewat API aset; ia ikut terhapus bersama brand.

### 7. Result handler `brand_extract`

Dibuat oleh `createBrandExtractHandler({ db, mediaDir, now })` dan didaftarkan Nitro plugin lewat `registerJobHandler`. Pada `onCompleted`:

1. `job.brandId` harus ada dan brand harus ditemukan; bila tidak, melempar error (pipeline menandai job `failed` dengan `handler_failed`). Ini juga menangani brand yang dihapus saat job berjalan.
2. Bila `identity.website` kosong dan brand punya `source_url`, `website` diisi dari URL sumber.
3. Logo hasil ekstraksi hanya disimpan bila brand **belum punya logo** (tidak menimpa unggahan user) dan isinya gambar valid; logo yang bukan gambar diabaikan dengan peringatan di log, tidak menggagalkan ekstraksi. Logo di atas 10 MB tidak pernah sampai ke handler: batas file `logo` di callback pipeline sudah menolaknya (`invalid_payload`), jadi pemeriksaan ukuran di handler hanya lapisan kedua.
4. Dalam satu transaksi: ganti `dna_json`, samakan `name` dengan `identity.name`, set status `ready` hanya bila status masih `extracting` (`WHERE status='extracting'`; jika tidak ada baris yang berubah, melempar error), dan sisipkan baris logo bila ada. File logo ditulis sebelum commit dan dihapus bila transaksi gagal.

### 8. Penghapusan brand

Baris `brands` dihapus (aset ikut lewat cascade), lalu folder `brands/<brandId>/` dihapus dengan `removeMediaPath`. Kegagalan menghapus file dicatat di log tetapi tidak menggagalkan request (data sudah hilang dari DB; file yatim lebih baik daripada brand yang tidak bisa dihapus). Job milik brand tidak dihapus. Job yang masih berjalan akan berakhir `failed` (`handler_failed: brand not found`) saat callback tiba.

### 9. Endpoint unduhan internal

`GET /api/internal/assets/:id`: `assertInternalRequest` (404 lewat proxy, 401 tanpa secret), cari aset berdasarkan id (semua jenis: PDF sumber, logo, foto), 404 bila tidak ada, lalu `serveMedia(event, mediaDir, asset.path)` sehingga Content-Type, Content-Length, dan Range konsisten dengan `/media`. n8n memakai `asset_base_url` yang sudah dibangun pipeline.

### 10. DTO dan URL

DTO ada di `shared/schemas/brand.ts` (camelCase, dipakai client dan server): `BrandListItem { id, name, status, sourceType, logoUrl, updatedAt }`, `AssetDto { id, kind, url, mime, sizeBytes, label, sortOrder }`, dan `BrandDetail { id, name, status, sourceType, sourceUrl, dna, logo, photos, extraction, createdAt, updatedAt }`. `url` aset adalah `/media/<path>`. Daftar brand diurut `created_at` turun.

### 11. Strategi pengujian

- Unit: `sniffFileType`, `media-storage` (traversal, penulisan, penghapusan rekursif), `parseUploadParts`.
- Service dengan SQLite + folder media sementara: pembuatan tiga jenis brand, rekonsiliasi (job gagal, timeout, tanpa job), PATCH, re-extract (409 ganda, manual 400), hapus (cascade + file), aset (logo diganti, batas jumlah, semua-atau-tidak, label/urutan).
- Result handler: DNA tersimpan, nama disamakan, website terisi, logo hanya bila belum ada, logo tidak valid diabaikan, brand tidak ada → error.
- HTTP (server `http` nyata): semua endpoint, kode status, `multipart` sungguhan, 413, internal assets (401/404/200/Range).
- E2E mock di level service: brand dari URL dan dari PDF sampai `ready` (klien mock dengan `sleep` instan dan handler asli), dan `mock:fail` sampai `failed` dengan pesan.
- Smoke test `pnpm preview` dengan `curl` pada mock sungguhan (jeda nyata ±4 detik).

### 12. Pemecahan change 3

`design.md` Bagian C diubah: change 3 menjadi `add-brand-api` (ini) lalu `add-brand-dna-ui` (halaman, dialog, kartu dengan mode edit, `useJobPolling`, `useBrands`, `useActiveBrand`, brand switcher); change berikutnya bergeser satu nomor. Pemecahan ini murni soal ukuran dan jenis verifikasi, bukan perubahan ruang lingkup produk.

## Risks / Trade-offs

- **[File yatim bila proses mati di antara tulis file dan commit]** → File ditulis sebelum commit dan dibersihkan pada kegagalan yang tertangkap; crash keras bisa meninggalkan file yang tidak direferensikan. Dapat diterima untuk tool internal; pembersihan berkala dicatat sebagai pekerjaan masa depan.
- **[GET menulis ke DB (rekonsiliasi)]** → Hanya mengubah `extracting` → `failed` secara guarded dan idempoten; konsisten dengan timeout lazy yang sudah ada.
- **[Ekstraksi ulang menimpa seluruh DNA, termasuk edit user]** → Disengaja (`design.md` §4.1); konfirmasi dilakukan di UI (change berikutnya). DNA lama tetap ada sampai hasil baru sukses.
- **[Batas 20 foto adalah angka usulan]** → Konstanta di satu tempat (`shared/schemas/brand.ts`), mudah diubah.
- **[Memori saat upload]** → `readMultipartFormData` memuat file ke memori; dibatasi 10 MB per gambar, 20 MB PDF, dan total request, aman untuk skala ini.
- **[Magic bytes bukan jaminan konten aman]** → Cukup untuk menolak file yang menyamar (mis. HTML bernama `.png`); file disajikan dengan `Content-Type` dari deteksi, `nosniff`, dan dari origin yang sama di belakang BasicAuth.
- **[Hapus brand saat job berjalan]** → Job berakhir `failed` saat callback; tidak ada kerusakan data.
- **[Mode live (n8n mengunduh PDF) belum teruji]** → Endpoint internal diuji lengkap (secret, proxy, Range), tetapi pengunduhan nyata oleh n8n baru teruji di VPS.

## Migration Plan

1. Tambah tabel ke `server/db/schema.ts`, lalu `pnpm db:generate` menghasilkan migrasi kedua; migrator yang ada menerapkannya saat start. Smoke test `pnpm build && pnpm preview` memastikan folder migrasi terbaca.
2. Tidak ada rollback data: tabel baru dan belum ada data produksi. Mengembalikan change cukup dengan menghapus migrasi sebelum dipakai di lingkungan mana pun.

## Open Questions

Tidak ada yang menghalangi. Angka batas (20 foto, 60 karakter label, 100 karakter nama) bersifat usulan dan dapat disesuaikan saat UI dibangun.
