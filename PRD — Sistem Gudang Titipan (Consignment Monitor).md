# PRD — Sistem Gudang Titipan (Consignment Monitor)

**Versi:** 1.0 (draft) · **Tanggal:** 11 Nov 2026 · **Sumber:** analisis prototipe `deepseek_html_20261111_b19203__1_.html` **Stack:** Backend REST API di Google Apps Script (GAS) + Google Sheets · Frontend statis di-deploy mandiri (Netlify / hosting lain)

---

## 1. Ringkasan

Prototipe HTML saat ini adalah aplikasi satu file dengan data dummy di memori browser (`const db = {...}`); semua perubahan hilang saat halaman di-refresh. PRD ini mengubah prototipe tersebut menjadi sistem produksi dengan dua bagian terpisah:

1. **Backend**: Google Apps Script Web App yang menyediakan REST-style API, menyimpan data di Google Sheets, dan memegang seluruh logika bisnis (validasi, perhitungan stok, nomor dokumen).
2. **Frontend**: UI dari prototipe, dipisah menjadi file statis (HTML/CSS/JS) yang memanggil API lewat `fetch`, di-deploy sendiri ke Netlify atau hosting statis lain.

**Masalah bisnis yang diselesaikan:** Surat Jalan (SJ) sudah memotong stok di sistem existing, tetapi fisik barang belum tentu sudah diterima di gudang titipan pelanggan. Sistem ini melacak selisih tersebut (fisik belum ada), mencatat penerimaan fisik per batch, mengelola stok titipan per pelanggan/rak/batch, membuat pengiriman keluar dengan jejak batch dan SJ asal, serta menyediakan kartu stock dan laporan rekonsiliasi.

## 2. Tujuan & Metrik Sukses

| Tujuan | Metrik |
| --- | --- |
| Data tersimpan permanen dan bisa dipakai banyak pengguna | 100% transaksi tersimpan di Sheets; tidak ada data hilang saat refresh |
| Stok titipan akurat | Saldo kartu stock = stok titipan = Masuk − Keluar untuk setiap batch (selisih 0) |
| Pending fisik terpantau | Semua baris pending punya alasan, ETA, PIC, dan umur terlihat di dashboard |
| Traceability | Setiap baris pengiriman menampilkan No. Batch dan SJ asal di layar dan di cetakan |
| Responsif | Muat awal (bootstrap) < 3 dtk; aksi tulis < 4 dtk pada kondisi normal |

## 3. Ruang Lingkup

**Dalam lingkup (v1):** login & peran, master data (produk, pelanggan, gudang, rak), penerimaan SJ, konfirmasi fisik ada / belum ada / batalkan sisa, stok per batch, pengiriman dari gudang titipan, tandai POD, cetak Surat Jalan, kartu stock, dashboard, rekonsiliasi, audit log.

**Di luar lingkup (v1):** integrasi langsung ke ERP/sistem existing (SJ diinput manual seperti prototipe), barcode/scanner, notifikasi WhatsApp/email, multi-perusahaan, aplikasi mobile native, harga/nilai persediaan.

## 4. Pengguna & Peran

| Peran | Hak akses |
| --- | --- |
| **ADMIN** | Semua fitur, kelola user, master data, void pengiriman |
| **GUDANG** | Input SJ, konfirmasi fisik, buat pengiriman, tandai POD, cetak; master data hanya baca |
| **VIEWER** | Hanya baca (dashboard, stok, kartu stock, laporan) |

Prototipe belum punya login (avatar `AD` hanya hiasan). Peran di atas adalah penambahan baru.

## 5. Fitur (diturunkan dari prototipe)

