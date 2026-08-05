// =========================================================
// UI helpers bersama: toast (pop up notifikasi) + modal
// (konfirmasi & form dengan dropdown). Dipakai Staff App & Admin Portal
// supaya gaya notifikasi/pop up konsisten di seluruh aplikasi.
// =========================================================

import { formatThousands, parseNumber, attachThousandsInput } from './format.js';
import { photoInputHtml, wirePhotoInput } from './photo-input.js';

// ---- Toast / pop up notifikasi ----

function ensureToastRoot() {
  let root = document.getElementById('toast-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'toast-root';
    root.className = 'toast-root';
    document.body.appendChild(root);
  }
  return root;
}

const TOAST_ICON = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };

/** Tampilkan pop up notifikasi singkat di pojok layar. */
export function toast(message, type = 'success', timeout = 3400) {
  const root = ensureToastRoot();
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span class="toast-icon">${TOAST_ICON[type] ?? 'ℹ'}</span><span class="toast-msg"></span>`;
  el.querySelector('.toast-msg').textContent = message;
  root.appendChild(el);
  // trigger animasi masuk
  requestAnimationFrame(() => el.classList.add('show'));
  const remove = () => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 220);
  };
  const timer = setTimeout(remove, timeout);
  el.addEventListener('click', () => {
    clearTimeout(timer);
    remove();
  });
  return remove;
}

// ---- Modal dasar ----

function buildOverlay() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  return overlay;
}

/**
 * Modal konfirmasi. Return Promise<boolean> — true kalau user klik tombol utama.
 */
export function confirmDialog({
  title = 'Konfirmasi',
  message = '',
  confirmText = 'Ya',
  cancelText = 'Batal',
  danger = false
} = {}) {
  return new Promise((resolve) => {
    const overlay = buildOverlay();
    overlay.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true">
        <h3 class="modal-title">${escapeHtml(title)}</h3>
        <p class="modal-text"></p>
        <div class="modal-actions">
          <button type="button" class="btn-ghost" data-act="cancel">${escapeHtml(cancelText)}</button>
          <button type="button" class="${danger ? 'btn-danger' : 'primary'} btn-inline" data-act="ok">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `;
    overlay.querySelector('.modal-text').textContent = message;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));

    const close = (result) => {
      overlay.classList.remove('show');
      setTimeout(() => overlay.remove(), 200);
      resolve(result);
    };
    overlay.querySelector('[data-act="ok"]').addEventListener('click', () => close(true));
    overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => close(false));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(false);
    });
  });
}

/**
 * Modal berisi form. `fields` = array field:
 *   { name, label, type, value, options, required, placeholder, min, minlength, accept, help }
 *   type: text | password | email | tel | number | color | select | file | checkbox
 * `onReady(form, helpers)` opsional buat wiring dropdown bergantung (mis. outlet ikut BU).
 *
 * Return Promise<Object|null> — object nilai field kalau disimpan, null kalau dibatalkan.
 * Untuk field file, nilainya berupa objek File (atau null).
 */
