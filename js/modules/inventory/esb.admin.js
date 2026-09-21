/**
 * Admin Portal → Inventory → **Ekspor ESB**.
 *
 * Tiga langkah, berurutan, dan ditampilkan sebagai tiga langkah supaya jelas
 * mana yang belum dikerjakan:
 *
 *   1. IMPOR daftar induk ESB (Branch, Unit of Material, Product Data).
 *   2. PETAKAN nilai Berjaya Hub ke nilai ESB — dengan pencocokan otomatis,
 *      karena 279 produk terlalu banyak untuk dipilih satu per satu.
 *   3. UNDUH berkasnya, lalu tandai notanya supaya tidak terunggah dua kali.
 *
 * ============ KENAPA UNDUHANNYA TIDAK LEWAT `exportTableXLSX` ============
 *
 * Helper itu menyisipkan baris judul & subjudul di atas header. ESB membaca
 * BARIS PERTAMA sebagai nama kolom, jadi satu baris judul saja membuat seluruh
 * berkas ditolak — dan penolakannya terjadi di ESB, jauh dari sini.
 */

import { toast, confirmDialog } from '../../core/ui.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';
import { monthRangeWIB } from '../../core/dates.js';
import { loadXLSX } from '../../core/xlsx.js';
import { listProducts, listRecipesFull, computeCosts } from '../product/product.service.js';
import { getBiayaRataBu } from './waste.service.js';
import { sayaAdminBu } from '../../core/base-scope.js';
import { KOLOM_ESB, JENIS_PETA, buatPeta, barisEsbPurchase, ringkasEkspor } from './esb-purchase.js';
import { susunBarisPemetaan, perluCari } from './urut-pemetaan.js';
// `saringTabel` tinggal di modul Pengiriman karena di sanalah ia lahir, dan
// aturannya — MENYEMBUNYIKAN baris, bukan menggambar ulang — persis yang
// dibutuhkan di sini: baris pemetaan memuat `<select>` yang sudah dipasangi
// penangan `change`. Memindahkannya ke `core/` berarti menyentuh tiga berkas
// verifikasi yang sudah hijau tanpa satu pun perubahan perilaku.
import { saringTabel } from '../dispatch/saring-tabel.js';
import { KOLOM_TRANSFER, barisEsbTransfer, ringkasTransfer } from './esb-transfer.js';
import { KOLOM_JOURNAL, BARIS_HEADER_JOURNAL, barisEsbJournal, ringkasJournal } from './esb-journal.js';
import { pasangFormatTanggal } from './tanggal-excel.js';
import { petaSupplier, petaEjaanSupplier, normalNama } from './cocok-supplier.js';
import { susunDaftarSupplier, ringkasStatus, pesanRingkas, LABEL_STATUS, STATUS_MENGHAMBAT } from './daftar-supplier.js';
import { satuanPerluDipetakan } from './konversi-satuan.js';
import {
  alasanSah,
  jejakBatal,
  susunDaftarBertanda,
  hasilPembatalan,
  PERINGATAN_ESB,
  PANJANG_ALASAN_MIN
} from './batal-tanda-esb.js';
import {
  listEsbMaster,
  gantiEsbMaster,
  listEsbMap,
  simpanEsbMap,
  namaSupplierTerpakai,
  notaUntukEsb,
  tandaiNotaEsb,
  kirimanUntukEsb,
  tandaiKirimanEsb,
  notaBertandaEsb,
  kirimanBertandaEsb,
  wasteUntukEsb,
  tandaiWasteEsb,
  wasteBertandaEsb,
  batalkanTandaWasteEsb,
  batalkanTandaEsb,
  batalkanTandaKirimanEsb
} from './esb.service.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const LABEL_JENIS = {
  branch: 'Branch',
  location: 'Location',
  payment_method: 'Payment Method',
  coa: 'COANo',
  unit: 'Unit',
  item: 'Item',
  supplier: 'Supplier',
  // Purpose BUKAN pemetaan (lihat 0147) — ia daftar pilihan yang dipakai form
  // waste. Labelnya tetap ada karena langkah "Daftar induk ESB" menghitungnya.
  purpose: 'Purpose',
  // Tiga di bawah ini BUKAN pemetaan — tidak ada dropdown untuk memperbaikinya.
  // Ia muncul di tabel "belum dipetakan" karena tabel itulah satu-satunya
  // tempat alasan sebuah dokumen tertahan bisa terbaca. Perbaikannya di nota
  // atau kirimannya sendiri, dan labelnya menyebutkan itu.
  tanggal: 'Tanggal nota (perbaiki di notanya)',
  'tanggal-terima': 'Tanggal terima (perbaiki di kirimannya)',
  harga: 'Harga satuan (perbaiki di notanya)',
  'qty-terima': 'Qty diterima (perbaiki di kirimannya)',
  // Bukan pemetaan juga. Labelnya menyebut KEDUA sumbernya, karena yang
  // tertahan di sini sudah gagal di keduanya: tidak pernah dibeli di outlet
  // itu, DAN harga beli master / resepnya belum lengkap. Kalimat lamanya
  // ("input dulu notanya") menyuruh orang membuat nota untuk barang setengah
  // jadi yang memang tidak pernah dibeli — pekerjaan yang tidak akan pernah
  // menyelesaikan apa pun.
  'nilai-bahan': 'Belum ada nilai — harga beli & HPP resepnya sama-sama kosong',
  // Dua alasan yang hampir mustahil muncul, dan justru karena itu labelnya
  // harus ada: tanpa label, tabelnya menampilkan kode mentah dan yang
  // membacanya tidak punya petunjuk apa pun.
  'qty-terlalu-kecil': 'Jumlahnya terlalu kecil untuk 4 desimal (jadi 0)',
  'nilai-terlalu-kecil': 'Nilainya terlalu kecil untuk 4 desimal (jadi 0)',
  // KUNCINYA 'purpose-kosong', BUKAN 'purpose'.
  //
  // Objek ini melayani dua hal yang berbeda: nama JENIS daftar induk ("5
  // Purpose tersimpan") dan ALASAN sebuah dokumen tertahan. Percobaan pertama
  // memakai kunci `purpose` untuk keduanya — dan karena kunci kembar di satu
  // objek literal itu sah di JavaScript, yang belakangan menang diam-diam:
  // langkah "Daftar induk ESB" berbunyi "5 Purpose kosong (isi di Rekap Waste
  // / Spoil)". Tidak ada galat, tidak ada peringatan.
  'purpose-kosong': 'Purpose kosong (isi di Rekap Waste / Spoil)'
};

/** Cara bayar lokal yang selalu perlu padanan, apa pun isi notanya. */
const CARA_BAYAR = ['kas', 'tempo', 'pusat'];

// `receipt_date` bertipe DATE dan datang sebagai 'YYYY-MM-DD'. Sufiks
// 'T00:00:00' membuatnya dibaca sebagai waktu LOKAL — tanpa itu ia dibaca
// sebagai UTC, dan tanggal nota bergeser satu hari mundur di layar orang WIB.
const fmtTanggal = (d) => {
  if (!d) return '-';
  const t = new Date(`${String(d).slice(0, 10)}T00:00:00`);
  return Number.isNaN(t.getTime()) ? String(d) : t.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
};

