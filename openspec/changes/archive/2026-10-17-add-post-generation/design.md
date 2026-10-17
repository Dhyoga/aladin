## Context

Sudah ada: pipeline job (`dispatchJob`, callback, registry result handler, mock dengan fixture post), API brand dengan aset dan endpoint unduhan internal, brand aktif (`useActiveBrand`, cookie `last_brand_id`), polling (`useJobPolling`), route `/media`, dan stub `/studio`. Skenario mock `post` sudah ada: tahap `caption` → `image` → `completed` dengan fixture `post.json` dan `post.png`. Kontrak n8n untuk `post` (request dan payload `completed`) sudah didefinisikan dan teruji.

Konteks yang membentuk keputusan:

- Jalur kegagalan sebuah job banyak (dispatch, callback `failed`, payload tidak valid, handler, timeout) dan pipeline tidak punya hook gagal. Status brand sudah diselesaikan dengan menurunkannya dari job saat dibaca. Generation mengikuti pola yang sama.
- Hasil harus tersimpan di filesystem, dengan tipe file dari isinya dan path buatan server.
- Satu proses Nitro, SQLite satu penulis. Tool internal di belakang BasicAuth, tanpa auth di app.
- Video (change berikutnya) memakai tabel dan pola yang sama, jadi bentuknya harus bisa diperluas tanpa membongkar.

## Goals / Non-Goals

**Goals:**

- Alur Post lengkap di mode mock: prompt → progres → mockup → copy/edit/download/regenerate, dan jalur gagal dengan Retry.
- Status generation yang selalu benar tanpa mengubah pipeline.
- Tidak ada file yatim: hapus generation dan hapus brand membersihkan filenya.
- Input yang divalidasi di server (foto milik brand, batas jumlah, brand siap), karena request ini membakar biaya API.

**Non-Goals:**

- Video, storyboard, dan kolom-kolomnya. Edit gambar. Reaksi selain edit teks. Auto-post.
- Rate limiting atau batas anggaran (dicatat sebagai risiko).
- Mengubah workflow n8n.

## Decisions

### 1. Status diturunkan dari job, tanpa kolom status dan tanpa `post_job_id`

`design.md` §6 memuat `post_job_id` dan `video_job_id` di `generations`. Kolom itu **dibuang**: `jobs.generation_id` sudah menghubungkan keduanya, dan menyimpan id job di dua tempat membuat dua sumber kebenaran serta jendela waktu di mana generation sudah ada tetapi `post_job_id` belum terisi (job dibuat di dalam `dispatchJob`, callback bisa datang sebelum baris generation diperbarui). Generation mencari job `post` terbarunya lewat `generation_id`, dengan indeks baru `jobs_generation_idx (generation_id, created_at)`.

Status yang dilihat user:

| Job `post` | Status generation |
|---|---|
| `queued`, `running` | `running` (dengan `stage`) |
| `completed` | `completed` |
| `failed` | `failed` (dengan `error`) |
| tidak ada, dan generation lebih dari 60 detik | `failed` (`The generation did not start.`) |
| tidak ada, belum 60 detik | `running` |

Pembacaan memakai `getJobWithTimeout`, sehingga timeout 5 menit ikut berlaku. Tidak ada penulisan ke tabel `generations` saat membaca (berbeda dengan brand), karena tidak ada status yang disimpan.

*Alternatif*: kolom `status` di `generations` yang direkonsiliasi. Ditolak: butuh penulisan saat baca dan satu tempat lagi yang bisa tidak sinkron.

### 2. Skema tabel

`generations`: `id` (`gen_` + nanoid 12), `brand_id` (foreign key `ON DELETE CASCADE`), `prompt`, `aspect_ratio` (`1:1` | `4:5`), `asset_ids_json` (JSON array id foto, divalidasi Zod saat baca), `caption`, `hashtags_json`, `image_path` (relatif `mediaDir`), `created_at`, `updated_at`; indeks `(brand_id, created_at)`. Kolom video ditambahkan oleh change video lewat `ALTER TABLE … ADD COLUMN` (SQLite mendukungnya). `design.md` §6 diperbarui sesuai.

