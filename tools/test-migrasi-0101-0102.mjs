/**
 * MIGRATION 0101 & 0102 DI POSTGRES SUNGGUHAN (PGlite).
 *
 * ============ KENAPA HARUS DIJALANKAN, BUKAN DIBACA ============
 *
 * Pertanyaan yang memicu pekerjaan ini — "apakah stoknya sudah ikut berubah?"
 * — TIDAK BISA dijawab dengan membaca SQL. Bisa saja rumusnya terlihat benar
 * dan tandanya terbalik, atau resep yang dipakai membalik berbeda dari yang
 * dulu memotong. Keduanya menghasilkan selisih kecil yang terlihat wajar dan
 * tidak akan pernah dicurigai.
 *
 * Jadi di sini SALDO STOKNYA yang diperiksa: dijumlahkan dari `stock_movements`
 * sebelum dan sesudah, dan dituntut kembali ke angka semula.
 *
 * `auth.uid()` dipalsukan lewat GUC supaya pemeriksaan wewenang bisa diuji
 * sungguhan, bukan dilewati.
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

/** Jalankan sebagai user tertentu. `auth.uid()` membacanya dari GUC. */
const sebagai = (uid) => q(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);

async function galat(fn) {
  try {
    await fn();
    return null;
  } catch (e) {
    return e.message ?? String(e);
  }
}

// =====================================================================
// KERANGKA MINIMAL — hanya yang benar-benar disentuh 0101/0102.
// =====================================================================
await db.exec(`
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;

  create table business_units (id uuid primary key default gen_random_uuid(), name text);
  create table outlets (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid references business_units(id),
    name text, outlet_role text default 'standalone', allow_sales boolean default true
  );
  create table user_profiles (id uuid primary key, full_name text);
  create table products (id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text, category text);
  create table recipes (id uuid primary key default gen_random_uuid(), product_id uuid, mode text, yield_qty numeric);
  create table recipe_items (id uuid primary key default gen_random_uuid(), recipe_id uuid, ingredient_product_id uuid, qty numeric);

  create table sales (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, outlet_id uuid, sale_date date, product_id uuid,
    qty numeric, unit_price numeric, revenue numeric,
    created_by uuid, created_at timestamptz not null default now(), submission_id uuid
  );
  create table sales_submissions (
    id uuid primary key, business_unit_id uuid, outlet_id uuid, sale_date date,
    created_by uuid, item_count int default 0, total_revenue numeric default 0
  );
  create table stock_movements (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, outlet_id uuid, product_id uuid,
    movement_type text, qty_delta numeric, notes text,
    created_by uuid, created_at timestamptz not null default now()
  );
  create table outlet_menu_prices (
    id uuid primary key default gen_random_uuid(),
    outlet_id uuid, product_id uuid, selling_price numeric, packaging_cost numeric default 0
  );
  create table assets (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid not null, outlet_id uuid not null,
    name text not null, qty numeric default 1, size text, photo_path text,
    condition text default 'normal', condition_note text, notes text,
    created_by uuid, updated_by uuid,
    created_at timestamptz default now(), updated_at timestamptz default now()
  );
  create table membership_scopes (user_id uuid, business_unit_id uuid, outlet_id uuid, role text);

  -- Peran Supabase yang dipakai GRANT di migration. PGlite tidak punya bawaan.
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
  create or replace function harga_outlet_aktif(p_outlet uuid, p_product uuid, p_date date) returns outlet_menu_prices language sql stable as $$
    select * from outlet_menu_prices where outlet_id = p_outlet and product_id = p_product limit 1;
  $$;
`);

const jalankan = async (berkas) => {
  const sql = fs.readFileSync(path.join(AKAR, 'supabase/migrations', berkas), 'utf8');
  await db.exec(sql.replace(/notify pgrst[^;]*;/g, ''));
};

await jalankan('0101_ubah_hapus_penjualan.sql');
await jalankan('0102_kategori_pindah_aset.sql');
console.log('  migration 0101 & 0102 terpasang.');

// Idempotensi: dijalankan dua kali tidak boleh meledak.
await jalankan('0101_ubah_hapus_penjualan.sql');
await jalankan('0102_kategori_pindah_aset.sql');
console.log('  dijalankan ulang: aman.');

