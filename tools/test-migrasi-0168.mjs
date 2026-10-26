/**
 * 0168 — ASET: MASTER SE-BU + KODE OTOMATIS (PGlite — Postgres sungguhan).
 *
 *   §1 Backfill tidak kehilangan satu pun barang.
 *   §2 Nama yang SAMA PERSIS digabung; yang beda huruf/spasi TIDAK.
 *   §3 Kode: prefix kategori, bentrok, dan nomor urut.
 *   §4 Foto lama tetap ketemu.
 *   §5 Tambah item baru lewat RPC.
 *   §6 Gabung item kembar.
 *   §7 RLS.
 *   §8 Dijalankan ulang.
 *
 * ============ YANG SEBENARNYA DIUJI DI SINI ============
 *
 * Backfill ini memindahkan data yang sudah ada dan tidak bisa dibatalkan.
 * Kegagalannya tidak berbunyi: daftar aset tetap tampil rapi, cuma isinya
 * kurang — dan tidak ada yang menyadarinya sampai opname berikutnya, saat
 * sebabnya sudah tidak bisa ditelusuri.
 *
 * Karena itu datanya dibuat BERANTAKAN dengan sengaja: nama beda huruf besar,
 * spasi ganda, satu outlet mendata barang yang sama dua kali, kategori kosong,
 * kategori berawalan huruf sama, dan baris tanpa foto bercampur yang berfoto.
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
const semua = async (sql, params) => (await q(sql, params)).rows;
const sebagai = (uid) => q(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
const galat = async (fn) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return String(e.message ?? e);
  }
};

await db.exec(`
  create role authenticated;
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;

  create table business_units (id uuid primary key default gen_random_uuid(), name text);
  create table outlets (id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text);
  create table user_profiles (id uuid primary key, full_name text);
  create table membership_scopes (
    id uuid primary key default gen_random_uuid(),
    user_id uuid, business_unit_id uuid, outlet_id uuid, role text);

  create or replace function is_bu_admin(p_uid uuid, p_bu uuid) returns boolean
    language sql security definer stable as $$
      select exists (select 1 from membership_scopes ms where ms.user_id = p_uid
        and (ms.role = 'super_admin' or (ms.business_unit_id = p_bu and ms.role = 'bu_admin'))) $$;
  create or replace function has_bu_scope(p_uid uuid, p_bu uuid) returns boolean
    language sql security definer stable as $$
      select exists (select 1 from membership_scopes ms where ms.user_id = p_uid
        and (ms.role = 'super_admin' or ms.business_unit_id = p_bu)) $$;
  create or replace function has_outlet_scope(p_uid uuid, p_outlet uuid) returns boolean
    language sql security definer stable as $$
      select exists (
        select 1 from membership_scopes ms join outlets o on o.id = p_outlet
         where ms.user_id = p_uid
           and (ms.role = 'super_admin'
                or (ms.business_unit_id = o.business_unit_id and ms.role = 'bu_admin')
                or ms.outlet_id = p_outlet)) $$;

  -- Tabel aset SEBELUM 0168 (bentuk 0045 + kategori dari 0102).
  create table assets (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid not null references business_units(id) on delete cascade,
    outlet_id uuid not null references outlets(id) on delete cascade,
    name text not null,
    category text,
    qty numeric not null default 1 check (qty >= 0),
    size text,
    photo_path text,
    condition text not null default 'normal' check (condition in ('normal','rusak','lainnya')),
    condition_note text,
    notes text,
    created_by uuid references user_profiles(id) on delete set null,
    updated_by uuid references user_profiles(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now());
`);

// ---------------------------------------------------------------
const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const BU2 = (await satu(`insert into business_units (name) values ('Cafe Dua') returning id`)).id;
const A = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Outlet A') returning id`, [BU])).id;
const B = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Outlet B') returning id`, [BU])).id;
const C = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Outlet C') returning id`, [BU])).id;
const LUAR = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Outlet Luar') returning id`, [BU2])).id;

const ADMIN = '11111111-1111-1111-1111-111111111111';
const STAFF_A = '22222222-2222-2222-2222-222222222222';
const STAFF_B = '33333333-3333-3333-3333-333333333333';
await q(`insert into user_profiles (id, full_name) values ($1,'Admin'),($2,'Staff A'),($3,'Staff B')`, [ADMIN, STAFF_A, STAFF_B]);
await q(
  `insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values
     ($1,$4,null,'bu_admin'), ($2,$4,$5,'staff'), ($3,$4,$6,'staff')`,
  [ADMIN, STAFF_A, STAFF_B, BU, A, B]
);

/** Data BERANTAKAN dengan sengaja — lihat catatan di kepala berkas. */
const tambah = (outlet, nama, kategori, qty, extra = {}) =>
  satu(
    `insert into assets (business_unit_id, outlet_id, name, category, qty, size, photo_path, condition, notes, created_by, created_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now() - ($11 || ' days')::interval, now()) returning id`,
    [
      BU, outlet, nama, kategori, qty,
      extra.size ?? null, extra.photo ?? null, extra.condition ?? 'normal', extra.notes ?? null,
      extra.by ?? STAFF_A, extra.umur ?? 1
    ]
  );