| Halaman | Fungsi | Catatan perilaku dari prototipe |
| --- | --- | --- |
| **Dashboard** | 4 kartu (Stok Titipan, Fisik Belum Ada, SJ Belum Selesai, Belum Ada POD), callout selisih menggantung, Top 5 pending berdasarkan umur, stok per pelanggan | Umur = hari antara tanggal SJ dan hari ini |
| **Penerimaan SJ** | Daftar SJ + pencarian (no SJ / pelanggan / PO), tambah SJ multi-baris | SJ baru berstatus administratif; batch baru lahir saat Fisik Ada |
| **Fisik Belum Ada** | Antrean pending, bucket umur 0–7 hari dan >30 hari, aksi Fisik Ada / Batalkan | Hanya baris WAITING\_PHYSICAL dan PARTIALLY\_RECEIVED |
| **Stok Titipan** | Posisi stok per batch (batch, SJ asal, pelanggan, produk, rak, qty, umur) + ringkasan per pelanggan | Hanya batch dengan sisa > 0 |
| **Pengiriman** | Daftar DO, buat pengiriman dengan memilih batch spesifik, cetak SJ, badge jumlah cetak | Pilih batch manual, bukan FIFO otomatis |
| **Kartu Stock** | Filter kode produk, batch, pelanggan, rentang tanggal; saldo berjalan per batch | Urut pelanggan → kode produk → batch → tanggal |
| **Rekonsiliasi** | Total masuk/keluar/stok/selisih menggantung, exception report, 15 mutasi terakhir |  |
| **Master Data** | CRUD Produk, Pelanggan, Gudang, Rak | Data yang sudah dipakai tidak boleh dihapus |
| **Cetak Surat Jalan** | Dokumen cetak berkop perusahaan, tabel dengan No. Batch, Rak, SJ Asal, 3 kolom tanda tangan | Dibuka di jendela baru, lalu `window.print()` |

## 6. Aturan Bisnis (wajib dipindahkan ke backend)

Semua aturan berikut saat ini ada di JavaScript browser. Pada sistem baru, **backend adalah satu-satunya penentu**; frontend hanya menampilkan.

### 6.1 Status baris SJ

- `qtyReceived` = jumlah semua penerimaan (receipts) pada baris.
- `pending` = `qtySj − qtyReceived − qtyCancelled`.
- Status baris (urutan evaluasi):
  1. `pending ≤ 0` → `CANCELLED` bila `qtyCancelled ≥ qtySj`, selain itu `RECEIVED`.
  2. `qtyReceived > 0` → `PARTIALLY_RECEIVED`.
  3. `decision = WAITING` → `WAITING_PHYSICAL`.
  4. Selain itu → `OPEN` (belum diklasifikasi).
- Status SJ: `RECEIVED` jika semua baris RECEIVED/CANCELLED; `WAITING_PHYSICAL` jika ada baris WAITING\_PHYSICAL/PARTIALLY\_RECEIVED; selain itu `OPEN`.

### 6.2 Surat Jalan masuk

- No SJ unik; format otomatis `SJ/{tahun}/{urut 4 digit}` (urut = angka terbesar yang ada + 1). Boleh diubah manual, tetap harus unik.
- Wajib: tanggal, pelanggan, No PO, minimal 1 baris; tiap baris wajib produk dan qty ≥ 1.
- Baris baru: `decision = OPEN`, belum ada receipt.

### 6.3 Fisik Ada (penerimaan fisik)

- Pelanggan harus sudah punya gudang titipan dengan minimal 1 rak; jika tidak, tolak dengan pesan arahkan ke Master Data.
- Qty diterima: 1 ≤ qty ≤ pending. Boleh sebagian (bertahap), tiap penerimaan menghasilkan **satu batch baru**.
- No. Batch wajib; saran otomatis `BN-{YYYYMMDD}-{urut 3 digit}` (urut = jumlah penerimaan pada tanggal itu + 1). Harus unik.
- Rak tujuan harus milik gudang titipan pelanggan SJ tersebut.
- Bila pending menjadi 0, `decision = DONE`.
- Mencatat mutasi `CONSIGN_IN` (+qty).

### 6.4 Fisik Belum Ada

- Menyimpan `alasan` (BELUM\_READY\_PRODUKSI, BELUM\_DATANG\_SUPPLIER, BELUM\_DIVERIFIKASI, SALAH\_INPUT, LAINNYA), `eta`, `pic` (wajib). Stok tidak berubah.

### 6.5 Batalkan sisa

- Hanya untuk baris WAITING\_PHYSICAL / PARTIALLY\_RECEIVED. `qtyCancelled += pending`, `decision = DONE`.
- Alasan: BATAL\_PELANGGAN, BARANG\_TIDAK\_DATANG, SALAH\_INPUT, LAINNYA + catatan. **Prototipe tidak menyimpan alasan/catatan ini; versi produksi wajib menyimpannya** (tabel `cancellations`) dan menampilkannya di rekonsiliasi.

### 6.6 Stok titipan

- Stok per batch = `qtyIn − total qty terpakai pengiriman non-DRAFT`. Tampilkan hanya yang sisa > 0.
- Satu pelanggan hanya boleh punya **satu** gudang titipan. Gudang bertipe `MAIN` tidak terkait pelanggan.

### 6.7 Pengiriman

