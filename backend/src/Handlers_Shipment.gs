/**
 * Handlers_Shipment.gs — Pengiriman keluar dari gudang titipan (PRD 6.7).
 *
 * Cakupan: shipment.list, shipment.get, shipment.create, shipment.markDelivered,
 *          shipment.printData, shipment.void.
 *
 * Aturan kunci:
 *  - Pengiriman selalu dari SATU pelanggan; baris dipilih dari batch miliknya.
 *  - Qty per baris <= sisa batch, dihitung juga terhadap baris lain di dokumen
 *    yang sama; validasi ULANG di server di dalam lock (stok bisa berubah).
 *  - Simpan dari UI langsung berstatus SHIPPED (langsung memotong stok).
 *  - Nomor DO memakai counter terpisah (bukan jumlah baris) agar tidak bentrok.
 *  - Void (ADMIN) mengembalikan stok: pengiriman VOID diabaikan saat menghitung
 *    sisa batch, dan dicatat sebagai mutasi VOID_OUT (+qty) untuk jejak.
 */

/* =========================================================
   VIEW
   ========================================================= */

/** Satu baris pengiriman siap pakai frontend (termasuk batch & SJ asal). */
function shipmentLineView_(line, ds) {
  var product = ds.productsById[String(line.product_id)] || {};
  var rack = ds.racksById[String(line.rack_id)] || {};

  var cons = ds.consumptionsByLine ? (ds.consumptionsByLine[String(line.id)] || []) : [];
  var first = cons[0] || {};

  return {
    id: line.id,
    productId: line.product_id,
    productCode: product.code || '',
    productName: product.name || '(produk terhapus)',
    unit: product.unit || '',
    rackId: line.rack_id,
    rackCode: rack.code || '',
    qty: Number(line.qty || 0),
    receiptId: first.receipt_id || '',
    batchNumber: first.batch_number || '',
    sjNo: first.sj_no || ''
  };
}

/** Satu pengiriman siap pakai frontend. */
function shipmentView_(sh, ds) {
  var customer = ds.customersById[String(sh.customer_id)] || {};
  var rawLines = (ds.linesByNo[String(sh.no)] || []);
  var lines = rawLines.map(function (l) { return shipmentLineView_(l, ds); });

  return {
    no: sh.no,
    date: sh.date,
    customerId: sh.customer_id,
    customerName: customer.name || '(pelanggan terhapus)',
    status: sh.status || 'SHIPPED',
    podDate: sh.pod_date || '',
    driver: sh.driver || '',
    vehicle: sh.vehicle || '',
    note: sh.note || '',
    printCount: Number(sh.print_count || 0),
    lastPrintedAt: sh.last_printed_at || '',
    totalLines: lines.length,
    totalQty: lines.reduce(function (a, l) { return a + l.qty; }, 0),
    lines: lines
  };
}

/**
 * Dataset pengiriman — stockDataset_() sudah memuat baris & konsumsi
 * per dokumen (linesByNo, consumptionsByLine), jadi cukup diteruskan.
 */
function shipmentDataset_() {
  return stockDataset_();
}

/** Ambil pengiriman berdasarkan nomor atau lempar NOT_FOUND. */
function findShipment_(no) {
  var found = readTableWhere_('shipments', { no: no });
  if (!found.length) throw apiError_('NOT_FOUND', 'Pengiriman tidak ditemukan.', 'no');
  return found[0];
}

/** Nomor DO final dari counter terpisah (PRD 6.7). */
function nextShipmentNumber_() {
  var existing = {};
  readTable_('shipments').forEach(function (s) { existing[String(s.no).toUpperCase()] = true; });

  for (var guard = 0; guard < 1000; guard++) {
    var candidate = formatSeq_('DO-TTR-', nextCounter_('DO-TTR'), 3);
    if (!existing[candidate]) return candidate;
  }
  throw apiError_('INTERNAL', 'Gagal menentukan nomor pengiriman baru.');
}

/* =========================================================
   ACTION — BACA
   ========================================================= */

