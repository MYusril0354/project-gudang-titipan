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

/** Batas baris per impor CSV Surat Jalan. */
var SJ_IMPORT_MAX_ROWS = 1000;

/** Nama kolom yang dikenali pada header CSV Surat Jalan (Indonesia & Inggris). */
var SJ_IMPORT_ALIASES_ = {
  no_sj: ['no_sj', 'no sj', 'nosj', 'nomor sj', 'sj', 'surat jalan'],
  tanggal: ['tanggal', 'date', 'tgl'],
  pelanggan: ['pelanggan', 'customer', 'kode pelanggan', 'customer code'],
  po: ['po', 'no po', 'nomor po', 'no_po'],
  produk: ['produk', 'kode produk', 'product', 'product code', 'kode'],
  qty: ['qty', 'jumlah', 'quantity', 'kuantitas'],
  batch: ['batch', 'no batch', 'no. batch', 'nomor batch', 'batch_number', 'planned_batch'],
  ed: ['ed', 'expired', 'expiry', 'kadaluarsa', 'tgl ed', 'tanggal ed']
};

/** Urutan kolom bila CSV tidak menyertakan baris header. */
var SJ_IMPORT_ORDER_ = ['no_sj', 'tanggal', 'pelanggan', 'po', 'produk', 'qty', 'batch', 'ed'];

/** Tanggal CSV valid (format + kewajaran). */
function isValidImportDate_(s) {
  try { assertDate_(s); return true; } catch (e) { return false; }
}

/** Cocokkan judul kolom CSV SJ ke nama field internal, atau null. */
function sjImportFieldOf_(title) {
  var t = String(title || '').trim().toLowerCase();
  var keys = Object.keys(SJ_IMPORT_ALIASES_);
  for (var i = 0; i < keys.length; i++) {
    if (SJ_IMPORT_ALIASES_[keys[i]].indexOf(t) !== -1) return keys[i];
  }
  return null;
}

/**
 * Impor Surat Jalan dari CSV (satu file boleh memuat banyak SJ).
 *
 * Baris dikelompokkan berdasarkan `no_sj`; tiap kelompok menjadi satu dokumen
 * SJ dengan beberapa baris produk. Kolom `batch` dan `ed` bersifat RENCANA —
 * stok tidak bertambah di sini, batch baru lahir saat Fisik Ada dikonfirmasi.
 *
 * Kolom: no_sj, tanggal, pelanggan, po, produk, qty, batch, ed
 *
 * @param {Object} params { csv }
 * @returns {Object} ringkasan per dokumen + daftar kegagalan per baris
 */
