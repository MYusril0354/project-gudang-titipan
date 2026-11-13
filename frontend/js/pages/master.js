/**
 * pages/master.js — Halaman Master Data (PRD 5, 6.8).
 *
 * CRUD empat entity: produk, pelanggan, gudang, rak.
 * - Semua data dari server (master.list) — tidak ada logika bisnis di browser.
 * - Error dari server ditampilkan sebagai toast & penanda field.
 * - Teks dirender lewat textContent (anti-XSS, PRD temuan #9).
 */

import { CONFIG } from '../config.js';
import { master } from '../api.js';
import { state, notify, setMaster } from '../state.js';
import { confirmDialog } from '../ui.js';
import { openImportCsv } from '../modals/import.js';

const ENTITIES = {
  product: {
    label: 'Produk',
    cols: [
      { key: 'code', label: 'Kode' },
      { key: 'name', label: 'Nama' },
      { key: 'unit', label: 'Satuan' }
    ],
    formFields: [
      { key: 'code', label: 'Kode', required: true, placeholder: 'mis. PRD-006' },
      { key: 'name', label: 'Nama', required: true, placeholder: 'mis. Kertas A3' },
      { key: 'unit', label: 'Satuan', type: 'select', required: true,
        options: ['pcs', 'rim', 'pak', 'box', 'lusin', 'unit', 'kg', 'liter'] }
    ],
    showLocation: false
  },
  customer: {
    label: 'Pelanggan',
    cols: [
      { key: 'code', label: 'Kode' },
      { key: 'name', label: 'Nama' },
      { key: 'address', label: 'Alamat' },
      { key: 'phone', label: 'Telepon' }
    ],
    formFields: [
      { key: 'code', label: 'Kode', required: true, placeholder: 'mis. ABC' },
      { key: 'name', label: 'Nama', required: true, placeholder: 'mis. PT Maju' },
      { key: 'address', label: 'Alamat' },
      { key: 'phone', label: 'Telepon' }
    ],
    showLocation: false
  },
  location: {
    label: 'Gudang',
    cols: [
      { key: 'code', label: 'Kode' },
      { key: 'type', label: 'Tipe', badge: true },
      { key: 'name', label: 'Nama' },
      { key: 'customerName', label: 'Pelanggan' }
    ],
    formFields: [
      { key: 'type', label: 'Tipe', type: 'select', required: true,
        options: [{ value: 'MAIN', label: 'MAIN — Gudang Utama' }, { value: 'CONSIGN', label: 'CONSIGN — Gudang Titipan' }] },
      { key: 'name', label: 'Nama', required: true },
      { key: 'customerId', label: 'Pelanggan', type: 'select', dependsOn: 'type', dependsValue: 'CONSIGN',
        options: () => state.master.customers.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` })) }
    ],
    showLocation: true
  },
  rack: {
    label: 'Rak',
    cols: [
      { key: 'code', label: 'Kode' },
      { key: 'name', label: 'Nama' },
      { key: 'locationName', label: 'Gudang' }
    ],
    formFields: [
      { key: 'code', label: 'Kode', required: true, placeholder: 'mis. F-01-01' },
      { key: 'name', label: 'Nama', required: true },
      { key: 'locationId', label: 'Gudang', type: 'select', required: true,
        options: () => state.master.locations.map((l) => ({ value: l.id, label: `${l.type} — ${l.name}` })) }
    ],
    showLocation: false
  }
};

const TABS = ['product', 'customer', 'location', 'rack'];

let activeTab = 'product';

/** Siapkan dan render halaman. */
export async function renderMasterPage(view, route) {
  activeTab = (route && route.tab) || activeTab;
  view.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'panel-head';
  const title = document.createElement('div');
  title.className = 'panel-title';
  title.textContent = 'Master Data';
  const sub = document.createElement('div');
  sub.className = 'panel-sub';
  sub.textContent = 'Produk, pelanggan, gudang, dan rak — data yang dipakai transaksi tidak bisa dihapus';
  title.appendChild(sub);
  head.appendChild(title);

  const actionWrap = document.createElement('div');
  actionWrap.className = 'panel-actions';

  const importBtn = document.createElement('button');
  importBtn.className = 'btn';
  importBtn.type = 'button';
  importBtn.textContent = 'Impor CSV';
  importBtn.title = 'Impor data master dari berkas CSV (migrasi data awal)';
  importBtn.addEventListener('click', () => openImportCsv(activeTab, refreshAfterMutation));
  actionWrap.appendChild(importBtn);

  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-primary';
  addBtn.type = 'button';
  addBtn.textContent = '+ Tambah';
  addBtn.addEventListener('click', () => openForm(null));
  actionWrap.appendChild(addBtn);
  head.appendChild(actionWrap);

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.appendChild(head);
  panel.appendChild(buildTabs());
  panel.appendChild(buildTableWrap());
  view.appendChild(panel);

  await load(activeTab);
}

function buildTabs() {
  const tabs = document.createElement('div');
  tabs.className = 'master-tabs';
  TABS.forEach((t) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tab-item' + (t === activeTab ? ' active' : '');
    btn.textContent = ENTITIES[t].label;
    btn.addEventListener('click', async () => {
      activeTab = t;
      await load(t);
    });
    tabs.appendChild(btn);
  });
  return tabs;
}

function buildTableWrap() {
  const wrap = document.createElement('div');
  wrap.className = 'panel-body';
  wrap.id = 'masterTableWrap';
  return wrap;
}

export async function load(entity) {
  activeTab = entity || activeTab;
  const wrap = document.getElementById('masterTableWrap');
  if (!wrap) return;

  wrap.innerHTML = '';
  wrap.appendChild(skeleton());

  try {
    const conf = ENTITIES[activeTab];
    const { items } = await master.list(activeTab);

    // Siapkan kolom turunan untuk tampilan.
    const custById = new Map(state.master.customers.map((c) => [c.id, c]));
    const locById = new Map(state.master.locations.map((l) => [l.id, l]));
    const enriched = items.map((it) => {
      if (activeTab === 'location') it.customerName = it.customerId ? (custById.get(it.customerId)?.name || '—') : '—';
      if (activeTab === 'rack') it.locationName = locById.get(it.locationId)?.name || '—';
      return it;
    });

    wrap.innerHTML = '';
    wrap.appendChild(buildTable(enriched, conf));
    updateTabButtons(activeTab);
  } catch (err) {
    wrap.innerHTML = '';
    wrap.appendChild(errorBox(err));
  }
}

function buildTable(items, conf) {
  const box = document.createElement('div');

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.style.padding = '32px';
    empty.textContent = 'Belum ada data ' + conf.label.toLowerCase() + '. Klik “+ Tambah” untuk membuat.';
    box.appendChild(empty);
    return box;
  }

  const table = document.createElement('table');
  table.className = 'tbl tbl-resp';

  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  [['#', 'num']].concat(conf.cols.map((c) => [c.label, ''])).concat([['', '']]).forEach(([txt, cls]) => {
    const th = document.createElement('th');
    if (cls) th.className = cls;
    th.textContent = txt;
    hr.appendChild(th);
  });
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  items.forEach((it, i) => {
    const tr = document.createElement('tr');
    const num = document.createElement('td');
    num.className = 'num tbl-idx';
    num.dataset.label = '';
    num.textContent = String(i + 1);
    tr.appendChild(num);

    for (const col of conf.cols) {
      const td = document.createElement('td');
      td.dataset.label = col.label;
      if (col.badge) {
        const badge = document.createElement('span');
        badge.className = 'badge ' + (it[col.key] === 'MAIN' ? 'b-gray' : 'b-brand');
        badge.textContent = it[col.key] || '—';
        td.appendChild(badge);
      } else {
        td.textContent = it[col.key] == null || it[col.key] === '' ? '—' : String(it[col.key]);
      }
      tr.appendChild(td);
    }

    const actions = document.createElement('td');
    actions.className = 'num actions';
    actions.dataset.label = '';
    const edit = document.createElement('button');
    edit.className = 'btn btn-sm';
    edit.type = 'button';
    edit.textContent = 'Edit';
    edit.addEventListener('click', () => openForm(it));
    actions.appendChild(edit);

    const del = document.createElement('button');
    del.className = 'btn btn-sm btn-danger';
    del.type = 'button';
    del.textContent = 'Hapus';
    del.addEventListener('click', () => confirmDelete(it, conf));
    actions.appendChild(del);

    tr.appendChild(actions);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  box.appendChild(table);
  return box;
}

function confirmDelete(item, conf) {
  const label = item.code || item.name || item.id;
  confirmDialog({
    title: `Hapus ${conf.label}?`,
    message: `Hapus "${label}"? Data yang sudah dipakai transaksi ditolak server (amat aman), master yang bersih akan langsung terhapus.`,
    confirmText: 'Hapus',
    danger: true,
    onConfirm: async () => {
      try {
        await master.remove(activeTab, item.id);
        await refreshAfterMutation();
        window.toast?.(`${conf.label} dihapus`, 'ok');
      } catch (err) {
        window.toast?.(err.message || 'Gagal menghapus', 'err');
      }
    }
  });
}

/* =========================================================
   FORM (modal)
   ========================================================= */

function openForm(item) {
  const conf = ENTITIES[activeTab];
  const editing = Boolean(item);

  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

  const card = document.createElement('div');
  card.className = 'modal';

  const head = document.createElement('div');
  head.className = 'modal-head';
  const titleWrap = document.createElement('div');
  const title = document.createElement('h3');
  title.textContent = editing ? `Ubah ${conf.label}` : `Tambah ${conf.label}`;
  const sub = document.createElement('p');
  sub.textContent = editing ? 'Perbarui data ' + conf.label.toLowerCase() : 'Lengkapi data ' + conf.label.toLowerCase() + ' baru';
  titleWrap.append(title, sub);
  head.appendChild(titleWrap);
  const x = document.createElement('button');
  x.className = 'x';
  x.type = 'button';
  x.setAttribute('aria-label', 'Tutup');
  x.textContent = '×';
  x.addEventListener('click', close);
  head.appendChild(x);
  card.appendChild(head);

  const body = document.createElement('div');
  body.className = 'modal-body';
  card.appendChild(body);
  const grid = document.createElement('div');
  grid.className = 'grid2';
  body.appendChild(grid);

  const fields = {};
  for (const f of conf.formFields) {
    const wrap = document.createElement('div');
    wrap.className = 'field';
    const label = document.createElement('label');
    label.textContent = f.label + (f.required ? ' *' : '');
    wrap.appendChild(label);

    let input;
    if (f.type === 'select') {
      input = document.createElement('select');
      const opts = typeof f.options === 'function' ? f.options() : f.options;
      const ph = document.createElement('option');
      ph.value = '';
      ph.textContent = '— pilih —';
      input.appendChild(ph);
      for (const o of opts) {
        const opt = document.createElement('option');
        opt.value = typeof o === 'object' ? o.value : o;
        opt.textContent = typeof o === 'object' ? o.label : o;
        input.appendChild(opt);
      }
    } else {
      input = document.createElement('input');
      input.type = 'text';
      input.placeholder = f.placeholder || '';
    }
    input.dataset.field = f.key;
    if (editing && item[f.key] != null) input.value = item[f.key];
    fields[f.key] = input;
    wrap.appendChild(input);
    grid.appendChild(wrap);
  }

  // Saling terkait: kolom yang dependsOn (mis. customerId saat tipe=CONSIGN).
  for (const f of conf.formFields) {
    if (f.dependsOn && f.dependsValue && fields[f.dependsOn]) {
      const toggle = () => {
        const show = fields[f.dependsOn].value === f.dependsValue;
        fields[f.key].closest('.field').style.display = show ? '' : 'none';
      };
      fields[f.dependsOn].addEventListener('change', toggle);
      toggle();
    }
  }

  // Set ulang nilai saat mengubah field "tipe" agar tidak kirim customerId lama.
  const typeField = fields.type;
  if (typeField) {
    typeField.addEventListener('change', () => {
      if (typeField.value !== 'CONSIGN') fields.customerId.value = '';
    });
  }

  const footer = document.createElement('div');
  footer.className = 'modal-foot';
  const cancel = document.createElement('button');
  cancel.className = 'btn';
  cancel.type = 'button';
  cancel.textContent = 'Batal';
  cancel.addEventListener('click', close);
  footer.appendChild(cancel);

  const save = document.createElement('button');
  save.className = 'btn btn-primary';
  save.type = 'button';
  save.textContent = 'Simpan';
  save.addEventListener('click', async () => {
    const payload = {};
    let firstInvalid = null;
    for (const f of conf.formFields) {
      const el = fields[f.key];
      let v = el.value;
      if (el.type === 'checkbox') v = el.checked;
      if (f.dependsOn && f.dependsValue && typeField && typeField.value !== f.dependsValue) continue;
      if (f.required && (v === '' || v == null)) {
        el.classList.add('input-invalid');
        if (!firstInvalid) firstInvalid = el;
        continue;
      }
      el.classList.remove('input-invalid');
      payload[f.key] = v;
    }
    if (firstInvalid) {
      window.toast?.('Lengkapi kolom wajib.', 'err');
      firstInvalid.focus();
      return;
    }

    save.disabled = true;
    save.textContent = 'Menyimpan…';
    try {
      if (editing) {
        await master.update(activeTab, item.id, payload);
      } else {
        await master.create(activeTab, payload);
      }
      close();
      await refreshAfterMutation();
      window.toast?.(`${conf.label} disimpan`, 'ok');
    } catch (err) {
      save.disabled = false;
      save.textContent = 'Simpan';
      // Tandai field yang disebut error.
      if (err.field && fields[err.field]) {
        fields[err.field].classList.add('input-invalid');
        fields[err.field].focus();
      }
      window.toast?.(err.message || 'Gagal menyimpan', 'err');
    }
  });
  footer.appendChild(save);
  card.appendChild(footer);
  modal.appendChild(card);

  const root = document.getElementById('modalRoot');
  root.innerHTML = '';
  root.appendChild(modal);

  function close() {
    root.innerHTML = '';
  }
}

/* =========================================================
   UTIL
   ========================================================= */

async function refreshAfterMutation() {
  // muat ulang master data agar state lokal sinkron (PRD 12.3)
  try {
    const b = await Promise.all([
      master.list('product'),
      master.list('customer'),
      master.list('location'),
      master.list('rack')
    ]);
    setMaster('product', b[0].items);
    setMaster('customer', b[1].items);
    setMaster('location', b[2].items);
    setMaster('rack', b[3].items);
    notify();
  } catch (ignore) { /* halaman tetap bisa render dari server */ }
  await load(activeTab);
}

function updateTabButtons(current) {
  document.querySelectorAll('.master-tabs .tab-item').forEach((btn) => {
    btn.classList.toggle('active', btn.textContent === ENTITIES[current].label);
  });
}

function skeleton() {
  const box = document.createElement('div');
  box.style.padding = '24px';
  for (let i = 0; i < 6; i++) {
    const s = document.createElement('div');
    s.className = 'skeleton';
    s.style.width = (60 + Math.random() * 30) + '%';
    s.style.marginBottom = '10px';
    box.appendChild(s);
  }
  return box;
}

function errorBox(err) {
  const box = document.createElement('div');
  box.className = 'empty';
  box.style.padding = '28px';
  box.style.color = 'var(--red)';
  box.textContent = err.message || 'Gagal memuat data.';
  return box;
}
