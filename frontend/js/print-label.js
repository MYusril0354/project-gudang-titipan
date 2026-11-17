/**
 * print-label.js — Cetak sticker alamat untuk pengiriman (label koli).
 *
 * Bentuk mengikuti `LabelAlamat.html` dari project lain:
 *  - Kertas 214 × 165 mm (landscape), grid 2 kolom × 3 baris → 6 stiker/halaman.
 *  - Satu stiker 100 × 50 mm: Kepada (+ telepon), Tujuan (kode cabang besar +
 *    alamat), lalu Ekspedisi di dasar stiker.
 *  - Slot sisa di halaman terakhir tetap dicetak sebagai kotak kosong supaya
 *    grid tidak bergeser saat ditempel.
 *
 * Data diambil dari dokumen Pengiriman (DO) + Master Pelanggan; TIDAK ada
 * panggilan server di sini, jadi mencetak label tidak menaikkan `print_count`
 * Surat Jalan.
 *
 * Semua teks dirender lewat `textContent`/createElement (anti-XSS).
 */

/** Jumlah stiker per halaman. */
export const LABELS_PER_PAGE = 6;

/** Ukuran & gaya default. */
const DEFAULTS = {
  phoneMode: 'baris',        // 'baris' | 'sebaris' | 'tanpa'
  middleStyle: 'kosong-kode', // 'kosong-kode' | 'nama-kode' | 'enseval-nama' | 'enseval-kode'
  columnGapMm: 6,
  copies: 1,
  showDo: false
};

/**
 * Ambil nama penerima dari nama pelanggan berpola "… UP <nama>".
 * @param {string} customerName
 * @returns {string} nama penerima, atau '' bila polanya tidak ada
 */
