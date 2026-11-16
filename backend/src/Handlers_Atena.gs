/**
 * Handlers_Atena.gs — Impor Surat Jalan dari ERP Atena.
 *
 * Sumber: worker `atena-dr-worker`, endpoint `GET /api/v2/dn` (Laporan Surat
 * Jalan LSJ12). Data ERP diambil REALTIME oleh worker tersebut, jadi setiap
 * pemanggilan bisa berbeda.
 *
 * Aturan yang dipakai di sini:
 *  - Satu DN Atena = satu Surat Jalan di aplikasi ini, dengan nomor SJ = `no_dn`
 *    (agar penelusuran ke ERP mudah). Stok TIDAK bertambah saat impor: baris
 *    masuk sebagai `OPEN` dan baru menjadi batch saat "Fisik Ada" dikonfirmasi.
 *  - Item yang kode barangnya belum ada di master produk DILEWATI dan
 *    dilaporkan per baris; DN tanpa satu pun baris valid ditolak.
 *  - Batch & ED dari Atena disimpan sebagai RENCANA (`planned_batch`,
 *    `planned_ed`) dan boleh dikoreksi saat pemeriksaan fisik.
 *  - Token Atena (opsional) disimpan di Script Properties `ATENA_TOKEN`,
 *    TIDAK pernah dikirim ke browser.
 */

/** Base URL worker Atena (bisa ditimpa lewat Script Property `ATENA_BASE_URL`). */
var ATENA_BASE_DEFAULT_ = 'https://atena-dr-worker.m-yusril-al-ubadillah.workers.dev';

/** Nama Script Property untuk base URL dan token. */
var PROP_ATENA_BASE_ = 'ATENA_BASE_URL';
var PROP_ATENA_TOKEN_ = 'ATENA_TOKEN';

/** Rentang tanggal maksimum sekali tarik (ERP diakses per hari oleh worker). */
var ATENA_MAX_RANGE_DAYS_ = 31;

/** Batas jumlah DN per satu impor. */
var ATENA_MAX_IMPORT_ = 60;

/** Umur cache daftar DN (detik) — hanya penahan klik ganda, data tetap realtime. */
var ATENA_CACHE_SEC_ = 120;

/** Batas ukuran JSON yang boleh di-cache (karakter). */
var ATENA_CACHE_MAX_ = 90000;

/* =========================================================
   KONEKSI
   ========================================================= */

/** Base URL Atena yang dipakai. */
function atenaBase_() {
  var v = '';
  try {
    v = PropertiesService.getScriptProperties().getProperty(PROP_ATENA_BASE_) || '';
  } catch (ignore) {
    v = '';
  }
  v = String(v).trim().replace(/\/+$/, '');
  return v || ATENA_BASE_DEFAULT_;
}

/** Token baca Atena (opsional). */
function atenaToken_() {
  try {
    return String(PropertiesService.getScriptProperties().getProperty(PROP_ATENA_TOKEN_) || '').trim();
  } catch (ignore) {
    return '';
  }
}

/**
 * GET ke API Atena dan kembalikan JSON-nya.
 * @param {string} path mis. `/api/v2/dn?from=...&to=...`
 * @returns {Object}
 */
function atenaGet_(path) {
  var options = {
    method: 'get',
    muteHttpExceptions: true,
    headers: { Accept: 'application/json' }
  };
  var token = atenaToken_();
  if (token) options.headers.Authorization = 'Bearer ' + token;

  var res;
  try {
    res = UrlFetchApp.fetch(atenaBase_() + path, options);
  } catch (e) {
    throw apiError_('UPSTREAM_ERROR',
      'Tidak bisa menghubungi API Atena: ' + ((e && e.message) ? e.message : String(e)));
  }

  var code = res.getResponseCode();
  var text = res.getContentText();
  var json = null;
  try { json = JSON.parse(text); } catch (ignore) { json = null; }

  if (code === 200 && json) return json;

  if (code === 429) {
    var wait = (json && json.coba_lagi_dalam_detik) ? json.coba_lagi_dalam_detik : 60;
    throw apiError_('RATE_LIMITED',
      'API Atena membatasi permintaan. Coba lagi dalam ' + wait + ' detik.');
  }
  if (code === 400) {
    var msg = (json && (json.message || json.error)) || text || '';
    throw apiError_('VALIDATION_ERROR', 'Permintaan ditolak API Atena: ' + String(msg).slice(0, 200));
  }
  throw apiError_('UPSTREAM_ERROR', 'API Atena mengembalikan HTTP ' + code + '.');
}