export function formDialog({
  title = 'Form',
  description = '',
  fields = [],
  submitText = 'Simpan',
  cancelText = 'Batal',
  onReady
} = {}) {
  return new Promise((resolve) => {
    const overlay = buildOverlay();
    overlay.innerHTML = `
      <div class="modal-card modal-form" role="dialog" aria-modal="true">
        <h3 class="modal-title">${escapeHtml(title)}</h3>
        ${description ? `<p class="modal-text">${escapeHtml(description)}</p>` : ''}
        <form class="modal-body"></form>
        <p class="error-text modal-error" style="min-height:0"></p>
        <div class="modal-actions">
          <button type="button" class="btn-ghost" data-act="cancel">${escapeHtml(cancelText)}</button>
          <button type="submit" class="primary btn-inline" data-act="ok">${escapeHtml(submitText)}</button>
        </div>
      </div>
    `;
    const form = overlay.querySelector('.modal-body');
    form.innerHTML = fields.map(fieldHtml).join('');
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));

    // Auto-format ribuan untuk field 'money' & 'qty'.
    fields.filter((f) => f.type === 'money' || f.type === 'qty').forEach((f) => attachThousandsInput(form.elements[f.name]));

    // Aktifkan search-select fuzzy. `f.onChange` dipakai untuk field bertingkat
    // (mis. Merk -> Tipe): opsi field turunan cukup di-mutate di tempat
    // (`opts.length = 0; opts.push(...)`) karena wireSearchSelect membaca array
    // yang sama setiap kali daftar digambar.
    fields
      .filter((f) => f.type === 'searchselect')
      .forEach((f) => wireSearchSelect(form.querySelector(`.search-select[data-name="${f.name}"]`), f.options ?? [], f.onChange));

    // Field foto: dua tombol (Kamera diutamakan, lalu Galeri). Pembaca file-nya
    // disimpan supaya submit() bisa mengambil hasilnya — tidak bisa lewat
    // form.elements karena ada DUA input untuk satu nama field.
    const bacaFoto = new Map();
    fields.filter((f) => f.type === 'photo').forEach((f) => bacaFoto.set(f.name, wirePhotoInput(form, f.name)));

    const errorEl = overlay.querySelector('.modal-error');
    const close = (result) => {
      overlay.classList.remove('show');
      setTimeout(() => overlay.remove(), 200);
      resolve(result);
    };

    const submit = () => {
      const values = {};
      for (const f of fields) {
        // Field foto punya dua input (kamera + galeri) dengan satu nama logis,
        // jadi form.elements tidak bisa dipakai — dibaca lewat pembacanya sendiri.
        if (f.type === 'photo') {
          values[f.name] = bacaFoto.get(f.name)?.() ?? null;
          if (f.required && !values[f.name]) {
            errorEl.textContent = `"${f.label}" wajib diisi.`;
            return;
          }
          continue;
        }
        const input = form.elements[f.name];
        if (!input) continue;
        let rawEmpty = false;
        if (f.type === 'file') {
          values[f.name] = input.files[0] ?? null;
          rawEmpty = !values[f.name];
        } else if (f.type === 'checkbox') {
          values[f.name] = input.checked;
        } else if (f.type === 'money' || f.type === 'qty') {
          rawEmpty = String(input.value).trim() === '';
          values[f.name] = parseNumber(input.value);
        } else {
          values[f.name] = typeof input.value === 'string' ? input.value.trim() : input.value;
          rawEmpty = values[f.name] === '' || values[f.name] == null;
        }
        if (f.required && rawEmpty) {
          errorEl.textContent = `"${f.label}" wajib diisi.`;
          input.focus();
          return;
        }
        if (f.minlength && typeof values[f.name] === 'string' && values[f.name].length > 0 && values[f.name].length < f.minlength) {
          errorEl.textContent = `"${f.label}" minimal ${f.minlength} karakter.`;
          input.focus();
          return;
        }
      }
      close(values);
    };

    overlay.querySelector('[data-act="ok"]').addEventListener('click', (e) => {
      e.preventDefault();
      submit();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      submit();
    });
    overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => close(null));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
    });

    if (typeof onReady === 'function') {
      onReady(form, { close, setError: (m) => (errorEl.textContent = m || '') });
    }
  });
}

/** Modal info sederhana (judul + isi HTML tepercaya + tombol Tutup). */
export function infoDialog({ title = 'Detail', bodyHtml = '' } = {}) {
  return new Promise((resolve) => {
    const overlay = buildOverlay();
    overlay.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true">
        <h3 class="modal-title">${escapeHtml(title)}</h3>
        <div class="modal-info-body">${bodyHtml}</div>
        <div class="modal-actions">
          <button type="button" class="primary btn-inline" data-act="close">Tutup</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));
    const close = () => {
      overlay.classList.remove('show');
      setTimeout(() => overlay.remove(), 200);
      resolve();
    };
    overlay.querySelector('[data-act="close"]').addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
  });
}

