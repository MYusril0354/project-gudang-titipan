/**
 * Handlers_Stock.gs — Stok titipan per batch (PRD 6.6).
 *
 * Prinsip (PRD 6.6 & 10): stok TIDAK disimpan sebagai kolom; selalu dihitung
 * dari receipts − shipment_consumptions pengiriman non-DRAFT & non-VOID.
 *
 * Satu "batch" = satu baris `receipts` (setiap penerimaan fisik membuat satu
 * batch dengan nomor batch unik). Karena itu id batch = id receipt.
 *
 * Cakupan: stock.list, stock.available — plus dataset bersama yang dipakai
 * juga oleh Handlers_Shipment.gs.
 */

/**
 * Muat seluruh data yang dibutuhkan perhitungan stok dalam satu request.
 * Tiap tabel dibaca SATU kali (PRD 13: kinerja).
 *
 * @param {{withMovements?: boolean}} [opts] `movements` hanya dibaca bila
 *   diminta — dashboard dan pengiriman tidak memakainya, jadi tidak perlu
 *   membayar satu getValues ekstra.
 */
function stockDataset_(opts) {
  var wantMovements = Boolean(opts && opts.withMovements);
  var receipts = readTable_('receipts');
  var consumptions = readTable_('shipment_consumptions');
  var shipments = readTable_('shipments');
  var shipmentLines = readTable_('shipment_lines');

  var shipmentsByNo = {};
  shipments.forEach(function (s) { shipmentsByNo[String(s.no)] = s; });

  // Tabel shipment_consumptions tidak menyimpan nomor pengiriman; nomor itu
  // diambil dari shipment_lines. Tanpa ini, `isIgnoredShipment_` tidak bisa
  // tahu pengiriman mana yang VOID/DRAFT sehingga void gagal mengembalikan stok.
  var shipmentNoByLineId = {};
  var linesByNo = {};
  shipmentLines.forEach(function (l) {
    shipmentNoByLineId[String(l.id)] = l.shipment_no;
    var k = String(l.shipment_no);
    if (!linesByNo[k]) linesByNo[k] = [];
    linesByNo[k].push(l);
  });

  var consumptionsByReceipt = {};
  var consumptionsByLine = {};
  consumptions.forEach(function (c) {
    c.shipment_no = shipmentNoByLineId[String(c.shipment_line_id)] || '';

    var kr = String(c.receipt_id);
    if (!consumptionsByReceipt[kr]) consumptionsByReceipt[kr] = [];
    consumptionsByReceipt[kr].push(c);

    var kl = String(c.shipment_line_id);
    if (!consumptionsByLine[kl]) consumptionsByLine[kl] = [];
    consumptionsByLine[kl].push(c);
  });

  var receiptsById = {};
  var receiptsByLine = {};
  receipts.forEach(function (r) {
    receiptsById[String(r.id)] = r;
    var kl = String(r.sj_line_id);
    if (!receiptsByLine[kl]) receiptsByLine[kl] = [];
    receiptsByLine[kl].push(r);
  });

  var sjs = readTable_('sj');
  var sjLines = readTable_('sj_lines');

  var linesById = {};
  var sjLinesByNo = {};
  sjLines.forEach(function (l) {
    linesById[String(l.id)] = l;
    var k = String(l.sj_no);
    if (!sjLinesByNo[k]) sjLinesByNo[k] = [];
    sjLinesByNo[k].push(l);
  });

  var sjByNo = {};
  sjs.forEach(function (s) { sjByNo[String(s.no)] = s; });

  var productsById = {};
  readTable_('products').forEach(function (p) { productsById[String(p.id)] = p; });

  var racksById = {};
  readTable_('racks').forEach(function (r) { racksById[String(r.id)] = r; });

  var customersById = {};
  readTable_('customers').forEach(function (c) { customersById[String(c.id)] = c; });

  return {
    receipts: receipts,
    consumptions: consumptions,
    shipments: shipments,
    shipmentLines: shipmentLines,
    movements: wantMovements ? readTable_('movements') : [],
    sjs: sjs,
    sjLines: sjLines,
    shipmentsByNo: shipmentsByNo,
    linesByNo: linesByNo,
    consumptionsByReceipt: consumptionsByReceipt,
    consumptionsByLine: consumptionsByLine,
    receiptsById: receiptsById,
    receiptsByLine: receiptsByLine,
    linesById: linesById,
    sjLinesByNo: sjLinesByNo,
    sjByNo: sjByNo,
    productsById: productsById,
    racksById: racksById,
    customersById: customersById
  };
}

