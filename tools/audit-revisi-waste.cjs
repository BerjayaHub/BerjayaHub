/**
 * AUDIT: revisi & pembatalan waste/spoil (0181).
 *
 * ============ CARA FITUR INI RUSAK TANPA TERLIHAT RUSAK ============
 *
 *   angkanya diubah, stoknya     -> laporan waste menyebut 2 kg, stok
 *   tidak                            berkurang 20 kg. Dua layar yang
 *                                    sama-sama rapi dan saling bertentangan,
 *                                    tanpa satu pun galat yang menghubungkan
 *                                    keduanya
 *
 *   dipasang tanpa dibongkar      -> stok terpotong DUA KALI. Tidak ada yang
 *   lebih dulu                       merah di mana pun; angkanya cuma salah
 *
 *   pembatalan menghapus
 *   `waste_items`                 -> "dibatalkan tapi berjejak" kehilangan
 *                                    jejaknya: tidak ada lagi catatan bahan
 *                                    apa saja yang dulu terpotong
 *
 *   wewenangnya diperiksa pakai   -> `has_outlet_scope` juga bernilai true
 *   penjaga yang salah               untuk STAFF outlet itu — yaitu orang yang
 *                                    salah inputnya sedang dibetulkan
 *
 *   `catat_waste` kehilangan satu -> waste tanpa foto, atau waste di outlet
 *   pemeriksaan saat ditulis ulang   yang bukan haknya. 0179 kehilangan dua
 *                                    `insert into asset_log` persis begitu
 */
const fs = require('fs');
const path = require('path');
const { tanpaKomentar, periksaKewarasan } = require('./lib/tanpa-komentar.cjs');

const AKAR = path.dirname(__dirname);
let gagal = 0;
const salah = (pesan) => {
  gagal++;
  console.error(`❌ ${pesan}`);
};

const baca = (rel) => {
  const p = path.join(AKAR, rel);
  if (!fs.existsSync(p)) {
    salah(`${rel} tidak ada — audit ini kehilangan sasarannya.`);
    return null;
  }
  return fs.readFileSync(p, 'utf8');
};

const bacaKode = (rel) => {
  const asli = baca(rel);
  if (!asli) return null;
  const kode = tanpaKomentar(asli);
  const pesan = periksaKewarasan(asli, kode, ['waste', 'revisi']);
  if (pesan) {
    salah(`${rel}: ${pesan} — audit ini tidak bisa dipercaya untuk berkas itu.`);
    return null;
  }
  return kode;
};

const tanpaKomentarSql = (sql) =>
  sql
    .split('\n')
    .map((b) => (b.trim().startsWith('--') ? '' : b))
    .join('\n');

const MIG = 'supabase/migrations/0181_revisi_waste.sql';
const MURNI = 'js/modules/inventory/aturan-revisi-waste.js';
const SVC = 'js/modules/inventory/waste.service.js';
const PAGE = 'js/modules/inventory/waste.admin.js';
const LAPORAN = 'js/modules/inventory/laporan-waste.js';
const TES_PG = 'tools/test-migrasi-0181.mjs';
const TES_MURNI = 'tools/test-aturan-revisi-waste.mjs';

// =====================================================================
// 1. SQL
// =====================================================================
const mentah = baca(MIG);
const sql = mentah ? tanpaKomentarSql(mentah) : null;
const fungsi = (nama) => {
  if (!sql) return '';
  const i = sql.indexOf(`create or replace function ${nama}(`);
  return i < 0 ? '' : sql.slice(i, sql.indexOf('\n$$;', i));
};

