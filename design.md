# design.md — Aladin

Dokumen desain teknis dan visual. Bagian A membahas sisi teknis (arsitektur, data, kontrak n8n, deploy). Bagian B membahas design system UI. Bagian C berisi rencana change OpenSpec.

---

# Bagian A — Teknis

## 1. Scope

**Masuk scope (MVP)**

- Multi-brand. Setiap brand punya Brand DNA yang bisa diedit, logo, dan koleksi foto produk.
- Brand DNA dibuat dari URL website **atau** PDF (atau dibuat manual dari nol).
- Studio: prompt → Result 1 (caption + gambar feed single image) → Result 2 (video Reels 9:16, 10 detik, dengan voice over).
- Riwayat generate per brand, ditampilkan di sidebar Studio.
- Mock mode untuk development tanpa n8n dan tanpa biaya API.

**Di luar scope**

- Auth user, multi-user, role.
- Auto-post / penjadwalan ke Instagram.
- Carousel, Story, platform selain Instagram.
- Edit gambar/video di dalam app (selain edit caption).
- Memanggil API AI langsung dari app.

## 2. Arsitektur

```
Browser ──HTTPS──> Traefik ──(BasicAuth)──> aladin:3000 (Nuxt/Nitro + SQLite + data/media)
                                               │  ▲
                        POST webhook (job)     │  │  POST callback (progress/completed/failed)
                        http://n8n:5678/webhook│  │  http://aladin:3000/api/n8n/callback
                                               ▼  │
                                         n8n:5678 ──HTTPS──> Gemini API (Interactions API)
                                               │
                         GET aset (foto/PDF)   └──> http://aladin:3000/api/internal/assets/:id
```

App dan n8n berkomunikasi lewat **network Docker internal** `n8n-compose_default`, tidak lewat domain publik. Akibatnya, BasicAuth di Traefik tidak menghalangi n8n.

Diagram di atas hanya berlaku di **production (VPS)**.

### Dev vs prod

| | Lokal (dev) | VPS (prod) |
|---|---|---|
| App | `pnpm dev`, tanpa Docker, Node 22 | Docker di belakang Traefik |
| n8n (dari app) | tidak dihubungi, `n8nMode = mock` | `live`, `http://n8n:5678` (mock dulu di change 7) |
| Tes live | tidak ada (untuk app) | tes e2e penuh, dengan workflow dibuat dan diuji lewat MCP n8n |

n8n di `https://n8n.serdadu.dev` tidak bisa memanggil balik app di laptop (callback dan download aset butuh alamat yang terjangkau). Keputusan: **tidak memakai tunnel, dan app di laptop tidak pernah menghubungi n8n**. Lokal bekerja sepenuhnya dengan mock mode dan fixture (change 1–6).

Mulai change 7, app naik di VPS dan menjadi penerima callback. Workflow n8n dibuat dan diuji oleh Claude Code lewat **MCP n8n** (OAuth, dari laptop); app lokal tidak terlibat. Semua yang bergantung pada n8n asli (workflow, kualitas hasil Gemini, voice over) diverifikasi di change 8 dan 9.

### Pola job + callback

1. UI memanggil API app (mis. `POST /api/generations`).
2. App membuat baris `jobs` (status `queued`), lalu POST ke webhook n8n dengan `job_id`, `callback_url`, dan data input. Kalau n8n membalas 2xx, status menjadi `running`. Kalau gagal, langsung `failed`.
3. n8n membalas webhook segera ("Respond Immediately"), lalu memproses di belakang.
4. Selama proses, n8n boleh mengirim callback `event=progress` (mis. storyboard sudah jadi).
5. Di akhir, n8n mengirim callback `event=completed` (beserta file) atau `event=failed`.
6. UI melakukan polling `GET /api/jobs/:id` (interval 2 detik untuk post/brand, 4 detik untuk video) sampai status final.

### Timeout job

Dicek secara lazy saat `GET /api/jobs/:id` dan saat list. Jika `running` melewati batas, job ditandai `failed` dengan error `timeout`.

| Tipe job | Timeout |
|---|---|
| `brand_extract` | 5 menit |
| `post` | 5 menit |
| `video` | 20 menit |

### Mock mode (`NUXT_N8N_MODE=mock`, default)

Mock adalah default `runtimeConfig.n8nMode`, sehingga lokal aman tanpa konfigurasi. Production mengisi `live` secara eksplisit lewat docker-compose.

`server/utils/n8n-client.ts` tidak memanggil n8n. Sebagai gantinya, ia menjadwalkan simulasi (setTimeout di proses Nitro) yang memanggil fungsi handler callback yang sama dengan file dari `server/fixtures/` (brand DNA contoh, gambar post contoh, storyboard contoh, video contoh), lengkap dengan event progress. Tujuannya agar seluruh UI bisa dikerjakan dan didemokan tanpa biaya.

## 3. Platform AI dan biaya

Semua dari Google, cukup lewat **Google AI Studio** (Gemini API). Status per 16 Oktober 2026 (cek ulang di halaman pricing resmi saat implementasi, karena model dan harga sering berubah):

| Kegunaan | Model (ID) | Free tier | Perkiraan biaya |
|---|---|---|---|
| Ekstraksi Brand DNA, caption, script storyboard | Gemini 3.8 Flash (`gemini-3.8-flash`) | Ya, tetapi tidak berlaku di project berbilling (anggap berbayar) | ~US$0.03–0.05 per ekstraksi brand, ~US$0.006 per caption atau script ($0.75 / $3.75 per 1M token) |
| Gambar post + gambar storyboard | Nano Banana 2.1 (`gemini-nano-banana-2.1`) | Tidak | ~US$0.034 per gambar 1K |
| Video iklan 10 detik + audio | Gemini Omni Flash (`gemini-omni-1.1-flash`) | Tidak | ~US$0.10 per detik, jadi ~US$1 per video 10 detik (720p) |

