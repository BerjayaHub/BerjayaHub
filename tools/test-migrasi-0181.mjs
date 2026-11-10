/**
 * MIGRATION 0181 — ADMIN MEREVISI & MEMBATALKAN WASTE/SPOIL (PGlite).
 *
 * ============ YANG DIBUKTIKAN ============
 *
 *   §1 `catat_waste` yang ditulis ulang masih bekerja DAN masih menjaga
 *      semua yang dijaganya dulu (foto, jenis, jumlah, wewenang).
 *   §2 Revisi jumlah: stok ikut berubah, bukan cuma angkanya di laporan.
 *   §3 Revisi item: bahan yang lama kembali UTUH, bahan baru berkurang.
 *   §4 Revisi waste menu: bahan resepnya dihitung ulang seluruhnya.
 *   §5 Wewenang & penolakan: staff ditolak, alasan wajib, produk BU lain
 *      ditolak, jumlah nol ditolak.
 *   §6 Pembatalan: stok kembali, rekap tidak memuatnya, barisnya tetap ada.
 *   §7 Pemulihan: stok terpotong lagi — TEPAT sekali, bukan dua kali.
 *   §8 Yang sudah diekspor ke ESB boleh direvisi, dan keadaannya ikut dicatat.
 *   §9 Dijalankan dua kali tetap aman.
 *
 * Yang paling mudah salah dan karena itu diperiksa dengan angka stok, bukan
 * dengan angka di `waste_runs`: revisi yang mengubah laporan tanpa mengubah
 * stok menghasilkan dua layar yang sama-sama rapi dan saling bertentangan.
 */
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let gagal = 0;
const cek = (nama, dapat, harap) => {
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  } else console.log(`  ✔ ${nama}`);
};
const benar = (nama, syarat, ket = '') => {
  if (!syarat) {
    gagal++;
    console.error(`❌ ${nama}${ket ? ' — ' + ket : ''}`);
  } else console.log(`  ✔ ${nama}`);
};

const db = new PGlite();
const q = (sql, params) => db.query(sql, params);
const satu = async (sql, params) => (await q(sql, params)).rows[0];
const galat = async (sql, params) => {
  try {
    await q(sql, params);
    return null;
  } catch (e) {
    return String(e.message ?? e);
  }
};
const jadi = async (uid) => q(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? '']);

await db.exec(`
  create role authenticated;
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;
  create table membership_scopes (
    id uuid primary key default gen_random_uuid(),
    user_id uuid, business_unit_id uuid, outlet_id uuid, role text);
  create table business_units (id uuid primary key default gen_random_uuid(), name text);
  create table outlets (id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, name text, outlet_role text default 'standalone');
  create table user_profiles (id uuid primary key, full_name text);
  create table products (id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, name text, base_unit text);
  create table recipes (id uuid primary key default gen_random_uuid(),
    product_id uuid, mode text, yield_qty numeric);
  create table recipe_items (recipe_id uuid, ingredient_product_id uuid, qty numeric);
  create table stock_movements (id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, outlet_id uuid, product_id uuid, movement_type text,
    qty_delta numeric, notes text, created_by uuid, waste_run_id uuid,
    created_at timestamptz not null default now());

  -- waste_runs APA ADANYA sebelum 0147: penanda ESB dari 0146 sudah ada,
  -- kolom purpose belum. Kalau 0147 tidak menambahkannya, §1 gagal.
  create table waste_runs (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, outlet_id uuid, jenis text, product_id uuid,
    qty numeric, photo_path text, code text, notes text, created_by uuid,
    created_at timestamptz not null default now(),
    esb_exported_at timestamptz);
  create table waste_items (waste_id uuid, product_id uuid, qty numeric,
    primary key (waste_id, product_id));

  -- TANDA TANGAN LAMA (0135) DIPASANG SUNGGUHAN.
  --
  -- Tanpa ini, "drop function if exists catat_waste(6 argumen)" di 0147 tidak
  -- menghapus apa pun — dan §4 lolos karena yang dicarinya memang tidak pernah
  -- ada, bukan karena 0147 membuangnya. Sabotase yang menghapus baris "drop
  -- function" itu pun tidak tertangkap. Isinya sengaja sekadar penanda: yang
  -- diuji keberadaannya, bukan perilakunya.
  --
  -- (Tanda petik biasa, BUKAN backtick: blok ini ada di dalam template literal
  -- JavaScript, dan satu backtick di sini menutupnya lebih awal. Berkasnya lalu
  -- gagal di-parse — persis yang barusan terjadi, dan persis yang sudah dua
  -- kali dicatat di README.)
  create or replace function catat_waste(
    p_outlet uuid, p_jenis text, p_product uuid, p_qty numeric, p_photo text, p_notes text
  ) returns uuid language sql as $lama$ select gen_random_uuid() $lama$;

  create table esb_master (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid not null references business_units(id) on delete cascade,
    jenis text not null, kode text, nama text not null, keterangan text,
    unique (business_unit_id, jenis, nama));

  create or replace function is_bu_admin(p_uid uuid, p_bu uuid) returns boolean
    language sql security definer stable as $$
      select exists (select 1 from membership_scopes ms
        where ms.user_id = p_uid
          and (ms.role = 'super_admin' or (ms.role = 'bu_admin' and ms.business_unit_id = p_bu))) $$;
  create or replace function has_outlet_scope(p_uid uuid, p_outlet uuid) returns boolean
    language sql security definer stable as $$
      select exists (select 1 from membership_scopes ms
        where ms.user_id = p_uid
          and (ms.role = 'super_admin'
               or ms.outlet_id = p_outlet
               or ms.business_unit_id = (select business_unit_id from outlets where id = p_outlet))) $$;
`);