if (sql) {
  // ============ STOKNYA IKUT, SELALU ============
  const revisi = fungsi('revisi_waste');
  if (!revisi) {
    salah(`${MIG}: \`revisi_waste\` tidak ada.`);
  } else {
    if (!/perform bongkar_waste\(w\.id\);[\s\S]{0,120}pasang_waste\(w\.id\)/.test(revisi)) {
      salah(
        `${MIG}: revisi tidak membongkar lalu memasang ulang potongan stoknya. ` +
          'Angka di laporan berubah, stok tidak — dua layar rapi yang saling bertentangan.'
      );
    }
    // Wewenangnya `is_admin_of_outlet`, BUKAN `has_outlet_scope`: yang kedua
    // juga bernilai true untuk staff outlet itu, yaitu orang yang salah
    // inputnya sedang dibetulkan.
    if (!/is_admin_of_outlet\(v_uid, w\.outlet_id\)/.test(revisi)) {
      salah(`${MIG}: revisi tidak dijaga \`is_admin_of_outlet\` — staff biasa ikut bisa merevisi catatannya sendiri.`);
    }
    if (/has_outlet_scope/.test(revisi)) {
      salah(`${MIG}: revisi memakai \`has_outlet_scope\` — itu juga bernilai true untuk staff biasa.`);
    }
    if (!/v_alasan is null then raise exception/.test(revisi)) {
      salah(`${MIG}: alasan revisi tidak wajib — "kenapa 20 kg jadi 2 kg" tidak akan terjawab di mana pun.`);
    }
    if (!/business_unit_id = w\.business_unit_id/.test(revisi)) {
      salah(`${MIG}: produk dari BU lain tidak ditolak — satu salah pilih memotong stok milik BU lain.`);
    }
    if (!/insert into waste_revisi/.test(revisi)) {
      salah(`${MIG}: angka lamanya tidak disimpan — sesudah ditimpa, tidak ada lagi yang tahu dulu berapa.`);
    }
    if (!/w\.dibatalkan_at is not null then/.test(revisi)) {
      salah(`${MIG}: kejadian yang sudah dibatalkan masih bisa direvisi — stoknya akan terpotong lagi diam-diam.`);
    }
  }

  const bongkar = fungsi('bongkar_waste');
  if (!/delete from stock_movements where waste_run_id = p_waste;/.test(bongkar)) {
    salah(`${MIG}: \`bongkar_waste\` tidak menghapus pergerakan stoknya.`);
  }
  if (!/delete from waste_items where waste_id = p_waste;/.test(bongkar)) {
    salah(`${MIG}: \`bongkar_waste\` tidak menghapus rinciannya — bahan lama akan menumpuk dengan yang baru.`);
  }

  // ============ PEMBATALAN MENINGGALKAN JEJAK ============
  const batal = fungsi('batalkan_waste');
  if (!batal) {
    salah(`${MIG}: \`batalkan_waste\` tidak ada.`);
  } else {
    if (/bongkar_waste|delete from waste_items/.test(batal)) {
      salah(
        `${MIG}: pembatalan ikut menghapus rincian bahannya. ` +
          '"Dibatalkan tapi tetap berjejak" lalu kehilangan jejaknya — tidak ada lagi catatan bahan apa yang dulu terpotong.'
      );
    }
    if (!/delete from stock_movements where waste_run_id = w\.id;/.test(batal)) {
      salah(`${MIG}: pembatalan tidak mengembalikan stoknya.`);
    }
    if (!/is_admin_of_outlet\(v_uid, w\.outlet_id\)/.test(batal)) {
      salah(`${MIG}: pembatalan tidak dijaga \`is_admin_of_outlet\`.`);
    }
    if (!/v_alasan is null then raise exception/.test(batal)) {
      salah(`${MIG}: alasan pembatalan tidak wajib.`);
    }
    if (!/w\.dibatalkan_at is not null then/.test(batal)) {
      salah(`${MIG}: membatalkan dua kali tidak ditolak.`);
    }
  }

  const pulih = fungsi('pulihkan_waste');
  if (!pulih) {
    salah(`${MIG}: \`pulihkan_waste\` tidak ada — admin yang salah membatalkan tidak punya jalan pulang.`);
  } else if (!/perform bongkar_waste\(w\.id\);[\s\S]{0,120}pasang_waste\(w\.id\)/.test(pulih)) {
    salah(
      `${MIG}: pemulihan memasang tanpa membongkar lebih dulu. ` +
        'Rincian lama yang tertinggal membuat stok terpotong DUA KALI, dan tidak ada yang merah di mana pun.'
    );
  }

  // ============ SATU TEMPAT SAJA YANG TAHU CARA MEMOTONG STOK ============
  //
  // Kalau `catat_waste` tetap punya salinan aturan resepnya sendiri, keduanya
  // pasti menyimpang pada perbaikan berikutnya — dan penyimpangannya membuat
  // stok yang dipotong revisi berbeda dari stok yang dipotong pencatatan.
  const catat = fungsi('catat_waste');
  if (!catat) {
    salah(`${MIG}: \`catat_waste\` tidak ditulis ulang — ia masih memakai salinan aturannya sendiri.`);
  } else {
    if (!/v_n := pasang_waste\(v_id\);/.test(catat)) {
      salah(`${MIG}: \`catat_waste\` tidak memakai \`pasang_waste\`.`);
    }
    if (/recipe_items/.test(catat)) {
      salah(`${MIG}: \`catat_waste\` masih menjabarkan resepnya sendiri — dua salinan aturan yang akan menyimpang.`);
    }

    // ============ YANG DISALIN HARUS UTUH ============
    //
    // Dibandingkan baris demi baris dengan 0147: setiap baris pemeriksaan di
    // paruh pertama yang hilang adalah penjagaan yang lenyap tanpa satu pun
    // tanda. Yang dibandingkan hanya SAMPAI `insert into waste_runs` —
    // sesudah itu memang sengaja diganti.
    const lama = baca('supabase/migrations/0147_purpose_waste.sql');
    if (lama) {
      const potong = (teks) => {
        const i = teks.indexOf('create or replace function catat_waste(');
        if (i < 0) return null;
        const j = teks.indexOf('insert into waste_runs', i);
        return j < 0 ? null : teks.slice(i, j);
      };
      const a = potong(tanpaKomentarSql(lama));
      const b = potong(sql);
      if (!a || !b) {
        salah(`${MIG}: \`catat_waste\` tidak ditemukan di salah satu berkas.`);
      } else {
        const barisA = a.split('\n').filter((x) => x.trim());
        const barisB = b.split('\n').filter((x) => x.trim());
        const hilang = barisA.filter((x) => !barisB.includes(x));
        if (hilang.length) {
          salah(
            `${MIG}: penulisan ulang \`catat_waste\` KEHILANGAN ${hilang.length} baris pemeriksaan dari 0147 — ` +
              `mis. ${hilang[0].trim().slice(0, 70)}`
          );
        }
      }
    }
  }

  // ============ REKAPNYA TIDAK MEMUAT YANG DIBATALKAN ============
  if (!/where w\.dibatalkan_at is null/.test(sql)) {
    salah(
      `${MIG}: \`waste_rekap\` masih memuat kejadian yang dibatalkan. ` +
        'Stoknya sudah dikembalikan tapi laporannya tetap menghitungnya — selisih yang tidak akan dicurigai siapa pun.'
    );
  }
  if (!/create or replace function daftar_waste_dibatalkan/.test(sql)) {
    salah(`${MIG}: yang dibatalkan tidak bisa dilihat dari aplikasi — "berjejak" cuma berlaku bagi yang bisa membuka SQL editor.`);
  }

  for (const t of [TES_PG, TES_MURNI]) {
    if (!fs.existsSync(path.join(AKAR, t))) salah(`${t} tidak ada — aturannya tidak pernah dijalankan.`);
  }
}

