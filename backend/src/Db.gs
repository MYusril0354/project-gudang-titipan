/**
 * Db.gs — Helper akses Google Sheets sebagai database.
 *
 * Prinsip (PRD bagian 10 & 13):
 *  - Satu spreadsheet, satu sheet per tabel, baris 1 = header.
 *  - Baca satu tabel dengan SATU getValues() per request (jangan per baris).
 *  - Kolom `id` diisi server; semua tabel punya created_at/by, updated_at/by.
 *
 * Implementasi lengkap masuk Fase 0.
 */

/** ID spreadsheet database — diisi saat setup (Script Properties). */
var PROP_SPREADSHEET_ID = 'SPREADSHEET_ID';

/** Nama sheet sesuai model data (PRD bagian 10). */
var TABLES_ = [
  'users', 'sessions', 'products', 'customers', 'locations', 'racks',
  'sj', 'sj_lines', 'receipts', 'cancellations',
  'shipments', 'shipment_lines', 'shipment_consumptions',
  'movements', 'counters', 'audit_log', 'error_log'
];

/** Workbook database aktif. */
function db_() {
  var id = PropertiesService.getScriptProperties().getProperty(PROP_SPREADSHEET_ID);
  if (!id) throw apiError_('INTERNAL', 'SPREADSHEET_ID belum diset di Script Properties.');
  return SpreadsheetApp.openById(id);
}

/** Sheet berdasarkan nama, dibuat bila belum ada (beserta header). */
function sheet_(name) {
  var ss = db_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    var headers = HEADERS_[name];
    if (headers) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
  }
  return sh;
}

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

/** Baca seluruh tabel menjadi array objek. */
function readTable_(name) {
  // Fase 0: implementasi getValues() sekali baca + map ke objek.
  return [];
}

/** Tambah satu baris. */
function appendRow_(name, obj) {
  // Fase 0
  return obj;
}

/** Update baris berdasarkan id. */
function updateById_(name, id, patch) {
  // Fase 0
  return patch;
}

/** Hapus baris berdasarkan id. */
function deleteById_(name, id) {
  // Fase 0
  return true;
}

function getCounter_(key) {
  // Fase 0
  return 0;
}

function setCounter_(key, value) {
  // Fase 0
  return value;
}
