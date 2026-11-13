/**
 * modals/import.js — Impor master data dari CSV (Fase 5, migrasi data awal).
 *
 * Server memvalidasi setiap baris memakai aturan yang sama dengan master.create,
 * jadi baris yang tidak valid dilaporkan per baris tanpa menggagalkan sisanya.
 */

import { master, sj } from '../api.js';
import { el, btn, modal, field, select, toast, callout, badge } from '../ui.js';

/** Kolom yang diharapkan per entity (untuk contoh & petunjuk). */
const ENTITY_INFO = {
  sj: {
    label: 'Surat Jalan',
    fields: 'no_sj, tanggal, pelanggan, po, produk, qty, batch, ed',
    sample: 'no_sj,tanggal,pelanggan,po,produk,qty,batch,ed\n'
      + 'SJ/2026/0101,2026-11-13,SJY,PO-1001,PRD-001,50,BN-20261113-001,2027-06-30\n'
      + 'SJ/2026/0101,2026-11-13,SJY,PO-1001,PRD-002,20,BN-20261113-002,2027-01-15\n'
      + 'SJ/2026/0102,2026-11-13,MAB,PO-1002,PRD-003,10,,',
    note: 'Satu file boleh memuat beberapa SJ: baris dikelompokkan per no_sj. '
      + 'Kolom batch & ed bersifat RENCANA — stok baru bertambah saat Fisik Ada '
      + 'dikonfirmasi. Tanggal & ED wajib format YYYY-MM-DD. Pelanggan diisi kode '
      + 'atau nama; produk diisi kode produk.'
  },
  product: {
    label: 'Produk',
    fields: 'kode, nama, satuan',
    sample: 'kode,nama,satuan\nPRD-101,Kertas A4 80gsm,rim\nPRD-102,Tinta Printer,pcs',
    note: 'Satuan bebas diisi (mis. pcs, rim, dus, bal, roll, meter) — maksimal 20 karakter.'
  },
  customer: {
    label: 'Pelanggan',
    fields: 'kode, nama, alamat, telepon',
    sample: 'kode,nama,alamat,telepon\nSJY2,PT Sinar Jaya Cabang,Jl. Merdeka 1,021-5551',
    note: 'Kode pelanggan otomatis dijadikan huruf besar dan harus unik.'
  },
  location: {
    label: 'Gudang',
    fields: 'tipe, nama, pelanggan',
    sample: 'tipe,nama,pelanggan\nCONSIGN,Gudang Titipan Baru,ABC',
    note: 'Tipe MAIN atau CONSIGN. Kolom pelanggan diisi KODE pelanggan; '
      + 'satu pelanggan hanya boleh punya satu gudang titipan.'
  },
  rack: {
    label: 'Rak',
    fields: 'kode, nama, gudang',
    sample: 'kode,nama,gudang\nF-01-01,Rak F1 Level 1,Gudang Utama',
    note: 'Kolom gudang diisi NAMA gudang (gudang tidak punya kode), mis. "Gudang Utama".'
  }
};

/**
 * Buka modal impor CSV.
 * @param {string} entity product | customer | location | rack
 * @param {Function} onDone dipanggil setelah impor sukses
 */