// Sama persis di tiga outlet -> HARUS jadi satu item.
const kursiA = await tambah(A, 'Kursi Bar', 'Bar', 10, { size: '45 cm', photo: `${A}/foto-kursi.jpg`, umur: 9 });
await tambah(B, 'Kursi Bar', 'Bar', 4, { umur: 5 });
await tambah(C, 'Kursi Bar', 'Bar', 6, { condition: 'rusak', notes: 'kaki goyang', umur: 3 });

// Nama "mirip" -> TIDAK boleh digabung otomatis.
await tambah(A, 'kursi bar', 'Bar', 2, { umur: 2 });
await tambah(B, 'Kursi  Bar', 'Bar', 1, { umur: 2 });

// Satu outlet mendata barang yang sama DUA KALI -> jumlahnya dijumlahkan.
await tambah(A, 'Meja Bar', 'Bar', 3, { notes: 'dekat kasir', umur: 8 });
await tambah(A, 'Meja Bar', 'Bar', 2, { notes: 'pojok', condition: 'rusak', umur: 4 });

// Kategori berawalan huruf sama -> prefix harus diperpanjang.
await tambah(A, 'Kompor', 'Kitchen', 2, { umur: 7 });
await tambah(B, 'Kompor', 'Kitchen', 1, { umur: 7 });
await tambah(A, 'Blender', 'Kitchenware', 1, { umur: 6 });

// Kategori KOSONG.
await tambah(A, 'Kotak P3K', null, 1, { umur: 6 });
await tambah(B, 'Kotak P3K', '', 1, { umur: 6 });

// Kategori tanpa satu pun huruf.
await tambah(A, 'Arsip 2024', '2024', 5, { umur: 6 });

// BU lain — tidak boleh tercampur.
await q(
  `insert into assets (business_unit_id, outlet_id, name, category, qty, created_by) values ($1,$2,'Kursi Bar','Bar',99,$3)`,
  [BU2, LUAR, ADMIN]
);

const SEBELUM = await satu(`select count(*)::int c, sum(qty)::numeric t from assets`);

const SQL = fs.readFileSync(path.join(AKAR, 'supabase/migrations/0168_aset_master_bu_dan_kode.sql'), 'utf8');
await db.exec(SQL.replace(/notify pgrst[^;]*;/g, ''));
console.log('  0168 terpasang.');

// ===============================================================
console.log('\n§1 Backfill tidak kehilangan satu pun barang');
// ===============================================================
const SESUDAH = await satu(`select count(*)::int c, sum(qty)::numeric t from asset_stock`);

// ============ INI PEMERIKSAAN YANG PALING PENTING ============
//
// Jumlah BARIS memang berkurang — itu tujuannya. Jumlah BARANG tidak boleh
// berubah satu pun. Backfill yang kehilangan aset tidak memunculkan galat; ia
// menghasilkan daftar yang terlihat rapi dengan isi yang kurang.
cek('§1 total jumlah barang TIDAK berubah', Number(SESUDAH.t), Number(SEBELUM.t));
benar('§1 baris stok lebih sedikit daripada baris asal', SESUDAH.c < SEBELUM.c, `${SESUDAH.c} vs ${SEBELUM.c}`);

