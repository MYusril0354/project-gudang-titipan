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

## Tambahan setelah Fase 5 — Batch/ED & Impor SJ

Permintaan pengguna: Penerimaan SJ bisa impor CSV, dan bisa langsung mengisi
No. Batch & ED.

**Keputusan yang diambil (dikonfirmasi pengguna sebelum eksekusi):**
Batch & ED yang diisi saat SJ dibuat bersifat **RENCANA** — stok **tidak**
bertambah; batch baru lahir saat Fisik Ada dikonfirmasi. Tidak ada peringatan
kedaluwarsa otomatis. Impor CSV boleh memuat banyak SJ dalam satu berkas.

- **Skema (versi 2)** — `sj_lines.planned_batch`, `sj_lines.planned_ed`,
  `receipts.ed`. Semua kolom baru ditaruh di **akhir** `HEADERS_` supaya posisi
  kolom dan data lama tidak bergeser.
- **`system.migrate`** (ADMIN) — menuliskan header yang belum ada; header yang
  berbentrok tidak ditimpa, hanya dilaporkan.
- **`sj.create`** menerima `plannedBatch`/`plannedEd` per baris (ED tidak boleh
  sebelum tanggal SJ).
- **`sj.line.receive`** menerima `ed`, dan memakai rencana sebagai default bila
  `batchNumber`/`ed` dikosongkan.
- **`sj.import`** — impor CSV banyak SJ sekaligus, dikelompokkan per `no_sj`,
  laporan kegagalan per baris.
- **Frontend** — modal Tambah SJ kini punya field No. Batch & ED per baris
  (tata letak kartu, responsif); modal Fisik Ada terisi otomatis dari rencana;
  kolom **Rencana Batch / ED** di tabel Penerimaan; kolom **ED** di Stok Titipan;
  jenis impor **Surat Jalan** di modal Impor CSV; kolom ED di cetakan surat jalan.

**Bug yang ditemukan & diperbaiki saat pengerjaan:** `assertDate_` hanya
memeriksa pola, sehingga tanggal mustahil seperti `2026-13-99` atau `2026-02-30`
lolos. Sekarang tanggal benar-benar divalidasi (termasuk rentang tahun
2000–2100), dan impor melaporkannya per baris.

## Tambahan berikutnya — Satuan bebas, Batch boleh sama, Fisik Terima

Permintaan pengguna atas data nyata:

**1. No. Batch tidak lagi dipaksa unik** (menyimpang dari PRD temuan #10).
Pengguna memakai nomor batch pabrik/supplier (mis. `2605224`) yang memang muncul
di beberapa Surat Jalan. Aman karena satu batch = satu baris `receipts`, dan
seluruh perhitungan memakai `receipts.id`. Fungsi `assertBatchUnique_` dihapus.

**2. Tombol "Fisik Terima" per Surat Jalan** — menerima seluruh sisa tiap baris
pada satu SJ dengan satu klik, lewat action baru `sj.receiveAll`:

- satu request untuk semua baris (bukan N request terpisah),
- seluruh validasi dijalankan **sebelum** penulisan pertama, sehingga tidak ada
  penerimaan setengah jalan,
- memakai rencana batch & ED per baris bila ada; batch lain dibuat otomatis,
- baris yang sudah selesai dilewati dan dilaporkan sebagai `linesSkipped`.

Tombol hanya muncul bila peran boleh menulis dan masih ada baris bersisa; SJ yang
sudah selesai tidak menampilkan tombol.

**Verifikasi tanpa menyentuh data pengguna:** database dicadangkan lebih dulu
(`system.backupDatabase`), lalu seluruh pengujian dijalankan pada jalur yang
berhenti di validasi sebelum menulis (batch duplikat + rak salah, `receiveAll`
pada SJ tidak ada / SJ selesai / rak salah / PIC kosong) dan E2E hanya-baca
(buka modal lalu Batal). Snapshot sebelum dan sesudah identik
(`sj=10, batch=14, qty=33649`), 0 console error. Jalur sukses `receiveAll`
sengaja **tidak** dijalankan otomatis agar tidak mengubah data pengguna.

### Satuan produk bebas
Atas permintaan pengguna, **satuan produk tidak lagi dibatasi daftar tetap**.
Ini **menyimpang dari PRD 6.8** (`pcs, rim, pak, box, lusin, unit, kg, liter`)
secara sengaja.

- Backend: `assertUnitValid_` menggantikan pemeriksaan whitelist. Yang dijaga
  hanya kewajaran — wajib diisi, maksimal 20 karakter, tanpa karakter kontrol —
  supaya nilai aneh tidak merusak tabel dan dokumen cetak.
- `SATUAN_` diganti nama menjadi `SATUAN_UMUM_` dan berubah peran menjadi
  **saran** (kini termasuk `dus`, `bal`, `roll`, `meter`). Tetap dikirim lewat
  `system.bootstrap` sebagai `constants.satuan`.
- Frontend: field satuan di Master Data berubah dari `<select>` menjadi input
  teks dengan `<datalist>` (tipe field baru `combo`), jadi nilai bebas bisa
  diketik sementara saran tetap muncul.
- Impor CSV: catatan kolom satuan diperbarui.
- Uji: self-test kini memeriksa "satuan bebas diterima" dan "satuan > 20
  karakter ditolak" (20/20 lolos).

### Penyesuaian dokumen cetak + Colly

Permintaan pengguna saat masuk tahap pengiriman:

- kolom **Rak dihilangkan** dari surat jalan;
- blok kanan atas berlabel **Ekspedisi** (sebelumnya "Pengangkutan") dan hanya
  memuat satu nilai **Ekspedisi** — Sopir & Kendaraan dihapus dari form, skema,
  dan cetakan (kolom lamanya dibiarkan ada agar data lama tetap terbaca);
- tanda tangan kedua menjadi **"Ekspedisi / Pengirim"**;
- kolom **Colly** ditambahkan per baris, dan **total Colly** menjadi angka di
  baris Total dokumen (di samping total Qty).

Skema versi 3: `shipments.ekspedisi`, `shipment_lines.colly` (keduanya di akhir
header, dijalankan lewat `system.migrate`). Form pengiriman juga otomatis
memilih pelanggan pertama yang **masih punya stok**, supaya tidak langsung
tampak "tidak ada batch tersedia".

**Kop perusahaan dihilangkan dari cetakan.** Nama perusahaan, alamat, dan email
tidak lagi dicetak karena surat jalan umumnya dicetak di atas kertas berkop.
Yang tampil di kop hanya logo, judul **SURAT JALAN**, nomor, dan tanggal.
Properti `COMPANY_*` dan `company{}` pada respons `printData` tetap ada
(kompatibilitas), hanya tidak dirender.

### Cetak Laporan Posisi Stok

Halaman **Stok Titipan** dapat dicetak (`frontend/js/print-stock.js`):

- mengikuti filter halaman (pencarian & pelanggan) — header laporan menyebut
  pelanggan dan kata kunci yang aktif;
- data diambil **ulang** dari server (`fresh: true`) tepat sebelum dicetak,
  supaya angka pada dokumen resmi bukan salinan cache;
- kertas **A4 landscape**, 11 kolom: No, No. Batch, Kode, Nama Produk,
  Pelanggan, Rak, Masuk, Sisa, Satuan, ED, Kondisi;
- ringkasan di atas (total batch, total sisa, pelanggan berstok) + baris TOTAL;
- **Rekap per Pelanggan** muncul otomatis bila lebih dari satu pelanggan;
- tiga kolom tanda tangan (Dibuat oleh / Diperiksa / Diterima);
- jendela dibuka sinkron lebih dulu agar tidak diblokir popup, dengan pesan
  "Menyiapkan laporan…" selama data dimuat.

### Nomor batch bisa berupa angka

Nomor batch dari pabrik bisa tersimpan sebagai **angka** di sheet (mis.
`2609431`). Sebelumnya API mengembalikannya apa adanya sehingga tipe datanya
campur (angka/teks). Sekarang `batchNumber` **selalu dikembalikan sebagai teks**
di `stock.list`, `stock.available`, `sj.list`/`sj.get`, `pending.list`, dan
`shipment.list`/`shipment.get`, agar kontrak API konsisten dan perbandingan
nilai tidak meleset.

**Bug harness self-test yang ditemukan & diperbaiki:** uji "hapus saat belum
dipakai" memakai `created.pop()` yang membuang entri **terakhir**, bukan entri
yang dihapus — akibatnya produk uji `TEST-P2` tertinggal di sheet milik
pengguna. Diganti `forget(id)` yang membuang berdasarkan id, dan sisa `TEST-P2`
dibersihkan (hanya baris uji itu; data pengguna tidak disentuh). self-test
kembali 20/20 dengan `cleanup.failed` kosong.

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

