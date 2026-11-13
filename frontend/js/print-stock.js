/**
 * print-stock.js — Cetak Laporan Posisi Stok Titipan.
 *
 * Berbeda dari cetak surat jalan (per dokumen), laporan ini memuat seluruh batch
 * yang tampil sesuai filter halaman Stok Titipan.
 *
 * Data diambil ULANG dari server (`fresh: true`) tepat sebelum dicetak, supaya
 * angka pada dokumen resmi tidak memakai salinan cache.
 *
 * SEMUA teks dirender lewat textContent/createElement — tidak ada data pengguna
 * yang disisipkan sebagai HTML.
 */

import { stock } from './api.js';
import { fmt, fmtDate } from './state.js';

/**
 * Cetak laporan posisi stok.
 * Jendela dibuka sinkron lebih dulu supaya tidak diblokir popup blocker.
 *
 * @param {{filter?: object, customerName?: string, keyword?: string, modeLabel?: string}} opts
 */
export async function printStockPosition(opts = {}) {
  const win = window.open('', '_blank');
  if (!win) {
    throw new Error('Jendela cetak diblokir browser. Izinkan popup untuk situs ini lalu coba lagi.');
  }

  win.document.write(
    '<!DOCTYPE html><meta charset="utf-8">'
      + '<p style="font:14px Arial,Helvetica,sans-serif;padding:24px;color:#444">'
      + 'Menyiapkan laporan posisi stok&hellip;</p>'
  );

  try {
    const data = await stock.list(opts.filter || {}, { fresh: true });
    const html = buildStockDocument(data, opts);
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  } catch (err) {
    try { win.close(); } catch (ignore) { /* jendela mungkin sudah tertutup */ }
    throw err;
  }
}

/**
 * Bangun HTML laporan (fungsi murni, bisa diuji tanpa membuka jendela).
 * @param {object} data hasil `stock.list`
 * @param {{customerName?: string, keyword?: string, printedAt?: string, modeLabel?: string}} opts
 * @returns {string} HTML lengkap
 */