- Pengiriman selalu dari satu pelanggan; baris dipilih dari batch milik pelanggan itu.
- Qty per baris ≤ sisa batch, dihitung juga terhadap baris lain di draf yang sama. **Validasi ulang di server** saat simpan (di dalam lock) karena stok bisa berubah sejak layar dibuka.
- Nomor DO: `DO-TTR-{urut 3 digit}`. Prototipe memakai `jumlah DO + 1`, yang bisa bentrok bila ada data dihapus; versi produksi memakai **counter terpisah**.
- Status: `DRAFT` (tidak memotong stok), `SHIPPED` (stok keluar), `DELIVERED` (POD diterima, ada tanggal POD). Simpan dari UI langsung membuat `SHIPPED`.
- Tiap baris menyimpan `consumed[]`: batchId, sjNo, batchNumber, qty. Mencatat mutasi `CONSIGN_OUT` (−qty).
- Cetak SJ menambah `printCount` dan menyimpan `lastPrintedAt`.

### 6.8 Master data

- Produk: kode unik, nama, satuan (pcs, rim, pak, box, lusin, unit, kg, liter). Tidak bisa dihapus bila dipakai di SJ/pengiriman.
- Pelanggan: kode unik (huruf besar), nama, alamat, telepon. Tidak bisa dihapus bila dipakai di SJ, pengiriman, atau punya gudang titipan.
- Gudang: tipe MAIN/CONSIGN; CONSIGN wajib punya pelanggan. Tidak bisa dihapus bila masih punya rak.
- Rak: kode unik (huruf besar), nama, gudang. Tidak bisa dihapus bila dipakai di penerimaan/pengiriman.

## 7. Temuan Prototipe yang Harus Diperbaiki di Produksi

| # | Temuan | Perbaikan |
| --- | --- | --- |
| 1 | `TODAY` di-hardcode `2024-11-11` | Tanggal dari server, zona waktu `Asia/Jakarta` |
| 2 | Data hilang saat refresh | Persist ke Sheets |
| 3 | Tidak ada login/peran | Auth + RBAC (bagian 4 & 9) |
| 4 | Field Kondisi (Baik / Rusak sebagian) di form Fisik Ada tidak disimpan | Simpan di receipt (`kondisi`) |
| 5 | Alasan & catatan pembatalan tidak disimpan | Tabel `cancellations` |
| 6 | Tidak ada UI untuk menandai POD (status DELIVERED hanya ada di data dummy) | Endpoint dan tombol `Tandai POD` |
| 7 | Tidak ada edit/void pengiriman dan SJ | Void pengiriman (ADMIN) yang mengembalikan stok; SJ hanya bisa dikoreksi bila belum ada receipt |
| 8 | ID dibuat dari `Date.now() % 1000` (rawan tabrakan) | ID/nomor dari counter server atau UUID |
| 9 | Nilai input disisipkan lewat `innerHTML` tanpa escape (risiko XSS) | Escape semua teks atau pakai `textContent` |
| 10 | Nomor batch hanya diperiksa tidak kosong | Wajib unik (per pelanggan + produk minimal) |
| 11 | Tidak ada jejak siapa melakukan apa | Audit log + kolom `created_by`/`updated_by` |
| 12 | Tanggal fisik/pengiriman bebas | Validasi: tanggal penerimaan ≥ tanggal SJ; tanggal kirim ≥ tanggal batch yang dipakai |

## 8. Arsitektur

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

### 8.1 Keputusan teknis penting

- **Deploy GAS sebagai Web App**: *Execute as* = Me (pemilik), *Who has access* = Anyone. Keamanan dijaga oleh token sesi di aplikasi, bukan oleh Google login.
- **CORS**: GAS tidak mendukung preflight `OPTIONS` dan tidak bisa menambah header CORS sendiri. Agar request tetap *simple request*, frontend **harus** mengirim `Content-Type: text/plain;charset=utf-8` (isi body tetap JSON) dan **tidak boleh** memakai header kustom (`Authorization`, `X-Token`). Token dikirim di body.
- **Semua panggilan memakai POST** (termasuk baca), supaya token tidak muncul di URL/log. `GET` hanya untuk health check.
- **Status HTTP selalu 200** dari GAS. Hasil sebenarnya ada di field `ok` dan `error.code` pada envelope respons.
- **Redirect**: `/exec` mengalihkan ke `script.googleusercontent.com`; `fetch` mengikuti redirect otomatis, jadi tidak perlu penanganan khusus selama `redirect: 'follow'` (default).
- **Konkurensi**: semua operasi tulis dibungkus `LockService.getScriptLock().waitLock(15000)`; validasi stok dan penomoran dilakukan di dalam lock.
- **Waktu**: `appsscript.json` diset `"timeZone": "Asia/Jakarta"`.
- **Dua lingkungan**: spreadsheet + deployment `DEV` dan `PROD` terpisah; URL `/exec` disimpan di konfigurasi frontend per lingkungan.

