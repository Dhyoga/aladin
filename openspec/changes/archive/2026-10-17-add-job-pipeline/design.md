## Context

Fondasi (change `setup-foundation`) sudah ada: Nuxt 4, `runtimeConfig` (`n8nMode`, `n8nBaseUrl`, `appInternalUrl`, `sharedSecret`), SQLite + Drizzle dengan migrator otomatis (journal masih kosong), dan route `/media`. Belum ada tabel bisnis.

Change ini membangun pola job + callback + polling dari `design.md` root §2 dan kontrak §8. Konteks yang membentuk keputusan:

- Lokal tidak pernah menghubungi n8n (`design.md` §2 "Dev vs prod"). Mock harus memakai fungsi inti callback yang sama dengan jalur live, supaya bug kontrak di sisi app ketahuan lokal.
- Mode live baru teruji di VPS (change 7), jadi kontrak Zod dan tes dengan `fetch` palsu adalah satu-satunya jaring pengaman sebelum itu.
- Tabel `brands`, `brand_assets`, dan `generations` belum ada. Hasil job (Brand DNA, gambar, video) belum punya tempat disimpan. Jadi persistensi hasil harus diserahkan ke change 3–5.
- Satu proses Nitro, satu container, SQLite file tunggal (better-sqlite3 sinkron).

## Goals / Non-Goals

**Goals:**

- Siklus hidup job yang benar di bawah balapan nyata: callback datang dobel, callback datang sebelum app sempat menandai `running`, callback datang bersamaan dengan timeout.
- Kontrak n8n sebagai satu sumber kebenaran Zod, dipakai pembuat request, handler callback, mock, dan tes.
- Mock mode yang menjalankan seluruh siklus (progress, completed, failed) dengan fixture nyata, tanpa jaringan.
- Seam yang jelas bagi change 3–5 untuk menyimpan hasil tanpa mengubah pipeline.

**Non-Goals:**

- Endpoint pembuat job, tabel brands/assets/generations, penyimpanan hasil ke `data/media`, UI.
- `GET /api/internal/assets/:id` dan `useJobPolling` (digeser ke `add-brand-dna`, lihat Keputusan 10).
- Retry otomatis, antrean, atau multi-instance. Satu proses saja.
- Menguji n8n asli.

## Decisions

### 1. Inti murni, adapter Nitro tipis

Semua logika ditulis sebagai fungsi yang menerima dependensinya (`db`, `now`, `fetchFn`, `sleep`, registry) dan memakai import `h3`/`node:*` eksplisit, bukan auto-import Nitro, sama seperti pola `media.ts`. Berkas route hanya merakit dependensi dari `useRuntimeConfig` lalu memanggil inti. Dengan begitu tes Vitest memakai SQLite sungguhan di direktori sementara (termasuk migrasi yang dihasilkan drizzle-kit) tanpa menjalankan Nitro.

```
shared/schemas/   job.ts · brand-dna.ts · n8n-contracts.ts
server/utils/     jobs.ts            tabel jobs: create/get/transisi/timeout
                  job-dispatch.ts    startJob = create → client.dispatch → running|failed
                  n8n-client.ts      live (fetch) + mock (runner)
                  n8n-mock.ts        skenario mock + loader fixture
                  job-callback.ts    applyJobCallback (inti) + parseCallbackForm
                  job-handlers.ts    registry result handler per tipe job
                  secret.ts          perbandingan secret constant-time + guard internal
                  job-services.ts    merakit dependensi dari runtimeConfig (adapter)
server/api/       jobs/[id].get.ts · n8n/callback.post.ts   (tipis)
server/fixtures/  brand-dna.json · post.json · video-script.json · *.png · video.mp4
```

### 2. Skema `jobs` dan transisi atomik

Kolom snake_case sesuai `design.md` §6: `id` (`job_` + nanoid 16), `type`, `brand_id`, `generation_id`, `status`, `stage`, `error`, `created_at`, `started_at`, `finished_at`, `updated_at` (unix ms). **Tanpa foreign key**: tabel tujuannya belum ada, dan job tidak boleh ikut terhapus saat brand dihapus tanpa disengaja. Indeks pada `status`.