export function openImportCsv(entity, onDone) {
  const info = ENTITY_INFO[entity] || ENTITY_INFO.product;

  const entitySelect = select(
    Object.keys(ENTITY_INFO).map((k) => ({ value: k, label: ENTITY_INFO[k].label })),
    entity
  );
  const fileInput = el('input', { type: 'file', accept: '.csv,text/csv' });
  const csvInput = el('textarea', {
    rows: '8',
    placeholder: info.sample,
    style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '12px' }
  });
  const resultWrap = el('div');

  const submitBtn = btn('Impor Sekarang', { variant: 'primary' });

  /** Perbarui petunjuk saat entity berganti. */
  function refreshHint() {
    const cur = ENTITY_INFO[entitySelect.value] || ENTITY_INFO.product;
    hintBox.innerHTML = '';
    hintBox.appendChild(el('div', {}, [
      el('div', {}, [el('b', { text: 'Kolom: ' }), document.createTextNode(cur.fields)]),
      el('div', { class: 'sub', text: cur.note })
    ]));
    csvInput.placeholder = cur.sample;
  }

  const hintBox = el('div', { class: 'callout callout-blue' });
  refreshHint();
  entitySelect.addEventListener('change', refreshHint);

  // Baca berkas CSV lokal lalu isi textarea.
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { csvInput.value = String(reader.result || ''); };
    reader.onerror = () => toast('Gagal membaca berkas.', 'err');
    reader.readAsText(file);
  });

  const dlg = modal({
    title: 'Impor Master Data (CSV)',
    sub: 'Baris pertama boleh berisi nama kolom — kalau tidak, urutan kolom mengikuti petunjuk',
    body: [
      grid2Top([
        field('Jenis data', entitySelect, null, true),
        field('Berkas CSV (opsional)', fileInput, 'Atau tempel langsung di kotak bawah.', false)
      ]),
      hintBox,
      field('Isi CSV', csvInput, 'Pemisah koma atau titik koma. Maksimal 500 baris per impor.', true),
      resultWrap
    ],
    footer: [btn('Tutup', { onClick: () => dlg.close() }), submitBtn]
  });

  submitBtn.addEventListener('click', async () => {
    const csv = csvInput.value.trim();
    if (!csv) {
      csvInput.classList.add('input-invalid');
      toast('Isi CSV masih kosong.', 'err');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Mengimpor…';
    resultWrap.innerHTML = '';

    try {
      const target = entitySelect.value;
      const res = target === 'sj'
        ? await sj.import(csv)
        : await master.import(target, csv);

      renderResult(res, target);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Impor Lagi';

      if (target === 'sj') {
        if (res.created > 0 && res.failed === 0) {
          toast(`${res.created} Surat Jalan diimpor (${res.linesCreated} baris).`, 'ok');
        } else if (res.created > 0) {
          toast(`${res.created} SJ dibuat, ${res.failed} baris gagal. Lihat rincian di bawah.`, 'warn');
        } else {
          toast(`Tidak ada SJ yang bisa diimpor (${res.failed} baris gagal).`, 'err');
        }
        if (res.created > 0 && onDone) await onDone();
        return;
      }

      if (res.created > 0 && res.failed === 0) {
        toast(`${res.created} ${ENTITY_INFO[res.entity].label.toLowerCase()} berhasil diimpor.`, 'ok');
      } else if (res.created > 0) {
        toast(`${res.created} berhasil, ${res.failed} gagal. Lihat rincian di bawah.`, 'warn');
      } else {
        toast(`Tidak ada baris yang bisa diimpor (${res.failed} gagal).`, 'err');
      }

      if (res.created > 0 && onDone) await onDone();
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Impor Sekarang';
      toast(err.message || 'Gagal mengimpor', 'err');
    }
  });

  /** Ringkasan hasil impor. */
  function renderResult(res, target) {
    resultWrap.innerHTML = '';

    const summary = target === 'sj'
      ? `${res.created} SJ dibuat (${res.linesCreated} baris), ${res.failed} baris gagal, dari ${res.rows} baris`
      : `${res.created} dibuat, ${res.failed} gagal, dari ${res.rows} baris`;

    resultWrap.appendChild(el('div', { class: 'row-between', style: { marginBottom: '8px' } }, [
      el('div', {}, [
        el('b', { text: 'Hasil impor: ' }),
        document.createTextNode(summary)
      ]),
      el('div', {}, [
        badge(`${res.created} dibuat`, 'b-green'),
        document.createTextNode(' '),
        res.failed ? badge(`${res.failed} gagal`, 'b-red') : null
      ])
    ]));

    if (res.errors && res.errors.length) {
      const rows = res.errors.map((e) => el('tr', {}, [
        el('td', { class: 'num', 'data-label': 'Baris', text: String(e.row) }),
        el('td', { 'data-label': 'SJ', text: e.sj || '—' }),
        el('td', { 'data-label': 'Kode' }, [badge(e.code, 'b-red')]),
        el('td', { 'data-label': 'Pesan', text: e.message })
      ]));
      resultWrap.appendChild(el('table', { class: 'tbl tbl-resp' }, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { class: 'num', text: 'Baris' }),
            el('th', { text: 'SJ' }),
            el('th', { text: 'Kode' }),
            el('th', { text: 'Pesan' })
          ])
        ]),
        el('tbody', {}, rows)
      ]));
    }
  }
}

/** Grid dua kolom sederhana untuk header modal. */
function grid2Top(children) {
  return el('div', { class: 'grid2' }, children);
}
