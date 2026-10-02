/**
 * 0155 — REVISI HASIL OPNAME YANG SUDAH DITUTUP (PGlite — Postgres sungguhan).
 *
 *   "setelah stock opname selesai dan ditutup, ada case staff masih salah
 *    input, apakah admin bisa mengubah hasil stock opname ini agar sesuai"
 *
 * ============ YANG SESUNGGUHNYA DIUJI ============
 *
 * Bukan "apakah angkanya berubah". `update stock_count_items set counted_qty`
 * akan lolos pemeriksaan itu sambil tidak menyentuh stok sama sekali.
 *
 * Yang diuji adalah SALDO — dan lebih khusus lagi, saldo PADA TANGGAL opname
 * lewat `saldo_stok_pada` (0137), yaitu angka yang dipakai laporan COGS sebagai
 * stok akhir periode. Koreksi yang bertanggal hari ini akan membuat saldo
 * sekarang benar DAN saldo per tanggal itu tetap salah — dua-duanya terlihat
 * "berhasil" di layar, dan hanya yang kedua yang menjawab permintaannya.
 *
 *   §1 Penjaga: non-admin, sesi open, sesi dibatalkan, sesi bukan-terakhir.
 *   §2 Ubah angka — saldo sekarang DAN saldo per tanggal ikut benar.
 *   §3 `system_qty` tidak dibaca ulang (jebakan ganda-hitung, bentuk bug nanas).
 *   §4 Revisi berantai.
 *   §5 Tambah bahan yang terlewat.
 *   §6 Buang baris salah barang — kembali ke angka SEBELUM opname, bukan nol.
 *   §7 Alasan wajib, dan jejaknya tersimpan.
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
  const a = typeof dapat === 'number' ? Number(dapat.toFixed(6)) : dapat;
  const b = typeof harap === 'number' ? Number(harap.toFixed(6)) : harap;
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(a)}\n   harap : ${JSON.stringify(b)}`);
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
    movement_type text, qty_delta numeric, unit_cost numeric, notes text,
    created_by uuid, created_at timestamptz not null default now()
  );

  create view stock_balances as
    select business_unit_id, outlet_id, product_id, sum(qty_delta) as qty
      from stock_movements group by business_unit_id, outlet_id, product_id;

  create role authenticated;

  create or replace function has_bu_scope(p_uid uuid, p_bu uuid) returns boolean language sql stable as $$
    select exists (select 1 from membership_scopes where user_id = p_uid and business_unit_id = p_bu);
  $$;
  create or replace function has_outlet_scope(p_uid uuid, p_outlet uuid) returns boolean language sql stable as $$
    select exists (
      select 1 from membership_scopes ms join outlets o on o.id = p_outlet
       where ms.user_id = p_uid
         and (ms.role in ('super_admin') or (ms.business_unit_id = o.business_unit_id and ms.role = 'bu_admin') or ms.outlet_id = p_outlet)
    );
  $$;
  create or replace function is_bu_admin(p_uid uuid, p_bu uuid) returns boolean language sql stable as $$
    select exists (select 1 from membership_scopes where user_id = p_uid and business_unit_id = p_bu and role in ('bu_admin','super_admin'));
  $$;
`);

for (const berkas of [
  '0085_opname_bernomor.sql',
  '0114_opname_stok_sistem_dari_server.sql',
  '0137_saldo_stok_pada_tanggal.sql',
  '0155_revisi_opname.sql'
]) {
  const sql = fs.readFileSync(path.join(AKAR, 'supabase/migrations', berkas), 'utf8');
  // Hanya bagian yang dibutuhkan: 0137 memuat fungsi lain yang menyentuh tabel
  // di luar lingkup tes ini.
  //
  // Dipotong TEPAT sebelum `comment on` — bukan beberapa ratus karakter
  // sesudahnya. Percobaan pertama memakai `+ 200` dan memotong kalimat
  // komentarnya di tengah, yang membuat Postgres melaporkan "unterminated
  // quoted string" pada berkas yang sama sekali tidak salah.
  const potong = berkas.startsWith('0137')
    ? sql.slice(0, sql.indexOf('comment on function saldo_stok_pada'))
    : sql;
  await db.exec(potong.replace(/notify pgrst[^;]*;/g, ''));
}
console.log('  0085 + 0114 + 0137 + 0155 terpasang.');

// =====================================================================
// DATA
// =====================================================================
const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const OUT = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Serpong') returning id`, [BU])).id;
const OUT2 = (await satu(`insert into outlets (business_unit_id, name) values ($1,'CK') returning id`, [BU])).id;

const STAFF = '11111111-1111-1111-1111-111111111111';
const ADMIN = '22222222-2222-2222-2222-222222222222';
await q(`insert into user_profiles (id, full_name) values ($1,'Staff'),($2,'Admin')`, [STAFF, ADMIN]);
await q(
  `insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values ($1,$3,$4,'staff'), ($2,$3,null,'bu_admin')`,
  [STAFF, ADMIN, BU, OUT]
);

const NANAS = (await satu(`insert into products (business_unit_id, name) values ($1,'Nanas') returning id`, [BU])).id;
const GULA = (await satu(`insert into products (business_unit_id, name) values ($1,'Gula') returning id`, [BU])).id;
const BERAS = (await satu(`insert into products (business_unit_id, name) values ($1,'Beras') returning id`, [BU])).id;

const saldo = async (p, o = OUT) =>
  Number((await satu(`select coalesce((select qty from stock_balances where product_id=$1 and outlet_id=$2),0) q`, [p, o])).q);

/** Saldo PADA TANGGAL — inilah yang dibaca laporan COGS sebagai stok akhir. */
const saldoPada = async (p, tgl, o = OUT) =>
  Number(
    (
      await satu(`select coalesce((select qty from saldo_stok_pada($1,$2::date,$3) where product_id=$4),0) q`, [
        BU,
        tgl,
        o,
        p
      ])
    ).q
  );

