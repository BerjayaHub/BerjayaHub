/**
 * MIGRATION 0187 — MENARIK KEMBALI IMPOR TURBOLY (PGlite).
 *
 *   §1 Tiap impor mendapat nomornya sendiri, dengan ringkasan yang benar.
 *   §2 Pratinjau: berapa yang AKAN hilang, tanpa menghapus apa pun.
 *   §3 Tarik kembali: barisnya hilang, riwayatnya tetap.
 *   §4 Yang sudah DIGANTIKAN impor berikutnya TIDAK ikut tertarik.
 *   §5 Impor pembelian juga bisa ditarik.
 *   §6 Hapus satu dokumen hasil impor; korporat tetap lewat pintunya sendiri.
 *   §7 Wewenang, alasan wajib, tarik dua kali ditolak.
 *   §8 Penjagaan 0185/0186 tidak ada yang hilang saat fungsinya ditulis ulang.
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
for (const m of ['0185_penjualan_bengkel_rinci.sql', '0186_pembelian_bengkel.sql', '0187_tarik_impor_bengkel.sql']) await jalankan(m);

const BU = (await satu(`insert into business_units (name) values ('Bengkel') returning id`)).id;
const MLG = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Malang') returning id`, [BU])).id;
const ADMIN = '11111111-1111-1111-1111-111111111111';
const STAFF = '22222222-2222-2222-2222-222222222222';
await q(`insert into user_profiles (id, full_name) values ($1,'Admin'),($2,'Budi')`, [ADMIN, STAFF]);
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values ($1,$2,null,'bu_admin'),($3,$2,$4,'staff')`, [ADMIN, BU, STAFF, MLG]);
await jadi(ADMIN);
await q(`select petakan_store_bengkel($1,'OTONIX Malang',$2)`, [BU, MLG]);
const ALAMAT = 'Jl. Borobudur 45, Malang';
await q(`select petakan_tujuan_kirim($1,$2,$3)`, [BU, ALAMAT, MLG]);

const inv = (no, o = {}) => ({
  invoice_no: no, tanggal: '2026-10-01', store: 'OTONIX Malang', customer: 'A', nopol: 'N1',
  baris: [{ urut: 1, item_type: 'sparepart', sku: 'X', nama: 'OLI', qty: 1, harga_satuan: 100000, diskon: 0, total: 100000, modal: 60000 }],
  ...o
});
const imporJual = async (invoices, berkas) => (await satu(`select impor_penjualan_bengkel($1,$2::jsonb,$3) as h`, [BU, JSON.stringify(invoices), berkas])).h;
const po = (no, o = {}) => ({ po_no: no, tanggal: '2026-10-01', supplier: 'ABB', kirim_ke: ALAMAT, sku: 'X', nama: 'OLI', qty: 2, harga: 50000, total: 100000, ...o });
const imporBeli = async (baris, berkas) => (await satu(`select impor_pembelian_bengkel($1,$2::jsonb,$3) as h`, [BU, JSON.stringify(baris), berkas])).h;
const nInv = async () => Number((await satu(`select count(*)::int n from bengkel_sale_invoices`)).n);
const nBeli = async () => Number((await satu(`select count(*)::int n from bengkel_purchase_lines`)).n);

// ===============================================================
console.log('§1 Tiap impor punya nomornya');
// ===============================================================
const h1 = await imporJual([inv('SRI/1'), inv('SRI/2')], 'okt-salah.xlsx');
benar('§1 nomor impor dikembalikan', Boolean(h1.run));
const run1 = await satu(`select * from bengkel_import_runs where id=$1`, [h1.run]);
cek('§1 jenisnya penjualan', run1.jenis, 'penjualan');
cek('§1 nama berkas dicatat', run1.berkas, 'okt-salah.xlsx');
cek('§1 jumlah invoice & baris', [run1.invoice, run1.baris], [2, 2]);
cek('§1 nilainya', Number(run1.nilai), 200000);
// `date` dari PGlite datang sebagai objek Date — dibandingkan sebagai ISO,
// bukan sebagai teks mentah yang bentuknya bergantung locale.
const iso = (d) => new Date(d).toISOString().slice(0, 10);
cek('§1 periodenya', [iso(run1.periode_dari), iso(run1.periode_sampai)], ['2026-10-01', '2026-10-01']);
cek('§1 tiap baris menyimpan nomornya', Number((await satu(`select count(*)::int n from bengkel_sale_invoices where import_run_id=$1`, [h1.run])).n), 2);

// ===============================================================
console.log('§2 Pratinjau tidak menghapus apa pun');
// ===============================================================
const pra = (await satu(`select pratinjau_tarik_impor($1) as h`, [h1.run])).h;
cek('§2 menyebut yang akan hilang', [pra.invoice, pra.baris, Number(pra.nilai)], [2, 2, 200000]);
cek('§2 dan tidak menghapus', await nInv(), 2);
cek('§2 belum ditandai tertarik', pra.ditarik_at, null);

// ===============================================================
console.log('§4 Yang sudah digantikan tidak ikut tertarik');
// ===============================================================
// SRI/2 diimpor ulang oleh berkas yang BENAR -> ia pindah ke impor kedua.
const h2 = await imporJual([inv('SRI/2'), inv('SRI/3')], 'okt-benar.xlsx');
cek('§4 impor kedua: satu diganti, satu baru', [h2.invoice_baru, h2.invoice_diganti], [1, 1]);
const pra2 = (await satu(`select pratinjau_tarik_impor($1) as h`, [h1.run])).h;
cek('§4 impor pertama tinggal 1 invoice', pra2.invoice, 1);
cek('§4 dan menyebut berapa yang sudah digantikan', pra2.sudah_digantikan, 1);

// ===============================================================
console.log('§3 Tarik kembali');
// ===============================================================
const tarik = (await satu(`select tarik_impor_bengkel($1,$2) as h`, [h1.run, 'salah periode'])).h;
cek('§3 satu invoice tertarik', tarik.invoice, 1);
// SRI/2 & SRI/3 milik impor kedua -> tidak boleh ikut hilang.
cek('§3 sisa invoice', await nInv(), 2);
cek('§3 SRI/1 hilang', Number((await satu(`select count(*)::int n from bengkel_sale_invoices where invoice_no='SRI/1'`)).n), 0);
cek('§3 barisnya ikut hilang (cascade)', Number((await satu(`select count(*)::int n from bengkel_sale_lines`)).n), 2);
const r1 = await satu(`select ditarik_at, ditarik_by, alasan_tarik from bengkel_import_runs where id=$1`, [h1.run]);
// Riwayatnya TIDAK dihapus: ia satu-satunya yang bisa menjawab siapa
// memasukkan ini dan siapa yang menariknya.
benar('§3 riwayatnya tetap ada & ditandai', Boolean(r1.ditarik_at) && r1.ditarik_by === ADMIN && r1.alasan_tarik === 'salah periode');
benar('§3 menarik dua kali ditolak', /sudah ditarik/.test(await galat(`select tarik_impor_bengkel($1,'lagi')`, [h1.run]) ?? ''));

// ===============================================================
console.log('§5 Impor pembelian juga bisa ditarik');
// ===============================================================
const b1 = await imporBeli([po('PO/1'), po('PO/2')], 'beli-salah.xlsx');
cek('§5 dua PO masuk', await nBeli(), 2);
const praB = (await satu(`select pratinjau_tarik_impor($1) as h`, [b1.run])).h;
cek('§5 pratinjau pembelian', [praB.jenis, praB.invoice, praB.baris, Number(praB.nilai)], ['pembelian', 2, 2, 200000]);
const tarikB = (await satu(`select tarik_impor_bengkel($1,$2) as h`, [b1.run, 'ekspor store, harganya nol'])).h;
cek('§5 dua PO tertarik', [tarikB.invoice, tarikB.baris], [2, 2]);
cek('§5 barisnya hilang', await nBeli(), 0);

// ===============================================================
console.log('§6 Hapus satu dokumen hasil impor');
// ===============================================================
cek('§6 invoice impor boleh dihapus satuan', await galat(`select hapus_dokumen_impor_bengkel($1,'penjualan','SRI/3','salah input di Turboly')`, [BU]), null);
cek('§6 sisa satu invoice', await nInv(), 1);
await imporBeli([po('PO/9')], 'beli.xlsx');
cek('§6 PO impor boleh dihapus satuan', await galat(`select hapus_dokumen_impor_bengkel($1,'pembelian','PO/9','dobel')`, [BU]), null);
cek('§6 PO-nya hilang', await nBeli(), 0);
// Invoice korporat punya pintunya sendiri, yang memeriksa wewenang per OUTLET.
const korp = (await satu(`select simpan_invoice_korporat($1,$2::jsonb) as h`, [BU, JSON.stringify({
  outlet_id: MLG, tanggal: '2026-10-05', customer: 'PT X',
  baris: [{ item_type: 'sparepart', nama: 'FILTER', qty: 1, harga_satuan: 50000, total: 50000, modal: '' }]
})])).h;
benar('§6 korporat ditolak lewat pintu impor',
  /bukan hasil impor/.test(await galat(`select hapus_dokumen_impor_bengkel($1,'penjualan',$2,'coba')`, [BU, korp.invoice_no]) ?? ''));
benar('§6 jenis tak dikenal ditolak', /tidak dikenal/.test(await galat(`select hapus_dokumen_impor_bengkel($1,'apa','X','y')`, [BU]) ?? ''));
benar('§6 dokumen tidak ada ditolak', /tidak ditemukan/.test(await galat(`select hapus_dokumen_impor_bengkel($1,'penjualan','SRI/999','x')`, [BU]) ?? ''));

// ===============================================================
console.log('§7 Wewenang & alasan');
// ===============================================================
const h3 = await imporJual([inv('SRI/10')], 'x.xlsx');
benar('§7 alasan tarik wajib', /[Aa]lasan/.test(await galat(`select tarik_impor_bengkel($1,'  ')`, [h3.run]) ?? ''));
benar('§7 alasan hapus wajib', /[Aa]lasan/.test(await galat(`select hapus_dokumen_impor_bengkel($1,'penjualan','SRI/10','')`, [BU]) ?? ''));
await jadi(STAFF);
benar('§7 staff tidak bisa menarik', /Admin BU/.test(await galat(`select tarik_impor_bengkel($1,'coba')`, [h3.run]) ?? ''));
benar('§7 staff tidak bisa menghapus dokumen', /Admin BU/.test(await galat(`select hapus_dokumen_impor_bengkel($1,'penjualan','SRI/10','coba')`, [BU]) ?? ''));
// Pratinjau boleh dibaca siapa pun yang punya scope BU — ia tidak mengubah apa pun.
cek('§7 staff boleh melihat pratinjau', await galat(`select pratinjau_tarik_impor($1)`, [h3.run]), null);
await jadi(ADMIN);

// ===============================================================
console.log('§8 Penjagaan lama masih utuh');
// ===============================================================
// Store belum dipetakan -> tetap dilewati & dilaporkan (0185).
const h4 = await imporJual([inv('SRI/20', { store: 'OTONIX Mojokerto' })], 'y.xlsx');
cek('§8 store asing tetap dilewati', h4.store_belum_dipetakan, ['OTONIX Mojokerto']);
// Invoice korporat tetap tidak boleh ditimpa impor (0185).
const h5 = await imporJual([inv(korp.invoice_no)], 'z.xlsx');
cek('§8 korporat tetap tidak ditimpa', h5.dilewati_korporat, [korp.invoice_no]);
// Pembelian: alamat belum dipetakan -> pusat & dilaporkan (0186).
const b2 = await imporBeli([po('PO/50', { kirim_ke: 'Jl. Lain 1' })], 'w.xlsx');
cek('§8 alamat asing jadi pusat & dilaporkan', [b2.ke_pusat, b2.alamat_belum_dipetakan], [1, ['Jl. Lain 1']]);
// Baris tanpa SKU tetap masuk (0186).
const b3 = await imporBeli([po('PO/51', { sku: '' })], 'w2.xlsx');
cek('§8 tanpa SKU tetap masuk', [b3.baris, b3.tanpa_sku], [1, 1]);
await jalankan('0187_tarik_impor_bengkel.sql');
cek('§8 dijalankan dua kali tetap aman', await nInv(), await nInv());

console.log(`\n${gagal === 0 ? '✅' : '❌'} test-migrasi-0187: ${n - gagal}/${n} lulus`);
process.exit(gagal === 0 ? 0 : 1);