// View 0136 APA ADANYA. §6 menguji `create or replace` di 0147 sungguh bisa
// menggantikannya — aturan Postgres menuntut kolom lama tetap di posisi & tipe
// yang sama, jadi menyisipkan kolom di tengah akan menggagalkan migrationnya
// DI TENGAH JALAN. Menyiapkan view kosong di sini tidak akan menguji itu.
await db.exec(
  fs
    .readFileSync(path.join(AKAR, 'supabase/migrations/0136_rekap_waste_ikut_yang_lama.sql'), 'utf8')
    .replace(/notify pgrst[^;]*;/g, '')
    // Blok pelapor di ujungnya membaca `waste_rekap` lewat raise notice — tidak
    // ada gunanya di sini dan memperberat keluarannya.
    .replace(/do \$\$[\s\S]*?raise notice[\s\S]*?end \$\$;/g, '')
);

const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const BU2 = (await satu(`insert into business_units (name) values ('Lain') returning id`)).id;
const OUT = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Sentul') returning id`, [BU])).id;
const OUT2 = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Serpong') returning id`, [BU2])).id;

const ADMIN = '11111111-1111-1111-1111-111111111111';
const STAFF = '22222222-2222-2222-2222-222222222222';
await q(`insert into user_profiles (id, full_name) values ($1,'Admin'), ($2,'Staff')`, [ADMIN, STAFF]);
await q(
  `insert into membership_scopes (user_id, business_unit_id, outlet_id, role)
   values ($1,$2,null,'bu_admin'), ($3,$2,$4,'staff')`,
  [ADMIN, BU, STAFF, OUT]
);

const BERAS = (await satu(`insert into products (business_unit_id, name, base_unit) values ($1,'Beras','gr') returning id`, [BU])).id;

// Satu catatan LAMA (tanpa waste_run) supaya §6 bisa membuktikan cabang kedua
// view-nya tetap ikut sesudah kolomnya bertambah.
await q(
  `insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, notes, created_by)
   values ($1,$2,$3,'waste',-500,'Spoil',$4)`,
  [BU, OUT, BERAS, STAFF]
);

const jalankan = async (b) =>
  db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', b), 'utf8').replace(/notify pgrst[^;]*;/g, ''));

