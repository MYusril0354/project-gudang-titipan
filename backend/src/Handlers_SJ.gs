/**
 * Handlers_SJ.gs — Surat Jalan & penerimaan fisik (Fase 2).
 *
 * Cakupan: sj.list, sj.get, sj.nextNumber, sj.create,
 *          sj.line.suggestBatch, sj.line.receive, sj.line.wait,
 *          sj.line.cancel, pending.list.
 *
 * Aturan bisnis: PRD 6.1–6.5. Backend adalah SATU-SATUNYA penentu status;
 * frontend hanya menampilkan hasilnya.
 */

/** Batas jumlah baris dalam satu SJ. */
var SJ_MAX_LINES = 100;

/** Kondisi barang yang dikenal (PRD temuan #4). */
var KONDISI_ = ['Baik', 'Rusak sebagian'];

/** Alasan pembatalan sisa (PRD 6.5). */
var CANCEL_REASONS_ = {
  BATAL_PELANGGAN: 'Dibatalkan pelanggan',
  BARANG_TIDAK_DATANG: 'Barang tidak akan datang',
  SALAH_INPUT: 'Salah input surat jalan',
  LAINNYA: 'Lainnya'
};

/* =========================================================
   DATASET — baca sekali, pakai banyak
   ========================================================= */

/**
 * Muat SJ + baris + receipt + master terkait.
 * Semua akses sheet dalam satu request dibatasi beberapa getValues().
 */
function sjDataset_() {
  var sjs = readTable_('sj');
  var lines = readTable_('sj_lines');
  var receipts = readTable_('receipts');

  var receiptsByLine = {};
  receipts.forEach(function (r) {
    var k = String(r.sj_line_id);
    if (!receiptsByLine[k]) receiptsByLine[k] = [];
    receiptsByLine[k].push(r);
  });

  var linesByNo = {};
  lines.forEach(function (l) {
    var k = String(l.sj_no);
    if (!linesByNo[k]) linesByNo[k] = [];
    linesByNo[k].push(l);
  });

  var productsById = {};
  readTable_('products').forEach(function (p) { productsById[String(p.id)] = p; });

  var customersById = {};
  readTable_('customers').forEach(function (c) { customersById[String(c.id)] = c; });

  var racksById = {};
  readTable_('racks').forEach(function (r) { racksById[String(r.id)] = r; });

  return {
    sjs: sjs,
    linesByNo: linesByNo,
    receiptsByLine: receiptsByLine,
    productsById: productsById,
    customersById: customersById,
    racksById: racksById
  };
}

/** Baris SJ dalam bentuk siap pakai frontend (camelCase + status terhitung). */
function sjLineView_(line, ds) {
  var receipts = ds.receiptsByLine[String(line.id)] || [];
  var product = ds.productsById[String(line.product_id)] || {};

  return {
    id: line.id,
    productId: line.product_id,
    productCode: product.code || '',
    productName: product.name || '(produk terhapus)',
    unit: product.unit || '',
    qtySj: Number(line.qty_sj || 0),
    qtyCancelled: Number(line.qty_cancelled || 0),
    qtyReceived: qtyReceived_(line, receipts),
    pending: pendingOf_(line, receipts),
    decision: line.decision || 'OPEN',
    alasan: line.alasan || '',
    alasanLabel: ALASAN_[line.alasan] || '',
    eta: line.eta || '',
    pic: line.pic || '',
    status: lineStatus_(line, receipts),
    receipts: receipts.map(function (r) {
      var rack = ds.racksById[String(r.rack_id)] || {};
      return {
        id: r.id,
        qty: Number(r.qty || 0),
        rackId: r.rack_id,
        rackCode: rack.code || '',
        date: r.date,
        pic: r.pic || '',
        batchNumber: r.batch_number || '',
        kondisi: r.kondisi || ''
      };
    })
  };
}

