/**
 * Auth.gs — Login, hash password (SHA-256 + salt), sesi, pemeriksaan peran.
 *
 * Aturan (PRD bagian 9):
 *  - Password tidak pernah disimpan polos; simpan `password_hash` + `salt`.
 *  - Token sesi acak (UUID) dengan masa berlaku (default 12 jam) di sheet `sessions`.
 *  - Batasi percobaan login gagal (5x -> kunci 10 menit).
 *  - Setiap aksi tulis dicatat di `audit_log`.
 */

/** Masa berlaku token sesi (jam) — PRD bagian 9. */
var SESSION_TTL_HOURS = 12;

/** Maksimum percobaan login gagal sebelum dikunci. */
var MAX_FAILED_LOGIN = 5;

/** Lama kunci akun (menit). */
var LOCK_MINUTES = 10;

/** Peran yang dikenal. */
var ROLES = { ADMIN: 'ADMIN', GUDANG: 'GUDANG', VIEWER: 'VIEWER' };

/* =========================================================
   SESI
   ========================================================= */

/**
 * Muat sesi dari token dan periksa peran.
 * @param {string} token
 * @param {string[]} allowedRoles null = semua peran
 * @return {{userId:string, username:string, role:string, nama:string, token:string}}
 */
function requireSession_(token, allowedRoles) {
  if (!token) throw apiError_('UNAUTHENTICATED', 'Token tidak ditemukan, silakan login.');

  var ctx = loadSession_(token);
  if (!ctx) throw apiError_('UNAUTHENTICATED', 'Sesi tidak valid atau sudah kedaluwarsa.');

  if (allowedRoles && allowedRoles.indexOf(ctx.role) === -1) {
    throw apiError_('FORBIDDEN', 'Peran Anda tidak berhak melakukan aksi ini.');
  }
  return ctx;
}

/**
 * Baca token dari sheet `sessions`, cek kedaluwarsa, lalu muat usernya.
 * @returns {Object|null}
 */
function loadSession_(token) {
  var sessions = readTableWhere_('sessions', { token: token });
  if (!sessions.length) return null;

  var session = sessions[0];
  var now = nowStamp_();
  if (String(session.expires_at) <= now) {
    deleteById_('sessions', token); // bersihkan sesi kedaluwarsa
    return null;
  }

  var users = readTableWhere_('users', { id: session.user_id });
  if (!users.length) return null;

  var user = users[0];
  if (!isTrue_(user.aktif)) return null;

  return {
    userId: user.id,
    username: user.username,
    role: user.role,
    nama: user.nama,
    token: token
  };
}

/** Buat token sesi baru dan simpan. */
function createSession_(userId) {
  var token = Utilities.getUuid().replace(/-/g, '');
  var expires = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000);
  appendRow_('sessions', {
    token: token,
    user_id: userId,
    expires_at: Utilities.formatDate(expires, TZ_, 'yyyy-MM-dd HH:mm:ss'),
    created_at: nowStamp_()
  });
  return token;
}

/* =========================================================
   ACTION
   ========================================================= */

/**
 * Login: username + password -> token, profil, peran (PRD 9).
 * @param {Object} params { username, password }
 */
