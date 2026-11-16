# RUNBOOK — Operasi & Rilis

Panduan operasional Sistem Gudang Titipan (backend Apps Script + Sheets,
frontend statis Netlify).

---

## 1. Peta lingkungan

| Lingkungan | Spreadsheet | Deployment GAS | Frontend |
| --- | --- | --- | --- |
| DEV (sekarang) | `database_gudang_titipan` | `/exec` aktif, `access: ANYONE_ANONYMOUS` | Netlify dari repo ini |
| PROD | spreadsheet terpisah | deployment terpisah | Netlify production |

`frontend/js/config.js` adalah **satu-satunya berkas** yang berbeda antar
lingkungan (PRD 12.1). URL `/exec` tetap sama bila memakai
*Manage deployments → Edit → New version*.

---

## 2. Alur rilis backend

```bash
cd backend
clasp push                     # kirim kode ke Apps Script
```

Lalu buat versi baru dan pindahkan deployment ke versi itu (jangan
`clasp redeploy`, karena akan mereset konfigurasi akses Web App):

1. Buat versi baru lewat menu **Deploy → Manage deployments → Edit → Version: New version**.
2. Pastikan **Who has access** tetap `Anyone` dan **Execute as** tetap `Me`.
3. Simpan. URL `/exec` tidak berubah.

Verifikasi setelah rilis:

```json
{ "action": "system.health", "params": {} }
```

Harus mengembalikan `ok: true` beserta `version` dan `timeZone: Asia/Jakarta`.

---

## 3. Backup

Backup = salinan spreadsheet database ke folder Drive
(`Gudang Titipan Backup`, bisa diubah lewat `system.hardening`).

**Manual (kapan saja, ADMIN):**

```json
{ "action": "system.backupDatabase", "params": {} }
```

```json
{ "action": "system.backupStatus", "params": {} }
```

Retensi default **30 salinan**; salinan tertua otomatis dipindahkan ke trash
saat melewati batas (`backupKeep`, 1–365).

**Harian otomatis (dipasang sekali, tanpa mengubah scope):**

Program ini sengaja **tidak** memakai `ScriptApp.newTrigger()`, karena menambah
scope `script.scriptapp` memaksa otorisasi ulang dan berisiko mematikan Web App
yang sudah berjalan. Pasang trigger lewat UI:

1. Buka proyek di <https://script.google.com>.
2. Menu **Triggers** (ikon jam) → **Add Trigger**.
3. Function: `backupDatabase_` · Event source: **Time-driven** ·
   Type: **Day timer** · pilih jam (mis. 01:00–02:00).
4. Simpan. Google akan meminta otorisasi Drive sekali — setujui.

> `backupDatabase_` menerima parameter dari trigger sebagai objek event, bukan
> `params`, jadi aman dipanggil tanpa argumen.

**Restore:**

1. Buka folder `Gudang Titipan Backup` di Drive.
2. Pilih salinan sesuai tanggal, klik kanan → **Make a copy**.
3. Buka salinan itu, salin ID dari URL.
4. Set Script Property `SPREADSHEET_ID` ke ID salinan tersebut (Project Settings →
   Script Properties), **atau** jalankan `system.setup` dengan `spreadsheetId`
   salinan + `key` yang benar.
5. Jalankan `system.health`, lalu cek Dashboard dan Rekonsiliasi.

Tindakan restore mengubah database aktif — lakukan di luar jam operasional dan
catat di audit log.

---

## 4. Kunci go-live

Saat sistem dinyatakan produksi, matikan endpoint sensitif:

```json
{ "action": "system.hardening", "params": { "lock": true } }
```

Efeknya (lihat `sensitiveActions` pada respons):

| Action | Saat terkunci |
| --- | --- |
| `system.setup` | ditolak `FORBIDDEN` |
| `system.selfTest` | ditolak `FORBIDDEN` |
| action lain | tetap berjalan normal |

`system.health`, login, dan seluruh transaksi **tidak** terpengaruh.

Buka kembali bila perlu (mis. setup ulang saat perbaikan):

```json
{ "action": "system.hardening", "params": { "lock": false } }
```

Status lengkap + checklist ada di respons `system.hardening` tanpa parameter.

---

## 5. Kunci & rahasia

