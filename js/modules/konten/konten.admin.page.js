/**
 * ADMIN PORTAL — Konten Sosmed.
 *
 * Dua tab, dua pertanyaan:
 *
 *   Antrean   — "apa yang sudah masuk, dan mana yang menunggu saya?"
 *   Jadwal    — "outlet mana yang setor, hari apa, dengan brief apa?"
 *
 * Berkasnya tidak pernah lewat Supabase. Yang ditonton di sini adalah objek R2
 * yang diambil lewat URL bertanda tangan berumur satu jam; alasannya ada di
 * supabase/functions/konten-r2/index.ts.
 */
import { escapeHtml, toast, confirmDialog, formDialog } from '../../core/ui.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';
import { listOutletsSayaKelola, PESAN_TANPA_OUTLET_KELOLA } from '../../core/my-outlets.js';
import { todayWIB } from '../../core/dates.js';
import {
  listSetelanOutlet,
  simpanSetelanOutlet,
  listTugas,
  buatTugasKhusus,
  simpanBriefTugas,
  tandaiDiunduh,
  tandaiSelesai,
  urlTonton,
  hapusBerkasR2
} from './konten.service.js';
import {
  NAMA_HARI,
  BRIEF_BAWAAN,
  STATUS,
  LABEL_STATUS,
  keadaanTugas,
  briefEfektif,
  ASAL_BRIEF,
  kelengkapan,
  pesanKelengkapan,
  ringkasAntrean,
  pesanAntrean,
  keTanggal
} from './aturan-konten.js';

const TABS = [
  { key: 'antrean', label: 'Antrean setoran' },
  { key: 'jadwal', label: 'Jadwal per outlet' }
];

/**
 * Seberapa jauh ke belakang antrean dibaca.
 *
 * Bukan "semua": tugas tidak pernah dihapus (barisnya beberapa ratus byte dan
 * menjawab pertanyaan rekap berbulan-bulan kemudian), jadi tanpa batas layar
 * ini akan memuat seluruh riwayat setiap kali dibuka. Dua belas minggu cukup
 * untuk pekerjaan sehari-hari, dan saringan tanggalnya bisa digeser.
 */
const MINGGU_KE_BELAKANG = 12;
/** Tenggat yang belum datang juga ikut: itu yang sedang dikerjakan outlet. */
const HARI_KE_DEPAN = 14;

const mb = (b) => `${(Number(b || 0) / (1024 * 1024)).toFixed(1)} MB`;

const geserHari = (tanggal, hari) => {
  const d = keTanggal(tanggal);
  if (!d) return '';
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + hari);
  return t.toISOString().slice(0, 10);
};

const namaHariTanggal = (tanggal) => {
  const d = keTanggal(tanggal);
  if (!d) return '';
  return NAMA_HARI[new Date(`${d}T00:00:00Z`).getUTCDay()] ?? '';
};

export async function renderKontenAdminPage(container, { businessUnitId }) {
  container.innerHTML = `
    <h1>Konten Sosmed</h1>
    <div class="tab-bar">
      ${TABS.map((t, i) => `<button class="tab-btn ${i === 0 ? 'active' : ''}" data-tab="${t.key}">${t.label}</button>`).join('')}
    </div>
    <div id="kta-isi">${loadingHtml('Memuat…')}</div>`;

  const isi = container.querySelector('#kta-isi');

  const outlets = await listOutletsSayaKelola(businessUnitId).catch(() => []);
  if (!outlets.length) {
    isi.innerHTML = `<p style="color:var(--color-text-muted)">${escapeHtml(PESAN_TANPA_OUTLET_KELOLA)}</p>`;
    return;
  }

  const hariIni = todayWIB();
  const ctx = {
    businessUnitId,
    outlets,
    namaOutlet: new Map(outlets.map((o) => [o.id, o.name])),
    hariIni,
    // Saringan hidup selama layar terbuka: admin yang sedang memeriksa satu
    // outlet tidak mau saringannya hilang setiap kali ia menandai selesai.
    saringan: { outletId: '', status: '', dari: geserHari(hariIni, -7 * MINGGU_KE_BELAKANG), sampai: geserHari(hariIni, HARI_KE_DEPAN) }
  };

  async function showTab(key) {
    container.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === key));
    if (key === 'antrean') await gambarAntrean(isi, ctx);
    if (key === 'jadwal') await gambarJadwal(isi, ctx);
  }
  container.querySelectorAll('.tab-btn').forEach((btn) => btn.addEventListener('click', () => showTab(btn.dataset.tab)));
  await showTab('antrean');
}

