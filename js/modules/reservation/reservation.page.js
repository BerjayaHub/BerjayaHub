import { listMyOutlets } from '../../core/my-outlets.js';
import { renderReservationHotelPage } from './reservation.hotel.page.js';
import { toast, formDialog } from '../../core/ui.js';
import { todayWIB } from '../../core/dates.js';
import {
  RES_STATUS,
  RES_BADGE,
  SOURCE_LABEL,
  listReservationAreas,
  getAvailability,
  createReservation,
  listReservations
} from './reservation.service.js';
import { loadingHtml } from '../../core/loading.js';

/**
 * Reservasi — Staff App.
 * Staff mencatat reservasi (telepon/WA/walk-in) lalu melihat riwayatnya inline.
 * Kuota slot divalidasi di database (RPC `create_reservation`), bukan di sini,
 * supaya dua staff yang menyimpan bersamaan tidak sama-sama lolos.
 */
export async function renderReservationPage(container, { businessUnitId }) {
  container.innerHTML = loadingHtml('Memuat reservasi…');

  const semua = await listMyOutlets(businessUnitId).catch(() => []);
  // `semua` sudah hasil listMyOutlets() -> jangan disaring dua kali, dan JANGAN
  // fallback ke `semua` saat gagal (itu justru membuka yang seharusnya tertutup).
  if (!semua.length) {
    container.innerHTML = `<h1>Reservasi</h1><p style="color:var(--color-text-muted)">Belum ada outlet yang bisa kamu akses di BU ini.</p>`;
    return;
  }

  // Outlet bermode hotel memakai halaman lain: hanya informasi, tanpa input.
  // Booking hotel diisi admin di Admin Portal — menampilkan form slot/pax untuk
  // outlet hotel akan salah, dan menampilkan tombol simpan yang pasti ditolak
  // RLS hanya melatih staff mengabaikan pesan error.
  const outletHotel = semua.filter((o) => o.reservation_mode === 'hotel');
  const outlets = semua.filter((o) => o.reservation_mode !== 'hotel');
  if (outletHotel.length && !outlets.length) {
    return renderReservationHotelPage(container, { businessUnitId, outlets: outletHotel });
  }

  // Default HARI INI, bukan sebulan penuh: yang dibutuhkan staff saat membuka
  // halaman ini adalah tamu yang datang hari ini, bukan riwayat sebulan.
  const hariIni = todayWIB();
  const state = { outletId: outlets[0].id, from: hariIni, to: hariIni };

  container.innerHTML = `
    <div class="page-header">
      <h1 style="margin:0">Reservasi</h1>
      <button class="primary" id="rv-new" style="max-width:200px">+ Reservasi Baru</button>
    </div>

    <div class="inline-card" style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
      <div class="field" style="margin:0;max-width:220px"><label>Outlet</label>
        <select id="rv-outlet">${outlets.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select>
      </div>
      <div class="field" style="margin:0;max-width:165px"><label>Dari tanggal</label><input type="date" id="rv-from" value="${hariIni}" /></div>
      <div class="field" style="margin:0;max-width:165px"><label>Sampai tanggal</label><input type="date" id="rv-to" value="${hariIni}" /></div>
      <button class="primary" id="rv-refresh" style="max-width:120px">Tampilkan</button>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="rv-quick" data-range="today">Hari ini</button>
        <button class="rv-quick" data-range="tomorrow">Besok</button>
        <button class="rv-quick" data-range="week">7 hari</button>
        <button class="rv-quick" data-range="month">Bulan ini</button>
      </div>
    </div>

    <div id="rv-list" style="margin-top:12px"></div>
  `;

  const list = container.querySelector('#rv-list');
  container.querySelector('#rv-outlet').addEventListener('change', (e) => {
    state.outletId = e.target.value;
    refresh();
  });
  container.querySelector('#rv-from').addEventListener('change', (e) => (state.from = e.target.value));
  container.querySelector('#rv-to').addEventListener('change', (e) => (state.to = e.target.value));
  container.querySelector('#rv-refresh').addEventListener('click', refresh);
  container.querySelector('#rv-new').addEventListener('click', openForm);

  // Pintasan rentang — rentang lain tetap bisa diisi manual lewat dua kolom tanggal.
  container.querySelectorAll('.rv-quick').forEach((b) =>
    b.addEventListener('click', () => {
      const t = todayWIB();
      const geser = (n) => {
        const d = new Date(t + 'T00:00:00');
        d.setDate(d.getDate() + n);
        const pad = (x) => String(x).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      };
      if (b.dataset.range === 'today') [state.from, state.to] = [t, t];
      if (b.dataset.range === 'tomorrow') [state.from, state.to] = [geser(1), geser(1)];
      if (b.dataset.range === 'week') [state.from, state.to] = [t, geser(6)];
      if (b.dataset.range === 'month') [state.from, state.to] = [t.slice(0, 8) + '01', geser(0)];
      container.querySelector('#rv-from').value = state.from;
      container.querySelector('#rv-to').value = state.to;
      refresh();
    })
  );

  async function refresh() {
    list.innerHTML = loadingHtml('Memuat…', { baris: 5 });
    let rows;
    try {
      rows = await listReservations({ businessUnitId, outletId: state.outletId, dateFrom: state.from, dateTo: state.to, mode: 'cafe' });
    } catch (error) {
      list.innerHTML = `<p class="error-text">${esc(error.message ?? error)}</p>`;
      return;
    }
    const tamu = rows.filter((r) => r.status === 'confirmed' || r.status === 'pending').reduce((t, r) => t + (Number(r.pax) || 0), 0);
    list.innerHTML = `
      <p style="font-size:0.82rem;color:var(--color-text-muted);margin:0 0 8px">
        ${state.from === state.to ? fmtDate(state.from) : `${fmtDate(state.from)} – ${fmtDate(state.to)}`} ·
        <strong>${rows.length}</strong> reservasi · <strong>${tamu}</strong> tamu (menunggu + dikonfirmasi)
      </p>
      <div class="table-scroll">
        <table class="data-table table-freeze-1">
          <thead><tr><th>Kode</th><th>Tanggal &amp; Jam</th><th>Customer</th><th>Tamu</th><th>Area</th><th>Sumber</th><th>Status</th></tr></thead>
          <tbody>
            ${
              rows
                .map(
                  (r) => `<tr>
                    <td style="font-family:ui-monospace,Menlo,monospace;font-size:0.78rem">${esc(r.code ?? '-')}</td>
                    <td style="font-size:0.85rem">${fmtDate(r.reserve_date)}
                      <div style="font-weight:600">${String(r.reserve_time).slice(0, 5)}</div></td>
                    <td>${esc(r.customer_name)}
                      <div style="font-size:0.74rem;color:var(--color-text-muted)">${esc(r.phone)}</div>
                      ${r.notes ? `<div style="font-size:0.74rem;color:var(--color-text-muted)">💬 ${esc(r.notes)}</div>` : ''}</td>
                    <td style="text-align:right">${r.pax}</td>
                    <td style="font-size:0.82rem">${esc(r.reservation_areas?.name ?? '-')}</td>
                    <td style="font-size:0.78rem">${esc(SOURCE_LABEL[r.source] ?? r.source)}</td>
                    <td><span class="badge ${RES_BADGE[r.status] ?? ''}">${RES_STATUS[r.status] ?? r.status}</span>
                      ${r.review_note ? `<div style="font-size:0.72rem;color:var(--color-text-muted)">${esc(r.review_note)}</div>` : ''}</td>
                  </tr>`
                )
                .join('') || '<tr><td colspan="7">Belum ada reservasi pada rentang ini.</td></tr>'
            }
          </tbody>
        </table>
      </div>
    `;
  }

  async function openForm() {
    const areas = await listReservationAreas(state.outletId).catch(() => []);
    // Slot dimuat ulang tiap kali tanggal berganti supaya sisa kuotanya akurat.
    const slotOptions = [{ value: '', label: 'pilih tanggal dulu…' }];

    const values = await formDialog({
      title: 'Reservasi Baru',
      description: `Outlet: ${outlets.find((o) => o.id === state.outletId)?.name ?? '-'}. Slot yang penuh atau sudah lewat batas waktu tidak akan muncul.`,
      fields: [
        { name: 'customer_name', label: 'Nama customer', type: 'text', required: true },
        { name: 'phone', label: 'No. WhatsApp', type: 'tel', required: true, placeholder: '0812xxxxxxx' },
        { name: 'email', label: 'Email (opsional)', type: 'email' },
        { name: 'reserve_date', label: 'Tanggal', type: 'date', required: true, value: todayWIB() },
        { name: 'reserve_time', label: 'Jam', type: 'select', required: true, options: slotOptions },
        { name: 'pax', label: 'Jumlah tamu', type: 'number', required: true, min: 1, value: '2' },
        {
          name: 'area_id',
          label: 'Area',
          type: 'select',
          options: [{ value: '', label: '-- tidak ditentukan --' }, ...areas.map((a) => ({ value: a.id, label: a.name }))]
        },
        { name: 'referral_source', label: 'Tahu dari mana (opsional)', type: 'text', placeholder: 'Instagram, teman, Google Maps…' },
        { name: 'notes', label: 'Permintaan khusus (opsional)', type: 'text', placeholder: 'ulang tahun, kursi bayi, alergi…' }
      ],
      submitText: 'Simpan Reservasi',
      onReady: (form, { setError }) => {
        const tgl = form.elements['reserve_date'];
        const jam = form.elements['reserve_time'];

        const muatSlot = async () => {
          jam.innerHTML = `<option value="">memuat…</option>`;
          try {
            const slots = await getAvailability(state.outletId, tgl.value);
            const open = slots.filter((s) => s.is_open);
            jam.innerHTML = open.length
              ? open
                  .map(
                    (s) =>
                      `<option value="${String(s.slot_time).slice(0, 5)}">${String(s.slot_time).slice(0, 5)} — sisa ${
                        s.max_pax - s.used_pax
                      } kursi</option>`
                  )
                  .join('')
              : `<option value="">tidak ada slot tersedia</option>`;
            setError(
              open.length ? '' : 'Tanggal ini penuh, di luar jam operasional, atau pengaturan reservasi outlet belum diisi admin.'
            );
          } catch (e) {
            jam.innerHTML = `<option value="">gagal memuat slot</option>`;
            setError(e.message ?? String(e));
          }
        };

        tgl.addEventListener('change', muatSlot);
        muatSlot();
      }
    });
    if (!values) return;
    if (!values.reserve_time) return toast('Pilih jam yang tersedia dulu.', 'warning');

    try {
      const row = await createReservation({
        outletId: state.outletId,
        name: values.customer_name,
        phone: values.phone,
        date: values.reserve_date,
        time: values.reserve_time,
        pax: Number(values.pax),
        areaId: values.area_id,
        email: values.email,
        notes: values.notes,
        referral: values.referral_source
      });
      toast(`Reservasi ${row?.code ?? ''} tersimpan.`, 'success');
      await refresh();
    } catch (error) {
      toast(error.message ?? 'Gagal menyimpan reservasi.', 'error');
    }
  }

  await refresh();
}

function fmtDate(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
