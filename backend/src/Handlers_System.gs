/**
 * Handlers_System.gs — Hardening & rilis (Fase 5).
 *
 * Cakupan:
 *  - Kunci go-live (`PROD_LOCK`) untuk mematikan endpoint sensitif.
 *  - Backup database ke folder Drive + pruning retensi.
 *  - Daftar error dari sheet `error_log`.
 *
 * Catatan scope: modul ini SENGAJA tidak memakai ScriptApp (trigger) maupun
 * MailApp (email) supaya manifest oauthScopes tidak berubah — menambah scope
 * memaksa otorisasi ulang dan bisa mematikan Web App yang sudah jalan.
 * Pemasangan trigger harian dilakukan lewat UI Apps Script (lihat RUNBOOK).
 */

/** Action yang dimatikan saat PROD_LOCK aktif. */
var SENSITIVE_ACTIONS_ = ['system.setup', 'system.selfTest'];

/** Nama Script Property untuk kunci go-live. */
var PROP_PROD_LOCK = 'PROD_LOCK';

/** Folder Drive default untuk backup. */
var DEFAULT_BACKUP_FOLDER = 'Gudang Titipan Backup';

/** Jumlah backup yang disimpan (retensi harian). */
var DEFAULT_BACKUP_KEEP = 30;

/** Maksimum baris error_log sebelum dipangkas. */
var ERROR_LOG_MAX = 1000;

/** Kode error yang wajar (bukan gangguan sistem) — tidak dicatat ke error_log. */
var BENIGN_CODES_ = [
  'VALIDATION_ERROR', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND',
  'DUPLICATE', 'IN_USE', 'QTY_EXCEEDS_PENDING', 'INSUFFICIENT_STOCK',
  'NO_CONSIGN_RACK', 'LOCK_TIMEOUT'
];

/* =========================================================
   KUNCI GO-LIVE
   ========================================================= */

/** Apakah sistem sedang terkunci untuk produksi. */
function isLocked_() {
  return isTrue_(PropertiesService.getScriptProperties().getProperty(PROP_PROD_LOCK));
}

/** Lempar FORBIDDEN bila sistem terkunci dan action termasuk sensitif. */
function assertNotLocked_(action) {
  if (isLocked_() && SENSITIVE_ACTIONS_.indexOf(String(action)) !== -1) {
    throw apiError_('FORBIDDEN',
      'Sistem dalam mode produksi terkunci. Action "' + action + '" dinonaktifkan.');
  }
}

/**
 * Status hardening + (opsional) ubah kunci.
 * @param {Object} params { lock?: boolean, adminEmail?: string, backupFolder?: string, backupKeep?: number }
 */
function systemHardening_(params, ctx) {
  var props = PropertiesService.getScriptProperties();

  if (params.lock !== undefined) {
    var wantLock = isTrue_(params.lock);
    if (wantLock) props.setProperty(PROP_PROD_LOCK, 'TRUE');
    else props.deleteProperty(PROP_PROD_LOCK);
    audit_(ctx, wantLock ? 'system.lock' : 'system.unlock', 'system', '', {
      locked: wantLock
    });
  }

  if (params.adminEmail !== undefined) {
    var email = String(params.adminEmail || '').trim();
    if (email) props.setProperty('ADMIN_EMAIL', email);
    else props.deleteProperty('ADMIN_EMAIL');
  }

  if (params.backupFolder !== undefined) {
    var folder = String(params.backupFolder || '').trim();
    if (folder) props.setProperty('BACKUP_FOLDER', folder);
    else props.deleteProperty('BACKUP_FOLDER');
  }

  if (params.backupKeep !== undefined) {
    var keep = parseInt(params.backupKeep, 10);
    if (!isFinite(keep) || keep < 1 || keep > 365) {
      throw apiError_('VALIDATION_ERROR', 'backupKeep harus 1–365.', 'backupKeep');
    }
    props.setProperty('BACKUP_KEEP', String(keep));
  }

  var ss = db_();
  return {
    locked: isLocked_(),
    sensitiveActions: SENSITIVE_ACTIONS_,
    setupKeyPresent: Boolean(props.getProperty('SETUP_KEY')),
    adminEmail: props.getProperty('ADMIN_EMAIL') || '',
    backupFolder: props.getProperty('BACKUP_FOLDER') || DEFAULT_BACKUP_FOLDER,
    backupKeep: Number(props.getProperty('BACKUP_KEEP') || DEFAULT_BACKUP_KEEP),
    spreadsheetId: props.getProperty(PROP_SPREADSHEET_ID),
    spreadsheetName: ss.getName(),
    timeZone: Session.getScriptTimeZone(),
    // Diperiksa operator saat go-live.
    checklist: {
      prodLock: isLocked_(),
      headerKeamanan: 'lihat netlify.toml (CSP, X-Frame-Options, nosniff)',
      backupTerpasang: 'pasang trigger harian lewat UI Apps Script (lihat RUNBOOK)'
    }
  };
}

/* =========================================================
   BACKUP
   ========================================================= */

/** Folder backup (dibuat bila belum ada). */
function backupFolder_() {
  var name = PropertiesService.getScriptProperties().getProperty('BACKUP_FOLDER')
    || DEFAULT_BACKUP_FOLDER;
  var it = DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.createFolder(name);
}

/**
 * Salin spreadsheet database ke folder Drive, lalu pangkas backup lama.
 * @param {Object} params { note }
 */
