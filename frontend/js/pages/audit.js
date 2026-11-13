/**
 * pages/audit.js — Halaman Audit Log & Error Log (ADMIN, PRD temuan #11 & Fase 5).
 *
 * Dua tab:
 *  - Audit Log : jejak siapa melakukan apa (sheet audit_log)
 *  - Error Log : error tak terduga yang tercatat server (sheet error_log)
 *
 * Server yang mencatat; halaman ini hanya membaca dengan pencarian & paginasi.
 */

import { audit, errors } from '../api.js';
import {
  el, btn, badge, panel, emptyBox, skeleton, errorBox,
  searchInput, sub
} from '../ui.js';

const PAGE_SIZE = 50;

/** Warna badge per kelompok aksi audit. */
function actionClass(action) {
  const a = String(action || '');
  if (a.indexOf('create') !== -1) return 'b-green';
  if (a.indexOf('delete') !== -1) return 'b-red';
  if (a.indexOf('update') !== -1) return 'b-blue';
  if (a.indexOf('void') !== -1) return 'b-amber';
  if (a.indexOf('login') !== -1) return 'b-purple';
  if (a.indexOf('import') !== -1) return 'b-blue';
  if (a.indexOf('lock') !== -1) return 'b-amber';
  return 'b-gray';
}

export async function renderAuditPage(view) {
  view.innerHTML = '';

  const tabsWrap = el('div', { class: 'master-tabs' });
  const listWrap = el('div');
  const pagerWrap = el('div', { class: 'pager' });
  const searchWrap = el('div', { class: 'panel-actions' });

  const ui = { tab: 'audit', q: '', page: 1 };

  const TABS = [
    { key: 'audit', label: 'Audit Log', sub: 'Jejak aktivitas pengguna' },
    { key: 'error', label: 'Error Log', sub: 'Error tak terduga yang tercatat server' }
  ];

  for (const t of TABS) {
    const b = el('button', {
      type: 'button',
      class: 'tab-item' + (t.key === ui.tab ? ' active' : ''),
      text: t.label,
      onclick: () => {
        if (ui.tab === t.key) return;
        ui.tab = t.key;
        ui.q = '';
        ui.page = 1;
        Array.from(tabsWrap.children).forEach((c) => c.classList.toggle('active', c.textContent === t.label));
        panelSub.textContent = t.sub;
        load();
      }
    });
    tabsWrap.appendChild(b);
  }

  view.appendChild(panel({
    title: 'Audit & Error',
    sub: TABS[0].sub,
    actions: [searchWrap],
    body: [tabsWrap, listWrap, pagerWrap]
  }));

  const panelSub = view.querySelector('.panel-sub');
  rebuildSearch();

  /** Ganti kotak pencarian sesuai tab aktif. */
  function rebuildSearch() {
    searchWrap.innerHTML = '';
    const placeholder = ui.tab === 'audit'
      ? 'Cari user / aksi / entitas…'
      : 'Cari kode / pesan error…';
    searchWrap.appendChild(searchInput(placeholder, ui.q, (v) => {
      ui.q = v;
      ui.page = 1;
      load();
    }));
  }

  /** Muat satu halaman sesuai tab aktif. */
  async function load() {
    listWrap.innerHTML = '';
    listWrap.appendChild(skeleton(8));
    pagerWrap.innerHTML = '';

    try {
      const data = ui.tab === 'audit'
        ? await audit.list({ q: ui.q, page: ui.page, pageSize: PAGE_SIZE })
        : await errors.list({ q: ui.q, page: ui.page, pageSize: PAGE_SIZE });

      const items = data.items || [];

      if (panelSub) {
        const label = ui.tab === 'audit' ? 'catatan' : 'error';
        panelSub.textContent = data.total
          ? `${data.total} ${label} • halaman ${data.page} dari ${data.totalPages}`
          : `Belum ada ${label}`;
      }

      listWrap.innerHTML = '';
      if (!items.length) {
        listWrap.appendChild(emptyBox(
          ui.q ? 'Tidak ada hasil cocok' : (ui.tab === 'audit' ? 'Belum ada aktivitas' : 'Tidak ada error tercatat'),
          ui.q ? 'Ubah kata kunci pencarian.'
            : (ui.tab === 'audit'
              ? 'Catatan muncul setelah ada aksi tulis di aplikasi.'
              : 'Bagus — belum ada error tak terduga yang tercatat.')
        ));
        return;
      }

      listWrap.appendChild(ui.tab === 'audit' ? buildAuditTable(items) : buildErrorTable(items));
      buildPager(data);
    } catch (err) {
      listWrap.innerHTML = '';
      listWrap.appendChild(errorBox(err));
    }
  }

  /** Kontrol paginasi sederhana. */
  function buildPager(data) {
    if (!data.totalPages || data.totalPages <= 1) return;
    pagerWrap.append(
      btn('‹ Sebelumnya', {
        sm: true,
        disabled: data.page <= 1,
        onClick: () => { ui.page = data.page - 1; load(); }
      }),
      el('span', { class: 'sub', text: `Halaman ${data.page} / ${data.totalPages}` }),
      btn('Berikutnya ›', {
        sm: true,
        disabled: data.page >= data.totalPages,
        onClick: () => { ui.page = data.page + 1; load(); }
      })
    );
  }

  await load();
}

/** Tabel audit log. */
function buildAuditTable(items) {
  const rows = items.map((r) => el('tr', {}, [
    el('td', { 'data-label': 'Waktu' }, [el('span', { class: 'mono', text: r.timestamp || '—' })]),
    el('td', { 'data-label': 'Pengguna', text: r.user || '—' }),
    el('td', { 'data-label': 'Aksi' }, [badge(r.action || '—', actionClass(r.action))]),
    el('td', { 'data-label': 'Entitas' }, [
      el('div', { text: r.entity || '—' }),
      r.entity_id ? sub(r.entity_id) : null
    ]),
    el('td', { 'data-label': 'Detail', text: r.detail || '—' })
  ]));

  return el('table', { class: 'tbl tbl-resp' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Waktu' }),
        el('th', { text: 'Pengguna' }),
        el('th', { text: 'Aksi' }),
        el('th', { text: 'Entitas' }),
        el('th', { text: 'Detail' })
      ])
    ]),
    el('tbody', {}, rows)
  ]);
}

/** Tabel error log. */
function buildErrorTable(items) {
  const rows = items.map((r) => el('tr', {}, [
    el('td', { 'data-label': 'Waktu' }, [el('span', { class: 'mono', text: r.timestamp || '—' })]),
    el('td', { 'data-label': 'Kode' }, [badge(r.code || 'INTERNAL', 'b-red')]),
    el('td', { 'data-label': 'Pesan', text: r.message || '—' }),
    el('td', { 'data-label': 'Request' }, [
      el('span', { class: 'mono', style: { fontSize: '11px' }, text: r.request || '—' })
    ])
  ]));

  return el('table', { class: 'tbl tbl-resp' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Waktu' }),
        el('th', { text: 'Kode' }),
        el('th', { text: 'Pesan' }),
        el('th', { text: 'Request' })
      ])
    ]),
    el('tbody', {}, rows)
  ]);
}
