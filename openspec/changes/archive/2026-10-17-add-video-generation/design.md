## Context

Sudah ada dan dipakai ulang: pipeline job (`dispatchJob`, callback, registry handler dengan hook `onProgress`/`onCompleted`, timeout `video` 20 menit), kontrak n8n `video` (request, payload `completed`, tahap `script`/`storyboard`/`video`, berkas `storyboard` dan `video`), skenario mock video dengan fixture (script, storyboard, MP4 9:16 10 detik), tabel `generations` dengan status post turunan dari job, `PostResult` di Studio, dan `/media` dengan `Range`.

Yang membedakan video dari post:

- **Hasil datang bertahap.** Script dan storyboard tiba lewat event `progress` beberapa menit sebelum video, dan user harus melihatnya saat itu juga (`design.md` §4.2).
- **Biaya dan durasi besar** (~US$1, beberapa menit), sehingga klik ganda dan konfirmasi menjadi urusan serius.
- **Satu generation, beberapa percobaan.** Video yang gagal harus bisa diulang pada post yang sama tanpa meninggalkan sisa percobaan lama yang menyesatkan.
- **Berkas yang lebih besar dan berbeda jenis** (MP4 hingga 100 MB), yang harus diperiksa isinya seperti gambar.

Batasan lama tetap berlaku: satu proses Nitro, SQLite satu penulis, tipe file dari isi, path buatan server, UI berbahasa Inggris, dan tidak ada prompt AI di app.

## Goals / Non-Goals

**Goals:**

- Alur video lengkap di mode mock: konfirmasi → progres bertahap dengan storyboard tampil begitu tiba → pemutar Reels, script, unduhan; serta jalur gagal dengan Retry.
- Satu klik ganda tidak pernah membuat dua job video (dua kali biaya).
- Status video selalu benar tanpa mengubah pipeline, termasuk timeout.
- Tidak ada file yatim: percobaan ulang, hapus generation, dan hapus brand membersihkan semuanya.

**Non-Goals:**

- Membuat ulang video yang sudah jadi. Biaya ~US$1 membuat "take baru" sebaiknya sadar: user melakukan Regenerate pada post.
- Voice over lewat TTS dan penggabungan ffmpeg (fallback masa depan `design.md` §9.3), serta durasi atau rasio lain.
- Mengubah workflow n8n atau kontraknya.

## Decisions

### 1. Tiga kolom nullable, status tetap turunan

`generations` mendapat `video_script_json`, `storyboard_path`, dan `video_path` (semua nullable) lewat migrasi keempat (`ALTER TABLE … ADD COLUMN`, aman untuk baris yang ada). Seperti post, **tidak ada kolom status maupun job id**: status video diturunkan dari job `video` terbaru (`jobs.generation_id` dan `type = 'video'`, dilayani indeks `jobs_generation_idx` yang sudah ada) setelah aturan timeout.

Field baru `video` pada detail: `null` bila belum pernah ada job video; selain itu

```
video: { status: 'running' | 'completed' | 'failed', stage, error, jobId,
         script | null, storyboardUrl | null, videoUrl | null }
```

| Job `video` terbaru | `video.status` |
|---|---|
| tidak ada | `video` = `null` |
| `queued` / `running` | `running` (dengan `stage`) |
| `completed` | `completed` |
| `failed` (termasuk `timeout`) | `failed` (dengan `error`) |

`script` dan `storyboardUrl` terisi segera setelah event progress-nya diproses, jadi UI menampilkannya selama `running`. `script` di DB divalidasi dengan skema `VideoScript` yang sama saat dibaca (rusak → 500 jelas, seperti data lain).

*Alternatif*: kolom `video_status` yang direkonsiliasi. Ditolak karena alasan yang sama dengan post: penulisan saat baca dan satu sumber kebenaran lagi.

### 2. Aturan memulai video, dan satu klik tidak boleh jadi dua job

`POST /api/generations/:id/video` (tanpa body) memeriksa, berurutan:

