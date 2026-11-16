/**
 * modals/atena-import.js — Impor Surat Jalan dari ERP Atena.
 *
 * Tiga langkah:
 *  1. Pilih periode (from/to) -> muat DN dari server -> centang DN yang akan
 *     diimpor, tentukan pelanggan kita untuk tiap DN.
 *  2. Cek barang: semua baris DN terpilih ditampilkan untuk diperiksa
 *     (produk, qty, batch, ED). Baris yang produknya belum ada di master
 *     ditandai dan tidak akan diimpor.
 *  3. Simpan: server membuat SJ (nomor = no DN) berstatus OPEN. Stok baru
 *     bertambah setelah "Fisik Ada" dikonfirmasi di halaman Penerimaan.
 *
 * Semua data lewat backend (bukan langsung ke worker Atena) supaya token dan
 * alamat API tidak pernah sampai ke browser.
 */

import { atena } from '../api.js';
import { state, fmt, fmtDate } from '../state.js';
import { el, btn, badge, callout, field, grid2, modal, select, toast, kodeTag, batchTag } from '../ui.js';

/** Tanggal pertama bulan berjalan dari sebuah `YYYY-MM-DD`. */
function monthStartOf(iso) {
  const s = String(iso || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.slice(0, 8) + '01' : '';
}

/** Beda hari inklusif antara dua tanggal `YYYY-MM-DD`. */
function daySpan(from, to) {
  const a = Date.parse(from + 'T00:00:00');
  const b = Date.parse(to + 'T00:00:00');
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86400000) + 1;
}

/** Baris kecil "label: nilai". */
function infoLine(label, value) {
  return el('div', { class: 'atena-meta' }, [
    el('span', { class: 'sub', text: label + ': ' }),
    el('b', { text: value == null || value === '' ? '—' : String(value) })
  ]);
}

/**
 * Buka modal impor Atena.
 * @param {Function} [onDone] dipanggil setelah ada SJ yang dibuat
 */
