/**
 * MIGRATION 0142 DI POSTGRES SUNGGUHAN (PGlite).
 *
 * ============ YANG DIUJI ============
 *
 *   §1 Cicilan: dua staff mengecek bagian berbeda dari SATU SJ, dan tidak
 *      saling menimpa. Inilah yang diminta.
 *   §2 Jejak pengecek tidak terhapus saat orang lain menyimpan ulang baris yang
 *      sama tanpa mengubah angkanya.
 *   §3 Simpan Sementara TIDAK menggerakkan satu gram stok pun.
 *   §4 `receive_dispatch` MENOLAK selama masih ada baris yang belum dicek, dan
 *      menyebut nama barangnya.
 *   §5 Setelah semua dicek: stok bergerak sekali, susutnya benar, dan nol yang
 *      DISENGAJA tidak tertukar dengan belum dicek.
 *   §6 Izin: hanya outlet tujuan; draft & yang sudah diterima ditolak.
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
  if (!syarat) {
    gagal++;
    console.error(`❌ ${nama}${ket ? ' — ' + ket : ''}`);
  }
};

const db = new PGlite();
const q = (sql, params) => db.query(sql, params);
const satu = async (sql, params) => (await q(sql, params)).rows[0];
const galat = async (sql, params) => {
  try {
    await q(sql, params);
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
  create table products (id uuid primary key default gen_random_uuid(), name text, base_unit text);
  create table dispatches (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, from_outlet_id uuid, to_outlet_id uuid,
    code text, status text default 'sent', notes text,
    esb_exported_at timestamptz, received_by uuid, received_at timestamptz,
    created_by uuid, created_at timestamptz default now());
  create table dispatch_items (
    id uuid primary key default gen_random_uuid(),
    dispatch_id uuid references dispatches(id) on delete cascade,
    product_id uuid, sent_qty numeric not null, received_qty numeric,
    keterangan text, ordered_qty numeric);
  create table stock_movements (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, outlet_id uuid, product_id uuid, movement_type text,
    qty_delta numeric, ref_outlet_id uuid, dispatch_id uuid, notes text,
    created_by uuid, created_at timestamptz default now());

  -- Tiruan 0001. "security definer" supaya kebijakan yang memanggilnya tidak
  -- mati kena izin tabel, persis seperti aslinya.
  create or replace function has_outlet_scope(p_uid uuid, p_outlet uuid) returns boolean
    language sql security definer stable as $$
      select exists (
        select 1 from membership_scopes ms join outlets o on o.id = p_outlet
         where ms.user_id = p_uid
           and (ms.role = 'super_admin'
                or (ms.business_unit_id = o.business_unit_id and ms.role = 'bu_admin')
                or ms.outlet_id = p_outlet)) $$;
`);

const jalankan = async (b) =>
  db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', b), 'utf8').replace(/notify pgrst[^;]*;/g, ''));

await jalankan('0142_cek_kiriman_bisa_dicicil.sql');
console.log('  0142 terpasang.');
await jalankan('0142_cek_kiriman_bisa_dicicil.sql');
console.log('  dijalankan ulang: aman.');

// =====================================================================
// DATA
// =====================================================================
const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const CK = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Central Kitchen') returning id`, [BU])).id;
const SENTUL = (await satu(`insert into outlets (business_unit_id, name) values ($1,'AB Sentul') returning id`, [BU])).id;

const RISMA = '11111111-1111-1111-1111-111111111111';
const ADHE = '22222222-2222-2222-2222-222222222222';
const ORANG_CK = '33333333-3333-3333-3333-333333333333';
await q(`insert into user_profiles (id, full_name) values ($1,'Risma'), ($2,'Adhe'), ($3,'Orang CK')`, [RISMA, ADHE, ORANG_CK]);
await q(
  `insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values
     ($1,$4,$5,'staff'), ($2,$4,$5,'staff'), ($3,$4,$6,'staff')`,
  [RISMA, ADHE, ORANG_CK, BU, SENTUL, CK]
);

const SANTAN = (await satu(`insert into products (name, base_unit) values ('Santan','ml') returning id`)).id;
const BERAS = (await satu(`insert into products (name, base_unit) values ('Beras','gr') returning id`)).id;
const TEPUNG = (await satu(`insert into products (name, base_unit) values ('Tepung','gr') returning id`)).id;

const buatSJ = async (status = 'sent') => {
  const d = (
    await satu(
      `insert into dispatches (business_unit_id, from_outlet_id, to_outlet_id, code, status, created_by)
       values ($1,$2,$3,'SJ-001',$4,$5) returning id`,
      [BU, CK, SENTUL, status, ORANG_CK]
    )
  ).id;
  const items = {};
  for (const [p, qty] of [[SANTAN, 400], [BERAS, 1000], [TEPUNG, 2000]]) {
    items[p] = (
      await satu(`insert into dispatch_items (dispatch_id, product_id, sent_qty) values ($1,$2,$3) returning id`, [d, p, qty])
    ).id;
  }
  return { d, items };
};

const sebagai = (uid) => q(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
const cekKiriman = (d, items) => q(`select simpan_cek_kiriman($1, $2::jsonb) as h`, [d, JSON.stringify(items)]);
const gerakan = async (d) => Number((await satu(`select count(*)::int as n from stock_movements where dispatch_id = $1`, [d])).n);

// =====================================================================
// §1 DUA STAFF, SATU SJ, BAGIAN BERBEDA — inti permintaannya
// =====================================================================
const A = await buatSJ();
await sebagai(RISMA);
await cekKiriman(A.d, [{ item_id: A.items[SANTAN], dicek_qty: 400 }]);

await sebagai(ADHE);
await cekKiriman(A.d, [{ item_id: A.items[BERAS], dicek_qty: 950 }]);

{
  const baris = (await q(`select product_id, dicek_qty, dicek_by from dispatch_items where dispatch_id = $1 order by product_id`, [A.d])).rows;
  const per = Object.fromEntries(baris.map((r) => [r.product_id, r]));
  cek('§1 hitungan Risma tersimpan', Number(per[SANTAN].dicek_qty), 400);
  cek('§1 dan atas namanya', per[SANTAN].dicek_by, RISMA);
  cek('§1 hitungan Adhe tersimpan', Number(per[BERAS].dicek_qty), 950);
  cek('§1 dan atas namanya', per[BERAS].dicek_by, ADHE);
  // YANG TIDAK DIKIRIM TIDAK DISENTUH. Kalau baris yang kuncinya tidak ada
  // ikut dikosongkan, staff kedua akan MENGHAPUS hitungan staff pertama.
  cek('§1 baris yang belum dicek tetap NULL', per[TEPUNG].dicek_qty, null);
}

// =====================================================================
// §2 JEJAK PENGECEK TIDAK TERHAPUS
// =====================================================================
{
  // Adhe menyimpan SELURUH formulir, termasuk baris Risma yang angkanya sama.
  await cekKiriman(A.d, [
    { item_id: A.items[SANTAN], dicek_qty: 400 },
    { item_id: A.items[BERAS], dicek_qty: 950 }
  ]);
  const r = await satu(`select dicek_by from dispatch_items where id = $1`, [A.items[SANTAN]]);
  cek('§2 nama Risma tidak ditimpa Adhe', r.dicek_by, RISMA);
}
{
  // Tapi kalau angkanya BENAR-BENAR diubah, namanya ikut berpindah — itu
  // hitungan baru, dan yang bertanggung jawab atasnya orang yang baru.
  await cekKiriman(A.d, [{ item_id: A.items[SANTAN], dicek_qty: 390 }]);
  const r = await satu(`select dicek_qty, dicek_by from dispatch_items where id = $1`, [A.items[SANTAN]]);
  cek('§2 angka berubah -> nama ikut', [Number(r.dicek_qty), r.dicek_by], [390, ADHE]);
}
{
  // Batalkan cek: nilainya null, dan jejaknya ikut dibersihkan supaya tidak ada
  // nama yang menempel pada hitungan yang sudah tidak ada.
  await cekKiriman(A.d, [{ item_id: A.items[SANTAN], dicek_qty: null }]);
  const r = await satu(`select dicek_qty, dicek_by, dicek_at from dispatch_items where id = $1`, [A.items[SANTAN]]);
  cek('§2 cek bisa dibatalkan', [r.dicek_qty, r.dicek_by, r.dicek_at], [null, null, null]);
  await cekKiriman(A.d, [{ item_id: A.items[SANTAN], dicek_qty: 400 }]);
}

// =====================================================================
// §3 SIMPAN SEMENTARA TIDAK MENGGERAKKAN STOK
// =====================================================================
cek('§3 tidak ada satu pergerakan stok pun', await gerakan(A.d), 0);
cek('§3 dan SJ-nya masih berstatus sent', (await satu(`select status from dispatches where id = $1`, [A.d])).status, 'sent');

// =====================================================================
// §4 TERIMA MENOLAK SELAMA MASIH ADA YANG BELUM DICEK
// =====================================================================
{
  const e = await galat(`select receive_dispatch($1, '[]'::jsonb)`, [A.d]);
  benar('§4 ditolak', !!e);
  // Namanya disebut — "3 bahan belum dicek" membuat orangnya menyisir ulang
  // seluruh tabel; menyebut namanya langsung menunjuk barisnya.
  benar('§4 dan menyebut nama barangnya', (e ?? '').includes('Tepung'), e);
  cek('§4 stok tetap tidak bergerak', await gerakan(A.d), 0);
  cek('§4 status tetap sent', (await satu(`select status from dispatches where id = $1`, [A.d])).status, 'sent');
}

// =====================================================================
// §5 SETELAH LENGKAP — STOK BERGERAK SEKALI, SUSUTNYA BENAR
//
// Tepung dicek 0 DENGAN SENGAJA: barangnya memang tidak datang. Itu harus
// terbedakan dari "belum dicek", dan §4 barusan membuktikan bedanya.
// =====================================================================
{
  const h = await satu(`select receive_dispatch($1, $2::jsonb) as r`, [
    A.d,
    JSON.stringify([{ item_id: A.items[TEPUNG], dicek_qty: 0 }])
  ]);
  // Santan 400/400 pas, Beras 950/1000 kurang 50, Tepung 0/2000 kurang 2000.
  cek('§5 susutnya dijumlahkan', Number(h.r.susut), 2050);
  cek('§5 status jadi received', (await satu(`select status from dispatches where id = $1`, [A.d])).status, 'received');

  const gerak = (await q(`select movement_type, outlet_id, qty_delta, product_id from stock_movements where dispatch_id = $1`, [A.d])).rows;
  // CK berkurang sebesar YANG DIKIRIM (3 baris), outlet bertambah sebesar YANG
  // DITERIMA — Tepung 0 tidak menghasilkan baris masuk.
  cek('§5 CK berkurang 3 baris', gerak.filter((g) => g.movement_type === 'transfer_out').length, 3);
  cek('§5 outlet bertambah 2 baris', gerak.filter((g) => g.movement_type === 'transfer_in').length, 2);
  cek(
    '§5 tepung tidak menambah stok outlet',
    gerak.filter((g) => g.movement_type === 'transfer_in' && g.product_id === TEPUNG).length,
    0
  );
  cek(
    '§5 santan masuk 400',
    Number(gerak.find((g) => g.movement_type === 'transfer_in' && g.product_id === SANTAN).qty_delta),
    400
  );
  cek('§5 received_qty tercatat', Number((await satu(`select received_qty from dispatch_items where id = $1`, [A.items[BERAS]])).received_qty), 950);
}
{
  // Tidak bisa diterima dua kali.
  const e = await galat(`select receive_dispatch($1, '[]'::jsonb)`, [A.d]);
  benar('§5 tidak bisa diterima dua kali', (e ?? '').includes('sudah diproses'), e);
  benar('§5 dan cek tidak bisa diubah lagi', (await galat(`select simpan_cek_kiriman($1, '[]'::jsonb)`, [A.d]) ?? '').includes('sudah diproses'));
}

// =====================================================================
// §6 IZIN & STATUS
// =====================================================================
{
  const B = await buatSJ();
  await sebagai(ORANG_CK);
  const e = await galat(`select simpan_cek_kiriman($1, $2::jsonb)`, [B.d, JSON.stringify([{ item_id: B.items[SANTAN], dicek_qty: 1 }])]);
  benar('§6 orang CK tidak boleh mengecek kiriman outlet', (e ?? '').includes('outlet tujuan'), e);
  benar(
    '§6 dan tidak boleh menerimanya',
    (await galat(`select receive_dispatch($1, '[]'::jsonb)`, [B.d]) ?? '').includes('outlet tujuan')
  );
}
{
  const C = await buatSJ('draft');
  await sebagai(RISMA);
  benar('§6 draft belum bisa dicek', (await galat(`select simpan_cek_kiriman($1, '[]'::jsonb)`, [C.d]) ?? '').includes('masih draft'));
}
{
  // Nilai negatif dijepit ke 0, bukan disimpan apa adanya — jumlah diterima
  // yang negatif akan menambah stok ke arah yang salah.
  const D = await buatSJ();
  await sebagai(RISMA);
  await cekKiriman(D.d, [{ item_id: D.items[SANTAN], dicek_qty: -5 }]);
  cek('§6 negatif dijepit ke 0', Number((await satu(`select dicek_qty from dispatch_items where id = $1`, [D.items[SANTAN]])).dicek_qty), 0);
}
{
  // Kunci `dicek_qty` yang TIDAK ADA berarti "tidak sedang saya sentuh".
  const E = await buatSJ();
  await sebagai(RISMA);
  await cekKiriman(E.d, [{ item_id: E.items[SANTAN], dicek_qty: 100 }]);
  await cekKiriman(E.d, [{ item_id: E.items[SANTAN] }]);
  cek(
    '§6 baris tanpa kunci dicek_qty tidak dihapus',
    Number((await satu(`select dicek_qty from dispatch_items where id = $1`, [E.items[SANTAN]])).dicek_qty),
    100
  );
}

// Penjaga bentuk tunggal.
for (const fn of ['simpan_cek_kiriman', 'receive_dispatch']) {
  const n = (
    await q(
      `select count(*)::int as n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
        where ns.nspname = 'public' and p.proname = $1`,
      [fn]
    )
  ).rows[0].n;
  cek(`§6 ${fn} hanya satu bentuk`, n, 1);
}

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('0142 benar — pengecekan bisa dicicil dua orang, jejaknya utuh, dan penerimaan menolak menebak baris yang belum dihitung. ✅');
