/**
 * MASTER SUPPLIER — Admin Portal → Inventory → **Master Supplier**.
 *
 *   "di admin portal di master supplier saat ini jadi satu dengan tab ekspor
 *    esb, saya ingin dibedakan tab nya"
 *
 * ============ KENAPA IA MEMANG TIDAK BERTEMPAT DI EKSPOR ESB ============
 *
 * Layar ini lahir di dalam Ekspor ESB (0158) karena di situlah daftar supplier
 * pertama kali dibicarakan. Tapi keduanya menjawab pertanyaan yang berbeda,
 * dan itu sudah ditulis sejak awal di `master-supplier.js`:
 *
 *   Ekspor ESB       "ejaan mana yang belum cocok dengan daftar ESB?"
 *                    Dikerjakan menjelang tutup bulan, oleh orang yang sedang
 *                    menyiapkan berkas ekspor.
 *
 *   layar ini        "supplier apa saja yang terdaftar di Berjaya Hub, dan
 *                    mana yang belum diperiksa admin?"
 *                    Dikerjakan kapan saja, paling sering justru saat ada
 *                    nama baru muncul dari nota staff kemarin.
 *
 * Mengubur yang kedua di dalam yang pertama berarti pekerjaan harian harus
 * melewati layar tutup bulan — lima langkah, satu `<details>` yang tertutup —
 * dan pekerjaan yang terlalu jauh dijangkau adalah pekerjaan yang tidak
 * dikerjakan. Itu sebabnya ia pindah, bukan karena tab barunya lebih rapi.
 *
 * Yang TIDAK berubah: ia tetap membaca tabel `suppliers` yang SAMA dengan
 * dropdown Staff App. Tidak ada yang disalin, jadi tidak ada yang perlu
 * disinkronkan — dan tidak mungkin ada dua daftar yang berbeda.
 */
import { toast, formDialog, confirmDialog } from '../../core/ui.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';
import { semuaDenganBatas } from '../../core/batas-waktu.js';
import {
  listSuppliers,
  ubahSupplier,
  tambahSupplier,
  gabungSupplier,
  hapusSupplier,
  namaSupplierTerpakai
} from './esb.service.js';
// `sayaAdminBu` ada di `core/base-scope.js`, BUKAN di `core/my-outlets.js` —
// percobaan pertama mengimpornya dari sana, dan `audit-import-ekspor` yang
// menangkapnya. Sintaksnya sah, jadi galatnya baru muncul di browser sebagai
// layar kosong tanpa penjelasan saat tab ini dibuka.
import { sayaAdminBu } from '../../core/base-scope.js';
import {
  susunMasterSupplier,
  ringkasMaster,
  pesanMaster,
  calonKembar,
  LABEL_STATUS as LABEL_MS,
  STATUS as MS,
  STATUS_PERLU_DIKERJAKAN,
  JENIS as JS,
  LABEL_JENIS as LABEL_JS
} from './master-supplier.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export async function renderSupplierAdmin(container, { businessUnitId }) {
  container.innerHTML = loadingHtml('Memuat Master Supplier…');

  // Layar ini MENULIS ke tabel ber-skala BU, jadi penjaganya `sayaAdminBu()`.
  // Tanpa ini, admin outlet melihat seluruh tombol dan tiap ketukan ditolak
  // RLS satu per satu — fitur yang tampak rusak, bukan fitur yang tidak
  // diizinkan.
  // `sayaAdminBu` sudah memulangkan true untuk Super Admin — pemeriksaan
  // terpisah untuk itu cuma jalur kedua yang bisa menyimpang.
  if (!(await sayaAdminBu(businessUnitId).catch(() => false))) {
    container.innerHTML =
      '<p style="color:var(--color-text-muted)">Master Supplier diatur di tingkat Business Unit, jadi hanya Admin BU atau Super Admin yang bisa membukanya.</p>';
    return;
  }

  let masterSupplier = [];
  let supplierTerpakai = [];
  try {
    // Berbatas waktu, dengan alasan yang sama dengan layar Ekspor ESB:
    // permintaan yang MENGGANTUNG tidak melempar apa-apa, jadi tanpa ini
    // kerangka "Memuat…" bertahan selamanya dan terlihat seperti sedang
    // bekerja. Lihat `core/batas-waktu.js`.
    [masterSupplier, supplierTerpakai] = await semuaDenganBatas([
      { apa: 'Daftar supplier', janji: listSuppliers(businessUnitId, { semua: true }) },
      // Berapa nota memakai tiap ejaan. Gagal = daftar kosong, bukan layar
      // mati: angkanya keterangan tambahan, bukan syarat daftarnya terbaca.
      { apa: 'Jumlah nota per supplier', janji: namaSupplierTerpakai(businessUnitId).catch(() => []) }
    ]);
  } catch (error) {
    container.innerHTML = `<p class="error-text">Gagal memuat: ${esc(error.message ?? error)}</p>`;
    return;
  }

  container.innerHTML = `
    <div class="inline-card" style="max-width:860px">
      <div class="page-header" style="margin-bottom:4px">
        <h3 style="margin:0;font-size:0.95rem">Master Supplier <span id="ms-lencana" style="font-weight:400"></span></h3>
      </div>
      <div id="ms-isi" style="margin-top:8px"></div>
    </div>
  `;

