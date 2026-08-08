import { listMyOutlets, listOutletsSayaKelola, PESAN_TANPA_OUTLET_KELOLA } from '../../core/my-outlets.js';
import { renderReservationHotelAdmin } from './reservation.hotel.admin.page.js';
import { toast, confirmDialog, formDialog, shareDialog } from '../../core/ui.js';
import { monthRangeWIB } from '../../core/dates.js';
import { exportTablePDF } from '../../core/pdf.js';
import {
  RES_STATUS,
  RES_BADGE,
  RES_STATUS_OPTIONS,
  SOURCE_LABEL,
  listReservations,
  setReservationStatus,
  getReservationSettings,
  upsertReservationSettings,
  listReservationAreas,
  createReservationArea,
  updateReservationArea,
  deleteReservationArea,
  buildConfirmMessage,
  buildRejectMessage,
  getReservationTerms,
  saveReservationTerms,
  updateReservation,
  uploadDepositProof,
  getDepositProofUrl,
  deleteReservation,
  waNumber
} from './reservation.service.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';
import { formatRupiah } from '../../core/format.js';

const TABS = [
  { key: 'inbox', label: 'Perlu Diproses' },
  { key: 'all', label: 'Semua Reservasi' },
  { key: 'settings', label: 'Pengaturan & Area' }
];

/**
 * Pesan konfirmasi + S&K outlet yang bersangkutan.
 *
 * S&K diambil SAAT AKAN DIKIRIM, bukan ikut dimuat bersama daftar reservasi.
 * Teksnya panjang dan sama untuk semua baris — membawanya di setiap baris hanya
 * memperberat daftar demi sesuatu yang dipakai sekali per pengiriman.
 */
async function pesanKonfirmasi(r) {
  const terms = await getReservationTerms(r.outlet_id).catch(() => '');
  return buildConfirmMessage({ ...r, terms });
}

export async function renderReservationAdminPage(container, { businessUnitId }) {
  // DUA daftar, karena ada dua pertanyaan berbeda di halaman ini:
  //   `outlets`       — yang boleh DILIHAT. Untuk penyaring laporan; menyempitkannya
  //                     akan menghilangkan data yang memang boleh dia baca.
  //   `outletsKelola` — yang boleh DIATUR. Untuk tab Pengaturan dan untuk
  //                     memutuskan tombol aksi mana yang pantas muncul.
  // Menyamakan keduanya selalu merugikan salah satu sisi: kalau dipakai yang
  // sempit, laporannya bolong; kalau dipakai yang lebar, tombolnya ditolak RLS.
  const [outlets, outletsKelola] = await Promise.all([
    listMyOutlets(businessUnitId).catch(() => []),
    listOutletsSayaKelola(businessUnitId)
  ]);

  // Mode ditentukan per OUTLET (kolom `reservation_mode`, migration 0055).
  // Kalau SEMUA outlet yang bisa diakses bermode hotel, seluruh halaman diganti
  // — bukan sekadar menyembunyikan tombol. Alur hotel berbeda secara mendasar:
  // tidak ada antrean persetujuan, dan yang ditanyakan tiap hari adalah siapa
  // datang / keluar / masih menginap, bukan "mana yang perlu di-approve".
  const outletHotel = outlets.filter((o) => o.reservation_mode === 'hotel');
  if (outlets.length && outletHotel.length === outlets.length) {
    // Layar hotel MENULIS booking, jadi yang dikirim daftar yang boleh diatur.
    return renderReservationHotelAdmin(container, {
      businessUnitId,
      outlets: outletsKelola.filter((o) => o.reservation_mode === 'hotel')
    });
  }
  // Campuran (satu BU punya hotel DAN cafe): halaman cafe tetap dipakai, tapi
  // outlet hotel dikeluarkan supaya tidak ada form slot/pax yang muncul untuk
  // outlet yang tidak mengenal konsep itu. Hotelnya diakses lewat BU/outlet
  // yang bersangkutan.
  const outletsCafe = outlets.filter((o) => o.reservation_mode !== 'hotel');

  container.innerHTML = `
    <h1>Reservasi</h1>
    ${
      outletHotel.length
        ? `<p style="font-size:0.8rem;color:var(--color-text-muted);margin:0 0 8px">
             ${outletHotel.length} outlet bermode <strong>hotel</strong> tidak ditampilkan di sini —
             alurnya berbeda. Pilih BU/outlet hotelnya untuk membuka layar booking kamar.
           </p>`
        : ''
    }
    <div class="tab-bar">
      ${TABS.map((t, i) => `<button class="tab-btn ${i === 0 ? 'active' : ''}" data-tab="${t.key}">${t.label}</button>`).join('')}
    </div>
    <div id="rv-admin"></div>
  `;
  const content = container.querySelector('#rv-admin');
  const ctx = {
    businessUnitId,
    outlets: outletsCafe,
    outletsKelola: outletsKelola.filter((o) => o.reservation_mode !== 'hotel'),
    // Dipakai berulang di tiap baris tabel — dijadikan Set sekali, bukan
    // `.some()` di dalam perulangan.
    idKelola: new Set(outletsKelola.filter((o) => o.reservation_mode !== 'hotel').map((o) => o.id))
  };

  async function showTab(key) {
    container.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === key));
    if (key === 'inbox') await renderInbox(content, ctx);
    if (key === 'all') await renderAll(content, ctx);
    if (key === 'settings') await renderSettings(content, ctx);
  }
  container.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  await showTab('inbox');
}

