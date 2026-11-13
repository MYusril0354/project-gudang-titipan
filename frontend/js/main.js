/**
 * main.js — Titik masuk aplikasi.
 *
 * Tanggung jawab:
 *  1. Bangun navigasi sesuai peran (RBAC tampilan; server tetap memeriksa ulang).
 *  2. Panggil system.bootstrap sekali di awal (PRD 13: kinerja).
 *  3. Render halaman sesuai route.
 *
 * Catatan: tahap ini masih kerangka. Halaman diisi pada fase berikutnya.
 */

import { CONFIG } from './config.js';
import { clearSession, getToken, auth, system, sj, pending, shipment } from './api.js';
import { state, applyBootstrap, fmtDate } from './state.js';
import { renderMasterPage } from './pages/master.js';
import { renderPenerimaanPage } from './pages/penerimaan.js';
import { renderPendingPage } from './pages/pending.js';
import { renderStokPage } from './pages/stok.js';
import { renderPengirimanPage } from './pages/pengiriman.js';
import { renderDashboardPage } from './pages/dashboard.js';
import { renderKartuPage } from './pages/kartu.js';
import { renderLaporanPage } from './pages/laporan.js';
import { renderPenggunaPage } from './pages/pengguna.js';
import { renderAuditPage } from './pages/audit.js';
import { setCacheScope, clearEverything } from './cache.js';
import { el } from './ui.js';

/* =========================================================
   Definisi halaman & hak akses tampilan
   ========================================================= */

const GROUPS = [
  { key: 'operasional', label: 'Operasional' },
  { key: 'pelaporan', label: 'Pelaporan' },
  { key: 'admin', label: 'Administrasi' }
];

const PAGES = [
  { route: 'dashboard', group: 'operasional', label: 'Dashboard', sub: 'Ringkasan stok titipan dan pending fisik', roles: null },
  { route: 'penerimaan', group: 'operasional', label: 'Penerimaan SJ', sub: 'Daftar Surat Jalan dan penerimaan fisik', roles: null, badgeKey: 'openSj' },
  { route: 'pending', group: 'operasional', label: 'Fisik Belum Ada', sub: 'Antrean barang yang fisiknya belum diterima', roles: null, badgeKey: 'pendingLines' },
  { route: 'stok', group: 'operasional', label: 'Stok Titipan', sub: 'Posisi stok per batch', roles: null },
  { route: 'pengiriman', group: 'operasional', label: 'Pengiriman', sub: 'Surat jalan keluar dari gudang titipan', roles: null, badgeKey: 'awaitingPod' },
  { route: 'kartu', group: 'pelaporan', label: 'Kartu Stock', sub: 'Mutasi dan saldo berjalan per batch', roles: null },
  { route: 'laporan', group: 'pelaporan', label: 'Rekonsiliasi', sub: 'Total masuk, keluar, stok, dan selisih', roles: null },
  { route: 'master', group: 'admin', label: 'Master Data', sub: 'Produk, pelanggan, gudang, dan rak', roles: null },
  { route: 'pengguna', group: 'admin', label: 'Pengguna', sub: 'Kelola akun dan peran', roles: ['ADMIN'] },
  { route: 'audit', group: 'admin', label: 'Audit Log', sub: 'Jejak aktivitas pengguna', roles: ['ADMIN'] }
];

/** Angka kecil di daftar menu (diisi setelah bootstrap, non-blocking). */
let navBadges = { openSj: 0, pendingLines: 0, awaitingPod: 0 };

const ICONS = {
  dashboard: '<path d="M3 13h8V3H3zM13 21h8v-8h-8zM13 3v6h8V3zM3 21h8v-4H3z"/>',
  penerimaan: '<path d="M4 4h16v6H4zM4 14h16v6H4z"/><path d="M8 7h8M8 17h8"/>',
  pending: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  stok: '<path d="M3 7l9-4 9 4-9 4z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/>',
  pengiriman: '<path d="M3 7h11v10H3z"/><path d="M14 10h4l3 3v4h-7z"/><circle cx="7" cy="19" r="1.6"/><circle cx="17" cy="19" r="1.6"/>',
  kartu: '<path d="M4 4h16v16H4z"/><path d="M4 9h16M9 9v11"/>',
  laporan: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  master: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  pengguna: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
  audit: '<path d="M5 3h14v18H5z"/><path d="M9 8h6M9 12h6M9 16h4"/>'
};

/* =========================================================
   Inisialisasi
   ========================================================= */

