## ADDED Requirements

### Requirement: Brand list view
Halaman `/brand-dna` SHALL menampilkan semua brand dalam tampilan kartu, paling baru dulu, masing-masing mencakup nama, status, logo (atau placeholder), dan waktu terakhir diperbarui. Brand yang statusnya `extracting` SHALL ditandai sebagai sedang memproses.

#### Scenario: Kosong
- **WHEN** tidak ada brand
- **THEN** halaman menampilkan pesan kosong dan tombol "New brand" (copy UI berbahasa Inggris, sesuai konvensi di `AGENTS.md`)

#### Scenario: Brand dengan logo
- **WHEN** brand memiliki logo
- **THEN** kartu menampilkan logo sebagai avatar

#### Scenario: Brand sedang mengekstrak
- **WHEN** brand status `extracting`
- **THEN** kartu menampilkan indikator loading dan status `extracting`

### Requirement: Dialog New Brand
Halaman `/brand-dna` SHALL menyediakan dialog "New brand" dengan tiga mode: dari URL website, dari file PDF, atau secara manual dengan nama. Dialog SHALL memvalidasi input sebelum submit dan menampilkan hasil pembuatan brand.

#### Scenario: Buat brand dari URL
- **WHEN** pengguna memasukkan URL website valid dan submit
- **THEN** brand dibuat dengan status `extracting`, nama dari hostname tanpa `www.`, dan job `brand_extract` dimulai

#### Scenario: Buat brand dari PDF
- **WHEN** pengguna mengunggah file PDF valid maksimal 20 MB
- **THEN** brand dibuat dengan status `extracting`, nama dari nama file, dan job `brand_extract` dimulai dengan aset PDF

#### Scenario: Buat brand manual
- **WHEN** pengguna memasukkan nama 1–100 karakter
- **THEN** brand dibuat dengan status `ready` tanpa job

#### Scenario: Input tidak valid
- **WHEN** URL bukan http/https, PDF bukan PDF, atau nama kosong/lebih dari 100 karakter
- **THEN** dialog menampilkan error dan tidak submit

### Requirement: Mode edit Brand DNA
Pengguna SHALL bisa membuka dialog edit Brand DNA dari kartu brand, mengubah field DNA (identitas, audiens, suara, penawaran, visual, sosial, catatan), dan menyimpan perubahan. Brand SHALL menjadi `ready` setelah DNA disimpan.

#### Scenario: Edit DNA berhasil
- **WHEN** pengguna mengubah DNA dan submit
- **THEN** brand diperbarui, nama disinkronkan dengan `identity.name`, dan status menjadi `ready`

#### Scenario: Edit selama extracting
- **WHEN** brand status `extracting` diedit
- **THEN** response 409 dan tidak ada perubahan

### Requirement: Upload logo dan foto produk
Pengguna SHALL bisa mengunggah logo (satu file) dan foto produk (maksimal 20 file) dari kartu brand. File SHALL divalidasi dari isinya (PNG/JPEG/WebP maksimal 10 MB), bukan dari nama atau MIME klien.

#### Scenario: Upload logo
- **WHEN** satu file gambar valid diunggah sebagai logo
- **THEN** logo tersimpan dan ditampilkan pada kartu brand

#### Scenario: Upload foto produk
- **WHEN** beberapa file gambar valid diunggah sebagai foto produk
- **THEN** foto tersimpan dengan urutan dan ditampilkan pada kartu brand

#### Scenario: File tidak valid
- **WHEN** file bukan gambar atau lebih dari 10 MB
- **THEN** upload ditolak dengan error

### Requirement: Re-extract brand
Pengguna SHALL bisa meminta re-extract dari brand yang sudah ada. Re-extract SHALL memulai job `brand_extract` baru dari sumber asli brand dan mengatur status menjadi `extracting`. Re-extract pada brand manual SHALL ditolak.

#### Scenario: Re-extract brand siap
- **WHEN** brand siap di-re-extract
- **THEN** job baru dimulai dan status menjadi `extracting`

#### Scenario: Re-extract brand manual
- **WHEN** brand manual di-re-extract
- **THEN** response 400

### Requirement: Hapus brand
Pengguna SHALL bisa menghapus brand dari kartu brand. Penghapusan SHALL menghapus brand, asetnya, dan folder media-nya, tetapi job terkait SHALL tidak dihapus.

#### Scenario: Hapus brand
- **WHEN** brand dihapus
- **THEN** brand, aset, dan folder media hilang; job tetap ada

### Requirement: Brand switcher
Sidebar SHALL menampilkan brand switcher yang memungkinkan pengguna memilih brand aktif. Brand aktif SHALL disimpan dan dipakai dalam konteks Studio.

#### Scenario: Ganti brand aktif
- **WHEN** pengguna memilih brand lain dari switcher
- **THEN** brand aktif berubah dan Studio menggunakan brand baru

### Requirement: Job polling UI
UI SHALL melakukan polling status job melalui `useJobPolling` sampai status final (`completed` atau `failed`). Saat job berjalan, halaman SHALL menampilkan indikator progres. Saat selesai, UI SHALL memperbarui brand dan menyembunyikan indikator.

#### Scenario: Job selesai berhasil
- **WHEN** polling mendapatkan status `completed`
- **THEN** brand diperbarui dengan hasil ekstraksi dan indikator progres disembunyikan

#### Scenario: Job gagal
- **WHEN** polling mendapatkan status `failed`
- **THEN** brand ditandai gagal dan error ditampilkan
