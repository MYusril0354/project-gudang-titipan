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
import { state, fmt, fmtDate, findProduct, findCustomer, findRack } from './state.js';

/**
 * Cetak Surat Jalan untuk satu nomor pengiriman.
 * @param {string} no nomor DO, mis. 'DO-TTR-001'
 */
export async function printSuratJalan(no) {
  // Server menaikkan print_count saat data cetak diminta.
  const data = await shipment.printData(no);
  const win = window.open('', '_blank');
  if (!win) {
    throw new Error('Jendela cetak diblokir browser. Izinkan popup untuk situs ini lalu coba lagi.');
  }
  win.document.write(buildDocument(data));
  win.document.close();
  win.focus();
  win.print();
}

/**
 * Bangun HTML dokumen cetak.
 * @param {object} data hasil shipment.printData
 * @returns {string} HTML lengkap
 */
export function buildDocument(data) {
  const company = data.company || state.company || {};
  const customer = data.customer || findCustomer(data.customerId);
  const rows = (data.lines || []).map((l, i) => {
    const p = findProduct(l.productId);
    const r = findRack(l.rackId);
    return { i: i + 1, p, r, l };
  });
  const totalQty = (data.lines || []).reduce((a, l) => a + Number(l.qty || 0), 0);

  // Bangun DOM lewat API aman, bukan string interpolation.
  const doc = document.implementation.createHTMLDocument('Surat Jalan ' + no_(data));
  doc.body.innerHTML = PRINT_TEMPLATE;

  setText(doc, '#coName', company.name || '');
  setText(doc, '#coAddr', [company.address, company.phone].filter(Boolean).join(' · '));
  setText(doc, '#coEmail', company.email || '');
  setText(doc, '#docNo', no_(data));
  setText(doc, '#docDate', fmtDate(data.date));

  setText(doc, '#custName', customer.name);
  setText(doc, '#custAddr', customer.address);
  setText(doc, '#custPhone', customer.phone);
  setText(doc, '#driver', data.driver || '—');
  setText(doc, '#vehicle', data.vehicle || '—');

  const tbody = doc.querySelector('#docRows');
  rows.forEach(({ i, p, r, l }) => {
    const tr = doc.createElement('tr');
    [
      String(i),
      p.code || '—',
      p.name || '—',
      l.batchNumber || '—',
      l.sjNo || '—',
      r.code || '—',
      `${fmt(l.qty)} ${p.unit || ''}`.trim()
    ].forEach((text) => {
      const td = doc.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  setText(doc, '#totalQty', fmt(totalQty));
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
<div class="sheet">
  <header class="kop">
    <div class="kop-logo"></div>
    <div class="kop-text">
      <div class="kop-name" id="coName"></div>
      <div class="kop-line" id="coAddr"></div>
      <div class="kop-line" id="coEmail"></div>
    </div>
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
      <div class="meta-label">Pengangkutan</div>
      <div class="meta-line">Sopir: <b id="driver"></b></div>
      <div class="meta-line">Kendaraan: <b id="vehicle"></b></div>
    </div>
  </section>

  <table class="doc-tbl">
    <thead>
      <tr>
        <th>#</th><th>Kode</th><th>Produk</th><th>No. Batch</th>
        <th>SJ Asal</th><th>Rak</th><th>Qty</th>
      </tr>
    </thead>
    <tbody id="docRows"></tbody>
    <tfoot>
      <tr><td colspan="6">Total</td><td id="totalQty"></td></tr>
    </tfoot>
  </table>

  <p class="doc-note" id="docNote"></p>

  <section class="signs">
    <div><div class="sign-line"></div><div class="sign-cap">Disiapkan Gudang</div></div>
    <div><div class="sign-line"></div><div class="sign-cap">Sopir / Pengirim</div></div>
    <div><div class="sign-line"></div><div class="sign-cap">Diterima Pelanggan</div></div>
  </section>
</div>
`;
