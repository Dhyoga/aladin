## Context

Change 1–6 selesai dan diverifikasi lokal dengan mock mode. Yang ada untuk deploy baru `docker-compose.yml` (service `aladin`, network eksternal `n8n-compose_default`, label Traefik dengan certresolver `mytlschallenge` dan middleware BasicAuth). `Dockerfile` dan `.dockerignore` belum ada. Referensi: `design.md` §11 (Deployment), `AGENTS.md` (Dev vs Prod, Gotcha, Pagar VPS), dan proposal change ini.

Fakta yang sudah terverifikasi:

- **App:** Nitro `node-server` (`.output/server/index.mjs`). Plugin `server/plugins/migrate.ts` membaca folder migrasi dari `NUXT_MIGRATIONS_DIR`, dan bila kosong dari `process.cwd()/server/db/migrations` (cwd = `/app` di Docker). `better-sqlite3` ikut di `.output/server/node_modules`. Di laptop `nuxt build` memakan 8 detik dan puncak memori sekitar 1,17 GB.
- **VPS** (`ubuntu@43.157.229.232`, Ubuntu 24.04, `x86_64`, 2 vCPU): RAM 3,7 GB dengan sekitar 2,0 GB tersedia, swap 1,9 GB (sekitar 1,2 GB kosong), disk sekitar 27 GB bebas. Docker 29.5 dan Compose v5.1. Hanya dua container berjalan: `n8n-compose-n8n-1` dan `n8n-compose-traefik-1` (Traefik sudah berjalan 3 bulan dan menaungi situs lain). Ada proyek lain di `$HOME`. `htpasswd` tidak ada, `openssl` ada. Image `alpine:latest` sudah ada lokal.
- **Sudah disiapkan:** DNS `aladin.serdadu.dev` → `43.157.229.232`, `~/aladin` (clone repo) dengan `.env` berisi `SHARED_SECRET` (64 hex, mode 600, tidak ter-track), credential n8n `Google AI` dan `Aladin Secret`.
- Claude Code hanya dijalankan di laptop. VPS tidak pernah dipakai untuk mengedit kode.

## Goals / Non-Goals

**Goals:**

- App berjalan di `https://aladin.serdadu.dev` di belakang Traefik dengan TLS dan BasicAuth, dalam mode `mock`, sebagai satu container non-root.
- Infrastruktur diverifikasi terpisah dari n8n: migrasi, `better-sqlite3`, `/media` dengan Range, penolakan akses publik ke endpoint internal.
- Prasyarat change 8 terbukti: container n8n/network `n8n-compose_default` bisa menjangkau `http://aladin:3000`, dan secret yang salah ditolak.
- Deploy bisa diulang dengan satu perintah dari laptop dan bisa dibatalkan tanpa menyentuh layanan lain di server.

**Non-Goals:**

- Workflow n8n dan mode `live` (change 8 dan 9).
- Backup `data/`, CI/CD, registry image, healthcheck khusus, multi-instance (pipeline mengasumsikan satu proses Nitro).
- Mengubah perilaku app. Change ini tidak mengubah requirement spec yang ada.

## Decisions

### 1. Dockerfile: dua stage, base image sama

`node:22-slim` untuk stage `build` dan `runner` (glibc di keduanya, sesuai gotcha `better-sqlite3`). Stage `build`: aktifkan pnpm lewat corepack (versi dari `packageManager`), `pnpm install --frozen-lockfile`, `nuxt build` dengan `NODE_OPTIONS=--max-old-space-size=1536`. Stage `runner`: salin hanya `.output/`, `server/db/migrations/`, dan `server/fixtures/` ke `/app` (fixture dibaca mock mode relatif ke cwd; ditemukan lewat uji image lokal: tanpa folder ini job mock macet di `running`), `USER node` (uid 1000), `ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000`, `CMD ["node", ".output/server/index.mjs"]`. `/app/data` dibuat dan dimiliki `node` di dalam image, jadi bind mount `./data` yang dimiliki uid 1000 di host (user `ubuntu` = 1000) langsung bisa ditulis.

Toolchain kompilasi (`python3 make g++`) **tidak** dipasang. Uji image lokal menunjukkan bahwa `pnpm install` menjalankan `node-gyp rebuild` implisit untuk `better-sqlite3` (paketnya punya `binding.gyp` tanpa skrip `install`) dan gagal di `node:22-slim` karena tidak ada Python. Padahal loader `better-sqlite3` v13 hanya memuat `prebuilds/<target>.node` (tidak pernah `build/Release`), jadi kompilasi tidak diperlukan. Karena itu stage build memakai `pnpm install --frozen-lockfile --ignore-scripts` (`nuxt build` menjalankan `nuxt prepare` sendiri). Ini juga menghindari kompilasi C++ di VPS yang RAM-nya sempit. Dicatat di `AGENTS.md` pada tahap penutup.

