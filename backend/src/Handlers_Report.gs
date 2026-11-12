/**
 * Handlers_Report.gs — Dashboard, kartu stock, rekonsiliasi, user, audit.
 * Cakupan: system.bootstrap, dashboard.summary, ledger.kartuStock,
 *          report.reconciliation (Fase 4); user dan audit ada di Handlers_User.gs.
 *
 * Semua handler di sini memakai SATU dataset bersama (stockDataset_()) supaya
 * satu request tidak membaca sheet berkali-kali (PRD 13: kinerja).
 */

/* =========================================================
   BOOTSTRAP
   ========================================================= */

/** Satu panggilan: master data + konstanta + tanggal server + info perusahaan. */
function systemBootstrap_(params, ctx) {
  return {
    products: readMaster_('product'),
    customers: readMaster_('customer'),
    locations: readMaster_('location'),
    racks: readMaster_('rack'),
    constants: {
      alasan: ALASAN_,
      satuan: SATUAN_,
      role: ROLES,
      kondisi: KONDISI_,
      cancelReasons: CANCEL_REASONS_
    },
    serverDate: todayStr_(),
    company: getCompany_(),
    user: ctx ? { userId: ctx.userId, username: ctx.username, nama: ctx.nama, role: ctx.role } : null
  };
}

/* =========================================================
   HELPER MUTASI (dipakai kartu stock & rekonsiliasi)
   ========================================================= */

/** Satu mutasi dalam bentuk siap pakai frontend. */
function movementView_(m, ds) {
  var qty = Number(m.qty || 0);
  var product = ds.productsById[String(m.product_id)] || {};
  var rack = ds.racksById[String(m.rack_id)] || {};
  var customer = ds.customersById[String(m.customer_id)] || {};

  return {
    id: m.id,
    date: m.date,
    type: m.type || '',
    ref: m.ref || '',
    productId: m.product_id,
    productCode: product.code || '',
    productName: product.name || '(produk terhapus)',
    unit: product.unit || '',
    batchNumber: m.batch_number || '',
    rackId: m.rack_id,
    rackCode: rack.code || '',
    customerId: m.customer_id,
    customerName: customer.name || '(pelanggan terhapus)',
    sjRef: m.sj_ref || '',
    note: m.note || '',
    qty: qty,
    in: qty > 0 ? qty : 0,
    out: qty < 0 ? -qty : 0,
    createdAt: m.created_at || ''
  };
}

/** Kunci batch untuk pengelompokan saldo. */
function batchKeyOf_(mv) {
  return [mv.customerId, mv.productId, mv.batchNumber].join('|');
}

/** Urutkan mutasi secara kronologis (tanggal, lalu urutan input). */
function sortMovements_(items) {
  return items.sort(function (a, b) {
    var d = String(a.date).localeCompare(String(b.date));
    if (d !== 0) return d;
    return String(a.createdAt).localeCompare(String(b.createdAt));
  });
}

/* =========================================================
   DASHBOARD
   ========================================================= */

/**
 * Angka kartu utama + pending prioritas + stok per pelanggan.
 * PRD 5: ringkasan stok titipan dan pending fisik.
 */
