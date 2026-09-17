/**
 * MIGRATION 0143 DI POSTGRES SUNGGUHAN (PGlite).
 *
 * ============ YANG DIUJI ============
 *
 *   §1 Tanda ekspor benar-benar terbuka, dan jejaknya tertulis.
 *   §2 Alasan WAJIB, dan alasan sekadarnya ("x", "-", spasi) ditolak.
 *   §3 Yang tidak bertanda dilewati — tidak ditulisi jejak pembatalan yang
 *      tidak pernah terjadi.
 *   §4 Izin: hanya admin BU, dan hanya BU-nya sendiri.
 *   §5 Jejak TIDAK terhapus saat notanya diekspor ulang, dan urutan waktunya
 *      masih bisa dibedakan — inilah yang membuat layar tidak salah lapor.
 *   §6 Tanda tangan lama `batalkan_tanda_esb(uuid[])` benar-benar HILANG.
 *   §7 Kiriman (Simple Transfer) mengikuti aturan yang sama persis.
 *   §8 Pesan "nota terkunci" menyebut siapa yang bisa membukanya, dan tinggal
 *      di satu tempat saja.
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

  create table goods_receipts (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, outlet_id uuid, code text, receipt_date date,
    supplier text, invoice_no text, notes text, photo_path text,
    status text default 'aktif', payment_status text default 'belum',
    payment_source text, due_date date, paid_at timestamptz, payment_entry_id uuid,
    harga_digeser_at timestamptz, dibatalkan_at timestamptz, dibatalkan_by uuid,
    alasan_batal text, esb_exported_at timestamptz, esb_exported_by uuid,
    created_by uuid, created_at timestamptz default now(), updated_at timestamptz);
  create table goods_receipt_items (
    id uuid primary key default gen_random_uuid(),
    receipt_id uuid references goods_receipts(id) on delete cascade,
    product_id uuid, qty numeric, unit_cost numeric, line_total numeric);
  create table dispatches (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, from_outlet_id uuid, to_outlet_id uuid,
    code text, status text default 'received', notes text,
    esb_exported_at timestamptz, esb_exported_by uuid,
    received_by uuid, received_at timestamptz, created_at timestamptz default now());
  create table stock_movements (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, outlet_id uuid, product_id uuid, movement_type text,
    qty_delta numeric, receipt_id uuid, notes text, created_by uuid,
    created_at timestamptz default now());

  -- Tiruan 0001, "security definer" persis seperti aslinya.
  create or replace function has_outlet_scope(p_uid uuid, p_outlet uuid) returns boolean
    language sql security definer stable as $$
      select exists (
        select 1 from membership_scopes ms join outlets o on o.id = p_outlet
         where ms.user_id = p_uid
           and (ms.role = 'super_admin'
                or (ms.business_unit_id = o.business_unit_id and ms.role = 'bu_admin')
                or ms.outlet_id = p_outlet)) $$;

  create or replace function is_bu_admin(p_uid uuid, p_bu uuid) returns boolean
    language sql security definer stable as $$
      select exists (
        select 1 from membership_scopes ms
         where ms.user_id = p_uid
           and (ms.role = 'super_admin'
                or (ms.role = 'bu_admin' and ms.business_unit_id = p_bu))) $$;

  -- Tiruan fungsi-fungsi yang 0143 panggil tapi bukan miliknya.
  create or replace function ubah_nota_terima(
    p_id uuid, p_receipt_date date, p_supplier text, p_invoice_no text,
    p_photo_path text, p_notes text, p_items jsonb) returns void
    language plpgsql as $$
    begin
      update goods_receipts set supplier = p_supplier, notes = p_notes where id = p_id;
    end $$;
  create or replace function sesuaikan_kas_nota(p_nota uuid, p_selisih numeric, p_sebab text)
    returns void language plpgsql as $$ begin return; end $$;

  -- Tanda tangan LAMA dipasang lebih dulu, supaya §6 benar-benar menguji bahwa
  -- 0143 membuangnya — bukan menguji fungsi yang memang tidak pernah ada.
  create or replace function batalkan_tanda_esb(p_notas uuid[]) returns int
    language sql as $$ select 0 $$;
  create or replace function batalkan_tanda_kiriman_esb(p_kiriman uuid[]) returns int
    language sql as $$ select 0 $$;

  -- Tiruan penjaga 0131 dengan pesan LAMA, supaya §8 menguji penggantiannya.
  create or replace function jaga_ubah_item_nota() returns trigger
    language plpgsql as $$ begin return coalesce(new, old); end $$;
  create or replace function koreksi_nota(
    p_id uuid, p_receipt_date date, p_supplier text, p_invoice_no text,
    p_photo_path text, p_notes text, p_items jsonb, p_alasan text)
    returns numeric language sql as $$ select 0::numeric $$;
  create or replace function batalkan_nota(p_nota uuid, p_alasan text)
    returns numeric language sql as $$ select 0::numeric $$;
`);

const jalankan = async (b) =>
  db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', b), 'utf8').replace(/notify pgrst[^;]*;/g, ''));

await jalankan('0143_batal_tanda_esb_berjejak.sql');
console.log('  0143 terpasang.');
await jalankan('0143_batal_tanda_esb_berjejak.sql');
console.log('  dijalankan ulang: aman.');

await db.exec(`
  drop trigger if exists trg_jaga_ubah_item_nota on goods_receipt_items;
  create trigger trg_jaga_ubah_item_nota
    before insert or update or delete on goods_receipt_items
    for each row execute function jaga_ubah_item_nota();
`);

// =====================================================================
// DATA
// =====================================================================
const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const BU2 = (await satu(`insert into business_units (name) values ('Lain') returning id`)).id;
const CK = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Central Kitchen') returning id`, [BU])).id;
const LUAR = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Outlet BU Lain') returning id`, [BU2])).id;

const IKO = '11111111-1111-1111-1111-111111111111'; // bu_admin BU
const STAFF = '22222222-2222-2222-2222-222222222222'; // staff outlet CK
const ADMIN2 = '33333333-3333-3333-3333-333333333333'; // bu_admin BU2
await q(`insert into user_profiles (id, full_name) values ($1,'Iko'), ($2,'Staff CK'), ($3,'Admin BU Lain')`, [IKO, STAFF, ADMIN2]);
await q(
  `insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values
     ($1,$4,null,'bu_admin'), ($2,$4,$5,'staff'), ($3,$6,null,'bu_admin')`,
  [IKO, STAFF, ADMIN2, BU, CK, BU2]
);

const PRODUK = (await satu(`insert into products (name, base_unit) values ('Beras','gr') returning id`)).id;

// Itemnya disisipkan DULU, tandanya dipasang belakangan.
//
// Urutan ini bukan gaya penulisan: `trg_jaga_ubah_item_nota` menolak INSERT
// item ke nota yang sudah bertanda ekspor, jadi urutan sebaliknya membuat
// seluruh berkas tes ini gagal di baris pertama. Sekaligus bukti kecil bahwa
// penjaganya memang menutup jalur insert, bukan cuma update.
const buatNota = async (kode, { terekspor = true, outlet = CK, bu = BU } = {}) => {
  const id = (
    await satu(
      `insert into goods_receipts (business_unit_id, outlet_id, code, receipt_date, supplier)
       values ($1,$2,$3,'2026-09-01','Toko Berkah') returning id`,
      [bu, outlet, kode]
    )
  ).id;
  await q(`insert into goods_receipt_items (receipt_id, product_id, qty, unit_cost) values ($1,$2,100,36)`, [id, PRODUK]);
  if (terekspor) {
    await q(`update goods_receipts set esb_exported_at = now(), esb_exported_by = $2 where id = $1`, [id, IKO]);
  }
  return id;
};

const jadi = (uid) => q(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);

const ALASAN = 'berkasnya ditolak ESB, belum masuk ke sana';

// =====================================================================
// §1 Tandanya terbuka & jejaknya tertulis
// =====================================================================
const A = await buatNota('TRM-A');
await jadi(IKO);
cek('§1 satu nota terbuka', Number((await satu(`select batalkan_tanda_esb(array[$1]::uuid[], $2) as n`, [A, ALASAN])).n), 1);

const rA = await satu(
  `select esb_exported_at, esb_exported_by, esb_dibatalkan_at, esb_dibatalkan_by, esb_alasan_batal from goods_receipts where id = $1`,
  [A]
);
cek('§1 tanda ekspornya benar-benar kosong', rA.esb_exported_at, null);
cek('§1 esb_exported_by ikut dikosongkan', rA.esb_exported_by, null);
benar('§1 waktu pembatalan tercatat', rA.esb_dibatalkan_at !== null);
cek('§1 pelakunya tercatat', rA.esb_dibatalkan_by, IKO);
cek('§1 alasannya tersimpan apa adanya', rA.esb_alasan_batal, ALASAN);

// =====================================================================
// §2 Alasan wajib
// =====================================================================
const B = await buatNota('TRM-B');
for (const [nama, alasan] of [
  ['null', null],
  ['kosong', ''],
  ['spasi saja', '        '],
  ['satu huruf', 'x'],
  ['terlalu pendek', 'salah'],
  ['pendek sesudah dirapikan', '   ok   ']
]) {
  const e = await galat(`select batalkan_tanda_esb(array[$1]::uuid[], $2)`, [B, alasan]);
  benar(`§2 alasan ${nama} ditolak`, e !== null && /[Aa]lasan/.test(e), `pesannya: ${e}`);
}
cek(
  '§2 notanya masih bertanda sesudah semua penolakan itu',
  (await satu(`select (esb_exported_at is not null) as ada from goods_receipts where id = $1`, [B])).ada,
  true
);
benar(
  '§2 alasan pas-pasan 10 huruf diterima',
  (await galat(`select batalkan_tanda_esb(array[$1]::uuid[], $2)`, [B, 'salah ungg'])) === null
);
cek(
  '§2 alasannya tersimpan tanpa spasi tepi',
  (await satu(`select esb_alasan_batal as a from goods_receipts where id = $1`, [B])).a,
  'salah ungg'
);

// =====================================================================
// §3 Yang tidak bertanda dilewati, bukan ditulisi jejak palsu
// =====================================================================
const C = await buatNota('TRM-C', { terekspor: false });
cek('§3 nota tanpa tanda tidak terhitung', Number((await satu(`select batalkan_tanda_esb(array[$1]::uuid[], $2) as n`, [C, ALASAN])).n), 0);
const rC = await satu(`select esb_dibatalkan_at, esb_alasan_batal from goods_receipts where id = $1`, [C]);
cek('§3 dan TIDAK ditulisi waktu pembatalan', rC.esb_dibatalkan_at, null);
cek('§3 dan TIDAK ditulisi alasan', rC.esb_alasan_batal, null);

cek('§3 daftar kosong mengembalikan 0', Number((await satu(`select batalkan_tanda_esb(array[]::uuid[], $1) as n`, [ALASAN])).n), 0);
cek('§3 daftar null mengembalikan 0', Number((await satu(`select batalkan_tanda_esb(null, $1) as n`, [ALASAN])).n), 0);

// =====================================================================
// §4 Izin
// =====================================================================
const D = await buatNota('TRM-D');
await jadi(STAFF);
cek('§4 staff outlet tidak bisa membuka tanda', Number((await satu(`select batalkan_tanda_esb(array[$1]::uuid[], $2) as n`, [D, ALASAN])).n), 0);
await jadi(ADMIN2);
cek('§4 admin BU lain tidak bisa', Number((await satu(`select batalkan_tanda_esb(array[$1]::uuid[], $2) as n`, [D, ALASAN])).n), 0);
cek(
  '§4 notanya masih utuh bertanda',
  (await satu(`select (esb_exported_at is not null) as ada from goods_receipts where id = $1`, [D])).ada,
  true
);
await jadi(IKO);
cek('§4 admin BU-nya sendiri bisa', Number((await satu(`select batalkan_tanda_esb(array[$1]::uuid[], $2) as n`, [D, ALASAN])).n), 1);

// Satu panggilan memuat nota BU sendiri DAN nota BU lain: yang boleh saja yang
// terbuka. Kalau seluruh panggilannya ditolak, admin tidak punya cara tahu
// nota mana yang bermasalah; kalau semuanya lolos, batas BU-nya bocor.
const E = await buatNota('TRM-E');
const F = await buatNota('TRM-F', { outlet: LUAR, bu: BU2 });
cek(
  '§4 campuran: hanya nota BU sendiri yang terbuka',
  Number((await satu(`select batalkan_tanda_esb(array[$1,$2]::uuid[], $3) as n`, [E, F, ALASAN])).n),
  1
);
cek(
  '§4 nota BU lain tetap bertanda',
  (await satu(`select (esb_exported_at is not null) as ada from goods_receipts where id = $1`, [F])).ada,
  true
);

// =====================================================================
// §5 Jejak bertahan melewati ekspor ulang
// =====================================================================
// Ini jebakan yang sesungguhnya: kolom jejaknya TIDAK dikosongkan saat notanya
// diekspor lagi. Layar yang cuma melihat `esb_dibatalkan_at is not null` akan
// melaporkan nota yang sehat sebagai nota yang tandanya sedang terbuka.
await q(`update goods_receipts set esb_exported_at = now() + interval '1 minute', esb_exported_by = $2 where id = $1`, [A, IKO]);
const rA2 = await satu(
  `select esb_dibatalkan_at is not null as ada_jejak,
          esb_exported_at > esb_dibatalkan_at as ekspor_lebih_baru
     from goods_receipts where id = $1`,
  [A]
);
cek('§5 jejak pembatalan tetap ada sesudah diekspor ulang', rA2.ada_jejak, true);
cek('§5 dan waktunya bisa dibandingkan: ekspornya lebih baru', rA2.ekspor_lebih_baru, true);

// =====================================================================
// §6 Tanda tangan lama benar-benar hilang
// =====================================================================
const eLama = await galat(`select batalkan_tanda_esb(array[$1]::uuid[])`, [A]);
benar(
  '§6 batalkan_tanda_esb(uuid[]) berparameter satu sudah TIDAK ADA',
  eLama !== null,
  'kalau ia masih hidup, satu panggilan tanpa p_alasan akan jatuh ke sana: berhasil, tanpa alasan, tanpa jejak'
);
const eLamaK = await galat(`select batalkan_tanda_kiriman_esb(array[$1]::uuid[])`, [A]);
benar('§6 batalkan_tanda_kiriman_esb(uuid[]) juga hilang', eLamaK !== null);

cek(
  '§6 hanya ada satu tanda tangan yang tersisa untuk masing-masing',
  (
    await satu(
      `select count(*)::int as n from pg_proc where proname in ('batalkan_tanda_esb','batalkan_tanda_kiriman_esb')`
    )
  ).n,
  2
);

// =====================================================================
// §7 Kiriman: aturan yang sama persis
// =====================================================================
const K = (
  await satu(
    `insert into dispatches (business_unit_id, from_outlet_id, to_outlet_id, code, status, received_at, esb_exported_at, esb_exported_by)
     values ($1,$2,$2,'SJ-1','received', now(), now(), $3) returning id`,
    [BU, CK, IKO]
  )
).id;
benar('§7 alasan kosong ditolak juga untuk kiriman', (await galat(`select batalkan_tanda_kiriman_esb(array[$1]::uuid[], '')`, [K])) !== null);
cek('§7 kiriman terbuka dengan alasan', Number((await satu(`select batalkan_tanda_kiriman_esb(array[$1]::uuid[], $2) as n`, [K, ALASAN])).n), 1);
const rK = await satu(`select esb_exported_at, esb_dibatalkan_by, esb_alasan_batal from dispatches where id = $1`, [K]);
cek('§7 tandanya kosong', rK.esb_exported_at, null);
cek('§7 pelakunya tercatat', rK.esb_dibatalkan_by, IKO);
cek('§7 alasannya tersimpan', rK.esb_alasan_batal, ALASAN);

await jadi(ADMIN2);
const K2 = (
  await satu(
    `insert into dispatches (business_unit_id, from_outlet_id, to_outlet_id, code, status, received_at, esb_exported_at)
     values ($1,$2,$2,'SJ-2','received', now(), now()) returning id`,
    [BU, CK]
  )
).id;
cek('§7 admin BU lain tidak bisa membuka kiriman BU ini', Number((await satu(`select batalkan_tanda_kiriman_esb(array[$1]::uuid[], $2) as n`, [K2, ALASAN])).n), 0);
await jadi(IKO);

// =====================================================================
// §8 Pesan terkunci menyebut siapa & di mana
// =====================================================================
const G = await buatNota('TRM-G');
const ePesan = await galat(`update goods_receipt_items set qty = 999 where receipt_id = $1`, [G]);
benar('§8 nota terekspor tetap ditolak saat isinya diubah', ePesan !== null);
benar('§8 pesannya menyebut admin BU', ePesan !== null && /admin BU/i.test(ePesan), `pesannya: ${ePesan}`);
benar('§8 pesannya menyebut di mana tombolnya', ePesan !== null && /Ekspor ESB/.test(ePesan), `pesannya: ${ePesan}`);
benar('§8 pesannya menyebut nama tombolnya', ePesan !== null && /Batalkan tanda ekspor/.test(ePesan), `pesannya: ${ePesan}`);
benar('§8 pesannya menyebut kode notanya', ePesan !== null && /TRM-G/.test(ePesan), `pesannya: ${ePesan}`);

const eKoreksi = await galat(`select koreksi_nota($1, '2026-09-01','Toko','INV',null,null,'[]'::jsonb,'perbaikan')`, [G]);
benar('§8 aksi Edit ditolak juga', eKoreksi !== null);
benar('§8 Edit memakai kalimat yang SAMA', eKoreksi !== null && /Batalkan tanda ekspor/.test(eKoreksi), `pesannya: ${eKoreksi}`);

const eBatal = await galat(`select batalkan_nota($1, 'salah input')`, [G]);
benar('§8 aksi Batalkan nota ditolak juga', eBatal !== null);
benar('§8 Batalkan nota memakai kalimat yang SAMA', eBatal !== null && /Batalkan tanda ekspor/.test(eBatal), `pesannya: ${eBatal}`);

// Sesudah tandanya dibuka, ketiganya harus BENAR-BENAR terbuka. Pesan yang
// menyuruh membatalkan tanda, lalu tetap menolak sesudah tandanya dibatalkan,
// adalah pesan yang lebih buruk daripada tidak ada pesan.
await q(`select batalkan_tanda_esb(array[$1]::uuid[], $2)`, [G, ALASAN]);
cek(
  '§8 sesudah tandanya dibuka, isinya bisa diubah',
  await galat(`update goods_receipt_items set qty = 999 where receipt_id = $1`, [G]),
  null
);
cek(
  '§8 dan aksi Edit jalan',
  await galat(`select koreksi_nota($1, '2026-09-01','Toko Baru','INV',null,null,'[]'::jsonb,'perbaikan')`, [G]),
  null
);

console.log('');
if (gagal === 0) console.log('MIGRATION 0143: semua pemeriksaan lolos. ✅');
else console.error(`${gagal} pemeriksaan GAGAL.`);
await db.close();
process.exit(gagal === 0 ? 0 : 1);
