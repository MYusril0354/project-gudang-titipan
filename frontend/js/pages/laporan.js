/**
 * pages/laporan.js — Halaman Rekonsiliasi (PRD 5 & 6).
 *
 * Menampilkan total masuk/keluar/stok, pemeriksaan keseimbangan
 * (stok dari batch vs stok dari mutasi), exception report, dan riwayat mutasi.
 */

import { report } from '../api.js';
import { fmt, fmtDate } from '../state.js';
import {
  el, btn, badge, panel, callout, emptyBox, skeleton, errorBox,
  statCard, navigate, sub, kodeTag, rakTag, batchTag
} from '../ui.js';

/** Badge umur pending. */
function umurBadge(days) {
  const cls = days > 30 ? 'b-red' : days > 7 ? 'b-amber' : 'b-gray';
  return badge(`${days} hari`, cls);
}

/** Label tipe mutasi. */
const TYPE_META = {
  CONSIGN_IN: { label: 'Masuk', cls: 'b-green', dir: 'in' },
  CONSIGN_OUT: { label: 'Keluar', cls: 'b-blue', dir: 'out' },
  VOID_OUT: { label: 'Kembali (void)', cls: 'b-amber', dir: 'in' }
};

export async function renderLaporanPage(view) {
  view.innerHTML = '';

  const cardsWrap = el('div', { class: 'cards' });
  const bodyWrap = el('div');
  view.appendChild(cardsWrap);
  view.appendChild(bodyWrap);

  try {
    const data = await report.reconciliation();
    cardsWrap.innerHTML = '';
    cardsWrap.append(
      statCard('Total Masuk', fmt(data.totalIn), 'unit',
        'Akumulasi penerimaan fisik', '#0e9f6e'),
      statCard('Total Keluar', fmt(data.totalOut), 'unit',
        'Akumulasi pengiriman', '#2563eb'),
      statCard('Stok Titipan', fmt(data.stock), 'unit',
        'Masuk − keluar', '#4f46e5'),
      statCard('Selisih Menggantung', fmt(data.hanging), 'unit',
        'Sudah potong stok existing', '#b42318')
    );

    bodyWrap.innerHTML = '';
    bodyWrap.appendChild(buildBalanceCheck(data));
    bodyWrap.appendChild(buildExceptions(data.exceptions));
    bodyWrap.appendChild(buildMovements(data.recentMovements));
  } catch (err) {
    bodyWrap.innerHTML = '';
    bodyWrap.appendChild(errorBox(err));
  }
}

/**
 * Pemeriksaan keseimbangan: stok dari batch (receipts − pemakaian) harus sama
 * dengan stok dari akumulasi mutasi. Bila beda, ada data tidak konsisten.
 */
function buildBalanceCheck(data) {
  const c = data.checks;
  const balanced = c.balanced;

  const body = [
    el('div', { class: 'recon-grid' }, [
      reconCell('Stok dari batch', c.stockFromBatches, 'receipts − pemakaian pengiriman'),
      reconCell('Stok dari mutasi', c.stockFromMovements, 'Σ mutasi masuk − keluar'),
      reconCell('Selisih (variance)', data.variance, 'Harus 0')
    ]),
    el('div', { class: 'row-between', style: { marginTop: '4px' } }, [
      el('span', { class: 'sub',
        text: `${data.totals.batches} batch • ${data.totals.movements} mutasi • `
          + `${data.totals.sj} SJ • ${data.totals.shipments} pengiriman` }),
      balanced
        ? badge('Seimbang', 'b-green')
        : badge(`Selisih ${fmt(data.variance)}`, 'b-red')
    ])
  ];

  return panel({
    title: 'Pemeriksaan Keseimbangan',
    sub: 'Masuk − Keluar harus sama dengan stok titipan, tanpa selisih',
    body: [el('div', { style: { padding: '16px 18px' } }, body)]
  });
}

function reconCell(label, value, note) {
  return el('div', { class: 'recon-cell' }, [
    el('div', { class: 'stat-label', text: label }),
    el('div', { class: 'recon-value', text: fmt(value) }),
    el('div', { class: 'sub', text: note })
  ]);
}

