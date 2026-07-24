import { toast } from '../../core/ui.js';
import {
  listBuOutlets,
  listActiveSessions,
  listActiveItems,
  getTodayDoneSessions,
  submitChecklistRun,
  todayWIB
} from './cleaning.service.js';

export async function renderCleaningPage(container, { userId, businessUnitId, outletId }) {
  container.innerHTML = `<p>Memuat ceklis kebersihan...</p>`;

  let outlets, sessions, items;
  try {
    [outlets, sessions, items] = await Promise.all([
      listBuOutlets(businessUnitId),
      listActiveSessions(businessUnitId),
      listActiveItems(businessUnitId)
    ]);
  } catch (error) {
    container.innerHTML = `<p class="error-text">Gagal memuat: ${error.message ?? error}</p>`;
    return;
  }

  if (!outlets.length) {
    container.innerHTML = `<h1>Ceklis Kebersihan</h1><p>Belum ada outlet untukmu di BU ini.</p>`;
    return;
  }
  if (!sessions.length || !items.length) {
    container.innerHTML = `<h1>Ceklis Kebersihan</h1><p style="color:var(--color-text-muted)">Admin belum mengatur ${!sessions.length ? 'sesi' : 'item'} ceklis untuk BU ini.</p>`;
    return;
  }

  const state = { outletId: outlets.some((o) => o.id === outletId) ? outletId : outlets[0].id };

  container.innerHTML = `
    <h1>Ceklis Kebersihan</h1>
    <div class="field" style="max-width:280px">
      <label>Outlet</label>
      <select id="clean-outlet">
        ${outlets.map((o) => `<option value="${o.id}"${o.id === state.outletId ? ' selected' : ''}>${o.name}</option>`).join('')}
      </select>
    </div>
    <p style="color:var(--color-text-muted);font-size:0.85rem">Sesi hari ini — ${fmtDate(todayWIB())}</p>
    <div id="clean-body"></div>
  `;

  const body = container.querySelector('#clean-body');
  const outletSelect = container.querySelector('#clean-outlet');
  outletSelect.addEventListener('change', () => {
    state.outletId = outletSelect.value;
    renderSessionList();
  });

  async function renderSessionList() {
    body.innerHTML = `<p>Memuat...</p>`;
    let done;
    try {
      done = await getTodayDoneSessions(state.outletId);
    } catch (error) {
      body.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
      return;
    }
    body.innerHTML = `
      <div class="card-grid" style="margin-top:8px">
        ${sessions
          .map((s) => {
            const isDone = done.has(s.id);
            return `
            <button class="module-card ${isDone ? 'session-done' : ''}" data-session="${s.id}" ${isDone ? 'disabled' : ''}>
              <span class="module-card-icon">${isDone ? '✅' : '🧹'}</span>
              <span class="module-card-label">${escapeHtml(s.name)}</span>
              <span style="font-size:0.72rem;color:var(--color-text-muted)">${isDone ? 'Selesai' : 'Belum'}</span>
            </button>`;
          })
          .join('')}
      </div>
    `;
    body.querySelectorAll('[data-session]').forEach((btn) => {
      btn.addEventListener('click', () => renderRunForm(sessions.find((s) => s.id === btn.dataset.session)));
    });
  }

  function renderRunForm(session) {
    body.innerHTML = `
      <div class="inline-card" style="max-width:520px">
        <button class="btn-home" id="clean-back">← Kembali</button>
        <h3 style="margin:12px 0 4px">${escapeHtml(session.name)}</h3>
        <p style="font-size:0.82rem;color:var(--color-text-muted);margin:0 0 12px">Centang item yang sudah beres, ambil 1 foto bukti kondisi akhir, lalu kirim.</p>
        <div id="clean-items">
          ${items
            .map(
              (it) => `
            <label class="clean-item">
              <input type="checkbox" class="clean-check" data-item="${it.id}" />
              <span>${escapeHtml(it.label)}</span>
            </label>`
            )
            .join('')}
        </div>
        <div class="field" style="margin-top:12px">
          <label>Foto bukti (wajib)</label>
          <input type="file" accept="image/*" capture="environment" id="clean-photo" />
        </div>
        <div class="field">
          <label>Catatan (opsional)</label>
          <input type="text" id="clean-notes" placeholder="mis. kran wastafel bocor" />
        </div>
        <button class="primary" id="clean-submit">Kirim Ceklis</button>
        <p class="error-text" id="clean-error"></p>
      </div>
    `;
    body.querySelector('#clean-back').addEventListener('click', renderSessionList);
    body.querySelector('#clean-submit').addEventListener('click', async (e) => {
      const errorEl = body.querySelector('#clean-error');
      errorEl.textContent = '';
      const file = body.querySelector('#clean-photo').files[0];
      if (!file) {
        errorEl.textContent = 'Foto bukti wajib diisi.';
        return;
      }
      const itemStates = [...body.querySelectorAll('.clean-check')].map((c) => ({ item_id: c.dataset.item, checked: c.checked }));
      e.target.disabled = true;
      try {
        await submitChecklistRun({
          businessUnitId,
          outletId: state.outletId,
          sessionId: session.id,
          itemStates,
          notes: body.querySelector('#clean-notes').value,
          file
        });
        toast(`Ceklis "${session.name}" terkirim. Terima kasih! 🧹`, 'success');
        renderSessionList();
      } catch (error) {
        errorEl.textContent = error.message ?? 'Gagal mengirim ceklis.';
        e.target.disabled = false;
      }
    });
  }

  renderSessionList();
}

function fmtDate(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' });
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