// Stok awal lewat penerimaan, BERTANGGAL LAMPAU — supaya ada riwayat yang bisa
// dibedakan dari koreksi hari ini.
await sebagai(ADMIN);
await q(
  `insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, created_by, created_at)
   values ($1,$2,$3,'receive',6400,$4,'2026-09-01 10:00+07'),
          ($1,$2,$5,'receive',100,$4,'2026-09-01 10:00+07'),
          ($1,$2,$6,'receive',40,$4,'2026-09-01 10:00+07')`,
  [BU, OUT, NANAS, ADMIN, GULA, BERAS]
);

// =====================================================================
// SESI 1 — ditutup dengan SALAH INPUT: nanas diketik 46.000, bukan 4.600.
// =====================================================================
const SESI = (await satu(`select buka_opname($1,'opname akhir September') s`, [OUT])).s;
await sebagai(STAFF);
await q(`select catat_hitungan_opname($1,$2,46000,null,null)`, [SESI, NANAS]); // SALAH: 10x
await q(`select catat_hitungan_opname($1,$2,100,null,null)`, [SESI, GULA]); // cocok dgn sistem
await sebagai(ADMIN);
await q(`select tutup_opname($1)`, [SESI]);
// Tanggalnya dipaksa ke 30 September supaya "saldo per tanggal" punya arti.
await q(`update stock_counts set count_date='2026-09-30', closed_at='2026-09-30 21:00+07' where id=$1`, [SESI]);
await q(`update stock_movements set created_at='2026-09-30 21:00+07' where count_id=$1`, [SESI]);

cek('0. saldo nanas sesudah opname salah', await saldo(NANAS), 46000);
cek('0. saldo per 30 Sep juga salah', await saldoPada(NANAS, '2026-09-30'), 46000);

// ============ PERGERAKAN SESUDAH OPNAME ============
//
// Inilah yang membuat "baca ulang saja stoknya" jadi jebakan — dan ia harus
// ada untuk BERAS juga, bukan cuma NANAS.
//
// Percobaan pertama tes ini hanya memberi nota pada NANAS. Akibatnya sabotase
// "potret bahan terlewat memakai stok hari ini" LOLOS: BERAS tidak punya satu
// pun pergerakan sesudah penutupan, jadi stok-hari-ini dan
// stok-saat-sesi-ditutup kebetulan angkanya sama, dan membuang batas waktunya
// tidak mengubah apa pun. Pemeriksanya hijau untuk kode yang sudah rusak.
await q(
  `insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, created_by, created_at)
   values ($1,$2,$3,'receive',1000,$4,'2026-10-02 09:00+07'),
          ($1,$2,$5,'receive',25,$4,'2026-10-02 09:00+07')`,
  [BU, OUT, NANAS, ADMIN, BERAS]
);
cek('0. saldo sekarang = 46.000 + 1.000', await saldo(NANAS), 47000);

