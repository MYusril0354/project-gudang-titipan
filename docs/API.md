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