| Keadaan | Hasil |
|---|---|
| generation tidak ada | 404 |
| post belum `completed` | 409 `The post has to be finished first` |
| ada job video `queued`/`running` | 409 `A video is already being created` |
| video sudah `completed` | 409 `This post already has a video` |
| brand tidak `ready` atau DNA hilang | 409 `The Brand DNA is not ready yet` |
| tidak ada foto yang tersisa dari pilihan awal | 409 `The photos of this post no longer exist` |
| job video terakhir `failed`, atau belum pernah ada | **boleh** |

Input ke n8n: `brand_dna`, `prompt` generation, `post: { caption, hashtags }` **dari generation saat ini** (jadi caption yang diedit user ikut, supaya pesan video konsisten dengan post yang akan dipublikasikan), `assets` (logo lalu foto pilihan awal yang masih ada, maksimal 4), sedangkan `duration_seconds: 10` dan `aspect_ratio: '9:16'` diisi oleh pembangun request (sudah ada dan divalidasi kontrak).

**Anti klik ganda tanpa kunci.** Pemeriksaan "tidak ada job video berjalan" dan pembuatan job (`dispatchJob` → `createJob`) harus terjadi dalam satu rangkaian sinkron, tanpa `await` di antaranya: satu proses Nitro dengan SQLite sinkron berarti request kedua baru berjalan setelah job pertama tercatat, lalu melihatnya dan ditolak 409. Ada komentar di kode dan tes dengan dua request serentak (`Promise.all`) yang memastikan hanya satu job lahir. Karena itu pembersihan file lama **tidak** dilakukan sebelum dispatch (itu `await`), lihat Keputusan 3.

### 3. Percobaan ulang tidak meninggalkan sisa yang menyesatkan

Saat percobaan baru dimulai (sinkron, sebelum dispatch), ketiga kolom video di-`NULL`-kan: script dan storyboard dari percobaan yang gagal tidak boleh tampil di samping percobaan baru. Berkasnya tidak dihapus di titik itu; handler yang menggantinya:

- video selalu `video.mp4` (ditimpa);
- storyboard memakai ekstensi dari isinya (`storyboard.<ext>`), dan handler menghapus saudaranya yang berekstensi lain, sehingga tidak ada berkas lama tersisa walau tipenya berubah antara percobaan;
- sisa dari percobaan yang gagal sebelum sempat menulis apa pun tidak ada.

Hapus generation dan hapus brand sudah menghapus folder `generations/<id>/`, sehingga semuanya ikut bersih.

### 4. Result handler `video`: progres menyimpan hasil antara

`createVideoResultHandler({ db, mediaDir, now })`, didaftarkan Nitro plugin untuk `video`.

- **`onProgress`**: bila `files.storyboard` ada → validasi isi sebagai gambar (PNG/JPEG/WebP) lalu simpan `storyboard.<ext>` dan isi `storyboard_path`. Bila `payload` untuk tahap `script` lolos `VideoCompleted` → simpan script. Tahap `video` tidak menyimpan apa pun. Payload script yang tidak valid sudah menggagalkan job di pipeline.
- **`onCompleted`**: simpan script dari payload (versi final menggantikan versi progres), simpan storyboard bila baru dikirim di sini ("bila belum dikirim di progress"), lalu video: isi harus MP4 (Keputusan 5), disimpan sebagai `video.mp4`, dan `video_path` diisi.
- Semua langkah: generation harus ada (hilang → melempar, job menjadi `failed` dengan `handler_failed`), berkas ditulis sebelum baris diperbarui, dan bila baris tidak berubah (dihapus di tengah jalan) berkas dihapus lagi dan error dilempar. Gambar atau video yang bukan tipenya melempar tanpa menulis apa pun.
- Idempoten: event progress ganda menulis hal yang sama.
- Callback dari job lama tidak bisa menimpa percobaan baru: pipeline mengabaikan callback untuk job yang sudah final, dan percobaan baru hanya boleh dimulai setelah yang lama final (Keputusan 2).

### 5. MP4 ikut dikenali oleh util tipe file bersama

`shared/utils/file-type.ts` mengenali MP4 dari `ftyp` pada byte 4–8 (kotak pertama ISO BMFF; `video/mp4`, `.mp4`). Tipe `FileType` bertambah `'mp4'`; `ImageType` mengecualikan `pdf` dan `mp4`, sehingga `isImageType` tetap `false` untuk keduanya dan semua kode gambar atau PDF yang ada tidak berubah perilaku. Hanya satu bentuk kontainer yang diterima (MP4); WebM dan lainnya ditolak, karena Omni mengembalikan MP4 dan pemutar Safari/iOS butuh MP4.

