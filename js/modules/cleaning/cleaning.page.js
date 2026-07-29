import { toast } from '../../core/ui.js';
import { photoInputHtml, wirePhotoInput } from '../../core/photo-input.js';
import {
  listBuOutlets,
  listActiveSessions,
  listActiveItems,
  getTodayDoneSessions,
  submitChecklistRun,
  todayWIB
} from './cleaning.service.js';

export async function renderCleaningPage(container, { userId, businessUnitId, outletId }) {
  container.innerHTML = `<p>Memuat daily activities...</p>`;

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
    container.innerHTML = `<h1>Daily Activities</h1><p>Belum ada outlet untukmu di BU ini.</p>`;
    return;
  }
  if (!sessions.length || !items.length) {
    container.innerHTML = `<h1>Daily Activities</h1><p style="color:var(--color-text-muted)">Admin belum mengatur ${!sessions.length ? 'sesi' : 'item'} aktivitas untuk BU ini.</p>`;
    return;
  }

  const state = { outletId: outlets.some((o) => o.id === outletId) ? outletId : outlets[0].id };

  container.innerHTML = `
    <h1>Daily Activities</h1>
    <div class="field" style="max-width:280px">
      <label>Outlet</label>
      <select id="clean-outlet">
        ${outlets.map((o) => `<option value="${o.id}"${o.id === state.outletId ? ' selected' : ''}>${escapeHtml(o.name)}</option>`).join('')}
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
        <p style="font-size:0.82rem;color:var(--color-text-muted);margin:0 0 12px">
          Centang item yang sudah beres, lalu <strong>ambil foto bukti untuk tiap item yang dicentang</strong>.
          Item yang tidak dicentang tidak perlu foto.
        </p>
        <div id="clean-items">
          ${items
            .map(
              (it) => `
            <div class="clean-item-block" data-block="${it.id}" style="border:1px solid var(--color-border,#e3e3e3);border-radius:10px;padding:10px;margin-bottom:8px">
              <label class="clean-item" style="margin:0">
                <input type="checkbox" class="clean-check" data-item="${it.id}" />
                <span>${escapeHtml(it.label)}</span>
              </label>
              <!-- Bagian foto disembunyikan sampai itemnya dicentang: menampilkan
                   10 tombol kamera sekaligus membuat form terasa mustahil dikerjakan. -->
              <div class="clean-photo-wrap" data-for="${it.id}" hidden style="margin-top:8px">
                ${photoInputHtml({
                  name: `foto-${it.id}`,
                  label: 'Foto bukti item ini',
                  facing: 'environment'
                })}
              </div>
            </div>`
            )
            .join('')}
        </div>
        <div class="field">
          <label>Catatan (opsional)</label>
          <input type="text" id="clean-notes" placeholder="mis. kran wastafel bocor" />
        </div>
        <button class="primary" id="clean-submit">Kirim Aktivitas</button>
        <p class="error-text" id="clean-error"></p>
        <p id="clean-progress" style="font-size:0.8rem;color:var(--color-text-muted);margin:6px 0 0"></p>
      </div>
    `;
    body.querySelector('#clean-back').addEventListener('click', renderSessionList);

    // Satu pembaca foto per item.
    const bacaFoto = new Map(items.map((it) => [it.id, wirePhotoInput(body, `foto-${it.id}`)]));

    body.querySelectorAll('.clean-check').forEach((c) =>
      c.addEventListener('change', () => {
        const wrap = body.querySelector(`.clean-photo-wrap[data-for="${CSS.escape(c.dataset.item)}"]`);
        if (wrap) wrap.hidden = !c.checked;
      })
    );

    body.querySelector('#clean-submit').addEventListener('click', async (e) => {
      const errorEl = body.querySelector('#clean-error');
      const progressEl = body.querySelector('#clean-progress');
      errorEl.textContent = '';

      const itemStates = [...body.querySelectorAll('.clean-check')].map((c) => ({
        item_id: c.dataset.item,
        checked: c.checked,
        file: c.checked ? bacaFoto.get(c.dataset.item)?.() ?? null : null
      }));

      const dicentang = itemStates.filter((s) => s.checked);
      if (!dicentang.length) {
        errorEl.textContent = 'Centang minimal satu item dulu.';
        return;
      }
      const tanpaFoto = dicentang.filter((s) => !s.file);
      if (tanpaFoto.length) {
        // Sebut BERAPA yang kurang dan bawa layar ke item pertamanya — daftar
        // 15 item terlalu panjang untuk dicari sendiri oleh orang yang sedang
        // berdiri sambil memegang alat pel.
        errorEl.textContent = `${tanpaFoto.length} item yang dicentang belum ada fotonya.`;
        body.querySelector(`.clean-item-block[data-block="${CSS.escape(tanpaFoto[0].item_id)}"]`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }

      e.target.disabled = true;
      try {
        await submitChecklistRun(
          {
            businessUnitId,
            outletId: state.outletId,
            sessionId: session.id,
            itemStates,
            notes: body.querySelector('#clean-notes').value
          },
          (pesan) => (progressEl.textContent = pesan)
        );
        progressEl.textContent = '';
        toast(`Aktivitas "${session.name}" terkirim. Terima kasih! ✅`, 'success');
        renderSessionList();
      } catch (error) {
        progressEl.textContent = '';
        errorEl.textContent = error.message ?? 'Gagal mengirim aktivitas.';
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
