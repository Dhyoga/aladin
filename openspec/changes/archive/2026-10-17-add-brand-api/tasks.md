## 1. Skema bersama dan deteksi tipe file

- [x] 1.1 Buat `shared/schemas/brand.ts`: enum (`BRAND_STATUSES`, `BRAND_SOURCE_TYPES`, `ASSET_KINDS`), konstanta batas (`MAX_IMAGE_BYTES` 10 MB, `MAX_PDF_BYTES` 20 MB, `MAX_BRAND_CREATE_REQUEST_BYTES` 21 MB, `MAX_ASSET_UPLOAD_REQUEST_BYTES` 60 MB, `MAX_PRODUCT_PHOTOS` 20, `MAX_LABEL_LENGTH` 60, `MAX_BRAND_NAME_LENGTH` 100), skema `AssetDto`, `ExtractionDto`, `BrandListItem`, `BrandDetail`, body `PatchBrandBody` (`{ dna }`) dan `PatchAssetBody` (`{ label?, sortOrder? }`), serta tipenya
- [x] 1.2 Buat `server/utils/file-type.ts`: `sniffFileType(buffer)` (PNG, JPEG, WebP, PDF dari magic bytes; selain itu `null`), `mimeFor(type)`, `extensionFor(type)` (`jpeg` → `jpg`), dan `isImageType(type)`
- [x] 1.3 Tes `tests/server/file-type.test.ts`: tiap tipe didukung, HTML menyamar, buffer kosong/terlalu pendek, WebP palsu (`RIFF` tanpa `WEBP`), MIME dan ekstensi kanonis
- [x] 1.4 Tes `tests/shared/brand-schemas.test.ts`: `PatchBrandBody` menerima DNA valid dan menolak warna salah, `PatchAssetBody` (label 60 vs 61 karakter, `null`, `sortOrder` negatif/pecahan), dan `BrandDetail` menerima brand tanpa DNA (`dna: null`)
- [x] 1.5 Verifikasi: `pnpm lint && pnpm typecheck && pnpm test` lolos (jalankan semua di Node 22: `nvm use 22`)

## 2. Penyimpanan media dan parser upload

- [x] 2.1 Tambah `saveMediaFile(mediaDir, relPath, data)` dan `removeMediaPath(mediaDir, relPath)` di `server/utils/media-storage.ts`, memakai `resolveMediaPath` untuk path: buat folder induk, timpa bila ada, hapus file atau folder rekursif, abaikan path yang tidak ada, tolak path kosong/`.`/`/` (akar `mediaDir`), dan lempar `MediaPathError` untuk traversal
- [x] 2.2 Buat `server/utils/upload.ts`: `parseUploadParts(parts)` (bagian tanpa filename jadi field teks, bagian dengan filename jadi file `{ name, filename, data }`; nama asli file tidak dipakai untuk path) dan `rejectIfTooLarge(event, maxBytes)` (413 bila `Content-Length` melebihi batas, sebelum body dibaca)
- [x] 2.3 Tes `tests/server/media-storage.test.ts`: menulis path bertingkat, menimpa, traversal (`../`, `a/../../x`, null byte), menghapus file, menghapus folder rekursif tanpa menyentuh saudaranya, path tidak ada, penolakan akar dan `.`
- [x] 2.4 Tes `tests/server/upload.test.ts`: `parseUploadParts` (field vs file, banyak file, file dengan nama berbahaya) dan `rejectIfTooLarge` lewat server `h3` (413 untuk 22 MB, lolos untuk di bawah batas, tanpa `Content-Length`)
- [x] 2.5 Verifikasi: `pnpm lint && pnpm typecheck && pnpm test` lolos

## 3. Tabel brands dan brand_assets