// ---- Tab: Perlu Diproses ----

async function renderInbox(content, ctx) {
  content.innerHTML = loadingHtml('Memuat…', { baris: 5 });
  let rows;
  try {
    // mode: 'cafe' WAJIB — booking hotel tidak pernah berstatus pending, tapi
    // menyaring eksplisit lebih aman daripada bergantung pada asumsi itu.
    rows = await listReservations({ businessUnitId: ctx.businessUnitId, status: 'pending', mode: 'cafe' });
  } catch (error) {
    content.innerHTML = `<p class="error-text">${esc(error.message ?? error)}</p>`;
    return;
  }
  // Yang paling dekat tanggalnya didahulukan — itu yang paling mendesak.
  rows.sort((a, b) => `${a.reserve_date} ${a.reserve_time}`.localeCompare(`${b.reserve_date} ${b.reserve_time}`));

  content.innerHTML = `
    <div class="incoming-highlight${rows.length ? ' has-items' : ''}">
      <div class="incoming-head">
        <h2>🔔 Menunggu Persetujuan${rows.length ? ` <span class="incoming-count">${rows.length}</span>` : ''}</h2>
      </div>
      ${
        rows.length
          ? `<div class="table-scroll" style="margin-top:10px">
               <table class="data-table table-freeze-1">
                 <thead><tr><th>Kode</th><th>Tanggal &amp; Jam</th><th>Customer</th><th>Tamu</th><th>Outlet / Area</th><th>Sumber</th><th>Aksi</th></tr></thead>
                 <tbody>${rows.map((r) => rowHtml(r, ctx.idKelola.has(r.outlet_id))).join('')}</tbody>
               </table>
             </div>
             <p style="font-size:0.78rem;color:var(--color-text-muted);margin:8px 0 0">
               Setelah <strong>Setujui</strong>, dialog WhatsApp terbuka otomatis supaya kamu tinggal mengirim konfirmasi ke customer.
             </p>`
          : '<p class="incoming-empty">Tidak ada reservasi yang menunggu persetujuan. 👍</p>'
      }
    </div>
  `;
  wireActions(content, rows, () => renderInbox(content, ctx));
}

/**
 * @param {object} r
 * @param {boolean} bolehAtur outlet ini termasuk yang boleh dia kelola?
 *
 * Barisnya tetap DITAMPILKAN meski tidak boleh diproses — admin outlet Serpong
 * berhak tahu ada antrean di Sentul, dan menyembunyikannya cuma memindahkan
 * kebingungan. Yang dicabut hanya tombolnya, karena tombol yang pasti ditolak
 * lebih buruk daripada tidak ada tombol.
 */
function rowHtml(r, bolehAtur = true) {
  return `<tr>
    <td style="font-family:ui-monospace,Menlo,monospace;font-size:0.78rem">${esc(r.code ?? '-')}</td>
    <td style="font-size:0.85rem">${fmtDate(r.reserve_date)}<div style="font-weight:600">${String(r.reserve_time).slice(0, 5)}</div></td>
    <td>${esc(r.customer_name)}
      <div style="font-size:0.74rem;color:var(--color-text-muted)">${esc(r.phone)}${r.email ? ` · ${esc(r.email)}` : ''}</div>
      ${r.notes ? `<div style="font-size:0.74rem;color:var(--color-text-muted)">💬 ${esc(r.notes)}</div>` : ''}
      ${r.referral_source ? `<div style="font-size:0.72rem;color:var(--color-text-muted)">tahu dari: ${esc(r.referral_source)}</div>` : ''}</td>
    <td style="text-align:right"><strong>${r.pax}</strong></td>
    <td style="font-size:0.82rem">${esc(r.outlets?.name ?? '-')}
      ${r.reservation_areas?.name ? `<div style="font-size:0.74rem;color:var(--color-text-muted)">${esc(r.reservation_areas.name)}</div>` : ''}</td>
    <td style="font-size:0.78rem">${esc(SOURCE_LABEL[r.source] ?? r.source)}</td>
    <td>
      ${
        bolehAtur
          ? `<button class="primary rv-ok" data-id="${r.id}" style="max-width:110px">Setujui</button>
             <button class="rv-no" data-id="${r.id}">Tolak</button>`
          : `<span style="font-size:0.72rem;color:var(--color-text-muted)" title="Hanya admin outlet ini yang bisa memprosesnya">diproses admin ${esc(r.outlets?.name ?? 'outletnya')}</span>`
      }
      <button class="rv-wa" data-id="${r.id}" title="Buka chat WhatsApp ke ${esc(r.phone)}">💬 WA</button>
    </td>
  </tr>`;
}

