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
      created.pop();
      return masterDelete_({ entity: 'product', id: prod.id }, admin);
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
