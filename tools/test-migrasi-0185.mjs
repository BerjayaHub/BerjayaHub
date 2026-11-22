/**
 * MIGRATION 0185 — PENJUALAN BENGKEL PER BARIS (PGlite).
 *
 *   §1 Impor pertama: invoice & barisnya masuk, outlet dari pemetaan store.
 *   §2 Impor ULANG periode yang sama MENGGANTI, bukan menggandakan.
 *   §3 Baris yang hilang di Turboly ikut hilang di sini.
 *   §4 Store yang belum dipetakan DILEWATI dan dilaporkan, bukan ditebak.
 *   §5 Invoice korporat tidak pernah disentuh impor.
 *   §6 Korporat: nomor otomatis `KRP/`, modal boleh kosong.
 *   §7 Invoice hasil impor tidak bisa disunting/dihapus tangan.
 *   §8 View: `laba` NULL kalau modal tidak diketahui — bukan laba penuh.
 *   §9 Wewenang & dijalankan dua kali.
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
const q = (sql, p) => db.query(sql, p);
const satu = async (sql, p) => (await q(sql, p)).rows[0];
const jadi = (uid) => q(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? '']);
const galat = async (sql, p) => {
  try {
    await q(sql, p);
    return null;
  } catch (e) {
    return String(e.message ?? e);
  }
};

await db.exec(`
  create role authenticated;
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $x$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $x$;
  create table business_units (id uuid primary key default gen_random_uuid(), name text);
  create table outlets (id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text);
  create table user_profiles (id uuid primary key, full_name text);
  create table membership_scopes (id uuid primary key default gen_random_uuid(),
    user_id uuid, business_unit_id uuid, outlet_id uuid, role text);
  create table modules (code text primary key, name text, description text);
  create or replace function is_bu_admin(p_uid uuid, p_bu uuid) returns boolean
    language sql security definer stable as $x$
      select exists (select 1 from membership_scopes ms where ms.user_id=p_uid
        and (ms.role='super_admin' or (ms.role='bu_admin' and ms.business_unit_id=p_bu))) $x$;
  create or replace function has_bu_scope(p_uid uuid, p_bu uuid) returns boolean
    language sql security definer stable as $x$
      select exists (select 1 from membership_scopes ms where ms.user_id=p_uid
        and (ms.role='super_admin' or ms.business_unit_id=p_bu)) $x$;
  create or replace function is_admin_of_outlet(p_uid uuid, p_outlet uuid) returns boolean
    language sql security definer stable as $x$
      select exists (select 1 from membership_scopes ms join outlets o on o.id=p_outlet
        where ms.user_id=p_uid and (ms.role='super_admin'
          or (ms.role='bu_admin' and ms.business_unit_id=o.business_unit_id)
          or (ms.role='outlet_admin' and ms.outlet_id=p_outlet))) $x$;
`);

const jalankan = async (b) =>
  db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', b), 'utf8').replace(/notify pgrst[^;]*;/g, ''));
await jalankan('0185_penjualan_bengkel_rinci.sql');

const BU = (await satu(`insert into business_units (name) values ('Bengkel') returning id`)).id;
const MLG = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Otonix Malang') returning id`, [BU])).id;
const MJK = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Otonix Mojokerto') returning id`, [BU])).id;
const ADMIN = '11111111-1111-1111-1111-111111111111';
const ADM_OUT = '22222222-2222-2222-2222-222222222222';
const STAFF = '33333333-3333-3333-3333-333333333333';
await q(`insert into user_profiles (id, full_name) values ($1,'Admin BU'),($2,'Admin Outlet'),($3,'Budi')`, [ADMIN, ADM_OUT, STAFF]);
await q(
  `insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values
     ($1,$2,null,'bu_admin'), ($3,$2,$4,'outlet_admin'), ($5,$2,$4,'staff')`,
  [ADMIN, BU, ADM_OUT, MLG, STAFF]
);

const inv = (o = {}) => ({
  invoice_no: 'SRI/OTXM/001', tanggal: '2026-11-22', store: 'OTONIX Malang', tipe: 'Service Sale',
  status: 'Completed', customer: 'CATUR', company: '', nopol: 'N1234AB', merek: 'DATSUN', model: 'GO+',
  work_order: '', service_order: 'SRO/1', pembayaran: 'Cash',
  baris: [
    { urut: 1, item_type: 'jasa', sku: 'JAS0048', nama: 'INSTALASI PART', qty: 1, harga_satuan: 100000, diskon: 0, total: 100000, modal: null, laba_turboly: null },
    { urut: 2, item_type: 'sparepart', sku: 'NC.300', nama: 'NYLON CABLE TIE', qty: 1, harga_satuan: 2500, diskon: 0, total: 2500, modal: 300, laba_turboly: 2200 }
  ],
  ...o
});
const impor = (invoices, berkas = 'nov.xlsx') =>
  satu(`select impor_penjualan_bengkel($1,$2::jsonb,$3) as h`, [BU, JSON.stringify(invoices), berkas]);
const barisDi = async (no) =>
  Number((await satu(
    `select count(*)::int n from bengkel_sale_lines l join bengkel_sale_invoices i on i.id=l.invoice_id where i.invoice_no=$1`, [no]
  )).n);

await jadi(ADMIN);
await q(`select petakan_store_bengkel($1,'OTONIX Malang',$2)`, [BU, MLG]);

// ===============================================================
console.log('§1 Impor pertama');
// ===============================================================
const h1 = (await impor([inv()])).h;
cek('§1 satu invoice baru', h1.invoice_baru, 1);
cek('§1 dua baris', h1.baris, 2);
cek('§1 tidak ada yang diganti', h1.invoice_diganti, 0);
const disimpan = await satu(`select outlet_id, sumber, nopol, berkas from bengkel_sale_invoices where invoice_no='SRI/OTXM/001'`);
cek('§1 outlet dari pemetaan store', disimpan.outlet_id, MLG);
cek('§1 sumbernya turboly', disimpan.sumber, 'turboly');
cek('§1 nopol ikut', disimpan.nopol, 'N1234AB');
cek('§1 nama berkas dicatat', disimpan.berkas, 'nov.xlsx');

// ===============================================================
console.log('§2–§3 Impor ulang MENGGANTI');
// ===============================================================
const h2 = (await impor([inv()])).h;
cek('§2 dihitung sebagai diganti', [h2.invoice_baru, h2.invoice_diganti], [0, 1]);
cek('§2 barisnya tetap dua, tidak jadi empat', await barisDi('SRI/OTXM/001'), 2);
cek('§2 invoicenya tetap satu', Number((await satu(`select count(*)::int n from bengkel_sale_invoices`)).n), 1);
// Baris yang DIHAPUS di Turboly harus ikut hilang. Menyamakan baris satu per
// satu akan meninggalkannya hidup di sini — dan omzetnya terhitung selamanya.
await impor([inv({ baris: [inv().baris[0]] })]);
cek('§3 baris yang hilang di Turboly ikut hilang', await barisDi('SRI/OTXM/001'), 1);
// Angkanya yang berubah ikut diperbarui, bukan ditinggal.
await impor([inv({ baris: [{ ...inv().baris[1], urut: 1, total: 9999, modal: 1000 }] })]);
cek('§3 angka yang berubah ikut diperbarui', Number((await satu(
  `select l.total from bengkel_sale_lines l join bengkel_sale_invoices i on i.id=l.invoice_id where i.invoice_no='SRI/OTXM/001'`)).total), 9999);

// ===============================================================
console.log('§4 Store belum dipetakan');
// ===============================================================
const h4 = (await impor([inv({ invoice_no: 'SRI/OTXMJ/009', store: 'OTONIX Mojokerto' })])).h;
cek('§4 dilewati, tidak ditebak', h4.invoice_baru, 0);
cek('§4 storenya dilaporkan balik', h4.store_belum_dipetakan, ['OTONIX Mojokerto']);
cek('§4 dan tidak ada baris yang masuk', await barisDi('SRI/OTXMJ/009'), 0);
await q(`select petakan_store_bengkel($1,'OTONIX Mojokerto',$2)`, [BU, MJK]);
const h4b = (await impor([inv({ invoice_no: 'SRI/OTXMJ/009', store: 'OTONIX Mojokerto' })])).h;
cek('§4 sesudah dipetakan, masuk', h4b.invoice_baru, 1);
cek('§4 ke outlet yang benar', (await satu(`select outlet_id from bengkel_sale_invoices where invoice_no='SRI/OTXMJ/009'`)).outlet_id, MJK);
// Nama store dibandingkan tanpa peduli huruf besar-kecil & spasi ganda.
cek('§4 "otonix  malang" dikenali sebagai store yang sama',
  (await impor([inv({ invoice_no: 'SRI/OTXM/002', store: 'otonix  malang' })])).h.invoice_baru, 1);
// Invoice tanpa baris tidak boleh mengosongkan invoice yang sudah ada.
const h4c = (await impor([inv({ baris: [] })])).h;
cek('§4 invoice tanpa baris dilewati', h4c.dilewati_kosong, ['SRI/OTXM/001']);
cek('§4 dan isinya tidak terhapus', await barisDi('SRI/OTXM/001'), 1);

// ===============================================================
console.log('§5–§6 Korporat');
// ===============================================================
const korp = {
  outlet_id: MLG, tanggal: '2026-11-23', customer: 'PT SEMEN', company: 'PT SEMEN INDONESIA',
  nopol: 'L9999XX', pembayaran: 'Transfer',
  baris: [
    { item_type: 'sparepart', sku: 'OLI.X', nama: 'OLI MESIN', qty: 4, harga_satuan: 150000, total: 600000, modal: '400000' },
    { item_type: 'sparepart', sku: 'FLT.Y', nama: 'FILTER', qty: 1, harga_satuan: 65000, total: 65000, modal: '' },
    { item_type: 'jasa', nama: 'SERVICE BERKALA', qty: 1, harga_satuan: 250000, total: 250000 }
  ]
};
const k1 = (await satu(`select simpan_invoice_korporat($1,$2::jsonb) as h`, [BU, JSON.stringify(korp)])).h;
benar('§6 nomor otomatis berawalan KRP/', /^KRP\/2611\/0001$/.test(k1.invoice_no), k1.invoice_no);
cek('§6 tiga baris', k1.baris, 3);
const kolomModal = await q(`select urut, modal from bengkel_sale_lines where invoice_id=$1 order by urut`, [k1.id]);
cek('§6 modal yang diisi tersimpan', Number(kolomModal.rows[0].modal), 400000);
// Modal yang dikosongkan tetap NULL — 0 akan membuat labanya terlihat 100%.
cek('§6 modal yang dikosongkan tetap null', kolomModal.rows[1].modal, null);
cek('§6 nomor berikutnya berurut',
  (await satu(`select simpan_invoice_korporat($1,$2::jsonb) as h`, [BU, JSON.stringify(korp)])).h.invoice_no, 'KRP/2611/0002');

// Impor TIDAK boleh menyentuh invoice korporat, walau nomornya kebetulan sama.
const h5 = (await impor([inv({ invoice_no: k1.invoice_no, store: 'OTONIX Malang' })])).h;
cek('§5 impor melewati invoice korporat', h5.dilewati_korporat, [k1.invoice_no]);
cek('§5 isinya utuh', Number((await satu(`select count(*)::int n from bengkel_sale_lines where invoice_id=$1`, [k1.id])).n), 3);
cek('§5 sumbernya tetap korporat', (await satu(`select sumber from bengkel_sale_invoices where id=$1`, [k1.id])).sumber, 'korporat');

// ===============================================================
console.log('§7 Invoice impor tidak bisa disunting tangan');
// ===============================================================
const idImpor = (await satu(`select id from bengkel_sale_invoices where invoice_no='SRI/OTXM/001'`)).id;
const tolakUbah = await galat(`select simpan_invoice_korporat($1,$2::jsonb)`, [
  BU, JSON.stringify({ ...korp, id: idImpor })
]);
benar('§7 menyunting invoice impor ditolak', /impor Turboly/.test(tolakUbah ?? ''), tolakUbah);
const tolakHapus = await galat(`select hapus_invoice_korporat($1)`, [idImpor]);
// "Sudah saya hapus kok muncul lagi" adalah keadaan yang tidak bisa
// dijelaskan kepada yang mengalaminya.
benar('§7 menghapus invoice impor ditolak', /impor ulang/.test(tolakHapus ?? ''), tolakHapus);
cek('§7 korporat boleh dihapus', await galat(`select hapus_invoice_korporat($1)`, [k1.id]), null);

// ===============================================================
console.log('§8 View laporan');
// ===============================================================
const baris8 = (await q(`select sku, item_type, total, modal, laba from bengkel_penjualan_rinci order by sku`)).rows;
const cari = (sku) => baris8.find((b) => b.sku === sku);
cek('§8 baris bermodal punya laba', Number(cari('OLI.X').laba), 200000);
// NULL, bukan 600000: laporan tidak punya cara membedakan laba penuh dari
// modal yang belum diisi kalau ini 0.
cek('§8 baris tanpa modal: laba NULL', cari('FLT.Y').laba, null);
cek('§8 jasa juga NULL, bukan laba penuh', baris8.find((b) => b.item_type === 'jasa').laba, null);

// ===============================================================
console.log('§9 Wewenang & idempotensi');
// ===============================================================
await jadi(STAFF);
benar('§9 staff tidak bisa mengimpor', /Admin BU/.test(await galat(`select impor_penjualan_bengkel($1,'[]'::jsonb,null)`, [BU]) ?? ''));
benar('§9 staff tidak bisa memetakan store', /Admin BU/.test(await galat(`select petakan_store_bengkel($1,'X',$2)`, [BU, MLG]) ?? ''));
benar('§9 staff tidak bisa mencatat korporat', /admin/i.test(await galat(`select simpan_invoice_korporat($1,$2::jsonb)`, [BU, JSON.stringify(korp)]) ?? ''));
await jadi(ADM_OUT);
cek('§9 admin outlet boleh mencatat korporat di outletnya', await galat(`select simpan_invoice_korporat($1,$2::jsonb)`, [BU, JSON.stringify(korp)]), null);
benar('§9 tapi tidak di outlet lain',
  /admin/i.test(await galat(`select simpan_invoice_korporat($1,$2::jsonb)`, [BU, JSON.stringify({ ...korp, outlet_id: MJK })]) ?? ''));
await jadi(ADMIN);
const sebelum = Number((await satu(`select count(*)::int n from bengkel_sale_lines`)).n);
await jalankan('0185_penjualan_bengkel_rinci.sql');
cek('§9 dijalankan dua kali tidak mengubah data', Number((await satu(`select count(*)::int n from bengkel_sale_lines`)).n), sebelum);

console.log(`\n${gagal === 0 ? '✅' : '❌'} test-migrasi-0185: ${n - gagal}/${n} lulus`);
process.exit(gagal === 0 ? 0 : 1);