- [x] 3.1 Tambah tabel `brands` dan `brand_assets` ke `server/db/schema.ts` (kolom snake_case, enum bertipe dari `shared/schemas/brand.ts`, `brand_assets.brand_id` foreign key `ON DELETE CASCADE`, indeks `(brand_id, kind, sort_order)`), ekspor tipe `BrandRow` dan `BrandAssetRow`, lalu `pnpm db:generate` untuk migrasi kedua; periksa SQL (foreign key dan indeks)
- [x] 3.2 Perluas `tests/server/helpers.ts` bila perlu (mis. `useTestMedia()` yang membuat folder media sementara) dan tes `tests/server/brand-schema.test.ts`: migrasi membuat kedua tabel, cascade menghapus aset saat brand dihapus, dan foreign key menolak aset untuk brand yang tidak ada
- [x] 3.3 Verifikasi: `pnpm lint && pnpm typecheck && pnpm test` lolos, dan `pnpm dev` menerapkan migrasi kedua

## 4. Service brand

- [x] 4.1 Buat `server/utils/brands.ts` (tanpa auto-import Nitro; dependensi `{ db, mediaDir, dispatch, now }`): pembaca baris brand dengan parse `dna_json` lewat Zod (500 bila rusak), `latestExtractionJob(db, brandId)`, dan `reconcileBrand(db, brand, now)` sesuai design Keputusan 3 (job `failed` → brand `failed` dengan `WHERE status='extracting'`, tanpa job lebih dari 60 detik → `failed`, timeout lewat `getJobWithTimeout`)
- [x] 4.2 Tambah pemetaan DTO: `toAssetDto`, `toBrandListItem`, dan `getBrandDetail` (rekonsiliasi, logo, foto berurut `(sort_order, created_at)`, `extraction` hanya untuk status `extracting`/`failed`)
- [x] 4.3 Tambah `listBrands` (terbaru dulu, rekonsiliasi hanya yang `extracting`, `logoUrl`)
- [x] 4.4 Tambah `createManualBrand` (nama dipangkas 1–100 karakter, DNA awal valid, status `ready`) dan `createUrlBrand` (hanya `http`/`https`, nama = hostname tanpa `www.`, dispatch `{ source_type: 'url', url }` dengan `brandId`)
- [x] 4.5 Tambah `createPdfBrand`: validasi isi `%PDF-` dan ukuran, nama dari nama file (dibersihkan, maksimal 100 karakter, fallback `Untitled brand`), tulis file ke `brands/<brandId>/source/<assetId>.pdf`, transaksi database untuk baris brand + aset `source_pdf` + `source_asset_id` (hapus file bila transaksi gagal), lalu dispatch `{ source_type: 'pdf', pdf_asset_id }`
- [x] 4.6 Tambah `updateBrandDna` (409 saat `extracting`, validasi Zod, ganti seluruh DNA, samakan `name`, status `ready`, `updated_at`), `reExtractBrand` (400 untuk manual, transisi atomik `WHERE status IN ('ready','failed')` untuk 409 pada klik ganda, dispatch dari `source_url` atau aset `source_pdf`, DNA lama tetap tersimpan), dan `deleteBrand` (hapus baris, `removeMediaPath('brands/<id>')`, kegagalan hapus file hanya dicatat di log, job tidak dihapus)
- [x] 4.7 Tes `tests/server/brands.test.ts` (SQLite + folder media sementara, `dispatch` palsu): pembuatan tiga jenis brand (nama default, status, aset PDF, job dengan `brandId`), URL tidak valid, PDF palsu dan terlalu besar, nama manual tidak valid, rekonsiliasi (job gagal, `dispatch_failed`, timeout 5 menit, tanpa job >60 detik vs baru, tetap `extracting` saat job berjalan, idempoten), `getBrandDetail` (urutan foto, `extraction` hanya saat `extracting`/`failed`, DNA rusak → 500), `updateBrandDna` (sukses, sinkron nama, 409, ambil alih brand `failed`), `reExtractBrand` (ready, klik ganda, manual 400, retry PDF memakai aset PDF, DNA lama tetap), `deleteBrand` (cascade, folder terhapus, job tetap ada, kegagalan hapus file tidak menggagalkan)
- [x] 4.8 Verifikasi: `pnpm lint && pnpm typecheck && pnpm test` lolos