/**
 * Dialog "Bagikan" tanpa API: teks bisa diedit, lalu dibagikan lewat share
 * sheet native (navigator.share), WhatsApp (wa.me), atau disalin. Untuk kirim
 * manual ke staff/PIC via chat.
 */
/**
 * Dialog bagikan teks. `phone` opsional: kalau diisi, tombol WhatsApp membuka
 * chat ke nomor itu langsung (wa.me/<nomor>) — dipakai modul Reservasi untuk
 * mengirim konfirmasi ke customer tanpa WhatsApp API.
 */
export function shareDialog({ title = 'Bagikan', helper = '', defaultMessage = '', phone = '', email = '', subject = '' } = {}) {
  return new Promise((resolve) => {
    const overlay = buildOverlay();
    const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
    overlay.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true">
        <h3 class="modal-title">${escapeHtml(title)}</h3>
        ${helper ? `<p class="modal-text">${escapeHtml(helper)}</p>` : ''}
        ${
          phone
            ? `<p class="modal-text" style="margin-top:-6px">Tombol WhatsApp akan membuka chat ke
                 <strong style="font-family:ui-monospace,Menlo,monospace">+${escapeHtml(String(phone).replace(/\D/g, ''))}</strong>.</p>`
            : ''
        }
        ${
          email
            ? `<p class="modal-text" style="margin-top:-6px">Tombol Email akan membuka aplikasi email dengan tujuan
                 <strong style="font-family:ui-monospace,Menlo,monospace">${escapeHtml(email)}</strong> sudah terisi.</p>`
            : ''
        }
        <div class="field">
          <label for="share-text">Pesan (bisa diedit)</label>
          <textarea id="share-text" rows="4" class="share-textarea"></textarea>
        </div>
        <div class="modal-actions" style="flex-wrap:wrap">
          <button type="button" class="btn-ghost" data-act="close">Tutup</button>
          <button type="button" class="btn-ghost" data-act="copy">Salin</button>
          <button type="button" class="btn-inline btn-whatsapp" data-act="wa">${phone ? 'Kirim ke Customer' : 'WhatsApp'}</button>
          ${email ? `<button type="button" class="btn-inline" data-act="email">✉️ Email</button>` : ''}
          ${canShare ? `<button type="button" class="primary btn-inline" data-act="share">Bagikan…</button>` : ''}
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const ta = overlay.querySelector('#share-text');
    ta.value = defaultMessage;
    requestAnimationFrame(() => overlay.classList.add('show'));

    const close = () => {
      overlay.classList.remove('show');
      setTimeout(() => overlay.remove(), 200);
      resolve();
    };
    overlay.querySelector('[data-act="close"]').addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    overlay.querySelector('[data-act="copy"]').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(ta.value);
        toast('Teks disalin.', 'success');
      } catch {
        toast('Gagal menyalin teks.', 'error');
      }
    });
    overlay.querySelector('[data-act="wa"]').addEventListener('click', () => {
      const tujuan = String(phone ?? '').replace(/\D/g, '');
      window.open(`https://wa.me/${tujuan}?text=` + encodeURIComponent(ta.value), '_blank');
    });
    // Email: mailto: dengan tujuan SUDAH TERISI dari form, bukan share sheet
    // kosong yang memaksa admin mengetik ulang alamatnya. Tanpa ini, alamat
    // email yang sudah susah payah diminta di formulir jadi tidak pernah dipakai.
    //
    // Isi pesannya diambil dari textarea saat diklik (bukan `defaultMessage`),
    // supaya suntingan admin ikut terkirim.
    overlay.querySelector('[data-act="email"]')?.addEventListener('click', () => {
      const url =
        `mailto:${encodeURIComponent(email)}` +
        `?subject=${encodeURIComponent(subject || title)}` +
        `&body=${encodeURIComponent(ta.value)}`;
      // location.href, BUKAN window.open: sebagian browser memblokir popup ke
      // skema non-http, dan yang muncul cuma tab kosong tanpa pesan apa pun.
      window.location.href = url;
    });

    overlay.querySelector('[data-act="share"]')?.addEventListener('click', async () => {
      try {
        await navigator.share({ text: ta.value });
        close();
      } catch {
        // user membatalkan share sheet -> biarkan dialog tetap terbuka
      }
    });
  });
}