/** Satu SJ + baris dalam bentuk siap pakai frontend. */
function sjView_(sj, ds) {
  var customer = ds.customersById[String(sj.customer_id)] || {};
  var rawLines = ds.linesByNo[String(sj.no)] || [];
  var lines = rawLines.map(function (l) { return sjLineView_(l, ds); });

  var statuses = lines.map(function (l) { return l.status; });

  return {
    no: sj.no,
    date: sj.date,
    customerId: sj.customer_id,
    customerName: customer.name || '(pelanggan terhapus)',
    po: sj.po || '',
    status: sjStatusOfStatuses_(statuses),
    totalLines: lines.length,
    lines: lines
  };
}

/* =========================================================
   VALIDASI
   ========================================================= */

/** No. Batch wajib unik (PRD temuan #10). */
function assertBatchUnique_(batchNumber, excludeReceiptId) {
  var target = String(batchNumber || '').trim().toUpperCase();
  var clash = readTable_('receipts').filter(function (r) {
    if (excludeReceiptId && String(r.id) === String(excludeReceiptId)) return false;
    return String(r.batch_number || '').trim().toUpperCase() === target;
  });
  if (clash.length) {
    throw apiError_('DUPLICATE', 'No. Batch "' + batchNumber + '" sudah dipakai.', 'batchNumber');
  }
}

/**
 * Gudang titipan (CONSIGN) milik pelanggan + rak-nya.
 * PRD 6.3: penerimaan ditolak bila pelanggan belum punya gudang titipan/rak.
 */
function consignOf_(customerId) {
  var loc = readTable_('locations').filter(function (l) {
    return String(l.type) === 'CONSIGN' && String(l.customer_id) === String(customerId);
  })[0] || null;

  if (!loc) {
    throw apiError_('NO_CONSIGN_RACK',
      'Pelanggan ini belum punya gudang titipan. Tambahkan di Master Data terlebih dahulu.', 'customerId');
  }

  var racks = readTableWhere_('racks', { location_id: loc.id });
  if (!racks.length) {
    throw apiError_('NO_CONSIGN_RACK',
      'Gudang titipan pelanggan ini belum punya rak. Tambahkan di Master Data terlebih dahulu.', 'rackId');
  }
  return { location: loc, racks: racks };
}

/** Ambil SJ + baris (DB-shaped) atau lempar NOT_FOUND. */
function findSjLine_(sjNo, lineId) {
  var sjs = readTableWhere_('sj', { no: sjNo });
  if (!sjs.length) throw apiError_('NOT_FOUND', 'Surat Jalan tidak ditemukan.', 'sjNo');

  var lines = readTableWhere_('sj_lines', { id: lineId });
  if (!lines.length || String(lines[0].sj_no) !== String(sjNo)) {
    throw apiError_('NOT_FOUND', 'Baris Surat Jalan tidak ditemukan.', 'lineId');
  }
  return { sj: sjs[0], line: lines[0] };
}

/** Hitung ulang status_cache SJ lalu simpan (status turunan tetap dicache). */
function sjRefreshStatus_(sjNo, ctx) {
  var lines = readTableWhere_('sj_lines', { sj_no: sjNo });
  var receipts = readTable_('receipts');

  var byLine = {};
  receipts.forEach(function (r) {
    var k = String(r.sj_line_id);
    if (!byLine[k]) byLine[k] = [];
    byLine[k].push(r);
  });

  var statuses = lines.map(function (l) { return lineStatus_(l, byLine[String(l.id)] || []); });
  var status = sjStatusOfStatuses_(statuses);

  updateById_('sj', sjNo, {
    status_cache: status,
    updated_at: nowStamp_(),
    updated_by: ctx ? ctx.username : 'system'
  });
  return status;
}

/**
 * Nomor SJ berikutnya dari counter, lewati nomor yang sudah dipakai.
 * Counter dinaikkan (dipanggil hanya di dalam aksi tulis / lock).
 */
