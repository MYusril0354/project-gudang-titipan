# Rencana Implementasi

Status saat ini: **Fase 5 selesai** — aplikasi lengkap dan siap UAT. Backend live **v30**.
Dokumen operasional: [RUNBOOK](RUNBOOK.md) · checklist [UAT](UAT.md).

## Ringkas Status

| Fase | Cakupan | Status |
| --- | --- | --- |
| **0. Fondasi** | Spreadsheet + sheet, proyek GAS, router, envelope, `system.health`, helper Db, deployment | ✅ Selesai |
| **1. Auth & master** | `auth.*`, `users`, RBAC, `system.bootstrap`, CRUD master | ✅ Selesai |
| **2. SJ & penerimaan** | `sj.*`, `pending.list`, counter, batch suggestion, receipts, cancellations | ✅ Selesai |
| **3. Stok & pengiriman** | `stock.*`, `shipment.*`, consumption, movements, lock, POD, void, cetak | ✅ Selesai |
| **4. Laporan** | `dashboard.summary`, `ledger.kartuStock`, `report.reconciliation`, `user.*`, `audit.list` | ✅ Selesai |
| **5. Hardening & rilis** | Backup, error log, impor CSV, kunci go-live, uji beban, UAT, RUNBOOK | ✅ Selesai |

## Fase 5 — Selesai

- **Error log** — error tak terduga dicatat ke sheet `error_log` (tanpa token/password),
  dipangkas otomatis pada 1000 baris; dilihat lewat tab **Error Log** di halaman Audit
- **Backup** — `system.backupDatabase` menyalin spreadsheet ke folder Drive dan
  menyimpan 30 salinan terbaru; `system.backupStatus` untuk daftar. Trigger harian
  dipasang manual lewat UI (lihat RUNBOOK — sengaja menghindari scope baru)
- **Impor CSV master** — `master.import` + tombol **Impor CSV** di Master Data;
  header opsional, validasi per baris, laporan kegagalan per baris
- **Kunci go-live** — `PROD_LOCK` mematikan `system.setup` & `system.selfTest`
  tanpa mengganggu transaksi (`system.hardening`)
- **Uji beban kecil** + **optimasi kinerja** (lihat temuan di bawah)
- **Dokumen** — [RUNBOOK](RUNBOOK.md) (rilis, backup/restore, kunci, insiden) dan
  [UAT](UAT.md) (checklist PRD bagian 14)

### Temuan kinerja (jujur)

Batas bawah platform: `curl` ke `/exec` menunjukkan **1,06–1,38 dtk** hanya untuk
menerima HTTP 302 — sebelum kode kita jalan. `system.health` (tanpa akses sheet)
= ~1,7 dtk. Jadi **300 ms tidak mungkin** selama API ada di Apps Script.

| Perbaikan | Hasil |
| --- | --- |
| Cache per-eksekusi + cache master di `CacheService` | server 7–22% lebih cepat (stok 4,78 → 3,71 dtk) |
| **Cache browser + stale-while-revalidate** | pindah halaman **3,2 dtk → ~1 ms** |
| Prefetch `values:batchGet` | ❌ dicoba, tidak lebih cepat, dicabut (alasan di `Db.gs`) |

Sisa waktu server tidak bisa ditekan tanpa mengubah arsitektur: 6 tabel transaksi
harus dibaca segar, masing-masing satu round-trip `getValues()`.

**Bila target 300 ms wajib:** pindahkan API keluar dari Apps Script
(edge/serverless + Postgres/D1). Kontrak API tidak berubah — hanya `Db.gs`
yang diganti.

### Belum dikerjakan (perlu keputusan)

- **Email alert** error `INTERNAL` berulang — butuh scope `script.send_mail`,
  dan menambah scope memaksa otorisasi ulang seluruh Web App
- **Pemisahan lingkungan PROD** — prosedurnya sudah ada di RUNBOOK, eksekusinya
  menunggu spreadsheet + deployment produksi
- Polish opsional: pencarian global, soft-undo void

## Fase 4 — Selesai

- `dashboard.summary` — 4 kartu (stok, pending fisik, SJ belum selesai, belum POD),
  pending prioritas (5 tertua), stok per pelanggan
- `ledger.kartuStock` — mutasi + saldo berjalan per batch; **saldo dihitung dari
  seluruh riwayat batch**, jadi tetap benar walau difilter tanggal. Filter: kode
  produk, batch, pelanggan, rentang tanggal
- `report.reconciliation` — total masuk/keluar/stok, exception report, riwayat
  mutasi, plus **pemeriksaan keseimbangan**: stok dari batch vs stok dari mutasi
  (`variance` harus 0)
- Halaman **Dashboard**, **Kartu Stock**, **Rekonsiliasi**, **Pengguna**, dan
  **Audit Log** — tidak ada lagi halaman placeholder

### Catatan teknis

- `pending.list` di-refactor memakai `pendingRows_(ds)` di atas dataset bersama,
  sehingga pending, dashboard, dan rekonsiliasi memakai SATU sumber hitungan.
- `stockDataset_()` diperluas (sjs, sjLines, receiptsByLine, movements) agar satu
  request laporan hanya membaca tiap sheet sekali.

## Fase 3 — Selesai

Stok **tidak** disimpan sebagai kolom; selalu dihitung `receipts − shipment_consumptions`
pengiriman non-DRAFT/non-VOID (PRD 6.6). Satu batch = satu baris `receipts`.

