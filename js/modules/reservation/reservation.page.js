import { listMyOutlets } from '../../core/my-outlets.js';
import { idSaya } from '../../core/base-scope.js';
import { renderReservationHotelPage } from './reservation.hotel.page.js';
import { toast, formDialog, infoDialog } from '../../core/ui.js';
import { todayWIB, monthEndWIB, geserHari } from '../../core/dates.js';
import {
  RES_STATUS,
  RES_BADGE,
  SOURCE_LABEL,
  listReservationAreas,
  getAvailability,
  createReservation,
  listReservations,
  getReservationTerms,
  catatDpReservasi,
  getInfoTanggal,
  uploadDepositProof,
  getDepositProofUrl
} from './reservation.service.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';
import { formatRupiah } from '../../core/format.js';

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

  // Default: HARI INI sampai AKHIR BULAN INI.
  //
  // Tanggal yang sudah lewat sengaja tidak ikut. Modul ini dipakai untuk
  // bersiap, bukan untuk mengenang: yang berguna saat layarnya dibuka adalah
  // tamu yang BELUM datang. Rentang yang dimulai dari tanggal 1 hanya membuat
  // baris hari ini terdorong ke bawah oleh reservasi yang sudah selesai.
  //
  // Konsekuensi yang perlu diketahui: menjelang akhir bulan rentang bawaannya
  // jadi pendek, dan reservasi awal bulan depan tidak ikut terlihat. Karena itu
  // ada pintasan "30 hari" — satu ketukan, bukan mengetik dua tanggal.
  const hariIni = todayWIB();
  const akhirBulan = monthEndWIB();
  const state = { outletId: outlets[0].id, from: hariIni, to: akhirBulan };

  // Dipakai HANYA untuk memutuskan tombol "Catat DP" pantas muncul atau tidak.
  // Database tetap yang menolak; ini supaya staff tidak ditawari tombol yang
  // sudah pasti gagal — tombol semacam itu melatih orang mengabaikan pesan
  // error, dan sesudah itu pesan error yang benar-benar penting ikut diabaikan.
  const sayaId = await idSaya().catch(() => null);

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
      <div class="field" style="margin:0;max-width:165px"><label>Sampai tanggal</label><input type="date" id="rv-to" value="${akhirBulan}" /></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="rv-quick" data-range="today">Hari ini</button>
        <button class="rv-quick" data-range="tomorrow">Besok</button>
        <button class="rv-quick" data-range="week">7 hari</button>
        <button class="rv-quick" data-range="month">Sisa bulan ini</button>
        <button class="rv-quick" data-range="30">30 hari</button>
      </div>
    </div>

    <div id="rv-list" style="margin-top:12px"></div>
  `;

  const list = container.querySelector('#rv-list');
  container.querySelector('#rv-outlet').addEventListener('change', (e) => {
    state.outletId = e.target.value;
    refresh();
  });
  // Tombol "Tampilkan" dihapus: mengubah tanggal LALU menekan tombol berarti
  // setiap perubahan punya dua langkah, dan langkah kedua itu mudah terlupakan —
  // gejalanya staff menatap daftar yang tidak sesuai tanggal di layarnya sendiri
  // dan mengira reservasinya hilang. Sekarang daftarnya ikut begitu tanggalnya
  // diubah.
  container.querySelector('#rv-from').addEventListener('change', (e) => {
    state.from = e.target.value;
    refresh();
  });
  container.querySelector('#rv-to').addEventListener('change', (e) => {
    state.to = e.target.value;
    refresh();
  });
  container.querySelector('#rv-new').addEventListener('click', openForm);

  // Pintasan rentang — rentang lain tetap bisa diisi manual lewat dua kolom tanggal.
  container.querySelectorAll('.rv-quick').forEach((b) =>
    b.addEventListener('click', () => {
      const t = todayWIB();
      const geser = (n) => geserHari(t, n);
      if (b.dataset.range === 'today') [state.from, state.to] = [t, t];
      if (b.dataset.range === 'tomorrow') [state.from, state.to] = [geser(1), geser(1)];
      if (b.dataset.range === 'week') [state.from, state.to] = [t, geser(6)];
      // "Bulan ini" menatap ke DEPAN (hari ini → akhir bulan), bukan ke belakang
      // seperti di modul laporan. Reservasi kemarin tidak bisa disiapkan lagi.
      if (b.dataset.range === 'month') [state.from, state.to] = [t, monthEndWIB()];
      if (b.dataset.range === '30') [state.from, state.to] = [t, geser(30)];
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
          <thead><tr><th>Kode</th><th>Tanggal &amp; Jam</th><th>Customer</th><th>Tamu</th><th>Area</th><th>DP</th><th>Sumber</th><th>Status</th></tr></thead>
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
                    <td style="font-size:0.8rem;white-space:nowrap">
                      ${
                        r.deposit_amount
                          ? `${esc(formatRupiah(Number(r.deposit_amount)))}${
                              r.deposit_proof_path
                                ? ` <button class="rv-bukti" data-id="${r.id}" title="Lihat bukti transfer" style="padding:2px 6px;font-size:0.72rem">📎</button>`
                                : ' <span title="Belum ada bukti transfer" style="color:var(--color-danger)">⚠</span>'
                            }`
                          : !r.created_by || r.created_by === sayaId
                            ? `<button class="rv-dp" data-id="${r.id}" style="padding:4px 8px;font-size:0.75rem">💰 Catat DP</button>`
                            : '<span style="color:var(--color-text-muted);font-size:0.75rem" title="DP reservasi ini dicatat oleh staff yang membuatnya, atau oleh admin">—</span>'
                      }
                    </td>
                    <td style="font-size:0.78rem">${esc(SOURCE_LABEL[r.source] ?? r.source)}</td>
                    <td><span class="badge ${RES_BADGE[r.status] ?? ''}">${RES_STATUS[r.status] ?? r.status}</span>
                      ${r.review_note ? `<div style="font-size:0.72rem;color:var(--color-text-muted)">${esc(r.review_note)}</div>` : ''}</td>
                  </tr>`
                )
                .join('') || '<tr><td colspan="8">Belum ada reservasi pada rentang ini.</td></tr>'
            }
          </tbody>
        </table>
      </div>
    `;

    // 📎 harus bisa DIBUKA. Penanda yang tidak bisa diklik hanya memberi tahu
    // bahwa buktinya ada di suatu tempat — dan pertanyaannya selalu "berapa yang
    // ditransfer", bukan "apakah ada filenya".
    list.querySelectorAll('.rv-bukti').forEach((b) =>
      b.addEventListener(
        'click',
        sekaliJalan(async () => {
          const r = rows.find((x) => x.id === b.dataset.id);
          const url = await getDepositProofUrl(r?.deposit_proof_path).catch(() => null);
          if (!url) return toast('Bukti transfer tidak bisa dibuka.', 'error');
          infoDialog({
            title: `Bukti transfer ${r.code ?? ''}`.trim(),
            bodyHtml: `<img src="${url}" alt="Bukti transfer" style="width:100%;border-radius:8px" />
              <p style="font-size:0.78rem;color:var(--color-text-muted);margin:8px 0 0">DP ${esc(formatRupiah(Number(r.deposit_amount ?? 0)))}</p>`
          });
        })
      )
    );

    // Catat DP belakangan. Bukti transfer sering baru dikirim customer
    // beberapa jam setelah menelepon; memaksa DP diisi bersamaan dengan
    // pembuatan reservasi berarti sebagian besar DP tidak akan pernah tercatat.
    list.querySelectorAll('.rv-dp').forEach((b) =>
      b.addEventListener(
        'click',
        sekaliJalan(async () => {
          const r = rows.find((x) => x.id === b.dataset.id);
          if (!r) return;
          const values = await formDialog({
            title: `Catat DP ${r.code ?? ''}`.trim(),
            description: `${r.customer_name} · ${r.pax} orang · ${fmtDate(r.reserve_date)} ${String(r.reserve_time).slice(0, 5)}`,
            fields: [
              { name: 'deposit_amount', label: 'DP diterima (Rp)', type: 'money', required: true, value: '' },
              {
                name: 'deposit_proof',
                label: 'Foto bukti transfer',
                type: 'photo',
                facing: 'environment',
                required: true,
                // Wajib di sini, tidak seperti di form reservasi baru: di sana
                // DP-nya boleh dilewati sama sekali, tapi begitu seseorang
                // menekan "Catat DP", nominal tanpa bukti justru yang paling
                // sulit dipertanggungjawabkan belakangan.
                help: 'Nominalnya percuma kalau buktinya tidak ikut.'
              }
            ],
            submitText: 'Simpan DP'
          });
          if (!values) return;
          const ok = await simpanDp(r, values.deposit_amount, values.deposit_proof);
          if (ok) await refresh();
        })
      )
    );
  }

  async function openForm() {
    const areas = await listReservationAreas(state.outletId).catch(() => []);
    // S&K dibaca di sini, bukan di dalam onReady: dialognya harus sudah tahu
    // apakah field persetujuan perlu ditampilkan SEBELUM digambar.
    const terms = await getReservationTerms(state.outletId).catch(() => '');
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
        // Jam BEBAS, bukan daftar slot. Rombongan datang 18:15 atau 19:30 itu
        // hal biasa; memaksa .00 membuat staff memilih jam yang salah lalu
        // menulis jam sebenarnya di kolom catatan — dan catatan tidak pernah
        // ikut terhitung di mana pun.
        //
        // Kuotanya tetap dijaga: 0077 menghitung pemakaian per SLOT tempat jam
        // itu jatuh, jadi 18:00 dan 18:15 tetap berebut kursi yang sama.
        { name: 'reserve_time', label: 'Jam', type: 'time', required: true, value: '' },
        { name: 'info_slot', label: 'Sisa kursi', type: 'text', value: '', help: 'Terisi otomatis setelah tanggal & jam dipilih.' },
        { name: 'pax', label: 'Jumlah tamu', type: 'number', required: true, min: 1, value: '2' },
        {
          name: 'area_id',
          label: 'Area',
          type: 'select',
          options: [{ value: '', label: '-- tidak ditentukan --' }, ...areas.map((a) => ({ value: a.id, label: a.name }))]
        },
        { name: 'referral_source', label: 'Tahu dari mana (opsional)', type: 'text', placeholder: 'Instagram, teman, Google Maps…' },
        { name: 'notes', label: 'Permintaan khusus (opsional)', type: 'text', placeholder: 'ulang tahun, kursi bayi, alergi…' },
        // DP dicatat DI SINI, bukan hanya di Admin Portal.
        //
        // Yang menerima bukti transfer di WhatsApp adalah staff yang mengangkat
        // teleponnya. Selama jalurnya cuma ada di admin, buktinya berhenti di
        // galeri HP staff — dan saat dia libur, tidak ada yang bisa menjawab
        // berapa DP yang sudah masuk untuk reservasi ini.
        {
          name: 'deposit_amount',
          label: 'DP diterima (Rp) — opsional',
          type: 'money',
          value: '',
          help: 'Kosongkan kalau DP-nya belum masuk. Bisa dicatat belakangan lewat tombol 💰 di daftar.'
        },
        {
          name: 'deposit_proof',
          label: 'Foto bukti transfer',
          type: 'photo',
          facing: 'environment',
          help: 'Simpan buktinya di sini, bukan di galeri pribadi.'
        },
        // S&K ditampilkan DI DALAM form, bukan sebagai tautan terpisah. Yang
        // dibaca orang adalah yang ada di depan matanya; ketentuan yang harus
        // diklik dulu praktis tidak pernah dibuka, dan itu justru yang jadi
        // pangkal perselisihan soal deposit.
        ...(terms
          ? [
              { name: 'terms_view', label: 'Syarat & Ketentuan', type: 'textarea', rows: 10, value: terms },
              {
                name: 'terms_accepted',
                label: 'Customer sudah diberi tahu & menyetujui S&K di atas',
                type: 'checkbox',
                value: false,
                help: 'Dicatat beserta waktunya. Kalau reservasi lewat telepon, bacakan dulu poin depositnya.'
              }
            ]
          : [])
      ],
      submitText: 'Simpan Reservasi',
      onReady: (form, { setError }) => {
        // S&K hanya untuk DIBACA di sini. Mengubahnya adalah urusan Pengaturan
        // di Admin Portal — kalau bisa disunting dari form reservasi, tiap
        // reservasi berpotensi punya ketentuannya sendiri tanpa ada yang tahu.
        if (form.elements['terms_view']) form.elements['terms_view'].readOnly = true;
        const tgl = form.elements['reserve_date'];
        const jam = form.elements['reserve_time'];
        const info = form.elements['info_slot'];
        info.readOnly = true;

        // Slot tidak lagi membatasi PILIHAN, tapi tetap ditampilkan sebagai
        // KETERANGAN. Staff perlu tahu sisa kursinya sebelum menjanjikan meja —
        // dan angka itu jauh lebih berguna daripada daftar jam yang kaku.
        let slots = [];
        // Batas H- hanya mengikat WEBSITE. Staff tetap boleh menyimpan — telepon
        // "meja untuk besok" harus bisa dicatat di aplikasi, bukan di kertas.
        // Tapi staff perlu TAHU kalau tanggal itu sudah ditutup untuk publik:
        // itu yang menjelaskan kenapa tamu bilang "di website tidak bisa".
        let catatanBatas = '';
        const muatSlot = async () => {
          info.value = 'memuat…';
          try {
            const [hasil, kabar] = await Promise.all([
              getAvailability(state.outletId, tgl.value),
              getInfoTanggal(state.outletId, tgl.value)
            ]);
            slots = hasil;
            catatanBatas = kabar.boleh ? '' : `⚠ ${kabar.alasan ?? 'Tanggal ini sudah ditutup untuk pemesanan online.'} Kamu tetap bisa menyimpannya dari sini.`;
            tampilkanSisa();
            setError(catatanBatas || (slots.length ? '' : 'Pengaturan reservasi outlet ini belum diisi admin, atau tanggalnya di luar jangkauan.'));
          } catch (e) {
            slots = [];
            info.value = '';
            setError(e.message ?? String(e));
          }
        };

        const tampilkanSisa = () => {
          if (!jam.value || !slots.length) {
            info.value = '';
            return;
          }
          // Cari slot tempat jam ini jatuh: slot terakhir yang mulainya <= jam.
          const menit = (t) => Number(String(t).slice(0, 2)) * 60 + Number(String(t).slice(3, 5));
          const j = menit(jam.value);
          const cocok = slots.filter((s) => menit(s.slot_time) <= j).pop();
          if (!cocok) {
            info.value = 'di luar jam operasional';
            return;
          }
          const sisa = cocok.max_pax - cocok.used_pax;
          // "(tertutup)" dulu berarti dua hal sekaligus — kuota habis atau lewat
          // batas waktu — dan staff tidak bisa membedakannya. Sekarang
          // kuotanyalah yang menentukan katanya.
          const tutup = cocok.is_open ? '' : sisa > 0 ? ' (tutup untuk online)' : ' (penuh)';
          info.value = `slot ${String(cocok.slot_time).slice(0, 5)} — sisa ${sisa} kursi${tutup}`;
        };

        tgl.addEventListener('change', muatSlot);
        jam.addEventListener('change', tampilkanSisa);
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
        referral: values.referral_source,
        termsAccepted: !!values.terms_accepted
      });
      toast(`Reservasi ${row?.code ?? ''} tersimpan.`, 'success');
      // DP dicatat SETELAH reservasinya jadi, karena path fotonya memuat ID
      // reservasi. Kegagalan di sini tidak boleh membatalkan reservasinya —
      // yang sudah dijanjikan ke tamu adalah mejanya, bukan catatan DP-nya.
      await simpanDp(row, values.deposit_amount, values.deposit_proof);
      await refresh();
    } catch (error) {
      toast(error.message ?? 'Gagal menyimpan reservasi.', 'error');
    }
  }

  /**
   * Catat DP untuk sebuah reservasi yang sudah ada.
   * @returns {Promise<boolean>} tersimpan atau tidak
   */
  async function simpanDp(row, nominal, foto) {
    // Field `money` mengembalikan 0 untuk isian kosong, bukan ''. Tanpa
    // pemeriksaan > 0, membiarkan kolom DP kosong akan mencatat "DP Rp 0" —
    // angka yang terlihat pasti padahal artinya justru "tidak ada DP", dan
    // sesudah itu tombol Catat DP tidak muncul lagi.
    const adaNominal = Number(nominal) > 0;
    if (!adaNominal && !foto) return false;
    if (!row?.id) {
      toast('DP belum tercatat — reservasinya tersimpan, tapi ID-nya tidak terbaca. Catat lewat Admin Portal.', 'warning');
      return false;
    }
    try {
      // Foto diunggah dulu supaya nominal dan buktinya masuk dalam satu
      // panggilan. Kalau unggahannya gagal, tidak ada yang tercatat sama
      // sekali — nominal tanpa bukti justru yang paling sulit diperiksa
      // belakangan.
      const path = foto ? await uploadDepositProof({ outletId: row.outlet_id ?? state.outletId, reservationId: row.id, file: foto }) : null;
      await catatDpReservasi({ id: row.id, deposit: adaNominal ? Number(nominal) : null, depositProof: path });
      toast('DP tercatat.', 'success');
      return true;
    } catch (error) {
      toast(`Reservasi tersimpan, tapi DP GAGAL dicatat: ${error.message ?? error}. Coba lagi lewat tombol 💰.`, 'error');
      return false;
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