/** Bentuk satu batch siap pakai frontend + sisa stok terhitung. */
function batchView_(receipt, ds) {
  var line = ds.linesById[String(receipt.sj_line_id)] || {};
  var sj = ds.sjByNo[String(line.sj_no)] || {};
  var product = ds.productsById[String(line.product_id)] || {};
  var rack = ds.racksById[String(receipt.rack_id)] || {};
  var customer = ds.customersById[String(sj.customer_id)] || {};
  var consumptions = ds.consumptionsByReceipt[String(receipt.id)] || [];

  return {
    id: receipt.id,
    batchNumber: receipt.batch_number || '',
    date: receipt.date,
    qtyIn: Number(receipt.qty || 0),
    available: batchAvailable_(receipt, consumptions, ds.shipments),
    kondisi: receipt.kondisi || '',
    pic: receipt.pic || '',
    rackId: receipt.rack_id,
    rackCode: rack.code || '',
    rackName: rack.name || '',
    productId: line.product_id,
    productCode: product.code || '',
    productName: product.name || '',
    unit: product.unit || '',
    sjNo: line.sj_no || '',
    customerId: sj.customer_id || '',
    customerName: customer.name || ''
  };
}

/** Semua batch (termasuk yang habis) dalam bentuk view. */
function allBatchViews_(ds) {
  return ds.receipts.map(function (r) { return batchView_(r, ds); });
}

/** Urutkan batch: pelanggan, produk, lalu tanggal/batch. */
function sortBatchViews_(items) {
  return items.sort(function (a, b) {
    var c = String(a.customerName).localeCompare(String(b.customerName));
    if (c !== 0) return c;
    var p = String(a.productCode).localeCompare(String(b.productCode));
    if (p !== 0) return p;
    var d = String(a.date).localeCompare(String(b.date));
    if (d !== 0) return d;
    return String(a.batchNumber).localeCompare(String(b.batchNumber));
  });
}

/* =========================================================
   ACTION
   ========================================================= */

/**
 * Posisi stok per batch (hanya sisa > 0) + ringkasan per pelanggan.
 * @param {Object} params { q, customerId, productId, includeEmpty }
 */
function stockList_(params, ctx) {
  var ds = stockDataset_();
  var includeEmpty = isTrue_(params.includeEmpty);
  var items = allBatchViews_(ds);

  if (!includeEmpty) items = items.filter(function (b) { return b.available > 0; });

  var customerId = String(params.customerId || '').trim();
  if (customerId) items = items.filter(function (b) { return String(b.customerId) === customerId; });

  var productId = String(params.productId || '').trim();
  if (productId) items = items.filter(function (b) { return String(b.productId) === productId; });

  var q = String(params.q || '').trim().toLowerCase();
  if (q) {
    items = items.filter(function (b) {
      return [b.batchNumber, b.productCode, b.productName, b.customerName, b.sjNo, b.rackCode]
        .some(function (v) { return String(v || '').toLowerCase().indexOf(q) !== -1; });
    });
  }

  sortBatchViews_(items);

  // Ringkasan per pelanggan.
  var byCustomer = {};
  items.forEach(function (b) {
    var k = String(b.customerId);
    if (!byCustomer[k]) {
      byCustomer[k] = {
        customerId: b.customerId,
        customerName: b.customerName || '(pelanggan terhapus)',
        qty: 0,
        batches: 0
      };
    }
    byCustomer[k].qty += b.available;
    byCustomer[k].batches += 1;
  });

  var perCustomer = Object.keys(byCustomer).map(function (k) { return byCustomer[k]; })
    .sort(function (a, b) { return b.qty - a.qty; });

  var totalQty = items.reduce(function (a, b) { return a + b.available; }, 0);

  return {
    items: items,
    perCustomer: perCustomer,
    totals: { batches: items.length, qty: totalQty, customers: perCustomer.length }
  };
}

/** Batch tersedia untuk satu pelanggan — dasar form pengiriman. */
function stockAvailable_(params, ctx) {
  var customerId = String(assertRequired_(params.customerId, 'customerId', 'Pelanggan')).trim();

  if (!readTableWhere_('customers', { id: customerId }).length) {
    throw apiError_('NOT_FOUND', 'Pelanggan tidak ditemukan.', 'customerId');
  }

  var ds = stockDataset_();
  var items = allBatchViews_(ds).filter(function (b) {
    return String(b.customerId) === customerId && b.available > 0;
  });

  sortBatchViews_(items);

  return {
    customerId: customerId,
    items: items,
    totals: {
      batches: items.length,
      qty: items.reduce(function (a, b) { return a + b.available; }, 0)
    }
  };
}
