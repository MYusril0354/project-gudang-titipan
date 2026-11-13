/**
 * Handlers_Master.gs — CRUD master data: product, customer, location, rack.
 *
 * Aturan (PRD 6.8):
 *  - kode unik (pelanggan & rak memakai huruf besar)
 *  - data yang dipakai transaksi tidak boleh dihapus (IN_USE)
 *  - gudang CONSIGN wajib punya pelanggan; lokasi MAIN tidak terkait pelanggan
 *  - satu pelanggan hanya boleh punya satu gudang titipan (PRD 6.6)
 */

/** Peta entity -> tabel + pemetaan kolom ke bentuk camelCase untuk frontend. */
var MASTER_MAP_ = {
  product: {
    table: 'products',
    fields: ['code', 'name', 'unit'],
    toApi: function (r) { return { id: r.id, code: r.code, name: r.name, unit: r.unit }; }
  },
  customer: {
    table: 'customers',
    fields: ['code', 'name', 'address', 'phone'],
    toApi: function (r) { return { id: r.id, code: r.code, name: r.name, address: r.address, phone: r.phone }; }
  },
  location: {
    table: 'locations',
    fields: ['type', 'name', 'customerId'],
    toApi: function (r) { return { id: r.id, type: r.type, name: r.name, customerId: r.customer_id || null }; }
  },
  rack: {
    table: 'racks',
    fields: ['code', 'name', 'locationId'],
    toApi: function (r) { return { id: r.id, code: r.code, name: r.name, locationId: r.location_id }; }
  }
};

/** Ambil konfigurasi entity atau lempar error. */
function masterConf_(entity) {
  var conf = MASTER_MAP_[String(entity || '')];
  if (!conf) {
    throw apiError_('VALIDATION_ERROR',
      'Entity tidak dikenal: ' + entity + '. Gunakan product, customer, location, atau rack.', 'entity');
  }
  return conf;
}

/** Baca satu entity master dalam bentuk siap pakai frontend. */
function readMaster_(entity) {
  var conf = masterConf_(entity);
  return readTable_(conf.table).map(conf.toApi);
}

/** Urutkan master berdasarkan kode (atau nama bila tanpa kode). */
function sortMaster_(items) {
  return items.sort(function (a, b) {
    var ka = String(a.code || a.name || '').toUpperCase();
    var kb = String(b.code || b.name || '').toUpperCase();
    return ka.localeCompare(kb);
  });
}

/* =========================================================
   VALIDASI
   ========================================================= */

/** Cek keunikan nilai sebuah kolom (tidak peka huruf besar/kecil). */
function assertUnique_(table, field, value, excludeKey) {
  var target = String(value || '').trim().toUpperCase();
  var rows = readTable_(table);
  for (var i = 0; i < rows.length; i++) {
    if (excludeKey && String(rows[i].id) === String(excludeKey)) continue;
    if (String(rows[i][field] || '').trim().toUpperCase() === target) {
      throw apiError_('DUPLICATE', 'Nilai "' + value + '" sudah dipakai pada kolom ' + field + '.', field);
    }
  }
}

/**
 * Susun baris siap simpan dari input user (hanya kolom yang diizinkan).
 * @param {string} entity
 * @param {Object} values input dari frontend (camelCase)
 * @param {Object|null} existing baris lama saat update
 */
function buildMasterRow_(entity, values, existing) {
  var row = {};
  if (!values) return row;

  if (entity === 'product') {
    if (values.code !== undefined) row.code = String(values.code || '').trim().toUpperCase();
    if (values.name !== undefined) row.name = String(values.name || '').trim();
    if (values.unit !== undefined) row.unit = String(values.unit || '').trim();
  } else if (entity === 'customer') {
    if (values.code !== undefined) row.code = String(values.code || '').trim().toUpperCase();
    if (values.name !== undefined) row.name = String(values.name || '').trim();
    if (values.address !== undefined) row.address = String(values.address || '').trim();
    if (values.phone !== undefined) row.phone = String(values.phone || '').trim();
  } else if (entity === 'location') {
    if (values.type !== undefined) row.type = String(values.type || '').trim().toUpperCase();
    if (values.name !== undefined) row.name = String(values.name || '').trim();
    if (values.customerId !== undefined) row.customer_id = values.customerId ? String(values.customerId) : '';
  } else if (entity === 'rack') {
    if (values.code !== undefined) row.code = String(values.code || '').trim().toUpperCase();
    if (values.name !== undefined) row.name = String(values.name || '').trim();
    if (values.locationId !== undefined) row.location_id = values.locationId ? String(values.locationId) : '';
  }
  return row;
}