// =====================================================================
// TAB 1 — ANTREAN SETORAN
// =====================================================================

async function gambarAntrean(wadah, ctx) {
  wadah.innerHTML = loadingHtml('Memuat setoran…', { baris: 4 });

  let tugas = [];
  let setelan = [];
  try {
    [tugas, setelan] = await Promise.all([
      listTugas({
        businessUnitId: ctx.businessUnitId,
        dari: ctx.saringan.dari,
        sampai: ctx.saringan.sampai,
        outletId: ctx.saringan.outletId || null
      }),
      listSetelanOutlet(ctx.businessUnitId)
    ]);
  } catch (e) {
    wadah.innerHTML = `<p class="error-text">${escapeHtml(e.message ?? e)}</p>`;
    return;
  }

  const briefTetapPer = new Map(setelan.map((s) => [s.outlet_id, s.brief_tetap]));
  const terlihat = ctx.saringan.status ? tugas.filter((t) => (t.status ?? STATUS.BELUM) === ctx.saringan.status) : tugas;

  // Ringkasannya dihitung dari SELURUH hasil rentang, bukan dari yang lolos
  // saringan status. Kalau tidak, menyaring "Selesai" membuat banner berbunyi
  // "semua beres" padahal ada lima outlet yang belum setor.
  const r = ringkasAntrean(tugas, ctx.hariIni);

  wadah.innerHTML = `
    <p class="inline-card" style="margin:0 0 10px;font-size:0.88rem">${escapeHtml(pesanAntrean(r))}</p>

    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px">
      <div class="form-row" style="margin:0">
        <label for="kta-outlet">Outlet</label>
        <select id="kta-outlet">
          <option value="">Semua outlet</option>
          ${ctx.outlets
            .map((o) => `<option value="${escapeHtml(o.id)}"${o.id === ctx.saringan.outletId ? ' selected' : ''}>${escapeHtml(o.name)}</option>`)
            .join('')}
        </select>
      </div>
      <div class="form-row" style="margin:0">
        <label for="kta-status">Status</label>
        <select id="kta-status">
          <option value="">Semua status</option>
          ${Object.values(STATUS)
            .map((s) => `<option value="${escapeHtml(s)}"${s === ctx.saringan.status ? ' selected' : ''}>${escapeHtml(LABEL_STATUS[s] ?? s)}</option>`)
            .join('')}
        </select>
      </div>
      <div class="form-row" style="margin:0">
        <label for="kta-dari">Tenggat dari</label>
        <input type="date" id="kta-dari" value="${escapeHtml(ctx.saringan.dari)}" />
      </div>
      <div class="form-row" style="margin:0">
        <label for="kta-sampai">sampai</label>
        <input type="date" id="kta-sampai" value="${escapeHtml(ctx.saringan.sampai)}" />
      </div>
      <button id="kta-khusus">+ Tugas khusus</button>
    </div>

    <div id="kta-pemutar"></div>

    ${
      terlihat.length
        ? `<div class="table-scroll"><table class="data-table table-freeze-1">
             <thead><tr>
               <th>Outlet</th><th>Tenggat</th><th>Isi</th><th>Status</th><th>Berkas</th><th>Aksi</th>
             </tr></thead>
             <tbody>${terlihat.map((t) => barisTugas(t, ctx, briefTetapPer)).join('')}</tbody>
           </table></div>`
        : '<p style="color:var(--color-text-muted);font-size:0.88rem">Tidak ada setoran pada rentang & saringan ini.</p>'
    }`;

  const muatUlang = () => gambarAntrean(wadah, ctx);

  wadah.querySelector('#kta-outlet').addEventListener('change', (e) => {
    ctx.saringan.outletId = e.target.value;
    muatUlang();
  });
  wadah.querySelector('#kta-status').addEventListener('change', (e) => {
    ctx.saringan.status = e.target.value;
    muatUlang();
  });
  wadah.querySelector('#kta-dari').addEventListener('change', (e) => {
    ctx.saringan.dari = e.target.value;
    muatUlang();
  });
  wadah.querySelector('#kta-sampai').addEventListener('change', (e) => {
    ctx.saringan.sampai = e.target.value;
    muatUlang();
  });

  wadah.querySelector('#kta-khusus').addEventListener('click', () => dialogTugasKhusus(ctx, muatUlang));

  const pemutar = wadah.querySelector('#kta-pemutar');
  const petaTugas = new Map(tugas.map((t) => [t.id, t]));

  wadah.querySelectorAll('[data-tonton]').forEach((btn) =>
    btn.addEventListener(
      'click',
      sekaliJalan(async () => {
        await tampilkanBerkas(pemutar, btn.dataset.tugas, btn.dataset.tonton, btn.dataset.jenis, btn.dataset.nama);
      })
    )
  );

  wadah.querySelectorAll('[data-brief]').forEach((btn) =>
    btn.addEventListener('click', () => dialogBrief(petaTugas.get(btn.dataset.brief), briefTetapPer, muatUlang))
  );

  wadah.querySelectorAll('[data-selesai]').forEach((btn) =>
    btn.addEventListener(
      'click',
      sekaliJalan(async () => {
        const t = petaTugas.get(btn.dataset.selesai);
        const jadiSelesai = btn.dataset.ke === 'selesai';
        if (jadiSelesai) {
          const k = kelengkapan(t?.konten_berkas ?? []);
          const yakin = await confirmDialog({
            title: 'Tandai setoran ini selesai?',
            // ============ PERINGATAN INI BUKAN HIASAN ============
            //
            // Menandai selesai adalah SATU-SATUNYA hal yang memicu penghapusan
            // berkasnya dari R2 tujuh hari kemudian. Admin yang menekannya
            // sebelum mengunduh akan kehilangan berkasnya tanpa pernah melihat
            // peringatan apa pun kalau kalimat ini tidak ada.
            message:
              `Berkasnya akan dihapus otomatis dari penyimpanan 7 hari setelah ini. ` +
              `Pastikan kamu sudah mengunduhnya.` +
              (k.lengkap ? '' : ` Catatan: setoran ini masih kurang ${k.kurang.join(' dan ')}.`),
            confirmText: 'Tandai selesai',
            danger: !k.lengkap
          });
          if (!yakin) return;
        }
        try {
          await tandaiSelesai(btn.dataset.selesai, jadiSelesai);
          toast(jadiSelesai ? 'Ditandai selesai.' : 'Dibuka kembali.', 'success');
          await muatUlang();
        } catch (e) {
          toast(e.message ?? 'Gagal menandai.', 'error');
        }
      })
    )
  );

  wadah.querySelectorAll('[data-hapus-berkas]').forEach((btn) =>
    btn.addEventListener(
      'click',
      sekaliJalan(async () => {
        const yakin = await confirmDialog({
          title: 'Hapus berkas ini sekarang?',
          message: `"${btn.dataset.nama}" dihapus dari penyimpanan dan tidak bisa dikembalikan.`,
          confirmText: 'Hapus',
          danger: true
        });
        if (!yakin) return;
        try {
          await hapusBerkasR2({ tugasId: btn.dataset.tugas, r2Key: btn.dataset.hapusBerkas });
          toast('Berkas dihapus.', 'success');
          await muatUlang();
        } catch (e) {
          toast(e.message ?? 'Gagal menghapus.', 'error');
        }
      })
    )
  );
}

