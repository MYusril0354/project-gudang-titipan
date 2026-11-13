# Model Data — Sistem Gudang Titipan

Database: **satu Google Spreadsheet**, satu sheet per tabel, baris 1 = header.
Kolom `id` diisi server. Semua tabel punya `created_at`, `created_by`, `updated_at`, `updated_by` (tidak diulang di tabel bawah).

## Daftar Tabel

| Sheet | Kolom utama |
| --- | --- |
| `users` | id, username, nama, role, password_hash, salt, aktif, failed_count, locked_until |
| `sessions` | token, user_id, expires_at |
| `products` | id, code (unik), name, unit |
| `customers` | id, code (unik), name, address, phone |
| `locations` | id, type (MAIN/CONSIGN), name, customer_id |
| `racks` | id, code (unik), name, location_id |
| `sj` | no (unik), date, customer_id, po, status_cache |
| `sj_lines` | id, sj_no, product_id, qty_sj, qty_cancelled, decision (OPEN/WAITING/DONE), alasan, eta, pic, **planned_batch**, **planned_ed** |
| `receipts` | id, sj_line_id, qty, rack_id, date, pic, batch_number, kondisi, **ed** |
| `cancellations` | id, sj_line_id, qty, reason, note, date |
| `shipments` | no (unik), date, customer_id, status, pod_date, driver, vehicle, note, print_count, last_printed_at |
| `shipment_lines` | id, shipment_no, product_id, rack_id, qty |
| `shipment_consumptions` | id, shipment_line_id, receipt_id, sj_no, batch_number, qty |
| `movements` | id, date, type (CONSIGN_IN/CONSIGN_OUT/VOID_OUT), ref, product_id, customer_id, rack_id, qty (+/−), batch_number, sj_ref, note |
| `counters` | key (mis. `SJ-2026`, `DO-TTR`, `BATCH-20261111`), value |
| `audit_log` | id, timestamp, user, action, entity, entity_id, detail |
| `error_log` | id, timestamp, code, message, stack, request |

Header lengkap tiap tabel ada di `backend/src/Db.gs` (`HEADERS_`).

## Catatan Desain

1. **`movements` bersifat append-only** dan menjadi sumber kartu stock. Void pengiriman menambah baris `VOID_OUT` (+qty), **bukan** menghapus baris lama.
2. **Stok tidak disimpan sebagai kolom.** Stok per batch selalu dihitung:
   ```
   stok(batch) = receipts.qty − Σ shipment_consumptions.qty
                 (hanya pengiriman non-DRAFT dan non-void)
   ```
   Dengan begitu saldo tidak mungkin menyimpang dari mutasi.
3. **`status_cache` pada `sj`** hanya untuk mempercepat daftar; nilai kebenarannya tetap dihitung dari baris (`Domain.gs`).
4. **Nomor dokumen dari `counters`**, bukan dari jumlah baris — prototipe memakai `jumlah DO + 1` yang bisa bentrok bila ada data dihapus (temuan #8).
5. **Satu pelanggan = satu gudang titipan** (aturan PRD 6.6). Gudang bertipe `MAIN` tidak terkait pelanggan.
6. **Batch & ED punya dua tahap.** Saat SJ dibuat/impor, `planned_batch` & `planned_ed` diisi sebagai **rencana** — stok **tidak** bertambah. Batch dan ED yang benar-benar diterima disimpan di `receipts` (`batch_number`, `ed`) saat Fisik Ada dikonfirmasi, dengan nilai rencana sebagai default yang boleh diubah.
7. **Kolom baru selalu ditambahkan di AKHIR** daftar `HEADERS_` supaya posisi kolom (dan seluruh data lama) tidak bergeser. Setelah menambah kolom, jalankan `system.migrate` (ADMIN) untuk menuliskan header yang belum ada; header yang sudah berisi nama lain **tidak** ditimpa, hanya dilaporkan sebagai konflik.

## Perhitungan Kunci (PRD 6.1)

```
qtyReceived = Σ receipts.qty
pending     = qty_sj − qtyReceived − qty_cancelled

status baris (urutan evaluasi):
  1. pending ≤ 0           → CANCELLED bila qty_cancelled ≥ qty_sj, selain itu RECEIVED
  2. qtyReceived > 0       → PARTIALLY_RECEIVED
  3. decision = WAITING    → WAITING_PHYSICAL
  4. selain itu            → OPEN
```

## Penomoran Otomatis

| Dokumen | Format | Counter key |
| --- | --- | --- |
| Surat Jalan | `SJ/{tahun}/{urut 4 digit}` | `SJ-{tahun}` |
| Batch | `BN-{YYYYMMDD}-{urut 3 digit}` | `BATCH-{YYYYMMDD}` |
| Pengiriman | `DO-TTR-{urut 3 digit}` | `DO-TTR` |

## Seed Awal

Sheet `counters` perlu diisi saat setup bila ingin memulai penomoran dari nilai tertentu.
Seluruh operasi tulis dibungkus `LockService.getScriptLock().waitLock(15000)` agar penomoran tetap unik saat dua pengguna menyimpan bersamaan.
