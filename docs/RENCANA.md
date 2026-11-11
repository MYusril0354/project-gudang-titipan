# Rencana Implementasi

Status saat ini: **Fase 0 — Fondasi (kerangka repo selesai, deployment GAS belum).**

## Ringkas Status

| Fase | Cakupan | Status |
| --- | --- | --- |
| **0. Fondasi** | Spreadsheet + sheet, proyek GAS, router, envelope, `system.health`, helper Db, deployment DEV | 🟡 Kerangka siap; spreadsheet & deploy belum |
| **1. Auth & master** | `auth.*`, `users`, RBAC, `system.bootstrap`, CRUD master | ⬜ Belum |
| **2. SJ & penerimaan** | `sj.*`, `pending.list`, counter, batch suggestion, receipts, cancellations | ⬜ Belum |
| **3. Stok & pengiriman** | `stock.*`, `shipment.*`, consumption, movements, lock, POD, void, cetak | ⬜ Belum |
| **4. Laporan** | `dashboard.summary`, `ledger.kartuStock`, `report.reconciliation` | ⬜ Belum |
| **5. Hardening & rilis** | Audit log, backup harian, error log, uji beban, header keamanan, impor CSV, UAT, PROD | ⬜ Belum |

## Fase 0 — Langkah Berikutnya

Kerangka kode sudah ada di repo. Yang perlu dilakukan secara manual (butuh akun Google):

1. **Buat spreadsheet database** dan isi sheet sesuai [DATA-MODEL.md](DATA-MODEL.md).
   Sheet dibuat otomatis oleh `sheet_()` saat pertama diakses, tetapi lebih aman dibuat manual agar header pasti benar.
2. **Buat proyek Apps Script** lalu hubungkan ke repo:
   ```bash
   cd backend
   clasp login
   clasp create --type webapp --title "Gudang Titipan API"
   clasp push
   ```
3. **Set Script Properties** (Project Settings → Script properties):
   | Key | Nilai |
   | --- | --- |
   | `SPREADSHEET_ID` | ID spreadsheet hasil langkah 1 |
   | `COMPANY_NAME` | Nama perusahaan untuk kop surat |
   | `COMPANY_ADDRESS`, `COMPANY_PHONE`, `COMPANY_EMAIL`, `COMPANY_NPWP` | Info kop surat |
4. **Deploy sebagai Web App**: *Execute as* = **Me**, *Who has access* = **Anyone**. Salin URL `/exec`.
5. **Isi `frontend/js/config.js`** dengan URL `/exec` tersebut.
6. **Uji health check**:
   ```bash
   curl "https://script.google.com/macros/s/XXXX/exec?action=system.health"
   ```
   Harus mengembalikan `{"ok":true,"data":{...}}`.
7. **Jalankan frontend lokal** dan pastikan bootstrap tidak error CORS:
   ```bash
   cd frontend
   npx serve .
   ```

**Kriteria selesai Fase 0:** frontend bisa memanggil `system.health` dan `system.bootstrap` dari origin berbeda tanpa error CORS.

## Urutan Kerja yang Disarankan

Fase 1 harus lebih dulu karena semua action lain butuh sesi dan peran. Setelahnya:

- **Fase 2** membuka alur inti (SJ → penerimaan fisik), yang merupakan nilai bisnis utama.
- **Fase 3** menambahkan pengiriman + cetak — bagian paling rumit (validasi stok di dalam lock, idempotency).
- **Fase 4** melengkapi laporan; **Fase 5** baru hardening dan go-live.

## Temuan Prototipe yang Wajib Diperbaiki

Rujukan: PRD bagian 7. Yang paling berisiko bila terlewat:

| # | Temuan | Diperbaiki di |
| --- | --- | --- |
| 1 | `TODAY` di-hardcode `2024-11-11` | Fase 0 (`todayStr_` memakai zona Jakarta) |
| 8 | ID dari `Date.now() % 1000` → rawan tabrakan | Fase 2 (`counters`) |
| 9 | `innerHTML` tanpa escape → risiko XSS | Fase 1+ (frontend memakai `textContent`) |
| — | Nomor DO dari `jumlah DO + 1` → bentrok saat data dihapus | Fase 3 (counter terpisah) |

## Pertanyaan Terbuka

Perlu keputusan sebelum Fase 2 (PRD bagian 16):

1. FIFO otomatis atau cukup pemilihan batch manual?
2. No. Batch mengikuti format tetap atau boleh bebas dari pabrik/supplier?
3. Siapa yang boleh void pengiriman, perlu persetujuan dua tingkat?
4. Ada data SJ/stok titipan existing yang harus diimpor? Format sumbernya apa?
5. Ada pelanggan dengan lebih dari satu gudang titipan?
6. Kop surat dan nomor SJ/DO boleh diubah admin lewat layar pengaturan?