function sjAutoNumber_() {
  var year = todayStr_().slice(0, 4);
  var existing = {};
  readTable_('sj').forEach(function (s) { existing[String(s.no).toUpperCase()] = true; });

  for (var guard = 0; guard < 1000; guard++) {
    var candidate = formatSeq_('SJ/' + year + '/', nextCounter_('SJ-' + year), 4);
    if (!existing[candidate]) return candidate;
  }
  throw apiError_('INTERNAL', 'Gagal menentukan nomor Surat Jalan baru.');
}

/* =========================================================
   ACTION — BACA
   ========================================================= */

/** Daftar SJ + baris + status turunan. Filter: q, status, customerId. */
function sjList_(params, ctx) {
  var ds = sjDataset_();
  var items = ds.sjs.map(function (s) { return sjView_(s, ds); });

  var q = String(params.q || '').trim().toLowerCase();
  if (q) {
    items = items.filter(function (it) {
      if (String(it.no).toLowerCase().indexOf(q) !== -1) return true;
      if (String(it.po || '').toLowerCase().indexOf(q) !== -1) return true;
      if (String(it.customerName || '').toLowerCase().indexOf(q) !== -1) return true;
      return it.lines.some(function (l) {
        return String(l.productName || '').toLowerCase().indexOf(q) !== -1
          || String(l.productCode || '').toLowerCase().indexOf(q) !== -1;
      });
    });
  }

  var status = String(params.status || '').trim().toUpperCase();
  if (status) items = items.filter(function (it) { return it.status === status; });

  var customerId = String(params.customerId || '').trim();
  if (customerId) items = items.filter(function (it) { return String(it.customerId) === customerId; });

  // Terbaru lebih dulu (tanggal, lalu nomor).
  items.sort(function (a, b) {
    var d = String(b.date).localeCompare(String(a.date));
    return d !== 0 ? d : String(b.no).localeCompare(String(a.no));
  });

  var counts = { open: 0, waitingPhysical: 0, received: 0 };
  items.forEach(function (it) {
    if (it.status === 'OPEN') counts.open++;
    else if (it.status === 'WAITING_PHYSICAL') counts.waitingPhysical++;
    else if (it.status === 'RECEIVED') counts.received++;
  });

  return { items: items, total: items.length, counts: counts };
}

/** Detail satu SJ. */
function sjGet_(params, ctx) {
  var sjNo = String(assertRequired_(params.no || params.sjNo, 'no', 'No SJ')).trim();
  var ds = sjDataset_();
  var found = ds.sjs.filter(function (s) { return String(s.no) === sjNo; })[0];
  if (!found) throw apiError_('NOT_FOUND', 'Surat Jalan tidak ditemukan.', 'no');
  return sjView_(found, ds);
}

/**
 * Saran nomor SJ berikutnya (PRD 6.2) — hanya pratinjau, counter TIDAK dinaikkan.
 * Nomor final tetap ditentukan server saat sj.create.
 */
function sjNextNumber_(params, ctx) {
  var year = todayStr_().slice(0, 4);
  var existing = {};
  readTable_('sj').forEach(function (s) { existing[String(s.no).toUpperCase()] = true; });

  var base = Number(getCounter_('SJ-' + year) || 0);
  for (var i = 1; i <= 1000; i++) {
    var candidate = formatSeq_('SJ/' + year + '/', base + i, 4);
    if (!existing[candidate]) return { no: candidate };
  }
  throw apiError_('INTERNAL', 'Tidak bisa menentukan nomor SJ berikutnya.');
}