function barisTugas(t, ctx, briefTetapPer) {
  const keadaan = keadaanTugas(t, ctx.hariIni);
  const berkas = t.konten_berkas ?? [];
  const k = kelengkapan(berkas);
  const brief = briefEfektif({ briefTugas: t.brief, briefTetapOutlet: briefTetapPer.get(t.outlet_id) });

  const lencana =
    keadaan.status === STATUS.SELESAI
      ? '<span class="nota-lunas">Selesai</span>'
      : keadaan.telat
        ? `<span class="nota-telat">Telat ${Math.abs(keadaan.sisaHari)} hari</span>`
        : keadaan.status === STATUS.DISETOR
          ? '<span class="nota-lunas">Sudah setor</span>'
          : keadaan.jatuhTempoHariIni
            ? '<span class="nota-telat">Tenggat hari ini</span>'
            : escapeHtml(keadaan.label);

  const selBerkas = keadaan.berkasDihapus
    ? '<span style="color:var(--color-text-muted);font-size:0.8rem">Berkas sudah dihapus otomatis</span>'
    : berkas.length
      ? berkas
          .map(
            (b) => `<div style="display:flex;gap:4px;align-items:center;margin-bottom:3px">
              <button class="btn-ghost btn-inline" data-tonton="${escapeHtml(b.r2_key)}" data-tugas="${escapeHtml(t.id)}"
                      data-jenis="${escapeHtml(b.jenis)}" data-nama="${escapeHtml(b.nama_asli ?? b.jenis)}"
                      style="font-size:0.78rem">
                ${b.jenis === 'video' ? '🎥' : '🖼️'} ${escapeHtml((b.nama_asli ?? b.jenis).slice(0, 28))}
              </button>
              <span style="color:var(--color-text-muted);font-size:0.74rem">${escapeHtml(mb(b.ukuran_byte))}</span>
              <button class="btn-ghost btn-inline" data-hapus-berkas="${escapeHtml(b.r2_key)}" data-tugas="${escapeHtml(t.id)}"
                      data-nama="${escapeHtml(b.nama_asli ?? b.jenis)}" style="font-size:0.72rem">✕</button>
            </div>`
          )
          .join('')
      : '<span style="color:var(--color-text-muted);font-size:0.8rem">Belum ada</span>';

  return `<tr>
    <td>${escapeHtml(ctx.namaOutlet.get(t.outlet_id) ?? t.outlet_id)}</td>
    <td>
      ${escapeHtml(t.tenggat)}
      <div style="color:var(--color-text-muted);font-size:0.74rem">
        ${escapeHtml(namaHariTanggal(t.tenggat))}${t.jenis === 'khusus' ? ' · khusus' : ''}
      </div>
    </td>
    <td style="max-width:260px">
      <div style="font-size:0.8rem">${escapeHtml(pesanKelengkapan(k))}</div>
      <div style="color:var(--color-text-muted);font-size:0.74rem;white-space:pre-wrap">
        ${escapeHtml(brief.teks.slice(0, 120))}${brief.teks.length > 120 ? '…' : ''}
      </div>
      <div style="color:var(--color-text-muted);font-size:0.72rem">${escapeHtml(ASAL_BRIEF[brief.asal] ?? '')}</div>
    </td>
    <td>
      ${lencana}
      ${t.diunduh_at ? '<div style="color:var(--color-text-muted);font-size:0.72rem">sudah diunduh</div>' : ''}
    </td>
    <td>${selBerkas}</td>
    <td style="white-space:nowrap">
      <button class="btn-ghost btn-inline" data-brief="${escapeHtml(t.id)}" style="font-size:0.76rem">Brief</button>
      ${
        keadaan.status === STATUS.SELESAI
          ? `<button class="btn-ghost btn-inline" data-selesai="${escapeHtml(t.id)}" data-ke="buka" style="font-size:0.76rem">Buka lagi</button>`
          : `<button class="btn-inline primary" data-selesai="${escapeHtml(t.id)}" data-ke="selesai" style="font-size:0.76rem">Selesai</button>`
      }
    </td>
  </tr>`;
}