// =====================================================================
// DATA UJI
//
// Nasi Goreng: 1 porsi butuh 200 g beras + 50 g bumbu.
// =====================================================================
const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const BU2 = (await satu(`insert into business_units (name) values ('Hotel') returning id`)).id;
const OUT = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Serpong') returning id`, [BU])).id;
const OUT2 = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Sentul') returning id`, [BU])).id;
const OUT3 = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Hotel A') returning id`, [BU2])).id;

const STAFF = '11111111-1111-1111-1111-111111111111';
const ADMIN = '22222222-2222-2222-2222-222222222222';
const ORANG_LAIN = '33333333-3333-3333-3333-333333333333';
await q(`insert into user_profiles (id, full_name) values ($1,'Staff'),($2,'Admin'),($3,'Lain')`, [STAFF, ADMIN, ORANG_LAIN]);
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values
  ($1,$3,$4,'staff'), ($1,$3,$5,'staff'), ($2,$3,$4,'bu_admin'), ($2,$3,$5,'bu_admin'), ($6,$3,$5,'staff')`,
  [STAFF, ADMIN, BU, OUT, OUT2, ORANG_LAIN]);

const MENU = (await satu(`insert into products (business_unit_id, name) values ($1,'Nasi Goreng') returning id`, [BU])).id;
const BERAS = (await satu(`insert into products (business_unit_id, name) values ($1,'Beras') returning id`, [BU])).id;
const BUMBU = (await satu(`insert into products (business_unit_id, name) values ($1,'Bumbu') returning id`, [BU])).id;

const RES = (await satu(`insert into recipes (product_id, mode, yield_qty) values ($1,'standalone',1) returning id`, [MENU])).id;
await q(`insert into recipe_items (recipe_id, ingredient_product_id, qty) values ($1,$2,200),($1,$3,50)`, [RES, BERAS, BUMBU]);
await q(`insert into outlet_menu_prices (outlet_id, product_id, selling_price) values ($1,$2,25000)`, [OUT, MENU]);

/** Saldo stok sebuah bahan di outlet — dijumlahkan dari buku besarnya. */
const saldo = async (produk, outlet = OUT) =>
  Number((await satu(`select coalesce(sum(qty_delta),0) s from stock_movements where product_id=$1 and outlet_id=$2`, [produk, outlet])).s);

// =====================================================================
// 1. CATAT PENJUALAN — stok terpotong & tertaut ke penjualannya
// =====================================================================
await sebagai(STAFF);
const REF = '44444444-4444-4444-4444-444444444444';
const hasil = await satu(`select record_sales($1,$2,current_date,$3::jsonb,$4) r`, [
  BU, OUT, JSON.stringify([{ product_id: MENU, qty: 10 }]), REF
]);

cek('1. tercatat 1 item', hasil.r.item, 1);
cek('1. omzet 10 × 25.000', Number(hasil.r.omzet), 250000);
cek('1. beras terpotong 10 × 200 g', await saldo(BERAS), -2000);
cek('1. bumbu terpotong 10 × 50 g', await saldo(BUMBU), -500);

const SALE = (await satu(`select id from sales limit 1`)).id;
const tertaut = Number((await satu(`select count(*) n from stock_movements where sale_id=$1`, [SALE])).n);
cek('1. pergerakan tertaut ke penjualannya', tertaut, 2);

// Catatannya menyebut menunya, bukan cuma "Penjualan".
const catatan = (await satu(`select notes from stock_movements where sale_id=$1 limit 1`, [SALE])).notes;
benar('1. catatan menyebut nama menu', /Nasi Goreng/.test(catatan), catatan);

// =====================================================================
// 2. UBAH 10 -> 15 : stok terpotong TAMBAHAN, bukan dihitung ulang dari nol
// =====================================================================
const naik = await satu(`select ubah_penjualan($1, 15) r`, [SALE]);
cek('2. dilaporkan berubah', naik.r.berubah, true);
cek('2. stok ikut disesuaikan', naik.r.stok_disesuaikan, true);
cek('2. omzet jadi 15 × 25.000', Number(naik.r.omzet), 375000);
cek('2. beras jadi −3.000 g', await saldo(BERAS), -3000);
cek('2. bumbu jadi −750 g', await saldo(BUMBU), -750);

// Pergerakan LAMA tidak diubah — yang ditulis adalah penyeimbang baru.
const jumlahGerakan = Number((await satu(`select count(*) n from stock_movements where product_id=$1`, [BERAS])).n);
cek('2. buku besar bertambah, bukan ditimpa', jumlahGerakan, 2);
const asli = Number((await satu(`select qty_delta d from stock_movements where product_id=$1 order by created_at limit 1`, [BERAS])).d);
cek('2. pergerakan pertama tetap −2.000', asli, -2000);

// =====================================================================
// 3. UBAH 15 -> 8 : stok DIKEMBALIKAN sebagian
// =====================================================================
const turun = await satu(`select ubah_penjualan($1, 8) r`, [SALE]);
cek('3. omzet jadi 8 × 25.000', Number(turun.r.omzet), 200000);
cek('3. beras jadi −1.600 g', await saldo(BERAS), -1600);
cek('3. bumbu jadi −400 g', await saldo(BUMBU), -400);

// =====================================================================
// 4. HARGA TIDAK DIBACA ULANG — inti penjagaan omzet historis
//
// Harga master dinaikkan. Mengedit jumlah TIDAK BOLEH ikut memakai harga baru;
// kalau ikut, membetulkan salah ketik hari Senin akan menggeser omzet hari
// Sabtu tanpa satu pun tanda.
// =====================================================================
await q(`update outlet_menu_prices set selling_price = 40000 where outlet_id=$1 and product_id=$2`, [OUT, MENU]);
const setelahNaik = await satu(`select ubah_penjualan($1, 10) r`, [SALE]);
cek('4. tetap memakai harga beku 25.000', Number(setelahNaik.r.omzet), 250000);
benar('4. BUKAN harga baru 40.000', Number(setelahNaik.r.omzet) !== 400000);
cek('4. unit_price di barisnya juga tidak berubah',
  Number((await satu(`select unit_price p from sales where id=$1`, [SALE])).p), 25000);
await q(`update outlet_menu_prices set selling_price = 25000 where outlet_id=$1 and product_id=$2`, [OUT, MENU]);

// =====================================================================
// 5. RINGKASAN KIRIMAN IKUT DIHITUNG ULANG
// =====================================================================
cek('5. total_revenue kiriman ikut terkoreksi',
  Number((await satu(`select total_revenue t from sales_submissions where id=$1`, [REF])).t), 250000);

// =====================================================================
// 6. WEWENANG DITEGAKKAN
// =====================================================================
await sebagai(ORANG_LAIN);
const tolakUbah = await galat(() => q(`select ubah_penjualan($1, 99)`, [SALE]));
benar('6. orang lain ditolak mengubah', /hanya boleh memperbaiki/i.test(tolakUbah ?? ''), tolakUbah);
cek('6.   dan jumlahnya tidak berubah',
  Number((await satu(`select qty q from sales where id=$1`, [SALE])).q), 10);

const tolakHapus = await galat(() => q(`select hapus_penjualan($1, null)`, [SALE]));
benar('6. orang lain ditolak menghapus', /hanya boleh menghapus/i.test(tolakHapus ?? ''), tolakHapus);

// Admin BU boleh kapan saja — termasuk untuk penjualan orang lain.
await sebagai(ADMIN);
const olehAdmin = await satu(`select ubah_penjualan($1, 12) r`, [SALE]);
cek('6. admin BU boleh mengubah', olehAdmin.r.berubah, true);
await q(`select ubah_penjualan($1, 10)`, [SALE]);

// Pencatatnya sendiri, TAPI bukan hari ini -> ditolak.
await q(`update sales set created_at = now() - interval '3 days' where id=$1`, [SALE]);
await sebagai(STAFF);
const tolakLama = await galat(() => q(`select ubah_penjualan($1, 5)`, [SALE]));
benar('6. pencatat ditolak untuk penjualan kemarin', /Selebihnya lewat Admin BU/i.test(tolakLama ?? ''), tolakLama);
await q(`update sales set created_at = now() where id=$1`, [SALE]);

// Jumlah nol/negatif ditolak — "tidak jadi terjual" harus lewat Hapus.
await sebagai(STAFF);
const tolakNol = await galat(() => q(`select ubah_penjualan($1, 0)`, [SALE]));
benar('6. qty 0 ditolak & mengarahkan ke Hapus', /hapus barisnya/i.test(tolakNol ?? ''), tolakNol);
benar('6. qty negatif ditolak', (await galat(() => q(`select ubah_penjualan($1, -5)`, [SALE]))) !== null);

// =====================================================================
// 7. HAPUS — STOK KEMBALI PERSIS KE NOL
//
// Inilah pertanyaan yang memicu seluruh pekerjaan ini, dijawab dengan angka.
// =====================================================================
const hapus = await satu(`select hapus_penjualan($1, 'salah input') r`, [SALE]);
cek('7. dilaporkan terhapus', hapus.r.dihapus, true);
cek('7. stok dikembalikan', hapus.r.stok_dikembalikan, true);

cek('7. SALDO BERAS KEMBALI 0', await saldo(BERAS), 0);
cek('7. SALDO BUMBU KEMBALI 0', await saldo(BUMBU), 0);
cek('7. barisnya benar-benar hilang',
  Number((await satu(`select count(*) n from sales where id=$1`, [SALE])).n), 0);

// Buku besarnya TIDAK ikut terhapus — kalau ikut, saldo berubah diam-diam.
const sisaGerakan = Number((await satu(`select count(*) n from stock_movements where product_id=$1`, [BERAS])).n);
benar('7. pergerakan stok TIDAK ikut terhapus', sisaGerakan >= 4, `${sisaGerakan} baris`);
cek('7. tautannya jadi null, bukan barisnya lenyap',
  Number((await satu(`select count(*) n from stock_movements where product_id=$1 and sale_id is null`, [BERAS])).n), sisaGerakan);

// Ceritanya tertinggal di catatan, karena penjualannya sudah tidak ada.
const catatanBatal = (await satu(`select notes from stock_movements where product_id=$1 order by created_at desc limit 1`, [BERAS])).notes;
benar('7. catatan memuat ceritanya sendiri', /Batal penjualan Nasi Goreng/.test(catatanBatal), catatanBatal);
benar('7.   beserta alasannya', /salah input/.test(catatanBatal), catatanBatal);

cek('7. ringkasan kiriman jadi nol',
  Number((await satu(`select total_revenue t from sales_submissions where id=$1`, [REF])).t), 0);

// =====================================================================
// 8. MENU TANPA RESEP — omzet tetap bisa dikoreksi, stok apa adanya
// =====================================================================
const TANPA = (await satu(`insert into products (business_unit_id, name) values ($1,'Air Mineral') returning id`, [BU])).id;
await q(`insert into outlet_menu_prices (outlet_id, product_id, selling_price) values ($1,$2,5000)`, [OUT, TANPA]);
await sebagai(STAFF);
await q(`select record_sales($1,$2,current_date,$3::jsonb,$4)`, [
  BU, OUT, JSON.stringify([{ product_id: TANPA, qty: 4 }]), '55555555-5555-5555-5555-555555555555'
]);
const SALE2 = (await satu(`select id from sales where product_id=$1`, [TANPA])).id;
const tanpaResep = await satu(`select ubah_penjualan($1, 6) r`, [SALE2]);
cek('8. omzet tetap terkoreksi', Number(tanpaResep.r.omzet), 30000);
cek('8. dikatakan stoknya TIDAK disesuaikan', tanpaResep.r.stok_disesuaikan, false);
const hapus2 = await satu(`select hapus_penjualan($1, null) r`, [SALE2]);
cek('8. tetap bisa dihapus', hapus2.r.dihapus, true);
cek('8. dikatakan stoknya tidak dikembalikan', hapus2.r.stok_dikembalikan, false);

// =====================================================================
// 9. KATEGORI ASET
// =====================================================================
const kolom = await satu(`select data_type from information_schema.columns where table_name='assets' and column_name='category'`);
cek('9. kolom category ada', kolom?.data_type, 'text');

await sebagai(STAFF);
const A1 = (await satu(`insert into assets (business_unit_id, outlet_id, name, category, photo_path, created_by)
  values ($1,$2,'Kursi','Furnitur',$3,$4) returning id`, [BU, OUT, `${OUT}/foto1.jpg`, STAFF])).id;
const A2 = (await satu(`insert into assets (business_unit_id, outlet_id, name, category, created_by)
  values ($1,$2,'Kulkas','Elektronik',$3) returning id`, [BU, OUT, STAFF])).id;
const A3 = (await satu(`insert into assets (business_unit_id, outlet_id, name, category, created_by)
  values ($1,$2,'Meja','Furnitur',$3) returning id`, [BU, OUT2, STAFF])).id;

const kategori = (await q(`select distinct category from assets where business_unit_id=$1 order by category`, [BU])).rows.map((r) => r.category);
cek('9. daftar kategori dari nilai yang ada', kategori, ['Elektronik', 'Furnitur']);

// =====================================================================
// 10. PINDAH MASSAL
// =====================================================================
const pindah = await satu(`select pindah_aset($1::uuid[], $2, $3) r`, [[A1, A2], BU, OUT2]);
cek('10. dua aset berpindah', pindah.r.pindah, 2);
cek('10. tidak ada yang ditolak', pindah.r.ditolak, 0);
cek('10. keduanya ganti outlet', pindah.r.ganti_outlet, 2);
cek('10. outletnya sudah berubah',
  (await q(`select outlet_id from assets where id = any($1::uuid[])`, [[A1, A2]])).rows.every((r) => r.outlet_id === OUT2), true);

// Foto dikosongkan karena berkasnya tinggal di folder outlet lama.
cek('10. photo_path dikosongkan saat ganti outlet',
  (await satu(`select photo_path p from assets where id=$1`, [A1])).p, null);

// Yang sudah berada di tujuan tidak dihitung berpindah.
const lagi = await satu(`select pindah_aset($1::uuid[], $2, $3) r`, [[A3], BU, OUT2]);
cek('10. yang sudah di sana tidak dihitung', lagi.r.pindah, 0);

// --- Outlet tujuan bukan milik BU tujuan -> DITOLAK.
const salahBu = await galat(() => q(`select pindah_aset($1::uuid[], $2, $3)`, [[A1], BU2, OUT2]));
benar('10. outlet tujuan ≠ BU tujuan ditolak', /bukan milik BU tujuan/i.test(salahBu ?? ''), salahBu);

// --- Tidak punya akses ke outlet tujuan -> DITOLAK, bukan "0 berpindah".
const tanpaAkses = await galat(() => q(`select pindah_aset($1::uuid[], $2, $3)`, [[A1], BU2, OUT3]));
benar('10. outlet tujuan di luar scope ditolak', /tidak punya akses ke outlet tujuan/i.test(tanpaAkses ?? ''), tanpaAkses);
cek('10.   dan asetnya tidak berpindah',
  (await satu(`select outlet_id o from assets where id=$1`, [A1])).o, OUT2);

// --- Aset di outlet yang bukan miliknya dilewati & DILAPORKAN.
const ASING = (await satu(`insert into assets (business_unit_id, outlet_id, name, created_by)
  values ($1,$2,'Aset Hotel',$3) returning id`, [BU2, OUT3, ADMIN])).id;
const campur = await satu(`select pindah_aset($1::uuid[], $2, $3) r`, [[A1, ASING], BU, OUT]);
cek('10. hanya yang berhak yang pindah', campur.r.pindah, 1);
cek('10. yang ditolak dilaporkan jumlahnya', campur.r.ditolak, 1);
cek('10.   aset asing tidak tersentuh',
  (await satu(`select outlet_id o from assets where id=$1`, [ASING])).o, OUT3);

// --- Pindah lintas BU yang sah.
await sebagai(ADMIN);
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values ($1,$2,$3,'bu_admin')`, [ADMIN, BU2, OUT3]);
const lintas = await satu(`select pindah_aset($1::uuid[], $2, $3) r`, [[A2], BU2, OUT3]);
cek('10. pindah lintas BU berhasil', lintas.r.pindah, 1);
const setelah = await satu(`select business_unit_id b, outlet_id o from assets where id=$1`, [A2]);
cek('10.   BU-nya ikut berubah', setelah.b, BU2);
cek('10.   outletnya ikut berubah', setelah.o, OUT3);

// --- Daftar kosong ditolak dengan pesan yang bisa ditindaklanjuti.
benar('10. daftar kosong ditolak', /Belum ada aset yang dipilih/i.test(await galat(() => q(`select pindah_aset($1::uuid[], $2, $3)`, [[], BU, OUT])) ?? ''));

await db.close();
console.log(gagal === 0 ? '✅ migrasi 0101/0102: semua lulus' : `❌ migrasi 0101/0102: ${gagal} gagal`);
process.exit(gagal === 0 ? 0 : 1);