/** Daftar pengiriman. Filter: q, status, customerId. */
function shipmentList_(params, ctx) {
  var ds = shipmentDataset_();
  var items = ds.shipments.map(function (s) { return shipmentView_(s, ds); });

  var q = String(params.q || '').trim().toLowerCase();
  if (q) {
    items = items.filter(function (it) {
      if (String(it.no).toLowerCase().indexOf(q) !== -1) return true;
      if (String(it.customerName).toLowerCase().indexOf(q) !== -1) return true;
      if (String(it.driver || '').toLowerCase().indexOf(q) !== -1) return true;
      if (String(it.note || '').toLowerCase().indexOf(q) !== -1) return true;
      return it.lines.some(function (l) {
        return String(l.productName).toLowerCase().indexOf(q) !== -1
          || String(l.productCode).toLowerCase().indexOf(q) !== -1
          || String(l.batchNumber).toLowerCase().indexOf(q) !== -1;
      });
    });
  }

  var status = String(params.status || '').trim().toUpperCase();
  if (status) items = items.filter(function (it) { return it.status === status; });

  var customerId = String(params.customerId || '').trim();
  if (customerId) items = items.filter(function (it) { return String(it.customerId) === customerId; });

  items.sort(function (a, b) {
    var d = String(b.date).localeCompare(String(a.date));
    return d !== 0 ? d : String(b.no).localeCompare(String(a.no));
  });

  var counts = { shipped: 0, delivered: 0, void: 0 };
  items.forEach(function (it) {
    if (it.status === 'SHIPPED' || it.status === 'DRAFT') counts.shipped++;
    else if (it.status === 'DELIVERED') counts.delivered++;
    else if (it.status === 'VOID') counts.void++;
  });

  return { items: items, total: items.length, counts: counts };
}

/** Detail satu pengiriman. */
function shipmentGet_(params, ctx) {
  var no = String(assertRequired_(params.no || params.shipmentNo, 'no', 'No pengiriman')).trim();
  var ds = shipmentDataset_();
  return shipmentView_(findShipment_(no), ds);
}

/* =========================================================
   ACTION — TULIS
   ========================================================= */

/**
 * Buat pengiriman (PRD 6.7).
 * Dipanggil di dalam lock router, jadi validasi stok di sini bersifat final.
 * @param {Object} params { date, customerId, driver, vehicle, note, lines:[{productId, receiptId, rackId, qty}] }
 */