function sjImport_(params, ctx) {
  var csv = String(params.csv || '');
  if (!csv.trim()) throw apiError_('VALIDATION_ERROR', 'Isi CSV masih kosong.', 'csv');

  var matrix = parseCsv_(csv);
  if (!matrix.length) {
    throw apiError_('VALIDATION_ERROR', 'Tidak ada baris data yang bisa dibaca.', 'csv');
  }

  var headerFields = matrix[0].map(sjImportFieldOf_);
  var hasHeader = headerFields.some(function (f) { return f !== null; });

  var fields = hasHeader ? headerFields : SJ_IMPORT_ORDER_;
  var dataRows = hasHeader ? matrix.slice(1) : matrix;

  if (!dataRows.length) {
    throw apiError_('VALIDATION_ERROR', 'CSV hanya berisi baris header.', 'csv');
  }
  if (dataRows.length > SJ_IMPORT_MAX_ROWS) {
    throw apiError_('VALIDATION_ERROR',
      'Maksimal ' + SJ_IMPORT_MAX_ROWS + ' baris per impor (dikirim ' + dataRows.length + ').', 'csv');
  }

  // Susun objek per baris lebih dulu.
  var parsed = dataRows.map(function (cells, idx) {
    var row = {};
    if (hasHeader) {
      for (var c = 0; c < fields.length; c++) {
        if (fields[c]) row[fields[c]] = cells[c] !== undefined ? cells[c] : '';
      }
    } else {
      for (var d = 0; d < fields.length; d++) {
        row[SJ_IMPORT_ORDER_[d]] = cells[d] !== undefined ? cells[d] : '';
      }
    }
    row.__row = hasHeader ? idx + 2 : idx + 1;
    return row;
  });

  // Kelompokkan per nomor SJ, mempertahankan urutan kemunculan.
  var order = [];
  var groups = {};
  parsed.forEach(function (r) {
    var no = String(r.no_sj || '').trim().toUpperCase();
    var key = no || '__tanpa_nomor_' + r.__row;
    if (!groups[key]) {
      groups[key] = { no: no, rows: [] };
      order.push(key);
    }
    groups[key].rows.push(r);
  });

  var created = [];
  var failed = [];
  var createdLines = 0;

  // Peta kode -> id agar pencarian pelanggan/produk tidak membaca sheet berulang.
  var customers = readTable_('customers');
  var products = readTable_('products');

  function findCustomerId_(ref) {
    var v = String(ref || '').trim().toUpperCase();
    if (!v) return '';
    for (var i = 0; i < customers.length; i++) {
      if (String(customers[i].id).toUpperCase() === v) return customers[i].id;
      if (String(customers[i].code || '').toUpperCase() === v) return customers[i].id;
      if (String(customers[i].name || '').trim().toUpperCase() === v) return customers[i].id;
    }
    return '';
  }

  function findProductId_(ref) {
    var v = String(ref || '').trim().toUpperCase();
    if (!v) return '';
    for (var i = 0; i < products.length; i++) {
      if (String(products[i].id).toUpperCase() === v) return products[i].id;
      if (String(products[i].code || '').toUpperCase() === v) return products[i].id;
    }
    return '';
  }

  order.forEach(function (key) {
    var g = groups[key];
    var first = g.rows[0];

    // Header dokumen diambil dari baris pertama kelompok.
    var date = String(first.tanggal || '').trim();
    var customerId = findCustomerId_(first.pelanggan);
    var po = String(first.po || '').trim();
    var no = g.no;

    if (!date) {
      failed.push({ row: first.__row, sj: no || '(tanpa nomor)', code: 'VALIDATION_ERROR', message: 'Kolom tanggal wajib diisi.' });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isValidImportDate_(date)) {
      failed.push({ row: first.__row, sj: no || '(tanpa nomor)', code: 'VALIDATION_ERROR', message: 'Tanggal tidak valid (dapat "' + date + '"); gunakan YYYY-MM-DD yang benar.' });
      return;
    }
    if (!customerId) {
      failed.push({ row: first.__row, sj: no || '(tanpa nomor)', code: 'NOT_FOUND', message: 'Pelanggan "' + first.pelanggan + '" tidak ditemukan (isi kode atau nama pelanggan).' });
      return;
    }
    if (!po) {
      failed.push({ row: first.__row, sj: no || '(tanpa nomor)', code: 'VALIDATION_ERROR', message: 'Kolom PO wajib diisi.' });
      return;
    }
    if (no && readTableWhere_('sj', { no: no }).length) {
      failed.push({ row: first.__row, sj: no, code: 'DUPLICATE', message: 'No SJ "' + no + '" sudah ada.' });
      return;
    }

    // Susun baris; baris yang produknya tidak dikenal dilaporkan terpisah.
    var lines = [];
    var rowErrors = [];
    g.rows.forEach(function (r) {
      var productId = findProductId_(r.produk);
      if (!productId) {
        rowErrors.push({ row: r.__row, sj: no || '(tanpa nomor)', code: 'NOT_FOUND', message: 'Produk "' + r.produk + '" tidak ditemukan.' });
        return;
      }
      var qty = parseInt(r.qty, 10);
      if (!isFinite(qty) || qty < 1) {
        rowErrors.push({ row: r.__row, sj: no || '(tanpa nomor)', code: 'VALIDATION_ERROR', message: 'Qty tidak valid ("' + r.qty + '").' });
        return;
      }
      var ed = String(r.ed || '').trim();
      if (ed && (!/^\d{4}-\d{2}-\d{2}$/.test(ed) || !isValidImportDate_(ed))) {
        rowErrors.push({ row: r.__row, sj: no || '(tanpa nomor)', code: 'VALIDATION_ERROR', message: 'ED tidak valid (dapat "' + ed + '"); gunakan YYYY-MM-DD yang benar.' });
        return;
      }
      lines.push({
        productId: productId,
        qty: qty,
        plannedBatch: String(r.batch || '').trim().toUpperCase(),
        plannedEd: ed
      });
    });

    if (!lines.length) {
      failed.push({
        row: first.__row,
        sj: no || '(tanpa nomor)',
        code: 'VALIDATION_ERROR',
        message: 'Tidak ada baris valid pada dokumen ini' + (rowErrors.length ? ' (' + rowErrors.length + ' baris gagal)' : '') + '.'
      });
      rowErrors.forEach(function (e) { failed.push(e); });
      return;
    }

    try {
      var result = sjCreate_({
        no: no || undefined,
        date: date,
        customerId: customerId,
        po: po,
        lines: lines
      }, ctx);
      created.push({ no: result.no, lines: lines.length });
      createdLines += lines.length;
      rowErrors.forEach(function (e) { failed.push(e); });
    } catch (groupErr) {
      failed.push({
        row: first.__row,
        sj: no || '(tanpa nomor)',
        code: groupErr.code || 'INTERNAL',
        message: groupErr.message || 'Dokumen gagal dibuat.'
      });
    }
  });

  audit_(ctx, 'sj.import', 'sj', '', {
    documents: order.length,
    created: created.length,
    lines: createdLines,
    failed: failed.length,
    header: hasHeader
  });

  return {
    headerDetected: hasHeader,
    fields: fields,
    rows: dataRows.length,
    documents: order.length,
    created: created.length,
    linesCreated: createdLines,
    failed: failed.length,
    documents_created: created,
    errors: failed.slice(0, 60)
  };
}

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
    /** Rencana yang diisi saat SJ dibuat — dipakai untuk mengisi form Fisik Ada. */
    plannedBatch: line.planned_batch || '',
    plannedEd: line.planned_ed || '',
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
        kondisi: r.kondisi || '',
        ed: r.ed || ''
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

