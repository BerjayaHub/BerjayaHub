// =========================================================
// UI helpers bersama: toast (pop up notifikasi) + modal
// (konfirmasi & form dengan dropdown). Dipakai Staff App & Admin Portal
// supaya gaya notifikasi/pop up konsisten di seluruh aplikasi.
// =========================================================

import { formatThousands, parseNumber, attachThousandsInput } from './format.js';

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

    // Auto-format ribuan untuk field 'money'.
    fields.filter((f) => f.type === 'money').forEach((f) => attachThousandsInput(form.elements[f.name]));

    const errorEl = overlay.querySelector('.modal-error');
    const close = (result) => {
      overlay.classList.remove('show');
      setTimeout(() => overlay.remove(), 200);
      resolve(result);
    };

    const submit = () => {
      const values = {};
      for (const f of fields) {
        const input = form.elements[f.name];
        if (!input) continue;
        let rawEmpty = false;
        if (f.type === 'file') {
          values[f.name] = input.files[0] ?? null;
          rawEmpty = !values[f.name];
        } else if (f.type === 'checkbox') {
          values[f.name] = input.checked;
        } else if (f.type === 'money') {
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

/**
 * Dialog "Bagikan" tanpa API: teks bisa diedit, lalu dibagikan lewat share
 * sheet native (navigator.share), WhatsApp (wa.me), atau disalin. Untuk kirim
 * manual ke staff/PIC via chat.
 */
export function shareDialog({ title = 'Bagikan', helper = '', defaultMessage = '' } = {}) {
  return new Promise((resolve) => {
    const overlay = buildOverlay();
    const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
    overlay.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true">
        <h3 class="modal-title">${escapeHtml(title)}</h3>
        ${helper ? `<p class="modal-text">${escapeHtml(helper)}</p>` : ''}
        <div class="field">
          <label for="share-text">Pesan (bisa diedit)</label>
          <textarea id="share-text" rows="4" class="share-textarea"></textarea>
        </div>
        <div class="modal-actions" style="flex-wrap:wrap">
          <button type="button" class="btn-ghost" data-act="close">Tutup</button>
          <button type="button" class="btn-ghost" data-act="copy">Salin</button>
          <button type="button" class="btn-inline btn-whatsapp" data-act="wa">WhatsApp</button>
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
      window.open('https://wa.me/?text=' + encodeURIComponent(ta.value), '_blank');
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

function fieldHtml(f) {
  const id = `f-${f.name}`;
  const req = f.required ? 'required' : '';
  const help = f.help ? `<span class="field-help">${escapeHtml(f.help)}</span>` : '';

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

  const extra = [
    f.placeholder ? `placeholder="${escapeAttr(f.placeholder)}"` : '',
    f.min != null ? `min="${escapeAttr(f.min)}"` : '',
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

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s);
}