// =====================================================================
// §1 PENJAGA
// =====================================================================
console.log('\n§1 Penjaga');

await sebagai(STAFF);
const tolakStaff = await galat(() => q(`select revisi_hitungan_opname($1,$2,4600,'salah input')`, [SESI, NANAS]));
benar('1. staff ditolak merevisi', /admin bu|super admin/i.test(tolakStaff ?? ''), tolakStaff);
cek('1. penolakan tidak menyisakan pergerakan', await saldo(NANAS), 47000);

await sebagai(ADMIN);
const tolakKosong = await galat(() => q(`select revisi_hitungan_opname($1,$2,4600,'   ')`, [SESI, NANAS]));
benar('1. alasan wajib', /alasan/i.test(tolakKosong ?? ''), tolakKosong);

// Sesi yang MASIH BERJALAN punya jalannya sendiri, dan ia juga menghalangi
// revisi sesi sebelumnya: potret stoknya akan basi tanpa terlihat.
const SESI_BERJALAN = (await satu(`select buka_opname($1,null) s`, [OUT])).s;
const tolakAdaOpen = await galat(() => q(`select revisi_hitungan_opname($1,$2,4600,'salah input')`, [SESI, NANAS]));
benar('1. INTI: sesi berjalan di outlet itu menghalangi revisi', /sedang berjalan/i.test(tolakAdaOpen ?? ''), tolakAdaOpen);

const tolakOpen = await galat(() => q(`select revisi_hitungan_opname($1,$2,1,'apa saja')`, [SESI_BERJALAN, NANAS]));
benar('1. sesi yang masih berjalan tidak direvisi lewat jalan ini', /masih berjalan|staff app/i.test(tolakOpen ?? ''), tolakOpen);

await q(`select batalkan_opname($1,'tidak dipakai, cuma untuk tes')`, [SESI_BERJALAN]);
const tolakBatal = await galat(() => q(`select revisi_hitungan_opname($1,$2,1,'apa saja')`, [SESI_BERJALAN, NANAS]));
benar('1. sesi dibatalkan tidak bisa direvisi', /dibatalkan/i.test(tolakBatal ?? ''), tolakBatal);
cek('1. seluruh penolakan tidak menggerakkan stok', await saldo(NANAS), 47000);

// =====================================================================
// §2 UBAH ANGKA — saldo sekarang DAN saldo per tanggal
// =====================================================================
console.log('\n§2 Ubah angka');

const delta = Number((await satu(`select revisi_hitungan_opname($1,$2,4600,'staff salah input 46.000') d`, [SESI, NANAS])).d);
cek('2. delta yang ditulis = 4.600 − 46.000', delta, -41400);
cek('2. counted_qty tersimpan', Number((await satu(`select counted_qty c from stock_count_items where count_id=$1 and product_id=$2`, [SESI, NANAS])).c), 4600);

// Saldo SEKARANG: 4.600 (hasil opname yang benar) + 1.000 (nota 2 Oktober).
cek('2. saldo sekarang benar', await saldo(NANAS), 5600);

// ============ INI PEMERIKSAAN TERPENTING DI SELURUH BERKAS ============
//
// Koreksi yang bertanggal HARI INI akan membuat baris di atas lolos dan baris
// ini gagal — dan hanya baris ini yang menjawab "agar sesuai".
cek('2. INTI: saldo per 30 Sep ikut benar (COGS periode itu)', await saldoPada(NANAS, '2026-09-30'), 4600);
cek('2. saldo per 1 Okt (sebelum nota) juga 4.600', await saldoPada(NANAS, '2026-10-01'), 4600);

// Dan koreksinya BUKAN menimpa baris lama: buku stok tetap append-only.
cek(
  '2. koreksinya baris BARU, bukan menimpa',
  Number((await satu(`select count(*) n from stock_movements where count_id=$1`, [SESI])).n),
  2
);
benar(
  '2. pergerakan koreksinya bertanggal closed_at, bukan now()',
  Number(
    (
      await satu(
        `select count(*) n from stock_movements where count_id=$1 and created_at = '2026-09-30 21:00+07'::timestamptz`,
        [SESI]
      )
    ).n
  ) === 2
);