*Alternatif:* `node:22-alpine` (lebih kecil, tetapi musl berbeda dari rekomendasi `AGENTS.md` dan lebih berisiko untuk native module); satu stage saja (image membawa `node_modules` dev dan sumber, tidak perlu).

### 2. Strategi build: di VPS dengan batas memori, fallback dari laptop

Build di VPS dengan `docker compose build`, dengan batas heap Node 1536 MB di stage `build` (puncak terukur 1,17 GB di laptop, tersedia sekitar 2,0 GB + swap). Sebelum build periksa `free -m`: lanjut hanya bila memori tersedia cukup (sekitar 1,6 GB atau lebih) dan jangan membangun saat n8n sedang menjalankan eksekusi berat. Selama build pantau memori, dan pastikan container n8n dan Traefik tidak restart (bandingkan waktu start sebelum dan sesudah).

*Fallback* bila OOM atau n8n terganggu: build di laptop (keduanya `x86_64`) lalu `docker save aladin:latest | ssh ubuntu@43.157.229.232 docker load`, kemudian `docker compose up -d` tanpa `--build`. Fallback ini butuh Docker di laptop, yang belum diwajibkan proyek, jadi baru disiapkan bila dibutuhkan.

*Alternatif:* registry (GHCR) lewat GitHub Actions (CI/CD di luar scope, menambah bagian yang bergerak).

### 3. Compose: perbaikan kecil, fail-fast untuk variabel wajib

`docker-compose.yml` yang ada dipertahankan (network eksternal, tanpa port host, label Traefik, `NUXT_N8N_BASE_URL=http://n8n:5678`, `NUXT_APP_INTERNAL_URL=http://aladin:3000`). Perubahan:

- `SHARED_SECRET` dan `BASIC_AUTH_USERS` memakai sintaks wajib `${VAR:?pesan}`, sehingga `docker compose` menolak jalan bila salah satunya kosong. Ini mencegah app terbuka tanpa BasicAuth (middleware kosong) dan app berjalan dengan secret default.
- `N8N_MODE` tetap default `live` di compose (sesuai `AGENTS.md`), tetapi `.env.example` dan `.env` VPS memakai `mock` untuk deploy pertama, dengan komentar jelas bahwa mode diganti `live` di change 8.
- Pastikan penulisan `BASIC_AUTH_USERS` (berisi banyak `$`) tidak terpotong: nilai di `.env` diapit tanda kutip tunggal, dan hasil substitusi dicek dengan login nyata (bukan hanya melihat config).

Project compose bernama `aladin` (nama direktori `~/aladin`), terpisah dari `n8n-compose`, jadi `docker compose` di `~/aladin` tidak pernah menyentuh container n8n atau Traefik. Traefik menemukan container baru lewat Docker provider tanpa restart.

### 4. Deploy dari laptop lewat SSH, tanpa edit di VPS

Alur: commit dan push dari laptop, lalu `ssh ubuntu@43.157.229.232 'cd ~/aladin && git pull --ff-only && docker compose up -d --build'`. Semua perintah yang mengubah server dibatasi pada `~/aladin` dan container/image `aladin` (Pagar VPS di `AGENTS.md`): tidak ada `down` atau restart Traefik/n8n, tidak menyentuh `~/n8n-compose` atau proyek lain, tidak membuka `.git-credentials` atau `.bash_history`. Perintah yang mengubah server dikonfirmasi dulu ke user.

### 5. Rahasia tidak pernah lewat chat

- `SHARED_SECRET` sudah ada di `~/aladin/.env` dan tidak pernah ditampilkan.
- Password BasicAuth dipilih dan di-hash oleh user sendiri di VPS: `openssl passwd -apr1` (meminta password tanpa echo). Hanya **hash**-nya yang dikirim ke chat. Username `admin`. Hash ditambahkan ke `.env` lewat stdin SSH (heredoc) supaya tidak tertulis di riwayat shell, dan nilainya tidak dicetak balik.
- `.env` tetap mode 600 dan tidak ter-track git.

### 6. Verifikasi berlapis, tanpa password di tangan agen

