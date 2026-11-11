/**
 * Handlers_SJ.gs — Surat Jalan & penerimaan fisik.
 * Cakupan: sj.list, sj.get, sj.nextNumber, sj.create,
 *          sj.line.suggestBatch, sj.line.receive, sj.line.wait, sj.line.cancel,
 *          pending.list.
 * Implementasi lengkap masuk Fase 2.
 */

/** Daftar SJ + baris + status turunan. Filter: q, status, customer. */
function sjList_(params, ctx) {
  return { items: [], page: 1, pageSize: 50, total: 0 };
}

/** Detail satu SJ. */
function sjGet_(params, ctx) {
  throw apiError_('NOT_FOUND', 'sj.get belum diimplementasikan (Fase 2).');
}

/** Saran nomor SJ berikutnya: SJ/{tahun}/{urut 4 digit} (PRD 6.2). */
function sjNextNumber_(params, ctx) {
  var year = todayStr_().slice(0, 4);
  var n = nextCounter_('SJ-' + year);
  return { no: formatSeq_('SJ/' + year + '/', n, 4) };
}

/** Buat SJ + baris (PRD 6.2). */
function sjCreate_(params, ctx) {
  throw apiError_('INTERNAL', 'sj.create belum diimplementasikan (Fase 2).');
}

/** Saran No. Batch: BN-{YYYYMMDD}-{urut 3 digit} (PRD 6.3). */
function sjLineSuggestBatch_(params, ctx) {
  var date = assertDate_(params.date || todayStr_(), 'date');
  var n = nextCounter_('BATCH-' + date.replace(/-/g, ''));
  return { batchNumber: formatSeq_('BN-' + date.replace(/-/g, '') + '-', n, 3) };
}

/** Fisik Ada -> receipt + batch + mutasi CONSIGN_IN (PRD 6.3). */
function sjLineReceive_(params, ctx) {
  throw apiError_('INTERNAL', 'sj.line.receive belum diimplementasikan (Fase 2).');
}

/** Fisik Belum Ada: simpan alasan, ETA, PIC. Stok tidak berubah (PRD 6.4). */
function sjLineWait_(params, ctx) {
  throw apiError_('INTERNAL', 'sj.line.wait belum diimplementasikan (Fase 2).');
}

/** Batalkan sisa: qty_cancelled += pending, decision = DONE (PRD 6.5). */
function sjLineCancel_(params, ctx) {
  throw apiError_('INTERNAL', 'sj.line.cancel belum diimplementasikan (Fase 2).');
}

/** Antrean pending + bucket umur 0–7 dan >30 hari. */
function pendingList_(params, ctx) {
  return { items: [], buckets: { d0_7: 0, d8_30: 0, gt30: 0 } };
}