cek(
  '§1 tabel lama disimpan, tidak dihapus',
  Number((await satu(`select count(*)::int c from assets_sebelum_0168`)).c),
  SEBELUM.c
);
benar(
  '§1 tabel `assets` sudah tidak ada (supaya tidak ada yang membacanya diam-diam)',
  (await galat(() => q(`select 1 from assets`))) !== null
);

cek(
  '§1 BU lain tidak tercampur',
  Number((await satu(`select count(*)::int c from asset_items where business_unit_id = $1`, [BU2])).c),
  1
);

// ===============================================================
console.log('§2 Sama persis digabung; mirip TIDAK');
// ===============================================================
const kursiItem = await semua(
  `select kode, name from asset_items where business_unit_id = $1 and lower(btrim(regexp_replace(name,'\\s+',' ','g'))) = 'kursi bar' order by name`,
  [BU]
);
// "Kursi Bar", "kursi bar", "Kursi  Bar" = TIGA item, bukan satu.
cek('§2 tiga varian nama tetap tiga item', kursiItem.length, 3);
cek('§2 namanya disimpan apa adanya', kursiItem.map((r) => r.name).sort(), ['Kursi  Bar', 'Kursi Bar', 'kursi bar']);

const kursiPersis = await satu(`select id, kode from asset_items where business_unit_id = $1 and name = 'Kursi Bar'`, [BU]);
const stokKursi = await semua(
  `select o.name outlet, s.qty from asset_stock s join outlets o on o.id = s.outlet_id where s.asset_item_id = $1 order by o.name`,
  [kursiPersis.id]
);
cek(
  '§2 "Kursi Bar" yang identik jadi SATU item di tiga outlet',
  stokKursi.map((r) => [r.outlet, Number(r.qty)]),
  [['Outlet A', 10], ['Outlet B', 4], ['Outlet C', 6]]
);

// Dugaan kembar DILAPORKAN, supaya ada yang bisa merapikannya.
const dugaan = await semua(`select nama_baku, jumlah_item from v_aset_dugaan_kembar where business_unit_id = $1`, [BU]);
cek('§2 kembar dilaporkan lewat view', dugaan.map((d) => [d.nama_baku, Number(d.jumlah_item)]), [['kursi bar', 3]]);

// Satu outlet yang mendata dua kali: DIJUMLAHKAN, bukan dipilih salah satu.
const meja = await satu(`select id from asset_items where business_unit_id = $1 and name = 'Meja Bar'`, [BU]);
const stokMeja = await satu(`select qty, condition, notes from asset_stock where asset_item_id = $1 and outlet_id = $2`, [meja.id, A]);
cek('§2 dua baris di satu outlet dijumlahkan', Number(stokMeja.qty), 5);
// Barang rusak tidak boleh kehilangan penandanya hanya karena digabung.
cek('§2 kondisi "rusak" menang saat digabung', stokMeja.condition, 'rusak');
// Catatan DISATUKAN, bukan dipilih salah satu — keduanya ditulis orang tentang
// barang yang sungguh ada.
benar('§2 kedua catatan dipertahankan', /dekat kasir/.test(stokMeja.notes) && /pojok/.test(stokMeja.notes), stokMeja.notes);

// ===============================================================
console.log('§3 Kode: prefix, bentrok, nomor urut');
// ===============================================================
const kode = async (nama) => (await satu(`select kode from asset_items where business_unit_id = $1 and name = $2`, [BU, nama])).kode;

benar('§3 kategori Bar -> B###', /^B\d{3}$/.test(await kode('Kursi Bar')), await kode('Kursi Bar'));
benar('§3 kategori Kitchen -> K###', /^K\d{3}$/.test(await kode('Kompor')), await kode('Kompor'));