/** Antrean pending fisik + baris belum diklasifikasi + bucket umur (PRD 6.4). */
function pendingList_(params, ctx) {
  var ds = sjDataset_();
  var items = [];
  var openItems = [];

  ds.sjs.forEach(function (s) {
    var customer = ds.customersById[String(s.customer_id)] || {};
    (ds.linesByNo[String(s.no)] || []).forEach(function (raw) {
      var v = sjLineView_(raw, ds);
      if (v.pending <= 0) return;

      var base = {
        sjNo: s.no,
        sjDate: s.date,
        customerId: s.customer_id,
        customerName: customer.name || '(pelanggan terhapus)',
        lineId: v.id,
        productId: v.productId,
        productCode: v.productCode,
        productName: v.productName,
        unit: v.unit,
        qtySj: v.qtySj,
        qtyReceived: v.qtyReceived,
        pending: v.pending,
        status: v.status,
        umurDays: agingDays_(s.date)
      };

      if (v.status === 'WAITING_PHYSICAL' || v.status === 'PARTIALLY_RECEIVED') {
        items.push(Object.assign(base, {
          alasan: v.alasan,
          alasanLabel: v.alasanLabel,
          eta: v.eta,
          pic: v.pic
        }));
      } else if (v.status === 'OPEN') {
        openItems.push(base);
      }
    });
  });

  var q = String(params.q || '').trim().toLowerCase();
  if (q) {
    var match = function (r) {
      return [r.sjNo, r.customerName, r.productName, r.productCode].some(function (s) {
        return String(s || '').toLowerCase().indexOf(q) !== -1;
      });
    };
    items = items.filter(match);
    openItems = openItems.filter(match);
  }

  // Paling lama menunggu lebih dulu.
  items.sort(function (a, b) { return b.umurDays - a.umurDays; });
  openItems.sort(function (a, b) { return String(a.sjNo).localeCompare(String(b.sjNo)); });

  var buckets = { d0_7: 0, d8_30: 0, gt30: 0 };
  var totalQty = 0;
  items.forEach(function (r) {
    totalQty += r.pending;
    if (r.umurDays <= 7) buckets.d0_7++;
    else if (r.umurDays <= 30) buckets.d8_30++;
    else buckets.gt30++;
  });

  return {
    items: items,
    openItems: openItems,
    buckets: buckets,
    totals: { rows: items.length, qty: totalQty, openRows: openItems.length }
  };
}

/* =========================================================
   ACTION — TULIS
   ========================================================= */

/** Buat SJ + baris (PRD 6.2). */
function sjCreate_(params, ctx) {
  var date = assertDate_(params.date, 'date');
  var customerId = String(assertRequired_(params.customerId, 'customerId', 'Pelanggan')).trim();
  var po = String(assertRequired_(params.po, 'po', 'No PO')).trim();

  if (!readTableWhere_('customers', { id: customerId }).length) {
    throw apiError_('NOT_FOUND', 'Pelanggan tidak ditemukan.', 'customerId');
  }

  var inputLines = params.lines;
  if (!inputLines || !inputLines.length) {
    throw apiError_('VALIDATION_ERROR', 'Minimal satu baris produk.', 'lines');
  }
  if (inputLines.length > SJ_MAX_LINES) {
    throw apiError_('VALIDATION_ERROR', 'Maksimal ' + SJ_MAX_LINES + ' baris per Surat Jalan.', 'lines');
  }

  var knownProducts = {};
  readTable_('products').forEach(function (p) { knownProducts[String(p.id)] = p; });

  var prepared = inputLines.map(function (ln, i) {
    var productId = String(assertRequired_(ln.productId, 'lines[' + i + '].productId', 'Produk baris ' + (i + 1)));
    if (!knownProducts[productId]) {
      throw apiError_('NOT_FOUND', 'Produk baris ' + (i + 1) + ' tidak ditemukan.', 'lines[' + i + '].productId');
    }
    return { productId: productId, qty: assertPositiveInt_(ln.qty, 'lines[' + i + '].qty', 1) };
  });

  var no = String(params.no || '').trim().toUpperCase();
  if (no) {
    if (readTableWhere_('sj', { no: no }).length) {
      throw apiError_('DUPLICATE', 'No SJ "' + no + '" sudah dipakai.', 'no');
    }
  } else {
    no = sjAutoNumber_();
  }

  var now = nowStamp_();
  appendRow_('sj', {
    no: no,
    date: date,
    customer_id: customerId,
    po: po,
    status_cache: 'OPEN',
    created_at: now,
    created_by: ctx.username,
    updated_at: now,
    updated_by: ctx.username
  });

  appendRows_('sj_lines', prepared.map(function (p) {
    return {
      id: newId_(),
      sj_no: no,
      product_id: p.productId,
      qty_sj: p.qty,
      qty_cancelled: 0,
      decision: 'OPEN',
      alasan: '',
      eta: '',
      pic: '',
      created_at: now,
      created_by: ctx.username,
      updated_at: now,
      updated_by: ctx.username
    };
  }));

  audit_(ctx, 'sj.create', 'sj', no, { po: po, lines: prepared.length });

  var ds = sjDataset_();
  var created = ds.sjs.filter(function (s) { return String(s.no) === no; })[0];
  return sjView_(created, ds);
}

