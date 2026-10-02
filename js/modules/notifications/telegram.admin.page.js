import { toast, confirmDialog, formDialog } from '../../core/ui.js';
import { listBusinessUnitsBasic } from '../organization/organization.service.js';
import {
  TELEGRAM_EVENTS,
  eventInfo,
  listTelegramRoutes,
  saveTelegramRoute,
  deleteTelegramRoute,
  sendTelegramTest,
  detectTelegramChats,
  getIntegrationStatus,
  jalankanRekapReservasi
} from './telegram.service.js';
import { diagnosaRekap, ikonVonis } from './diagnosa-rekap.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';

/**
 * Halaman Notifikasi Telegram (Super Admin).
 *
 * Halaman ini sengaja TIDAK menyimpan token bot — token hidup sebagai secret di
 * Edge Function, karena repo ini publik di GitHub Pages. Yang diatur di sini
 * hanya **tujuan grup per event**; chat ID bukan rahasia (tanpa token, ia tidak
 * bisa dipakai mengirim apa pun).
 */
export async function renderTelegramAdminPage(container) {
  container.innerHTML = loadingHtml('Memuat pengaturan notifikasi…');

  let routes, bus, integrasi;
  try {
    [routes, bus, integrasi] = await Promise.all([
      listTelegramRoutes(),
      listBusinessUnitsBasic().catch(() => []),
      getIntegrationStatus().catch(() => [])
    ]);
  } catch (error) {
    container.innerHTML = `<p class="error-text">Gagal memuat: ${esc(error.message ?? error)}</p>`;
    return;
  }

  container.innerHTML = `
    <h1>Notifikasi Telegram</h1>
    <p style="font-size:0.85rem;color:var(--color-text-muted);margin-top:0;max-width:660px">
      Tiap jenis event bisa diarahkan ke grup yang berbeda. Token bot disimpan sebagai
      <strong>secret di Edge Function</strong> — yang diatur di sini hanya tujuan grupnya.
    </p>
    <div class="inline-card" style="max-width:660px;margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <h3 style="margin:0">Deteksi Grup</h3>
        <button id="tg-detect">🔍 Deteksi grup bot</button>
      </div>
      <p style="font-size:0.82rem;color:var(--color-text-muted);margin:6px 0 0">
        Menampilkan grup yang <strong>bot ini benar-benar menjadi anggotanya</strong>, lengkap dengan ID-nya.
        Kalau sebuah grup tidak muncul di sini, botnya memang belum ditambahkan ke grup itu — itulah penyebab
        <code>chat not found</code>. Tambahkan bot ke grup, kirim satu pesan di sana, lalu deteksi ulang.
      </p>
      <div id="tg-detect-result" style="margin-top:10px"></div>
    </div>

    <div class="inline-card" style="max-width:660px;margin-bottom:16px">
      <h3 style="margin-top:0">Status Pemicu Database</h3>
      <p style="font-size:0.82rem;color:var(--color-text-muted);margin:0 0 8px">
        Tombol <strong>Tes</strong> di bawah memanggil Edge Function langsung dari browser — itu membuktikan bot &amp; grupnya benar,
        tapi <strong>tidak</strong> membuktikan database tahu harus memanggil siapa saat ada data baru. Bagian inilah yang paling
        sering terlewat: tes hijau, tapi event sungguhan diam.
      </p>
      <table class="data-table">
        <thead><tr><th>Pengaturan</th><th>Status</th></tr></thead>
        <tbody>
          ${integrasi
            .map(
              (k) => `<tr>
                <td><strong>${esc(k.label)}</strong>
                  <div style="font-size:0.72rem;color:var(--color-text-muted);font-family:ui-monospace,Menlo,monospace">${esc(k.key)}</div></td>
                <td>${
                  !k.isSet
                    ? '<span class="badge badge-rejected">belum diisi</span>'
                    : k.ok
                    ? `<span class="badge badge-approved">siap</span>
                       <div style="font-size:0.7rem;color:var(--color-text-muted);word-break:break-all">${esc(k.preview)}</div>`
                    : `<span class="badge badge-rejected">salah format</span>
                       <div style="font-size:0.72rem;color:var(--color-danger)">${esc(k.problem)}</div>
                       <div style="font-size:0.7rem;color:var(--color-text-muted);word-break:break-all">${esc(k.preview)}</div>`
                }</td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>
      ${
        integrasi.some((k) => !k.ok)
          ? `<p style="font-size:0.82rem;margin:10px 0 0">Perbaiki lewat <strong>SQL Editor</strong> (ganti <code>&lt;PROJECT-REF&gt;</code> dengan nama project Supabase-mu):</p>
             <pre style="font-size:0.72rem;background:var(--color-bg);padding:10px;border-radius:8px;overflow:auto;margin:6px 0 0">insert into integration_settings (key, value) values
${integrasi.filter((k) => !k.ok).map((k) => `  ('${k.key}', '${k.hint}')`).join(',\n')}
on conflict (key) do update set value = excluded.value, updated_at = now();</pre>`
          : '<p style="font-size:0.82rem;color:var(--color-primary);margin:10px 0 0">✅ Semua pemicu sudah terdaftar &amp; formatnya benar.</p>'
      }
    </div>

    <div class="inline-card" style="max-width:660px;margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <h3 style="margin:0">🗒️ Rekap Reservasi Harian</h3>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button id="rk-pratinjau">👁 Pratinjau hari ini</button>
          <button id="rk-kirim" class="primary">Kirim sekarang</button>
        </div>
      </div>
      <p style="font-size:0.82rem;color:var(--color-text-muted);margin:6px 0 0">
        Rekap ini jalannya lewat <strong>cron harian</strong>, bukan trigger — jadi kalau tidak ada yang memanggilnya,
        tidak ada apa pun yang terjadi, <strong>termasuk tidak ada galat</strong>. Tombol <strong>Tes</strong> di tabel bawah
        tidak bisa membedakannya: ia mengirim pesan karangan lewat jalur yang berbeda.
        <strong>Pratinjau</strong> tidak mengirim apa pun — ia memanggil rekapnya sungguhan dan memperlihatkan
        isi persis yang akan masuk ke tiap grup, berikut sebabnya kalau kosong.
      </p>
      <div id="rk-hasil" style="margin-top:10px"></div>
    </div>

    <div id="tg-routes"></div>

    <div class="inline-card" style="max-width:660px;margin-top:16px">
      <h3 style="margin-top:0">Kalau Pesan Tidak Sampai</h3>
      <ul style="font-size:0.84rem;color:var(--color-text-muted);padding-left:18px;margin-bottom:0">
        <li><strong>chat not found</strong> — bot belum ditambahkan ke grup, atau ID salah. Pakai <strong>Deteksi grup</strong> di atas untuk memastikan. Awalan <code>-100</code> hanya untuk supergroup; grup biasa ber-ID negatif polos, dan itu normal.</li>
        <li><strong>bot was kicked</strong> — bot dikeluarkan dari grup, tambahkan kembali.</li>
        <li><strong>Tes berhasil tapi event tidak terkirim</strong> — Database Webhook belum didaftarkan di dashboard Supabase (lihat <code>SETUP.md</code>).</li>
        <li><strong>Reminder armada tidak muncul</strong> — cron harian belum dipasang, atau semua dokumen memang masih aman.</li>
      </ul>
    </div>
  `;

  const host = container.querySelector('#tg-routes');
  wireDetect(container);
  wireRekap(container);
  draw();

  function routeFor(key) {
    // Rute global (berlaku semua BU) yang dipakai sebagai baris utama.
    return routes.find((r) => r.event_key === key && !r.business_unit_id) ?? null;
  }
  function overridesFor(key) {
    return routes.filter((r) => r.event_key === key && r.business_unit_id);
  }

  function draw() {
    host.innerHTML = `
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Event</th><th>Grup tujuan</th><th>ID Chat</th><th>Aksi</th></tr></thead>
          <tbody>
            ${TELEGRAM_EVENTS.map((e) => {
              const r = routeFor(e.key);
              const ov = overridesFor(e.key);
              return `
                <tr>
                  <td>
                    <strong>${e.icon} ${esc(e.label)}</strong>
                    <div style="font-size:0.72rem;color:var(--color-text-muted)">${esc(e.detail)}</div>
                  </td>
                  <td>${
                    r
                      ? `${esc(r.label ?? 'Grup')}${r.is_active ? '' : ' <span class="badge badge-cancelled">nonaktif</span>'}`
                      : '<span style="color:var(--color-danger)">belum diatur</span>'
                  }</td>
                  <td style="font-family:ui-monospace,Menlo,monospace;font-size:0.8rem">${r ? esc(r.chat_id) : '-'}</td>
                  <td>
                    <button class="tg-edit" data-key="${e.key}">${r ? 'Ubah' : 'Atur'}</button>
                    ${r ? `<button class="tg-test" data-key="${e.key}">Tes</button>` : ''}
                    ${r ? `<button class="tg-del" data-id="${r.id}">Hapus</button>` : ''}
                    <button class="tg-override" data-key="${e.key}">+ Khusus BU</button>
                  </td>
                </tr>
                ${ov
                  .map(
                    (o) => `<tr>
                      <td style="padding-left:24px;font-size:0.82rem;color:var(--color-text-muted)">↳ khusus ${esc(o.business_units?.name ?? 'BU')}</td>
                      <td>${esc(o.label ?? 'Grup')}</td>
                      <td style="font-family:ui-monospace,Menlo,monospace;font-size:0.8rem">${esc(o.chat_id)}</td>
                      <td>
                        <button class="tg-edit" data-key="${e.key}" data-bu="${o.business_unit_id}">Ubah</button>
                        <button class="tg-test" data-key="${e.key}" data-bu="${o.business_unit_id}">Tes</button>
                        <button class="tg-del" data-id="${o.id}">Hapus</button>
                      </td>
                    </tr>`
                  )
                  .join('')}
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
      <p style="font-size:0.78rem;color:var(--color-text-muted);margin-top:8px">
        Baris utama berlaku untuk <strong>semua BU</strong>. Tambahkan <em>Khusus BU</em> hanya kalau ada BU yang
        harus mengirim ke grup berbeda.
      </p>
    `;

    host.querySelectorAll('.tg-edit').forEach((b) =>
      b.addEventListener('click', () => openRouteDialog(b.dataset.key, b.dataset.bu || null))
    );
    host.querySelectorAll('.tg-override').forEach((b) => b.addEventListener('click', () => openRouteDialog(b.dataset.key, '', true)));
    host.querySelectorAll('.tg-test').forEach((b) =>
      b.addEventListener('click', async () => {
        const info = eventInfo(b.dataset.key);
        b.disabled = true;
        const label = b.textContent;
        b.textContent = 'Mengirim…';
        try {
          await sendTelegramTest({ eventKey: b.dataset.key, eventLabel: info.label, businessUnitId: b.dataset.bu || null });
          toast('Pesan tes terkirim. Cek grupnya.', 'success');
        } catch (error) {
          toast(error.message ?? 'Gagal mengirim.', 'error');
        } finally {
          b.disabled = false;
          b.textContent = label;
        }
      })
    );
    host.querySelectorAll('.tg-del').forEach((b) =>
      b.addEventListener('click', sekaliJalan(async () => {
        const ok = await confirmDialog({
          title: 'Hapus rute ini?',
          message: 'Event ini tidak akan mengirim notifikasi sampai rutenya diatur lagi.',
          confirmText: 'Hapus',
          danger: true
        });
        if (!ok) return;
        try {
          await deleteTelegramRoute(b.dataset.id);
          toast('Rute dihapus.', 'success');
          await reload();
        } catch (error) {
          toast(error.message ?? 'Gagal menghapus.', 'error');
        }
      }))
    );
  }

  async function reload() {
    routes = await listTelegramRoutes();
    draw();
  }

  async function openRouteDialog(eventKey, businessUnitId, isNewOverride = false) {
    const info = eventInfo(eventKey);
    const existing = routes.find(
      (r) => r.event_key === eventKey && (businessUnitId ? r.business_unit_id === businessUnitId : !r.business_unit_id)
    );

    const values = await formDialog({
      title: `${info.icon} ${info.label}`,
      description: isNewOverride
        ? 'Kirim event ini ke grup berbeda khusus untuk satu BU. Kosongkan pilihan BU untuk mengatur rute umum.'
        : 'Tujuan grup untuk event ini. ID grup Telegram selalu diawali tanda minus, contoh: -1001234567890.',
      fields: [
        ...(isNewOverride || businessUnitId
          ? [
              {
                name: 'business_unit_id',
                label: 'Berlaku untuk BU',
                type: 'select',
                value: businessUnitId ?? '',
                options: [{ value: '', label: '-- semua BU --' }, ...bus.map((b) => ({ value: b.id, label: b.name }))]
              }
            ]
          : []),
        { name: 'label', label: 'Nama grup (pengingat saja)', type: 'text', value: existing?.label ?? '', placeholder: 'mis. Grup Berjaya' },
        {
          name: 'chat_id',
          label: 'ID Chat grup',
          type: 'text',
          required: true,
          value: existing?.chat_id ?? '',
          placeholder: '-1001234567890',
          help: 'Ambil dari https://api.telegram.org/bot<TOKEN>/getUpdates setelah mengirim pesan di grup.'
        },
        { name: 'is_active', label: 'Aktif', type: 'checkbox', value: existing ? existing.is_active : true }
      ],
      submitText: 'Simpan'
    });
    if (!values) return;

    const chat = String(values.chat_id).trim();
    if (!/^-?\d+$/.test(chat)) {
      toast('ID chat harus berupa angka (grup diawali tanda minus).', 'warning');
      return;
    }
    try {
      await saveTelegramRoute({
        eventKey,
        businessUnitId: values.business_unit_id ?? businessUnitId ?? null,
        chatId: chat,
        label: values.label,
        isActive: values.is_active
      });
      toast('Rute disimpan.', 'success');
      await reload();
    } catch (error) {
      toast(error.message ?? 'Gagal menyimpan rute.', 'error');
    }
  }
}

/** Tombol deteksi grup: satu klik, tanpa perlu membuka URL getUpdates manual. */
function wireDetect(container) {
  const btn = container.querySelector('#tg-detect');
  const box = container.querySelector('#tg-detect-result');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    box.innerHTML = `<p style="color:var(--color-text-muted)">Menghubungi Telegram…</p>`;
    try {
      const data = await detectTelegramChats();
      const chats = data?.chats ?? [];
      box.innerHTML = `
        <p style="font-size:0.82rem;margin:0 0 6px">
          Bot: <strong>@${esc(data?.bot ?? '-')}</strong> · ditemukan <strong>${chats.length}</strong> chat.
        </p>
        ${
          chats.length
            ? `<table class="data-table"><thead><tr><th>Nama</th><th>Jenis</th><th>ID Chat</th></tr></thead><tbody>
                 ${chats
                   .map(
                     (c) => `<tr><td>${esc(c.title)}</td><td>${esc(c.type)}</td>
                       <td style="font-family:ui-monospace,Menlo,monospace;font-size:0.82rem"><strong>${esc(c.id)}</strong></td></tr>`
                   )
                   .join('')}
               </tbody></table>`
            : `<p class="error-text" style="margin:0">Tidak ada chat terdeteksi. Kirim satu pesan di grupnya (atau <code>/start@${esc(data?.bot ?? 'namabot')}</code>), lalu coba lagi.</p>`
        }`;
    } catch (e) {
      box.innerHTML = `<p class="error-text" style="margin:0">❌ ${esc(e.message ?? e)}</p>`;
    } finally {
      btn.disabled = false;
    }
  });
}

