## 1. Berkas deploy (lokal)

- [x] 1.1 Buat `Dockerfile` dua stage sesuai design Keputusan 1: `node:22-slim` untuk `build` dan `runner`, pnpm lewat corepack (versi dari `packageManager`), `pnpm install --frozen-lockfile`, `NODE_OPTIONS=--max-old-space-size=1536` di stage build, runner hanya menyalin `.output/` dan `server/db/migrations/` ke `/app`, `/app/data` dimiliki `node`, `USER node`, `ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000`, `CMD ["node", ".output/server/index.mjs"]`; tanpa toolchain kompilasi (tambahkan hanya bila build pertama membuktikan perlu)
- [x] 1.2 Buat `.dockerignore`: `.env`, `.env.*` (kecuali `.env.example` bila perlu), `data/`, `.data/`, `node_modules/`, `.nuxt/`, `.output/`, `.git/`, `openspec/`, `tests/`, `.claude/`, dan berkas log
- [x] 1.3 Tinjau `docker-compose.yml` sesuai design Keputusan 3: `SHARED_SECRET` dan `BASIC_AUTH_USERS` memakai `${VAR:?pesan}`; pertahankan network eksternal, tanpa port host, label Traefik, dan `NUXT_*`; tambahkan komentar singkat tentang `N8N_MODE`
- [x] 1.4 Perbarui `.env.example`: `N8N_MODE=mock` dengan komentar "ganti ke live di change 8", catatan tanda kutip tunggal untuk `BASIC_AUTH_USERS` dan cara membuat hash dengan `openssl passwd -apr1`; pastikan setiap variabel yang dirujuk compose ada di contoh
- [x] 1.5 Bila Docker tersedia di laptop, jalankan `docker compose config --quiet` dengan `.env` contoh untuk memastikan compose valid; bila tidak, tinjau manual dan catat bahwa validasi dilakukan di VPS (tugas 3.5)

## 2. Smoke test lokal dan push

- [x] 2.1 Jalankan `pnpm lint && pnpm typecheck && pnpm test` di Node 22 (`nvm use 22`)
- [x] 2.2 Jalankan `pnpm build && NUXT_SHARED_SECRET=<32+ karakter acak> pnpm preview` dari root proyek; periksa: migrasi berjalan di `data/aladin.db`, `better-sqlite3` termuat, alur mock dasar jalan, dan `/media` melayani file (termasuk Range 206 untuk video). Tambahan karena Docker tersedia di laptop: image juga di-build dan dijalankan lokal (`aladin:smoke`, 249 MB), dan skrip smoke yang sama lolos 16/16 di dalam container (non-root uid 1000, migrasi, mock end-to-end, Range 206, data bertahan setelah container dibuat ulang). Temuan: `pnpm install` butuh `--ignore-scripts` (tanpa itu `node-gyp rebuild` gagal) dan runner harus menyalin `server/fixtures/`
- [ ] 2.3 Commit dan push ke `origin/main` (berkas deploy dan perubahan dokumen), lalu pastikan `git status` bersih dan `origin/main` sama dengan HEAD lokal

## 3. Persiapan VPS

- [ ] 3.1 (baca saja) Periksa kondisi sebelum build: `free -m`, `uptime`, dan catat waktu start container n8n dan Traefik (`docker ps --format ...` dengan `StartedAt`) sebagai pembanding; lanjut hanya bila memori tersedia cukup dan server relatif sepi
- [ ] 3.2 **User:** di VPS jalankan `openssl passwd -apr1` (password dimasukkan di prompt, tidak diketik di chat), lalu kirim hash-nya (hanya hash) ke agen; username `admin`
- [ ] 3.3 Lengkapi `~/aladin/.env` lewat stdin SSH tanpa mencetak nilai: tambahkan `BASIC_AUTH_USERS='admin:<hash>'` (kutip tunggal) dan `N8N_MODE=mock`; jangan menimpa `SHARED_SECRET`; verifikasi dengan hanya menampilkan nama variabel dan panjang nilai, mode 600, dan tidak ter-track git
- [ ] 3.4 Di `~/aladin`: `git pull --ff-only`, `mkdir -p data`, dan pastikan `data/` dimiliki uid 1000 dan bisa ditulis
- [ ] 3.5 Jalankan `docker compose config --quiet` di `~/aladin` untuk memastikan compose valid dan variabel wajib terisi (tanpa mencetak nilai)