function authLogin_(params) {
  var username = String(params.username || '').trim();
  var password = String(params.password || '');
  if (!username) throw apiError_('VALIDATION_ERROR', 'Username wajib diisi.', 'username');
  if (!password) throw apiError_('VALIDATION_ERROR', 'Password wajib diisi.', 'password');

  var found = readTableWhere_('users', { username: username });
  if (!found.length) {
    // Pesan sama untuk user tidak ada vs password salah (hindari user enumeration).
    throw apiError_('UNAUTHENTICATED', 'Username atau password salah.');
  }

  var user = found[0];
  if (!isTrue_(user.aktif)) {
    throw apiError_('FORBIDDEN', 'Akun Anda tidak aktif. Hubungi Administrator.');
  }

  // Akun sedang dikunci?
  var now = nowStamp_();
  if (user.locked_until && String(user.locked_until) > now) {
    throw apiError_('FORBIDDEN', 'Akun terkunci sementara karena terlalu banyak percobaan gagal. Coba lagi beberapa menit lagi.');
  }

  var expected = hashPassword_(password, user.salt);
  if (String(expected) !== String(user.password_hash)) {
    var fails = Number(user.failed_count || 0) + 1;
    var patch = { failed_count: fails };
    if (fails >= MAX_FAILED_LOGIN) {
      var until = new Date(Date.now() + LOCK_MINUTES * 60 * 1000);
      patch.locked_until = Utilities.formatDate(until, TZ_, 'yyyy-MM-dd HH:mm:ss');
      patch.failed_count = 0;
    }
    updateById_('users', user.id, patch);
    auditRaw_(username, 'auth.login.failed', 'user', user.id, 'Percobaan login gagal (' + fails + ')');
    throw apiError_('UNAUTHENTICATED', 'Username atau password salah.');
  }

  // Berhasil: reset penghitung gagal, buat sesi.
  if (Number(user.failed_count || 0) > 0 || user.locked_until) {
    updateById_('users', user.id, { failed_count: 0, locked_until: '' });
  }

  var token = createSession_(user.id);
  auditRaw_(username, 'auth.login', 'user', user.id, 'Login berhasil');

  return {
    token: token,
    expiresInHours: SESSION_TTL_HOURS,
    user: {
      id: user.id,
      username: user.username,
      nama: user.nama,
      role: user.role
    }
  };
}

/** Hapus sesi aktif. */
function authLogout_(params, ctx) {
  if (ctx && ctx.token) {
    deleteById_('sessions', ctx.token);
    audit_(ctx, 'auth.logout', 'user', ctx.userId, 'Logout');
  }
  return { loggedOut: true };
}

/** Profil sesi aktif. */
function authMe_(params, ctx) {
  if (!ctx) return null;
  return { userId: ctx.userId, username: ctx.username, nama: ctx.nama, role: ctx.role };
}

/* =========================================================
   PASSWORD
   ========================================================= */

/** Hash password SHA-256 atas (salt + password), hex. */
function hashPassword_(password, salt) {
  var raw = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(salt) + String(password),
    Utilities.Charset.UTF_8
  );
  return raw.map(function (b) {
    var v = (b & 0xFF).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

/** Salt acak. */
function makeSalt_() {
  return Utilities.getUuid().replace(/-/g, '');
}

/* =========================================================
   AUDIT
   ========================================================= */

/** Catat aksi tulis ke audit_log. */
function audit_(ctx, action, entity, entityId, detail) {
  auditRaw_(ctx ? ctx.username : 'system', action, entity, entityId, detail);
  return true;
}

/** Versi audit tanpa ctx (dipakai sebelum sesi terbentuk, mis. login). */
function auditRaw_(username, action, entity, entityId, detail) {
  try {
    appendRow_('audit_log', {
      id: newId_(),
      timestamp: nowStamp_(),
      user: username || 'system',
      action: action,
      entity: entity || '',
      entity_id: entityId || '',
      detail: typeof detail === 'string' ? detail : JSON.stringify(detail || '')
    });
  } catch (ignore) { /* audit tidak boleh menggagalkan aksi utama */ }
  return true;
}

/* =========================================================
   IDEMPOTENCY
   ========================================================= */

/**
 * Idempotency key (PRD 11.1): hasil aksi tulis yang sama dikembalikan ulang
 * bila requestId yang sama dikirim lagi (klik ganda / retry).
 */
function idempotent_(requestId, fn) {
  if (!requestId) return fn();

  var cache = CacheService.getScriptCache();
  var key = 'idem_' + String(requestId).slice(0, 200);
  var cached = cache.get(key);
  if (cached) {
    try {
      var parsed = JSON.parse(cached);
      if (parsed && parsed.cached) return parsed.data;
    } catch (ignore) { /* cache rusak -> proses ulang */ }
  }

  var result = fn();
  try {
    cache.put(key, JSON.stringify({ cached: true, data: result }), 21600); // maks 6 jam
  } catch (ignore) { /* hasil tetap dikembalikan walau cache gagal */ }
  return result;
}

/* =========================================================
   UTIL KECIL
   ========================================================= */

/** Normalisasi nilai boolean dari sheet ("TRUE"/true/1). */
function isTrue_(v) {
  if (v === true) return true;
  var s = String(v === null || v === undefined ? '' : v).trim().toUpperCase();
  return s === 'TRUE' || s === '1' || s === 'YA' || s === 'YES';
}
