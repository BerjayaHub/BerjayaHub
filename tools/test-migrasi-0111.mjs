/**
 * MIGRATION 0111 DI POSTGRES SUNGGUHAN (PGlite) — tahap DRAFT pada order ke CK.
 *
 * ============ YANG DIBUKTIKAN ============
 *
 *   §1  draft bisa disusun bersama beberapa divisi
 *   §2  CK TIDAK melihat draft sama sekali
 *   §3  satu draft per pasangan outlet-tujuan, dijamin index
 *   §4  draft kosong tidak bisa dikirim
 *   §5  sesudah dikirim, isinya terkunci
 *   §6  trigger Telegram tidak menyala untuk draft, menyala saat berangkat
 *   §7  wewenang tidak ikut longgar
 *
 * §6 yang paling mudah terlewat dan paling merugikan. `trg_notify_stock_orders`
 * (0043) menyala pada `after insert`, dan draft dibuat lewat INSERT — jadi
 * tanpa perubahan trigger, CK menerima "Order baru dari Serpong" untuk daftar
 * yang masih kosong. Kegagalan yang sama pernah terjadi di 0103.
 *
 * Triggernya diuji dengan cara memasang `notify_telegram_event()` PALSU yang
 * mencatat panggilannya ke sebuah tabel. Yang diperiksa bukan isinya, melainkan
 * BERAPA KALI dan PADA PERISTIWA APA ia dipanggil.
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
const sebagai = (uid) => q(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
const galat = async (fn) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return e.message ?? String(e);
  }
};

await db.exec(`
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;

  create table business_units (id uuid primary key default gen_random_uuid(), name text);
  create table outlets (id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text, outlet_role text default 'standalone');
  create table user_profiles (id uuid primary key, full_name text);
  create table products (id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text);
  create table membership_scopes (user_id uuid, business_unit_id uuid, outlet_id uuid, role text);

  create table stock_orders (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, from_outlet_id uuid, to_outlet_id uuid,
    code text, status text not null default 'open'
      check (status in ('open','fulfilled','rejected','cancelled')),
    notes text, reject_reason text,
    created_by uuid, created_at timestamptz not null default now(),
    edited_by uuid, edited_at timestamptz,
    handled_by uuid, handled_at timestamptz
  );
  create table stock_order_items (
    id uuid primary key default gen_random_uuid(),
    order_id uuid references stock_orders(id) on delete cascade,
    product_id uuid, qty numeric
  );

  create role authenticated;

  create or replace function has_bu_scope(p_uid uuid, p_bu uuid) returns boolean language sql stable as $$
    select exists (select 1 from membership_scopes where user_id = p_uid and business_unit_id = p_bu);
  $$;
  create or replace function has_outlet_scope(p_uid uuid, p_outlet uuid) returns boolean language sql stable as $$
    select exists (select 1 from membership_scopes where user_id = p_uid and outlet_id = p_outlet);
  $$;
  create or replace function is_bu_admin(p_uid uuid, p_bu uuid) returns boolean language sql stable as $$
    select exists (select 1 from membership_scopes where user_id = p_uid and business_unit_id = p_bu and role in ('bu_admin','super_admin'));
  $$;
  create or replace function is_admin_of_outlet(p_uid uuid, p_outlet uuid) returns boolean language sql stable as $$
    select exists (select 1 from membership_scopes where user_id = p_uid and outlet_id = p_outlet and role in ('outlet_admin','bu_admin','super_admin'));
  $$;

  -- NOTIFIKASI PALSU: mencatat tiap panggilan supaya bisa dihitung.
  create table kabar (id serial primary key, peristiwa text, status text, order_id uuid);
  create or replace function notify_telegram_event() returns trigger language plpgsql as $$
  begin
    insert into kabar (peristiwa, status, order_id) values (TG_OP, new.status, new.id);
    return new;
  end; $$;

  -- Fungsi & trigger VERSI LAMA, persis seperti produksi sebelum 0111.
  create or replace function create_stock_order(p_from uuid, p_to uuid, p_items jsonb, p_notes text)
  returns uuid language plpgsql security definer set search_path = public as $x$
  begin return null; end; $x$;
  -- GRANT-nya dipasang di sini, persis seperti produksi (0031).
  --
  -- Tanpa baris ini, pemeriksaan "grant sudah dicabut" di §7 akan HIJAU tanpa
  -- menguji apa pun — grant-nya memang tidak pernah ada. Sabotase yang
  -- membuang perintah revoke sempat LOLOS persis karena itu.
  grant execute on function create_stock_order(uuid, uuid, jsonb, text) to authenticated;

  create or replace function update_stock_order(p_order uuid, p_items jsonb, p_notes text)
  returns void language plpgsql security definer set search_path = public as $x$
  begin null; end; $x$;

  create or replace function cancel_stock_order(p_order uuid)
  returns void language plpgsql security definer set search_path = public as $x$
  begin null; end; $x$;

  drop trigger if exists trg_notify_stock_orders on stock_orders;
  create trigger trg_notify_stock_orders
    after insert on stock_orders
    for each row execute function notify_telegram_event();
`);

const jalankan = async (b) =>
  db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', b), 'utf8').replace(/notify pgrst[^;]*;/g, ''));

await jalankan('0111_draft_order_ck.sql');
console.log('  0111 terpasang di atas versi lama.');
await jalankan('0111_draft_order_ck.sql');
console.log('  dijalankan ulang: aman.');

// =====================================================================
// DATA
// =====================================================================
const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const SERPONG = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Serpong') returning id`, [BU])).id;
const SENTUL = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Sentul') returning id`, [BU])).id;
const CK = (await satu(`insert into outlets (business_unit_id, name, outlet_role) values ($1,'CK','central_kitchen') returning id`, [BU])).id;
const CK2 = (await satu(`insert into outlets (business_unit_id, name, outlet_role) values ($1,'CK Dua','central_kitchen') returning id`, [BU])).id;

const ELSA = '11111111-1111-1111-1111-111111111111';
const MASKAL = '22222222-2222-2222-2222-222222222222';
const ORANG_SENTUL = '33333333-3333-3333-3333-333333333333';
await q(`insert into user_profiles (id, full_name) values ($1,'Elsa'),($2,'Maskal'),($3,'Sentul')`, [ELSA, MASKAL, ORANG_SENTUL]);
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values
  ($1,$4,$5,'staff'), ($2,$4,$5,'staff'), ($3,$4,$6,'staff')`, [ELSA, MASKAL, ORANG_SENTUL, BU, SERPONG, SENTUL]);

const SIRUP = (await satu(`insert into products (business_unit_id, name) values ($1,'Sirup') returning id`, [BU])).id;
const DAGING = (await satu(`insert into products (business_unit_id, name) values ($1,'Daging') returning id`, [BU])).id;

const draftOrder = async (dari = SERPONG, ke = CK) =>
  (await satu(`select buat_atau_ambil_draft_order($1,$2) id`, [dari, ke])).id;
const isi = (id, items) => q(`select update_stock_order($1,$2::jsonb,null)`, [id, JSON.stringify(items)]);
const barang = async (id) => Number((await satu(`select count(*) n from stock_order_items where order_id=$1`, [id])).n);
const kabarUntuk = async (id) => (await q(`select peristiwa, status from kabar where order_id=$1 order by id`, [id])).rows;

// =====================================================================
// 1. DISUSUN BERSAMA
// =====================================================================
await sebagai(ELSA);
const D = await draftOrder();
cek('1. draft dibuat berstatus draft', (await satu(`select status from stock_orders where id=$1`, [D])).status, 'draft');
await isi(D, [{ product_id: SIRUP, qty: 5 }]);

await sebagai(MASKAL);
const tolakMaskal = await galat(() => isi(D, [{ product_id: SIRUP, qty: 5 }, { product_id: DAGING, qty: 3 }]));
benar('1. rekan seoutlet boleh menambah', tolakMaskal === null, String(tolakMaskal));
cek('1. isinya jadi 2 barang', await barang(D), 2);

// =====================================================================
// 2. CK TIDAK MELIHAT DRAFT
//
// Diperiksa dengan query yang PERSIS dipakai layar CK
// (`listIncomingOrders`: status = 'open' and to_outlet_id in (...)).
// =====================================================================
const masuk = async () =>
  Number((await satu(`select count(*) n from stock_orders where status='open' and to_outlet_id=$1`, [CK])).n);
cek('2. daftar Order Masuk CK masih kosong', await masuk(), 0);

// =====================================================================
// 3. SATU DRAFT PER PASANGAN OUTLET-TUJUAN
// =====================================================================
await sebagai(MASKAL);
cek('3. menekan tombol lagi mengembalikan draft yang SAMA', await draftOrder(), D);

// Tujuan BERBEDA boleh punya draftnya sendiri — index-nya per pasangan.
const D_CK2 = await draftOrder(SERPONG, CK2);
benar('3. draft ke CK lain adalah draft terpisah', D_CK2 !== D);

// Outlet lain juga tidak terganggu.
await sebagai(ORANG_SENTUL);
const D_SENTUL = await draftOrder(SENTUL, CK);
benar('3. outlet lain punya draftnya sendiri', D_SENTUL !== D);

// Index parsialnya benar-benar menahan penyisipan langsung.
const tolakGanda = await galat(() =>
  q(`insert into stock_orders (business_unit_id, from_outlet_id, to_outlet_id, code, status, created_by)
     values ($1,$2,$3,'OR-DUP','draft',$4)`, [BU, SERPONG, CK, ELSA])
);
benar('3. draft kedua untuk pasangan yang sama DITOLAK index', /duplicate|unique/i.test(tolakGanda ?? ''), String(tolakGanda));

// =====================================================================
// 4. DRAFT KOSONG TIDAK BISA DIKIRIM
//
// Draft BOLEH kosong (orang menghapus barang yang batal), tapi tidak boleh
// BERANGKAT kosong — CK akan menerima permintaan tanpa satu pun barang.
// =====================================================================
await sebagai(ELSA);
const KOSONG = await draftOrder(SERPONG, CK2);
cek('4. draft ke CK2 memang milik yang tadi', KOSONG, D_CK2);
const tolakKosong = await galat(() => q(`select kirim_draft_order($1)`, [KOSONG]));
benar('4. draft kosong ditolak saat dikirim', /masih kosong/i.test(tolakKosong ?? ''), String(tolakKosong));
cek('4. statusnya tetap draft', (await satu(`select status from stock_orders where id=$1`, [KOSONG])).status, 'draft');

// Mengosongkan isi draft SAH — ini beda dari perilaku 0110.
await isi(D_CK2, [{ product_id: SIRUP, qty: 1 }]);
const bolehKosong = await galat(() => isi(D_CK2, []));
benar('4. draft BOLEH dikosongkan isinya', bolehKosong === null, String(bolehKosong));
cek('4.   dan isinya memang nol', await barang(D_CK2), 0);

// =====================================================================
// 5. KIRIM — lalu terkunci
// =====================================================================
await sebagai(MASKAL);
await q(`select kirim_draft_order($1)`, [D]);
const setelah = await satu(`select status, sent_by, sent_at from stock_orders where id=$1`, [D]);
cek('5. statusnya jadi open', setelah.status, 'open');
cek('5. pengirimnya tercatat', setelah.sent_by, MASKAL);
benar('5. waktu kirim tercatat', setelah.sent_at != null);

cek('5. BARU SEKARANG muncul di Order Masuk CK', await masuk(), 1);

const tolakUbah = await galat(() => isi(D, [{ product_id: SIRUP, qty: 99 }]));
benar('5. order terkirim tidak bisa diubah', /sudah dikirim/i.test(tolakUbah ?? ''), String(tolakUbah));
cek('5.   isinya tidak tersentuh', await barang(D), 2);

const tolakKirimUlang = await galat(() => q(`select kirim_draft_order($1)`, [D]));
benar('5. kirim dua kali ditolak', /sudah dikirim/i.test(tolakKirimUlang ?? ''), String(tolakKirimUlang));

// Draft BARU bisa dibuat lagi sesudah yang lama berangkat — index parsialnya
// hanya mengunci yang berstatus draft.
await sebagai(ELSA);
const D_BARU = await draftOrder(SERPONG, CK);
benar('5. draft baru bisa dibuat sesudah yang lama dikirim', D_BARU !== D);

// =====================================================================
// 6. NOTIFIKASI — draft diam, berangkat berbunyi SEKALI
// =====================================================================
const kabarD = await kabarUntuk(D);
cek('6. tepat SATU kabar untuk order ini', kabarD.length, 1);
cek('6. dan itu terjadi saat BERANGKAT, bukan saat dibuat', kabarD[0], { peristiwa: 'UPDATE', status: 'open' });

// Draft yang belum dikirim: tidak ada kabar sama sekali.
cek('6. draft baru tidak mengumumkan apa pun', (await kabarUntuk(D_BARU)).length, 0);
cek('6. draft CK2 juga diam', (await kabarUntuk(D_CK2)).length, 0);

// Mengubah isi draft berkali-kali juga tidak membangunkan siapa pun.
await isi(D_BARU, [{ product_id: SIRUP, qty: 1 }]);
await isi(D_BARU, [{ product_id: SIRUP, qty: 2 }]);
cek('6. menyunting draft tidak mengumumkan apa pun', (await kabarUntuk(D_BARU)).length, 0);

// Order yang dibatalkan tidak ikut mengumumkan.
await q(`select cancel_stock_order($1)`, [D_BARU]);
cek('6. pembatalan tidak mengumumkan apa pun', (await kabarUntuk(D_BARU)).length, 0);

// =====================================================================
// 7. WEWENANG
// =====================================================================
const D2 = await draftOrder(SERPONG, CK);
await isi(D2, [{ product_id: SIRUP, qty: 1 }]);

await sebagai(ORANG_SENTUL);
benar('7. staff outlet lain tidak bisa menyunting draft',
  /outlet asal/i.test((await galat(() => isi(D2, [{ product_id: DAGING, qty: 1 }]))) ?? ''));
benar('7. staff outlet lain tidak bisa mengirim draft',
  /outlet asal/i.test((await galat(() => q(`select kirim_draft_order($1)`, [D2]))) ?? ''));
benar('7. staff outlet lain tidak bisa membuat draft atas nama Serpong',
  /tidak terdaftar/i.test((await galat(() => draftOrder(SERPONG, CK2))) ?? ''));

// Jalur lama ditutup: grant `create_stock_order` sudah dicabut.
const grantLama = Number((await satu(
  `select count(*) n from information_schema.role_routine_grants
    where routine_name = 'create_stock_order' and grantee = 'authenticated'`)).n);
cek('7. grant create_stock_order sudah dicabut', grantLama, 0);

if (gagal === 0) {
  console.log('✅ migrasi 0111: draft disusun bersama, CK baru melihat saat dikirim, notifikasi berbunyi sekali.');
} else {
  console.error(`\n${gagal} pemeriksaan gagal.`);
}
process.exit(gagal === 0 ? 0 : 1);
