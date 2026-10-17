## Why

Change 1–6 sepenuhnya diverifikasi lokal dengan mock mode. Workflow n8n (change 8 dan 9) tidak bisa diuji end-to-end sebelum app berjalan di tempat yang bisa dijangkau n8n lewat network Docker, yaitu VPS. Sebelum n8n asli dilibatkan, infrastruktur perlu dibuktikan sendiri (TLS, BasicAuth, migrasi, `better-sqlite3`, `/media` dengan Range), supaya kegagalan infrastruktur tidak tercampur dengan kegagalan workflow. DNS `aladin.serdadu.dev` sudah menunjuk `43.157.229.232`, `SHARED_SECRET` sudah dibuat di VPS, dan kredensial n8n (`Google AI`, `Aladin Secret`) sudah ada.

## What Changes

- Tambah `Dockerfile` multi-stage (`node:22-slim` untuk build dan runner, user non-root uid 1000, salin `.output/` dan folder migrasi Drizzle ke `/app/server/db/migrations`) dan `.dockerignore`.
- Tinjau `docker-compose.yml` yang sudah ada (network eksternal `n8n-compose_default`, label Traefik, BasicAuth, pemetaan env `NUXT_`) dan perbaiki bila perlu.
- Sesuaikan `.env.example` supaya deploy pertama memakai `N8N_MODE=mock` dan cara membuat hash BasicAuth (`openssl passwd -apr1`) terdokumentasi.
- Jalankan smoke test lokal wajib (`pnpm build && NUXT_SHARED_SECRET=<32+ karakter> pnpm preview`) sebelum deploy.
- Deploy ke VPS dari laptop lewat SSH (`~/aladin`: `git pull`, `docker compose up -d --build`) dengan `N8N_MODE=mock`, tanpa menyentuh Traefik, n8n, maupun proyek lain di server.
- Verifikasi di VPS, termasuk prasyarat change 8: container n8n bisa menjangkau `http://aladin:3000` dan secret yang salah ditolak 401.
- Perbarui `design.md` dan `AGENTS.md` bila hasil deploy mengubah catatan di sana (strategi build, gotcha baru).

Di luar scope: workflow n8n (change 8 dan 9), mode `live`, backup `data/`, CI/CD.

## Capabilities

### New Capabilities
- `vps-deployment`: image Docker produksi dan service compose di belakang Traefik (BasicAuth, TLS, network n8n), konfigurasi produksi lewat `.env`, serta daftar verifikasi yang harus lolos di VPS.

### Modified Capabilities
<!-- Tidak ada. Perilaku requirement yang sudah ada (runtime-config, media-serving, n8n-callback, internal-assets) tidak berubah; change ini hanya membungkus dan menjalankannya di Docker. -->

## Impact

- **File baru:** `Dockerfile`, `.dockerignore`.
- **File diubah:** `docker-compose.yml` (jika hasil tinjauan menuntut), `.env.example`, `design.md` §11, `AGENTS.md` (gotcha deploy).
- **Server:** satu service/container `aladin` baru di `~/aladin` (project compose terpisah dari `~/n8n-compose`), dan file `~/aladin/.env` (sudah berisi `SHARED_SECRET`) dilengkapi `BASIC_AUTH_USERS` dan `N8N_MODE`. Router Traefik baru untuk `aladin.serdadu.dev`. Traefik dan n8n tidak di-restart.
- **Risiko:** RAM VPS terbatas (sekitar 2,0 GB tersedia + swap 1,2 GB, puncak build sekitar 1,17 GB) sehingga build bisa mengganggu n8n; mitigasi di `design.md` change ini. Server dipakai bersama, jadi semua perintah yang mengubah server dibatasi pada `~/aladin` dan container `aladin` (lihat Pagar VPS di `AGENTS.md`).
- **Dependensi:** tidak ada dependensi npm baru.