// `is_admin_of_outlet` (0003): super_admin, bu_admin BU-nya, atau outlet_admin
// outlet itu. Dipasang apa adanya — wewenang yang distub lebih longgar membuat
// §5 hijau untuk penjaga yang sebenarnya tidak ada.
await db.exec(`
  create or replace function is_admin_of_outlet(p_uid uuid, p_outlet uuid) returns boolean
    language sql security definer stable as $$
      select exists (
        select 1 from membership_scopes ms join outlets o on o.id = p_outlet
         where ms.user_id = p_uid
           and (ms.role = 'super_admin'
                or (ms.role = 'bu_admin' and ms.business_unit_id = o.business_unit_id)
                or (ms.role = 'outlet_admin' and ms.outlet_id = p_outlet))) $$;
  create or replace function has_bu_scope(p_uid uuid, p_bu uuid) returns boolean
    language sql security definer stable as $$
      select exists (select 1 from membership_scopes ms where ms.user_id = p_uid
        and (ms.role = 'super_admin' or ms.business_unit_id = p_bu)) $$;
`);

const ADM_OUTLET = '33333333-3333-3333-3333-333333333333';
const ORANG_LUAR = '44444444-4444-4444-4444-444444444444';
await q(`insert into user_profiles (id, full_name) values ($1,'Admin Outlet'),($2,'Orang Luar')`, [ADM_OUTLET, ORANG_LUAR]);
await q(
  `insert into membership_scopes (user_id, business_unit_id, outlet_id, role)
   values ($1,$2,$3,'outlet_admin'), ($4,$5,null,'bu_admin')`,
  [ADM_OUTLET, BU, OUT, ORANG_LUAR, BU2]
);

const GULA = (await satu(`insert into products (business_unit_id, name, base_unit) values ($1,'Gula','gr') returning id`, [BU])).id;
const SUSU = (await satu(`insert into products (business_unit_id, name, base_unit) values ($1,'Susu','ml') returning id`, [BU])).id;
const LATTE = (await satu(`insert into products (business_unit_id, name, base_unit) values ($1,'Latte','porsi') returning id`, [BU])).id;
const BAHAN_LAIN_BU = (await satu(`insert into products (business_unit_id, name, base_unit) values ($1,'Teh BU Lain','gr') returning id`, [BU2])).id;

// Resep Latte: 1 porsi = 150 ml susu + 10 gr gula.
const RES = (await satu(`insert into recipes (product_id, mode, yield_qty) values ($1,'standalone',1) returning id`, [LATTE])).id;
await q(`insert into recipe_items (recipe_id, ingredient_product_id, qty) values ($1,$2,150),($1,$3,10)`, [RES, SUSU, GULA]);

await jalankan('0147_purpose_waste.sql');
await jalankan('0181_revisi_waste.sql');

console.log('§0 Migrationnya jalan');
for (const fn of ['revisi_waste', 'batalkan_waste', 'pulihkan_waste', 'pasang_waste', 'bongkar_waste', 'daftar_waste_dibatalkan']) {
  benar(`§0 \`${fn}\` ada`, (await satu(`select count(*)::int as n from pg_proc where proname = $1`, [fn])).n > 0);
}
for (const kol of ['dibatalkan_at', 'alasan_batal', 'revisi_ke', 'direvisi_by']) {
  benar(
    `§0 kolom \`${kol}\` ada di waste_runs`,
    (await satu(`select count(*)::int n from information_schema.columns where table_name='waste_runs' and column_name=$1`, [kol])).n === 1
  );
}

/** Stok sebuah bahan di outlet = jumlah seluruh pergerakannya. */
const stok = async (produk, outlet = OUT) =>
  Number((await satu(`select coalesce(sum(qty_delta),0) s from stock_movements where product_id=$1 and outlet_id=$2`, [produk, outlet])).s);
const barisRekap = async (wasteId) =>
  Number((await satu(`select count(*)::int n from waste_rekap where waste_id=$1`, [wasteId])).n);
const catat = async (jenis, produk, qty, uid = STAFF, notes = null) => {
  await jadi(uid);
  return (await satu(`select catat_waste($1,$2,$3,$4,$5,$6,$7) as id`, [OUT, jenis, produk, qty, 'foto/x.jpg', notes, null])).id;
};

