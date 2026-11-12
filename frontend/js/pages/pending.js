/**
 * pages/pending.js — Halaman Fisik Belum Ada (PRD 6.4).
 *
 * Dua bagian:
 *  1. Antrean pending (baris WAITING_PHYSICAL / PARTIALLY_RECEIVED) + bucket umur.
 *  2. Baris belum diklasifikasi (OPEN) — masih bisa langsung Fisik Ada / Belum Ada.
 *
 * Umur, bucket, dan seluruh total dihitung server (pending.list).
 */

import { pending } from '../api.js';
import { state, fmt, fmtDate } from '../state.js';
import {
  el, btn, badge, panel, emptyBox, skeleton, errorBox,
  searchInput, statCard, sub, kodeTag
} from '../ui.js';
import { openReceive, openWait, openCancel } from '../modals/sj.js';

/** Badge umur pending (PRD: 0–7 SLA, >30 eskalasi). */
function umurBadge(days) {
  const cls = days > 30 ? 'b-red' : days > 7 ? 'b-amber' : 'b-gray';
  return badge(`${days} hari`, cls);
}

export async function renderPendingPage(view) {
  view.innerHTML = '';

  const cardsWrap = el('div', { class: 'cards' });
  const queueWrap = el('div');
  const openWrap = el('div');
  const filter = { q: state.filters.pending || '' };

  view.appendChild(cardsWrap);
  view.appendChild(panel({
    title: 'Antrean Penerimaan Fisik',
    sub: 'Klik "Fisik Ada" untuk membuat batch baru dari SJ ini',
    actions: [
      searchInput('Cari SJ / pelanggan / produk…', filter.q, (v) => {
        filter.q = v;
        state.filters.pending = v;
        load();
      })
    ],
    body: [queueWrap]
  }));
  view.appendChild(openWrap);

  const reload = () => renderPendingPage(view);

  /** Muat ulang data. */
  async function load() {
    queueWrap.innerHTML = '';
    queueWrap.appendChild(skeleton(6));
    try {
      const data = await pending.list({ q: filter.q });

      // Kartu ringkasan — angka dari server.
      cardsWrap.innerHTML = '';
      cardsWrap.append(
        statCard('Total Baris Pending', fmt(data.totals.rows), 'baris',
          'Menunggu konfirmasi fisik', '#d97706'),
        statCard('Total Qty Pending', fmt(data.totals.qty), 'unit',
          'Belum masuk stok titipan', '#b45309'),
        statCard('Umur 0–7 hari', fmt(data.buckets.d0_7), 'baris',
          'Masih dalam SLA', '#2563eb'),
        statCard('Umur > 30 hari', fmt(data.buckets.gt30), 'baris',
          'Perlu eskalasi', '#b42318')
      );

      // Antrean pending
      queueWrap.innerHTML = '';
      if (!data.items.length) {
        queueWrap.appendChild(emptyBox(
          filter.q ? 'Tidak ada pending yang cocok' : 'Tidak ada pending fisik',
          filter.q ? 'Ubah kata kunci pencarian.' : 'Semua baris SJ sudah diklasifikasi.'
        ));
      } else {
        queueWrap.appendChild(buildQueueTable(data.items, reload));
      }

      // Belum diklasifikasi
      openWrap.innerHTML = '';
      openWrap.appendChild(panel({
        title: 'Belum Diklasifikasi',
        sub: data.totals.openRows
          ? `${data.totals.openRows} baris menunggu keputusan Fisik Ada / Belum Ada`
          : 'Semua sudah diklasifikasi',
        body: [data.openItems.length
          ? buildOpenTable(data.openItems, reload)
          : emptyBox('Semua sudah diklasifikasi',
            'Baris baru akan muncul di sini setelah SJ ditambahkan.')]
      }));
    } catch (err) {
      queueWrap.innerHTML = '';
      queueWrap.appendChild(errorBox(err));
    }
  }

  await load();
}