| Nama | Tempat | Catatan |
| --- | --- | --- |
| `SPREADSHEET_ID` | Script Properties | ID database aktif |
| `SETUP_KEY` | Script Properties | wajib untuk `system.setup` setelah setup pertama |
| `ADMIN_EMAIL` | Script Properties | untuk notifikasi (opsional, lihat §7) |
| Token sesi | respons `auth.login` | berlaku 12 jam, disimpan di `sessionStorage` |
| Password | sheet `users` | SHA-256 + salt; tidak pernah tersimpan polos |

**Rotasi `SETUP_KEY`:** hapus property `SETUP_KEY`, jalankan `system.setup`
sekali (akan membuat kunci baru bila sistem belum terkonfigurasi), lalu simpan
kunci baru di tempat aman. Jangan pernah membagikan kunci ini.

**Ganti password admin:** lewat halaman **Pengguna → Reset Password**
(disarankan segera setelah serah terima).

---

## 6. Pemantauan

| Yang dipantau | Cara |
| --- | --- |
| Error tak terduga | Halaman **Audit & Error → tab Error Log**, atau `error.list` |
| Aktivitas pengguna | Halaman **Audit & Error → tab Audit Log** |
| Keseimbangan stok | Halaman **Rekonsiliasi** — `variance` harus `0` |
| Backup | `system.backupStatus` |
| Kesehatan API | `system.health` (publik, bisa dicek dari luar) |

Hanya error **tak terduga** yang dicatat ke `error_log`; kesalahan wajar
(validasi, sesi kedaluwarsa, stok kurang) sengaja tidak dicatat agar log tetap
berguna. Log dipangkas otomatis pada 1000 baris.

---

## 7. Notifikasi email (belum aktif — perlu keputusan)

PRD meminta email ke admin bila ada error `INTERNAL` berulang. Modul ini belum
mengaktifkannya karena `MailApp` memerlukan scope `script.send_mail`, dan
**menambah scope memaksa otorisasi ulang** seluruh Web App.

Bila diinginkan: tambahkan scope tersebut di `backend/src/appsscript.json`,
otorisasi ulang sekali lewat browser, lalu kirim email dengan throttle
(mis. maksimal 1 email per 30 menit) ke `ADMIN_EMAIL`.

Sementara ini, pantau lewat tab Error Log.

---

## 8. Risiko & batasan yang diketahui

### Kinerja — optimasi P2 (diukur 2026-11-16, p50, n=8–12 per endpoint)

Kelanjutan P1, tetap tanpa mengubah kontrak API:

5. **Cache baca bersama berbasis "versi data"** (`cachedRead_`). Setiap aksi
   tulis menaikkan versi di `CacheService`; kunci cache memuat versi itu,
   sehingga hasil baca lama **tidak mungkin** tersaji setelah ada perubahan.
   Bila ada request baca yang mulai sebelum penulisan selesai, hasilnya
   tersimpan dengan versi lama yang sudah tidak dibaca lagi — jadi tidak ada
   data basi. Yang di-cache: `dashboard.summary`, `stock.list`, `pending.list`,
   `sj.list`, `sj.get`, `shipment.list`, `master.list`, `master.listAll`,
   `ledger.kartuStock`, `report.reconciliation` (TTL 30–120 dtk).
   Hanya endpoint yang **tidak** memuat data pribadi pengguna yang di-cache.
6. **`master.listAll`** — satu request untuk produk+pelanggan+gudang+rak.
   Halaman Master memakainya setelah simpan/hapus (dulu 4 panggilan ±3 dtk
   masing-masing).
7. **Pembersihan sesi kedaluwarsa** dijalankan dari `auth.login` maksimal
   sekali per jam (≤50 baris per putaran), supaya tabel `sessions` tidak
   tumbuh selamanya dan biaya baca tidak naik seiring waktu.
8. **Cache master 5 → 15 menit** dan **cache kop surat** (`getCompany_`,
   sebelumnya 6 kali `getProperty` per panggilan).

| Endpoint | p50 setelah P1 | p50 setelah P2 | Perubahan |
| --- | --- | --- | --- |
| `system.health` (tanpa sheet) | 1,65 dtk | 1,70 dtk | — lantai platform |
| `system.bootstrap` | 2,05 dtk | 2,01 dtk | — (tidak di-cache: memuat profil pengguna) |
| `master.list` rack | 2,03 dtk | 1,80 dtk | −11% |
| `master.list` product | 1,85 dtk | 1,81 dtk | — |
| `stock.list` | 4,28 dtk | **1,95 dtk** | **−54%** |
| `dashboard.summary` | 3,99 dtk | **1,86 dtk** | **−53%** |
| `sj.list` | 3,69 dtk | **1,96 dtk** | **−47%** |
| `pending.list` | 3,42 dtk | **1,91 dtk** | **−44%** |

