/**
 * state.js — State aplikasi + cache master data dari `system.bootstrap`.
 *
 * Prinsip (PRD 12.3): JANGAN menghitung ulang stok/status di browser.
 * Browser hanya menyimpan cache master data dan state tampilan (filter, halaman aktif).
 */

const listeners = new Set();

/** State global aplikasi. */
export const state = {
  /** true setelah system.bootstrap berhasil. */
  ready: false,
  /** Profil pengguna aktif: { username, role, userId }. */
  user: null,
  /** Info perusahaan untuk kop cetak (dari server, bukan konstanta kode). */
  company: null,
  /** Tanggal server (YYYY-MM-DD) — menggantikan TODAY yang di-hardcode di prototipe. */
  serverDate: null,
  /** Konstanta dari server, mis. daftar alasan pending. */
  constants: { alasan: {} },

  /** Cache master data. */
  master: { products: [], customers: [], locations: [], racks: [] },

  /** State tampilan. */
  route: 'dashboard',
  filters: {
    penerimaan: '',
    pending: '',
    stok: '',
    stokCustomer: '',
    pengiriman: '',
    pengirimanStatus: '',
    kartu: { code: '', batch: '', customer: '', from: '', to: '' }
  }
};

/** Berlangganan perubahan state. @returns {() => void} fungsi unsubscribe */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Umumkan perubahan state ke semua pelanggan. */
export function notify() {
  listeners.forEach((fn) => fn(state));
}

/** Isi state dari hasil system.bootstrap. */
export function applyBootstrap(data) {
  state.master = {
    products: data.products || [],
    customers: data.customers || [],
    locations: data.locations || [],
    racks: data.racks || []
  };
  state.constants = data.constants || { alasan: {} };
  state.serverDate = data.serverDate || null;
  state.company = data.company || null;
  state.user = data.user || null;
  state.ready = true;
  notify();
}

/** Perbarui cache master untuk satu entity setelah CRUD. */
export function setMaster(entity, items) {
  const key = { product: 'products', customer: 'customers', location: 'locations', rack: 'racks' }[entity];
  if (!key) return;
  state.master[key] = items || [];
  notify();
}

/* =========================================================
   Lookup — hanya format/label, bukan logika bisnis
   ========================================================= */

export const findProduct = (id) => state.master.products.find((p) => p.id === id) || { id, code: '—', name: '—', unit: '' };
export const findCustomer = (id) => state.master.customers.find((c) => c.id === id) || { id, code: '—', name: '—', address: '—', phone: '—' };
export const findRack = (id) => state.master.racks.find((r) => r.id === id) || { id, code: '—', name: '—' };
export const findLocation = (id) => state.master.locations.find((l) => l.id === id) || { id, name: '—' };

/** Gudang titipan (CONSIGN) milik satu pelanggan. */
export const consignLocationOf = (customerId) =>
  state.master.locations.find((l) => l.type === 'CONSIGN' && l.customerId === customerId) || null;

/** Daftar rak milik gudang titipan pelanggan. */
export function racksOfCustomer(customerId) {
  const loc = consignLocationOf(customerId);
  return loc ? state.master.racks.filter((r) => r.locationId === loc.id) : [];
}

/* =========================================================
   Format tampilan (PRD 13: UI Bahasa Indonesia, angka id-ID)
   ========================================================= */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/** Angka format id-ID. */
export const fmt = (n) => (n ?? 0).toLocaleString('id-ID');

/** Tanggal tampil: dd MMM yyyy. */
export function fmtDate(d) {
  if (!d) return '—';
  const [y, m, dd] = String(d).split('-');
  return `${dd} ${MONTHS[Number(m) - 1]} ${y}`;
}

/** Selisih hari antara dua tanggal YYYY-MM-DD. */
export function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
}

/** Label status baris SJ (teks saja — status ditentukan server). */
export const STATUS_META = {
  OPEN: { label: 'Belum diklasifikasi', cls: 'b-gray' },
  WAITING_PHYSICAL: { label: 'Fisik belum ada', cls: 'b-amber' },
  PARTIALLY_RECEIVED: { label: 'Diterima sebagian', cls: 'b-blue' },
  RECEIVED: { label: 'Diterima', cls: 'b-green' },
  CANCELLED: { label: 'Dibatalkan', cls: 'b-red' },
  DRAFT: { label: 'Draf', cls: 'b-gray' },
  SHIPPED: { label: 'Terkirim', cls: 'b-blue' },
  DELIVERED: { label: 'Selesai (POD)', cls: 'b-green' },
  VOID: { label: 'Dibatalkan', cls: 'b-red' }
};