`asset_ids_json` menyimpan id foto yang dipilih saat itu. Bila fotonya kemudian dihapus, id itu menjadi basi: tidak berbahaya untuk history (thumbnail memakai `image_path`), dan UI Regenerate menyaringnya terhadap foto brand yang masih ada.

### 3. Membuat generation

`POST /api/generations` dengan body JSON `{ brandId, prompt, aspectRatio, assetIds }` (`readValidatedBody` + Zod). Urutan di service:

1. Brand harus ada (404), setelah `reconcileBrand` harus `ready` dan punya DNA (409 `The Brand DNA is not ready yet`).
2. `assetIds`: 1 sampai 3 id unik. Semuanya harus foto produk milik brand itu (400 `One of the photos does not belong to this brand`). Minimal satu foto: tanpa foto, model bisa mengarang produk, yang justru dihindari desain (§5.1 "produk asli yang muncul"). Brand tanpa foto diarahkan UI ke halaman Brand DNA.
3. Prompt dipangkas dan harus 1–2000 karakter (kontrak n8n).
4. Baris generation dibuat, lalu `dispatchJob({ type: 'post', brandId, generationId, input })`. Input: `brand_dna`, `prompt`, `aspect_ratio`, dan `assets` = logo brand (bila ada) lalu foto terpilih, masing-masing `{ id, kind, mime, label }`. Total maksimal 4 (logo + 3 foto), sesuai kontrak.
5. Respons 201 dengan detail, termasuk status dari job yang baru berjalan. Bila n8n menolak saat dispatch, generation tetap ada dengan status `failed` (`dispatch_failed…`) supaya user melihat dan bisa Retry.

*Catatan biaya*: tombol dinonaktifkan selama request berjalan; tidak ada batas server. Dicatat di risiko.

### 4. Result handler `post`

`createPostResultHandler({ db, mediaDir, now })`, didaftarkan Nitro plugin lewat `registerJobHandler('post', …)`. Pada `onCompleted`:

1. `job.generationId` harus ada dan generation harus ditemukan; bila tidak (mis. dihapus saat berjalan), melempar error, sehingga job menjadi `failed` dengan `handler_failed`.
2. Berkas `image` wajib (sudah dijamin pipeline) dan isinya harus gambar PNG/JPEG/WebP menurut `sniffFileType`; selain itu melempar error. Ekstensi file dari tipe terdeteksi: `generations/<id>/post.<ext>` (desain menulis `post.png`; hasil Gemini bisa JPEG, jadi ekstensi mengikuti isi).
3. File ditulis dulu; baris diperbarui (caption, `hashtags_json`, `image_path`, `updated_at`) dengan `WHERE id = ?`; bila tidak ada baris yang berubah (dihapus di tengah jalan) file dihapus dan error dilempar. File lama dengan ekstensi berbeda (tidak terjadi untuk generation baru, tetapi mungkin pada pemrosesan ulang) dihapus.
4. `image_brief` tidak disimpan: tidak ada gunanya setelah gambar jadi, dan tidak ada kolomnya di desain.

### 5. Edit, hapus, dan history

