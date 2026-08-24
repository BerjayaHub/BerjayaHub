/**
 * MIGRATION 0103 DI POSTGRES SUNGGUHAN (PGlite).
 *
 * ============ YANG PALING PENTING DI BERKAS INI ============
 *
 * UJI 7 — kiriman lama yang stok CK-nya SUDAH terpotong saat dibuat tidak boleh
 * terpotong lagi saat dikonfirmasi.
 *
 * Kegagalan itu tidak menampilkan error apa pun. Stok CK sekadar berkurang dua
 * kali lipat untuk kiriman-kiriman yang kebetulan sedang di jalan saat
 * migration dijalankan, dan selisihnya akan diserap opname sebagai "susut" —
 * berminggu-minggu kemudian, oleh orang yang tidak tahu migration pernah
 * dijalankan.
 *
 * Karena itu di sini SALDO STOKNYA yang diperiksa di tiap tahap, bukan sekadar
 * "fungsinya jalan".
 */
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

let gagal = 0;
const cek = (nama, dapat, harap) => {
  const a = typeof dapat === 'number' ? Number(dapat.toFixed(6)) : dapat;
  const b = typeof harap === 'number' ? Number(harap.toFixed(6)) : harap;
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(a)}\n   harap : ${JSON.stringify(b)}`);
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
const sebagai = (uid) => q(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);

async function galat(fn) {
  try {
    await fn();
    return null;
  } catch (e) {
    return e.message ?? String(e);
  }
}

// =====================================================================
// KERANGKA MINIMAL
// =====================================================================
await db.exec(`
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;
  create role authenticated;

  create table business_units (id uuid primary key default gen_random_uuid(), name text);
  create table outlets (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid references business_units(id), name text, outlet_role text default 'standalone'
  );
  create table user_profiles (id uuid primary key, full_name text);
  create table products (id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text);
  create table membership_scopes (user_id uuid, business_unit_id uuid, outlet_id uuid, role text);

  create table stock_movements (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, outlet_id uuid, product_id uuid,
    movement_type text, qty_delta numeric, ref_outlet_id uuid, dispatch_id uuid,
    notes text, created_by uuid, created_at timestamptz not null default now()
  );

  create table stock_orders (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, from_outlet_id uuid, to_outlet_id uuid, code text,
    status text not null default 'open',
    notes text, reject_reason text, dispatch_id uuid,
    created_by uuid, created_at timestamptz default now(),
    handled_by uuid, handled_at timestamptz
  );

  create table dispatches (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid not null, from_outlet_id uuid not null, to_outlet_id uuid not null,
    status text not null default 'sent' check (status in ('sent','received','cancelled')),
    code text, notes text,
    created_by uuid, created_at timestamptz not null default now(),
    received_by uuid, received_at timestamptz
  );
  create table dispatch_items (
    id uuid primary key default gen_random_uuid(),
    dispatch_id uuid not null references dispatches(id) on delete cascade,
    product_id uuid not null, sent_qty numeric not null, received_qty numeric
  );

  create or replace function has_bu_scope(p_uid uuid, p_bu uuid) returns boolean language sql stable as $$
    select exists (select 1 from membership_scopes where user_id = p_uid and business_unit_id = p_bu);
  $$;
  create or replace function has_outlet_scope(p_uid uuid, p_outlet uuid) returns boolean language sql stable as $$
    select exists (select 1 from membership_scopes where user_id = p_uid and outlet_id = p_outlet);
  $$;

  -- =====================================================================
  -- KEADAAN PRODUKSI SEBELUM MIGRATION — bukan skema kosong.
  --
  -- Versi pertama uji ini membuat semuanya dari nol, dan karena itu MELEWATKAN
  -- dua kesalahan yang langsung muncul di produksi:
  --
  --   1. receive_dispatch lama mengembalikan VOID; yang baru JSONB.
  --      "create or replace" menolak dengan 42P13 — dan uji dari nol tidak
  --      pernah punya versi lama untuk bertabrakan.
  --
  --   2. Trigger notifikasi 0046 berbunyi "after insert", jadi membuat DRAFT
  --      akan mengumumkan "barang dikirim" untuk barang yang masih di rak.
  --
  --   CATATAN: jangan pakai backtick di dalam blok SQL ini — ia menutup
  --   template literal JS-nya dan berkasnya gagal di-parse. Jebakan yang sama
  --   pernah menjatuhkan modul shift.
  --
  -- Keduanya kelas kesalahan yang sama: uji yang tidak menyerupai produksi
  -- akan hijau untuk migration yang tidak bisa dijalankan di produksi.
  -- =====================================================================

  -- Versi LAMA create_dispatch (0024): memotong stok CK saat dibuat.
  create or replace function create_dispatch(p_from uuid, p_to uuid, p_items jsonb, p_notes text)
  returns uuid language plpgsql security definer set search_path = public as $$
  declare
    v_bu uuid; v_uid uuid := auth.uid(); v_did uuid := gen_random_uuid(); v_code text;
    it jsonb; v_pid uuid; v_qty numeric;
  begin
    select business_unit_id into v_bu from outlets where id = p_from;
    v_code := 'SJ-LAMA-' || upper(substr(v_did::text, 1, 4));
    insert into dispatches(id, business_unit_id, from_outlet_id, to_outlet_id, status, notes, created_by, code)
      values (v_did, v_bu, p_from, p_to, 'sent', p_notes, v_uid, v_code);
    for it in select * from jsonb_array_elements(p_items) loop
      v_pid := (it->>'product_id')::uuid; v_qty := (it->>'qty')::numeric;
      insert into dispatch_items(dispatch_id, product_id, sent_qty) values (v_did, v_pid, v_qty);
      insert into stock_movements(business_unit_id, outlet_id, product_id, movement_type, qty_delta, ref_outlet_id, dispatch_id, notes, created_by)
        values (v_bu, p_from, v_pid, 'transfer_out', -v_qty, p_to, v_did, 'Dispatch', v_uid);
    end loop;
    return v_did;
  end $$;

  -- Versi LAMA receive_dispatch (0022): mengembalikan VOID.
  create or replace function receive_dispatch(p_dispatch uuid, p_items jsonb)
  returns void language plpgsql security definer set search_path = public as $$
  begin
    update dispatches set status = 'received' where id = p_dispatch;
  end $$;

  -- Tiruan notify_telegram_event: mencatat ke tabel, bukan memanggil jaringan.
  create table notifikasi_terkirim (
    id serial primary key, tg_op text, status_baru text, status_lama text, dispatch_id uuid
  );
  create or replace function notify_telegram_event() returns trigger
  language plpgsql as $$
  begin
    insert into notifikasi_terkirim (tg_op, status_baru, status_lama, dispatch_id)
    values (tg_op, new.status, case when tg_op = 'UPDATE' then old.status else null end, new.id);
    return new;
  end $$;

  -- Trigger 0046 apa adanya: after insert OR update of status.
  create trigger trg_notify_dispatches
    after insert or update of status on dispatches
    for each row execute function notify_telegram_event();