// ===============================================================
console.log('\n§1 `catat_waste` yang ditulis ulang masih utuh');
// ===============================================================
const W1 = await catat('spoil', BERAS, 2000);
cek('§1 spoil memotong stok', await stok(BERAS), -2500); // -500 dari catatan lama
cek('§1 rinciannya satu baris', Number((await satu(`select count(*)::int n from waste_items where waste_id=$1`, [W1])).n), 1);

const WM = await catat('menu', LATTE, 2);
cek('§1 waste menu memotong susu sesuai resep', await stok(SUSU), -300);
cek('§1 waste menu memotong gula sesuai resep', await stok(GULA), -20);

// ============ PEMERIKSAAN LAMA TIDAK BOLEH IKUT HILANG ============
//
// Fungsi yang ditulis ulang adalah cara paling mudah kehilangan penjagaan
// tanpa menyadarinya — 0179 kehilangan dua `insert into asset_log` begitu.
await jadi(STAFF);
benar(
  '§1 foto tetap wajib',
  /Foto wajib/.test(await galat(`select catat_waste($1,'spoil',$2,1,'',null,null)`, [OUT, BERAS]) ?? '')
);
benar(
  '§1 jenis yang tidak dikenal tetap ditolak',
  /Jenis waste/.test(await galat(`select catat_waste($1,'apa',$2,1,'f.jpg',null,null)`, [OUT, BERAS]) ?? '')
);
benar(
  '§1 jumlah nol tetap ditolak',
  /lebih dari 0/.test(await galat(`select catat_waste($1,'spoil',$2,0,'f.jpg',null,null)`, [OUT, BERAS]) ?? '')
);
await jadi(ORANG_LUAR);
benar(
  '§1 outlet di luar wewenang tetap ditolak',
  /tidak berhak/.test(await galat(`select catat_waste($1,'spoil',$2,1,'f.jpg',null,null)`, [OUT, BERAS]) ?? '')
);

// ===============================================================
console.log('\n§2 Revisi jumlah: stoknya ikut, bukan cuma angkanya');
// ===============================================================
await jadi(ADMIN);
const hasil2 = (await satu(`select revisi_waste($1,$2,$3,$4,$5) as h`, [W1, BERAS, 200, 'salah ketik', 'Staff salah input 2000 gr, aslinya 200 gr'])).h;
cek('§2 stok dikoreksi, bukan ditambah koreksi', await stok(BERAS), -700);
cek('§2 rinciannya ikut', Number((await satu(`select qty from waste_items where waste_id=$1`, [W1])).qty), 200);
cek('§2 revisi_ke naik', hasil2.revisi_ke, 1);
cek('§2 jejaknya tercatat', Number((await satu(`select count(*)::int n from waste_revisi where waste_id=$1`, [W1])).n), 1);
const jejak2 = await satu(`select qty_lama, qty_baru, alasan, oleh_nama from waste_revisi where waste_id=$1`, [W1]);
cek('§2 jejak memuat angka LAMA', Number(jejak2.qty_lama), 2000);
cek('§2 jejak memuat angka baru', Number(jejak2.qty_baru), 200);
cek('§2 jejak memuat pelakunya', jejak2.oleh_nama, 'Admin');
// Tanpa alasan, "kenapa 2000 jadi 200" tidak bisa dijawab siapa pun belakangan.
benar('§2 jejak memuat alasannya', /2000 gr/.test(jejak2.alasan));
// Pergerakan stok lamanya DIHAPUS, bukan ditambah lawannya: barangnya memang
// tidak pernah berkurang 2000 gr.
cek(
  '§2 tidak meninggalkan dua pergerakan yang saling meniadakan',
  Number((await satu(`select count(*)::int n from stock_movements where waste_run_id=$1`, [W1])).n),
  1
);

// ===============================================================
console.log('\n§3 Revisi item: bahan lama kembali UTUH');
// ===============================================================
await jadi(ADMIN);
await q(`select revisi_waste($1,$2,$3,$4,$5)`, [W1, GULA, 50, null, 'Bukan beras, tapi gula']);
cek('§3 beras kembali ke keadaan sebelum kejadian ini', await stok(BERAS), -500);
cek('§3 gula berkurang', await stok(GULA), -70); // -20 dari waste menu
cek(
  '§3 rinciannya menunjuk bahan baru',
  (await satu(`select product_id from waste_items where waste_id=$1`, [W1])).product_id,
  GULA
);

