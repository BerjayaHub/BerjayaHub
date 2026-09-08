/**
 * MIGRATION 0129 DI POSTGRES SUNGGUHAN (PGlite).
 *
 * ============ YANG DIUJI ============
 *
 *   1. Baris kembar yang SUDAH tersimpan digabung — 100 + 150 = 250, dan
 *      jumlah totalnya tidak berubah.
 *   2. Nota yang sudah LUNAS ikut tergabung. Trigger 0122 menolak perubahan
 *      pada nota lunas; kalau ia tidak dimatikan sementara, migration berhenti
 *      di tengah dan sebagian tabel sudah terlanjur berubah.
 *   3. Kiriman yang sudah diekspor ke ESB ikut tergabung (trigger 0128).
 *   4. Harga nota DIKOSONGKAN kalau salah satu barisnya belum berharga —
 *      bukan diambil dari baris yang kebetulan berharga.
 *   5. `stock_movements` ikut disamakan; kalau tertinggal, layar nota benar
 *      sementara laporan biayanya memakai angka lama.
 *   6. Sesudahnya, bahan kembar DITOLAK — dengan pesan yang menyebut namanya,
 *      bukan galat unique constraint mentah.
 *   7. Dijalankan dua kali tetap aman.
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
  }
};
const benar = (nama, syarat, ket = '') => {
  if (!syarat) { gagal++; console.error(`❌ ${nama}${ket ? ' — ' + ket : ''}`); }
};

const db = new PGlite();
const q = (sql, params) => db.query(sql, params);
const satu = async (sql, params) => (await q(sql, params)).rows[0];
const gagalkan = async (fn) => { try { await fn(); return null; } catch (e) { return String(e.message ?? e); } };

await db.exec(`
  create table products (id uuid primary key default gen_random_uuid(), name text, base_unit text);
  create table stock_orders (id uuid primary key default gen_random_uuid(), code text);
  create table stock_order_items (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null, product_id uuid not null, qty numeric not null);
  create table dispatches (
    id uuid primary key default gen_random_uuid(), code text, esb_exported_at timestamptz);
  create table dispatch_items (
    id uuid primary key default gen_random_uuid(),
    dispatch_id uuid not null, product_id uuid not null, sent_qty numeric, received_qty numeric);
  create table goods_receipts (
    id uuid primary key default gen_random_uuid(), code text, payment_status text default 'belum');
  create table goods_receipt_items (
    id uuid primary key default gen_random_uuid(),
    receipt_id uuid not null, product_id uuid not null,
    qty numeric not null check (qty > 0), unit_cost numeric, line_total numeric, notes text);
  create table stock_movements (
    id uuid primary key default gen_random_uuid(),
    receipt_id uuid, product_id uuid, qty_delta numeric, unit_cost numeric);

  -- Trigger 0122: nota lunas tidak boleh diubah.
  create or replace function tolak_ubah_nota_lunas() returns trigger language plpgsql as $$
  begin
    if exists (select 1 from goods_receipts g
                where g.id = coalesce(new.receipt_id, old.receipt_id) and g.payment_status = 'lunas') then
      raise exception 'Nota ini sudah lunas, isinya tidak bisa diubah.';
    end if;
    return coalesce(new, old);
  end; $$;
  create trigger trg_tolak_ubah_nota_lunas
    before insert or update or delete on goods_receipt_items
    for each row execute function tolak_ubah_nota_lunas();

  -- Trigger 0128: kiriman yang sudah diekspor tidak boleh diubah.
  create or replace function tolak_ubah_kiriman_terekspor() returns trigger language plpgsql as $$
  begin
    if exists (select 1 from dispatches d
                where d.id = coalesce(new.dispatch_id, old.dispatch_id) and d.esb_exported_at is not null) then
      raise exception 'Kiriman ini sudah diekspor ke ESB.';
    end if;
    return coalesce(new, old);
  end; $$;
  create trigger trg_tolak_ubah_kiriman_terekspor
    before insert or update or delete on dispatch_items
    for each row execute function tolak_ubah_kiriman_terekspor();
`);

// ---- Data KEMBAR yang sudah tersimpan, dibuat SEBELUM 0129 dipasang ----
const WORTEL = (await satu(`insert into products (name, base_unit) values ('Wortel','GR') returning id`)).id;
const BERAS = (await satu(`insert into products (name, base_unit) values ('Beras','GR') returning id`)).id;

const ORD = (await satu(`insert into stock_orders (code) values ('OR-001') returning id`)).id;
await q(`insert into stock_order_items (order_id, product_id, qty) values ($1,$2,100), ($1,$2,150), ($1,$3,7)`, [ORD, WORTEL, BERAS]);

const KRM = (await satu(`insert into dispatches (code) values ('KRM-001') returning id`)).id;
const KRM_ESB = (await satu(`insert into dispatches (code) values ('KRM-ESB') returning id`)).id;
await q(`insert into dispatch_items (dispatch_id, product_id, sent_qty, received_qty) values ($1,$2,10,9), ($1,$2,20,null)`, [KRM, WORTEL]);
// Isinya dimasukkan DULU, penanda ekspornya belakangan — triggernya sendiri
// yang melarang menambah baris ke kiriman yang sudah diekspor.
await q(`insert into dispatch_items (dispatch_id, product_id, sent_qty, received_qty) values ($1,$2,5,null), ($1,$2,6,null)`, [KRM_ESB, BERAS]);
await q(`update dispatches set esb_exported_at = now() where id = $1`, [KRM_ESB]);

// Nota LUNAS dengan dua baris berharga, dan nota belum lunas yang salah satu
// barisnya belum berharga.
const NOTA_LUNAS = (await satu(`insert into goods_receipts (code, payment_status) values ('TRM-LUNAS','lunas') returning id`)).id;
const NOTA_BIASA = (await satu(`insert into goods_receipts (code) values ('TRM-BIASA') returning id`)).id;
await q(`update goods_receipts set payment_status = 'belum' where id = $1`, [NOTA_LUNAS]); // isi dulu, baru dilunaskan
await q(`insert into goods_receipt_items (receipt_id, product_id, qty, unit_cost, line_total) values
   ($1,$2,100,50,5000), ($1,$2,150,60,9000)`, [NOTA_LUNAS, WORTEL]);
await q(`update goods_receipts set payment_status = 'lunas' where id = $1`, [NOTA_LUNAS]);
await q(`insert into goods_receipt_items (receipt_id, product_id, qty, unit_cost, line_total) values
   ($1,$2,100,50,5000), ($1,$2,150,null,null)`, [NOTA_BIASA, WORTEL]);
await q(`insert into stock_movements (receipt_id, product_id, qty_delta, unit_cost) values
   ($1,$2,100,50), ($1,$2,150,60)`, [NOTA_LUNAS, WORTEL]);

// Sanity: triggernya memang menggigit sebelum migration jalan.
benar(
  'prasyarat: trigger nota lunas memang aktif',
  /sudah lunas/i.test(await gagalkan(() => q(`update goods_receipt_items set qty = 1 where receipt_id = $1`, [NOTA_LUNAS])) ?? '')
);

const jalankan = async (b) =>
  db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', b), 'utf8').replace(/notify pgrst[^;]*;/g, ''));
await jalankan('0129_satu_bahan_satu_baris.sql');
console.log('  0129 terpasang.');

// =====================================================================
// §1. Order: 100 + 150 = 250, satu baris.
// =====================================================================
const ordItems = (await q(`select product_id, qty from stock_order_items where order_id = $1 order by qty`, [ORD])).rows;
cek('§1 order tinggal dua baris (wortel + beras)', ordItems.length, 2);
const wortelOrd = ordItems.find((r) => r.product_id === WORTEL);
cek('§1 100 + 150 = 250', Number(wortelOrd.qty), 250);
cek('§1 barang yang tidak kembar tidak tersentuh', Number(ordItems.find((r) => r.product_id === BERAS).qty), 7);

// =====================================================================
// §2 & §3. Kiriman — termasuk yang sudah diekspor ke ESB.
// =====================================================================
const kItems = (await q(`select sent_qty, received_qty from dispatch_items where dispatch_id = $1`, [KRM])).rows;
cek('§2 kiriman tinggal satu baris', kItems.length, 1);
cek('§2 sent_qty dijumlahkan', Number(kItems[0].sent_qty), 30);
cek('§2 received_qty dijumlahkan dari yang terisi saja', Number(kItems[0].received_qty), 9);

const kEsb = (await q(`select sent_qty, received_qty from dispatch_items where dispatch_id = $1`, [KRM_ESB])).rows;
cek('§3 kiriman yang sudah diekspor ESB ikut tergabung', kEsb.length, 1);
cek('§3 jumlahnya benar', Number(kEsb[0].sent_qty), 11);
benar(
  '§3 received_qty tetap NULL, bukan 0 — "belum dicatat" berbeda dari "tidak sampai"',
  kEsb[0].received_qty === null,
  `dapat: ${kEsb[0].received_qty}`
);

// Triggernya HIDUP LAGI sesudah migration — dimatikan sementara, bukan dibuang.
benar(
  '§3 trigger 0128 aktif kembali sesudah migration',
  /sudah diekspor/i.test(
    (await gagalkan(() => q(`update dispatch_items set sent_qty = 99 where dispatch_id = $1`, [KRM_ESB]))) ?? ''
  )
);

// =====================================================================
// §2b. Nota LUNAS ikut tergabung.
// =====================================================================
const nLunas = (await q(`select qty, unit_cost, line_total from goods_receipt_items where receipt_id = $1`, [NOTA_LUNAS])).rows;
cek('§2b nota lunas tinggal satu baris', nLunas.length, 1);
cek('§2b qty dijumlahkan', Number(nLunas[0].qty), 250);
cek('§2b harga dijumlahkan', Number(nLunas[0].line_total), 14000);
cek('§2b unit_cost = rata-rata tertimbang (14000/250)', Number(nLunas[0].unit_cost), 56);

benar(
  '§2b trigger 0122 aktif kembali sesudah migration',
  /sudah lunas/i.test((await gagalkan(() => q(`update goods_receipt_items set qty = 1 where receipt_id = $1`, [NOTA_LUNAS]))) ?? '')
);

// =====================================================================
// §4. Harga separuh -> dikosongkan, bukan diambil dari yang berharga.
// =====================================================================
const nBiasa = (await q(`select qty, unit_cost, line_total from goods_receipt_items where receipt_id = $1`, [NOTA_BIASA])).rows;
cek('§4 nota biasa tinggal satu baris', nBiasa.length, 1);
cek('§4 qty tetap dijumlahkan', Number(nBiasa[0].qty), 250);
benar('§4 line_total DIKOSONGKAN', nBiasa[0].line_total === null, `dapat: ${nBiasa[0].line_total}`);
benar('§4 unit_cost ikut dikosongkan', nBiasa[0].unit_cost === null, `dapat: ${nBiasa[0].unit_cost}`);
benar('§4 dan BUKAN diambil dari baris yang kebetulan berharga', Number(nBiasa[0].line_total) !== 5000);

// =====================================================================
// §5. stock_movements ikut disamakan.
// =====================================================================
const sm = (await q(`select distinct unit_cost from stock_movements where receipt_id = $1`, [NOTA_LUNAS])).rows;
cek('§5 seluruh pergerakan memakai satu biaya yang sama', sm.length, 1);
cek('§5 dan biayanya hasil gabungan, bukan yang lama', Number(sm[0].unit_cost), 56);

// Jumlah stoknya tidak boleh berubah — yang digabung barisnya, bukan barangnya.
cek(
  '§5 total qty di buku besar stok TIDAK berubah',
  Number((await satu(`select sum(qty_delta) as t from stock_movements where receipt_id = $1`, [NOTA_LUNAS])).t),
  250
);

// =====================================================================
// §6. Sesudahnya bahan kembar ditolak, dengan pesan yang menyebut namanya.
// =====================================================================
const tolakOrd = await gagalkan(() =>
  q(`insert into stock_order_items (order_id, product_id, qty) values ($1,$2,5)`, [ORD, WORTEL])
);
benar('§6 order: bahan kembar ditolak', tolakOrd !== null);
benar('§6 order: pesannya menyebut NAMA bahannya', /Wortel/.test(tolakOrd ?? ''), `dapat: ${tolakOrd}`);
benar('§6 order: bukan galat unique constraint mentah', !/duplicate key|unique constraint/i.test(tolakOrd ?? ''), `dapat: ${tolakOrd}`);

const tolakKrm = await gagalkan(() =>
  q(`insert into dispatch_items (dispatch_id, product_id, sent_qty) values ($1,$2,1)`, [KRM, WORTEL])
);
benar('§6 surat jalan: bahan kembar ditolak, menyebut namanya', /Wortel/.test(tolakKrm ?? ''), `dapat: ${tolakKrm}`);

const tolakNota = await gagalkan(() =>
  q(`insert into goods_receipt_items (receipt_id, product_id, qty) values ($1,$2,1)`, [NOTA_BIASA, WORTEL])
);
benar('§6 nota: bahan kembar ditolak, menyebut namanya', /Wortel/.test(tolakNota ?? ''), `dapat: ${tolakNota}`);

// Produk BERBEDA di dokumen yang sama tetap boleh — kalau ini ikut tertolak,
// seluruh aplikasi berhenti bisa membuat order lebih dari satu barang.
//
// Produknya harus yang BENAR-BENAR belum ada di order itu. Versi pertama
// pemeriksaan ini memakai BERAS, yang sudah ada di ORD sejak awal — jadi ia
// menuduh penjagaan yang bekerja dengan benar.
const KOPI = (await satu(`insert into products (name, base_unit) values ('Kopi','GR') returning id`)).id;
benar(
  '§6 produk yang belum ada di dokumen itu tetap bisa ditambah',
  (await gagalkan(() => q(`insert into stock_order_items (order_id, product_id, qty) values ($1,$2,3)`, [ORD, KOPI]))) === null
);

// Produk yang sama di dokumen BERBEDA tetap boleh.
const ORD2 = (await satu(`insert into stock_orders (code) values ('OR-002') returning id`)).id;
benar(
  '§6 produk sama di order LAIN tetap boleh',
  (await gagalkan(() => q(`insert into stock_order_items (order_id, product_id, qty) values ($1,$2,5)`, [ORD2, WORTEL]))) === null
);

// =====================================================================
// §7. Dijalankan ulang tetap aman.
// =====================================================================
const ulang = await gagalkan(() => jalankan('0129_satu_bahan_satu_baris.sql'));
benar('§7 dijalankan dua kali tidak melempar', ulang === null, `dapat: ${ulang}`);
cek(
  '§7 dan tidak mengubah apa pun untuk kedua kalinya',
  Number((await satu(`select qty from stock_order_items where order_id = $1 and product_id = $2`, [ORD, WORTEL])).qty),
  250
);

if (gagal === 0) console.log('Migration 0129 di Postgres sungguhan: 7 bagian LULUS. ✅');
process.exit(gagal === 0 ? 0 : 1);