`);

// =====================================================================
// DATA + KIRIMAN LAMA (dibuat SEBELUM migration)
// =====================================================================
const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const CK = (await satu(`insert into outlets (business_unit_id, name, outlet_role) values ($1,'Central Kitchen','central_kitchen') returning id`, [BU])).id;
const OUT = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Serpong') returning id`, [BU])).id;
const OUT2 = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Sentul') returning id`, [BU])).id;

const CKSTAFF = '11111111-1111-1111-1111-111111111111';
const OUTSTAFF = '22222222-2222-2222-2222-222222222222';
const LAIN = '33333333-3333-3333-3333-333333333333';
await q(`insert into user_profiles (id, full_name) values ($1,'CK'),($2,'Outlet'),($3,'Lain')`, [CKSTAFF, OUTSTAFF, LAIN]);
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values
  ($1,$4,$5,'staff'), ($2,$4,$6,'staff'), ($3,$4,$7,'staff')`, [CKSTAFF, OUTSTAFF, LAIN, BU, CK, OUT, OUT2]);

const AYAM = (await satu(`insert into products (business_unit_id, name) values ($1,'Ayam') returning id`, [BU])).id;
const BERAS = (await satu(`insert into products (business_unit_id, name) values ($1,'Beras') returning id`, [BU])).id;

// Stok awal CK.
await q(`insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, notes)
  values ($1,$2,$3,'receive',100,'stok awal'), ($1,$2,$4,'receive',500,'stok awal')`, [BU, CK, AYAM, BERAS]);

await sebagai(CKSTAFF);
const SJ_LAMA = (await satu(`select create_dispatch($1,$2,$3::jsonb,'kiriman lama') d`, [
  CK, OUT, JSON.stringify([{ product_id: AYAM, qty: 10 }])
])).d;

const saldo = async (produk, outlet) =>
  Number((await satu(`select coalesce(sum(qty_delta),0) s from stock_movements where product_id=$1 and outlet_id=$2`, [produk, outlet])).s);

cek('pra-migration: kiriman lama sudah memotong CK', await saldo(AYAM, CK), 90);

// =====================================================================
// MIGRATION
// =====================================================================
const jalankan = async (berkas) => {
  const sql = fs.readFileSync(path.join(AKAR, 'supabase/migrations', berkas), 'utf8');
  await db.exec(sql.replace(/notify pgrst[^;]*;/g, ''));
};
await jalankan('0103_draft_surat_jalan.sql');
console.log('  migration 0103 terpasang.');
await jalankan('0103_draft_surat_jalan.sql');
console.log('  dijalankan ulang: aman.');

// Fungsi lama DI-DROP — klien PWA lama harus gagal dengan lantang, bukan
// diam-diam membuat draft yang dikiranya kiriman.
benar('fungsi create_dispatch lama sudah tiada',
  /does not exist|function create_dispatch/i.test(await galat(() => q(`select create_dispatch($1,$2,'[]'::jsonb,null)`, [CK, OUT])) ?? ''));
benar('fungsi fulfill_stock_order lama sudah tiada',
  /does not exist|function fulfill_stock_order/i.test(await galat(() => q(`select fulfill_stock_order($1,'[]'::jsonb,null)`, [SJ_LAMA])) ?? ''));

// Tipe kembalian receive_dispatch benar-benar berubah jadi jsonb — kalau
// `drop function` hilang, migration di atas sudah meledak dengan 42P13 dan
// berkas ini tidak akan sampai ke sini.
benar('receive_dispatch sekarang mengembalikan jsonb',
  (await satu(`select pg_get_function_result(oid) t from pg_proc where proname='receive_dispatch'`)).t === 'jsonb');

// Riwayat kiriman lama tidak berlubang.
benar('sent_at kiriman lama diisi dari created_at',
  (await satu(`select sent_at is not null ok from dispatches where id=$1`, [SJ_LAMA])).ok);

// =====================================================================
// 1. BUAT DRAFT — nomor SJ ada, STOK DIAM
// =====================================================================
await sebagai(CKSTAFF);
const DRAFT = (await satu(`select buat_draft_kiriman($1,$2,$3::jsonb,'siapan H-1',null) d`, [
  CK, OUT, JSON.stringify([{ product_id: AYAM, qty: 20 }, { product_id: BERAS, qty: 50 }])
])).d;

const hDraft = await satu(`select status, code from dispatches where id=$1`, [DRAFT]);
cek('1. statusnya draft', hDraft.status, 'draft');
benar('1. nomor SJ sudah ada sejak draft', /^SJ-\d{6}-/.test(hDraft.code ?? ''), hDraft.code);
cek('1. dua barang tersimpan',
  Number((await satu(`select count(*) n from dispatch_items where dispatch_id=$1`, [DRAFT])).n), 2);

// INTI PERUBAHANNYA: menyiapkan H-1 tidak boleh menyentuh stok semalaman.
cek('1. STOK CK TIDAK BERGERAK saat draft', await saldo(AYAM, CK), 90);
cek('1.   beras juga tidak', await saldo(BERAS, CK), 500);
cek('1.   outlet juga belum bertambah', await saldo(AYAM, OUT), 0);
cek('1. tidak ada pergerakan yang menempel ke draft',
  Number((await satu(`select count(*) n from stock_movements where dispatch_id=$1`, [DRAFT])).n), 0);

// Draft kosong ditolak — nomor SJ tanpa isi hanya jadi baris membingungkan.
benar('1. draft kosong ditolak',
  /tidak ada barang yang diisi/i.test(await galat(() => q(`select buat_draft_kiriman($1,$2,'[]'::jsonb,null,null)`, [CK, OUT])) ?? ''));

// DRAFT TIDAK MENGUMUMKAN APA PUN.
//
// Tanpa penjagaan ini, grup Telegram menerima "barang dikirim" untuk barang
// yang masih di rak CK — dan outlet tujuan menunggu kiriman yang belum
// berangkat.
cek('1. draft TIDAK memicu notifikasi',
  Number((await satu(`select count(*) n from notifikasi_terkirim where dispatch_id=$1`, [DRAFT])).n), 0);

// =====================================================================
// 2. UBAH DRAFT — inilah gunanya: dicek ulang besok paginya
// =====================================================================
await q(`select ubah_draft_kiriman($1,$2::jsonb,'sudah dicek ulang')`, [
  DRAFT, JSON.stringify([{ product_id: AYAM, qty: 15 }])
]);
cek('2. isinya berganti seluruhnya',
  Number((await satu(`select count(*) n from dispatch_items where dispatch_id=$1`, [DRAFT])).n), 1);
cek('2. jumlahnya jadi 15',
  Number((await satu(`select sent_qty s from dispatch_items where dispatch_id=$1`, [DRAFT])).s), 15);
cek('2. catatannya ikut diperbarui',
  (await satu(`select notes n from dispatches where id=$1`, [DRAFT])).n, 'sudah dicek ulang');
cek('2. stok TETAP diam', await saldo(AYAM, CK), 90);

// Mengosongkan draft ditolak — dan `delete` di dalamnya ikut dibatalkan.
benar('2. draft tidak boleh dikosongkan',
  /tidak boleh kosong/i.test(await galat(() => q(`select ubah_draft_kiriman($1,'[]'::jsonb,null)`, [DRAFT])) ?? ''));
cek('2.   isinya tetap utuh setelah penolakan',
  Number((await satu(`select count(*) n from dispatch_items where dispatch_id=$1`, [DRAFT])).n), 1);

// =====================================================================
// 3. WEWENANG — draft milik OUTLET ASAL, bukan pembuatnya
// =====================================================================
await sebagai(LAIN); // punya scope di OUT2 saja
const SATU_ITEM = JSON.stringify([{ product_id: AYAM, qty: 1 }]);
benar('3. orang luar tidak bisa mengubah draft',
  /tidak bisa kamu ubah/i.test(await galat(() => q(`select ubah_draft_kiriman($1,$2::jsonb,null)`, [DRAFT, SATU_ITEM])) ?? ''));
benar('3. orang luar tidak bisa mengirim draft',
  /tidak bisa kamu kirim/i.test(await galat(() => q(`select kirim_draft_kiriman($1)`, [DRAFT])) ?? ''));
benar('3. orang luar tidak bisa menghapus draft',
  /tidak bisa kamu hapus/i.test(await galat(() => q(`select hapus_draft_kiriman($1)`, [DRAFT])) ?? ''));

// Rekan satu outlet CK BOLEH — shift pagi menyiapkan, shift lain mengirim.
const CKSTAFF2 = '44444444-4444-4444-4444-444444444444';
await q(`insert into user_profiles (id, full_name) values ($1,'CK Shift 2')`, [CKSTAFF2]);
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values ($1,$2,$3,'staff')`, [CKSTAFF2, BU, CK]);
await sebagai(CKSTAFF2);
cek('3. rekan satu outlet CK boleh mengelola draft',
  (await satu(`select boleh_kelola_draft($1) b`, [DRAFT])).b, true);

