/**
 * print.js — Cetak Surat Jalan.
 *
 * Alur (PRD 6.7 & 12.3):
 *  1. Ambil data dari action `shipment.printData` (server menambah print_count
 *     dan menyimpan last_printed_at).
 *  2. Render dokumen berkop perusahaan ke jendela baru.
 *  3. Panggil window.print().
 *
 * SEMUA teks dirender lewat textContent/createElement untuk mencegah XSS
 * (temuan prototipe #9 — innerHTML tanpa escape).
 */

import { shipment } from './api.js';
import { fmt, fmtDate, findProduct, findCustomer } from './state.js';

/**
 * Cetak Surat Jalan untuk satu nomor pengiriman.
 *
 * Urutan penting: jendela dibuka SINKRON di dalam handler klik (agar tidak
 * diblokir popup blocker) SEBELUM memanggil server. Dengan begitu, bila popup
 * diblokir, `print_count` tidak ikut naik (server hanya menambah saat data
 * cetak benar-benar diminta).
 *
 * @param {string} no nomor DO, mis. 'DO-TTR-001'
 */
export async function printSuratJalan(no) {
  const win = window.open('', '_blank');
  if (!win) {
    throw new Error('Jendela cetak diblokir browser. Izinkan popup untuk situs ini lalu coba lagi.');
  }

  try {
    // Server menaikkan print_count saat data cetak diminta.
    const data = await shipment.printData(no);
    win.document.write(buildDocument(data));
    win.document.close();
    win.focus();
    win.print();
  } catch (err) {
    try { win.close(); } catch (ignore) { /* jendela mungkin sudah tertutup */ }
    throw err;
  }
}

/**
 * Bangun HTML dokumen cetak.
 * @param {object} data hasil shipment.printData
 * @returns {string} HTML lengkap
 */