// ===============================================================
console.log('\n§4 Revisi waste menu: resepnya dihitung ulang');
// ===============================================================
await jadi(ADMIN);
await q(`select revisi_waste($1,$2,$3,$4,$5)`, [WM, LATTE, 5, null, 'Yang tumpah 5 gelas, bukan 2']);
cek('§4 susu dihitung ulang seluruhnya', await stok(SUSU), -750);
cek('§4 gula dihitung ulang seluruhnya', await stok(GULA), -100); // -50 spoil gula + -50 resep
cek(
  '§4 rinciannya tetap dua bahan, tidak menumpuk',
  Number((await satu(`select count(*)::int n from waste_items where waste_id=$1`, [WM])).n),
  2
);

// ===============================================================
console.log('\n§5 Wewenang & penolakan');
// ===============================================================
await jadi(STAFF);
benar(
  '§5 staff biasa ditolak',
  /admin/i.test(await galat(`select revisi_waste($1,$2,1,null,'coba')`, [W1, GULA]) ?? '')
);
await jadi(ORANG_LUAR);
benar(
  '§5 admin BU lain ditolak',
  /admin/i.test(await galat(`select revisi_waste($1,$2,1,null,'coba')`, [W1, GULA]) ?? '')
);
// Admin outlet BOLEH — ini yang diminta: "admin BU + admin outlet".
await jadi(ADM_OUTLET);
cek('§5 admin outlet boleh merevisi', await galat(`select revisi_waste($1,$2,40,null,'dikoreksi admin outlet')`, [W1, GULA]), null);
await jadi(ADMIN);
// ============ KALIMATNYA, BUKAN SEKADAR KATA "alasan" ============
//
// Versi pertama tes ini cuma mencari /alasan/ di pesan galatnya — dan itu
// LOLOS walau penjaganya dicabut, karena `waste_revisi.alasan` bertipe
// `not null`: yang muncul adalah "null value in column \"alasan\" violates
// not-null constraint", yang juga memuat kata itu. Admin lalu mendapat pesan
// database mentah alih-alih kalimat yang bisa dibaca, dan tesnya tetap hijau.
benar(
  '§5 alasan wajib, dengan kalimat yang bisa dibaca',
  /Alasan revisi wajib diisi/.test(await galat(`select revisi_waste($1,$2,1,null,'   ')`, [W1, GULA]) ?? '')
);
benar(
  '§5 jumlah nol ditolak',
  /lebih dari 0/.test(await galat(`select revisi_waste($1,$2,0,null,'nol')`, [W1, GULA]) ?? '')
);
// Produk BU lain: tanpa penjagaan ini, satu salah pilih memotong stok bahan
// milik BU lain — dan tidak ada laporan di BU mana pun yang menunjukkannya.
benar(
  '§5 produk milik BU lain ditolak',
  /BU ini/.test(await galat(`select revisi_waste($1,$2,1,null,'salah BU')`, [W1, BAHAN_LAIN_BU]) ?? '')
);