// =====================================================================
// 4. KIRIM — barang berangkat, stok MASIH DIAM
// =====================================================================
await sebagai(CKSTAFF);
await q(`select kirim_draft_kiriman($1)`, [DRAFT]);

const hKirim = await satu(`select status, sent_at, sent_by from dispatches where id=$1`, [DRAFT]);
cek('4. statusnya sent', hKirim.status, 'sent');
benar('4. sent_at terisi', hKirim.sent_at != null);
cek('4. sent_by tercatat', hKirim.sent_by, CKSTAFF);

// MOMEN KIRIM SEKARANG ADALAH UPDATE. Notifikasinya harus tetap ada — kalau
// tidak, barang berangkat tanpa satu pun pemberitahuan.
const notifKirim = (await q(`select tg_op, status_baru, status_lama from notifikasi_terkirim where dispatch_id=$1`, [DRAFT])).rows;
cek('4. kirim memicu tepat satu notifikasi', notifKirim.length, 1);
cek('4.   lewat UPDATE, bukan INSERT', notifKirim[0].tg_op, 'UPDATE');
cek('4.   dari draft ke sent', [notifKirim[0].status_lama, notifKirim[0].status_baru], ['draft', 'sent']);

cek('4. STOK CK MASIH DIAM setelah dikirim', await saldo(AYAM, CK), 90);
cek('4.   outlet juga belum bertambah', await saldo(AYAM, OUT), 0);

