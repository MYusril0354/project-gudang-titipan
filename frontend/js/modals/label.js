/**
 * modals/label.js — Modal "Cetak Label" untuk satu Pengiriman (DO).
 *
 * Semua field terisi otomatis dari DO + Master Pelanggan dan boleh diubah
 * sebelum dicetak:
 *  - Kepada  : diurai dari nama pelanggan (pola "… UP <nama>"); bisa diisi manual
 *  - Telepon : dari Master Pelanggan; bisa disembunyikan atau disebariskan
 *  - Cabang  : kode pelanggan (baris besar pada stiker)
 *  - Alamat  : alamat pelanggan
 *  - Ekspedisi: dari DO
 *
 * Jumlah stiker default = total colly DO (1 stiker per koli). Mencetak label
 * TIDAK menaikkan hitungan cetak Surat Jalan.
 */

import { state } from '../state.js';
import { el, btn, field, grid2, modal, select, toast, callout } from '../ui.js';
import { printAddressLabels, parseRecipient, LABELS_PER_PAGE } from '../print-label.js';

const MIDDLE_STYLES = [
  { value: 'kosong-kode', label: 'Kosong + kode cabang besar (default)' },
  { value: 'nama-kode', label: 'Nama pelanggan penuh + kode cabang besar' },
  { value: 'enseval-nama', label: '"Enseval" + nama pelanggan besar' },
  { value: 'enseval-kode', label: '"Enseval" + kode cabang besar' }
];

const PHONE_MODES = [
  { value: 'baris', label: 'Baris sendiri di bawah "Kepada"' },
  { value: 'sebaris', label: 'Sebaris dengan "Kepada"' },
  { value: 'tanpa', label: 'Tanpa telepon' }
];

/** Batas jumlah stiker & salinan agar tidak salah ketik. */
const MAX_STICKERS = 60;
const MAX_COPIES = 10;

/**
 * Buka modal cetak label.
 * @param {object} item baris dari `shipment.list` / `shipment.get`
 * @param {Function} [onDone] dipanggil setelah dokumen cetak dibuka
 */