Setiap perubahan status memakai `UPDATE ... WHERE id = ? AND status IN (<status yang sah>)` lalu memeriksa jumlah baris yang berubah. Karena better-sqlite3 sinkron dan satu penulis, ini membuat transisi atomik dan menentukan pemenang tanpa lock: callback vs timeout vs callback dobel.

```
queued ──dispatch ok──▶ running ──completed──▶ completed
  │                        │
  └──────dispatch gagal────┴──failed / timeout──▶ failed        (completed & failed = final)
```

*Alternatif*: kolom `result_json` di `jobs` agar hasil tersimpan di pipeline. Ditolak: hasil punya rumah di tabel domain (brands, generations), dan menyimpannya dua kali menciptakan dua sumber kebenaran.

### 3. Callback bisa mendahului `running`

n8n membalas webhook segera lalu memproses, jadi callback `progress` pertama bisa tiba sebelum app selesai memproses respons webhook dan menandai `running`. Karena itu: (a) handler callback menerima job berstatus `queued` maupun `running`; (b) `markRunning` hanya berlaku `WHERE status = 'queued'`, sehingga tidak pernah memundurkan job yang sudah `completed` atau berstatus lebih maju; (c) `started_at` diisi oleh transisi pertama yang menang (dispatch ok atau callback pertama).

### 4. Timeout lazy dengan satu aturan

`isTimedOut(job, now)` = job non-final dan `now - (started_at ?? created_at) > timeout(type)`. Memakai `created_at` bila belum ada `started_at` menutup kasus job yang tertinggal `queued` karena proses mati di antara insert dan dispatch. Dipicu di tiga tempat: `GET /api/jobs/:id`, awal pemrosesan callback (callback terlambat dicatat sebagai diabaikan secara konsisten), dan fungsi massal `expireStaleJobs(db, now)` untuk endpoint list di change berikutnya. Hasilnya `failed` dengan `error = 'timeout'`, lewat transisi atomik yang sama.

Batas: `brand_extract` 5 menit, `post` 5 menit, `video` 20 menit (`design.md` §2), disimpan sebagai konstanta di `shared/schemas/job.ts`.

*Trade-off*: callback yang datang setelah timeout dibuang, sehingga hasil n8n terbuang. Dapat diterima karena batasnya longgar relatif terhadap durasi normal.

### 5. Kontrak n8n: satu file Zod, dipakai di dua arah

`n8n-contracts.ts` mendefinisikan: jalur webhook per tipe (`aladin-brand-extract`, dst.), envelope (`job_id`, `callback_url`, `asset_base_url`), tiga bentuk request (brand extract berupa union terdiskriminasi pada `source_type`), field callback, payload `completed` per tipe, dan konstanta ukuran file. Pembuat request memvalidasi body dengan skema yang sama sebelum mengirim (kesalahan pemrograman terdeteksi di app, bukan sebagai 4xx misterius dari n8n), dan handler callback memvalidasi payload masuk.

`stage` pada callback adalah string bebas (1–50 karakter) agar workflow n8n bisa menambah tahap tanpa mengubah app. Kosakata yang dikenal UI dicatat sebagai konstanta `JOB_STAGES` (brand_extract: `crawling` | `reading` | `structuring`; post: `caption` | `image`; video: `script` | `storyboard` | `video`). Untuk video, `progress` dengan `stage=script` membawa payload `{ script }` yang divalidasi bila ada.

Skema Brand DNA (`design.md` §5.2) dimajukan ke change ini karena payload `brand_extract` dan request `post`/`video` memuatnya. Memakai Zod 4 (`z.url()`, bukan `z.string().url()` yang deprecated).

### 6. Klien n8n: live dan mock di balik satu antarmuka

```ts
interface N8nClient { dispatch(job: JobRow, input: DispatchInput): Promise<void> }
```