function dashboardSummary_(params, ctx) {
  var ds = stockDataset_();

  // --- stok ---
  var batches = allBatchViews_(ds).filter(function (b) { return b.available > 0; });
  var stockTotal = batches.reduce(function (a, b) { return a + b.available; }, 0);

  var byCustomer = {};
  batches.forEach(function (b) {
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
  var stockByCustomer = Object.keys(byCustomer).map(function (k) { return byCustomer[k]; })
    .sort(function (a, b) { return b.qty - a.qty; });

  // --- pending fisik ---
  var pending = pendingRows_(ds);
  var pendingItems = pending.filter(function (r) {
    return r.status === 'WAITING_PHYSICAL' || r.status === 'PARTIALLY_RECEIVED';
  });
  var openRows = pending.filter(function (r) { return r.status === 'OPEN'; });
  var pendingQty = pendingItems.reduce(function (a, r) { return a + r.pending; }, 0);
  var oldestPending = pendingItems.reduce(function (a, r) { return Math.max(a, r.umurDays); }, 0);

  // --- SJ belum selesai ---
  var sjOpen = 0;
  var sjWaiting = 0;
  ds.sjs.forEach(function (s) {
    var statuses = (ds.sjLinesByNo[String(s.no)] || []).map(function (l) {
      return lineStatus_(l, ds.receiptsByLine[String(l.id)] || []);
    });
    var st = sjStatusOfStatuses_(statuses);
    if (st === 'OPEN') sjOpen++;
    else if (st === 'WAITING_PHYSICAL') sjWaiting++;
  });

  // --- pengiriman belum POD ---
  var notDelivered = ds.shipments.filter(function (s) { return String(s.status) === 'SHIPPED'; }).length;

  var topPending = pendingItems.slice()
    .sort(function (a, b) { return b.umurDays - a.umurDays; })
    .slice(0, 5);

  return {
    stockTotal: stockTotal,
    stockBatches: batches.length,
    stockCustomers: stockByCustomer.length,
    pendingPhysical: pendingQty,
    pendingRows: pendingItems.length,
    oldestPendingDays: oldestPending,
    sjNotFinished: sjOpen + sjWaiting,
    sjOpen: sjOpen,
    sjWaiting: sjWaiting,
    openLines: openRows.length,
    notDelivered: notDelivered,
    hangingDifference: pendingQty,
    topPending: topPending,
    stockByCustomer: stockByCustomer
  };
}

/* =========================================================
   KARTU STOCK
   ========================================================= */

/**
 * Mutasi + saldo berjalan per batch (PRD 5: kartu stock).
 *
 * Saldo tiap baris dihitung dari SELURUH riwayat batch tersebut (bukan hanya
 * baris yang lolos filter), sehingga nilai saldo tetap benar walau difilter
 * tanggal. Filter hanya memilih baris mana yang ditampilkan.
 *
 * @param {Object} params { productId, code, batch, customerId, from, to }
 */
function ledgerKartuStock_(params, ctx) {
  var ds = stockDataset_();
  var all = ds.movements.map(function (m) { return movementView_(m, ds); });
  sortMovements_(all);

  // Saldo berjalan per batch atas seluruh riwayat.
  var running = {};
  all.forEach(function (mv) {
    var k = batchKeyOf_(mv);
    running[k] = (running[k] || 0) + mv.qty;
    mv.balance = running[k];
  });

  // Penanda awal/akhir grup (untuk garis pemisah di tabel).
  var lastKey = null;
  all.forEach(function (mv) {
    var k = batchKeyOf_(mv);
    mv.isGroupStart = k !== lastKey;
    lastKey = k;
    mv.isGroupEnd = false;
  });
  for (var i = 0; i < all.length; i++) {
    var next = all[i + 1];
    all[i].isGroupEnd = !next || batchKeyOf_(next) !== batchKeyOf_(all[i]);
  }

  // --- filter ---
  var code = String(params.code || '').trim().toLowerCase();
  var batch = String(params.batch || '').trim().toLowerCase();
  var productId = String(params.productId || '').trim();
  var customerId = String(params.customerId || '').trim();
  var from = params.from ? assertDate_(params.from, 'from') : '';
  var to = params.to ? assertDate_(params.to, 'to') : '';

  var items = all.filter(function (mv) {
    if (code && String(mv.productCode).toLowerCase().indexOf(code) === -1) return false;
    if (batch && String(mv.batchNumber).toLowerCase().indexOf(batch) === -1) return false;
    if (productId && String(mv.productId) !== productId) return false;
    if (customerId && String(mv.customerId) !== customerId) return false;
    if (from && String(mv.date) < from) return false;
    if (to && String(mv.date) > to) return false;
    return true;
  });

  var totalIn = items.reduce(function (a, m) { return a + m.in; }, 0);
  var totalOut = items.reduce(function (a, m) { return a + m.out; }, 0);

  // Saldo = sisa akhir tiap batch yang tampil (bukan sekadar in−out filter).
  var endByBatch = {};
  items.forEach(function (m) { endByBatch[batchKeyOf_(m)] = m.balance; });
  var balance = Object.keys(endByBatch).reduce(function (a, k) { return a + endByBatch[k]; }, 0);

  return {
    items: items,
    totals: {
      rows: items.length,
      in: totalIn,
      out: totalOut,
      balance: balance,
      batches: Object.keys(endByBatch).length
    },
    filtered: Boolean(code || batch || productId || customerId || from || to)
  };
}

/* =========================================================
   REKONSILIASI
   ========================================================= */

/**
 * Total masuk/keluar/stok + exception report + mutasi terakhir (PRD 5).
 *
 * Dilengkapi pemeriksaan silang: stok dari batch (receipts − pemakaian) vs
 * stok dari mutasi (Σ mutasi). Bila berbeda, itu indikasi data tidak konsisten
 * dan ditampilkan sebagai `variance` (PRD: "Masuk − Keluar = Stok, tanpa selisih").
 */
function reportReconciliation_(params, ctx) {
  var ds = stockDataset_();

  var allMoves = ds.movements.map(function (m) { return movementView_(m, ds); });
  sortMovements_(allMoves);

  var totalIn = allMoves.reduce(function (a, m) { return a + m.in; }, 0);
  var totalOut = allMoves.reduce(function (a, m) { return a + m.out; }, 0);
  var stockFromMovements = totalIn - totalOut;

  var batchViews = allBatchViews_(ds);
  var stockFromBatches = batchViews.reduce(function (a, b) { return a + b.available; }, 0);

  // Exception: baris SJ yang memotong stok tapi fisiknya belum diterima.
  var exceptions = pendingRows_(ds).filter(function (r) {
    return r.status === 'WAITING_PHYSICAL' || r.status === 'PARTIALLY_RECEIVED';
  }).sort(function (a, b) { return b.umurDays - a.umurDays; });

  var hanging = exceptions.reduce(function (a, r) { return a + r.pending; }, 0);

  var limit = Math.min(100, Math.max(1, parseInt(params.limit, 10) || 15));
  var recentMovements = allMoves.slice().reverse().slice(0, limit);

  var byType = {};
  allMoves.forEach(function (m) {
    if (!byType[m.type]) byType[m.type] = { type: m.type, in: 0, out: 0, rows: 0 };
    byType[m.type].in += m.in;
    byType[m.type].out += m.out;
    byType[m.type].rows += 1;
  });

  return {
    totalIn: totalIn,
    totalOut: totalOut,
    stock: stockFromBatches,
    hanging: hanging,
    variance: stockFromBatches - stockFromMovements,
    checks: {
      stockFromBatches: stockFromBatches,
      stockFromMovements: stockFromMovements,
      balanced: stockFromBatches === stockFromMovements
    },
    byType: Object.keys(byType).map(function (k) { return byType[k]; }),
    exceptions: exceptions,
    recentMovements: recentMovements,
    totals: {
      exceptionRows: exceptions.length,
      movements: allMoves.length,
      batches: batchViews.length,
      shipments: ds.shipments.length,
      sj: ds.sjs.length
    }
  };
}

/* =========================================================
   KONSTANTA
   ========================================================= */

/** Konstanta alasan (PRD 6.4) — satu sumber kebenaran bersama frontend. */
var ALASAN_ = {
  BELUM_READY_PRODUKSI: 'Belum ready produksi',
  BELUM_DATANG_SUPPLIER: 'Belum datang dari supplier',
  BELUM_DIVERIFIKASI: 'Belum diverifikasi gudang',
  SALAH_INPUT: 'Salah input / perlu koreksi',
  LAINNYA: 'Lainnya'
};

/** Satuan produk yang diizinkan (PRD 6.8). */
var SATUAN_ = ['pcs', 'rim', 'pak', 'box', 'lusin', 'unit', 'kg', 'liter'];

/** Info kop surat — dibaca dari Script Properties agar bisa diubah tanpa deploy. */
function getCompany_() {
  var p = PropertiesService.getScriptProperties();
  return {
    name: p.getProperty('COMPANY_NAME') || 'PT DISTRIBUSI NUSANTARA',
    address: p.getProperty('COMPANY_ADDRESS') || '',
    phone: p.getProperty('COMPANY_PHONE') || '',
    email: p.getProperty('COMPANY_EMAIL') || '',
    npwp: p.getProperty('COMPANY_NPWP') || '',
    logo: p.getProperty('COMPANY_LOGO') || 'DN'
  };
}
