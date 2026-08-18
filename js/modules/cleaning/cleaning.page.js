import { toast, infoDialog, formDialog, confirmDialog } from '../../core/ui.js';
import { photoInputHtml, wirePhotoInput } from '../../core/photo-input.js';
import {
  listBuOutlets,
  listActiveSessions,
  listActiveItems,
  petaTerakhirDikerjakan,
  listSessionRuns,
  getRunItems,
  getRunItemIds,
  getItemsPerSession,
  lanjutkanChecklistRun,
  ubahItemRun,
  hapusItemRun,
  getChecklistPhotoUrl,
  getChecklistPhotoUrls,
  submitChecklistRun,
  todayWIB
} from './cleaning.service.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';
import { dorongSubHalaman } from '../../core/navigasi.js';
import { ingatLayar } from '../../core/ingatan-layar.js';
import { saringJatuhTempo, labelJadwal } from './jadwal-item.js';

export async function renderCleaningPage(container, { userId, businessUnitId, outletId, layarAwal = null }) {
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
  async function muatItem(sessionId, sudahDikerjakan = null) {
    const semua = await listActiveItems(businessUnitId, state.outletId, sessionId);
    // JADWAL (0083): item yang dikerjakan beberapa hari sekali disaring di sini,
    // bukan di query — riwayat pengerjaannya perlu ditanyakan terpisah, dan
    // kalau riwayat itu gagal dibaca, SEMUA item tetap muncul.
    //
    // Disaring terhadap tanggal yang sedang dilihat (`state.tanggal`), bukan
    // hari ini: staff bisa membuka tanggal kemarin untuk melanjutkan sesi yang
    // tertinggal, dan menyaringnya dengan hari ini akan menampilkan daftar yang
    // berbeda dari yang benar-benar berlaku hari itu.
    const terakhir = await petaTerakhirDikerjakan(state.outletId);
    return saringJatuhTempo(semua, terakhir, state.tanggal, sudahDikerjakan);
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
    ingatLayar(null); // kembali ke layar utama modul
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

    // Berapa item yang SEHARUSNYA ada di tiap sesi. Tanpa angka ini, sesi yang
    // baru terisi 1 dari 15 item tetap tampil "Selesai" — dan itu persis bug
    // yang membuat 14 item sisanya tidak pernah dikerjakan.
    let itemPerSesi = new Map();
    try {
      itemPerSesi = await getItemsPerSession(businessUnitId, state.outletId, sessions);
    } catch {
      // Gagal menghitung -> kartunya tidak menampilkan kemajuan, tapi tetap bisa dibuka.
    }
    const kemajuan = (sesiId) => {
      const run = runPerSesi.get(sesiId);
      const total = itemPerSesi.get(sesiId)?.length ?? 0;
      // HANYA baris yang benar-benar DIKERJAKAN yang dihitung.
      //
      // Data sebelum 0071 menyimpan baris untuk item yang tidak dicentang juga,
      // jadi menghitung semua baris membuat sesi yang baru terisi 1 dari 6
      // terbaca "6 dari 6" — tuntas, kartunya mati, dan bug yang baru saja
      // diperbaiki muncul lagi untuk data lama.
      const selesai = run ? (run.checklist_run_items ?? []).filter((i) => i.checked).length : 0;
      return { total, selesai, tuntas: total > 0 && selesai >= total };
    };
    if (!sessions.length) {
      body.innerHTML = `<p style="color:var(--color-text-muted)">Admin belum mengatur sesi aktivitas untuk outlet ini.</p>`;
      return;
    }
    body.innerHTML = `
      <div class="card-grid" style="margin-top:8px">
        ${sessions
          .map((s) => {
            const run = runPerSesi.get(s.id);
            const k = kemajuan(s.id);
            // Kartu yang sudah selesai TIDAK lagi mati. Versi lama menonaktifkan
            // tombolnya, jadi setelah semua sesi beres halamannya cuma deretan
            // kotak abu-abu — tidak ada cara melihat siapa yang mengerjakan,
            // jam berapa, atau apa buktinya. Sekarang kartunya jadi pintu ke
            // rinciannya.
            const belumBisaIsi = !hariIni && !run;
            // Tiga keadaan, bukan dua. "Ada run" TIDAK sama dengan "selesai".
            const ikon = !run ? (belumBisaIsi ? '—' : '🧹') : k.tuntas ? '✅' : '⏳';
            return `
            <button class="module-card ${k.tuntas ? 'session-done' : ''}"
              data-session="${escapeHtml(s.id)}" data-run="${escapeHtml(run?.id ?? '')}"
              data-tuntas="${k.tuntas ? '1' : ''}"
              ${belumBisaIsi ? 'disabled' : ''}>
              <span class="module-card-icon">${ikon}</span>
              <span class="module-card-label">${escapeHtml(s.name)}</span>
              <span style="font-size:0.72rem;color:var(--color-text-muted)">${
                run
                  ? `${k.total ? `${k.selesai}/${k.total} item · ` : ''}${escapeHtml(run.user_profiles?.full_name ?? 'Staff')} · ${jamOf(run.created_at)}`
                  : belumBisaIsi
                    ? 'Tidak dikerjakan'
                    : `${k.total ? `${k.total} item · ` : ''}Belum · ketuk untuk mulai`
              }</span>
              ${
                run && !k.tuntas && hariIni
                  ? '<span style="font-size:0.68rem;color:var(--color-primary)">Ketuk untuk lanjutkan</span>'
                  : ''
              }
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
        const run = runPerSesi.get(sesi.id);
        // Tiga jalan, sesuai tiga keadaan:
        //   belum ada run          -> isi dari awal
        //   ada run & belum tuntas -> lanjutkan item yang belum dikerjakan
        //   tuntas / hari lampau   -> lihat rinciannya saja
        // Selalu buka LAYAR SESI, bukan dialog — juga saat sudah tuntas.
        // Di situlah staff melihat apa saja yang sudah dikerjakan, oleh siapa,
        // dan bisa memperbaiki miliknya sendiri.
        if (!run) return renderRunForm(sesi);
        if (hariIni) return renderRunForm(sesi, run);
        // Hari lampau: kalau satu sesi punya beberapa run, dialog rincian yang
        // bisa menampilkan semuanya sekaligus.
        const runSesi = runs.filter((r) => r.session_id === sesi.id);
        if (runSesi.length > 1) return bukaRincian(sesi, runSesi);
        renderRunForm(sesi, run);
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
          <div style="font-size:0.88rem">Dimulai <strong>${escapeHtml(run.user_profiles?.full_name ?? 'Staff')}</strong>
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
                        : // Dicentang tapi tanpa foto ditandai merah — artinya beda
                          // jauh dari item yang memang tidak dikerjakan.
                          `<span title="${i.checked ? 'Dicentang tanpa foto bukti' : 'Tidak dikerjakan'}"
                             style="width:40px;text-align:center;flex-shrink:0${i.checked ? ';color:var(--color-danger)' : ''}">${i.checked ? '⚠️' : '⬜'}</span>`
                    }
                    <span style="font-size:0.85rem${i.checked ? '' : ';color:var(--color-text-muted)'}">${escapeHtml(i.checklist_items?.label ?? '-')}
                      ${
                        // Pengerja menempel pada ITEM. Satu sesi bisa dikerjakan
                        // beberapa orang lintas pergantian shift.
                        i.checked
                          ? `<div style="font-size:0.72rem;color:var(--color-text-muted)">${escapeHtml(i.pengerja?.full_name ?? 'Staff')}${i.done_at ? ` · ${jamOf(i.done_at)}` : ''}</div>`
                          : ''
                      }
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

  /**
   * Satu layar untuk satu sesi — dipakai untuk mengisi, melanjutkan, maupun
   * sekadar melihat.
   *
   * SELURUH item selalu ditampilkan, termasuk yang sudah dikerjakan. Versi
   * sebelumnya menghilangkan item begitu terkirim, sehingga staff kehilangan
   * satu-satunya tempat untuk melihat apa yang sudah beres — padahal itulah
   * pertanyaan yang paling sering muncul di tengah shift.
   *
   * @param {object|null} runAda run hari itu kalau sudah ada
   */
  async function renderRunForm(session, runAda = null) {
    const hariIni = state.tanggal === todayWIB();
    body.innerHTML = loadingHtml('Memuat item…', { baris: 4 });

    let items, sudah, fotoSelesai;
    try {
      // Urutannya dibalik: yang SUDAH tercatat hari ini diambil DULU, lalu
      // dipakai memaksa item itu tetap tampil walau jadwalnya sudah lewat.
      // Tanpa ini, item berjadwal lenyap tepat setelah dicentang.
      sudah = runAda ? await getRunItemIds(runAda.id) : new Map();
      items = await muatItem(session.id, new Set(sudah.keys()));
      fotoSelesai = await getChecklistPhotoUrls([...sudah.values()].map((r) => r.photo_path)).catch(() => new Map());
    } catch (error) {
      body.innerHTML = `<p class="error-text">${escapeHtml(error.message ?? error)}</p>`;
      return;
    }

    // "Sudah dikerjakan" = punya baris DENGAN checked = true. Baris lama yang
    // checked = false berarti belum dikerjakan, dan masih boleh diisi (barisnya
    // diperbarui, bukan disisipkan — lihat migration 0072).
    const selesaiRow = (id) => (sudah.get(id)?.checked ? sudah.get(id) : null);
    const sisa = items.filter((it) => !selesaiRow(it.id));
    const bisaIsi = hariIni && sisa.length > 0;

    if (!items.length) {
      body.innerHTML = `
        <div class="inline-card" style="max-width:520px">
          <button class="btn-home" id="clean-back">← Kembali</button>
          <p style="margin-top:12px;color:var(--color-text-muted)">
            Belum ada item aktivitas untuk sesi <strong>${escapeHtml(session.name)}</strong> di outlet ini.
            Minta admin menambahkannya lewat Admin Portal → Daily Activities → Item.
          </p>
        </div>`;
      const lepasLapis = dorongSubHalaman('aktivitas-kosong', renderSessionList);
      body.querySelector('#clean-back').addEventListener('click', () => {
        lepasLapis();
        renderSessionList();
      });
      return;
    }

    const jumlahSelesai = items.filter((it) => selesaiRow(it.id)).length;

    /** Kartu item yang SUDAH dikerjakan — informasi, bukan isian. */
    const kartuSelesai = (it, done) => {
      const url = fotoSelesai.get(done.photo_path);
      // Perbaiki/hapus hanya untuk pekerjaan SENDIRI, dan hanya di hari yang
      // sama. Batas ini yang membuat isinya tetap layak disebut bukti; sama
      // persis dengan yang ditegakkan policy 0073 di database.
      const milikku = done.done_by === userId && hariIni;
      return `
        <div class="clean-item-block" style="border:1px solid var(--color-border,#e3e3e3);border-radius:10px;padding:10px;margin-bottom:8px;background:var(--color-bg)">
          <div style="display:flex;gap:10px;align-items:flex-start">
            ${
              url
                ? `<img src="${escapeHtml(url)}" alt="" class="ck-foto" data-path="${escapeHtml(done.photo_path)}"
                     style="width:52px;height:52px;object-fit:cover;border-radius:8px;cursor:pointer;flex-shrink:0;border:1px solid var(--color-border)" />`
                : '<span style="width:52px;text-align:center;flex-shrink:0;font-size:1.3rem">✅</span>'
            }
            <span style="flex:1;min-width:0">
              <span style="font-weight:600">✅ ${escapeHtml(it.label)}</span>
              <div style="font-size:0.74rem;color:var(--color-text-muted)">
                ${escapeHtml(done.pengerja?.full_name ?? 'Staff')}${done.done_at ? ` · ${jamOf(done.done_at)}` : ''}
              </div>
              ${done.note ? `<div style="font-size:0.74rem;color:var(--color-text-muted)">${escapeHtml(done.note)}</div>` : ''}
            </span>
          </div>
          ${
            milikku
              ? `<div style="display:flex;gap:6px;margin-top:8px">
                   <button class="ck-edit" data-item="${escapeHtml(it.id)}" data-label="${escapeHtml(it.label)}">✎ Perbaiki</button>
                   <button class="ck-hapus" data-item="${escapeHtml(it.id)}" data-label="${escapeHtml(it.label)}"
                     data-path="${escapeHtml(done.photo_path ?? '')}">🗑 Hapus</button>
                 </div>`
              : ''
          }
        </div>`;
    };

    body.innerHTML = `
      <div class="inline-card" style="max-width:520px">
        <button class="btn-home" id="clean-back">← Kembali</button>
        <h3 style="margin:12px 0 4px">${escapeHtml(session.name)}</h3>
        <p style="font-size:0.82rem;color:var(--color-text-muted);margin:0 0 12px">
          <strong>${jumlahSelesai} dari ${items.length} item</strong> sudah dikerjakan.
          ${
            !hariIni
              ? 'Ini riwayat hari sebelumnya — hanya bisa dilihat.'
              : bisaIsi
                ? 'Centang item yang sudah beres, lalu <strong>ambil foto bukti untuk tiap item yang dicentang</strong>. Yang belum sempat bisa dilanjutkan nanti.'
                : 'Semua item sesi ini sudah beres. 🎉'
          }
        </p>
        <div id="clean-items">
          ${items
            .map((it) => {
              const done = selesaiRow(it.id);
              if (done) return kartuSelesai(it, done);
              if (!hariIni) {
                return `
            <div class="clean-item-block" style="border:1px dashed var(--color-border,#e3e3e3);border-radius:10px;padding:10px;margin-bottom:8px">
              <span style="color:var(--color-text-muted)">⬜ ${escapeHtml(it.label)} — tidak dikerjakan</span>
            </div>`;
              }
              return `
            <div class="clean-item-block" data-block="${escapeHtml(it.id)}" style="border:1px solid var(--color-border,#e3e3e3);border-radius:10px;padding:10px;margin-bottom:8px">
              <label class="clean-item" style="margin:0">
                <input type="checkbox" class="clean-check" data-item="${escapeHtml(it.id)}" />
                <span>${escapeHtml(it.label)}${jadwalHtml(it)}</span>
              </label>
              <div class="clean-photo-wrap" data-for="${escapeHtml(it.id)}" hidden style="margin-top:8px">
                ${photoInputHtml({ name: `foto-${it.id}`, label: 'Foto bukti item ini', facing: 'environment' })}
              </div>
            </div>`;
            })
            .join('')}
        </div>
        ${
          bisaIsi && !runAda
            ? `<div class="field">
                 <label>Catatan (opsional)</label>
                 <input type="text" id="clean-notes" placeholder="mis. kran wastafel bocor" />
               </div>`
            : ''
        }
        ${bisaIsi ? `<button class="primary" id="clean-submit">${runAda ? 'Tambahkan ke Sesi Ini' : 'Kirim Aktivitas'}</button>` : ''}
        <p class="error-text" id="clean-error"></p>
        <p id="clean-progress" style="font-size:0.8rem;color:var(--color-text-muted);margin:6px 0 0"></p>
      </div>
    `;

    // Back dari layar sesi kembali ke DAFTAR SESI, bukan ke Beranda.
    const lepasLapis = dorongSubHalaman(`sesi:${session.id}`, renderSessionList);
    // Dicatat supaya kalau halaman ini dibuang OS (orangnya membuka Excel atau
    // kamera), yang dipulihkan bukan cuma modulnya tapi layar sesi ini.
    ingatLayar(`sesi:${session.id}`);
    body.querySelector('#clean-back').addEventListener('click', () => {
      lepasLapis();
      renderSessionList();
    });
    sambungkanFotoRincian(); // foto item selesai bisa diketuk untuk diperbesar

    // ---- Perbaiki / hapus item milik sendiri ----
    body.querySelectorAll('.ck-edit').forEach((btn) =>
      btn.addEventListener('click', sekaliJalan(async () => {
        const values = await formDialog({
          title: `Perbaiki "${btn.dataset.label}"`,
          description: 'Ambil foto pengganti kalau fotonya kurang jelas. Kalau hanya catatannya yang salah, biarkan fotonya kosong.',
          fields: [
            { name: 'note', label: 'Catatan (opsional)', type: 'text', value: sudah.get(btn.dataset.item)?.note ?? '' },
            { name: 'file', label: 'Foto pengganti (opsional)', type: 'photo', facing: 'environment' }
          ],
          submitText: 'Simpan Perbaikan'
        });
        if (!values) return;
        try {
          await ubahItemRun({
            runId: runAda.id,
            itemId: btn.dataset.item,
            outletId: state.outletId,
            note: values.note,
            file: values.file
          });
          toast('Item diperbarui.', 'success');
          await renderRunForm(session, runAda);
        } catch (error) {
          toast(error.message ?? 'Gagal memperbarui.', 'error');
        }
      }))
    );

    body.querySelectorAll('.ck-hapus').forEach((btn) =>
      btn.addEventListener('click', sekaliJalan(async () => {
        const ok = await confirmDialog({
          title: `Hapus catatan "${btn.dataset.label}"?`,
          message: 'Foto buktinya ikut dihapus, dan item ini kembali jadi "belum dikerjakan" sehingga bisa diulang.',
          confirmText: 'Hapus',
          danger: true
        });
        if (!ok) return;
        try {
          await hapusItemRun({ runId: runAda.id, itemId: btn.dataset.item, photoPath: btn.dataset.path || null });
          toast('Catatan item dihapus.', 'success');
          await renderRunForm(session, runAda);
        } catch (error) {
          toast(error.message ?? 'Gagal menghapus.', 'error');
        }
      }))
    );

    if (!bisaIsi) return;

    // Satu pembaca foto per item YANG BISA DIISI.
    // Preset 'aktivitas' DIMINTA DI SINI supaya fotonya dikecilkan begitu
    // diambil, bukan ditahan mentah sampai tombol Kirim. Satu sesi bisa berisi
    // sepuluh item, dan sepuluh foto 12 megapiksel di halaman yang sedang di
    // latar belakang (karena aplikasi kamera di depan) adalah cara tercepat
    // membuat Android membuang halaman ini. Alasan lengkapnya di photo-input.js.
    const bacaFoto = new Map(sisa.map((it) => [it.id, wirePhotoInput(body, `foto-${it.id}`, { preset: 'aktivitas' })]));

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
        // panjang terlalu melelahkan untuk dicari sendiri oleh orang yang
        // sedang berdiri sambil memegang alat pel.
        errorEl.textContent = `${tanpaFoto.length} item yang dicentang belum ada fotonya.`;
        body.querySelector(`.clean-item-block[data-block="${CSS.escape(tanpaFoto[0].item_id)}"]`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }

      e.target.disabled = true;
      try {
        if (runAda) {
          const n = await lanjutkanChecklistRun(
            { runId: runAda.id, outletId: state.outletId, itemStates },
            (pesan) => (progressEl.textContent = pesan)
          );
          progressEl.textContent = '';
          toast(`${n} item ditambahkan ke "${session.name}". ✅`, 'success');
        } else {
          await submitChecklistRun(
            {
              businessUnitId,
              outletId: state.outletId,
              sessionId: session.id,
              itemStates,
              notes: body.querySelector('#clean-notes')?.value ?? ''
            },
            (pesan) => (progressEl.textContent = pesan)
          );
          progressEl.textContent = '';
          toast(`Aktivitas "${session.name}" terkirim. Terima kasih! ✅`, 'success');
        }
        // Tetap di layar sesi ini, bukan kembali ke daftar: setelah mengirim,
        // yang ingin dilihat orang adalah hasilnya — dan item apa yang masih
        // tersisa.
        await renderRunForm(session, runAda ?? (await cariRunSesi(session.id)));
      } catch (error) {
        progressEl.textContent = '';
        errorEl.textContent = error.message ?? 'Gagal mengirim aktivitas.';
        e.target.disabled = false;
      }
    });
  }

  /** Run hari ini untuk satu sesi — dipakai setelah pengiriman pertama. */
  async function cariRunSesi(sessionId) {
    const daftar = await listSessionRuns(state.outletId, state.tanggal).catch(() => []);
    return daftar.find((r) => r.session_id === sessionId) ?? null;
  }

  await renderSessionList();

  // Pulihkan layar sesi yang sedang dibuka sebelum halaman ini dibuang OS.
  // Hanya untuk HARI INI: memulihkan layar sesi tanggal kemarin bukan
  // "melanjutkan", itu membingungkan — dan tanggalnya sudah berganti.
  const sesiPulih = String(layarAwal ?? '').startsWith('sesi:') ? String(layarAwal).slice(5) : null;
  if (sesiPulih && state.tanggal === todayWIB()) {
    const sesi = sessions.find((x) => x.id === sesiPulih);
    if (sesi) {
      const daftar = await listSessionRuns(state.outletId, state.tanggal).catch(() => []);
      await renderRunForm(sesi, daftar.find((r) => r.session_id === sesi.id) ?? null);
    }
  }
}