- `PATCH /api/generations/:id` dengan `{ caption?, hashtags? }`: caption 1–2200 karakter (batas Instagram), hashtag maksimal 30 entri, tiap entri 1–100 karakter, dinormalisasi menjadi diawali `#` dan tanpa spasi; duplikat dibuang. Hanya bila `completed` (409 sebelum itu). Body kosong tidak mengubah apa pun dan menjawab 200.
- `DELETE /api/generations/:id` (tambahan terhadap `design.md` §7) menghapus baris dan folder `generations/<id>/`, 204. Job-nya tidak dihapus (konsisten dengan brand). Tanpa ini history hanya bisa bertambah, dan Retry meninggalkan generation gagal selamanya. Generate yang sedang berjalan boleh dihapus: handler akan gagal dengan jelas saat callback tiba.
- `GET /api/generations?brandId=` wajib `brandId` (400 bila tidak ada), terbaru dulu, maksimal 100, item ringan: `{ id, brandId, prompt, aspectRatio, status, stage, imageUrl, createdAt }`. Statusnya diturunkan dengan satu kueri job per baris yang belum final saja; baris `completed` yang `image_path`-nya ada tidak perlu membaca job.
- Menghapus brand: `deleteBrand` membaca id generation milik brand sebelum menghapus baris, lalu menghapus folder `generations/<id>/` masing-masing bersama `brands/<id>/`. Kegagalan hapus file tetap hanya dicatat. Ini perubahan persyaratan `brand-management`.

### 6. Struktur kode

Mengikuti pola yang sudah ada: service murni dengan dependensi eksplisit (`{ db, mediaDir, dispatch, now }`), import `h3`/`node:*` eksplisit, route tipis.

```
shared/schemas/generation.ts        DTO, body POST/PATCH, konstanta batas, enum rasio
server/utils/generations.ts         repository + service (create/list/get/patch/delete, status turunan)
server/utils/post-result.ts         createPostResultHandler
server/utils/generation-requests.ts handler HTTP + pemetaan error domain (GenerationError)
server/utils/generation-services.ts perakit dependensi dari runtimeConfig
server/plugins/post-result-handler.ts
server/api/generations/index.get.ts, index.post.ts, [id].get.ts, [id].patch.ts, [id].delete.ts
```

`GenerationError` memakai pola `BrandError` (`not_found` 404, `invalid` 400, `conflict` 409, `corrupt` 500). Untuk menghindari salinan kode, pemetaan kind→status dipakai bersama dari `brand-errors.ts` bila bentuknya identik; kalau tidak, dibuat sejajar di file sendiri tanpa mengubah perilaku brand.

### 7. UI Studio

Halaman `/studio` (lebar maks 720px) memakai brand aktif (`useActiveBrand`). Komponen:

- `StudioComposer`: baris "CREATE WITH" dengan pemilih brand (`<select>` bergaya, hanya brand `ready`, menulis ke brand aktif yang sama dengan sidebar), textarea prompt, pemilih foto (thumbnail, multi-pilih maks 3, default foto pertama), toggle rasio `1:1`/`4:5` (default `4:5`), dan tombol **Generate Post** dengan lencana biaya `~$0.04`. Draft prompt disimpan di `useState` agar tidak hilang saat berpindah halaman.
- `PostResult`: menampilkan generation terpilih. Saat `running`: kerangka berukuran sesuai rasio dan progres tahap (`Caption` → `Image`) dari `useJobPolling` (2 detik) atas job generation itu; saat job final ia memuat ulang generation dan history. Saat `completed`: `InstagramPostMockup` dan aksi. Saat `failed`: pesan ramah dan **Retry**.
- `InstagramPostMockup`: kartu `#000` sesuai Bagian B: header avatar 32px + handle (`instagramHandle` atau nama brand), gambar penuh sesuai rasio, baris ikon, caption 14px, hashtag `--info`.
- Aksi hasil: **Copy caption** (`useClipboard`, caption + baris kosong + hashtag), **Edit caption** inline (textarea, simpan lewat PATCH, batal mengembalikan), **Download image** (`<a download>` ke URL media dengan nama file `<brand>-<id>.<ext>`), **Regenerate** (generation baru dengan prompt, rasio, dan foto yang sama yang masih ada; bila tak ada yang tersisa, memakai foto pertama brand). **Retry** untuk generation gagal adalah Regenerate yang sama.
- `StudioHistory` di `AppSidebar` hanya pada `/studio`: thumbnail kecil (atau ikon progres/gagal), potongan prompt, waktu relatif, dan status. Memilih item menampilkannya di `PostResult` (state terpilih di `useState`). Selama ada item `running`, daftar diperbarui tiap 3 detik oleh halaman Studio (satu pemilik polling, bukan tiap item).
- Keadaan kosong: tanpa brand → ajakan membuat brand; brand tanpa foto → ajakan mengunggah foto di Brand DNA (tombol Generate nonaktif dengan alasannya).
- Teks UI berbahasa Inggris (`AGENTS.md`); konten hasil mengikuti bahasa DNA.