// =====================================================================
// §3 `system_qty` TIDAK DIBACA ULANG
// =====================================================================
console.log('\n§3 Potret sistem dibekukan');

cek(
  '3. INTI: system_qty tetap 6.400 — bukan dibaca ulang dari stok sekarang',
  Number((await satu(`select system_qty s from stock_count_items where count_id=$1 and product_id=$2`, [SESI, NANAS])).s),
  6400
);

// Kalau `system_qty` dibaca ulang saat revisi, ia akan bernilai 47.000 (stok
// yang SUDAH memuat hasil opname), dan deltanya jadi 4.600 − 47.000 = −42.400
// alih-alih −41.400. Selisih seribunya adalah nota 2 Oktober yang tidak ada
// hubungannya sama sekali dengan opname bulan lalu.
cek('3. selisih yang dilaporkan = 4.600 − 6.400', (await saldoPada(NANAS, '2026-09-30')) - 6400, -1800);

// =====================================================================
// §4 REVISI BERANTAI
// =====================================================================
console.log('\n§4 Revisi berantai');

const delta2 = Number((await satu(`select revisi_hitungan_opname($1,$2,4650,'dihitung ulang, 4.650') d`, [SESI, NANAS])).d);
cek('4. delta kedua dihitung dari angka REVISI, bukan angka asli', delta2, 50);
cek('4. saldo per 30 Sep ikut naik 50', await saldoPada(NANAS, '2026-09-30'), 4650);
cek('4. saldo sekarang', await saldo(NANAS), 5650);

const jejak = (await satu(`select revisi j from stock_count_items where count_id=$1 and product_id=$2`, [SESI, NANAS])).j;
cek('4. dua entri jejak tersimpan', jejak.length, 2);
cek('4. jejak pertama menyimpan angka ASLI staff', Number(jejak[0].qty_lama), 46000);
cek('4. jejak kedua TIDAK menimpa yang pertama', Number(jejak[1].qty_lama), 4600);
benar('4. alasannya ikut tersimpan', /salah input/i.test(jejak[0].alasan ?? ''), JSON.stringify(jejak[0]));

const sama = await galat(() => q(`select revisi_hitungan_opname($1,$2,4650,'sama saja')`, [SESI, NANAS]));
benar('4. angka yang sama ditolak, bukan menulis pergerakan nol', /sama/i.test(sama ?? ''), sama);

// =====================================================================
// §5 TAMBAH BAHAN YANG TERLEWAT
// =====================================================================
console.log('\n§5 Bahan terlewat');

// BERAS tidak pernah dihitung di sesi itu. Stoknya 40 sejak 1 September, dan
// `tutup_opname` sengaja tidak menyentuh bahan yang tidak dihitung.
cek('5. beras sebelum ditambahkan', await saldoPada(BERAS, '2026-09-30'), 40);

const delta3 = Number((await satu(`select revisi_hitungan_opname($1,$2,38,'staff lupa rak beras') d`, [SESI, BERAS])).d);
cek('5. delta = 38 − 40 (stok saat sesi ditutup)', delta3, -2);
cek('5. INTI: saldo beras per 30 Sep jadi 38', await saldoPada(BERAS, '2026-09-30'), 38);
cek(
  '5. system_qty-nya stok SAAT SESI DITUTUP, bukan stok sekarang',
  Number((await satu(`select system_qty s from stock_count_items where count_id=$1 and product_id=$2`, [SESI, BERAS])).s),
  40
);
cek('5. barisnya ditandai sebagai tambahan admin (qty_lama null)',
  (await satu(`select revisi->0->>'qty_lama' v from stock_count_items where count_id=$1 and product_id=$2`, [SESI, BERAS])).v,
  null
);

// =====================================================================
// §6 BUANG BARIS SALAH BARANG
// =====================================================================
console.log('\n§6 Buang baris');

// GULA dihitung 100 dan sistemnya juga 100 — penutupan tidak menulis
// pergerakan apa pun. Membuangnya pun tidak boleh menulis apa pun.
const dg = Number((await satu(`select hapus_hitungan_opname($1,$2,'salah barang, maksudnya gula halus') d`, [SESI, GULA])).d);
cek('6. delta nol untuk baris yang dulu cocok dengan sistem', dg, 0);
cek('6. saldo gula tidak bergerak', await saldo(GULA), 100);
benar(
  '6. barisnya TIDAK dihapus, hanya ditandai',
  Number((await satu(`select count(*) n from stock_count_items where count_id=$1 and product_id=$2`, [SESI, GULA])).n) === 1
);
benar(
  '6. dibuang_at & alasannya terisi',
  !!(await satu(`select dibuang_at a, dibuang_alasan b from stock_count_items where count_id=$1 and product_id=$2`, [SESI, GULA])).a
);

