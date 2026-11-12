/**
 * pages/audit.js — Halaman Audit Log (ADMIN, PRD temuan #11).
 *
 * Menampilkan jejak siapa melakukan apa. Server yang mencatat; halaman ini
 * hanya membaca dengan pencarian dan paginasi.
 */

import { audit } from '../api.js';
import {
  el, btn, badge, panel, emptyBox, skeleton, errorBox,
  searchInput, sub
} from '../ui.js';

const PAGE_SIZE = 50;

/** Warna badge per kelompok aksi. */
function actionClass(action) {
  const a = String(action || '');
  if (a.indexOf('create') !== -1) return 'b-green';
  if (a.indexOf('delete') !== -1) return 'b-red';
  if (a.indexOf('update') !== -1) return 'b-blue';
  if (a.indexOf('void') !== -1) return 'b-amber';
  if (a.indexOf('login') !== -1) return 'b-purple';
  return 'b-gray';
}

export async function renderAuditPage(view) {
  view.innerHTML = '';

  const listWrap = el('div');
  const pagerWrap = el('div', { class: 'pager' });
  const state_ = { q: '', page: 1 };

  view.appendChild(panel({
    title: 'Audit Log',
    sub: 'Memuat…',
    actions: [
      searchInput('Cari user / aksi / entitas…', '', (v) => {
        state_.q = v;
        state_.page = 1;
        load();
      })
    ],
    body: [listWrap, pagerWrap]
  }));

  const panelSub = view.querySelector('.panel-sub');

  /** Muat satu halaman audit log. */
  async function load() {
    listWrap.innerHTML = '';
    listWrap.appendChild(skeleton(8));
    pagerWrap.innerHTML = '';

    try {
      const data = await audit.list({ q: state_.q, page: state_.page, pageSize: PAGE_SIZE });
      const items = data.items || [];

      if (panelSub) {
        panelSub.textContent = data.total
          ? `${data.total} catatan • halaman ${data.page} dari ${data.totalPages}`
          : 'Belum ada catatan';
      }

      listWrap.innerHTML = '';
      if (!items.length) {
        listWrap.appendChild(emptyBox(
          state_.q ? 'Tidak ada catatan cocok' : 'Belum ada aktivitas',
          state_.q ? 'Ubah kata kunci pencarian.' : 'Catatan muncul setelah ada aksi tulis di aplikasi.'
        ));
        return;
      }

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

      listWrap.appendChild(el('table', { class: 'tbl tbl-resp' }, [
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
      ]));

      buildPager(data);
    } catch (err) {
      listWrap.innerHTML = '';
      listWrap.appendChild(errorBox(err));
    }
  }

  /** Kontrol paginasi sederhana. */
  function buildPager(data) {
    if (!data.totalPages || data.totalPages <= 1) return;

    const prev = btn('‹ Sebelumnya', {
      sm: true,
      disabled: data.page <= 1,
      onClick: () => { state_.page = data.page - 1; load(); }
    });
    const next = btn('Berikutnya ›', {
      sm: true,
      disabled: data.page >= data.totalPages,
      onClick: () => { state_.page = data.page + 1; load(); }
    });

    pagerWrap.append(
      prev,
      el('span', { class: 'sub', text: `Halaman ${data.page} / ${data.totalPages}` }),
      next
    );
  }

  await load();
}