Sekarang hampir semua endpoint baca berada di **lantai platform** (~1,6–2,0 dtk):
yang tersisa hanyalah biaya masuk ke Apps Script. Permintaan pertama per versi
data (mis. langsung setelah simpan) tetap ±3,5–4,5 dtk karena harus membaca
sheet.

Kebenaran data dijaga uji di `system.selfTest`: 26/26 lulus, termasuk uji
"versi data naik → entri cache lama tidak terpakai" dan bentuk balasan
`master.listAll`.

### Kinerja — optimasi P1 (diukur 2026-11-16, p50, n=8–12 per endpoint)

Empat perubahan yang tidak mengubah kontrak API maupun aturan keamanan:

1. **Cache konteks sesi 60 detik** (`CacheService`). Sesi + user tidak lagi
   dibaca dari sheet di setiap request. Pencabutan tetap **seketika** untuk
   logout/ubah user/reset password karena kunci cache dibuang eksplisit, dan
   setiap perubahan data user menaikkan `epoch` otorisasi sehingga konteks
   lama tidak cocok lagi. Perubahan langsung di sheet berlaku ≤60 detik.
2. **Cek `PROD_LOCK` hanya untuk action sensitif** (`system.setup`,
   `system.selfTest`). Action lain tidak lagi membayar satu service call
   `PropertiesService` per request.
3. **Audit ditulis sekali per request** (`appendRows_`), dikumpulkan di memori
   dan di-flush di dalam lock. Isi audit tidak berkurang; aksi yang mencatat
   beberapa peristiwa tidak lagi membayar satu round-trip per baris.
4. **"Fisik Terima" semua baris ditulis batch** (`appendRows_` +
   `updateManyById_`). Sebelumnya 10 baris ≈ 30–40 round-trip sheet
   (2 append + 1 update baca+tulis per baris), sekarang ±4.

| Endpoint | p50 sebelum | p50 sesudah | Perubahan |
| --- | --- | --- | --- |
| `system.health` (tanpa sheet) | 1,72 dtk | 1,65 dtk | — (lantai platform) |
| `system.bootstrap` | 3,66 dtk | 2,05 dtk | **−44%** |
| `master.list` rack | 3,35 dtk | 2,03 dtk | **−40%** |
| `master.list` product | 2,88 dtk | 1,85 dtk | **−36%** |
| `pending.list` | 5,21 dtk | 3,42 dtk | **−34%** |
| `stock.list` | 4,98 dtk | 4,28 dtk | −14% |
| `dashboard.summary` | 4,49 dtk | 3,99 dtk | −11% |
| `sj.list` | 3,67 dtk | 3,69 dtk | — (derau) |

Sisa waktu tetap didominasi lantai platform (~1,6 dtk) dan pembacaan tabel
transaksi yang harus segar. Regresi diuji lewat `system.selfTest`
(24/24 lulus, termasuk uji `updateManyById_` dan rak tanpa nama).

### Kinerja (diukur 2026-11-13, uji beban kecil)

**Batas bawah platform.** `curl` ke `/exec` menunjukkan TTFB **1,06–1,38 dtk**
hanya untuk menerima HTTP 302 — sebelum satu baris kode kita berjalan.
`system.health` yang tidak menyentuh sheet sama sekali pun ~1,7 dtk.

| Endpoint | p50 sebelum optimasi | p50 sesudah |
| --- | --- | --- |
| `system.health` (tanpa akses sheet) | 1,7 dtk | 1,7 dtk |
| `system.bootstrap` | 3,70 dtk | 3,33 dtk |
| `dashboard.summary` | 3,90 dtk | 3,63 dtk |
| `stock.list` | 4,78 dtk | 3,71 dtk |
| `report.reconciliation` | 4,44 dtk | 3,73 dtk |
| 5 permintaan bersamaan | sukses 15/15 | sukses 15/15 |

**Yang berhasil (server):** cache per-eksekusi + cache master data di
`CacheService` (produk/pelanggan/gudang/rak, 5 menit, dibuang setiap kali tabel
master ditulis) → 7–22% lebih cepat, dan menghapus 4 round-trip dari endpoint
terpanas.

**Yang gagal dan dicabut:** prefetch semua tabel via `values:batchGet` +
`UrlFetchApp` ternyata **tidak lebih cepat** (bootstrap 3,5 → 4,0 dtk). Alasan
didokumentasikan di `Db.gs` supaya tidak diulang.