function wireActions(host, rows, reload) {
  const byId = (id) => rows.find((r) => r.id === id);

  host.querySelectorAll('.rv-ok').forEach((b) =>
    b.addEventListener('click', sekaliJalan(async () => {
      const r = byId(b.dataset.id);
      const ok = await confirmDialog({
        title: `Setujui reservasi ${r.code ?? ''}?`,
        message: `${r.customer_name} · ${r.pax} tamu · ${fmtDate(r.reserve_date)} ${String(r.reserve_time).slice(0, 5)}`,
        confirmText: 'Setujui'
      });
      if (!ok) return;
      try {
        await setReservationStatus(r.id, 'confirmed');
        toast('Reservasi dikonfirmasi.', 'success');
        // Langsung tawarkan kirim konfirmasi — supaya customer tidak menunggu
        // tanpa kabar hanya karena admin lupa membuka tombol WA.
        await shareDialog({
          title: 'Kirim Konfirmasi ke Customer',
          helper:
            'Nomor WhatsApp dan alamat email diambil otomatis dari formulir reservasi (Staff App maupun website) — admin tidak perlu menyimpan kontak customer lebih dulu.',
          defaultMessage: await pesanKonfirmasi(r),
          phone: waNumber(r.phone),
          email: r.email ?? '',
          subject: `Konfirmasi Reservasi ${r.code ?? ''}`.trim()
        });
        await reload();
      } catch (error) {
        toast(error.message ?? 'Gagal menyetujui.', 'error');
      }
    }))
  );

  host.querySelectorAll('.rv-no').forEach((b) =>
    b.addEventListener('click', async () => {
      const r = byId(b.dataset.id);
      const values = await formDialog({
        title: `Tolak reservasi ${r.code ?? ''}`,
        description: 'Alasan akan tersimpan di riwayat dan ikut di teks WhatsApp.',
        fields: [{ name: 'reason', label: 'Alasan', type: 'text', required: true, placeholder: 'mis. slot penuh, outlet tutup' }],
        submitText: 'Tolak'
      });
      if (!values) return;
      try {
        await setReservationStatus(r.id, 'rejected', values.reason);
        toast('Reservasi ditolak.', 'success');
        await shareDialog({
          title: 'Kabari Customer',
          helper: 'Sampaikan baik-baik dan tawarkan alternatif kalau memungkinkan.',
          defaultMessage: buildRejectMessage(r, values.reason),
          phone: waNumber(r.phone),
          email: r.email ?? '',
          subject: `Reservasi ${r.code ?? ''}`.trim()
        });
        await reload();
      } catch (error) {
        toast(error.message ?? 'Gagal menolak.', 'error');
      }
    })
  );

  host.querySelectorAll('.rv-wa').forEach((b) =>
    // `async` karena S&K diambil dulu sebelum dialognya dibuka. Tanpa itu,
    // `await` di dalam handler biasa adalah SyntaxError yang mematikan seluruh
    // file — dan file yang gagal di-parse membuat halamannya berhenti di
    // "Memuat…" tanpa pesan apa pun.
    b.addEventListener('click', async () => {
      const r = byId(b.dataset.id);
      await shareDialog({
        title: `WhatsApp ke ${r.customer_name}`,
        helper: 'Nomor WhatsApp dan alamat email diambil otomatis dari formulir reservasi — admin tidak perlu menyimpan kontak customer.',
        defaultMessage: await pesanKonfirmasi(r),
        phone: waNumber(r.phone),
        email: r.email ?? '',
        subject: `Konfirmasi Reservasi ${r.code ?? ''}`.trim()
      });
    })
  );

  host.querySelectorAll('.rv-edit').forEach((b) =>
    b.addEventListener('click', sekaliJalan(async () => {
      const r = byId(b.dataset.id);
      const areas = await listReservationAreas(r.outlet_id).catch(() => []);
      const buktiUrl = await getDepositProofUrl(r.deposit_proof_path).catch(() => null);
      const values = await formDialog({
        title: `Koreksi ${r.code ?? 'Reservasi'}`,
        description:
          'Untuk reschedule atau ralat data dari customer. Kuota slot dihitung ulang otomatis kalau tanggal, jam, ' +
          'atau jumlah tamunya berubah — jadi pemindahan ke slot yang sudah penuh akan ditolak, bukan diterima diam-diam.',
        fields: [
          { name: 'customer_name', label: 'Nama customer', type: 'text', required: true, value: r.customer_name ?? '' },
          { name: 'phone', label: 'No. WhatsApp', type: 'tel', required: true, value: r.phone ?? '' },
          { name: 'email', label: 'Email', type: 'email', value: r.email ?? '' },
          { name: 'reserve_date', label: 'Tanggal', type: 'date', required: true, value: r.reserve_date ?? '' },
          { name: 'reserve_time', label: 'Jam', type: 'time', required: true, value: String(r.reserve_time ?? '').slice(0, 5) },
          { name: 'pax', label: 'Jumlah tamu', type: 'number', required: true, min: 1, value: String(r.pax ?? 1) },
          {
            name: 'area_id',
            label: 'Area',
            type: 'select',
            value: r.area_id ?? '',
            options: [{ value: '', label: '-- tidak ditentukan --' }, ...areas.map((a) => ({ value: a.id, label: a.name }))]
          },
          { name: 'notes', label: 'Permintaan khusus', type: 'text', value: r.notes ?? '' },
          {
            name: 'deposit_amount',
            label: 'DP diterima (Rp)',
            type: 'money',
            value: r.deposit_amount ?? '',
            help: buktiUrl ? 'Sudah ada bukti transfer terlampir. Unggah ulang hanya kalau perlu diganti.' : 'Kosongkan kalau belum ada DP.'
          },
          {
            name: 'deposit_proof',
            label: buktiUrl ? 'Ganti foto bukti transfer' : 'Foto bukti transfer',
            type: 'photo',
            facing: 'environment',
            currentUrl: buktiUrl ?? '',
            help: 'Simpan bukti transfernya di sini, bukan di galeri pribadi — saat yang menerima transfer libur, tidak ada yang bisa menjawab berapa DP yang sudah masuk.'
          }
        ],
        submitText: 'Simpan Koreksi'
      });
      if (!values) return;

      try {
        // Foto diunggah DULU supaya path-nya ikut dalam satu koreksi. Kalau
        // unggahannya gagal, tidak ada perubahan sama sekali — lebih baik
        // daripada nominal DP tersimpan tanpa buktinya.
        let path = null;
        if (values.deposit_proof) {
          path = await uploadDepositProof({ outletId: r.outlet_id, reservationId: r.id, file: values.deposit_proof });
        }
        await updateReservation({
          id: r.id,
          name: values.customer_name,
          phone: values.phone,
          email: values.email ?? '',
          date: values.reserve_date,
          time: values.reserve_time,
          pax: Number(values.pax),
          areaId: values.area_id || null,
          notes: values.notes ?? '',
          // Field `money` mengembalikan 0 untuk isian kosong, bukan ''. Di form
          // KOREKSI, kolomnya sudah terisi nilai lama — jadi mengosongkannya
          // adalah niat "DP ini salah, hapus", bukan "biarkan saja". RPC
          // memaknai 0 sebagai penghapusan (0079); tanpa itu DP yang tercatat
          // di reservasi yang keliru tidak akan pernah bisa dicabut.
          deposit: Number(values.deposit_amount) > 0 ? Number(values.deposit_amount) : 0,
          depositProof: path
        });
        toast('Reservasi diperbarui.', 'success');
        await reload();
      } catch (error) {
        toast(error.message ?? 'Gagal menyimpan koreksi.', 'error');
      }
    }))
  );

  host.querySelectorAll('.rv-del').forEach((b) =>
    b.addEventListener('click', sekaliJalan(async () => {
      const r = byId(b.dataset.id);
      const ok = await confirmDialog({
        title: `Hapus reservasi ${r.code ?? ''}?`,
        message:
          `${r.customer_name} · ${r.pax} orang · ${r.reserve_date} ${String(r.reserve_time ?? '').slice(0, 5)}. ` +
          'Data ini hilang permanen dan kursinya langsung kembali ke kuota. ' +
          'Untuk pembatalan biasa, lebih baik ubah statusnya jadi "Dibatalkan" — jejaknya tetap ada untuk rekap.',
        confirmText: 'Hapus permanen',
        danger: true
      });
      if (!ok) return;
      try {
        await deleteReservation(r.id);
        toast('Reservasi dihapus.', 'success');
        await reload();
      } catch (error) {
        toast(error.message ?? 'Gagal menghapus.', 'error');
      }
    }))
  );

  host.querySelectorAll('.rv-status').forEach((sel) =>
    sel.addEventListener('change', async () => {
      try {
        await setReservationStatus(sel.dataset.id, sel.value);
        toast('Status diperbarui.', 'success');
        await reload();
      } catch (error) {
        toast(error.message ?? 'Gagal memperbarui status.', 'error');
        reload();
      }
    })
  );
}

