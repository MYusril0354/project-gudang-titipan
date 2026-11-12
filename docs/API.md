# API — Sistem Gudang Titipan

Kontrak REST API untuk backend Google Apps Script. Lihat PRD bagian 11.

## 1. Konvensi

Satu endpoint: **`POST {GAS_EXEC_URL}`**. Routing memakai field `action` karena GAS tidak punya path routing nyata.

### Request

```json
{
  "action": "sj.line.receive",
  "token": "<token sesi>",
  "requestId": "uuid-dari-klien",
  "params": {
    "sjNo": "SJ/2026/0008",
    "lineId": "L-102",
    "qty": 40,
    "date": "2026-11-11",
    "rackId": "R2-01",
    "batchNumber": "BN-20261111-001",
    "kondisi": "Baik",
    "pic": "Andi"
  }
}
```

### Respons sukses

```json
{ "ok": true, "data": { }, "meta": { "serverTime": "2026-11-11T09:14:02+07:00" } }
```

### Respons gagal

```json
{ "ok": false, "error": { "code": "QTY_EXCEEDS_PENDING", "message": "Qty melebihi pending (maks 40).", "field": "qty" } }
```

### Aturan wajib

| Aturan | Alasan |
| --- | --- |
| `Content-Type: text/plain;charset=utf-8` (isi body JSON) | GAS tidak mendukung preflight `OPTIONS`; agar tetap *simple request* |
| Tanpa header kustom (`Authorization`, `X-Token`) | Header kustom memicu preflight yang gagal |
| Token dikirim di **body** | Agar tidak muncul di URL/log |
| Semua panggilan `POST`, termasuk baca | Konsisten & aman |
| Status HTTP selalu `200` | Hasil sebenarnya ada di field `ok` |
| `requestId` pada aksi tulis = **idempotency key** | Klik ganda / retry tidak memproses dua kali |

### `system.health`

Satu-satunya action yang juga menerima `GET`: `GET {GAS_EXEC_URL}?action=system.health`.

## 2. Kode Error Baku

| Kode | Arti |
| --- | --- |
| `UNAUTHENTICATED` | Token tidak ada / kedaluwarsa → frontend kembali ke login |
| `FORBIDDEN` | Peran tidak berhak |
| `VALIDATION_ERROR` | Input tidak valid (sertakan `field`) |
| `NOT_FOUND` | Data / action tidak ditemukan |
| `DUPLICATE` | Kode / nomor sudah dipakai |
| `IN_USE` | Master data masih dipakai transaksi |
| `QTY_EXCEEDS_PENDING` | Qty penerimaan melebihi pending |
| `INSUFFICIENT_STOCK` | Sisa batch tidak cukup |
| `NO_CONSIGN_RACK` | Pelanggan belum punya gudang titipan / rak |
| `LOCK_TIMEOUT` | Server sibuk, coba lagi |
| `INTERNAL` | Kesalahan tak terduga |

## 3. Daftar Action

| Action | Peran | Write | Fungsi |
| --- | --- | --- | --- |
| `system.health` | publik (GET) | – | Cek layanan hidup + versi API |
| `auth.login` | publik | ✓ | Username + password → token, profil, peran |
| `auth.logout` / `auth.me` | semua | ✓/– | Hapus sesi / profil sesi aktif |
| `system.bootstrap` | semua | – | Master data + konstanta + tanggal server + info perusahaan |
| `dashboard.summary` | semua | – | Angka 4 kartu, top pending, stok per pelanggan |
| `master.list` | semua | – | Baca master; param `entity`: product, customer, location, rack |
| `master.create` / `master.update` / `master.delete` | ADMIN | ✓ | CRUD master (aturan PRD 6.8) |
| `sj.list` / `sj.get` | semua | – | Daftar / detail SJ |
| `sj.nextNumber` | ADMIN, GUDANG | – | Saran nomor SJ berikutnya |
| `sj.create` | ADMIN, GUDANG | ✓ | Buat SJ + baris |
| `sj.line.suggestBatch` | ADMIN, GUDANG | – | Saran No. Batch untuk tanggal tertentu |
| `sj.line.receive` | ADMIN, GUDANG | ✓ | Fisik Ada → receipt + batch + mutasi IN |
| `sj.line.wait` | ADMIN, GUDANG | ✓ | Fisik Belum Ada (alasan, ETA, PIC) |
| `sj.line.cancel` | ADMIN, GUDANG | ✓ | Batalkan sisa |
| `pending.list` | semua | – | Antrean pending + bucket umur |
| `stock.list` | semua | – | Stok per batch + ringkasan per pelanggan |
| `stock.available` | ADMIN, GUDANG | – | Batch tersedia untuk satu pelanggan |
| `shipment.list` / `shipment.get` | semua | – | Daftar / detail pengiriman |
| `shipment.create` | ADMIN, GUDANG | ✓ | Buat pengiriman (validasi stok di dalam lock) |
| `shipment.markDelivered` | ADMIN, GUDANG | ✓ | Set DELIVERED + tanggal POD |
| `shipment.printData` | ADMIN, GUDANG | ✓ | Data cetak + increment `print_count` |
| `shipment.void` | ADMIN | ✓ | Void pengiriman, kembalikan stok, wajib alasan |
| `ledger.kartuStock` | semua | – | Mutasi + saldo berjalan per batch |
| `report.reconciliation` | semua | – | Total masuk/keluar/stok/selisih + exception |
| `user.list` / `user.create` / `user.update` / `user.resetPassword` | ADMIN | ✓ | Kelola pengguna |
| `audit.list` | ADMIN | – | Lihat audit log |

