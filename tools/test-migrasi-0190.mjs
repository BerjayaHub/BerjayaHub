/**
 * MIGRATION 0190 — PENAMBAHAN ASET (PGlite).
 *
 * ============ YANG DIBUKTIKAN ============
 *
 *   §1 Penambahan menaikkan stok DAN meninggalkan dua jejak: angkanya (dari
 *      trigger 0170) dan sebabnya (dari RPC).
 *   §2 Jumlahnya DITAMBAHKAN, bukan ditetapkan — dua pencatatan berturut-turut
 *      tidak saling menimpa.
 *   §3 Sumber & tanggal: pilihan tetap, tanggal mundur boleh, maju ditolak.
 *   §4 Penolakan: jumlah nol/minus, barang yang belum didata, outlet di luar
 *      wewenang.
 *   §5 Pembatalan: stok turun lagi, barisnya TETAP ADA beserta alasannya.
 *   §6 Pembatalan yang melebihi sisa DITOLAK, bukan membuat stok minus.
 *   §7 Tulis langsung ke tabelnya tertutup; baca terbatas BU-nya.
 *   §8 Penjagaan 0169/0170 tidak ikut longgar.
 *   §9 Dijalankan dua kali tetap aman.
 *
 * Yang paling mudah salah dan karena itu diperiksa pakai ANGKA STOK, bukan
 * pakai isi `asset_penambahan`: catatan pembelian yang bertambah tanpa stok
 * ikut bertambah menghasilkan dua layar yang sama-sama rapi dan saling
 * bertentangan.
 */
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let gagal = 0, n = 0;
const cek = (nama, dapat, harap) => {
  n++;
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};
const benar = (nama, syarat, ket = '') => { n++; if (!syarat) { gagal++; console.error(`❌ ${nama}${ket ? ' — ' + ket : ''}`); } };

const db = new PGlite();
const q = (sql, p) => db.query(sql, p);
const satu = async (sql, p) => (await q(sql, p)).rows[0];
const jadi = (uid) => q(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? '']);
const galat = async (sql, p) => { try { await q(sql, p); return null; } catch (e) { return String(e.message ?? e); } };

await db.exec(`
  create role authenticated;
  create schema if not exists auth;
  create schema if not exists storage;
  create or replace function auth.uid() returns uuid language sql stable as $x$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $x$;

  create table business_units (id uuid primary key default gen_random_uuid(), name text);
  create table outlets (id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text);
  create table user_profiles (id uuid primary key, full_name text);
  create table membership_scopes (
    id uuid primary key default gen_random_uuid(),
    user_id uuid, business_unit_id uuid, outlet_id uuid, role text);
  create table assets (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid references business_units(id) on delete cascade,
    outlet_id uuid references outlets(id) on delete cascade,
    name text, category text, qty numeric default 1, size text, photo_path text,
    condition text default 'normal', condition_note text, notes text,
    created_by uuid references user_profiles(id) on delete set null,
    updated_by uuid references user_profiles(id) on delete set null,
    created_at timestamptz default now(), updated_at timestamptz default now());
  create table storage.objects (
    id uuid primary key default gen_random_uuid(), bucket_id text, name text);

  create or replace function asset_photo_outlet(p_name text) returns uuid
    language sql security definer stable as $$
      select nullif(split_part(p_name, '/', 1), '')::uuid $$;
  create or replace function asset_photo_bu(p_name text) returns uuid
    language sql security definer stable as $$
      select o.business_unit_id from outlets o where o.id = asset_photo_outlet(p_name) $$;

  create or replace function is_bu_admin(p_uid uuid, p_bu uuid) returns boolean
    language sql security definer stable as $x$
      select exists (select 1 from membership_scopes ms where ms.user_id = p_uid
        and (ms.role = 'super_admin' or (ms.business_unit_id = p_bu and ms.role = 'bu_admin'))) $x$;
  create or replace function has_bu_scope(p_uid uuid, p_bu uuid) returns boolean
    language sql security definer stable as $x$
      select exists (select 1 from membership_scopes ms where ms.user_id = p_uid
        and (ms.role = 'super_admin' or ms.business_unit_id = p_bu)) $x$;
  create or replace function has_outlet_scope(p_uid uuid, p_outlet uuid) returns boolean
    language sql security definer stable as $x$
      select exists (
        select 1 from membership_scopes ms join outlets o on o.id = p_outlet
         where ms.user_id = p_uid
           and (ms.role = 'super_admin'
                or (ms.business_unit_id = o.business_unit_id and ms.role = 'bu_admin')
                or ms.outlet_id = p_outlet)) $x$;
  create or replace function is_admin_of_outlet(p_uid uuid, p_outlet uuid) returns boolean
    language sql security definer stable as $x$
      select exists (
        select 1 from membership_scopes ms join outlets o on o.id = p_outlet
         where ms.user_id = p_uid
           and (ms.role = 'super_admin'
                or (ms.business_unit_id = o.business_unit_id and ms.role = 'bu_admin')
                or (ms.role = 'outlet_admin' and ms.outlet_id = p_outlet))) $x$;
`);