// ---------------------------------------------------------------
// 1b. MASTER SUPPLIER (0158) — daftar yang dipakai dropdown Staff App.
//
// Bisa diedit di sini, dan hasilnya langsung terbaca Staff App karena
// keduanya membaca tabel yang SAMA. Tidak ada yang disalin, jadi tidak ada
// yang perlu disinkronkan — dan tidak mungkin ada dua daftar yang berbeda.
// ---------------------------------------------------------------
async function muatMaster() {
  // Keduanya dimuat ulang, bukan cuma daftarnya: menghapus atau menggabungkan
  // supplier mengubah jumlah nota per ejaan juga, dan angka yang tidak ikut
  // diperbarui akan menyebut nota milik baris yang sudah tidak ada.
  [masterSupplier, supplierTerpakai] = await Promise.all([
    listSuppliers(businessUnitId, { semua: true }).catch(() => []),
    namaSupplierTerpakai(businessUnitId).catch(() => [])
  ]);
  gambarMasterSupplier();
}

function gambarMasterSupplier() {
  const daftar = susunMasterSupplier(masterSupplier, supplierTerpakai);
  const ringkas = ringkasMaster(daftar);
  const kembar = calonKembar(daftar);
  const perNama = new Map(daftar.map((b) => [b.id, b.nama]));

  const perlu = STATUS_PERLU_DIKERJAKAN.reduce((t, k) => t + (ringkas[k] ?? 0), 0);
  container.querySelector('#ms-lencana').innerHTML = !ringkas.total
    ? '<span style="color:var(--color-text-muted);font-size:0.8rem">kosong</span>'
    : perlu
      ? `<span class="nota-telat">${perlu} perlu dikerjakan</span> <span style="color:var(--color-text-muted);font-size:0.8rem">· ${ringkas.total} supplier</span>`
      : `<span class="nota-lunas">semua beres</span> <span style="color:var(--color-text-muted);font-size:0.8rem">· ${ringkas.total} supplier</span>`;
  // Dulu di sini ada `#ms-box.open = true` — `<details>`-nya dibuka sendiri
  // kalau ada pekerjaan. Tidak diperlukan lagi: layarnya sudah tab tersendiri,
  // jadi isinya selalu terlihat begitu dibuka.

  const box = container.querySelector('#ms-isi');
  box.innerHTML = `
    <p style="font-size:0.82rem;color:var(--color-text-muted);margin:0 0 8px">${esc(pesanMaster(ringkas))}</p>
    <p style="font-size:0.8rem;color:var(--color-text-muted);margin:0 0 8px">
      Daftar inilah yang muncul di dropdown <strong>Dibayarkan ke</strong> pada kas keluar, dan di dropdown
      <strong>Supplier</strong> pada nota. Nama yang diketik staff masuk ke sini sendiri, bertanda
      <strong>Baru dari staff</strong> — tetap langsung bisa dipakai semua orang.
    </p>
    <p style="font-size:0.8rem;color:var(--color-text-muted);margin:0 0 8px">
      Baris <strong>Internal</strong> (mis. &ldquo;Kas Operasional&rdquo;) adalah penerima yang bukan penjual apa pun —
      tempat membukukan uang hadir staff dan pembayaran lain yang tidak punya supplier. Ia hanya muncul di kas
      keluar, <em>tidak</em> di nota terima barang.
    </p>
    <p style="margin:0 0 8px"><button id="ms-tambah">+ Tambah penerima</button></p>
    ${
      daftar.length
        ? `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 8px">
             <input type="search" id="ms-cari" placeholder="Cari nama supplier…" autocomplete="off" style="flex:1 1 200px;min-width:170px" />
             <select id="ms-saring" style="flex:0 1 180px">
               <option value="">Semua status</option>
               ${Object.entries(LABEL_MS).map(([k, v]) => `<option value="${esc(k)}">${esc(v)} (${ringkas[k] ?? 0})</option>`).join('')}
             </select>
             <select id="ms-saring-jenis" style="flex:0 1 150px">
               <option value="">Semua jenis</option>
               ${Object.entries(LABEL_JS)
                 .map(
                   ([k, v]) =>
                     `<option value="${esc(k)}">${esc(v)} (${daftar.filter((b) => b.jenis === k).length})</option>`
                 )
                 .join('')}
             </select>
             <span id="ms-info" style="font-size:0.78rem;color:var(--color-text-muted)"></span>
           </div>
           <div class="table-scroll"><table class="data-table kartu-sempit">
             <thead><tr><th>Penerima</th><th>Jenis</th><th>Kode ESB</th><th>Status</th><th>Nota</th><th>Aksi</th></tr></thead>
             <tbody id="ms-baris">${daftar
               .map((b) => {
                 const warna = b.status === MS.BARU ? 'nota-telat' : b.status === MS.SIAP ? 'nota-lunas' : '';
                 const mirip = kembar.get(b.id) ?? [];
                 return (
                   `<tr data-status="${esc(b.status)}" data-jenis="${esc(b.jenis)}" data-nama="${esc(b.nama)} ${esc(b.esbNama)} ${esc(b.esbKode)}">` +
                   `<td data-label="Penerima"><strong>${esc(b.nama)}</strong>${
                     // Ejaan ESB disebut HANYA kalau berbeda. Menampilkannya
                     // selalu membuat kolom yang sama persis terbaca dua kali.
                     b.esbNama ? `<br><span style="font-size:0.76rem;color:var(--color-text-muted)">di ESB: ${esc(b.esbNama)}</span>` : ''
                   }${
                     mirip.length
                       ? `<br><span class="nota-telat" style="font-size:0.74rem">mirip: ${esc(
                           mirip.map((id) => perNama.get(id) ?? '?').join(', ')
                         )}</span>`
                       : ''
                   }</td>` +
                   `<td data-label="Jenis" style="font-size:0.8rem">${
                     b.jenis === JS.INTERNAL
                       ? `<span class="nota-lunas">${esc(LABEL_JS[JS.INTERNAL])}</span>`
                       : `<span style="color:var(--color-text-muted)">${esc(LABEL_JS[JS.SUPPLIER])}</span>`
                   }</td>` +
                   `<td data-label="Kode ESB" style="font-size:0.8rem">${esc(b.esbKode) || '<span style="color:var(--color-text-muted)">–</span>'}</td>` +
                   `<td data-label="Status"><span class="${warna}">${esc(LABEL_MS[b.status])}</span></td>` +
                   `<td data-label="Nota" style="font-size:0.8rem">${
                     b.jumlah ? `${b.jumlah}${b.belumEkspor ? ` · <span class="nota-telat">${b.belumEkspor} belum diekspor</span>` : ''}` : '<span style="color:var(--color-text-muted)">–</span>'
                   }</td>` +
                   `<td data-label="Aksi"><button class="ms-edit" data-id="${esc(b.id)}">Edit</button>${
                     mirip.length ? `<button class="ms-gabung" data-id="${esc(b.id)}">Gabungkan</button>` : ''
                   }${
                     // ============ HAPUS HANYA UNTUK YANG BELUM DIPAKAI ============
                     //
                     // Tombolnya disembunyikan, bukan ditampilkan lalu ditolak.
                     // Tombol yang selalu ada tapi hampir selalu menolak
                     // mengajari orang bahwa penolakan itu normal — dan pada
                     // ketukan yang benar-benar penting, pesannya tidak dibaca
                     // lagi.
                     //
                     // `b.jumlah` cuma hitungan NOTA. Entri kas tidak ikut
                     // terhitung di sini karena layar ini tidak memuatnya, jadi
                     // tombolnya masih bisa muncul untuk supplier yang ternyata
                     // dipakai kas. Itu sebabnya database tetap memeriksa
                     // keduanya (0161), dan pesannya diteruskan apa adanya:
                     // yang di layar ini saringan, bukan penjaga.
                     b.jumlah ? '' : `<button class="ms-hapus" data-id="${esc(b.id)}" data-nama="${esc(b.nama)}">Hapus</button>`
                   }</td></tr>`
                 );
               })
               .join('')}</tbody>
           </table></div>`
        : '<p style="color:var(--color-text-muted);font-size:0.88rem">Belum ada supplier. Daftarnya terisi sendiri begitu staff mencatat nota — atau impor daftar ESB di langkah 3.</p>'
    }`;

  const kotak = box.querySelector('#ms-cari');
  if (kotak) {
    const saring = box.querySelector('#ms-saring');
    const baris = [...box.querySelectorAll('#ms-baris tr')];
    const info = box.querySelector('#ms-info');
    // Dua saringan pada SATU daftar, dihitung bersama — alasannya sama
    // dengan daftar supplier ESB di bawah.
    const saringJenis = box.querySelector('#ms-saring-jenis');
    const jalankan = () => {
      const kata = kotak.value.trim().toLowerCase();
      const status = saring.value;
      const jenis = saringJenis.value;
      let tampil = 0;
      for (const tr of baris) {
        const cocok =
          (!status || tr.dataset.status === status) &&
          (!jenis || tr.dataset.jenis === jenis) &&
          (!kata || (tr.dataset.nama ?? '').toLowerCase().includes(kata));
        tr.hidden = !cocok;
        if (cocok) tampil += 1;
      }
      info.textContent = tampil === baris.length ? '' : `${tampil} dari ${baris.length} penerima`;
    };
    kotak.addEventListener('input', jalankan);
    saring.addEventListener('change', jalankan);
    saringJenis.addEventListener('change', jalankan);
  }

  box.querySelector('#ms-tambah')?.addEventListener(
    'click',
    sekaliJalan(async () => {
      const v = await formDialog({
        title: 'Tambah penerima',
        description:
          'Supplier biasanya tidak perlu ditambah dari sini — namanya lahir sendiri begitu staff mencatat nota. ' +
          'Yang perlu tombol ini adalah penerima INTERNAL: ia tidak pernah lahir dari nota, karena memang tidak boleh.',
        fields: [
          { name: 'nama', label: 'Nama penerima', type: 'text', required: true, placeholder: 'mis. Kas Operasional' },
          {
            name: 'jenis',
            label: 'Jenis penerima',
            type: 'select',
            value: JS.INTERNAL,
            required: true,
            options: Object.entries(LABEL_JS).map(([k, v2]) => ({ value: k, label: v2 })),
            help: 'Internal hanya muncul di kas keluar. Supplier muncul di kas keluar DAN nota terima barang.'
          }
        ],
        submitText: 'Tambah'
      });
      if (!v) return;
      try {
        await tambahSupplier(businessUnitId, v.nama, v.jenis);
        // Nama yang sudah ada tidak menghasilkan galat di sisi RPC — ia
        // mengembalikan baris yang sudah ada. Jadi kalimatnya tidak boleh
        // menjanjikan "dibuat", karena bisa saja tidak.
        toast(`"${v.nama}" siap dipakai di dropdown Dibayarkan ke.`, 'success');
        await muatMaster();
      } catch (e) {
        toast(e.message ?? 'Gagal menambah penerima.', 'error');
      }
    })
  );

  box.querySelectorAll('.ms-edit').forEach((btn) =>
    btn.addEventListener(
      'click',
      sekaliJalan(async () => {
        const b = daftar.find((x) => x.id === btn.dataset.id);
        if (!b) return;
        const v = await formDialog({
          title: `Edit ${b.nama}`,
          description:
            'Perubahan di sini langsung terbaca Staff App — dropdown-nya membaca tabel yang sama. ' +
            'Nama yang dibetulkan juga ikut mengubah nota LAMA yang memakai supplier ini.',
          fields: [
            { name: 'nama', label: 'Nama supplier', type: 'text', value: b.nama, required: true },
            {
              name: 'esb_kode',
              label: 'Kode ESB',
              type: 'text',
              value: b.esbKode,
              help: 'Dicocokkan dengan Master Supplier di ESB. Kosong = notanya akan tertahan saat diekspor.'
            },
            {
              name: 'esb_nama',
              label: 'Nama di ESB (kalau ejaannya berbeda)',
              type: 'text',
              value: b.esbNama,
              help: 'Kosongkan kalau ejaannya sama dengan nama di atas — kosong berarti SAMA, bukan belum diisi.'
            },
            {
              name: 'jenis',
              label: 'Jenis penerima',
              type: 'select',
              value: b.jenis,
              required: true,
              options: Object.entries(LABEL_JS).map(([k, v2]) => ({ value: k, label: v2 })),
              help:
                'Internal = penerima yang bukan penjual apa pun (mis. "Kas Operasional" untuk uang hadir staff). ' +
                'Hanya muncul di kas keluar, tidak di nota terima barang.'
            },
            { name: 'terverifikasi', label: 'Sudah diperiksa admin', type: 'checkbox', value: b.terverifikasi },
            { name: 'aktif', label: 'Aktif (muncul di dropdown)', type: 'checkbox', value: b.aktif }
          ],
          submitText: 'Simpan'
        });
        if (!v) return;
        try {
          await ubahSupplier(b.id, {
            nama: v.nama,
            esbKode: v.esb_kode,
            esbNama: v.esb_nama,
            terverifikasi: v.terverifikasi,
            aktif: v.aktif,
            jenis: v.jenis
          });
          toast('Master supplier diperbarui — Staff App ikut sejak sekarang.', 'success');
          await muatMaster();
        } catch (e) {
          toast(e.message ?? 'Gagal menyimpan.', 'error');
        }
      })
    )
  );

  box.querySelectorAll('.ms-hapus').forEach((btn) =>
    btn.addEventListener(
      'click',
      sekaliJalan(async () => {
        const nama = btn.dataset.nama ?? 'supplier ini';
        const yakin = await confirmDialog({
          title: `Hapus ${nama}?`,
          message:
            `"${nama}" belum dipakai nota mana pun, jadi menghapusnya tidak mengubah satu pun dokumen. ` +
            'Baris ini hilang dari daftar dan dari dropdown Staff App. Kalau suatu saat nama itu diketik lagi ' +
            'di nota, ia akan lahir kembali sebagai supplier baru yang belum diperiksa.',
          confirmText: 'Hapus',
          danger: true
        });
        if (!yakin) return;
        try {
          await hapusSupplier(btn.dataset.id);
          toast(`"${nama}" dihapus.`, 'success');
          await muatMaster();
        } catch (e) {
          // Pesan dari `hapus_supplier` sudah menyebut jumlah pemakaiannya dan
          // jalan keluarnya — diteruskan apa adanya, tidak diganti kalimat
          // umum yang kehilangan kedua keterangan itu.
          toast(e.message ?? 'Gagal menghapus supplier.', 'error');
          await muatMaster();
        }
      })
    )
  );

  box.querySelectorAll('.ms-gabung').forEach((btn) =>
    btn.addEventListener(
      'click',
      sekaliJalan(async () => {
        const b = daftar.find((x) => x.id === btn.dataset.id);
        const mirip = kembar.get(btn.dataset.id) ?? [];
        if (!b || !mirip.length) return;
        const v = await formDialog({
          title: `Gabungkan ${b.nama}`,
          description:
            `Seluruh nota "${b.nama}" dipindahkan ke supplier yang dipilih, lalu "${b.nama}" dihapus dari daftar. ` +
            'Nota lamanya ikut menyebut nama tujuannya — jejaknya tidak hilang, cuma menunjuk induk yang benar.',
          fields: [
            {
              name: 'ke',
              label: 'Digabungkan ke',
              type: 'select',
              required: true,
              options: mirip.map((id) => ({ value: id, label: perNama.get(id) ?? '?' }))
            }
          ],
          submitText: 'Gabungkan',
          danger: true
        });
        if (!v) return;
        try {
          const n = await gabungSupplier(b.id, v.ke);
          toast(`${n} nota dipindahkan ke ${perNama.get(v.ke) ?? 'supplier tujuan'}.`, 'success');
          await muatMaster();
        } catch (e) {
          toast(e.message ?? 'Gagal menggabungkan.', 'error');
        }
      })
    )
  );
}

  gambarMasterSupplier();
}
