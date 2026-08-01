import { toast, confirmDialog, formDialog, shareDialog, escapeHtml } from '../../core/ui.js';
import { monthRangeWIB } from '../../core/dates.js';
import { exportTablePDF } from '../../core/pdf.js';
import {
  RES_STATUS,
  RES_BADGE,
  RES_STATUS_OPTIONS_HOTEL,
  listReservations,
  listRoomTypes,
  saveRoomType,
  deleteRoomType,
  getRoomAvailability,
  createHotelBooking,
  updateHotelBooking,
  checkInBooking,
  checkOutBooking,
  cancelHotelBooking,
  deleteReservation,
  getHotelHarian,
  jumlahMalam,
  buildConfirmMessage,
  waNumber
} from './reservation.service.js';

/**
 * Admin Portal — mode HOTEL.
 *
 * Bedanya dengan mode cafe bukan cuma tampilan: di sini TIDAK ADA antrean
 * persetujuan. Yang mengisi adalah admin sendiri, jadi booking langsung
 * berstatus Dikonfirmasi. Karena itu tab pertamanya bukan "Perlu Diproses"
 * melainkan layar harian resepsionis — pertanyaan yang benar-benar ditanyakan
 * tiap pagi: siapa datang, siapa keluar, siapa masih di dalam.
 */

const TABS = [
  { key: 'harian', label: 'Hari Ini' },
  { key: 'semua', label: 'Semua Booking' },
  { key: 'kamar', label: 'Tipe Kamar' }
];

const hariIni = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });

export async function renderReservationHotelAdmin(container, ctx) {
  const { businessUnitId, outlets } = ctx;
  container.innerHTML = `
    <h1>Reservasi Hotel</h1>
    <div class="tab-bar">
      ${TABS.map((t, i) => `<button class="tab-btn ${i === 0 ? 'active' : ''}" data-htab="${t.key}">${t.label}</button>`).join('')}
    </div>
    <div id="hv-content"></div>
  `;
  const content = container.querySelector('#hv-content');
  const state = { outletId: outlets[0]?.id ?? '', tanggal: hariIni() };

  async function showTab(key) {
    container.querySelectorAll('[data-htab]').forEach((b) => b.classList.toggle('active', b.dataset.htab === key));
    if (key === 'harian') await tabHarian(content, { businessUnitId, outlets, state });
    if (key === 'semua') await tabSemua(content, { businessUnitId, outlets, state });
    if (key === 'kamar') await tabKamar(content, { businessUnitId, outlets, state });
  }
  container.querySelectorAll('[data-htab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.htab)));
  await showTab('harian');
}

// ---------------------------------------------------------
// Tab: Hari Ini
// ---------------------------------------------------------

async function tabHarian(content, ctx) {
  const { businessUnitId, outlets, state } = ctx;
  content.innerHTML = `
    <div class="inline-card" style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
      <div class="field" style="margin:0;max-width:220px"><label>Outlet</label>
        <select id="hv-outlet">${outlets.map((o) => `<option value="${escapeHtml(o.id)}"${o.id === state.outletId ? ' selected' : ''}>${escapeHtml(o.name)}</option>`).join('')}</select>
      </div>
      <div class="field" style="margin:0;max-width:170px"><label>Tanggal</label>
        <input type="date" id="hv-tgl" value="${escapeHtml(state.tanggal)}" />
      </div>
      <button id="hv-today">Hari ini</button>
      <button class="primary" id="hv-new" style="max-width:170px">+ Booking Baru</button>
    </div>
    <div id="hv-harian"></div>
  `;
  const host = content.querySelector('#hv-harian');

  content.querySelector('#hv-outlet').addEventListener('change', (e) => {
    state.outletId = e.target.value;
    gambar();
  });
  content.querySelector('#hv-tgl').addEventListener('change', (e) => {
    state.tanggal = e.target.value || hariIni();
    gambar();
  });
  content.querySelector('#hv-today').addEventListener('click', () => {
    state.tanggal = hariIni();
    content.querySelector('#hv-tgl').value = state.tanggal;
    gambar();
  });
  content.querySelector('#hv-new').addEventListener('click', () => formBooking(null, ctx, gambar));

  async function gambar() {
    host.innerHTML = `<p style="color:var(--color-text-muted)">Memuat…</p>`;
    let data;
    try {
      data = await getHotelHarian({ businessUnitId, outletId: state.outletId, date: state.tanggal });
    } catch (error) {
      host.innerHTML = `<p class="error-text">${escapeHtml(error.message ?? error)}</p>`;
      return;
    }

    host.innerHTML = `
      ${blok('🛎️ Check-in hari ini', data.datang, 'Belum ada tamu yang dijadwalkan datang.')}
      ${blok('🧳 Check-out hari ini', data.keluar, 'Tidak ada tamu yang dijadwalkan keluar.')}
      ${blok('🛏️ Sedang menginap', data.menginap, 'Tidak ada tamu yang menginap malam ini.')}
    `;
    wireAksi(host, [...data.datang, ...data.keluar, ...data.menginap], ctx, gambar);
  }

  await gambar();
}

function blok(judul, rows, kosong) {
  return `
    <div class="inline-card" style="margin-top:12px">
      <h2 style="font-size:0.98rem;margin:0 0 8px">${judul}${rows.length ? ` <span class="incoming-count">${rows.length}</span>` : ''}</h2>
      ${
        rows.length
          ? `<div class="table-scroll"><table class="data-table">
              <thead><tr><th>Kode</th><th>Tamu</th><th>Tipe / Kamar</th><th>Menginap</th><th>Status</th><th>Aksi</th></tr></thead>
              <tbody>${rows.map(barisTamu).join('')}</tbody>
            </table></div>`
          : `<p style="color:var(--color-text-muted);font-size:0.85rem;margin:0">${kosong}</p>`
      }
    </div>`;
}

function barisTamu(r) {
  const malam = jumlahMalam(r.check_in, r.check_out);
  return `<tr>
    <td style="font-family:ui-monospace,Menlo,monospace;font-size:0.76rem">${escapeHtml(r.code ?? '-')}</td>
    <td>${escapeHtml(r.customer_name)}
      <div style="font-size:0.74rem;color:var(--color-text-muted)">${escapeHtml(r.phone)}</div>
      ${r.notes ? `<div style="font-size:0.72rem;color:var(--color-text-muted)">💬 ${escapeHtml(r.notes)}</div>` : ''}</td>
    <td style="font-size:0.84rem">${escapeHtml(r.room_types?.name ?? '-')}
      <div style="font-weight:600">${r.room_no ? escapeHtml(r.room_no) : '<span style="color:var(--color-text-muted);font-weight:400">nomor belum diisi</span>'}</div></td>
    <td style="font-size:0.82rem">${fmtSingkat(r.check_in)} → ${fmtSingkat(r.check_out)}
      <div style="color:var(--color-text-muted)">${malam} malam · ${r.adults ?? 1} dewasa${r.children ? ` + ${r.children} anak` : ''}</div></td>
    <td><span class="badge ${RES_BADGE[r.status] ?? ''}">${escapeHtml(RES_STATUS[r.status] ?? r.status)}</span></td>
    <td style="white-space:nowrap">
      ${r.status === 'confirmed' ? `<button class="primary hv-in" data-id="${r.id}" style="max-width:110px">Check-in</button>` : ''}
      ${r.status === 'checked_in' ? `<button class="primary hv-out" data-id="${r.id}" style="max-width:110px">Check-out</button>` : ''}
      <button class="hv-edit" data-id="${r.id}">Edit</button>
      <button class="hv-wa" data-id="${r.id}" title="Kirim konfirmasi lewat WhatsApp">💬</button>
      ${r.status !== 'cancelled' ? `<button class="hv-cancel" data-id="${r.id}" title="Batalkan — kamar langsung bebas, jejaknya tetap tersimpan">Batalkan</button>` : ''}
      <button class="hv-del" data-id="${r.id}" title="Hapus permanen">Hapus</button>
    </td>
  </tr>`;
}

function wireAksi(host, rows, ctx, reload) {
  const cari = (id) => rows.find((r) => r.id === id);

  host.querySelectorAll('.hv-in').forEach((b) =>
    b.addEventListener('click', async () => {
      const r = cari(b.dataset.id);
      const values = await formDialog({
        title: `Check-in — ${r.customer_name}`,
        description: `${r.room_types?.name ?? 'Kamar'} · ${fmtSingkat(r.check_in)} → ${fmtSingkat(r.check_out)}`,
        fields: [
          {
            name: 'room_no',
            label: 'Nomor kamar',
            type: 'text',
            required: true,
            value: r.room_no ?? '',
            // Nomor kamar tidak divalidasi sistem (kuota dijaga per TIPE, bukan
            // per nomor) — jadi ketelitiannya ada di tangan resepsionis.
            help: 'Pastikan kamar ini memang kosong — sistem menjaga jumlah per tipe, bukan nomor kamarnya.'
          }
        ],
        submitText: 'Check-in'
      });
      if (!values) return;
      try {
        await checkInBooking(r.id, values.room_no);
        toast('Tamu sudah check-in.', 'success');
        await reload();
      } catch (error) {
        toast(error.message ?? 'Gagal check-in.', 'error');
      }
    })
  );

  host.querySelectorAll('.hv-out').forEach((b) =>
    b.addEventListener('click', async () => {
      const r = cari(b.dataset.id);
      const ok = await confirmDialog({
        title: `Check-out ${r.customer_name}?`,
        message: `Kamar ${r.room_no ?? '-'} akan dilepas dan bisa dipakai booking lain.`,
        confirmText: 'Check-out'
      });
      if (!ok) return;
      try {
        await checkOutBooking(r.id);
        toast('Tamu sudah check-out.', 'success');
        await reload();
      } catch (error) {
        toast(error.message ?? 'Gagal check-out.', 'error');
      }
    })
  );

  host.querySelectorAll('.hv-edit').forEach((b) =>
    b.addEventListener('click', () => formBooking(cari(b.dataset.id), ctx, reload))
  );

  host.querySelectorAll('.hv-cancel').forEach((b) =>
    b.addEventListener('click', async () => {
      const r = cari(b.dataset.id);
      const values = await formDialog({
        title: `Batalkan booking ${r.code ?? ''}?`,
        description: `${r.customer_name} · ${r.room_types?.name ?? '-'} · ${fmtSingkat(r.check_in)} → ${fmtSingkat(r.check_out)}. Kamar langsung bebas untuk tanggal tersebut.`,
        fields: [{ name: 'alasan', label: 'Alasan pembatalan', type: 'text', required: true, placeholder: 'mis. tamu batal datang' }],
        submitText: 'Batalkan Booking'
      });
      if (!values) return;
      try {
        await cancelHotelBooking(r.id, values.alasan);
        toast('Booking dibatalkan.', 'success');
        await reload();
      } catch (error) {
        toast(error.message ?? 'Gagal membatalkan.', 'error');
      }
    })
  );

  host.querySelectorAll('.hv-del').forEach((b) =>
    b.addEventListener('click', async () => {
      const r = cari(b.dataset.id);
      // Dibedakan tegas dari Batalkan, karena keduanya sama-sama "membebaskan
      // kamar" tapi hanya satu yang menyisakan jejak.
      const ok = await confirmDialog({
        title: `Hapus booking ${r.code ?? ''}?`,
        message:
          `${r.customer_name} akan HILANG PERMANEN dari riwayat dan laporan. ` +
          'Kalau tamunya sekadar batal datang, pakai "Batalkan" — kamar tetap bebas tapi alasannya masih bisa ditelusuri.',
        confirmText: 'Hapus Permanen',
        danger: true
      });
      if (!ok) return;
      try {
        await deleteReservation(r.id);
        toast('Booking dihapus.', 'success');
        await reload();
      } catch (error) {
        toast(error.message ?? 'Gagal menghapus.', 'error');
      }
    })
  );

  host.querySelectorAll('.hv-wa').forEach((b) =>
    b.addEventListener('click', () => {
      const r = cari(b.dataset.id);
      shareDialog({
        title: `WhatsApp ke ${r.customer_name}`,
        helper: 'Nomor tujuan diambil dari data booking.',
        defaultMessage: buildConfirmMessage({ ...r, mode: 'hotel' }),
        phone: waNumber(r.phone),
        email: r.email ?? '',
        subject: `Konfirmasi Booking ${r.code ?? ''}`.trim()
      });
    })
  );
}

// ---------------------------------------------------------
// Form booking
// ---------------------------------------------------------

async function formBooking(existing, ctx, reload) {
  const { businessUnitId, outlets, state } = ctx;
  const outletId = existing?.outlet_id ?? state.outletId ?? outlets[0]?.id;
  if (!outletId) return toast('Pilih outlet dulu.', 'warning');

  let tipe = [];
  try {
    tipe = await listRoomTypes(outletId);
  } catch (error) {
    return toast(error.message ?? 'Gagal memuat tipe kamar.', 'error');
  }
  if (!tipe.length) {
    return toast('Belum ada tipe kamar. Isi dulu di tab Tipe Kamar.', 'warning');
  }

  const besok = (d) => {
    const t = new Date(d + 'T00:00:00');
    t.setDate(t.getDate() + 1);
    return t.toLocaleDateString('sv-SE');
  };
  const cIn = existing?.check_in ?? state.tanggal;
  const cOut = existing?.check_out ?? besok(cIn);

  const values = await formDialog({
    title: existing ? `Edit Booking — ${existing.customer_name}` : 'Booking Baru',
    description: 'Booking langsung berstatus Dikonfirmasi — tidak ada antrean persetujuan.',
    fields: [
      { name: 'customer_name', label: 'Nama tamu', type: 'text', required: true, value: existing?.customer_name ?? '' },
      { name: 'phone', label: 'No. WhatsApp', type: 'text', required: true, value: existing?.phone ?? '', placeholder: '08xxxxxxxxxx' },
      { name: 'email', label: 'Email (opsional)', type: 'text', value: existing?.email ?? '' },
      {
        name: 'room_type_id',
        label: 'Tipe kamar',
        type: 'select',
        required: true,
        value: existing?.room_type_id ?? tipe[0].id,
        options: tipe.map((t) => ({ value: t.id, label: `${t.name} (${t.qty} unit)` }))
      },
      { name: 'check_in', label: 'Check-in', type: 'date', required: true, value: cIn },
      { name: 'check_out', label: 'Check-out', type: 'date', required: true, value: cOut, help: 'Tanggal check-out tidak dihitung sebagai malam menginap.' },
      { name: 'adults', label: 'Dewasa', type: 'number', min: 1, value: existing?.adults ?? 1 },
      { name: 'children', label: 'Anak', type: 'number', min: 0, value: existing?.children ?? 0 },
      { name: 'notes', label: 'Catatan / permintaan khusus', type: 'text', value: existing?.notes ?? '' },
      { name: 'referral_source', label: 'Tahu dari mana', type: 'text', value: existing?.referral_source ?? '' }
    ],
    submitText: 'Simpan',
    onReady: (form, { setError }) => {
      // Sisa kamar ditampilkan saat tanggal/tipe berubah, SEBELUM Simpan ditekan.
      // Trigger di database tetap penentu akhirnya — ini supaya penolakannya
      // tidak jadi kejutan setelah semua kolom terlanjur diisi.
      const info = document.createElement('p');
      info.style.cssText = 'font-size:0.8rem;margin:4px 0 0';
      form.querySelector('[name="check_out"]').closest('.field').appendChild(info);

      let jalan = 0;
      async function cek() {
        const ci = form.elements['check_in'].value;
        const co = form.elements['check_out'].value;
        const rt = form.elements['room_type_id'].value;
        if (!ci || !co || co <= ci) {
          info.textContent = co && ci && co <= ci ? '⚠️ Check-out harus setelah check-in (minimal 1 malam).' : '';
          info.style.color = 'var(--color-danger)';
          return;
        }
        const seq = ++jalan;
        info.textContent = 'Mengecek ketersediaan…';
        info.style.color = 'var(--color-text-muted)';
        try {
          const av = await getRoomAvailability(outletId, ci, co);
          if (seq !== jalan) return; // hasil lama, sudah ada pengecekan lebih baru
          const t = av.find((x) => x.room_type_id === rt);
          if (!t) return (info.textContent = '');
          // Saat mengedit, booking ini sendiri ikut terhitung terpakai.
          const sisa = t.sisa + (existing && existing.room_type_id === rt ? 1 : 0);
          const malam = jumlahMalam(ci, co);
          info.textContent =
            sisa > 0
              ? `✅ ${malam} malam · sisa ${sisa} dari ${t.qty} unit ${t.name}`
              : `⚠️ ${t.name} penuh untuk tanggal tersebut (${t.qty} unit terpakai semua).`;
          info.style.color = sisa > 0 ? 'var(--color-text-muted)' : 'var(--color-danger)';
        } catch {
          if (seq === jalan) info.textContent = '';
        }
      }
      ['check_in', 'check_out', 'room_type_id'].forEach((n) => form.elements[n].addEventListener('change', cek));
      cek();
      void setError;
    }
  });
  if (!values) return;

  if (values.check_out <= values.check_in) {
    return toast('Check-out harus setelah check-in — minimal menginap satu malam.', 'error');
  }

  try {
    if (existing) {
      await updateHotelBooking(existing.id, {
        customer_name: values.customer_name.trim(),
        phone: values.phone.trim(),
        email: values.email?.trim() || null,
        room_type_id: values.room_type_id,
        check_in: values.check_in,
        check_out: values.check_out,
        adults: Number(values.adults) || 1,
        children: Number(values.children) || 0,
        notes: values.notes?.trim() || null,
        referral_source: values.referral_source?.trim() || null
      });
      toast('Booking diperbarui.', 'success');
    } else {
      const baru = await createHotelBooking({
        outletId,
        businessUnitId,
        name: values.customer_name,
        phone: values.phone,
        email: values.email,
        roomTypeId: values.room_type_id,
        checkIn: values.check_in,
        checkOut: values.check_out,
        adults: values.adults,
        children: values.children,
        notes: values.notes,
        referral: values.referral_source
      });
      toast(`Booking ${baru?.code ?? ''} tersimpan.`, 'success');

      const outletNama = outlets.find((o) => o.id === outletId)?.name ?? '';
      const tipeNama = tipe.find((t) => t.id === values.room_type_id)?.name ?? '';
      await shareDialog({
        title: 'Kirim Konfirmasi ke Tamu',
        helper: 'Nomor WhatsApp dan alamat email diambil dari data booking yang baru saja diisi.',
        email: values.email?.trim() || '',
        subject: `Konfirmasi Booking ${baru?.code ?? ''}`.trim(),
        defaultMessage: buildConfirmMessage({
          mode: 'hotel',
          code: baru?.code,
          customer_name: values.customer_name,
          outlets: { name: outletNama },
          room_types: { name: tipeNama },
          check_in: values.check_in,
          check_out: values.check_out,
          adults: values.adults,
          children: values.children,
          notes: values.notes
        }),
        phone: waNumber(values.phone)
      });
    }
    await reload();
  } catch (error) {
    // Pesan dari trigger kuota sudah berbahasa manusia — tampilkan apa adanya.
    toast(error.message ?? 'Gagal menyimpan booking.', 'error');
  }
}

// ---------------------------------------------------------
// Tab: Semua Booking
// ---------------------------------------------------------

async function tabSemua(content, ctx) {
  const { businessUnitId, outlets, state } = ctx;
  const rng = monthRangeWIB();
  const f = { outletId: state.outletId, status: '', from: rng.from, to: rng.to };

  content.innerHTML = `
    <div class="inline-card" style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
      <div class="field" style="margin:0;max-width:200px"><label>Outlet</label>
        <select id="hs-outlet"><option value="">Semua</option>${outlets.map((o) => `<option value="${escapeHtml(o.id)}"${o.id === f.outletId ? ' selected' : ''}>${escapeHtml(o.name)}</option>`).join('')}</select>
      </div>
      <div class="field" style="margin:0;max-width:180px"><label>Status</label>
        <select id="hs-status"><option value="">Semua</option>${RES_STATUS_OPTIONS_HOTEL.map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join('')}</select>
      </div>
      <div class="field" style="margin:0;max-width:160px"><label>Check-in dari</label><input type="date" id="hs-from" value="${escapeHtml(f.from)}" /></div>
      <div class="field" style="margin:0;max-width:160px"><label>Sampai</label><input type="date" id="hs-to" value="${escapeHtml(f.to)}" /></div>
      <button class="primary" id="hs-go" style="max-width:110px">Filter</button>
      <button id="hs-pdf">⇩ PDF</button>
    </div>
    <div id="hs-list" style="margin-top:12px"></div>
  `;

  const list = content.querySelector('#hs-list');
  let rows = [];

  async function gambar() {
    list.innerHTML = `<p style="color:var(--color-text-muted)">Memuat…</p>`;
    try {
      rows = await listReservations({
        businessUnitId,
        outletId: f.outletId,
        status: f.status,
        dateFrom: f.from,
        dateTo: f.to,
        mode: 'hotel'
      });
    } catch (error) {
      list.innerHTML = `<p class="error-text">${escapeHtml(error.message ?? error)}</p>`;
      return;
    }
    list.innerHTML = `
      <p style="font-size:0.82rem;color:var(--color-text-muted);margin:0 0 8px"><strong>${rows.length}</strong> booking</p>
      <div class="table-scroll"><table class="data-table">
        <thead><tr><th>Kode</th><th>Tamu</th><th>Tipe / Kamar</th><th>Menginap</th><th>Status</th><th>Aksi</th></tr></thead>
        <tbody>${rows.map(barisTamu).join('') || '<tr><td colspan="6">Tidak ada booking pada periode ini.</td></tr>'}</tbody>
      </table></div>
    `;
    wireAksi(list, rows, ctx, gambar);
  }

  content.querySelector('#hs-go').addEventListener('click', () => {
    f.outletId = content.querySelector('#hs-outlet').value;
    f.status = content.querySelector('#hs-status').value;
    f.from = content.querySelector('#hs-from').value;
    f.to = content.querySelector('#hs-to').value;
    gambar();
  });

  content.querySelector('#hs-pdf').addEventListener('click', async () => {
    if (!rows.length) return toast('Tidak ada data untuk diexport.', 'warning');
    try {
      await exportTablePDF({
        title: 'Booking Hotel',
        subtitle: `${f.from} s/d ${f.to} · ${rows.length} booking`,
        columns: [
          { header: 'Kode', width: 1 },
          { header: 'Tamu', width: 1.6 },
          { header: 'Telp', width: 1.2 },
          { header: 'Tipe', width: 1.2 },
          { header: 'Kamar', width: 0.8 },
          { header: 'Check-in', width: 1 },
          { header: 'Check-out', width: 1 },
          { header: 'Malam', width: 0.6 },
          { header: 'Status', width: 1 }
        ],
        rows: rows.map((r) => [
          r.code ?? '-',
          r.customer_name,
          r.phone,
          r.room_types?.name ?? '-',
          r.room_no ?? '-',
          r.check_in,
          r.check_out,
          String(jumlahMalam(r.check_in, r.check_out)),
          RES_STATUS[r.status] ?? r.status
        ]),
        filename: 'booking-hotel'
      });
      toast('PDF terunduh.', 'success');
    } catch (error) {
      toast(error.message ?? 'Gagal membuat PDF.', 'error');
    }
  });

  await gambar();
}

// ---------------------------------------------------------
// Tab: Tipe Kamar
// ---------------------------------------------------------

async function tabKamar(content, ctx) {
  const { outlets, state } = ctx;
  content.innerHTML = `
    <div class="inline-card" style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
      <div class="field" style="margin:0;max-width:220px"><label>Outlet</label>
        <select id="hk-outlet">${outlets.map((o) => `<option value="${escapeHtml(o.id)}"${o.id === state.outletId ? ' selected' : ''}>${escapeHtml(o.name)}</option>`).join('')}</select>
      </div>
      <button class="primary" id="hk-new" style="max-width:170px">+ Tambah Tipe</button>
    </div>
    <p style="font-size:0.8rem;color:var(--color-text-muted);margin:10px 0;max-width:70ch">
      <strong>Jumlah unit</strong> adalah kuotanya. Deluxe = 2 berarti maksimal 2 booking Deluxe
      yang tanggal menginapnya bertabrakan. Aturan ini dijaga database, jadi tidak bisa ditembus
      walau dua admin menyimpan di detik yang sama.
    </p>
    <div id="hk-list"></div>
  `;
  const list = content.querySelector('#hk-list');

  content.querySelector('#hk-outlet').addEventListener('change', (e) => {
    state.outletId = e.target.value;
    gambar();
  });
  content.querySelector('#hk-new').addEventListener('click', () => formTipe(null));

  async function gambar() {
    list.innerHTML = `<p style="color:var(--color-text-muted)">Memuat…</p>`;
    let rows;
    try {
      rows = await listRoomTypes(state.outletId, false);
    } catch (error) {
      list.innerHTML = `<p class="error-text">${escapeHtml(error.message ?? error)}</p>`;
      return;
    }
    list.innerHTML = `
      <div class="table-scroll"><table class="data-table">
        <thead><tr><th>Urutan</th><th>Tipe Kamar</th><th>Jumlah Unit</th><th>Kapasitas</th><th>Status</th><th>Aksi</th></tr></thead>
        <tbody>
          ${
            rows
              .map(
                (t) => `<tr${t.is_active ? '' : ' style="opacity:0.55"'}>
                  <td>${t.sort_order}</td>
                  <td><strong>${escapeHtml(t.name)}</strong>${t.notes ? `<div style="font-size:0.74rem;color:var(--color-text-muted)">${escapeHtml(t.notes)}</div>` : ''}</td>
                  <td style="text-align:right"><strong>${t.qty}</strong></td>
                  <td style="text-align:right">${t.capacity ?? '-'}</td>
                  <td>${t.is_active ? 'Aktif' : 'Nonaktif'}</td>
                  <td><button class="hk-edit" data-id="${t.id}">Edit</button>
                      <button class="hk-del" data-id="${t.id}">Hapus</button></td>
                </tr>`
              )
              .join('') || '<tr><td colspan="6">Belum ada tipe kamar.</td></tr>'
          }
        </tbody>
      </table></div>
    `;
    list.querySelectorAll('.hk-edit').forEach((b) => b.addEventListener('click', () => formTipe(rows.find((t) => t.id === b.dataset.id))));
    list.querySelectorAll('.hk-del').forEach((b) =>
      b.addEventListener('click', async () => {
        const t = rows.find((x) => x.id === b.dataset.id);
        const ok = await confirmDialog({
          title: `Hapus tipe "${t.name}"?`,
          message: 'Tipe yang sudah dipakai booking tidak bisa dihapus — nonaktifkan saja lewat Edit.',
          confirmText: 'Hapus',
          danger: true
        });
        if (!ok) return;
        try {
          await deleteRoomType(t.id);
          toast('Tipe kamar dihapus.', 'success');
          await gambar();
        } catch (error) {
          // FK `on delete restrict` menolak kalau masih ada booking -> pesan
          // database-nya tidak ramah, jadi diterjemahkan.
          const pesan = /foreign key|restrict/i.test(error.message ?? '')
            ? 'Tipe ini masih dipakai booking. Nonaktifkan saja lewat Edit — datanya tetap terbaca di riwayat.'
            : error.message ?? 'Gagal menghapus.';
          toast(pesan, 'error');
        }
      })
    );
  }

  async function formTipe(existing) {
    const values = await formDialog({
      title: existing ? `Edit — ${existing.name}` : 'Tambah Tipe Kamar',
      fields: [
        { name: 'name', label: 'Nama tipe', type: 'text', required: true, value: existing?.name ?? '', placeholder: 'mis. Deluxe' },
        { name: 'qty', label: 'Jumlah unit', type: 'number', min: 1, required: true, value: existing?.qty ?? 1, help: 'Berapa kamar bertipe ini yang dimiliki hotel.' },
        { name: 'capacity', label: 'Kapasitas tamu (opsional)', type: 'number', min: 1, value: existing?.capacity ?? '' },
        { name: 'notes', label: 'Keterangan (opsional)', type: 'text', value: existing?.notes ?? '' },
        { name: 'sort_order', label: 'Urutan', type: 'number', min: 0, value: existing?.sort_order ?? 0 },
        ...(existing ? [{ name: 'is_active', label: 'Aktif', type: 'checkbox', value: existing.is_active }] : [])
      ],
      submitText: 'Simpan'
    });
    if (!values) return;
    try {
      await saveRoomType({ id: existing?.id, outletId: state.outletId, ...values });
      toast('Tipe kamar tersimpan.', 'success');
      await gambar();
    } catch (error) {
      toast(error.message ?? 'Gagal menyimpan.', 'error');
    }
  }

  await gambar();
}

function fmtSingkat(d) {
  if (!d) return '-';
  return new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
}