export function openLabelPrint(item, onDone) {
  const customer = state.master.customers.find((c) => String(c.id) === String(item.customerId)) || {};
  const colly = Number(item.totalColly || 0);

  const namaInput = el('input', { type: 'text', value: customer.name || item.customerName || '' });
  const cabangInput = el('input', { type: 'text', value: customer.code || '' });
  const alamatInput = el('input', { type: 'text', value: customer.address || '' });
  const kepadaInput = el('input', {
    type: 'text',
    value: parseRecipient(customer.name || item.customerName || ''),
    placeholder: 'otomatis dari nama pelanggan'
  });
  const teleponInput = el('input', { type: 'text', value: customer.phone || '' });
  const ekspedisiInput = el('input', { type: 'text', value: item.ekspedisi || '' });
  const jumlahInput = el('input', { type: 'number', min: '1', max: String(MAX_STICKERS), value: String(colly || 1) });
  const salinanInput = el('input', { type: 'number', min: '1', max: String(MAX_COPIES), value: '1' });

  const phoneModeSel = select(PHONE_MODES, 'baris');
  const middleSel = select(MIDDLE_STYLES, 'kosong-kode');
  const gapInput = el('input', { type: 'number', min: '0', max: '10', step: '0.5', value: '6' });
  const showDoChk = el('input', { type: 'checkbox' });

  const infoWrap = el('div', { class: 'hint' });

  const submitBtn = btn('Cetak Label', { variant: 'primary' });

  const dlg = modal({
    title: 'Cetak Label Alamat',
    sub: `Pengiriman ${item.no} · ${item.customerName || ''}`
      + (colly ? ` · ${colly} colly` : ''),
    body: [
      colly
        ? callout(`Jumlah stiker default = jumlah colly DO ini (${colly}). `
          + 'Satu stiker ditempel di tiap koli.', 'blue')
        : callout('DO ini belum punya jumlah colly, jadi jumlah stiker default 1. '
          + 'Isi manual bila perlu.', 'amber'),
      grid2([
        field('Nama pelanggan', namaInput, 'Dipakai untuk mengurai "Kepada".', true),
        field('Kode cabang', cabangInput, 'Tampil besar di stiker.', true)
      ]),
      field('Alamat cabang', alamatInput, null, false),
      grid2([
        field('Kepada', kepadaInput, 'Kosongkan untuk urai otomatis dari nama.', false),
        field('No. telepon', teleponInput, null, false)
      ]),
      grid2([
        field('Penempatan telepon', phoneModeSel, null, false),
        field('Ekspedisi', ekspedisiInput, 'Tercetak di dasar stiker.', false)
      ]),
      grid2([
        field('Jumlah stiker', jumlahInput, 'Biasanya sama dengan jumlah colly.', true),
        field('Salinan per koli', salinanInput, 'Mis. 2 untuk cadangan.', false)
      ]),
      el('details', {}, [
        el('summary', { text: 'Opsi lanjutan' }),
        el('div', { style: { marginTop: '10px' } }, [
          grid2([
            field('Gaya baris tengah', middleSel, null, false),
            field('Jarak antar kolom (mm)', gapInput, 'Turunkan bila hasil cetak terpotong.', false)
          ]),
          el('label', { class: 'check-inline' }, [
            showDoChk,
            document.createTextNode(' Tampilkan nomor DO kecil di bawah stiker')
          ])
        ])
      ]),
      infoWrap
    ],
    footer: [btn('Batal', { onClick: () => dlg.close() }), submitBtn]
  });

  /** Perbarui ringkasan jumlah halaman. */
  function refreshInfo() {
    const total = Math.max(1, Number(jumlahInput.value) || 0) * Math.max(1, Number(salinanInput.value) || 1);
    const pages = Math.ceil(total / LABELS_PER_PAGE);
    infoWrap.textContent = `${total} stiker · ${pages} halaman (${LABELS_PER_PAGE} stiker per halaman).`;
  }

  [jumlahInput, salinanInput].forEach((i) => i.addEventListener('input', refreshInfo));
  refreshInfo();

  submitBtn.addEventListener('click', () => {
    const stickers = Number(jumlahInput.value);
    const copies = Number(salinanInput.value);

    if (!namaInput.value.trim()) {
      namaInput.classList.add('input-invalid');
      toast('Nama pelanggan wajib diisi.', 'err');
      return;
    }
    if (!cabangInput.value.trim()) {
      cabangInput.classList.add('input-invalid');
      toast('Kode cabang wajib diisi.', 'err');
      return;
    }
    if (!Number.isFinite(stickers) || stickers < 1 || stickers > MAX_STICKERS) {
      jumlahInput.classList.add('input-invalid');
      toast(`Jumlah stiker harus 1–${MAX_STICKERS}.`, 'err');
      return;
    }
    if (!Number.isFinite(copies) || copies < 1 || copies > MAX_COPIES) {
      salinanInput.classList.add('input-invalid');
      toast(`Salinan per koli harus 1–${MAX_COPIES}.`, 'err');
      return;
    }

    try {
      printAddressLabels({
        no: item.no,
        customerName: namaInput.value.trim(),
        customerCode: cabangInput.value.trim(),
        address: alamatInput.value.trim(),
        recipient: kepadaInput.value.trim(),
        phone: teleponInput.value.trim(),
        phoneMode: phoneModeSel.value,
        ekspedisi: ekspedisiInput.value.trim(),
        stickers,
        copies,
        middleStyle: middleSel.value,
        columnGapMm: Number(gapInput.value) || 0,
        showDo: showDoChk.checked
      });
      toast(`Dokumen label dibuka: ${stickers * copies} stiker.`, 'ok');
      if (onDone) onDone();
    } catch (err) {
      toast(err.message || 'Gagal membuka dokumen cetak.', 'err');
    }
  });
}