// ---- Search-select (dropdown dengan pencarian fuzzy) ----

export function fuzzyMatch(query, text) {
  const q = String(query ?? '').toLowerCase().trim();
  const t = String(text ?? '').toLowerCase();
  if (!q) return true;
  if (t.includes(q)) return true;
  let i = 0;
  for (const ch of t) {
    if (ch === q[i]) i++;
    if (i >= q.length) return true;
  }
  return false;
}

export function renderSearchSelect({ name, options, value = '', placeholder = 'Ketik untuk cari…', allowCreate = false }) {
  const selected = options.find((o) => String(o.value) === String(value ?? ''));
  // Untuk field bebas (allowCreate), nilai yang belum ada di daftar tetap ditampilkan.
  const shownLabel = selected?.label ?? (allowCreate ? value ?? '' : '');
  return `
    <div class="search-select" data-name="${escapeAttr(name)}"${allowCreate ? ' data-allow-create="1"' : ''}>
      <input type="hidden" name="${escapeAttr(name)}" value="${escapeAttr(value ?? '')}" />
      <input type="text" class="ss-input" autocomplete="off" placeholder="${escapeAttr(placeholder)}" value="${escapeAttr(shownLabel)}" />
      <ul class="ss-list" hidden></ul>
    </div>`;
}

export function wireSearchSelect(widget, options, onChange) {
  if (!widget) return;
  const hidden = widget.querySelector('input[type="hidden"]');
  const input = widget.querySelector('.ss-input');
  const list = widget.querySelector('.ss-list');
  const allowCreate = widget.dataset.allowCreate === '1';
  const labelFor = (val) => options.find((o) => String(o.value) === String(val))?.label ?? (allowCreate ? val : '');

  const draw = (filtered) => {
    const typed = input.value.trim();
    const exact = options.some((o) => String(o.label).toLowerCase() === typed.toLowerCase());
    const createItem =
      allowCreate && typed && !exact
        ? `<li data-val="${escapeAttr(typed)}" class="ss-create">+ Tambah “${escapeHtml(typed)}”</li>`
        : '';
    list.innerHTML =
      createItem +
        filtered.slice(0, 60).map((o) => `<li data-val="${escapeAttr(o.value)}">${escapeHtml(o.label)}</li>`).join('') ||
      (createItem || '<li class="ss-empty">Tidak ada hasil</li>');
    list.hidden = false;
  };

  input.addEventListener('focus', () => draw(options));
  input.addEventListener('input', () => {
    hidden.value = allowCreate ? input.value.trim() : '';
    draw(options.filter((o) => fuzzyMatch(input.value, o.label)));
  });
  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li[data-val]');
    if (!li) return;
    hidden.value = li.dataset.val;
    input.value = labelFor(li.dataset.val) || li.dataset.val;
    list.hidden = true;
    onChange?.(hidden.value);
  });
  input.addEventListener('blur', () => {
    setTimeout(() => {
      list.hidden = true;
      if (allowCreate) {
        hidden.value = input.value.trim();
      } else {
        input.value = hidden.value ? labelFor(hidden.value) : '';
      }
    }, 150);
  });
}

/** Aktifkan semua .search-select di dalam container dengan satu set opsi yang sama. */
export function activateSearchSelects(container, options, onChange) {
  container.querySelectorAll('.search-select').forEach((w) => wireSearchSelect(w, options, onChange));
}