## 4. Paginasi

Daftar besar mendukung `page`, `pageSize` (default 50), `q` (pencarian), dan filter spesifik per action (mis. `status`, `customerId`, `from`, `to`).

## 5. Kontrak Stok & Pengiriman (Fase 3)

Satu **batch** = satu baris `receipts` (setiap penerimaan fisik membuat satu batch).
Karena itu `id` batch = `id` receipt, dan sisa batch selalu dihitung
`qty receipt − Σ shipment_consumptions` pengiriman non-DRAFT/non-VOID.

### `stock.list`

```json
{ "action": "stock.list", "params": { "q": "", "customerId": "", "includeEmpty": false } }
```

Balasan: `{ items[], perCustomer[], totals:{batches,qty,customers} }`.
Tiap item: `{ id, batchNumber, date, qtyIn, available, kondisi, rackId, rackCode,
productId, productCode, productName, unit, sjNo, customerId, customerName }`.

### `stock.available`

```json
{ "action": "stock.available", "params": { "customerId": "<id>" } }
```

Balasan: `{ customerId, items[], totals:{batches,qty} }` — hanya batch bersisa > 0.

### `shipment.create`

```json
{ "action": "shipment.create", "params": {
  "date": "2026-11-12", "customerId": "<id>",
  "driver": "Budi", "vehicle": "B 1234 XY", "note": "",
  "lines": [ { "productId": "<id>", "receiptId": "<id batch>", "rackId": "<id rak>", "qty": 30 } ] } }
```

Nomor `DO-TTR-{urut 3}` diambil dari counter terpisah. Status langsung `SHIPPED`
(langsung memotong stok). Validasi stok **diulang di server di dalam lock** dan
mengakumulasi baris yang memakai batch sama.

Error: `INSUFFICIENT_STOCK` (qty > sisa), `VALIDATION_ERROR` (batch bukan milik
pelanggan / produk tidak cocok), `NOT_FOUND` (batch hilang).

### `shipment.markDelivered`

```json
{ "action": "shipment.markDelivered", "params": { "no": "DO-TTR-001", "podDate": "2026-11-13" } }
```

`podDate` opsional (default hari ini) dan tidak boleh sebelum tanggal kirim.
Pengiriman `VOID` ditolak; yang sudah `DELIVERED` dikembalikan apa adanya.

### `shipment.printData`

```json
{ "action": "shipment.printData", "params": { "no": "DO-TTR-001" } }
```

Menaikkan `print_count` + menyimpan `last_printed_at`. Balasan berisi
`no, date, customerId, customer{name,address,phone}, driver, vehicle, note,
status, podDate, printCount, lines[{productId,rackId,qty,batchNumber,sjNo}],
company{}` — dipakai `frontend/js/print.js`. Pengiriman `VOID` ditolak.

### `shipment.void`

```json
{ "action": "shipment.void", "params": { "no": "DO-TTR-001", "reason": "salah input qty" } }
```

ADMIN saja, `reason` wajib. Status menjadi `VOID`; stok kembali otomatis karena
pengiriman VOID diabaikan saat menghitung sisa batch, dan dicatat mutasi
`VOID_OUT` (+qty) untuk jejak kartu stock.

## 6. Kontrak Laporan (Fase 4)

### `dashboard.summary`

```json
{ "action": "dashboard.summary", "params": {} }
```

Balasan: `stockTotal, stockBatches, stockCustomers, pendingPhysical, pendingRows,
oldestPendingDays, sjNotFinished, sjOpen, sjWaiting, openLines, notDelivered,
hangingDifference, topPending[5], stockByCustomer[]`.

### `ledger.kartuStock`

```json
{ "action": "ledger.kartuStock", "params": {
  "code": "", "batch": "", "customerId": "", "from": "", "to": "" } }
```

`code` dan `batch` adalah pencarian sebagian (contains). Balasan:
`items[], totals:{rows,in,out,balance,batches}, filtered`.

Tiap item: `{ date, type, ref, productId, productCode, productName, unit,
batchNumber, rackId, rackCode, customerId, customerName, sjRef, note,
qty, in, out, balance, isGroupStart, isGroupEnd }`.

> `balance` adalah saldo berjalan **dari seluruh riwayat batch**, bukan hanya
> baris yang lolos filter. Jadi memfilter tanggal tidak mengubah arti saldo —
> hanya memilih baris mana yang ditampilkan.

### `report.reconciliation`

```json
{ "action": "report.reconciliation", "params": { "limit": 15 } }
```

Balasan: `totalIn, totalOut, stock, hanging, variance, checks{stockFromBatches,
stockFromMovements, balanced}, byType[], exceptions[], recentMovements[],
totals{exceptionRows,movements,batches,shipments,sj}`.

> `variance` = `stockFromBatches − stockFromMovements` dan **harus 0**. Nilai
> selain 0 berarti ada data tidak konsisten antara pengurangan stok dan mutasi.

### `user.*` dan `audit.list`

`user.list` / `user.create` / `user.update` / `user.resetPassword` dan
`audit.list` (ADMIN). `audit.list` menerima `q`, `page`, `pageSize` dan
mengembalikan `{ items[], page, pageSize, total, totalPages }`.