const jalankan = async (b) =>
  db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', b), 'utf8').replace(/notify pgrst[^;]*;/g, ''));
for (const f of [
  '0168_aset_master_bu_dan_kode.sql',
  '0169_aset_pindah_dan_izin_hapus.sql',
  '0170_kerusakan_aset_dan_riwayat.sql',
  '0171_foto_acuan_item_aset.sql',
  '0172_kategori_wajib_dan_hapus_item_aset.sql',
  '0173_transfer_aset.sql',
  '0174_revisi_transfer_aset.sql',
  '0179_foto_aset_ikut_transfer.sql',
  '0180_kode_aset_global.sql',
  '0190_penambahan_aset.sql'
]) await jalankan(f);

const BU = (await satu(`insert into business_units (name) values ('Admin') returning id`)).id;
const OUT = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Gudang') returning id`, [BU])).id;
const LAIN = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Outlet Lain') returning id`, [BU])).id;
const BU2 = (await satu(`insert into business_units (name) values ('BU Lain') returning id`)).id;
const OUT2 = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Cabang BU2') returning id`, [BU2])).id;

const ADMIN = '11111111-1111-1111-1111-111111111111';
const STAF = '22222222-2222-2222-2222-222222222222';
const ORANGLAIN = '33333333-3333-3333-3333-333333333333';
for (const [id, nm] of [[ADMIN, 'Iko Permadi'], [STAF, 'Staff Gudang'], [ORANGLAIN, 'Orang BU Lain']]) {
  await q(`insert into user_profiles (id, full_name) values ($1,$2)`, [id, nm]);
}
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values ($1,$2,null,'bu_admin')`, [ADMIN, BU]);
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values ($1,$2,$3,'staff')`, [STAF, BU, OUT]);
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values ($1,$2,null,'bu_admin')`, [ORANGLAIN, BU2]);

await jadi(ADMIN);
const ITEM = (await satu(`select tambah_item_aset($1,'Piring Putih Motif Daun bunga','Kitchen','27') as h`, [BU])).h.id;
await q(`select catat_stok_aset($1,$2,28)`, [ITEM, OUT]);

const qty = async (outlet = OUT) =>
  Number((await satu(`select qty from asset_stock where asset_item_id=$1 and outlet_id=$2`, [ITEM, outlet]))?.qty ?? NaN);
const log = async (aksi) => (await q(`select * from asset_log where asset_item_id=$1 and aksi=$2 order by at`, [ITEM, aksi])).rows;
const hariIni = new Date().toISOString().slice(0, 10);
const tgl = (v) => (v === null || v === undefined ? null : new Date(v).toISOString().slice(0, 10));
const tambah = async (jml, sumber = 'pembelian', tanggal = null, catatan = null) =>
  (await satu(`select tambah_stok_aset($1,$2,$3,$4,$5::date,$6) as h`, [ITEM, OUT, jml, sumber, tanggal, catatan])).h;

// ===============================================================
console.log('§1 Stok naik, dan sebabnya ikut tercatat');
// ===============================================================
cek('§1 keadaan awal', await qty(), 28);
const h1 = await tambah(2, 'pembelian', null, 'nota 1123 · TB Sinar');
cek('§1 stok naik', await qty(), 30);
cek('§1 jawaban RPC menyebut sebelum & sesudah', [Number(h1.sebelum), Number(h1.sesudah)], [28, 30]);

const baris = await satu(`select * from asset_penambahan where id=$1`, [h1.id]);
cek('§1 jumlahnya tersimpan', Number(baris.jumlah), 2);
cek('§1 sumbernya tersimpan', baris.sumber, 'pembelian');
cek('§1 catatannya tersimpan', baris.catatan, 'nota 1123 · TB Sinar');
// Angka sebelum/sesudah disimpan supaya barisnya tetap bisa dibaca sendirian
// bertahun-tahun kemudian, walau Edit & kerusakan ikut menggeser stoknya.
cek('§1 angka sebelum & sesudah disimpan', [Number(baris.qty_sebelum), Number(baris.qty_sesudah)], [28, 30]);
// Namanya disimpan sebagai TEKS: orang yang keluar membuat `oleh` jadi null.
cek('§1 nama pencatatnya disimpan', baris.dicatat_by_nama, 'Iko Permadi');

// ---- DUA jejak, bukan satu ----
const logUbah = await log('ubah');
benar('§1 trigger tetap mencatat angkanya', logUbah.some((r) => r.kolom === 'qty' && r.sebelum === '28' && r.sesudah === '30'),
  'tanpa baris ini, riwayat angka kehilangan satu langkah');
const logTambah = await log('tambah');
cek('§1 ada baris log yang menjelaskan sebabnya', logTambah.length, 1);
cek('§1 sebabnya terbaca di kolomnya', logTambah[0].kolom, 'pembelian');
cek('§1 catatannya ikut', logTambah[0].catatan, 'nota 1123 · TB Sinar');
cek('§1 pelakunya tercatat', logTambah[0].oleh_nama, 'Iko Permadi');

// ===============================================================
console.log('§2 Ditambahkan, bukan ditetapkan');
// ===============================================================
//
// Dua orang membuka layar saat stok 30, lalu masing-masing mencatat pembelian.
// Kalau RPC-nya MENETAPKAN angka akhir, yang terakhir menyimpan menang dan
// pembelian satunya hilang tanpa galat.
await tambah(3, 'pembelian');
await tambah(5, 'hibah');
cek('§2 keduanya masuk', await qty(), 38);
cek('§2 tiga baris penambahan', Number((await satu(`select count(*)::int c from asset_penambahan where asset_item_id=$1`, [ITEM])).c), 3);

// ===============================================================
console.log('§3 Sumber & tanggal');
// ===============================================================
cek('§3 tanggal bawaan = hari ini', tgl(baris.tanggal), hariIni);
// Barang datang Sabtu, didata Senin — keadaan normal (0170).
const h3 = await tambah(1, 'temuan', '2026-11-01', 'ketemu di gudang');
cek('§3 tanggal mundur boleh', tgl((await satu(`select tanggal from asset_penambahan where id=$1`, [h3.id])).tanggal), '2026-11-01');
// Tanggal yang bukan hari ini WAJIB terbaca di riwayat: baris log hanya punya
// waktu pengetikan, dan selisih keduanya justru yang sering jadi pertanyaan.
const logTemuan = (await log('tambah')).find((r) => r.kolom === 'temuan');
benar('§3 tanggal masuk ikut ditulis ke catatan log', /tanggal masuk 01 Nov 2026/.test(logTemuan.catatan ?? ''), logTemuan.catatan);
benar('§3 catatan aslinya tidak hilang', /ketemu di gudang/.test(logTemuan.catatan ?? ''), logTemuan.catatan);

const esok = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
benar('§3 tanggal maju ditolak', /tidak boleh di masa depan/.test(await galat(
  `select tambah_stok_aset($1,$2,1,'pembelian',$3::date,null)`, [ITEM, OUT, esok]) ?? ''));
benar('§3 sumber ngawur ditolak', /tidak dikenal/.test(await galat(
  `select tambah_stok_aset($1,$2,1,'beli-beli',null,null)`, [ITEM, OUT]) ?? ''));
cek('§3 yang ditolak tidak mengubah stok', await qty(), 39);

// ===============================================================
console.log('§4 Penolakan');
// ===============================================================
for (const [nama, jml] of [['nol', 0], ['minus', -3]]) {
  benar(`§4 jumlah ${nama} ditolak`, /harus lebih dari nol/.test(await galat(
    `select tambah_stok_aset($1,$2,$3,'pembelian',null,null)`, [ITEM, OUT, jml]) ?? ''));
}
// Barang yang belum pernah didata di outlet itu: ditolak dengan menyebut
// jalan yang benar. "Tidak ditemukan" saja membuat orang menekan tombol yang
// sama berkali-kali.
benar('§4 barang yang belum didata di outlet itu ditolak', /belum didata/.test(await galat(
  `select tambah_stok_aset($1,$2,1,'pembelian',null,null)`, [ITEM, LAIN]) ?? ''));
benar('§4 pesannya menunjuk jalan yang benar', /Tambah Aset/.test(await galat(
  `select tambah_stok_aset($1,$2,1,'pembelian',null,null)`, [ITEM, LAIN]) ?? ''));

await jadi(ORANGLAIN);
benar('§4 outlet di luar wewenang ditolak', /di luar outlet yang bisa kamu kelola/.test(await galat(
  `select tambah_stok_aset($1,$2,1,'pembelian',null,null)`, [ITEM, OUT]) ?? ''));
await jadi(null);
benar('§4 tanpa login ditolak', /Harus login/.test(await galat(
  `select tambah_stok_aset($1,$2,1,'pembelian',null,null)`, [ITEM, OUT]) ?? ''));
await jadi(ADMIN);
cek('§4 stok tidak bergeser oleh semua penolakan di atas', await qty(), 39);

// Staff outlet itu BOLEH — wewenangnya sama dengan Edit, dan pintu yang lebih
// sempit cuma akan membuatnya kembali mengetik angka lewat Edit.
await jadi(STAF);
await tambah(1, 'pembelian');
cek('§4 staff outlet itu tetap bisa mencatat', await qty(), 40);
await jadi(ADMIN);

// ===============================================================
console.log('§5 Pembatalan');
// ===============================================================
const hSalah = await tambah(20, 'pembelian', null, 'salah ketik');
cek('§5 stok sempat naik', await qty(), 60);
benar('§5 alasan wajib', /Alasan pembatalan wajib/.test(await galat(
  `select batalkan_penambahan_aset($1,'   ')`, [hSalah.id]) ?? ''));
const b5 = (await satu(`select batalkan_penambahan_aset($1,'salah ketik, harusnya 2') as h`, [hSalah.id])).h;
cek('§5 stok kembali', await qty(), 40);
cek('§5 jawabannya menyebut yang ditarik', Number(b5.ditarik), 20);

const row5 = await satu(`select * from asset_penambahan where id=$1`, [hSalah.id]);
// Barisnya TETAP ADA: yang dibatalkan harus tetap terlihat beserta alasannya.
benar('§5 barisnya tidak dihapus', row5 !== undefined && row5 !== null);
benar('§5 ditandai dibatalkan', row5.dibatalkan_at !== null);
cek('§5 alasannya tersimpan', row5.alasan_batal, 'salah ketik, harusnya 2');
cek('§5 pembatalnya tercatat', row5.dibatalkan_by_nama, 'Iko Permadi');
cek('§5 jumlahnya TIDAK diubah jadi nol', Number(row5.jumlah), 20);
cek('§5 ada jejaknya di riwayat', (await log('batal-tambah')).length, 1);
benar('§5 dua kali batal ditolak', /sudah dibatalkan/.test(await galat(
  `select batalkan_penambahan_aset($1,'lagi')`, [hSalah.id]) ?? ''));

await jadi(STAF);
benar('§5 staff tidak boleh membatalkan', /Hanya admin outlet/.test(await galat(
  `select batalkan_penambahan_aset($1,'coba')`, [h3.id]) ?? ''));
await jadi(ADMIN);

// ===============================================================
console.log('§6 Pembatalan yang melebihi sisa');
// ===============================================================
//
// Membatalkan pembelian 10 sementara sisanya tinggal 3 berarti 7-nya sudah
// terpakai/pecah/pindah. Dipaksakan, stoknya jadi minus — dan stok minus tidak
// pernah diperiksa siapa pun karena ia terlihat seperti galat sistem.
const hBesar = await tambah(10, 'pembelian');
await q(`select catat_stok_aset($1,$2,3)`, [ITEM, OUT]); // dikoreksi lewat Edit
cek('§6 stok sekarang 3', await qty(), 3);
const pesan6 = await galat(`select batalkan_penambahan_aset($1,'tarik')`, [hBesar.id]);
benar('§6 ditolak', /tidak bisa menarik penambahan/.test(pesan6 ?? ''), pesan6);
benar('§6 pesannya menyebut sisanya', /Tinggal 3 unit/.test(pesan6 ?? ''), pesan6);
cek('§6 stok tidak jadi minus', await qty(), 3);
benar('§6 barisnya tidak ikut ditandai batal',
  (await satu(`select dibatalkan_at from asset_penambahan where id=$1`, [hBesar.id])).dibatalkan_at === null);

// ===============================================================
console.log('§7 Jalan masuk langsung tertutup');
// ===============================================================
const policy = (await q(`select cmd from pg_policies where tablename='asset_penambahan'`)).rows.map((r) => String(r.cmd).toUpperCase());
cek('§7 hanya policy SELECT', [...new Set(policy)], ['SELECT']);
benar('§7 RLS menyala', (await satu(`select relrowsecurity r from pg_class where relname='asset_penambahan'`)).r === true);
// Insert langsung akan menambah catatan pembelian TANPA menyentuh stoknya:
// dua angka berbeda, dua-duanya terlihat benar di layarnya masing-masing.
benar('§7 tidak ada policy insert/update/delete', !policy.some((c) => c !== 'SELECT'));

// ===============================================================
console.log('§8 Penjagaan lama tidak ikut longgar');
// ===============================================================
// Kerusakan masih menolak melebihi stok (0170).
benar('§8 catat kerusakan melebihi stok masih ditolak', /tidak bisa mencatat/.test(await galat(
  `select catat_kerusakan_aset($1,$2,99,'pecah','foto/x.jpg',null,null)`, [ITEM, OUT]) ?? ''));
// `catat_stok_aset` masih MENETAPKAN (itu memang perannya untuk Edit).
await q(`select catat_stok_aset($1,$2,7)`, [ITEM, OUT]);
cek('§8 Edit tetap menetapkan angka', await qty(), 7);
// Dan perubahan lewat Edit tetap tercatat sebagai "ubah", bukan "tambah" —
// koreksi tidak boleh menyamar jadi pembelian.
const ubahTerakhir = (await log('ubah')).filter((r) => r.kolom === 'qty').pop();
cek('§8 koreksi lewat Edit tetap beraksi "ubah"', [ubahTerakhir.sebelum, ubahTerakhir.sesudah], ['3', '7']);
cek('§8 dan tidak menambah baris penambahan',
  Number((await satu(`select count(*)::int c from asset_penambahan where asset_item_id=$1`, [ITEM])).c), 7);

// ===============================================================
console.log('§9 Dijalankan dua kali tetap aman');
// ===============================================================
const sebelumUlang = await qty();
const jmlBaris = Number((await satu(`select count(*)::int c from asset_penambahan`)).c);
await jalankan('0190_penambahan_aset.sql');
cek('§9 stok tidak berubah', await qty(), sebelumUlang);
cek('§9 barisnya tidak hilang', Number((await satu(`select count(*)::int c from asset_penambahan`)).c), jmlBaris);
await jadi(ADMIN);
const h9 = await tambah(1, 'kembali');
cek('§9 masih bisa dipakai sesudahnya', Number(h9.sesudah), sebelumUlang + 1);

console.log(`\n${gagal === 0 ? '✅' : '❌'} test-migrasi-0190: ${n - gagal}/${n} lulus`);
process.exit(gagal === 0 ? 0 : 1);
