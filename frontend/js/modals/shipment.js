/**
 * modals/shipment.js — Modal pengiriman keluar (PRD 6.7).
 *
 *  - openCreateShipment : pilih batch milik pelanggan + qty, simpan (langsung
 *    SHIPPED), opsi langsung cetak.
 *  - openPod            : tandai POD (DELIVERED + tanggal).
 *  - openVoid           : void pengiriman (ADMIN) + alasan wajib.
 *
 * Validasi stok final tetap di server (di dalam lock); di sini hanya UX.
 */

import { shipment, stock } from '../api.js';
import { state, fmt, fmtDate } from '../state.js';
import { el, btn, modal, field, select, grid2, infobox, toast, callout } from '../ui.js';

/** Sisa batch setelah memperhitungkan baris lain pada draf yang sama. */
function remainingFor(batches, lines, receiptId, skipIndex) {
  const batch = batches.find((b) => b.id === receiptId);
  if (!batch) return 0;
  const usedByOthers = lines.reduce((acc, ln, i) => {
    if (i === skipIndex) return acc;
    return ln.receiptId === receiptId ? acc + Number(ln.qty || 0) : acc;
  }, 0);
  return batch.available - usedByOthers;
}

/** Label opsi batch untuk select. */
function batchLabel(b) {
  return `${b.productCode} — ${b.productName} · Batch ${b.batchNumber} · sisa ${fmt(b.available)} ${b.unit}`;
}