/**
 * Baris SJ yang masih punya sisa pending, dihitung dari dataset bersama.
 * Dipakai `pending.list`, dashboard, dan rekonsiliasi agar satu sumber hitungan.
 * @param {Object} ds hasil stockDataset_()
 * @returns {Object[]} baris pending siap pakai frontend
 */
function pendingRows_(ds) {
  var rows = [];

  ds.sjs.forEach(function (s) {
    var customer = ds.customersById[String(s.customer_id)] || {};
    (ds.sjLinesByNo[String(s.no)] || []).forEach(function (line) {
      var receipts = ds.receiptsByLine[String(line.id)] || [];
      var pending = pendingOf_(line, receipts);
      if (pending <= 0) return;

      var product = ds.productsById[String(line.product_id)] || {};
      rows.push({
        sjNo: s.no,
        sjDate: s.date,
        customerId: s.customer_id,
        customerName: customer.name || '(pelanggan terhapus)',
        lineId: line.id,
        productId: line.product_id,
        productCode: product.code || '',
        productName: product.name || '(produk terhapus)',
        unit: product.unit || '',
        qtySj: Number(line.qty_sj || 0),
        qtyReceived: qtyReceived_(line, receipts),
        pending: pending,
        status: lineStatus_(line, receipts),
        alasan: line.alasan || '',
        alasanLabel: ALASAN_[line.alasan] || '',
        eta: line.eta || '',
        pic: line.pic || '',
        // Rencana batch & ED dari baris SJ — dipakai mengisi form Fisik Ada.
        plannedBatch: line.planned_batch || '',
        plannedEd: line.planned_ed || '',
        umurDays: agingDays_(s.date)
      });
    });
  });

  return rows;
}

/** Antrean pending fisik + baris belum diklasifikasi + bucket umur (PRD 6.4). */
function pendingList_(params, ctx) {
  var ds = stockDataset_();
  var all = pendingRows_(ds);

  var items = [];
  var openItems = [];

  all.forEach(function (r) {
    if (r.status === 'WAITING_PHYSICAL' || r.status === 'PARTIALLY_RECEIVED') {
      items.push(r);
    } else if (r.status === 'OPEN') {
      openItems.push(r);
    }
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

    // Rencana batch & ED (opsional). Stok TIDAK bertambah di sini — batch baru
    // lahir saat Fisik Ada dikonfirmasi, memakai nilai rencana ini sebagai default.
    var plannedBatch = String(ln.plannedBatch || '').trim().toUpperCase();
    var plannedEd = ln.plannedEd ? assertDate_(ln.plannedEd, 'lines[' + i + '].plannedEd') : '';
    if (plannedEd && String(plannedEd) < String(date)) {
      throw apiError_('VALIDATION_ERROR',
        'ED baris ' + (i + 1) + ' tidak boleh sebelum tanggal SJ (' + date + ').',
        'lines[' + i + '].plannedEd');
    }

    return {
      productId: productId,
      qty: assertPositiveInt_(ln.qty, 'lines[' + i + '].qty', 1),
      plannedBatch: plannedBatch,
      plannedEd: plannedEd
    };
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
      planned_batch: p.plannedBatch,
      planned_ed: p.plannedEd,
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

  // No. Batch: pakai kiriman, kalau kosong pakai RENCANA dari baris SJ,
  // kalau masih kosong baru dibuat otomatis dari counter (dalam lock).
  var batchNumber = String(params.batchNumber || line.planned_batch || '').trim().toUpperCase();
  if (batchNumber) {
    assertBatchUnique_(batchNumber, null);
  } else {
    batchNumber = nextBatchNumber_(date);
  }

  // ED: pakai kiriman, kalau kosong pakai RENCANA dari baris SJ.
  var ed = params.ed ? assertDate_(params.ed, 'ed') : (line.planned_ed || '');
  if (ed && String(ed) < String(date)) {
    throw apiError_('VALIDATION_ERROR',
      'ED tidak boleh sebelum tanggal penerimaan (' + date + ').', 'ed');
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
    ed: ed,
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
    ed: ed,
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
