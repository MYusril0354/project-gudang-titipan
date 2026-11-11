/**
 * Auth.gs — Login, hash password (SHA-256 + salt), sesi, pemeriksaan peran.
 * Implementasi lengkap masuk Fase 1.
 */

/** Masa berlaku token sesi (jam) — PRD bagian 9. */
var SESSION_TTL_HOURS = 12;

/** Maksimum percobaan login gagal sebelum dikunci. */
var MAX_FAILED_LOGIN = 5;

/** Lama kunci akun (menit). */
var LOCK_MINUTES = 10;

/** Peran yang dikenal. */
var ROLES = { ADMIN: 'ADMIN', GUDANG: 'GUDANG', VIEWER: 'VIEWER' };

/**
 * Muat sesi dari token dan periksa peran.
 * @param {string} token
 * @param {string[]} allowedRoles null = semua peran
 * @return {{userId:string, username:string, role:string}}
 */
function requireSession_(token, allowedRoles) {
  if (!token) throw apiError_('UNAUTHENTICATED', 'Token tidak ditemukan, silakan login.');

  // Fase 1: baca sheet `sessions`, cek expires_at, muat user, cek aktif.
  var ctx = loadSession_(token);
  if (!ctx) throw apiError_('UNAUTHENTICATED', 'Sesi tidak valid atau sudah kedaluwarsa.');

  if (allowedRoles && allowedRoles.indexOf(ctx.role) === -1) {
    throw apiError_('FORBIDDEN', 'Peran Anda tidak berhak melakukan aksi ini.');
  }
  return ctx;
}

/** Login: username + password -> token, profil, peran (PRD 9). */
function authLogin_(params, ctx) {
  assertRequired_(params.username, 'username', 'Username');
  assertRequired_(params.password, 'password', 'Password');
  // Fase 1: cocokkan hash, buat token UUID, simpan ke sheet `sessions`.
  throw apiError_('INTERNAL', 'auth.login belum diimplementasikan (Fase 1).');
}

/** Hapus sesi aktif. */
function authLogout_(params, ctx) {
  // Fase 1
  return { loggedOut: true };
}

/** Profil sesi aktif. */
function authMe_(params, ctx) {
  return ctx ? { username: ctx.username, role: ctx.role, userId: ctx.userId } : null;
}

/** Fase 1: implementasi pembacaan sesi + user. */
function loadSession_(token) {
  return null;
}

/** Fase 1: hash password SHA-256 + salt. */
function hashPassword_(password, salt) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + password, Utilities.Charset.UTF_8);
  return raw.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

/** Fase 1: buat salt acak. */
function makeSalt_() {
  return Utilities.getUuid().replace(/-/g, '');
}

/** Fase 1: catat aksi tulis ke audit_log. */
function audit_(ctx, action, entity, entityId, detail) {
  // Fase 1
  return true;
}

/** Idempotency key: kembalikan hasil sebelumnya untuk requestId yang sama (PRD 11.1). */
function idempotent_(requestId, fn) {
  if (!requestId) return fn();
  // Fase 3: CacheService dengan TTL, kunci = 'idem:' + requestId.
  return fn();
}
