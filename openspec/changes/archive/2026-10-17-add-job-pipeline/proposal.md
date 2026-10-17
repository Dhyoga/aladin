## Why

Semua kerja AI di Aladin berjalan sebagai job asinkron lewat n8n: app mengirim job ke webhook, n8n memproses (video bisa beberapa menit), lalu mengirim hasil lewat callback, dan UI melakukan polling status. Pola ini (job + callback + polling, `design.md` §2) dipakai oleh brand extract, post, dan video, jadi harus ada sekali dan teruji sebelum change fitur (3–5) dibangun di atasnya. Karena n8n tidak pernah dihubungi dari lokal, mock mode harus meniru pola yang sama persis agar seluruh UI bisa dikembangkan tanpa n8n.

## What Changes

- Tambah tabel **`jobs`** (Drizzle + migrasi pertama) dan service job: buat job (`queued`), dispatch ke n8n (`running` bila 2xx, `failed` bila gagal), transisi status atomik, dan **timeout lazy** (`brand_extract` 5 menit, `post` 5 menit, `video` 20 menit) yang menandai job `failed` dengan error `timeout` saat status dibaca.
- Tambah endpoint **`GET /api/jobs/:id`** (status, stage, error, termasuk pengecekan timeout).
- Tambah **kontrak n8n** di `shared/schemas/n8n-contracts.ts` (Zod): payload webhook app → n8n untuk tiga tipe job, field callback n8n → app, payload `completed` per tipe, dan konstanta batas ukuran file callback.
- Tambah skema **Brand DNA** di `shared/schemas/brand-dna.ts` (Zod, `design.md` §5.2). Dimajukan dari change `add-brand-dna` karena kontrak `brand_extract` bergantung padanya. Change 3 membangun tabel, API, dan UI di atas file ini.
- Tambah **klien n8n** `server/utils/n8n-client.ts` dengan dua mode: **live** (POST ke `<n8nBaseUrl>/webhook/<path>` dengan header `X-Aladin-Secret`) dan **mock** (simulasi di proses Nitro yang memanggil fungsi inti callback yang sama, lengkap event `progress`, memakai file nyata di `server/fixtures/`; input yang memuat `mock:fail` mensimulasikan job gagal).
- Tambah endpoint **`POST /api/n8n/callback`** (multipart): cek secret (constant-time), tolak request yang datang lewat proxy (`X-Forwarded-Host`), job tidak dikenal 404, **idempotent** untuk job final, validasi payload dengan Zod (payload tidak valid membuat job `failed`, respons tetap 200), dan batas ukuran upload. Hasil `completed` diteruskan ke **registry result handler per tipe job** yang didaftarkan change 3–5 (yang memegang tabel brands/generations); callback itu sendiri hanya mengelola status.
- Tambah **fixture mock** di `server/fixtures/`: contoh Brand DNA, logo, gambar post, storyboard, dan video MP4 pendek.
- Tambah **unit test** (Vitest): kontrak Zod, skema Brand DNA, service job + timeout, klien live (fetch dimock), skenario mock, dan handler callback (secret salah, job tidak ditemukan, idempotency, payload tidak valid, event progress/failed).
- **Digeser ke change berikutnya** (perlu tabel yang belum ada): `GET /api/internal/assets/:id` pindah ke `add-brand-dna` (membaca `brand_assets`, dan PDF sumber baru dipakai di sana), dan composable `useJobPolling` pindah ke konsumen UI pertamanya (`add-brand-dna`). `design.md` Bagian C diperbarui di change ini.
- **Tidak termasuk**: endpoint pembuat job (`POST /api/brands`, `POST /api/generations`), tabel brands/brand_assets/generations, persistensi hasil job ke media, dan UI apa pun.

## Capabilities

### New Capabilities

- `job-lifecycle`: tabel `jobs`, pembuatan dan dispatch job, state machine status, timeout lazy per tipe, dan `GET /api/jobs/:id`.
- `n8n-contracts`: skema Zod untuk request webhook, field callback, payload `completed` per tipe job, dan batas ukuran file.
- `brand-dna-schema`: skema Zod Brand DNA (field, default, validasi warna/enum) yang dipakai bersama client, server, dan kontrak n8n.
- `n8n-client`: pengiriman job ke n8n dalam mode live dan mode mock yang meniru siklus callback dengan fixture.
- `n8n-callback`: endpoint callback n8n (secret, internal-only, idempotency, validasi, batas ukuran) dan registry result handler per tipe job.

### Modified Capabilities

<!-- Tidak ada. Spec yang sudah ada (app-shell, runtime-config, database, media-serving) tidak berubah persyaratannya. -->

## Impact

- **Kode baru**: `server/db/schema.ts` (+ migrasi pertama di `server/db/migrations/`), `server/utils/` (jobs, n8n-client, job-callback, job-handlers, secret), `server/api/jobs/[id].get.ts`, `server/api/n8n/callback.post.ts`, `server/fixtures/`, `shared/schemas/` (n8n-contracts, brand-dna, job), `tests/`.
- **Dependensi**: `nanoid` (id job). Tanpa dependensi lain; `fetch` bawaan Node 22.
- **Konfigurasi**: memakai `n8nMode`, `n8nBaseUrl`, `appInternalUrl`, `sharedSecret` yang sudah ada. Tidak ada key baru.
- **Database**: migrasi pertama (`jobs`). Folder migrasi yang sebelumnya hanya berisi journal kosong mendapat file SQL pertama.
- **Dokumen**: `design.md` Bagian C (pergeseran `internal/assets` dan `useJobPolling`, BrandDNA schema dimajukan) dan `AGENTS.md` bila ada yang menyimpang saat implementasi.
- **Sistem eksternal**: tidak ada yang dihubungi saat development lokal. Mode live baru benar-benar teruji di VPS (change `deploy-to-vps`).
- **Referensi**: `design.md` §2 (pola job + callback, timeout, mock mode), §5.2 (skema Brand DNA), §6 (tabel `jobs`), §7 (API), §8 (kontrak n8n), §10 (keamanan), Bagian C (change 2).