// Sudah dikirim -> bukan draft lagi.
benar('4. draft yang sudah dikirim tidak bisa diubah',
  /tidak bisa kamu ubah/i.test(await galat(() => q(`select ubah_draft_kiriman($1,$2::jsonb,null)`, [DRAFT, SATU_ITEM])) ?? ''));
benar('4.   dan tidak bisa dihapus',
  /tidak bisa kamu hapus/i.test(await galat(() => q(`select hapus_draft_kiriman($1)`, [DRAFT])) ?? ''));

// =====================================================================
// 5. TERIMA — DI SINI seluruh stok bergeser sekaligus
// =====================================================================
const ITEM = (await satu(`select id from dispatch_items where dispatch_id=$1`, [DRAFT])).id;

// Outlet lain tidak boleh mengonfirmasi kiriman yang bukan tujuannya.
await sebagai(LAIN);
benar('5. hanya outlet tujuan yang boleh mengonfirmasi',
  /Hanya outlet tujuan/i.test(await galat(() => q(`select receive_dispatch($1,$2::jsonb)`, [DRAFT, JSON.stringify([{ item_id: ITEM, received_qty: 15 }])])) ?? ''));

await sebagai(OUTSTAFF);
const terima = await satu(`select receive_dispatch($1,$2::jsonb) r`, [
  DRAFT, JSON.stringify([{ item_id: ITEM, received_qty: 13 }]) // 2 susut di jalan
]);

