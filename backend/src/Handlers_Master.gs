/**
 * Handlers_Master.gs — CRUD master data: product, customer, location, rack.
 * Aturan (PRD 6.8): kode unik; data yang dipakai transaksi tidak boleh dihapus (IN_USE).
 * Implementasi lengkap masuk Fase 1.
 */

function masterList_(params, ctx) {
  // Fase 1: entity = product | customer | location | rack
  return [];
}

function masterCreate_(params, ctx) {
  // Fase 1
  throw apiError_('INTERNAL', 'master.create belum diimplementasikan (Fase 1).');
}

function masterUpdate_(params, ctx) {
  // Fase 1
  throw apiError_('INTERNAL', 'master.update belum diimplementasikan (Fase 1).');
}

function masterDelete_(params, ctx) {
  // Fase 1: tolak dengan IN_USE bila sudah dipakai transaksi.
  throw apiError_('INTERNAL', 'master.delete belum diimplementasikan (Fase 1).');
}
