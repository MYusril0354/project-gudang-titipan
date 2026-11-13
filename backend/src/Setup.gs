/**
 * Setup.gs — Skrip penyiapan satu kali (Fase 0).
 *
 * Cara pakai yang disarankan (lewat Web App, karena Execution API bermasalah):
 *   POST /exec  {"action":"system.setup","params":{"spreadsheetId":"...","adminPassword":"..."}}
 *
 * Pengamanan: action `system.setup` hanya boleh berjalan bila system BELUM
 * dikonfigurasi (SPREADSHEET_ID kosong), atau bila mengirim `key` yang cocok
 * dengan Script Property SETUP_KEY. Setelah setup selesai, endpoint ini
 * menolak permintaan tanpa kunci.
 *
 * Semua fungsi di sini idempoten (aman dijalankan berulang).
 */

/* =========================================================
   ENTRY POINT ACTION
   ========================================================= */

/**
 * Handler action `system.setup`.
 * @param {Object} params { spreadsheetId, adminPassword, adminUsername, key }
 * @returns {Object} ringkasan hasil setup
 */
function systemSetup_(params) {
  var props = PropertiesService.getScriptProperties();
  var configured = props.getProperty(PROP_SPREADSHEET_ID);
  var setupKey = props.getProperty('SETUP_KEY');

  // Sudah terkonfigurasi -> wajib kunci yang cocok.
  if (configured) {
    if (!setupKey) {
      throw apiError_('FORBIDDEN', 'Sistem sudah terkonfigurasi. Setup ulang dinonaktifkan.');
    }
    if (String(params.key || '') !== setupKey) {
      throw apiError_('FORBIDDEN', 'Kunci setup tidak valid.');
    }
  }

  var spreadsheetId = params.spreadsheetId || configured;
  if (!spreadsheetId) {
    throw apiError_('VALIDATION_ERROR', 'spreadsheetId wajib diisi pada setup pertama.', 'spreadsheetId');
  }

  var result = setupAll(spreadsheetId, params.adminPassword || 'admin123', params.adminUsername || 'admin');

  if (isTrue_(params.seedSample)) {
    result.sample = seedSampleData_();
  }

  // Simpan kunci setup agar pemanggilan berikutnya bisa diverifikasi.
  if (!setupKey) {
    var newKey = Utilities.getUuid().replace(/-/g, '').slice(0, 24);
    props.setProperty('SETUP_KEY', newKey);
    result.setupKey = newKey;
  }

  return result;
}

/**
 * Jalankan seluruh penyiapan.
 * @param {string} spreadsheetId ID spreadsheet database (boleh URL lengkap)
 * @param {string} adminPassword password user admin pertama
 * @param {string} [adminUsername] default 'admin'
 * @returns {Object} ringkasan hasil
 */
function setupAll(spreadsheetId, adminPassword, adminUsername) {
  var result = {};

  result.properties = setupProperties_(spreadsheetId, false);
  result.tables = setupTables_();
  // Samakan header dengan skema kode (kolom baru selalu di akhir).
  result.schema = ensureHeaders_();
  result.admin = seedAdmin_(adminUsername || 'admin', adminPassword || 'admin123');
  result.company = seedCompany_();
  result.counters = seedCounters_();
  result.verify = selfTest_();

  return result;
}

/* =========================================================
   PROPERTIES
   ========================================================= */

/** Simpan API/Spreadsheet ID ke Script Properties. */
function setupProperties_(spreadsheetId, overwrite) {
  var props = PropertiesService.getScriptProperties();
  var saved = {};

  var id = String(spreadsheetId || '').trim();
  if (id) {
    // Terima URL lengkap maupun ID saja.
    var m = id.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (m) id = m[1];
    if (overwrite || !props.getProperty(PROP_SPREADSHEET_ID)) {
      props.setProperty(PROP_SPREADSHEET_ID, id);
    }
    saved.spreadsheetId = id;
  }
  saved.current = props.getProperty(PROP_SPREADSHEET_ID) || null;
  return saved;
}

/* =========================================================
   TABEL
   ========================================================= */

/** Pastikan semua sheet dan header tersedia. */
function setupTables_() {
  var created = ensureAllTables_();

  // Hapus sheet default kosong "Sheet1" agar tidak mengganggu.
  try {
    var ss = db_();
    var def = ss.getSheetByName('Sheet1');
    if (def && ss.getSheets().length > 1 && def.getLastRow() === 0) ss.deleteSheet(def);
  } catch (ignore) { /* bukan masalah bila gagal */ }

  var report = {};
  TABLES_.forEach(function (name) {
    report[name] = readTable_(name).length;
  });
  return { created: created, rowCounts: report };
}

/* =========================================================
   SEED DATA
   ========================================================= */

/**
 * Buat user ADMIN pertama bila belum ada.
 * @returns {Object} { created:boolean, username:string }
 */
function seedAdmin_(username, password) {
  var existing = readTable_('users');
  if (existing.length > 0) {
    return { created: false, username: existing[0].username, total: existing.length };
  }

  var salt = makeSalt_();
  var now = nowStamp_();
  appendRow_('users', {
    id: newId_(),
    username: username,
    nama: 'Administrator',
    role: ROLES.ADMIN,
    password_hash: hashPassword_(password, salt),
    salt: salt,
    aktif: 'TRUE',
    failed_count: 0,
    locked_until: '',
    created_at: now,
    created_by: 'setup',
    updated_at: now,
    updated_by: 'setup'
  });

  return { created: true, username: username, total: 1 };
}