// =====================================================================
// 2. Modul murni
// =====================================================================
const murni = bacaKode(MURNI);
if (murni) {
  // Gagal memeriksa wewenang = dianggap TIDAK berwenang.
  if (!/bolehKelola = false/.test(murni)) {
    salah(`${MURNI}: wewenang tidak berpangkal "tidak boleh" — keraguan jaringan akan membuka tombolnya untuk semua orang.`);
  }
  // Sudah diekspor ke ESB: BOLEH, tapi harus dikatakan.
  if (!/terkunci[\s\S]{0,200}ESB/.test(murni)) {
    salah(`${MURNI}: kejadian yang sudah diekspor tidak diberi peringatan ESB.`);
  }
  if (/terkunci[\s\S]{0,80}boleh: false/.test(murni)) {
    salah(`${MURNI}: yang sudah diekspor ditolak — angka yang salah lalu salah di dua tempat selamanya.`);
  }
}

// =====================================================================
// 3. Layarnya
// =====================================================================
const page = bacaKode(PAGE);
if (page) {
  // Satu kejadian = satu tombol.
  if (!/barisPemegangAksi\(lap\.meta\)/.test(page)) {
    salah(
      `${PAGE}: tombol aksi tidak dibatasi satu per kejadian. ` +
        'Waste menu melahirkan beberapa baris bahan; tombol di tiap baris membuat admin mengira sedang merevisi baris itu saja.'
    );
  }
  // Wewenangnya `scopeAdminSaya`, bukan `sayaAdminBu`: admin outlet memang
  // diizinkan database, dan menyembunyikan tombolnya membuat dia tidak pernah
  // tahu bahwa ia boleh.
  if (!/scopeAdminSaya\(businessUnitId\)/.test(page)) {
    salah(`${PAGE}: wewenang revisi dihitung tanpa \`scopeAdminSaya\` — admin outlet kehilangan tombol yang database-nya izinkan.`);
  }
  // Konfirmasi menyebut APA yang berubah. "Yakin?" saja tidak memberi tahu
  // apa pun, dan yang menekannya baru tahu isinya sesudah stok terlanjur
  // dihitung ulang.
  if (!/ringkasPerubahanWaste\(/.test(page)) {
    salah(`${PAGE}: dialog konfirmasi tidak menyebut apa yang berubah.`);
  }
  if (!/if \(!perubahan\.length\) return toast/.test(page)) {
    salah(`${PAGE}: revisi yang tidak mengubah apa pun tetap dikirim — menaikkan nomor revisi dan menulis jejak yang isinya sama di dua sisi.`);
  }
  // Kolom Aksi harus punya header DAN `data-label` yang sama. Di mode kartu,
  // label yang bergeser satu kolom menghasilkan kartu yang rapi dan salah.
  // Diperiksa DI SEL YANG MENGGAMBAR TOMBOLNYA, bukan di mana pun di berkas:
  // daftar "dibatalkan" di bawah tabel juga punya kolom Aksi, dan mencarinya
  // di seluruh berkas membuat pemeriksaan ini tetap hijau walau sel tabel
  // utamanya kehilangan labelnya.
  if (!/<th>Aksi<\/th>/.test(page) || !/data-label="Aksi">\$\{selAksi\(/.test(page)) {
    salah(`${PAGE}: kolom Aksi tidak punya header & \`data-label\` yang sepadan — tampilan kartu akan bergeser.`);
  }
  if (!/daftarWasteDibatalkan\(/.test(page)) {
    salah(`${PAGE}: kejadian yang dibatalkan tidak ditampilkan di mana pun.`);
  }
}

const svc = bacaKode(SVC);
if (svc) {
  for (const fn of ['revisiWaste', 'batalkanWaste', 'pulihkanWaste', 'daftarWasteDibatalkan']) {
    if (!new RegExp(`export async function ${fn}\\(`).test(svc)) salah(`${SVC}: \`${fn}\` tidak ada.`);
  }
  // `argumenRpc`: PostgREST memilih overload lewat HIMPUNAN NAMA ARGUMEN, dan
  // `JSON.stringify` membuang kunci bernilai `undefined` — kuncinya hilang,
  // fungsinya tidak ketemu, dan galatnya 42883 yang tidak berarti apa-apa.
  const potong = svc.slice(svc.indexOf('export async function revisiWaste('));
  if (!/argumenRpc\(/.test(potong.slice(0, 900))) {
    salah(`${SVC}: \`revisiWaste\` tidak memakai \`argumenRpc\` — argumen bernilai undefined akan hilang dari permintaannya.`);
  }
}

// ============ YANG DIBATALKAN TIDAK IKUT KE ESB ============
//
// Stoknya sudah dikembalikan di sini; ikut terekspor, ia jadi baris di ESB
// untuk kejadian yang sudah dinyatakan tidak pernah terjadi — dan selisihnya
// baru terasa saat stok dua sistem dibandingkan, berbulan-bulan kemudian.
const esb = bacaKode('js/modules/inventory/esb.service.js');
if (esb) {
  const i = esb.indexOf('export async function wasteUntukEsb(');
  const badan = i < 0 ? '' : esb.slice(i, esb.indexOf('\nexport ', i + 10));
  if (!badan) salah('js/modules/inventory/esb.service.js: `wasteUntukEsb` tidak ditemukan.');
  else if (!/filter\(\(w\) => !w\.dibatalkan_at\)/.test(badan)) {
    salah('js/modules/inventory/esb.service.js: ekspor ESB masih mengangkut kejadian yang sudah dibatalkan.');
  } else if (!/dibatalkan_at/.test(badan.slice(badan.indexOf('catch')))) {
    salah('js/modules/inventory/esb.service.js: saringan itu tidak punya jalan mundur kalau 0181 belum dijalankan — seluruh layar ekspor akan kosong.');
  }
}

const lap = bacaKode(LAPORAN);
if (lap && (!/sumberId:/.test(lap) || !/outletId:/.test(lap))) {
  salah(`${LAPORAN}: meta tidak membawa \`sumberId\`/\`outletId\` — dialog revisi tidak punya keadaan sekarang untuk diisi.`);
}

console.log('');
if (gagal === 0) console.log('Audit revisi waste bersih. ✅');
else console.error(`${gagal} masalah ditemukan.`);
process.exit(gagal === 0 ? 0 : 1);