Perkiraan per sekali jalan:

- **Post** (1 teks + 1 gambar): ~US$0.04
- **Video** (1 teks + 1 storyboard + 1 video): ~US$1.05

**API key**: satu key dari satu project berbilling (`Default Gemini Project`), dipakai untuk teks, gambar, dan video. Billing memakai **prepay** (Tier 1, auto-reload mati), jadi tidak ada tagihan kejutan. Biaya teks hanya sen per panggilan, dan keuntungannya data tidak dipakai Google untuk meningkatkan produknya (berbeda dengan free tier).

Konsekuensi satu key satu saldo: kalau saldo prepay habis, API membalas **HTTP 402** dan semua panggilan berhenti, termasuk ekstraksi brand. Saldo non-refundable dan kedaluwarsa setahun setelah pembelian. Pengaman: pasang *Monthly spend cap* di halaman Spend AI Studio, biarkan auto-reload mati, dan cek saldo sebelum sesi tes video.

Key disimpan sebagai **credential di n8n**, tidak pernah di app.

Semua panggilan memakai **Interactions API** (`POST https://generativelanguage.googleapis.com/v1beta/interactions`, header `x-goog-api-key`) lewat node HTTP Request biasa di n8n, karena `generateContent` sudah berstatus legacy dan node bawaan n8n belum tentu mendukung Omni.

## 4. Halaman dan UX

Hanya dua halaman. Brand yang aktif disimpan di query `?brand=<id>`, dengan fallback ke cookie `last_brand_id`.

### 4.1 `/brand-dna` — Halaman Brand DNA

**Header**: brand switcher (dropdown) + tombol **New Brand**.

**Dialog New Brand** punya tiga tab:

- **Website**: input URL.
- **PDF**: upload file (maks 20 MB).
- **Manual**: hanya nama brand, lalu semua field diisi sendiri.

Untuk Website/PDF, brand langsung dibuat dengan status `extracting`, dan halaman menampilkan skeleton + teks status sampai job selesai.

**Tampilan brand** (meniru layout Spira, lihat Bagian B):

1. Hero card: inisial/logo, nama, link website, dan di kanan "Product Summary".
2. Baris 3 kartu: **Logo** (upload/ganti), **Font** (chip), **Color** (swatch + hex).
3. **Product Photos**: grid thumbnail, upload multiple, hapus, beri label. Ini input wajib untuk post dan video yang menampilkan produk asli.
4. **Brand Tagline** dan **Tone of Voice**.
5. **Target Audience** (audience, region, pain points).
6. **Prioritized Features**: Tier 1 Anchor, Tier 2 Supporting, Tier 3 Variety.
7. **Key Benefits** dan **Product Features** (list).
8. **Content Rules**: kata yang dipakai/dihindari, level emoji, CTA default, hashtag default.

**Mode edit**: setiap kartu punya tombol pensil, edit inline, lalu **Save** (PATCH seluruh DNA). Ada tombol **Re-extract** (konfirmasi dulu karena akan menimpa field) dan **Delete brand**.

### 4.2 `/studio` — Halaman Studio

**Layout**: sidebar kiri berisi navigasi + **History** brand aktif (thumbnail, potongan prompt, waktu). Konten utama di tengah (max-width ~720px), meniru Social Studio Spira.

**Composer card**:

- Baris atas: "CREATE WITH" + brand switcher.
- Textarea "Tell your agent what you want to post about."
- Picker foto produk (thumbnail dari brand, multi-select maks 3; default foto pertama).
- Toggle rasio gambar: **1:1** / **4:5** (default 4:5).
- Tombol primary **Generate Post** dengan label biaya kecil (~$0.04).

**Result 1 — Post** ("This is what your followers will see"):

- Mockup post Instagram: avatar (logo brand), handle, gambar, ikon aksi, lalu caption + hashtag.
- Aksi: **Copy caption**, **Edit caption** (inline, disimpan), **Download image**, **Regenerate** (membuat generation baru dengan prompt yang sama).

**Result 2 — Video** (muncul setelah Result 1 selesai):

- Tombol **Generate Video** (~$1) dengan dialog konfirmasi biaya.
- Progress bertahap: `Script → Storyboard → Video`. Storyboard ditampilkan begitu event progress-nya datang.
- Hasil: player video di dalam mockup layar Reels 9:16, script (scene + VO + teks visual) yang bisa dicollapse, tombol **Download video**, **Download storyboard**.

**State gagal**: kartu menampilkan pesan error yang ramah + tombol **Retry**.

## 5. Brand DNA

### 5.1 Kenapa field-field ini

Field dipilih berdasarkan **apa yang benar-benar dipakai saat generate**. Field yang tidak memengaruhi caption, gambar, atau video tidak dimasukkan (mis. "distribution/persona binding" di Spira dibuang).

| Kelompok | Dipakai untuk |
|---|---|
| Identity (nama, summary, tagline, kategori, handle IG) | Konteks dasar semua prompt, handle di mockup |
| Audience (target, region, pain points) | Sudut pandang hook caption dan skenario video |
| Voice (tone, sapaan, bahasa, emoji, kata dipakai/dihindari) | Gaya caption dan voice over |
| Offer (benefit, fitur berprioritas, CTA, promo) | Isi pesan. Fitur Tier 1 diutamakan, Tier 2/3 diselingi agar konten bervariasi |
| Visual (warna, font, kata kunci gaya, larangan visual) | Prompt gambar dan storyboard agar konsisten dengan brand |
| Social (hashtag default) | Ditambahkan ke caption |
| Aset (logo, foto produk) | Referensi gambar agar produk asli yang muncul, bukan produk karangan AI |