- **Live**: `POST <n8nBaseUrl>/webhook/<path>`, header `X-Aladin-Secret` dan `Content-Type: application/json`, `AbortSignal.timeout(15 s)`. Hanya respons 2xx yang dianggap sukses. Selain itu, melempar error ringkas (status + potongan pesan) tanpa membocorkan secret. `callback_url` = `<appInternalUrl>/api/n8n/callback`, `asset_base_url` = `<appInternalUrl>/api/internal/assets`.
- **Mock**: `dispatch` selesai segera, lalu menjalankan skenario di latar (`void runner.run(...)`). Skenario memanggil `applyJobCallback` langsung (bukan HTTP) dengan struktur file yang sama seperti hasil parse multipart.
- Pemilihan mode dari `runtimeConfig.n8nMode`.

Skenario mock per tipe, dengan jeda yang dapat diganti di tes (`sleep` diinjeksi):

| Tipe | Rangkaian event |
|---|---|
| `brand_extract` | progress `crawling` (URL) atau `reading` (PDF) → progress `structuring` → completed (Brand DNA fixture + logo) |
| `post` | progress `caption` → progress `image` → completed (caption, hashtag, image_brief + gambar) |
| `video` | progress `script` (payload script) → progress `storyboard` (file) → progress `video` → completed (script + video) |

Input yang memuat teks `mock:fail` (URL, prompt) menghasilkan event `failed` setelah progress pertama, supaya state gagal dan tombol Retry bisa didemokan. Fixture dibaca dari `server/fixtures/` relatif `process.cwd()` (sama dengan pola folder migrasi: dev dan `pnpm preview` berjalan dari root proyek). Mock tidak dipakai di production.

*Alternatif*: mock lewat HTTP ke endpoint callback sendiri. Ditolak: butuh port/URL, lebih rapuh, dan tidak menambah cakupan dibanding memanggil inti yang sama.

### 7. Inti callback dan registry result handler

`applyJobCallback(deps, callback)` adalah satu-satunya tempat status berubah akibat callback (HTTP maupun mock):

1. Cari job. Tidak ada → hasil `not_found`.
2. Jalankan pengecekan timeout. Job final → `ignored` (idempotent).
3. `progress`: perbarui `stage`; validasi payload bila ada (mis. script video); panggil `onProgress` handler tipe itu bila ada.
4. `completed`: parse `payload` (string JSON) dengan skema tipe job, cek file wajib (post: `image`; video: `video`) dan batas ukuran; tidak valid → `failed` dengan `invalid_payload: …`, hasil tetap sukses di level HTTP. Valid → panggil `onCompleted` handler; sukses → `completed`; handler melempar → `failed` dengan `handler_failed: …`.
5. `failed`: tandai `failed` dengan `error` dari n8n (dipotong 500 karakter, default `unknown_error`).

Registry `registerJobHandler(type, { onProgress?, onCompleted })` diisi plugin Nitro milik change 3–5, yang punya tabel dan jalur media. Konteks handler membawa `job`, `stage`, payload bertipe, dan file (`{ field, filename, mime, data: Buffer }`). Job `completed` tanpa handler terdaftar ditandai `failed` dengan `no_result_handler`, agar kegagalan konfigurasi tidak terlihat seperti sukses. Sampai change 3, memang belum ada job yang dibuat.

Callback `completed` duplikat yang tiba **saat handler pertama masih berjalan** (retry n8n) diblok oleh set in-memory `processing` per job id dan dijawab `ignored`. Cukup untuk satu proses. Dua proses akan membutuhkan klaim di DB, yang di luar scope.

### 8. Endpoint callback

`server/api/n8n/callback.post.ts` memanggil `handleCallbackRequest(event, deps)`, berurutan:

1. Header `X-Forwarded-Host` ada → 404 (internal-only, `design.md` §10). n8n memanggil `http://aladin:3000` langsung tanpa Traefik, jadi header ini hanya muncul bila request lewat domain publik.
2. Secret salah atau kosong → 401, **sebelum body dibaca**. Perbandingan constant-time: kedua nilai di-hash SHA-256 lalu `timingSafeEqual`, sehingga panjang tidak bocor.
3. `Content-Length` melebihi batas total → 413.
4. `readMultipartFormData`; bagian tanpa `filename` menjadi field teks, bagian dengan `filename` menjadi file (hanya `logo`, `image`, `storyboard`, `video`; selain itu diabaikan).
5. Field divalidasi dengan Zod (`job_id`, `event`, `stage?`, `payload?`, `error?`). Gagal → 400, karena tanpa `job_id` yang sah tidak ada job yang dapat ditandai gagal.
6. Panggil `applyJobCallback`: `not_found` → 404, selain itu 200 dengan `{ ok: true, status }`.

