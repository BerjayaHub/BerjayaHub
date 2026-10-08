/**
 * 0157 — KETERANGAN BARIS SURAT JALAN BISA DIKOSONGKAN (PGlite).
 *
 * ============ SATU PERBEDAAN YANG MENENTUKAN SEGALANYA ============
 *
 *     kunci `keterangan` TIDAK ADA   -> pertahankan nilai lama
 *     kunci ADA tapi isinya kosong   -> orangnya sengaja menghapusnya
 *
 * `0132` menyatukan keduanya lewat `nullif(btrim(...), '')`, dan itu benar
 * selama tidak ada layar yang bisa mengosongkannya. Begitu kotaknya dipasang
 * di layar draft, staff yang menghapus keterangan salah ketik akan melihatnya
 * MUNCUL KEMBALI sesudah menyimpan — tanpa galat, berkali-kali.
 *
 *   §1 Keterangan yang dikirim tersimpan.
 *   §2 INTI: kunci ADA tapi kosong -> benar-benar terhapus.
 *   §3 INTI: kunci TIDAK ADA -> nilai lama bertahan (PWA lama di HP staff).
 *   §4 `ordered_qty` tetap berperilaku seperti 0132.
 *   §5 Penjaga lama tidak ikut longgar.
 */
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

let gagal = 0;
let n = 0;
const cek = (nama, dapat, harap) => {
  n++;
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};
const benar = (nama, syarat, ket = '') => {
  n++;
  if (!syarat) {
    gagal++;
    console.error(`❌ ${nama}${ket ? ' — ' + ket : ''}`);
  }
};

const db = new PGlite();
const q = (sql, params) => db.query(sql, params);
const satu = async (sql, params) => (await q(sql, params)).rows[0];
const galat = async (fn) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return e.message ?? String(e);
  }
};

// Skema seadanya — hanya yang disentuh `ubah_draft_kiriman`.
await db.exec(`
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;

  create table products (id uuid primary key default gen_random_uuid(), name text);
  create table dispatches (id uuid primary key default gen_random_uuid(), notes text, status text default 'draft');
  create table dispatch_items (
    id uuid primary key default gen_random_uuid(),
    dispatch_id uuid references dispatches(id) on delete cascade,
    product_id uuid references products(id),
    sent_qty numeric not null,
    keterangan text,
    ordered_qty numeric
  );

  -- Penjaga wewenangnya diuji di tempat lain (0103); di sini ia dibuat selalu
  -- mengizinkan supaya yang diuji benar-benar aturan keterangannya.
  create or replace function boleh_kelola_draft(p uuid) returns boolean language sql stable as $$ select true; $$;
`);

const sql = fs.readFileSync(path.join(AKAR, 'supabase/migrations/0157_keterangan_draft_bisa_dikosongkan.sql'), 'utf8');
await db.exec(sql.replace(/notify pgrst[^;]*;/g, '').replace(/^revoke all[^;]*;$/gm, '').replace(/^grant execute[^;]*;$/gm, ''));
console.log('  0157 terpasang.');

const SJ = (await satu(`insert into dispatches (notes) values ('awal') returning id`)).id;
const BERAS = (await satu(`insert into products (name) values ('Beras') returning id`)).id;
const GULA = (await satu(`insert into products (name) values ('Gula') returning id`)).id;

await q(
  `insert into dispatch_items (dispatch_id, product_id, sent_qty, keterangan, ordered_qty)
   values ($1,$2,10,'stok CK habis',20), ($1,$3,5,'dikirim lewat ojol',5)`,
  [SJ, BERAS, GULA]
);

const ubah = (items, notes = 'catatan') => q(`select ubah_draft_kiriman($1, $2::jsonb, $3)`, [SJ, JSON.stringify(items), notes]);
const ket = async (pid) => (await satu(`select keterangan from dispatch_items where dispatch_id=$1 and product_id=$2`, [SJ, pid])).keterangan;
const ord = async (pid) => (await satu(`select ordered_qty from dispatch_items where dispatch_id=$1 and product_id=$2`, [SJ, pid])).ordered_qty;

// =====================================================================
// §1 YANG DIKIRIM TERSIMPAN
// =====================================================================
console.log('\n§1 Keterangan yang dikirim');

await ubah([
  { product_id: BERAS, qty: 10, keterangan: 'diganti jadi ini' },
  { product_id: GULA, qty: 5, keterangan: 'dikirim lewat ojol' }
]);
cek('1. keterangan baru tersimpan', await ket(BERAS), 'diganti jadi ini');

await ubah([
  { product_id: BERAS, qty: 10, keterangan: '   spasi dirapikan   ' },
  { product_id: GULA, qty: 5, keterangan: 'dikirim lewat ojol' }
]);
cek('1. spasi di ujung dibuang', await ket(BERAS), 'spasi dirapikan');

// =====================================================================
// §2 KUNCI ADA TAPI KOSONG -> TERHAPUS
//
// Inilah seluruh alasan berkas 0157 ada.
// =====================================================================
console.log('\n§2 Sengaja dikosongkan');

await ubah([
  { product_id: BERAS, qty: 10, keterangan: '' },
  { product_id: GULA, qty: 5, keterangan: 'dikirim lewat ojol' }
]);
cek('2. INTI: keterangan yang dikosongkan benar-benar terhapus', await ket(BERAS), null);