### 5.2 Skema (Zod, `shared/schemas/brand-dna.ts`)

```ts
const Feature = z.object({
  name: z.string(),
  description: z.string(),
  tier: z.enum(["anchor", "supporting", "variety"]),
});

export const BrandDNA = z.object({
  identity: z.object({
    name: z.string().min(1),
    website: z.string().url().optional(),
    tagline: z.string().optional(),
    summary: z.string(),                 // 2–5 kalimat
    category: z.string().optional(),     // mis. "browser extension", "minuman"
    instagramHandle: z.string().optional(),
  }),
  audience: z.object({
    targetAudience: z.string(),
    region: z.string().optional(),       // mis. "Indonesia"
    painPoints: z.array(z.string()).default([]),
  }),
  voice: z.object({
    toneOfVoice: z.string(),
    addressing: z.enum(["kamu", "Anda", "kalian", "lo"]).default("kamu"),
    contentLanguage: z.enum(["id", "en"]).default("id"),
    emojiLevel: z.enum(["none", "light", "heavy"]).default("light"),
    wordsToUse: z.array(z.string()).default([]),
    wordsToAvoid: z.array(z.string()).default([]),
  }),
  offer: z.object({
    keyBenefits: z.array(z.string()).default([]),
    features: z.array(Feature).default([]),
    featureSamplingGuidance: z.string().optional(),
    defaultCta: z.string().optional(),   // mis. "Install gratis di Chrome"
    priceOrPromo: z.string().optional(),
  }),
  visual: z.object({
    colors: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).default([]),
    fonts: z.array(z.string()).default([]),
    styleKeywords: z.array(z.string()).default([]),   // mis. "natural light", "minimalis"
    avoid: z.array(z.string()).default([]),           // mis. "tanpa orang", "tanpa neon"
  }),
  social: z.object({
    defaultHashtags: z.array(z.string()).default([]),
  }),
  notes: z.string().optional(),          // catatan bebas dari user
});
```

Logo dan foto produk **tidak** disimpan di JSON ini, melainkan di tabel `brand_assets`.

Hasil ekstraksi untuk warna, font, dan logo bersifat **best-effort**. Semuanya bisa diedit manual.

## 6. Data model (SQLite + Drizzle)

```
brands
  id               text pk (nanoid)
  name             text not null
  source_type      text  -- 'url' | 'pdf' | 'manual'
  source_url       text null
  source_asset_id  text null   -- PDF yang diupload (brand_assets.kind='source_pdf')
  dna_json         text null   -- BrandDNA, divalidasi Zod saat baca/tulis
  status           text  -- 'extracting' | 'ready' | 'failed'
  created_at, updated_at  integer (unix ms)

brand_assets
  id, brand_id (fk, cascade)
  kind             text  -- 'logo' | 'product_photo' | 'source_pdf'
  path             text  -- relatif terhadap MEDIA_DIR
  mime, size_bytes, label (null)
  sort_order       integer
  created_at

generations                -- satu baris per prompt di Studio
  id, brand_id (fk, cascade)
  prompt           text
  aspect_ratio     text  -- '1:1' | '4:5'
  asset_ids_json   text  -- foto produk yang dipilih
  caption          text null
  hashtags_json    text null
  image_path       text null
  created_at, updated_at
  -- Tidak ada kolom status maupun job id: jobs.generation_id sudah menghubungkan keduanya, dan
  -- status diturunkan dari job saat dibaca (lihat add-post-generation).
  video_script_json text null   -- script dari n8n (progress stage 'script' atau hasil akhir)
  storyboard_path   text null   -- generations/<id>/storyboard.<ext>, tampil sebelum video selesai
  video_path        text null   -- generations/<id>/video.mp4
  -- Status video juga diturunkan: dari job 'video' terbaru untuk generation itu (tanpa job = belum ada video).

jobs
  id, type         text  -- 'brand_extract' | 'post' | 'video'
  brand_id, generation_id (null)
  status           text  -- 'queued' | 'running' | 'completed' | 'failed'
  stage            text null  -- mis. 'crawling', 'script', 'storyboard', 'video'
  error            text null
  created_at, started_at, finished_at, updated_at
```

### Lokasi file

```
data/
  aladin.db
  media/
    brands/<brandId>/logo-<id>.png
    brands/<brandId>/products/<id>.jpg
    brands/<brandId>/source/<id>.pdf
    generations/<generationId>/post.png
    generations/<generationId>/storyboard.png
    generations/<generationId>/video.mp4
```

Semua file disajikan lewat `GET /media/<path>` (Nitro route `server/routes/media/[...path].get.ts`). Route ini wajib mendukung header `Range` (respons 206), karena player video, terutama Safari/iOS, butuh Range untuk memutar dan melakukan seek.

## 7. API app

Semua endpoint adalah Nitro event handler di `server/api/` (nama file mengikuti method, mis. `server/api/brands/[id].patch.ts`). Upload dan callback dibaca dengan `readMultipartFormData`, dan body JSON divalidasi dengan `readValidatedBody` + Zod.

