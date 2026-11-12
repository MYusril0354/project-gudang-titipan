/**
 * pages/dashboard.js — Halaman Dashboard (PRD 5).
 *
 * Semua angka datang dari `dashboard.summary` — tidak ada perhitungan bisnis
 * di browser (PRD 12.3).
 */

import { dashboard } from '../api.js';
import { fmt, fmtDate } from '../state.js';
import {
  el, btn, badge, panel, callout, emptyBox, errorBox,
  statCard, navigate, sub, kodeTag
} from '../ui.js';

/** Badge umur pending. */
function umurBadge(days) {
  const cls = days > 30 ? 'b-red' : days > 7 ? 'b-amber' : 'b-gray';
  return badge(`${days} hari`, cls);
}

export async function renderDashboardPage(view) {
  view.innerHTML = '';

  const cardsWrap = el('div', { class: 'cards' });
  const bodyWrap = el('div');
  view.appendChild(cardsWrap);
  view.appendChild(bodyWrap);

  try {
    const data = await dashboard.summary();
    cardsWrap.innerHTML = '';
    cardsWrap.append(
      statCard('Stok Titipan', fmt(data.stockTotal), 'unit',
        `${data.stockBatches} batch • ${data.stockCustomers} pelanggan`, '#4f46e5'),
      statCard('Fisik Belum Ada', fmt(data.pendingPhysical), 'unit',
        `${data.pendingRows} baris • tertua ${data.oldestPendingDays} hari`, '#d97706'),
      statCard('SJ Belum Selesai', fmt(data.sjNotFinished), 'SJ',
        `${data.openLines} baris belum diklasifikasi`, '#2563eb'),
      statCard('Belum Ada POD', fmt(data.notDelivered), 'DO',
        'Pengiriman keluar, bukti terima belum masuk', '#0e9f6e')
    );

    bodyWrap.innerHTML = '';

    if (data.pendingRows > 0) {
      bodyWrap.appendChild(callout(
        `Perhatian: ${data.pendingRows} baris surat jalan sudah memotong stok di sistem existing, `
          + `tetapi fisiknya belum diterima di gudang titipan. Total ${fmt(data.pendingPhysical)} unit menggantung.`,
        'amber'
      ));
    }

    bodyWrap.appendChild(buildTopPending(data.topPending));
    bodyWrap.appendChild(buildStockByCustomer(data.stockByCustomer));
  } catch (err) {
    bodyWrap.innerHTML = '';
    bodyWrap.appendChild(errorBox(err));
  }
}

/** Panel pending prioritas (maks 5 baris dari server). */
function buildTopPending(items) {
  const body = [];

  if (!items.length) {
    body.push(emptyBox('Tidak ada pending fisik', 'Semua baris surat jalan sudah diklasifikasi.'));
  } else {
    const rows = items.map((r) => el('tr', {}, [
      el('td', { 'data-label': 'Surat Jalan' }, [
        el('div', { class: 'mono', text: r.sjNo }),
        sub(fmtDate(r.sjDate))
      ]),
      el('td', { 'data-label': 'Pelanggan', text: r.customerName }),
      el('td', { 'data-label': 'Produk' }, [
        el('div', { text: r.productName }),
        el('div', { class: 'sub' }, [kodeTag(r.productCode)])
      ]),
      el('td', { class: 'num', 'data-label': 'Qty Pending' }, [
        el('b', { text: fmt(r.pending) }),
        document.createTextNode(` ${r.unit}`)
      ]),
      el('td', { 'data-label': 'Umur' }, [umurBadge(r.umurDays)]),
      el('td', { 'data-label': 'ETA', text: fmtDate(r.eta) }),
      el('td', { class: 'num', 'data-label': '' }, [
        btn('Tinjau', { sm: true, onClick: () => navigate('pending') })
      ])
    ]));

    body.push(el('table', { class: 'tbl tbl-resp' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { text: 'Surat Jalan' }),
          el('th', { text: 'Pelanggan' }),
          el('th', { text: 'Produk' }),
          el('th', { class: 'num', text: 'Qty Pending' }),
          el('th', { text: 'Umur' }),
          el('th', { text: 'ETA' }),
          el('th', { class: 'num', text: '' })
        ])
      ]),
      el('tbody', {}, rows)
    ]));
  }

  return panel({
    title: 'Pending Fisik — Prioritas',
    sub: 'Diurutkan berdasarkan umur titipan',
    actions: [btn('Lihat semua', { onClick: () => navigate('pending') })],
    body
  });
}

/** Panel stok per pelanggan. */
function buildStockByCustomer(items) {
  const body = [];

  if (!items.length) {
    body.push(emptyBox('Belum ada stok titipan', 'Stok muncul setelah penerimaan fisik dikonfirmasi.'));
  } else {
    const rows = items.map((c) => el('tr', {}, [
      el('td', { 'data-label': 'Pelanggan' }, [
        el('b', { text: c.customerName }),
        sub(`${c.batches} batch`)
      ]),
      el('td', { class: 'num', 'data-label': 'Qty Titipan' }, [
        el('b', { text: fmt(c.qty) }),
        document.createTextNode(' unit')
      ])
    ]));

    body.push(el('table', { class: 'tbl tbl-resp' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { text: 'Pelanggan' }),
          el('th', { class: 'num', text: 'Qty Titipan' })
        ])
      ]),
      el('tbody', {}, rows)
    ]));
  }

  return panel({
    title: 'Stok per Pelanggan',
    sub: 'Sisa barang titipan yang masih ada di gudang',
    actions: [btn('Detail stok', { onClick: () => navigate('stok') })],
    body
  });
}
