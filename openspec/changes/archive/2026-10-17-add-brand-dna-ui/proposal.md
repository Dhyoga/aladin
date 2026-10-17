## Why

Halaman `/brand-dna` masih stub ("Coming soon") sementara API server sisi brand (`add-brand-api`) sudah siap. Tanpa lapisan klien, pengguna tidak bisa membuat brand dari URL/PDF/manual, melihat daftar brand, mengedit Brand DNA, unggah logo/foto produk, atau beralih antar brand. Change ini membangun seluruh sisi UI untuk brand sehingga API yang sudah teruji dapat digunakan oleh pengguna akhir.

## What Changes

- Composable `useJobPolling`: polling `GET /api/jobs/:id` sampai status final (dipesat dari change 2).
- Composable `useBrands`: CRUD brand via `GET/POST/PATCH/DELETE /api/brands` dan aset via `POST/PATCH/DELETE /api/brands/:id/assets`.
- Composable `useActiveBrand`: state brand aktif via `useState`.
- Brand switcher di sidebar untuk ganti brand aktif.
- Halaman `/brand-dna`: dialog New Brand (URL/PDF/manual), tampilan kartu brand, mode edit Brand DNA, upload logo/foto produk, re-extract, delete brand.

## Capabilities

### New Capabilities

- `brand-ui`: lapisan klien untuk manajemen brand (composable, halaman, komponen dialog/kartu/aset, brand switcher di sidebar).

### Modified Capabilities

<!-- Tidak ada. Kontrak API dari add-brand-api tidak berubah; change ini hanya mengonsumsi API yang sudah ada. -->

## Impact

- `app/pages/brand-dna.vue` (mengganti stub)
- `app/composables/useJobPolling.ts`, `useBrands.ts`, `useActiveBrand.ts`
- `app/components/` (brand cards, dialog New Brand, upload aset)
- `app/components/AppSidebar.vue` (brand switcher)
- Bergantung pada `shared/schemas/brand.ts` (sudah ada dari add-brand-api)
- Bergantung pada API brand dari add-brand-api (sudah diimplementasikan)