/**
 * Saran No. Batch: BN-{YYYYMMDD}-{urut 3 digit} (PRD 6.3).
 * Hanya PRATINJAU — counter tidak dinaikkan, sehingga membatalkan modal
 * tidak menghasilkan nomor bolong. Keunikan tetap diperiksa saat receive.
 */
function sjLineSuggestBatch_(params, ctx) {
  var date = assertDate_(params.date || todayStr_(), 'date');
  var key = 'BATCH-' + date.replace(/-/g, '');
  var prefix = 'BN-' + date.replace(/-/g, '') + '-';

  var existing = {};
  readTable_('receipts').forEach(function (r) {
    existing[String(r.batch_number || '').toUpperCase()] = true;
  });

  var base = Number(getCounter_(key) || 0);
  for (var i = 1; i <= 1000; i++) {
    var candidate = formatSeq_(prefix, base + i, 3);
    if (!existing[candidate]) return { batchNumber: candidate, date: date };
  }
  throw apiError_('INTERNAL', 'Tidak bisa menentukan No. Batch berikutnya.');
}

/** Nomor batch final saat simpan: pakai yang dikirim, atau buat otomatis dari counter. */
function nextBatchNumber_(date) {
  var key = 'BATCH-' + date.replace(/-/g, '');
  var prefix = 'BN-' + date.replace(/-/g, '') + '-';

  var existing = {};
  readTable_('receipts').forEach(function (r) {
    existing[String(r.batch_number || '').toUpperCase()] = true;
  });

  for (var guard = 0; guard < 1000; guard++) {
    var candidate = formatSeq_(prefix, nextCounter_(key), 3);
    if (!existing[candidate]) return candidate;
  }
  throw apiError_('INTERNAL', 'Gagal menentukan No. Batch baru.');
}

/**
 * Fisik Ada -> receipt + batch + mutasi CONSIGN_IN (PRD 6.3).
 * Setiap penerimaan menghasilkan satu batch baru; boleh bertahap.
 */
