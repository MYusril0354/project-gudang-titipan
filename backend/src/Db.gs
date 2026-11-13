/**
 * Db.gs — Helper akses Google Sheets sebagai database.
 *
 * Prinsip (PRD bagian 10 & 13):
 *  - Satu spreadsheet, satu sheet per tabel, baris 1 = header.
 *  - Baca satu tabel dengan SATU getValues() per request (bukan per baris).
 *  - Kolom `id` diisi server; semua tabel punya created_at/by, updated_at/by.
 */

/** Nama Script Property untuk ID spreadsheet database. */
var PROP_SPREADSHEET_ID = 'SPREADSHEET_ID';

/** Nama sheet sesuai model data (PRD bagian 10). */
var TABLES_ = [
  'users', 'sessions', 'products', 'customers', 'locations', 'racks',
  'sj', 'sj_lines', 'receipts', 'cancellations',
  'shipments', 'shipment_lines', 'shipment_consumptions',
  'movements', 'counters', 'audit_log', 'error_log'
];

/** Definisi kolom tiap tabel (baris 1 sheet). */
var HEADERS_ = {
  users: ['id', 'username', 'nama', 'role', 'password_hash', 'salt', 'aktif', 'failed_count', 'locked_until', 'created_at', 'created_by', 'updated_at', 'updated_by'],
  sessions: ['token', 'user_id', 'expires_at', 'created_at'],
  products: ['id', 'code', 'name', 'unit', 'created_at', 'created_by', 'updated_at', 'updated_by'],
  customers: ['id', 'code', 'name', 'address', 'phone', 'created_at', 'created_by', 'updated_at', 'updated_by'],
  locations: ['id', 'type', 'name', 'customer_id', 'created_at', 'created_by', 'updated_at', 'updated_by'],
  racks: ['id', 'code', 'name', 'location_id', 'created_at', 'created_by', 'updated_at', 'updated_by'],
  sj: ['no', 'date', 'customer_id', 'po', 'status_cache', 'created_at', 'created_by', 'updated_at', 'updated_by'],
  sj_lines: ['id', 'sj_no', 'product_id', 'qty_sj', 'qty_cancelled', 'decision', 'alasan', 'eta', 'pic', 'created_at', 'created_by', 'updated_at', 'updated_by'],
  receipts: ['id', 'sj_line_id', 'qty', 'rack_id', 'date', 'pic', 'batch_number', 'kondisi', 'created_at', 'created_by', 'updated_at', 'updated_by'],
  cancellations: ['id', 'sj_line_id', 'qty', 'reason', 'note', 'date', 'created_at', 'created_by', 'updated_at', 'updated_by'],
  shipments: ['no', 'date', 'customer_id', 'status', 'pod_date', 'driver', 'vehicle', 'note', 'print_count', 'last_printed_at', 'created_at', 'created_by', 'updated_at', 'updated_by'],
  shipment_lines: ['id', 'shipment_no', 'product_id', 'rack_id', 'qty', 'created_at', 'created_by', 'updated_at', 'updated_by'],
  shipment_consumptions: ['id', 'shipment_line_id', 'receipt_id', 'sj_no', 'batch_number', 'qty', 'created_at'],
  movements: ['id', 'date', 'type', 'ref', 'product_id', 'customer_id', 'rack_id', 'qty', 'batch_number', 'sj_ref', 'note', 'created_at'],
  counters: ['key', 'value'],
  audit_log: ['id', 'timestamp', 'user', 'action', 'entity', 'entity_id', 'detail'],
  error_log: ['id', 'timestamp', 'code', 'message', 'stack', 'request']
};

/**
 * Kolom tanggal (YYYY-MM-DD) per tabel.
 * Wajib: Sheets menyimpan sel sebagai Date, bukan string.
 */
var DATE_COLS_ = {
  sj: ['date'],
  sj_lines: ['eta'],
  receipts: ['date'],
  cancellations: ['date'],
  shipments: ['date', 'pod_date'],
  movements: ['date']
};

/** Kolom timestamp (YYYY-MM-DD HH:mm:ss) per tabel. */
var STAMP_COLS_ = {
  users: ['created_at', 'updated_at', 'locked_until'],
  sessions: ['expires_at', 'created_at'],
  products: ['created_at', 'updated_at'],
  customers: ['created_at', 'updated_at'],
  locations: ['created_at', 'updated_at'],
  racks: ['created_at', 'updated_at'],
  sj: ['created_at', 'updated_at'],
  sj_lines: ['created_at', 'updated_at'],
  receipts: ['created_at', 'updated_at'],
  cancellations: ['created_at', 'updated_at'],
  shipments: ['created_at', 'updated_at', 'last_printed_at'],
  shipment_lines: ['created_at', 'updated_at'],
  shipment_consumptions: ['created_at'],
  movements: ['created_at'],
  audit_log: ['timestamp'],
  error_log: ['timestamp']
};

