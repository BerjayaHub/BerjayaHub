import { escapeHtml } from '../../core/ui.js';
import { todayWIB } from '../../core/dates.js';
import { RES_STATUS, RES_BADGE, getHotelHarian, jumlahMalam } from './reservation.service.js';

/**
 * Reservasi Hotel — Staff App. HANYA INFORMASI, tidak ada tombol input.
 *
 * Booking hotel diisi admin lewat Admin Portal, jadi di sini tidak ada tombol
 * "Booking Baru", tidak ada Check-in/Check-out, dan tidak ada Edit. Bukan
 * karena disembunyikan — RLS `reservations_insert_staff` memang mensyaratkan
 * mode cafe lewat constraint `reservations_hotel_bukan_dari_web`, dan
 * perubahan status hanya boleh admin outlet. Menampilkan tombol yang pasti
 * ditolak hanya melatih staff mengabaikan pesan error.
 *
 * Yang ditampilkan adalah pertanyaan operasional harian: siapa datang hari ini,
 * siapa keluar, siapa masih di dalam.
 */
export async function renderReservationHotelPage(container, { businessUnitId, outlets }) {
  const hariIni = todayWIB();
  const state = { outletId: outlets[0].id, tanggal: hariIni };

  container.innerHTML = `
    <h1>Reservasi Hotel</h1>
    <p style="font-size:0.8rem;color:var(--color-text-muted);margin:0 0 10px">
      Tampilan informasi. Booking baru, check-in, dan check-out dikerjakan lewat Admin Portal.
    </p>

    <div class="inline-card" style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
      ${
        outlets.length > 1
          ? `<div class="field" style="margin:0;max-width:220px"><label>Outlet</label>
               <select id="rh-outlet">${outlets.map((o) => `<option value="${escapeHtml(o.id)}">${escapeHtml(o.name)}</option>`).join('')}</select>
             </div>`
          : ''
      }
      <div class="field" style="margin:0;max-width:170px"><label>Tanggal</label>
        <input type="date" id="rh-tgl" value="${escapeHtml(hariIni)}" />
      </div>
      <button id="rh-today">Hari ini</button>
    </div>

    <div id="rh-body" style="margin-top:12px"></div>
  `;

  const body = container.querySelector('#rh-body');
  container.querySelector('#rh-outlet')?.addEventListener('change', (e) => {
    state.outletId = e.target.value;
    gambar();
  });
  container.querySelector('#rh-tgl').addEventListener('change', (e) => {
    state.tanggal = e.target.value || hariIni;
    gambar();
  });
  container.querySelector('#rh-today').addEventListener('click', () => {
    state.tanggal = hariIni;
    container.querySelector('#rh-tgl').value = hariIni;
    gambar();
  });

  async function gambar() {
    body.innerHTML = `<p style="color:var(--color-text-muted)">Memuat…</p>`;
    let data;
    try {
      data = await getHotelHarian({ businessUnitId, outletId: state.outletId, date: state.tanggal });
    } catch (error) {
      body.innerHTML = `<p class="error-text">${escapeHtml(error.message ?? error)}</p>`;
      return;
    }

    const total = data.datang.length + data.keluar.length + data.menginap.length;
    body.innerHTML = `
      <p style="font-size:0.82rem;color:var(--color-text-muted);margin:0 0 10px">
        <strong>${data.datang.length}</strong> check-in ·
        <strong>${data.keluar.length}</strong> check-out ·
        <strong>${data.menginap.length}</strong> menginap
      </p>
      ${kartu('🛎️ Datang hari ini', data.datang, 'Tidak ada tamu yang dijadwalkan datang.')}
      ${kartu('🧳 Keluar hari ini', data.keluar, 'Tidak ada tamu yang dijadwalkan keluar.')}
      ${kartu('🛏️ Sedang menginap', data.menginap, 'Tidak ada tamu yang menginap.')}
      ${total === 0 ? '<p style="color:var(--color-text-muted);font-size:0.85rem">Hotel kosong pada tanggal ini.</p>' : ''}
    `;
  }

  await gambar();
}

function kartu(judul, rows, kosong) {
  if (!rows.length) {
    return `<div class="inline-card" style="margin-bottom:10px">
      <h2 style="font-size:0.95rem;margin:0 0 4px">${judul}</h2>
      <p style="color:var(--color-text-muted);font-size:0.82rem;margin:0">${kosong}</p>
    </div>`;
  }
  return `<div class="inline-card" style="margin-bottom:10px">
    <h2 style="font-size:0.95rem;margin:0 0 8px">${judul} <span class="incoming-count">${rows.length}</span></h2>
    <div style="display:flex;flex-direction:column;gap:8px">
      ${rows
        .map(
          (r) => `<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;border-bottom:1px solid var(--color-border,#eee);padding-bottom:6px">
            <span style="flex:1;min-width:0">
              <span style="font-weight:600">${escapeHtml(r.customer_name)}</span>
              <span class="badge ${RES_BADGE[r.status] ?? ''}" style="font-size:0.64rem;margin-left:4px">${escapeHtml(RES_STATUS[r.status] ?? r.status)}</span>
              <div style="font-size:0.76rem;color:var(--color-text-muted)">
                ${escapeHtml(r.room_types?.name ?? '-')}${r.room_no ? ` · kamar ${escapeHtml(r.room_no)}` : ''} ·
                ${r.adults ?? 1} dewasa${r.children ? ` + ${r.children} anak` : ''}
              </div>
              ${r.notes ? `<div style="font-size:0.74rem;color:var(--color-text-muted)">💬 ${escapeHtml(r.notes)}</div>` : ''}
            </span>
            <span style="font-size:0.74rem;color:var(--color-text-muted);text-align:right;white-space:nowrap">
              ${fmtSingkat(r.check_in)} → ${fmtSingkat(r.check_out)}
              <div>${jumlahMalam(r.check_in, r.check_out)} malam</div>
            </span>
          </div>`
        )
        .join('')}
    </div>
  </div>`;
}

function fmtSingkat(d) {
  if (!d) return '-';
  return new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
}
