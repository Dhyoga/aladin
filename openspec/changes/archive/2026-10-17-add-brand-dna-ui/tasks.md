## 1. Composable klien

- [x] 1.1 Buat `app/composables/useJobPolling.ts`: polling `GET /api/jobs/:id` interval 2 detik sampai status final (`completed`/`failed`), berhenti otomatis, expose `status`, `stage`, `error`, `isPolling`
- [x] 1.2 Buat `app/composables/useBrands.ts`: fungsi `listBrands`, `getBrand`, `createBrand` (url/pdf/manual), `updateBrandDna`, `reExtractBrand`, `deleteBrand`, `uploadAssets`, `updateAsset`, `deleteAsset` lewat `$fetch` dengan Zod validasi dari `shared/schemas/brand.ts`
- [x] 1.3 Buat `app/composables/useActiveBrand.ts`: state `useState<BrandDetail | null>('activeBrand')` dengan getter/setter, expose brand aktif dan fungsi setActiveBrand

## 2. Komponen UI

- [x] 2.1 Buat `app/components/BrandCard.vue`: kartu brand menampilkan nama, status, logo/placeholder, waktu update, indikator loading saat extracting, aksi edit/unggah/re-extract/hapus
- [x] 2.2 Buat `app/components/NewBrandDialog.vue`: dialog dengan 3 mode (URL/PDF/manual), validasi input, submit ke `useBrands.createBrand`, tampilkan hasil pembuatan
- [x] 2.3 Buat `app/components/AssetUpload.vue`: Sheet untuk upload logo (satu file) dan foto produk (banyak file), validasi isi file (PNG/JPEG/WebP maksimal 10 MB), all-or-nothing
- [x] 2.4 Buat `app/components/EditBrandDnaDialog.vue`: dialog edit Brand DNA (identitas, audiens, suara, penawaran, visual, sosial, catatan), submit ke `useBrands.updateBrandDna`
- [x] 2.5 Buat `app/components/BrandSwitcher.vue`: komponen sidebar untuk ganti brand aktif, tampilkan daftar brand dengan brand aktif ditandai

## 3. Halaman /brand-dna

- [x] 3.1 Ganti stub `app/pages/brand-dna.vue`: tampilan kartu brand (brand cards), tombol "Buat Brand Baru" membuka NewBrandDialog, daftar brand dari `useBrands.listBrands`
- [x] 3.2 Integrasikan `useJobPolling` pada halaman untuk memantau status job ekstraksi brand yang sedang extracting
- [x] 3.3 Integrasikan `useActiveBrand` untuk menyimpan brand yang dipilih pengguna

## 4. Sidebar brand switcher

- [x] 4.1 Perbarui `app/components/AppSidebar.vue`: tambahkan brand switcher di bawah item nav Studio/Brand DNA, gunakan `BrandSwitcher`, sinkronkan dengan `useActiveBrand`

## 5. Verifikasi akhir

- [x] 5.1 Jalankan `pnpm lint && pnpm typecheck && pnpm test` lolos (Node 22)
- [x] 5.2 Smoke test di mode mock: buat brand dari URL/PDF/manual sampai `ready`/`failed`, upload logo dan foto, re-extract, delete, ganti brand aktif