/** Tabel antrean pending. */
function buildQueueTable(items, reload) {
  const rows = items.map((r) => {
    const ctx = {
      sjNo: r.sjNo,
      lineId: r.lineId,
      productName: r.productName,
      productCode: r.productCode,
      unit: r.unit,
      pending: r.pending,
      customerName: r.customerName,
      customerId: r.customerId,
      alasan: r.alasan,
      eta: r.eta,
      pic: r.pic
    };

    const actions = el('div', { class: 'btn-group' }, [
      btn('Fisik Ada', { variant: 'ok', sm: true, onClick: () => openReceive(ctx, reload) }),
      btn('Batalkan', { variant: 'danger', sm: true, onClick: () => openCancel(ctx, reload) })
    ]);

    return el('tr', {}, [
      el('td', { 'data-label': 'Surat Jalan' }, [
        el('div', { class: 'mono', text: r.sjNo }),
        sub(fmtDate(r.sjDate))
      ]),
      el('td', { 'data-label': 'Pelanggan' }, [el('b', { text: r.customerName })]),
      el('td', { 'data-label': 'Produk' }, [
        el('div', { text: r.productName }),
        el('div', { class: 'sub' }, [kodeTag(r.productCode)])
      ]),
      el('td', { class: 'num', 'data-label': 'Qty SJ', text: fmt(r.qtySj) }),
      el('td', { class: 'num', 'data-label': 'Diterima', text: fmt(r.qtyReceived) }),
      el('td', { class: 'num', 'data-label': 'Pending' }, [el('b', { text: fmt(r.pending) })]),
      el('td', { 'data-label': 'Umur' }, [umurBadge(r.umurDays)]),
      el('td', { 'data-label': 'Alasan' }, [
        el('div', { text: r.alasanLabel || '—' }),
        sub(`PIC ${r.pic || '—'}`)
      ]),
      el('td', { 'data-label': 'ETA', text: fmtDate(r.eta) }),
      el('td', { class: 'num', 'data-label': '' }, [actions])
    ]);
  });

  return el('table', { class: 'tbl tbl-resp' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Surat Jalan' }),
        el('th', { text: 'Pelanggan' }),
        el('th', { text: 'Produk' }),
        el('th', { class: 'num', text: 'Qty SJ' }),
        el('th', { class: 'num', text: 'Diterima' }),
        el('th', { class: 'num', text: 'Pending' }),
        el('th', { text: 'Umur' }),
        el('th', { text: 'Alasan' }),
        el('th', { text: 'ETA' }),
        el('th', { class: 'num', text: 'Aksi' })
      ])
    ]),
    el('tbody', {}, rows)
  ]);
}

/** Tabel baris OPEN yang belum diklasifikasi. */
function buildOpenTable(items, reload) {
  const rows = items.map((r) => {
    const ctx = {
      sjNo: r.sjNo,
      lineId: r.lineId,
      productName: r.productName,
      productCode: r.productCode,
      unit: r.unit,
      pending: r.pending,
      customerName: r.customerName,
      customerId: r.customerId,
      alasan: '',
      eta: '',
      pic: ''
    };

    const actions = el('div', { class: 'btn-group' }, [
      btn('Fisik Ada', { variant: 'ok', sm: true, onClick: () => openReceive(ctx, reload) }),
      btn('Fisik Belum Ada', { variant: 'warn', sm: true, onClick: () => openWait(ctx, reload) })
    ]);

    return el('tr', {}, [
      el('td', { class: 'mono', 'data-label': 'Surat Jalan', text: r.sjNo }),
      el('td', { 'data-label': 'Pelanggan', text: r.customerName }),
      el('td', { 'data-label': 'Produk' }, [
        document.createTextNode(r.productName + ' '),
        kodeTag(r.productCode)
      ]),
      el('td', { class: 'num', 'data-label': 'Qty', text: fmt(r.pending) }),
      el('td', { class: 'num', 'data-label': '' }, [actions])
    ]);
  });

  return el('table', { class: 'tbl tbl-resp' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Surat Jalan' }),
        el('th', { text: 'Pelanggan' }),
        el('th', { text: 'Produk' }),
        el('th', { class: 'num', text: 'Qty' }),
        el('th', { class: 'num', text: 'Aksi' })
      ])
    ]),
    el('tbody', {}, rows)
  ]);
}
