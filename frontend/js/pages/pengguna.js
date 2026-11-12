/**
 * pages/pengguna.js — Halaman Pengguna (ADMIN, PRD 4 & 9).
 *
 * Server tetap penentu akhir: menolak menonaktifkan akun sendiri dan menolak
 * menghilangkan ADMIN aktif terakhir.
 */

import { users } from '../api.js';
import { state } from '../state.js';
import {
  el, btn, badge, panel, emptyBox, skeleton, errorBox,
  statCard, sub
} from '../ui.js';
import { openUserForm, openResetPassword } from '../modals/user.js';

const ROLE_BADGE = { ADMIN: 'b-purple', GUDANG: 'b-blue', VIEWER: 'b-gray' };

export async function renderPenggunaPage(view) {
  view.innerHTML = '';

  const cardsWrap = el('div', { class: 'cards' });
  const listWrap = el('div');

  view.appendChild(cardsWrap);
  view.appendChild(panel({
    title: 'Daftar Pengguna',
    sub: 'Memuat…',
    actions: [btn('+ Tambah Pengguna', { variant: 'primary', onClick: () => openUserForm(null, load) })],
    body: [listWrap]
  }));

  const panelSub = view.querySelector('.panel-sub');

  /** Muat daftar user. */
  async function load() {
    listWrap.innerHTML = '';
    listWrap.appendChild(skeleton(5));
    try {
      const data = await users.list();
      const items = data.items || [];

      const aktif = items.filter((u) => u.aktif).length;
      cardsWrap.innerHTML = '';
      cardsWrap.append(
        statCard('Total Pengguna', String(items.length), 'akun', 'Terdaftar di sistem', '#4f46e5'),
        statCard('Aktif', String(aktif), 'akun', 'Bisa login', '#0e9f6e'),
        statCard('Nonaktif', String(items.length - aktif), 'akun', 'Login ditolak', '#b42318'),
        statCard('Administrator', String(items.filter((u) => u.role === 'ADMIN').length), 'akun',
          'Akses penuh', '#9333ea')
      );

      if (panelSub) panelSub.textContent = `${items.length} akun terdaftar`;

      listWrap.innerHTML = '';
      if (!items.length) {
        listWrap.appendChild(emptyBox('Belum ada pengguna'));
        return;
      }

      const rows = items.map((u) => {
        const isSelf = state.user && state.user.userId === u.id;
        const actions = el('div', { class: 'btn-group' }, [
          btn('Ubah', { sm: true, onClick: () => openUserForm(u, load) }),
          btn('Reset Password', { sm: true, onClick: () => openResetPassword(u, load) })
        ]);

        return el('tr', {}, [
          el('td', { 'data-label': 'Username' }, [
            el('div', { class: 'mono', text: u.username }),
            isSelf ? sub('Akun Anda') : null
          ]),
          el('td', { 'data-label': 'Nama', text: u.nama || '—' }),
          el('td', { 'data-label': 'Peran' }, [badge(u.role, ROLE_BADGE[u.role] || 'b-gray')]),
          el('td', { 'data-label': 'Status' }, [
            badge(u.aktif ? 'Aktif' : 'Nonaktif', u.aktif ? 'b-green' : 'b-red')
          ]),
          el('td', { 'data-label': 'Terakhir Diubah', text: u.updated_at || u.created_at || '—' }),
          el('td', { class: 'num', 'data-label': '' }, [actions])
        ]);
      });

      listWrap.appendChild(el('table', { class: 'tbl tbl-resp' }, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { text: 'Username' }),
            el('th', { text: 'Nama' }),
            el('th', { text: 'Peran' }),
            el('th', { text: 'Status' }),
            el('th', { text: 'Terakhir Diubah' }),
            el('th', { class: 'num', text: 'Aksi' })
          ])
        ]),
        el('tbody', {}, rows)
      ]));
    } catch (err) {
      listWrap.innerHTML = '';
      listWrap.appendChild(errorBox(err));
    }
  }

  await load();
}