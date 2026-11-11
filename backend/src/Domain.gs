/**
 * Domain.gs — Aturan bisnis murni (tanpa akses sheet langsung).
 * Ini adalah cermin dari PRD bagian 6 dan pengganti fungsi prototipe:
 *   pendingOf, lineStatus, sjStatus, stockByBatch, buildKartuStockEntries, dst.
 *
 * Backend adalah SATU-SATUNYA penentu aturan ini; frontend hanya menampilkan.
 * Implementasi lengkap masuk Fase 2–4.
 */

/** Jumlah seluruh penerimaan pada satu baris SJ. */
function qtyReceived_(line, receipts) {
  return (receipts || []).reduce(function (a, r) { return a + Number(r.qty || 0); }, 0);
}

/** pending = qtySj − qtyReceived − qtyCancelled (PRD 6.1). */
function pendingOf_(line, receipts) {
  return Number(line.qty_sj || 0) - qtyReceived_(line, receipts) - Number(line.qty_cancelled || 0);
}

/**
 * Status baris SJ (urutan evaluasi PRD 6.1):
 *  1. pending <= 0 -> CANCELLED bila qtyCancelled >= qtySj, selain itu RECEIVED
 *  2. qtyReceived > 0 -> PARTIALLY_RECEIVED
 *  3. decision = WAITING -> WAITING_PHYSICAL
 *  4. selain itu -> OPEN
 */
function lineStatus_(line, receipts) {
  var pending = pendingOf_(line, receipts);
  if (pending <= 0) {
    return Number(line.qty_cancelled || 0) >= Number(line.qty_sj || 0) ? 'CANCELLED' : 'RECEIVED';
  }
  if (qtyReceived_(line, receipts) > 0) return 'PARTIALLY_RECEIVED';
  if (line.decision === 'WAITING') return 'WAITING_PHYSICAL';
  return 'OPEN';
}

/**
 * Status SJ (PRD 6.1):
 *  - RECEIVED bila semua baris RECEIVED/CANCELLED
 *  - WAITING_PHYSICAL bila ada baris WAITING_PHYSICAL/PARTIALLY_RECEIVED
 *  - selain itu OPEN
 */
function sjStatus_(lines) {
  var st = lines.map(function (l) { return lineStatus_(l, l.receipts); });
  var allDone = st.every(function (x) { return x === 'RECEIVED' || x === 'CANCELLED'; });
  if (allDone) return 'RECEIVED';
  var anyWaiting = st.some(function (x) { return x === 'WAITING_PHYSICAL' || x === 'PARTIALLY_RECEIVED'; });
  if (anyWaiting) return 'WAITING_PHYSICAL';
  return 'OPEN';
}

/** Sisa stok satu batch = qtyIn − total pemakaian pengiriman non-DRAFT & non-void (PRD 6.6). */
function batchAvailable_(batch, consumptions, shipments) {
  var used = (consumptions || [])
    .filter(function (c) { return c.receipt_id === batch.id && !isIgnoredShipment_(c.shipment_no, shipments); })
    .reduce(function (a, c) { return a + Number(c.qty || 0); }, 0);
  return Number(batch.qty || 0) - used;
}

/** Pengiriman DRAFT tidak memotong stok; pengiriman void juga tidak. */
function isIgnoredShipment_(shipmentNo, shipments) {
  var sh = (shipments || []).filter(function (s) { return s.no === shipmentNo; })[0];
  if (!sh) return false;
  return sh.status === 'DRAFT' || sh.status === 'VOID';
}

/** Umur pending dalam hari (hari ini − tanggal SJ), zona Jakarta. */
function agingDays_(sjDate) {
  var a = new Date(sjDate + 'T00:00:00+07:00');
  var b = new Date(todayStr_() + 'T00:00:00+07:00');
  return Math.round((b - a) / 86400000);
}