| Lapisan | Siapa | Caranya |
|---|---|---|
| Lokal | agen | `pnpm lint && pnpm typecheck && pnpm test`, lalu `pnpm build && NUXT_SHARED_SECRET=<32+ karakter> pnpm preview` (migrasi, `better-sqlite3`, `/media`). |
| Dalam network Docker | agen | Container sementara dari `alpine:latest` (sudah ada) di `n8n-compose_default`, memanggil `http://aladin:3000` langsung (tanpa Traefik): secret benar vs salah vs tanpa secret, dan `X-Forwarded-Host` untuk mensimulasikan akses lewat Traefik. Ini sekaligus membuktikan prasyarat change 8 tanpa `docker exec` ke container n8n. |
| Publik tanpa login | agen | `curl` dari laptop ke `https://aladin.serdadu.dev`: sertifikat valid dan jawaban 401 tanpa kredensial. |
| Publik dengan login | user | Browser: UI terbuka, alur mock (extract brand, post, video) selesai, video bisa diputar dan di-seek. |

Pengecekan memakai container sementara (`docker run --rm`), yang tidak meninggalkan state di server.

### 7. Data uji mock

Selama mock, brand dan generation fixture tersimpan di `~/aladin/data`. Sebelum mode `live` (change 8) data uji itu perlu dibersihkan agar tidak bercampur dengan data produksi. Karena `data/` hanya berisi data Aladin dan berada di dalam `~/aladin`, penghapusannya diperbolehkan **setelah konfirmasi user**, dan dicatat sebagai langkah penutup di tasks, bukan dilakukan otomatis.

## Risks / Trade-offs

- **[OOM saat build mengganggu n8n/Traefik]** → batas heap Node di stage build, cek `free -m` dan waktu sepi sebelum build, bandingkan waktu start container n8n dan Traefik sebelum dan sesudah, fallback `docker save | ssh docker load`.
- **[Sertifikat TLS tidak terbit]** → DNS sudah benar; baca log Traefik (hanya baca) bila gagal. Challenge TLS-ALPN butuh port 443 yang sudah dipakai situs lain.
- **[`$` dalam hash BasicAuth rusak saat substitusi]** → nilai di `.env` diapit tanda kutip tunggal, verifikasi dengan login nyata oleh user, dan `docker compose config --quiet` untuk memastikan compose valid tanpa mencetak nilai.
- **[Native module tidak cocok di runner]** → base image build dan runner sama, ditambah smoke test lokal; binary `better-sqlite3` dicek lewat log start container (migrasi jalan).
- **[Migrasi tidak ditemukan di container]** → folder migrasi disalin eksplisit ke `/app/server/db/migrations`, dan startup gagal dengan pesan jelas bila tidak ada.
- **[Permission `./data`]** → `./data` dibuat oleh `ubuntu` (uid 1000) dan runner memakai uid 1000.
- **[Blast radius di server bersama]** → semua tindakan terbatas pada `~/aladin` dan container `aladin`; konfirmasi untuk perintah yang mengubah server.
- **[Tidak ada Docker lokal untuk mencoba image sebelum VPS]** → smoke test `pnpm preview` menangkap sebagian besar masalah bundling; sisa risiko ditangkap oleh build pertama di VPS, yang gagalnya tidak berdampak ke layanan lain.

## Migration Plan

1. Siapkan dan uji file (Dockerfile, `.dockerignore`, compose, `.env.example`) lokal sampai smoke test lolos, commit, push.
2. Di VPS: cek memori, lengkapi `.env` (hash BasicAuth dari user, `N8N_MODE=mock`), `git pull --ff-only`, pastikan `data/` ada dan bisa ditulis uid 1000.
3. Build dan naikkan service (`docker compose up -d --build` di `~/aladin`), baca log, bandingkan waktu start n8n dan Traefik.
4. Jalankan verifikasi berlapis (Keputusan 6).
5. Perbarui `design.md` §11 dan `AGENTS.md`, lalu arsipkan change.

**Rollback:** `docker compose down` di `~/aladin` (hanya service `aladin`; `data/` tetap), dan bila perlu `docker image rm aladin:latest`. Tidak ada perubahan pada Traefik atau n8n yang perlu dibatalkan karena keduanya tidak disentuh.

## Open Questions

- ~~Apakah `pnpm install` di image cukup dengan binary prebuilt `better-sqlite3`, atau perlu toolchain kompilasi?~~ Terjawab lewat uji image lokal: cukup prebuilt, dengan `--ignore-scripts` (Keputusan 1).
- Perlukah `docker compose` dipasangi batas memori untuk container `aladin` (mis. `mem_limit`) agar app tidak ikut menekan n8n? Ditunda sampai ada angka pemakaian nyata dari verifikasi.