| Method & path | Fungsi |
|---|---|
| `GET /api/brands` | List brand (id, nama, status, sumber, `logoUrl`, `updatedAt`), terbaru dulu |
| `POST /api/brands` | multipart: `source_type` + (`url` \| `file` \| `name`). Membuat brand, dan job `brand_extract` bila perlu. 201; 400 input salah; 413 terlalu besar |
| `GET/PATCH/DELETE /api/brands/:id` | Detail (+ `extraction` bila `extracting`/`failed`), ganti seluruh DNA (409 saat `extracting`), hapus (204, beserta file) |
| `POST /api/brands/:id/re-extract` | Job ekstraksi ulang dari sumber yang sama (400 untuk brand manual, 409 bila sedang `extracting`) |
| `POST /api/brands/:id/assets` | multipart `kind` (`logo` \| `product_photo`) + `files`; jpg/png/webp dideteksi dari isi, maks 10 MB/file, maks 20 foto, semua-atau-tidak |
| `PATCH/DELETE /api/brands/:id/assets/:assetId` | Ubah label/urutan, hapus |
| `GET /api/generations?brandId=` | History brand (wajib `brandId`, terbaru dulu, maks 100) |
| `POST /api/generations` | JSON `{ brandId, prompt, aspectRatio, assetIds }`, membuat generation + job `post`. 201; 400 input salah (prompt, rasio, 1–3 foto milik brand); 404 brand tidak ada; 409 brand belum `ready` |
| `GET /api/generations/:id` | Detail (caption, hashtag, `imageUrl`, status, stage, error, `jobId`, dan `video`: null atau `{ status, stage, error, jobId, script, storyboardUrl, videoUrl }`) |
| `PATCH /api/generations/:id` | Edit caption (1–2200) dan/atau hashtag (maks 30), hanya setelah post selesai (409 sebelum itu) |
| `DELETE /api/generations/:id` | Hapus generation beserta filenya (204) |
| `POST /api/generations/:id/video` | Membuat job `video` (biaya ~US$1; UI meminta konfirmasi dulu). 201 dengan detail generation; 404 tidak ada; 409 bila post belum selesai, video sedang dibuat atau sudah selesai, brand/DNA belum siap, atau foto post sudah terhapus semua. Video yang `failed` boleh diulang (kolom video dikosongkan, job baru) |
| `GET /api/jobs/:id` | Status + stage + error (+ cek timeout) |
| `POST /api/n8n/callback` | Callback dari n8n (wajib header secret) |
| `GET /api/internal/assets/:id` | Download aset untuk n8n (wajib header secret) |
| `GET /media/[...path]` | Serve file media (dengan dukungan `Range`) |

## 8. Kontrak n8n

Semua payload didefinisikan di `shared/schemas/n8n-contracts.ts` (Zod) dan harus sama persis dengan yang dipakai di workflow.

### 8.1 App → n8n (webhook)

- URL: `<N8N_BASE_URL>/webhook/<path>`, path = `aladin-brand-extract` | `aladin-post-generate` | `aladin-video-generate`.
- Header: `X-Aladin-Secret: <SHARED_SECRET>`. Node Webhook n8n memakai Header Auth.
- Body JSON:

```jsonc
// umum
{
  "job_id": "job_xxx",
  "callback_url": "http://aladin:3000/api/n8n/callback",
  "asset_base_url": "http://aladin:3000/api/internal/assets"
}

// aladin-brand-extract
{ ...umum, "source_type": "url", "url": "https://remindeen.serdadu.dev" }
{ ...umum, "source_type": "pdf", "pdf_asset_id": "ast_xxx" }

// aladin-post-generate
{
  ...umum,
  "brand_dna": { /* BrandDNA */ },
  "prompt": "promo ramadan, fokus fitur countdown",
  "aspect_ratio": "4:5",
  "assets": [
    { "id": "ast_logo", "kind": "logo", "mime": "image/png" },
    { "id": "ast_p1", "kind": "product_photo", "mime": "image/jpeg", "label": "botol depan" }
  ]
}

// aladin-video-generate
{
  ...umum,
  "brand_dna": { /* BrandDNA */ },
  "prompt": "...",
  "post": { "caption": "...", "hashtags": ["..."] },   // untuk konsistensi pesan
  "assets": [ /* sama seperti di atas */ ],
  "duration_seconds": 10,
  "aspect_ratio": "9:16"
}
```

n8n mengunduh file lewat `GET {asset_base_url}/{id}` dengan header secret yang sama.

### 8.2 n8n → App (callback)

- `POST {callback_url}`, header `X-Aladin-Secret`, `multipart/form-data`.
- Field:
  - `job_id` (wajib)
  - `event`: `progress` | `completed` | `failed`
  - `stage`: opsional
  - `payload`: string JSON, isinya tergantung tipe
  - `error`: hanya untuk failed
- File opsional: `logo`, `image`, `storyboard`, `video`.

| Job | `completed.payload` | File |
|---|---|---|
| brand_extract | `{ "brand_dna": BrandDNA }` | `logo` (opsional) |
| post | `{ "caption": string, "hashtags": string[], "image_brief": object }` | `image` |
| video | `{ "script": { "scenes": [{ "start": 0, "end": 2, "visual": "...", "on_screen_text": "...", "voice_over": "..." }] } }` | `video` (+ `storyboard` bila belum dikirim di progress) |

Event `progress` untuk video: `stage=script` (payload berisi script), `stage=storyboard` (file `storyboard`), `stage=video` (sedang render).

**Aturan handler**:

- Secret salah → 401.
- `job_id` tidak dikenal → 404.
- Job sudah final → 200 tanpa perubahan (idempotent).
- Payload tidak valid → job `failed` dengan error validasi, lalu 200.

## 9. Template workflow n8n (3 workflow)

Dibuat dan diperbarui oleh Claude Code lewat **MCP n8n** (`create_workflow_from_code`, `update_workflow`) memakai `@n8n/workflow-sdk`. Sumber kebenaran di repo adalah **kode SDK** di `n8n/workflows/`, bukan JSON export (bentuk file dan cara menjalankannya ditetapkan di awal change 8). Semua workflow Aladin berawalan `aladin-`. Tidak ada folder khusus di n8n, jadi awalan nama itulah batasnya.

Credential dibuat manual oleh user di UI n8n. Claude Code tidak pernah melihat secret, hanya mencari ID-nya lewat `list_credentials`:

- `Google AI` (Header Auth `x-goog-api-key`, key dari project berbilling, lihat §3)
- `Aladin Secret` (Header Auth `X-Aladin-Secret`, nilainya sama dengan `SHARED_SECRET` di `.env` VPS)

**Pagar MCP.** Instance n8n dipakai bersama dan memuat workflow produksi lain (mis. yang aktif). Claude Code hanya boleh membuat, mengubah, menjalankan, dan mempublikasikan workflow `aladin-*`. Toggle *Available in MCP* dimatikan lagi untuk workflow non-Aladin (terutama yang aktif) setelah selesai dibaca. Jangan men-unpublish, meng-archive, atau mengubah workflow lain, dan jangan memakai credential milik orang lain.

**Tangga tes** (murah ke mahal): `validate_workflow` → `test_workflow` dengan pin data (HTTP dan credential di-pin, tanpa biaya) → `execute_workflow` manual dengan payload webhook (kena biaya Gemini, `callback_url` ke app di VPS) → generate dari UI app. Naik satu anak tangga hanya setelah yang sebelumnya lolos.

Setiap node yang berisiko gagal memakai **"On Error → Continue (using error output)"** yang diarahkan ke node **Report Failure** (callback `event=failed`).

### 9.1 `aladin-brand-extract`

1. Webhook (Header Auth, respond immediately).
2. Switch berdasarkan `source_type`.
3. **URL**: HTTP GET halaman utama → ambil `<head>` (meta, theme-color, link font, og:image/icon) + konversi body ke Markdown → pilih maksimal 3 link internal yang relevan (about/features/pricing/product) → ambil juga → gabungkan teks (potong ke batas aman).
4. **PDF**: download dari `asset_base_url` → kirim PDF langsung ke Gemini sebagai input dokumen (Gemini bisa membaca PDF, termasuk hasil scan, tanpa langkah ekstraksi teks).
5. Gemini 3.8 Flash dengan **structured output** (JSON schema = BrandDNA) + instruksi:
   - Jangan mengarang.
   - Kosongkan field yang tidak ada di sumber.
   - Tulis dalam bahasa Indonesia, kecuali nama produk.
   - Tetapkan tier fitur.
6. (URL) Download kandidat logo (og:image / apple-touch-icon / favicon) bila ada.
7. Callback `completed`.

**Batasan**: website berbasis JavaScript (SPA) bisa menghasilkan teks sedikit. Dalam kasus itu, hasilnya akan tipis. User bisa melengkapi manual atau memakai PDF.

### 9.2 `aladin-post-generate`

1. Webhook.
2. Download aset (logo + foto produk).
3. Gemini 3.8 Flash (structured output) menghasilkan:
   - `caption` (hook di baris pertama, mengikuti voice, CTA default)
   - `hashtags` (gabungan default + relevan, maks ~8)
   - `image_brief`: `headline` maks ~8 kata, `subheadline`, `chips` maks 3, `scene` (deskripsi foto/latar), `layout_notes`

   Aturan: utamakan fitur tier anchor, ambil 1 fitur supporting/variety secara bergantian.
4. Nano Banana 2.1 menerima foto produk + logo sebagai referensi, `image_brief`, warna/gaya brand, dan aspect ratio. Instruksinya: produk harus identik dengan foto referensi, dan teks di gambar persis sesuai headline/chips. Gaya yang dituju: iklan feed seperti contoh Spira (headline besar, chip fitur, logo kecil di bawah).
5. Callback `completed` (payload + file `image`).

### 9.3 `aladin-video-generate` (meniru alur tutorial)

Alur di video tutorial:

1. Foto produk dimasukkan ke ChatGPT dengan prompt "buatkan gambar storyboard iklan komersial, lengkap dengan voice over dan visual text, durasi 10 detik, 9:16". Hasilnya satu gambar grid 6 panel, berisi visual, teks layar, dan VO per detik.
2. Di Google Flow, mode Video, model **Omni 1.1 Flash**, 9:16, 720p, 10 detik, foto produk + storyboard dimasukkan sebagai bahan, dengan prompt "buatkan video iklan komersial berdasarkan storyboard dan foto produk, lengkap dengan voice over durasi 10 detik".

Versi otomatisnya:

1. Webhook → download aset.
2. **Script**: Gemini 3.8 Flash (structured output) membuat 5–6 scene dengan timecode (`[0-2s]`, `[2-4s]`, …), visual, teks di layar (pendek, bahasa Indonesia), dan VO total kira-kira 20–25 kata. Callback `progress stage=script`.
3. **Storyboard**: Nano Banana 2.1 membuat satu gambar grid storyboard (2×3, 9:16 per panel) dari foto produk + script. Callback `progress stage=storyboard` (file `storyboard`).
4. **Video**: Gemini Omni Flash (`gemini-omni-1.1-flash`) dengan input foto produk + storyboard + teks prompt. Pengaturan:
   - `response_format`: `{ type: "video", aspect_ratio: "9:16", resolution: "720p" }`
   - Prompt memakai tag referensi (`<IMAGE_REF_0>` produk, `<IMAGE_REF_1>` storyboard) dan timecode dari script
   - Instruksi agar storyboard dipakai sebagai panduan, bukan ditampilkan
   - Deskripsi audio: VO bahasa Indonesia sesuai script + musik latar
   - Panggil dengan **background execution**, lalu polling `GET /v1beta/interactions/{id}` dengan node Wait (setiap ~15 detik, maks ~15 menit). Video diambil dari `steps[].content[]` bertipe `video`.

   Callback `progress stage=video` saat mulai render.
5. Callback `completed` (payload script + file `video`).

**Catatan risiko video**:

- Kualitas VO bahasa Indonesia belum dijamin oleh Google (Omni resmi baru dievaluasi untuk bahasa Inggris), meskipun tutorial menunjukkan hasilnya bisa bagus.
- Gambar yang memuat orang yang dikenali publik ditolak oleh API.
- **Fallback di masa depan** (bukan MVP): video tanpa dialog + VO dari Gemini TTS (free tier) + gabung dengan ffmpeg.

## 10. Keamanan

- **Traefik BasicAuth** di router `aladin` (wajib di production). Tanpa ini, siapa pun yang tahu domainnya bisa memakai kredit API berbayar.
- `SHARED_SECRET` minimal 32 karakter acak. Bandingkan dengan constant-time compare. Lokal memakai default `dev-secret`, tetapi di production server menolak start jika secret masih default atau kurang dari 32 karakter.
- `/api/internal/*` dan `/api/n8n/callback` wajib secret. Idealnya juga ditolak jika request datang lewat Traefik (cek header `X-Forwarded-Host`).
- Validasi upload: whitelist MIME + ekstensi, batas ukuran, nama file di-generate server (tidak memakai nama dari user).
- `/media/[...path]`: normalisasi path dan tolak `..`.

## 11. Deployment

Seluruh bagian ini hanya untuk **VPS**. Lokal tidak memakai Docker. Dockerfile dan compose dikerjakan di change `deploy-to-vps` (change 7, sebelum workflow n8n), dan sebelum itu build diperiksa dengan `pnpm build && NUXT_SHARED_SECRET=<32+ karakter> pnpm preview`.

Change 7 naik dengan `N8N_MODE=mock` di `.env` VPS, supaya kegagalan infrastruktur (Traefik, TLS, BasicAuth, migrasi, `better-sqlite3`, Range di `/media`) terpisah dari kegagalan n8n. Mode diganti `live` di change 8.

**Catatan VPS** (Ubuntu 24.04, 2 vCPU, RAM 3,6 GB + swap 1,9 GB, dicek 17 Okt 2026): server dipakai bersama. Traefik dan n8n berjalan dari `~/n8n-compose` (mereka juga menaungi situs lain lewat Traefik yang sama), dan ada proyek lain di `$HOME`. Konsekuensinya: jangan restart atau `down` Traefik/n8n, cukup tambah service `aladin` dari `~/aladin`. RAM sempit, jadi `docker build` Nuxt di VPS berpotensi kehabisan memori dan mengganggu n8n. **Terbukti aman di change 7:** build di VPS memakan 76 detik, memori tersedia turun dari 2.039 MB ke minimum 1.148 MB (swap hanya naik 39 MB), dan container n8n serta Traefik tidak restart. Heap Node di stage build dibatasi 1536 MB. Tetap cek `free -m` sebelum build dan hindari saat n8n menjalankan eksekusi berat. Fallback bila suatu saat OOM: build di laptop (image 249 MB, ~60 detik, keduanya `x86_64`) lalu `docker save aladin:latest | ssh ubuntu@43.157.229.232 docker load` dan `docker compose up -d` tanpa `--build`. Node di VPS (nvm) adalah 24 dan tidak ada pnpm, tetapi build memakai Node 22 di dalam image sehingga tidak masalah.

### docker-compose.yml (terpisah dari compose n8n)

Lihat file `docker-compose.yml` di root repo. Inti pengaturannya:

- Join ke network eksternal `n8n-compose_default`.
- Nama service `aladin`, sehingga bisa diakses n8n di `http://aladin:3000`.
- Volume `./data:/app/data`.
- Label Traefik untuk `aladin.serdadu.dev` dengan certresolver `mytlschallenge` (sama seperti n8n dan paperclip) + middleware BasicAuth.
- Tidak ada port yang dipublikasikan ke host. `SHARED_SECRET` dan `BASIC_AUTH_USERS` adalah variabel wajib (`${VAR:?pesan}`): compose menolak jalan bila salah satunya kosong, supaya app tidak pernah terbuka tanpa BasicAuth atau berjalan dengan secret default.

### Dockerfile (garis besar)

- Multi-stage: `build` (node:22-slim, pnpm lewat corepack, `pnpm install --frozen-lockfile --ignore-scripts`, `nuxt build`) → `runner` (node:22-slim, user `node`). Stage build dan runner harus memakai base image yang sama (glibc vs musl), karena binary native better-sqlite3 ikut di-copy.
- **Tanpa toolchain kompilasi dan dengan `--ignore-scripts`.** Tanpa flag itu pnpm menjalankan `node-gyp rebuild` implisit untuk `better-sqlite3` (ada `binding.gyp`, tanpa skrip `install`) dan gagal di image slim karena tidak ada Python. Tidak perlu: loader `better-sqlite3` v13 hanya memuat `prebuilds/<target>.node`, dan `nuxt build` menjalankan `nuxt prepare` sendiri.
- Yang di-copy ke runner: folder `.output/`, folder migrasi Drizzle (`server/db/migrations/`, tidak ikut di-bundle Nitro), dan `server/fixtures/` (mock mode membacanya relatif ke cwd; tanpa folder ini job mock macet di `running`).
- Migrasi dijalankan otomatis oleh Nitro plugin `server/plugins/migrate.ts` saat server start.
- Perintah start: `node .output/server/index.mjs`, dengan `HOST=0.0.0.0` dan `PORT=3000`.
- Variabel runtime dibaca lewat `runtimeConfig`, sehingga di container harus memakai prefix `NUXT_` (mis. `NUXT_SHARED_SECRET`). docker-compose.yml sudah memetakannya dari `.env`.

### Langkah di VPS

Sekali saja, di VPS (`ubuntu`, uid 1000, jadi `data/` otomatis bisa ditulis container):

