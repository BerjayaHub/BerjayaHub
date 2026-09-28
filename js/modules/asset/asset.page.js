import { listMyOutlets } from '../../core/my-outlets.js';
import { listBuOwner } from '../owner/owner.service.js';
import { toast, confirmDialog, formDialog } from '../../core/ui.js';
import { formatNum } from '../../core/format.js';
import { exportTablePDF, imageToDataUrl } from '../../core/pdf.js';
import { exportTableXLSXFoto } from '../../core/xlsx-foto.js';
import {
  ASSET_CONDITION,
  ASSET_CONDITION_BADGE,
  ASSET_CONDITION_OPTIONS,
  conditionText,
  listAssets,
  saveAsset,
  deleteAsset,
  getAssetPhotoUrl,
  getAssetPhotoUrls,
  listKategoriAset,
  bacaBerkasImporAset,
  pindahAset,
  pindahFotoAset
} from './asset.service.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';
// Kalimat "yang sedang disaring" tinggal di SATU tempat. Tiga salinan sudah
// menyimpang sebelum berkas itu ada: subjudul PDF tidak menyebut kata
// pencarian sama sekali, jadi PDF hasil saringan terlihat seperti laporan
// lengkap di tangan orang yang menerimanya.
import { adaSaringan, ringkasSaringan } from './saringan-aset.js';
import { pesanGagalFoto, PESAN_GAGAL_UMUM } from '../../core/tautan-foto.js';
// Aturan impornya tinggal di modul murni — bisa diuji terhadap berkas .xlsx
// sungguhan tanpa browser, dan layar ini cuma menggambarkannya.
import { barisTemplateAset, susunImporAset, nilaiSimpan, ringkasImpor } from './impor-aset.js';

/**
 * Inventaris Aset — dipakai Staff App maupun Admin Portal.
 *
 * Bedanya hanya cakupan outlet: staff melihat outlet dalam scope-nya, admin
 * melihat seluruh outlet BU. Isi halamannya sama supaya tidak ada dua tampilan
 * yang harus dijaga sinkron.
 */
export function renderAssetPage(container, ctx) {
  return render(container, ctx, false);
}
export function renderAssetAdminPage(container, ctx) {
  return render(container, ctx, true);
}