- `stock.list` — posisi stok per batch (sisa > 0) + ringkasan qty per pelanggan
- `stock.available` — batch tersedia milik satu pelanggan (dasar form pengiriman)
- `shipment.create` — nomor `DO-TTR-{urut 3}` dari counter terpisah, langsung `SHIPPED`,
  menyimpan `shipment_lines` + `shipment_consumptions` (jejak batch + SJ asal) + mutasi `CONSIGN_OUT`
- `shipment.list` / `shipment.get` — daftar & detail + jumlah cetak
- `shipment.markDelivered` — `DELIVERED` + tanggal POD (tidak boleh sebelum tanggal kirim)
- `shipment.printData` — data cetak + naikkan `print_count` & `last_printed_at`
- `shipment.void` (ADMIN) — `VOID`, stok kembali, mutasi `VOID_OUT` untuk jejak

Validasi stok **diulang di server di dalam lock** dan mengakumulasi seluruh baris
dokumen yang sama, jadi stok yang berubah sejak layar dibuka tetap tertangkap.

### Catatan penting teknis

- Tabel `shipment_consumptions` tidak menyimpan `shipment_no`, sedangkan
  `batchAvailable_()` memfilternya lewat field itu. Dataset stok karena itu
  **memperkaya** setiap konsumsi dengan `shipment_no` (diambil dari
  `shipment_lines`). Tanpa ini, void tidak akan mengembalikan stok.
- Cetak: jendela dibuka **sinkron** di dalam handler klik sebelum memanggil
  server, supaya bila popup diblokir `print_count` tidak ikut naik.

Frontend: halaman **Stok Titipan** (`pages/stok.js`) dan **Pengiriman**
(`pages/pengiriman.js`), modal `modals/shipment.js` (buat / POD / void),
dokumen cetak di `print.js` (stylesheet A4 ditambahkan).

## Langkah Berikutnya

1. **Fase 5 — Hardening & rilis**: backup harian, error log ke sheet, uji beban,
   impor CSV master, header keamanan, UAT, pemisahan lingkungan PROD.
2. Hapus `system.setup` & `system.selfTest` dari router sebelum go-live (catatan keamanan).
3. Polish lanjutan: pencarian global, soft-undo void, empty-state CTA.
3. Polish lanjutan: pencarian global, soft-undo void, empty-state CTA.

## Fase 0 — Selesai

Hasil yang sudah terpasang:

| Item | Nilai |
| --- | --- |
| Proyek Apps Script | "Gudang Titipan API" |
| Deployment Web App | v30, `access: ANYONE_ANONYMOUS`, `executeAs: USER_DEPLOYING` |
| Spreadsheet database | `database_gudang_titipan` (17 tabel, header terverifikasi) |
| Zona waktu | `Asia/Jakarta` |
| Frontend `API_URL` | sudah diisi di `frontend/js/config.js` |

**Cara setup ulang (bila perlu):** action `system.setup` lewat Web App.

```json
{ "action": "system.setup",
  "params": { "spreadsheetId": "...", "adminPassword": "...", "key": "<SETUP_KEY>" } }
```

> `system.setup` hanya bisa dipanggil tanpa kunci bila sistem **belum** dikonfigurasi.
> Setelah setup, `SETUP_KEY` tersimpan di Script Properties dan wajib dikirim untuk setup ulang.
> Jangan bagikan `SETUP_KEY`.

## Fase 1 — Selesai

- `auth.login` — verifikasi SHA-256 + salt, token UUID, masa berlaku 12 jam, kunci akun setelah 5x gagal (10 menit)
- `auth.me`, `auth.logout`
- `system.bootstrap` — master data + konstanta + tanggal server + info perusahaan
- `master.list` + `master.create/update/delete` (aturan `IN_USE`, kode unik, gudang CONSIGN wajib pelanggan)
- `user.list/create/update/resetPassword`, `audit.list` (khusus ADMIN, jaga ADMIN aktif terakhir)
- RBAC: `requireSession_` memeriksa peran per action
- Audit log untuk login berhasil/gagal dan setiap aksi tulis
- Idempotency key (`requestId`) lewat CacheService

## Fase 2 — Selesai

Backend (deploy v15) dan frontend aktif:

- `sj.list` / `sj.get` — daftar & detail SJ dengan status turunan + daftar batch
- `sj.nextNumber` — pratinjau nomor SJ (`SJ/{tahun}/{urut4}`, counter tidak dinaikkan saat pratinjau)
- `sj.create` — buat SJ + baris, nomor unik, validasi PO/pelanggan/qty
- `sj.line.suggestBatch` — pratinjau No. Batch (`BN-{YYYYMMDD}-{urut3}`)
- `sj.line.receive` — Fisik Ada → receipt + batch unik + mutasi `CONSIGN_IN`, validasi rak/rak konsinyasi/tanggal/qty
- `sj.line.wait` — Fisik Belum Ada (alasan, ETA, PIC) — stok tidak berubah
- `sj.line.cancel` — Batalkan sisa (alasan + catatan wajib tersimpan di `cancellations`)
- `pending.list` — antrean pending + bucket umur + baris belum diklasifikasi
- Normalisasi tanggal di lapisan Db (Sheets mengembalikan `Date`, bukan string) agar ETA/tanggal tidak melorot jadi ISO-UTC

Frontend: halaman **Penerimaan SJ** (`pages/penerimaan.js`) dan **Fisik Belum Ada** (`pages/pending.js`), modal bersama di `modals/sj.js` & `modals/sj-create.js`, helper `ui.js`.

