/**
 * MIGRATION 0186 — PEMBELIAN SPAREPART BENGKEL (PGlite).
 *
 *   §1 Impor pertama: baris masuk, outlet dari pemetaan `Deliver To`.
 *   §2 Alamat belum dipetakan -> outlet NULL (pusat) + dilaporkan balik.
 *   §3 Memetakan alamat MEMBETULKAN baris yang sudah terlanjur masuk.
 *   §4 Impor ulang MENGGANTI isi PO, bukan menggandakan.
 *   §5 Baris tanpa SKU tetap masuk & dihitung; tanpa PO/tanggal dilewati.
 *   §6 Harga NULL ≠ 0, dan `nilai` di view mengikuti keduanya.
 *   §7 Wewenang & idempotensi migrationnya.
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
await jalankan('0185_penjualan_bengkel_rinci.sql');
await jalankan('0186_pembelian_bengkel.sql');

const BU = (await satu(`insert into business_units (name) values ('Bengkel') returning id`)).id;
const MLG = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Otonix Malang') returning id`, [BU])).id;
const ADMIN = '11111111-1111-1111-1111-111111111111';
const STAFF = '22222222-2222-2222-2222-222222222222';
await q(`insert into user_profiles (id, full_name) values ($1,'Admin'),($2,'Budi')`, [ADMIN, STAFF]);
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values ($1,$2,null,'bu_admin'),($3,$2,$4,'staff')`, [ADMIN, BU, STAFF, MLG]);

const ALAMAT = 'Jl. Borobudur 45, Blimbing, Malang, Jawa Timur';
const b = (o = {}) => ({ po_no: 'PO/HO/26100001', tanggal: '2026-10-01', supplier: '7 BERKAT', supplier_kode: 'S28',
  status: 'Received', pengirim: 'LUTFAN', warehouse: 'AWAL BERJAYA BENGKEL', kirim_ke: ALAMAT,
  sku: 'SB.INNV', nama: 'SHOCK BAGASI INNOVA', product_type: 'PART', qty: 1, harga: 200000, total: 200000, ...o });
const impor = (baris, berkas = 'okt.xlsx') =>
  satu(`select impor_pembelian_bengkel($1,$2::jsonb,$3) as h`, [BU, JSON.stringify(baris), berkas]);
const jumlah = async () => Number((await satu(`select count(*)::int n from bengkel_purchase_lines`)).n);

await jadi(ADMIN);

// ===============================================================
console.log('§1–§2 Impor & alamat belum dipetakan');
// ===============================================================
const h1 = (await impor([b(), b({ sku: 'SK.CVC', nama: 'SEAL KOKEL', harga: 45000, total: 45000 })])).h;
cek('§1 satu PO baru, dua baris', [h1.po_baru, h1.baris], [1, 2]);
// Alamatnya belum dipetakan -> masuk sebagai pembelian PUSAT, dan alamatnya
// dilaporkan balik. Menebaknya ke outlet mana pun akan membebankan pembelian
// cabang lain ke cabang ini, dan angkanya tetap terlihat masuk akal.
cek('§2 keduanya jadi pembelian pusat', h1.ke_pusat, 2);
cek('§2 alamatnya dilaporkan balik', h1.alamat_belum_dipetakan, [ALAMAT]);
cek('§2 outlet_id null', (await satu(`select count(*)::int n from bengkel_purchase_lines where outlet_id is null`)).n, 2);

// ===============================================================
console.log('§3 Memetakan alamat membetulkan yang sudah masuk');
// ===============================================================
const pet = (await satu(`select petakan_tujuan_kirim($1,$2,$3) as h`, [BU, ALAMAT, MLG])).h;
// Tanpa ini, pemetaan hanya berlaku untuk impor BERIKUTNYA — dan yang sudah
// masuk tetap "pusat" selamanya, padahal orangnya baru saja menyebut outletnya.
cek('§3 dua baris lama ikut dibetulkan', Number(pet.baris_dibetulkan), 2);
cek('§3 tidak ada lagi yang pusat', (await satu(`select count(*)::int n from bengkel_purchase_lines where outlet_id is null`)).n, 0);
// Alamat dengan spasi ganda / huruf beda adalah alamat yang sama.
const h3 = (await impor([b({ po_no: 'PO/HO/26100002', kirim_ke: '  jl. borobudur 45,  blimbing, MALANG, Jawa Timur ' })])).h;
cek('§3 alamat beda huruf & spasi tetap dikenali', h3.ke_pusat, 0);
cek('§3 dan tidak dilaporkan sebagai belum dipetakan', h3.alamat_belum_dipetakan, []);

// ===============================================================
console.log('§4 Impor ulang MENGGANTI');
// ===============================================================
const h4 = (await impor([b()])).h;
cek('§4 dihitung sebagai PO diganti', [h4.po_baru, h4.po_diganti], [0, 1]);
// PO yang semula 2 baris, diimpor ulang dengan 1 baris -> sisanya ikut hilang.
cek('§4 isi lamanya dibuang', Number((await satu(`select count(*)::int n from bengkel_purchase_lines where po_no='PO/HO/26100001'`)).n), 1);
cek('§4 PO lain tidak tersentuh', Number((await satu(`select count(*)::int n from bengkel_purchase_lines where po_no='PO/HO/26100002'`)).n), 1);
// Dua baris SKU sama dalam satu PO tetap dua baris (urutnya yang membedakan).
await impor([b({ po_no: 'PO/HO/26100003' }), b({ po_no: 'PO/HO/26100003' })]);
cek('§4 SKU kembar dalam satu PO tetap dua baris', Number((await satu(`select count(*)::int n from bengkel_purchase_lines where po_no='PO/HO/26100003'`)).n), 2);
cek('§4 urutnya 1 & 2', (await q(`select urut from bengkel_purchase_lines where po_no='PO/HO/26100003' order by urut`)).rows.map((x) => x.urut), [1, 2]);

// ===============================================================
console.log('§5 Baris tanpa SKU & baris cacat');
// ===============================================================
const h5 = (await impor([
  b({ po_no: 'PO/HO/26100004', sku: '' }),
  b({ po_no: '' }),
  b({ po_no: 'PO/HO/26100005', tanggal: '' })
])).h;
// Tanpa SKU: pembeliannya nyata dan nilainya harus ikut terhitung. Yang hilang
// cuma kemampuan mencocokkannya — dan itu dikatakan, bukan dibuang.
cek('§5 tanpa SKU tetap masuk & dihitung', [h5.baris, h5.tanpa_sku], [1, 1]);
cek('§5 tanpa PO / tanpa tanggal dilewati', h5.dilewati, 2);

// ===============================================================
console.log('§6 Harga NULL vs 0');
// ===============================================================
await impor([
  b({ po_no: 'PO/HO/26100010', sku: 'A', harga: null, total: null, qty: 3 }),
  b({ po_no: 'PO/HO/26100011', sku: 'B', harga: 0, total: 0, qty: 2 }),
  b({ po_no: 'PO/HO/26100012', sku: 'C', harga: 1000, total: null, qty: 4 })
]);
const v = (sku) => satu(`select harga, nilai from bengkel_pembelian_rinci where sku=$1`, [sku]);
cek('§6 harga kosong tetap null', (await v('A')).harga, null);
// 0 di sini akan membuat nilai pembelian terlihat lebih kecil daripada
// kenyataannya — dan tidak ada yang akan mencurigainya.
cek('§6 nilainya juga null, bukan 0', (await v('A')).nilai, null);
cek('§6 harga nol tetap nol', Number((await v('B')).harga), 0);
cek('§6 nilai nol', Number((await v('B')).nilai), 0);
cek('§6 total kosong dihitung harga × qty', Number((await v('C')).nilai), 4000);

// ===============================================================
console.log('§7 Wewenang & idempotensi');
// ===============================================================
await jadi(STAFF);
benar('§7 staff tidak bisa mengimpor', /Admin BU/.test(await galat(`select impor_pembelian_bengkel($1,'[]'::jsonb,null)`, [BU]) ?? ''));
benar('§7 staff tidak bisa memetakan alamat', /Admin BU/.test(await galat(`select petakan_tujuan_kirim($1,$2,$3)`, [BU, 'X', MLG]) ?? ''));
await jadi(ADMIN);
// Pemetaan `store` (0185) dan `kirim` (0186) hidup berdampingan walau namanya
// kebetulan sama — itu sebabnya `jenis` ikut jadi kunci uniknya.
cek('§7 nama yang sama boleh ada di dua jenis', await galat(`select petakan_store_bengkel($1,$2,$3)`, [BU, ALAMAT, MLG]), null);
cek('§7 keduanya tersimpan', Number((await satu(`select count(*)::int n from bengkel_store_map where lower(btrim(store_name))=lower($1)`, [ALAMAT])).n), 2);
const sebelum = await jumlah();
await jalankan('0186_pembelian_bengkel.sql');
cek('§7 dijalankan dua kali tidak mengubah data', await jumlah(), sebelum);

console.log(`\n${gagal === 0 ? '✅' : '❌'} test-migrasi-0186: ${n - gagal}/${n} lulus`);
process.exit(gagal === 0 ? 0 : 1);
