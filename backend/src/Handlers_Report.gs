/**
 * Handlers_Report.gs — Dashboard, kartu stock, rekonsiliasi, user, audit.
 * Cakupan: system.bootstrap, dashboard.summary, ledger.kartuStock,
 *          report.reconciliation, user.*, audit.list.
 * Implementasi lengkap masuk Fase 4 (user.* di Fase 1).
 */

/** Satu panggilan: master data + konstanta + tanggal server + info perusahaan. */
function systemBootstrap_(params, ctx) {
  return {
    products: readMaster_('product'),
    customers: readMaster_('customer'),
    locations: readMaster_('location'),
    racks: readMaster_('rack'),
    constants: {
      alasan: ALASAN_,
      satuan: SATUAN_,
      role: ROLES
    },
    serverDate: todayStr_(),
    company: getCompany_(),
    user: ctx ? { userId: ctx.userId, username: ctx.username, nama: ctx.nama, role: ctx.role } : null
  };
}

/** Angka 4 kartu, top pending, stok per pelanggan. */
function dashboardSummary_(params, ctx) {
  return {
    stockTotal: 0, pendingPhysical: 0, sjOpen: 0, notDelivered: 0,
    hangingDifference: 0, topPending: [], stockByCustomer: []
  };
}

/** Mutasi + saldo berjalan per batch. */
function ledgerKartuStock_(params, ctx) {
  return { items: [] };
}

/** Total masuk/keluar/stok/selisih + exception report + N mutasi terakhir. */
function reportReconciliation_(params, ctx) {
  return { totalIn: 0, totalOut: 0, stock: 0, hanging: 0, exceptions: [], recentMovements: [] };
}

// user.* dan audit.list ada di Handlers_User.gs (khusus ADMIN).

/** Konstanta alasan (PRD 6.4) — satu sumber kebenaran bersama frontend. */
var ALASAN_ = {
  BELUM_READY_PRODUKSI: 'Belum ready produksi',
  BELUM_DATANG_SUPPLIER: 'Belum datang dari supplier',
  BELUM_DIVERIFIKASI: 'Belum diverifikasi gudang',
  SALAH_INPUT: 'Salah input / perlu koreksi',
  LAINNYA: 'Lainnya'
};

/** Satuan produk yang diizinkan (PRD 6.8). */
var SATUAN_ = ['pcs', 'rim', 'pak', 'box', 'lusin', 'unit', 'kg', 'liter'];

/** Info kop surat — dibaca dari Script Properties agar bisa diubah tanpa deploy. */
function getCompany_() {
  var p = PropertiesService.getScriptProperties();
  return {
    name: p.getProperty('COMPANY_NAME') || 'PT DISTRIBUSI NUSANTARA',
    address: p.getProperty('COMPANY_ADDRESS') || '',
    phone: p.getProperty('COMPANY_PHONE') || '',
    email: p.getProperty('COMPANY_EMAIL') || '',
    npwp: p.getProperty('COMPANY_NPWP') || '',
    logo: p.getProperty('COMPANY_LOGO') || 'DN'
  };
}