/** Isi Script Properties untuk kop surat bila belum ada. */
function seedCompany_() {
  var props = PropertiesService.getScriptProperties();
  var defaults = {
    COMPANY_NAME: 'PT DISTRIBUSI NUSANTARA',
    COMPANY_ADDRESS: 'Jl. Industri Raya No. 45, Jakarta Timur 13910',
    COMPANY_PHONE: '(021) 8765-4321',
    COMPANY_EMAIL: 'admin@distribusi.co.id',
    COMPANY_NPWP: '01.234.567.8-901.000',
    COMPANY_LOGO: 'DN'
  };
  var set = [];
  Object.keys(defaults).forEach(function (k) {
    if (!props.getProperty(k)) {
      props.setProperty(k, defaults[k]);
      set.push(k);
    }
  });
  return { filled: set };
}

/** Siapkan baris counter awal. */
function seedCounters_() {
  var rows = readTable_('counters');
  if (rows.length > 0) return { created: 0, existing: rows.length };

  var year = todayStr_().slice(0, 4);
  appendRows_('counters', [
    { key: 'SJ-' + year, value: 0 },
    { key: 'DO-TTR', value: 0 }
  ]);
  return { created: 2, existing: 0 };
}

/* =========================================================
   DATA CONTOH — mengikuti data dummy prototipe
   ========================================================= */

/**
 * Isi master data contoh (idempoten: hanya bila tabel masih kosong).
 * Satu pelanggan = satu gudang titipan (PRD 6.6).
 */
function seedSampleData_() {
  var result = { products: 0, customers: 0, locations: 0, racks: 0, skipped: false };

  if (readTable_('products').length || readTable_('customers').length) {
    result.skipped = true;
    return result;
  }

  var now = nowStamp_();
  function base() {
    return { created_at: now, created_by: 'setup', updated_at: now, updated_by: 'setup' };
  }

  // Produk
  var products = [
    { code: 'PRD-001', name: 'Kertas A4 80gsm', unit: 'rim' },
    { code: 'PRD-002', name: 'Tinta Printer HP 680', unit: 'pcs' },
    { code: 'PRD-003', name: 'Map Plastik', unit: 'pak' },
    { code: 'PRD-004', name: 'Kabel HDMI 2m', unit: 'pcs' },
    { code: 'PRD-005', name: 'Lampu LED 12W', unit: 'pcs' }
  ];
  products.forEach(function (p) {
    appendRow_('products', Object.assign({ id: newId_(), code: p.code, name: p.name, unit: p.unit }, base()));
    result.products++;
  });

  // Pelanggan
  var customers = [
    { code: 'SJY', name: 'PT Sinar Jaya', address: 'Jl. Merdeka No. 12, Jakarta Pusat', phone: '021-5551234' },
    { code: 'MAB', name: 'CV Mitra Abadi', address: 'Jl. Ahmad Yani No. 88, Bekasi', phone: '021-5552345' },
    { code: 'KRU', name: 'PT Karya Utama', address: 'Jl. Gatot Subroto No. 5, Jakarta Selatan', phone: '021-5553456' },
    { code: 'TKB', name: 'Toko Berkah', address: 'Jl. Pasar Baru No. 3, Tangerang', phone: '021-5554567' }
  ];
  var customerIds = {};
  customers.forEach(function (c) {
    var row = Object.assign({ id: newId_(), code: c.code, name: c.name, address: c.address, phone: c.phone }, base());
    appendRow_('customers', row);
    customerIds[c.code] = row.id;
    result.customers++;
  });

  // Gudang: 1 MAIN + 1 CONSIGN per pelanggan
  var mainId = newId_();
  appendRow_('locations', Object.assign({ id: mainId, type: 'MAIN', name: 'Gudang Utama', customer_id: '' }, base()));
  result.locations++;

  var consignIds = {};
  customers.forEach(function (c) {
    var id = newId_();
    appendRow_('locations', Object.assign({
      id: id, type: 'CONSIGN', name: 'Gudang Titipan — ' + c.name, customer_id: customerIds[c.code]
    }, base()));
    consignIds[c.code] = id;
    result.locations++;
  });

  // Rak
  var racks = [
    { code: 'A-01-01', name: 'Rak A1 Level 1', location_id: mainId },
    { code: 'B-01-01', name: 'Rak B1', location_id: consignIds.SJY },
    { code: 'B-01-02', name: 'Rak B2', location_id: consignIds.SJY },
    { code: 'C-01-01', name: 'Rak C1', location_id: consignIds.MAB },
    { code: 'D-01-01', name: 'Rak D1', location_id: consignIds.KRU },
    { code: 'E-01-01', name: 'Rak E1', location_id: consignIds.TKB }
  ];
  racks.forEach(function (r) {
    appendRow_('racks', Object.assign({ id: newId_(), code: r.code, name: r.name, location_id: r.location_id }, base()));
    result.racks++;
  });

  auditRaw_('setup', 'setup.seedSample', 'master', '', result);
  return result;
}

/* =========================================================
   VERIFIKASI
   ========================================================= */

/** Cek struktur database: sheet, header, dan jumlah baris. */
function selfTest_() {
  var ss = db_();
  var report = { spreadsheetName: ss.getName(), tables: {}, missingHeaders: [] };

  TABLES_.forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) {
      report.tables[name] = { exists: false };
      return;
    }
    var headers = HEADERS_[name];
    var actual = sh.getLastColumn() > 0
      ? sh.getRange(1, 1, 1, headers.length).getValues()[0]
      : [];
    var ok = headers.every(function (h, i) { return String(actual[i]) === h; });
    if (!ok) report.missingHeaders.push(name);
    report.tables[name] = {
      exists: true,
      headersOk: ok,
      rows: Math.max(0, sh.getLastRow() - 1)
    };
  });

  return report;
}