/**
 * Tampilkan satu berkas di panel atas tabel.
 *
 * Panelnya satu untuk seluruh tabel, bukan satu per baris: pemutar video yang
 * ditanam di tiap baris berarti belasan elemen video sekaligus, masing-masing
 * memegang URL bertanda tangan — dan browser mulai memuat sebagiannya sendiri.
 */
async function tampilkanBerkas(panel, tugasId, r2Key, jenis, nama) {
  panel.innerHTML = loadingHtml('Menyiapkan tautan…', { baris: 1 });
  let url = '';
  try {
    const hasil = await urlTonton({ tugasId, r2Key });
    url = hasil?.url ?? '';
    if (!url) throw new Error('Tautan tidak diterima.');
  } catch (e) {
    panel.innerHTML = `<p class="error-text">${escapeHtml(e.message ?? e)}</p>`;
    return;
  }

  panel.innerHTML = `
    <div class="inline-card" style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px">
        <strong style="font-size:0.86rem">${escapeHtml(nama)}</strong>
        <button class="btn-ghost btn-inline" id="kta-tutup" style="font-size:0.76rem">Tutup</button>
      </div>
      ${
        jenis === 'video'
          ? `<video controls preload="metadata" src="${escapeHtml(url)}" style="width:100%;max-height:60vh;background:#000"></video>`
          : `<img src="${escapeHtml(url)}" alt="${escapeHtml(nama)}" style="max-width:100%;max-height:60vh" />`
      }
      <p style="margin:6px 0 0;font-size:0.78rem">
        <a id="kta-unduh" href="${escapeHtml(url)}" download="${escapeHtml(nama)}">Unduh berkas ini</a>
        <span style="color:var(--color-text-muted)"> · tautannya berlaku 1 jam</span>
      </p>
    </div>`;

  panel.querySelector('#kta-tutup').addEventListener('click', () => {
    panel.innerHTML = '';
  });
  // Penanda "sudah diunduh" diisi saat tautannya DIKLIK, bukan saat admin
  // menandai sendiri: penanda manual adalah pekerjaan tambahan yang paling
  // mudah dilupakan, dan penanda yang tidak pernah terisi sama saja tidak ada.
  panel.querySelector('#kta-unduh').addEventListener('click', () => {
    tandaiDiunduh(tugasId).catch(() => {
      /* penanda keterangan — kegagalannya tidak boleh menghalangi unduhan */
    });
  });
}

