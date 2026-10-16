/**
 * STAFF APP — Konten Sosmed: setor foto & video minggu ini.
 *
 * Satu layar menjawab satu pertanyaan: "apa yang harus saya ambil minggu ini,
 * dan apakah saya sudah selesai?"
 *
 * Berkasnya dikirim LANGSUNG ke Cloudflare R2, tidak lewat Supabase. Alasannya
 * ada di `supabase/functions/konten-r2/index.ts`.
 */
import { toast, confirmDialog } from '../../core/ui.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';
import { getMyBaseScope } from '../../core/base-scope.js';
import { listMyOutlets, PESAN_TANPA_OUTLET } from '../../core/my-outlets.js';
import { todayWIB } from '../shift/shift.service.js';
import {
  listSetelanOutlet,
  tugasMingguIni,
  urlUnggah,
  kirimKeR2,
  catatBerkas,
  hapusBerkasSendiri
} from './konten.service.js';
import {
  briefEfektif,
  keadaanTugas,
  kelengkapan,
  pesanKelengkapan,
  bolehTambah,
  sisaHari,
  NAMA_HARI
} from './aturan-konten.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * Batas ukuran berkas.
 *
 * R2 sendiri tidak membatasi segini — ini pagar yang KITA pilih, supaya satu
 * staff yang merekam 4K selama tiga menit tidak menghabiskan jatah 10 GB
 * sendirian. Angkanya longgar: 1 menit FHD dari HP kelas menengah sekitar
 * 141 MB, jadi 200 MB memberi ruang tanpa jadi pintu terbuka.
 */
const MAKS_BYTE = 200 * 1024 * 1024;

const mb = (b) => `${(Number(b || 0) / (1024 * 1024)).toFixed(1)} MB`;