// ---- Tab: Semua Reservasi ----

async function renderAll(content, ctx) {
  const range = monthRangeWIB();
  const state = { outletId: '', status: '', from: range.from, to: range.to };

  content.innerHTML = `
    <div class="inline-card" style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
      <div class="field" style="margin:0;max-width:200px"><label>Outlet</label>
        <select id="ra-outlet"><option value="">Semua outlet</option>${ctx.outlets.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select>
      </div>
      <div class="field" style="margin:0;max-width:180px"><label>Status</label>
        <select id="ra-status"><option value="">Semua status</option>${RES_STATUS_OPTIONS.map((s) => `<option value="${s.value}">${esc(s.label)}</option>`).join('')}</select>
      </div>
      <div class="field" style="margin:0;max-width:165px"><label>Dari tanggal</label><input type="date" id="ra-from" value="${range.from}" /></div>
      <div class="field" style="margin:0;max-width:165px"><label>Sampai tanggal</label><input type="date" id="ra-to" value="${range.to}" /></div>
      <button class="primary" id="ra-go" style="max-width:120px">Tampilkan</button>
      <button id="ra-pdf">⇩ Export PDF</button>
    </div>
    <div id="ra-result" style="margin-top:12px"></div>
  `;

  const result = content.querySelector('#ra-result');
  let last = [];

  const bind = (sel, key) => content.querySelector(sel).addEventListener('change', (e) => (state[key] = e.target.value));
  bind('#ra-outlet', 'outletId');
  bind('#ra-status', 'status');
  bind('#ra-from', 'from');
  bind('#ra-to', 'to');
  content.querySelector('#ra-go').addEventListener('click', go);
  content.querySelector('#ra-pdf').addEventListener('click', exportPdf);

  async function go() {
    result.innerHTML = loadingHtml('Memuat…', { baris: 5 });
    try {
      last = await listReservations({
        businessUnitId: ctx.businessUnitId,
        outletId: state.outletId,
        status: state.status,
        dateFrom: state.from,
        dateTo: state.to,
        mode: 'cafe' // booking hotel punya halamannya sendiri; kolomnya berbeda
      });
    } catch (error) {
      result.innerHTML = `<p class="error-text">${esc(error.message ?? error)}</p>`;
      return;
    }
    const hidup = last.filter((r) => r.status === 'confirmed' || r.status === 'pending');
    result.innerHTML = `
      <p style="font-size:0.82rem;color:var(--color-text-muted);margin:0 0 8px">
        <strong>${last.length}</strong> reservasi · <strong>${hidup.reduce((t, r) => t + (Number(r.pax) || 0), 0)}</strong> tamu aktif
      </p>
      <div class="table-scroll">
        <table class="data-table table-freeze-1">
          <thead><tr><th>Kode</th><th>Tanggal &amp; Jam</th><th>Customer</th><th>Tamu</th><th>Outlet / Area</th><th>Sumber</th><th>Status</th><th>Aksi</th></tr></thead>
          <tbody>
            ${
              last
                .map(
                  (r) => `<tr>
                    <td style="font-family:ui-monospace,Menlo,monospace;font-size:0.78rem">${esc(r.code ?? '-')}</td>
                    <td style="font-size:0.85rem">${fmtDate(r.reserve_date)}<div style="font-weight:600">${String(r.reserve_time).slice(0, 5)}</div></td>
                    <td>${esc(r.customer_name)}<div style="font-size:0.74rem;color:var(--color-text-muted)">${esc(r.phone)}</div></td>
                    <td style="text-align:right">${r.pax}
                      ${
                        r.deposit_amount
                          ? `<div style="font-size:0.7rem;color:var(--color-text-muted)">DP ${esc(formatRupiah(Number(r.deposit_amount)))}${
                              r.deposit_proof_path ? ' 📎' : ''
                            }</div>`
                          : ''
                      }</td>
                    <td style="font-size:0.82rem">${esc(r.outlets?.name ?? '-')}${
                      r.reservation_areas?.name ? `<div style="font-size:0.74rem;color:var(--color-text-muted)">${esc(r.reservation_areas.name)}</div>` : ''
                    }</td>
                    <td style="font-size:0.78rem">${esc(SOURCE_LABEL[r.source] ?? r.source)}</td>
                    <td>
                      ${
                        ctx.idKelola.has(r.outlet_id)
                          ? `<select class="rv-status" data-id="${r.id}">
                               ${RES_STATUS_OPTIONS.map((s) => `<option value="${s.value}"${s.value === r.status ? ' selected' : ''}>${esc(s.label)}</option>`).join('')}
                             </select>`
                          : ''
                      }
                      <div><span class="badge ${RES_BADGE[r.status] ?? ''}" style="font-size:0.65rem">${RES_STATUS[r.status] ?? r.status}</span></div>
                    </td>
                    <td style="white-space:nowrap">
                      <button class="rv-wa" data-id="${r.id}">WA</button>
                      ${
                        ctx.idKelola.has(r.outlet_id)
                          ? `<button class="rv-edit" data-id="${r.id}" title="Koreksi / reschedule">✎</button>
                             <button class="rv-del" data-id="${r.id}" title="Hapus permanen">🗑</button>`
                          : '<span style="font-size:0.72rem;color:var(--color-text-muted)" title="Hanya admin outlet ini yang bisa mengubahnya">— </span>'
                      }
                    </td>
                  </tr>`
                )
                .join('') || '<tr><td colspan="8">Tidak ada data.</td></tr>'
            }
          </tbody>
        </table>
      </div>
      <p style="font-size:0.78rem;color:var(--color-text-muted);margin-top:8px">
        Status bisa diubah langsung lewat dropdown — termasuk menandai <strong>Selesai</strong> atau <strong>Tidak datang</strong> setelah harinya lewat.
      </p>
    `;
    wireActions(result, last, go);
  }

  async function exportPdf() {
    if (!last.length) return toast('Tampilkan datanya dulu.', 'warning');
    try {
      await exportTablePDF({
        title: 'Daftar Reservasi',
        subtitle: `${state.outletId ? ctx.outlets.find((o) => o.id === state.outletId)?.name ?? '-' : 'Semua outlet'} · ${state.from} s/d ${state.to}`,
        columns: [
          { header: 'Kode', width: 1.1 },
          { header: 'Tanggal', width: 1 },
          { header: 'Jam', width: 0.6 },
          { header: 'Customer', width: 1.4 },
          { header: 'Telepon', width: 1.1 },
          { header: 'Tamu', width: 0.5 },
          { header: 'Outlet', width: 1.2 },
          { header: 'Sumber', width: 0.8 },
          { header: 'Status', width: 1 }
        ],
        rows: last.map((r) => [
          r.code ?? '-',
          r.reserve_date,
          String(r.reserve_time).slice(0, 5),
          r.customer_name,
          r.phone,
          String(r.pax),
          r.outlets?.name ?? '-',
          SOURCE_LABEL[r.source] ?? r.source,
          RES_STATUS[r.status] ?? r.status
        ]),
        filename: 'reservasi'
      });
      toast('PDF reservasi terunduh.', 'success');
    } catch (error) {
      toast(error.message ?? 'Gagal membuat PDF.', 'error');
    }
  }

  await go();
}

