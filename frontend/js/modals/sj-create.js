/**
 * modals/sj-create.js — Modal tambah Penerimaan SJ (PRD 6.2).
 *
 * Aturan yang dipegang:
 *  - No SJ disarankan server (sj.nextNumber) dan boleh diubah manual.
 *  - Tanggal, pelanggan, No PO wajib; minimal 1 baris; tiap baris produk + qty >= 1.
 *  - Nomor final ditentukan server saat simpan (bisa auto bila dikosongkan).
 */

import { sj } from '../api.js';
import { state, fmt } from '../state.js';
import { el, btn, modal, field, select, grid2, toast, kodeTag, sub } from '../ui.js';

const MAX_LINES = 100;

/** Satu baris draft {productId, qty}. */
function blankLine() {
  const first = state.master.products[0];
  return { productId: first ? first.id : '', qty: 1 };
}

export async function openCreateSJ(onDone) {
  const draft = {
    no: '',
    date: state.serverDate || '',
    customerId: state.master.customers[0] ? state.master.customers[0].id : '',
    po: '',
    lines: [blankLine()]
  };

  const noInput = el('input', { type: 'text', value: '', placeholder: 'memuat…' });
  const dateInput = el('input', { type: 'date', value: draft.date, required: true });
  const customerSelect = select(
    state.master.customers.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` })),
    draft.customerId,
    { placeholder: '— pilih pelanggan —' }
  );
  const poInput = el('input', { type: 'text', placeholder: 'PO-XXXX', required: true });
  const linesWrap = el('div');

  const submitBtn = btn('Simpan Surat Jalan', { variant: 'primary' });

  const dlg = modal({
    title: 'Tambah Penerimaan SJ',
    sub: 'Dokumen masuk administratif — batch dibuat saat Fisik Ada dikonfirmasi',
    body: [
      grid2([
        field('No SJ', noInput, 'Disarankan otomatis; boleh diubah, tetap harus unik.', false),
        field('Tanggal', dateInput, null, true)
      ]),
      grid2([
        field('Pelanggan', customerSelect, null, true),
        field('No PO', poInput, null, true)
      ]),
      el('div', { class: 'addline-box' }, [
        el('div', { class: 'addline-title', text: 'Baris Produk' }),
        linesWrap,
        btn('+ Tambah Baris', { onClick: () => { draft.lines.push(blankLine()); renderLines(); } })
      ]),
      el('div', { class: 'hint',
        text: 'Setelah SJ dibuat, lakukan "Fisik Ada" pada halaman Penerimaan untuk membuat batch.' })
    ],
    footer: [
      btn('Batal', { onClick: () => dlg.close() }),
      submitBtn
    ]
  });

  /** Render ulang daftar baris (setiap baris: produk, qty, satuan, hapus). */
  function renderLines() {
    linesWrap.innerHTML = '';

    draft.lines.forEach((ln, i) => {
      const productSelect = select(
        state.master.products.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` })),
        ln.productId
      );
      productSelect.addEventListener('change', () => { draft.lines[i].productId = productSelect.value; });

      const qtyInput = el('input', {
        class: 'inline-input', type: 'number', min: '1', value: String(ln.qty),
        style: { width: '100px' }
      });
      qtyInput.addEventListener('input', () => { draft.lines[i].qty = Number(qtyInput.value); });

      const unitCell = sub(
        (state.master.products.find((p) => p.id === ln.productId) || {}).unit || ''
      );

      const removeBtn = btn('×', {
        variant: 'danger',
        sm: true,
        disabled: draft.lines.length === 1,
        onClick: () => { draft.lines.splice(i, 1); renderLines(); }
      });

      const row = el('tr', {}, [
        el('td', { class: 'num', text: String(i + 1) }),
        el('td', {}, [productSelect]),
        el('td', {}, [qtyInput]),
        el('td', {}, [unitCell]),
        el('td', { class: 'num' }, [removeBtn])
      ]);
      linesWrap.appendChild(row);
    });

    const tbl = el('table', { class: 'tbl', style: { marginBottom: '10px' } }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { class: 'num', style: { width: '30px' }, text: '#' }),
          el('th', { text: 'Produk' }),
          el('th', { style: { width: '120px' }, text: 'Qty' }),
          el('th', { style: { width: '50px' }, text: 'Satuan' }),
          el('th', { text: '' })
        ])
      ]),
      el('tbody', {}, Array.from(linesWrap.children))
    ]);
    linesWrap.appendChild(tbl);
  }

  renderLines();

  // Wiring handler submit SEGERA (tidak menunggu network call), agar tombol
  // tidak pernah "mati" saat saran No SJ masih dimuat.
  submitBtn.addEventListener('click', async () => {
    const no = noInput.value.trim();
    const po = poInput.value.trim();

    if (!dateInput.value) {
      dateInput.classList.add('input-invalid');
      toast('Tanggal wajib diisi.', 'err');
      return;
    }
    if (!customerSelect.value) {
      customerSelect.classList.add('input-invalid');
      toast('Pilih pelanggan.', 'err');
      return;
    }
    if (!po) {
      poInput.classList.add('input-invalid');
      toast('No PO wajib diisi.', 'err');
      return;
    }
    if (!draft.lines.length) {
      toast('Minimal satu baris produk.', 'err');
      return;
    }
    const bad = draft.lines.find((l) => !l.productId || !l.qty || l.qty < 1);
    if (bad) {
      toast('Setiap baris harus punya produk dan qty minimal 1.', 'err');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Menyimpan…';
    try {
      const res = await sj.create({
        no: no || undefined,
        date: dateInput.value,
        customerId: customerSelect.value,
        po,
        lines: draft.lines.map((l) => ({ productId: l.productId, qty: Number(l.qty) }))
      });
      dlg.close();
      toast(`Surat Jalan ${res.no} ditambahkan (${res.totalLines} baris).`, 'ok');
      if (onDone) await onDone();
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Simpan Surat Jalan';
      if (err.field === 'no') noInput.classList.add('input-invalid');
      if (err.field === 'date') dateInput.classList.add('input-invalid');
      if (err.field === 'po') poInput.classList.add('input-invalid');
      if (err.field === 'customerId') customerSelect.classList.add('input-invalid');
      toast(err.message || 'Gagal menyimpan Surat Jalan', 'err');
    }
  });

  // Saran No SJ (best-effort, tidak memblokir interaksi).
  try {
    const res = await sj.nextNumber();
    draft.no = res.no;
    noInput.value = res.no;
    noInput.placeholder = '';
  } catch (err) {
    noInput.placeholder = 'isi manual';
    toast(err.message || 'Gagal mengambil nomor SJ', 'err');
  }
}
