## 1. Skema bersama

- [x] 1.1 Buat `shared/schemas/generation.ts`: konstanta batas (`MAX_PROMPT_LENGTH` 2000, `MAX_CAPTION_LENGTH` 2200, `MAX_HASHTAGS` 30, `MAX_HASHTAG_LENGTH` 100, `MAX_GENERATION_PHOTOS` 3, `GENERATION_HISTORY_LIMIT` 100), enum rasio (`1:1`, `4:5`), `CreateGenerationBody`, `PatchGenerationBody`, `normalizeHashtags(list)` (murni: pangkas, satu `#` di depan, tolak spasi dan panjang >100, buang duplikat tanpa memperhatikan huruf besar), serta DTO `GenerationDetail` dan `GenerationListItem` (status `running` | `completed` | `failed`)
- [x] 1.2 Tes `tests/shared/generation-schemas.test.ts`: body create (prompt 2000 vs 2001, kosong/spasi, rasio salah, 0/1/3/4 foto, duplikat), body patch (caption 2200 vs 2201, kosong, body kosong valid), `normalizeHashtags` (`promo`, `#Promo`, `##baru`, spasi, terlalu panjang, lebih dari 30, urutan dipertahankan), DTO menerima generation yang belum selesai (caption/imageUrl `null`)
- [x] 1.3 Verifikasi: `pnpm lint && pnpm typecheck && pnpm test` lolos (semua di Node 22: `nvm use 22`)

## 2. Tabel generations

- [x] 2.1 Tambah tabel `generations` ke `server/db/schema.ts` (kolom snake_case, `brand_id` foreign key `ON DELETE CASCADE`, indeks `(brand_id, created_at)`, rasio bertipe enum) dan indeks `jobs_generation_idx (generation_id, created_at)` pada `jobs`; ekspor `GenerationRow`; `pnpm db:generate` untuk migrasi ketiga; periksa SQL
- [x] 2.2 Tes `tests/server/generation-schema.test.ts`: migrasi membuat tabel dan kedua indeks, cascade menghapus generation saat brand dihapus (hanya miliknya), foreign key menolak generation untuk brand yang tidak ada
- [x] 2.3 Verifikasi: `pnpm lint && pnpm typecheck && pnpm test` lolos, dan `pnpm dev` menerapkan migrasi ketiga

## 3. Service generations

- [x] 3.1 Buat `server/utils/generation-errors.ts` (`GenerationError` dengan kind `not_found` | `invalid` | `conflict` | `corrupt` dan peta status HTTP)
- [x] 3.2 Buat `server/utils/generations.ts` (tanpa auto-import Nitro; dependensi `{ db, mediaDir, dispatch, now }`): `latestPostJob`, `deriveStatus(generation, job, now)` murni sesuai tabel di design Keputusan 1 (termasuk tanpa job lama/baru dan timeout lewat `getJobWithTimeout`, tanpa menulis ke `generations`), pembaca baris dengan parse `asset_ids_json` dan `hashtags_json` lewat Zod (`corrupt` bila rusak), serta pemetaan DTO (`imageUrl`, `jobId`)
- [x] 3.3 Tambah `createGeneration`: validasi sesuai spec (brand ada, setelah `reconcileBrand` harus `ready` dengan DNA, prompt, rasio, 1–3 foto unik milik brand dan bertipe `product_photo`), buat baris, rakit input (`brand_dna`, `prompt`, `aspect_ratio`, aset logo lalu foto terpilih dengan `{ id, kind, mime, label }`), `dispatch({ type: 'post', brandId, generationId, input })`, kembalikan detail; tidak membuat apa pun bila validasi gagal
- [x] 3.4 Tambah `listGenerations` (wajib `brandId`, terbaru dulu, maksimal 100, status turunan hanya membaca job untuk baris tanpa `image_path`), `getGeneration`, `patchGeneration` (hanya `completed`, normalisasi hashtag, body kosong tidak mengubah apa pun), dan `deleteGeneration` (hapus baris, `removeMediaPath('generations/<id>')`, kegagalan hapus file hanya dicatat, job tidak dihapus)
- [x] 3.5 Ubah `deleteBrand` di `server/utils/brands.ts`: baca id generation milik brand sebelum menghapus baris, lalu hapus folder `generations/<id>/` masing-masing bersama `brands/<id>/` (kegagalan hanya dicatat)
- [x] 3.6 Tes `tests/server/generations.test.ts` (SQLite + media sementara, `dispatch` palsu): semua penolakan create (prompt, rasio, jumlah foto, duplikat, foto brand lain/logo/id tidak ada, brand tidak ada, brand `extracting`/`failed`) tanpa baris dan tanpa job; input yang dikirim (isi, urutan aset dengan dan tanpa logo, label); dispatch gagal menghasilkan `failed` `dispatch_failed…`; semua baris tabel status turunan (running dengan stage, failed dengan error, timeout 5 menit, tanpa job >60 detik dan <60 detik); list (urutan, lingkup brand, batas 100, `brandId` wajib); get 404 dan JSON rusak → `corrupt`; patch (sukses, hashtag dinormalisasi dan dideduplikasi, hashtag berspasi ditolak, caption 2200 vs 2201/kosong, 409 saat belum selesai, body kosong); delete (baris, folder, job tetap ada, kegagalan hapus file tidak menggagalkan, 404); `deleteBrand` membersihkan generation dan foldernya tanpa menyentuh brand lain
- [x] 3.7 Verifikasi: `pnpm lint && pnpm typecheck && pnpm test` lolos

