# Sistem Gudang Titipan (Consignment Monitor)

Aplikasi monitoring **gudang titipan**: melacak barang yang sudah dipotong stoknya oleh Surat Jalan (SJ) tetapi **fisiknya belum diterima** di gudang titipan pelanggan, mengelola stok titipan per batch, membuat pengiriman keluar dengan jejak batch, serta menyediakan kartu stock dan laporan rekonsiliasi.

> Status: **Fase 5 — Hardening & rilis**. Aplikasi lengkap (10 halaman, semua
> memakai data nyata) dengan backup, error log, impor CSV, kunci go-live, dan
> dokumen operasional. Lihat [docs/RUNBOOK.md](docs/RUNBOOK.md) dan
> [docs/UAT.md](docs/UAT.md).

---

## 1. Latar Belakang Masalah

SJ sudah memotong stok di sistem existing, tetapi fisik barang belum tentu sudah sampai di gudang titipan pelanggan. Selisih inilah yang harus dilacak:

- **Fisik belum ada** → antrean pending dengan alasan, ETA, dan PIC.
- **Fisik ada (sebagian/seluruh)** → lahir **batch** baru dengan No. Batch, rak, dan tanggal.
- **Pengiriman keluar** → memilih batch spesifik, menyimpan jejak batch + SJ asal.
- **Rekonsiliasi** → Masuk − Keluar = Stok Titipan, tanpa selisih.

## 2. Arsitektur

```
[Browser]  ──HTTPS──▶  [Netlify: file statis HTML/CSS/JS]
    │
    └── fetch (POST, JSON sebagai text/plain) ──▶ [GAS Web App /exec]
                                                        │ router doPost(e)
                                                        ▼
                                           [Service layer + validasi + LockService]
                                                        ▼
                                           [Google Spreadsheet = database]
```

**Backend:** Google Apps Script (GAS) Web App + Google Sheets sebagai database.
**Frontend:** HTML/CSS/JS statis, di-deploy mandiri (Netlify atau hosting statis lain).

### Keputusan teknis kunci

| Aspek | Keputusan |
| --- | --- |
| CORS | Frontend **wajib** kirim `Content-Type: text/plain;charset=utf-8` (isi body JSON), **tanpa** header kustom. Token dikirim di body. |
| Metode | Semua panggilan `POST` (termasuk baca). `GET` hanya untuk health check. |
| Status HTTP | Selalu `200` dari GAS; hasil sebenarnya di field `ok` dan `error.code`. |
| Konkurensi | Semua tulis dibungkus `LockService.getScriptLock().waitLock(15000)`. |
| Zona waktu | `appsscript.json` → `"timeZone": "Asia/Jakarta"`. |
| Idempotency | `requestId` dari klien menjadi idempotency key pada aksi tulis. |
| Stok | **Tidak** disimpan sebagai kolom; selalu dihitung dari `receipts` − `shipment_consumptions`. |

## 3. Struktur Repo

```
.
├── PRD — Sistem Gudang Titipan (Consignment Monitor).md   # spesifikasi lengkap
├── deepseek_html_20261111_b19203.html                     # prototipe UI (referensi)
├── netlify.toml                                           # deploy Netlify + header CSP
├── backend/                                               # Google Apps Script
│   ├── .clasp.json
│   └── src/
│       ├── appsscript.json    # zona waktu, scope, konfigurasi Web App
│       ├── Code.gs            # doGet, doPost, router, envelope
│       ├── Auth.gs            # login, hash password, sesi, RBAC
│       ├── Db.gs              # helper Sheets (baca/append/update/hapus)
│       ├── Domain.gs          # pendingOf, lineStatus, sjStatus, stok, kartu stock
│       ├── Setup.gs           # penyiapan database & user admin pertama
│       ├── Util.gs            # tanggal, penomoran counter, validasi, escape
│       └── Handlers_*.gs      # master, sj, shipment, stock, report
├── frontend/                                              # statis, deploy ke Netlify
│   ├── index.html
│   ├── login.html
│   ├── css/app.css
│   └── js/
│       ├── config.js          # API_URL per lingkungan (satu-satunya file yang diganti)
│       ├── api.js             # klien API + envelope handling
│       ├── state.js           # state + cache master data
│       ├── main.js            # navigasi + bootstrap
│       ├── login.js           # logika halaman login
│       ├── ui.js              # helper DOM (ikon SVG, modal, progress, tabel)
│       ├── cache.js           # cache browser + stale-while-revalidate
│       ├── print.js           # cetak surat jalan
│       ├── print-stock.js     # cetak laporan posisi stok titipan
│       ├── pages/*.js         # dashboard, penerimaan, pending, stok, pengiriman,
│       │                      # kartu, laporan, master, pengguna, audit
│       ├── modals/*.js        # sj, sj-create, shipment, user
│       └── print.js
└── docs/
    ├── API.md                 # kontrak REST API
    ├── DATA-MODEL.md          # skema sheet
    ├── RENCANA.md             # rencana implementasi per fase
    ├── RUNBOOK.md             # operasi: rilis, backup/restore, kunci, insiden
    └── UAT.md                 # checklist kriteria penerimaan
```