## 5. Service aset

- [x] 5.1 Buat `server/utils/brand-assets.ts`: `addBrandAssets(deps, brandId, kind, files)` (validasi semua file dulu: isi gambar valid via `sniffFileType`, ukuran maksimal 10 MB, satu file untuk `logo`, batas 20 foto; semua-atau-tidak), penyimpanan di `brands/<brandId>/logo-<assetId>.<ext>` atau `products/<assetId>.<ext>` dengan `mime` dan ekstensi dari deteksi, `size_bytes`, `sort_order` = maksimum + 1 berurutan, dan penggantian logo (transaksi hapus baris lama + tambah baru, lalu hapus file lama)
- [x] 5.2 Tambah `updateBrandAsset` (hanya `label` dan `sortOrder` yang diberikan; 404 bila bukan milik brand atau `source_pdf`) dan `deleteBrandAsset` (hapus baris dan file; 404 untuk aset brand lain atau `source_pdf`)
- [x] 5.3 Tes `tests/server/brand-assets.test.ts`: unggah banyak foto dan satu logo, banyak file untuk logo ditolak, file menyamar (HTML bernama `.png`), ekstensi mengikuti isi (JPEG bernama `picture.png` → `.jpg`, `image/jpeg`), nama berbahaya tidak masuk path, gambar >10 MB, satu file buruk membatalkan semuanya (tanpa file di disk), batas 20 foto (19+1 lolos, 19+2 ditolak), ganti logo (satu logo, file lama hilang), urutan `sort_order`, patch label (60 vs 61 karakter, `null`) dan `sortOrder`, aset brand lain → 404, hapus foto (baris dan file hilang), `source_pdf` tidak dapat diubah/dihapus
- [x] 5.4 Verifikasi: `pnpm lint && pnpm typecheck && pnpm test` lolos

## 6. Result handler brand_extract

- [x] 6.1 Buat `server/utils/brand-extraction.ts`: `createBrandExtractHandler({ db, mediaDir, now })` sesuai design Keputusan 7 (brand harus ada dan `extracting`, `website` diisi dari `source_url` bila kosong, logo hanya bila belum ada dan valid, logo tidak valid diabaikan dengan peringatan di log, transaksi DNA + nama + status + baris logo, file logo dihapus bila transaksi gagal, melempar error bila brand hilang atau tidak `extracting`)
- [x] 6.2 Buat `server/plugins/brand-extract-handler.ts` yang memanggil `registerJobHandler('brand_extract', …)` dengan `getDb()` dan `useRuntimeConfig().mediaDir`
- [x] 6.3 Tes `tests/server/brand-extraction.test.ts`: lewat `applyJobCallback` nyata dengan handler ini: DNA tersimpan + nama + `ready`, hasil menggantikan DNA lama, website terisi dan website hasil dipertahankan, logo disimpan bila belum ada, logo lama tidak ditimpa, logo bukan gambar diabaikan (brand tetap `ready`), brand dihapus saat berjalan → job `failed` `handler_failed`, brand sudah `ready` → job `failed` dan brand tidak berubah, tidak ada file logo yatim setelah kegagalan
- [x] 6.4 Tes `tests/server/brand-extraction-mock.test.ts` (E2E di level service): klien mock dengan `sleep` instan, registry berisi handler asli, dispatch memakai `startJob`: brand URL dan brand PDF sampai `ready` (nama fixture, logo ada, `website` dari URL), `mock:fail` berakhir `failed` dengan `extraction.error` menyebut `mock:fail`
- [x] 6.5 Verifikasi: `pnpm lint && pnpm typecheck && pnpm test` lolos

## 7. Endpoint HTTP

