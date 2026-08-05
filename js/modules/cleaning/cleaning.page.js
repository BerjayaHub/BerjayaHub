import { toast, infoDialog } from '../../core/ui.js';
import { photoInputHtml, wirePhotoInput } from '../../core/photo-input.js';
import {
  listBuOutlets,
  listActiveSessions,
  listActiveItems,
  listSessionRuns,
  getRunItems,
  getChecklistPhotoUrl,
  getChecklistPhotoUrls,
  submitChecklistRun,
  todayWIB
} from './cleaning.service.js';
import { loadingHtml } from '../../core/loading.js';

export async function renderCleaningPage(container, { userId, businessUnitId, outletId }) {
  container.innerHTML = loadingHtml('Memuat daily activities…');

  let outlets;
  try {
    outlets = await listBuOutlets(businessUnitId);
  } catch (error) {
    container.innerHTML = `<p class="error-text">Gagal memuat: ${error.message ?? error}</p>`;
    return;
  }

  if (!outlets.length) {
    container.innerHTML = `<h1>Daily Activities</h1><p>Belum ada outlet untukmu di BU ini.</p>`;
    return;
  }

  const state = {
    outletId: outlets.some((o) => o.id === outletId) ? outletId : outlets[0].id,
    tanggal: todayWIB()
  };

  // Sesi & item dimuat PER OUTLET, bukan sekali di awal: sejak migration 0054
  // tiap outlet bisa punya tambahan sendiri di atas standar BU. Kalau dimuat
  // sekali saja, berpindah outlet akan menampilkan ceklis outlet sebelumnya —
  // salah tanpa tanda apa pun.
  let sessions = [];
  async function muatTemplate() {
    sessions = await listActiveSessions(businessUnitId, state.outletId);
  }

  // Item dimuat SAAT SESI DIBUKA, bukan sekali di awal: sejak 0069 tiap sesi
  // bisa punya daftar item sendiri. Memuatnya di depan berarti sesi kedua
  // menampilkan item sesi pertama — salah tanpa tanda apa pun.
  async function muatItem(sessionId) {
    return listActiveItems(businessUnitId, state.outletId, sessionId);
  }

  container.innerHTML = `
    <h1>Daily Activities</h1>
    <div class="field" style="max-width:280px">
      <label>Outlet</label>
      <select id="clean-outlet">
        ${outlets.map((o) => `<option value="${o.id}"${o.id === state.outletId ? ' selected' : ''}>${escapeHtml(o.name)}</option>`).join('')}
      </select>
    </div>
    <div class="field" style="max-width:200px">
      <label>Tanggal</label>
      <input type="date" id="clean-date" value="${state.tanggal}" max="${todayWIB()}" />
    </div>
    <p id="clean-datelabel" style="color:var(--color-text-muted);font-size:0.85rem"></p>
    <div id="clean-body"></div>
  `;

  const body = container.querySelector('#clean-body');
  const outletSelect = container.querySelector('#clean-outlet');
  const dateInput = container.querySelector('#clean-date');
  outletSelect.addEventListener('change', () => {
    state.outletId = outletSelect.value;
    renderSessionList();
  });
  dateInput.addEventListener('change', () => {
    state.tanggal = dateInput.value || todayWIB();
    renderSessionList();
  });

  async function renderSessionList() {
    body.innerHTML = loadingHtml('Memuat…');
    const hariIni = state.tanggal === todayWIB();
    container.querySelector('#clean-datelabel').textContent = hariIni
      ? `Sesi hari ini — ${fmtDate(state.tanggal)}`
      : `Riwayat ${fmtDate(state.tanggal)} — hanya bisa dilihat, tidak bisa diisi.`;

    let runs;
    try {
      await muatTemplate();
      runs = await listSessionRuns(state.outletId, state.tanggal);
    } catch (error) {
      body.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
      return;
    }
    // Satu sesi bisa punya lebih dari satu run (mis. sebelum 0068, dua orang
    // mengerjakannya karena sama-sama melihat "Belum"). Yang ditampilkan di
    // kartu adalah yang PERTAMA, sisanya tetap terbaca di dialog rinciannya.
    const runPerSesi = new Map();
    for (const r of runs) if (!runPerSesi.has(r.session_id)) runPerSesi.set(r.session_id, r);
    if (!sessions.length) {
      body.innerHTML = `<p style="color:var(--color-text-muted)">Admin belum mengatur sesi aktivitas untuk outlet ini.</p>`;
      return;
    }
    body.innerHTML = `
      <div class="card-grid" style="margin-top:8px">
        ${sessions
          .map((s) => {
            const run = runPerSesi.get(s.id);
            // Kartu yang sudah selesai TIDAK lagi mati. Versi lama menonaktifkan
            // tombolnya, jadi setelah semua sesi beres halamannya cuma deretan
            // kotak abu-abu — tidak ada cara melihat siapa yang mengerjakan,
            // jam berapa, atau apa buktinya. Sekarang kartunya jadi pintu ke
            // rinciannya.
            const belumBisaIsi = !hariIni && !run;
            return `
            <button class="module-card ${run ? 'session-done' : ''}"
              data-session="${escapeHtml(s.id)}" data-run="${escapeHtml(run?.id ?? '')}"
              ${belumBisaIsi ? 'disabled' : ''}>
              <span class="module-card-icon">${run ? '✅' : belumBisaIsi ? '—' : '🧹'}</span>
              <span class="module-card-label">${escapeHtml(s.name)}</span>
              <span style="font-size:0.72rem;color:var(--color-text-muted)">${
                run
                  ? `${escapeHtml(run.user_profiles?.full_name ?? 'Staff')} · ${jamOf(run.created_at)}`
                  : belumBisaIsi
                    ? 'Tidak dikerjakan'
                    : 'Belum · ketuk untuk mulai'
              }</span>
            </button>`;
          })
          .join('')}
      </div>
      ${
        runs.length > runPerSesi.size
          ? `<p style="font-size:0.76rem;color:var(--color-text-muted);margin-top:10px">
               Ada sesi yang tercatat dikerjakan lebih dari sekali hari itu. Ketuk kartunya untuk melihat semuanya.
             </p>`
          : ''
      }
    `;
    body.querySelectorAll('[data-session]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sesi = sessions.find((x) => x.id === btn.dataset.session);
        // Sudah dikerjakan -> lihat rinciannya. Belum & hari ini -> isi.
        if (btn.dataset.run) bukaRincian(sesi, runs.filter((r) => r.session_id === sesi.id));
        else renderRunForm(sesi);
      });
    });
  }

  /**
   * Rincian pengerjaan satu sesi: siapa, jam berapa, item apa saja, dan
   * fotonya. Read-only — melihat pekerjaan rekan adalah transparansi,
   * menyuntingnya hal yang sama sekali berbeda (dan RLS-nya memang menolak).
   */
  async function bukaRincian(session, runsSesi) {
    sambungkanFotoRincian();
    const bagian = [];
    for (const run of runsSesi) {
      let items = [];
      try {
        items = await getRunItems(run.id);
      } catch {
        // Satu run yang gagal dibaca tidak boleh menutup seluruh dialog.
      }
      const fotoUrl = await getChecklistPhotoUrls(items.map((i) => i.photo_path)).catch(() => new Map());
      const dicentang = items.filter((i) => i.checked);
      bagian.push(`
        <div style="border-top:1px solid var(--color-border,#eee);padding-top:10px;margin-top:10px">
          <div style="font-size:0.88rem"><strong>${escapeHtml(run.user_profiles?.full_name ?? 'Staff')}</strong>
            <span style="color:var(--color-text-muted)">· ${jamOf(run.created_at)}</span></div>
          ${run.notes ? `<div style="font-size:0.78rem;color:var(--color-text-muted);margin-top:2px">💬 ${escapeHtml(run.notes)}</div>` : ''}
          <div style="font-size:0.78rem;color:var(--color-text-muted);margin:6px 0">${dicentang.length} dari ${items.length} item dikerjakan</div>
          <div style="display:flex;flex-direction:column;gap:6px">
            ${
              items
                .map((i) => {
                  const url = fotoUrl.get(i.photo_path);
                  return `<div style="display:flex;gap:8px;align-items:center">
                    ${
                      url
                        ? `<img src="${escapeHtml(url)}" alt="" class="ck-foto" data-path="${escapeHtml(i.photo_path)}"
                             style="width:40px;height:40px;object-fit:cover;border-radius:6px;cursor:pointer;flex-shrink:0;border:1px solid var(--color-border)" />`
                        : `<span style="width:40px;text-align:center;flex-shrink:0">${i.checked ? '✅' : '⬜'}</span>`
                    }
                    <span style="font-size:0.85rem${i.checked ? '' : ';color:var(--color-text-muted)'}">${escapeHtml(i.checklist_items?.label ?? '-')}
                      ${i.note ? `<div style="font-size:0.74rem;color:var(--color-text-muted)">${escapeHtml(i.note)}</div>` : ''}</span>
                  </div>`;
                })
                .join('') || '<span style="font-size:0.82rem;color:var(--color-text-muted)">Rincian item tidak bisa dibaca.</span>'
            }
          </div>
        </div>`);
    }

    await infoDialog({
      title: session?.name ?? 'Rincian aktivitas',
      bodyHtml: `<div id="ck-rincian">${bagian.join('') || '<p>Belum ada rincian.</p>'}</div>`
    });
  }

  async function renderRunForm(session) {
    body.innerHTML = loadingHtml('Memuat item…', { baris: 4 });
    let items;
    try {
      items = await muatItem(session.id);
    } catch (error) {
      body.innerHTML = `<p class="error-text">${escapeHtml(error.message ?? error)}</p>`;
      return;
    }
    if (!items.length) {
      body.innerHTML = `
        <div class="inline-card" style="max-width:520px">
          <button class="btn-home" id="clean-back">← Kembali</button>
          <p style="margin-top:12px;color:var(--color-text-muted)">
            Belum ada item aktivitas untuk sesi <strong>${escapeHtml(session.name)}</strong> di outlet ini.
            Minta admin menambahkannya lewat Admin Portal → Daily Activities → Item.
          </p>
        </div>`;
      body.querySelector('#clean-back').addEventListener('click', renderSessionList);
      return;
    }
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

/**
 * Foto di dalam dialog rincian dibuka besar saat diketuk.
 *
 * Disambungkan lewat delegasi di document karena isi dialog dibuat oleh
 * infoDialog, di luar container modul. Dipasang SEKALI di level modul, bukan di
 * dalam render: memasangnya tiap kali halaman dibuka membuat pendengarnya
 * menumpuk, dan satu ketukan akan membuka tab yang sama berkali-kali.
 */
let fotoRincianTersambung = false;
function sambungkanFotoRincian() {
  if (fotoRincianTersambung) return;
  fotoRincianTersambung = true;
  document.addEventListener('click', async (e) => {
    const img = e.target.closest?.('#ck-rincian .ck-foto');
    if (!img) return;
    try {
      const url = await getChecklistPhotoUrl(img.dataset.path);
      if (url) window.open(url, '_blank');
    } catch (error) {
      toast(error.message ?? 'Gagal membuka foto.', 'error');
    }
  });
}

function jamOf(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });
}

function fmtDate(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' });
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
