/**
 * api.js — Klien API Gudang Titipan.
 *
 * Aturan CORS GAS yang WAJIB dipatuhi (PRD 8.1 & 12.2):
 *  - Content-Type: text/plain;charset=utf-8  (isi body tetap JSON)
 *  - TIDAK memakai header kustom (Authorization / X-Token) -> token di body
 *  - Selalu POST, termasuk untuk baca
 *  - Status HTTP selalu 200; hasil nyata ada di field `ok`
 */

import { CONFIG } from './config.js';
import { cacheRead, cacheSet, clearAll, markRefresh } from './cache.js';

const TOKEN_KEY = 'gt_token';

/**
 * Salinan cache yang lebih muda dari ini tidak perlu disegarkan lagi.
 * Tanpa ambang ini, "render ulang karena data segar" bisa memicu muat ulang
 * yang memicu penyegaran lagi (loop).
 */
const MIN_REFRESH_AGE_MS = 3000;

/** Kunci yang sedang disegarkan — cegah penyegaran ganda untuk data yang sama. */
const inFlight = new Set();

/** Ambil token sesi dari sessionStorage. */
export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}

/** Simpan token sesi. */
export function setToken(token) {
  sessionStorage.setItem(TOKEN_KEY, token);
}

/** Hapus sesi lokal. */
export function clearSession() {
  sessionStorage.removeItem(TOKEN_KEY);
}

/**
 * Kode error yang menandakan sesi tidak valid lagi.
 * @type {string[]}
 */
const AUTH_ERRORS = ['UNAUTHENTICATED'];

/**
 * Panggil satu action API.
 *
 * Untuk aksi BACA, salinan cache dikembalikan seketika lalu disegarkan di
 * belakang (stale-while-revalidate) sehingga pindah halaman terasa instan.
 * Aksi TULIS selalu ke server dan membuang seluruh cache.
 *
 * @param {string} action  mis. 'sj.create'
 * @param {object} [params]
 * @param {{write?: boolean, timeoutMs?: number, fresh?: boolean}} [opts]
 *   write=true memicu requestId (idempotency key);
 *   fresh=true memaksa ambil dari server (dipakai form yang butuh data pasti)
 * @returns {Promise<any>} isi field `data` pada envelope sukses
 * @throws {Error & {code: string, field?: string}} error terstruktur dari server
 */
export async function api(action, params = {}, opts = {}) {
  const cacheable = !opts.write && !opts.fresh
    && !String(action).startsWith('auth.')
    && action !== 'system.health';

  if (cacheable) {
    const hit = cacheRead(action, params);
    if (hit) {
      // Hanya segarkan bila salinan sudah cukup tua (lihat MIN_REFRESH_AGE_MS).
      if (hit.ageMs >= MIN_REFRESH_AGE_MS) refreshInBackground(action, params, opts);
      return hit.data;
    }
  }

  try {
    const data = await request(action, params, opts);
    if (opts.write) clearAll();          // data transaksi berubah -> buang cache
    else if (cacheable) cacheSet(action, params, data);
    return data;
  } catch (err) {
    // Jaringan gagal tapi ada salinan lama -> tetap tampilkan (mode luring ringan)
    if (cacheable && err.code === 'NETWORK') {
      const stale = cacheRead(action, params, { ignoreTtl: true });
      if (stale) return stale.data;
    }
    throw err;
  }
}

/** Ambil data segar di belakang lalu umumkan bila isinya berubah. */
function refreshInBackground(action, params, opts) {
  const key = action + '|' + JSON.stringify(params || {});
  if (inFlight.has(key)) return;
  inFlight.add(key);
  markRefresh(1);

  request(action, params, opts)
    .then((data) => {
      const changed = cacheSet(action, params, data);
      if (changed) {
        window.dispatchEvent(new CustomEvent('app:data-fresh', { detail: { action } }));
      }
    })
    .catch(() => { /* biarkan data cache yang tampil */ })
    .finally(() => {
      inFlight.delete(key);
      markRefresh(-1);
    });
}