cek('5. CK berkurang sebesar YANG DIKIRIM (15)', await saldo(AYAM, CK), 75);
cek('5. outlet bertambah sebesar YANG DITERIMA (13)', await saldo(AYAM, OUT), 13);
cek('5. susut dilaporkan, bukan hilang diam-diam', Number(terima.r.susut), 2);
cek('5. status jadi received', (await satu(`select status s from dispatches where id=$1`, [DRAFT])).s, 'received');
cek('5. bukan kiriman lama', terima.r.stok_ck_sudah_terpotong_sebelumnya, false);

// =====================================================================
// 6. DRAFT MASIH DRAFT TIDAK BISA DITERIMA
// =====================================================================
await sebagai(CKSTAFF);
const DRAFT2 = (await satu(`select buat_draft_kiriman($1,$2,$3::jsonb,null,null) d`, [
  CK, OUT, JSON.stringify([{ product_id: BERAS, qty: 30 }])
])).d;
const ITEM2 = (await satu(`select id from dispatch_items where dispatch_id=$1`, [DRAFT2])).id;
await sebagai(OUTSTAFF);
benar('6. draft belum bisa diterima',
  /masih draft/i.test(await galat(() => q(`select receive_dispatch($1,$2::jsonb)`, [DRAFT2, JSON.stringify([{ item_id: ITEM2, received_qty: 30 }])])) ?? ''));
cek('6.   stok beras belum tersentuh', await saldo(BERAS, CK), 500);

// =====================================================================
// 7. KIRIMAN LAMA TIDAK TERPOTONG DUA KALI  <-- yang paling berbahaya
//
// SJ_LAMA dibuat sebelum migration: stok CK-nya SUDAH −10. Mengonfirmasinya
// sekarang hanya boleh MENAMBAH stok outlet, tidak boleh memotong CK lagi.
// =====================================================================
const ckSebelum = await saldo(AYAM, CK);
const ITEM_LAMA = (await satu(`select id from dispatch_items where dispatch_id=$1`, [SJ_LAMA])).id;

await sebagai(OUTSTAFF);
const terimaLama = await satu(`select receive_dispatch($1,$2::jsonb) r`, [
  SJ_LAMA, JSON.stringify([{ item_id: ITEM_LAMA, received_qty: 10 }])
]);

cek('7. dikenali sebagai kiriman lama', terimaLama.r.stok_ck_sudah_terpotong_sebelumnya, true);
cek('7. STOK CK TIDAK BERKURANG LAGI', await saldo(AYAM, CK), ckSebelum);
cek('7. outlet tetap bertambah 10', await saldo(AYAM, OUT), 23);
cek('7. hanya ada SATU transfer_out untuk kiriman lama',
  Number((await satu(`select count(*) n from stock_movements where dispatch_id=$1 and movement_type='transfer_out'`, [SJ_LAMA])).n), 1);

// =====================================================================
// 8. ALUR ORDER — order TETAP 'open' sampai draftnya dikirim
// =====================================================================
await sebagai(OUTSTAFF);
const ORDER = (await satu(`insert into stock_orders (business_unit_id, from_outlet_id, to_outlet_id, code, created_by)
  values ($1,$2,$3,'ORD-001',$4) returning id`, [BU, OUT, CK, OUTSTAFF])).id;

