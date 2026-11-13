# UAT — Kriteria Penerimaan

Checklist ini memetakan **PRD bagian 14** ke cara mengujinya. Kolom **Status**
diisi saat UAT dijalankan bersama pengguna.

Legenda: ✅ lolos · ⬜ belum diuji · ❌ gagal

## Cara menjalankan

1. Siapkan data uji: minimal 2 pelanggan, 3 produk, 1 gudang titipan + rak per pelanggan.
2. Login sebagai **ADMIN** di frontend (Netlify atau `npx serve frontend`).
3. Kerjakan berurutan; beberapa langkah bergantung pada langkah sebelumnya.
4. Catat temuan di kolom Catatan, termasuk tangkapan layar bila ada.

---

## A. Autentikasi & peran

| # | Skenario | Cara uji | Harapan | Status |
| --- | --- | --- | --- | --- |
| A1 | Login valid | Login user aktif | Masuk ke Dashboard, token tersimpan | ⬜ |
| A2 | Login salah | Password salah 5x | Ditolak; akun terkunci ±10 menit | ⬜ |
| A3 | Token kedaluwarsa | Hapus `gt_token` di sessionStorage, muat ulang | Diarahkan ke halaman login | ⬜ |
| A4 | VIEWER tidak bisa menulis | Login VIEWER, buka Penerimaan | Tidak ada tombol aksi; bila action dipaksa → `FORBIDDEN` | ⬜ |
| A5 | ADMIN terakhir dilindungi | Coba nonaktifkan/ubah peran ADMIN terakhir | Ditolak server | ⬜ |

## B. Surat Jalan & penerimaan fisik

| # | Skenario | Cara uji | Harapan | Status |
| --- | --- | --- | --- | --- |
| B1 | Buat SJ 2 baris | Penerimaan → + Tambah Penerimaan SJ | Muncul dengan status **Belum diklasifikasi**, nomor berurutan | ⬜ |
| B2 | Nomor SJ unik saat bersamaan | Dua pengguna menyimpan bersamaan | Nomor berbeda, tanpa duplikat | ⬜ |
| B3 | Fisik Ada sebagian | Isi qty 120 dari 200 | Baris **Diterima sebagian**, pending 80, batch baru, stok +120 | ⬜ |
| B4 | Qty melebihi pending | Fisik Ada qty > pending | Ditolak `QTY_EXCEEDS_PENDING` | ⬜ |
| B5 | Fisik Belum Ada | Isi alasan + ETA + PIC | Masuk antrean Pending, umur benar, stok **tidak** berubah | ⬜ |
| B6 | Batalkan sisa | Batalkan dengan alasan + catatan | Pending jadi 0, status sesuai aturan 6.1, alasan tersimpan & tampil di rekonsiliasi | ⬜ |
| B7 | Rak beda pelanggan | Pilih rak milik pelanggan lain | Ditolak | ⬜ |
| B8 | Pelanggan tanpa gudang/rak | Fisik Ada untuk pelanggan tanpa rak | Ditolak `NO_CONSIGN_RACK` dengan arahan ke Master Data | ⬜ |

## C. Stok & pengiriman

| # | Skenario | Cara uji | Harapan | Status |
| --- | --- | --- | --- | --- |
| C1 | Kirim dari 2 batch berbeda | Buat pengiriman 2 baris | Stok tiap batch berkurang tepat, DO unik | ⬜ |
| C2 | Mutasi keluar tercatat | Buka Kartu Stock | Baris `CONSIGN_OUT` dengan batch + SJ asal | ⬜ |
| C3 | Cetak surat jalan | Klik Cetak | Dokumen memuat No. Batch & SJ asal; `print_count` naik 1 | ⬜ |
| C4 | Popup diblokir | Blokir popup, klik Cetak | Ada pesan jelas; `print_count` **tidak** naik | ⬜ |
| C5 | Dua user, batch sama | Kirim melebihi sisa bersamaan | Yang kedua ditolak `INSUFFICIENT_STOCK`; stok tidak pernah negatif | ⬜ |
| C6 | Klik ganda Simpan | Klik Simpan Pengiriman dua kali cepat | Hanya **satu** DO (idempotency) | ⬜ |
| C7 | Tandai POD | Tandai POD satu pengiriman | Status **Selesai**, kartu "Belum Ada POD" berkurang | ⬜ |
| C8 | POD sebelum tanggal kirim | Isi tanggal POD lebih awal | Ditolak | ⬜ |
| C9 | Void (ADMIN) | Void pengiriman + alasan | Stok kembali, mutasi `VOID_OUT`, tercatat di audit | ⬜ |
| C10 | Void tanpa alasan | Kosongkan alasan | Ditolak | ⬜ |