## 4. Build dan jalankan di VPS

- [ ] 4.1 Konfirmasi ke user sebelum menjalankan perintah yang mengubah server, lalu `docker compose build` di `~/aladin` sambil memantau memori; bila `pnpm install` mencoba mengompilasi `better-sqlite3`, tambahkan toolchain di stage `build` dan ulangi
- [ ] 4.2 `docker compose up -d`; baca log container `aladin`: migrasi berjalan, tidak ada error native module, server mendengarkan di port 3000
- [ ] 4.3 Bandingkan waktu start container n8n dan Traefik dengan catatan 3.1: harus tidak berubah; bila build gagal karena OOM atau n8n terganggu, terapkan fallback `docker save | ssh docker load` (design Keputusan 2) dan catat
- [ ] 4.4 Pastikan port host tidak bertambah (`ss -tlnH` dibandingkan sebelum dan sesudah) dan `restart` policy bekerja (container naik lagi setelah `docker restart aladin`, yang hanya menyentuh container Aladin)

## 5. Verifikasi dari network Docker

- [ ] 5.1 Jalankan container sementara `alpine:latest` (`docker run --rm --network n8n-compose_default`) dan panggil `http://aladin:3000/`: app menjawab (prasyarat change 8)
- [ ] 5.2 Dari container sementara yang sama: `/api/n8n/callback` dengan secret salah → 401, tanpa secret → 401; `/api/internal/assets/<id>` tanpa secret → 401
- [ ] 5.3 Dari container sementara, simulasikan Traefik dengan header `X-Forwarded-Host`: `/api/n8n/callback` dan `/api/internal/assets/<id>` → 404 meski secret benar (gunakan secret dari `.env` hanya di dalam perintah di server tanpa mencetaknya, atau lewati kasus secret benar bila tidak perlu)

## 6. Verifikasi publik

- [ ] 6.1 Dari laptop: `curl -sI https://aladin.serdadu.dev/` menunjukkan sertifikat valid dan `401` dengan `WWW-Authenticate: Basic`; bila sertifikat belum terbit, baca log Traefik (hanya baca) untuk penyebabnya
- [ ] 6.2 **User:** buka `https://aladin.serdadu.dev` di browser dengan login `admin`: UI terbuka; buat brand dari URL (mock), generate post, generate video; semua selesai dengan fixture; video bisa diputar dan di-seek; `mock:fail` di prompt menghasilkan job `failed`
- [ ] 6.3 Uji persistensi: recreate container (`docker compose up -d --force-recreate` di `~/aladin`) dan pastikan brand yang tadi dibuat masih ada
- [ ] 6.4 Pastikan akses publik ke `/api/n8n/callback` dan `/api/internal/*` tidak tembus: tanpa login tetap 401 dari BasicAuth (tidak mencapai app)

## 7. Dokumentasi dan penutup

- [ ] 7.1 Perbarui `design.md` §11 (Dockerfile final, strategi build yang terbukti, langkah deploy dari laptop via SSH, hasil ukur memori) dan `AGENTS.md` (gotcha baru dari deploy, mis. variabel wajib compose, hash BasicAuth, toolchain bila ditambahkan)
- [ ] 7.2 Catat di `design.md` hasil verifikasi prasyarat change 8 (n8n network bisa menjangkau `http://aladin:3000`)
- [ ] 7.3 Tanyakan ke user apakah `~/aladin/data` (data uji mock) dibersihkan sebelum change 8; hapus hanya setelah konfirmasi, dan hanya isi `~/aladin/data`
- [ ] 7.4 Jalankan lagi `pnpm lint && pnpm typecheck && pnpm test`, commit dan push perubahan dokumentasi
