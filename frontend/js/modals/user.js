/**
 * modals/user.js — Modal kelola pengguna (ADMIN, PRD 4 & 9).
 *
 *  - openUserForm  : tambah / ubah user (peran, aktif)
 *  - openResetPassword : set password baru
 *
 * Aturan server yang tetap berlaku: tidak bisa menonaktifkan akun sendiri dan
 * harus selalu ada minimal satu ADMIN aktif.
 */

import { users } from '../api.js';
import { state } from '../state.js';
import { el, btn, modal, field, select, grid2, infobox, toast, callout } from '../ui.js';

const ROLES = [
  { value: 'ADMIN', label: 'ADMIN — semua fitur' },
  { value: 'GUDANG', label: 'GUDANG — transaksi gudang' },
  { value: 'VIEWER', label: 'VIEWER — hanya baca' }
];

const ROLE_LABEL = { ADMIN: 'Administrator', GUDANG: 'Petugas Gudang', VIEWER: 'Pengamat' };

/** Tambah (item null) atau ubah user. */
export function openUserForm(item, onDone) {
  const editing = Boolean(item);

  const usernameInput = el('input', { type: 'text', value: item ? item.username : '', placeholder: 'mis. budi' });
  const namaInput = el('input', { type: 'text', value: item ? item.nama : '', placeholder: 'Nama lengkap' });
  const roleSelect = select(ROLES, item ? item.role : 'GUDANG');
  const passwordInput = el('input', { type: 'password', placeholder: 'Minimal 6 karakter' });
  const aktifSelect = select(
    [{ value: 'TRUE', label: 'Aktif' }, { value: 'FALSE', label: 'Nonaktif' }],
    item && item.aktif === false ? 'FALSE' : 'TRUE'
  );

  if (editing) usernameInput.disabled = true;

  const submitBtn = btn(editing ? 'Simpan Perubahan' : 'Tambah Pengguna', { variant: 'primary' });

  const body = [
    grid2([
      field('Username', usernameInput,
        editing ? 'Username tidak bisa diubah.' : 'Dipakai untuk login.', true),
      field('Nama', namaInput, null, false)
    ]),
    field('Peran', roleSelect, 'Menentukan hak akses di server, bukan sekadar tampilan.', true)
  ];

  if (editing) {
    body.push(field('Status akun', aktifSelect,
      'Akun sendiri tidak bisa dinonaktifkan; harus ada minimal satu ADMIN aktif.', false));
  } else {
    body.push(field('Password awal', passwordInput, 'Minimal 6 karakter.', true));
  }

  const dlg = modal({
    title: editing ? 'Ubah Pengguna' : 'Tambah Pengguna',
    sub: editing ? 'Perbarui profil, peran, atau status akun' : 'Buat akun baru beserta perannya',
    body,
    footer: [btn('Batal', { onClick: () => dlg.close() }), submitBtn]
  });

  submitBtn.addEventListener('click', async () => {
    if (!editing) {
      if (!usernameInput.value.trim()) {
        usernameInput.classList.add('input-invalid');
        toast('Username wajib diisi.', 'err');
        return;
      }
      if (!passwordInput.value || passwordInput.value.length < 6) {
        passwordInput.classList.add('input-invalid');
        toast('Password minimal 6 karakter.', 'err');
        return;
      }
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Menyimpan…';
    try {
      if (editing) {
        await users.update(item.id, {
          nama: namaInput.value.trim(),
          role: roleSelect.value,
          aktif: aktifSelect.value === 'TRUE'
        });
        dlg.close();
        toast(`Pengguna ${item.username} diperbarui.`, 'ok');
      } else {
        await users.create({
          username: usernameInput.value.trim(),
          nama: namaInput.value.trim(),
          role: roleSelect.value,
          password: passwordInput.value
        });
        dlg.close();
        toast(`Pengguna ${usernameInput.value.trim()} dibuat.`, 'ok');
      }
      if (onDone) await onDone();
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = editing ? 'Simpan Perubahan' : 'Tambah Pengguna';
      if (err.field === 'username') usernameInput.classList.add('input-invalid');
      if (err.field === 'password') passwordInput.classList.add('input-invalid');
      if (err.field === 'role') roleSelect.classList.add('input-invalid');
      if (err.field === 'aktif') aktifSelect.classList.add('input-invalid');
      toast(err.message || 'Gagal menyimpan pengguna', 'err');
    }
  });
}

/** Reset password user. */
export function openResetPassword(item, onDone) {
  const passInput = el('input', { type: 'password', placeholder: 'Minimal 6 karakter' });
  const submitBtn = btn('Reset Password', { variant: 'danger' });

  const dlg = modal({
    title: 'Reset Password',
    sub: 'Password lama tidak bisa dilihat — hanya bisa diganti',
    body: [
      infobox([
        ['Username', item.username],
        ['Nama', item.nama || '—'],
        ['Peran', item.role],
        ['Status', item.aktif ? 'Aktif' : 'Nonaktif'],
        ['Dibuat', item.created_at || '—'],
        ['Diubah', item.updated_at || '—']
      ]),
      field('Password baru', passInput, 'Minimal 6 karakter. Sampaikan ke pemilik akun lewat jalur aman.', true)
    ],
    footer: [btn('Batal', { onClick: () => dlg.close() }), submitBtn]
  });

  submitBtn.addEventListener('click', async () => {
    if (!passInput.value || passInput.value.length < 6) {
      passInput.classList.add('input-invalid');
      toast('Password minimal 6 karakter.', 'err');
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = 'Menyimpan…';
    try {
      await users.resetPassword(item.id, passInput.value);
      dlg.close();
      toast(`Password ${item.username} berhasil direset.`, 'ok');
      if (onDone) await onDone();
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Reset Password';
      if (err.field === 'password') passInput.classList.add('input-invalid');
      toast(err.message || 'Gagal reset password', 'err');
    }
  });
}