### 8. Strategi pengujian

- Unit: normalisasi hashtag dan validasi body (Zod), status turunan dari job (semua baris tabel di Keputusan 1, termasuk tanpa job lama/baru dan timeout).
- Service (SQLite + media sementara, `dispatch` palsu): create (semua penolakan, input yang dikirim ke dispatch termasuk logo dan urutan aset), dispatch gagal, list/get, patch, delete (file dan baris), `deleteBrand` membersihkan generations.
- Result handler lewat `applyJobCallback` nyata: simpan caption/hashtag/gambar, ekstensi mengikuti isi, gambar palsu → job `failed`, generation dihapus saat berjalan → job `failed` tanpa file yatim.
- HTTP (server `http` nyata, pola harness brand): semua endpoint dan kode status, termasuk `message` pada body error.
- E2E mock di level service: generate sampai `completed` (caption fixture, gambar tersimpan, `/media` melayaninya) dan `mock:fail` sampai `failed` dengan pesan.
- Browser (Playwright terhadap dev server dan build produksi, mock): prompt → progres → mockup, copy, edit tersimpan, download, regenerate, gagal → Retry, history, ganti brand, keadaan kosong, mobile.

## Risks / Trade-offs

- **[Tidak ada batas anggaran atau rate limit]** satu klik berulang membuat banyak generate berbiaya → tombol nonaktif saat request, label biaya terlihat, dan tool di belakang BasicAuth. Batas server ditangguhkan; bila diperlukan, mudah ditambahkan di service create (hitung generation `running` per brand).
- **[Status turunan bergantung pada job]** job yang dihapus manual dari DB membuat generation tampak `failed` → job tidak pernah dihapus oleh aplikasi.
- **[Foto yang dipakai sebuah generation bisa dihapus kemudian]** → history tetap utuh; Regenerate menyaring id basi.
- **[Satu foto minimal]** user tanpa foto tidak bisa generate → pesan jelas dengan jalan keluar; lebih baik daripada produk karangan model.
- **[Hapus brand saat generate berjalan]** → job gagal bersih dengan `handler_failed`; tidak ada file yatim karena handler tidak menulis bila generation hilang.
- **[Ekstensi gambar mengikuti isi, bukan `post.png`]** → URL media tidak bisa ditebak, tetapi selalu dari `imageUrl` di DTO.
- **[Mode live belum teruji]** kualitas gambar dan caption dari Gemini baru terlihat di VPS; kontrak dan handler teruji lokal.
- **[Polling dua lapis]** `PostResult` mem-poll job, halaman mem-poll daftar → keduanya ringan (SQLite lokal) dan tiap lapis punya satu pemilik.

## Migration Plan

1. Tambah `generations` dan indeks `jobs_generation_idx` ke `server/db/schema.ts`, `pnpm db:generate` menghasilkan migrasi ketiga, diterapkan migrator saat start. Smoke test `pnpm build && pnpm preview` memastikan folder migrasi terbaca.
2. Tidak ada rollback data: tabel baru, belum ada data produksi. Mengembalikan change cukup menghapus migrasi sebelum dipakai.

## Open Questions

- Batas satu foto minimal dan maksimal tiga mengikuti `design.md` §4.2; bila ingin mengizinkan generate tanpa foto (logo saja), cukup longgarkan satu validasi.
- Angka batas (caption 2200, hashtag 30, riwayat 100) bersifat usulan dan hidup di satu file konstanta.