export async function openCreateShipment(onDone) {
  if (!state.master.customers.length) {
    toast('Belum ada pelanggan. Lengkapi Master Data dulu.', 'err');
    return;
  }

  const draft = {
    date: state.serverDate || '',
    customerId: state.master.customers[0].id,
    ekspedisi: '',
    note: '',
    lines: []
  };

  let batches = [];
  let loadingBatches = true;
  /** Penjaga agar pemilihan pelanggan otomatis hanya dicoba sekali. */
  let autoPicked = false;

  const dateInput = el('input', { type: 'date', value: draft.date, required: true });
  const customerSelect = select(
    state.master.customers.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` })),
    draft.customerId
  );
  // Satu kolom "Ekspedisi" menggantikan Sopir + Kendaraan (muncul di cetak).
  const ekspedisiInput = el('input', { type: 'text', placeholder: 'Nama ekspedisi / pengangkutan' });
  const noteInput = el('input', { type: 'text', placeholder: 'Catatan (opsional)' });
  const linesWrap = el('div');
  const summary = el('div', { class: 'hint' });

  const submitBtn = btn('Simpan Pengiriman', { variant: 'primary' });
  const savePrintBtn = btn('Simpan & Cetak', { variant: 'ok' });

  const dlg = modal({
    title: 'Buat Pengiriman',
    sub: 'Baris diambil dari batch titipan milik pelanggan ini',
    body: [
      grid2([
        field('Tanggal kirim', dateInput, null, true),
        field('Pelanggan', customerSelect, null, true)
      ]),
      field('Ekspedisi', ekspedisiInput,
        'Tercetak pada surat jalan. Boleh dikosongkan.', false),
      field('Catatan', noteInput, null, false),
      el('div', { class: 'addline-box' }, [
        el('div', { class: 'addline-title', text: 'Baris Pengiriman' }),
        linesWrap,
        el('div', { class: 'row-between' }, [
          btn('+ Tambah Baris', { onClick: () => { draft.lines.push({ receiptId: '', qty: 1, colly: 0 }); renderLines(); } }),
          summary
        ])
      ])
    ],
    footer: [
      btn('Batal', { onClick: () => dlg.close() }),
      savePrintBtn,
      submitBtn
    ]
  });

  /** Muat batch tersedia untuk pelanggan terpilih. */
  async function loadBatches() {
    loadingBatches = true;
    linesWrap.innerHTML = '';
    linesWrap.appendChild(el('div', { class: 'hint', text: 'Memuat batch tersedia…' }));
    try {
      // `fresh: true` — sisa batch harus data pasti, bukan salinan cache.
      const res = await stock.available(customerSelect.value, { fresh: true });
      batches = res.items || [];
    } catch (err) {
      batches = [];
      toast(err.message || 'Gagal memuat batch', 'err');
    }
    loadingBatches = false;

    // Pelanggan terpilih belum punya stok: coba pilih pelanggan lain yang punya,
    // supaya form tidak langsung tampak kosong. Hanya dicoba sekali.
    if (!batches.length && !autoPicked) {
      const moved = await pickCustomerWithStock();
      if (moved) return;
    }

    if (!batches.length) {
      draft.lines = [];
      linesWrap.innerHTML = '';
      linesWrap.appendChild(callout(
        'Tidak ada batch tersedia untuk pelanggan ini. Pastikan penerimaan fisik sudah dikonfirmasi.',
        'amber'
      ));
      submitBtn.disabled = true;
      savePrintBtn.disabled = true;
      summary.textContent = '';
      return;
    }
    submitBtn.disabled = false;
    savePrintBtn.disabled = false;
    draft.lines = [{ receiptId: batches[0].id, qty: 1, colly: 0 }];
    renderLines();
  }

  /**
   * Pilih otomatis pelanggan pertama yang masih punya stok.
   * Memakai `stock.list()` (satu panggilan) yang sudah memuat ringkasan per
   * pelanggan, bukan menanyakan satu per satu.
   * @returns {Promise<boolean>} true bila pelanggan diganti (pemanggil berhenti)
   */
  async function pickCustomerWithStock() {
    autoPicked = true;
    try {
      const res = await stock.list({});
      const withStock = (res.perCustomer || []).filter((c) => c.qty > 0);
      if (!withStock.length) return false;

      const current = String(customerSelect.value);
      const target = withStock.find((c) => String(c.customerId) === current) || withStock[0];
      if (!target || String(target.customerId) === current) return false;

      customerSelect.value = target.customerId;
      draft.customerId = target.customerId;
      await loadBatches();
      return true;
    } catch (ignore) {
      return false;
    }
  }

  /** Render baris: batch + qty + colly (koli) + sisa. */
  function renderLines() {
    linesWrap.innerHTML = '';

    if (!draft.lines.length) {
      draft.lines.push({ receiptId: batches.length ? batches[0].id : '', qty: 1, colly: 0 });
    }

    draft.lines.forEach((ln, i) => {
      const batchSelect = select(
        batches.map((b) => ({
          value: b.id,
          label: batchLabel(b),
          disabled: b.available <= 0
        })),
        ln.receiptId
      );
      batchSelect.addEventListener('change', () => {
        draft.lines[i].receiptId = batchSelect.value;
        renderLines();
      });

      const max = remainingFor(batches, draft.lines, ln.receiptId, i);
      const qtyInput = el('input', {
        class: 'inline-input', type: 'number', min: '1', max: String(Math.max(1, max)),
        value: String(ln.qty), style: { width: '110px' }
      });
      qtyInput.addEventListener('input', () => {
        draft.lines[i].qty = Number(qtyInput.value);
        updateSummary();
      });

      // Colly (jumlah koli) — tercetak di surat jalan, totalnya di baris bawah.
      const collyInput = el('input', {
        class: 'inline-input', type: 'number', min: '0', step: '1',
        value: String(ln.colly || 0), style: { width: '90px' }
      });
      collyInput.addEventListener('input', () => {
        draft.lines[i].colly = Number(collyInput.value || 0);
        updateSummary();
      });

      const batch = batches.find((b) => b.id === ln.receiptId) || {};
      const removeBtn = btn('×', {
        variant: 'danger', sm: true, disabled: draft.lines.length === 1,
        onClick: () => { draft.lines.splice(i, 1); renderLines(); }
      });

      linesWrap.appendChild(el('div', { class: 'ship-line' }, [
        el('div', { class: 'ship-line-main' }, [batchSelect]),
        el('div', { class: 'ship-line-side' }, [
          el('span', { class: 'sub', text: 'qty' }),
          qtyInput,
          el('span', { class: 'sub', text: batch.unit || '' }),
          el('span', { class: 'sub', text: `maks ${fmt(Math.max(0, max))}` }),
          el('span', { class: 'sub', text: 'colly' }),
          collyInput,
          removeBtn
        ])
      ]));
    });

    updateSummary();
  }

  function updateSummary() {
    const total = draft.lines.reduce((a, l) => a + Number(l.qty || 0), 0);
    const totalColly = draft.lines.reduce((a, l) => a + Number(l.colly || 0), 0);
    const over = draft.lines.some((l, i) => {
      const max = remainingFor(batches, draft.lines, l.receiptId, i);
      return Number(l.qty || 0) > max;
    });
    summary.textContent = `${draft.lines.length} baris · total ${fmt(total)} unit · ${fmt(totalColly)} colly`
      + (over ? ' · ada qty melebihi sisa batch' : '');
    summary.style.color = over ? 'var(--red)' : '';
  }

  customerSelect.addEventListener('change', loadBatches);
  await loadBatches();

  /** Simpan; cetak bila diminta. */
  async function save(andPrint) {
    if (!dateInput.value) {
      dateInput.classList.add('input-invalid');
      toast('Tanggal kirim wajib diisi.', 'err');
      return;
    }
    if (!draft.lines.length) {
      toast('Minimal satu baris pengiriman.', 'err');
      return;
    }

    for (let i = 0; i < draft.lines.length; i++) {
      const l = draft.lines[i];
      const max = remainingFor(batches, draft.lines, l.receiptId, i);
      if (!l.receiptId) { toast(`Baris ${i + 1}: pilih batch.`, 'err'); return; }
      if (!l.qty || Number(l.qty) < 1) { toast(`Baris ${i + 1}: qty minimal 1.`, 'err'); return; }
      if (Number(l.qty) > max) {
        toast(`Baris ${i + 1}: qty melebihi sisa batch (maks ${fmt(max)}).`, 'err');
        return;
      }
    }

    submitBtn.disabled = true;
    savePrintBtn.disabled = true;
    const label = andPrint ? 'Menyimpan & menyiapkan cetak…' : 'Menyimpan…';
    submitBtn.textContent = label;
    savePrintBtn.textContent = label;

    try {
      const res = await shipment.create({
        date: dateInput.value,
        customerId: customerSelect.value,
        ekspedisi: ekspedisiInput.value.trim(),
        note: noteInput.value.trim(),
        lines: draft.lines.map((l) => {
          const b = batches.find((x) => x.id === l.receiptId) || {};
          return {
            productId: b.productId,
            receiptId: l.receiptId,
            rackId: b.rackId,
            qty: Number(l.qty),
            colly: Number(l.colly || 0)
          };
        })
      });
      dlg.close();
      toast(`Pengiriman ${res.no} dibuat (${res.totalLines} baris, ${fmt(res.totalQty)} unit).`, 'ok');
      if (onDone) await onDone();
      if (andPrint) {
        const { printSuratJalan } = await import('../print.js');
        await printSuratJalan(res.no);
      }
    } catch (err) {
      submitBtn.disabled = false;
      savePrintBtn.disabled = false;
      submitBtn.textContent = 'Simpan Pengiriman';
      savePrintBtn.textContent = 'Simpan & Cetak';
      toast(err.message || 'Gagal menyimpan pengiriman', 'err');
    }
  }

  submitBtn.addEventListener('click', () => save(false));
  savePrintBtn.addEventListener('click', () => save(true));
}

/** Tandai POD (DELIVERED). */
export function openPod(item, onDone) {
  const podInput = el('input', { type: 'date', value: state.serverDate || '' });
  const submitBtn = btn('Tandai POD', { variant: 'ok' });

  const dlg = modal({
    title: 'Tandai Barang Diterima (POD)',
    sub: 'Status pengiriman menjadi Selesai setelah pelanggan menerima barang',
    body: [
      infobox([
        ['No. Pengiriman', item.no],
        ['Pelanggan', item.customerName],
        ['Tanggal kirim', fmtDate(item.date)],
        ['Jumlah baris', String(item.totalLines)],
        ['Total qty', fmt(item.totalQty)],
        ['Status kini', item.status]
      ]),
      field('Tanggal diterima', podInput, 'Tidak boleh sebelum tanggal kirim.', true)
    ],
    footer: [btn('Batal', { onClick: () => dlg.close() }), submitBtn]
  });

  submitBtn.addEventListener('click', async () => {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Menyimpan…';
    try {
      await shipment.markDelivered({ no: item.no, podDate: podInput.value });
      dlg.close();
      toast(`Pengiriman ${item.no} selesai (POD ${fmtDate(podInput.value)}).`, 'ok');
      if (onDone) await onDone();
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Tandai POD';
      if (err.field === 'podDate') podInput.classList.add('input-invalid');
      toast(err.message || 'Gagal menandai POD', 'err');
    }
  });
}

/** Void pengiriman (ADMIN) — stok dikembalikan server. */
export function openVoid(item, onDone) {
  const reasonInput = el('input', { type: 'text', placeholder: 'mis. salah input qty' });
  const submitBtn = btn('Ya, Batalkan', { variant: 'danger' });

  const dlg = modal({
    title: 'Batalkan Pengiriman (Void)',
    sub: 'Stok batch dikembalikan ke gudang titipan',
    body: [
      callout(
        `Membatalkan ${item.no} akan mengembalikan ${fmt(item.totalQty)} unit dari ${item.totalLines} baris ke stok titipan. `
          + 'Tindakan ini tercatat di audit log.',
        'amber'
      ),
      infobox([
        ['No. Pengiriman', item.no],
        ['Pelanggan', item.customerName],
        ['Tanggal', fmtDate(item.date)],
        ['Status kini', item.status]
      ]),
      field('Alasan void', reasonInput, 'Wajib diisi, disimpan untuk jejak audit.', true)
    ],
    footer: [btn('Batal', { onClick: () => dlg.close() }), submitBtn]
  });

  submitBtn.addEventListener('click', async () => {
    if (!reasonInput.value.trim()) {
      reasonInput.classList.add('input-invalid');
      toast('Alasan void wajib diisi.', 'err');
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = 'Membatalkan…';
    try {
      const res = await shipment.void(item.no, reasonInput.value.trim());
      dlg.close();
      toast(`Pengiriman ${item.no} dibatalkan; ${fmt(res.restoredQty)} unit kembali ke stok.`, 'warn');
      if (onDone) await onDone();
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Ya, Batalkan';
      toast(err.message || 'Gagal membatalkan pengiriman', 'err');
    }
  });
}
