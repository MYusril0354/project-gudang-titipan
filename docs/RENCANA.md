# Rencana Implementasi

Status saat ini: **Fase 0 selesai** (backend live, database terbentuk). **Fase 1 sebagian** (auth selesai, CRUD master menyusul).

## Ringkas Status

| Fase | Cakupan | Status |
| --- | --- | --- |
| **0. Fondasi** | Spreadsheet + sheet, proyek GAS, router, envelope, `system.health`, helper Db, deployment DEV | ✅ Selesai |
| **1. Auth & master** | `auth.*`, `users`, RBAC, `system.bootstrap`, CRUD master | 🟡 Auth + bootstrap selesai; CRUD master belum |
| **2. SJ & penerimaan** | `sj.*`, `pending.list`, counter, batch suggestion, receipts, cancellations | ⬜ Belum |
| **3. Stok & pengiriman** | `stock.*`, `shipment.*`, consumption, movements, lock, POD, void, cetak | ⬜ Belum |
| **4. Laporan** | `dashboard.summary`, `ledger.kartuStock`, `report.reconciliation` | ⬜ Belum |
| **5. Hardening & rilis** | Audit log, backup harian, error log, uji beban, header keamanan, impor CSV, UAT, PROD | ⬜ Belum |

## Fase 0 — Selesai

Hasil yang sudah terpasang:

| Item | Nilai |
| --- | --- |
| Proyek Apps Script | "Gudang Titipan API" |
| Deployment Web App | v4, `access: ANYONE_ANONYMOUS`, `executeAs: USER_DEPLOYING` |
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

## Fase 1 — Yang Sudah Jalan

- `auth.login` — verifikasi SHA-256 + salt, token UUID, masa berlaku 12 jam, kunci akun setelah 5x gagal (10 menit)
- `auth.me`, `auth.logout`
- `system.bootstrap` — master data + konstanta + tanggal server + info perusahaan
- `master.list` — baca produk/pelanggan/gudang/rak
- RBAC: `requireSession_` memeriksa peran per action
- Audit log untuk login berhasil/gagal
- Idempotency key (`requestId`) lewat CacheService

**Belum:** `master.create/update/delete`, `user.*`, `audit.list`.

## Langkah Berikutnya

1. **CRUD master data** (`master.create/update/delete` + aturan `IN_USE`) — menyelesaikan Fase 1.
2. **Halaman UI master data & login** — frontend masih placeholder.
3. **Fase 2**: SJ & penerimaan (nilai bisnis utama).

