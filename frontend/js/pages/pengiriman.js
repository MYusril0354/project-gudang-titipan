/**
 * pages/pengiriman.js — Halaman Pengiriman (PRD 6.7).
 *
 * Aksi per status:
 *   SHIPPED   -> Cetak, Tandai POD, Void (ADMIN)
 *   DELIVERED -> Cetak, Void (ADMIN)
 *   VOID      -> tidak ada aksi
 */

import { shipment } from '../api.js';
import { state, fmt, fmtDate, STATUS_META } from '../state.js';
import {
  el, btn, badge, panel, emptyBox, skeleton, errorBox, searchInput,
  toast, statCard, sub, kodeTag, rakTag, batchTag
} from '../ui.js';
import { openCreateShipment, openPod, openVoid } from '../modals/shipment.js';
import { printSuratJalan } from '../print.js';

const STATUS_FILTERS = [
  { value: '', label: 'Semua status' },
  { value: 'SHIPPED', label: 'Dikirim' },
  { value: 'DELIVERED', label: 'Selesai (POD)' },
  { value: 'VOID', label: 'Dibatalkan' }
];

export async function renderPengirimanPage(view) {
  view.innerHTML = '';

  const isAdmin = state.user && state.user.role === 'ADMIN';
  const canWrite = state.user && (state.user.role === 'ADMIN' || state.user.role === 'GUDANG');

  const cardsWrap = el('div', { class: 'cards' });
  const listWrap = el('div');
  const filter = {
    q: state.filters.pengiriman || '',
    status: state.filters.pengirimanStatus || ''
  };

  const statusSelect = el('select', { class: 'input' });
  for (const s of STATUS_FILTERS) {
    const opt = el('option', { value: s.value, text: s.label });
    if (s.value === filter.status) opt.selected = true;
    statusSelect.appendChild(opt);
  }
  statusSelect.addEventListener('change', () => {
    filter.status = statusSelect.value;
    state.filters.pengirimanStatus = statusSelect.value;
    load();
  });

  const actions = [];
  if (canWrite) {
    actions.push(btn('+ Buat Pengiriman', {
      variant: 'primary',
      onClick: () => openCreateShipment(load)
    }));
  }

  view.appendChild(cardsWrap);
  view.appendChild(panel({
    title: 'Daftar Pengiriman',
    sub: 'Memuat…',
    actions: [
      statusSelect,
      searchInput('Cari no DO / pelanggan / batch…', filter.q, (v) => {
        filter.q = v;
        state.filters.pengiriman = v;
        load();
      })
    ].concat(actions),
    body: [listWrap]
  }));

  const panelSub = view.querySelector('.panel-sub');
  const reload = () => load();

  /** Muat ulang daftar pengiriman. */
  async function load() {
    listWrap.innerHTML = '';
    listWrap.appendChild(skeleton(6));
    try {
      const data = await shipment.list({ q: filter.q, status: filter.status });

      cardsWrap.innerHTML = '';
      cardsWrap.append(
        statCard('Total Pengiriman', fmt(data.total), 'dokumen',
          'Sesuai filter aktif', '#4f46e5'),
        statCard('Dikirim', fmt(data.counts.shipped), 'dokumen',
          'Menunggu konfirmasi terima', '#1d4ed8'),
        statCard('Selesai (POD)', fmt(data.counts.delivered), 'dokumen',
          'Sudah diterima pelanggan', '#0e9f6e'),
        statCard('Dibatalkan', fmt(data.counts.void), 'dokumen',
          'Stok sudah dikembalikan', '#b42318')
      );

      if (panelSub) {
        panelSub.textContent = filter.q || filter.status
          ? `${data.total} dokumen sesuai filter`
          : `${data.total} dokumen pengiriman`;
      }

      listWrap.innerHTML = '';
      if (!data.items.length) {
        listWrap.appendChild(emptyBox(
          filter.q || filter.status ? 'Tidak ada pengiriman yang cocok' : 'Belum ada pengiriman',
          filter.q || filter.status
            ? 'Ubah filter atau kata kunci.'
            : 'Klik "+ Buat Pengiriman" untuk mengirim barang titipan keluar.'
        ));
        return;
      }
      for (const item of data.items) listWrap.appendChild(buildCard(item, { canWrite, isAdmin, reload }));
    } catch (err) {
      listWrap.innerHTML = '';
      listWrap.appendChild(errorBox(err));
    }
  }

  await load();
}