### 8.2 Struktur proyek Apps Script

| File | Isi |
| --- | --- |
| `Code.gs` | `doGet`, `doPost`, router action → handler, penanganan error, envelope |
| `Auth.gs` | login, hash password (SHA-256 + salt), sesi, cek peran |
| `Db.gs` | helper Sheets: baca tabel → array objek, append, update by id, hapus, cache header |
| `Domain.gs` | perhitungan: `pendingOf`, `lineStatus`, `sjStatus`, stok per batch, kartu stock |
| `Handlers_*.gs` | master, sj, shipment, stock, report |
| `Util.gs` | tanggal, penomoran (counter), validasi, escape |
| `appsscript.json` | zona waktu, scope, konfigurasi Web App |

## 9. Autentikasi & Keamanan

- **Login**: `auth.login` (username + password) → server mencocokkan hash di sheet `users`, membuat **token acak** (UUID) dengan masa berlaku (default 12 jam), menyimpannya di sheet `sessions` (atau CacheService bila cukup, maksimum 6 jam).
- Setiap request selain login dan health wajib membawa `token`; server memuat user + peran lalu memeriksa izin per action (matriks peran bagian 4).
- Password **tidak pernah** disimpan polos; simpan `password_hash` dan `salt`. Batasi percobaan login gagal (mis. 5× → kunci 10 menit).
- Frontend menyimpan token di `sessionStorage`; tidak ada rahasia lain di frontend. URL `/exec` bukan rahasia, tetapi tanpa token semua action ditolak.
- Semua input divalidasi di server (tipe, panjang, format tanggal `YYYY-MM-DD`, integer positif untuk qty). Teks yang ditampilkan di UI di-escape.
- Sheet database **tidak dibagikan** ke pengguna; hanya pemilik script yang punya akses.
- **Audit log**: setiap aksi tulis menyimpan waktu, user, action, entitas, ringkasan perubahan.
- Header/CSP di Netlify (`_headers`): `X-Content-Type-Options`, `Referrer-Policy`, dan `Content-Security-Policy` yang membatasi `connect-src` hanya ke domain `script.google.com` dan `script.googleusercontent.com`.

## 10. Model Data (Google Sheets)

Satu spreadsheet, satu sheet per tabel, baris 1 = header. Kolom `id` diisi server. Semua tabel punya `created_at`, `created_by`, `updated_at`, `updated_by` (tidak diulang di bawah).

| Sheet | Kolom utama |
| --- | --- |
| `users` | id, username, nama, role, password\_hash, salt, aktif, failed\_count, locked\_until |
| `sessions` | token, user\_id, expires\_at |
| `products` | id, code (unik), name, unit |
| `customers` | id, code (unik), name, address, phone |
| `locations` | id, type (MAIN/CONSIGN), name, customer\_id |
| `racks` | id, code (unik), name, location\_id |
| `sj` | no (unik), date, customer\_id, po, status\_cache |
| `sj_lines` | id, sj\_no, product\_id, qty\_sj, qty\_cancelled, decision (OPEN/WAITING/DONE), alasan, eta, pic |
| `receipts` | id, sj\_line\_id, qty, rack\_id, date, pic, batch\_number, kondisi |
| `cancellations` | id, sj\_line\_id, qty, reason, note, date |
| `shipments` | no (unik), date, customer\_id, status, pod\_date, driver, vehicle, note, print\_count, last\_printed\_at |
| `shipment_lines` | id, shipment\_no, product\_id, rack\_id, qty |
| `shipment_consumptions` | id, shipment\_line\_id, receipt\_id, sj\_no, batch\_number, qty |
| `movements` | id, date, type (CONSIGN\_IN/CONSIGN\_OUT/VOID\_OUT), ref, product\_id, customer\_id, rack\_id, qty (+/−), batch\_number, sj\_ref, note |
| `counters` | key (mis. `SJ-2026`, `DO-TTR`, `BATCH-20261111`), value |
| `audit_log` | id, timestamp, user, action, entity, entity\_id, detail |

**Catatan desain:**

