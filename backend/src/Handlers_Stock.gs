/**
 * Handlers_Stock.gs — Stok titipan per batch.
 * Cakupan: stock.list, stock.available.
 * Prinsip (PRD 6.6 & 10): stok TIDAK disimpan sebagai kolom; selalu dihitung
 * dari receipts − shipment_consumptions pengiriman non-DRAFT.
 * Implementasi lengkap masuk Fase 3.
 */

/** Posisi stok per batch (hanya sisa > 0) + ringkasan per pelanggan. */
function stockList_(params, ctx) {
  return { items: [], perCustomer: [] };
}

/** Batch tersedia untuk satu pelanggan — dasar form pengiriman. */
function stockAvailable_(params, ctx) {
  assertRequired_(params.customerId, 'customerId', 'Pelanggan');
  return { items: [] };
}