function shipmentCreate_(params, ctx) {
  var date = assertDate_(params.date || todayStr_(), 'date');
  var customerId = String(assertRequired_(params.customerId, 'customerId', 'Pelanggan')).trim();

  var customers = readTableWhere_('customers', { id: customerId });
  if (!customers.length) throw apiError_('NOT_FOUND', 'Pelanggan tidak ditemukan.', 'customerId');

  var inputLines = params.lines;
  if (!inputLines || !inputLines.length) {
    throw apiError_('VALIDATION_ERROR', 'Minimal satu baris pengiriman.', 'lines');
  }
  if (inputLines.length > 200) {
    throw apiError_('VALIDATION_ERROR', 'Maksimal 200 baris per pengiriman.', 'lines');
  }

  var ds = stockDataset_();
  var prepared = [];
  var neededByBatch = {};

  for (var i = 0; i < inputLines.length; i++) {
    var ln = inputLines[i];
    var productId = String(assertRequired_(ln.productId, 'lines[' + i + '].productId', 'Produk baris ' + (i + 1)));
    var receiptId = String(assertRequired_(ln.receiptId, 'lines[' + i + '].receiptId', 'Batch baris ' + (i + 1)));
    var qty = assertPositiveInt_(ln.qty, 'lines[' + i + '].qty', 1);

    var receipt = ds.receiptsById[receiptId];
    if (!receipt) {
      throw apiError_('NOT_FOUND', 'Batch baris ' + (i + 1) + ' tidak ditemukan (mungkin sudah berubah).', 'lines');
    }

    // Batch harus milik pelanggan pengiriman ini (PRD 6.7).
    var view = batchView_(receipt, ds);
    if (String(view.customerId) !== customerId) {
      throw apiError_('VALIDATION_ERROR',
        'Batch ' + (view.batchNumber || receiptId) + ' bukan milik pelanggan ini.', 'lines');
    }
    if (String(view.productId) !== productId) {
      throw apiError_('VALIDATION_ERROR',
        'Produk baris ' + (i + 1) + ' tidak cocok dengan batch ' + (view.batchNumber || receiptId) + '.', 'lines');
    }

    prepared.push({
      productId: productId,
      receiptId: receiptId,
      rackId: String(ln.rackId || receipt.rack_id || ''),
      qty: qty,
      batchNumber: view.batchNumber,
      sjNo: view.sjNo,
      available: view.available,
      unit: view.unit
    });

    neededByBatch[receiptId] = (neededByBatch[receiptId] || 0) + qty;
  }

  // Validasi stok final: akumulasi seluruh baris terhadap batch yang sama.
  Object.keys(neededByBatch).forEach(function (rid) {
    var need = neededByBatch[rid];
    var have = batchView_(ds.receiptsById[rid], ds).available;
    if (need > have) {
      var v = batchView_(ds.receiptsById[rid], ds);
      throw apiError_('INSUFFICIENT_STOCK',
        'Sisa batch ' + (v.batchNumber || rid) + ' tinggal ' + have + ' ' + (v.unit || '') + ', diminta ' + need + '.',
        'lines');
    }
  });

  var no = nextShipmentNumber_();
  var now = nowStamp_();

  appendRow_('shipments', {
    no: no,
    date: date,
    customer_id: customerId,
    status: 'SHIPPED', // simpan dari UI langsung memotong stok
    pod_date: '',
    driver: String(params.driver || '').trim(),
    vehicle: String(params.vehicle || '').trim(),
    note: String(params.note || '').trim(),
    print_count: 0,
    last_printed_at: '',
    created_at: now,
    created_by: ctx.username,
    updated_at: now,
    updated_by: ctx.username
  });

  var lineRows = prepared.map(function (p) {
    return {
      id: newId_(),
      shipment_no: no,
      product_id: p.productId,
      rack_id: p.rackId,
      qty: p.qty,
      created_at: now,
      created_by: ctx.username,
      updated_at: now,
      updated_by: ctx.username
    };
  });
  appendRows_('shipment_lines', lineRows);

  // Satu baris mengonsumsi satu batch; jejak batch + SJ asal disimpan.
  appendRows_('shipment_consumptions', prepared.map(function (p, idx) {
    return {
      id: newId_(),
      shipment_line_id: lineRows[idx].id,
      receipt_id: p.receiptId,
      sj_no: p.sjNo,
      batch_number: p.batchNumber,
      qty: p.qty,
      created_at: now
    };
  }));

  // Mutasi CONSIGN_OUT (−qty) untuk kartu stock.
  appendRows_('movements', prepared.map(function (p) {
    return {
      id: newId_(),
      date: date,
      type: 'CONSIGN_OUT',
      ref: no,
      product_id: p.productId,
      customer_id: customerId,
      rack_id: p.rackId,
      qty: -p.qty,
      batch_number: p.batchNumber,
      sj_ref: p.sjNo,
      note: 'Pengiriman keluar',
      created_at: now
    };
  }));

  audit_(ctx, 'shipment.create', 'shipment', no, {
    customerId: customerId,
    lines: prepared.length,
    qty: prepared.reduce(function (a, p) { return a + p.qty; }, 0)
  });

  return shipmentView_(findShipment_(no), shipmentDataset_());
}

/** Tandai POD -> status DELIVERED + tanggal POD. */
function shipmentMarkDelivered_(params, ctx) {
  var no = String(assertRequired_(params.no || params.shipmentNo, 'no', 'No pengiriman')).trim();
  var sh = findShipment_(no);

  var status = String(sh.status || '');
  if (status === 'VOID') {
    throw apiError_('VALIDATION_ERROR', 'Pengiriman sudah dibatalkan (void), tidak bisa ditandai POD.');
  }
  if (status === 'DELIVERED') {
    return shipmentView_(sh, shipmentDataset_()); // sudah selesai — tidak diubah
  }

  var podDate = params.podDate ? assertDate_(params.podDate, 'podDate') : todayStr_();
  if (String(podDate) < String(sh.date)) {
    throw apiError_('VALIDATION_ERROR',
      'Tanggal POD tidak boleh sebelum tanggal pengiriman (' + sh.date + ').', 'podDate');
  }

  updateById_('shipments', no, {
    status: 'DELIVERED',
    pod_date: podDate,
    updated_at: nowStamp_(),
    updated_by: ctx.username
  });
  audit_(ctx, 'shipment.markDelivered', 'shipment', no, { podDate: podDate });

  return shipmentView_(findShipment_(no), shipmentDataset_());
}