async function dialogBrief(tugas, briefTetapPer, muatUlang) {
  if (!tugas) return;
  const tetap = briefTetapPer.get(tugas.outlet_id);
  const hasil = await formDialog({
    title: 'Brief setoran ini',
    description:
      'Hanya untuk setoran ini. Kosongkan untuk memakai brief tetap outlet, atau brief bawaan kalau outletnya belum punya.',
    fields: [
      {
        name: 'brief',
        label: 'Brief',
        type: 'textarea',
        rows: 5,
        value: tugas.brief ?? '',
        help: tetap ? `Brief tetap outlet: ${tetap}` : `Tanpa brief tetap, yang dipakai: ${BRIEF_BAWAAN}`
      }
    ]
  });
  if (!hasil) return;
  try {
    await simpanBriefTugas(tugas.id, hasil.brief);
    toast('Brief disimpan.', 'success');
    await muatUlang();
  } catch (e) {
    toast(e.message ?? 'Gagal menyimpan brief.', 'error');
  }
}

async function dialogTugasKhusus(ctx, muatUlang) {
  const hasil = await formDialog({
    title: 'Tugas konten khusus',
    description: 'Di luar irama mingguan — misalnya untuk promo atau acara. Tidak mengubah jadwal tetap outlet.',
    fields: [
      {
        name: 'outlet',
        label: 'Outlet',
        type: 'select',
        required: true,
        options: ctx.outlets.map((o) => ({ value: o.id, label: o.name })),
        value: ctx.saringan.outletId || ctx.outlets[0]?.id
      },
      { name: 'tenggat', label: 'Tenggat setor', type: 'date', required: true, value: ctx.hariIni },
      { name: 'brief', label: 'Brief', type: 'textarea', rows: 4, placeholder: 'Mau diambil apa?' }
    ]
  });
  if (!hasil) return;
  try {
    await buatTugasKhusus({
      businessUnitId: ctx.businessUnitId,
      outletId: hasil.outlet,
      tenggat: hasil.tenggat,
      brief: hasil.brief
    });
    toast('Tugas khusus dibuat.', 'success');
    // Tenggatnya bisa di luar rentang saringan yang sedang aktif — tugas yang
    // baru dibuat lalu langsung tidak terlihat tampak seperti kegagalan.
    if (hasil.tenggat > ctx.saringan.sampai) ctx.saringan.sampai = hasil.tenggat;
    if (hasil.tenggat < ctx.saringan.dari) ctx.saringan.dari = hasil.tenggat;
    await muatUlang();
  } catch (e) {
    toast(e.message ?? 'Gagal membuat tugas.', 'error');
  }
}

// =====================================================================
// TAB 2 — JADWAL PER OUTLET
// =====================================================================

