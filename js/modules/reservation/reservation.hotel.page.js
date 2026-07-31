import { escapeHtml, formDialog, toast } from '../../core/ui.js';
import { todayWIB } from '../../core/dates.js';
import { RES_STATUS, RES_BADGE, getHotelHarian, jumlahMalam, staffCheckIn } from './reservation.service.js';

/**
 * Reservasi Hotel — Staff App.
 *
 * Isinya menjawab pertanyaan operasional harian: siapa datang hari ini, siapa
 * keluar, siapa masih di dalam. Satu-satunya tindakan yang bisa dilakukan staff
 * adalah MENCENTANG bahwa tamu sudah datang (check-in).
 *
 * Yang TIDAK ada di sini, dan alasannya:
 *   - Booking baru & Edit -> diisi admin di Admin Portal.
 *   - Check-out -> melepas kamar sehingga bisa dipesan orang lain. Kalau salah
 *     tekan, kamar tamu yang masih menginap bisa terjual. Ditahan di admin.
 *
 * Ceklis check-in memakai RPC `staff_check_in_booking`, bukan update langsung:
 * RLS bekerja per BARIS, jadi mengizinkan staff meng-update baris booking sama
 * dengan mengizinkannya mengubah tanggal, tipe kamar, dan nama tamu juga.
 */
export async function renderReservationHotelPage(container, { businessUnitId, outlets }) {
  const hariIni = todayWIB();
  const state = { outletId: outlets[0].id, tanggal: hariIni };

  container.innerHTML = `
    <h1>Reservasi Hotel</h1>
    <p style="font-size:0.8rem;color:var(--color-text-muted);margin:0 0 10px">
      Centang tamu yang sudah datang untuk menandai <strong>check-in</strong>.
      Booking baru dan check-out dikerjakan lewat Admin Portal.
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
    const belum = data.datang.filter((r) => r.status === 'confirmed').length;

    body.innerHTML = `
      <p style="font-size:0.82rem;color:var(--color-text-muted);margin:0 0 10px">
        <strong>${data.datang.length}</strong> check-in ·
        <strong>${data.keluar.length}</strong> check-out ·
        <strong>${data.menginap.length}</strong> menginap
        ${belum ? ` · <span style="color:var(--color-danger)"><strong>${belum}</strong> belum datang</span>` : ''}
      </p>
      ${kartu('🛎️ Datang hari ini', data.datang, 'Tidak ada tamu yang dijadwalkan datang.', true)}
      ${kartu('🧳 Keluar hari ini', data.keluar, 'Tidak ada tamu yang dijadwalkan keluar.')}
      ${kartu('🛏️ Sedang menginap', data.menginap, 'Tidak ada tamu yang menginap.')}
      ${total === 0 ? '<p style="color:var(--color-text-muted);font-size:0.85rem">Hotel kosong pada tanggal ini.</p>' : ''}
    `;

    wireCeklis(body, data.datang, gambar);
  }

  await gambar();
}

/**
 * Ceklis check-in. Sekali dicentang TIDAK bisa dibatalkan dari sini — membatalkan
 * check-in berarti mengembalikan status, dan itu keputusan yang pantas ditahan
 * di admin. Karena itu setelah tercentang, kotaknya dinonaktifkan dan diganti
 * keterangan siapa yang menandai serta jamnya.
 */
function wireCeklis(host, rows, reload) {
  host.querySelectorAll('.rh-checkin').forEach((box) =>
    box.addEventListener('change', async () => {
      const r = rows.find((x) => x.id === box.dataset.id);
      if (!r) return;

      // Dikembalikan dulu ke posisi semula: centangnya baru sah setelah
      // servernya menerima. Kalau dibiarkan tercentang lalu gagal, staff
      // terlanjur mengira tamunya sudah tercatat.
      box.checked = false;
      box.disabled = true;

      const values = await formDialog({
        title: `Check-in — ${r.customer_name}`,
        description: `${r.room_types?.name ?? 'Kamar'} · ${fmtSingkat(r.check_in)} → ${fmtSingkat(r.check_out)}`,
        fields: [
          {
            name: 'room_no',
            label: 'Nomor kamar',
            type: 'text',
            value: r.room_no ?? '',
            placeholder: 'mis. 201',
            help: 'Boleh dikosongkan kalau nomornya belum ditentukan.'
          }
        ],
        submitText: 'Tandai Check-in'
      });

      if (!values) {
        box.disabled = false;
        return;
      }

      try {
        await staffCheckIn(r.id, values.room_no);
        toast(`${r.customer_name} ditandai sudah check-in.`, 'success');
        await reload();
      } catch (error) {
        box.disabled = false;
        toast(error.message ?? 'Gagal menandai check-in.', 'error');
      }
    })
  );
}

function kartu(judul, rows, kosong, bisaCeklis = false) {
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
          (r) => `<div style="display:flex;gap:10px;align-items:flex-start;border-bottom:1px solid var(--color-border,#eee);padding-bottom:6px">
            ${bisaCeklis ? kotakCeklis(r) : ''}
            <span style="flex:1;min-width:0">
              <span style="font-weight:600">${escapeHtml(r.customer_name)}</span>
              <span class="badge ${RES_BADGE[r.status] ?? ''}" style="font-size:0.64rem;margin-left:4px">${escapeHtml(RES_STATUS[r.status] ?? r.status)}</span>
              <div style="font-size:0.76rem;color:var(--color-text-muted)">
                ${escapeHtml(r.room_types?.name ?? '-')}${r.room_no ? ` · kamar ${escapeHtml(r.room_no)}` : ''} ·
                ${r.adults ?? 1} dewasa${r.children ? ` + ${r.children} anak` : ''}
              </div>
              ${r.notes ? `<div style="font-size:0.74rem;color:var(--color-text-muted)">💬 ${escapeHtml(r.notes)}</div>` : ''}
              ${
                r.status === 'checked_in' && r.checked_in_at
                  ? `<div style="font-size:0.72rem;color:var(--color-text-muted)">✅ ditandai ${fmtJam(r.checked_in_at)}${
                      r.penanda?.full_name ? ` oleh ${escapeHtml(r.penanda.full_name)}` : ''
                    }</div>`
                  : ''
              }
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

function kotakCeklis(r) {
  // Hanya booking berstatus `confirmed` yang bisa dicentang. Yang sudah
  // check-in ditampilkan tercentang & terkunci; yang batal/no-show tidak
  // menampilkan kotak sama sekali supaya tidak terlihat seolah bisa diproses.
  if (r.status === 'checked_in') {
    return `<input type="checkbox" checked disabled title="Sudah check-in — pembatalan lewat Admin Portal"
      style="margin-top:3px;width:20px;height:20px;flex-shrink:0" />`;
  }
  if (r.status !== 'confirmed') return `<span style="width:20px;flex-shrink:0"></span>`;
  return `<input type="checkbox" class="rh-checkin" data-id="${escapeHtml(r.id)}"
    title="Tandai tamu sudah datang" style="margin-top:3px;width:20px;height:20px;flex-shrink:0" />`;
}

function fmtJam(iso) {
  return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });
}

function fmtSingkat(d) {
  if (!d) return '-';
  return new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
}