function sjLineReceive_(params, ctx) {
  var sjNo = String(assertRequired_(params.sjNo, 'sjNo', 'No SJ')).trim();
  var lineId = String(assertRequired_(params.lineId, 'lineId', 'ID baris')).trim();

  var found = findSjLine_(sjNo, lineId);
  var sj = found.sj;
  var line = found.line;

  var receiptsBefore = readTableWhere_('receipts', { sj_line_id: lineId });
  var pending = pendingOf_(line, receiptsBefore);
  if (pending <= 0) {
    throw apiError_('VALIDATION_ERROR', 'Baris ini sudah tidak punya sisa pending.');
  }

  var qty = assertPositiveInt_(params.qty, 'qty', 1);
  if (qty > pending) {
    throw apiError_('QTY_EXCEEDS_PENDING', 'Qty melebihi pending (maks ' + pending + ').', 'qty');
  }

  var date = assertDate_(params.date || todayStr_(), 'date');
  if (String(date) < String(sj.date)) {
    throw apiError_('VALIDATION_ERROR',
      'Tanggal fisik tidak boleh sebelum tanggal SJ (' + sj.date + ').', 'date');
  }

  // No. Batch: kosong = dibuat otomatis dari counter (dalam lock).
  var batchNumber = String(params.batchNumber || '').trim().toUpperCase();
  if (batchNumber) {
    assertBatchUnique_(batchNumber, null);
  } else {
    batchNumber = nextBatchNumber_(date);
  }

  var consign = consignOf_(sj.customer_id);
  var rackId = String(assertRequired_(params.rackId, 'rackId', 'Rak tujuan')).trim();
  var rack = consign.racks.filter(function (r) { return String(r.id) === rackId; })[0];
  if (!rack) {
    throw apiError_('VALIDATION_ERROR',
      'Rak tujuan bukan milik gudang titipan pelanggan ini.', 'rackId');
  }

  var kondisi = String(params.kondisi || 'Baik').trim();
  if (KONDISI_.indexOf(kondisi) === -1) {
    throw apiError_('VALIDATION_ERROR', 'Kondisi harus: ' + KONDISI_.join(' / ') + '.', 'kondisi');
  }

  var pic = String(assertRequired_(params.pic, 'pic', 'Petugas penerima')).trim();

  var now = nowStamp_();
  var receipt = {
    id: newId_(),
    sj_line_id: lineId,
    qty: qty,
    rack_id: rackId,
    date: date,
    pic: pic,
    batch_number: batchNumber,
    kondisi: kondisi,
    created_at: now,
    created_by: ctx.username,
    updated_at: now,
    updated_by: ctx.username
  };
  appendRow_('receipts', receipt);

  // Mutasi CONSIGN_IN (+qty) — PRD 6.3.
  appendRow_('movements', {
    id: newId_(),
    date: date,
    type: 'CONSIGN_IN',
    ref: sjNo,
    product_id: line.product_id,
    customer_id: sj.customer_id,
    rack_id: rackId,
    qty: qty,
    batch_number: batchNumber,
    sj_ref: sjNo,
    note: 'Penerimaan fisik',
    created_at: now
  });

  var receiptsAfter = receiptsBefore.concat([receipt]);
  var pendingAfter = pendingOf_(line, receiptsAfter);

  var patch = { updated_at: now, updated_by: ctx.username };
  if (pendingAfter <= 0) patch.decision = 'DONE'; // PRD 6.3
  updateById_('sj_lines', lineId, patch);

  var sjStatus = sjRefreshStatus_(sjNo, ctx);

  audit_(ctx, 'sj.line.receive', 'sj_line', lineId, {
    sjNo: sjNo, qty: qty, batchNumber: batchNumber, rackId: rackId, kondisi: kondisi
  });

  return {
    sjNo: sjNo,
    lineId: lineId,
    batchNumber: batchNumber,
    qty: qty,
    pendingAfter: pendingAfter,
    lineStatus: lineStatus_(Object.assign({}, line, patch), receiptsAfter),
    sjStatus: sjStatus
  };
}