/** Cache tipis untuk respons Atena (tidak memakai versi data aplikasi). */
function atenaCached_(key, compute) {
  var cache = scriptCache_();
  if (!cache) return compute();

  var ck = 'gt_atena_' + String(key).slice(0, 200);
  try {
    var raw = cache.get(ck);
    if (raw) return JSON.parse(raw);
  } catch (ignore) { /* cache rusak -> ambil ulang */ }

  var result = compute();
  try {
    var json = JSON.stringify(result);
    if (json && json.length <= ATENA_CACHE_MAX_) cache.put(ck, json, ATENA_CACHE_SEC_);
  } catch (ignore) { /* cache opsional */ }

  return result;
}

/* =========================================================
   PEMETAAN DATA
   ========================================================= */

/** Selisih hari inklusif antara dua tanggal `YYYY-MM-DD`. */
function atenaDaySpan_(from, to) {
  var a = new Date(String(from) + 'T00:00:00');
  var b = new Date(String(to) + 'T00:00:00');
  return Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
}

/** Normalisasi nama untuk pencocokan: huruf besar, tanpa tanda baca. */
function atenaNormName_(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Tebak pelanggan aplikasi dari nama pelanggan Atena.
 *
 * Urutan: cocok persis kode, lalu nama; bila tidak ada, cari satu-satunya
 * pelanggan yang kode/nama-nya MEMUAT nama Atena (mis. "TANGERANG" ->
 * pelanggan berkode TANGERANG). Tidak menebak bila kandidat lebih dari satu —
 * user wajib memilih sendiri.
 *
 * @param {string} atenaName nama pelanggan dari Atena
 * @param {Object[]} customers baris tabel `customers`
 * @returns {string} id pelanggan atau '' bila tidak yakin
 */
function atenaGuessCustomer_(atenaName, customers) {
  var key = atenaNormName_(atenaName);
  if (!key) return '';

  var list = customers || [];
  for (var i = 0; i < list.length; i++) {
    var c = list[i];
    if (atenaNormName_(c.code) === key || atenaNormName_(c.name) === key) return c.id;
  }

  var partial = [];
  for (var j = 0; j < list.length; j++) {
    var cc = list[j];
    var hay = atenaNormName_(cc.code) + ' ' + atenaNormName_(cc.name);
    if (hay.indexOf(key) !== -1) partial.push(cc.id);
  }
  return partial.length === 1 ? partial[0] : '';
}

/**
 * Ubah balasan `/api/v2/dn` menjadi bentuk siap pakai frontend.
 * Item yang belum ada di master produk ditandai `productId: ''`.
 *
 * @param {Object} payload balasan API Atena
 * @param {string} from tanggal awal
 * @param {string} to tanggal akhir
 * @param {string} status cbStatus yang dipakai
 * @returns {{meta:Object, items:Object[]}}
 */
function atenaBuildDnResult_(payload, from, to, status) {
  var productsByCode = {};
  readTable_('products').forEach(function (p) {
    productsByCode[String(p.code || '').toUpperCase()] = p;
  });

  var customers = readTable_('customers');
  var existingSj = {};
  readTable_('sj').forEach(function (s) { existingSj[String(s.no || '').toUpperCase()] = true; });

  var list = (payload && payload.delivery_notes) || [];
  var items = list.map(function (dn) {
    var rawItems = dn.items || [];
    var mapped = [];
    var unknown = 0;
    var totalQty = 0;

    rawItems.forEach(function (it) {
      var kode = String(it.kode_barang || '').trim().toUpperCase();
      var qty = Number(it.jml || 0);
      totalQty += qty;

      var product = productsByCode[kode];
      if (!product) unknown++;

      mapped.push({
        kode: kode,
        nama: String(it.nama_barang || ''),
        satuan: String(it.satuan || ''),
        qty: qty,
        batch: String(it.nomer_batch || '').trim(),
        ed: String(it.tgl_expired || '').trim(),
        productId: product ? product.id : '',
        productName: product ? String(product.name || '') : ''
      });
    });

    var noDn = String(dn.no_dn || '').trim().toUpperCase();
    return {
      noDn: noDn,
      tglKirim: String(dn.tgl_kirim || ''),
      customer: String(dn.customer || ''),
      customerId: atenaGuessCustomer_(dn.customer, customers),
      jenis: String(dn.jenis || ''),
      ekspedisi: String(dn.ekspedisi || ''),
      noDr: String(dn.no_dr || ''),
      noPo: String(dn.no_po_pelanggan || ''),
      jatuhTempo: String(dn.tgl_jatuh_tempo || ''),
      keterangan: String(dn.keterangan || ''),
      itemCount: mapped.length,
      totalQty: totalQty,
      unknownProducts: unknown,
      imported: Boolean(existingSj[noDn]),
      items: mapped
    };
  });

  items.sort(function (a, b) {
    var d = String(a.tglKirim).localeCompare(String(b.tglKirim));
    return d !== 0 ? d : String(a.noDn).localeCompare(String(b.noDn));
  });

  return {
    meta: {
      from: from,
      to: to,
      status: status,
      source: 'Atena',
      realtime: true,
      generatedAt: (payload && payload.meta && payload.meta.generated_at) || '',
      totalDn: items.length,
      totalItem: (payload && payload.meta && payload.meta.total_item) || 0
    },
    items: items
  };
}

/* =========================================================
   ACTION — BACA
   ========================================================= */

/**
 * Daftar DN Atena pada rentang tanggal kirim.
 * @param {Object} params { from, to, cbStatus? }
 */
function atenaDnList_(params, ctx) {
  var from = assertDate_(params.from, 'from');
  var to = assertDate_(params.to, 'to');

  if (String(from) > String(to)) {
    throw apiError_('VALIDATION_ERROR', 'Tanggal "from" tidak boleh setelah "to".', 'from');
  }
  var span = atenaDaySpan_(from, to);
  if (span > ATENA_MAX_RANGE_DAYS_) {
    throw apiError_('VALIDATION_ERROR',
      'Rentang tanggal maksimal ' + ATENA_MAX_RANGE_DAYS_ + ' hari (diminta ' + span + ' hari).', 'to');
  }

  var status = String(params.cbStatus || 'I,S,P').toUpperCase().replace(/\s+/g, '');
  if (!/^[ISPD](,[ISPD])*$/.test(status)) {
    throw apiError_('VALIDATION_ERROR', 'cbStatus harus kombinasi I, S, P, D (mis. "I,S,P").', 'cbStatus');
  }

  var path = '/api/v2/dn?from=' + encodeURIComponent(from)
    + '&to=' + encodeURIComponent(to)
    + '&cbStatus=' + encodeURIComponent(status);

  var payload = atenaCached_(path, function () { return atenaGet_(path); });
  return atenaBuildDnResult_(payload, from, to, status);
}

/* =========================================================
   ACTION — TULIS
   ========================================================= */

/**
 * Impor DN terpilih menjadi Surat Jalan (baris berstatus OPEN).
 *
 * Seluruh DN divalidasi lebih dulu; baru setelah itu dokumen dibuat satu per
 * satu lewat `sjCreate_` (aturan yang sama dengan tambah SJ manual). DN yang
 * gagal dilaporkan, tidak menggagalkan DN lain.
 *
 * @param {Object} params { dns: [{ noDn, tglKirim, customerId, noDr, noPo, jenis, ekspedisi, items[] }] }
 */
function atenaImportDn_(params, ctx) {
  var input = params.dns;
  if (!input || !input.length) {
    throw apiError_('VALIDATION_ERROR', 'Tidak ada DN yang dipilih.', 'dns');
  }
  if (input.length > ATENA_MAX_IMPORT_) {
    throw apiError_('VALIDATION_ERROR', 'Maksimal ' + ATENA_MAX_IMPORT_ + ' DN per impor.', 'dns');
  }

  var productsByCode = {};
  readTable_('products').forEach(function (p) {
    productsByCode[String(p.code || '').toUpperCase()] = p;
  });

  var customerById = {};
  readTable_('customers').forEach(function (c) { customerById[String(c.id)] = c; });

  var existingSj = {};
  readTable_('sj').forEach(function (s) { existingSj[String(s.no || '').toUpperCase()] = true; });

  var prepared = [];
  var failed = [];
  var skippedLines = [];
  var seen = {};

  for (var i = 0; i < input.length; i++) {
    var dn = input[i] || {};
    var noDn = String(dn.noDn || '').trim().toUpperCase();

    try {
      if (!noDn) throw apiError_('VALIDATION_ERROR', 'No DN kosong.');
      if (seen[noDn]) throw apiError_('VALIDATION_ERROR', 'DN ' + noDn + ' dipilih lebih dari sekali.');
      seen[noDn] = true;
      if (existingSj[noDn]) throw apiError_('DUPLICATE', 'DN ' + noDn + ' sudah pernah diimpor.');

      var date = assertDate_(dn.tglKirim || dn.date, 'dns[' + i + '].tglKirim');
      var customerId = String(dn.customerId || '').trim();
      if (!customerId || !customerById[customerId]) {
        throw apiError_('VALIDATION_ERROR', 'Pelanggan untuk DN ' + noDn + ' belum dipilih.', 'customerId');
      }

      var lines = [];
      (dn.items || []).forEach(function (it) {
        var kode = String(it.kode || '').trim().toUpperCase();
        var product = productsByCode[kode];
        if (!product) {
          skippedLines.push({ noDn: noDn, kode: kode, message: 'Produk ' + kode + ' belum ada di master.' });
          return;
        }
        var qty = parseInt(it.qty, 10);
        if (!isFinite(qty) || qty < 1) {
          skippedLines.push({ noDn: noDn, kode: kode, message: 'Qty tidak valid.' });
          return;
        }
        lines.push({
          productId: product.id,
          qty: qty,
          plannedBatch: String(it.batch || '').trim().toUpperCase(),
          plannedEd: String(it.ed || '').trim()
        });
      });

      if (!lines.length) {
        throw apiError_('VALIDATION_ERROR',
          'Tidak ada baris valid pada DN ' + noDn + ' (semua produk belum ada di master).');
      }

      prepared.push({
        no: noDn,
        date: date,
        customerId: customerId,
        po: String(dn.noPo || dn.noDr || 'ATENA').trim(),
        lines: lines,
        noDr: String(dn.noDr || ''),
        jenis: String(dn.jenis || '')
      });
    } catch (e) {
      failed.push({
        noDn: noDn || '(tanpa nomor)',
        code: (e && e.code) ? e.code : 'INTERNAL',
        message: (e && e.message) ? e.message : 'Gagal divalidasi.'
      });
    }
  }

  var created = [];
  prepared.forEach(function (p) {
    try {
      var view = sjCreate_({
        no: p.no,
        date: p.date,
        customerId: p.customerId,
        po: p.po,
        lines: p.lines
      }, ctx);
      created.push({ no: view.no, lines: p.lines.length, noDr: p.noDr, jenis: p.jenis });
    } catch (e) {
      failed.push({
        noDn: p.no,
        code: (e && e.code) ? e.code : 'INTERNAL',
        message: (e && e.message) ? e.message : 'Gagal dibuat.'
      });
    }
  });

  audit_(ctx, 'atena.import', 'sj', '', {
    requested: input.length,
    created: created.length,
    skippedLines: skippedLines.length,
    failed: failed.length
  });

  return {
    created: created,
    failed: failed,
    skippedLines: skippedLines,
    totals: {
      requested: input.length,
      created: created.length,
      lines: created.reduce(function (a, c) { return a + c.lines; }, 0),
      skipped: skippedLines.length,
      failed: failed.length
    }
  };
}