### 6. Struktur kode

```
shared/schemas/generation.ts     + VideoDto, VIDEO_COST_LABEL; GenerationDetail.video
server/db/schema.ts              + tiga kolom pada generations (+ migrasi keempat)
server/utils/generations.ts      detail memuat video (latestVideoJob, deriveVideo)
server/utils/video-generation.ts createVideo (aturan, input, reset, dispatch)
server/utils/video-result.ts     createVideoResultHandler
server/utils/generation-requests.ts  + handler video
server/plugins/video-result-handler.ts
server/api/generations/[id]/video.post.ts
app/components/VideoResult.vue   Result 2 (4 keadaan)
app/components/ReelsMockup.vue   frame 9:16
app/composables/useGenerations.ts + createVideo
app/utils/studio.ts              unduhan (nama file video/storyboard), pesan gagal video
```

Pola tetap: service murni dengan dependensi eksplisit, `GenerationError` (`conflict` untuk semua penolakan di Keputusan 2), route tipis.

### 7. UI Result 2

`VideoResult` tampil di bawah aksi post, hanya bila post `completed`, menerima `detail` dari `PostResult` dan meminta muat ulang lewat event `refresh`. Empat keadaan:

- **Belum ada**: kartu "Turn this post into a 10-second Reel" dengan tombol **Generate Video** berlabel `~$1`. Mengklik membuka `ConfirmDialog` ("About $1 and a few minutes. The video is created from this post and its photos.") dengan tombol **Generate video**; hanya konfirmasi yang memanggil API.
- **Berjalan**: langkah `Script → Storyboard → Video` (titik, garis, langkah aktif oranye berdenyut, Bagian B) dari `useJobPolling` pada job video (**4 detik**, `design.md` §2). Setiap kali tahap berubah dan saat job final, `VideoResult` meminta `refresh`, sehingga storyboard dan script yang baru tiba langsung tampil selama video dirender. `PostResult` memuat ulang detail tanpa menyentuh editor caption yang sedang terbuka (pemuatan ini hanya mengganti `detail`, tidak mereset state edit).
- **Selesai**: `ReelsMockup` (frame 9:16, radius 28px, `<video controls playsinline preload="metadata">` dengan `object-cover`, gradien bawah berisi handle dan potongan caption, digeser di atas bilah kontrol bawaan agar kontrol tetap bisa diklik), script yang bisa dilipat (`<details>`: tiap scene dengan rentang waktu, visual, teks layar, dan voice over), **Download video**, dan **Download storyboard** (storyboard juga ditampilkan sebagai gambar).
- **Gagal**: kartu dengan pesan ramah (`friendlyVideoError`, tanpa kode atau status mentah) dan **Retry**, yang membuka dialog biaya yang sama. Script atau storyboard yang sempat tiba sebelum gagal tidak ditampilkan di kartu ini (pesan dan Retry sudah cukup, dan hasil setengah jadi hanya membingungkan). Keduanya tetap tersimpan dan ikut di detail API sampai percobaan baru dimulai, saat itu dikosongkan (Keputusan 3).

Pada layar sempit frame Reels dibatasi lebarnya (maks sekitar 320px) dan tidak pernah melebihi layar.

### 8. Mock mode

Skenario video yang ada dipakai apa adanya (script, storyboard, video, completed; total ±9 detik). Untuk mendemokan kegagalan video, teks `mock:fail` cukup ada di salah satu input request; prompt post yang berisi `mock:fail` sudah menggagalkan postnya sendiri, jadi cara yang benar-benar menguji video adalah **menulis `mock:fail` di caption** (lewat Edit caption) lalu Generate Video, karena caption ikut terkirim. Ini dicatat di `AGENTS.md`. Mock tidak diubah.

### 9. Strategi pengujian