export function parseRecipient(customerName) {
  const m = String(customerName || '').match(/\bUP\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

/**
 * Cetak sticker alamat: buka jendela SINKRON di dalam handler klik, lalu print.
 * @param {object} opts lihat `buildLabelDocument`
 */
export function printAddressLabels(opts) {
  const win = window.open('', '_blank');
  if (!win) {
    throw new Error('Jendela cetak diblokir browser. Izinkan popup untuk situs ini lalu coba lagi.');
  }
  win.document.write(buildLabelDocument(opts));
  win.document.close();
  win.focus();
  win.print();
}

/**
 * Bangun dokumen cetak.
 * @param {object} opts
 * @param {string} opts.customerName nama pelanggan lengkap
 * @param {string} [opts.customerCode] kode pelanggan → baris besar (cabang)
 * @param {string} [opts.address] alamat cabang
 * @param {string} [opts.recipient] "Kepada"; kosong = urai otomatis dari nama
 * @param {string} [opts.phone] no. telepon
 * @param {string} [opts.phoneMode] 'baris' | 'sebaris' | 'tanpa'
 * @param {string} [opts.ekspedisi]
 * @param {number} [opts.stickers] jumlah stiker (mis. total colly)
 * @param {number} [opts.copies] salinan per stiker
 * @param {string} [opts.middleStyle] gaya baris tengah
 * @param {number} [opts.columnGapMm] jarak antar kolom (mm)
 * @param {boolean} [opts.showDo] tampilkan nomor DO kecil di bawah stiker
 * @param {string} [opts.no] nomor DO
 * @returns {string} HTML dokumen lengkap
 */
export function buildLabelDocument(opts) {
  const o = Object.assign({}, DEFAULTS, opts || {});
  const total = Math.max(1, Number(o.stickers) || 0) * Math.max(1, Number(o.copies) || 1);
  const totalPages = Math.ceil(total / LABELS_PER_PAGE);
  const gap = Math.max(0, Math.min(20, Number(o.columnGapMm) || 0));

  const doc = document.implementation.createHTMLDocument('Sticker Alamat');
  doc.head.innerHTML = '<meta charset="utf-8">' + LABEL_STYLE.replace('__GAP__', gap + 'mm');
  doc.body.innerHTML = '<div id="pages"></div>';

  const host = doc.getElementById('pages');
  let dibuat = 0;

  for (let p = 0; p < totalPages; p++) {
    const page = el(doc, 'div', 'page');
    for (let i = 0; i < LABELS_PER_PAGE; i++) {
      if (dibuat < total) {
        page.appendChild(buildSticker(doc, o));
        dibuat++;
      } else {
        page.appendChild(el(doc, 'div', 'sticker')); // slot kosong agar grid rapi
      }
    }
    host.appendChild(page);
  }

  return '<!DOCTYPE html>' + doc.documentElement.outerHTML;
}

/* =========================================================
   BAGIAN DALAM
   ========================================================= */

/** Buat elemen dengan teks aman. */
function el(doc, tag, cls, text) {
  const node = doc.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

/** Baris "Label : nilai" dengan titik dua sejajar. */
function row(doc, label, isi) {
  const r = el(doc, 'div', 'flex-row');
  r.appendChild(el(doc, 'div', 'lbl', label));
  r.appendChild(el(doc, 'div', 'separator', ':'));
  if (typeof isi === 'string') r.appendChild(el(doc, 'div', 'val', isi));
  else r.appendChild(isi);
  return r;
}

/** Isi baris tengah sesuai gaya terpilih. */
function middleLine(o) {
  if (o.middleStyle === 'nama-kode') return { atas: o.customerName, besar: o.customerCode };
  if (o.middleStyle === 'enseval-nama') return { atas: 'Enseval', besar: o.customerName };
  if (o.middleStyle === 'enseval-kode') return { atas: 'Enseval', besar: o.customerCode };
  return { atas: '', besar: o.customerCode }; // kosong-kode (default)
}

/** Satu kotak stiker. */
function buildSticker(doc, o) {
  const wrap = el(doc, 'div', 'sticker');

  const kepada = String(o.recipient || '').trim() || parseRecipient(o.customerName) || o.customerName || '';
  const telepon = String(o.phone || '').trim();
  const pakaiTelepon = o.phoneMode !== 'tanpa' && telepon;

  // --- Kepada (+ telepon) ---
  const titleRow = el(doc, 'div', 'flex-row title-row');
  titleRow.appendChild(el(doc, 'div', 'lbl', 'Kepada'));
  titleRow.appendChild(el(doc, 'div', 'separator', ':'));
  if (o.phoneMode === 'sebaris' && pakaiTelepon) {
    const val = el(doc, 'div', 'val');
    val.appendChild(el(doc, 'span', 'namapenerima', kepada));
    val.appendChild(el(doc, 'span', 'telepon', ' / ' + telepon));
    titleRow.appendChild(val);
  } else {
    titleRow.appendChild(el(doc, 'span', 'namapenerima', kepada));
  }
  wrap.appendChild(titleRow);

  if (o.phoneMode === 'baris' && pakaiTelepon) {
    const telpRow = el(doc, 'div', 'flex-row title-row');
    telpRow.appendChild(el(doc, 'div', 'lbl', 'Telepon'));
    telpRow.appendChild(el(doc, 'div', 'separator', ':'));
    telpRow.appendChild(el(doc, 'span', 'namapenerima', telepon));
    wrap.appendChild(telpRow);
  }

  // --- Tujuan ---
  const group = el(doc, 'div', 'val tujuan-group');
  const mid = middleLine(o);
  if (mid.atas) group.appendChild(el(doc, 'span', 'enseval', mid.atas)); // kosong -> tidak dirender
  group.appendChild(el(doc, 'span', 'cabang', mid.besar || ''));
  group.appendChild(el(doc, 'span', 'alamat', o.address || ''));

  const tujuanRow = row(doc, 'Tujuan', group);
  tujuanRow.style.flexGrow = '1';
  wrap.appendChild(tujuanRow);

  // --- Ekspedisi ---
  const eksVal = el(doc, 'div', 'val', o.ekspedisi || '');
  eksVal.style.fontWeight = 'bold';
  const eksRow = row(doc, 'Ekspedisi', eksVal);
  eksRow.classList.add('ekspedisi-row');
  wrap.appendChild(eksRow);

  if (o.showDo && o.no) wrap.appendChild(el(doc, 'div', 'do-tag', 'DO: ' + o.no));

  return wrap;
}

/** Gaya dokumen (tanpa data dinamis). */
const LABEL_STYLE = `
<style>
  @page { size: 214mm 165mm landscape; margin: 0; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: 'Segoe UI', Arial, sans-serif;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page {
    width: 214mm; height: 165mm; background: #fff;
    padding: 1mm 7mm; box-sizing: border-box;
    display: grid;
    grid-template-columns: 100mm 100mm;
    grid-template-rows: 50mm 50mm 50mm;
    column-gap: __GAP__;
    row-gap: 0.2cm;
    justify-content: center;
    align-content: center;
    page-break-after: always;
    position: relative;
  }
  .sticker {
    width: 100mm; height: 50mm; box-sizing: border-box;
    padding: 5mm 8mm; display: flex; flex-direction: column;
    font-size: 13px; line-height: 1.4; color: #000; border-radius: 5%;
  }
  .title-row { margin-bottom: 5px; }
  .title-row + .title-row { margin-top: -3px; }
  .flex-row { display: flex; align-items: flex-start; }
  .lbl { width: 65px; font-weight: bold; flex-shrink: 0; }
  .separator { width: 15px; font-weight: bold; flex-shrink: 0; }
  .val { flex-grow: 1; }
  .tujuan-group { display: flex; flex-direction: column; }
  .title-row .namapenerima { font-weight: bold; font-size: 15px; }
  .title-row .telepon { font-size: 12px; }
  .tujuan-group .enseval { font-weight: bold; font-size: 14px; }
  .tujuan-group .cabang { font-weight: bold; font-size: 30px; line-height: .9; margin-bottom: 3px; }
  .tujuan-group .alamat { font-size: 11px; line-height: 1.2; }
  .ekspedisi-row { margin-top: auto; padding-top: 5px; }
  .do-tag { font-size: 10px; color: #555; margin-top: 2px; }
</style>`;
