/**
 * pages/kartu.js — Halaman Kartu Stock (PRD 5).
 *
 * Menampilkan mutasi + saldo berjalan per batch. Saldo tiap baris dihitung
 * server dari SELURUH riwayat batch, sehingga nilai saldo tetap benar walau
 * difilter tanggal (PRD 12.3: jangan hitung ulang di browser).
 */

import { report } from '../api.js';
import { state, fmt, fmtDate } from '../state.js';
import {
  el, btn, panel, emptyBox, skeleton, errorBox, statCard,
  kodeTag, rakTag, batchTag
} from '../ui.js';

const EMPTY_FILTER = { code: '', batch: '', customer: '', from: '', to: '' };

export async function renderKartuPage(view) {
  view.innerHTML = '';

  const filter = Object.assign({}, EMPTY_FILTER, state.filters.kartu || {});
  const resultsWrap = el('div');

  view.appendChild(panel({
    title: 'Filter Kartu Stock',
    sub: 'Kosongkan filter untuk menampilkan semua mutasi',
    body: [buildFilterForm(filter, () => load())]
  }));
  view.appendChild(resultsWrap);

  /** Muat ulang hasil. */
  async function load() {
    resultsWrap.innerHTML = '';
    resultsWrap.appendChild(skeleton(6));
    try {
      const data = await report.kartuStock({
        code: filter.code.trim(),
        batch: filter.batch.trim(),
        customerId: filter.customer,
        from: filter.from,
        to: filter.to
      });
      resultsWrap.innerHTML = '';

      if (data.totals.rows === 0 && !data.filtered) {
        resultsWrap.appendChild(panel({
          title: 'Kartu Stock',
          sub: 'Belum ada mutasi',
          body: [emptyBox('Belum ada mutasi tercatat',
            'Mutasi muncul setelah penerimaan fisik atau pengiriman.')]
        }));
        return;
      }

      resultsWrap.appendChild(buildCards(data));
      resultsWrap.appendChild(buildTable(data, filter, () => {
        Object.assign(filter, EMPTY_FILTER);
        state.filters.kartu = Object.assign({}, EMPTY_FILTER);
        renderKartuPage(view);
      }));
    } catch (err) {
      resultsWrap.innerHTML = '';
      resultsWrap.appendChild(errorBox(err));
    }
  }

  await load();
}

/** Form filter. */
function buildFilterForm(filter, onReload) {
  const form = el('div', { class: 'ks-form' });

  const codeInput = el('input', { type: 'text', placeholder: 'PRD-001', value: filter.code });
  const batchInput = el('input', { type: 'text', placeholder: 'BN-20261110-001', value: filter.batch });

  const customerSelect = el('select');
  customerSelect.appendChild(el('option', { value: '', text: '— Semua Pelanggan —' }));
  for (const c of state.master.customers) {
    const opt = el('option', { value: c.id, text: c.name });
    if (c.id === filter.customer) opt.selected = true;
    customerSelect.appendChild(opt);
  }

  const fromInput = el('input', { type: 'date', value: filter.from });
  const toInput = el('input', { type: 'date', value: filter.to });

  const apply = () => { state.filters.kartu = Object.assign({}, filter); onReload(); };

  codeInput.addEventListener('change', () => { filter.code = codeInput.value; apply(); });
  batchInput.addEventListener('change', () => { filter.batch = batchInput.value; apply(); });
  customerSelect.addEventListener('change', () => { filter.customer = customerSelect.value; apply(); });
  fromInput.addEventListener('change', () => { filter.from = fromInput.value; apply(); });
  toInput.addEventListener('change', () => { filter.to = toInput.value; apply(); });

  const field = (label, control) => el('div', { class: 'field', style: { margin: '0' } }, [
    el('label', { text: label }),
    control
  ]);

  form.append(
    field('Kode Produk', codeInput),
    field('No. Batch', batchInput),
    field('Pelanggan', customerSelect),
    field('Dari Tanggal', fromInput),
    field('Sampai Tanggal', toInput),
    el('div', { class: 'field', style: { margin: '0' } }, [
      el('label', { text: '\u00a0' }),
      btn('↺ Reset Filter', {
        onClick: () => {
          Object.assign(filter, EMPTY_FILTER);
          state.filters.kartu = Object.assign({}, EMPTY_FILTER);
          onReload();
        }
      })
    ])
  );
  return form;
}

