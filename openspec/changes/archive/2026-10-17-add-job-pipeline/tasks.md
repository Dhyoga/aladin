## 1. Skema bersama (Zod) dan kontrak

- [x] 1.1 Pasang `nanoid`; jalankan semua perintah di Node 22 (`nvm use 22`)
- [x] 1.2 Buat `shared/schemas/brand-dna.ts`: skema `BrandDNA` sesuai `design.md` §5.2 (Zod 4: `z.url()`), ekspor tipe `BrandDNA` dan `Feature`
- [x] 1.3 Buat `shared/schemas/job.ts`: `JOB_TYPES`, `JOB_STATUSES`, tipe, `JOB_TIMEOUTS_MS` (5/5/20 menit), `isFinalStatus`, dan `JobDtoSchema` (camelCase)
- [x] 1.4 Buat `shared/schemas/n8n-contracts.ts`: `N8N_WEBHOOK_PATHS`, envelope, `AssetRef`, request brand extract (union `source_type`), post, video, field callback, payload `completed` per tipe (+ skema script video), `JOB_STAGES`, `CALLBACK_FILE_FIELDS`, batas ukuran per file dan total, `REQUIRED_COMPLETED_FILES`
- [x] 1.5 Tes `tests/shared/brand-dna.test.ts`: minimal valid, field wajib hilang (path `identity.name`), nama kosong, default terisi, tier salah, warna salah (`red`, `#fff`) dan benar (`#F97316`), website salah/benar
- [x] 1.6 Tes `tests/shared/n8n-contracts.test.ts`: path webhook, envelope, brand extract (url, pdf tanpa asset id, source tidak dikenal), post (valid, rasio salah, prompt kosong), video (durasi 15 ditolak), field callback (stage bebas, event salah, job_id kosong), payload per tipe (chips 4 ditolak, `chips` default `[]`, scene waktu terbalik, scenes kosong, `image_brief` mempertahankan key tambahan), batas ukuran dan file wajib
- [x] 1.7 Verifikasi: `pnpm lint && pnpm typecheck && pnpm test` lolos

## 2. Tabel `jobs` dan service job

- [x] 2.1 Tambah tabel `jobs` ke `server/db/schema.ts` (kolom snake_case, `status` dan `type` bertipe enum, tanpa foreign key, indeks pada `status`), lalu `pnpm db:generate` untuk migrasi SQL pertama; periksa SQL yang dihasilkan
- [x] 2.2 Buat `server/utils/jobs.ts` (tanpa auto-import Nitro; menerima `db` dan `now`): `createJob`, `getJob`, `markRunning` (hanya `WHERE status = 'queued'`), `updateStage`, `completeJob`, `failJob` (semuanya guarded `UPDATE … WHERE status IN (…)` dan mengembalikan apakah berlaku), `isTimedOut`, `getJobWithTimeout` (menandai `failed`/`timeout` secara atomik), `expireStaleJobs`, dan `toJobDto`
- [x] 2.3 Tes `tests/server/jobs.test.ts` memakai SQLite sementara + migrasi nyata: pembuatan job (id `job_…`, `queued`, timestamp), transisi sah dan ditolak, job final tidak berubah, callback mendahului `running` (`markRunning` tidak memundurkan), timeout per tipe (post 6 menit gagal, video 10 menit tetap `running`, `queued` lama gagal), `expireStaleJobs` hanya menyentuh yang basi, `toJobDto` camelCase
- [x] 2.4 Verifikasi: `pnpm lint && pnpm typecheck && pnpm test` lolos, dan `pnpm dev` menerapkan migrasi `jobs` (log `[db] migrations up to date`)

## 3. Secret, guard internal, dan registry handler

- [x] 3.1 Buat `server/utils/secret.ts`: `safeEqualSecret(a, b)` (SHA-256 lalu `timingSafeEqual`), dan `assertInternalRequest(event, expectedSecret)` yang melempar 404 bila ada `X-Forwarded-Host`, lalu 401 bila secret salah/kosong
- [x] 3.2 Buat `server/utils/job-handlers.ts`: tipe `JobResultHandler` (konteks bertipe per job type: `job`, `stage`, `payload`, `files`), `createHandlerRegistry()` dengan `register` (menggantikan yang lama) dan `get`, plus registry bawaan aplikasi dan `registerJobHandler`
- [x] 3.3 Tes `tests/server/secret.test.ts`: sama/beda, prefix, panjang berbeda, string kosong; `assertInternalRequest` untuk proxy (404), secret salah (401), secret benar; tes registry (register, ganti, belum ada)
- [x] 3.4 Verifikasi: `pnpm lint && pnpm typecheck && pnpm test` lolos

