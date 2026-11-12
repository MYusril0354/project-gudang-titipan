/**
 * pages/penerimaan.js — Halaman Penerimaan SJ (PRD 5 & 6.1–6.5).
 *
 * Satu kartu per Surat Jalan berisi tabel baris dengan aksi sesuai status:
 *  OPEN               -> Fisik Ada / Fisik Belum Ada
 *  WAITING_PHYSICAL   -> Fisik Ada / Batalkan
 *  PARTIALLY_RECEIVED -> Fisik Ada / Batalkan sisa
 *  RECEIVED|CANCELLED -> (tidak ada aksi)
 *
 * Semua status datang dari server — halaman ini tidak menghitung apa pun.
 */

import { sj } from '../api.js';
import { state, fmt, fmtDate, STATUS_META } from '../state.js';
import {
  el, btn, badge, panel, callout, emptyBox, skeleton, errorBox,
  searchInput, toast, sub, kodeTag, rakTag, batchTag, progressBar
} from '../ui.js';import { openCreateSJ } from '../modals/sj-create.js';
import { openReceive, openWait, openCancel } from '../modals/sj.js';

/**
 * Render halaman. Dipanggil main.js pada setiap navigasi.
 * @param {HTMLElement} view
 */
export async function renderPenerimaanPage(view) {
  view.innerHTML = '';

  view.appendChild(callout(
    'Alur: tambah SJ sebagai dokumen masuk, lalu tiap Fisik Ada menciptakan batch '
    + 'dengan Nomor Batch yang mengalir ke stok, pengiriman, dan surat jalan.',
    'blue'
  ));

  const listWrap = el('div');
  const filter = { q: state.filters.penerimaan || '' };

  view.appendChild(panel({
    title: 'Daftar Surat Jalan',
    sub: 'Memuat…',
    actions: [
      searchInput('Cari no SJ / pelanggan / PO…', filter.q, (v) => {
        filter.q = v;
        state.filters.penerimaan = v;
        load();
      }),
      btn('+ Tambah Penerimaan SJ', {
        variant: 'primary',
        onClick: () => {
          if (!state.master.customers.length || !state.master.products.length) {
            toast('Lengkapi Master Data (pelanggan & produk) terlebih dahulu.', 'err');
            return;
          }
          openCreateSJ(load);
        }
      })
    ],
    body: [listWrap]
  }));

  const panelSub = view.querySelector('.panel-sub');

  /** Muat ulang daftar SJ. */
  async function load() {
    listWrap.innerHTML = '';
    listWrap.appendChild(skeleton(6));
    try {
      const data = await sj.list({ q: filter.q });
      if (panelSub) {
        panelSub.textContent = `${data.total} SJ terdaftar · ${data.counts.waitingPhysical} pending · `
          + `${data.counts.open} belum diklasifikasi`;
      }
      listWrap.innerHTML = '';
      if (!data.items.length) {
        listWrap.appendChild(emptyBox(
          filter.q ? 'Tidak ada SJ yang cocok' : 'Belum ada Surat Jalan',
          filter.q ? 'Ubah kata kunci pencarian.' : 'Klik "+ Tambah Penerimaan SJ" untuk memulai.'
        ));
        return;
      }
      for (const item of data.items) listWrap.appendChild(buildCard(item));
    } catch (err) {
      listWrap.innerHTML = '';
      listWrap.appendChild(errorBox(err));
    }
  }

  await load();
}

/** Kartu satu SJ. */
function buildCard(item) {
  const meta = STATUS_META[item.status] || STATUS_META.OPEN;

  const head = el('div', { class: 'sj-head' }, [
    el('div', {}, [
      el('div', { class: 'sj-no', text: item.no }),
      el('div', { class: 'sj-meta' }, [
        el('span', {}, [
          document.createTextNode('Tanggal '),
          el('b', { text: fmtDate(item.date) })
        ]),
        el('span', {}, [
          document.createTextNode('Pelanggan '),
          el('b', { text: item.customerName })
        ]),
        el('span', {}, [
          document.createTextNode('PO '),
          el('b', { text: item.po || '—' })
        ])
      ])
    ]),
    el('div', {}, [badge(meta.label, meta.cls)])
  ]);

  const rows = item.lines.map((line) => buildLineRow(item, line));
  const table = el('table', { class: 'tbl tbl-resp' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Produk / Kode' }),
        el('th', { class: 'num', text: 'Qty SJ' }),
        el('th', { class: 'num', text: 'Diterima · Batch · Rak' }),
        el('th', { class: 'num', text: 'Pending' }),
        el('th', { text: 'Status' }),
        el('th', { class: 'num', text: 'Aksi' })
      ])
    ]),
    el('tbody', {}, rows)
  ]);

  return el('div', { class: 'sj-card' }, [head, table]);
}

