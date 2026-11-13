/**
 * Util.gs — Utilitas umum: tanggal, penomoran (counter), validasi, escape.
 * Semua tanggal memakai zona waktu Asia/Jakarta (lihat appsscript.json).
 * Implementasi lengkap masuk Fase 0–2.
 */

var TZ_ = 'Asia/Jakarta';

/** Waktu server dalam format ISO dengan offset zona Jakarta. */
function nowIso_() {
  return Utilities.formatDate(new Date(), TZ_, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

/** Tanggal hari ini (YYYY-MM-DD) menurut zona Jakarta. */
function todayStr_() {
  return Utilities.formatDate(new Date(), TZ_, 'yyyy-MM-dd');
}

/** Timestamp penuh untuk kolom audit. */
function nowStamp_() {
  return Utilities.formatDate(new Date(), TZ_, 'yyyy-MM-dd HH:mm:ss');
}

/**
 * Validasi format tanggal YYYY-MM-DD **dan** kewajarannya.
 * Pola saja tidak cukup: "2026-13-99" lolos regex tapi bukan tanggal.
 */
function assertDate_(value, field) {
  var s = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw apiError_('VALIDATION_ERROR', 'Format tanggal harus YYYY-MM-DD.', field || 'date');
  }

  var y = parseInt(s.slice(0, 4), 10);
  var m = parseInt(s.slice(5, 7), 10);
  var d = parseInt(s.slice(8, 10), 10);
  var probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    throw apiError_('VALIDATION_ERROR', 'Tanggal tidak valid: ' + s + '.', field || 'date');
  }
  if (y < 2000 || y > 2100) {
    throw apiError_('VALIDATION_ERROR', 'Tahun di luar rentang wajar (2000-2100): ' + s + '.', field || 'date');
  }
  return s;
}

/** Validasi integer positif (>= min). */
function assertPositiveInt_(value, field, min) {
  var n = parseInt(value, 10);
  if (!isFinite(n) || String(n) !== String(value).trim() || n < (min || 1)) {
    throw apiError_('VALIDATION_ERROR', 'Nilai harus bilangan bulat minimal ' + (min || 1) + '.', field);
  }
  return n;
}

/** Wajib diisi. */
function assertRequired_(value, field, label) {
  if (value === null || value === undefined || String(value).trim() === '') {
    throw apiError_('VALIDATION_ERROR', (label || field) + ' wajib diisi.', field);
  }
  return value;
}

/* =========================================================
   NORMALISASI SEL TANGGAL
   Google Sheets mengubah string "2026-11-11" / "2026-11-11 08:30:00"
   menjadi objek Date. Bila dikirim apa adanya ke frontend, JSON-nya
   menjadi "2026-11-11T01:00:00.000Z" (UTC) sehingga tanggal bisa
   bergeser sehari dan perbandingan teks (mis. masa berlaku sesi) rusak.
   Semua tanggal dinormalisasi ke format kanonik aplikasi.
   ========================================================= */

/** Sel tanggal -> 'YYYY-MM-DD' (string kosong bila sel kosong). */
function cellDate_(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, TZ_, 'yyyy-MM-dd');
  }
  var s = String(v).trim();
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  var d = new Date(s);
  return isNaN(d.getTime()) ? s : Utilities.formatDate(d, TZ_, 'yyyy-MM-dd');
}

/** Sel timestamp -> 'YYYY-MM-DD HH:mm:ss' (string kosong bila sel kosong). */
function cellStamp_(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, TZ_, 'yyyy-MM-dd HH:mm:ss');
  }
  var s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return s;
  var d = new Date(s);
  return isNaN(d.getTime()) ? s : Utilities.formatDate(d, TZ_, 'yyyy-MM-dd HH:mm:ss');
}

/** Ambil nilai berikutnya dari tabel counter (key -> value) secara atomik. */
function nextCounter_(key) {
  var current = Number(getCounter_(key) || 0) + 1;
  setCounter_(key, current);
  return current;
}

/** Nomor urut berformat padding, mis. SJ/2026/0008. */
function formatSeq_(prefix, n, pad) {
  var s = String(n);
  while (s.length < (pad || 3)) s = '0' + s;
  return prefix + s;
}

/** Bungkus operasi tulis dengan script lock (PRD 8.1). */
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    throw apiError_('LOCK_TIMEOUT', 'Server sedang sibuk, coba lagi sebentar lagi.');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}