function fieldHtml(f) {
  const id = `f-${f.name}`;
  const req = f.required ? 'required' : '';
  const help = f.help ? `<span class="field-help">${escapeHtml(f.help)}</span>` : '';

  if (f.type === 'photo') {
    return photoInputHtml({
      name: f.name,
      label: f.label,
      help: f.help,
      facing: f.facing ?? 'environment',
      currentUrl: f.currentUrl ?? ''
    });
  }

  if (f.type === 'select') {
    const opts = (f.options ?? [])
      .map((o) => `<option value="${escapeAttr(o.value)}"${String(o.value) === String(f.value ?? '') ? ' selected' : ''}>${escapeHtml(o.label)}</option>`)
      .join('');
    return `
      <div class="field">
        <label for="${id}">${escapeHtml(f.label)}</label>
        <select id="${id}" name="${escapeAttr(f.name)}" ${req}>${opts}</select>
        ${help}
      </div>`;
  }

  if (f.type === 'checkbox') {
    return `
      <div class="field field-check">
        <input type="checkbox" id="${id}" name="${escapeAttr(f.name)}" ${f.value ? 'checked' : ''} />
        <label for="${id}" style="margin:0">${escapeHtml(f.label)}</label>
        ${help}
      </div>`;
  }

  if (f.type === 'searchselect') {
    return `
      <div class="field">
        <label for="${id}">${escapeHtml(f.label)}</label>
        ${renderSearchSelect({ name: f.name, options: f.options ?? [], value: f.value, placeholder: f.placeholder, allowCreate: f.allowCreate })}
        ${help}
      </div>`;
  }

  if (f.type === 'textarea') {
    return `
      <div class="field">
        <label for="${id}">${escapeHtml(f.label)}</label>
        <textarea id="${id}" name="${escapeAttr(f.name)}" rows="${f.rows ?? 6}" ${req}
          placeholder="${escapeAttr(f.placeholder ?? '')}"
          style="width:100%;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:0.8rem">${escapeHtml(f.value ?? '')}</textarea>
        ${help}
      </div>`;
  }

  if (f.type === 'money') {
    return `
      <div class="field">
        <label for="${id}">${escapeHtml(f.label)}</label>
        <div class="money-wrap">
          <span class="money-prefix">Rp</span>
          <input type="text" inputmode="numeric" id="${id}" name="${escapeAttr(f.name)}"
            value="${escapeAttr(formatThousands(f.value ?? ''))}" ${f.required ? 'required' : ''}
            ${f.placeholder ? `placeholder="${escapeAttr(f.placeholder)}"` : ''} />
        </div>
        ${help}
      </div>`;
  }

  if (f.type === 'qty') {
    return `
      <div class="field">
        <label for="${id}">${escapeHtml(f.label)}</label>
        <input type="text" inputmode="numeric" id="${id}" name="${escapeAttr(f.name)}" class="qty-input"
          value="${escapeAttr(formatThousands(f.value ?? ''))}" ${f.required ? 'required' : ''}
          ${f.placeholder ? `placeholder="${escapeAttr(f.placeholder)}"` : ''} />
        ${help}
      </div>`;
  }

  const extra = [
    f.placeholder ? `placeholder="${escapeAttr(f.placeholder)}"` : '',
    f.min != null ? `min="${escapeAttr(f.min)}"` : '',
    // `max` hanya mengatur tombol naik/turun & keyboard angka di HP — ia TIDAK
    // menghalangi orang mengetik angka lebih besar, karena formDialog memakai
    // validasinya sendiri, bukan validasi bawaan browser. Pemanggil tetap wajib
    // membatasi nilainya sendiri.
    f.max != null ? `max="${escapeAttr(f.max)}"` : '',
    f.minlength ? `minlength="${escapeAttr(f.minlength)}"` : '',
    f.accept ? `accept="${escapeAttr(f.accept)}"` : ''
  ].join(' ');

  return `
    <div class="field">
      <label for="${id}">${escapeHtml(f.label)}</label>
      <input type="${escapeAttr(f.type ?? 'text')}" id="${id}" name="${escapeAttr(f.name)}"
        value="${f.type === 'file' ? '' : escapeAttr(f.value ?? '')}" ${req} ${extra} />
      ${help}
    </div>`;
}

/**
 * Escape teks sebelum masuk HTML. Diekspor supaya modul yang belum punya
 * helper sendiri tidak perlu menyalin ulang — nama outlet/BU yang mengandung
 * kutip atau < akan merusak markup kalau tidak di-escape.
 */
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s);
}