- `movements` bersifat *append-only* dan menjadi sumber kartu stock. Void pengiriman menambah baris `VOID_OUT` (+qty), bukan menghapus baris lama.
- Stok per batch dihitung dari `receipts` dikurangi `shipment_consumptions` milik pengiriman non-DRAFT dan non-void. Jangan menyimpan saldo stok sebagai kolom terpisah agar tidak bisa menyimpang.
- `status_cache` pada `sj` boleh dipakai untuk mempercepat daftar, tetapi nilai kebenaran tetap dihitung dari baris.

## 11. Spesifikasi REST API

### 11.1 Konvensi

Satu endpoint: `POST {GAS_EXEC_URL}`. Routing memakai field `action` (GAS tidak punya path routing nyata, jadi `GET /sj/123` tidak tersedia).

**Request**

```
{
  "action": "sj.line.receive",
  "token": "<token sesi>",
  "requestId": "uuid-dari-klien",
  "params": { "sjNo": "SJ/2026/0008", "lineId": "L-102", "qty": 40,
              "date": "2026-11-11", "rackId": "R2-01",
              "batchNumber": "BN-20261111-001", "kondisi": "Baik", "pic": "Andi" }
}
```

**Respons sukses**

```
{ "ok": true, "data": { ... }, "meta": { "serverTime": "2026-11-11T09:14:02+07:00" } }
```

**Respons gagal**

```
{ "ok": false, "error": { "code": "QTY_EXCEEDS_PENDING", "message": "Qty melebihi pending (maks 40).", "field": "qty" } }
```

- `requestId` pada aksi tulis dipakai sebagai **idempotency key**: bila request yang sama dikirim ulang (klik ganda / retry), server mengembalikan hasil sebelumnya, bukan memproses dua kali.
- Kode error baku: `UNAUTHENTICATED`, `FORBIDDEN`, `VALIDATION_ERROR`, `NOT_FOUND`, `DUPLICATE`, `IN_USE`, `QTY_EXCEEDS_PENDING`, `INSUFFICIENT_STOCK`, `NO_CONSIGN_RACK`, `LOCK_TIMEOUT`, `INTERNAL`.
- Daftar besar mendukung `page`, `pageSize` (default 50), `q` (pencarian), dan filter spesifik.

### 11.2 Daftar action

| Action | Peran | Fungsi |
| --- | --- | --- |
| `system.health` (GET) | publik | Cek layanan hidup + versi API |
| `auth.login` | publik | Username + password → token, profil, peran |
| `auth.logout` / `auth.me` | semua | Hapus sesi / profil sesi aktif |
| `system.bootstrap` | semua | Satu panggilan: master data (produk, pelanggan, gudang, rak), konstanta (alasan), tanggal server, info perusahaan untuk cetak |
| `dashboard.summary` | semua | Angka 4 kartu, top pending, stok per pelanggan |
| `master.list` / `master.create` / `master.update` / `master.delete` | baca: semua; tulis: ADMIN | Param `entity`: `product`, `customer`, `location`, `rack`; aturan 6.8 |
| `sj.list` | semua | Daftar SJ + baris + status turunan; filter `q`, `status`, `customer` |
| `sj.get` | semua | Detail satu SJ |
| `sj.nextNumber` | ADMIN, GUDANG | Saran nomor SJ berikutnya |
| `sj.create` | ADMIN, GUDANG | Buat SJ + baris (aturan 6.2) |
| `sj.line.suggestBatch` | ADMIN, GUDANG | Saran No. Batch untuk tanggal tertentu |
| `sj.line.receive` | ADMIN, GUDANG | Fisik Ada → receipt + batch + mutasi IN (6.3) |
| `sj.line.wait` | ADMIN, GUDANG | Fisik Belum Ada (6.4) |
| `sj.line.cancel` | ADMIN, GUDANG | Batalkan sisa (6.5) |
| `pending.list` | semua | Antrean pending + bucket umur |
| `stock.list` | semua | Stok per batch + ringkasan per pelanggan; filter `q` |
| `stock.available` | ADMIN, GUDANG | Batch tersedia untuk satu pelanggan (dasar form pengiriman) |
| `shipment.list` / `shipment.get` | semua | Daftar / detail pengiriman |
| `shipment.create` | ADMIN, GUDANG | Buat pengiriman dengan baris batch + qty; validasi stok di dalam lock (6.7) |
| `shipment.markDelivered` | ADMIN, GUDANG | Set status DELIVERED + tanggal POD |
| `shipment.printData` | ADMIN, GUDANG | Data lengkap cetak + increment `print_count` |
| `shipment.void` | ADMIN | Batalkan pengiriman, kembalikan stok, wajib alasan |
| `ledger.kartuStock` | semua | Mutasi + saldo berjalan per batch; filter kode, batch, pelanggan, tanggal |
| `report.reconciliation` | semua | Total masuk/keluar/stok/selisih, exception report, N mutasi terakhir |
| `user.list` / `user.create` / `user.update` / `user.resetPassword` | ADMIN | Kelola pengguna |
| `audit.list` | ADMIN | Lihat audit log |

