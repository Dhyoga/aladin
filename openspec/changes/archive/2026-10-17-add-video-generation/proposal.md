## Why

Studio sudah menghasilkan Result 1 (post). Result 2 adalah separuh lain produknya: video iklan vertikal 9:16 berdurasi 10 detik dengan voice over, dibuat dari post yang sudah jadi lewat alur "script → storyboard → video". Pipeline job, mock mode dengan fixture video, kontrak n8n `video`, dan timeout 20 menit sudah ada; yang belum ada adalah tempat menyimpan hasilnya, endpoint untuk memulainya, dan UI-nya. Video lebih mahal (~US$1, 25× sebuah post) dan lebih lama (menit), jadi konfirmasi biaya, progres bertahap, dan penanganan gagal yang jelas menjadi bagian inti change ini, bukan tambahan.

## What Changes

- Tambah kolom video ke **`generations`** (migrasi keempat, `ALTER TABLE … ADD COLUMN`): `video_script_json`, `storyboard_path`, `video_path`. Status video **tidak disimpan**: diturunkan dari job `video` terbaru lewat `jobs.generation_id`, seperti status post.
- Tambah **`POST /api/generations/:id/video`**: memulai job `video` dari post yang sudah selesai, dengan Brand DNA, prompt, caption dan hashtag post saat ini (termasuk hasil edit user), serta logo dan foto yang masih ada. Ditolak bila post belum selesai, bila video sudah berjalan, atau bila video sudah jadi; boleh diulang setelah gagal.
- Tambah **field `video`** pada detail generation (`GET /api/generations/:id`): status, tahap, error, id job, script, `storyboardUrl`, dan `videoUrl`; `null` bila video belum pernah diminta. Script dan storyboard muncul begitu event progress-nya datang, tidak menunggu video selesai.
- Tambah **result handler `video`** (Nitro plugin) dengan hook progress: tahap `script` menyimpan script, berkas `storyboard` disimpan sebagai gambar, dan saat `completed` video disimpan sebagai `generations/<id>/video.mp4` setelah dicek isinya benar-benar MP4. Gagal dengan jelas bila generation sudah dihapus atau berkas bukan MP4.
- Tambah **deteksi MP4** ke util tipe file bersama (`ftyp` pada byte 4–8), tanpa mengubah perilaku untuk gambar dan PDF.
- Tambah **Result 2 di Studio**: tombol **Generate Video** (~$1) dengan dialog konfirmasi biaya, progres `Script → Storyboard → Video` (polling 4 detik) dengan storyboard tampil begitu tiba, hasil berupa pemutar video di dalam mockup layar Reels 9:16, script yang bisa dilipat (scene, teks layar, voice over), **Download video** dan **Download storyboard**, serta kartu gagal ramah dengan **Retry** (yang meminta konfirmasi biaya lagi).
- Perbarui `design.md` (§6 kolom video, §7 endpoint video dan field `video`), `AGENTS.md` (cara mensimulasikan video gagal di mock: tulis `mock:fail` di caption), dan `server/fixtures/README.md` bila perlu.
- **Tidak termasuk**: membuat ulang video yang sudah jadi (untuk take baru, user melakukan Regenerate pada post), voice over lewat TTS atau penggabungan ffmpeg (fallback masa depan di `design.md` §9.3), mengubah workflow n8n, dan video di luar 9:16/10 detik.

## Capabilities

### New Capabilities

- `video-generation`: memulai job video dari sebuah post, aturan kapan boleh dan tidak boleh, input yang dikirim ke n8n, status video yang diturunkan dari job, dan retry setelah gagal.
- `video-result`: result handler `video` (script, storyboard, video) beserta kasus gagalnya dan perilaku end to end di mock mode.
- `video-ui`: Result 2 di Studio (konfirmasi biaya, progres, pemutar Reels, script, unduhan, gagal dan Retry).

### Modified Capabilities

- `generation-management`: tabel `generations` mendapat kolom video, dan detail generation mendapat field `video`.
- `media-storage`: deteksi tipe file dari isi juga mengenali MP4.

## Impact

- **Kode baru**: `server/utils/video-generation.ts`, `server/utils/video-result.ts`, `server/plugins/video-result-handler.ts`, `server/api/generations/[id]/video.post.ts`, komponen `VideoResult.vue` dan `ReelsMockup.vue`, `tests/`.
- **Kode berubah**: `server/db/schema.ts` (+ migrasi keempat), `server/utils/generations.ts` (field `video` pada detail), `server/utils/generation-requests.ts`, `shared/schemas/generation.ts`, `shared/utils/file-type.ts`, `app/composables/useGenerations.ts`, `app/components/PostResult.vue`, `app/utils/studio.ts`, `design.md`, `AGENTS.md`.
- **Dependensi**: tidak ada yang baru.
- **Konfigurasi**: tidak ada key baru.
- **Database**: migrasi keempat (tiga kolom nullable), diterapkan otomatis saat server start. Baris yang sudah ada tidak berubah.
- **Media**: file baru `generations/<id>/storyboard.<ext>` dan `video.mp4`, disajikan route `/media` (dengan `Range`, wajib agar video bisa di-seek, terutama di Safari/iOS).
- **Sistem eksternal**: tidak ada yang dihubungi saat development lokal. Kualitas video dan voice over dari Gemini Omni (resminya baru dievaluasi untuk bahasa Inggris) baru teruji di VPS.
- **Referensi**: `design.md` §4.2 (Result 2), §6 (tabel), §7 (API), §8 (kontrak `video`), §9.3 (workflow), Bagian B (mockup Reels, progress stage), Bagian C (change 6).