const fmtTanggalJam = (t) => {
  if (!t) return '-';
  const d = new Date(t);
  return Number.isNaN(d.getTime())
    ? String(t)
    : d.toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

/**
 * Dua jenis dokumen ESB, satu layar, **satu pemetaan**.
 *
 * Origin/Destination di Simple Transfer sumbernya sama-sama nama outlet —
 * persis yang sudah dipetakan untuk Branch & Location di Simple Purchase. Kalau
 * transfer diberi jenis pemetaan sendiri, "AB Sentul" harus dipetakan dua kali,
 * lalu suatu hari yang satu diperbarui dan yang lain tidak. Dua jawaban untuk
 * satu pertanyaan tidak pernah terlihat salah di layar; ia cuma membuat dua
 * berkas ESB tidak konsisten.
 */
const DOKUMEN = {
  purchase: {
    label: 'Simple Purchase',
    sumber: 'nota penerimaan barang (modul Bahan)',
    kolom: KOLOM_ESB,
    berkas: 'esb-purchase',
    satuan: 'nota'
  },
  transfer: {
    label: 'Simple Transfer',
    sumber: 'kiriman antar-outlet yang SUDAH DITERIMA (modul Pengiriman)',
    kolom: KOLOM_TRANSFER,
    berkas: 'esb-transfer',
    satuan: 'kiriman'
  },
  journal: {
    label: 'Item Journal',
    sumber: 'waste & spoil (modul Bahan → Waste / Spoil)',
    kolom: KOLOM_JOURNAL,
    berkas: 'esb-item-journal',
    satuan: 'waste',
    // SATU BERKAS, SATU OUTLET.
    //
    // Template Item Journal tidak punya kolom Branch sama sekali — outletnya
    // ditentukan saat DIIMPOR di ESB. Berkas gabungan beberapa outlet masuk
    // seluruhnya ke outlet yang dipilih saat impor, dan stok outlet lain
    // berkurang di ESB tanpa pernah berkurang di sini.
    outletWajib: true,
    // Header di baris ke-3, bukan baris 1. Dua template lain memakai baris
    // pertama; menyamakannya membuat seluruh berkas ditolak.
    barisHeader: BARIS_HEADER_JOURNAL,
    judulBerkas: 'ESB Item Journal Template'
  }
};

/**
 * Nama disamakan sebelum dibandingkan: huruf kecil, spasi rangkap jadi satu,
 * dan tanda baca dibuang.
 *
 * "Telur Ayam", "telur  ayam", dan "TELUR AYAM." adalah satu barang yang sama.
 * Tanpa penyamaan ini, pencocokan otomatis hampir tidak pernah kena, dan orang
 * akan memetakan 279 produk dengan tangan.
 */
const normal = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export async function renderEsbAdmin(container, { businessUnitId, outlets }) {
  container.innerHTML = loadingHtml('Memuat…', { baris: 4 });

  // SKALA BU, BUKAN SKALA OUTLET.
  //
  // `esb_map` dan `esb_master` dijaga `is_bu_admin` (0127): pemetaan berlaku
  // untuk seluruh BU, bukan per outlet. Daftar outlet di layar ini cuma dipakai
  // untuk MENYEBUT namanya dan menyaring rentang ekspor — bukan untuk
  // menentukan wewenang.
  //
  // Tanpa penjaga ini, admin outlet melihat editor pemetaan yang lengkap, lalu
  // tiap perubahan ditolak RLS dengan "new row violates row-level security
  // policy" — pesan yang tidak bisa ditindaklanjuti siapa pun.
  if (!(await sayaAdminBu(businessUnitId).catch(() => false))) {
    container.innerHTML =
      '<p style="color:var(--color-text-muted)">Ekspor ESB diatur di tingkat Business Unit, jadi hanya Admin BU atau Super Admin yang bisa membukanya.</p>';
    return;
  }

  let master = [];
  let peta = [];
  let produk = [];
  let supplierTerpakai = [];
  try {
    [master, peta, produk, supplierTerpakai] = await Promise.all([
      listEsbMaster(businessUnitId).catch(() => []),
      listEsbMap(businessUnitId).catch(() => []),
      listProducts(businessUnitId).catch(() => []),
      // Gagal berarti 0144 belum dijalankan. Layarnya tetap berdiri dengan
      // kelompok Supplier kosong — bukan halaman galat yang mengunci seluruh
      // ekspor ESB hanya karena satu daftar tidak bisa dibaca.
      namaSupplierTerpakai(businessUnitId).catch(() => [])
    ]);
  } catch (e) {
    container.innerHTML = `<p class="error-text">${esc(e.message ?? e)}</p>`;
    return;
  }

  const masterPer = (j) => master.filter((m) => m.jenis === j);
  const petaPer = (j) => new Map(peta.filter((p) => p.jenis === j).map((p) => [normal(p.kunci), p.nilai]));
  const range = monthRangeWIB();

  /** Nilai lokal yang PERLU dipetakan, per jenis. */
  const lokal = {
    branch: outlets.map((o) => o.name),
    location: outlets.map((o) => o.name),
    payment_method: CARA_BAYAR,
    coa: CARA_BAYAR,
    // SATUAN BELI IKUT, dan itu wajib.
    //
    // Sejak ekspor memakai satuan beli, nilai yang dicari di pemetaan bukan
    // lagi `base_unit` melainkan `purchase_unit`. Daftar yang masih berisi
    // GR/PCS saja akan membuat SELURUH nota tertahan — dengan alasan "unit
    // PACK@30PCS belum dipetakan" dan tanpa satu pun baris untuk memetakannya.
    // Kemampuannya ada, jalannya tidak ada di layar; pola yang sudah beberapa
    // kali muncul di proyek ini.
    unit: satuanPerluDipetakan(produk),
    item: [...new Set(produk.filter((p) => p.product_type === 'raw' || p.product_type === 'semi').map((p) => p.name))].sort(),
    // SUPPLIER BEKERJA TERBALIK DARI ENAM LAINNYA.
    //
    // Lima jenis di atas SELALU perlu dipetakan: nama outlet lokal tidak akan
    // pernah sama dengan nama Branch di ESB. Supplier tidak begitu — sejak
    // daftarnya diimpor, nama yang dipilih staff memang sudah nama ESB.
    //
    // Jadi yang muncul di sini HANYA ejaan lama yang tidak ada di daftar induk:
    // nama-nama yang terlanjur diketik sebelum daftarnya ada. Menampilkan
    // seluruh nama yang pernah dipakai akan membuat 30 baris yang sudah benar
    // tampil sebagai "belum dipetakan", dan yang delapan benar-benar bermasalah
    // tenggelam di antaranya.
    supplier: (() => {
      const m = petaSupplier(master);
      return supplierTerpakai.map((t) => String(t?.nama ?? '')).filter((nama) => nama && !m.has(normalNama(nama)));
    })()
  };

  /** Berapa nota yang tertahan oleh tiap ejaan supplier — untuk ditampilkan. */
  const notaPerSupplier = new Map(
    supplierTerpakai.map((t) => [normalNama(t?.nama), { jumlah: Number(t?.jumlah) || 0, belum: Number(t?.belum_ekspor) || 0 }])
  );

  container.innerHTML = `
    <h2 style="font-size:1.05rem">Ekspor ke ESB</h2>
    <p style="font-size:0.82rem;color:var(--color-text-muted);max-width:760px">
      Berjaya Hub jadi tempat input, ESB menerima berkasnya. Tiga jenis dokumen didukung —
      <strong>Simple Purchase</strong> dari nota penerimaan, <strong>Simple Transfer</strong> dari modul Pengiriman,
      dan <strong>Item Journal</strong> dari waste &amp; spoil — dan ketiganya memakai
      <strong>pemetaan yang sama</strong>. Dokumen yang ada nilainya belum terpetakan
      <strong>tidak ikut terunduh</strong>; ia muncul di daftar di bawah, supaya ketahuan alih-alih berangkat dengan
      sel kosong yang ditolak ESB belakangan.
    </p>

    <!-- UNDUH DI PALING ATAS.
         Impor & pemetaan adalah pekerjaan PENYIAPAN — dikerjakan sekali saat
         ESB berubah. Yang dikerjakan berulang setiap periode adalah
         mengunduhnya. Menaruh dua langkah penyiapan di atasnya berarti
         menggulir melewati pekerjaan yang sudah selesai, setiap kali. -->
    <div class="inline-card" style="max-width:820px">
      <h3 style="margin-top:0;font-size:0.95rem">1. Unduh</h3>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <div class="field" style="margin:0"><label>Jenis dokumen</label>
          <select id="esb-dokumen">
            <option value="purchase">Simple Purchase — nota supplier</option>
            <option value="transfer">Simple Transfer — kiriman antar-outlet</option>
            <option value="journal">Item Journal — waste / spoil</option>
          </select>
        </div>
        <div class="field" style="margin:0"><label>Dari tanggal</label><input type="date" id="esb-from" value="${range.from}" /></div>
        <div class="field" style="margin:0"><label>Sampai tanggal</label><input type="date" id="esb-to" value="${range.to}" /></div>
        <div class="field" style="margin:0"><label>Outlet</label>
          <select id="esb-outlet"><option value="">Semua outlet</option>${outlets
            .map((o) => `<option value="${o.id}">${esc(o.name)}</option>`)
            .join('')}</select>
        </div>
        <button class="primary" id="esb-pratinjau" style="max-width:140px">Pratinjau</button>
      </div>
      <p style="font-size:0.8rem;color:var(--color-text-muted);margin:8px 0 0" id="esb-dokumen-ket"></p>
      <div id="esb-hasil" style="margin-top:10px"></div>
    </div>

    <!-- JALAN KELUARNYA, DI TEMPAT YANG BISA DITEMUKAN.
         Fungsinya ada di database sejak 0127, dan komentar di sana sendiri
         menulis bahwa tanpa jalan keluar ini satu-satunya cara adalah SQL
         Editor — "itu bukan jalan keluar; itu ketiadaan jalan keluar". Lalu
         layarnya tidak pernah dibuat, jadi jalan keluarnya memang tetap SQL
         Editor sampai hari ini.

         Ditaruh di urutan KEDUA, bukan di dasar halaman: yang membukanya
         sedang menunggu jawaban staff yang tidak bisa memperbaiki notanya. -->
    <div class="inline-card" style="max-width:820px;margin-top:12px">
      <h3 style="margin-top:0;font-size:0.95rem">2. Batalkan tanda ekspor</h3>
      <p style="font-size:0.8rem;color:var(--color-text-muted);margin:0 0 8px">
        Nota atau kiriman yang sudah diekspor <strong>terkunci isinya</strong> — staff tidak bisa memperbaikinya.
        Buka tandanya di sini supaya bisa diperbaiki, lalu unggah ulang berkasnya.
      </p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <div class="field" style="margin:0"><label>Jenis dokumen</label>
          <select id="batal-dokumen">
            <option value="purchase">Nota supplier</option>
            <option value="transfer">Kiriman antar-outlet</option>
            <option value="journal">Waste / spoil</option>
          </select>
        </div>
        <div class="field" style="margin:0"><label>Dari tanggal</label><input type="date" id="batal-from" value="${range.from}" /></div>
        <div class="field" style="margin:0"><label>Sampai tanggal</label><input type="date" id="batal-to" value="${range.to}" /></div>
        <div class="field" style="margin:0"><label>Outlet</label>
          <select id="batal-outlet"><option value="">Semua outlet</option>${outlets
            .map((o) => `<option value="${o.id}">${esc(o.name)}</option>`)
            .join('')}</select>
        </div>
        <button class="primary" id="batal-cari" style="max-width:220px">Tampilkan yang sudah diekspor</button>
      </div>
      <div id="batal-hasil" style="margin-top:10px"></div>
    </div>

    <div class="inline-card" style="max-width:820px;margin-top:12px">
      <h3 style="margin-top:0;font-size:0.95rem">3. Daftar induk ESB</h3>
      <p style="font-size:0.8rem;color:var(--color-text-muted);margin:0 0 8px">
        Unggah berkas <em>ekspor dari ESB</em> apa adanya — Master Branch, Master Unit of Material, Master Product Data,
        Master Supplier, Master Purpose. Diimpor ulang kapan pun ESB berubah;
        <strong>pemetaan di langkah 5 tidak ikut terhapus</strong>.
        <br><strong>Master Purpose</strong> bukan pemetaan: ia mengisi dropdown Purpose di form Waste / Spoil,
        dan tanpanya setiap waste tertahan saat diekspor.
      </p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <input type="file" id="esb-file" accept=".xlsx,.xls" />
        <select id="esb-file-jenis">
          <option value="branch">Master Branch</option>
          <option value="unit">Master Unit of Material</option>
          <option value="item">Master Product Data</option>
          <option value="supplier">Master Supplier</option>
          <option value="purpose">Master Purpose</option>
        </select>
        <button class="primary" id="esb-impor" style="max-width:150px">Impor</button>
      </div>
      <p style="font-size:0.8rem;margin:8px 0 0">
        Tersimpan: ${['branch', 'unit', 'item', 'supplier', 'purpose']
          .map((j) => `<strong>${masterPer(j).length}</strong> ${LABEL_JENIS[j]}`)
          .join(' · ')}
      </p>
      <p class="error-text" id="esb-impor-error"></p>
    </div>

    <!-- DAFTAR SUPPLIER, LENGKAP DENGAN YANG SUDAH BENAR.
         Kelompok "Supplier" di langkah 5 sengaja HANYA memuat ejaan yang
         bermasalah — jadi tidak ada satu tempat pun yang bisa menjawab
         "supplier apa saja yang sudah terdaftar di sini?". Yang tersisa
         membuka berkas ESB di Excel, dan itu bukan jawaban. -->
    <details class="inline-card" style="max-width:820px;margin-top:12px" id="esb-supplier-box">
      <summary style="cursor:pointer;font-size:0.95rem;font-weight:600">
        4. Daftar supplier <span id="esb-supplier-lencana" style="font-weight:400"></span>
      </summary>
      <div id="esb-supplier-isi" style="margin-top:8px"></div>
    </details>

    <div class="inline-card" style="max-width:820px;margin-top:12px">
      <div class="page-header" style="margin-bottom:6px">
        <h3 style="margin:0;font-size:0.95rem">5. Pemetaan</h3>
        <button id="esb-cocokkan" title="Cocokkan otomatis berdasarkan kemiripan nama">⚡ Cocokkan otomatis</button>
      </div>
      <div id="esb-peta"></div>
    </div>
  `;

  gambarPeta();

  // ---------------------------------------------------------------
  // 1. Impor daftar induk
  // ---------------------------------------------------------------
  container.querySelector('#esb-impor').addEventListener(
    'click',
    sekaliJalan(async () => {
      const errEl = container.querySelector('#esb-impor-error');
      errEl.textContent = '';
      const file = container.querySelector('#esb-file').files?.[0];
      const jenis = container.querySelector('#esb-file-jenis').value;
      if (!file) {
        errEl.textContent = 'Pilih berkasnya dulu.';
        return;
      }
      try {
        const baris = await bacaMasterEsb(file, jenis);
        if (!baris.length) {
          errEl.textContent =
            'Tidak ada baris yang terbaca. Pastikan berkasnya berkas EKSPOR dari ESB (ada baris judul, lalu header di baris ke-6).';
          return;
        }
        const n = await gantiEsbMaster(businessUnitId, jenis, baris);
        // LOCATION TIDAK DISALIN DARI BRANCH.
        //
        // Percobaan pertama menyalinnya, dengan anggapan gudang dan cabang
        // bernama sama. Daftar yang diberikan membuktikan sebaliknya:
        //
        //   Branch "HEAD OFFICE"                        -> Location "Central Kitchen"
        //   Branch "Awal Bermula Cafe & Eatery Serpong" -> Location "Outlet Awal Bermula Coffee & Eatery Serpong"
        //
        // Salinan itu akan mengisi dropdown Location dengan nama-nama yang
        // TIDAK ADA di ESB — dan yang memilihnya tidak punya cara tahu, karena
        // pilihannya tampil seperti pilihan yang sah. Location diketik manual;
        // jumlahnya cuma sebanyak outlet.
        toast(`${n} ${LABEL_JENIS[jenis]} tersimpan.`, 'success');
        renderEsbAdmin(container, { businessUnitId, outlets });
      } catch (e) {
        errEl.textContent = e.message ?? 'Gagal mengimpor.';
      }
    })
  );

  // ---------------------------------------------------------------
  // 1b. Batalkan tanda ekspor
  // ---------------------------------------------------------------
  container.querySelector('#batal-cari').addEventListener(
    'click',
    sekaliJalan(async () => {
      const box = container.querySelector('#batal-hasil');
      box.innerHTML = loadingHtml('Mencari…', { baris: 3 });
      const jenis = container.querySelector('#batal-dokumen').value;
      const from = container.querySelector('#batal-from').value;
      const to = container.querySelector('#batal-to').value;
      const outletId = container.querySelector('#batal-outlet').value || null;
      const satuan = { transfer: 'kiriman', journal: 'waste' }[jenis] ?? 'nota';

      let baris = [];
      try {
        baris =
          jenis === 'transfer'
            ? await kirimanBertandaEsb({ businessUnitId, from, to, outletId })
            : jenis === 'journal'
              ? await wasteBertandaEsb({ businessUnitId, from, to, outletId })
              : await notaBertandaEsb({ businessUnitId, from, to, outletId });
      } catch (e) {
        box.innerHTML = `<p class="error-text">${esc(e.message ?? e)}</p>`;
        return;
      }

      // Disaring lewat modul murni, bukan dipercaya apa adanya dari query.
      // Baris yang tandanya sudah dibuka orang lain sedetik yang lalu masih
      // bisa ikut terbawa, dan menampilkannya sebagai "bisa dibatalkan" cuma
      // menghasilkan "0 dari 3 terbuka" yang membingungkan.
      const daftar = susunDaftarBertanda(baris);
      if (!daftar.length) {
        box.innerHTML = `<p style="color:var(--color-text-muted);font-size:0.88rem">Tidak ada ${esc(satuan)} bertanda ekspor di rentang itu.</p>`;
        return;
      }

      box.innerHTML = `
        <p class="nota-total-kurang" style="margin:0 0 8px">⚠ ${esc(PERINGATAN_ESB)}</p>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 8px">
          <input type="search" id="batal-cari-kode" placeholder="Cari kode ${esc(satuan)}…" autocomplete="off"
                 style="flex:1 1 220px;min-width:180px" />
          <span id="batal-cari-info" style="font-size:0.78rem;color:var(--color-text-muted)"></span>
        </div>
        <div class="table-scroll" style="margin-bottom:8px"><table class="data-table kartu-sempit">
          <thead><tr><th style="width:34px"></th><th>Kode</th><th>Tanggal</th><th>Outlet</th><th>Diekspor</th></tr></thead>
          <tbody id="batal-baris">${daftar
            .map((r) => {
              const jejak = jejakBatal(r, fmtTanggalJam);
              return (
                `<tr data-nama="${esc(r.code)} ${esc(r.supplier ?? '')} ${esc(r.outlet_name)}">` +
                `<td><input type="checkbox" class="batal-pilih" value="${esc(r.id)}" /></td>` +
                `<td data-label="Kode">${esc(r.code ?? '')}${r.supplier ? `<br><span style="font-size:0.78rem;color:var(--color-text-muted)">${esc(r.supplier)}</span>` : ''}</td>` +
                `<td data-label="Tanggal">${esc(fmtTanggal(r.receipt_date))}</td>` +
                `<td data-label="Outlet" style="font-size:0.82rem">${esc(r.outlet_name)}</td>` +
                `<td data-label="Diekspor" style="font-size:0.8rem">${esc(fmtTanggalJam(r.esb_exported_at))}${
                  // Jejak pembatalan LAMA ditampilkan apa adanya sebagai
                  // "pernah dibuka, lalu diekspor lagi". Menampilkannya sebagai
                  // "tandanya terbuka" akan membuat orangnya membukanya lagi.
                  jejak
                    ? `<br><span style="font-size:0.76rem;color:var(--color-text-muted)">pernah dibuka ${esc(jejak.waktu)} oleh ${esc(jejak.oleh)}${
                        jejak.alasan ? ` — ${esc(jejak.alasan)}` : ''
                      }, lalu diekspor lagi</span>`
                    : ''
                }</td></tr>`
              );
            })
            .join('')}</tbody>
        </table></div>
        <div class="field" style="margin:0 0 8px">
          <label for="batal-alasan">Alasan (wajib, minimal ${PANJANG_ALASAN_MIN} huruf)</label>
          <textarea id="batal-alasan" rows="2" placeholder="mis. berkasnya ditolak ESB, belum masuk ke sana"></textarea>
        </div>
        <button class="btn-danger" id="batal-jalankan" style="max-width:280px">Batalkan tanda yang dicentang</button>
        <p class="error-text" id="batal-error" style="margin:8px 0 0"></p>
      `;

      // Pencariannya MENYEMBUNYIKAN barisnya, tidak menggambar ulang — sama
      // seperti di pemetaan. Baris di sini memuat checkbox yang sudah dicentang
      // orangnya; menggambar ulang akan membuang centangnya diam-diam, dan
      // yang hilang dari DOM tidak ikut terkirim.
      saringTabel(
        box.querySelector('#batal-cari-kode'),
        box.querySelectorAll('#batal-baris tr'),
        box.querySelector('#batal-cari-info')
      );

      box.querySelector('#batal-jalankan').addEventListener(
        'click',
        sekaliJalan(async () => {
          const errEl = box.querySelector('#batal-error');
          errEl.textContent = '';
          // Dibaca dari SELURUH tbody, bukan dari baris yang terlihat: baris
          // yang disembunyikan penyaring tetap ada di DOM dan centangnya tetap
          // sah. Membaca yang terlihat saja akan diam-diam melewatkannya.
          const ids = [...box.querySelectorAll('#batal-baris .batal-pilih:checked')].map((c) => c.value);
          if (!ids.length) {
            errEl.textContent = `Centang dulu ${satuan} yang mau dibuka tandanya.`;
            return;
          }
          const periksa = alasanSah(box.querySelector('#batal-alasan').value);
          if (!periksa.boleh) {
            errEl.textContent = periksa.sebab;
            return;
          }
          const setuju = await confirmDialog({
            title: `Buka tanda ekspor ${ids.length} ${satuan}?`,
            message: `${PERINGATAN_ESB}\n\nAlasan: ${periksa.alasan}`,
            confirmText: 'Ya, buka tandanya',
            danger: true
          });
          if (!setuju) return;

          try {
            const n =
              jenis === 'transfer'
                ? await batalkanTandaKirimanEsb(ids, periksa.alasan)
                : jenis === 'journal'
                  ? await batalkanTandaWasteEsb(ids, periksa.alasan)
                  : await batalkanTandaEsb(ids, periksa.alasan);
            // Angka dari database DIBANDINGKAN dengan yang dicentang. Baris
            // milik BU lain, atau yang tandanya sudah dibuka orang lain sejak
            // halaman ini dimuat, dilewati tanpa melempar galat apa pun —
            // melaporkan "berhasil" begitu saja membuat admin mengira semuanya
            // terbuka, lalu staff menabrak dinding yang sama besok.
            const hasil = hasilPembatalan(ids.length, n);
            toast(hasil.pesan, hasil.nada);
          } catch (e) {
            errEl.textContent = e.message ?? 'Gagal membatalkan tanda.';
            return;
          }
          container.querySelector('#batal-cari').click();
        })
      );
    })
  );

  // ---------------------------------------------------------------
  // 1c. Daftar master supplier
  // ---------------------------------------------------------------
  function gambarDaftarSupplier() {
    const daftar = susunDaftarSupplier(master, supplierTerpakai, petaEjaanSupplier(peta));
    const ringkas = ringkasStatus(daftar);
    const kosong = masterPer('supplier').length === 0;

    const lencana = container.querySelector('#esb-supplier-lencana');
    lencana.innerHTML = kosong
      ? '<span class="nota-telat">belum diimpor</span>'
      : ringkas[STATUS_MENGHAMBAT]
        ? `<span class="nota-telat">${ringkas[STATUS_MENGHAMBAT]} belum ada di ESB</span> <span style="color:var(--color-text-muted);font-size:0.8rem">· ${ringkas.total} nama</span>`
        : `<span class="nota-lunas">semua cocok</span> <span style="color:var(--color-text-muted);font-size:0.8rem">· ${ringkas.total} nama</span>`;

    // Kotaknya dibuka sendiri kalau ada yang menghambat. Daftar tertutup yang
    // menyimpan pekerjaan mendesak sama saja dengan tidak ada.
    if (ringkas[STATUS_MENGHAMBAT] || kosong) container.querySelector('#esb-supplier-box').open = true;

    const box = container.querySelector('#esb-supplier-isi');
    box.innerHTML = `
      <p style="font-size:0.82rem;color:var(--color-text-muted);margin:0 0 8px">${esc(pesanRingkas(ringkas, kosong))}</p>
      ${
        daftar.length
          ? `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 8px">
               <input type="search" id="esb-supplier-cari" placeholder="Cari nama supplier…" autocomplete="off"
                      style="flex:1 1 200px;min-width:170px" />
               <select id="esb-supplier-saring" style="flex:0 1 190px">
                 <option value="">Semua status</option>
                 ${Object.entries(LABEL_STATUS)
                   .map(([k, v]) => `<option value="${esc(k)}">${esc(v)} (${ringkas[k] ?? 0})</option>`)
                   .join('')}
               </select>
               <span id="esb-supplier-info" style="font-size:0.78rem;color:var(--color-text-muted)"></span>
             </div>
             <div class="table-scroll"><table class="data-table kartu-sempit">
               <thead><tr><th>Supplier</th><th>Kode ESB</th><th>Status</th><th>Nota</th></tr></thead>
               <tbody id="esb-supplier-baris">${daftar
                 .map((b) => {
                   const warna =
                     b.status === 'belum-terdaftar'
                       ? 'nota-telat'
                       : b.status === 'cocok'
                         ? 'nota-lunas'
                         : '';
                   return (
                     `<tr data-status="${esc(b.status)}" data-nama="${esc(b.nama)} ${esc(b.namaEsb ?? '')} ${esc(b.kode)}">` +
                     `<td data-label="Supplier">${esc(b.nama)}${
                       // Ejaan yang dipetakan menyebut tujuannya. Tanpa itu,
                       // baris "Dipetakan ke ESB" tidak memberitahu DIPETAKAN
                       // KE APA — dan yang membacanya tetap harus menebak.
                       b.status === 'dipetakan' && b.namaEsb
                         ? `<br><span style="font-size:0.76rem;color:var(--color-text-muted)">→ ${esc(b.namaEsb)}</span>`
                         : ''
                     }</td>` +
                     `<td data-label="Kode ESB" style="font-size:0.8rem">${esc(b.kode) || '<span style="color:var(--color-text-muted)">–</span>'}</td>` +
                     `<td data-label="Status"><span class="${warna}">${esc(LABEL_STATUS[b.status])}</span></td>` +
                     `<td data-label="Nota" style="font-size:0.8rem">${
                       b.jumlah
                         ? `${b.jumlah}${b.belumEkspor ? ` · <span class="nota-telat">${b.belumEkspor} belum diekspor</span>` : ''}`
                         : '<span style="color:var(--color-text-muted)">–</span>'
                     }</td></tr>`
                   );
                 })
                 .join('')}</tbody>
             </table></div>`
          : '<p style="color:var(--color-text-muted);font-size:0.88rem">Belum ada supplier — belum ada daftar dari ESB, dan belum ada nota yang mengisi namanya.</p>'
      }`;

    const kotak = box.querySelector('#esb-supplier-cari');
    const saring = box.querySelector('#esb-supplier-saring');
    if (!kotak) return;

    const baris = [...box.querySelectorAll('#esb-supplier-baris tr')];
    const info = box.querySelector('#esb-supplier-info');
    // Dua saringan pada SATU daftar baris, jadi keduanya dihitung bersama.
    // Menyambungkan `saringTabel` dua kali membuat yang kedua menimpa
    // keputusan yang pertama — barisnya muncul lagi padahal statusnya tidak
    // cocok, dan tidak ada yang terlihat salah.
    const jalankan = () => {
      const kata = kotak.value.trim().toLowerCase();
      const status = saring.value;
      let tampil = 0;
      for (const tr of baris) {
        const cocok =
          (!status || tr.dataset.status === status) && (!kata || (tr.dataset.nama ?? '').toLowerCase().includes(kata));
        tr.hidden = !cocok;
        if (cocok) tampil += 1;
      }
      info.textContent = tampil === baris.length ? '' : `${tampil} dari ${baris.length} nama`;
    };
    kotak.addEventListener('input', jalankan);
    saring.addEventListener('change', jalankan);
    jalankan();
  }
  gambarDaftarSupplier();

  // ---------------------------------------------------------------
  // 2. Pemetaan
  // ---------------------------------------------------------------
  function gambarPeta() {
    const box = container.querySelector('#esb-peta');
    box.innerHTML = JENIS_PETA.map((j) => {
      const m = petaPer(j);
      const pilihan = masterPer(j);
      // YANG BELUM DIPETAKAN NAIK KE ATAS.
      //
      // Kelompok Item berisi 647 baris dan yang belum dipetakan delapan.
      // Lencana "8 belum dipetakan" sudah menyebut jumlahnya sejak dulu; yang
      // belum ada adalah cara sampai ke barisnya.
      const { baris, belum: kurang, total } = susunBarisPemetaan(lokal[j], (k) => m.get(normal(k)) ?? '');
      return `
        <details ${kurang ? 'open' : ''} style="margin-bottom:6px">
          <summary style="cursor:pointer;font-size:0.88rem">
            <strong>${LABEL_JENIS[j]}</strong> —
            ${kurang ? `<span class="nota-telat">${kurang} belum dipetakan</span>` : '<span class="nota-lunas">lengkap</span>'}
            <span style="color:var(--color-text-muted);font-size:0.8rem">· ${total} baris</span>
          </summary>
          ${
            perluCari(total)
              ? `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0">
                   <input type="search" class="esb-cari" data-jenis="${j}" placeholder="Cari nama ${esc(LABEL_JENIS[j])}…"
                          autocomplete="off" style="flex:1 1 220px;min-width:180px" />
                   <span class="esb-cari-info" data-jenis="${j}" style="font-size:0.78rem;color:var(--color-text-muted)"></span>
                 </div>`
              : ''
          }
          <div class="table-scroll"><table class="data-table kartu-sempit">
            <thead><tr><th>Berjaya Hub</th><th>ESB</th></tr></thead>
            <tbody data-baris="${j}">${baris
              .map(({ kunci: k, nilai: kini, dipetakan }) => {
                const opsi = pilihan.length
                  ? `<select class="esb-pilih" data-jenis="${j}" data-kunci="${esc(k)}">
                       <option value=""${kini ? '' : ' selected'}>— belum dipetakan —</option>
                       ${pilihan
                         .map((p) => `<option value="${esc(p.nama)}"${p.nama === kini ? ' selected' : ''}>${esc(p.nama)}</option>`)
                         .join('')}
                     </select>`
                  : // Daftar induknya belum diimpor -> kotak ketik, supaya
                    // pemetaan yang jumlahnya sedikit (COA, cara bayar) tidak
                    // ikut tersandera oleh impor yang belum dilakukan.
                    `<input type="text" class="esb-ketik" data-jenis="${j}" data-kunci="${esc(k)}"
                            value="${esc(kini)}" placeholder="ketik nilai ESB" />`;
                // `data-nama` memuat KEDUA sisi: orang mencari lewat nama
                // Berjaya Hub maupun nama ESB-nya, tergantung mana yang ia
                // pegang saat itu.
                // Untuk supplier: berapa nota yang memakai ejaan ini, dan
                // berapa yang masih menunggu diekspor. Tanpa angka itu, ejaan
                // yang menahan 40 nota dan yang menahan 1 nota terlihat sama
                // mendesaknya — dan yang dikerjakan lebih dulu jadi yang
                // kebetulan paling atas.
                const pakai = j === 'supplier' ? notaPerSupplier.get(normalNama(k)) : null;
                const ket = pakai
                  ? `<br><span style="font-size:0.76rem;color:var(--color-text-muted)">${pakai.jumlah} nota${
                      pakai.belum ? ` · <span class="nota-telat">${pakai.belum} belum diekspor</span>` : ''
                    }</span>`
                  : '';
                return `<tr data-nama="${esc(k)} ${esc(kini)}"${dipetakan ? '' : ' class="esb-belum"'}>
                          <td data-label="Berjaya Hub">${esc(k)}${ket}</td><td data-label="ESB">${opsi}</td>
                        </tr>`;
              })
              .join('')}</tbody>
          </table></div>
        </details>`;
    }).join('');

    // Pencarian MENYEMBUNYIKAN baris, tidak menggambar ulang tabelnya —
    // barisnya memuat `<select>` yang nilainya sedang dipakai, dan baris yang
    // lenyap dari DOM kehilangan penangan `change`-nya.
    box.querySelectorAll('.esb-cari').forEach((kotak) =>
      saringTabel(
        kotak,
        box.querySelectorAll(`tbody[data-baris="${kotak.dataset.jenis}"] tr`),
        box.querySelector(`.esb-cari-info[data-jenis="${kotak.dataset.jenis}"]`)
      )
    );

    const simpan = async (el) => {
      try {
        await simpanEsbMap(businessUnitId, { jenis: el.dataset.jenis, kunci: el.dataset.kunci, nilai: el.value });
        const i = peta.findIndex((p) => p.jenis === el.dataset.jenis && normal(p.kunci) === normal(el.dataset.kunci));
        if (i >= 0) peta.splice(i, 1);
        if (el.value.trim()) peta.push({ jenis: el.dataset.jenis, kunci: el.dataset.kunci, nilai: el.value.trim() });
      } catch (e) {
        toast(e.message ?? 'Gagal menyimpan pemetaan.', 'error');
      }
    };
    box.querySelectorAll('.esb-pilih').forEach((el) => el.addEventListener('change', () => simpan(el)));
    box.querySelectorAll('.esb-ketik').forEach((el) => el.addEventListener('change', () => simpan(el)));
  }

  container.querySelector('#esb-cocokkan').addEventListener(
    'click',
    sekaliJalan(async () => {
      // Kecocokan PERSIS saja, sesudah nama disamakan. Kemiripan sebagian
      // ("Telur" ~ "Telur Puyuh") adalah tebakan, dan tebakan di sini menjadi
      // pembelian yang tercatat atas barang yang salah — tanpa satu pun error.
      //
      // KODE SKU DIDAHULUKAN DARI NAMA (0148).
      //
      // Nama adalah jembatan yang putus saat salah satu ujungnya diganti — dan
      // keduanya memang diganti: produk diubah namanya di Master Produk, dan
      // ESB merapikan ejaannya sendiri. Kode tidak ikut berubah.
      //
      // Cuma untuk `item`: lima jenis lain tidak punya kode di Berjaya Hub.
      const kodeEsb = new Map(
        masterPer('item')
          .filter((p) => normal(p.kode))
          .map((p) => [normal(p.kode), p.nama])
      );
      const namaKeSku = new Map(
        produk.filter((p) => normal(p.sku)).map((p) => [normal(p.name), normal(p.sku)])
      );

      const usul = [];
      let lewatKode = 0;
      for (const j of JENIS_PETA) {
        const m = petaPer(j);
        const idx = new Map(masterPer(j).map((p) => [normal(p.nama), p.nama]));
        for (const k of lokal[j]) {
          if (m.has(normal(k))) continue;
          const sku = j === 'item' ? namaKeSku.get(normal(k)) : null;
          const lewatSku = sku ? kodeEsb.get(sku) : null;
          if (lewatSku) {
            usul.push({ jenis: j, kunci: k, nilai: lewatSku });
            lewatKode += 1;
            continue;
          }
          const cocok = idx.get(normal(k));
          if (cocok) usul.push({ jenis: j, kunci: k, nilai: cocok });
        }
      }
      if (!usul.length) {
        toast('Tidak ada yang bisa dicocokkan otomatis — namanya harus sama persis.', 'warning');
        return;
      }
      const ok = await confirmDialog({
        title: `Cocokkan ${usul.length} nilai?`,
        message:
          (lewatKode
            ? `<strong>${lewatKode}</strong> dicocokkan lewat <strong>kode SKU</strong> — jembatan yang tidak putus saat namanya diganti. `
            : '') +
          `Sisanya lewat nama yang <strong>sama persis</strong> (beda huruf besar-kecil & tanda baca diabaikan). ` +
          'Yang mirip tapi tidak sama sengaja dibiarkan — menebaknya berarti pembelian tercatat atas barang yang salah.' +
          (lewatKode
            ? ''
            : '<br><br>Belum ada satu pun yang cocok lewat kode. Isi kolom Kode SKU di Master Produk ' +
              '(tombol "Template Kode SKU") supaya pemetaannya tidak putus saat nama produk diubah.'),
        confirmText: 'Cocokkan'
      });
      if (!ok) return;
      let n = 0;
      for (const u of usul) {
        try {
          await simpanEsbMap(businessUnitId, u);
          n++;
        } catch {
          // Satu kegagalan tidak boleh menghentikan sisanya; jumlah yang
          // berhasil tetap dilaporkan apa adanya.
        }
      }
      toast(`${n} dari ${usul.length} nilai dicocokkan.`, n === usul.length ? 'success' : 'warning');
      renderEsbAdmin(container, { businessUnitId, outlets });
    })
  );

  // ---------------------------------------------------------------
  // 3. Pratinjau & unduh
  // ---------------------------------------------------------------
  const jenisDokumen = () => container.querySelector('#esb-dokumen').value;

  function ketDokumen() {
    const jenis = jenisDokumen();
    const d = DOKUMEN[jenis];
    const tambahan = {
      transfer:
        ' Qty yang dikirim ke ESB adalah <strong>jumlah yang DITERIMA</strong>, dan tanggalnya tanggal barang diterima — bukan tanggal dikirim.',
      journal:
        ' Berkas Item Journal <strong>tidak punya kolom outlet</strong> — outletnya ditentukan saat diimpor di ESB, jadi <strong>satu berkas hanya boleh berisi satu outlet</strong>. ' +
        'Semua barisnya <strong>Deduct</strong> (mengurangi stok), dan <strong>Value per Unit</strong> diambil dari harga beli rata-rata bahan di outlet itu.',
      purchase:
        ' <strong>Harga yang dikirim adalah harga per satuan</strong> (beras 5.000 gr seharga Rp180.000 berangkat sebagai Qty 5000, Price 36).'
    }[jenis];
    container.querySelector('#esb-dokumen-ket').innerHTML = `Sumbernya: ${esc(d.sumber)}.${tambahan ?? ''}`;

    // OUTLET DIPAKSA, BUKAN CUMA DIMINTA.
    //
    // "Semua outlet" tetap terpilih dari pilihan sebelumnya akan menghasilkan
    // berkas gabungan yang DITERIMA ESB dengan tenang: seluruhnya masuk ke
    // outlet yang dipilih saat impor, dan stok outlet lain berkurang di sana
    // tanpa pernah berkurang di sini. Jadi pilihannya dicabut dari layar, bukan
    // ditolak belakangan lewat pesan galat.
    const sel = container.querySelector('#esb-outlet');
    const semua = sel.querySelector('option[value=""]');
    if (d.outletWajib) {
      semua.disabled = true;
      semua.textContent = '— pilih satu outlet —';
      // Kalau yang terpilih justru "Semua outlet", pindahkan ke outlet pertama
      // supaya kotaknya tidak berdiri dengan nilai yang sudah dilarang.
      if (!sel.value) sel.value = outlets[0]?.id ?? '';
    } else {
      semua.disabled = false;
      semua.textContent = 'Semua outlet';
    }
  }
  ketDokumen();
  // Hasil pratinjau lama dibersihkan saat jenisnya berganti. Tabel Purchase yang
  // masih terpampang di bawah pilihan "Transfer" akan diunduh sebagai berkas
  // bernama transfer — dan isinya baru ketahuan salah setelah diunggah.
  container.querySelector('#esb-dokumen').addEventListener('change', () => {
    ketDokumen();
    container.querySelector('#esb-hasil').innerHTML = '';
  });

  container.querySelector('#esb-pratinjau').addEventListener('click', sekaliJalan(pratinjau));

  async function pratinjau() {
    const hasilEl = container.querySelector('#esb-hasil');
    hasilEl.innerHTML = loadingHtml('Menyiapkan…', { baris: 3 });
    const jenis = jenisDokumen();
    const dok = DOKUMEN[jenis];
    const from = container.querySelector('#esb-from').value;
    const to = container.querySelector('#esb-to').value;
    const outletId = container.querySelector('#esb-outlet').value || null;

    // Penjaga KEDUA untuk aturan satu-berkas-satu-outlet. Yang pertama mencabut
    // pilihannya dari layar; yang ini menangkap keadaan yang lolos dari sana —
    // BU tanpa outlet sama sekali, atau `<select>` yang nilainya dikosongkan
    // sesudah `ketDokumen` jalan. Penjaga ketiga ada di `barisEsbJournal`.
    if (dok.outletWajib && !outletId) {
      hasilEl.innerHTML =
        '<p class="error-text" style="margin:0">Pilih satu outlet dulu. Berkas Item Journal tidak punya kolom outlet, jadi berkas gabungan akan masuk seluruhnya ke outlet yang dipilih saat impor di ESB.</p>';
      return;
    }

    let hasil;
    let total;
    let ringkas;
    let ids;
    try {
      if (jenis === 'journal') {
        // DUA SUMBER NILAI, dan keduanya memang perlu — sama persis dengan
        // Rekap Waste / Spoil, lewat fungsi yang sama.
        //
        // Versi pertama cuma mengambil yang pertama, dan SELURUH barang
        // produksi tertahan: "Danish Cinnamon (WIP)" tidak pernah dibeli, ia
        // diproduksi, jadi ia tidak punya satu pun baris biaya rata-rata —
        // sementara Master Produk dan Rekap Waste menampilkan HPP-nya dengan
        // jelas. Dua layar yang menyebut angka berbeda untuk barang yang sama
        // membuat keduanya tidak bisa dipercaya.
        const [data, biayaRata, resep] = await Promise.all([
          wasteUntukEsb({ businessUnitId, from, to, outletId }),
          // Kuncinya `outletId|productId` — biayanya memang berbeda per outlet.
          getBiayaRataBu(businessUnitId),
          listRecipesFull(businessUnitId)
        ]);
        total = data.waste.length;
        if (!total) {
          hasilEl.innerHTML =
            '<p style="color:var(--color-text-muted);font-size:0.88rem">Tidak ada waste/spoil baru di outlet & rentang itu. Yang sudah pernah diekspor sengaja tidak ditawarkan lagi.</p>';
          return;
        }
        hasil = barisEsbJournal({
          waste: data.waste,
          itemsPerWaste: data.itemsPerWaste,
          peta: buatPeta(peta),
          kodeItem: new Map(master.filter((m) => m.jenis === 'item' && m.kode).map((m) => [m.nama, m.kode])),
          biaya: biayaRata,
          hpp: computeCosts(produk, resep)
        });
        ringkas = ringkasJournal(hasil, total);
        ids = hasil.wasteIds;
      } else if (jenis === 'transfer') {
        const data = await kirimanUntukEsb({ businessUnitId, from, to, outletId });
        total = data.kiriman.length;
        if (!total) {
          hasilEl.innerHTML =
            '<p style="color:var(--color-text-muted);font-size:0.88rem">Tidak ada kiriman <strong>yang sudah diterima</strong> di rentang itu. Kiriman yang masih di jalan sengaja belum ditawarkan — stok ESB baru boleh bertambah setelah barangnya sampai. Yang sudah pernah diekspor juga tidak ditawarkan lagi.</p>';
          return;
        }
        hasil = barisEsbTransfer({
          kiriman: data.kiriman,
          itemsPerKiriman: data.itemsPerKiriman,
          peta: buatPeta(peta),
          // Product Code diambil dari daftar induk ESB lewat NAMA hasil
          // pemetaan — kode lokal Berjaya Hub bukan kode ESB.
          kodeItem: new Map(master.filter((m) => m.jenis === 'item' && m.kode).map((m) => [m.nama, m.kode]))
        });
        ringkas = ringkasTransfer(hasil, total);
        ids = hasil.kirimanIds;
      } else {
        const data = await notaUntukEsb({ businessUnitId, from, to, outletId });
        total = data.notas.length;
        if (!total) {
          hasilEl.innerHTML =
            '<p style="color:var(--color-text-muted);font-size:0.88rem">Tidak ada nota baru di rentang itu. Nota yang sudah pernah diekspor sengaja tidak ditawarkan lagi.</p>';
          return;
        }
        hasil = barisEsbPurchase({
          notas: data.notas,
          itemsPerNota: data.itemsPerNota,
          peta: buatPeta(peta),
          // Daftar induk supplier. Kalau BU ini belum pernah mengimpornya,
          // petanya kosong dan pemeriksaan suppliernya dilewati — aturan baru
          // tidak boleh mendadak menahan seluruh nota yang selama ini berangkat.
          masterSupplier: petaSupplier(master)
        });
        ringkas = ringkasEkspor(hasil, total);
        ids = hasil.notaIds;
      }
    } catch (e) {
      hasilEl.innerHTML = `<p class="error-text">${esc(e.message ?? e)}</p>`;
      return;
    }

    hasilEl.innerHTML = `
      <p style="font-size:0.88rem;margin:0 0 8px">
        <strong>${ringkas.siap}</strong> ${dok.satuan} siap (${ringkas.baris} baris)${
          ringkas.tertahan ? ` · <span class="nota-telat">${ringkas.tertahan} tertahan</span>` : ''
        }
      </p>
      ${
        hasil.kurang.length
          ? `<div class="table-scroll" style="margin-bottom:8px"><table class="data-table kartu-sempit">
               <thead><tr><th>Jenis</th><th>Nilai Berjaya Hub</th><th>Dokumen terpengaruh</th></tr></thead>
               <tbody>${hasil.kurang
                 .map((k) => {
                   // Modul Purchase menamainya `nota`, modul Transfer `dok`.
                   const daftar = k.dok ?? k.nota ?? [];
                   return (
                     `<tr><td data-label="Jenis">${esc(LABEL_JENIS[k.jenis] ?? k.jenis)}</td>` +
                     `<td data-label="Nilai">${esc(k.nilai)}</td>` +
                     `<td data-label="Dokumen" style="font-size:0.8rem">${esc(daftar.slice(0, 6).join(', '))}${
                       daftar.length > 6 ? ` +${daftar.length - 6}` : ''
                     }</td></tr>`
                   );
                 })
                 .join('')}</tbody></table></div>
             <p class="nota-total-kurang" style="margin:0 0 8px">Beresi dulu yang di atas — yang berupa pemetaan di langkah 5, sisanya di nota/kiriman/waste-nya sendiri — lalu tekan Pratinjau lagi.</p>`
          : ''
      }
      ${
        ringkas.siap
          ? `<button class="primary" id="esb-unduh" style="max-width:260px">⇩ Unduh .xlsx — ${esc(dok.label)}</button>`
          : `<p class="error-text" style="margin:0">Tidak ada ${esc(dok.satuan)} yang bisa diunduh.</p>`
      }
    `;

    container.querySelector('#esb-unduh')?.addEventListener(
      'click',
      sekaliJalan(async () => {
        try {
          await unduhEsb(dok.kolom, hasil.baris, `${dok.berkas}-${from}-sd-${to}`, {
            barisHeader: dok.barisHeader ?? 0,
            judul: dok.judulBerkas ?? ''
          });
        } catch (e) {
          toast(e.message ?? 'Gagal membuat berkas.', 'error');
          return;
        }
        // DITANDAI SESUDAH BERKASNYA JADI, bukan sebelum. Kalau ditandai lebih
        // dulu lalu pembuatan berkasnya gagal, dokumennya hilang dari daftar
        // tanpa pernah sampai ke ESB — dan tidak ada yang tahu sampai stoknya
        // tidak cocok.
        try {
          const n =
            jenis === 'transfer'
              ? await tandaiKirimanEsb(ids)
              : jenis === 'journal'
                ? await tandaiWasteEsb(ids)
                : await tandaiNotaEsb(ids);
          toast(`Berkas terunduh. ${n} ${dok.satuan} ditandai sudah diekspor.`, 'success');
        } catch (e) {
          toast(
            `Berkas TERUNDUH, tapi penandaannya gagal: ${e.message ?? e}. ` +
              `${dok.satuan} ini akan ditawarkan lagi di ekspor berikutnya — jangan unggah dua kali.`,
            'warning'
          );
        }
        pratinjau();
      })
    );
  }
}

/**
 * Tulis berkas .xlsx yang bentuknya persis template ESB-nya.
 *
 * ============ BARIS HEADERNYA TIDAK SAMA DI SEMUA TEMPLATE ============
 *
 * Simple Purchase & Simple Transfer menaruh nama kolom di BARIS 1, tanpa judul
 * apa pun di atasnya — satu baris judul saja membuat seluruh berkas ditolak.
 *
 * Item Journal justru sebaliknya: baris 1 judul, baris 2 kosong, nama kolom di
 * BARIS 3. Templatenya dibuka dan diperiksa apa adanya, bukan dikira-kira.
 *
 * Jadi `barisHeader` bukan hiasan: mengirim berkas Item Journal dengan header
 * di baris 1 berarti ESB membaca "ESB Item Journal Template" sebagai nama kolom
 * pertamanya. Angkanya datang dari `BARIS_HEADER_JOURNAL`, satu tempat.
 *
 * Kolom Date-nya berisi nomor seri Excel (lihat `tanggal-excel.js`), dan di
 * sinilah ia diberi format tampilan. Tanpa itu isinya benar tapi tampil sebagai
 * `46266` — dan yang membuka berkasnya untuk memeriksa sebelum mengunggah akan
 * mengira ekspornya rusak.
 */
async function unduhEsb(kolom, baris, namaFile, { barisHeader = 0, judul = '' } = {}) {
  const XLSX = await loadXLSX();
  // Baris kosong SEBANYAK yang dituntut templatenya, dengan judulnya di baris
  // paling atas kalau ada. `barisHeader` 0 menghasilkan daftar kosong — jadi
  // dua template lama tetap berangkat dengan header di baris pertama.
  const atas = [];
  for (let r = 0; r < barisHeader; r++) atas.push(r === 0 && judul ? [judul] : []);

  const ws = XLSX.utils.aoa_to_sheet([...atas, kolom, ...baris]);
  pasangFormatTanggal(ws, kolom, baris.length, (c, r) => XLSX.utils.encode_cell({ c, r }), barisHeader);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  XLSX.writeFile(wb, `${namaFile}.xlsx`);
}

/**
 * Baca berkas ekspor ESB.
 *
 * Bentuknya seragam: empat baris judul/keterangan, satu baris kosong, lalu
 * HEADER di baris ke-6. Header dicari, bukan diasumsikan di baris tertentu —
 * ESB boleh menambah baris keterangan kapan saja, dan pembacaan yang mengunci
 * nomor baris akan diam-diam memuat data yang bergeser.
 */
async function bacaMasterEsb(file, jenis) {
  const XLSX = await loadXLSX();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  const kolomWajib = {
    branch: ['Branch Name'],
    unit: ['Unit Name'],
    item: ['Product Name'],
    // Ekspor "Master Supplier With Bank" — 22 kolom, header di baris ke-6.
    // Barisnya dicari, bukan diasumsikan; lihat catatan di kepala fungsi ini.
    supplier: ['Supplier Name'],
    // Ekspor "Master Purpose Management" — empat kolom (Purpose ID, Purpose
    // Name, Purpose Account, Status), header di baris ke-6 juga.
    purpose: ['Purpose Name']
  }[jenis];

  const iHeader = aoa.findIndex((r) => kolomWajib.every((k) => r.includes(k)));
  if (iHeader < 0) {
    throw new Error(`Kolom "${kolomWajib.join('", "')}" tidak ditemukan — berkasnya bukan ekspor ${jenis} dari ESB?`);
  }
  const header = aoa[iHeader].map((h) => String(h).trim());
  const kol = (nama) => header.indexOf(nama);

  const iNama = kol(kolomWajib[0]);
  const KODE = { branch: 'Branch Code', item: 'Product Code', supplier: 'Supplier Code', purpose: 'Purpose ID' }[jenis];
  // Purpose Account ("COGS - Food") ikut sebagai keterangan. Ia tidak dikirim
  // ke mana pun — ia yang membuat staff bisa membedakan tiga pilihan yang
  // namanya mirip, di layar tempat ia harus memilih salah satunya.
  const KET = { item: 'Category', branch: 'Branch Type', supplier: 'Category', purpose: 'Purpose Account' }[jenis];
  const iKode = KODE ? kol(KODE) : -1;
  const iKet = KET ? kol(KET) : -1;
  // Baris NONAKTIF tidak ikut. ESB menolak nilai yang statusnya bukan Active,
  // dan menawarkannya di dropdown berarti menawarkan pilihan yang pasti gagal
  // — kegagalannya baru terbaca saat berkasnya diunggah, berminggu kemudian.
  const iStatus = kol('Status');

  const out = [];
  for (let i = iHeader + 1; i < aoa.length; i++) {
    const r = aoa[i];
    const nama = String(r[iNama] ?? '').trim();
    if (!nama) continue;
    if (iStatus >= 0 && String(r[iStatus] ?? '').trim().toLowerCase() === 'inactive') continue;
    out.push({
      nama,
      kode: iKode >= 0 ? String(r[iKode] ?? '').trim() : null,
      keterangan: iKet >= 0 ? String(r[iKet] ?? '').trim() : null
    });
  }
  return out;
}