## 4. Result handler post

- [x] 4.1 Buat `server/utils/post-result.ts`: `createPostResultHandler({ db, mediaDir, now })` sesuai design Keputusan 4 (generation harus ada, gambar divalidasi `sniffFileType` PNG/JPEG/WebP, ekstensi dari isi, tulis file lalu perbarui baris `WHERE id = ?`, hapus file dan lempar error bila tidak ada baris yang berubah, hapus file lama berekstensi berbeda)
- [x] 4.2 Buat `server/plugins/post-result-handler.ts` yang memanggil `registerJobHandler('post', …)` dengan `getDb()` dan `useRuntimeConfig().mediaDir`
- [x] 4.3 Tes `tests/server/post-result.test.ts` lewat `applyJobCallback` nyata: caption/hashtag/gambar tersimpan dan job `completed`, ekstensi mengikuti isi (PNG, JPEG, WebP), gambar bukan gambar → job `failed` `handler_failed` tanpa perubahan dan tanpa file, generation dihapus saat berjalan → `failed` tanpa file yatim, job tanpa generation → `failed`, generation yang sama diproses ulang dengan ekstensi lain tidak meninggalkan file lama
- [x] 4.4 Tes `tests/server/post-result-mock.test.ts` (E2E level service, klien mock dengan `sleep` instan dan handler asli): generate sampai `completed` (caption fixture, gambar PNG tersimpan) dan prompt `mock:fail` berakhir `failed` dengan `error` menyebut `mock:fail`; tidak ada panggilan jaringan
- [x] 4.5 Verifikasi: `pnpm lint && pnpm typecheck && pnpm test` lolos

## 5. Endpoint HTTP

- [x] 5.1 Buat `server/utils/generation-requests.ts` (import `h3` eksplisit) dengan handler list (`getValidatedQuery`, `brandId` wajib), create (`readValidatedBody`, 201), get, patch, dan delete (204), memetakan `GenerationError` ke status HTTP (pesan di `message`); `server/utils/generation-services.ts` yang merakit dependensi dari `runtimeConfig` dan `dispatchJob`; berkas route tipis `server/api/generations/index.get.ts`, `index.post.ts`, `[id].get.ts`, `[id].patch.ts`, `[id].delete.ts`
- [x] 5.2 Perluas harness tes HTTP (`tests/server/brand-api-harness.ts` atau berkas harness bersama) agar memasang route generations, dengan pilihan klien mock nyata untuk alur penuh
- [x] 5.3 Tes HTTP `tests/server/generation-api-http.test.ts` (server `http` nyata): create 201 beserta isi, semua 400/404/409, `message` ada pada body error, list (urutan, lingkup, `brandId` wajib), get, patch (200/400/409/404), delete (204, folder hilang, 404), `imageUrl` dapat diambil lewat `/media` dengan isi sama, dan alur mock penuh sampai `completed` dan `failed`
- [x] 5.4 Verifikasi: `pnpm lint && pnpm typecheck && pnpm test` lolos

## 6. Composable dan util klien

- [x] 6.1 Buat `app/composables/useGenerations.ts`: state bersama (`useState`) untuk daftar history brand aktif dan generation terpilih, fungsi `loadHistory(brandId)`, `createGeneration`, `getGeneration`, `patchGeneration`, `deleteGeneration`, `regenerate(source, brandPhotoIds)`; setiap respons di-parse dengan Zod dari `shared/schemas/generation.ts`
- [x] 6.2 Buat util murni `app/utils/studio.ts`: `captionToClipboard(caption, hashtags)`, `downloadName(brandName, generationId, imageUrl)` (slug aman, ekstensi dari URL), `regeneratePhotoIds(sourceIds, currentPhotoIds)` (menyaring id basi, kembali ke foto pertama bila kosong), `timeAgo(ms, now)`
- [x] 6.3 Tes `tests/app/studio-utils.test.ts` untuk keempat fungsi (termasuk nama brand dengan karakter aneh, id basi semua, daftar foto kosong)
- [x] 6.4 Verifikasi: `pnpm lint && pnpm typecheck && pnpm test` lolos