## 4. Inti callback

- [x] 4.1 Buat `server/utils/job-callback.ts` dengan tipe `CallbackFile`/`ParsedCallback` dan `parseCallbackParts(parts)` murni (bagian tanpa filename jadi field teks, whitelist file `logo`/`image`/`storyboard`/`video`, file lain diabaikan, validasi field dengan kontrak)
- [x] 4.2 Implementasikan `applyJobCallback(deps, callback)` sesuai design Keputusan 7: cari job (`not_found`), cek timeout lalu job final = `ignored`, `progress` (stage, validasi payload script video, hook `onProgress`, `queued` → `running`), `completed` (parse JSON, skema per tipe, file wajib, batas ukuran per file, handler, `completed`; `invalid_payload`/`handler_failed`/`no_result_handler`), `failed` (error dipotong 500, default `unknown_error`), dan set `processing` untuk callback `completed` dobel yang bersamaan
- [x] 4.3 Tes `tests/server/job-callback.test.ts` (SQLite sementara, handler palsu): semua skenario spec `n8n-callback` di level inti: stage update, progress sebelum running, hook menerima file, payload script video tidak valid, completed sukses, payload hilang field, JSON rusak, file wajib hilang, file terlalu besar, handler melempar, tanpa handler, handler diganti, `failed` dengan/tanpa pesan/pesan panjang, job tidak ada, callback dobel, callback setelah gagal, callback setelah timeout, completed bersamaan (handler hanya sekali)
- [x] 4.4 Verifikasi: `pnpm lint && pnpm typecheck && pnpm test` lolos

## 5. Klien n8n (live) dan dispatch

- [x] 5.1 Buat `buildWebhookRequest(type, envelope, input)` murni di `server/utils/n8n-client.ts` yang menyusun body dari input domain (mengisi `duration_seconds: 10` dan `aspect_ratio: '9:16'` untuk video) dan memvalidasinya dengan kontrak; turunkan `callback_url` dan `asset_base_url` dari `appInternalUrl` (tanpa slash ganda)
- [x] 5.2 Implementasikan klien live `createN8nClient({ mode, baseUrl, secret, appInternalUrl, fetchFn, mockRunner })`: POST ke `<baseUrl>/webhook/<path>` dengan header secret dan `AbortSignal.timeout(15000)`, 2xx = sukses, selain itu throw error ringkas (status/penyebab/timeout) yang tidak memuat secret
- [x] 5.3 Buat `server/utils/job-dispatch.ts`: `startJob(deps, { type, brandId, generationId, input })` = `createJob` → `client.dispatch` → `markRunning`, atau `failJob('dispatch_failed: …')` bila throw; mengembalikan job
- [x] 5.4 Tes `tests/server/n8n-client.test.ts` (fetch palsu): URL, method, header, body, trailing slash, input tidak valid tanpa fetch, 404 (pesan memuat `404` dan tanpa secret), network error, timeout; mode mock tidak memanggil fetch; `startJob` sukses (`running`, `started_at`) dan gagal (`failed`, `dispatch_failed…`, `finished_at`)
- [x] 5.5 Verifikasi: `pnpm lint && pnpm typecheck && pnpm test` lolos

## 6. Fixture dan mock mode

