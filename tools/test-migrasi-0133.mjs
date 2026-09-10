/**
 * MIGRATION 0133 DI POSTGRES SUNGGUHAN (PGlite).
 *
 * ============ YANG DIUJI ============
 *
 *   1. Kiriman 'sent' bisa dibatalkan oleh PENGIRIM maupun PENERIMA.
 *   2. Alasan wajib, dan orang luar ditolak.
 *   3. Kiriman lama (yang stoknya sudah terpotong saat dibuat) mengembalikan
 *      potongan itu — kalau tidak, barangnya hilang dari pembukuan selamanya.
 *   4. Kiriman modern (0103, stok belum bergerak) TIDAK membuat pergerakan
 *      apa pun saat dibatalkan.
 *   5. Yang sudah DITERIMA tidak boleh dibatalkan — diarahkan ke "Teruskan".
 *   6. `teruskan_kiriman` membuat DRAFT baru dari outlet yang salah ke tujuan
 *      yang benar, sebanyak yang BENAR-BENAR diterima, dan tersambung ke
 *      kiriman aslinya.
 *   7. Draft & kiriman yang sudah diekspor ESB ditahan dengan pesan yang
 *      mengarahkan.
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
  create role authenticated;
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;
  create table business_units (id uuid primary key default gen_random_uuid(), name text);
  create table outlets (id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text);
  create table user_profiles (id uuid primary key, full_name text);
  create table products (id uuid primary key default gen_random_uuid(), name text, base_unit text);
  create table stock_movements (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, outlet_id uuid, product_id uuid, movement_type text,
    qty_delta numeric, unit_cost numeric, notes text, created_by uuid,
    dispatch_id uuid, ref_outlet_id uuid, created_at timestamptz default now());
  create table dispatches (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, from_outlet_id uuid, to_outlet_id uuid, code text,
    status text not null default 'sent' check (status in ('draft','sent','received','cancelled')),
    notes text, created_by uuid, created_at timestamptz default now(),
    received_at timestamptz, received_by uuid, stock_order_id uuid, esb_exported_at timestamptz);
  create table dispatch_items (
    id uuid primary key default gen_random_uuid(),
    dispatch_id uuid not null references dispatches(id) on delete cascade,
    product_id uuid not null, sent_qty numeric, received_qty numeric,
    keterangan text, ordered_qty numeric);
  create unique index dispatch_items_produk_uk on dispatch_items(dispatch_id, product_id);

  create or replace function has_outlet_scope(p_uid uuid, p_outlet uuid) returns boolean
    language sql stable as $$
      select exists (select 1 from user_profiles u
                      where u.id = p_uid
                        and (u.full_name = 'SEMUA' or u.full_name = p_outlet::text)); $$;
`);

// 0132 menyediakan `buat_draft_kiriman` yang dipakai `teruskan_kiriman`.
const jalankan = async (b) =>
  db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', b), 'utf8').replace(/notify pgrst[^;]*;/g, ''));
await jalankan('0132_kiriman_nol_dan_keterangan.sql');
await jalankan('0133_kiriman_salah_alamat.sql');
console.log('  0133 terpasang.');
await jalankan('0133_kiriman_salah_alamat.sql');
console.log('  dijalankan ulang: aman.');

const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const SERPONG = (await satu(`insert into outlets (business_unit_id, name) values ($1,'AB Gading Serpong') returning id`, [BU])).id;
const HAMPTON = (await satu(`insert into outlets (business_unit_id, name) values ($1,'AB Hampton') returning id`, [BU])).id;
const CK = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Central Kitchen') returning id`, [BU])).id;

// Wewenang ditiru lewat `full_name`: 'SEMUA' untuk yang berhak di mana pun,
// atau id outletnya untuk yang hanya berhak di satu tempat.
const SUPER = '11111111-1111-1111-1111-111111111111';
const ORANG_SERPONG = '22222222-2222-2222-2222-222222222222';
const ORANG_HAMPTON = '33333333-3333-3333-3333-333333333333';
const ORANG_LUAR = '44444444-4444-4444-4444-444444444444';
await q(`insert into user_profiles (id, full_name) values ($1,'SEMUA'), ($2,$5), ($3,$6), ($4,'bukan siapa-siapa')`,
  [SUPER, ORANG_SERPONG, ORANG_HAMPTON, ORANG_LUAR, SERPONG, HAMPTON]);

const jadi = (uid) => q(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
await jadi(SUPER);

const AYAM = (await satu(`insert into products (name, base_unit) values ('Ayam Fillet','GR') returning id`)).id;
const BERAS = (await satu(`insert into products (name, base_unit) values ('Beras','GR') returning id`)).id;

let n = 0;
async function buatKiriman({ dari = SERPONG, ke = HAMPTON, status = 'sent', items = [[AYAM, 1000, null]], stokSudahDipotong = false } = {}) {
  n += 1;
  const id = (
    await satu(
      `insert into dispatches (business_unit_id, from_outlet_id, to_outlet_id, code, status, created_by, received_at)
       values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [BU, dari, ke, `SJ-${String(n).padStart(3, '0')}`, status, SUPER, status === 'received' ? new Date().toISOString() : null]
    )
  ).id;
  for (const [pid, kirim, terima] of items) {
    await q(`insert into dispatch_items (dispatch_id, product_id, sent_qty, received_qty) values ($1,$2,$3,$4)`, [id, pid, kirim, terima]);
    if (stokSudahDipotong) {
      await q(
        `insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, notes, created_by, dispatch_id)
         values ($1,$2,$3,'transfer_out',$4,'Kiriman lama',$5,$6)`,
        [BU, dari, pid, -kirim, SUPER, id]
      );
    }
  }
  return id;
}

const gerak = async (dispatchId) =>
  Number((await satu(`select coalesce(sum(qty_delta),0) as t from stock_movements where dispatch_id=$1`, [dispatchId])).t);

// =====================================================================
// §1. Dibatalkan oleh PENGIRIM maupun PENERIMA.
// =====================================================================
const A = await buatKiriman();
await jadi(ORANG_SERPONG);
benar('§1 pengirim bisa membatalkan', (await gagalkan(() => q(`select batalkan_kiriman($1,'salah pilih tujuan')`, [A]))) === null);
const rowA = await satu(`select status, alasan_batal, dibatalkan_by from dispatches where id=$1`, [A]);
cek('§1 statusnya cancelled', rowA.status, 'cancelled');
cek('§1 alasannya tersimpan', rowA.alasan_batal, 'salah pilih tujuan');
cek('§1 pelakunya tercatat', rowA.dibatalkan_by, ORANG_SERPONG);

const B = await buatKiriman();
await jadi(ORANG_HAMPTON);
benar(
  '§1 PENERIMA juga bisa menolak — "bukan untuk kami"',
  (await gagalkan(() => q(`select batalkan_kiriman($1,'bukan untuk outlet kami')`, [B]))) === null
);
cek('§1 dan statusnya ikut cancelled', (await satu(`select status from dispatches where id=$1`, [B])).status, 'cancelled');

// =====================================================================
// §2. Alasan wajib & orang luar ditolak.
// =====================================================================
const C = await buatKiriman();
await jadi(ORANG_SERPONG);
for (const alasan of ['', '   ', null]) {
  benar(
    `§2 alasan ${JSON.stringify(alasan)} ditolak`,
    /alasan/i.test((await gagalkan(() => q(`select batalkan_kiriman($1,$2)`, [C, alasan]))) ?? '')
  );
}
await jadi(ORANG_LUAR);
benar(
  '§2 orang luar tidak bisa membatalkan',
  /bukan wewenangmu/i.test((await gagalkan(() => q(`select batalkan_kiriman($1,'iseng')`, [C]))) ?? '')
);
cek('§2 dan statusnya tidak berubah', (await satu(`select status from dispatches where id=$1`, [C])).status, 'sent');

// =====================================================================
// §3. KIRIMAN LAMA: potongan stoknya dikembalikan.
// =====================================================================
const LAMA = await buatKiriman({ stokSudahDipotong: true });
cek('§3 stok pengirim memang sudah terpotong -1000', await gerak(LAMA), -1000);
await jadi(ORANG_SERPONG);
await q(`select batalkan_kiriman($1,'salah alamat')`, [LAMA]);
cek('§3 sesudah dibatalkan, pergerakan bersihnya kembali 0', await gerak(LAMA), 0);
cek(
  '§3 pengembaliannya masuk ke outlet PENGIRIM',
  (await satu(`select outlet_id from stock_movements where dispatch_id=$1 and qty_delta > 0`, [LAMA])).outlet_id,
  SERPONG
);
benar(
  '§3 dan pergerakan lamanya TIDAK dihapus — riwayatnya tetap jujur',
  Number((await satu(`select count(*) as c from stock_movements where dispatch_id=$1`, [LAMA])).c) === 2
);

// =====================================================================
// §4. KIRIMAN MODERN: tidak ada pergerakan sama sekali.
// =====================================================================
const MODERN = await buatKiriman();
await jadi(ORANG_SERPONG);
await q(`select batalkan_kiriman($1,'salah alamat')`, [MODERN]);
cek(
  '§4 kiriman yang stoknya belum bergerak tidak membuat pergerakan apa pun',
  Number((await satu(`select count(*) as c from stock_movements where dispatch_id=$1`, [MODERN])).c),
  0
);

// =====================================================================
// §5. Yang SUDAH DITERIMA tidak boleh dibatalkan.
// =====================================================================
const DITERIMA = await buatKiriman({ status: 'received', items: [[AYAM, 1000, 900]] });
await jadi(ORANG_SERPONG);
const tolak = await gagalkan(() => q(`select batalkan_kiriman($1,'salah alamat')`, [DITERIMA]));
benar('§5 pembatalan ditolak', tolak !== null);
benar('§5 dan pesannya MENGARAHKAN ke Teruskan', /Teruskan/i.test(tolak ?? ''), `dapat: ${tolak}`);
benar('§5 serta menyebut outlet tempat barangnya sekarang', /Hampton/i.test(tolak ?? ''), `dapat: ${tolak}`);

// Draft juga diarahkan ke jalannya sendiri.
const DRAF = await buatKiriman({ status: 'draft' });
const tolakDraf = await gagalkan(() => q(`select batalkan_kiriman($1,'x')`, [DRAF]));
benar('§5 draft diarahkan ke "Hapus draft"', /Hapus draft/i.test(tolakDraf ?? ''), `dapat: ${tolakDraf}`);

// =====================================================================
// §6. TERUSKAN ke tujuan yang benar.
// =====================================================================
await jadi(ORANG_HAMPTON);
const BARU = (await satu(`select teruskan_kiriman($1,$2,'seharusnya retur ke CK') as id`, [DITERIMA, CK])).id;
benar('§6 kiriman koreksi dibuat', !!BARU);

const kBaru = await satu(`select from_outlet_id, to_outlet_id, status, koreksi_dari, notes from dispatches where id=$1`, [BARU]);
cek('§6 dari outlet yang SALAH menerima', kBaru.from_outlet_id, HAMPTON);
cek('§6 ke tujuan yang BENAR', kBaru.to_outlet_id, CK);
cek('§6 berupa DRAFT — barangnya masih harus dinaikkan ke mobil', kBaru.status, 'draft');
cek('§6 tersambung ke kiriman yang salah', kBaru.koreksi_dari, DITERIMA);
benar('§6 catatannya menyebut nomor kiriman aslinya', /SJ-/.test(kBaru.notes ?? ''), `dapat: ${kBaru.notes}`);

const isiBaru = (await q(`select product_id, sent_qty, keterangan from dispatch_items where dispatch_id=$1`, [BARU])).rows;
cek('§6 jumlahnya dari yang DITERIMA (900), bukan yang dikirim (1000)', Number(isiBaru[0].sent_qty), 900);
benar('§6 keterangannya menjelaskan asal-usulnya', /Koreksi salah alamat/i.test(isiBaru[0].keterangan ?? ''));

// Kiriman aslinya TIDAK diubah — ia catatan sejarah bahwa barangnya pernah
// sampai di Hampton.
cek('§6 kiriman aslinya tetap received', (await satu(`select status from dispatches where id=$1`, [DITERIMA])).status, 'received');

// Wewenang & masukan aneh.
await jadi(ORANG_SERPONG);
benar(
  '§6 pengirim asli TIDAK bisa meneruskan — barangnya bukan di tangannya',
  /outlet yang menerima/i.test((await gagalkan(() => q(`select teruskan_kiriman($1,$2,'x')`, [DITERIMA, CK]))) ?? '')
);
await jadi(ORANG_HAMPTON);
benar(
  '§6 tujuan yang sama dengan tempat barangnya sekarang ditolak',
  /tidak ada yang perlu diteruskan/i.test((await gagalkan(() => q(`select teruskan_kiriman($1,$2,'x')`, [DITERIMA, HAMPTON]))) ?? '')
);
benar(
  '§6 kiriman yang BELUM diterima diarahkan ke Batalkan',
  /BATALKAN/i.test((await gagalkan(() => q(`select teruskan_kiriman($1,$2,'x')`, [C, CK]))) ?? '')
);

// Tidak ada yang benar-benar diterima -> tidak ada yang bisa diteruskan.
const NOL = await buatKiriman({ status: 'received', items: [[BERAS, 500, 0]] });
await jadi(ORANG_HAMPTON);
benar(
  '§6 kiriman yang tidak ada barangnya sampai tidak bisa diteruskan',
  /tidak ada yang bisa diteruskan/i.test((await gagalkan(() => q(`select teruskan_kiriman($1,$2,'x')`, [NOL, CK]))) ?? '')
);

// =====================================================================
// §7. Sudah diekspor ESB -> ditahan.
// =====================================================================
const ESB = await buatKiriman();
await q(`update dispatches set esb_exported_at = now() where id=$1`, [ESB]);
await jadi(ORANG_SERPONG);
const tolakEsb = await gagalkan(() => q(`select batalkan_kiriman($1,'salah alamat')`, [ESB]));
benar('§7 kiriman yang sudah diekspor ESB ditahan', /diekspor ke ESB/i.test(tolakEsb ?? ''), `dapat: ${tolakEsb}`);
benar('§7 dan pesannya menawarkan jalan keluar', /Batalkan tanda ekspornya/i.test(tolakEsb ?? ''));

if (gagal === 0) console.log('Migration 0133 di Postgres sungguhan: 7 bagian LULUS. ✅');
process.exit(gagal === 0 ? 0 : 1);
