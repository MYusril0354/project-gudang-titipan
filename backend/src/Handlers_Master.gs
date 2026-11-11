/**
 * Handlers_Master.gs — CRUD master data: product, customer, location, rack.
 * Aturan (PRD 6.8): kode unik; data yang dipakai transaksi tidak boleh dihapus (IN_USE).
 *
 * Fase 1: master.list sudah memakai data nyata; create/update/delete menyusul.
 */

/** Peta entity -> nama tabel + pemetaan kolom ke bentuk camelCase untuk frontend. */
var MASTER_MAP_ = {
  product: {
    table: 'products',
    toApi: function (r) { return { id: r.id, code: r.code, name: r.name, unit: r.unit }; }
  },
  customer: {
    table: 'customers',
    toApi: function (r) { return { id: r.id, code: r.code, name: r.name, address: r.address, phone: r.phone }; }
  },
  location: {
    table: 'locations',
    toApi: function (r) { return { id: r.id, type: r.type, name: r.name, customerId: r.customer_id || null }; }
  },
  rack: {
    table: 'racks',
    toApi: function (r) { return { id: r.id, code: r.code, name: r.name, locationId: r.location_id }; }
  }
};

/** Ambil konfigurasi entity atau lempar error. */
function masterConf_(entity) {
  var conf = MASTER_MAP_[String(entity || '')];
  if (!conf) {
    throw apiError_('VALIDATION_ERROR', 'Entity tidak dikenal: ' + entity + '. Gunakan product, customer, location, atau rack.', 'entity');
  }
  return conf;
}

/** Baca satu entity master dalam bentuk siap pakai frontend. */
function readMaster_(entity) {
  var conf = masterConf_(entity);
  return readTable_(conf.table).map(conf.toApi);
}

/**
 * Daftar master data.
 * @param {Object} params { entity, q }
 */
function masterList_(params, ctx) {
  var items = readMaster_(params.entity);

  var q = String(params.q || '').trim().toLowerCase();
  if (q) {
    items = items.filter(function (it) {
      return Object.keys(it).some(function (k) {
        return String(it[k] === null || it[k] === undefined ? '' : it[k]).toLowerCase().indexOf(q) !== -1;
      });
    });
  }

  items.sort(function (a, b) { return String(a.code || a.name || '').localeCompare(String(b.code || b.name || '')); });
  return { entity: params.entity, items: items, total: items.length };
}

function masterCreate_(params, ctx) {
  throw apiError_('INTERNAL', 'master.create belum diimplementasikan (Fase 1).');
}

function masterUpdate_(params, ctx) {
  throw apiError_('INTERNAL', 'master.update belum diimplementasikan (Fase 1).');
}

function masterDelete_(params, ctx) {
  throw apiError_('INTERNAL', 'master.delete belum diimplementasikan (Fase 1).');
}