### 11.3 Contoh router `Code.gs` (kerangka)

```javascript
function doPost(e) {
  var req, res;
  try {
    req = JSON.parse(e.postData.contents);
    var handler = ROUTES[req.action];
    if (!handler) throw apiError('NOT_FOUND', 'Action tidak dikenal');
    var ctx = (handler.public) ? null : requireSession(req.token, handler.roles);
    res = handler.write
      ? withLock(function () { return idempotent(req.requestId, function () { return handler.fn(req.params || {}, ctx); }); })
      : handler.fn(req.params || {}, ctx);
    res = { ok: true, data: res, meta: { serverTime: nowIso() } };
  } catch (err) {
    res = { ok: false, error: toErrorPayload(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(res))
    .setMimeType(ContentService.MimeType.JSON);
}
```

## 12. Persyaratan Frontend (deploy mandiri)

### 12.1 Struktur

Pisahkan satu file prototipe menjadi:

| File | Isi |
| --- | --- |
| `index.html` | Kerangka (sidebar, topbar, `#view`, `#modalRoot`, `#toastRoot`) |
| `css/app.css` | CSS dari prototipe (tema tidak berubah) |
| `js/config.js` | `API_URL` (URL `/exec`), `APP_ENV`; **satu-satunya file yang diganti per lingkungan** |
| `js/api.js` | Klien API (lihat 12.2) |
| `js/state.js` | State aplikasi + cache master data dari `system.bootstrap` |
| `js/pages/*.js` | Satu file per halaman (dashboard, penerimaan, pending, stok, pengiriman, kartu, laporan, master) |
| `js/modals/*.js` | Modal: tambah SJ, fisik ada, fisik belum ada, batalkan, buat pengiriman, master CRUD |
| `js/print.js` | Cetak Surat Jalan memakai data dari `shipment.printData` |
| `login.html` atau view login | Form login |

Tidak perlu build tool; ES Modules native sudah cukup. Framework (React/Vue) boleh dipakai bila diinginkan, kontrak API tidak berubah.

### 12.2 Klien API

```javascript
async function api(action, params = {}, opts = {}) {
  const body = JSON.stringify({
    action, params,
    token: sessionStorage.getItem('token'),
    requestId: opts.write ? crypto.randomUUID() : undefined
  });
  const r = await fetch(CONFIG.API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // hindari preflight CORS
    body
  });
  const json = await r.json();
  if (!json.ok) {
    if (json.error.code === 'UNAUTHENTICATED') { sessionStorage.clear(); location.href = '/login.html'; }
    throw Object.assign(new Error(json.error.message), json.error);
  }
  return json.data;
}
```

### 12.3 Perubahan perilaku UI dibanding prototipe

- Semua fungsi yang tadinya mengubah `db` langsung diganti panggilan API; setelah sukses, data dimuat ulang dari server (jangan menghitung ulang stok di browser).
- **Loading state** pada tombol aksi (nonaktif selama request, mencegah klik ganda) dan *skeleton/spinner* pada tabel.
- **Error handling**: pesan dari `error.message` ditampilkan di toast; error `field` menandai input terkait.
- Hapus fungsi bisnis dari browser (`pendingOf`, `lineStatus`, `initConsumption`, `stockByBatch`, dll.). Boleh tersisa hanya untuk tampilan (format tanggal/angka, label badge).
- Pencarian: debounce 300 ms lalu query ke server (atau filter lokal bila data kecil).
- Tombol sesuai peran: VIEWER tidak melihat tombol tulis; tetap dicek ulang di server.
- Tampilan responsif untuk tablet (gudang) minimal lebar 768 px.
- Cetak SJ: ambil data dari `shipment.printData`, render di jendela baru seperti prototipe; informasi perusahaan (`company`) berasal dari `system.bootstrap`, bukan konstanta di kode.
- Tambahan UI baru: halaman login, tombol Tandai POD, tombol Void (ADMIN), layar Pengguna dan Audit Log (ADMIN).

### 12.4 Deploy ke Netlify

