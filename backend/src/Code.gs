/**
 * Code.gs — Entry point Web App Gudang Titipan.
 *
 * Kontrak (PRD bagian 8 & 11):
 *  - Satu endpoint POST /exec, routing lewat field `action`.
 *  - Semua balasan HTTP 200; hasil nyata ada di envelope `ok` / `error`.
 *  - Frontend mengirim Content-Type: text/plain agar tidak memicu preflight CORS.
 *
 * FASE 0: kerangka saja. Handler diisi pada fase berikutnya.
 */

/** Versi API — dinaikkan saat kontrak berubah. */
var API_VERSION = '0.1.0';

/**
 * Tabel routing: action -> { fn, public, roles, write }.
 * `public`  : boleh diakses tanpa token.
 * `roles`   : daftar peran yang diizinkan (null = semua peran).
 * `write`   : true = dibungkus lock + idempotency.
 */
var ROUTES = {
  /* --- publik --- */
  'system.health': { fn: function () { return healthPayload_(); }, public: true, write: false },
  'system.setup': { fn: systemSetup_, public: true, write: true },
  'auth.login': { fn: authLogin_, public: true, write: true },

  /* --- semua peran --- */
  'auth.logout': { fn: authLogout_, roles: null, write: true },
  'auth.me': { fn: authMe_, roles: null, write: false },
  'system.bootstrap': { fn: systemBootstrap_, roles: null, write: false },
  'dashboard.summary': { fn: dashboardSummary_, roles: null, write: false },

  /* --- self-test (ADMIN) --- */
  'system.selfTest': { fn: systemSelfTest_, roles: [ROLES.ADMIN], write: true },

  /* --- master data: baca semua, tulis ADMIN --- */
  'master.list': { fn: masterList_, roles: null, write: false },
  'master.create': { fn: masterCreate_, roles: [ROLES.ADMIN], write: true },
  'master.update': { fn: masterUpdate_, roles: [ROLES.ADMIN], write: true },
  'master.delete': { fn: masterDelete_, roles: [ROLES.ADMIN], write: true },

  /* --- surat jalan & penerimaan --- */
  'sj.list': { fn: sjList_, roles: null, write: false },
  'sj.get': { fn: sjGet_, roles: null, write: false },
  'sj.nextNumber': { fn: sjNextNumber_, roles: [ROLES.ADMIN, ROLES.GUDANG], write: false },
  'sj.create': { fn: sjCreate_, roles: [ROLES.ADMIN, ROLES.GUDANG], write: true },
  'sj.line.suggestBatch': { fn: sjLineSuggestBatch_, roles: [ROLES.ADMIN, ROLES.GUDANG], write: false },
  'sj.line.receive': { fn: sjLineReceive_, roles: [ROLES.ADMIN, ROLES.GUDANG], write: true },
  'sj.line.wait': { fn: sjLineWait_, roles: [ROLES.ADMIN, ROLES.GUDANG], write: true },
  'sj.line.cancel': { fn: sjLineCancel_, roles: [ROLES.ADMIN, ROLES.GUDANG], write: true },
  'pending.list': { fn: pendingList_, roles: null, write: false },

  /* --- stok --- */
  'stock.list': { fn: stockList_, roles: null, write: false },
  'stock.available': { fn: stockAvailable_, roles: [ROLES.ADMIN, ROLES.GUDANG], write: false },

  /* --- pengiriman --- */
  'shipment.list': { fn: shipmentList_, roles: null, write: false },
  'shipment.get': { fn: shipmentGet_, roles: null, write: false },
  'shipment.create': { fn: shipmentCreate_, roles: [ROLES.ADMIN, ROLES.GUDANG], write: true },
  'shipment.markDelivered': { fn: shipmentMarkDelivered_, roles: [ROLES.ADMIN, ROLES.GUDANG], write: true },
  'shipment.printData': { fn: shipmentPrintData_, roles: [ROLES.ADMIN, ROLES.GUDANG], write: true },
  'shipment.void': { fn: shipmentVoid_, roles: [ROLES.ADMIN], write: true },

  /* --- laporan --- */
  'ledger.kartuStock': { fn: ledgerKartuStock_, roles: null, write: false },
  'report.reconciliation': { fn: reportReconciliation_, roles: null, write: false },

  /* --- admin --- */
  'user.list': { fn: userList_, roles: [ROLES.ADMIN], write: false },
  'user.create': { fn: userCreate_, roles: [ROLES.ADMIN], write: true },
  'user.update': { fn: userUpdate_, roles: [ROLES.ADMIN], write: true },
  'user.resetPassword': { fn: userResetPassword_, roles: [ROLES.ADMIN], write: true },
  'audit.list': { fn: auditList_, roles: [ROLES.ADMIN], write: false }
};

/* =========================================================
   ENTRY POINT
   ========================================================= */

/** Health check sederhana (GET). */
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'system.health';
  if (action !== 'system.health') {
    return jsonOut_({ ok: false, error: { code: 'NOT_FOUND', message: 'Gunakan POST untuk action selain system.health.' } });
  }
  return jsonOut_({ ok: true, data: healthPayload_(), meta: { serverTime: nowIso_() } });
}

/** Router utama untuk semua action. */
function doPost(e) {
  var res;
  try {
    var req = parseRequest_(e);
    var handler = ROUTES[req.action];
    if (!handler) throw apiError_('NOT_FOUND', 'Action tidak dikenal: ' + req.action);

    var ctx = handler.public ? null : requireSession_(req.token, handler.roles);
    var params = req.params || {};

    var data = handler.write
      ? withLock_(function () {
          return idempotent_(req.requestId, function () { return handler.fn(params, ctx); });
        })
      : handler.fn(params, ctx);

    res = { ok: true, data: data, meta: { serverTime: nowIso_() } };
  } catch (err) {
    res = { ok: false, error: toErrorPayload_(err) };
    logError_(err, e);
  }
  return jsonOut_(res);
}

/* =========================================================
   HELPER INTERNAL
   ========================================================= */

function parseRequest_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    throw apiError_('VALIDATION_ERROR', 'Body request kosong.');
  }
  var req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (parseErr) {
    throw apiError_('VALIDATION_ERROR', 'Body bukan JSON yang valid.');
  }
  if (!req.action) throw apiError_('VALIDATION_ERROR', 'Field `action` wajib diisi.', 'action');
  return req;
}

function healthPayload_() {
  return { ok: true, version: API_VERSION, time: nowIso_(), timeZone: Session.getScriptTimeZone() };
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Bangun Error dengan kode terstruktur (dipakai toErrorPayload_). */
function apiError_(code, message, field) {
  var err = new Error(message);
  err.code = code;
  err.field = field || null;
  return err;
}

function toErrorPayload_(err) {
  return {
    code: err && err.code ? err.code : 'INTERNAL',
    message: err && err.message ? err.message : 'Terjadi kesalahan pada server.',
    field: (err && err.field) || null
  };
}

/** Catat error ke sheet error_log (Fase 5 melengkapi ini). */
function logError_(err, e) {
  try {
    console.error('[GudangTitipan]', (err && err.stack) || err, e && e.postData && e.postData.contents);
  } catch (ignore) { /* logging tidak boleh menggagalkan request */ }
}