## D. Laporan & konsistensi

| # | Skenario | Cara uji | Harapan | Status |
| --- | --- | --- | --- | --- |
| D1 | Saldo kartu stock = stok | Bandingkan saldo akhir batch di Kartu Stock dengan Stok Titipan | Sama untuk setiap batch | ⬜ |
| D2 | Masuk − Keluar = stok | Lihat Rekonsiliasi | Total Masuk − Total Keluar = Stok Titipan | ⬜ |
| D3 | Pemeriksaan keseimbangan | Panel Pemeriksaan Keseimbangan | Badge **Seimbang**, `variance` = 0 | ⬜ |
| D4 | Exception report | Lihat daftar menggantung | Sesuai baris pending, umur benar | ⬜ |
| D5 | Filter kartu tanggal | Filter rentang tanggal | Baris tersaring, **saldo tetap** dari riwayat penuh | ⬜ |
| D6 | Dashboard | Buka Dashboard | 4 kartu sesuai kenyataan; pending prioritas urut umur | ⬜ |

## E. Master data & impor

| # | Skenario | Cara uji | Harapan | Status |
| --- | --- | --- | --- | --- |
| E1 | Duplikat kode | Tambah produk dengan kode yang ada | Ditolak `DUPLICATE`, field ditandai | ⬜ |
| E2 | Hapus yang dipakai | Hapus produk yang dipakai SJ | Ditolak `IN_USE` dengan alasan | ⬜ |
| E3 | Gudang titipan ganda | Buat CONSIGN kedua untuk pelanggan sama | Ditolak | ⬜ |
| E4 | Impor CSV (header) | Master Data → Impor CSV, dengan baris header | Baris dibuat; ringkasan `n dibuat, m gagal` | ⬜ |
| E5 | Impor CSV (tanpa header) | Tempel CSV tanpa header | Kolom mengikuti urutan petunjuk | ⬜ |
| E6 | Impor baris tidak valid | Sertakan 1 baris satuan salah | Baris itu dilaporkan per baris, sisanya tetap masuk | ⬜ |
| E7 | Impor relasi | Impor rak dengan **nama** gudang | Berhasil; nama gudang salah → `NOT_FOUND` dengan pesan jelas | ⬜ |

## F. Non-fungsional & rilis

| # | Skenario | Cara uji | Harapan | Status |
| --- | --- | --- | --- | --- |
| F1 | Tanpa error CORS | Buka frontend dari domain Netlify | Semua halaman memuat data | ⬜ |
| F2 | Refresh tidak hilang data | Muat ulang halaman | Data tetap ada (tersimpan di Sheets) | ⬜ |
| F3 | Tanggal Indonesia | Periksa tabel | Format `dd Mmm yyyy`; tidak ada ISO mentah | ⬜ |
| F4 | Angka id-ID | Periksa qty besar | Pemisah ribuan sesuai locale Indonesia | ⬜ |
| F5 | Tampilan mobile | Buka di lebar ≤720px | Sidebar geser, tabel jadi kartu, tanpa scroll horizontal | ⬜ |
| F6 | Backup manual | `system.backupDatabase` | Salinan baru muncul di `system.backupStatus` | ⬜ |
| F7 | Kunci go-live | `system.hardening { lock: true }` | `system.setup` & `system.selfTest` ditolak; transaksi tetap jalan | ⬜ |
| F8 | Error log | Buka Audit & Error → Error Log | Hanya error tak terduga yang tercatat | ⬜ |
| F9 | Kinerja | Ukur muat Dashboard | Tercatat (lihat catatan kinerja di RUNBOOK) — target 2 dtk belum tercapai | ⬜ |

---

## Catatan hasil UAT

| Tanggal | Penguji | Temuan | Tindak lanjut |
| --- | --- | --- | --- |
| | | | |