- [x] 7.1 Buat `server/utils/brand-requests.ts` (import `h3` eksplisit) dengan handler untuk: list, create (multipart; 400/413), get (404), patch (`readValidatedBody` dengan `PatchBrandBody`; 400/409/404), re-extract (400/409/404), delete (204/404), upload aset (413 lewat `Content-Length` 60 MB, 400/404), patch aset, delete aset, dan unduhan internal (`assertInternalRequest` dulu, lalu cari aset, 404 bila baris atau file tidak ada, `serveMedia`); validasi parameter `id` dan `assetId` dengan Zod
- [x] 7.2 Buat `server/utils/brand-services.ts` yang merakit dependensi dari `runtimeConfig` dan `getJobServices()` (`dispatch` = `dispatchJob`), dan berkas route tipis: `server/api/brands/index.get.ts`, `index.post.ts`, `[id].get.ts`, `[id].patch.ts`, `[id].delete.ts`, `[id]/re-extract.post.ts`, `[id]/assets/index.post.ts`, `[id]/assets/[assetId].patch.ts`, `[id]/assets/[assetId].delete.ts`, dan `server/api/internal/assets/[id].get.ts`
- [x] 7.3 Tes HTTP `tests/server/brand-api-http.test.ts` (server `http` nyata, router `h3`, DB dan media sementara, klien mock instan + handler asli): daftar kosong dan terurut, buat brand URL/PDF/manual (201 dan isi detail), kasus 400/413 pembuatan, detail 404 dan DNA rusak 500, patch (200/400/409/404), re-extract (200, klik ganda 409, manual 400), delete (204, file hilang, 404), unggah aset (201, menyamar 400, 413, batas foto), patch dan delete aset, serta `url` aset dapat diambil lewat route `/media` dengan isi yang sama
- [x] 7.4 Tes HTTP `tests/server/internal-assets-http.test.ts`: 401 (salah/kosong/prefix), 404 lewat `X-Forwarded-Host`, 200 PDF dengan `application/pdf` dan byte identik, 206 untuk `Range`, 404 id tidak dikenal dan baris tanpa file; pastikan 401/404-proxy terjadi sebelum query database
- [x] 7.5 Verifikasi: `pnpm lint && pnpm typecheck && pnpm test` lolos

## 8. Dokumen dan verifikasi akhir

- [x] 8.1 Perbarui `design.md` Bagian C: change 3 dipecah menjadi `add-brand-api` (ini) dan `add-brand-dna-ui` (halaman, dialog, kartu dengan mode edit, `useJobPolling`, `useBrands`, `useActiveBrand`, brand switcher); nomor change berikutnya bergeser satu; sesuaikan tabel API §7 (kode status 400/409/413, `re-extract`, `internal/assets`) bila perlu
- [x] 8.2 Perbarui `AGENTS.md`: catatan upload (tipe file dari isi, nama dan path dibuat server, semua-atau-tidak), status brand yang direkonsiliasi saat dibaca (tidak ada hook gagal di pipeline), dan hapus brand tidak menghapus job
- [x] 8.3 Smoke test build: `pnpm build`, lalu `NUXT_SHARED_SECRET=<32+ karakter> pnpm preview` (mock, jeda nyata) dan dengan `curl`: buat brand dari URL lalu poll `GET /api/brands/:id` sampai `ready` (stage berubah `crawling` → `structuring`), buat dari PDF kecil dan dari `mock:fail` (berakhir `failed`), buat manual, patch DNA, unggah logo dan foto lalu ambil lewat `/media`, patch label, re-extract, delete aset dan brand (folder hilang), serta unduhan internal (401 tanpa secret, 404 dengan `X-Forwarded-Host`, 200 dengan secret)
- [x] 8.4 Pastikan migrasi kedua diterapkan pada database baru dari build produksi dan tidak ada panggilan jaringan baru di luar jalur live (`grep` pada `fetch`)
- [x] 8.5 Jalankan `pnpm lint && pnpm typecheck && pnpm test` sampai lolos, periksa tipe `tests/` dengan tsconfig sementara seperti change sebelumnya, lalu `openspec validate add-brand-api`