/** Satu baris SJ + aksi sesuai status. */
function buildLineRow(sjItem, line) {
  const meta = STATUS_META[line.status] || STATUS_META.OPEN;

  // Kolom produk
  const productCell = el('td', { 'data-label': 'Produk' }, [
    el('div', {}, [el('b', { text: line.productName })]),
    el('div', { class: 'sub' }, [kodeTag(line.productCode)])
  ]);

  // Qty SJ
  const qtyCell = el('td', { class: 'num', 'data-label': 'Qty SJ' }, [
    document.createTextNode(fmt(line.qtySj) + ' '),
    sub(line.unit)
  ]);

  // Diterima + progress + daftar batch
  const receivedCell = el('td', { class: 'num', 'data-label': 'Diterima' });
  const recvTop = el('div', {}, [
    el('b', { text: fmt(line.qtyReceived) }),
    el('span', { class: 'sub', text: ` / ${fmt(line.qtySj)} ${line.unit}` })
  ]);
  receivedCell.appendChild(recvTop);
  if (line.qtySj > 0) receivedCell.appendChild(progressBar(line.qtyReceived, line.qtySj));
  for (const r of line.receipts) {
    receivedCell.appendChild(el('div', { class: 'sub', style: { marginTop: '4px' } }, [
      batchTag(r.batchNumber),
      document.createTextNode(' '),
      rakTag(r.rackCode),
      document.createTextNode(` ${fmt(r.qty)} ${line.unit} • ${fmtDate(r.date)}`)
    ]));
  }

  // Pending
  const pendingCell = el('td', { class: 'num', 'data-label': 'Pending' }, [el('b', { text: fmt(line.pending) })]);

  // Status + info alasan/ETA/PIC
  const statusCell = el('td', { 'data-label': 'Status' }, [badge(meta.label, meta.cls)]);
  if (line.status === 'WAITING_PHYSICAL' || line.status === 'PARTIALLY_RECEIVED') {
    if (line.alasanLabel) {
      statusCell.appendChild(sub(`${line.alasanLabel} • ETA ${fmtDate(line.eta)} • PIC ${line.pic || '—'}`));
    }
  }
  if (line.status === 'CANCELLED') {
    statusCell.appendChild(sub(`Dibatalkan ${fmt(line.qtyCancelled)} ${line.unit}`));
  }

  // Aksi
  const actions = el('td', { class: 'num', 'data-label': '' });
  const group = el('div', { class: 'btn-group' });
  const ctx = {
    sjNo: sjItem.no,
    lineId: line.id,
    productName: line.productName,
    productCode: line.productCode,
    unit: line.unit,
    pending: line.pending,
    customerName: sjItem.customerName,
    customerId: sjItem.customerId,
    alasan: line.alasan,
    eta: line.eta,
    pic: line.pic
  };

  const canWrite = state.user && (state.user.role === 'ADMIN' || state.user.role === 'GUDANG');
  const reload = () => {
    const page = document.querySelector('#view');
    if (page) renderPenerimaanPage(page);
  };

  if (!canWrite) {
    group.appendChild(sub('—'));
  } else if (line.status === 'OPEN') {
    group.appendChild(btn('Fisik Ada', { variant: 'ok', sm: true, onClick: () => openReceive(ctx, reload) }));
    group.appendChild(btn('Fisik Belum Ada', { variant: 'warn', sm: true, onClick: () => openWait(ctx, reload) }));
  } else if (line.status === 'WAITING_PHYSICAL') {
    group.appendChild(btn('Fisik Ada', { variant: 'ok', sm: true, onClick: () => openReceive(ctx, reload) }));
    group.appendChild(btn('Batalkan', { variant: 'danger', sm: true, onClick: () => openCancel(ctx, reload) }));
  } else if (line.status === 'PARTIALLY_RECEIVED') {
    group.appendChild(btn('Fisik Ada', { variant: 'ok', sm: true, onClick: () => openReceive(ctx, reload) }));
    group.appendChild(btn('Batalkan sisa', { variant: 'danger', sm: true, onClick: () => openCancel(ctx, reload) }));
  } else {
    group.appendChild(sub('—'));
  }
  actions.appendChild(group);

  return el('tr', {}, [productCell, qtyCell, receivedCell, pendingCell, statusCell, actions]);
}