/** Exception report: SJ sudah potong stok tapi fisik belum diterima. */
function buildExceptions(items) {
  const body = [];

  if (!items.length) {
    body.push(emptyBox('Tidak ada selisih', 'Semua baris surat jalan sudah ada fisiknya.'));
  } else {
    const rows = items.map((r) => el('tr', {}, [
      el('td', { 'data-label': 'Surat Jalan' }, [
        el('div', { class: 'mono', text: r.sjNo }),
        sub(fmtDate(r.sjDate))
      ]),
      el('td', { 'data-label': 'Pelanggan', text: r.customerName }),
      el('td', { 'data-label': 'Produk / Kode' }, [
        el('div', { text: r.productName }),
        el('div', { class: 'sub' }, [kodeTag(r.productCode)])
      ]),
      el('td', { class: 'num', 'data-label': 'Qty Menggantung' }, [
        el('b', { text: fmt(r.pending) }),
        document.createTextNode(` ${r.unit}`)
      ]),
      el('td', { 'data-label': 'Umur' }, [umurBadge(r.umurDays)]),
      el('td', { 'data-label': 'Alasan', text: r.alasanLabel || '—' }),
      el('td', { class: 'num', 'data-label': '' }, [
        btn('Tinjau', { sm: true, onClick: () => navigate('pending') })
      ])
    ]));

    body.push(el('table', { class: 'tbl tbl-resp' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { text: 'Surat Jalan' }),
          el('th', { text: 'Pelanggan' }),
          el('th', { text: 'Produk / Kode' }),
          el('th', { class: 'num', text: 'Qty Menggantung' }),
          el('th', { text: 'Umur' }),
          el('th', { text: 'Alasan' }),
          el('th', { class: 'num', text: '' })
        ])
      ]),
      el('tbody', {}, rows)
    ]));
  }

  return panel({
    title: 'Exception Report',
    sub: 'SJ sudah potong stok existing, fisik belum diterima',
    body
  });
}

/** Riwayat mutasi terakhir. */
function buildMovements(items) {
  const body = [];

  if (!items.length) {
    body.push(emptyBox('Belum ada mutasi'));
  } else {
    const rows = items.map((m) => {
      const meta = TYPE_META[m.type] || { label: m.type, cls: 'b-gray', dir: m.qty > 0 ? 'in' : 'out' };
      return el('tr', {}, [
        el('td', { 'data-label': 'Tanggal', text: fmtDate(m.date) }),
        el('td', { 'data-label': 'Tipe' }, [badge(meta.label, meta.cls)]),
        el('td', { 'data-label': 'Referensi' }, [
          el('div', { class: 'mono', text: m.ref }),
          m.sjRef && m.type === 'CONSIGN_OUT'
            ? el('div', { class: 'sub', text: `dari SJ ${m.sjRef}` })
            : null
        ]),
        el('td', { 'data-label': 'Batch' }, [m.batchNumber ? batchTag(m.batchNumber) : el('span', { text: '—' })]),
        el('td', { 'data-label': 'Pelanggan', text: m.customerName }),
        el('td', { 'data-label': 'Produk' }, [
          el('div', { text: m.productName }),
          el('div', { class: 'sub' }, [kodeTag(m.productCode)])
        ]),
        el('td', { 'data-label': 'Rak' }, [rakTag(m.rackCode)]),
        el('td', {
          class: 'num ' + (m.qty > 0 ? 'in-cell' : 'out-cell'),
          'data-label': 'Qty',
          text: (m.qty > 0 ? '+' : '') + fmt(m.qty)
        })
      ]);
    });

    body.push(el('table', { class: 'tbl tbl-resp' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { text: 'Tanggal' }),
          el('th', { text: 'Tipe' }),
          el('th', { text: 'Referensi' }),
          el('th', { text: 'Batch' }),
          el('th', { text: 'Pelanggan' }),
          el('th', { text: 'Produk' }),
          el('th', { text: 'Rak' }),
          el('th', { class: 'num', text: 'Qty' })
        ])
      ]),
      el('tbody', {}, rows)
    ]));
  }

  return panel({
    title: 'Riwayat Mutasi',
    sub: `${items.length} mutasi terakhir dengan batch & SJ referensi`,
    body
  });
}