## 4. Status Backend (sudah ter-deploy)

| Item | Nilai |
| --- | --- |
| Proyek Apps Script | Gudang Titipan API |
| Deployment | Web App v41 · `access: ANYONE_ANONYMOUS` · `executeAs: USER_DEPLOYING` |
| Spreadsheet database | `database_gudang_titipan` (17 tabel) |
| Zona waktu | `Asia/Jakarta` |
| Endpoint | URL `/exec` sudah diisi di [frontend/js/config.js](frontend/js/config.js) |

### Perintah harian

```bash
cd backend
clasp push                 # kirim perubahan kode ke Apps Script
clasp create-version       # buat versi baru (wajib sebelum deploy ulang)
clasp list-deployments     # lihat ID deployment
```

Setelah `clasp push`, Web App **belum** ikut berubah sampai deployment
dipindah ke versi baru. Bila memakai *Manage deployments → Edit → New version*,
URL `/exec` tetap sama.

### Setup database

Action `system.setup` menyiapkan 17 sheet + header, user ADMIN pertama, dan
counter awal. Aman dijalankan berulang.

> `system.setup` hanya bisa dipanggil tanpa kunci bila sistem **belum**
> dikonfigurasi. Setelah itu `SETUP_KEY` tersimpan di Script Properties dan
> wajib dikirim. Jangan bagikan `SETUP_KEY` maupun spreadsheet ke publik.

### Menjalankan frontend

```bash
cd frontend
npx serve .
```

Buka halaman yang ditampilkan, lalu login. Deploy ke Netlify:
**publish directory** = `frontend`, **build command** kosong.

## 5. Kontrak API (ringkas)

Satu endpoint: `POST {GAS_EXEC_URL}` dengan routing lewat field `action`.

```json
{
  "action": "sj.line.receive",
  "token": "<token sesi>",
  "requestId": "uuid-dari-klien",
  "params": { "sjNo": "SJ/2026/0008", "lineId": "L-102", "qty": 40 }
}
```

Sukses: `{ "ok": true, "data": {...}, "meta": { "serverTime": "..." } }`
Gagal: `{ "ok": false, "error": { "code": "...", "message": "...", "field": "..." } }`

Daftar lengkap action ada di [docs/API.md](docs/API.md).

## 6. Peran Pengguna

| Peran | Hak akses |
| --- | --- |
| **ADMIN** | Semua fitur, kelola user, master data, void pengiriman |
| **GUDANG** | Input SJ, konfirmasi fisik, buat pengiriman, tandai POD, cetak |
| **VIEWER** | Hanya baca (dashboard, stok, kartu stock, laporan) |

## 7. Rencana Implementasi

| Fase | Cakupan | Hasil |
| --- | --- | --- |
| **0. Fondasi** | Spreadsheet + sheet, proyek GAS, router, envelope, health, helper Db, deployment DEV | Frontend bisa memanggil `health` tanpa CORS error |
| **1. Auth & master** | `auth.*`, `users`, RBAC, `system.bootstrap`, CRUD master | Login + Master Data end-to-end |
| **2. SJ & penerimaan** | `sj.*`, `pending.list`, counter, batch suggestion, receipts, cancellations | ✅ Alur SJ → Fisik Ada / Belum Ada / Batalkan berjalan end-to-end |
| **3. Stok & pengiriman** | `stock.*`, `shipment.*`, consumption, movements, lock, POD, void, cetak | ✅ Stok per batch + pengiriman, POD, void, cetak berjalan |
| **4. Laporan** | `dashboard.summary`, `ledger.kartuStock`, `report.reconciliation`, `user.*`, `audit.list` | ✅ Dashboard, kartu stock, rekonsiliasi, pengguna, audit berjalan |
| **5. Hardening & rilis** | Backup harian, error log, impor CSV, kunci go-live, uji beban, UAT, RUNBOOK | ✅ Selesai (email alert belum — perlu scope tambahan) |

## 8. Dokumen

- [PRD lengkap](<PRD — Sistem Gudang Titipan (Consignment Monitor).md>) — aturan bisnis, model data, kriteria penerimaan
- [Prototipe UI](deepseek_html_20261111_b19203.html) — sumber tampilan & perilaku
- [docs/API.md](docs/API.md) — kontrak API
- [docs/DATA-MODEL.md](docs/DATA-MODEL.md) — skema sheet
- [docs/RENCANA.md](docs/RENCANA.md) — rencana per fase

## 9. Lisensi

Internal / proprietary. Belum ditentukan.