1. Taruh folder frontend di repo Git (GitHub/GitLab), hubungkan ke Netlify, *publish directory* = folder root frontend, *build command* kosong.
2. Isi `js/config.js` dengan URL Web App GAS (PROD). Gunakan branch/site terpisah untuk DEV.
3. Tambahkan `_headers` (keamanan, lihat bagian 9) dan `_redirects` bila memakai routing SPA (`/* /index.html 200`).
4. Domain kustom + HTTPS otomatis dari Netlify.
5. Setiap kali GAS di-deploy sebagai **versi baru**, perhatikan: URL `/exec` tetap sama bila memakai *Manage deployments → Edit → New version*; membuat deployment baru menghasilkan URL berbeda.

## 13. Persyaratan Non-Fungsional

| Aspek | Persyaratan |
| --- | --- |
| **Kinerja** | Latensi GAS umumnya 0,5–2 dtk per panggilan; gunakan `system.bootstrap` sekali di awal, `CacheService` untuk master data (invalidasi saat master berubah), baca sheet dengan satu `getValues()` per tabel per request |
| **Kuota GAS** | Perhatikan batas harian eksekusi, waktu eksekusi maks 6 menit, dan konkurensi; target pemakaian: ≤ 10 pengguna bersamaan, ≤ 500 transaksi/hari |
| **Volume data** | Nyaman hingga puluhan ribu baris per sheet; bila `movements` melewati ±100 ribu baris, arsipkan per tahun atau pindah ke database (Cloud SQL/Firestore/D1) tanpa mengubah kontrak API |
| **Integritas** | Lock pada semua tulis; idempotency key; stok tidak boleh negatif; tanggal menolak format selain `YYYY-MM-DD` |
| **Ketersediaan** | Mengikuti SLA Google Workspace/Apps Script; tampilkan pesan ramah bila server tidak merespons dan sediakan tombol coba lagi |
| **Backup** | Salinan otomatis spreadsheet harian (trigger waktu → `makeCopy` ke folder Drive khusus), simpan 30 hari |
| **Observabilitas** | Log error ke sheet `error_log` atau Cloud Logging; trigger email ke admin bila ada error `INTERNAL` berulang |
| **Bahasa & format** | Antarmuka Bahasa Indonesia; angka `id-ID`; tanggal tampil `dd MMM yyyy`, kirim ke API `YYYY-MM-DD` |
| **Kompatibilitas** | Chrome/Edge/Safari versi terbaru; popup cetak harus diizinkan |

## 14. Kriteria Penerimaan (ringkas)

1. Login dengan user valid berhasil; token kedaluwarsa memaksa kembali ke login; VIEWER tidak bisa memanggil action tulis (ditolak server walau tombol dimanipulasi).
2. Membuat SJ dengan 2 baris → muncul di Penerimaan dengan status OPEN dan nomor SJ otomatis berurutan tanpa duplikat meski dua user menyimpan bersamaan.
3. Fisik Ada sebagian (mis. 120 dari 200) → baris menjadi PARTIALLY\_RECEIVED, pending 80, batch baru tercatat, stok bertambah 120, mutasi IN muncul di kartu stock.
4. Fisik Ada dengan qty > pending ditolak dengan `QTY_EXCEEDS_PENDING`.
5. Fisik Belum Ada menyimpan alasan/ETA/PIC; baris muncul di antrean dan di dashboard dengan umur yang benar.
6. Batalkan sisa menyimpan alasan + catatan, pending menjadi 0, status CANCELLED/RECEIVED sesuai aturan 6.1, terlihat di rekonsiliasi.
7. Buat pengiriman dari 2 batch berbeda → stok batch berkurang tepat, DO bernomor unik, mutasi OUT tercatat, cetak SJ menampilkan No. Batch dan SJ asal.
8. Dua user mengirim dari batch yang sama bersamaan: yang kedua ditolak `INSUFFICIENT_STOCK` bila sisa tidak cukup; stok tidak pernah negatif.
9. Klik ganda / retry pada Simpan Pengiriman hanya menghasilkan satu DO (idempotency).
10. Tandai POD mengubah status ke DELIVERED dan mengurangi hitungan Belum Ada POD di dashboard.
11. Void pengiriman (ADMIN) mengembalikan stok batch, menambah mutasi VOID\_OUT, dan tercatat di audit log.
12. Untuk setiap batch: saldo akhir kartu stock = qty di Stok Titipan; total Masuk − Keluar di rekonsiliasi = total stok.
13. Master data yang dipakai transaksi tidak bisa dihapus (`IN_USE`); kode duplikat ditolak (`DUPLICATE`).
14. Frontend berjalan dari domain Netlify tanpa error CORS; refresh halaman tidak menghilangkan data.