**Sisa waktu tidak bisa ditekan tanpa mengubah arsitektur:** 6 tabel transaksi
(`receipts`, `shipment_consumptions`, `shipments`, `shipment_lines`, `sj`,
`sj_lines`) harus dibaca segar setiap request, masing-masing satu round-trip
`getValues()` ~250–350 ms.

### Kinerja terasa (cache di browser) — dampak terbesar

Frontend menyimpan salinan respons di `localStorage` dan memakai pola
*stale-while-revalidate*: data lama tampil **seketika**, lalu disegarkan di
belakang dengan indikator **"Memperbarui…"**.

| Skenario | Sebelum | Sesudah |
| --- | --- | --- |
| Kunjungan pertama sebuah halaman | ~3,2 dtk | ~3,2 dtk (tidak berubah) |
| **Kunjungan berikutnya / pindah-pindah halaman** | ~3,2 dtk | **~0,001 dtk** |

Cara kerjanya:

- Cache dipisah **per pengguna**; berganti akun → cache dibuang.
- Setiap aksi **tulis** membuang seluruh cache, lalu halaman memuat data segar.
- Indikator "Memperbarui…" muncul selama penyegaran latar berjalan.
- Halaman dirender ulang otomatis bila isi data berubah — **kecuali** sedang ada
  modal terbuka atau pengguna sedang mengetik (agar fokus tidak hilang).
- Bila jaringan gagal tetapi ada salinan lama, data lama tetap ditampilkan
  dengan pesan yang jelas — bukan layar kosong.
- Form yang butuh data pasti (sisa batch pada form pengiriman) memakai
  `{ fresh: true }` sehingga **tidak** memakai cache.

**Bila data terlihat tidak sesuai:** tunggu beberapa detik (penyegaran latar
berjalan otomatis), atau buka DevTools → `localStorage.removeItem('gt_cache_v1')`
lalu muat ulang. Verifikasi kebenaran tetap dari **Rekonsiliasi** (`variance`).

**Bila target 300 ms tetap wajib:** hanya bisa dicapai dengan memindahkan API
keluar dari Apps Script (edge/serverless + database sungguhan, mis. Postgres
atau D1). Kontrak API tidak perlu berubah — hanya lapisan `Db.gs` yang diganti.

### Batasan lain

| Batasan | Dampak | Mitigasi |
| --- | --- | --- |
| Sheets bukan DB transaksional | Data rusak bila diedit manual | Lock pada tulis, validasi, backup harian, larang edit manual |
| Kuota Apps Script | Eksekusi berhenti saat kuota habis | ≤10 pengguna, ≤500 transaksi/hari |
| `movements` tumbuh | Sheet melambat | Arsipkan per tahun setelah ±100 ribu baris |
| Web App `Anyone` | URL bisa dicoba pihak luar | Token sesi, throttle login (5x → kunci 10 menit), tanpa data sensitif di respons publik |
| Popup cetak | Cetak gagal bila diblokir | Pesan arahkan izinkan popup; `print_count` tidak naik bila diblokir |

---

## 9. Insiden umum

| Gejala | Kemungkinan penyebab | Tindakan |
| --- | --- | --- |
| Semua halaman menampilkan "Gagal menghubungi server" | deployment belum dipindah ke versi baru, atau URL `/exec` berubah | cek `system.health`, pindahkan deployment ke versi terbaru |
| Data terlihat tidak sesuai / tertinggal | salinan cache browser | tunggu beberapa detik (penyegaran latar otomatis), atau hapus `localStorage` kunci `gt_cache_v1` lalu muat ulang |
| Halaman pertama kali dibuka terasa lambat | belum ada salinan cache | wajar (~3 dtk); kunjungan berikutnya instan |
| Login gagal padahal password benar | akun terkunci setelah 5x gagal | tunggu 10 menit, atau ADMIN reset password |
| `FORBIDDEN` pada action tertentu | `PROD_LOCK` aktif | cek `system.hardening`, buka kunci bila memang perlu |
| `UNAUTHENTICATED` terus | token kedaluwarsa (12 jam) | login ulang; frontend otomatis mengarahkan ke halaman login |
| `LOCK_TIMEOUT` | dua tulis bersamaan | ulangi beberapa detik lagi |
| Stok terlihat tidak cocok | ada edit manual di sheet | cek **Rekonsiliasi** `variance`; restore dari backup bila perlu |