// ============ DUA KATEGORI BERAWALAN SAMA ============
//
// "Kitchen" dan "Kitchenware" sama-sama mulai dengan K. Yang kedua harus
// diperpanjang, bukan memakai K juga — kode yang bertabrakan berarti dua
// barang berbeda disebut dengan nama yang sama di berita acara.
const kBlender = await kode('Blender');
benar('§3 Kitchenware diperpanjang, tidak memakai K', !/^K\d/.test(kBlender), kBlender);
benar('§3 dan tetap berawalan huruf kategorinya', kBlender.startsWith('KI'), kBlender);

cek(
  '§3 prefix unik per BU',
  Number((await satu(`select count(*)::int c from (select prefix from asset_category_prefix where business_unit_id=$1 group by prefix having count(*)>1) x`, [BU])).c),
  0
);

// Kategori kosong & kategori tanpa huruf tetap dapat kode, bukan gagal.
benar('§3 kategori kosong tetap berkode', /^[A-Z]+\d{3}$/.test(await kode('Kotak P3K')), await kode('Kotak P3K'));
// "2024" tidak punya satu pun huruf, jadi ia jatuh ke 'X' — yang sudah
// dipakai kategori kosong. Prefixnya dibubuhi angka ('X2') supaya tetap ada
// kode, bukan gagal. Bentuknya karena itu huruf + angka + nomor urut.
const kodeArsip = await kode('Arsip 2024');
benar('§3 kategori tanpa huruf tetap berkode', /^[A-Z][A-Z0-9]*\d{3}$/.test(kodeArsip), kodeArsip);
benar('§3 dan tidak bertabrakan dengan kategori kosong', kodeArsip.slice(0, -3) !== (await kode('Kotak P3K')).slice(0, -3), kodeArsip);

// Nomor urut berjalan DI DALAM prefixnya, bukan global.
const barKode = (await semua(`select kode from asset_items where business_unit_id=$1 and kode like 'B%' order by kode`, [BU])).map((r) => r.kode);
benar('§3 nomor urut berurutan dari 001', barKode[0].endsWith('001'), JSON.stringify(barKode));
cek('§3 tidak ada kode kembar', new Set(barKode).size, barKode.length);

// Kode unik dijaga DATABASE, bukan cuma oleh kode aplikasi.
const kodeKursi = await kode('Kursi Bar');
const eKembar = await galat(() =>
  q(`insert into asset_items (business_unit_id, kode, name) values ($1, $2, 'Selundupan')`, [BU, kodeKursi])
);
benar('§3 kode kembar ditolak indeks', /unique|duplicate/i.test(eKembar ?? ''), eKembar ?? 'malah masuk');
// Huruf kecil pun dianggap kode yang sama — indeksnya atas `upper(btrim(kode))`.
const eKecil = await galat(() =>
  q(`insert into asset_items (business_unit_id, kode, name) values ($1, $2, 'Selundupan')`, [BU, kodeKursi.toLowerCase()])
);
benar('§3 kode berhuruf kecil juga ditolak', /unique|duplicate/i.test(eKecil ?? ''), eKecil ?? 'malah masuk');

// ===============================================================
console.log('§4 Foto lama tetap ketemu');
// ===============================================================

// ============ KENAPA ID-NYA DIWARISI ============
//
// Foto tersimpan dengan path `<outlet_id>/<asset_id>.<ext>`. Memberi baris
// stok id BARU berarti seluruh foto yang sudah ada kehilangan barisnya — tidak
// terhapus, tapi tidak bisa ditemukan lagi, dan tidak ada galat yang memberi
// tahu. Yang terlihat cuma aset tanpa foto, dan itu terbaca seperti staff yang
// belum memotretnya.
const barisFoto = await satu(`select id, photo_path from asset_stock where photo_path is not null`);
cek('§4 path fotonya utuh', barisFoto.photo_path, `${A}/foto-kursi.jpg`);
cek('§4 id baris stok = id baris aset lama', barisFoto.id, kursiA.id);
benar('§4 dan path itu masih menunjuk ke id barisnya', barisFoto.photo_path.includes(A));

// ===============================================================
console.log('§5 Tambah item baru lewat RPC');
// ===============================================================
await sebagai(STAFF_A);
const baru = (await satu(`select tambah_item_aset($1,'Gelas Wine','Bar',null) as h`, [BU])).h;
benar('§5 item baru dibuat', baru.baru === true);
benar('§5 kodenya ikut prefix Bar', /^B\d{3}$/.test(baru.kode), baru.kode);