/** Validasi lengkap sebelum simpan (dipakai create & update). */
function validateMaster_(entity, row, existing) {
  var id = existing ? existing.id : null;

  if (entity === 'product') {
    assertRequired_(row.code, 'code', 'Kode produk');
    assertRequired_(row.name, 'name', 'Nama produk');
    assertRequired_(row.unit, 'unit', 'Satuan');
    if (SATUAN_.indexOf(row.unit) === -1) {
      throw apiError_('VALIDATION_ERROR', 'Satuan harus salah satu dari: ' + SATUAN_.join(', ') + '.', 'unit');
    }
    assertUnique_('products', 'code', row.code, id);
  }

  if (entity === 'customer') {
    assertRequired_(row.code, 'code', 'Kode pelanggan');
    assertRequired_(row.name, 'name', 'Nama pelanggan');
    assertUnique_('customers', 'code', row.code, id);
  }

  if (entity === 'location') {
    assertRequired_(row.type, 'type', 'Tipe gudang');
    assertRequired_(row.name, 'name', 'Nama gudang');
    if (['MAIN', 'CONSIGN'].indexOf(row.type) === -1) {
      throw apiError_('VALIDATION_ERROR', 'Tipe gudang harus MAIN atau CONSIGN.', 'type');
    }
    if (row.type === 'CONSIGN') {
      assertRequired_(row.customer_id, 'customerId', 'Pelanggan');
      var cust = readTableWhere_('customers', { id: row.customer_id });
      if (!cust.length) {
        throw apiError_('NOT_FOUND', 'Pelanggan tidak ditemukan.', 'customerId');
      }
      // PRD 6.6: satu pelanggan hanya boleh punya satu gudang titipan.
      var existingConsign = readTableWhere_('locations', { customer_id: row.customer_id, type: 'CONSIGN' });
      var clash = existingConsign.filter(function (l) { return String(l.id) !== String(id); });
      if (clash.length) {
        throw apiError_('DUPLICATE', 'Pelanggan ini sudah punya gudang titipan: ' + clash[0].name + '.', 'customerId');
      }
    } else {
      row.customer_id = ''; // gudang MAIN tidak terkait pelanggan
    }
  }

  if (entity === 'rack') {
    assertRequired_(row.code, 'code', 'Kode rak');
    assertRequired_(row.name, 'name', 'Nama rak');
    assertRequired_(row.location_id, 'locationId', 'Gudang');
    assertUnique_('racks', 'code', row.code, id);
    var loc = readTableWhere_('locations', { id: row.location_id });
    if (!loc.length) throw apiError_('NOT_FOUND', 'Gudang tidak ditemukan.', 'locationId');
  }
}

/** Alasan data tidak boleh dihapus (IN_USE), atau null bila aman. */
function masterInUse_(entity, id, row) {
  if (entity === 'product') {
    if (readTableWhere_('sj_lines', { product_id: id }).length) return 'produk dipakai di Surat Jalan';
    if (readTableWhere_('shipment_lines', { product_id: id }).length) return 'produk dipakai di pengiriman';
    return null;
  }
  if (entity === 'customer') {
    if (readTableWhere_('sj', { customer_id: id }).length) return 'pelanggan dipakai di Surat Jalan';
    if (readTableWhere_('shipments', { customer_id: id }).length) return 'pelanggan dipakai di pengiriman';
    if (readTableWhere_('locations', { customer_id: id }).length) return 'pelanggan masih punya gudang titipan';
    return null;
  }
  if (entity === 'location') {
    if (readTableWhere_('racks', { location_id: id }).length) return 'gudang masih punya rak';
    return null;
  }
  if (entity === 'rack') {
    if (readTableWhere_('receipts', { rack_id: id }).length) return 'rak dipakai di penerimaan fisik';
    if (readTableWhere_('shipment_lines', { rack_id: id }).length) return 'rak dipakai di pengiriman';
    return null;
  }
  return null;
}

/* =========================================================
   ACTION
   ========================================================= */

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

  return { entity: params.entity, items: sortMaster_(items), total: items.length };
}

/** Tambah data master. */
function masterCreate_(params, ctx) {
  var entity = params.entity;
  var conf = masterConf_(entity);

  var row = buildMasterRow_(entity, params.values, null);
  row.id = newId_();
  row.created_at = nowStamp_();
  row.created_by = ctx.username;
  row.updated_at = row.created_at;
  row.updated_by = ctx.username;

  validateMaster_(entity, row, null);
  appendRow_(conf.table, row);
  audit_(ctx, 'master.create', entity, row.id, params.values);

  return conf.toApi(row);
}