/**
 * Cache per-eksekusi (variabel global hanya hidup selama satu request GAS).
 * Memangkas panggilan SpreadsheetApp.openById / getSheetByName yang tadinya
 * dilakukan ulang di setiap helper. Cache baris diinvalidasi setiap ada tulis.
 */
var SS_CACHE_ = null;
var SHEET_CACHE_ = {};
var READ_CACHE_ = {};

/**
 * CATATAN KINERJA (Fase 5) — hasil percobaan, jangan diulang tanpa alasan:
 *
 * Sempat dicoba prefetch semua tabel lewat satu panggilan Sheets API
 * (`values:batchGet` + UrlFetchApp) untuk menukar N round-trip `getValues()`
 * menjadi satu. Hasil pengukuran: TIDAK lebih cepat (bootstrap p50 3,5 -> 4,0
 * dtk; dashboard 3,9 -> 4,1 dtk), kemungkinan karena biaya OAuth token +
 * round-trip HTTPS menyamai atau melebihi penghematan `getValues`. Perubahan
 * itu dicabut.
 *
 * Yang TERBUKTI membantu adalah cache per-eksekusi di bawah ini (sheet object
 * dan baris tabel): bootstrap -17%, dashboard -27%.
 *
 * Batas bawah latensi ada di platform: `system.health` (tanpa akses sheet sama
 * sekali) sudah ~1,7 dtk. Untuk turun ke target PRD 0,5-2 dtk pada endpoint
 * multi-tabel, datastore harus dipindah dari Sheets (lihat RISK di RUNBOOK).
 */

/** Kosongkan cache baris setelah tulis (semua tulis lewat helper di bawah). */
function invalidateReadCache_(table) {
  if (table) delete READ_CACHE_[table];
  else READ_CACHE_ = {};
}

/** Workbook database aktif (di-cache per request). */
function db_() {
  if (SS_CACHE_) return SS_CACHE_;
  var id = PropertiesService.getScriptProperties().getProperty(PROP_SPREADSHEET_ID);
  if (!id) throw apiError_('INTERNAL', 'SPREADSHEET_ID belum diset di Script Properties.');
  SS_CACHE_ = SpreadsheetApp.openById(id);
  return SS_CACHE_;
}

/** Sheet berdasarkan nama, dibuat beserta header bila belum ada (di-cache). */
function sheet_(name) {
  var headers = HEADERS_[name];
  if (!headers) throw apiError_('INTERNAL', 'Tabel tidak dikenal: ' + name);

  if (SHEET_CACHE_[name]) return SHEET_CACHE_[name];

  var ss = db_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  SHEET_CACHE_[name] = sh;
  return sh;
}

/** Pastikan semua tabel ada beserta header-nya. */
function ensureAllTables_() {
  var created = [];
  TABLES_.forEach(function (name) {
    var ss = db_();
    if (!ss.getSheetByName(name)) created.push(name);
    sheet_(name);
  });
  return created;
}

/**
 * Baca seluruh tabel menjadi array objek (satu getValues per tabel).
 * Hasil di-cache per request; cache dibuang setiap ada operasi tulis.
 * @param {string} name nama sheet
 * @returns {Object[]}
 */
function readTable_(name) {
  var headers = HEADERS_[name];
  if (!headers) throw apiError_('INTERNAL', 'Tabel tidak dikenal: ' + name);

  if (READ_CACHE_[name]) return READ_CACHE_[name];

  var sh = sheet_(name);
  var lastRow = sh.getLastRow();
  if (lastRow < 2) {
    READ_CACHE_[name] = [];
    return READ_CACHE_[name];
  }

  var values = sh.getRange(2, 1, lastRow - 1, headers.length).getValues();
  var dateCols = DATE_COLS_[name] || [];
  var stampCols = STAMP_COLS_[name] || [];
  var rows = [];
  for (var r = 0; r < values.length; r++) {
    var obj = {};
    var hasValue = false;
    for (var c = 0; c < headers.length; c++) {
      var v = values[r][c];
      obj[headers[c]] = v;
      if (v !== '' && v !== null && v !== undefined) hasValue = true;
    }
    if (hasValue) {
      for (var d = 0; d < dateCols.length; d++) obj[dateCols[d]] = cellDate_(obj[dateCols[d]]);
      for (var t = 0; t < stampCols.length; t++) obj[stampCols[t]] = cellStamp_(obj[stampCols[t]]);
      rows.push(obj);
    }
  }
  READ_CACHE_[name] = rows;
  return rows;
}

