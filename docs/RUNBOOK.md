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

### Kinerja (diukur 2026-11-13, uji beban kecil)

| Endpoint | p50 | p95 |
| --- | --- | --- |
| `system.health` (tanpa akses sheet) | 1,7 dtk | 2,3 dtk |
| `system.bootstrap` | 3,7 dtk | 5,8 dtk |
| `dashboard.summary` | 3,9 dtk | 5,5 dtk |
| `stock.list` | 4,6 dtk | 8,5 dtk |
| `report.reconciliation` | 4,4 dtk | 6,4 dtk |
| 5 permintaan bersamaan | sukses 15/15 | — |

**Temuan:** target PRD 0,5–2 dtk **belum tercapai** untuk endpoint multi-tabel.
Batas bawahnya ada di platform: `system.health` yang tidak menyentuh sheet sama
sekali sudah ~1,7 dtk. Setiap `getValues()` menambah satu round-trip.

**Yang sudah dilakukan:** cache per-eksekusi (objek spreadsheet, objek sheet,
dan baris tabel) menurunkan bootstrap ~17% dan dashboard ~27%; `movements`
hanya dibaca oleh endpoint yang memerlukannya.

**Yang dicoba dan ditolak:** prefetch semua tabel lewat satu panggilan
`values:batchGet` + `UrlFetchApp`. Hasil pengukuran **tidak lebih cepat**
(bootstrap p50 3,5 → 4,0 dtk) — biaya token OAuth + round-trip HTTPS menyamai
penghematan. Perubahan dicabut; alasannya didokumentasikan di `Db.gs`.

**Bila target harus dipenuhi:** pindahkan datastore dari Sheets
(Cloud SQL / Firestore / D1). Kontrak API tidak perlu berubah — hanya lapisan
`Db.gs` yang diganti.

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
| Login gagal padahal password benar | akun terkunci setelah 5x gagal | tunggu 10 menit, atau ADMIN reset password |
| `FORBIDDEN` pada action tertentu | `PROD_LOCK` aktif | cek `system.hardening`, buka kunci bila memang perlu |
| `UNAUTHENTICATED` terus | token kedaluwarsa (12 jam) | login ulang; frontend otomatis mengarahkan ke halaman login |
| `LOCK_TIMEOUT` | dua tulis bersamaan | ulangi beberapa detik lagi |
| Stok terlihat tidak cocok | ada edit manual di sheet | cek **Rekonsiliasi** `variance`; restore dari backup bila perlu |
