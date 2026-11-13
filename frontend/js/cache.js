/**
 * cache.js — Cache respons di browser untuk navigasi instan (Fase 5+).
 *
 * Cara kerja (stale-while-revalidate):
 *  1. Panggilan baca mengembalikan salinan cache SEKETIKA (tanpa skeleton).
 *  2. Di belakang, data segar diambil dari server dan cache diperbarui.
 *  3. Bila isinya berbeda, event `app:data-fresh` dikirim supaya halaman
 *     dirender ulang dengan data baru.
 *
 * Keamanan & kebenaran:
 *  - Cache dipisah per pengguna; berganti pengguna -> cache dibuang.
 *  - Setiap aksi TULIS membuang seluruh cache (server tetap sumber kebenaran).
 *  - Aksi yang butuh data pasti (mis. batch tersedia untuk form pengiriman)
 *    boleh memakai `{ fresh: true }` agar tidak memakai cache.
 */

const VERSION = 'v1';
const STORAGE_KEY = 'gt_cache_' + VERSION;
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MAX_BYTES = 2000000;

/** Ruang cache milik pengguna aktif. */
let scope = 'anon';
/** Salinan di memori (dimuat sekali dari localStorage). */
let mem = null;
/** Jumlah penyegaran latar yang sedang berjalan. */
let pendingRefresh = 0;

/* =========================================================
   MUAT / SIMPAN
   ========================================================= */

function loadStore() {
  if (mem) return mem;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    mem = raw ? JSON.parse(raw) : {};
    if (!mem || typeof mem !== 'object') mem = {};
  } catch (ignore) {
    mem = {};
  }
  return mem;
}

function saveStore() {
  try {
    pruneIfNeeded();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(loadStore()));
  } catch (ignore) {
    // localStorage penuh / diblokir: cache bersifat opsional
  }
}

/** Buang entri tertua bila melebihi batas ukuran. */
function pruneIfNeeded() {
  const store = loadStore();
  let raw = JSON.stringify(store);
  if (raw.length <= MAX_BYTES) return;

  const entries = [];
  for (const s of Object.keys(store)) {
    for (const k of Object.keys(store[s] || {})) {
      entries.push({ s, k, t: (store[s][k] && store[s][k].t) || 0 });
    }
  }
  entries.sort((a, b) => a.t - b.t);

  for (const e of entries) {
    if (raw.length <= MAX_BYTES) break;
    delete store[e.s][e.k];
    raw = JSON.stringify(store);
  }
}

/* =========================================================
   CAKUPAN PENGGUNA
   ========================================================= */

/** Set pengguna aktif. Berganti pengguna -> cache dibuang seluruhnya. */
export function setCacheScope(userId) {
  const next = userId ? String(userId) : 'anon';
  if (next === scope) return;
  scope = next;
  clearAll();
}

/* =========================================================
   BACA / TULIS CACHE
   ========================================================= */

function entryKey(action, params) {
  let p = '';
  try { p = JSON.stringify(params || {}); } catch (ignore) { p = ''; }
  return action + '|' + p;
}

/**
 * Baca salinan cache beserta umurnya.
 * @param {string} action
 * @param {object} params
 * @param {{ignoreTtl?: boolean}} [opts]
 * @returns {{data: any, ageMs: number}|null}
 */
export function cacheRead(action, params, opts) {
  const store = loadStore();
  const bucket = store[scope];
  if (!bucket) return null;

  const entry = bucket[entryKey(action, params)];
  if (!entry) return null;

  const ageMs = Date.now() - (entry.t || 0);
  if (ageMs >= DEFAULT_TTL_MS && !(opts && opts.ignoreTtl)) return null;
  return { data: entry.d, ageMs: ageMs };
}

/**
 * Simpan salinan cache.
 * @returns {boolean} true bila isinya berbeda dari yang tersimpan
 */
export function cacheSet(action, params, data) {
  const store = loadStore();
  if (!store[scope]) store[scope] = {};

  const key = entryKey(action, params);
  const prev = store[scope][key];
  let changed = true;
  try {
    changed = !prev || JSON.stringify(prev.d) !== JSON.stringify(data);
  } catch (ignore) {
    changed = true;
  }

  store[scope][key] = { t: Date.now(), d: data };
  saveStore();
  return changed;
}

/** Buang cache pengguna aktif. */
export function clearAll() {
  const store = loadStore();
  delete store[scope];
  saveStore();
}

/** Buang seluruh cache (semua pengguna) — dipakai saat logout. */
export function clearEverything() {
  mem = {};
  try { localStorage.removeItem(STORAGE_KEY); } catch (ignore) { /* opsional */ }
}

/* =========================================================
   INDIKATOR SINKRONISASI
   ========================================================= */

function emitSync() {
  window.dispatchEvent(new CustomEvent('app:sync', { detail: { pending: pendingRefresh } }));
}

/** Tandai mulai/selesai penyegaran latar. */
export function markRefresh(delta) {
  pendingRefresh = Math.max(0, pendingRefresh + delta);
  emitSync();
}