Batas ukuran per file (`design.md` Gotcha): `logo` 10 MB, `image` dan `storyboard` 20 MB, `video` 100 MB. Batas total request: 130 MB.

### 9. `GET /api/jobs/:id`

Memvalidasi `id` (string tidak kosong, maksimal 64 karakter), memanggil `getJob` dengan pengecekan timeout, dan membalas DTO camelCase `{ id, type, status, stage, error, brandId, generationId, createdAt, startedAt, finishedAt, updatedAt }` (schema `JobDto` di `shared/schemas/job.ts`, dipakai client). Tidak ada → 404. `Cache-Control: no-store` agar polling selalu segar.

### 10. Pergeseran ke change 3

`GET /api/internal/assets/:id` membaca `brand_assets`, yang baru dibuat di `add-brand-dna`, dan konsumen pertamanya adalah PDF sumber di change itu. Maka endpoint itu dibangun di sana, memakai helper secret dan guard internal-only dari change ini. `useJobPolling` ikut ke change 3 karena butuh konsumen UI untuk diverifikasi. Pergeseran ini dicatat di `design.md` root Bagian C dalam change ini.

### 11. Fixture mock

Dibuat dengan alat yang ada (ImageMagick, ffmpeg), dengan perintahnya dicatat di `server/fixtures/README.md` agar dapat dibuat ulang: `brand-dna.json` (valid terhadap skema), `post.json` (caption, hashtag, image_brief), `video-script.json` (5 scene, 10 detik), `logo.png`, `post.png` (1080×1350), `storyboard.png`, dan `video.mp4` (9:16, 10 detik, H.264 + AAC, `+faststart`, di bawah 1 MB). Tes memastikan semua fixture JSON lolos skema kontrak.

## Risks / Trade-offs

- **[Mode live tidak teruji sampai VPS]** → Kontrak Zod dipakai di dua arah, klien live diuji dengan `fetch` palsu (header, jalur, body, 2xx vs error, timeout), dan mock memakai inti callback yang sama. Sisa risiko ada di workflow n8n, ditangani change 6–7.
- **[Asumsi satu proses]** (timer mock, set `processing`, transisi atomik per proses) → Cocok untuk satu container. Didokumentasikan; multi-instance di luar scope.
- **[Restart server mematikan skenario mock]** → job tertinggal `running` sampai timeout. Dapat diterima untuk lokal.
- **[Callback terlambat dibuang setelah timeout]** → Batas timeout longgar; n8n tidak mengulang bila menerima 200.
- **[Job selesai tanpa handler jadi `failed`]** → Disengaja agar konfigurasi yang salah terlihat; belum ada pembuat job sampai change 3.
- **[Skema Brand DNA dikunci lebih awal]** → Bila change 3 butuh penyesuaian, ditangani sebagai MODIFIED terhadap spec `brand-dna-schema`.
- **[`readMultipartFormData` memuat seluruh file ke memori]** → Batas ukuran per file dan total; aman untuk skala tool internal (Gotcha di `AGENTS.md`).
- **[`nanoid` dependensi baru]** → Kecil dan sudah disebut di `design.md` §6 untuk id; tidak menambah komponen berjalan.

## Migration Plan

1. Tambah tabel `jobs` ke `server/db/schema.ts`, lalu `pnpm db:generate` untuk migrasi SQL pertama. Migrator yang sudah ada menerapkannya saat server start. Smoke test `pnpm build && pnpm preview` memastikan folder migrasi terbaca.
2. Tidak ada rollback data: tabel baru dan belum ada pembuat job. Mengembalikan change cukup dengan menghapus migrasi sebelum dipakai di lingkungan mana pun.

## Open Questions

Tidak ada yang menghalangi. Tahap `stage` untuk post (`caption`, `image`) dan brand_extract (`structuring`) adalah usulan awal dan dapat disesuaikan saat workflow n8n ditulis (change 6) karena `stage` bertipe string bebas.