await sebagai(CKSTAFF);
const DRAFT3 = (await satu(`select siapkan_order_jadi_draft($1,$2::jsonb,'siapan') d`, [
  ORDER, JSON.stringify([{ product_id: BERAS, qty: 40 }])
])).d;

cek('8. ORDER MASIH open setelah draft dibuat',
  (await satu(`select status s from stock_orders where id=$1`, [ORDER])).s, 'open');
cek('8. draftnya tertaut ke ordernya',
  (await satu(`select stock_order_id o from dispatches where id=$1`, [DRAFT3])).o, ORDER);
cek('8. stok belum bergerak', await saldo(BERAS, CK), 500);

// Satu order = satu draft. Menekan "Siapkan" dua kali tidak boleh menghasilkan
// dua nomor SJ untuk order yang sama.
benar('8. order tidak bisa disiapkan dua kali',
  /sudah punya draft/i.test(await galat(() => q(`select siapkan_order_jadi_draft($1,$2::jsonb,null)`, [ORDER, JSON.stringify([{ product_id: BERAS, qty: 40 }])])) ?? ''));

await q(`select kirim_draft_kiriman($1)`, [DRAFT3]);
cek('8. ORDER baru fulfilled SETELAH dikirim',
  (await satu(`select status s from stock_orders where id=$1`, [ORDER])).s, 'fulfilled');
cek('8.   dan tertaut ke surat jalannya',
  (await satu(`select dispatch_id d from stock_orders where id=$1`, [ORDER])).d, DRAFT3);
cek('8. stok TETAP diam sampai diterima', await saldo(BERAS, CK), 500);

// =====================================================================
// 9. HAPUS DRAFT — benar-benar hilang, ordernya tetap open
// =====================================================================
await sebagai(OUTSTAFF);
const ORDER2 = (await satu(`insert into stock_orders (business_unit_id, from_outlet_id, to_outlet_id, code, created_by)
  values ($1,$2,$3,'ORD-002',$4) returning id`, [BU, OUT, CK, OUTSTAFF])).id;
await sebagai(CKSTAFF);
const DRAFT4 = (await satu(`select siapkan_order_jadi_draft($1,$2::jsonb,null) d`, [
  ORDER2, JSON.stringify([{ product_id: AYAM, qty: 5 }])
])).d;

await q(`select hapus_draft_kiriman($1)`, [DRAFT4]);
cek('9. draftnya hilang',
  Number((await satu(`select count(*) n from dispatches where id=$1`, [DRAFT4])).n), 0);
cek('9.   itemnya ikut hilang (cascade)',
  Number((await satu(`select count(*) n from dispatch_items where dispatch_id=$1`, [DRAFT4])).n), 0);
cek('9. ordernya TETAP open — bisa disiapkan ulang',
  (await satu(`select status s from stock_orders where id=$1`, [ORDER2])).s, 'open');

// Dan memang bisa disiapkan ulang sesudahnya.
const DRAFT5 = (await satu(`select siapkan_order_jadi_draft($1,$2::jsonb,null) d`, [
  ORDER2, JSON.stringify([{ product_id: AYAM, qty: 6 }])
])).d;
benar('9. order bisa disiapkan ulang setelah draftnya dihapus', DRAFT5 != null);

// Kiriman yang sudah menyentuh stok tidak bisa dihapus lewat jalur draft.
benar('9. kiriman yang sudah diterima tidak bisa dihapus',
  await galat(() => q(`select hapus_draft_kiriman($1)`, [DRAFT])) !== null);

// =====================================================================
// 10. TIDAK ADA ANGKA YANG ANEH
// =====================================================================
const negatif = (await q(`select outlet_id, product_id, sum(qty_delta) s from stock_movements group by 1,2 having sum(qty_delta) < 0`)).rows;
cek('10. tidak ada saldo negatif di mana pun', negatif.length, 0);

const ganda = (await q(`
  select dispatch_id, count(*) n from stock_movements
  where movement_type = 'transfer_out' and dispatch_id is not null
  group by 1 having count(*) > 1`)).rows;
cek('10. tidak ada kiriman dengan transfer_out berganda', ganda.length, 0);

await db.close();
console.log(gagal === 0 ? '✅ migrasi 0103: semua lulus' : `❌ migrasi 0103: ${gagal} gagal`);
process.exit(gagal === 0 ? 0 : 1);