/** Kartu ringkasan. */
function buildCards(data) {
  const t = data.totals;
  const wrap = el('div', { class: 'cards' });
  wrap.append(
    statCard('Total Masuk', fmt(t.in), 'unit',
      data.filtered ? 'Sesuai filter' : 'Semua penerimaan', '#0e9f6e'),
    statCard('Total Keluar', fmt(t.out), 'unit',
      data.filtered ? 'Sesuai filter' : 'Semua pengiriman', '#2563eb'),
    statCard('Saldo Akhir Batch', fmt(t.balance), 'unit',
      'Sisa akhir batch terpilih', '#4f46e5'),
    statCard('Batch Terlibat', fmt(t.batches), 'batch',
      data.filtered ? 'Hasil filter' : 'Semua batch', '#9333ea')
  );
  return wrap;
}

/** Tabel mutasi dengan saldo berjalan. */
function buildTable(data, filter, onReset) {
  const hasFilter = Boolean(filter.code || filter.batch || filter.customer || filter.from || filter.to);

  if (!data.totals.rows) {
    return panel({
      title: 'Kartu Stock — Penelusuran Mutasi',
      sub: 'Tidak ada mutasi cocok filter',
      actions: [btn('Reset filter', { sm: true, onClick: onReset })],
      body: [emptyBox('Tidak ada mutasi',
        'Tidak ada mutasi yang cocok dengan filter. Coba ubah atau reset filter.')]
    });
  }

  const rows = data.items.map((m) => {
    const tr = el('tr', { class: m.isGroupStart ? 'batch-start' : null });
    tr.append(
      el('td', { 'data-label': 'Tanggal', text: fmtDate(m.date) }),
      el('td', { 'data-label': 'Pelanggan', text: m.customerName }),
      el('td', { 'data-label': 'Referensi' }, [
        el('div', { class: 'mono', text: m.ref }),
        el('span', {
          class: 'ref-type ' + (m.in > 0 ? 'ref-in' : 'ref-out'),
          text: m.in > 0 ? 'MASUK' : 'KELUAR'
        }),
        m.sjRef && m.type === 'CONSIGN_OUT'
          ? el('div', { class: 'sub', text: `dari SJ ${m.sjRef}` })
          : null
      ]),
      el('td', { 'data-label': 'Kode Produk' }, [kodeTag(m.productCode)]),
      el('td', { 'data-label': 'Batch' }, [batchTag(m.batchNumber)]),
      el('td', { 'data-label': 'Rak' }, [rakTag(m.rackCode)]),
      el('td', { class: 'in-cell', 'data-label': 'Masuk', text: m.in ? '+' + fmt(m.in) : '—' }),
      el('td', { class: 'out-cell', 'data-label': 'Keluar', text: m.out ? '−' + fmt(m.out) : '—' }),
      el('td', {
        class: 'num ' + (m.isGroupEnd ? 'balance-final' : 'saldo-cell'),
        'data-label': 'Saldo',
        text: fmt(m.balance)
      })
    );
    return tr;
  });

  return panel({
    title: 'Kartu Stock — Penelusuran Mutasi',
    sub: `${data.totals.rows} mutasi ${hasFilter ? 'cocok filter' : 'tercatat'} • saldo berjalan per batch`,
    actions: hasFilter ? [btn('Reset filter', { sm: true, onClick: onReset })] : null,
    body: [
      el('table', { class: 'tbl tbl-resp ks-tbl' }, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { text: 'Tanggal' }),
            el('th', { text: 'Pelanggan' }),
            el('th', { text: 'Referensi' }),
            el('th', { text: 'Kode Produk' }),
            el('th', { text: 'Batch' }),
            el('th', { text: 'Rak' }),
            el('th', { class: 'num', text: 'Masuk' }),
            el('th', { class: 'num', text: 'Keluar' }),
            el('th', { class: 'num', text: 'Saldo' })
          ])
        ]),
        el('tbody', {}, rows)
      ])
    ]
  });
}
