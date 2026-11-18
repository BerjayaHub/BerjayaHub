/**
 * AUDIT: `on conflict do update` pada tabel yang dijaga trigger BEFORE INSERT.
 *
 * ============ JEBAKAN YANG BARU SAJA MEMAKAN KORBAN ============
 *
 * Di Postgres, trigger BEFORE INSERT berjalan **sebelum** bentrokan unik
 * diperiksa. Jadi pada tabel yang punya trigger "tolak baris kembar",
 *
 *     insert into ... values (...) on conflict (...) do update set ...
 *
 * TIDAK PERNAH sampai ke `do update`: triggernya melempar lebih dulu, setiap
 * kali barisnya memang sudah ada — yaitu persis keadaan yang `on conflict`
 * ditulis untuk menanganinya.
 *
 * Itu yang terjadi pada `ubah_draft_order` (0145) di atas trigger 0129:
 * mengubah jumlah barang yang sudah ada di draft SELALU gagal, dengan kalimat
 * yang menuduh staffnya menambah baris baru. Yang cuma MENAMBAH barang baru
 * tidak pernah mengalaminya — itu sebabnya ia bertahan lama tanpa dilaporkan.
 *
 * ============ YANG DIPERIKSA: DEFINISI TERAKHIR, BUKAN SEJARAHNYA ============
 *
 * Migration bersifat tambah-terus: 0145 akan selamanya memuat baris `on
 * conflict` itu, dan audit yang membaca semua berkas akan merah selamanya.
 * Jadi tiap fungsi diambil definisi TERAKHIRNYA (berkas bernomor paling
 * besar), dan hanya itu yang diadili — persis seperti yang berlaku di database.
 */
const fs = require('fs');
const path = require('path');

const AKAR = path.dirname(__dirname);
const DIR = path.join(AKAR, 'supabase/migrations');
let gagal = 0;
const salah = (pesan) => {
  gagal++;
  console.error(`❌ ${pesan}`);
};

const tanpaKomentarSql = (sql) =>
  sql
    .split('\n')
    .map((b) => (b.trim().startsWith('--') ? '' : b))
    .join('\n');

const berkas = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

// ---------------------------------------------------------
// 1. Tabel mana yang dijaga trigger BEFORE INSERT?
//
// Dicari dari migrationnya sendiri, bukan didaftar tangan: daftar tangan akan
// ketinggalan pada trigger berikutnya, dan ketinggalannya tidak terlihat
// sampai ada yang mengeluh.
// ---------------------------------------------------------
const dijaga = new Map(); // tabel -> nama trigger
for (const f of berkas) {
  const sql = tanpaKomentarSql(fs.readFileSync(path.join(DIR, f), 'utf8'));
  const re = /create trigger (\w+)\s+before insert[^;]*?on (\w+)/gi;
  let m;
  while ((m = re.exec(sql))) dijaga.set(m[2], m[1]);
}

if (!dijaga.size) {
  salah('Tidak ada satu pun trigger BEFORE INSERT yang terbaca — audit ini kehilangan sasarannya.');
}

// ---------------------------------------------------------
// 2. Definisi TERAKHIR tiap fungsi.
// ---------------------------------------------------------
const terakhir = new Map(); // nama fungsi -> { file, badan }
for (const f of berkas) {
  const sql = tanpaKomentarSql(fs.readFileSync(path.join(DIR, f), 'utf8'));
  const re = /create or replace function (\w+)\s*\(/gi;
  let m;
  while ((m = re.exec(sql))) {
    const mulai = m.index;
    const akhir = sql.indexOf('\n$$;', mulai);
    if (akhir < 0) continue;
    terakhir.set(m[1], { file: f, badan: sql.slice(mulai, akhir) });
  }
}

// ---------------------------------------------------------
// 3. Adakah yang masih meng-upsert ke tabel terjaga?
// ---------------------------------------------------------
let diperiksa = 0;
for (const [nama, { file, badan }] of terakhir) {
  for (const [tabel, trigger] of dijaga) {
    // `insert into <tabel>` ... `on conflict` dalam satu perintah: dibatasi
    // sampai titik koma supaya `insert` ke tabel lain di bawahnya tidak
    // ikut tertuduh.
    const re = new RegExp(`insert\\s+into\\s+${tabel}\\b[^;]*?on\\s+conflict[^;]*?do\\s+update`, 'is');
    diperiksa++;
    if (re.test(badan)) {
      salah(
        `${file} \`${nama}\`: \`on conflict do update\` ke \`${tabel}\`, yang dijaga trigger BEFORE INSERT ` +
          `\`${trigger}\`. Triggernya berjalan LEBIH DULU, jadi \`do update\` tidak pernah kebagian giliran — ` +
          'setiap penyimpanan baris yang sudah ada akan ditolak. Pakai `update ... if not found then insert`.'
      );
    }
  }
}

// ---------------------------------------------------------
// 4. Yang khusus 0184: perbaikannya memang berbentuk ubah-dulu.
// ---------------------------------------------------------
const draft = terakhir.get('ubah_draft_order');
if (!draft) {
  salah('`ubah_draft_order` tidak ditemukan di satu pun migration.');
} else {
  if (!/update stock_order_items\s+set qty = v_qty\s+where order_id = p_order and product_id = v_pid;/.test(draft.badan)) {
    salah(`${draft.file} \`ubah_draft_order\`: baris yang sudah ada tidak diubah lewat \`update\` — mengubah jumlah akan ditolak lagi.`);
  }
  if (!/if not found then/.test(draft.badan)) {
    salah(`${draft.file} \`ubah_draft_order\`: tidak ada \`if not found then insert\` — barang BARU tidak akan pernah masuk.`);
  }
  // Penjagaan lain dari 0145 tidak boleh ikut hilang saat fungsinya ditulis
  // ulang (pelajaran 0179).
  for (const [pola, apa] of [
    ['has_outlet_scope\\(v_uid, v_o.from_outlet_id\\)', 'wewenang outlet asal'],
    ["v_o.status = 'open'", 'penolakan order yang sudah dikirim'],
    ["v_o.status <> 'draft'", 'penolakan order yang sudah diproses'],
    ['coalesce\\(p_notes, notes\\)', 'catatan yang tidak ikut terhapus'],
    ['delete from stock_order_items', 'penghapusan baris yang diminta']
  ]) {
    if (!new RegExp(pola).test(draft.badan)) {
      salah(`${draft.file} \`ubah_draft_order\`: ${apa} hilang saat fungsinya ditulis ulang.`);
    }
  }
}

// Triggernya sendiri TIDAK boleh ikut dilonggarkan — ia yang menahan baris
// kembar sungguhan dari enam penulis yang berbeda (0129).
const tolak = terakhir.get('tolak_bahan_kembar_order');
if (!tolak) salah('`tolak_bahan_kembar_order` hilang — baris kembar sungguhan tidak ada yang menahan.');
else if (!/raise exception/.test(tolak.badan)) {
  salah(`${tolak.file} \`tolak_bahan_kembar_order\`: tidak lagi menolak apa pun.`);
}

console.log('');
if (gagal === 0) {
  console.log(`Audit upsert vs trigger bersih — ${dijaga.size} tabel terjaga, ${terakhir.size} fungsi diperiksa. ✅`);
} else console.error(`${gagal} masalah ditemukan.`);
process.exit(gagal === 0 ? 0 : 1);