async function render(container, { businessUnitId }, isAdmin) {
  container.innerHTML = loadingHtml('Memuat inventaris…');

  // Admin maupun staff sama-sama dibatasi scope-nya. Sebelumnya `isAdmin` melewati
  // penyaringan sama sekali, sehingga admin outlet melihat seluruh outlet BU.
  const outlets = await listMyOutlets(businessUnitId).catch(() => []);
  if (!outlets.length) {
    container.innerHTML = `<h1>Inventaris Aset</h1><p style="color:var(--color-text-muted)">Belum ada outlet yang bisa kamu akses di BU ini.</p>`;
    return;
  }

  const state = { outletId: isAdmin ? '' : outlets[0].id, condition: '', category: '', q: '', catatan: '' };
  let rows = [];
  /** Kategori yang sudah dipakai di BU ini — sumber dropdown & pilihan form. */
  let kategori = await listKategoriAset(businessUnitId).catch(() => []);
  /** id aset yang dicentang untuk dipindah (khusus admin). */
  const dipilih = new Set();
  /** photo_path -> signed URL, diisi ulang tiap refresh. */
  let fotoUrl = new Map();

  container.innerHTML = `
    <div class="page-header">
      <h1 style="margin:0">Inventaris Aset</h1>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button id="as-pdf">⇩ Export PDF</button>
        ${isAdmin ? '<button id="as-xlsx">⇩ Export Excel</button>' : ''}
        ${isAdmin ? '<button id="as-tpl">⇩ Template Impor</button>' : ''}
        ${isAdmin ? '<button id="as-impor">⇧ Impor Excel</button><input type="file" id="as-file" accept=".xlsx" hidden />' : ''}
        ${isAdmin ? '<button id="as-move" disabled>↔ Pindahkan (0)</button>' : ''}
        <button class="primary" id="as-new" style="max-width:170px">+ Tambah Aset</button>
      </div>
    </div>

    <div class="inline-card" style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
      <div class="field" style="margin:0;max-width:220px"><label>Outlet</label>
        <select id="as-outlet">
          ${isAdmin ? '<option value="">Semua outlet</option>' : ''}
          ${outlets.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}
        </select>
      </div>
      <div class="field" style="margin:0;max-width:200px"><label>Kategori</label>
        <select id="as-cat"><option value="">Semua kategori</option>${kategori
          .map((c) => `<option value="${esc(c)}">${esc(c)}</option>`)
          .join('')}</select>
      </div>
      <div class="field" style="margin:0;max-width:180px"><label>Kondisi</label>
        <select id="as-cond"><option value="">Semua</option>${ASSET_CONDITION_OPTIONS.map((c) => `<option value="${c.value}">${esc(c.label)}</option>`).join('')}</select>
      </div>
      <div class="field" style="margin:0;max-width:220px"><label>Cari nama barang</label><input type="text" id="as-q" placeholder="mis. kursi" /></div>
      <div class="field" style="margin:0;max-width:220px"><label>Cari catatan</label><input type="text" id="as-note" placeholder="mis. pecah, hibah" /></div>
    </div>

    <div id="as-impor-hasil" style="margin-top:12px"></div>
    <div id="as-list" style="margin-top:12px"></div>
  `;

  const list = container.querySelector('#as-list');
  container.querySelector('#as-outlet').addEventListener('change', (e) => {
    state.outletId = e.target.value;
    refresh();
  });
  container.querySelector('#as-cond').addEventListener('change', (e) => {
    state.condition = e.target.value;
    refresh();
  });
  container.querySelector('#as-cat').addEventListener('change', (e) => {
    state.category = e.target.value;
    refresh();
  });
  // SATU penunda untuk KEDUA kotak.
  //
  // Dua `let timer` terpisah terlihat lebih rapi dan salah: mengetik cepat
  // bergantian di dua kotak menembakkan dua permintaan yang balapan, dan yang
  // menang belum tentu yang terakhir diketik. Tabelnya lalu menampilkan hasil
  // pencarian yang sudah diganti orangnya.
  let timer;
  const tunda = () => {
    clearTimeout(timer);
    timer = setTimeout(refresh, 300);
  };
  container.querySelector('#as-q').addEventListener('input', (e) => {
    state.q = e.target.value.trim();
    tunda();
  });
  container.querySelector('#as-note').addEventListener('input', (e) => {
    state.catatan = e.target.value.trim();
    tunda();
  });
  container.querySelector('#as-new').addEventListener('click', () => openForm(null));
  container.querySelector('#as-pdf').addEventListener('click', exportPdf);
  // `sekaliJalan` menahan klik kedua selagi foto masih diambil. Tanpa itu,
  // menekan dua kali menjalankan dua unduhan yang saling berebut jaringan dan
  // menghasilkan dua file yang sebagian fotonya kosong.
  container.querySelector('#as-xlsx')?.addEventListener('click', sekaliJalan(exportXlsx, { teks: 'Menyiapkan…' }));
  container.querySelector('#as-move')?.addEventListener('click', sekaliJalan(bukaPindah, { teks: 'Memindahkan…' }));
  container.querySelector('#as-tpl')?.addEventListener('click', sekaliJalan(unduhTemplate, { teks: 'Menyiapkan…' }));
  const berkasImpor = container.querySelector('#as-file');
  container.querySelector('#as-impor')?.addEventListener('click', () => berkasImpor?.click());
  berkasImpor?.addEventListener('change', async () => {
    const f = berkasImpor.files?.[0];
    // Kotaknya DIKOSONGKAN sebelum diproses. Tanpa ini, memilih berkas yang
    // SAMA dua kali tidak menyalakan `change` sama sekali — dan orang yang
    // baru membetulkan isinya akan mengira tombolnya rusak.
    berkasImpor.value = '';
    if (f) await bacaImpor(f);
  });
  const hasilImpor = container.querySelector('#as-impor-hasil');

  async function refresh() {
    list.innerHTML = loadingHtml('Memuat…', { baris: 5 });
    try {
      rows = await listAssets({
        businessUnitId,
        outletId: state.outletId,
        condition: state.condition,
        category: state.category,
        q: state.q,
        catatan: state.catatan
      });
    } catch (error) {
      list.innerHTML = `<p class="error-text">${esc(error.message ?? error)}</p>`;
      return;
    }
    // Semua signed URL diambil sekali untuk seluruh halaman. Satu permintaan
    // per baris akan menembakkan puluhan koneksi berbarengan dan sebagian
    // tertunda lama — tabelnya lalu tampak "sebagian fotonya rusak".
    fotoUrl = await getAssetPhotoUrls(rows.map((a) => a.photo_path));

    const rusak = rows.filter((a) => a.condition === 'rusak').length;
    const totalUnit = rows.reduce((t, a) => t + (Number(a.qty) || 0), 0);

    list.innerHTML = `
      <p style="font-size:0.82rem;color:var(--color-text-muted);margin:0 0 8px">
        <strong>${rows.length}</strong> jenis barang · <strong>${formatNum(totalUnit)}</strong> unit
        ${rusak ? ` · <span style="color:var(--color-danger)"><strong>${rusak}</strong> rusak</span>` : ''}
      </p>
      <div class="table-scroll">
        <table class="data-table table-freeze-1 kartu-sempit">
          <thead><tr>${isAdmin ? '<th style="width:34px"><input type="checkbox" id="as-all" title="Pilih semua yang terlihat" /></th>' : ''}<th>Nama Barang</th><th>Foto</th><th>Kategori</th><th>Jumlah</th><th>Ukuran</th><th>Kondisi</th>${isAdmin ? '<th>Outlet</th>' : ''}<th>Aksi</th></tr></thead>
          <tbody>
            ${
              rows
                .map(
                  (a) => `<tr>
                    ${isAdmin ? `<td data-label="Pilih"><input type="checkbox" class="as-pick" data-id="${a.id}"${dipilih.has(a.id) ? ' checked' : ''} /></td>` : ''}
                    <td data-label="Nama Barang"><strong>${esc(a.name)}</strong>${a.notes ? `<div style="font-size:0.74rem;color:var(--color-text-muted)">${esc(a.notes)}</div>` : ''}</td>
                    <td data-label="Foto">${fotoSel(a, fotoUrl)}</td>
                    <td style="font-size:0.85rem" data-label="Kategori">${esc(a.category ?? '-')}</td>
                    <td style="text-align:right" data-label="Jumlah">${formatNum(a.qty)}</td>
                    <td style="font-size:0.85rem" data-label="Ukuran">${esc(a.size ?? '-')}</td>
                    <td data-label="Kondisi"><span class="badge ${ASSET_CONDITION_BADGE[a.condition] ?? ''}">${esc(conditionText(a))}</span></td>
                    ${isAdmin ? `<td style="font-size:0.82rem" data-label="Outlet">${esc(a.outlets?.name ?? '-')}</td>` : ''}
                    <td data-label="Aksi">
                      <button class="as-edit" data-id="${a.id}">Edit</button>
                      <button class="as-del" data-id="${a.id}">Hapus</button>
                    </td>
                  </tr>`
                )
                .join('') ||
                `<tr><td colspan="${isAdmin ? 9 : 7}">${
                  adaSaringan(state)
                    ? 'Tidak ada aset yang cocok dengan saringan ini.'
                    : 'Belum ada aset tercatat.'
                }</td></tr>`
            }
          </tbody>
        </table>
      </div>
    `;

    // CENTANG DISIMPAN DI LUAR TABEL.
    //
    // Tabelnya digambar ulang tiap kali saringan berubah, dan centang yang
    // hidup di DOM akan ikut hilang. Kalau begitu, admin yang memilih 5 aset di
    // outlet A lalu berpindah saringan untuk memilih 3 di outlet B akan
    // memindahkan 3, bukan 8 — tanpa satu pun tanda bahwa 5 lainnya terlepas.
    list.querySelectorAll('.as-pick').forEach((cb) =>
      cb.addEventListener('change', () => {
        if (cb.checked) dipilih.add(cb.dataset.id);
        else dipilih.delete(cb.dataset.id);
        syncPindah();
      })
    );
    list.querySelector('#as-all')?.addEventListener('change', (e) => {
      // "Pilih semua" hanya menyentuh yang SEDANG TERLIHAT. Mencentang seluruh
      // BU dari satu kotak terlalu mudah disalahgunakan, dan akibatnya tidak
      // bisa dibatalkan dengan satu tombol.
      for (const cb of list.querySelectorAll('.as-pick')) {
        cb.checked = e.target.checked;
        if (e.target.checked) dipilih.add(cb.dataset.id);
        else dipilih.delete(cb.dataset.id);
      }
      syncPindah();
    });
    syncPindah();

    // THUMBNAIL DAN TOMBOL "LIHAT" MEMBUKA LEWAT JALAN YANG SAMA.
    //
    // Versi sebelumnya membuka `img.src` — tautan yang dibuat saat TABELNYA
    // dimuat, untuk seluruh baris sekaligus. Gambarnya sudah terunduh dan
    // tinggal di cache, jadi tabelnya tetap terlihat normal selamanya; yang
    // mati cuma tautannya. Staff yang halamannya terbuka berjam-jam menekan
    // tautan kedaluwarsa dan mendapat layar hitam berisi JSON, sementara yang
    // membuka halaman lalu langsung menekan tidak pernah melihatnya.
    //
    // Sekarang keduanya membuat tautan BARU saat diketuk.
    const bukaFoto = async (path) => {
      if (!path) return;
      try {
        const url = await getAssetPhotoUrl(path);
        if (url) window.open(url, '_blank');
        else toast(PESAN_GAGAL_UMUM, 'warning');
      } catch (error) {
        // Kalimatnya dibedakan: kedaluwarsa menyuruh memuat ulang, izin
        // menyuruh menghubungi admin. Satu kalimat untuk keduanya membuat
        // orang yang tautannya cuma kedaluwarsa pergi meminta hak akses yang
        // sudah ia punya.
        toast(pesanGagalFoto(error), 'error');
      }
    };
    list.querySelectorAll('.as-thumb').forEach((img) => img.addEventListener('click', () => bukaFoto(img.dataset.path)));
    list.querySelectorAll('.as-photo').forEach((b) => b.addEventListener('click', () => bukaFoto(b.dataset.path)));
    list.querySelectorAll('.as-edit').forEach((b) => b.addEventListener('click', () => openForm(rows.find((a) => a.id === b.dataset.id))));
    list.querySelectorAll('.as-del').forEach((b) =>
      b.addEventListener('click', sekaliJalan(async () => {
        const a = rows.find((x) => x.id === b.dataset.id);
        const ok = await confirmDialog({
          title: `Hapus "${a.name}"?`,
          message: 'Data aset ini akan hilang permanen beserta fotonya.',
          confirmText: 'Hapus',
          danger: true
        });
        if (!ok) return;
        try {
          await deleteAsset(a.id);
          toast('Aset dihapus.', 'success');
          await refresh();
        } catch (error) {
          toast(error.message ?? 'Gagal menghapus.', 'error');
        }
      }))
    );
  }

  /** Muat ulang daftar kategori & isi ulang dropdown saringannya. */
  async function muatKategori() {
    kategori = await listKategoriAset(businessUnitId).catch(() => kategori);
    const sel = container.querySelector('#as-cat');
    if (!sel) return;
    // Pilihan yang sedang aktif DIPERTAHANKAN. Menggambar ulang dropdown lalu
    // membiarkannya kembali ke "Semua kategori" akan membuat daftar melebar
    // sendiri tepat setelah orang menyimpan — dan terlihat seperti saringannya
    // rusak.
    const aktif = state.category;
    sel.innerHTML =
      '<option value="">Semua kategori</option>' +
      kategori.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    sel.value = kategori.includes(aktif) ? aktif : '';
    state.category = sel.value;
  }

  /** Tombol Pindahkan menyebut ANGKANYA, bukan sekadar aktif/mati. */
  function syncPindah() {
    const btn = container.querySelector('#as-move');
    if (!btn) return;
    btn.disabled = dipilih.size === 0;
    btn.textContent = `↔ Pindahkan (${dipilih.size})`;
  }

  /**
   * Pindahkan aset terpilih ke outlet / BU lain.
   *
   * Fotonya ikut dipindahkan SESUDAH barisnya berpindah, karena berkas storage
   * tidak bisa dipindahkan dari dalam SQL. Urutan itu disengaja: kalau
   * pemindahan baris gagal, tidak ada berkas yang terlanjur pindah dan
   * tertinggal di folder yang salah.
   */
  async function bukaPindah() {
    if (!dipilih.size) return;

    let daftarBu = [];
    try {
      daftarBu = await listBuOwner();
    } catch {
      daftarBu = [];
    }
    // Kalau daftar BU tidak bisa diambil (bukan super admin), pemindahan tetap
    // bisa dilakukan DI DALAM BU ini. Menutup fiturnya sama sekali karena satu
    // daftar gagal dimuat jauh lebih merepotkan daripada pilihan yang lebih
    // sempit.
    if (!daftarBu.length) daftarBu = [{ id: businessUnitId, name: 'BU ini' }];

    const terpilih = rows.filter((a) => dipilih.has(a.id));
    const nama = terpilih.slice(0, 5).map((a) => a.name).join(', ');

    const nilai = await formDialog({
      title: `Pindahkan ${dipilih.size} aset`,
      fields: [
        {
          name: 'bu',
          label: 'BU tujuan',
          type: 'select',
          required: true,
          value: businessUnitId,
          options: daftarBu.map((b) => ({ value: b.id, label: b.name }))
        },
        {
          name: 'outlet',
          label: 'Outlet tujuan',
          type: 'select',
          required: true,
          value: outlets[0].id,
          options: outlets.map((o) => ({ value: o.id, label: o.name })),
          help: 'Daftar outlet menyesuaikan BU yang dipilih.'
        }
      ],
      submitText: 'Pindahkan',
      onReady: (form) => {
        const buSel = form.elements['bu'];
        const outSel = form.elements['outlet'];

        // OUTLET HARUS MENGIKUTI BU. Membiarkan keduanya bebas memungkinkan
        // kombinasi yang mustahil (outlet BU A di bawah BU B) — dan itu persis
        // yang ditolak `pindah_aset()`, jadi lebih baik tidak bisa dipilih
        // daripada ditolak setelah menekan tombol.
        const isiOutlet = async () => {
          const bu = buSel.value;
          let daftar = outlets;
          if (bu !== businessUnitId) {
            daftar = await listMyOutlets(bu).catch(() => []);
          }
          outSel.innerHTML = daftar.length
            ? daftar.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join('')
            : '<option value="">— tidak ada outlet yang bisa kamu akses —</option>';
        };
        buSel.addEventListener('change', isiOutlet);
      }
    });
    if (!nilai) return;
    if (!nilai.outlet) return toast('Pilih outlet tujuan dulu.', 'warning');

    const ok = await confirmDialog({
      title: `Pindahkan ${dipilih.size} aset?`,
      message: `${nama}${terpilih.length > 5 ? `, dan ${terpilih.length - 5} lainnya` : ''}.\n\nFoto ikut dipindahkan ke folder outlet tujuan.`,
      confirmText: 'Ya, pindahkan'
    });
    if (!ok) return;

    try {
      const hasil = await pindahAset({ ids: [...dipilih], businessUnitId: nilai.bu, outletId: nilai.outlet });

      // Fotonya menyusul. `pindah_aset()` sudah mengosongkan `photo_path` bagi
      // yang berganti outlet, jadi yang gagal di sini berakhir sebagai aset
      // tanpa foto — bukan aset dengan tautan yang selalu gagal dibuka.
      const perluFoto = terpilih
        .filter((a) => a.photo_path && a.outlet_id !== nilai.outlet)
        .map((a) => ({ assetId: a.id, dariPath: a.photo_path, keOutletId: nilai.outlet }));

      let foto = { berhasil: 0, gagal: [] };
      if (perluFoto.length) {
        toast(`Memindahkan ${perluFoto.length} foto…`, 'info');
        foto = await pindahFotoAset(perluFoto);
      }

      dipilih.clear();

      // DIKATAKAN APA ADANYA. "Berhasil dipindahkan" yang menutupi 12 aset
      // ditolak adalah kegagalan terburuk di layar ini: orang akan mencarinya
      // di outlet tujuan dan tidak menemukannya.
      const bagian = [`${hasil.pindah} aset dipindahkan`];
      if (hasil.ditolak) bagian.push(`${hasil.ditolak} ditolak (di luar outlet yang bisa kamu kelola)`);
      if (foto.gagal.length) bagian.push(`${foto.gagal.length} foto gagal ikut — asetnya pindah tanpa foto`);
      else if (foto.berhasil) bagian.push(`${foto.berhasil} foto ikut`);

      toast(bagian.join(' · '), hasil.ditolak || foto.gagal.length ? 'warning' : 'success');
      await muatKategori();
      await refresh();
    } catch (error) {
      toast(error.message ?? 'Gagal memindahkan aset.', 'error');
    }
  }

  async function openForm(existing) {
    // Admin bisa memilih "Semua outlet" di filter — untuk menyimpan, outletnya
    // harus tegas, jadi default ke outlet pertama.
    const outletDefault = existing?.outlet_id ?? state.outletId ?? outlets[0].id;

    const values = await formDialog({
      title: existing ? `Edit Aset — ${existing.name}` : 'Tambah Aset',
      fields: [
        {
          name: 'outlet_id',
          label: 'Outlet',
          type: 'select',
          required: true,
          value: outletDefault || outlets[0].id,
          options: outlets.map((o) => ({ value: o.id, label: o.name }))
        },
        { name: 'name', label: 'Nama barang', type: 'text', required: true, value: existing?.name ?? '' },
        {
          // Pola persis seperti Master Produk: pilih yang sudah ada, atau ketik
          // nama baru lalu pilih "+ Tambah …". Tidak ada langkah "buat kategori
          // dulu" yang harus dikerjakan admin sebelum barang bisa dicatat.
          name: 'category',
          label: 'Kategori',
          type: 'searchselect',
          allowCreate: true,
          value: existing?.category ?? '',
          options: kategori.map((c) => ({ value: c, label: c })),
          placeholder: 'cari / ketik kategori baru…',
          help: 'Ketik nama baru lalu pilih “+ Tambah …” untuk membuat kategori.'
        },
        { name: 'qty', label: 'Jumlah', type: 'qty', required: true, value: existing?.qty ?? 1 },
        { name: 'size', label: 'Ukuran barang', type: 'text', value: existing?.size ?? '', placeholder: 'mis. 120x60 cm / 3 inci / L' },
        {
          name: 'condition',
          label: 'Kondisi barang',
          type: 'select',
          required: true,
          value: existing?.condition ?? 'normal',
          options: ASSET_CONDITION_OPTIONS
        },
        {
          name: 'condition_note',
          label: 'Keterangan kondisi',
          type: 'text',
          value: existing?.condition_note ?? '',
          placeholder: 'isi kalau kondisi "Lain-lain"',
          help: 'Wajib diisi kalau kondisi dipilih Lain-lain.'
        },
        { name: 'notes', label: 'Catatan (opsional)', type: 'text', value: existing?.notes ?? '' },
        {
          name: 'file',
          label: existing?.photo_path ? 'Ganti foto (opsional)' : 'Foto barang (opsional)',
          // Kamera belakang: barang difoto langsung di tempat, bukan dicari-cari
          // di galeri. Galeri tetap tersedia sebagai tombol kedua.
          type: 'photo',
          facing: 'environment',
          help: 'Ambil Foto membuka kamera langsung. Kalau fotonya sudah ada, pakai Dari Galeri.'
        }
      ],
      submitText: 'Simpan',
      onReady: (form) => {
        // Kolom keterangan hanya relevan untuk "Lain-lain" — disembunyikan
        // supaya form tidak terasa penuh isian yang tidak dipakai.
        const cond = form.elements['condition'];
        const noteField = form.elements['condition_note'].closest('.field');
        const sync = () => (noteField.style.display = cond.value === 'lainnya' ? '' : 'none');
        cond.addEventListener('change', sync);
        sync();
      }
    });
    if (!values) return;
    if (values.condition === 'lainnya' && !values.condition_note?.trim()) {
      return toast('Isi keterangan kondisinya dulu.', 'warning');
    }

    try {
      await saveAsset({
        id: existing?.id,
        businessUnitId,
        outletId: values.outlet_id,
        name: values.name,
        category: values.category,
        qty: values.qty,
        size: values.size,
        condition: values.condition,
        conditionNote: values.condition_note,
        notes: values.notes,
        file: values.file
      });
      toast(existing ? 'Aset diperbarui.' : 'Aset ditambahkan.', 'success');
      // Kategori baru harus langsung bisa dipakai menyaring. Tanpa ini, orang
      // yang baru saja membuat "Elektronik" tidak akan menemukannya di dropdown
      // sampai halamannya dimuat ulang — dan akan membuatnya lagi.
      await muatKategori();
      await refresh();
    } catch (error) {
      toast(error.message ?? 'Gagal menyimpan aset.', 'error');
    }
  }

  async function exportPdf() {
    if (!rows.length) return toast('Tidak ada data untuk diexport.', 'warning');
    const nama = state.outletId ? outlets.find((o) => o.id === state.outletId)?.name ?? '-' : 'Semua outlet';
    try {
      toast('Menyiapkan foto untuk PDF…', 'info');

      // Foto diubah jadi data URL kecil. jsPDF memuat gambar secara SINKRON,
      // jadi URL jaringan menghasilkan halaman kosong tanpa error apa pun.
      // Dikerjakan berurutan (bukan Promise.all) supaya ratusan gambar tidak
      // dimuat serentak dan membuat tab menggantung.
      const fotoPdf = new Map();
      for (const a of rows) {
        if (!a.photo_path) continue;
        const url = fotoUrl.get(a.photo_path);
        if (!url) continue;
        const dataUrl = await imageToDataUrl(url, 160, 0.7);
        if (dataUrl) fotoPdf.set(a.id, dataUrl);
      }

      await exportTablePDF({
        title: 'Inventaris Aset',
        subtitle: `${nama}${ringkasSaringan(state, ASSET_CONDITION)} · ${rows.length} jenis barang`,
        columns: [
          { header: 'Foto', width: 0.9 },
          { header: 'Nama Barang', width: 1.8 },
          { header: 'Kategori', width: 1.1 },
          { header: 'Jumlah', width: 0.7 },
          { header: 'Ukuran', width: 1.2 },
          { header: 'Kondisi', width: 1.6 },
          { header: 'Outlet', width: 1.3 },
          { header: 'Catatan', width: 1.6 }
        ],
        rows: rows.map((a) => [
          fotoPdf.has(a.id) ? { image: fotoPdf.get(a.id), w: 46, h: 34 } : '-',
          a.name,
          a.category ?? '-',
          formatNum(a.qty),
          a.size ?? '-',
          conditionText(a),
          a.outlets?.name ?? '-',
          a.notes ?? '-'
        ]),
        filename: 'inventaris-aset'
      });
      toast('PDF inventaris terunduh.', 'success');
    } catch (error) {
      toast(error.message ?? 'Gagal membuat PDF.', 'error');
    }
  }

  /**
   * Export Excel dengan foto TERTANAM di dalam selnya.
   *
   * Fotonya benar-benar ikut ke dalam berkas, bukan tautan. Bucket `asset-photos`
   * bersifat privat, jadi satu-satunya URL yang bisa ditulis ke dalam file adalah
   * signed URL — dan signed URL kedaluwarsa. File yang hari ini penuh gambar
   * akan jadi deretan sel rusak dalam hitungan hari, di komputer orang yang
   * sudah tidak ingat file itu datang dari mana. Alasan lengkapnya di
   * `core/xlsx-foto.js`.
   */
  async function exportXlsx() {
    if (!rows.length) return toast('Tidak ada data untuk diexport.', 'warning');
    const nama = state.outletId ? outlets.find((o) => o.id === state.outletId)?.name ?? '-' : 'Semua outlet';
    const berfoto = rows.filter((a) => a.photo_path).length;

    try {
      if (berfoto) toast(`Menyiapkan ${berfoto} foto…`, 'info');

      // Berurutan, BUKAN Promise.all. Ratusan gambar yang dimuat serentak
      // membuat sebagian permintaan tertunda lama atau ditolak — dan hasilnya
      // file yang "sebagian fotonya hilang" tanpa sebab yang jelas. Sama seperti
      // yang sudah dilakukan di jalur PDF.
      const fotoSel = new Map();
      for (const a of rows) {
        if (!a.photo_path) continue;
        const url = fotoUrl.get(a.photo_path);
        // Signed URL-nya sendiri gagal dibuat, atau gambarnya gagal dimuat.
        // Dua-duanya ditandai 'GAGAL', bukan dikosongkan: sel kosong terbaca
        // sebagai "barang ini belum difoto", dan orang akan disuruh memfoto
        // ulang barang yang fotonya sudah ada.
        const dataUrl = url ? await imageToDataUrl(url, 220, 0.72) : null;
        fotoSel.set(a.id, dataUrl ?? 'GAGAL');
      }

      const hasil = await exportTableXLSXFoto({
        filename: `inventaris-aset-${new Date().toISOString().slice(0, 10)}`,
        sheetName: 'Inventaris Aset',
        title: 'Inventaris Aset',
        subtitle: `${nama}${ringkasSaringan(state, ASSET_CONDITION)} · ${rows.length} jenis barang · diunduh ${new Date().toLocaleString('id-ID')}`,
        columns: [
          { header: 'Foto', foto: true },
          { header: 'Nama Barang', width: 28 },
          { header: 'Kategori', width: 18 },
          { header: 'Jumlah', numeric: true, width: 10 },
          { header: 'Ukuran', width: 16 },
          { header: 'Kondisi', width: 22 },
          { header: 'Outlet', width: 20 },
          { header: 'Catatan', width: 30 }
        ],
        rows: rows.map((a) => [
          a.photo_path ? fotoSel.get(a.id) ?? 'GAGAL' : null,
          a.name,
          a.category ?? '-',
          // Angka mentah, bukan hasil format. Kolom Jumlah harus bisa
          // dijumlahkan di Excel — dan itu alasan orang minta xlsx, bukan PDF.
          Number(a.qty) || 0,
          a.size ?? '-',
          conditionText(a),
          a.outlets?.name ?? '-',
          a.notes ?? '-'
        ])
      });

      // Dikatakan apa adanya. "Excel terunduh" saja akan menyembunyikan foto
      // yang gagal, dan yang membukanya baru tahu setelah file sampai ke orang lain.
      if (hasil.gagalFoto) {
        toast(`Excel terunduh — ${hasil.adaFoto} foto ikut, ${hasil.gagalFoto} gagal dimuat. Muat ulang halaman lalu coba lagi untuk yang gagal.`, 'warning');
      } else {
        toast(`Excel terunduh — ${hasil.adaFoto} foto ikut di dalamnya.`, 'success');
      }
    } catch (error) {
      toast(error.message ?? 'Gagal membuat Excel.', 'error');
    }
  }

  // ---- Impor Excel (admin) ----

  /**
   * Template = berkas Export Excel yang sudah ada, PLUS kolom ID.
   *
   * Sengaja berisi data yang sudah ada, bukan berkas kosong: baris ber-ID
   * itulah yang membuat unggahannya bisa MEMPERBARUI, bukan cuma menambah.
   * Berkas kosong hanya bisa menambah, dan mengimpornya dua kali menghasilkan
   * duplikat yang harus dibersihkan tangan.
   */
  async function unduhTemplate() {
    if (!rows.length) return toast('Tidak ada aset untuk dijadikan template. Tambahkan satu dulu, atau longgarkan saringannya.', 'warning');
    try {
      // Berurutan, BUKAN Promise.all — alasan yang sama dengan Export Excel:
      // ratusan gambar serentak membuat sebagian permintaan tertunda lama, dan
      // hasilnya berkas yang "sebagian fotonya hilang" tanpa sebab yang jelas.
      const fotoSel = new Map();
      for (const a of rows) {
        if (!a.photo_path) continue;
        const url = fotoUrl.get(a.photo_path);
        const dataUrl = url ? await imageToDataUrl(url, 220, 0.72) : null;
        fotoSel.set(a.id, dataUrl ?? 'GAGAL');
      }
      await exportTableXLSXFoto({
        filename: `template-impor-aset-${new Date().toISOString().slice(0, 10)}`,
        sheetName: 'Inventaris Aset',
        title: 'Template Impor Inventaris Aset',
        // Subjudulnya ikut jadi PETUNJUK. Kalimat pengantar di layar tidak ikut
        // terbawa ke dalam berkas, dan yang membukanya seminggu lagi cuma
        // punya berkasnya.
        subtitle:
          'Baris ber-ID akan DIPERBARUI · baris tanpa ID jadi barang BARU · sel yang dikosongkan dibiarkan apa adanya · ' +
          'tempelkan foto di kolom A pada baris barangnya',
        columns: [
          { header: 'Foto', foto: true },
          { header: 'ID (jangan diubah)', width: 38 },
          { header: 'Nama Barang', width: 28 },
          { header: 'Kategori', width: 18 },
          { header: 'Jumlah', numeric: true, width: 10 },
          { header: 'Ukuran', width: 16 },
          { header: 'Kondisi', width: 14 },
          { header: 'Catatan kondisi', width: 24 },
          { header: 'Outlet', width: 22 },
          { header: 'Catatan', width: 30 }
        ],
        rows: barisTemplateAset(rows, fotoSel)
      });
      toast('Template terunduh. Isi di Excel, lalu tekan ⇧ Impor Excel.', 'success');
    } catch (error) {
      toast(error.message ?? 'Gagal membuat template.', 'error');
    }
  }

  /** Rencana impor yang sedang ditunggu persetujuan. */
  let rencanaImpor = null;

  /**
   * Baca berkasnya, lalu TAMPILKAN RENCANANYA — jangan langsung simpan.
   *
   * ============ KENAPA HARUS ADA PRATINJAU ============
   *
   * Gambar di Excel menempel pada KOORDINAT, bukan pada baris. Kalau jangkarnya
   * bergeser satu, kursi memakai foto meja dan meja memakai foto lemari —
   * SEMUANYA terlihat wajar, dan tidak ada satu pun kolom yang bisa dipakai
   * memeriksanya. Satu-satunya yang bisa memastikannya adalah mata orang yang
   * punya barangnya, sebelum disimpan.
   */
  async function bacaImpor(file) {
    hasilImpor.innerHTML = loadingHtml('Membaca berkas…', { baris: 3 });
    rencanaImpor = null;
    let berkas;
    try {
      berkas = await bacaBerkasImporAset(file);
    } catch (error) {
      hasilImpor.innerHTML = `<p class="error-text">Gagal membaca berkasnya: ${esc(error.message ?? error)}</p>`;
      return;
    }

    // Aset PEMBANDING diambil TANPA saringan layar.
    //
    // Kalau dipakai `rows`, ID yang sah tapi sedang tersembunyi saringan akan
    // ditolak dengan "ID tidak ada di inventaris ini" — menuduh orangnya
    // mengubah kolom yang tidak pernah ia sentuh.
    let semua = [];
    try {
      semua = await listAssets({ businessUnitId });
    } catch (error) {
      hasilImpor.innerHTML = `<p class="error-text">${esc(error.message ?? error)}</p>`;
      return;
    }

    const rencana = susunImporAset({ aoa: berkas.aoa, gambar: berkas.gambar, asetSekarang: semua, outlets });
    if (rencana.galat) {
      hasilImpor.innerHTML = `<p class="error-text">${esc(rencana.galat)}</p>`;
      return;
    }
    rencanaImpor = rencana;
    const r = ringkasImpor(rencana);
    const semuaBaris = [...rencana.ubah, ...rencana.tambah].sort((a, b) => a.baris - b.baris);

    hasilImpor.innerHTML = `
      <div class="inline-card">
        <h3 style="margin-top:0;font-size:0.95rem">Pratinjau impor — belum disimpan</h3>
        <p style="font-size:0.84rem;margin:0 0 8px">
          <strong>${r.ubah}</strong> diperbarui · <strong>${r.tambah}</strong> barang baru ·
          <strong>${r.foto}</strong> foto ikut${r.tolak ? ` · <span class="nota-telat">${r.tolak} ditolak</span>` : ''}
        </p>
        ${
          r.melayang || r.ganda
            ? `<p class="error-text" style="font-size:0.82rem;margin:0 0 8px">
                 ${r.melayang ? `${r.melayang} foto tidak menempel di baris data mana pun. ` : ''}${
                   r.ganda ? `${r.ganda} foto bertumpuk di baris yang sama. ` : ''
                 }Foto di Excel menempel pada posisi, bukan pada baris — periksa dulu daftar di bawah sebelum menyimpan.
               </p>`
            : ''
        }
        <div class="table-scroll" style="max-height:340px"><table class="data-table kartu-sempit">
          <thead><tr><th>Baris</th><th>Foto</th><th>Nama Barang</th><th>Outlet</th><th>Jumlah</th><th>Kondisi</th><th>Tindakan</th></tr></thead>
          <tbody>
            ${
              semuaBaris
                .map((b) => {
                  const nama = b.name || b.lama?.name || '-';
                  const outlet = outlets.find((o) => o.id === (b.outlet_id ?? b.lama?.outlet_id))?.name ?? '-';
                  return `<tr>
                    <td data-label="Baris">${b.baris}</td>
                    <td data-label="Foto">${
                      b.fotoDi
                        ? `<img data-baris="${b.baris}" alt="" style="width:48px;height:36px;object-fit:cover;border-radius:4px;background:var(--color-border)" />`
                        : '<span style="color:var(--color-text-muted)">—</span>'
                    }</td>
                    <td data-label="Nama Barang"><strong>${esc(nama)}</strong></td>
                    <td data-label="Outlet">${esc(outlet)}</td>
                    <td data-label="Jumlah">${b.qty === null ? '<span style="color:var(--color-text-muted)">tetap</span>' : formatNum(b.qty)}</td>
                    <td data-label="Kondisi">${esc(ASSET_CONDITION[b.condition ?? b.lama?.condition] ?? '-')}</td>
                    <td data-label="Tindakan">${b.id ? 'Diperbarui' : '<strong>Baru</strong>'}</td>
                  </tr>`;
                })
                .join('') || '<tr><td colspan="7">Tidak ada baris yang bisa disimpan.</td></tr>'
            }
          </tbody>
        </table></div>
        ${
          rencana.tolak.length
            ? `<p style="font-size:0.82rem;margin:10px 0 4px;font-weight:600">Ditolak — tidak akan disimpan:</p>
               <ul style="font-size:0.8rem;margin:0;padding-left:18px">
                 ${rencana.tolak.map((t) => `<li>Baris ${t.baris}${t.nama ? ` (${esc(t.nama)})` : ''} — ${esc(t.sebab)}</li>`).join('')}
               </ul>`
            : ''
        }
        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
          <button class="primary" id="as-impor-simpan" style="max-width:220px"${semuaBaris.length ? '' : ' disabled'}>Simpan ${semuaBaris.length} baris</button>
          <button id="as-impor-batal">Batal</button>
        </div>
      </div>
    `;

    // Thumbnail dipasang lewat NOMOR BARIS, bukan lewat urutan.
    //
    // Mencocokkan `querySelectorAll('img')[i]` dengan `daftar.filter(...)[i]`
    // adalah persis kesalahan yang sedang dijaga layar ini: dua daftar yang
    // diurutkan terpisah, dicocokkan lewat posisi. Satu baris tanpa foto yang
    // ikut tergambar sudah cukup menggeser seluruhnya — dan pratinjaunya akan
    // MEMBENARKAN foto yang salah.
    const perBaris = new Map(semuaBaris.filter((b) => b.fotoDi?.buffer).map((b) => [String(b.baris), b]));
    for (const img of hasilImpor.querySelectorAll('img[data-baris]')) {
      const b = perBaris.get(img.dataset.baris);
      if (!b) continue;
      const jenis = `image/${b.fotoDi.ext === 'jpg' ? 'jpeg' : b.fotoDi.ext}`;
      img.src = URL.createObjectURL(new Blob([b.fotoDi.buffer], { type: jenis }));
    }

    hasilImpor.querySelector('#as-impor-batal')?.addEventListener('click', () => {
      rencanaImpor = null;
      hasilImpor.innerHTML = '';
    });
    hasilImpor.querySelector('#as-impor-simpan')?.addEventListener('click', sekaliJalan(simpanImpor, { teks: 'Menyimpan…' }));
  }

  /**
   * Simpan rencananya, BARIS PER BARIS, dan katakan apa adanya.
   *
   * Satu baris yang gagal tidak menghentikan sisanya — berkas 200 baris yang
   * berhenti di baris ke-3 karena satu outlet yang sudah dihapus memaksa
   * orangnya mengulang seluruhnya. Yang gagal dikumpulkan dan disebut nomor
   * barisnya, supaya bisa dibetulkan di berkas yang sama lalu diunggah ulang.
   */
  async function simpanImpor() {
    if (!rencanaImpor) return;
    const daftar = [...rencanaImpor.ubah, ...rencanaImpor.tambah].sort((a, b) => a.baris - b.baris);
    if (!daftar.length) return;

    const gagal = [];
    let berhasil = 0;
    for (const b of daftar) {
      const nilai = nilaiSimpan(b);
      try {
        await saveAsset({
          id: nilai.id,
          businessUnitId,
          outletId: nilai.outlet_id,
          name: nilai.name,
          category: nilai.category,
          qty: nilai.qty,
          size: nilai.size,
          condition: nilai.condition,
          conditionNote: nilai.condition_note,
          notes: nilai.notes,
          // Buffer dari Excel dibungkus jadi `File` supaya `saveAsset` bisa
          // mengompresnya dengan jalur yang SAMA dengan foto dari kamera —
          // bukan jalur unggah kedua yang aturannya bisa menyimpang.
          file: b.fotoDi?.buffer
            ? new File([b.fotoDi.buffer], `impor.${b.fotoDi.ext}`, { type: `image/${b.fotoDi.ext === 'jpg' ? 'jpeg' : b.fotoDi.ext}` })
            : null
        });
        berhasil += 1;
      } catch (error) {
        gagal.push(`Baris ${b.baris} (${b.name || b.lama?.name || '-'}) — ${error.message ?? error}`);
      }
    }

    rencanaImpor = null;
    hasilImpor.innerHTML = gagal.length
      ? `<div class="inline-card"><p style="margin:0 0 6px"><strong>${berhasil}</strong> baris tersimpan, <strong>${gagal.length}</strong> gagal:</p>
         <ul style="font-size:0.8rem;margin:0;padding-left:18px">${gagal.map((g) => `<li>${esc(g)}</li>`).join('')}</ul></div>`
      : '';
    if (gagal.length) toast(`${berhasil} tersimpan, ${gagal.length} gagal — rinciannya di atas tabel.`, 'warning');
    else toast(`${berhasil} baris tersimpan dari Excel.`, 'success');

    kategori = await listKategoriAset(businessUnitId).catch(() => kategori);
    await refresh();
  }

  await refresh();
}

/**
 * Sel foto: thumbnail langsung, diklik membuka ukuran penuh.
 * Kalau signed URL-nya gagal dibuat, tetap sediakan tombol "Lihat" — gagalnya
 * bisa jadi hanya sementara, dan lebih baik user bisa mencoba lagi daripada
 * melihat "-" yang seolah berarti fotonya memang tidak ada.
 */
function fotoSel(a, fotoUrl) {
  if (!a.photo_path) return '<span style="color:var(--color-text-muted)">-</span>';
  const url = fotoUrl.get(a.photo_path);
  if (!url) return `<button class="as-photo" data-path="${esc(a.photo_path)}">Lihat</button>`;
  return `<img src="${esc(url)}" alt="" loading="lazy" class="as-thumb" data-path="${esc(a.photo_path)}"
    style="width:52px;height:52px;object-fit:cover;border-radius:6px;background:#eee;cursor:zoom-in;border:1px solid var(--color-border,#e3e3e3)" />`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