/** Baca satu tabel dengan filter sederhana {kolom: nilai}. */
function readTableWhere_(name, filter) {
  return readTable_(name).filter(function (row) {
    return Object.keys(filter).every(function (k) { return String(row[k]) === String(filter[k]); });
  });
}

/** Nama kolom kunci sebuah tabel: 'id' bila ada, selain itu header pertama. */
function idKey_(name) {
  var headers = HEADERS_[name];
  return headers.indexOf('id') !== -1 ? 'id' : headers[0];
}

/** Indeks baris (1-based, termasuk header) berdasarkan kunci; -1 bila tidak ada. */
function rowIndexByKey_(name, key) {
  var sh = sheet_(name);
  var headers = HEADERS_[name];
  var col = headers.indexOf(idKey_(name)) + 1;
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return -1;

  var values = sh.getRange(2, col, lastRow - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]) === String(key)) return i + 2;
  }
  return -1;
}

/** Tambah satu baris. Mengisi `id` otomatis bila tabel memilikinya. */
function appendRow_(name, obj) {
  var headers = HEADERS_[name];
  if (!obj[idKey_(name)] && headers.indexOf('id') !== -1) obj.id = newId_();

  var sh = sheet_(name);
  var row = headers.map(function (h) {
    var v = obj[h];
    return v === undefined || v === null ? '' : v;
  });
  sh.appendRow(row);
  invalidateReadCache_(name);
  return obj;
}

/** Tambah banyak baris sekaligus (lebih cepat daripada appendRow_ berulang). */
function appendRows_(name, objs) {
  if (!objs || !objs.length) return [];
  var headers = HEADERS_[name];
  var hasId = headers.indexOf('id') !== -1;

  var rows = objs.map(function (obj) {
    if (hasId && !obj.id) obj.id = newId_();
    return headers.map(function (h) {
      var v = obj[h];
      return v === undefined || v === null ? '' : v;
    });
  });

  var sh = sheet_(name);
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
  invalidateReadCache_(name);
  return objs;
}

/**
 * Update baris berdasarkan kunci.
 * @param {string} name nama tabel
 * @param {string} key nilai kolom kunci
 * @param {Object} patch kolom yang diubah
 * @returns {Object|null} objek hasil gabungan, atau null bila tidak ditemukan
 */
function updateById_(name, key, patch) {
  var idx = rowIndexByKey_(name, key);
  if (idx === -1) return null;

  var headers = HEADERS_[name];
  var sh = sheet_(name);
  var current = sh.getRange(idx, 1, 1, headers.length).getValues()[0];

  Object.keys(patch).forEach(function (col) {
    var c = headers.indexOf(col);
    if (c !== -1) current[c] = patch[col] === undefined || patch[col] === null ? '' : patch[col];
  });

  sh.getRange(idx, 1, 1, headers.length).setValues([current]);
  invalidateReadCache_(name);
  return current;
}

/** Hapus baris berdasarkan kunci. */
function deleteById_(name, key) {
  var idx = rowIndexByKey_(name, key);
  if (idx === -1) return false;
  sheet_(name).deleteRow(idx);
  invalidateReadCache_(name);
  return true;
}

/* =========================================================
   COUNTER — penomoran dokumen (PRD 6.2, 6.3, 6.7)
   ========================================================= */

/** Nilai counter saat ini (0 bila belum ada). */
function getCounter_(key) {
  var rows = readTable_('counters');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].key) === String(key)) return Number(rows[i].value || 0);
  }
  return 0;
}

/** Set nilai counter (upsert). */
function setCounter_(key, value) {
  var idx = rowIndexByKey_('counters', key);
  var sh = sheet_('counters');
  if (idx === -1) {
    sh.appendRow([key, value]);
  } else {
    sh.getRange(idx, 2).setValue(value);
  }
  invalidateReadCache_('counters');
  return value;
}

/* =========================================================
   ID
   ========================================================= */

/** ID unik untuk kolom `id` (UUID — menggantikan Date.now() % 1000). */
function newId_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 16);
}