// ---- Tab: Pengaturan & Area ----

async function renderSettings(content, ctx) {
  // Tab ini MENULIS pengaturan & area outlet. Daftarnya karena itu daftar outlet
  // yang boleh diatur — bukan yang boleh dilihat. Menawarkan outlet yang pasti
  // ditolak RLS hanya melatih orang mengabaikan pesan error.
  if (!ctx.outletsKelola.length) {
    content.innerHTML = ctx.outlets.length
      ? `<p style="color:var(--color-text-muted);max-width:560px;line-height:1.55">${PESAN_TANPA_OUTLET_KELOLA}</p>`
      : `<p style="color:var(--color-text-muted)">Belum ada outlet di BU ini.</p>`;
    return;
  }
  content.innerHTML = `
    <div class="field" style="max-width:280px"><label>Pilih Outlet</label>
      <select id="rs-outlet">${ctx.outletsKelola.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select>
    </div>
    <div id="rs-detail"></div>
  `;
  const sel = content.querySelector('#rs-outlet');
  sel.addEventListener('change', () => drawDetail(content, ctx, sel.value));
  await drawDetail(content, ctx, sel.value);
}

async function drawDetail(content, ctx, outletId) {
  const host = content.querySelector('#rs-detail');
  host.innerHTML = loadingHtml('Memuat…', { baris: 5 });
  const [s, areas] = await Promise.all([
    getReservationSettings(outletId).catch(() => null),
    listReservationAreas(outletId, false).catch(() => [])
  ]);
  const v = (k, d) => s?.[k] ?? d;

  host.innerHTML = `
    <form class="inline-card" id="rs-form" style="max-width:520px;margin-top:16px">
      <h3 style="margin-top:0">Jam &amp; Kapasitas</h3>
      ${
        s
          ? ''
          : '<p style="font-size:0.82rem;color:var(--color-danger);margin-top:0">Outlet ini belum punya pengaturan — reservasi belum bisa dibuat sampai kamu menyimpan form ini.</p>'
      }
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <div class="field" style="max-width:150px"><label>Jam buka</label><input type="time" name="open_time" value="${String(v('open_time', '10:00')).slice(0, 5)}" required /></div>
        <div class="field" style="max-width:150px"><label>Jam tutup</label><input type="time" name="close_time" value="${String(v('close_time', '22:00')).slice(0, 5)}" required /></div>
      </div>
      <div class="field"><label>Panjang slot (menit)</label>
        <input type="number" name="slot_minutes" min="15" max="240" step="15" value="${v('slot_minutes', 60)}" required />
        <span class="field-help">Jam reservasi dibuat otomatis dari jam buka sampai tutup dengan jarak sepanjang ini.</span>
      </div>
      <div class="field"><label>Maksimal tamu per slot</label>
        <input type="number" name="max_pax_per_slot" min="1" value="${v('max_pax_per_slot', 20)}" required />
        <span class="field-help">Rem utama supaya tidak overbooking. Hanya reservasi Menunggu &amp; Dikonfirmasi yang memakan kuota.</span>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <div class="field" style="max-width:200px"><label>Minimal pesan H- (hari)</label><input type="number" name="min_lead_days" min="0" value="${v('min_lead_days', 0)}" /></div>
        <div class="field" style="max-width:200px"><label>Batas jam di hari itu</label><input type="time" name="booking_cutoff_time" value="${String(v('booking_cutoff_time', '') ?? '').slice(0, 5)}" /></div>
      </div>
      <span class="field-help" style="display:block;margin:-6px 0 12px">
        Dihitung per <strong>tanggal kalender</strong>, seperti orang mengucapkan "H-3" — bukan 72 jam.
        Contoh: H-3 dengan batas 17.00 berarti reservasi tanggal 20 ditutup tanggal 17 pukul 17.00; memesan tanggal 16
        malam tetap diterima. Kosongkan jamnya kalau boleh sampai akhir hari. <strong>H-0</strong> berarti hari itu juga
        masih boleh — dan jam batasnya jadi jam tutup pemesanan hari yang sama.
      </span>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <div class="field" style="max-width:200px"><label>Minimal pesan H- (jam)</label><input type="number" name="min_lead_hours" min="0" value="${v('min_lead_hours', 2)}" /></div>
        <div class="field" style="max-width:200px"><label>Paling jauh (hari)</label><input type="number" name="max_days_ahead" min="1" value="${v('max_days_ahead', 60)}" /></div>
      </div>
      <span class="field-help" style="display:block;margin:-6px 0 12px">
        Batas <strong>jam</strong> tetap berlaku berdampingan: jarak sependek ini dari sekarang ke jam reservasinya
        selalu ditolak, walau aturan H- harinya lolos. Keduanya harus terpenuhi.
        <strong>Semua batas ini hanya berlaku di website</strong> — staff tetap bisa mencatat reservasi mendadak
        lewat telepon atau walk-in.
      </span>

      <h3 style="margin-top:18px">Halaman Publik</h3>
      <div class="field field-check">
        <input type="checkbox" id="rs-public" name="is_public_enabled" ${v('is_public_enabled', false) ? 'checked' : ''} />
        <label for="rs-public" style="margin:0">Buka reservasi lewat website</label>
      </div>
      <div class="field"><label>Catatan di halaman publik (opsional)</label>
        <input type="text" name="public_note" value="${escAttr(v('public_note', '') ?? '')}" placeholder="mis. Reservasi di atas 10 orang mohon hubungi kami" />
      </div>
      <div class="field field-check">
        <input type="checkbox" id="rs-auto" name="staff_input_auto_confirm" ${v('staff_input_auto_confirm', false) ? 'checked' : ''} />
        <label for="rs-auto" style="margin:0">Input dari Staff App langsung dikonfirmasi</label>
        <span class="field-help">Kalau dimatikan (default), reservasi dari staff pun tetap perlu disetujui di tab Perlu Diproses.</span>
      </div>

      <h3 style="margin-top:18px">Syarat &amp; Ketentuan</h3>
      <div class="field">
        <label>Teks S&amp;K reservasi outlet ini</label>
        <textarea name="terms" rows="12"
          placeholder="Minimal purchase, ketentuan deposit, lama pemakaian ruangan, dsb.">${esc(v('terms', '') ?? '')}</textarea>
        <span class="field-help">
          Teks ini ikut di <strong>pesan WhatsApp konfirmasi</strong>, tampil di form reservasi Staff App, dan di halaman
          publik. Ditulis per outlet, jadi ketentuan Gading Serpong dan Sentul boleh berbeda. Kosongkan kalau outlet ini
          tidak punya ketentuan khusus.
        </span>
      </div>

      <button class="primary" type="submit" style="max-width:180px">Simpan Pengaturan</button>
      <p class="error-text" id="rs-error"></p>
    </form>

    <div class="inline-card" style="max-width:520px;margin-top:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <h3 style="margin:0">Area Outlet Ini</h3>
        <button id="rs-add-area">+ Tambah Area</button>
      </div>
      <p style="font-size:0.8rem;color:var(--color-text-muted);margin:6px 0 8px">Indoor, outdoor, VIP, smoking — diisi sendiri sesuai outlet.</p>
      <div style="display:flex;flex-wrap:wrap;gap:6px">
        ${
          areas
            .map(
              (a) => `<span class="scope-badge"${a.is_active ? '' : ' style="opacity:.55"'}>${esc(a.name)}
                <button class="rs-ren scope-edit" data-id="${a.id}" data-name="${escAttr(a.name)}">✎</button>
                <button class="rs-del scope-remove" data-id="${a.id}" data-name="${escAttr(a.name)}">✕</button>
              </span>`
            )
            .join('') || '<span style="font-size:0.85rem;color:var(--color-text-muted)">Belum ada area.</span>'
        }
      </div>
    </div>
  `;

  const bu = ctx.businessUnitId;
  host.querySelector('#rs-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await upsertReservationSettings(outletId, bu, {
        open_time: f.open_time.value,
        close_time: f.close_time.value,
        slot_minutes: Number(f.slot_minutes.value),
        max_pax_per_slot: Number(f.max_pax_per_slot.value),
        min_lead_hours: Number(f.min_lead_hours.value) || 0,
        min_lead_days: Number(f.min_lead_days.value) || 0,
        // Kosong = sampai akhir hari, BUKAN 00:00. Menyimpan '' apa adanya akan
        // ditolak Postgres sebagai `time`; menyimpan '00:00' justru menutup
        // pemesanan sepanjang hari batas — kebalikan dari yang dimaksud.
        booking_cutoff_time: f.booking_cutoff_time.value || null,
        max_days_ahead: Number(f.max_days_ahead.value) || 60,
        is_public_enabled: f.is_public_enabled.checked,
        staff_input_auto_confirm: f.staff_input_auto_confirm.checked,
        public_note: f.public_note.value.trim() || null,
        terms: f.terms.value.trim() || null
      });
      toast('Pengaturan reservasi disimpan.', 'success');
      await drawDetail(content, ctx, outletId);
    } catch (error) {
      host.querySelector('#rs-error').textContent = error.message ?? 'Gagal menyimpan.';
      toast(error.message ?? 'Gagal menyimpan.', 'error');
    }
  });

  host.querySelector('#rs-add-area').addEventListener('click', sekaliJalan(async () => {
    const values = await formDialog({
      title: 'Tambah Area',
      fields: [{ name: 'name', label: 'Nama area', type: 'text', required: true, placeholder: 'mis. Outdoor' }],
      submitText: 'Tambah'
    });
    if (!values) return;
    try {
      await createReservationArea({ outletId, businessUnitId: bu, name: values.name });
      toast('Area ditambahkan.', 'success');
      await drawDetail(content, ctx, outletId);
    } catch (error) {
      toast(error.message ?? 'Gagal menambah area.', 'error');
    }
  }));

  host.querySelectorAll('.rs-ren').forEach((b) =>
    b.addEventListener('click', sekaliJalan(async () => {
      const values = await formDialog({
        title: 'Ubah Nama Area',
        fields: [
          { name: 'name', label: 'Nama area', type: 'text', required: true, value: b.dataset.name },
          { name: 'is_active', label: 'Aktif', type: 'checkbox', value: true }
        ],
        submitText: 'Simpan'
      });
      if (!values) return;
      try {
        await updateReservationArea(b.dataset.id, { name: values.name, is_active: values.is_active });
        toast('Area diperbarui.', 'success');
        await drawDetail(content, ctx, outletId);
      } catch (error) {
        toast(error.message ?? 'Gagal memperbarui.', 'error');
      }
    }))
  );

  host.querySelectorAll('.rs-del').forEach((b) =>
    b.addEventListener('click', sekaliJalan(async () => {
      const ok = await confirmDialog({
        title: `Hapus area "${b.dataset.name}"?`,
        message: 'Reservasi lama yang memakai area ini tetap tersimpan, hanya kolom areanya jadi kosong.',
        confirmText: 'Hapus',
        danger: true
      });
      if (!ok) return;
      try {
        await deleteReservationArea(b.dataset.id);
        toast('Area dihapus.', 'success');
        await drawDetail(content, ctx, outletId);
      } catch (error) {
        toast(error.message ?? 'Gagal menghapus.', 'error');
      }
    }))
  );
}

function fmtDate(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escAttr(s) {
  return esc(s);
}
