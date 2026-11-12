/**
 * ui.js — Helper DOM bersama (tanpa framework, tanpa innerHTML untuk data).
 *
 * Prinsip keamanan (PRD temuan #9): SEMUA teks dari server dirender lewat
 * textContent / createElement — tidak pernah disisipkan sebagai HTML.
 */

/**
 * Terapkan style. Properti kustom (--x) butuh setProperty, bukan assignment.
 */
export function applyStyle(node, style) {
  if (!style) return node;
  if (typeof style === 'string') { node.style.cssText = style; return node; }
  for (const [k, v] of Object.entries(style)) {
    if (v === null || v === undefined) continue;
    if (k.startsWith('--')) node.style.setProperty(k, String(v));
    else node.style[k] = v;
  }
  return node;
}

/** Buat elemen dengan atribut + anak. */
export function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k === 'style') applyStyle(node, v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : String(v));
    }
  }
  appendAll(node, children);
  return node;
}

/** Tambah anak (string jadi teks biasa, bukan HTML). */
export function appendAll(parent, children) {
  if (children === null || children === undefined) return parent;
  const list = Array.isArray(children) ? children : [children];
  for (const c of list) {
    if (c === null || c === undefined || c === false) continue;
    parent.appendChild(typeof c === 'string' || typeof c === 'number'
      ? document.createTextNode(String(c))
      : c);
  }
  return parent;
}

/** Tombol. */
export function btn(label, opts = {}) {
  return el('button', {
    type: 'button',
    class: 'btn' + (opts.variant ? ' btn-' + opts.variant : '') + (opts.sm ? ' btn-sm' : ''),
    text: label,
    disabled: opts.disabled || false,
    title: opts.title || null,
    onclick: opts.onClick
  });
}

/** Badge status. */
export function badge(label, cls) {
  return el('span', { class: 'badge ' + (cls || 'b-gray'), text: label });
}

/** Ikon SVG (stroke, 24x24 viewBox). */
const UI_ICONS = {
  rack: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
  tag: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1.3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M12 11v5"/>',
  warn: '<path d="M12 3l9 16H3z"/><path d="M12 9v4M12 17h.01"/>'
};

/** Buat elemen <svg> ikon. */
export function icon(name) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = UI_ICONS[name] || '';
  return s;
}

/** Teks + ikon kecil (dipakai tag rak/batch/dll). */
function icontag(cls, iconName, text) {
  return el('span', { class: cls }, [icon(iconName), document.createTextNode(text || '—')]);
}

/** Tag kode produk. */
export function kodeTag(code) {
  return el('span', { class: 'kode', text: code || '—' });
}

/** Tag rak. */
export function rakTag(code) {
  return icontag('rak', 'rack', code || '—');
}

/** Tag nomor batch. */
export function batchTag(no) {
  return icontag('batchtag', 'tag', no || '—');
}

/** Tag nomor SJ. */
export function sjTag(no) {
  return el('span', { class: 'sjtag', text: 'SJ ' + (no || '—') });
}

/** Teks kecil di bawah nilai utama. */
export function sub(text) {
  return el('div', { class: 'sub', text });
}

/** Kartu statistik. */
export function statCard(label, value, unit, foot, accent) {
  return el('div', { class: 'stat', style: { '--accent': accent || 'var(--brand)' } }, [
    el('div', { class: 'stat-label', text: label }),
    el('div', { class: 'stat-value' }, [
      document.createTextNode(String(value)),
      el('small', { text: ' ' + (unit || '') })
    ]),
    el('div', { class: 'stat-foot', text: foot || '' })
  ]);
}

/** Kotak kosong. */
export function emptyBox(title, note) {
  return el('div', { class: 'empty' }, [
    el('b', { text: title }),
    note ? document.createTextNode(note) : null
  ]);
}

/** Callout info. */
export function callout(text, variant) {
  return el('div', { class: 'callout callout-' + (variant || 'blue') }, [
    icon(variant === 'amber' ? 'warn' : 'info'),
    el('div', { text })
  ]);
}

/** Skeleton loading. */
export function skeleton(rows) {
  const box = el('div', { style: { padding: '24px' } });
  for (let i = 0; i < (rows || 5); i++) {
    box.appendChild(el('div', {
      class: 'skeleton',
      style: { width: (55 + Math.random() * 35) + '%', marginBottom: '10px' }
    }));
  }
  return box;
}

/** Kotak error. */
export function errorBox(err) {
  return el('div', {
    class: 'empty',
    style: { padding: '28px', color: 'var(--red)' },
    text: (err && err.message) || 'Gagal memuat data.'
  });
}

/** Input teks dengan debounce. */
export function searchInput(placeholder, value, onSearch, debounceMs) {
  const input = el('input', {
    class: 'input',
    type: 'search',
    placeholder: placeholder || 'Cari…',
    value: value || ''
  });
  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => onSearch(input.value), debounceMs || 300);
  });
  return input;
}

/**
 * Baris tabel. Setiap sel boleh node/teks, atau `num(...)` untuk rata kanan.
 */