- Unit: `sniffFileType` MP4 (termasuk tidak mengubah hasil untuk tipe lain), skema `VideoDto`, `friendlyVideoError`, nama file unduhan.
- Service (SQLite + media sementara, `dispatch` palsu): semua baris tabel aturan Keputusan 2, input yang dikirim (caption hasil edit, aset, foto basi disaring), reset kolom saat retry, dua request serentak menghasilkan satu job, status turunan (running dengan tahap, failed, timeout 20 menit, `null`).
- Handler lewat `applyJobCallback` nyata: script dan storyboard tersimpan saat progres (ekstensi dari isi, saudara berekstensi lain dihapus), video disimpan setelah dicek MP4, storyboard yang baru dikirim saat `completed`, bukan MP4 atau bukan gambar → job `failed` tanpa perubahan dan tanpa berkas, generation dihapus di tengah jalan → `failed` tanpa berkas yatim, event progres ganda idempoten.
- HTTP (harness yang ada): endpoint dan semua kode status, field `video` pada detail, berkas video dan storyboard tersaji lewat `/media` (video dengan `Range` 206).
- E2E mock level service: video sampai `completed` dengan pengamatan tahap satu per satu (jeda dikendalikan), dan `mock:fail` di caption sampai `failed`, lalu Retry sampai `completed`.
- Browser (Playwright, dev dan build produksi, mock): konfirmasi biaya (Batal tidak memanggil API), progres dengan storyboard muncul sebelum video, pemutar (metadata video terbaca, `Range` dilayani), script dilipat dan dibuka, kedua unduhan, gagal lalu Retry, dan mobile 375px.

## Risks / Trade-offs

- **[Biaya ~US$1 per klik]** → dialog konfirmasi, tombol nonaktif selama request, 409 untuk video yang berjalan atau sudah jadi, dan pemeriksaan serta pembuatan job tanpa celah (Keputusan 2). Tidak ada anggaran harian di server (sama seperti post; ditangguhkan).
- **[Tidak ada "buat ulang video yang sudah jadi"]** user yang kurang puas harus Regenerate post → itu sengaja: mencegah biaya tak sengaja. Mudah dibuka nanti dengan melonggarkan satu aturan dan menambah konfirmasi.
- **[Pemeriksaan serentak bergantung pada tidak adanya `await`]** → dikunci dengan komentar dan tes dua request serentak, yang gagal bila seseorang menyisipkan `await`.
- **[Kolom di-NULL-kan saat retry sementara berkasnya tersisa]** → handler menimpa `video.mp4` dan menghapus saudara storyboard berekstensi lain; hapus generation membersihkan sisanya.
- **[MP4 hingga 100 MB di memori saat callback]** → batas sudah ada di pipeline (`readMultipartFormData`); aman untuk skala ini (video 10 detik 720p hanya beberapa MB).
- **[Hanya MP4 yang diterima]** hasil berformat lain gagal dengan jelas (`handler_failed`) → sesuai kontrak Omni.
- **[Kualitas voice over bahasa Indonesia tidak dijamin Google]** dan gambar dengan orang yang dikenal publik ditolak API → urusan workflow n8n dan terlihat sebagai job `failed` dengan alasannya; baru teruji di VPS.
- **[Polling 4 detik per video yang berjalan]** → ringan (SQLite lokal), satu pemilik (`VideoResult`), berhenti sendiri saat job final atau komponen dibuang.
- **[Mode live belum teruji]** → kontrak, handler, dan jalur gagal teruji lokal; pengunduhan aset dan Gemini baru di VPS.

## Migration Plan

1. Tambah tiga kolom ke `server/db/schema.ts`, `pnpm db:generate` menghasilkan migrasi keempat (`ALTER TABLE … ADD COLUMN`), diterapkan migrator saat start. Smoke test `pnpm build && pnpm preview` memastikan folder migrasi terbaca dan baris lama tetap utuh.
2. Tidak ada rollback data: kolom baru nullable dan belum berisi apa pun. Mengembalikan change cukup menghapus migrasi sebelum dipakai.

## Open Questions

- Biaya "~$1" mengikuti perkiraan `design.md` §3 (Omni ±US$0,10 per detik × 10 detik, ditambah teks dan satu gambar). Angkanya satu konstanta (`VIDEO_COST_LABEL`) dan perlu dicek ulang saat deploy.
- Bila nanti dibutuhkan, "buat ulang video" cukup menambah satu pintu 409 yang dilonggarkan beserta konfirmasi biaya; tidak mengubah struktur data.