export function buildDocument(data) {
  // Kop perusahaan tidak dicetak (lihat catatan di PRINT_TEMPLATE), jadi data
  // company tidak lagi dipakai di sini.
  const customer = data.customer || findCustomer(data.customerId);
  const rows = (data.lines || []).map((l, i) => {
    const p = findProduct(l.productId);
    return { i: i + 1, p, l };
  });
  const totalQty = (data.lines || []).reduce((a, l) => a + Number(l.qty || 0), 0);
  const totalColly = (data.lines || []).reduce((a, l) => a + Number(l.colly || 0), 0);

  // Bangun DOM lewat API aman, bukan string interpolation.
  const doc = document.implementation.createHTMLDocument('Surat Jalan ' + no_(data));
  doc.body.innerHTML = PRINT_TEMPLATE;

  setText(doc, '#docNo', no_(data));
  setText(doc, '#docDate', fmtDate(data.date));

  setText(doc, '#custName', customer.name);
  setText(doc, '#custAddr', customer.address);
  setText(doc, '#custPhone', customer.phone);
  // Satu baris "Ekspedisi" menggantikan Sopir + Kendaraan.
  setText(doc, '#ekspedisi', data.ekspedisi || '—');

  const tbody = doc.querySelector('#docRows');
  rows.forEach(({ i, p, l }) => {
    const tr = doc.createElement('tr');
    // Kolom Rak dihilangkan; Colly ditambahkan.
    [
      String(i),
      p.code || '—',
      p.name || '—',
      l.batchNumber || '—',
      l.ed ? fmtDate(l.ed) : '—',
      l.sjNo || '—',
      `${fmt(l.qty)} ${p.unit || ''}`.trim(),
      l.colly ? fmt(l.colly) : '—'
    ].forEach((text) => {
      const td = doc.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  setText(doc, '#totalQty', fmt(totalQty));
  setText(doc, '#totalColly', fmt(totalColly));
  setText(doc, '#docNote', data.note || '');

  return '<!DOCTYPE html>' + doc.documentElement.outerHTML;
}

function no_(data) {
  return data.no || data.shipmentNo || '—';
}

function setText(doc, selector, value) {
  const el = doc.querySelector(selector);
  if (el) el.textContent = value == null ? '' : String(value);
}

/** Kerangka dokumen cetak (tanpa data dinamis — aman dari XSS). */
const PRINT_TEMPLATE = `
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000;
    font-size: 10.5pt; line-height: 1.4; background: #fff; }
  .sheet { max-width: 190mm; margin: 0 auto; padding: 8mm 0; }

  .kop { display: flex; align-items: center; gap: 14px; padding-bottom: 12px;
    border-bottom: 3px double #000; margin-bottom: 18px; }
  .kop-logo { width: 54px; height: 54px; border-radius: 10px; flex: none;
    background: #4f46e5; color: #fff; display: flex; align-items: center;
    justify-content: center; font-weight: 700; font-size: 18pt; }
  .kop-line { font-size: 9pt; color: #444; }
  .kop-title { margin-left: auto; text-align: right; flex: none; }
  .kop-title h1 { margin: 0; font-size: 15pt; letter-spacing: 3px; }
  .kop-no { font-family: 'Courier New', monospace; font-size: 11pt; font-weight: 700; }

  .meta { display: grid; grid-template-columns: 1.3fr 1fr; gap: 14px; margin-bottom: 18px; }
  .meta > div { border: 1px solid #333; padding: 10px 12px; }
  .meta-label { font-size: 8.5pt; text-transform: uppercase; letter-spacing: 1px;
    color: #666; border-bottom: 1px solid #ddd; padding-bottom: 5px; margin-bottom: 7px; }
  .meta-strong { font-weight: 700; font-size: 11pt; }
  .meta-line { font-size: 9.5pt; }

  .doc-tbl { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
  .doc-tbl th { background: #f0f0f0; border: 1px solid #333; padding: 7px 5px;
    font-size: 8pt; text-transform: uppercase; letter-spacing: .3px; text-align: left; }
  .doc-tbl td { border: 1px solid #999; padding: 6px 5px; font-size: 9pt; vertical-align: top; }
  .doc-tbl tfoot td { background: #f7f7f7; font-weight: 700; border-top: 2px solid #000; }

  .doc-note { background: #f8f9ff; border-left: 3px solid #4f46e5;
    padding: 10px 12px; font-size: 9.5pt; margin: 0 0 24px; }

  .signs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px;
    page-break-inside: avoid; }
  .signs > div { text-align: center; font-size: 10pt; }
  .sign-line { border-top: 1px solid #000; margin-top: 62px; padding-top: 6px; }
  .sign-cap { font-size: 9.5pt; color: #333; }

  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
<div class="sheet">
  <!--
    Kop perusahaan (nama, alamat, email) SENGAJA tidak dicetak — dokumen
    biasanya dicetak di atas kertas berkop. Yang tampil hanya logo, judul
    dokumen, nomor, dan tanggal.
  -->
  <header class="kop">
    <div class="kop-logo"></div>
    <div class="kop-title">
      <h1>SURAT JALAN</h1>
      <div class="kop-no" id="docNo"></div>
      <div class="kop-line" id="docDate"></div>
    </div>
  </header>

  <section class="meta">
    <div>
      <div class="meta-label">Kepada</div>
      <div class="meta-strong" id="custName"></div>
      <div class="meta-line" id="custAddr"></div>
      <div class="meta-line" id="custPhone"></div>
    </div>
    <div>
      <div class="meta-label">Ekspedisi</div>
      <div class="meta-line"><b id="ekspedisi"></b></div>
    </div>
  </section>

  <table class="doc-tbl">
    <thead>
      <tr>
        <th>#</th><th>Kode</th><th>Produk</th><th>No. Batch</th>
        <th>ED</th><th>SJ Asal</th><th>Qty</th><th>Colly</th>
      </tr>
    </thead>
    <tbody id="docRows"></tbody>
    <tfoot>
      <tr>
        <td colspan="6">Total</td>
        <td id="totalQty"></td>
        <td id="totalColly"></td>
      </tr>
    </tfoot>
  </table>

  <p class="doc-note" id="docNote"></p>

  <section class="signs">
    <div><div class="sign-line"></div><div class="sign-cap">Disiapkan Gudang</div></div>
    <div><div class="sign-line"></div><div class="sign-cap">Ekspedisi / Pengirim</div></div>
    <div><div class="sign-line"></div><div class="sign-cap">Diterima Pelanggan</div></div>
  </section>
</div>
`;