const lagi = await galat(() => q(`select hapus_hitungan_opname($1,$2,'lagi')`, [SESI, GULA]));
benar('6. membuang dua kali ditolak', /sudah dibuang/i.test(lagi ?? ''), lagi);

// Sekarang yang BERSELISIH: beras 38 dengan sistem 40 (delta dulu −2).
const db2 = Number((await satu(`select hapus_hitungan_opname($1,$2,'ternyata rak itu milik outlet lain') d`, [SESI, BERAS])).d);
cek('6. INTI: delta balik = system − counted', db2, 2);
cek('6. INTI: beras kembali ke 40 — angka SEBELUM opname, bukan nol', await saldoPada(BERAS, '2026-09-30'), 40);

// Dan baris yang dibuang bisa DIHIDUPKAN kembali — indeks uniknya
// (count_id, product_id) akan menolak insert baru.
const dh = Number((await satu(`select revisi_hitungan_opname($1,$2,39,'ternyata benar milik outlet ini') d`, [SESI, BERAS])).d);
cek('6. baris dibuang bisa dihidupkan lagi', dh, -1);
cek('6. saldo beras per 30 Sep jadi 39', await saldoPada(BERAS, '2026-09-30'), 39);
benar(
  '6. penanda dibuang ikut bersih',
  (await satu(`select dibuang_at a from stock_count_items where count_id=$1 and product_id=$2`, [SESI, BERAS])).a === null
);

// =====================================================================
// §7 SESI YANG BUKAN TERAKHIR
// =====================================================================
console.log('\n§7 Hanya sesi tertutup terakhir');

const SESI2 = (await satu(`select buka_opname($1,'opname Oktober') s`, [OUT])).s;
await q(`select catat_hitungan_opname($1,$2,5000,null,null)`, [SESI2, NANAS]);
await q(`select tutup_opname($1)`, [SESI2]);
await q(`update stock_counts set count_date='2026-10-02', closed_at='2026-10-02 21:00+07' where id=$1`, [SESI2]);

const tolakLama = await galat(() => q(`select revisi_hitungan_opname($1,$2,4700,'mau diubah lagi')`, [SESI, NANAS]));
benar('7. INTI: sesi yang sudah ketiban opname berikutnya ditolak', /lebih baru/i.test(tolakLama ?? ''), tolakLama);

const dSesi2 = Number((await satu(`select revisi_hitungan_opname($1,$2,5100,'salah baca timbangan') d`, [SESI2, NANAS])).d);
cek('7. sesi TERAKHIR tetap bisa direvisi', dSesi2, 100);

// Sesi di outlet LAIN tidak saling menghalangi.
const SESI_CK = (await satu(`select buka_opname($1,null) s`, [OUT2])).s;
await q(`select catat_hitungan_opname($1,$2,7,null,null)`, [SESI_CK, NANAS]);
await q(`select tutup_opname($1)`, [SESI_CK]);
const dCk = Number((await satu(`select revisi_hitungan_opname($1,$2,8,'beda outlet') d`, [SESI_CK, NANAS])).d);
cek('7. outlet lain tidak terpengaruh', dCk, 1);
cek('7. dan saldonya terpisah', await saldo(NANAS, OUT2), 8);

// =====================================================================
// §8 PENANDA DI KEPALA SESI
// =====================================================================
console.log('\n§8 Penanda sesi');

benar(
  '8. direvisi_at & direvisi_by terisi',
  !!(await satu(`select direvisi_at a, direvisi_by b from stock_counts where id=$1`, [SESI])).a
);
cek(
  '8. sesi yang tidak pernah direvisi tetap kosong',
  (await satu(`select direvisi_at a from stock_counts where id=$1`, [SESI_BERJALAN])).a,
  null
);

console.log('');
if (gagal === 0) console.log(`${n} pemeriksaan 0155 lolos. ✅`);
else console.error(`${gagal} dari ${n} pemeriksaan GAGAL.`);
process.exit(gagal === 0 ? 0 : 1);
