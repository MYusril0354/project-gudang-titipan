/**
 * Handlers_User.gs — Kelola pengguna & audit log (khusus ADMIN).
 * PRD bagian 4 & 11.2.
 */

/** Daftar user tanpa pernah mengembalikan hash/salt. */
function userList_(params, ctx) {
  var rows = readTable_('users');
  var items = rows.map(function (u) {
    return {
      id: u.id,
      username: u.username,
      nama: u.nama,
      role: u.role,
      aktif: isTrue_(u.aktif),
      created_at: u.created_at,
      updated_at: u.updated_at
    };
  });
  items.sort(function (a, b) { return String(a.username).localeCompare(String(b.username)); });
  return { items: items, total: items.length };
}

/** Buat user baru. */
function userCreate_(params, ctx) {
  var username = String(assertRequired_(params.username, 'username', 'Username')).trim();
  var nama = String(params.nama || '').trim() || username;
  var role = String(assertRequired_(params.role, 'role', 'Peran')).trim().toUpperCase();
  var password = String(assertRequired_(params.password, 'password', 'Password'));

  if (!ROLES[role]) throw apiError_('VALIDATION_ERROR', 'Peran harus ADMIN, GUDANG, atau VIEWER.', 'role');
  assertPassword_(password);

  var exists = readTable_('users').filter(function (u) {
    return String(u.username).toLowerCase() === username.toLowerCase();
  });
  if (exists.length) throw apiError_('DUPLICATE', 'Username sudah dipakai.', 'username');

  var salt = makeSalt_();
  var now = nowStamp_();
  var row = {
    id: newId_(),
    username: username,
    nama: nama,
    role: role,
    password_hash: hashPassword_(password, salt),
    salt: salt,
    aktif: 'TRUE',
    failed_count: 0,
    locked_until: '',
    created_at: now,
    created_by: ctx.username,
    updated_at: now,
    updated_by: ctx.username
  };
  appendRow_('users', row);
  audit_(ctx, 'user.create', 'user', row.id, { username: username, role: role });

  return { id: row.id, username: username, nama: nama, role: role, aktif: true };
}

/** Ubah profil user (bukan password). */
function userUpdate_(params, ctx) {
  var id = assertRequired_(params.id, 'id', 'ID');
  var found = readTableWhere_('users', { id: id });
  if (!found.length) throw apiError_('NOT_FOUND', 'User tidak ditemukan.', 'id');

  var target = found[0];
  var values = params.values || {};
  var patch = {};

  if (values.nama !== undefined) patch.nama = String(values.nama || '').trim() || target.username;

  if (values.role !== undefined) {
    var role = String(values.role).trim().toUpperCase();
    if (!ROLES[role]) throw apiError_('VALIDATION_ERROR', 'Peran harus ADMIN, GUDANG, atau VIEWER.', 'role');
    patch.role = role;
  }

  if (values.aktif !== undefined) {
    if (String(target.id) === String(ctx.userId) && !isTrue_(values.aktif)) {
      throw apiError_('VALIDATION_ERROR', 'Anda tidak bisa menonaktifkan akun sendiri.', 'aktif');
    }
    patch.aktif = isTrue_(values.aktif) ? 'TRUE' : 'FALSE';
  }

  // Jangan sampai sistem kehilangan ADMIN terakhir.
  if (patch.role && patch.role !== ROLES.ADMIN && String(target.role) === ROLES.ADMIN) {
    assertNotLastAdmin_(id);
  }
  if (patch.aktif === 'FALSE' && String(target.role) === ROLES.ADMIN) {
    assertNotLastAdmin_(id);
  }

  patch.updated_at = nowStamp_();
  patch.updated_by = ctx.username;
  updateById_('users', id, patch);
  audit_(ctx, 'user.update', 'user', id, values);

  return { id: id, username: target.username, nama: patch.nama || target.nama, role: patch.role || target.role };
}

/** Reset password user. */
function userResetPassword_(params, ctx) {
  var id = assertRequired_(params.id, 'id', 'ID');
  var password = String(assertRequired_(params.password, 'password', 'Password'));
  assertPassword_(password);

  var found = readTableWhere_('users', { id: id });
  if (!found.length) throw apiError_('NOT_FOUND', 'User tidak ditemukan.', 'id');

  var salt = makeSalt_();
  updateById_('users', id, {
    salt: salt,
    password_hash: hashPassword_(password, salt),
    failed_count: 0,
    locked_until: '',
    updated_at: nowStamp_(),
    updated_by: ctx.username
  });
  audit_(ctx, 'user.resetPassword', 'user', id, { username: found[0].username });

  return { reset: true, id: id };
}

/** Daftar audit log, terbaru lebih dulu. */
function auditList_(params, ctx) {
  var rows = readTable_('audit_log');
  rows.reverse(); // urutan append = urutan waktu

  var q = String(params.q || '').trim().toLowerCase();
  if (q) {
    rows = rows.filter(function (r) {
      return ['user', 'action', 'entity', 'entity_id', 'detail'].some(function (k) {
        return String(r[k] || '').toLowerCase().indexOf(q) !== -1;
      });
    });
  }

  var page = Math.max(1, parseInt(params.page, 10) || 1);
  var pageSize = Math.min(200, Math.max(1, parseInt(params.pageSize, 10) || 50));
  var total = rows.length;
  var start = (page - 1) * pageSize;

  return {
    items: rows.slice(start, start + pageSize),
    page: page,
    pageSize: pageSize,
    total: total,
    totalPages: Math.ceil(total / pageSize) || 1
  };
}

/* =========================================================
   HELPER
   ========================================================= */

/** Minimal 6 karakter. */
function assertPassword_(password) {
  if (String(password || '').length < 6) {
    throw apiError_('VALIDATION_ERROR', 'Password minimal 6 karakter.', 'password');
  }
}

/** Pastikan bukan ADMIN aktif terakhir. */
function assertNotLastAdmin_(excludeId) {
  var admins = readTable_('users').filter(function (u) {
    return String(u.role) === ROLES.ADMIN
      && isTrue_(u.aktif)
      && String(u.id) !== String(excludeId);
  });
  if (!admins.length) {
    throw apiError_('VALIDATION_ERROR', 'Harus ada minimal satu ADMIN aktif.', 'role');
  }
}