function backupDatabase_(params, ctx) {
  var ss = db_();
  var props = PropertiesService.getScriptProperties();
  var folder = backupFolder_();
  var keep = Number(props.getProperty('BACKUP_KEEP') || DEFAULT_BACKUP_KEEP);

  var stamp = Utilities.formatDate(new Date(), TZ_, 'yyyy-MM-dd_HHmm');
  var name = ss.getName() + '_backup_' + stamp;

  var copy = DriveApp.getFileById(ss.getId()).makeCopy(name, folder);

  // Pangkas: simpan `keep` terbaru saja.
  var files = [];
  var it = folder.getFiles();
  while (it.hasNext()) files.push(it.next());
  files.sort(function (a, b) { return b.getDateCreated().getTime() - a.getDateCreated().getTime(); });

  var trashed = 0;
  for (var i = keep; i < files.length; i++) {
    files[i].setTrashed(true);
    trashed++;
  }

  audit_(ctx, 'system.backup', 'spreadsheet', ss.getId(), {
    file: name, keep: keep, trashed: trashed
  });

  return {
    file: name,
    id: copy.getId(),
    url: copy.getUrl(),
    folder: folder.getName(),
    kept: files.length - trashed,
    trashed: trashed,
    keep: keep
    // Ukuran file sengaja tidak dikembalikan di sini: DriveApp.getSize() tepat
    // setelah makeCopy bisa masih 0/1. Pakai system.backupStatus untuk ukuran.
  };
}

/** Daftar backup yang tersimpan di folder. */
function backupStatus_(params, ctx) {
  var folder = backupFolder_();
  var keep = Number(PropertiesService.getScriptProperties().getProperty('BACKUP_KEEP')
    || DEFAULT_BACKUP_KEEP);

  var files = [];
  var it = folder.getFiles();
  while (it.hasNext()) files.push(it.next());
  files.sort(function (a, b) { return b.getDateCreated().getTime() - a.getDateCreated().getTime(); });

  return {
    folder: folder.getName(),
    folderUrl: folder.getUrl(),
    keep: keep,
    total: files.length,
    items: files.slice(0, 50).map(function (f) {
      return {
        name: f.getName(),
        created: Utilities.formatDate(f.getDateCreated(), TZ_, 'yyyy-MM-dd HH:mm:ss'),
        sizeBytes: f.getSize(),
        url: f.getUrl()
      };
    })
  };
}

/* =========================================================
   ERROR LOG
   ========================================================= */

/**
 * Catat error tak terduga ke sheet error_log.
 * - Error yang wajar (validasi, auth) tidak dicatat agar log tetap berguna.
 * - Token/password TIDAK pernah disimpan.
 * - Tidak boleh menggagalkan request (selalu dibungkus try).
 */
function logError_(err, e) {
  try {
    var code = (err && err.code) ? String(err.code) : 'INTERNAL';
    console.error('[GudangTitipan]', (err && err.stack) || err, e && e.postData && e.postData.contents);

    if (BENIGN_CODES_.indexOf(code) !== -1) return;

    var req = null;
    try {
      req = e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : null;
    } catch (ignore) { req = null; }

    appendRow_('error_log', {
      id: newId_(),
      timestamp: nowStamp_(),
      code: code,
      message: (err && err.message) ? String(err.message).slice(0, 500) : 'Tanpa pesan',
      stack: (err && err.stack) ? String(err.stack).slice(0, 1500) : '',
      request: JSON.stringify(safeRequest_(req)).slice(0, 800)
    });

    pruneErrorLog_();
  } catch (ignore) {
    // logging tidak boleh menggagalkan request
  }
}

/** Ringkasan request tanpa data sensitif. */
function safeRequest_(req) {
  if (!req) return { action: null };
  var params = req.params || {};
  var safe = {
    action: req.action || null,
    hasToken: Boolean(req.token),
    requestId: req.requestId ? 'ada' : null,
    paramKeys: Object.keys(params).sort()
  };
  if (params.username) safe.username = params.username;
  if (params.entity) safe.entity = params.entity;
  if (params.no) safe.no = params.no;
  if (params.sjNo) safe.sjNo = params.sjNo;
  return safe;
}

/** Jaga error_log tetap ramping: sisakan ERROR_LOG_MAX baris terbaru. */
function pruneErrorLog_() {
  try {
    var sh = sheet_('error_log');
    var last = sh.getLastRow();
    if (last - 1 <= ERROR_LOG_MAX) return 0;
    var excess = (last - 1) - ERROR_LOG_MAX;
    sh.deleteRows(2, excess);
    return excess;
  } catch (ignore) {
    return 0;
  }
}

/** Daftar error untuk ADMIN. */
function errorList_(params, ctx) {
  var rows = readTable_('error_log');
  rows.reverse(); // terbaru lebih dulu

  var q = String(params.q || '').trim().toLowerCase();
  if (q) {
    rows = rows.filter(function (r) {
      return ['code', 'message', 'request', 'timestamp'].some(function (k) {
        return String(r[k] || '').toLowerCase().indexOf(q) !== -1;
      });
    });
  }

  var page = Math.max(1, parseInt(params.page, 10) || 1);
  var pageSize = Math.min(200, Math.max(1, parseInt(params.pageSize, 10) || 50));
  var total = rows.length;
  var start = (page - 1) * pageSize;

  return {
    items: rows.slice(start, start + pageSize),
    page: page,
    pageSize: pageSize,
    total: total,
    totalPages: Math.ceil(total / pageSize) || 1
  };
}
