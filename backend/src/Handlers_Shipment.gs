/**
 * Handlers_Shipment.gs — Pengiriman dari gudang titipan.
 * Cakupan: shipment.list, shipment.get, shipment.create, shipment.markDelivered,
 *          shipment.printData, shipment.void.
 * Implementasi lengkap masuk Fase 3.
 */

/** Daftar / detail pengiriman. */
function shipmentList_(params, ctx) {
  return { items: [], page: 1, pageSize: 50, total: 0 };
}

function shipmentGet_(params, ctx) {
  throw apiError_('NOT_FOUND', 'shipment.get belum diimplementasikan (Fase 3).');
}

/**
 * Buat pengiriman: nomor DO-TTR-{urut} dari counter terpisah (PRD 6.7),
 * validasi stok DI DALAM lock, simpan consumed[] + mutasi CONSIGN_OUT.
 */
function shipmentCreate_(params, ctx) {
  throw apiError_('INTERNAL', 'shipment.create belum diimplementasikan (Fase 3).');
}

/** Tandai POD -> status DELIVERED + tanggal POD. */
function shipmentMarkDelivered_(params, ctx) {
  throw apiError_('INTERNAL', 'shipment.markDelivered belum diimplementasikan (Fase 3).');
}

/** Data cetak SJ + increment print_count dan last_printed_at. */
function shipmentPrintData_(params, ctx) {
  throw apiError_('INTERNAL', 'shipment.printData belum diimplementasikan (Fase 3).');
}

/** Void pengiriman (ADMIN): kembalikan stok lewat mutasi VOID_OUT (+qty). */
function shipmentVoid_(params, ctx) {
  throw apiError_('INTERNAL', 'shipment.void belum diimplementasikan (Fase 3).');
}
