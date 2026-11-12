/**
 * modals/sj.js — Modal aksi baris Surat Jalan (Fase 2).
 *
 * Tiga aksi sesuai PRD:
 *  - Fisik Ada        (6.3) -> receipt + batch + mutasi CONSIGN_IN
 *  - Fisik Belum Ada  (6.4) -> alasan, ETA, PIC (stok tidak berubah)
 *  - Batalkan sisa    (6.5) -> qty_cancelled += pending + catatan wajib
 *
 * Semua validasi ulang dilakukan server; di sini hanya UX (cegah input jelas salah).
 */

import { sj } from '../api.js';
import { state, fmt, fmtDate } from '../state.js';
import { racksOfCustomer, consignLocationOf } from '../state.js';
import {
  el, btn, modal, field, select, grid2, infobox, toast, kodeTag
} from '../ui.js';

/** Error pertama dari server ditandai pada field terkait. */
function markInvalid(control, err) {
  if (!control) return;
  control.classList.add('input-invalid');
  try { control.focus(); } catch (ignore) { /* fokus opsional */ }
}

/**
 * Modal Fisik Ada.
 * @param {{sjNo:string, lineId:string, productName:string, productCode:string,
 *          unit:string, pending:number, customerName:string, customerId:string}} line
 * @param {Function} onDone dipanggil setelah sukses
 */