// Diulang: kalau penjaganya salah, nilainya akan "pulih" dari salinan lama
// pada penyimpanan BERIKUTNYA, bukan pada yang pertama.
await ubah([
  { product_id: BERAS, qty: 10, keterangan: '' },
  { product_id: GULA, qty: 5, keterangan: 'dikirim lewat ojol' }
]);
cek('2. dan tetap kosong pada penyimpanan berikutnya', await ket(BERAS), null);

await ubah([
  { product_id: BERAS, qty: 10, keterangan: '    ' },
  { product_id: GULA, qty: 5, keterangan: 'dikirim lewat ojol' }
]);
cek('2. spasi saja juga dianggap kosong', await ket(BERAS), null);

// Baris LAIN tidak ikut terhapus.
cek('2. baris lain tidak ikut terpengaruh', await ket(GULA), 'dikirim lewat ojol');

// =====================================================================
// §3 KUNCI TIDAK ADA -> NILAI LAMA BERTAHAN
//
// Ini perlindungan untuk PWA lama di HP staff yang belum mengenal kolomnya.
// =====================================================================
console.log('\n§3 PWA lama');

await ubah([
  { product_id: BERAS, qty: 10, keterangan: 'diisi ulang' },
  { product_id: GULA, qty: 5, keterangan: 'dikirim lewat ojol' }
]);
cek('3. (persiapan) keterangan terisi lagi', await ket(BERAS), 'diisi ulang');

// Persis bentuk yang dikirim PWA lama: hanya product_id & qty.
await ubah([
  { product_id: BERAS, qty: 12 },
  { product_id: GULA, qty: 6 }
]);
cek('3. INTI: kunci yang TIDAK ADA mempertahankan keterangan lama', await ket(BERAS), 'diisi ulang');
cek('3. baris kedua juga selamat', await ket(GULA), 'dikirim lewat ojol');
cek('3. jumlahnya tetap berubah', Number((await satu(`select sent_qty from dispatch_items where dispatch_id=$1 and product_id=$2`, [SJ, BERAS])).sent_qty), 12);

// ============ DUA-DUANYA DALAM SATU PERMINTAAN ============
//
// Bentuk yang paling mungkin salah: satu baris sengaja dikosongkan, baris
// lain tidak disentuh sama sekali.
await ubah([
  { product_id: BERAS, qty: 12, keterangan: '' },
  { product_id: GULA, qty: 6 }
]);
cek('3. INTI: yang dikosongkan terhapus…', await ket(BERAS), null);
cek('3. INTI: …sementara yang tidak dikirim tetap bertahan', await ket(GULA), 'dikirim lewat ojol');

// =====================================================================
// §4 `ordered_qty` TIDAK IKUT BERUBAH PERILAKUNYA
// =====================================================================
console.log('\n§4 ordered_qty');

cek('4. ordered_qty bertahan walau tidak pernah dikirim ulang', Number(await ord(BERAS)), 20);
await ubah([
  { product_id: BERAS, qty: 12, ordered_qty: 30 },
  { product_id: GULA, qty: 6 }
]);
cek('4. dan tetap bisa diperbarui kalau dikirim', Number(await ord(BERAS)), 30);

// =====================================================================
// §5 PENJAGA LAMA TIDAK IKUT LONGGAR
// =====================================================================
console.log('\n§5 Penjaga lama');

const kosong = await galat(() => ubah([]));
benar('5. draft kosong tetap ditolak', /tidak boleh kosong/i.test(kosong ?? ''), kosong);

const semuaNol = await galat(() => ubah([{ product_id: BERAS, qty: 0 }, { product_id: GULA, qty: 0 }]));
benar('5. seluruh baris nol tetap ditolak', /jumlah kirimnya 0/i.test(semuaNol ?? ''), semuaNol);

// Penolakan membatalkan `delete` di awal — isinya harus utuh.
cek('5. INTI: penolakan tidak menyisakan draft yang terlanjur dikosongkan', Number((await satu(`select count(*) n from dispatch_items where dispatch_id=$1`, [SJ])).n), 2);

// Baris ber-qty NOL tetap tersimpan (0132) selama ada yang positif.
await ubah([
  { product_id: BERAS, qty: 0, keterangan: 'stok CK habis' },
  { product_id: GULA, qty: 6 }
]);
cek('5. baris "dikirim 0" tetap tersimpan beserta keterangannya', await ket(BERAS), 'stok CK habis');
cek('5. dan catatan surat jalannya ikut tersimpan', (await satu(`select notes from dispatches where id=$1`, [SJ])).notes, 'catatan');

// =====================================================================
// §6 DIJALANKAN ULANG
// =====================================================================
console.log('\n§6 Dijalankan ulang');

await db.exec(sql.replace(/notify pgrst[^;]*;/g, '').replace(/^revoke all[^;]*;$/gm, '').replace(/^grant execute[^;]*;$/gm, ''));
benar(
  '6. aman dijalankan dua kali',
  Number((await satu(`select count(*) n from pg_proc where proname = 'ubah_draft_kiriman'`)).n) === 1
);

console.log('');
if (gagal === 0) console.log(`${n} pemeriksaan 0157 lolos. ✅`);
else console.error(`${gagal} dari ${n} pemeriksaan GAGAL.`);
process.exit(gagal === 0 ? 0 : 1);
