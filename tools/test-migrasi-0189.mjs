/**
 * MIGRATION 0189 — ADMIN OUTLET BISA MENGIMPOR TURBOLY (PGlite).
 *
 *   §1 `outlet_admin_saya` menjawab outlet yang dipegang, bukan boolean.
 *   §2 Admin outlet BOLEH mengimpor penjualan — baris outletnya saja.
 *   §3 Baris outlet lain DILEWATI, DILAPORKAN, dan datanya TIDAK TERSENTUH.
 *   §4 Invoice milik outlet lain tidak bisa dipindahkan lewat pemetaan store.
 *   §5 Pembelian: outlet lain dilewati; PEMBELIAN PUSAT tetap boleh.
 *   §6 PO milik outlet lain tidak dihapus lebih dulu lalu "dilewati".
 *   §7 Pemetaan: hanya ke outlet sendiri, dan tidak bisa merebut pemetaan lain.
 *   §8 Tarik kembali: unggahan sendiri boleh; orang lain & `p_semua` tidak.
 *   §9 Hapus satu dokumen dibatasi outlet.
 *   §10 Staff biasa tetap ditolak; penjagaan 0185–0188 masih utuh.
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
`);
const jalankan = async (b) => db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', b), 'utf8').replace(/notify pgrst[^;]*;/g, ''));
for (const m of [
  '0185_penjualan_bengkel_rinci.sql',
  '0186_pembelian_bengkel.sql',
  '0187_tarik_impor_bengkel.sql',
  '0188_tarik_impor_menyeluruh.sql',
  '0189_impor_bengkel_admin_outlet.sql'
]) await jalankan(m);

const BU = (await satu(`insert into business_units (name) values ('Bengkel') returning id`)).id;
const BU2 = (await satu(`insert into business_units (name) values ('Bengkel Lain') returning id`)).id;
const MLG = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Malang') returning id`, [BU])).id;
const MJK = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Mojokerto') returning id`, [BU])).id;
const LUAR = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Cibubur') returning id`, [BU2])).id;

const BUADM = '11111111-1111-1111-1111-111111111111';
const OMLG = '22222222-2222-2222-2222-222222222222';
const OMJK = '33333333-3333-3333-3333-333333333333';
const STAF = '44444444-4444-4444-4444-444444444444';
const OMLG2 = '55555555-5555-5555-5555-555555555555'; // admin outlet KEDUA di Malang
for (const [id, nama] of [[BUADM, 'Admin BU'], [OMLG, 'Admin Malang'], [OMJK, 'Admin Mojokerto'], [STAF, 'Staff'], [OMLG2, 'Admin Malang 2']]) {
  await q(`insert into user_profiles (id, full_name) values ($1,$2)`, [id, nama]);
}
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values ($1,$2,null,'bu_admin')`, [BUADM, BU]);
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values ($1,$2,$3,'outlet_admin')`, [OMLG, BU, MLG]);
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values ($1,$2,$3,'outlet_admin')`, [OMLG2, BU, MLG]);
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values ($1,$2,$3,'outlet_admin')`, [OMJK, BU, MJK]);
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values ($1,$2,$3,'staff')`, [STAF, BU, MLG]);

const S_MLG = 'OTONIX Malang';
const S_MJK = 'OTONIX Mojokerto';
const A_MLG = 'Jl. Borobudur 45';
const A_MJK = 'Jl. Majapahit 7';

await jadi(BUADM);
await q(`select petakan_store_bengkel($1,$2,$3)`, [BU, S_MLG, MLG]);
await q(`select petakan_store_bengkel($1,$2,$3)`, [BU, S_MJK, MJK]);
await q(`select petakan_tujuan_kirim($1,$2,$3)`, [BU, A_MLG, MLG]);
await q(`select petakan_tujuan_kirim($1,$2,$3)`, [BU, A_MJK, MJK]);

const inv = (no, store, total = 100000, tgl = '2026-10-01') => ({
  invoice_no: no, tanggal: tgl, store, customer: 'A', nopol: 'N1',
  baris: [{ urut: 1, item_type: 'sparepart', sku: 'X', nama: 'OLI', qty: 1, harga_satuan: total, diskon: 0, total, modal: 60000 }]
});
const imporJual = async (list, berkas) => (await satu(`select impor_penjualan_bengkel($1,$2::jsonb,$3) as h`, [BU, JSON.stringify(list), berkas])).h;
const po = (no, alamat, harga = 50000) => ({ po_no: no, tanggal: '2026-10-01', supplier: 'ABB', kirim_ke: alamat, sku: 'X', nama: 'OLI', qty: 2, harga, total: harga * 2 });
const imporBeli = async (list, berkas) => (await satu(`select impor_pembelian_bengkel($1,$2::jsonb,$3) as h`, [BU, JSON.stringify(list), berkas])).h;
const invRow = async (no) => satu(`select outlet_id, berkas, (select count(*)::int from bengkel_sale_lines l where l.invoice_id = i.id) baris,
  (select coalesce(sum(total),0) from bengkel_sale_lines l where l.invoice_id = i.id) nilai
  from bengkel_sale_invoices i where upper(invoice_no)=upper($1)`, [no]);
const poRows = async (no) => (await q(`select outlet_id, harga from bengkel_purchase_lines where upper(po_no)=upper($1) order by urut`, [no])).rows;

// ===============================================================
console.log('§1 outlet_admin_saya');
// ===============================================================
cek('§1 admin outlet Malang -> [MLG]', (await satu(`select outlet_admin_saya($1,$2) a`, [OMLG, BU])).a, [MLG]);
// Admin BU & super admin TIDAK ikut masuk ke sini: mereka dijawab
// `is_bu_admin`, dan mencampurnya membuat "larik kosong" berarti dua hal.
cek('§1 admin BU -> kosong (bukan "semua outlet")', (await satu(`select outlet_admin_saya($1,$2) a`, [BUADM, BU])).a, []);
cek('§1 staff -> kosong', (await satu(`select outlet_admin_saya($1,$2) a`, [STAF, BU])).a, []);
// Outlet milik BU LAIN tidak boleh ikut terbawa: satu orang bisa jadi admin
// outlet di dua BU, dan jawaban yang mencampurnya akan memberi wewenang di BU
// yang tidak ditanyakan.
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values ($1,$2,$3,'outlet_admin')`, [OMLG, BU2, LUAR]);
cek('§1 outlet BU lain tidak ikut', (await satu(`select outlet_admin_saya($1,$2) a`, [OMLG, BU])).a, [MLG]);
cek('§1 ditanya BU lain -> outlet BU itu', (await satu(`select outlet_admin_saya($1,$2) a`, [OMLG, BU2])).a, [LUAR]);

// ===============================================================
console.log('§2–§3 Impor penjualan oleh admin outlet');
// ===============================================================
// Mojokerto punya datanya lebih dulu, dari Admin BU.
await jadi(BUADM);
await imporJual([inv('SRI/MJK/1', S_MJK, 777000)], 'mjk-asli.xlsx');
cek('§3 data Mojokerto ada lebih dulu', Number((await invRow('SRI/MJK/1')).nilai), 777000);

// Admin Malang mengunggah SATU berkas berisi dua cabang — kejadian nyata:
// ekspor Turboly memuat beberapa store sekaligus.
await jadi(OMLG);
const h = await imporJual([inv('SRI/MLG/1', S_MLG), inv('SRI/MJK/1', S_MJK, 1)], 'malang.xlsx');
cek('§2 invoice outletnya masuk', h.invoice_baru, 1);
cek('§2 nilainya benar', Number((await invRow('SRI/MLG/1')).nilai), 100000);
cek('§2 outletnya Malang', (await invRow('SRI/MLG/1')).outlet_id, MLG);

// INI yang paling penting: datanya Mojokerto harus UTUH. Kalau penjagaannya
// ditaruh sesudah `delete`, invoice ini sudah terhapus lalu "dilewati" —
// laporannya rapi, datanya hilang.
cek('§3 data Mojokerto TIDAK tersentuh', Number((await invRow('SRI/MJK/1')).nilai), 777000);
cek('§3 berkasnya pun tidak berubah', (await invRow('SRI/MJK/1')).berkas, 'mjk-asli.xlsx');
cek('§3 store outlet lain DILAPORKAN', h.dilewati_outlet_lain, [S_MJK]);
// Dilewati karena outlet lain BUKAN "belum dipetakan": yang pertama perlu
// Admin BU, yang kedua perlu pemetaan. Disamakan, orangnya akan memetakan
// ulang store cabang lain ke outletnya sendiri untuk "membetulkannya".
cek('§3 tidak dicampur dengan "belum dipetakan"', h.store_belum_dipetakan, []);
// Nomor dokumen milik impor ini hanya yang BENAR-BENAR diproses — kalau nomor
// yang dilewati ikut tercatat, "tarik menyeluruh" nanti akan menyapu invoice
// cabang lain yang tidak pernah ia sentuh.
cek('§3 nomor dilewati tidak tercatat di riwayat', (await satu(`select nomor_dokumen a from bengkel_import_runs where id=$1`, [h.run])).a, ['SRI/MLG/1']);

// ===============================================================
console.log('§4 Pemetaan store tidak bisa merebut invoice');
// ===============================================================
// Admin Malang memetakan store BARU ke outletnya (boleh), lalu memakai nomor
// invoice yang sudah ada milik Mojokerto. Tanpa penjagaan kedua, invoicenya
// akan BERPINDAH outlet beserta omzetnya.
await jadi(OMLG);
await q(`select petakan_store_bengkel($1,'OTONIX Malang 2',$2)`, [BU, MLG]);
const h4 = await imporJual([inv('SRI/MJK/1', 'OTONIX Malang 2', 5)], 'rebut.xlsx');
cek('§4 tidak ada yang diganti', [h4.invoice_baru, h4.invoice_diganti], [0, 0]);
cek('§4 invoicenya tetap milik Mojokerto', (await invRow('SRI/MJK/1')).outlet_id, MJK);
cek('§4 nilainya tetap', Number((await invRow('SRI/MJK/1')).nilai), 777000);
cek('§4 dilaporkan', h4.dilewati_outlet_lain, ['OTONIX Malang 2']);

// Admin BU TETAP bisa melakukannya — ia memang berwenang lintas outlet.
await jadi(BUADM);
const h4b = await imporJual([inv('SRI/MJK/1', 'OTONIX Malang 2', 5)], 'budaya.xlsx');
cek('§4 admin BU tetap bisa memindahkan', h4b.invoice_diganti, 1);
cek('§4 outletnya pindah', (await invRow('SRI/MJK/1')).outlet_id, MLG);

// ===============================================================
console.log('§5 Impor pembelian: outlet lain vs pembelian pusat');
// ===============================================================
await jadi(OMLG);
const b5 = await imporBeli([po('PO/1', A_MLG), po('PO/2', A_MJK), po('PO/3', '')], 'beli-malang.xlsx');
cek('§5 PO outletnya masuk', (await poRows('PO/1')).length, 1);
cek('§5 PO outlet lain tidak masuk', (await poRows('PO/2')).length, 0);
// Pembelian PUSAT tetap boleh: ia menambah, tidak menimpa milik siapa pun.
cek('§5 pembelian pusat tetap masuk', (await poRows('PO/3')).length, 1);
cek('§5 pusatnya tanpa outlet', (await poRows('PO/3'))[0].outlet_id, null);
cek('§5 dihitung sebagai pusat', b5.ke_pusat, 1);
cek('§5 baris outlet lain dihitung', b5.dilewati_outlet_lain, 1);
cek('§5 beserta alamatnya', b5.alamat_outlet_lain, [A_MJK]);
// "Dilewati karena outlet lain" tidak boleh bocor ke "belum dipetakan":
// A_MJK SUDAH dipetakan, cuma bukan ke outletnya.
cek('§5 bukan "alamat belum dipetakan"', b5.alamat_belum_dipetakan, []);
cek('§5 PO baru tidak menghitung yang dilewati', b5.po_baru, 2);

// ===============================================================
console.log('§6 PO milik outlet lain tidak dihapus lebih dulu');
// ===============================================================
//
// Di 0188 blok "hapus isi PO lama" berjalan SEBELUM alamatnya dibaca. Dengan
// admin outlet ikut boleh mengimpor, urutan itu berarti: PO cabang lain
// dihapus dulu, barisnya lalu "dilewati". Laporannya rapi; datanya hilang.
await jadi(BUADM);
await imporBeli([po('PO/MJK', A_MJK, 90000)], 'mjk-beli.xlsx');
cek('§6 PO Mojokerto ada lebih dulu', (await poRows('PO/MJK')).length, 1);
await jadi(OMLG);
const b6 = await imporBeli([po('PO/MJK', A_MJK, 1), po('PO/4', A_MLG)], 'coba.xlsx');
cek('§6 PO Mojokerto MASIH ADA', (await poRows('PO/MJK')).length, 1);
cek('§6 harganya tidak tertimpa', Number((await poRows('PO/MJK'))[0].harga), 90000);
cek('§6 PO sendiri tetap masuk', (await poRows('PO/4')).length, 1);
benar('§6 pelewatannya dilaporkan', b6.dilewati_outlet_lain >= 1);

// PO yang alamatnya kosong (pusat) TAPI barisnya di database milik outlet
// lain juga tidak boleh tertimpa — alamat kosong bukan surat kuasa.
await jadi(BUADM);
await imporBeli([po('PO/PUSAT', A_MJK, 55000)], 'mjk2.xlsx');
await jadi(OMLG);
await imporBeli([po('PO/PUSAT', '', 1)], 'pusat.xlsx');
cek('§6 PO milik outlet lain tidak tertimpa lewat alamat kosong', Number((await poRows('PO/PUSAT'))[0].harga), 55000);

// ===============================================================
console.log('§7 Pemetaan dibatasi outlet');
// ===============================================================
await jadi(OMLG);
benar('§7 tidak bisa memetakan ke outlet lain',
  /outlet yang kamu pegang/.test(await galat(`select petakan_store_bengkel($1,'STORE BARU',$2)`, [BU, MJK]) ?? ''));
benar('§7 tidak bisa merebut pemetaan outlet lain',
  /terpetakan ke outlet lain/.test(await galat(`select petakan_store_bengkel($1,$2,$3)`, [BU, S_MJK, MLG]) ?? ''));
benar('§7 alamat kirim outlet lain juga tidak bisa direbut',
  /terpetakan ke outlet lain/.test(await galat(`select petakan_tujuan_kirim($1,$2,$3)`, [BU, A_MJK, MLG]) ?? ''));
cek('§7 pemetaan Mojokerto utuh',
  (await satu(`select outlet_id o from bengkel_store_map where jenis='store' and lower(store_name)=lower($1)`, [S_MJK])).o, MJK);
await q(`select petakan_tujuan_kirim($1,'Jl. Baru 1',$2)`, [BU, MLG]);
cek('§7 ke outlet sendiri boleh',
  (await satu(`select outlet_id o from bengkel_store_map where jenis='kirim' and store_name='Jl. Baru 1'`)).o, MLG);
await jadi(STAF);
benar('§7 staff tetap ditolak',
  /Admin BU atau admin outlet/.test(await galat(`select petakan_store_bengkel($1,'X',$2)`, [BU, MLG]) ?? ''));

// Nama store yang KEBETULAN sama dengan alamat kirim tidak boleh saling
// menjawab: indeks uniknya membolehkan keduanya hidup, dan `select into`
// mengambil baris pertama tanpa galat.
await jadi(BUADM);
await q(`select petakan_tujuan_kirim($1,'GANDA',$2)`, [BU, MJK]);
await q(`select petakan_store_bengkel($1,'GANDA',$2)`, [BU, MLG]);
await imporJual([inv('SRI/GANDA', 'GANDA', 123000)], 'ganda.xlsx');
cek('§7 store "GANDA" terjawab baris store, bukan baris kirim', (await invRow('SRI/GANDA')).outlet_id, MLG);

// ===============================================================
console.log('§8 Tarik kembali');
// ===============================================================
await jadi(OMLG);
const r8 = await imporJual([inv('SRI/MLG/9', S_MLG)], 'tarik.xlsx');
await jadi(OMJK);
benar('§8 admin outlet lain tidak bisa menarik unggahan orang',
  /diunggah orang lain/.test(await galat(`select tarik_impor_bengkel($1,'salah',false)`, [r8.run]) ?? ''));
await jadi(OMLG2);
benar('§8 rekan di outlet yang SAMA pun tidak bisa',
  /diunggah orang lain/.test(await galat(`select tarik_impor_bengkel($1,'salah',false)`, [r8.run]) ?? ''));
await jadi(OMLG);
benar('§8 penarikan menyeluruh hanya Admin BU',
  /hanya bisa dilakukan Admin BU/.test(await galat(`select tarik_impor_bengkel($1,'salah',true)`, [r8.run]) ?? ''));
benar('§8 alasan tetap wajib',
  /Alasan penarikan wajib/.test(await galat(`select tarik_impor_bengkel($1,'  ',false)`, [r8.run]) ?? ''));
const t8 = (await satu(`select tarik_impor_bengkel($1,'salah unggah',false) as h`, [r8.run])).h;
cek('§8 unggahannya sendiri bisa ditarik', t8.invoice, 1);
cek('§8 invoicenya hilang', Number((await satu(`select count(*)::int n from bengkel_sale_invoices where invoice_no='SRI/MLG/9'`)).n), 0);
// Jejaknya WAJIB tertinggal: "angkanya kok hilang" tidak punya jawaban lain.
benar('§8 jejak penarikannya ada',
  (await satu(`select ditarik_at, ditarik_by, alasan_tarik from bengkel_import_runs where id=$1`, [r8.run])).ditarik_at !== null);
cek('§8 penariknya tercatat', (await satu(`select ditarik_by b from bengkel_import_runs where id=$1`, [r8.run])).b, OMLG);
// Admin BU tetap bisa menarik unggahan siapa pun.
await jadi(BUADM);
const r8b = (await satu(`select impor_penjualan_bengkel($1,$2::jsonb,'x.xlsx') as h`, [BU, JSON.stringify([inv('SRI/MLG/10', S_MLG)])])).h;
await jadi(OMLG);
await q(`select 1`);
await jadi(BUADM);
benar('§8 admin BU bisa menarik unggahan orang lain',
  (await galat(`select tarik_impor_bengkel($1,'rapikan',false)`, [r8b.run])) === null);

// ===============================================================
console.log('§9 Hapus satu dokumen');
// ===============================================================
await jadi(BUADM);
await imporJual([inv('SRI/MJK/9', S_MJK)], 'mjk9.xlsx');
await imporBeli([po('PO/MJK/9', A_MJK)], 'mjk9b.xlsx');
await imporBeli([po('PO/PST/9', '')], 'pst9.xlsx');
await jadi(OMLG);
benar('§9 invoice outlet lain tidak bisa dihapus',
  /bukan milik outlet yang kamu pegang/.test(await galat(`select hapus_dokumen_impor_bengkel($1,'penjualan','SRI/MJK/9','x')`, [BU]) ?? ''));
benar('§9 PO outlet lain tidak bisa dihapus',
  /di luar outlet yang kamu pegang/.test(await galat(`select hapus_dokumen_impor_bengkel($1,'pembelian','PO/MJK/9','x')`, [BU]) ?? ''));
// Pembelian pusat: boleh DIBUAT (§5), tidak boleh DIHAPUS. Asimetrinya
// disengaja — menghapus membuang baris yang mungkin dimasukkan orang lain.
benar('§9 pembelian pusat tidak bisa dihapus admin outlet',
  /di luar outlet yang kamu pegang/.test(await galat(`select hapus_dokumen_impor_bengkel($1,'pembelian','PO/PST/9','x')`, [BU]) ?? ''));
cek('§9 PO Mojokerto masih utuh', (await poRows('PO/MJK/9')).length, 1);
await jadi(OMLG);
const d9 = (await satu(`select hapus_dokumen_impor_bengkel($1,'penjualan','SRI/MLG/1','keliru') as h`, [BU])).h;
cek('§9 dokumen outletnya sendiri bisa dihapus', d9.dihapus, 1);
benar('§9 alasan tetap wajib',
  /Alasan penghapusan wajib/.test(await galat(`select hapus_dokumen_impor_bengkel($1,'pembelian','PO/1','')`, [BU]) ?? ''));

// ===============================================================
console.log('§10 Penjagaan lama masih utuh');
// ===============================================================
await jadi(STAF);
benar('§10 staff tidak bisa mengimpor penjualan',
  /Admin BU atau admin outlet/.test(await galat(`select impor_penjualan_bengkel($1,$2::jsonb,'x')`, [BU, JSON.stringify([inv('SRI/S/1', S_MLG)])]) ?? ''));
benar('§10 staff tidak bisa mengimpor pembelian',
  /Admin BU atau admin outlet/.test(await galat(`select impor_pembelian_bengkel($1,$2::jsonb,'x')`, [BU, JSON.stringify([po('PO/S/1', A_MLG)])]) ?? ''));
await jadi(null);
benar('§10 tanpa login ditolak',
  /Harus login/.test(await galat(`select impor_penjualan_bengkel($1,'[]'::jsonb,'x')`, [BU]) ?? ''));

// Yang 0185–0188 jaga tidak boleh ikut longgar.
await jadi(OMLG);
await q(`select simpan_invoice_korporat($1,$2::jsonb)`, [BU, JSON.stringify({
  outlet_id: MLG, tanggal: '2026-10-05', customer: 'PT A',
  baris: [{ item_type: 'sparepart', nama: 'OLI', qty: 1, harga_satuan: 200000, total: 200000, modal: '' }]
})]);
const korp = await satu(`select invoice_no from bengkel_sale_invoices where sumber='korporat'`);
const h10 = await imporJual([{ ...inv(korp.invoice_no, S_MLG, 9), invoice_no: korp.invoice_no }], 'timpa.xlsx');
cek('§10 invoice korporat tetap tidak bisa ditimpa impor', h10.dilewati_korporat, [korp.invoice_no]);
cek('§10 nilainya tetap', Number((await invRow(korp.invoice_no)).nilai), 200000);
// Modal korporat yang dikosongkan tetap NULL, bukan 0 (0185).
benar('§10 modal kosong tetap NULL',
  (await satu(`select modal from bengkel_sale_lines l join bengkel_sale_invoices i on i.id=l.invoice_id where i.sumber='korporat'`)).modal === null);
// Impor ulang tetap MENGGANTI, bukan menggandakan (0185).
await jadi(OMLG);
await imporJual([inv('SRI/ULANG', S_MLG, 50000)], 'u1.xlsx');
await imporJual([inv('SRI/ULANG', S_MLG, 50000)], 'u2.xlsx');
cek('§10 impor ulang tidak menggandakan baris', (await invRow('SRI/ULANG')).baris, 1);

console.log(`\n${gagal === 0 ? '✅' : '❌'} test-migrasi-0189: ${n - gagal}/${n} lulus`);
process.exit(gagal === 0 ? 0 : 1);