/** Ubah data master. */
function masterUpdate_(params, ctx) {
  var entity = params.entity;
  var conf = masterConf_(entity);
  var id = assertRequired_(params.id, 'id', 'ID');

  var found = readTableWhere_(conf.table, { id: id });
  if (!found.length) throw apiError_('NOT_FOUND', 'Data tidak ditemukan.', 'id');

  var existing = found[0];
  var patch = buildMasterRow_(entity, params.values, existing);

  // Gabungkan dengan data lama untuk validasi penuh.
  var merged = Object.assign({}, existing, patch);
  validateMaster_(entity, merged, existing);

  patch.updated_at = nowStamp_();
  patch.updated_by = ctx.username;
  updateById_(conf.table, id, patch);
  audit_(ctx, 'master.update', entity, id, params.values);

  return conf.toApi(Object.assign({}, existing, patch));
}

/** Hapus data master (ditolak bila masih dipakai). */
function masterDelete_(params, ctx) {
  var entity = params.entity;
  var conf = masterConf_(entity);
  var id = assertRequired_(params.id, 'id', 'ID');

  var found = readTableWhere_(conf.table, { id: id });
  if (!found.length) throw apiError_('NOT_FOUND', 'Data tidak ditemukan.', 'id');

  var reason = masterInUse_(entity, id, found[0]);
  if (reason) throw apiError_('IN_USE', 'Tidak bisa dihapus: ' + reason + '.');

  deleteById_(conf.table, id);
  audit_(ctx, 'master.delete', entity, id, { name: found[0].name || found[0].code || id });
  return { deleted: true, id: id };
}

/* =========================================================
   IMPOR CSV (Fase 5 — migrasi data awal)
   ========================================================= */

/** Batas baris per impor. */
var IMPORT_MAX_ROWS = 500;

/** Urutan kolom bila CSV tidak menyertakan baris header. */
var IMPORT_ORDER_ = {
  product: ['code', 'name', 'unit'],
  customer: ['code', 'name', 'address', 'phone'],
  location: ['type', 'name', 'customer'],
  rack: ['code', 'name', 'location']
};

/** Nama kolom yang dikenali di baris header (Indonesia & Inggris). */
var IMPORT_ALIASES_ = {
  code: ['code', 'kode', 'kode produk', 'kode pelanggan', 'kode rak', 'kode gudang'],
  name: ['name', 'nama', 'nama produk', 'nama pelanggan', 'nama gudang', 'nama rak'],
  unit: ['unit', 'satuan'],
  address: ['address', 'alamat'],
  phone: ['phone', 'telepon', 'telp', 'no telepon', 'no. telepon'],
  type: ['type', 'tipe', 'tipe gudang'],
  customer: ['customer', 'customerid', 'customer id', 'pelanggan', 'kode pelanggan'],
  // Gudang tidak punya kolom kode -> rujukan diisi NAMA gudang atau id.
  location: ['location', 'locationid', 'location id', 'gudang', 'nama gudang', 'lokasi']
};

/**
 * Urai teks CSV menjadi matriks sel (mendukung tanda kutip ganda).
 * Pemisah dideteksi: ';' bila baris pertama memakai ';' tanpa ','.
 */
function parseCsv_(text) {
  var s = String(text || '');
  var firstLine = s.split(/\r?\n/)[0] || '';
  var delim = (firstLine.indexOf(';') !== -1 && firstLine.indexOf(',') === -1) ? ';' : ',';

  var rows = [];
  var row = [];
  var field = '';
  var inQuotes = false;

  for (var i = 0; i < s.length; i++) {
    var ch = s.charAt(i);

    if (inQuotes) {
      if (ch === '"') {
        if (s.charAt(i + 1) === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') inQuotes = true;
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch === '\r') { /* abaikan */ }
    else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }

  return rows
    .filter(function (r) {
      return r.some(function (c) { return String(c).trim() !== ''; });
    })
    .map(function (r) {
      return r.map(function (c) { return String(c).trim(); });
    });
}

/** Cocokkan satu judul kolom ke nama field internal, atau null. */
function importFieldOf_(title) {
  var t = String(title || '').trim().toLowerCase();
  var keys = Object.keys(IMPORT_ALIASES_);
  for (var i = 0; i < keys.length; i++) {
    if (IMPORT_ALIASES_[keys[i]].indexOf(t) !== -1) return keys[i];
  }
  return null;
}

/** Cari id berdasarkan kode (atau id) pada tabel master; '' bila tidak ada. */
function resolveCodeToId_(table, value) {
  var v = String(value || '').trim().toUpperCase();
  if (!v) return '';
  var rows = readTable_(table);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].id).toUpperCase() === v) return rows[i].id;
    if (String(rows[i].code || '').toUpperCase() === v) return rows[i].id;
  }
  return '';
}

/**
 * Cari id gudang dari rujukan di CSV.
 * Tabel `locations` TIDAK punya kolom `code` (lihat HEADERS_), jadi rujukan
 * dicocokkan ke `id` lalu ke `name` (tidak peka huruf besar/kecil).
 */
