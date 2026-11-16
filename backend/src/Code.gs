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

  /* --- self-test & hardening (ADMIN) --- */
  'system.selfTest': { fn: systemSelfTest_, roles: [ROLES.ADMIN], write: true },
  'system.hardening': { fn: systemHardening_, roles: [ROLES.ADMIN], write: true },
  'system.migrate': { fn: systemMigrate_, roles: [ROLES.ADMIN], write: true },
  'system.backupDatabase': { fn: backupDatabase_, roles: [ROLES.ADMIN], write: true },
  'system.backupStatus': { fn: backupStatus_, roles: [ROLES.ADMIN], write: false },
  'error.list': { fn: errorList_, roles: [ROLES.ADMIN], write: false },

  /* --- master data: baca semua, tulis ADMIN --- */
  'master.list': { fn: masterList_, roles: null, write: false },
  'master.listAll': { fn: masterListAll_, roles: null, write: false },
  'master.create': { fn: masterCreate_, roles: [ROLES.ADMIN], write: true },
  'master.update': { fn: masterUpdate_, roles: [ROLES.ADMIN], write: true },
  'master.delete': { fn: masterDelete_, roles: [ROLES.ADMIN], write: true },
  'master.import': { fn: masterImport_, roles: [ROLES.ADMIN], write: true },

  /* --- surat jalan & penerimaan --- */
  'sj.list': { fn: sjList_, roles: null, write: false },
  'sj.get': { fn: sjGet_, roles: null, write: false },
  'sj.nextNumber': { fn: sjNextNumber_, roles: [ROLES.ADMIN, ROLES.GUDANG], write: false },
  'sj.create': { fn: sjCreate_, roles: [ROLES.ADMIN, ROLES.GUDANG], write: true },
  'sj.line.suggestBatch': { fn: sjLineSuggestBatch_, roles: [ROLES.ADMIN, ROLES.GUDANG], write: false },
  'sj.line.receive': { fn: sjLineReceive_, roles: [ROLES.ADMIN, ROLES.GUDANG], write: true },
  'sj.receiveAll': { fn: sjReceiveAll_, roles: [ROLES.ADMIN, ROLES.GUDANG], write: true },
  'sj.line.wait': { fn: sjLineWait_, roles: [ROLES.ADMIN, ROLES.GUDANG], write: true },
  'sj.line.cancel': { fn: sjLineCancel_, roles: [ROLES.ADMIN, ROLES.GUDANG], write: true },
  'sj.import': { fn: sjImport_, roles: [ROLES.ADMIN, ROLES.GUDANG], write: true },
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
   CACHE BACA (optimasi kinerja P2)
   ---------------------------------------------------------
   Hanya untuk respons yang TIDAK memuat data pribadi pengguna (aman dipakai
   bersama). Kunci cache memuat "versi data" yang dinaikkan setiap aksi tulis,
   jadi hasil baca tidak pernah basi setelah simpan/hapus.
   ========================================================= */

/** Aksi baca yang boleh memakai cache bersama: action -> umur (detik). */
var READ_CACHE_TTL_ = {
  'master.list': 120,
  'master.listAll': 120,
  'dashboard.summary': 30,
  'stock.list': 30,
  'pending.list': 30,
  'sj.list': 30,
  'sj.get': 30,
  'shipment.list': 30,
  'ledger.kartuStock': 30,
  'report.reconciliation': 60
};

/** Jalankan aksi baca lewat cache bila action-nya terdaftar. */
function readCached_(action, params, compute) {
  var ttl = READ_CACHE_TTL_[String(action)];
  if (!ttl) return compute();

  var key;
  try {
    key = action + '|' + JSON.stringify(params || {});
  } catch (ignore) {
    return compute(); // parameter tidak bisa diserialisasi -> lewati cache
  }
  return cachedRead_(key, ttl, compute);
}

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
  AUDIT_BUFFER_ = []; // state global tidak boleh terbawa dari request sebelumnya
  try {
    var req = parseRequest_(e);
    var handler = ROUTES[req.action];
    if (!handler) throw apiError_('NOT_FOUND', 'Action tidak dikenal: ' + req.action);

    // Kunci go-live: endpoint sensitif dimatikan lebih dulu, sebelum sesi/DB.
    assertNotLocked_(req.action);

    var ctx = handler.public ? null : requireSession_(req.token, handler.roles);
    var params = req.params || {};

    var data;
    if (handler.write) {
      data = withLock_(function () {
        try {
          var result = idempotent_(req.requestId, function () { return handler.fn(params, ctx); });
          // Versi data naik -> seluruh cache baca lama tidak terpakai lagi.
          bumpDataVersion_();
          return result;
        } finally {
          // Audit ditulis sekali per request, di dalam lock (anti baris bertabrakan).
          flushAudit_();
        }
      });
    } else {
      data = readCached_(req.action, params, function () { return handler.fn(params, ctx); });
    }

    res = { ok: true, data: data, meta: { serverTime: nowIso_() } };
  } catch (err) {
    res = { ok: false, error: toErrorPayload_(err) };
    logError_(err, e);
  } finally {
    // Sisa audit (aksi baca, atau error sebelum lock) tetap diselamatkan.
    flushAudit_();
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