## 7. Komponen dan halaman Studio

- [x] 7.1 Buat `InstagramPostMockup.vue` (kartu `#000`, avatar 32px logo atau inisial, handle, gambar sesuai rasio, baris ikon, caption 14px, hashtag warna `--info`; judul "This is what your followers will see")
- [x] 7.2 Buat `StudioComposer.vue` (baris "CREATE WITH" dengan pemilih brand `<select>` untuk brand `ready`, textarea prompt dengan draf tersimpan di `useState`, pemilih foto maks 3 dengan foto pertama terpilih dan pesan batas, toggle rasio default `4:5`, tombol **Generate Post** dengan lencana `~$0.04` nonaktif saat prompt kosong, tanpa foto, atau request berjalan, dan pesan kesalahan inline)
- [x] 7.3 Buat `PostResult.vue`: placeholder dengan proporsi rasio dan langkah `Caption` → `Image` saat `running` (`useJobPolling` 2 detik, memuat ulang generation dan history saat job final), mockup dengan aksi saat `completed` (Copy caption memakai `useClipboard` dengan konfirmasi singkat, Edit caption inline dengan Simpan/Batal dan validasi 1–2200, Download image, Regenerate), serta kartu gagal ramah dengan alasan dan **Retry**
- [x] 7.4 Buat `StudioHistory.vue` dan tampilkan di `AppSidebar.vue` hanya pada `/studio` (thumbnail atau ikon progres/gagal, potongan prompt, waktu relatif, status; klik memilih dan menutup drawer di layar kecil; hapus dengan `ConfirmDialog`; kosongkan hasil bila yang terpilih dihapus)
- [x] 7.5 Ganti stub `app/pages/studio.vue`: keadaan kosong (tanpa brand, tanpa brand aktif, brand tanpa foto), komposisi composer + hasil, muat history saat brand aktif berganti, perbarui daftar tiap 3 detik selama ada item `running` (satu pemilik polling), pilih generation yang baru dibuat; lebar maksimum 720px, tanpa scroll horizontal di 375px
- [x] 7.6 Verifikasi: `pnpm lint && pnpm typecheck && pnpm test` lolos (copy UI berbahasa Inggris; tanpa `any`; ikon dari `@lucide/vue`)

## 8. Dokumen dan verifikasi akhir

- [x] 8.1 Perbarui `design.md`: §6 (kolom `generations` untuk post saja, tanpa `post_job_id`/`video_job_id` karena `jobs.generation_id` sudah menghubungkan; kolom video ditambah di change video) dan §7 (tambahan `GET /api/generations/:id` dan `DELETE /api/generations/:id`, kode status, batas)
- [x] 8.2 Perbarui `AGENTS.md`: konvensi generations (status turunan dari job, tanpa kolom status, `GenerationError`), `deleteBrand` juga membersihkan `generations/`, dan history Studio dimiliki halaman Studio
- [x] 8.3 Smoke test build: `pnpm build`, lalu `NUXT_SHARED_SECRET=<32+ karakter> pnpm preview` (mock, jeda nyata) dan dengan `curl`: buat brand manual, unggah foto, buat generation lalu poll `GET /api/generations/:id` sampai `completed` (stage `caption` → `image`), ambil `imageUrl` lewat `/media`, patch caption dan hashtag, buat dengan `mock:fail` (berakhir `failed`), daftar history, hapus generation (folder hilang), hapus brand (folder `generations/` hilang), dan semua penolakan (400/404/409)
- [x] 8.4 Smoke test browser (Chromium + Playwright, di dev server dan build produksi, mock): prompt → progres → mockup, copy, edit caption tersimpan setelah reload, download, regenerate, `mock:fail` → Retry, history (pilih, update langsung, hapus), ganti brand, keadaan kosong, tanpa error console, tanpa request eksternal, dan tanpa scroll horizontal di 375px
- [x] 8.5 Pastikan migrasi ketiga diterapkan pada database baru dari build produksi, tidak ada panggilan jaringan baru di luar jalur live (`grep` pada `fetch`), dan `main.css` serta `ui/button/index.ts` tetap utuh bila ada komponen shadcn yang ditambah
- [x] 8.6 Jalankan `pnpm lint && pnpm typecheck && pnpm test` sampai lolos, periksa tipe `tests/` dengan tsconfig sementara seperti change sebelumnya, lalu `openspec validate add-post-generation`