/**
 * Jalankan rekap reservasi harian dari sini — pratinjau atau sungguhan.
 *
 * ============ KENAPA PRATINJAU DIDAHULUKAN ============
 *
 * Pertanyaan yang membawa orang ke tombol ini selalu "kenapa rekapnya tidak
 * datang?", dan jawabannya ada di ISI pratinjaunya — bukan di hasil kiriman.
 * Tombol yang langsung mengirim akan menjawab pertanyaan itu dengan membanjiri
 * grup, lalu meninggalkan sebabnya tetap tidak diketahui.
 */
function wireRekap(container) {
  const btnPratinjau = container.querySelector('#rk-pratinjau');
  const btnKirim = container.querySelector('#rk-kirim');
  const box = container.querySelector('#rk-hasil');

  const gambar = (d, { dikirim = false, jawaban = null } = {}) => {
    box.innerHTML = `
      <p style="margin:0 0 6px;font-size:0.86rem">
        ${ikonVonis(d.vonis)} <strong>${esc(d.ringkas)}</strong>
      </p>
      <p style="margin:0 0 10px;font-size:0.8rem;color:var(--color-text-muted)">${esc(d.saran)}</p>
      ${
        d.baris.length
          ? `<table class="data-table kartu-sempit"><thead><tr><th>Outlet</th><th>Keadaan</th></tr></thead><tbody>
               ${d.baris
                 .map(
                   (b) => `<tr>
                     <td data-label="Outlet"><strong>${esc(b.outlet)}</strong></td>
                     <td data-label="Keadaan" style="font-size:0.82rem">${ikonVonis(b.vonis)} ${esc(b.pesan)}</td>
                   </tr>`
                 )
                 .join('')}
             </tbody></table>`
          : ''
      }
      ${
        // Isi pesannya ditampilkan APA ADANYA. Ringkasan "3 reservasi" tidak
        // bisa menjawab "kenapa outlet ini tertulis kosong padahal ada booking"
        // — yang menjawab itu cuma teks yang sungguh akan dikirim.
        !dikirim && Array.isArray(jawaban?.telegram) && jawaban.telegram.length
          ? `<details style="margin-top:10px">
               <summary style="cursor:pointer;font-size:0.82rem">Lihat isi pesan yang akan dikirim</summary>
               ${jawaban.telegram
                 .map(
                   (t) => `<pre style="font-size:0.72rem;background:var(--color-bg);padding:8px;border-radius:8px;overflow:auto;margin:6px 0 0;white-space:pre-wrap">${esc(
                     String(t.preview ?? '').replace(/<\/?[bi]>/g, '')
                   )}</pre>`
                 )
                 .join('')}
             </details>`
          : ''
      }
      ${
        jawaban?.sudah_dikirim_hari_ini && !dikirim
          ? '<p style="margin:10px 0 0;font-size:0.8rem;color:var(--color-text-muted)">ℹ️ Penanda anti-kirim-ganda untuk hari ini sudah ada — "Kirim sekarang" akan menanyakan apakah mau dipaksa.</p>'
          : ''
      }`;
  };

  btnPratinjau.addEventListener(
    'click',
    sekaliJalan(async () => {
      box.innerHTML = '<p style="color:var(--color-text-muted)">Menjalankan rekap tanpa mengirim…</p>';
      try {
        const jawaban = await jalankanRekapReservasi({ dryRun: true });
        gambar(diagnosaRekap(jawaban), { jawaban });
      } catch (error) {
        gambar(diagnosaRekap(null, error));
      }
    })
  );

  btnKirim.addEventListener(
    'click',
    sekaliJalan(async () => {
      const ok = await confirmDialog({
        title: 'Kirim rekap sekarang?',
        message:
          '<p>Rekap hari ini dikirim ke grup Telegram <strong>dan</strong> sebagai notifikasi push — sungguhan, bukan tes.</p>' +
          '<p style="margin:6px 0 0;font-size:0.85rem;color:var(--color-text-muted)">Kalau cron paginya ternyata memang jalan, ' +
          'tim akan menerima rekap yang sama dua kali hari ini.</p>',
        confirmText: 'Kirim sekarang'
      });
      if (!ok) return;

      box.innerHTML = '<p style="color:var(--color-text-muted)">Mengirim…</p>';
      try {
        let jawaban = await jalankanRekapReservasi({ dryRun: false });

        // Penanda anti-kirim-ganda menahan kiriman kedua di hari yang sama.
        // Itu benar untuk cron, dan menjengkelkan untuk orang yang menekan
        // tombol ini justru karena yang pagi tadi tidak sampai — jadi
        // ditanyakan, bukan ditolak diam-diam dan bukan dipaksa diam-diam.
        if (jawaban?.skipped) {
          const paksa = await confirmDialog({
            title: 'Sudah tercatat terkirim hari ini',
            message:
              `<p>${esc(jawaban.reason ?? 'Sudah dikirim.')}</p>` +
              '<p style="margin:6px 0 0">Kirim ulang paksa? Pakai ini kalau penandanya ada tapi pesannya tidak pernah sampai.</p>',
            confirmText: 'Kirim ulang paksa',
            danger: true
          });
          if (!paksa) {
            gambar(diagnosaRekap(jawaban), { dikirim: true });
            return;
          }
          jawaban = await jalankanRekapReservasi({ dryRun: false, force: true });
        }

        const gagal = (jawaban?.telegram ?? []).filter((t) => !t.ok);
        box.innerHTML = `
          <p style="margin:0 0 6px;font-size:0.86rem">${jawaban?.ok ? '✅' : '❌'} <strong>${
            jawaban?.ok ? 'Terkirim' : 'Tidak ada yang terkirim'
          }</strong> · ${Number(jawaban?.total_reservasi) || 0} reservasi · push ${Number(jawaban?.push?.terkirim) || 0}</p>
          ${
            gagal.length
              ? `<ul style="font-size:0.82rem;color:var(--color-danger);padding-left:18px;margin:0">${gagal
                  .map((t) => `<li>${esc(t.outlet)}: ${esc(t.error ?? 'gagal')}</li>`)
                  .join('')}</ul>`
              : `<p style="margin:0;font-size:0.82rem;color:var(--color-text-muted)">${
                  (jawaban?.telegram ?? []).length
                } grup menerima rekapnya.</p>`
          }`;
        toast(jawaban?.ok ? 'Rekap terkirim.' : 'Rekap tidak terkirim — lihat keterangannya.', jawaban?.ok ? 'success' : 'error');
      } catch (error) {
        gambar(diagnosaRekap(null, error), { dikirim: true });
      }
    })
  );
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