// ===============================================================
console.log('\n§6 Pembatalan: stok kembali, barisnya tetap ada');
// ===============================================================
await jadi(ADMIN);
const gulaSebelum = await stok(GULA);
await q(`select batalkan_waste($1,$2)`, [W1, 'Ternyata tidak ada yang rusak']);
cek('§6 stoknya kembali', await stok(GULA), gulaSebelum + 40);
cek('§6 rekap tidak memuatnya lagi', await barisRekap(W1), 0);
// Barisnya & rinciannya SENGAJA tidak dihapus: tanpa itu, "dulu ini apa?"
// tidak bisa dijawab oleh siapa pun.
cek('§6 barisnya masih ada', Number((await satu(`select count(*)::int n from waste_runs where id=$1`, [W1])).n), 1);
cek('§6 rinciannya masih ada', Number((await satu(`select count(*)::int n from waste_items where waste_id=$1`, [W1])).n), 1);
const batal = await satu(`select alasan_batal, dibatalkan_by from waste_runs where id=$1`, [W1]);
cek('§6 alasannya tersimpan', batal.alasan_batal, 'Ternyata tidak ada yang rusak');
cek('§6 pelakunya tersimpan', batal.dibatalkan_by, ADMIN);
const daftar = await (async () => (await q(`select * from daftar_waste_dibatalkan($1,null,null,null)`, [BU])).rows)();
cek('§6 muncul di daftar yang dibatalkan', daftar.length, 1);
benar('§6 daftarnya menyebut alasannya', daftar[0].alasan_batal === 'Ternyata tidak ada yang rusak');
benar(
  '§6 membatalkan dua kali ditolak',
  /sudah dibatalkan/.test(await galat(`select batalkan_waste($1,'lagi')`, [W1]) ?? '')
);
benar(
  '§6 yang dibatalkan tidak bisa direvisi',
  /dibatalkan/.test(await galat(`select revisi_waste($1,$2,1,null,'coba')`, [W1, GULA]) ?? '')
);
benar(
  '§6 alasan pembatalan wajib',
  /Alasan pembatalan wajib diisi/.test(await galat(`select batalkan_waste($1,'  ')`, [WM]) ?? '')
);

// ===============================================================
console.log('\n§7 Pemulihan: terpotong lagi TEPAT sekali');
// ===============================================================
await jadi(ADMIN);
await q(`select pulihkan_waste($1,$2)`, [W1, 'Salah batal']);
cek('§7 stoknya terpotong lagi', await stok(GULA), gulaSebelum);
// Dibongkar dulu sebelum dipasang: rincian lama yang tertinggal akan membuat
// potongannya dobel, dan dobelnya tidak terlihat di layar mana pun.
cek(
  '§7 tidak terpotong dua kali',
  Number((await satu(`select count(*)::int n from stock_movements where waste_run_id=$1`, [W1])).n),
  1
);
cek('§7 kembali muncul di rekap', await barisRekap(W1), 1);
benar(
  '§7 memulihkan yang tidak dibatalkan ditolak',
  /tidak sedang dibatalkan/.test(await galat(`select pulihkan_waste($1,'coba')`, [W1]) ?? '')
);

// ===============================================================
console.log('\n§8 Yang sudah diekspor ke ESB');
// ===============================================================
await q(`update waste_runs set esb_exported_at = now() where id=$1`, [WM]);
await jadi(ADMIN);
const hasil8 = (await satu(`select revisi_waste($1,$2,$3,$4,$5) as h`, [WM, LATTE, 3, null, 'Dikoreksi walau sudah diekspor'])).h;
// BOLEH, tapi harus mengatakannya: angkanya sudah terlanjur berangkat ke ESB
// dan tidak ikut berubah di sana.
benar('§8 boleh direvisi, dan keterkuncian dikatakan', hasil8.esb_terkunci === true);
const jejak8 = await satu(`select esb_terkunci from waste_revisi where waste_id=$1 order by created_at desc limit 1`, [WM]);
// Dicatat SAAT revisi: tandanya bisa dibatalkan atau dipasang lagi sesudahnya,
// jadi membacanya belakangan dari `waste_runs` bukan jawaban yang sama.
benar('§8 keadaan ekspor ikut tercatat di jejaknya', jejak8.esb_terkunci === true);
cek('§8 stoknya tetap ikut dihitung ulang', await stok(SUSU), -450);

// ===============================================================
console.log('\n§9 Dijalankan dua kali');
// ===============================================================
const sebelum9 = await stok(SUSU);
const jejakSebelum = Number((await satu(`select count(*)::int n from waste_revisi`)).n);
await jalankan('0181_revisi_waste.sql');
cek('§9 stok tidak berubah', await stok(SUSU), sebelum9);
cek('§9 jejak tidak bertambah', Number((await satu(`select count(*)::int n from waste_revisi`)).n), jejakSebelum);
cek('§9 rekap masih bisa dibaca', await barisRekap(W1), 1);

console.log(`\n${gagal === 0 ? '✅' : '❌'} test-migrasi-0181 selesai${gagal ? ` — ${gagal} gagal` : ''}`);
process.exit(gagal === 0 ? 0 : 1);