async function boot() {
  if (!getToken()) {
    location.href = 'login.html';
    return;
  }

  initNavToggle();
  initSyncIndicator();
  renderNav();

  // Label lingkungan — membantu memastikan tidak salah arah ke PROD/DEV.
  document.getElementById('envPill').textContent = CONFIG.APP_ENV;

  try {
    const data = await system.bootstrap();
    applyBootstrap(data);
    // Cache dipisah per pengguna supaya data tidak bocor antar akun.
    setCacheScope(data.user && data.user.userId);
    renderUser();
    renderToday();
    renderNav(); // filter ulang setelah peran diketahui
    renderRoute(state.route);
    loadBadges(); // angka menu (pending/open) — non-blocking
  } catch (err) {
    showFatal(err);
  }
}

function renderUser() {
  const u = state.user;
  if (!u) return;
  const initials = (u.username || '?').slice(0, 2).toUpperCase();
  document.getElementById('userAvatar').textContent = initials;
  const pill = document.getElementById('userPill');
  pill.textContent = u.role;
  pill.hidden = false;

  const btn = document.getElementById('logoutBtn');
  btn.hidden = false;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try { await auth.logout(); } catch (ignore) { /* tetap keluar secara lokal */ }
    clearSession();
    clearEverything(); // jangan tinggalkan salinan data di browser
    location.href = 'login.html';
  });
}

/**
 * Indikator "Memperbarui…" + render ulang otomatis saat data segar tiba.
 *
 * Data lama tampil seketika dari cache, lalu disegarkan di belakang. Bila
 * isinya berubah, halaman dirender ulang — kecuali sedang ada modal terbuka
 * atau pengguna sedang mengetik, agar fokus tidak hilang.
 */
function initSyncIndicator() {
  const pill = document.getElementById('syncPill');

  window.addEventListener('app:sync', (e) => {
    const pending = (e.detail && e.detail.pending) || 0;
    if (pill) pill.hidden = pending <= 0;
  });

  window.addEventListener('app:data-fresh', () => {
    if (isBusy()) return;
    renderRoute(state.route);
  });
}

/** Apakah pengguna sedang berinteraksi (modal terbuka / mengetik). */
function isBusy() {
  const modalRoot = document.getElementById('modalRoot');
  if (modalRoot && modalRoot.children.length > 0) return true;

  const a = document.activeElement;
  if (!a) return false;
  const tag = a.tagName;
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
}

function renderToday() {
  document.getElementById('todayLabel').textContent = fmtDate(state.serverDate);
}

/** Sidebar off-canvas (mobile): buka/tutup. */
function initNavToggle() {
  const btn = document.getElementById('navToggle');
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (!btn || !sidebar || !overlay) return;

  const open = () => {
    sidebar.classList.add('open');
    overlay.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
  };
  const close = () => {
    sidebar.classList.remove('open');
    overlay.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  };

  btn.addEventListener('click', () => (sidebar.classList.contains('open') ? close() : open()));
  overlay.addEventListener('click', close);
}

/** Tutup sidebar (dipakai setelah pilih menu pada layar kecil). */
function closeSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  const btn = document.getElementById('navToggle');
  if (sidebar) sidebar.classList.remove('open');
  if (overlay) overlay.hidden = true;
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