- [x] 6.1 Buat fixture di `server/fixtures/`: `brand-dna.json` (valid, bahasa Indonesia), `post.json` (caption, hashtag, image_brief), `video-script.json` (5 scene, 10 detik), `logo.png`, `post.png` (1080×1350), `storyboard.png`, dan `video.mp4` (9:16, 10 detik, H.264 + AAC, `-movflags +faststart`, di bawah 1 MB) memakai ImageMagick dan ffmpeg; tulis perintahnya di `server/fixtures/README.md`
- [x] 6.2 Verifikasi fixture: `ffprobe` pada `video.mp4` (durasi, rasio, codec, moov di awal) dan ukuran semua file
- [x] 6.3 Buat `server/utils/n8n-mock.ts`: `loadFixture(name)` (relatif `process.cwd()/server/fixtures`) dan `createMockRunner({ applyCallback, loadFixture, sleep })` dengan skenario `brand_extract`, `post`, `video` (urutan event sesuai spec `n8n-client`), pemicu `mock:fail` (event progress pertama lalu `failed`), dan jeda yang dapat diinjeksi
- [x] 6.4 Hubungkan mode mock ke `createN8nClient`: `dispatch` selesai segera lalu `void runner.run(job, input)` dengan penanganan error yang dicatat ke log
- [x] 6.5 Tes `tests/server/n8n-mock.test.ts`: fixture JSON lolos skema kontrak dan Brand DNA; file fixture non-kosong dengan signature benar (PNG, `ftyp` MP4); skenario post (stage `caption` → `image`, `completed`), video (stage `script` → `storyboard` → `video`, storyboard diterima di progress ke-2, video di completed), brand extract dari URL (`crawling`) dan PDF (`reading`), `mock:fail` (job `failed`, handler tidak dipanggil), handler terdaftar menerima payload dan file; dispatch mock selesai sebelum event pertama
- [x] 6.6 Verifikasi: `pnpm lint && pnpm typecheck && pnpm test` lolos

## 7. Adapter HTTP

- [x] 7.1 Buat `server/utils/job-services.ts`: merakit dependensi (db dari `getDb()`, klien dari `useRuntimeConfig`, registry aplikasi, `now = Date.now`)
- [x] 7.2 Buat `handleCallbackRequest(event, deps)` (import `h3` eksplisit) dengan urutan: guard internal (404/401, tanpa baca body), cek `Content-Length` (413), `readMultipartFormData`, `parseCallbackParts` (400 bila field tidak valid), `applyJobCallback` (404 bila `not_found`, selain itu 200 `{ ok: true, status }`); route tipis `server/api/n8n/callback.post.ts`
- [x] 7.3 Buat `server/api/jobs/[id].get.ts` (validasi `id`, `getJobWithTimeout`, 404, DTO camelCase, `Cache-Control: no-store`)
- [x] 7.4 Tes HTTP `tests/server/n8n-callback-http.test.ts` memakai server `http` sementara + `toNodeListener` dan `fetch` dengan `FormData`: 404 lewat `X-Forwarded-Host`, 401 secret salah/kosong/prefix, 413 `Content-Length` terlalu besar, 400 event salah/job_id hilang, 404 job tidak dikenal, 200 progress/completed/failed, file `extra` diabaikan, duplikat completed hanya satu kali handler, dan `GET /api/jobs/:id` (200 camelCase + `no-store`, 404, timeout menjadi `failed`)
- [x] 7.5 Verifikasi: `pnpm lint && pnpm typecheck && pnpm test` lolos

## 8. Dokumen dan verifikasi akhir

- [x] 8.1 Perbarui `design.md` Bagian C: change 2 tanpa `internal/assets` dan tanpa `useJobPolling`, BrandDNA schema masuk change 2; change 3 mendapat `GET /api/internal/assets/:id`, `useJobPolling`, dan pendaftaran result handler `brand_extract`; sesuaikan baris tabel API §7 bila perlu
- [x] 8.2 Perbarui `AGENTS.md`: catatan asumsi satu proses (timer mock, set `processing`), pemicu `mock:fail`, dan lokasi fixture
- [x] 8.3 Smoke test build: `pnpm build`, lalu `NUXT_SHARED_SECRET=<32+ karakter> pnpm preview`; sisipkan satu job lewat skrip SQLite sementara, lalu dengan `curl`: callback tanpa secret (401), dengan `X-Forwarded-Host` (404), job tidak dikenal (404), `event` salah (400), `progress` (200 dan `GET /api/jobs/:id` menunjukkan stage), `completed` tanpa handler (200 dan job `failed` `no_result_handler`), serta ulangi callback pada job final (200, tidak berubah)
- [x] 8.4 Pastikan migrasi `jobs` diterapkan pada database baru dari build produksi dan tidak ada panggilan jaringan keluar dari mode mock
- [x] 8.5 Jalankan `pnpm lint && pnpm typecheck && pnpm test` sampai lolos, lalu `openspec validate add-job-pipeline`