/**
 * Foto di dalam dialog rincian dibuka besar saat diketuk.
 *
 * Disambungkan lewat delegasi di document karena isi dialog dibuat oleh
 * infoDialog, di luar container modul. Dipasang SEKALI di level modul, bukan di
 * dalam render: memasangnya tiap kali halaman dibuka membuat pendengarnya
 * menumpuk, dan satu ketukan akan membuka tab yang sama berkali-kali.
 *
 * Berlaku untuk SEMUA `.ck-foto`, bukan hanya yang di dalam dialog — foto item
 * yang sudah terkunci di form lanjutan juga harus bisa diperbesar.
 */
let fotoRincianTersambung = false;
function sambungkanFotoRincian() {
  if (fotoRincianTersambung) return;
  fotoRincianTersambung = true;
  document.addEventListener('click', async (e) => {
    const img = e.target.closest?.('.ck-foto');
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
/**
 * Tanda jadwal di sebelah nama item.
 *
 * Dua hal yang berbeda dan sengaja dibedakan tampilannya:
 *   - "tiap 7 hari" — keterangan biasa, supaya staff tahu ini bukan pekerjaan
 *     harian dan tidak bingung kenapa kemarin tidak ada.
 *   - "tertunda 5 hari" — peringatan. Angkanya disebut, bukan cuma kata
 *     "tertunda": beda antara telat sehari dan telat dua minggu adalah beda
 *     antara kelalaian kecil dan sesuatu yang harus ditanyakan ke atasan.
 */
function jadwalHtml(it) {
  const label = labelJadwal(it?.interval_days);
  if (!label && !it?.terlambat) return '';
  const tunda = Number(it?.terlambat) > 0
    ? `<span style="color:var(--color-danger);font-weight:600"> · tertunda ${it.terlambat} hari</span>`
    : '';
  return `<span style="font-size:0.75rem;color:var(--color-text-muted)"> (${escapeHtml(label ?? 'berjadwal')})</span>${tunda}`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
