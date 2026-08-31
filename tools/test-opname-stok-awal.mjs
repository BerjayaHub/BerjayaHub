/**
 * OPNAME: KAPAN PERSISNYA STOK BERUBAH? (PGlite — Postgres sungguhan)
 *
 * ============ PERTANYAAN YANG DIJAWAB ============
 *
 *   "apakah bila sesi belum ditutup stok tidak akan bertambah? kalau memang
 *    begitu sudah benar, karena saat staff isi stock opname dan klik simpan
 *    hasil opname, stock masih 0 — fyi ini kita baru isi stok awal"
 *
 * Jawabannya YA, dan itu memang rancangannya. Tapi "memang begitu rancangannya"
 * adalah kalimat yang sama persis dengan yang diucapkan orang tepat sebelum
 * menemukan bug — jadi di sini dijalankan sungguhan, bukan dibaca.
 *
 * Yang diperiksa BUKAN nilai kembalian fungsinya, melainkan SALDO di
 * `stock_balances` — view yang sama yang dibaca layar Inventory. Fungsi yang
 * mengembalikan "3 bahan disesuaikan" sambil tidak menulis apa pun akan lolos
 * dari pemeriksaan nilai kembalian, dan itu justru bentuk kegagalan yang paling
 * meyakinkan di layar.
 *
 * ============ KENAPA "STOK AWAL" DIUJI TERSENDIRI ============
 *
 * Opname pertama sebuah outlet punya bentuk yang khas: sistem 0, fisik sekian.
 * Penyesuaiannya `dihitung − sistem` = seluruh angkanya. Kalau di suatu tempat
 * ada penjaga yang melewati baris "yang sistemnya nol" — mis. dianggap produk
 * yang belum pernah dipakai — seluruh pengisian stok awal akan menghasilkan nol
 * pergerakan tanpa satu pun error. Outletnya lalu beroperasi berbulan-bulan
 * dengan stok yang selamanya minus.
 */
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

let gagal = 0;
const cek = (nama, dapat, harap) => {
  const a = typeof dapat === 'number' ? Number(dapat.toFixed(6)) : dapat;
  const b = typeof harap === 'number' ? Number(harap.toFixed(6)) : harap;
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(a)}\n   harap : ${JSON.stringify(b)}`);
  }
};
const benar = (nama, syarat, ket = '') => {
  if (!syarat) {
    gagal++;
    console.error(`❌ ${nama}${ket ? ' — ' + ket : ''}`);
  }
};

const db = new PGlite();
const q = (sql, params) => db.query(sql, params);
const satu = async (sql, params) => (await q(sql, params)).rows[0];
const sebagai = (uid) => q(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
const galat = async (fn) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return e.message ?? String(e);
  }
};

await db.exec(`
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;

  create table business_units (id uuid primary key default gen_random_uuid(), name text);
  create table outlets (id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text);
  create table user_profiles (id uuid primary key, full_name text);
  create table products (id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text, base_unit text default 'gr');
  create table membership_scopes (user_id uuid, business_unit_id uuid, outlet_id uuid, role text);

  create table stock_movements (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, outlet_id uuid, product_id uuid,
    movement_type text, qty_delta numeric, notes text,
    created_by uuid, created_at timestamptz not null default now()
  );

  -- View saldo yang SAMA dengan produksi (0018). Layar Inventory membaca ini,
  -- jadi ini juga yang harus dibuktikan bergerak — bukan tabel mentahnya.
  create view stock_balances as
    select business_unit_id, outlet_id, product_id, sum(qty_delta) as qty
      from stock_movements group by business_unit_id, outlet_id, product_id;

  create role authenticated;

  create or replace function has_bu_scope(p_uid uuid, p_bu uuid) returns boolean language sql stable as $$
    select exists (select 1 from membership_scopes where user_id = p_uid and business_unit_id = p_bu);
  $$;
  create or replace function has_outlet_scope(p_uid uuid, p_outlet uuid) returns boolean language sql stable as $$
    select exists (select 1 from membership_scopes where user_id = p_uid and outlet_id = p_outlet);
  $$;
  create or replace function is_bu_admin(p_uid uuid, p_bu uuid) returns boolean language sql stable as $$
    select exists (select 1 from membership_scopes where user_id = p_uid and business_unit_id = p_bu and role in ('bu_admin','super_admin'));
  $$;
`);

const sql = fs.readFileSync(path.join(AKAR, 'supabase/migrations/0085_opname_bernomor.sql'), 'utf8');
await db.exec(sql.replace(/notify pgrst[^;]*;/g, ''));
console.log('  0085 terpasang.');

// =====================================================================
// DATA
// =====================================================================
const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const OUT = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Serpong') returning id`, [BU])).id;