export function tr(cells) {
  const row = el('tr');
  for (const c of cells || []) {
    const isNum = Boolean(c && c.__num);
    const td = el('td', { class: isNum ? 'num' : null });
    appendAll(td, isNum ? c.content : c);
    row.appendChild(td);
  }
  return row;
}

/** Sel tabel dengan perataan angka. */
export function num(content) {
  return { __num: true, content };
}

/**
 * Tabel generik.
 * @param {Array<{label:string, cls?:string}>} columns
 * @param {HTMLElement[]} rows
 */
export function table(columns, rows) {
  const hr = el('tr');
  for (const c of columns || []) {
    hr.appendChild(el('th', { class: c.cls || null, text: c.label }));
  }
  const tbody = el('tbody');
  for (const r of rows || []) tbody.appendChild(r);
  return el('table', { class: 'tbl' }, [el('thead', {}, [hr]), tbody]);
}

/** Toast global (dipasang di main.js). */
export function toast(message, type) {
  if (typeof window.toast === 'function') window.toast(message, type);
}

/** Progress bar mini (persentase). */
export function progressBar(current, total) {
  const pct = total > 0 ? Math.min(100, Math.max(0, Math.round((current / total) * 100))) : 0;
  const bar = el('div', { class: 'progress' });
  bar.appendChild(el('div', { style: { width: pct + '%' } }));
  return bar;
}

/** Dialog konfirmasi (pengganti window.confirm). */
export function confirmDialog(opts) {
  const dlg = modal({
    title: opts.title || 'Konfirmasi',
    sub: opts.message || '',
    footer: [
      btn('Batal', { onClick: () => dlg.close() }),
      btn(opts.confirmText || 'OK', {
        variant: opts.danger ? 'danger' : 'primary',
        onClick: () => {
          dlg.close();
          if (typeof opts.onConfirm === 'function') opts.onConfirm();
        }
      })
    ]
  });
  return dlg;
}

/** Modal generik. Mengembalikan { close }. */
export function modal(opts) {
  const root = document.getElementById('modalRoot');
  const backdrop = el('div', { class: 'modal-backdrop' });
  const card = el('div', { class: 'modal' });

  const close = () => { root.innerHTML = ''; };
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

  const head = el('div', { class: 'modal-head' }, [
    el('div', {}, [
      el('h3', { text: opts.title || '' }),
      opts.sub ? el('p', { text: opts.sub }) : null
    ]),
    el('button', {
      class: 'x', type: 'button', 'aria-label': 'Tutup', text: '×', onclick: close
    })
  ]);

  const body = el('div', { class: 'modal-body' });
  appendAll(body, opts.body);

  const footer = el('div', { class: 'modal-foot' });

  card.append(head, body, footer);
  if (opts.footer) appendAll(footer, opts.footer);
  backdrop.appendChild(card);

  root.innerHTML = '';
  root.appendChild(backdrop);
  return { close, body, footer, card };
}

/** Field form: label + kontrol + hint. */
export function field(labelText, control, hint, required) {
  const wrap = el('div', { class: 'field' });
  wrap.appendChild(el('label', { text: labelText + (required ? ' *' : '') }));
  wrap.appendChild(control);
  if (hint) wrap.appendChild(el('div', { class: 'hint', text: hint }));
  return wrap;
}

/** Select dari daftar {value,label} atau string. */
export function select(options, value, opts = {}) {
  const sel = el('select', { class: opts.class || null });
  if (opts.placeholder) {
    sel.appendChild(el('option', { value: '', text: opts.placeholder }));
  }
  for (const o of options || []) {
    const isObj = o !== null && typeof o === 'object';
    const opt = el('option', {
      value: isObj ? o.value : o,
      text: isObj ? o.label : String(o)
    });
    if (isObj && o.disabled) opt.disabled = true;
    if (String(opt.value) === String(value)) opt.selected = true;
    sel.appendChild(opt);
  }
  return sel;
}

/** Grid dua kolom. */
export function grid2(children) {
  return el('div', { class: 'grid2' }, children);
}

/** Kotak info ringkas (label/nilai) untuk modal konfirmasi. */
export function infobox(entries) {
  const box = el('div', { class: 'infobox' });
  for (const [k, v] of entries) {
    box.appendChild(el('div', {}, [
      el('span', { class: 'k', text: k }),
      el('b', { text: String(v) })
    ]));
  }
  return box;
}

/** Panel dengan judul + aksi. */
export function panel(opts) {
  const head = el('div', { class: 'panel-head' }, [
    el('div', {}, [
      el('div', { class: 'panel-title', text: opts.title || '' }),
      opts.sub ? el('div', { class: 'panel-sub', text: opts.sub }) : null
    ])
  ]);
  if (opts.actions) {
    const wrap = el('div', { class: 'panel-actions' });
    appendAll(wrap, opts.actions);
    head.appendChild(wrap);
  }
  const node = el('div', { class: 'panel' }, [head]);
  if (opts.body) {
    const body = el('div', { class: 'panel-body' });
    appendAll(body, opts.body);
    node.appendChild(body);
  }
  return node;
}
