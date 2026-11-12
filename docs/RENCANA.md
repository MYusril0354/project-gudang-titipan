# Rencana Implementasi

Status saat ini: **Fase 2 selesai** (SJ & penerimaan berjalan end-to-end, backend live v15, frontend Penerimaan & Fisik Belum Ada aktif).

## Ringkas Status

| Fase | Cakupan | Status |
| --- | --- | --- |
| **0. Fondasi** | Spreadsheet + sheet, proyek GAS, router, envelope, `system.health`, helper Db, deployment | ✅ Selesai |
| **1. Auth & master** | `auth.*`, `users`, RBAC, `system.bootstrap`, CRUD master | ✅ Selesai |
| **2. SJ & penerimaan** | `sj.*`, `pending.list`, counter, batch suggestion, receipts, cancellations | ✅ Selesai |
| **3. Stok & pengiriman** | `stock.*`, `shipment.*`, consumption, movements, lock, POD, void, cetak | ⬜ Belum |
| **4. Laporan** | `dashboard.summary`, `ledger.kartuStock`, `report.reconciliation` | ⬜ Belum |
| **5. Hardening & rilis** | Audit log, backup harian, error log, uji beban, header keamanan, impor CSV, UAT, PROD | ⬜ Belum |

## Fase 0 — Selesai

Hasil yang sudah terpasang:

| Item | Nilai |
| --- | --- |
| Proyek Apps Script | "Gudang Titipan API" |
| Deployment Web App | v15, `access: ANYONE_ANONYMOUS`, `executeAs: USER_DEPLOYING` |
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

1. **Fase 3 — Stok & pengiriman**: implementasi `stock.*` (stok per batch), `shipment.*` (konsumsi batch, POD, void, cetak).
2. **Fase 4 — Laporan**: `dashboard.summary`, `ledger.kartuStock`, `report.reconciliation` memakai data nyata.
3. Hapus `system.setup` & `system.selfTest` dari router sebelum go-live (catatan keamanan).

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