export function openAtenaImport(onDone) {
  const today = state.serverDate || new Date().toISOString().slice(0, 10);

  const st = {
    step: 'pick',
    from: monthStartOf(today),
    to: today,
    status: 'I,S,P',
    loaded: null,       // { meta, items }
    selected: new Set(),
    custMap: {},        // noDn -> customerId
    jenisFilter: '',
    showImported: false,
    hasResult: false
  };

  const bodyWrap = el('div');

  const closeBtn = btn('Tutup', { onClick: () => dlg.close() });
  const backBtn = btn('Kembali', { onClick: () => { st.step = 'pick'; render(); } });
  const nextBtn = btn('Lanjut: cek barang', { variant: 'primary', onClick: () => { st.step = 'review'; render(); } });
  const saveBtn = btn('Simpan ke Penerimaan', { variant: 'ok', onClick: save });

  const dlg = modal({
    title: 'Impor Surat Jalan dari Atena',
    sub: 'Tarik DN dari ERP Atena, centang yang akan masuk, lalu periksa barangnya',
    body: [bodyWrap],
    footer: [closeBtn, backBtn, nextBtn, saveBtn]
  });

  /* =========================================================
     RENDER
     ========================================================= */

  function render() {
    bodyWrap.innerHTML = '';
    closeBtn.hidden = false;
    backBtn.hidden = st.step !== 'review';
    nextBtn.hidden = st.step !== 'pick';
    saveBtn.hidden = st.step !== 'review';

    if (st.step === 'pick') renderPick();
    else if (st.step === 'review') renderReview();
    else renderDone();
  }

  /* ---------- LANGKAH 1: PILIH DN ---------- */
  function renderPick() {
    const fromInput = el('input', { type: 'date', value: st.from });
    const toInput = el('input', { type: 'date', value: st.to });
    const loadBtn = btn('Muat DN', { variant: 'primary' });

    const statusSelect = select([
      { value: 'I,S,P', label: 'I, S, P — aktif (tanpa batal)' },
      { value: 'P', label: 'P — hanya posting' },
      { value: 'I,S,P,D', label: 'I, S, P, D — termasuk dibatalkan' }
    ], st.status);
    statusSelect.addEventListener('change', () => { st.status = statusSelect.value; });

    const listWrap = el('div', { class: 'atena-list' });

    bodyWrap.appendChild(callout(
      'Satu DN Atena menjadi satu Surat Jalan di aplikasi ini (nomor SJ = no DN). '
      + 'Stok belum bertambah sampai "Fisik Ada" dikonfirmasi.', 'blue'));
    bodyWrap.appendChild(grid2([
      field('Tanggal dari', fromInput, 'Tanggal kirim (Tgl. Kirim) di ERP.', true),
      field('Tanggal sampai', toInput, 'Maksimal 31 hari sekali tarik.', true)
    ]));
    bodyWrap.appendChild(grid2([
      field('Status dokumen', statusSelect, 'Dokumen batal (D) sebaiknya tidak diimpor.', false),
      el('div', { class: 'field' }, [el('label', { text: ' ' }), loadBtn])
    ]));
    bodyWrap.appendChild(listWrap);

    loadBtn.addEventListener('click', async () => {
      const from = fromInput.value;
      const to = toInput.value;
      if (!from || !to) {
        toast('Isi tanggal dari dan sampai.', 'err');
        return;
      }
      if (from > to) {
        toast('Tanggal "dari" tidak boleh setelah "sampai".', 'err');
        return;
      }
      if (daySpan(from, to) > 31) {
        toast('Rentang maksimal 31 hari sekali tarik.', 'err');
        return;
      }

      st.from = from;
      st.to = to;
      loadBtn.disabled = true;
      loadBtn.textContent = 'Memuat...';
      listWrap.innerHTML = '';
      listWrap.appendChild(el('div', { class: 'hint', text: 'Menghubungi ERP Atena...' }));

      try {
        const res = await atena.dnList({ from, to, cbStatus: st.status });
        st.loaded = res;
        st.selected = new Set();
        st.custMap = {};
        res.items.forEach((dn) => { if (dn.customerId) st.custMap[dn.noDn] = dn.customerId; });
        renderDnList(listWrap);
      } catch (err) {
        listWrap.innerHTML = '';
        listWrap.appendChild(callout(err.message || 'Gagal memuat DN dari Atena.', 'amber'));
        toast(err.message || 'Gagal memuat DN.', 'err');
      } finally {
        loadBtn.disabled = false;
        loadBtn.textContent = 'Muat DN';
        updateButtons();
      }
    });

    if (st.loaded) renderDnList(listWrap);
    updateButtons();
  }

  /** Daftar DN + checkbox + pilihan pelanggan. */
  function renderDnList(container) {
    container.innerHTML = '';
    const all = (st.loaded && st.loaded.items) || [];

    if (!all.length) {
      container.appendChild(callout('Tidak ada DN pada rentang tanggal ini.', 'amber'));
      updateButtons();
      return;
    }

    const jenisList = Array.from(new Set(all.map((d) => d.jenis).filter(Boolean))).sort();
    const jenisSelect = select(
      [{ value: '', label: 'Semua jenis' }].concat(jenisList.map((j) => ({ value: j, label: j }))),
      st.jenisFilter
    );
    jenisSelect.addEventListener('change', () => { st.jenisFilter = jenisSelect.value; renderDnList(container); });
    const importToggle = el('input', { type: 'checkbox' });
    importToggle.checked = st.showImported;
    importToggle.addEventListener('change', () => {
      st.showImported = importToggle.checked;
      renderDnList(container);
    });

    const shown = all.filter((dn) => {
      if (st.jenisFilter && dn.jenis !== st.jenisFilter) return false;
      if (!st.showImported && dn.imported) return false;
      return true;
    });

    const bar = el('div', { class: 'panel-actions', style: { marginBottom: '8px' } }, [
      jenisSelect,
      el('label', { class: 'check-inline' }, [importToggle, document.createTextNode(' Tampilkan yang sudah diimpor')]),
      el('span', { class: 'sub', text: `${shown.length} dari ${all.length} DN` })
    ]);
    container.appendChild(bar);

    const tbl = el('table', { class: 'tbl' });
    const thead = el('thead');
    const hr = el('tr');
    ['', 'No. DN', 'Tgl kirim', 'Pelanggan Atena', 'Jenis', 'Item', 'Qty', 'Pelanggan kita'].forEach((t) => {
      hr.appendChild(el('th', { text: t }));
    });
    thead.appendChild(hr);
    tbl.appendChild(thead);

    const tbody = el('tbody');
    shown.forEach((dn) => {
      const tr = el('tr');

      const cbCell = el('td');
      const cb = el('input', { type: 'checkbox' });
      cb.disabled = dn.imported;
      cb.checked = st.selected.has(dn.noDn);
      cb.addEventListener('change', () => {
        if (cb.checked) st.selected.add(dn.noDn);
        else st.selected.delete(dn.noDn);
        updateButtons();
      });
      cbCell.appendChild(cb);
      tr.appendChild(cbCell);

      tr.appendChild(el('td', {}, [el('span', { class: 'mono', text: dn.noDn })]));
      tr.appendChild(el('td', { text: fmtDate(dn.tglKirim) }));
      tr.appendChild(el('td', { text: dn.customer || '—' }));
      tr.appendChild(el('td', {}, [badge(dn.jenis || '—', 'b-gray')]));
      tr.appendChild(el('td', { class: 'num', text: String(dn.itemCount) }));
      tr.appendChild(el('td', { class: 'num', text: fmt(dn.totalQty) }));

      const custCell = el('td');
      if (dn.imported) {
        custCell.appendChild(badge('sudah diimpor', 'b-amber'));
      } else {
        const opts = state.master.customers.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` }));
        const sel = select(opts, st.custMap[dn.noDn] || '', { placeholder: '— pilih pelanggan —' });
        const hint = el('div', { class: 'hint', text: '' });

        /** Tampilkan peringatan hanya bila belum dipilih. */
        const syncHint = () => {
          const picked = Boolean(sel.value);
          hint.textContent = picked
            ? (dn.unknownProducts > 0
              ? `${dn.unknownProducts} produk belum ada di master (akan dilewati)`
              : '')
            : 'Pilih pelanggan dulu';
        };

        sel.addEventListener('change', () => {
          st.custMap[dn.noDn] = sel.value;
          syncHint();
          updateButtons();
        });

        custCell.appendChild(sel);
        custCell.appendChild(hint);
        syncHint();
      }
      tr.appendChild(custCell);

      tbody.appendChild(tr);
    });
    tbl.appendChild(tbody);
    container.appendChild(tbl);
    updateButtons();
  }

  /* ---------- LANGKAH 2: CEK BARANG ---------- */
  function renderReview() {
    const chosen = selectedDns();
    bodyWrap.appendChild(callout(
      'Periksa kembali barang yang datang. Yang disimpan di sini adalah RENCANA — '
      + 'stok bertambah saat "Fisik Ada" dikonfirmasi di halaman Penerimaan.', 'amber'));

    let totalLines = 0;
    let totalQty = 0;
    let skipped = 0;

    chosen.forEach((dn) => {
      const card = el('div', { class: 'panel', style: { marginBottom: '10px' } });

      const head = el('div', { class: 'panel-head' }, [
        el('div', {}, [
          el('div', { class: 'panel-title' }, [el('span', { class: 'mono', text: dn.noDn })]),
          el('div', { class: 'panel-sub', text: `${fmtDate(dn.tglKirim)} · ${dn.customer || '—'} → `
            + (customerLabel(st.custMap[dn.noDn]) || '(pelanggan belum dipilih)') })
        ])
      ]);
      card.appendChild(head);

      const body = el('div', { class: 'panel-body' });
      body.appendChild(el('div', { class: 'field' }, [
        infoLine('No. DR', dn.noDr),
        infoLine('PO pelanggan', dn.noPo),
        infoLine('Ekspedisi', dn.ekspedisi),
        infoLine('Jatuh tempo', dn.jatuhTempo ? fmtDate(dn.jatuhTempo) : '')
      ]));

      const tbl = el('table', { class: 'tbl tbl-resp' });
      const thead = el('thead');
      const hr = el('tr');
      ['Kode', 'Produk', 'Qty', 'Satuan', 'Batch', 'ED', 'Status'].forEach((t) => {
        hr.appendChild(el('th', { text: t }));
      });
      thead.appendChild(hr);
      tbl.appendChild(thead);

      const tbody = el('tbody');
      dn.items.forEach((it) => {
        const known = Boolean(it.productId);
        if (known) {
          totalLines++;
          totalQty += Number(it.qty || 0);
        } else {
          skipped++;
        }

        const tr = el('tr');
        const kodeCell = el('td');
        kodeCell.appendChild(kodeTag(it.kode || '—'));
        tr.appendChild(kodeCell);
        tr.appendChild(el('td', { text: it.productName || it.nama || '—' }));
        tr.appendChild(el('td', { class: 'num', text: fmt(it.qty) }));
        tr.appendChild(el('td', { text: it.satuan || '—' }));

        const batchCell = el('td');
        if (it.batch) batchCell.appendChild(batchTag(it.batch));
        else batchCell.textContent = '—';
        tr.appendChild(batchCell);

        tr.appendChild(el('td', { text: it.ed ? fmtDate(it.ed) : '—' }));

        const statusCell = el('td');
        statusCell.appendChild(known
          ? badge('siap', 'b-green')
          : badge('produk belum ada', 'b-amber'));
        tr.appendChild(statusCell);

        tbody.appendChild(tr);
      });
      tbl.appendChild(tbody);
      body.appendChild(tbl);
      card.appendChild(body);
      bodyWrap.appendChild(card);
    });

    bodyWrap.appendChild(el('div', { class: 'panel' }, [
      el('div', { class: 'panel-body' }, [
        infoLine('DN dipilih', String(chosen.length)),
        infoLine('Baris akan dibuat', String(totalLines)),
        infoLine('Baris dilewati (produk belum ada)', String(skipped)),
        infoLine('Total qty', fmt(totalQty))
      ])
    ]));

    if (!totalLines) {
      bodyWrap.appendChild(callout(
        'Tidak ada baris yang bisa diimpor — semua produk DN terpilih belum ada di Master Produk.', 'amber'));
    }

    const ack = el('input', { type: 'checkbox' });
    ack.addEventListener('change', () => { st.acked = ack.checked; updateButtons(); });
    bodyWrap.appendChild(el('label', { class: 'check-inline', style: { marginTop: '10px' } }, [
      ack,
      document.createTextNode(' Barang sudah saya periksa dan sesuai dengan DN Atena')
    ]));

    st.acked = false;
    updateButtons();
  }

  /* ---------- LANGKAH 3: HASIL ---------- */
  function renderDone() {
    const res = st.result || {};
    const t = res.totals || {};

    bodyWrap.appendChild(callout(
      `${t.created || 0} Surat Jalan dibuat (${t.lines || 0} baris).`
      + (t.failed ? ` ${t.failed} DN gagal.` : '')
      + (t.skipped ? ` ${t.skipped} baris dilewati.` : ''),
      t.failed ? 'amber' : 'green'));

    if ((res.created || []).length) {
      const tbl = el('table', { class: 'tbl' });
      const thead = el('thead');
      const hr = el('tr');
      ['No. SJ (no DN)', 'Baris', 'No. DR', 'Jenis'].forEach((x) => hr.appendChild(el('th', { text: x })));
      thead.appendChild(hr);
      tbl.appendChild(thead);
      const tbody = el('tbody');
      res.created.forEach((c) => {
        const tr = el('tr');
        tr.appendChild(el('td', {}, [el('span', { class: 'mono', text: c.no })]));
        tr.appendChild(el('td', { class: 'num', text: String(c.lines) }));
        tr.appendChild(el('td', { text: c.noDr || '—' }));
        tr.appendChild(el('td', { text: c.jenis || '—' }));
        tbody.appendChild(tr);
      });
      tbl.appendChild(tbody);
      bodyWrap.appendChild(tbl);
    }

    if ((res.failed || []).length) {
      bodyWrap.appendChild(el('div', { class: 'panel-sub', text: 'DN gagal' }));
      res.failed.forEach((f) => {
        bodyWrap.appendChild(el('div', { class: 'hint', text: `${f.noDn}: ${f.message}` }));
      });
    }

    if ((res.skippedLines || []).length) {
      bodyWrap.appendChild(el('div', { class: 'panel-sub', text: 'Baris dilewati' }));
      res.skippedLines.slice(0, 30).forEach((s) => {
        bodyWrap.appendChild(el('div', { class: 'hint', text: `${s.noDn} · ${s.kode}: ${s.message}` }));
      });
      if (res.skippedLines.length > 30) {
        bodyWrap.appendChild(el('div', { class: 'hint', text: `... dan ${res.skippedLines.length - 30} baris lainnya` }));
      }
    }

    closeBtn.textContent = 'Selesai';
    updateButtons();
  }

  /* =========================================================
     AKSI
     ========================================================= */

  /** DN terpilih (objek dari server). */
  function selectedDns() {
    const all = (st.loaded && st.loaded.items) || [];
    return all.filter((dn) => st.selected.has(dn.noDn));
  }

  /** Label pelanggan kita dari id. */
  function customerLabel(id) {
    const c = state.master.customers.find((x) => String(x.id) === String(id));
    return c ? `${c.code} — ${c.name}` : '';
  }

  /** Aktif/nonaktifkan tombol sesuai langkah. */
  function updateButtons() {
    if (st.step === 'pick') {
      const chosen = selectedDns();
      const missing = chosen.filter((dn) => !st.custMap[dn.noDn]);
      nextBtn.disabled = !chosen.length || missing.length > 0;
      nextBtn.textContent = chosen.length
        ? `Lanjut: cek barang (${chosen.length})`
        : 'Lanjut: cek barang';
      if (missing.length) nextBtn.title = 'Pilih pelanggan untuk semua DN terpilih';
      else nextBtn.removeAttribute('title');
    } else if (st.step === 'review') {
      saveBtn.disabled = !st.acked;
    }
  }

  /** Simpan DN terpilih ke server. */
  async function save() {
    const chosen = selectedDns();
    if (!chosen.length) {
      toast('Tidak ada DN yang dipilih.', 'err');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Menyimpan...';

    const payload = chosen.map((dn) => ({
      noDn: dn.noDn,
      tglKirim: dn.tglKirim,
      customerId: st.custMap[dn.noDn] || dn.customerId || '',
      noDr: dn.noDr,
      noPo: dn.noPo,
      jenis: dn.jenis,
      ekspedisi: dn.ekspedisi,
      items: dn.items.map((it) => ({
        kode: it.kode,
        qty: it.qty,
        batch: it.batch,
        ed: it.ed
      }))
    }));

    try {
      const res = await atena.importDn(payload);
      st.result = res;
      st.step = 'done';
      render();

      if (res.totals.created > 0) {
        toast(`${res.totals.created} Surat Jalan dibuat dari Atena.`, res.totals.failed ? 'warn' : 'ok');
        if (onDone) await onDone();
      } else {
        toast('Tidak ada SJ yang bisa dibuat. Lihat rincian.', 'err');
      }
    } catch (err) {
      toast(err.message || 'Gagal menyimpan impor.', 'err');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Simpan ke Penerimaan';
      updateButtons();
    }
  }

  render();
}