export function buildStockDocument(data, opts = {}) {
  const items = data.items || [];
  const totals = data.totals || { batches: items.length, qty: 0, customers: 0 };
  const perCustomer = data.perCustomer || [];

  const doc = document.implementation.createHTMLDocument('Posisi Stok Titipan');
  doc.body.innerHTML = TEMPLATE;

  setText(doc, '#judul', 'LAPORAN POSISI STOK TITIPAN');
  setText(doc, '#filterPelanggan', opts.customerName || 'Semua pelanggan');
  setText(doc, '#filterMode', opts.modeLabel || 'Sisa > 0');
  setText(doc, '#filterKata', opts.keyword ? `Kata kunci: "${opts.keyword}"` : '');
  setText(doc, '#dicatat', opts.printedAt || new Date().toLocaleString('id-ID'));
  setText(doc, '#fTotalBatch', fmt(totals.batches));
  setText(doc, '#fTotalQty', fmt(totals.qty));
  setText(doc, '#fTotalPelanggan', fmt(totals.customers));

  // --- tabel batch ---
  // Urutan kolom: No, Kode Pelanggan, Kode Produk, Rak, Batch, Masuk, Sisa, Satuan, ED
  const tbody = doc.querySelector('#rows');
  let totalIn = 0;

  items.forEach((b, i) => {
    totalIn += Number(b.qtyIn || 0);
    const tr = doc.createElement('tr');
    [
      String(i + 1),
      b.customerCode || '—',
      b.productCode || '—',
      b.rackCode || '—',
      String(b.batchNumber || '') || '—',
      fmt(b.qtyIn),
      fmt(b.available),
      b.unit || '',
      b.ed ? fmtDate(b.ed) : '—'
    ].forEach((text, idx) => {
      const td = doc.createElement('td');
      td.textContent = text;
      if (idx === 0 || idx === 5 || idx === 6 || idx === 8) td.className = 'c';
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  if (!items.length) {
    const tr = doc.createElement('tr');
    const td = doc.createElement('td');
    td.colSpan = 9;
    td.className = 'empty';
    td.textContent = 'Tidak ada batch yang cocok dengan filter.';
    tr.appendChild(td);
    tbody.appendChild(tr);
  }

  setText(doc, '#tMasuk', fmt(totalIn));
  setText(doc, '#tSisa', fmt(totals.qty));

  // --- rekap per pelanggan ---
  const rekapBody = doc.querySelector('#rekapRows');
  if (perCustomer.length > 1) {
    perCustomer.forEach((c) => {
      const tr = doc.createElement('tr');
      [c.customerName || '—', fmt(c.batches), fmt(c.qty)].forEach((text, idx) => {
        const td = doc.createElement('td');
        td.textContent = text;
        if (idx > 0) td.className = 'c';
        tr.appendChild(td);
      });
      rekapBody.appendChild(tr);
    });
  } else {
    doc.querySelector('#rekapSection').style.display = 'none';
  }

  // --- tanda tangan ---
  const tgl = doc.createElement('div');
  tgl.className = 'ttd-tgl';
  tgl.textContent = `Tanggal: ${opts.printedAt || new Date().toLocaleDateString('id-ID')}`;
  doc.querySelector('#ttdTanggal').appendChild(tgl);

  return '<!DOCTYPE html>' + doc.documentElement.outerHTML;
}

/**
 * Isi dokumen, aman dari teks yang mengandung karakter HTML.
 *
 * Catatan: karena data pengguna TIDAK PERNAH masuk ke TEMPLATE, panggilan ini
 * hanya menulis ke elemen statis (judul, angka, label).
 */
function setText(doc, selector, value) {
  const el = doc.querySelector(selector);
  if (el) el.textContent = value == null ? '' : String(value);
}

/** Kerangka laporan (tanpa data dinamis). */
const TEMPLATE = `
<style>
  @page { size: A4 landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000;
    font-size: 9.5pt; line-height: 1.35; background: #fff; }
  .sheet { max-width: 273mm; margin: 0 auto; padding: 4mm 0; }

  h1 { margin: 0; font-size: 14pt; letter-spacing: 2px; text-align: center; }
  .sub { text-align: center; font-size: 9pt; color: #444; margin-top: 3px; }
  .rule { border-bottom: 2px solid #000; margin: 10px 0 12px; }

  .info { display: flex; justify-content: space-between; gap: 16px;
    margin-bottom: 12px; font-size: 9pt; }
  .info .box { border: 1px solid #999; padding: 7px 10px; min-width: 46mm; }
  .info .k { color: #555; font-size: 8pt; text-transform: uppercase;
    letter-spacing: .5px; display: block; }
  .info b { font-size: 11pt; }

  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #888; padding: 4px 5px; vertical-align: top; }
  th { background: #eee; font-size: 8pt; text-transform: uppercase;
    letter-spacing: .3px; text-align: left; }
  td { font-size: 8.5pt; }
  td.c { text-align: center; }
  tfoot td { background: #f5f5f5; font-weight: 700; }
  td.empty { text-align: center; color: #666; padding: 14px; }

  h2 { font-size: 10pt; margin: 16px 0 6px; }
  .rekap { width: auto; min-width: 90mm; }

  .ttd { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px;
    margin-top: 34px; page-break-inside: avoid; }
  .ttd > div { text-align: center; font-size: 9.5pt; }
  .ttd .garis { border-top: 1px solid #000; margin-top: 58px; padding-top: 5px; }
  .ttd-tgl { font-size: 9pt; margin-bottom: 4px; }

  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
<div class="sheet">
  <h1 id="judul"></h1>
  <div class="sub" id="dicatat"></div>
  <div class="rule"></div>

  <div class="info">
    <div class="box"><span class="k">Pelanggan</span><span id="filterPelanggan"></span>
      <div class="sub" id="filterKata" style="text-align:left"></div></div>
    <div class="box"><span class="k">Filter Sisa</span><b id="filterMode"></b></div>
    <div class="box"><span class="k">Total Batch</span><b id="fTotalBatch"></b></div>
    <div class="box"><span class="k">Total Sisa (unit)</span><b id="fTotalQty"></b></div>
    <div class="box"><span class="k">Pelanggan Berstok</span><b id="fTotalPelanggan"></b></div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:9mm">No</th>
        <th style="width:26mm">Kode Pelanggan</th>
        <th style="width:26mm">Kode Produk</th>
        <th style="width:30mm">Rak</th>
        <th>Batch</th>
        <th style="width:20mm">Masuk</th>
        <th style="width:20mm">Sisa</th>
        <th style="width:18mm">Satuan</th>
        <th style="width:26mm">ED</th>
      </tr>
    </thead>
    <tbody id="rows"></tbody>
    <tfoot>
      <tr>
        <td colspan="5">TOTAL</td>
        <td class="c" id="tMasuk"></td>
        <td class="c" id="tSisa"></td>
        <td colspan="2"></td>
      </tr>
    </tfoot>
  </table>

  <div id="rekapSection">
    <h2>Rekap per Pelanggan</h2>
    <table class="rekap">
      <thead><tr><th>Pelanggan</th><th style="width:20mm">Batch</th><th style="width:24mm">Sisa</th></tr></thead>
      <tbody id="rekapRows"></tbody>
    </table>
  </div>

  <div class="ttd">
    <div><div class="ttd-tgl">&nbsp;</div><div class="garis">Dibuat oleh</div></div>
    <div><div id="ttdTanggal">&nbsp;</div><div class="garis">Diperiksa</div></div>
    <div><div class="ttd-tgl">&nbsp;</div><div class="garis">Diterima</div></div>
  </div>
</div>
`;