/** Satu panggilan jaringan ke Web App. */
async function request(action, params = {}, opts = {}) {
  const body = JSON.stringify({
    action,
    params,
    token: getToken(),
    requestId: opts.write && crypto.randomUUID ? crypto.randomUUID() : undefined
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || CONFIG.TIMEOUT_MS);

  let json;
  try {
    const res = await fetch(CONFIG.API_URL, {
      method: 'POST',
      // text/plain menghindari preflight CORS yang tidak didukung GAS.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body,
      redirect: 'follow',
      signal: controller.signal
    });
    json = await res.json();
  } catch (netErr) {
    const err = new Error(
      netErr.name === 'AbortError'
        ? 'Server tidak merespons. Periksa koneksi lalu coba lagi.'
        : 'Gagal menghubungi server. Periksa koneksi lalu coba lagi.'
    );
    err.code = 'NETWORK';
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!json.ok) {
    const e = json.error || { code: 'INTERNAL', message: 'Terjadi kesalahan.' };
    if (AUTH_ERRORS.includes(e.code)) {
      clearSession();
      if (!location.pathname.endsWith('/login.html')) location.href = 'login.html';
    }
    throw Object.assign(new Error(e.message), e);
  }
  return json.data;
}

/* =========================================================
   Pembungkus action yang sering dipakai
   ========================================================= */

export const auth = {
  login: (username, password) => api('auth.login', { username, password }, { write: true }),
  logout: () => api('auth.logout', {}, { write: true }),
  me: () => api('auth.me')
};

export const system = {
  health: () => api('system.health'),
  bootstrap: () => api('system.bootstrap'),
  hardening: (payload) => api('system.hardening', payload || {}, { write: true }),
  backupDatabase: () => api('system.backupDatabase', {}, { write: true }),
  backupStatus: () => api('system.backupStatus')
};

export const dashboard = {
  summary: () => api('dashboard.summary')
};

export const master = {
  list: (entity, filter) => api('master.list', { entity, ...filter }),
  create: (entity, values) => api('master.create', { entity, values }, { write: true }),
  update: (entity, id, values) => api('master.update', { entity, id, values }, { write: true }),
  remove: (entity, id) => api('master.delete', { entity, id }, { write: true }),
  import: (entity, csv) => api('master.import', { entity, csv }, { write: true })
};

export const sj = {
  list: (filter) => api('sj.list', filter || {}),
  get: (no) => api('sj.get', { no }),
  nextNumber: () => api('sj.nextNumber'),
  create: (payload) => api('sj.create', payload, { write: true }),
  suggestBatch: (date) => api('sj.line.suggestBatch', { date }),
  receive: (payload) => api('sj.line.receive', payload, { write: true }),
  wait: (payload) => api('sj.line.wait', payload, { write: true }),
  cancel: (payload) => api('sj.line.cancel', payload, { write: true }),
  import: (csv) => api('sj.import', { csv }, { write: true })
};

export const pending = {
  list: (filter) => api('pending.list', filter || {})
};

export const stock = {
  list: (filter) => api('stock.list', filter || {}),
  // `fresh` dipakai form pengiriman: sisa batch harus pasti, bukan dari cache.
  available: (customerId, opts) => api('stock.available', { customerId }, opts || {})
};

export const shipment = {
  list: (filter) => api('shipment.list', filter || {}),
  get: (no) => api('shipment.get', { no }),
  create: (payload) => api('shipment.create', payload, { write: true }),
  markDelivered: (payload) => api('shipment.markDelivered', payload, { write: true }),
  printData: (no) => api('shipment.printData', { no }, { write: true }),
  void: (no, reason) => api('shipment.void', { no, reason }, { write: true })
};

export const report = {
  kartuStock: (filter) => api('ledger.kartuStock', filter || {}),
  reconciliation: (filter) => api('report.reconciliation', filter || {})
};

export const users = {
  list: () => api('user.list'),
  create: (values) => api('user.create', values, { write: true }),
  update: (id, values) => api('user.update', { id, values }, { write: true }),
  resetPassword: (id, password) => api('user.resetPassword', { id, password }, { write: true })
};

export const audit = {
  list: (filter) => api('audit.list', filter || {})
};

export const errors = {
  list: (filter) => api('error.list', filter || {})
};
