/**
 * AUDIT: input manual bengkel, form dokumen, & hapus massal sparepart (0191).
 *
 * ============ EMPAT HAL YANG DIJAGA ============
 *
 * 1. DAFTAR PILIHAN YANG TIDAK TERLIHAT.
 *    `.ss-list` pernah `position: absolute` di dalam `.search-select`. Begitu
 *    kotaknya berada di dalam wadah bergulir, daftar hasilnya terpotong habis
 *    — penyaringannya tetap jalan, hasilnya tetap dihitung, dan yang mengetik
 *    "shell" melihat KOSONG. Satu-satunya kesimpulan yang masuk akal baginya
 *    adalah "pencariannya belum dibuat". Itu betul-betul terjadi, dan itu
 *    sebabnya daftarnya sekarang dipindah ke <body>.
 *
 * 2. NOMOR DOKUMEN MANUAL YANG BERTABRAKAN.
 *    Impor Turboly mengganti isi PO per nomor. Nomor manual tanpa awalan
 *    `MAN/` akan dihapus impor berikutnya — dan tidak ada berkas mana pun
 *    untuk memulihkan bon yang diketik orang.
 *
 * 3. HARGA BELI KOSONG YANG JADI NOL.
 *    Nol adalah harga; kosong berarti belum tahu. Laporan pengeluaran yang
 *    menjumlahkan nol sebagai harga akan diam saja.
 *
 * 4. HAPUS MASSAL TANPA PRATINJAU.
 *    Menghapus 1.900 baris dengan satu tekanan tidak bisa dibatalkan, dan
 *    pada saat menekannya orangnya belum tentu tahu berapa yang kena.
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

const bacaKode = (rel, penanda) => {
  const asli = baca(rel);
  if (!asli) return null;
  const kode = tanpaKomentar(asli);
  const pesan = periksaKewarasan(asli, kode, penanda);
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

const MIG = 'supabase/migrations/0191_pembelian_manual_dan_hapus_massal.sql';
const UI = 'js/core/ui.js';
const CSS = 'css/styles.css';
const MURNI = 'js/modules/bengkel/baris-pembelian-manual.js';
const PAGE = 'js/modules/bengkel/penjualan-rinci.admin.page.js';
const SVC = 'js/modules/bengkel/penjualan-rinci.service.js';
const SPPAGE = 'js/modules/sparepart/sparepart.admin.page.js';
const SPSVC = 'js/modules/sparepart/sparepart.service.js';

for (const t of ['tools/test-migrasi-0191.mjs', 'tools/test-baris-pembelian-manual.mjs']) {
  if (!fs.existsSync(path.join(AKAR, t))) salah(`${t} tidak ada — aturannya tidak pernah dijalankan.`);
}

// =====================================================================
// 1. DAFTAR PILIHAN MENGAMBANG
// =====================================================================
const ui = bacaKode(UI, ['wireSearchSelect', 'fuzzyMatch']);
if (ui) {
  const i = ui.indexOf('export function wireSearchSelect(');
  const f = i < 0 ? '' : ui.slice(i, ui.indexOf('\nexport ', i + 10));
  if (!f) salah(`${UI}: \`wireSearchSelect\` tidak terbaca.`);
  // Dipindah ke <body>: `position: fixed` saja tidak cukup, karena
  // `.modal-card` ber-transform menjadi containing block dan wadah yang
  // memotong tetap berada di antaranya.
  if (!/document\.body\.appendChild\(list\)/.test(f)) {
    salah(`${UI}: daftar pilihan tidak dipindah ke <body> saat terbuka — di dalam wadah bergulir ia terpotong habis, dan pencariannya terlihat seperti tidak ada sama sekali.`);
  }
  if (!/list\.classList\.add\('ss-floating'\)/.test(f)) {
    salah(`${UI}: daftar yang mengambang tidak ditandai \`ss-floating\` — tanpa kelas itu ia kehilangan posisinya dan muncul di pojok halaman.`);
  }
  // Dikembalikan saat ditutup: daftar yang tertinggal di <body> akan menempel
  // di atas isi layar lain setelah dialognya hilang.
  if (!/widget\.appendChild\(list\)/.test(f)) {
    salah(`${UI}: daftar tidak dikembalikan ke kotaknya saat ditutup — ia akan tertinggal menempel di atas layar lain.`);
  }
  if (!/fuzzyMatch\(input\.value, o\.label\)/.test(ui)) {
    salah(`${UI}: penyaringan tidak lagi memakai \`fuzzyMatch\` — mengetik "shell" berhenti memunculkan semua yang bernama shell.`);
  }
  // Layar yang digulir saat daftarnya terbuka membuatnya tertinggal di tempat
  // lamanya, menunjuk kotak yang sudah pindah.
  if (!/addEventListener\('scroll'/.test(f)) {
    salah(`${UI}: daftar mengambang tidak ikut saat layar digulir — ia tertinggal di tempat lamanya, menempel di atas isi lain.`);
  }
}

const css = baca(CSS);
if (css) {
  if (!/\.ss-list\.ss-floating\s*\{[^}]*position:\s*fixed/.test(css)) {
    salah(`${CSS}: \`.ss-list.ss-floating\` tidak \`position: fixed\` — begitu dipindah ke <body> ia akan ikut aliran halaman, muncul di bawah segalanya.`);
  }
  // z-index harus DI ATAS dialog, kalau tidak akibatnya persis sama dengan
  // terpotong: pencariannya terlihat tidak ada.
  const zFloat = Number((css.match(/\.ss-list\.ss-floating\s*\{[^}]*z-index:\s*(\d+)/) ?? [])[1] ?? 0);
  const zModal = Number((css.match(/\.modal-overlay\s*\{[^}]*z-index:\s*(\d+)/) ?? [])[1] ?? 0);
  if (!(zFloat > zModal)) {
    salah(`${CSS}: daftar mengambang (z-index ${zFloat}) tidak di atas dialog (${zModal}) — ia tersembunyi di belakangnya, dan akibatnya sama persis dengan terpotong.`);
  }
  // ANGKANYA ikut diperiksa, bukan cuma ada-tidaknya aturan: `max-width:
  // 560px` di bawah nama `modal-dokumen` adalah cara tata letaknya kembali
  // sempit tanpa satu pun kelas yang hilang.
  const lebarDok = css.match(/\.modal-card\.modal-dokumen\s*\{[^}]*max-width:\s*([^;]+);/);
  if (!lebarDok) {
    salah(`${CSS}: lebar \`modal-dokumen\` tidak ada — tabel 8 kolom dipaksa 560px menyisakan ~60px per kolom.`);
  } else {
    const angka = Number((lebarDok[1].match(/(\d+)px/) ?? [])[1] ?? 0);
    if (!/min\(/.test(lebarDok[1]) || angka < 900) {
      salah(`${CSS}: \`modal-dokumen\` tidak melebar di desktop (${lebarDok[1].trim()}) — tabel 8 kolom di lebar itu menyisakan ~60px per kolom, dan angkanya terpotong di layar yang sebenarnya muat.`);
    }
  }
  // Di HP tabelnya jadi kartu: delapan kolom di layar 360px tidak akan pernah
  // terbaca.
  if (!/@media \(max-width: 759px\)[\s\S]{0,400}\.dok-baris-tabel thead \{ display: none/.test(css)) {
    salah(`${CSS}: tabel baris dokumen tidak berubah jadi kartu di layar sempit — di HP ia akan digulir mendatar delapan kolom.`);
  }
}

const page = bacaKode(PAGE, ['dialogKorporat', 'dialogPembelianManual', 'gambarManual']);
if (page) {
  // KEDUA dialog, dihitung: satu yang tertinggal berarti penjualan melebar
  // dan pembelian tidak, dan bedanya cuma terlihat kalau keduanya dibuka
  // berurutan di layar yang sama.
  const jumlahLebar = (page.match(/lebar: 'dokumen'/g) ?? []).length;
  if (jumlahLebar < 2) {
    salah(`${PAGE}: hanya ${jumlahLebar} dari 2 dialog dokumen yang meminta lebar desktop — yang satunya tetap 560px.`);
  }
  // Tabel barisnya TIDAK boleh dibungkus `.table-scroll`: wadah bergulir itu
  // persis yang memotong daftar pilihan sparepart.
  const iTabel = page.indexOf('id="kb-tabel"');
  if (iTabel > 0 && /table-scroll[\s\S]{0,200}id="kb-tabel"/.test(page)) {
    salah(`${PAGE}: tabel baris dibungkus \`.table-scroll\` lagi — itu wadah yang memotong daftar pilihan sparepart.`);
  }
  if (!/dialogPembelianManual/.test(page)) {
    salah(`${PAGE}: dialog pembelian manual tidak ada — jalur manual cuma punya penjualan.`);
  }
  if (!/adminBuSaya \? \[\{ value: '', label: '— Pembelian pusat/.test(page)) {
    salah(`${PAGE}: pilihan "Pembelian pusat" ditawarkan ke semua orang — 0191 menolaknya untuk admin outlet, dan pilihan yang pasti ditolak membuat orangnya membaca penolakan atas daftar yang salah.`);
  }
  // Harga BELI dari master, bukan harga jual. Tertukar, seluruh laporan
  // pengeluaran membengkak sebesar marginnya.
  // PEMANGGILANNYA, bukan cuma impornya: baris `import` tetap menyebut
  // namanya walau pemanggilnya sudah diganti `dariMaster`.
  if (!/const isi = beliDariMaster\(sp\);/.test(page)) {
    salah(`${PAGE}: baris pembelian tidak memakai \`beliDariMaster\` — kalau ia memakai \`dariMaster\`, harga JUAL yang terisi sebagai harga beli.`);
  }
  if (!/ringkasBarisBeli/.test(page) || !/belum berharga/.test(page)) {
    salah(`${PAGE}: baris pembelian tanpa harga tidak disebut di ringkasan — totalnya terlihat lengkap padahal sebagiannya belum diketahui.`);
  }
}

const svc = bacaKode(SVC, ['simpanPembelianManual', 'dokumenPembelianManual']);
if (svc) {
  if (!/rpc\(\s*'simpan_pembelian_manual'/.test(svc)) {
    salah(`${SVC}: pembelian manual tidak lewat RPC.`);
  }
  // Dikelompokkan per nomor DI LAYANAN: daftar yang menampilkan baris satu
  // per satu membuat satu bon berisi sepuluh barang terlihat seperti sepuluh
  // pembelian.
  if (!/peta\.set\(b\.po_no/.test(svc)) {
    salah(`${SVC}: dokumen pembelian manual tidak dikelompokkan per nomor — satu bon berisi sepuluh barang akan terlihat seperti sepuluh pembelian.`);
  }
  if (!/\.eq\('sumber', 'manual'\)/.test(svc)) {
    salah(`${SVC}: daftar pembelian manual tidak menyaring \`sumber\` — seluruh pembelian Turboly ikut tampil di daftar yang tombolnya "Hapus".`);
  }
}

// =====================================================================
// 2–3. MIGRATION
// =====================================================================
const mentah = baca(MIG);
const sql = mentah ? tanpaKomentarSql(mentah) : null;
const fungsi = (nama) => {
  if (!sql) return '';
  const i = sql.indexOf(`function ${nama}(`);
  if (i < 0) return '';
  const j = sql.indexOf('\n$$;', i);
  return sql.slice(i, j < 0 ? undefined : j);
};

if (sql) {
  // ============ BERGANTUNG PADA 0189, DAN MENGATAKANNYA ============
  //
  // PostgreSQL tidak memeriksa isi badan fungsi plpgsql saat dibuat: 0191
  // tanpa 0189 terpasang MULUS, lalu gagal berminggu-minggu kemudian di
  // tangan orang yang mengunggah berkas pembelian — dengan pesan "function
  // outlet_admin_saya(uuid, uuid) does not exist" yang tidak menyebut satu
  // pun kata "migration". Itu betul-betul terjadi.
  if (!/to_regprocedure\('outlet_admin_saya\(uuid, uuid\)'\) is null/.test(sql)) {
    salah(`${MIG}: tidak memeriksa bahwa 0189 sudah dijalankan — tanpa itu migrationnya terpasang mulus dan baru gagal saat ada yang mengimpor pembelian, jauh dari sebabnya.`);
  }
  if (!/Migration 0189 belum dijalankan/.test(sql)) {
    salah(`${MIG}: pesan ketergantungannya tidak menyebut migration mana yang kurang — "function does not exist" memindahkan pekerjaan menebak ke orang yang paling tidak punya bahan untuk menebak.`);
  }

  if (!/check \(sumber in \('turboly', 'manual'\)\)/.test(sql)) {
    salah(`${MIG}: kolom \`sumber\` tidak dibatasi — ejaan bebas masuk lewat jalur mana pun selain layar.`);
  }
  // View harus DIBUANG dulu: Postgres menolak mengganti urutan kolom view yang
  // sudah ada, dan `create or replace` gagal dengan pesan tentang "mengganti
  // nama kolom" yang tidak menyebut sebab sebenarnya.
  if (!/drop view if exists bengkel_pembelian_rinci/.test(sql)) {
    salah(`${MIG}: view tidak dibuang dulu sebelum dibuat ulang — migrationnya akan gagal di database yang sudah punya view versi lama.`);
  }

  const simpan = fungsi('simpan_pembelian_manual');
  if (!simpan) {
    salah(`${MIG}: \`simpan_pembelian_manual\` tidak ada.`);
  } else {
    // Awalan `MAN/` dipaksakan DI SERVER, bukan di layar: layar bukan
    // satu-satunya jalan masuk.
    if (!/v_no := 'MAN\/' \|\| v_no;/.test(simpan)) {
      salah(`${MIG}: nomor yang diketik sendiri tidak diberi awalan \`MAN/\` — nomor yang bertabrakan dengan PO Turboly akan dihapus impor berikutnya, dan tidak ada berkas untuk memulihkannya.`);
    }
    if (!/sudah dipakai/.test(simpan)) {
      salah(`${MIG}: nomor kembar tidak ditolak.`);
    }
    if (!/tidak boleh di masa depan/.test(simpan)) {
      salah(`${MIG}: tanggal maju tidak ditolak.`);
    }
    // Pembelian pusat tidak dimiliki outlet mana pun.
    if (!/hanya bisa dicatat Admin BU/.test(simpan)) {
      salah(`${MIG}: pembelian pusat tidak dibatasi Admin BU.`);
    }
    if (!/is_admin_of_outlet\(v_uid, v_outlet\)/.test(simpan)) {
      salah(`${MIG}: wewenang outlet tidak diperiksa.`);
    }
    // Menyunting membuang isi lamanya SELURUHNYA: disamakan satu per satu,
    // baris yang dihapus orangnya tetap hidup dan nilainya ikut terhitung.
    if (!/delete from bengkel_purchase_lines[\s\S]{0,160}sumber = 'manual'/.test(simpan)) {
      salah(`${MIG}: menyunting tidak membuang baris lamanya — barisnya akan menumpuk, dan nilainya terhitung dua kali.`);
    }
  }

  const impor = fungsi('impor_pembelian_bengkel');
  if (!impor) {
    salah(`${MIG}: \`impor_pembelian_bengkel\` tidak ditulis ulang di sini.`);
  } else {
    if (!/and sumber = 'manual'[\s\S]{0,200}v_lewat_manual/.test(impor)) {
      salah(`${MIG}: impor tidak melewati nomor yang sudah milik dokumen manual — bon yang diketik orang akan terhapus, dan tidak ada berkas untuk memulihkannya.`);
    }
    if (!/'dilewati_manual', to_jsonb\(v_lewat_manual\)/.test(impor)) {
      salah(`${MIG}: nomor yang bertabrakan tidak dilaporkan kembali — yang mengimpor tidak tahu ada bon miliknya yang memegang nomor itu.`);
    }
    // Penggantian hanya menyentuh baris TURBOLY.
    if (!/delete from bengkel_purchase_lines[\s\S]{0,200}sumber = 'turboly'/.test(impor)) {
      salah(`${MIG}: penggantian isi PO tidak dibatasi \`sumber = 'turboly'\`.`);
    }
  }

  const tarik = fungsi('tarik_impor_bengkel');
  if (tarik && !/upper\(btrim\(po_no\)\) = any\(r\.nomor_dokumen\)/.test(tarik)) {
    salah(`${MIG}: penarikan menyeluruh pembelian tidak lagi memakai nomor dokumen.`);
  }
  if (tarik && !/and sumber = 'turboly'\s*\n\s*and upper\(btrim\(po_no\)\)/.test(tarik)) {
    salah(`${MIG}: sapuan \`p_semua\` pada pembelian tidak dibatasi \`sumber = 'turboly'\` — dokumen manual yang nomornya mirip bisa ikut tersapu.`);
  }

  // ---- Hapus massal ----
  const dampak = fungsi('dampak_hapus_sparepart_massal');
  const hapus = fungsi('hapus_sparepart_massal');
  if (!dampak) {
    salah(`${MIG}: \`dampak_hapus_sparepart_massal\` tidak ada — orang akan menghapus 1.900 baris tanpa pernah tahu berapa yang kena.`);
  } else if (/delete from|update spareparts/.test(dampak)) {
    salah(`${MIG}: pratinjau ikut mengubah data — yang memanggilnya sedang memastikan, belum memutuskan.`);
  }
  if (!hapus) {
    salah(`${MIG}: \`hapus_sparepart_massal\` tidak ada.`);
  } else {
    // Fungsinya `security definer`, jadi RLS TIDAK menahannya: saringan BU
    // adalah satu-satunya yang menjaga master BU tetangga.
    if (!/s\.business_unit_id = p_bu and s\.id = any\(p_ids\)/.test(hapus)) {
      salah(`${MIG}: penghapusan massal tidak disaring per BU — daftar id dari layar lain bisa menghapus master BU tetangga, dan RLS tidak menahannya karena fungsinya \`security definer\`.`);
    }
    if (!/bengkel_sale_lines/.test(hapus)) {
      salah(`${MIG}: yang masih dipakai invoice ikut terhapus — invoice lama kehilangan rujukan ke barang yang pernah dijualnya.`);
    }
    if (!/'dilewati_dipakai', v_dipakai/.test(hapus)) {
      salah(`${MIG}: yang dilewati tidak disebut — "20 terhapus" dari 25 yang dipilih tanpa keterangan membuat orangnya mengulang penghapusan yang sama.`);
    }
    if (!/is_bu_admin\(v_uid, p_bu\)/.test(hapus)) {
      salah(`${MIG}: hapus massal tidak dibatasi Admin BU.`);
    }
  }
}

// =====================================================================
// 3. MODUL MURNI PEMBELIAN
// =====================================================================
const murni = bacaKode(MURNI, ['susunBarisBeli', 'beliDariMaster']);
if (murni) {
  const i = murni.indexOf('export function susunBarisBeli(');
  const f = i < 0 ? '' : murni.slice(i, murni.indexOf('\nexport ', i + 10));
  if (!/h === '' \? '' : String\(angkaIsian\(h\)\)/.test(f)) {
    salah(`${MURNI}: harga beli yang dikosongkan tidak tetap kosong — kalau ia jadi 0, laporan pengeluaran membacanya sebagai barang gratis dan diam saja.`);
  }
  const j = murni.indexOf('export function beliDariMaster(');
  const g = j < 0 ? '' : murni.slice(j, murni.indexOf('\nexport ', j + 10));
  if (!/sp\.harga_beli/.test(g) || /sp\.harga_jual/.test(g)) {
    salah(`${MURNI}: \`beliDariMaster\` tidak memakai \`harga_beli\` — tertukar dengan harga jual, seluruh laporan pengeluaran membengkak sebesar marginnya dan angkanya tetap terlihat wajar.`);
  }
}

// =====================================================================
// 4. HAPUS MASSAL DI LAYAR
// =====================================================================
const sppage = bacaKode(SPPAGE, ['hapusMassal', 'renderSparepartAdminPage']);
if (sppage) {
  if (!/dampakHapusMassal\(businessUnitId, ids\)/.test(sppage)) {
    salah(`${SPPAGE}: hapus massal tidak menampilkan pratinjau lebih dulu — tindakan yang tidak bisa dibatalkan ditekan tanpa tahu berapa yang kena.`);
  }
  if (!/danger: true/.test(sppage)) {
    salah(`${SPPAGE}: konfirmasi hapus massal tidak bergaya merusak.`);
  }
  // Pilihan tinggal di `Set`, bukan di DOM: layar ini menggambar ulang seluruh
  // tabel tiap huruf yang diketik di kotak cari.
  if (!/const terpilih = new Set\(\)/.test(sppage)) {
    salah(`${SPPAGE}: pilihan baris tinggal di DOM — satu huruf di kotak cari menggambar ulang tabelnya, dan 30 centang hilang tanpa penjelasan.`);
  }
  // DIHITUNG, bukan dicari sekali: ada DUA tempat yang mencentang (satu baris,
  // dan "pilih semua"), dan definisi fungsinya tetap ada walau salah satu
  // pemanggilnya sudah diganti `gambar()`. Mencarinya sekali membuat yang
  // satunya bisa diam-diam kembali menggambar ulang 500 baris tiap centang.
  const panggilSegarkan = (sppage.match(/segarkanBarMassal\(\);/g) ?? []).length;
  if (panggilSegarkan < 2) {
    salah(`${SPPAGE}: hanya ${panggilSegarkan} dari 2 tempat pencentangan yang menyegarkan bar saja — sisanya menggambar ulang seluruh tabel, dan di 500 baris layarnya tersendat lalu posisi gulirnya melompat ke atas.`);
  }
  if (!/dipakai_invoice/.test(sppage)) {
    salah(`${SPPAGE}: yang dilewati karena dipakai invoice tidak disebut sebelum menekan Hapus.`);
  }
}

const spsvc = bacaKode(SPSVC, ['hapusSparepartMassal', 'imporSparepart']);
if (spsvc) {
  // Penolakan RLS pada DELETE membalas SUKSES dengan nol baris.
  if (!/rpc\('hapus_sparepart_massal'/.test(spsvc)) {
    salah(`${SPSVC}: hapus massal memakai \`.delete()\` langsung — penolakan RLS membalas sukses dengan nol baris, dan layarnya akan mengaku menghapus 25 baris.`);
  }
}

// ---- Impor memperbarui nama ----
//
// Pertanyaan yang ditanyakan langsung: SKU sama, nama sudah diubah di
// Turboly — ikut berubah atau tidak? Harus ikut; master yang menyimpan nama
// lama selamanya justru jadi sumber ketidaksamaan yang baru.
const m167 = baca('supabase/migrations/0167_sparepart_harga_beli_dan_jual.sql');
if (m167) {
  const s167 = tanpaKomentarSql(m167);
  const i = s167.indexOf('function impor_sparepart(');
  const f = i < 0 ? '' : s167.slice(i, s167.indexOf('\n$$;', i));
  if (!/do update\s*\n?\s*set name = excluded\.name/.test(f)) {
    salah(`supabase/migrations/0167_...: impor tidak lagi memperbarui \`name\` saat SKU-nya sudah ada — nama yang sudah dibetulkan di Turboly tidak akan pernah sampai ke sini.`);
  }
}

console.log('');
if (gagal === 0) console.log('Audit input manual & hapus massal bersih. ✅');
else console.error(`${gagal} masalah ditemukan.`);
process.exit(gagal === 0 ? 0 : 1);
