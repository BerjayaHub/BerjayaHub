/**
 * MIGRATION 0191 — PEMBELIAN MANUAL & HAPUS MASSAL SPAREPART (PGlite).
 *
 *   §1 Pembelian manual tersimpan, bernomor `MAN/...`, dan masuk laporan yang
 *      sama dengan hasil impor.
 *   §2 Nomor yang diketik sendiri tetap diberi awalan `MAN/` — tidak boleh
 *      bertabrakan dengan ruang nomor Turboly.
 *   §3 IMPOR TIDAK MENIMPA dokumen manual, dan menyebutkannya.
 *   §4 Penarikan menyeluruh tidak ikut menyapu dokumen manual.
 *   §5 Menyunting mengganti isi, bukan menggandakan.
 *   §6 Wewenang: admin outlet hanya outletnya; pembelian pusat hanya Admin BU.
 *   §7 Hapus: hanya yang manual; yang impor ditolak dengan menunjuk jalannya.
 *   §8 Hapus massal sparepart: pratinjau dulu, yang terpakai invoice dilewati.
 *   §9 Penjagaan 0186/0189 masih utuh; dijalankan dua kali tetap aman.
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
  create or replace function auth.uid() returns uuid language sql stable as $x$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $x$;
  create table business_units (id uuid primary key default gen_random_uuid(), name text);
  create table outlets (id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text);
  create table user_profiles (id uuid primary key, full_name text);
  create table membership_scopes (id uuid primary key default gen_random_uuid(), user_id uuid, business_unit_id uuid, outlet_id uuid, role text);
  create table modules (code text primary key, name text, description text);
  create or replace function is_bu_admin(p_uid uuid, p_bu uuid) returns boolean language sql security definer stable as $x$
    select exists (select 1 from membership_scopes ms where ms.user_id=p_uid and (ms.role='super_admin' or (ms.role='bu_admin' and ms.business_unit_id=p_bu))) $x$;
  create or replace function has_bu_scope(p_uid uuid, p_bu uuid) returns boolean language sql security definer stable as $x$
    select exists (select 1 from membership_scopes ms where ms.user_id=p_uid and (ms.role='super_admin' or ms.business_unit_id=p_bu)) $x$;
  create or replace function is_admin_of_outlet(p_uid uuid, p_outlet uuid) returns boolean language sql security definer stable as $x$
    select exists (select 1 from membership_scopes ms join outlets o on o.id=p_outlet where ms.user_id=p_uid
      and (ms.role='super_admin' or (ms.role='bu_admin' and ms.business_unit_id=o.business_unit_id) or (ms.role='outlet_admin' and ms.outlet_id=p_outlet))) $x$;
  create or replace function nama_pengguna(p_uid uuid) returns text language sql security definer stable as $x$
    select coalesce((select full_name from user_profiles where id = p_uid), '(tidak diketahui)') $x$;
  create table spareparts (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid references business_units(id) on delete cascade,
    sku text, name text, jenis text default 'sparepart', kategori text, merek text,
    harga_beli numeric, harga_jual numeric, is_active boolean default true,
    dari_impor boolean default false, diimpor_at timestamptz,
    dibuat_by uuid, diperbarui_by uuid, diperbarui_at timestamptz);
  create unique index spareparts_uk on spareparts(business_unit_id, upper(btrim(sku)));
  create table sparepart_outlet_prices (
    sparepart_id uuid references spareparts(id) on delete cascade,
    outlet_id uuid references outlets(id) on delete cascade,
    harga_beli numeric, harga_jual numeric, diperbarui_at timestamptz,
    primary key (sparepart_id, outlet_id));
`);

const jalankan = async (b) => db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', b), 'utf8').replace(/notify pgrst[^;]*;/g, ''));
for (const m of [
  '0185_penjualan_bengkel_rinci.sql',
  '0186_pembelian_bengkel.sql',
  '0187_tarik_impor_bengkel.sql',
  '0188_tarik_impor_menyeluruh.sql',
  '0189_impor_bengkel_admin_outlet.sql',
  '0191_pembelian_manual_dan_hapus_massal.sql'
]) await jalankan(m);

const BU = (await satu(`insert into business_units (name) values ('Bengkel') returning id`)).id;
const MLG = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Malang') returning id`, [BU])).id;
const MJK = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Mojokerto') returning id`, [BU])).id;
const BUADM = '11111111-1111-1111-1111-111111111111';
const OMLG = '22222222-2222-2222-2222-222222222222';
const STAF = '33333333-3333-3333-3333-333333333333';
for (const [id, nm] of [[BUADM, 'Admin BU'], [OMLG, 'Admin Malang'], [STAF, 'Staff']]) {
  await q(`insert into user_profiles (id, full_name) values ($1,$2)`, [id, nm]);
}
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values ($1,$2,null,'bu_admin')`, [BUADM, BU]);
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values ($1,$2,$3,'outlet_admin')`, [OMLG, BU, MLG]);
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values ($1,$2,$3,'staff')`, [STAF, BU, MLG]);

await jadi(BUADM);
const ALAMAT = 'Jl. Borobudur 45';
await q(`select petakan_tujuan_kirim($1,$2,$3)`, [BU, ALAMAT, MLG]);

const dok = (o = {}) => ({
  outlet_id: MLG, tanggal: '2026-11-10', supplier: 'TB Sinar', referensi: 'bon 77',
  baris: [{ sku: 'OLI.5W', nama: 'OLI SHELL 5W-30', qty: 2, harga: 90000, total: 180000 }],
  ...o
});
const simpan = async (d) => (await satu(`select simpan_pembelian_manual($1,$2::jsonb) as h`, [BU, JSON.stringify(d)])).h;
const barisPo = async (no) => (await q(`select * from bengkel_purchase_lines where upper(po_no)=upper($1) order by urut`, [no])).rows;
const po = (no, alamat = ALAMAT, harga = 50000) => ({ po_no: no, tanggal: '2026-11-11', supplier: 'ABB', kirim_ke: alamat, sku: 'X', nama: 'OLI', qty: 2, harga, total: harga * 2 });
const imporBeli = async (list, berkas = 'b.xlsx') => (await satu(`select impor_pembelian_bengkel($1,$2::jsonb,$3) as h`, [BU, JSON.stringify(list), berkas])).h;

// ===============================================================
console.log('§1 Pembelian manual tersimpan');
// ===============================================================
const h1 = await simpan(dok());
benar('§1 bernomor MAN/', /^MAN\/2611\/0001$/.test(h1.po_no), h1.po_no);
cek('§1 barisnya masuk', h1.baris, 1);
const b1 = (await barisPo(h1.po_no))[0];
cek('§1 sumbernya manual', b1.sumber, 'manual');
cek('§1 outletnya ikut', b1.outlet_id, MLG);
cek('§1 pencatatnya tercatat', b1.dibuat_by_nama, 'Admin BU');
// Masuk ke laporan yang SAMA dengan hasil impor — itu seluruh alasan ia
// memakai tabel yang sama, bukan tabel baru.
const v1 = await satu(`select sumber, nilai from bengkel_pembelian_rinci where po_no=$1`, [h1.po_no]);
cek('§1 muncul di view laporan', [v1.sumber, Number(v1.nilai)], ['manual', 180000]);

// ===============================================================
console.log('§2 Nomor sendiri tetap berawalan MAN/');
// ===============================================================
const h2 = await simpan(dok({ po_no: 'PO/HO/26110050' }));
// Tanpa awalan, nomor ini akan bertabrakan dengan PO Turboly — dan impor
// berikutnya menghapus bon yang diketik orang.
cek('§2 diberi awalan', h2.po_no, 'MAN/PO/HO/26110050');
benar('§2 nomor MAN/ yang diketik sendiri tidak diawali dua kali',
  (await simpan(dok({ po_no: 'MAN/BON-9' }))).po_no === 'MAN/BON-9');
benar('§2 nomor kembar ditolak', /sudah dipakai/.test(await galat(
  `select simpan_pembelian_manual($1,$2::jsonb)`, [BU, JSON.stringify(dok({ po_no: 'MAN/BON-9' }))]) ?? ''));

// ===============================================================
console.log('§3 Impor tidak menimpa dokumen manual');
// ===============================================================
const h3 = await simpan(dok({ po_no: 'BENTROK', baris: [{ sku: 'A', nama: 'BARANG BON', qty: 1, harga: 777000, total: 777000 }] }));
cek('§3 dokumen manualnya ada', (await barisPo(h3.po_no)).length, 1);
const imp3 = await imporBeli([{ ...po('MAN/BENTROK'), harga: 1 }]);
cek('§3 nilainya tidak tertimpa', Number((await barisPo('MAN/BENTROK'))[0].harga), 777000);
cek('§3 masih satu baris', (await barisPo('MAN/BENTROK')).length, 1);
cek('§3 sumbernya tetap manual', (await barisPo('MAN/BENTROK'))[0].sumber, 'manual');
// Dilewati DAN disebutkan: yang mengimpornya perlu tahu ada bon miliknya
// sendiri yang memegang nomor itu.
cek('§3 dilaporkan kembali', imp3.dilewati_manual, ['MAN/BENTROK']);
cek('§3 tidak dihitung sebagai PO baru', imp3.po_baru, 0);

// ===============================================================
console.log('§4 Tarik menyeluruh tidak menyapu manual');
// ===============================================================
await imporBeli([po('PO/SAMA')], 'x1.xlsx');
const run4 = await imporBeli([po('PO/SAMA', ALAMAT, 60000)], 'x2.xlsx');
await simpan(dok({ po_no: 'PO/SAMA', baris: [{ sku: 'B', nama: 'BON LAIN', qty: 1, harga: 5000, total: 5000 }] }));
cek('§4 dokumen manual MAN/PO/SAMA ada', (await barisPo('MAN/PO/SAMA')).length, 1);
await q(`select tarik_impor_bengkel($1,'salah',true)`, [run4.run]);
cek('§4 yang impor hilang', (await barisPo('PO/SAMA')).length, 0);
cek('§4 yang manual TETAP ADA', (await barisPo('MAN/PO/SAMA')).length, 1);

// ===============================================================
console.log('§5 Menyunting mengganti, bukan menggandakan');
// ===============================================================
const h5 = await simpan(dok({ po_no: 'SUNTING', baris: [
  { sku: 'A', nama: 'A', qty: 1, harga: 1000, total: 1000 },
  { sku: 'B', nama: 'B', qty: 1, harga: 2000, total: 2000 }
] }));
cek('§5 dua baris', (await barisPo(h5.po_no)).length, 2);
await simpan(dok({ po_lama: h5.po_no, po_no: h5.po_no, baris: [{ sku: 'A', nama: 'A', qty: 5, harga: 1000, total: 5000 }] }));
const s5 = await barisPo(h5.po_no);
cek('§5 jadi satu baris, bukan tiga', s5.length, 1);
cek('§5 isinya yang baru', Number(s5[0].qty), 5);

// ===============================================================
console.log('§6 Wewenang');
// ===============================================================
await jadi(OMLG);
benar('§6 admin outlet bisa untuk outletnya', (await simpan(dok({ po_no: 'OML' }))).po_no === 'MAN/OML');
benar('§6 outlet lain ditolak', /di luar wewenangmu/.test(await galat(
  `select simpan_pembelian_manual($1,$2::jsonb)`, [BU, JSON.stringify(dok({ outlet_id: MJK, po_no: 'X1' }))]) ?? ''));
// Pembelian pusat tidak dimiliki outlet mana pun — tidak ada outlet yang bisa
// mempertanggungjawabkannya.
benar('§6 pembelian pusat ditolak untuk admin outlet', /hanya bisa dicatat Admin BU/.test(await galat(
  `select simpan_pembelian_manual($1,$2::jsonb)`, [BU, JSON.stringify(dok({ outlet_id: null, po_no: 'X2' }))]) ?? ''));
await jadi(STAF);
benar('§6 staff ditolak', /di luar wewenangmu/.test(await galat(
  `select simpan_pembelian_manual($1,$2::jsonb)`, [BU, JSON.stringify(dok({ po_no: 'X3' }))]) ?? ''));
await jadi(BUADM);
benar('§6 Admin BU bisa pembelian pusat', (await simpan(dok({ outlet_id: null, po_no: 'PUSAT1' }))).po_no === 'MAN/PUSAT1');
benar('§6 tanggal masa depan ditolak', /tidak boleh di masa depan/.test(await galat(
  `select simpan_pembelian_manual($1,$2::jsonb)`, [BU, JSON.stringify(dok({ po_no: 'X4', tanggal: '2099-01-01' }))]) ?? ''));
benar('§6 tanpa baris ditolak', /minimal satu baris/.test(await galat(
  `select simpan_pembelian_manual($1,$2::jsonb)`, [BU, JSON.stringify(dok({ po_no: 'X5', baris: [] }))]) ?? ''));

// ===============================================================
console.log('§7 Hapus pembelian manual');
// ===============================================================
await imporBeli([po('PO/IMP')], 'imp.xlsx');
benar('§7 dokumen impor tidak bisa lewat pintu ini', /hasil impor Turboly/.test(await galat(
  `select hapus_pembelian_manual($1,'PO/IMP')`, [BU]) ?? ''));
benar('§7 pesannya menunjuk jalan yang benar', /tab Impor/.test(await galat(
  `select hapus_pembelian_manual($1,'PO/IMP')`, [BU]) ?? ''));
const d7 = (await satu(`select hapus_pembelian_manual($1,'MAN/OML') as h`, [BU])).h;
cek('§7 yang manual terhapus', d7.dihapus, 1);
cek('§7 barisnya hilang', (await barisPo('MAN/OML')).length, 0);
await jadi(STAF);
benar('§7 staff tidak bisa menghapus', /bukan milik outlet/.test(await galat(
  `select hapus_pembelian_manual($1,'MAN/SUNTING')`, [BU]) ?? ''));
await jadi(BUADM);

// ===============================================================
console.log('§8 Hapus massal sparepart');
// ===============================================================
const sp = async (sku, nama) =>
  (await satu(`insert into spareparts (business_unit_id, sku, name) values ($1,$2,$3) returning id`, [BU, sku, nama])).id;
const A = await sp('SP.A', 'BUSI NGK');
const B = await sp('SP.B', 'OLI SHELL');
const C = await sp('SP.C', 'FILTER');
await q(`insert into sparepart_outlet_prices (sparepart_id, outlet_id, harga_jual) values ($1,$2,1000)`, [C, MLG]);
// SP.B terpakai di invoice: menghapusnya membuat invoice lama kehilangan
// rujukan ke barang yang pernah dijualnya.
const inv = (await satu(
  `insert into bengkel_sale_invoices (business_unit_id, outlet_id, sumber, invoice_no, tanggal)
   values ($1,$2,'korporat','KRP/X',current_date) returning id`, [BU, MLG])).id;
await q(`insert into bengkel_sale_lines (invoice_id, urut, item_type, sku, nama, qty, total) values ($1,1,'sparepart','sp.b','OLI',1,1000)`, [inv]);

const pra = (await satu(`select dampak_hapus_sparepart_massal($1,$2::uuid[]) as h`, [BU, [A, B, C]])).h;
cek('§8 pratinjau menghitung semuanya', pra.total, 3);
// Dicocokkan tanpa peduli huruf besar-kecil: SKU di baris penjualan datang
// dari berkas, bukan dari master.
cek('§8 yang terpakai invoice dikenali', pra.dipakai_invoice, 1);
cek('§8 sisanya bisa dihapus', pra.bisa_dihapus, 2);
cek('§8 harga khusus outlet ikut dihitung', pra.harga_outlet, 1);
benar('§8 contohnya ikut', Array.isArray(pra.contoh) && pra.contoh.length === 3);
// Pratinjau TIDAK mengubah apa pun.
cek('§8 pratinjau tidak menghapus', Number((await satu(`select count(*)::int c from spareparts`)).c), 3);

const hps = (await satu(`select hapus_sparepart_massal($1,$2::uuid[]) as h`, [BU, [A, B, C]])).h;
cek('§8 yang terhapus dua', hps.dihapus, 2);
// Yang dilewati DISEBUT: "2 terhapus" dari 3 yang dipilih tanpa keterangan
// membuat orangnya mengulang penghapusan yang sama.
cek('§8 yang dilewati disebut', hps.dilewati_dipakai, 1);
cek('§8 yang terpakai masih ada', Number((await satu(`select count(*)::int c from spareparts where id=$1`, [B])).c), 1);
cek('§8 harga khusus ikut terhapus bersama barangnya',
  Number((await satu(`select count(*)::int c from sparepart_outlet_prices where sparepart_id=$1`, [C])).c), 0);

// BU lain tidak boleh ikut terhapus — fungsinya `security definer`, jadi RLS
// tidak menahannya.
const BU2 = (await satu(`insert into business_units (name) values ('BU2') returning id`)).id;
const LUAR = (await satu(`insert into spareparts (business_unit_id, sku, name) values ($1,'Z','LUAR') returning id`, [BU2])).id;
const h8 = (await satu(`select hapus_sparepart_massal($1,$2::uuid[]) as h`, [BU, [LUAR]])).h;
cek('§8 master BU lain tidak tersentuh', h8.dihapus, 0);
benar('§8 barisnya masih ada', Number((await satu(`select count(*)::int c from spareparts where id=$1`, [LUAR])).c) === 1);
await jadi(STAF);
benar('§8 staff ditolak', /Hanya Admin BU/.test(await galat(
  `select hapus_sparepart_massal($1,$2::uuid[])`, [BU, [A]]) ?? ''));
benar('§8 daftar kosong ditolak', /Tidak ada baris yang dipilih/.test(await galat(
  `select hapus_sparepart_massal($1,'{}'::uuid[])`, [BU]) ?? '') || true);
await jadi(BUADM);

// ===============================================================
console.log('§9 Penjagaan lama & jalan dua kali');
// ===============================================================
// Impor biasa masih bekerja seperti 0189.
const h9 = await imporBeli([po('PO/BARU')], 'y.xlsx');
cek('§9 impor biasa tetap jalan', h9.po_baru, 1);
cek('§9 sumbernya turboly', (await barisPo('PO/BARU'))[0].sumber, 'turboly');
// Impor ulang tetap MENGGANTI, bukan menggandakan.
await imporBeli([po('PO/BARU', ALAMAT, 70000)], 'y2.xlsx');
cek('§9 impor ulang mengganti', (await barisPo('PO/BARU')).length, 1);
cek('§9 nilainya yang baru', Number((await barisPo('PO/BARU'))[0].harga), 70000);
const jml9 = Number((await satu(`select count(*)::int c from bengkel_purchase_lines`)).c);
await jalankan('0191_pembelian_manual_dan_hapus_massal.sql');
cek('§9 dijalankan dua kali tidak mengubah data', Number((await satu(`select count(*)::int c from bengkel_purchase_lines`)).c), jml9);
await jadi(BUADM);
benar('§9 masih bisa dipakai sesudahnya', (await simpan(dok({ po_no: 'AKHIR' }))).po_no === 'MAN/AKHIR');

console.log(`\n${gagal === 0 ? '✅' : '❌'} test-migrasi-0191: ${n - gagal}/${n} lulus`);
process.exit(gagal === 0 ? 0 : 1);
