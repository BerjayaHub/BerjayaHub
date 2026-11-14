/**
 * AUDIT: master satuan untuk admin BU & admin outlet (0183).
 *
 * ============ DUA ARAH YANG SAMA-SAMA SALAH ============
 *
 * Terlalu ketat  -> admin BU tidak bisa menambah satuan, dan satu-satunya
 *                   jalan adalah menunggu super admin. Itu keadaan sebelum
 *                   0183, dan ia tidak memunculkan galat yang menjelaskan
 *                   apa pun — cuma "gagal menambah".
 *
 * Terlalu longgar-> daftar ini dipakai SEMUA BU. "Kg", "kg", "KG" dan "kg "
 *                   hidup berdampingan di dropdown setiap BU, dan satu
 *                   penghapusan mencabut 'gram' dari seluruh perusahaan.
 *
 * Yang dijaga berkas ini: jalan masuknya tetap satu (RPC yang merapikan nama),
 * dan aturan menghapus tidak ikut dilonggarkan bersama aturan menambah.
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

const MIG = 'supabase/migrations/0183_master_satuan_untuk_admin.sql';
const SVC = 'js/modules/product/product.service.js';
const PAGE = 'js/modules/product/product.admin.page.js';
const TES = 'tools/test-migrasi-0183.mjs';

const mentah = baca(MIG);
const sql = mentah ? tanpaKomentarSql(mentah) : null;
const fungsi = (nama) => {
  if (!sql) return '';
  const i = sql.indexOf(`create or replace function ${nama}(`);
  return i < 0 ? '' : sql.slice(i, sql.indexOf('\n$$;', i));
};

if (sql) {
  const adm = fungsi('adalah_admin');
  if (!adm) salah(`${MIG}: \`adalah_admin\` tidak ada.`);
  else if (!/'super_admin', 'bu_admin', 'outlet_admin'/.test(adm)) {
    salah(`${MIG}: \`adalah_admin\` tidak mencakup ketiga peran admin — admin outlet akan tetap ditolak.`);
  }

  const tambah = fungsi('tambah_satuan');
  if (!tambah) {
    salah(`${MIG}: \`tambah_satuan\` tidak ada.`);
  } else {
    if (!/adalah_admin\(v_uid\)/.test(tambah)) {
      salah(`${MIG}: \`tambah_satuan\` tidak memeriksa wewenang sama sekali — staff ikut bisa menambah.`);
    }
    // Nama dirapikan SEBELUM dibandingkan & disimpan. Tanpa ini, "kg " dan
    // "kg" jadi dua baris — `unique(name)` di 0019 tidak melihat bedanya.
    if (!/regexp_replace\(btrim\(coalesce\(p_nama, ''\)\), '\\s\+', ' ', 'g'\)/.test(tambah)) {
      salah(`${MIG}: nama satuan tidak dirapikan — spasi tepi & spasi ganda akan membuat baris kembar.`);
    }
    // Yang sudah ada dikembalikan, BUKAN ditolak: penolakan membuat orang
    // mengetik variasi lain sampai lolos, dan itu cara daftar ini jadi
    // berantakan.
    if (!/lower\(btrim\(name\)\) = lower\(v_nama\)/.test(tambah)) {
      salah(`${MIG}: duplikat tidak diperiksa tanpa peduli huruf besar-kecil — "Gram" akan jadi baris kedua di samping "gram".`);
    }
    if (!/'baru', false/.test(tambah)) {
      salah(`${MIG}: satuan yang sudah ada tidak dibedakan dari yang baru — layar akan bilang "ditambahkan" untuk yang sudah lama ada.`);
    }
    if (!/created_by/.test(tambah)) {
      salah(`${MIG}: pembuatnya tidak dicatat — tidak ada cara membedakan satuan bawaan dari buatan orang.`);
    }
  }

  // ============ MENGHAPUS TIDAK IKUT DILONGGARKAN ============
  const hapus = fungsi('hapus_satuan');
  if (!hapus) {
    salah(`${MIG}: \`hapus_satuan\` tidak ada.`);
  } else {
    if (!/is_super_admin\(v_uid\)/.test(hapus)) {
      salah(`${MIG}: \`hapus_satuan\` tidak membedakan super admin — satu salah tekan bisa mencabut 'gram' dari seluruh perusahaan.`);
    }
    if (!/v_unit\.created_by is distinct from v_uid/.test(hapus)) {
      salah(`${MIG}: admin bisa menghapus satuan buatan orang lain (termasuk satuan bawaan).`);
    }
    // Produk menyimpan satuannya sebagai TEKS; menghapus satuannya tidak
    // merusak barisnya, tapi membuatnya tidak bisa dipilih lagi saat disunting.
    if (!/from products/.test(hapus) || !/base_unit/.test(hapus) || !/purchase_unit/.test(hapus)) {
      salah(`${MIG}: pemakaian satuan oleh produk tidak diperiksa (base_unit DAN purchase_unit).`);
    }
  }

  // ============ JALAN MASUK LANGSUNG TETAP TERTUTUP ============
  //
  // Policy `insert` yang ikut dilonggarkan akan melewati seluruh perapian di
  // atas — dan yang memakainya adalah PWA lama, yang justru tidak tahu aturan
  // barunya.
  if (/create policy units_insert|for insert[\s\S]{0,80}adalah_admin/.test(sql)) {
    salah(`${MIG}: policy tulis langsung ikut dibuka — RPC-nya jadi bisa dilewati, beserta perapian namanya.`);
  }

  if (!fs.existsSync(path.join(AKAR, TES))) salah(`${TES} tidak ada — aturannya tidak pernah dijalankan.`);
}

// =====================================================================
// Klien
// =====================================================================
const svc = bacaKode(SVC, ['createUnit', 'listUnits']);
if (svc) {
  const potong = (nama) => {
    const i = svc.indexOf(`export async function ${nama}(`);
    return i < 0 ? '' : svc.slice(i, svc.indexOf('\n}', i));
  };
  const buat = potong('createUnit');
  const hapus = potong('deleteUnit');
  if (!/rpc\('tambah_satuan'/.test(buat)) {
    salah(`${SVC}: \`createUnit\` masih menulis langsung ke tabel — admin BU akan ditolak RLS tanpa penjelasan.`);
  }
  // ============ KENAPA DELETE JUGA HARUS LEWAT RPC ============
  //
  // Penolakan RLS pada DELETE tidak melempar galat: ia membalas sukses dengan
  // NOL baris. Layarnya lalu berkata "Satuan dihapus" kepada orang yang
  // sebenarnya ditolak.
  if (!/rpc\('hapus_satuan'/.test(hapus)) {
    salah(`${SVC}: \`deleteUnit\` masih memakai \`.delete()\` — penolakan RLS akan terbaca sebagai berhasil.`);
  }
}

const page = bacaKode(PAGE, ['renderUnitsTab', 'createUnit']);
if (page) {
  // Kalimat lama ("Hanya Super Admin yang bisa ubah daftar ini") sekarang
  // salah, dan keterangan yang salah membuat admin tidak pernah mencoba.
  if (/Hanya Super Admin yang bisa ubah daftar ini/.test(page)) {
    salah(`${PAGE}: keterangan di tab Satuan masih berkata hanya Super Admin yang bisa — sejak 0183 itu tidak benar.`);
  }
  // Dicari KALIMATNYA, bukan cuma syaratnya: `hasil?.baru === false` juga
  // muncul sebagai penentu warna toast, jadi memeriksa syaratnya saja membuat
  // audit ini tetap hijau walau pesannya sudah diratakan jadi "ditambahkan".
  if (!/sudah ada di daftar/.test(page)) {
    salah(`${PAGE}: "sudah ada" tidak dibedakan dari "ditambahkan" — layar akan mengaku menambah sesuatu yang sudah lama ada.`);
  }
}

console.log('');
if (gagal === 0) console.log('Audit master satuan bersih. ✅');
else console.error(`${gagal} masalah ditemukan.`);
process.exit(gagal === 0 ? 0 : 1);