```bash
git clone https://github.com/Dhyoga/aladin.git ~/aladin && cd ~/aladin
umask 077
printf 'SHARED_SECRET=%s\n' "$(openssl rand -hex 32)" >> .env   # jangan ditampilkan atau dikirim ke chat
openssl passwd -apr1                                           # password diketik di prompt; hanya hash-nya yang dipakai
echo "BASIC_AUTH_USERS='admin:<hash>'" >> .env                 # kutip TUNGGAL (hash berisi banyak $)
echo 'N8N_MODE=mock' >> .env                                   # ganti ke live di change 8
mkdir -p data
```

Setiap deploy, dari laptop (tidak ada kode yang diedit di VPS):

```bash
git push origin main
ssh ubuntu@43.157.229.232 'cd ~/aladin && git pull --ff-only && docker compose up -d --build'
```

`docker compose` hanya dijalankan di `~/aladin`, jadi tidak menyentuh container n8n dan Traefik. Workflow n8n tidak di-import manual: dibuat Claude Code lewat MCP (change 8 dan 9). Yang manual: 2 credential di n8n (`Google AI`, `Aladin Secret`, nilai yang sama dengan `SHARED_SECRET`), lalu `N8N_MODE=live`.

Pastikan DNS `aladin.serdadu.dev` sudah mengarah ke IP VPS sebelum container naik, agar sertifikat TLS dari Let's Encrypt bisa terbit. Sertifikat diterbitkan pada request pertama ke domain (sekitar beberapa detik).

**Hasil verifikasi change 7** (17 Okt 2026): dari container sementara di network `n8n-compose_default`, `http://aladin:3000` terjangkau (prasyarat change 8); `/api/n8n/callback` dan `/api/internal/*` menjawab 401 untuk secret salah atau kosong, 400 untuk secret benar dengan body kosong (autentikasi lolos), dan 404 untuk request ber-`X-Forwarded-Host`. Lewat domain publik, semua path tanpa login dijawab 401 oleh BasicAuth, HTTP di-redirect ke HTTPS, dan sertifikat Let's Encrypt valid.

### .env.example

`.env.example` di root berisi dua blok. Blok VPS dibaca docker-compose (nama tanpa prefix `NUXT_`, dipetakan oleh compose). Blok lokal bersifat opsional dan dibaca Nuxt saat `pnpm dev` (memakai prefix `NUXT_`). Lokal bisa berjalan tanpa `.env` sama sekali.

```
# --- VPS (dibaca docker-compose) ---
SHARED_SECRET=ganti-dengan-random-32-char
# openssl passwd -apr1  → tempel admin:<hash> di dalam tanda kutip tunggal
BASIC_AUTH_USERS='admin:$apr1$xxxx$yyyy'
# `mock` untuk deploy pertama; ganti ke `live` setelah workflow n8n ada
N8N_MODE=mock

# --- Lokal (opsional, dibaca Nuxt saat pnpm dev) ---
# NUXT_N8N_MODE=mock
# NUXT_DATABASE_PATH=./data/aladin.db
# NUXT_MEDIA_DIR=./data/media
```

---

# Bagian B — Design System

Referensi: dashboard Spira (Brand DNA dan Social Studio). Kesannya: hitam pekat, kartu dengan border tipis, tipografi tegas, aksen oranye hangat. Tiru gaya visualnya, bukan logo atau aset Spira.

## Warna (CSS variables, dark only)

| Token | Nilai | Pemakaian |
|---|---|---|
| `--bg` | `#0A0A0A` | Latar halaman |
| `--bg-glow` | radial `rgba(234,88,12,0.10)` di kanan bawah | Sentuhan hangat di latar |
| `--surface` | `#111111` | Kartu |
| `--surface-2` | `#171717` | Input, kartu bersarang, hover |
| `--border` | `rgba(255,255,255,0.08)` | Border kartu |
| `--border-strong` | `rgba(255,255,255,0.14)` | Border input fokus/hover |
| `--text` | `#FAFAFA` | Teks utama |
| `--text-muted` | `#A1A1AA` | Deskripsi |
| `--text-subtle` | `#71717A` | Label section uppercase |
| `--accent` | `#F97316` | Aksen utama (nav aktif, tier 1, ikon highlight). Di Tailwind tersedia sebagai `brand` (`text-brand`, `border-brand/40`). Utilitas `accent` bawaan shadcn (permukaan hover netral) dipetakan ke `--surface-2` |
| `--accent-gradient` | `linear-gradient(90deg,#EA580C,#FDBA74)` | Tombol CTA biaya/upgrade, progress bar |
| `--info` | `#3B82F6` | Label tier 2, link hashtag |
| `--success` / `--danger` | `#22C55E` / `#EF4444` | Status |

## Tipografi

- Font: **Geist Sans** (fallback Inter, system-ui), dimuat lewat `@nuxt/fonts`. Untuk hex/kode: Geist Mono.
- Judul halaman: 44–48px, bold, tracking rapat (contoh: "Brand DNA").
- Nama brand di hero: 32px semibold.
- Label section: 12px, uppercase, letter-spacing 0.12em, `--text-subtle`, sering didampingi ikon 14px.
- Body: 15px/1.6. Teks kartu deskripsi: 13–14px `--text-muted`.

## Komponen