async function gambarJadwal(wadah, ctx) {
  wadah.innerHTML = loadingHtml('Memuat jadwal…', { baris: 3 });

  let setelan = [];
  try {
    setelan = await listSetelanOutlet(ctx.businessUnitId);
  } catch (e) {
    wadah.innerHTML = `<p class="error-text">${escapeHtml(e.message ?? e)}</p>`;
    return;
  }
  const per = new Map(setelan.map((s) => [s.outlet_id, s]));

  wadah.innerHTML = `
    <p style="font-size:0.84rem;color:var(--color-text-muted);margin:0 0 10px;max-width:620px">
      Outlet yang belum punya hari setor TIDAK melihat modul ini di Staff App. Tugas mingguannya lahir
      sendiri saat staff membuka layarnya — tidak ada jadwal terpisah yang perlu dijalankan.
    </p>
    <div class="table-scroll"><table class="data-table table-freeze-1">
      <thead><tr><th>Outlet</th><th>Hari setor</th><th>Brief tetap</th><th>Aktif</th><th>Aksi</th></tr></thead>
      <tbody>${ctx.outlets
        .map((o) => {
          const s = per.get(o.id);
          const adaHari = s && s.hari_setor !== null && s.hari_setor !== undefined;
          return `<tr>
            <td>${escapeHtml(o.name)}</td>
            <td>${adaHari ? escapeHtml(NAMA_HARI[Number(s.hari_setor)] ?? String(s.hari_setor)) : '<span style="color:var(--color-text-muted)">belum diatur</span>'}</td>
            <td style="max-width:320px;white-space:pre-wrap;font-size:0.82rem">${
              s?.brief_tetap
                ? escapeHtml(s.brief_tetap)
                : '<span style="color:var(--color-text-muted)">pakai brief bawaan</span>'
            }</td>
            <td>${s ? (s.aktif === false ? '<span class="nota-telat">nonaktif</span>' : '<span class="nota-lunas">aktif</span>') : '—'}</td>
            <td><button class="btn-ghost btn-inline" data-atur="${escapeHtml(o.id)}" style="font-size:0.78rem">Atur</button></td>
          </tr>`;
        })
        .join('')}</tbody>
    </table></div>`;

  wadah.querySelectorAll('[data-atur]').forEach((btn) =>
    btn.addEventListener('click', () => dialogSetelan(ctx, per.get(btn.dataset.atur), btn.dataset.atur, () => gambarJadwal(wadah, ctx)))
  );
}

async function dialogSetelan(ctx, setelan, outletId, muatUlang) {
  const nama = ctx.namaOutlet.get(outletId) ?? outletId;
  const adaHari = setelan && setelan.hari_setor !== null && setelan.hari_setor !== undefined;
  const hasil = await formDialog({
    title: `Jadwal konten — ${nama}`,
    description: 'Hari setor menentukan tenggat mingguan outlet ini. Brief tetap berlaku untuk semua minggunya.',
    fields: [
      {
        name: 'hari',
        label: 'Hari setor',
        type: 'select',
        required: true,
        options: NAMA_HARI.map((h, i) => ({ value: String(i), label: h })),
        value: adaHari ? String(setelan.hari_setor) : '5'
      },
      {
        name: 'brief',
        label: 'Brief tetap (opsional)',
        type: 'textarea',
        rows: 5,
        value: setelan?.brief_tetap ?? '',
        help: `Kalau dikosongkan, yang dipakai: ${BRIEF_BAWAAN}`
      },
      { name: 'aktif', label: 'Outlet ini ikut modul Konten Sosmed', type: 'checkbox', value: setelan ? setelan.aktif !== false : true }
    ]
  });
  if (!hasil) return;

  // Dibaca lewat penjaga eksplisit, bukan Number() langsung: Number('') adalah
  // 0, yang berarti sebuah pilihan kosong akan tersimpan diam-diam sebagai
  // "Minggu" — jebakan yang sama sudah menggigit di aturan-konten.js.
  const hari = Number(hasil.hari);
  if (!Number.isInteger(hari) || hari < 0 || hari > 6) return toast('Hari setor belum dipilih.', 'warning');

  try {
    await simpanSetelanOutlet(outletId, ctx.businessUnitId, {
      hariSetor: hari,
      briefTetap: hasil.brief,
      aktif: !!hasil.aktif
    });
    toast('Jadwal disimpan.', 'success');
    await muatUlang();
  } catch (e) {
    toast(e.message ?? 'Gagal menyimpan jadwal.', 'error');
  }
}