const STAFF = '11111111-1111-1111-1111-111111111111';
const ADMIN = '22222222-2222-2222-2222-222222222222';
await q(`insert into user_profiles (id, full_name) values ($1,'Staff'),($2,'Admin')`, [STAFF, ADMIN]);
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values
  ($1,$3,$4,'staff'), ($2,$3,$4,'bu_admin')`, [STAFF, ADMIN, BU, OUT]);

const BERAS = (await satu(`insert into products (business_unit_id, name) values ($1,'Beras') returning id`, [BU])).id;
const GULA = (await satu(`insert into products (business_unit_id, name) values ($1,'Gula') returning id`, [BU])).id;
const GAS = (await satu(`insert into products (business_unit_id, name) values ($1,'Gas') returning id`, [BU])).id;

/** Saldo yang DILIHAT layar Inventory. `coalesce` karena view-nya tidak punya baris untuk produk yang belum pernah bergerak. */
const saldo = async (p) =>
  Number((await satu(`select coalesce((select qty from stock_balances where product_id=$1 and outlet_id=$2),0) q`, [p, OUT])).q);

// =====================================================================
// 1. STAFF TIDAK BISA MEMBUKA SESI — itu wewenang Admin BU
// =====================================================================
await sebagai(STAFF);
const tolakBuka = await galat(() => q(`select buka_opname($1,null)`, [OUT]));
benar('1. staff ditolak membuka sesi', /admin bu|super admin/i.test(tolakBuka ?? ''), tolakBuka);

await sebagai(ADMIN);
const SESI = (await satu(`select buka_opname($1,'Pengisian stok awal') s`, [OUT])).s;
benar('1. admin bisa membuka sesi', !!SESI);

// Membuka dua kali mengembalikan sesi yang SAMA, bukan sesi kedua. Dua sesi
// terbuka pada satu outlet berarti dua orang menghitung ke tempat berbeda dan
// yang kedua menimpa hasil yang pertama saat ditutup.
cek('1. buka dua kali = sesi yang sama', (await satu(`select buka_opname($1,null) s`, [OUT])).s, SESI);

// =====================================================================
// 2. STAFF MENGISI — DAN STOK SAMA SEKALI TIDAK BERGERAK
//
// Inti pertanyaannya ada di sini.
// =====================================================================
await sebagai(STAFF);
await q(`select catat_hitungan_opname($1,$2,50,0,null)`, [SESI, BERAS]);   // stok awal: sistem 0
await q(`select catat_hitungan_opname($1,$2,30,0,null)`, [SESI, GULA]);
await q(`select catat_hitungan_opname($1,$2,0,0,null)`, [SESI, GAS]);      // dihitung, ternyata memang 0

cek('2. hitungannya tersimpan', Number((await satu(`select count(*) n from stock_count_items where count_id=$1`, [SESI])).n), 3);
cek('2. BERAS saldonya masih 0', await saldo(BERAS), 0);
cek('2. GULA saldonya masih 0', await saldo(GULA), 0);
cek('2. tidak ada pergerakan stok sama sekali', Number((await satu(`select count(*) n from stock_movements`)).n), 0);

// Diisi ulang (salah hitung) — masih juga tidak bergerak.
await q(`select catat_hitungan_opname($1,$2,55,0,null)`, [SESI, BERAS]);
cek('2. diperbaiki pun stok tetap diam', await saldo(BERAS), 0);
cek('2. angka terakhir yang tersimpan', Number((await satu(`select counted_qty c from stock_count_items where count_id=$1 and product_id=$2`, [SESI, BERAS])).c), 55);

// Staff tidak bisa menutup sesinya sendiri.
const tolakTutup = await galat(() => q(`select tutup_opname($1)`, [SESI]));
benar('2. staff ditolak menutup sesi', /admin bu|super admin/i.test(tolakTutup ?? ''), tolakTutup);
cek('2. penolakan tidak menyisakan pergerakan', Number((await satu(`select count(*) n from stock_movements`)).n), 0);

// =====================================================================
// 3. ADMIN MENUTUP — BARU stok bergerak
// =====================================================================
await sebagai(ADMIN);
const n = Number((await satu(`select tutup_opname($1) n`, [SESI])).n);

// DUA saja yang disesuaikan, bukan tiga: GAS dihitung dan ternyata memang 0,
// jadi tidak ada yang perlu dikoreksi. "Dihitung dan cocok" tetap tersimpan
// sebagai bukti bahwa raknya sudah didatangi — itu beda dari "belum dihitung".
cek('3. dilaporkan 2 bahan disesuaikan', n, 2);
cek('3. BERAS jadi 55', await saldo(BERAS), 55);
cek('3. GULA jadi 30', await saldo(GULA), 30);
cek('3. GAS tetap 0 tanpa pergerakan', await saldo(GAS), 0);
cek('3. GAS memang tidak ditulis pergerakan', Number((await satu(`select count(*) n from stock_movements where product_id=$1`, [GAS])).n), 0);

const gerak = await satu(`select movement_type, notes from stock_movements where product_id=$1`, [BERAS]);
cek('3. tercatat sebagai penyesuaian', gerak.movement_type, 'adjustment');
benar('3. catatannya menyebut nomor opname', /OPN-/.test(gerak.notes ?? ''), gerak.notes);

// Menutup dua kali tidak boleh menggandakan stok. Ini kegagalan yang paling
// mahal di modul ini: tidak ada error, dan angkanya hanya "agak besar".
const tolakUlang = await galat(() => q(`select tutup_opname($1)`, [SESI]));
benar('3. tutup dua kali ditolak', /sudah ditutup/i.test(tolakUlang ?? ''), tolakUlang);
cek('3. stok tidak berlipat', await saldo(BERAS), 55);

// Sesi tertutup tidak bisa diisi lagi.
await sebagai(STAFF);
const tolakIsi = await galat(() => q(`select catat_hitungan_opname($1,$2,999,55,null)`, [SESI, BERAS]));
benar('3. sesi tertutup menolak hitungan baru', /sudah ditutup/i.test(tolakIsi ?? ''), tolakIsi);
cek('3. dan stoknya tidak tersentuh', await saldo(BERAS), 55);

// =====================================================================
// 4. OPNAME KEDUA — selisih, bukan penimpaan
//
// Beras dipakai 15 (jadi 40 menurut sistem), lalu dihitung ternyata 38.
// Penyesuaiannya harus −2, BUKAN "set ke 38". Kalau ditimpa absolut, semua
// pergerakan setelah potret diambil akan terhapus tanpa jejak.
// =====================================================================
await sebagai(ADMIN);
await q(`insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, notes, created_by)
  values ($1,$2,$3,'usage',-15,'pemakaian',$4)`, [BU, OUT, BERAS, ADMIN]);
cek('4. sistem membaca 40', await saldo(BERAS), 40);

const SESI2 = (await satu(`select buka_opname($1,null) s`, [OUT])).s;
benar('4. sesi kedua berbeda dari yang pertama', SESI2 !== SESI);

await sebagai(STAFF);
await q(`select catat_hitungan_opname($1,$2,38,40,null)`, [SESI2, BERAS]);
await sebagai(ADMIN);
await q(`select tutup_opname($1)`, [SESI2]);

cek('4. saldo jadi 38, bukan 78', await saldo(BERAS), 38);
const selisih = Number((await satu(
  `select qty_delta d from stock_movements where product_id=$1 order by created_at desc, id desc limit 1`, [BERAS])).d);
cek('4. yang ditulis adalah SELISIH −2', selisih, -2);

// Riwayatnya bertambah, tidak ditimpa — pergerakan pertama tetap +55.
cek('4. pergerakan pertama tetap utuh', Number((await satu(
  `select qty_delta d from stock_movements where product_id=$1 order by created_at, id limit 1`, [BERAS])).d), 55);

// =====================================================================
// 5. SESI DIBATALKAN — stok tidak disentuh sama sekali
// =====================================================================
const SESI3 = (await satu(`select buka_opname($1,null) s`, [OUT])).s;
await sebagai(STAFF);
await q(`select catat_hitungan_opname($1,$2,999,38,null)`, [SESI3, BERAS]);
await sebagai(ADMIN);

// Alasan wajib: sesi yang dibatalkan tanpa keterangan tidak bisa dibedakan dari
// kelalaian saat dibaca berbulan-bulan kemudian.
const tolakAlasan = await galat(() => q(`select batalkan_opname($1,'   ')`, [SESI3]));
benar('5. pembatalan tanpa alasan ditolak', /alasan/i.test(tolakAlasan ?? ''), tolakAlasan);

await q(`select batalkan_opname($1,'salah hitung, diulang besok')`, [SESI3]);
cek('5. stok tidak bergerak sedikit pun', await saldo(BERAS), 38);
cek('5. hitungannya tetap tersimpan sebagai riwayat',
  Number((await satu(`select count(*) n from stock_count_items where count_id=$1`, [SESI3])).n), 1);

// Yang paling penting: sesi yang dibatalkan MELEPASKAN kuncinya, supaya opname
// berikutnya bisa dimulai. Kalau tidak, satu sesi ngawur mengunci outlet itu
// selamanya.
const SESI4 = (await satu(`select buka_opname($1,null) s`, [OUT])).s;
benar('5. sesi baru bisa dibuka sesudah pembatalan', SESI4 !== SESI3);

if (gagal === 0) {
  console.log('✅ opname: stok TIDAK bergerak sampai sesi ditutup admin; stok awal (sistem 0) tercatat penuh; opname kedua memakai selisih.');
} else {
  console.error(`\n${gagal} pemeriksaan gagal.`);
}
process.exit(gagal === 0 ? 0 : 1);
