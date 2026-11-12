/**
 * pages/stok.js — Halaman Stok Titipan (PRD 6.6).
 *
 * Stok TIDAK dihitung di browser: seluruh sisa batch datang dari `stock.list`
 * (server menghitung receipts − shipment_consumptions non-VOID/DRAFT).
 */

import { stock } from '../api.js';
import { state, fmt, fmtDate } from '../state.js';
import {
  el, panel, emptyBox, skeleton, errorBox, searchInput, statCard,
  kodeTag, rakTag, batchTag, sub
} from '../ui.js';

export async function renderStokPage(view) {
  view.innerHTML = '';

  const cardsWrap = el('div', { class: 'cards' });
  const tableWrap = el('div');
  const filter = {
    q: state.filters.stok || '',
    customerId: state.filters.stokCustomer || ''
  };

  const customerSelect = el('select', { class: 'input' });
  customerSelect.appendChild(el('option', { value: '', text: 'Semua pelanggan' }));
  for (const c of state.master.customers) {
    const opt = el('option', { value: c.id, text: c.name });
    if (c.id === filter.customerId) opt.selected = true;
    customerSelect.appendChild(opt);
  }
  customerSelect.addEventListener('change', () => {
    filter.customerId = customerSelect.value;
    state.filters.stokCustomer = customerSelect.value;
    load();
  });

  view.appendChild(cardsWrap);
  view.appendChild(panel({
    title: 'Posisi Stok per Batch',
    sub: 'Hanya batch dengan sisa > 0',
    actions: [
      customerSelect,
      searchInput('Cari batch / produk / pelanggan…', filter.q, (v) => {
        filter.q = v;
        state.filters.stok = v;
        load();
      })
    ],
    body: [tableWrap]
  }));

  /** Muat ulang data stok. */
  async function load() {
    tableWrap.innerHTML = '';
    tableWrap.appendChild(skeleton(6));
    try {
      const data = await stock.list({ q: filter.q, customerId: filter.customerId });

      cardsWrap.innerHTML = '';
      cardsWrap.append(
        statCard('Total Batch Tersedia', fmt(data.totals.batches), 'batch',
          'Batch dengan sisa > 0', '#4f46e5'),
        statCard('Total Qty Titipan', fmt(data.totals.qty), 'unit',
          'Seluruh pelanggan', '#0e9f6e'),
        statCard('Pelanggan Berstok', fmt(data.totals.customers), 'pelanggan',
          'Punya barang titipan', '#1d4ed8'),
        statCard('Rata-rata per Batch',
          data.totals.batches ? fmt(Math.round(data.totals.qty / data.totals.batches)) : '0',
          'unit', 'Qty ÷ batch', '#96620a')
      );

      tableWrap.innerHTML = '';
      if (!data.items.length) {
        tableWrap.appendChild(emptyBox(
          filter.q || filter.customerId ? 'Tidak ada batch yang cocok' : 'Belum ada stok titipan',
          filter.q || filter.customerId
            ? 'Ubah filter atau kata kunci.'
            : 'Stok muncul setelah penerimaan fisik dikonfirmasi di halaman Penerimaan SJ.'
        ));
        return;
      }

      if (data.perCustomer.length > 1 || filter.customerId) {
        tableWrap.appendChild(buildCustomerSummary(data.perCustomer));
      }
      tableWrap.appendChild(buildBatchTable(data.items));
    } catch (err) {
      tableWrap.innerHTML = '';
      tableWrap.appendChild(errorBox(err));
    }
  }

  await load();
}

/** Ringkasan qty per pelanggan. */
function buildCustomerSummary(perCustomer) {
  const wrap = el('div', { class: 'cust-summary' });
  for (const c of perCustomer) {
    wrap.appendChild(el('div', { class: 'cust-chip' }, [
      el('span', { class: 'cust-chip-name', text: c.customerName }),
      el('b', { text: fmt(c.qty) }),
      el('span', { class: 'sub', text: `${c.batches} batch` })
    ]));
  }
  return wrap;
}

/** Tabel batch. */
function buildBatchTable(items) {
  const rows = items.map((b) => el('tr', {}, [
    el('td', { 'data-label': 'Batch' }, [
      el('div', {}, [batchTag(b.batchNumber)]),
      sub(`Masuk ${fmtDate(b.date)}`)
    ]),
    el('td', { 'data-label': 'Produk' }, [
      el('div', {}, [el('b', { text: b.productName })]),
      el('div', { class: 'sub' }, [kodeTag(b.productCode)])
    ]),
    el('td', { 'data-label': 'Pelanggan' }, [
      el('div', { text: b.customerName }),
      el('div', { class: 'sub' }, [
        document.createTextNode('SJ '),
        el('span', { class: 'mono', text: b.sjNo || '—' })
      ])
    ]),
    el('td', { 'data-label': 'Rak' }, [rakTag(b.rackCode)]),
    el('td', { class: 'num', 'data-label': 'Qty Masuk' }, [
      document.createTextNode(`${fmt(b.qtyIn)} `),
      sub(b.unit)
    ]),
    el('td', { class: 'num', 'data-label': 'Sisa' }, [
      el('b', { class: 'sisa-ok', text: fmt(b.available) }),
      document.createTextNode(` ${b.unit}`)
    ]),
    el('td', { 'data-label': 'Kondisi' }, [el('span', { text: b.kondisi || '—' })])
  ]));

  return el('table', { class: 'tbl tbl-resp' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Batch' }),
        el('th', { text: 'Produk' }),
        el('th', { text: 'Pelanggan' }),
        el('th', { text: 'Rak' }),
        el('th', { class: 'num', text: 'Qty Masuk' }),
        el('th', { class: 'num', text: 'Sisa' }),
        el('th', { text: 'Kondisi' })
      ])
    ]),
    el('tbody', {}, rows)
  ]);
}