/** Navigasi sesuai peran (VIEWER tidak melihat menu tulis — PRD 12.3). */
function renderNav() {
  const role = state.user ? state.user.role : null;
  const nav = document.getElementById('nav');
  nav.innerHTML = '';

  const visible = PAGES.filter((p) => !p.roles || (role && p.roles.includes(role)));

  for (const group of GROUPS) {
    const inGroup = visible.filter((p) => p.group === group.key);
    if (!inGroup.length) continue;

    const heading = document.createElement('div');
    heading.className = 'nav-group';
    heading.textContent = group.label;
    nav.appendChild(heading);

    for (const p of inGroup) {
      const btn = document.createElement('button');
      btn.className = 'nav-item' + (p.route === state.route ? ' active' : '');
      btn.type = 'button';
      btn.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[p.route] || ''}</svg><span></span>`;
      btn.querySelector('span').textContent = p.label; // textContent -> aman dari XSS

      const count = p.badgeKey ? navBadges[p.badgeKey] : 0;
      if (count > 0) {
        const badge = document.createElement('span');
        badge.className = 'nav-badge';
        badge.textContent = String(count);
        btn.appendChild(badge);
      }

      btn.addEventListener('click', () => go(p.route));
      nav.appendChild(btn);
    }
  }
}

/** Ambil angka menu (pending baris, SJ terbuka, menunggu POD) tanpa memblokir render. */
async function loadBadges() {
  try {
    const [sjRes, pendingRes, shipRes] = await Promise.all([
      sj.list({}),
      pending.list({}),
      shipment.list({})
    ]);
    navBadges.openSj = (sjRes.counts && sjRes.counts.open) || 0;
    navBadges.pendingLines = ((pendingRes.totals && pendingRes.totals.rows) || 0)
      + ((pendingRes.totals && pendingRes.totals.openRows) || 0);
    navBadges.awaitingPod = (shipRes.counts && shipRes.counts.shipped) || 0;
    renderNav();
  } catch (ignore) { /* angka menu bersifat opsional */ }
}

/** Pindah halaman. */
export function go(route) {
  state.route = route;
  renderNav();
  renderRoute(route);
  closeSidebar();
  window.scrollTo({ top: 0 });
}

/** Render isi halaman sesuai route. */
async function renderRoute(route) {
  const page = PAGES.find((p) => p.route === route) || PAGES[0];
  document.getElementById('pageTitle').textContent = page.label;
  document.getElementById('pageSub').textContent = page.sub;

  const view = document.getElementById('view');
  view.innerHTML = '';

  // Halaman yang sudah diimplementasikan.
  if (route === 'dashboard') {
    await renderDashboardPage(view);
    return;
  }
  if (route === 'master') {
    await renderMasterPage(view, { tab: state.masterTab });
    return;
  }
  if (route === 'penerimaan') {
    await renderPenerimaanPage(view);
    return;
  }
  if (route === 'pending') {
    await renderPendingPage(view);
    return;
  }
  if (route === 'stok') {
    await renderStokPage(view);
    return;
  }
  if (route === 'pengiriman') {
    await renderPengirimanPage(view);
    return;
  }
  if (route === 'kartu') {
    await renderKartuPage(view);
    return;
  }
  if (route === 'laporan') {
    await renderLaporanPage(view);
    return;
  }
  if (route === 'pengguna') {
    await renderPenggunaPage(view);
    return;
  }
  if (route === 'audit') {
    await renderAuditPage(view);
    return;
  }

  // Placeholder untuk halaman yang belum diimplementasikan.
  view.appendChild(buildPlaceholder(page));
}

/** Cadangan bila ada menu tanpa renderer (seharusnya tidak terjadi). */
function buildPlaceholder(page) {
  return el('div', { class: 'panel' }, [
    el('div', { class: 'panel-body', style: { padding: '28px' } }, [
      el('div', { class: 'panel-title', text: page.label }),
      el('div', {
        class: 'panel-sub',
        style: { marginTop: '6px' },
        text: 'Halaman ini belum punya renderer. Laporkan sebagai bug.'
      })
    ])
  ]);
}

/** Tampilkan kegagalan bootstrap (mis. URL API belum diisi). */
function showFatal(err) {
  const view = document.getElementById('view');
  view.innerHTML = '';
  const panel = document.createElement('div');
  panel.className = 'panel';
  const body = document.createElement('div');
  body.style.padding = '24px';

  const h = document.createElement('div');
  h.className = 'panel-title';
  h.textContent = 'Tidak dapat memuat data dari server';

  const p = document.createElement('p');
  p.style.cssText = 'color:var(--muted);font-size:13px;margin:8px 0 4px';
  p.textContent = err.message || 'Terjadi kesalahan.';

  const hint = document.createElement('p');
  hint.style.cssText = 'color:var(--muted);font-size:12.5px;margin:0 0 16px';
  hint.textContent = 'Pastikan CONFIG.API_URL pada js/config.js sudah diisi dengan URL Web App GAS (/exec).';

  const retry = document.createElement('button');
  retry.className = 'btn btn-primary';
  retry.type = 'button';
  retry.textContent = 'Coba lagi';
  retry.addEventListener('click', () => { retry.disabled = true; boot(); });

  body.append(h, p, hint, retry);
  panel.appendChild(body);
  view.appendChild(panel);
}

/** Navigasi dari dalam halaman (dipakai ui.navigate) tanpa import melingkar. */
window.addEventListener('app:navigate', (e) => {
  const route = e && e.detail && e.detail.route;
  if (route) go(route);
});

/** Toast notifikasi global (dipakai halaman & modal). */window.toast = function toast(message, type = 'ok') {
  const root = document.getElementById('toastRoot');
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .3s';
    setTimeout(() => el.remove(), 320);
  }, 3200);
};

boot();