export async function renderKontenPage(container, ctx) {
  const { businessUnitId } = ctx;
  container.innerHTML = loadingHtml('Memuat tugas konten…');

  let outlets = [];
  let setelanList = [];
  try {
    [outlets, setelanList] = await Promise.all([
      listMyOutlets(businessUnitId).catch(() => []),
      listSetelanOutlet(businessUnitId).catch(() => [])
    ]);
  } catch (e) {
    container.innerHTML = `<p class="error-text">${esc(e.message ?? e)}</p>`;
    return;
  }
  if (!outlets.length) {
    container.innerHTML = `<h1>Konten Sosmed</h1><p style="color:var(--color-text-muted)">${esc(PESAN_TANPA_OUTLET)}</p>`;
    return;
  }

  const setelanPer = new Map(setelanList.filter((s) => s.aktif !== false).map((s) => [s.outlet_id, s]));
  // Hanya outlet yang BENAR-BENAR punya setelan aktif. Outlet tanpa setelan
  // tidak ikut modul ini — menampilkannya dengan tugas kosong membuat staff
  // mengira ia lupa mengerjakan sesuatu yang memang tidak ada.
  const ikut = outlets.filter((o) => setelanPer.has(o.id));
  if (!ikut.length) {
    container.innerHTML = `
      <h1>Konten Sosmed</h1>
      <p style="color:var(--color-text-muted)">
        Outletmu belum diatur jadwal setor kontennya. Admin yang mengaturnya di Admin Portal.
      </p>`;
    return;
  }

  const basis = await getMyBaseScope({ business_unit_id: businessUnitId, outlet_id: ikut[0].id }).catch(() => null);
  const state = { outletId: ikut.some((o) => o.id === basis?.outlet_id) ? basis.outlet_id : ikut[0].id };

  container.innerHTML = `
    <h1>Konten Sosmed</h1>
    ${
      ikut.length > 1
        ? `<div class="form-row" style="max-width:320px">
             <label for="kt-outlet">Outlet</label>
             <select id="kt-outlet">${ikut
               .map((o) => `<option value="${esc(o.id)}"${o.id === state.outletId ? ' selected' : ''}>${esc(o.name)}</option>`)
               .join('')}</select>
           </div>`
        : ''
    }
    <div id="kt-isi"></div>`;

  container.querySelector('#kt-outlet')?.addEventListener('change', (e) => {
    state.outletId = e.target.value;
    gambar();
  });

  const isi = container.querySelector('#kt-isi');

  async function gambar() {
    isi.innerHTML = loadingHtml('Memuat…', { baris: 3 });
    const setelan = setelanPer.get(state.outletId);
    const hariIni = todayWIB();

    let tugas;
    try {
      tugas = await tugasMingguIni({
        businessUnitId,
        outletId: state.outletId,
        hariSetor: setelan?.hari_setor,
        hariIni
      });
    } catch (e) {
      isi.innerHTML = `<p class="error-text">${esc(e.message ?? e)}</p>`;
      return;
    }
    if (!tugas) {
      // Sejak layanan membedakan sebabnya, `null` HANYA berarti satu hal:
      // tenggatnya tidak bisa dihitung, yaitu hari setornya belum diisi.
      // Sebab lain (gagal membuat, gagal membaca) sekarang melempar galatnya
      // sendiri dan tertangkap di atas — dulu semuanya jatuh ke kalimat ini,
      // dan kalimat ini mengirim orang memeriksa jadwal yang sudah benar.
      isi.innerHTML = `<p class="error-text">Hari setor outlet ini belum diisi, jadi tenggatnya belum bisa dihitung. Beri tahu admin.</p>`;
      return;
    }

    const brief = briefEfektif({ briefTugas: tugas.brief, briefTetapOutlet: setelan?.brief_tetap });
    const berkas = tugas.konten_berkas ?? [];
    const k = kelengkapan(berkas);
    const keadaan = keadaanTugas(tugas, hariIni);
    const sisa = sisaHari(hariIni, tugas.tenggat);

    const kalimatTenggat =
      sisa === 0
        ? '<span class="nota-telat">Tenggatnya HARI INI</span>'
        : sisa > 0
          ? `Tenggat ${esc(NAMA_HARI[new Date(`${tugas.tenggat}T00:00:00Z`).getUTCDay()])}, ${sisa} hari lagi`
          : `<span class="nota-telat">Lewat ${Math.abs(sisa)} hari</span>`;

    isi.innerHTML = `
      <div class="inline-card" style="max-width:720px">
        <p style="margin:0 0 4px;font-size:0.82rem;color:var(--color-text-muted)">
          Setoran untuk ${esc(tugas.tenggat)} · ${kalimatTenggat}
        </p>
        <h3 style="margin:6px 0 4px;font-size:0.95rem">Brief</h3>
        <p style="margin:0 0 12px;font-size:0.9rem;white-space:pre-wrap">${esc(brief.teks)}</p>

        <p style="margin:0 0 10px;font-size:0.86rem">
          ${keadaan.status === 'selesai' ? '<span class="nota-lunas">Sudah ditandai selesai admin</span> · ' : ''}
          ${esc(pesanKelengkapan(k))}
        </p>

        ${
          keadaan.status === 'selesai'
            ? `<p style="font-size:0.82rem;color:var(--color-text-muted)">
                 Setoran ini sudah ditutup. Kalau masih ada yang perlu diubah, hubungi admin.
               </p>`
            : `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
                 <button id="kt-video"${k.penuh ? ' disabled' : ''}>🎥 Tambah video</button>
                 <button id="kt-foto"${k.penuh ? ' disabled' : ''}>🖼️ Tambah foto</button>
               </div>
               <!-- Dua input terpisah supaya 'accept' bisa menyaring galeri HP:
                    satu input gabungan membuat staff memilih foto saat yang
                    diminta video, dan salahnya baru ketahuan sesudah 141 MB
                    terkirim. -->
               <input type="file" id="kt-file-video" accept="video/*" hidden />
               <input type="file" id="kt-file-foto" accept="image/*" hidden />
               <div id="kt-maju" style="font-size:0.84rem;margin-bottom:8px"></div>`
        }

        ${
          berkas.length
            ? `<ul style="list-style:none;padding:0;margin:0">${berkas
                .map(
                  (b) => `<li style="display:flex;justify-content:space-between;align-items:center;gap:8px;
                                      padding:6px 0;border-top:1px solid var(--color-border)">
                    <span style="font-size:0.86rem">
                      ${b.jenis === 'video' ? '🎥' : '🖼️'} ${esc(b.nama_asli ?? b.jenis)}
                      <span style="color:var(--color-text-muted);font-size:0.78rem"> · ${esc(mb(b.ukuran_byte))}</span>
                    </span>
                    ${
                      keadaan.status === 'selesai'
                        ? ''
                        : `<button class="kt-hapus" data-id="${esc(b.id)}" data-nama="${esc(b.nama_asli ?? b.jenis)}">Hapus</button>`
                    }
                  </li>`
                )
                .join('')}</ul>`
            : '<p style="font-size:0.84rem;color:var(--color-text-muted);margin:0">Belum ada berkas.</p>'
        }
      </div>`;

    const maju = isi.querySelector('#kt-maju');

    const pasangUnggah = (tombolId, inputId, jenis) => {
      const tombol = isi.querySelector(tombolId);
      const input = isi.querySelector(inputId);
      if (!tombol || !input) return;
      tombol.addEventListener('click', () => input.click());
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        // Nilainya dikosongkan SEKARANG, bukan nanti: tanpa ini, memilih
        // berkas yang SAMA dua kali berturut-turut tidak memicu `change`
        // sama sekali, dan staff mengira tombolnya rusak.
        input.value = '';
        if (!file) return;

        const izin = bolehTambah(berkas, { jenis, ukuran: file.size }, { maksByte: MAKS_BYTE });
        if (!izin.boleh) return toast(izin.alasan, 'warning');

        tombol.disabled = true;
        maju.textContent = `Mengunggah ${file.name}… 0%`;
        try {
          const ext = (file.name.split('.').pop() ?? '').slice(0, 5);
          const { url, r2_key: kunci } = await urlUnggah({ tugasId: tugas.id, jenis, ext });
          await kirimKeR2(url, file, {
            onProgress: (p) => {
              maju.textContent = `Mengunggah ${file.name}… ${Math.round(p * 100)}%`;
            }
          });
          // Dicatat SESUDAH berkasnya benar-benar sampai. Kalau dicatat lebih
          // dulu, unggahan yang gagal di tengah meninggalkan baris yang
          // menunjuk objek yang tidak pernah ada — dan layar menampilkannya
          // sebagai berkas yang sah sampai ada yang mencoba memutarnya.
          await catatBerkas({ tugasId: tugas.id, jenis, r2Key: kunci, namaAsli: file.name, ukuran: file.size });
          toast('Berkas tersimpan.', 'success');
          await gambar();
        } catch (e) {
          maju.textContent = '';
          toast(e.message ?? 'Gagal mengunggah.', 'error');
        } finally {
          tombol.disabled = false;
        }
      });
    };
    pasangUnggah('#kt-video', '#kt-file-video', 'video');
    pasangUnggah('#kt-foto', '#kt-file-foto', 'foto');

    isi.querySelectorAll('.kt-hapus').forEach((btn) =>
      btn.addEventListener(
        'click',
        sekaliJalan(async () => {
          const yakin = await confirmDialog({
            title: 'Hapus berkas ini?',
            message: `"${btn.dataset.nama}" akan dihapus dari setoran minggu ini. Kamu bisa mengunggah penggantinya setelah ini.`,
            confirmText: 'Hapus',
            danger: true
          });
          if (!yakin) return;
          try {
            await hapusBerkasSendiri(btn.dataset.id);
            toast('Berkas dihapus.', 'success');
            await gambar();
          } catch (e) {
            toast(e.message ?? 'Gagal menghapus.', 'error');
          }
        })
      )
    );
  }

  await gambar();
}