function resolveLocationRef_(value) {
  var v = String(value || '').trim();
  if (!v) return '';
  var vu = v.toUpperCase();
  var rows = readTable_('locations');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].id).toUpperCase() === vu) return rows[i].id;
  }
  for (var j = 0; j < rows.length; j++) {
    if (String(rows[j].name || '').trim().toUpperCase() === vu) return rows[j].id;
  }
  return '';
}

/**
 * Impor master data dari teks CSV (PRD Fase 5: migrasi data awal).
 *
 * Menerima baris header opsional (nama kolom Indonesia/Inggris). Bila tidak ada
 * header, urutan kolom mengikuti IMPORT_ORDER_[entity].
 * Untuk `location`/`rack`, kolom customer/location diisi KODE dan diterjemahkan
 * ke id. Validasi tiap baris memakai aturan yang sama dengan master.create.
 *
 * @param {Object} params { entity, csv }
 * @returns {Object} ringkasan hasil per baris
 */
function masterImport_(params, ctx) {
  var entity = params.entity;
  var conf = masterConf_(entity);

  var csv = String(params.csv || '');
  if (!csv.trim()) {
    throw apiError_('VALIDATION_ERROR', 'Isi CSV masih kosong.', 'csv');
  }

  var matrix = parseCsv_(csv);
  if (!matrix.length) {
    throw apiError_('VALIDATION_ERROR', 'Tidak ada baris data yang bisa dibaca.', 'csv');
  }

  // Deteksi header: baris pertama dianggap header bila ada kolom yang dikenali.
  var headerFields = matrix[0].map(importFieldOf_);
  var hasHeader = headerFields.some(function (f) { return f !== null; });

  var fields;
  var dataRows;
  if (hasHeader) {
    fields = headerFields;
    dataRows = matrix.slice(1);
  } else {
    fields = IMPORT_ORDER_[entity];
    dataRows = matrix;
  }

  if (!dataRows.length) {
    throw apiError_('VALIDATION_ERROR', 'CSV hanya berisi baris header.', 'csv');
  }
  if (dataRows.length > IMPORT_MAX_ROWS) {
    throw apiError_('VALIDATION_ERROR',
      'Maksimal ' + IMPORT_MAX_ROWS + ' baris per impor (dikirim ' + dataRows.length + ').', 'csv');
  }

  var now = nowStamp_();
  var created = 0;
  var failed = 0;
  var errors = [];

  dataRows.forEach(function (cells, idx) {
    var rowNo = (hasHeader ? idx + 2 : idx + 1);
    var values = {};

    if (hasHeader) {
      for (var c = 0; c < fields.length; c++) {
        if (!fields[c]) continue;
        values[fields[c]] = cells[c] !== undefined ? cells[c] : '';
      }
    } else {
      for (var d = 0; d < fields.length; d++) {
        values[fields[d]] = cells[d] !== undefined ? cells[d] : '';
      }
    }

    // Terjemahkan kode relasi menjadi id.
    try {
      if (entity === 'location' && values.customer !== undefined) {
        if (String(values.customer).trim()) {
          var cid = resolveCodeToId_('customers', values.customer);
          if (!cid) {
            throw apiError_('NOT_FOUND', 'Pelanggan dengan kode "' + values.customer + '" tidak ditemukan.', 'customerId');
          }
          values.customerId = cid;
        }
        delete values.customer;
      }
      if (entity === 'rack' && values.location !== undefined) {
        if (String(values.location).trim()) {
          var lid = resolveLocationRef_(values.location);
          if (!lid) {
            throw apiError_('NOT_FOUND',
              'Gudang "' + values.location + '" tidak ditemukan (isi dengan NAMA gudang, karena gudang tidak punya kode).',
              'locationId');
          }
          values.locationId = lid;
        }
        delete values.location;
      }

      var row = buildMasterRow_(entity, values, null);
      row.id = newId_();
      row.created_at = now;
      row.created_by = ctx.username;
      row.updated_at = now;
      row.updated_by = ctx.username;

      validateMaster_(entity, row, null);
      appendRow_(conf.table, row);
      created++;
    } catch (rowErr) {
      failed++;
      if (errors.length < 50) {
        errors.push({
          row: rowNo,
          code: rowErr.code || 'INTERNAL',
          message: rowErr.message || 'Baris gagal diproses.',
          field: rowErr.field || null
        });
      }
    }
  });

  audit_(ctx, 'master.import', entity, '', {
    rows: dataRows.length, created: created, failed: failed, header: hasHeader
  });

  return {
    entity: entity,
    headerDetected: hasHeader,
    fields: hasHeader ? fields : IMPORT_ORDER_[entity],
    rows: dataRows.length,
    created: created,
    failed: failed,
    errors: errors
  };
}