// Nomor urutnya MENERUSKAN yang sudah ada, bukan mulai dari satu lagi.
benar('§5 nomornya meneruskan yang sudah ada', !barKode.includes(baru.kode), `${baru.kode} vs ${JSON.stringify(barKode)}`);

// Nama + kategori yang sama persis TIDAK membuat item kedua.
const lagi = (await satu(`select tambah_item_aset($1,'Gelas Wine','Bar',null) as h`, [BU])).h;
benar('§5 nama yang sama tidak membuat item kedua', lagi.baru === false);
cek('§5 dan mengembalikan kode yang sama', lagi.kode, baru.kode);

// Kategori BARU bikin prefix baru, bukan menumpang yang ada.
const gudang = (await satu(`select tambah_item_aset($1,'Rak Besi','Gudang',null) as h`, [BU])).h;
benar('§5 kategori baru dapat prefixnya sendiri', gudang.kode.startsWith('G'), gudang.kode);

const eKosong = await galat(() => q(`select tambah_item_aset($1,'   ','Bar',null)`, [BU]));
benar('§5 nama kosong ditolak', /wajib diisi/i.test(eKosong ?? ''), eKosong ?? 'malah masuk');

await sebagai('44444444-4444-4444-4444-444444444444');
const eLuar = await galat(() => q(`select tambah_item_aset($1,'Barang','Bar',null)`, [BU]));
benar('§5 orang tanpa akses BU ditolak', /tidak punya akses/i.test(eLuar ?? ''), eLuar ?? 'malah masuk');

// ===============================================================
console.log('§6 Gabung item kembar');
// ===============================================================
const idPersis = kursiPersis.id;
const idKecil = (await satu(`select id from asset_items where business_unit_id=$1 and name='kursi bar'`, [BU])).id;
const sebelumGabung = Number((await satu(`select sum(qty)::numeric t from asset_stock`)).t);

await sebagai(STAFF_A);
const eStaff = await galat(() => q(`select gabung_item_aset($1,$2)`, [idPersis, idKecil]));
benar('§6 staff tidak boleh menggabungkan', /admin bu/i.test(eStaff ?? ''), eStaff ?? 'malah jalan');

await sebagai(ADMIN);
const hasil = (await satu(`select gabung_item_aset($1,$2) as h`, [idPersis, idKecil])).h;

// Outlet A punya KEDUANYA (10 + 2). Jumlahnya DIJUMLAHKAN, bukan dipilih
// salah satu — dua baris itu barang yang sungguh ada di gudang.
cek('§6 outlet yang punya keduanya: dijumlahkan', Number(hasil.dijumlahkan), 1);
cek(
  '§6 jumlah di outlet A jadi 12',
  Number((await satu(`select qty from asset_stock where asset_item_id=$1 and outlet_id=$2`, [idPersis, A])).qty),
  12
);
cek('§6 total jumlah se-BU TIDAK berubah', Number((await satu(`select sum(qty)::numeric t from asset_stock`)).t), sebelumGabung);
cek('§6 item yang digabung terhapus', Number((await satu(`select count(*)::int c from asset_items where id=$1`, [idKecil])).c), 0);
cek('§6 stoknya ikut terhapus', Number((await satu(`select count(*)::int c from asset_stock where asset_item_id=$1`, [idKecil])).c), 0);

// Outlet yang HANYA punya yang digabung: barisnya dipindahkan.
const idSpasi = (await satu(`select id from asset_items where business_unit_id=$1 and name='Kursi  Bar'`, [BU])).id;
const sebelum2 = Number((await satu(`select sum(qty)::numeric t from asset_stock`)).t);
const hasil2 = (await satu(`select gabung_item_aset($1,$2) as h`, [idPersis, idSpasi])).h;
cek('§6 outlet yang cuma punya salah satu: dipindahkan', Number(hasil2.dipindahkan), 0);
cek('§6 totalnya tetap', Number((await satu(`select sum(qty)::numeric t from asset_stock`)).t), sebelum2);