/** Kartu satu pengiriman. */
function buildCard(item, opts) {
  const meta = STATUS_META[item.status] || { label: item.status, cls: 'b-gray' };

  const headMeta = [
    el('span', {}, [document.createTextNode('Tanggal '), el('b', { text: fmtDate(item.date) })]),
    el('span', {}, [document.createTextNode('Pelanggan '), el('b', { text: item.customerName })]),
    el('span', {}, [document.createTextNode('Total '), el('b', { text: `${fmt(item.totalQty)} unit` })])
  ];
  if (item.ekspedisi) headMeta.push(el('span', {}, [document.createTextNode('Ekspedisi '), el('b', { text: item.ekspedisi })]));
  if (item.podDate) headMeta.push(el('span', {}, [document.createTextNode('POD '), el('b', { text: fmtDate(item.podDate) })]));
  if (item.totalColly) headMeta.push(el('span', {}, [document.createTextNode('Colly '), el('b', { text: fmt(item.totalColly) })]));
  if (item.printCount > 0) {
    headMeta.push(el('span', {}, [
      document.createTextNode('Dicetak '),
      el('b', { text: `${item.printCount}×` })
    ]));
  }

  const head = el('div', { class: 'sj-head' }, [
    el('div', {}, [
      el('div', { class: 'sj-no', text: item.no }),
      el('div', { class: 'sj-meta' }, headMeta)
    ]),
    el('div', { class: 'head-right' }, [
      badge(meta.label, meta.cls),
      buildActions(item, opts)
    ])
  ]);

  const table = el('table', { class: 'tbl tbl-resp' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { class: 'num', text: '#' }),
        el('th', { text: 'Produk / Kode' }),
        el('th', { text: 'No. Batch' }),
        el('th', { text: 'ED' }),
        el('th', { text: 'SJ Asal' }),
        el('th', { text: 'Rak' }),
        el('th', { class: 'num', text: 'Qty' }),
        el('th', { class: 'num', text: 'Colly' })
      ])
    ]),
    el('tbody', {}, item.lines.map((l, i) => el('tr', {}, [
      el('td', { class: 'num tbl-idx', 'data-label': '', text: String(i + 1) }),
      el('td', { 'data-label': 'Produk' }, [
        el('div', {}, [el('b', { text: l.productName })]),
        el('div', { class: 'sub' }, [kodeTag(l.productCode)])
      ]),
      el('td', { 'data-label': 'No. Batch' }, [batchTag(l.batchNumber)]),
      el('td', { 'data-label': 'ED', text: l.ed ? fmtDate(l.ed) : '—' }),
      el('td', { 'data-label': 'SJ Asal' }, [
        el('span', { class: 'mono', text: l.sjNo || '—' })
      ]),
      el('td', { 'data-label': 'Rak' }, [rakTag(l.rackCode)]),
      el('td', { class: 'num', 'data-label': 'Qty' }, [
        el('b', { text: fmt(l.qty) }),
        document.createTextNode(` ${l.unit}`)
      ]),
      el('td', { class: 'num', 'data-label': 'Colly', text: l.colly ? fmt(l.colly) : '—' })
    ])))
  ]);

  return el('div', { class: 'sj-card' }, [head, table]);
}

/** Tombol aksi sesuai status & peran. */
function buildActions(item, opts) {
  const group = el('div', { class: 'btn-group' });

  if (item.status !== 'VOID') {
    group.appendChild(btn('Cetak', {
      sm: true,
      title: 'Cetak surat jalan',
      onClick: async () => {
        try {
          await printSuratJalan(item.no);
        } catch (err) {
          toast(err.message || 'Gagal menyiapkan cetak', 'err');
        } finally {
          // Muat ulang apa pun hasilnya: jumlah cetak di server bisa berubah.
          if (opts.reload) await opts.reload();
        }
      }
    }));
  }

  if (item.status === 'SHIPPED' && opts.canWrite) {
    group.appendChild(btn('Tandai POD', {
      variant: 'ok', sm: true,
      onClick: () => openPod(item, opts.reload)
    }));
  }

  if (item.status !== 'VOID' && opts.isAdmin) {
    group.appendChild(btn('Void', {
      variant: 'danger', sm: true,
      title: 'Batalkan pengiriman (stok dikembalikan)',
      onClick: () => openVoid(item, opts.reload)
    }));
  }

  if (!group.children.length) group.appendChild(sub('—'));
  return group;
}
