/**
 * MIGRATION 0188 — TARIK IMPOR SAMPAI DOKUMEN YANG SUDAH DIGANTIKAN (PGlite).
 *
 *   §1 Nomor dokumen tiap berkas DISIMPAN saat impor.
 *   §2 Pratinjau menyebut DUA angka: milik impor ini vs sudah digantikan.
 *   §3 Tarik biasa (0187) tidak berubah perilakunya.
 *   §4 Tarik menyeluruh menghapus SEMUA nomor yang ada di berkas itu.
 *   §5 Invoice KORPORAT tidak pernah ikut terbawa.
 *   §6 Pembelian: menyeluruh juga bekerja.
 *   §7 Cara penarikannya tercatat di riwayat.
 *   §8 Tanda tangan lama dibuang; penjagaan 0185–0187 masih utuh.
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
for (const m of ['0185_penjualan_bengkel_rinci.sql', '0186_pembelian_bengkel.sql', '0187_tarik_impor_bengkel.sql', '0188_tarik_impor_menyeluruh.sql']) await jalankan(m);

const BU = (await satu(`insert into business_units (name) values ('Bengkel') returning id`)).id;
const MLG = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Malang') returning id`, [BU])).id;
const ADMIN = '11111111-1111-1111-1111-111111111111';
await q(`insert into user_profiles (id, full_name) values ($1,'Admin')`, [ADMIN]);
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values ($1,$2,null,'bu_admin')`, [ADMIN, BU]);
await jadi(ADMIN);
await q(`select petakan_store_bengkel($1,'OTONIX Malang',$2)`, [BU, MLG]);
const ALAMAT = 'Jl. Borobudur 45';
await q(`select petakan_tujuan_kirim($1,$2,$3)`, [BU, ALAMAT, MLG]);

const inv = (no, total = 100000) => ({
  invoice_no: no, tanggal: '2026-10-01', store: 'OTONIX Malang', customer: 'A', nopol: 'N1',
  baris: [{ urut: 1, item_type: 'sparepart', sku: 'X', nama: 'OLI', qty: 1, harga_satuan: total, diskon: 0, total, modal: 60000 }]
});
const imporJual = async (list, berkas) => (await satu(`select impor_penjualan_bengkel($1,$2::jsonb,$3) as h`, [BU, JSON.stringify(list), berkas])).h;
const po = (no) => ({ po_no: no, tanggal: '2026-10-01', supplier: 'ABB', kirim_ke: ALAMAT, sku: 'X', nama: 'OLI', qty: 2, harga: 50000, total: 100000 });
const imporBeli = async (list, berkas) => (await satu(`select impor_pembelian_bengkel($1,$2::jsonb,$3) as h`, [BU, JSON.stringify(list), berkas])).h;
const adaInv = async (no) => Number((await satu(`select count(*)::int n from bengkel_sale_invoices where invoice_no=$1`, [no])).n);
const nInv = async () => Number((await satu(`select count(*)::int n from bengkel_sale_invoices`)).n);

// ===============================================================
console.log('§1 Nomor dokumen disimpan saat impor');
// ===============================================================
const A = await imporJual([inv('SRI/1'), inv('SRI/2'), inv('SRI/3')], 'salah.xlsx');
const runA = await satu(`select nomor_dokumen, invoice, baris from bengkel_import_runs where id=$1`, [A.run]);
cek('§1 ketiga nomornya tercatat', runA.nomor_dokumen, ['SRI/1', 'SRI/2', 'SRI/3']);
cek('§1 ringkasannya tetap benar', [runA.invoice, runA.baris], [3, 3]);

// ===============================================================
console.log('§2 Pratinjau dua angka');
// ===============================================================
// Berkas BENAR menimpa SRI/2 & SRI/3 -> keduanya pindah ke impor B.
const B = await imporJual([inv('SRI/2', 250000), inv('SRI/3', 250000)], 'benar.xlsx');
const pra = (await satu(`select pratinjau_tarik_impor($1) as h`, [A.run])).h;
cek('§2 masih milik impor A', pra.invoice, 1);
cek('§2 nomor yang ada di berkasnya', pra.nomor_di_berkas, 3);
cek('§2 sudah digantikan', pra.sudah_digantikan, 2);
cek('§2 beserta baris & nilainya', [pra.digantikan_baris, Number(pra.digantikan_nilai)], [2, 500000]);

// ===============================================================
console.log('§3 Tarik BIASA tidak berubah');
// ===============================================================
const t1 = (await satu(`select tarik_impor_bengkel($1,$2,false) as h`, [A.run, 'salah periode'])).h;
cek('§3 cuma miliknya sendiri', [t1.invoice, t1.ikut_terhapus], [1, 0]);
cek('§3 SRI/1 hilang', await adaInv('SRI/1'), 0);
// Data dari berkas yang BENAR tidak boleh ikut terbawa.
cek('§3 SRI/2 & SRI/3 selamat', await nInv(), 2);
cek('§3 nilainya tetap dari berkas benar', Number((await satu(`select total from bengkel_sale_lines l join bengkel_sale_invoices i on i.id=l.invoice_id where i.invoice_no='SRI/2'`)).total), 250000);

// ===============================================================
console.log('§4 Tarik MENYELURUH');
// ===============================================================
const C = await imporJual([inv('SRI/10'), inv('SRI/11')], 'dobel.xlsx');
const D = await imporJual([inv('SRI/10', 999000), inv('SRI/12')], 'dobel-lagi.xlsx');
const praC = (await satu(`select pratinjau_tarik_impor($1) as h`, [C.run])).h;
cek('§4 C tinggal 1 miliknya', [praC.invoice, praC.sudah_digantikan], [1, 1]);
const t2 = (await satu(`select tarik_impor_bengkel($1,$2,true) as h`, [C.run, 'dobel upload'])).h;
cek('§4 miliknya sendiri + yang digantikan', [t2.invoice, t2.ikut_terhapus], [1, 1]);
// SELURUH nomor yang ada di berkas C hilang — termasuk SRI/10 yang sudah
// jadi milik impor D.
cek('§4 SRI/10 ikut hilang', await adaInv('SRI/10'), 0);
cek('§4 SRI/11 hilang', await adaInv('SRI/11'), 0);
// SRI/12 TIDAK ada di berkas C, jadi tidak boleh tersentuh.
cek('§4 SRI/12 (tidak ada di berkas itu) selamat', await adaInv('SRI/12'), 1);

// ===============================================================
console.log('§5 Korporat tidak pernah ikut');
// ===============================================================
const korp = (await satu(`select simpan_invoice_korporat($1,$2::jsonb) as h`, [BU, JSON.stringify({
  outlet_id: MLG, tanggal: '2026-10-05', customer: 'PT X',
  baris: [{ item_type: 'sparepart', nama: 'FILTER', qty: 1, harga_satuan: 50000, total: 50000, modal: '' }]
})])).h;
// Berkas yang (mustahil, tapi diuji) memuat nomor korporat.
const E = await imporJual([inv(korp.invoice_no), inv('SRI/20')], 'nakal.xlsx');
await satu(`select tarik_impor_bengkel($1,$2,true) as h`, [E.run, 'uji korporat']);
cek('§5 invoice korporat tetap ada', Number((await satu(`select count(*)::int n from bengkel_sale_invoices where id=$1`, [korp.id])).n), 1);
cek('§5 dan sumbernya tetap korporat', (await satu(`select sumber from bengkel_sale_invoices where id=$1`, [korp.id])).sumber, 'korporat');
cek('§5 SRI/20 tetap hilang', await adaInv('SRI/20'), 0);

// ===============================================================
console.log('§6 Pembelian');
// ===============================================================
const P1 = await imporBeli([po('PO/1'), po('PO/2')], 'beli-salah.xlsx');
const P2 = await imporBeli([po('PO/2')], 'beli-benar.xlsx');
const praP = (await satu(`select pratinjau_tarik_impor($1) as h`, [P1.run])).h;
cek('§6 pratinjau pembelian', [praP.invoice, praP.sudah_digantikan], [1, 1]);
const t3 = (await satu(`select tarik_impor_bengkel($1,$2,true) as h`, [P1.run, 'dobel'])).h;
cek('§6 keduanya hilang', [t3.invoice, t3.ikut_terhapus], [1, 1]);
cek('§6 tidak ada baris pembelian tersisa', Number((await satu(`select count(*)::int n from bengkel_purchase_lines`)).n), 0);

// ===============================================================
console.log('§7–§8 Jejak, tanda tangan lama, penjagaan lama');
// ===============================================================
const r = await satu(`select alasan_tarik from bengkel_import_runs where id=$1`, [C.run]);
// Yang membaca riwayat ini bulan depan perlu tahu apakah data impor LAIN ikut
// terbawa — itu pertanyaan pertama saat ada angka yang hilang.
benar('§7 cara penarikannya tercatat', /menyeluruh/.test(r.alasan_tarik ?? ''), r.alasan_tarik);
const biasa = await satu(`select alasan_tarik from bengkel_import_runs where id=$1`, [A.run]);
benar('§7 tarik biasa tidak ditandai menyeluruh', !/menyeluruh/.test(biasa.alasan_tarik ?? ''));
// Tanda tangan 2-argumen dibuang: PWA lama yang memanggilnya akan mendapat
// galat yang jelas, bukan penarikan yang diam-diam tidak menyeluruh.
cek('§8 tanda tangan lama hilang',
  Number((await satu(`select count(*)::int n from pg_proc where proname='tarik_impor_bengkel' and pronargs=2`)).n), 0);
benar('§8 alasan tetap wajib', /[Aa]lasan/.test(await galat(`select tarik_impor_bengkel($1,'  ',true)`, [D.run]) ?? ''));
benar('§8 tarik dua kali tetap ditolak', /sudah ditarik/.test(await galat(`select tarik_impor_bengkel($1,'lagi',true)`, [C.run]) ?? ''));
// Penjagaan 0185/0186 tidak boleh hilang saat fungsinya ditulis ulang lagi.
const asing = await imporJual([{ ...inv('SRI/90'), store: 'OTONIX Asing' }], 'x.xlsx');
cek('§8 store asing tetap dilewati', asing.store_belum_dipetakan, ['OTONIX Asing']);
const beliAsing = await imporBeli([{ ...po('PO/90'), kirim_ke: 'Jl. Entah' }], 'y.xlsx');
cek('§8 alamat asing tetap jadi pusat', [beliAsing.ke_pusat, beliAsing.alamat_belum_dipetakan], [1, ['Jl. Entah']]);
await jalankan('0188_tarik_impor_menyeluruh.sql');
cek('§8 dijalankan dua kali tetap aman', await nInv(), await nInv());

console.log(`\n${gagal === 0 ? '✅' : '❌'} test-migrasi-0188: ${n - gagal}/${n} lulus`);
process.exit(gagal === 0 ? 0 : 1);