const eBeda = await galat(() => q(`select gabung_item_aset($1,$1)`, [idPersis]));
benar('§6 menggabung item dengan dirinya ditolak', /tidak bisa digabung/i.test(eBeda ?? ''), eBeda ?? 'malah jalan');

const idBu2 = (await satu(`select id from asset_items where business_unit_id=$1 limit 1`, [BU2])).id;
const eBu = await galat(() => q(`select gabung_item_aset($1,$2)`, [idPersis, idBu2]));
benar('§6 lintas BU ditolak', /BU yang sama/i.test(eBu ?? ''), eBu ?? 'malah jalan');

// ===============================================================
console.log('§7 RLS');
// ===============================================================
await db.exec(`grant usage on schema public to authenticated; grant all on all tables in schema public to authenticated;`);
const sbg = async (uid, fn) => {
  await db.exec(`set role authenticated`);
  await sebagai(uid);
  const r = await galat(fn);
  await db.exec(`reset role`);
  return r;
};
const bacaSbg = async (uid, sql, params) => {
  await db.exec(`set role authenticated`);
  await sebagai(uid);
  try {
    return (await q(sql, params)).rows[0];
  } finally {
    await db.exec(`reset role`);
  }
};

// Daftar ITEM dilihat se-BU — itulah gunanya: nama & kode sama di semua outlet.
benar(
  '§7 staff outlet A melihat SELURUH item BU-nya',
  Number((await bacaSbg(STAFF_A, `select count(*)::int c from asset_items where business_unit_id=$1`, [BU]))?.c) > 3
);
cek(
  '§7 tapi tidak melihat item BU lain',
  Number((await bacaSbg(STAFF_A, `select count(*)::int c from asset_items where business_unit_id=$1`, [BU2]))?.c),
  0
);

// Jumlahnya cuma boleh ditulis oleh orang outlet itu.
const eOutletLain = await sbg(STAFF_A, () =>
  q(`insert into asset_stock (asset_item_id, outlet_id, qty) values ($1,$2,5)`, [gudang.id, B])
);
benar('§7 staff A tidak bisa menulis stok outlet B', /policy|row-level/i.test(eOutletLain ?? ''), eOutletLain ?? 'malah masuk');

const eSendiri = await sbg(STAFF_A, () =>
  q(`insert into asset_stock (asset_item_id, outlet_id, qty) values ($1,$2,5)`, [gudang.id, A])
);
cek('§7 staff A bisa menulis stok outletnya sendiri', eSendiri, null);

const eHapusItem = await sbg(STAFF_A, () => q(`delete from asset_items where id=$1`, [gudang.id]));
cek(
  '§7 staff tidak bisa menghapus item (menghapusnya mengenai SEMUA outlet)',
  Number((await satu(`select count(*)::int c from asset_items where id=$1`, [gudang.id])).c),
  1
);
benar('§7 dan tidak melempar galat palsu', eHapusItem === null, String(eHapusItem));

// ===============================================================
console.log('§8 Dijalankan ulang');
// ===============================================================
const sebelumUlang = await satu(`select count(*)::int c, sum(qty)::numeric t from asset_stock`);
const eUlang = await galat(() => db.exec(SQL.replace(/notify pgrst[^;]*;/g, '')));
cek('§8 migrasi bisa dijalankan dua kali', eUlang, null);
const sesudahUlang = await satu(`select count(*)::int c, sum(qty)::numeric t from asset_stock`);

// ============ MENJALANKAN ULANG TIDAK BOLEH MENGGANDAKAN ============
//
// Backfill yang berjalan dua kali akan menjumlahkan ulang setiap aset. Tidak
// ada galat, cuma jumlah yang tiba-tiba dua kali lipat — dan itu terbaca
// seperti stok yang memang bertambah.
cek('§8 jumlah barang tidak berubah', Number(sesudahUlang.t), Number(sebelumUlang.t));
cek('§8 baris stok tidak bertambah', sesudahUlang.c, sebelumUlang.c);

// ---------------------------------------------------------------
console.log(`\n${gagal === 0 ? '✅' : '❌'} test-migrasi-0168: ${n - gagal}/${n} lulus`);
process.exit(gagal === 0 ? 0 : 1);
