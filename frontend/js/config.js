/**
 * config.js — SATU-SATUNYA file yang diganti per lingkungan (PRD 12.1).
 *
 * Ganti API_URL dengan URL Web App GAS hasil deploy:
 *   Apps Script -> Deploy -> Manage deployments -> Web app -> /exec
 *
 * Catatan: URL /exec tetap sama bila memakai "Edit -> New version".
 * Membuat deployment baru akan menghasilkan URL berbeda (PRD 12.4).
 */
window.CONFIG = {
  /** 'DEV' atau 'PROD' — dipakai untuk label di UI dan log. */
  APP_ENV: 'DEV',

  /** URL /exec Web App Google Apps Script. GANTI INI. */
  API_URL: 'https://script.google.com/macros/s/AKfycbyx88o7CdWlCbN64GAJ35iQWZSTBc6C2QBTcz3oXXAMXpwF_c6YXJ0jVLV6snbixkTz/exec',

  /** Nama aplikasi & perusahaan cadangan (nilai asli dari system.bootstrap). */
  APP_NAME: 'Gudang Titipan',
  COMPANY_FALLBACK: 'PT DISTRIBUSI NUSANTARA',

  /** Batas waktu request (ms) sebelum dianggap gagal. */
  TIMEOUT_MS: 30000,

  /** Debounce pencarian (ms) — PRD 12.3. */
  SEARCH_DEBOUNCE_MS: 300
};