/**
 * Data cetak surat jalan + naikkan print_count & simpan last_printed_at.
 * Kontrak dipakai frontend/js/print.js.
 */
function shipmentPrintData_(params, ctx) {
  var no = String(assertRequired_(params.no || params.shipmentNo, 'no', 'No pengiriman')).trim();
  var sh = findShipment_(no);

  if (String(sh.status || '') === 'VOID') {
    throw apiError_('VALIDATION_ERROR', 'Pengiriman sudah dibatalkan (void), tidak bisa dicetak.');
  }

  var ds = shipmentDataset_();
  var view = shipmentView_(sh, ds);

  updateById_('shipments', no, {
    print_count: Number(sh.print_count || 0) + 1,
    last_printed_at: nowStamp_(),
    updated_at: nowStamp_(),
    updated_by: ctx.username
  });

  var customer = ds.customersById[String(sh.customer_id)] || {};

  return {
    no: view.no,
    shipmentNo: view.no,
    date: view.date,
    customerId: view.customerId,
    customer: {
      name: customer.name || view.customerName,
      address: customer.address || '',
      phone: customer.phone || ''
    },
    driver: view.driver,
    vehicle: view.vehicle,
    note: view.note,
    status: view.status,
    podDate: view.podDate,
    printCount: view.printCount + 1,
    lines: view.lines.map(function (l) {
      return {
        productId: l.productId,
        rackId: l.rackId,
        qty: l.qty,
        batchNumber: l.batchNumber,
        sjNo: l.sjNo
      };
    }),
    company: getCompany_()
  };
}

/**
 * Void pengiriman (ADMIN) — mengembalikan stok (PRD 6.7, temuan #7).
 * Stok kembali otomatis karena sisa batch mengabaikan pengiriman VOID;
 * mutasi VOID_OUT (+qty) dicatat untuk jejak kartu stock.
 */
function shipmentVoid_(params, ctx) {
  var no = String(assertRequired_(params.no || params.shipmentNo, 'no', 'No pengiriman')).trim();
  var reason = String(assertRequired_(params.reason, 'reason', 'Alasan void')).trim();

  var sh = findShipment_(no);
  if (String(sh.status || '') === 'VOID') {
    throw apiError_('VALIDATION_ERROR', 'Pengiriman ini sudah dibatalkan (void).');
  }

  var ds = shipmentDataset_();
  var view = shipmentView_(sh, ds);
  var now = nowStamp_();

  var note = String(sh.note || '');
  var voidNote = '[VOID] ' + reason;
  updateById_('shipments', no, {
    status: 'VOID',
    note: note ? note + ' | ' + voidNote : voidNote,
    updated_at: now,
    updated_by: ctx.username
  });

  // Kembalikan stok: catat mutasi VOID_OUT (+qty) per baris.
  appendRows_('movements', view.lines.map(function (l) {
    return {
      id: newId_(),
      date: todayStr_(),
      type: 'VOID_OUT',
      ref: no,
      product_id: l.productId,
      customer_id: view.customerId,
      rack_id: l.rackId,
      qty: l.qty,
      batch_number: l.batchNumber,
      sj_ref: l.sjNo,
      note: 'Void pengiriman: ' + reason,
      created_at: now
    };
  }));

  audit_(ctx, 'shipment.void', 'shipment', no, { reason: reason, lines: view.lines.length });

  return {
    no: no,
    status: 'VOID',
    reason: reason,
    restoredQty: view.totalQty,
    restoredLines: view.lines.length
  };
}