## 15. Rencana Implementasi

| Fase | Cakupan | Hasil |
| --- | --- | --- |
| **0. Fondasi** | Buat spreadsheet + sheet sesuai bagian 10, proyek GAS, router, envelope, `system.health`, helper Db, deployment DEV | Frontend bisa memanggil `health` dari Netlify tanpa CORS error |
| **1. Auth & master** | `auth.*`, `users`, RBAC, `system.bootstrap`, CRUD master + aturan hapus | Login + Master Data berfungsi end-to-end |
| **2. SJ & penerimaan** | `sj.*`, `pending.list`, counter nomor, batch suggestion, receipts, cancellations | Alur SJ → Fisik Ada / Belum Ada / Batalkan |
| **3. Stok & pengiriman** | `stock.*`, `shipment.*`, consumption, movements, lock + idempotency, POD, void, cetak SJ | Alur pengiriman lengkap + cetak |
| **4. Laporan** | `dashboard.summary`, `ledger.kartuStock`, `report.reconciliation`, pagination | Semua halaman memakai data nyata |
| **5. Hardening & rilis** | Audit log, backup harian, error log, uji beban kecil, header keamanan, migrasi data SJ existing (impor CSV), UAT, deployment PROD | Go-live |

## 16. Asumsi, Risiko, dan Pertanyaan Terbuka

**Asumsi yang dipakai dalam PRD ini**

- Satu perusahaan, satu spreadsheet; penggunaan internal ≤ 10 pengguna.
- SJ existing tetap diinput manual (tidak ada integrasi otomatis ke ERP).
- Pengiriman memilih batch secara **manual** seperti prototipe; FIFO otomatis hanya saran (opsional, fase lanjutan).
- Satu pelanggan = satu gudang titipan (sesuai validasi prototipe).

**Risiko**

| Risiko | Dampak | Mitigasi |
| --- | --- | --- |
| Kuota/latensi Apps Script | UI terasa lambat saat ramai | Bootstrap + cache, pagination, batasi bacaan sheet |
| Sheets bukan database transaksional | Data rusak bila ada edit manual | Lindungi sheet, lock, validasi, backup harian |
| `Anyone` access pada Web App | URL bisa dicoba pihak luar | Token sesi, throttle login, tanpa data sensitif di respons publik |
| Keterbatasan CORS GAS | Header kustom ditolak | Selalu `text/plain`, token di body |
| Pertumbuhan data | Sheet melambat | Arsip tahunan / migrasi DB (kontrak API tetap) |

**Pertanyaan terbuka (perlu keputusan sebelum Fase 2)**

1. Apakah perlu **FIFO otomatis** atau cukup pemilihan batch manual?
2. Apakah **No. Batch** harus mengikuti format tetap atau boleh bebas (batch dari pabrik/supplier)?
3. Siapa yang boleh **void** pengiriman, dan apakah perlu persetujuan dua tingkat?
4. Apakah ada **data SJ/stok titipan existing** yang harus diimpor di awal (format sumbernya apa)?
5. Apakah ada **pelanggan dengan lebih dari satu gudang titipan** di dunia nyata (aturan 6.6 saat ini melarangnya)?
6. Apakah **kop surat dan nomor SJ/DO** boleh diubah admin lewat layar pengaturan, atau tetap di konfigurasi?

## Lampiran A — Pemetaan fungsi prototipe → API

| Fungsi prototipe | Pengganti |
| --- | --- |
| `submitAddSJ` | `sj.create` |
| `submitReceive` | `sj.line.receive` |
| `submitWait` | `sj.line.wait` |
| `submitCancel` | `sj.line.cancel` |
| `submitShipment` | `shipment.create` |
| `printSuratJalan` | `shipment.printData` + `js/print.js` |
| `allPending`, `renderPending` | `pending.list` |
| `stockRows`, `stockByBatch`, `getAvailableBatchesForCustomer` | `stock.list`, `stock.available` |
| `buildKartuStockEntries` | `ledger.kartuStock` |
| `renderLaporan` (movements, exception) | `report.reconciliation` |
| `renderDashboard` | `dashboard.summary` |
| `saveProduct/Customer/Location/Rack`, `del*` | `master.create/update/delete` |
| `nextSJNumber`, `suggestBatchNumber` | `sj.nextNumber`, `sj.line.suggestBatch` |
| `initConsumption`, `initMovements` | dihapus (diganti `shipment_consumptions` dan `movements` di server) |