export async function openReceive(line, onDone) {
  const racks = racksOfCustomer(line.customerId);
  const consign = consignLocationOf(line.customerId);

  if (!consign || !racks.length) {
    toast('Pelanggan ini belum punya gudang titipan/rak. Tambahkan di Master Data.', 'err');
    return;
  }

  const qtyInput = el('input', {
    type: 'number', min: '1', max: String(line.pending), value: String(line.pending), required: true
  });
  const dateInput = el('input', { type: 'date', value: state.serverDate || '', required: true });
  const batchInput = el('input', { type: 'text', value: '', placeholder: 'memuat…' });
  const rackSelect = select(
    racks.map((r) => ({ value: r.id, label: `${r.code} — ${r.name}` })),
    racks[0] ? racks[0].id : ''
  );
  const kondisiSelect = select(state.constants.kondisi || ['Baik', 'Rusak sebagian'], 'Baik');
  const picInput = el('input', {
    type: 'text',
    value: (state.user && state.user.nama) || 'Admin Gudang',
    required: true
  });

  const submitBtn = btn('Konfirmasi Fisik Ada', { variant: 'ok', disabled: true });

  const dlg = modal({
    title: 'Konfirmasi Penerimaan Fisik',
    sub: 'Setiap penerimaan membuat satu batch baru yang terikat ke SJ ini',
    body: [
      infobox([
        ['Surat Jalan', line.sjNo],
        ['Pelanggan', line.customerName],
        ['Produk', line.productName],
        ['Kode Produk', line.productCode],
        ['Qty Pending', `${fmt(line.pending)} ${line.unit}`],
        ['Gudang titipan', consign.name]
      ]),
      grid2([
        field('Qty diterima fisik', qtyInput,
          `Maks ${fmt(line.pending)} ${line.unit}. Boleh kurang untuk bertahap.`, true),
        field('Tanggal fisik', dateInput, null, true)
      ]),
      field('No. Batch', batchInput,
        'Nomor batch/lot barang — tampil di stok, kartu stock, pengiriman, dan surat jalan.', true),
      grid2([
        field('Lokasi rak tujuan', rackSelect, null, true),
        field('Kondisi', kondisiSelect, null, false)
      ]),
      field('Petugas penerima', picInput, null, true)
    ],
    footer: [
      btn('Batal', { onClick: () => dlg.close() }),
      submitBtn
    ]
  });

  /** Ambil saran No. Batch sesuai tanggal yang dipilih (server yang menentukan). */
  async function refreshBatch() {
    batchInput.value = '';
    batchInput.placeholder = 'memuat…';
    try {
      const res = await sj.suggestBatch(dateInput.value || state.serverDate);
      batchInput.value = res.batchNumber;
      batchInput.placeholder = '';
    } catch (err) {
      batchInput.placeholder = 'isi manual';
      toast(err.message || 'Gagal mengambil saran No. Batch', 'err');
    }
    submitBtn.disabled = false;
  }

  dateInput.addEventListener('change', refreshBatch);

  // Wiring handler submit SEGERA (jangan tunggu refreshBatch yang async).
  submitBtn.addEventListener('click', async () => {
    const qty = Number(qtyInput.value);
    if (!qty || qty < 1) {
      markInvalid(qtyInput);
      toast('Qty minimal 1.', 'err');
      return;
    }
    if (qty > line.pending) {
      markInvalid(qtyInput);
      toast(`Qty melebihi pending (maks ${line.pending}).`, 'err');
      return;
    }
    if (!picInput.value.trim()) {
      markInvalid(picInput);
      toast('Petugas penerima wajib diisi.', 'err');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Menyimpan…';
    try {
      const res = await sj.receive({
        sjNo: line.sjNo,
        lineId: line.lineId,
        qty,
        date: dateInput.value,
        batchNumber: batchInput.value.trim(),
        rackId: rackSelect.value,
        kondisi: kondisiSelect.value,
        pic: picInput.value.trim()
      });
      dlg.close();
      toast(`Batch ${res.batchNumber} disimpan: ${fmt(res.qty)} ${line.unit}.`, 'ok');
      if (onDone) await onDone();
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Konfirmasi Fisik Ada';
      if (err.field === 'qty') markInvalid(qtyInput);
      if (err.field === 'batchNumber') markInvalid(batchInput);
      if (err.field === 'rackId') markInvalid(rackSelect);
      if (err.field === 'date') markInvalid(dateInput);
      if (err.field === 'pic') markInvalid(picInput);
      toast(err.message || 'Gagal menyimpan penerimaan', 'err');
    }
  });

  await refreshBatch();
}

/**
 * Modal Fisik Belum Ada (PRD 6.4). Stok tidak berubah.
 */
export async function openWait(line, onDone) {
  const alasanMap = state.constants.alasan || {};
  const alasanSelect = select(
    Object.keys(alasanMap).map((k) => ({ value: k, label: alasanMap[k] })),
    line.alasan || Object.keys(alasanMap)[0] || ''
  );
  const etaInput = el('input', { type: 'date', value: line.eta || state.serverDate || '' });
  const picInput = el('input', { type: 'text', value: line.pic || '', required: true });

  const submitBtn = btn('Simpan ke Pending', { variant: 'warn' });

  const dlg = modal({
    title: 'Tandai Fisik Belum Ada',
    sub: 'Baris masuk antrean pending — stok titipan tidak berubah',
    body: [
      infobox([
        ['Surat Jalan', line.sjNo],
        ['Pelanggan', line.customerName],
        ['Produk', line.productName],
        ['Kode Produk', line.productCode],
        ['Qty Pending', fmt(line.pending) + ' ' + line.unit],
        ['Stok titipan', 'Tidak berubah']
      ]),
      field('Alasan belum ada', alasanSelect, null, true),
      grid2([
        field('Estimasi ready', etaInput, null, false),
        field('PIC', picInput, 'Penanggung jawab pengecekan fisik.', true)
      ])
    ],
    footer: [
      btn('Batal', { onClick: () => dlg.close() }),
      submitBtn
    ]
  });

  submitBtn.addEventListener('click', async () => {
    if (!picInput.value.trim()) {
      markInvalid(picInput);
      toast('PIC wajib diisi.', 'err');
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = 'Menyimpan…';
    try {
      await sj.wait({
        sjNo: line.sjNo,
        lineId: line.lineId,
        alasan: alasanSelect.value,
        eta: etaInput.value || '',
        pic: picInput.value.trim()
      });
      dlg.close();
      toast(`${line.sjNo} dipindahkan ke antrean pending.`, 'warn');
      if (onDone) await onDone();
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Simpan ke Pending';
      if (err.field === 'pic') markInvalid(picInput);
      if (err.field === 'eta') markInvalid(etaInput);
      toast(err.message || 'Gagal menyimpan', 'err');
    }
  });
}

/**
 * Modal Batalkan sisa (PRD 6.5). Alasan + catatan wajib disimpan.
 */
export async function openCancel(line, onDone) {
  const reasonMap = state.constants.cancelReasons || {
    BATAL_PELANGGAN: 'Dibatalkan pelanggan',
    BARANG_TIDAK_DATANG: 'Barang tidak akan datang',
    SALAH_INPUT: 'Salah input surat jalan',
    LAINNYA: 'Lainnya'
  };
  const reasonSelect = select(
    Object.keys(reasonMap).map((k) => ({ value: k, label: reasonMap[k] })),
    'BATAL_PELANGGAN'
  );
  const noteInput = el('textarea', { placeholder: 'Keterangan…', rows: '3' });

  const submitBtn = btn('Ya, Batalkan', { variant: 'danger' });

  const dlg = modal({
    title: 'Batalkan Sisa Pending',
    sub: 'Hanya untuk barang yang dipastikan tidak akan datang',
    body: [
      el('div', { class: 'callout callout-amber', style: { marginBottom: '16px' } }, [
        el('div', { text: '⚠️' }),
        el('div', {
          text: `Membatalkan ${fmt(line.pending)} ${line.unit} dari ${line.sjNo}. `
            + 'Alasan dan catatan disimpan dan tampil di rekonsiliasi.'
        })
      ]),
      field('Alasan', reasonSelect, null, true),
      field('Catatan', noteInput,
        'Wajib diisi bila alasan "Lainnya".', false)
    ],
    footer: [
      btn('Batal', { onClick: () => dlg.close() }),
      submitBtn
    ]
  });

  submitBtn.addEventListener('click', async () => {
    const reason = reasonSelect.value;
    if (reason === 'LAINNYA' && !noteInput.value.trim()) {
      markInvalid(noteInput);
      toast('Catatan wajib diisi bila alasan "Lainnya".', 'err');
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = 'Membatalkan…';
    try {
      const res = await sj.cancel({
        sjNo: line.sjNo,
        lineId: line.lineId,
        reason,
        note: noteInput.value.trim()
      });
      dlg.close();
      toast(`${fmt(res.cancelledQty)} ${line.unit} dari ${line.sjNo} dibatalkan.`, 'warn');
      if (onDone) await onDone();
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Ya, Batalkan';
      if (err.field === 'note') markInvalid(noteInput);
      toast(err.message || 'Gagal membatalkan', 'err');
    }
  });
}