/** Fisik Belum Ada: simpan alasan, ETA, PIC. Stok tidak berubah (PRD 6.4). */
function sjLineWait_(params, ctx) {
  var sjNo = String(assertRequired_(params.sjNo, 'sjNo', 'No SJ')).trim();
  var lineId = String(assertRequired_(params.lineId, 'lineId', 'ID baris')).trim();

  var found = findSjLine_(sjNo, lineId);
  var line = found.line;

  var receipts = readTableWhere_('receipts', { sj_line_id: lineId });
  if (pendingOf_(line, receipts) <= 0) {
    throw apiError_('VALIDATION_ERROR', 'Baris ini sudah tidak punya sisa pending.');
  }

  var alasan = String(assertRequired_(params.alasan, 'alasan', 'Alasan')).trim().toUpperCase();
  if (!ALASAN_[alasan]) {
    throw apiError_('VALIDATION_ERROR',
      'Alasan tidak dikenal. Pilihan: ' + Object.keys(ALASAN_).join(', ') + '.', 'alasan');
  }

  var pic = String(assertRequired_(params.pic, 'pic', 'PIC')).trim();
  var eta = params.eta ? assertDate_(params.eta, 'eta') : '';

  var now = nowStamp_();
  updateById_('sj_lines', lineId, {
    decision: 'WAITING',
    alasan: alasan,
    eta: eta,
    pic: pic,
    updated_at: now,
    updated_by: ctx.username
  });

  var sjStatus = sjRefreshStatus_(sjNo, ctx);
  audit_(ctx, 'sj.line.wait', 'sj_line', lineId, { sjNo: sjNo, alasan: alasan, eta: eta, pic: pic });

  return {
    sjNo: sjNo,
    lineId: lineId,
    alasan: alasan,
    alasanLabel: ALASAN_[alasan],
    eta: eta,
    pic: pic,
    lineStatus: 'WAITING_PHYSICAL',
    sjStatus: sjStatus
  };
}

/**
 * Batalkan sisa (PRD 6.5).
 * Hanya untuk baris WAITING_PHYSICAL / PARTIALLY_RECEIVED.
 * Alasan & catatan WAJIB disimpan (tabel cancellations) — prototipe tidak menyimpannya.
 */
function sjLineCancel_(params, ctx) {
  var sjNo = String(assertRequired_(params.sjNo, 'sjNo', 'No SJ')).trim();
  var lineId = String(assertRequired_(params.lineId, 'lineId', 'ID baris')).trim();

  var found = findSjLine_(sjNo, lineId);
  var line = found.line;

  var receipts = readTableWhere_('receipts', { sj_line_id: lineId });
  var status = lineStatus_(line, receipts);
  if (status !== 'WAITING_PHYSICAL' && status !== 'PARTIALLY_RECEIVED') {
    throw apiError_('VALIDATION_ERROR',
      'Hanya baris berstatus "Fisik belum ada" atau "Diterima sebagian" yang bisa dibatalkan sisanya.');
  }

  var reason = String(assertRequired_(params.reason, 'reason', 'Alasan')).trim().toUpperCase();
  if (!CANCEL_REASONS_[reason]) {
    throw apiError_('VALIDATION_ERROR',
      'Alasan pembatalan tidak dikenal. Pilihan: ' + Object.keys(CANCEL_REASONS_).join(', ') + '.', 'reason');
  }

  var note = String(params.note || '').trim();
  if (reason === 'LAINNYA' && !note) {
    throw apiError_('VALIDATION_ERROR', 'Catatan wajib diisi bila alasan "Lainnya".', 'note');
  }

  var pending = pendingOf_(line, receipts);
  var cancelled = Number(line.qty_cancelled || 0) + pending;
  var now = nowStamp_();

  appendRow_('cancellations', {
    id: newId_(),
    sj_line_id: lineId,
    qty: pending,
    reason: reason,
    note: note,
    date: todayStr_(),
    created_at: now,
    created_by: ctx.username,
    updated_at: now,
    updated_by: ctx.username
  });

  updateById_('sj_lines', lineId, {
    qty_cancelled: cancelled,
    decision: 'DONE',
    updated_at: now,
    updated_by: ctx.username
  });

  var sjStatus = sjRefreshStatus_(sjNo, ctx);
  audit_(ctx, 'sj.line.cancel', 'sj_line', lineId, {
    sjNo: sjNo, qty: pending, reason: reason, note: note
  });

  var patched = Object.assign({}, line, { qty_cancelled: cancelled, decision: 'DONE' });

  return {
    sjNo: sjNo,
    lineId: lineId,
    cancelledQty: pending,
    qtyCancelled: cancelled,
    reason: reason,
    reasonLabel: CANCEL_REASONS_[reason],
    lineStatus: lineStatus_(patched, receipts),
    sjStatus: sjStatus
  };
}
