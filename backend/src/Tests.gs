/**
 * Tests.gs — Uji aturan bisnis yang dijalankan DI DALAM server.
 *
 * Kenapa di server: menguji lewat HTTP butuh 1-3 dtk per panggilan, sehingga
 * belasan pemeriksaan menjadi sangat lambat. Di sini semua pemanggilan
 * langsung ke fungsi internal, jadi selesai dalam hitungan detik.
 *
 * Akses: action `system.selfTest` (khusus ADMIN).
 * Semua data uji dibersihkan di akhir agar database tidak kotor.
 */

/**
 * Handler action `system.selfTest`.
 * @param {Object} params { entity?: 'product'|'customer'|'location'|'rack' }
 */
function systemSelfTest_(params, ctx) {
  var results = [];

  function check(name, expectOk, fn) {
    var got, ok, code = null, msg = null;
    try {
      got = fn();
      ok = true;
    } catch (e) {
      ok = false;
      code = e && e.code ? e.code : 'UNKNOWN';
      msg = e && e.message ? e.message : String(e);
    }

    var pass;
    // expectOk === true  -> harus berhasil
    // expectOk === false -> harus gagal dengan EROR apa pun
    // expectOk === '<code>' -> harus gagal dengan kode tertentu
    if (expectOk === true) pass = ok;
    else if (expectOk === false) pass = !ok;
    else pass = !ok && code === expectOk;

    var expectedLabel = (expectOk === true) ? 'OK' : ((expectOk === false) ? 'FAIL(any)' : expectOk);
    results.push({
      test: name,
      expect: expectedLabel,
      got: ok ? 'OK' : code,
      pass: pass,
      message: pass ? null : (ok ? 'Seharusnya ditolak' : msg)
    });
    return got;
  }

  var created = [];   // { entity, id } untuk dibersihkan
  function track(entity, row) { created.push({ entity: entity, id: row.id }); return row; }
  /**
   * Buang satu id dari daftar pembersihan.
   * JANGAN memakai `created.pop()`: kalau ada record lain yang dibuat setelahnya,
   * pop() membuang record yang salah sehingga record lain tertinggal di sheet.
   */
  function forget(id) {
    for (var i = created.length - 1; i >= 0; i--) {
      if (String(created[i].id) === String(id)) { created.splice(i, 1); return true; }
    }
    return false;
  }

  var admin = { username: 'selfTest', role: ROLES.ADMIN, userId: 'selfTest' };

  /* ---------- PRODUK ---------- */
  var prod = check('product: buat kode huruf kecil dinormalkan', true, function () {
    return track('product', masterCreate_({ entity: 'product', values: { code: 'test-p1', name: 'Uji Produk', unit: 'pcs' } }, admin));
  });
  check('product: kode duplikat ditolak', 'DUPLICATE', function () {
    return masterCreate_({ entity: 'product', values: { code: 'TEST-P1', name: 'Duplikat', unit: 'pcs' } }, admin);
  });
  check('product: satuan bebas diterima (mis. karung)', true, function () {
    return track('product', masterCreate_({ entity: 'product', values: { code: 'TEST-P2', name: 'Satuan Bebas', unit: 'karung' } }, admin));
  });
  check('product: satuan > 20 karakter ditolak', 'VALIDATION_ERROR', function () {
    return masterCreate_({ entity: 'product', values: { code: 'TEST-P3', name: 'Satuan Panjang', unit: 'satuan-yang-terlalu-panjang-sekali' } }, admin);
  });
  check('product: kode kosong ditolak', 'VALIDATION_ERROR', function () {
    return masterCreate_({ entity: 'product', values: { code: '', name: 'Tanpa Kode', unit: 'pcs' } }, admin);
  });
  if (prod) {
    check('product: update nama', true, function () {
      return masterUpdate_({ entity: 'product', id: prod.id, values: { name: 'Uji Revisi' } }, admin);
    });
    check('product: hapus saat belum dipakai', true, function () {
      var res = masterDelete_({ entity: 'product', id: prod.id }, admin);
      forget(prod.id);
      return res;
    });
  }

  /* ---------- PELANGGAN ---------- */
  var cust = check('customer: buat', true, function () {
    return track('customer', masterCreate_({ entity: 'customer', values: { code: 'test-c1', name: 'Uji Pelanggan', address: 'Jl. Uji', phone: '021' } }, admin));
  });
  check('customer: kode duplikat ditolak', 'DUPLICATE', function () {
    return masterCreate_({ entity: 'customer', values: { code: 'TEST-C1', name: 'Duplikat' } }, admin);
  });

  /* ---------- GUDANG & RAK ---------- */
  var loc = null;
  if (cust) {
    loc = check('location: buat CONSIGN untuk pelanggan uji', true, function () {
      return track('location', masterCreate_({ entity: 'location', values: { type: 'CONSIGN', name: 'Gudang Uji', customerId: cust.id } }, admin));
    });
    check('location: CONSIGN kedua pelanggan sama ditolak', 'DUPLICATE', function () {
      return masterCreate_({ entity: 'location', values: { type: 'CONSIGN', name: 'Gudang Uji 2', customerId: cust.id } }, admin);
    });
    check('location: CONSIGN tanpa pelanggan ditolak', 'VALIDATION_ERROR', function () {
      return masterCreate_({ entity: 'location', values: { type: 'CONSIGN', name: 'Tanpa Pelanggan' } }, admin);
    });
    check('location: tipe tidak dikenal ditolak', 'VALIDATION_ERROR', function () {
      return masterCreate_({ entity: 'location', values: { type: 'GUDANG', name: 'Tipe Salah' } }, admin);
    });
    check('location: MAIN membuang customerId', true, function () {
      var row = masterCreate_({ entity: 'location', values: { type: 'MAIN', name: 'Gudang Utama Uji', customerId: cust.id } }, admin);
      if (row.customerId) throw apiError_('VALIDATION_ERROR', 'customerId harus kosong untuk MAIN');
      return track('location', row);
    });
  }

  var rack = null;
  if (loc) {
    rack = check('rack: buat', true, function () {
      return track('rack', masterCreate_({ entity: 'rack', values: { code: 'test-r1', name: 'Rak Uji', locationId: loc.id } }, admin));
    });
    check('rack: kode duplikat ditolak', 'DUPLICATE', function () {
      return masterCreate_({ entity: 'rack', values: { code: 'TEST-R1', name: 'Duplikat', locationId: loc.id } }, admin);
    });
    check('rack: tanpa gudang ditolak', 'VALIDATION_ERROR', function () {
      return masterCreate_({ entity: 'rack', values: { code: 'TEST-R2', name: 'Tanpa Gudang' } }, admin);
    });
    check('rack: gudang tidak ada ditolak', 'NOT_FOUND', function () {
      return masterCreate_({ entity: 'rack', values: { code: 'TEST-R3', name: 'Gudang Hantu', locationId: 'tidak-ada' } }, admin);
    });
    if (rack) {
      check('location: hapus gudang yang masih punya rak ditolak', 'IN_USE', function () {
        return masterDelete_({ entity: 'location', id: loc.id }, admin);
      });
    }
  }

  /* ---------- TULIS MASSAL (updateManyById_) & RAK TANPA NAMA ---------- */
  // `updateManyById_` dipakai "Fisik Terima" semua baris (satu getValues +
  // satu setValues, bukan 2 round-trip sheet per baris). Diuji pada tabel
  // `racks` supaya tidak menyentuh stok.
  var bulkRacks = [];
  if (loc) {
    check('rack: tanpa nama diterima (kolom nama tidak dipakai UI)', true, function () {
      return track('rack', masterCreate_({ entity: 'rack', values: { code: 'zz-tanpa-nama', locationId: loc.id } }, admin));
    });

    check('tulis massal: siapkan 3 rak uji', true, function () {
      for (var b = 1; b <= 3; b++) {
        bulkRacks.push(track('rack', masterCreate_({
          entity: 'rack',
          values: { code: 'ZZ-BULK-' + b, locationId: loc.id }
        }, admin)).id);
      }
      return bulkRacks.length === 3;
    });

    check('tulis massal: 3 baris diubah sekali tulis', true, function () {
      var patches = {};
      bulkRacks.forEach(function (id, idx) { patches[id] = { name: 'BULK-' + idx }; });
      var changed = updateManyById_('racks', patches);
      if (changed !== 3) throw new Error('jumlah baris terubah = ' + changed);

      var byId = {};
      readTable_('racks').forEach(function (r) { byId[String(r.id)] = r; });
      bulkRacks.forEach(function (id, idx) {
        var row = byId[String(id)];
        if (!row || String(row.name) !== 'BULK-' + idx) {
          throw new Error('baris ' + id + ' tidak ikut berubah');
        }
      });
      return true;
    });

    check('tulis massal: kunci tidak dikenal diabaikan', true, function () {
      var changed = updateManyById_('racks', {
        'tidak-ada-1': { name: 'x' },
        'tidak-ada-2': { name: 'y' }
      });
      if (changed !== 0) throw new Error('seharusnya 0, dapat ' + changed);
      return true;
    });
  }

  /* ---------- MASTER.listAll & CACHE BACA ---------- */
  check('master.listAll: mengembalikan 4 daftar master', true, function () {
    var all = masterListAll_({}, admin);
    ['products', 'customers', 'locations', 'racks'].forEach(function (k) {
      if (!all[k] || typeof all[k].length !== 'number') throw new Error('bagian ' + k + ' tidak ada');
    });
    if (bulkRacks.length && !all.racks.some(function (r) { return String(r.id) === String(bulkRacks[0]); })) {
      throw new Error('rak uji tidak ditemukan di master.listAll');
    }
    return true;
  });

  check('cache baca: versi data naik -> entri lama tidak terpakai', true, function () {
    var v1 = getDataVersion_();
    var first = cachedRead_('uji.cache', 60, function () { return { hit: v1 }; });
    if (first.hit !== v1) throw new Error('nilai pertama salah');

    var second = cachedRead_('uji.cache', 60, function () { return { hit: 'dihitung-ulang' }; });
    if (second.hit !== v1) throw new Error('cache tidak dipakai pada pembacaan kedua');

    bumpDataVersion_();
    var third = cachedRead_('uji.cache', 60, function () { return { hit: 'setelah-tulis' }; });
    if (third.hit !== 'setelah-tulis') throw new Error('entri lama masih dipakai setelah versi naik');
    return true;
  });

  /* ---------- NOMOR PENGIRIMAN (DO) ---------- */
  check('nomor DO: November 2026 -> DNTTP-2611-001', true, function () {
    var got = formatSeq_(doNumberPrefix_(new Date(2026, 10, 16, 12, 0, 0)), 1, DO_SEQ_PAD_);
    if (got !== 'DNTTP-2611-001') throw new Error('dapat ' + got);
    return true;
  });

  check('nomor DO: Desember 2026 reset ke 001', true, function () {
    var got = formatSeq_(doNumberPrefix_(new Date(2026, 11, 1, 12, 0, 0)), 1, DO_SEQ_PAD_);
    if (got !== 'DNTTP-2612-001') throw new Error('dapat ' + got);
    return true;
  });

  check('nomor DO: Januari 2027 -> DNTTP-2701-001', true, function () {
    var got = formatSeq_(doNumberPrefix_(new Date(2027, 0, 2, 12, 0, 0)), 1, DO_SEQ_PAD_);
    if (got !== 'DNTTP-2701-001') throw new Error('dapat ' + got);
    return true;
  });

  check('nomor DO: urutan lewat 999 lanjut 4 digit', true, function () {
    var got = formatSeq_(doNumberPrefix_(new Date(2026, 10, 30, 12, 0, 0)), 1000, DO_SEQ_PAD_);
    if (got !== 'DNTTP-2611-1000') throw new Error('dapat ' + got);
    return true;
  });

  /* ---------- IMPOR ATENA (pemetaan, tanpa jaringan) ---------- */
  check('atena: cocok pelanggan lewat kode persis', true, function () {
    var list = [
      { id: 'c1', code: 'TANGERANG', name: 'ENSEVAL TANGERANG UP HERY SNA' },
      { id: 'c2', code: 'BANDUNG', name: 'ENSEVAL BANDUNG UP LELY SNA' }
    ];
    var got = atenaGuessCustomer_('TANGERANG', list);
    if (got !== 'c1') throw new Error('dapat ' + got);
    return true;
  });

  check('atena: tidak menebak bila kandidat lebih dari satu', true, function () {
    var list = [
      { id: 'c1', code: 'TNG-1', name: 'ENSEVAL TANGERANG 1' },
      { id: 'c2', code: 'TNG-2', name: 'ENSEVAL TANGERANG 2' }
    ];
    var got = atenaGuessCustomer_('TANGERANG', list);
    if (got !== '') throw new Error('seharusnya kosong, dapat ' + got);
    return true;
  });

  check('atena: DN dipetakan ke produk & pelanggan kita', true, function () {
    if (!cust) throw new Error('pelanggan uji tidak ada');
    var atenProd = track('product', masterCreate_({
      entity: 'product',
      values: { code: 'ZZ-ATENA-1', name: 'Uji Atena', unit: 'pcs' }
    }, admin));
    var res = atenaBuildDnResult_({
      meta: { total_item: 2, generated_at: '2026-11-16T00:00:00Z' },
      delivery_notes: [{
        no_dn: 'dn.uji.1', tgl_kirim: '2026-11-16', customer: 'Uji Pelanggan', jenis: 'PENJUALAN',
        no_dr: 'DR.UJI.1', no_po_pelanggan: 'PO-UJI', ekspedisi: 'EPM UJI',
        items: [
          { kode_barang: 'ZZ-ATENA-1', nama_barang: 'Uji Atena', satuan: 'pcs', jml: 10, nomer_batch: 'B1', tgl_expired: '2027-01-01' },
          { kode_barang: 'ZZ-TIDAK-ADA', nama_barang: 'X', satuan: 'pcs', jml: 5 }
        ]
      }]
    }, '2026-11-16', '2026-11-16', 'I,S,P');

    var dn = res.items[0];
    if (!dn) throw new Error('DN tidak terbentuk');
    if (dn.noDn !== 'DN.UJI.1') throw new Error('noDn = ' + dn.noDn);
    if (dn.customerId !== cust.id) throw new Error('pelanggan tidak terpetakan: ' + dn.customerId);
    if (dn.unknownProducts !== 1) throw new Error('unknownProducts = ' + dn.unknownProducts);
    if (dn.totalQty !== 15) throw new Error('totalQty = ' + dn.totalQty);
    if (dn.imported !== false) throw new Error('imported harus false');
    if (dn.items[0].productId !== atenProd.id) throw new Error('produk uji tidak terpetakan');
    if (dn.items[1].productId !== '') throw new Error('produk asing harus kosong');
    return true;
  });

  /* ---------- HAPUS SJ (membatalkan salah impor) ---------- */
  if (cust && loc) {
    check('sj: buat SJ uji untuk penghapusan', true, function () {
      var delProd = track('product', masterCreate_({
        entity: 'product',
        values: { code: 'ZZ-DEL-1', name: 'Uji Hapus SJ', unit: 'pcs' }
      }, admin));

      var row = sjCreate_({
        no: 'ZZ-HAPUS-1',
        date: '2026-11-16',
        customerId: cust.id,
        po: 'PO-UJI-HAPUS',
        lines: [{ productId: delProd.id, qty: 2 }]
      }, admin);

      if (String(row.no) !== 'ZZ-HAPUS-1') throw new Error('nomor SJ = ' + row.no);
      return true;
    });

    check('sj: hapus SJ yang belum menerima stok', true, function () {
      var res = sjDelete_({ no: 'ZZ-HAPUS-1' }, admin);
      if (!res.deleted) throw new Error('tidak terhapus');
      if (Number(res.lines) !== 1) throw new Error('baris terhapus = ' + res.lines);
      return true;
    });

    check('sj: hapus SJ yang tidak ada ditolak', 'NOT_FOUND', function () {
      return sjDelete_({ no: 'ZZ-HAPUS-1' }, admin);
    });
  }

  /* ---------- ENTITY TIDAK DIKENAL ---------- */
  check('entity tidak dikenal ditolak', 'VALIDATION_ERROR', function () {
    return masterList_({ entity: 'supplier' }, admin);
  });

  /* ---------- PEMBERSIHAN ---------- */
  var cleaned = 0, cleanFail = [];
  // Urutan terbalik: hapus rak -> gudang -> pelanggan -> produk.
  created.slice().reverse().forEach(function (item) {
    try {
      masterDelete_({ entity: item.entity, id: item.id }, admin);
      cleaned++;
    } catch (e) {
      cleanFail.push(item.entity + ':' + item.id + ':' + (e && e.code));
    }
  });

  var passed = results.filter(function (r) { return r.pass; }).length;
  return {
    total: results.length,
    passed: passed,
    failed: results.length - passed,
    results: results,
    cleanup: { deleted: cleaned, failed: cleanFail }
  };
}