- **Kartu**: `--surface`, border 1px `--border`, radius 16px, padding 24px, tanpa shadow.
- **Sidebar**: lebar 260px, `--bg` sedikit lebih terang (`#0D0D0D`), border kanan. Item nav berisi ikon + label, tinggi 40px, radius 10px. Item aktif: latar `--surface-2` + border tipis oranye dengan glow lembut.
- **Tombol primary**: putih `#FAFAFA`, teks hitam, bentuk pill, tinggi 40px (seperti "Post" / "Preview").
- **Tombol secondary**: transparan, border `--border-strong`, teks putih, pill.
- **Tombol biaya**: primary + badge kecil berisi estimasi biaya (seperti badge kredit "43" di Spira).
- **Chip**: pill kecil, `--surface-2`, border, teks 12px (font tags, hashtag, fitur).
- **Swatch warna**: kotak 44px radius 10px + label hex terpotong di bawahnya.
- **Tier label**: "TIER 1 · ANCHOR" (oranye), "TIER 2 · SUPPORTING" (biru), "TIER 3 · VARIETY" (abu).
- **Mockup Instagram post**: kartu `#000`, header avatar 32px + handle, gambar full width sesuai rasio, baris ikon, caption 14px dengan hashtag `--info`.
- **Mockup Reels**: frame 9:16 radius 28px, video `object-cover`, overlay gradien bawah.
- **Skeleton**: `--surface-2` dengan shimmer halus.
- **Progress stage**: tiga titik/langkah dengan garis penghubung, langkah aktif oranye beranimasi pulse.

## Layout

- Konten utama dibatasi max-width 1100px (Brand DNA) / 720px (Studio), rata tengah, jarak antar kartu 24px.
- Grid Brand DNA: hero penuh, lalu 3 kolom (Logo/Font/Color), lalu 2 kolom (Tagline/Tone, Audience/Rules).
- Responsif: di bawah 1024px sidebar menjadi drawer, dan grid menjadi 1 kolom.

---

# Bagian C — Rencana Change OpenSpec

Kerjakan berurutan. Satu change = satu proposal → apply → archive.

Change 1–6 sepenuhnya diverifikasi lokal dengan mock mode. Mulai change 7 pekerjaan menyentuh VPS dan n8n asli: change 7 hanya memverifikasi infrastruktur (mode mock), tes live ke n8n terjadi di change 8 dan 9.

Claude Code hanya dijalankan di laptop. VPS menerima hasil lewat `git pull` dan `docker compose` yang dijalankan dari laptop via SSH, dan tidak ada kode yang diedit di VPS. Kode harus di-commit dan di-push sebelum deploy.

1. **`setup-foundation`**: scaffold Nuxt 4 + Tailwind + shadcn-vue, `ssr: false`, Node 22 (`.nvmrc`, `engines`), design tokens (Bagian B), app shell (sidebar, 2 route kosong), Drizzle + SQLite + migrasi, route `/media`, `runtimeConfig` dengan default lokal (`n8nMode = mock`), `.env.example`. **Tanpa Docker.**
2. **`add-job-pipeline`**: tabel `jobs`, `shared/schemas/n8n-contracts.ts` dan skema Zod BrandDNA (kontrak `brand_extract` bergantung padanya), `server/utils/n8n-client.ts` (live + mock dengan fixture di `server/fixtures/`), `/api/n8n/callback`, `/api/jobs/:id`, timeout lazy, registry result handler per tipe job, unit test. Hasil job belum disimpan di mana pun: handler-nya didaftarkan change 3–6.
3. **`add-brand-api`**: sisi server brand. Tabel `brands`/`brand_assets`, API brand dan aset (upload divalidasi dari isi file, nama dan path dibuat server), `GET /api/internal/assets/:id` untuk n8n (digeser dari change 2 karena membaca `brand_assets`), result handler `brand_extract`, status brand yang direkonsiliasi dari job-nya saat dibaca, util penyimpanan media. Tanpa UI.
4. **`add-brand-dna-ui`**: sisi client brand. Composable `useJobPolling` (digeser dari change 2; konsumen UI pertamanya), `useBrands`, `useActiveBrand`, brand switcher, halaman `/brand-dna` (dialog New Brand, tampilan kartu, mode edit, upload logo/foto, re-extract, delete). Change 3 dan 4 adalah satu change di rencana awal; dipecah karena ukuran dan jenis verifikasinya berbeda (tes server vs browser).
5. **`add-post-generation`**: tabel generations, API generations (memakai `dispatchJob`), result handler `post`, halaman `/studio` (composer, Result 1 mockup IG, edit/copy caption, download), history di sidebar.
6. **`add-video-generation`**: API video, result handler `video` (termasuk progress `script`/`storyboard`), Result 2 (konfirmasi biaya, progress stage, storyboard, player Reels, download).
7. **`deploy-to-vps`**: Dockerfile, docker-compose.yml (tinjau ulang file yang sudah ada), `.env` VPS, DNS `aladin.serdadu.dev` → `43.157.229.232` (sudah diatur). Naik dengan `N8N_MODE=mock`, lalu verifikasi infrastruktur: TLS, BasicAuth, migrasi, `better-sqlite3`, Range di `/media`, dan demo mock di domain asli. Sebelumnya, `pnpm build && pnpm preview` harus lolos lokal.
8. **`add-n8n-brand-post-workflows`**: 2 credential (dibuat manual oleh user), workflow `aladin-brand-extract` dan `aladin-post-generate` sebagai kode SDK di `n8n/workflows/`, `n8n/README.md` (credential, MCP, tangga tes), mode diganti `live`, lalu tes e2e brand extract dan post. Diawali spike kecil: pastikan workflow baru bisa dibuat, dibaca, dan dijalankan lewat MCP (termasuk toggle *Available in MCP*), dan tetapkan bentuk file kode SDK di repo.
9. **`add-n8n-video-workflow`**: `aladin-video-generate` (script → storyboard → Omni video, polling background execution) dan tes e2e video. Dipisah dari change 8 karena biaya dan risikonya berbeda (VO bahasa Indonesia, render hingga ~15 menit), dan supaya tidak menahan brand extract dan post.
