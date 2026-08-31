/**
 * MIGRATION 0110 DI POSTGRES SUNGGUHAN (PGlite).
 *
 * ============ YANG DILAPORKAN ============
 *
 *   Elsa (bar)     membuat order ke CK
 *   Maskal (kitchen) ingin menambahkan bahannya  -> DITOLAK
 *
 * Penyebabnya `0035`: `created_by <> v_uid and not is_admin_of_outlet(...)`.
 *
 * ============ KENAPA DIJALANKAN, BUKAN DIBACA ============
 *
 * Melonggarkan wewenang itu mudah dilakukan KELEWATAN. Perbaikan yang benar dan
 * perbaikan yang membuka pintu terlalu lebar terlihat nyaris sama saat dibaca:
 * `has_outlet_scope` vs `has_bu_scope` cuma beda satu kata, dan yang kedua
 * membuat staff Sentul bisa menyunting order Serpong.
 *
 * Jadi di sini yang diperiksa BUKAN "apakah Maskal bisa" saja, melainkan juga
 * siapa yang TETAP HARUS DITOLAK — dan itu setengah dari tesnya.
 *
 * Kerangkanya memasang `0031` lalu `0035` lebih dulu, persis urutan produksi,
 * supaya versi lamanya benar-benar ada untuk ditimpa. Pelajaran dari `0103`:
 * kerangka yang membuat fungsi dari nol membuat kegagalan `create or replace`
 * tidak pernah muncul di tes, padahal ia menggagalkan migration di produksi.
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
    code text, status text not null default 'open', notes text, reject_reason text,
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

  -- VERSI LAMA dipasang dulu, persis seperti di produksi. Kalau 0110 suatu saat
  -- mengubah tipe kembaliannya, error 42P13 akan muncul DI SINI, bukan di SQL
  -- Editor milik iko.
  --
  -- CATATAN: JANGAN memakai backtick di komentar SQL ini. Seluruh blok ini
  -- adalah template literal JavaScript, dan satu backtick MENUTUPNYA di tengah
  -- jalan. Jebakan ini sudah tiga kali terjadi di repo ini (modul shift,
  -- test-migrasi-0103, lalu berkas ini). Pakai tanda kutip biasa.
  create or replace function update_stock_order(p_order uuid, p_items jsonb, p_notes text)
  returns void language plpgsql security definer set search_path = public as $x$
  declare v_o stock_orders%rowtype; v_uid uuid := auth.uid();
  begin
    select * into v_o from stock_orders where id = p_order;
    if v_o.created_by <> v_uid and not is_admin_of_outlet(v_uid, v_o.from_outlet_id) then
      raise exception 'Hanya pembuat order atau admin outlet asal yang bisa mengubah';
    end if;
  end; $x$;

  create or replace function cancel_stock_order(p_order uuid)
  returns void language plpgsql security definer set search_path = public as $x$
  declare v_o stock_orders%rowtype; v_uid uuid := auth.uid();
  begin
    select * into v_o from stock_orders where id = p_order;
    if v_o.created_by <> v_uid and not is_bu_admin(v_uid, v_o.business_unit_id) then
      raise exception 'Hanya pembuat order atau admin BU yang bisa membatalkan';
    end if;
  end; $x$;
`);

const jalankan = async (b) =>
  db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', b), 'utf8').replace(/notify pgrst[^;]*;/g, ''));

await jalankan('0110_order_milik_outlet.sql');
console.log('  0110 menimpa versi lama: aman.');
await jalankan('0110_order_milik_outlet.sql');
console.log('  dijalankan ulang: aman.');

// =====================================================================
// DATA — kasus yang dilaporkan, apa adanya.
// =====================================================================
const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const BU2 = (await satu(`insert into business_units (name) values ('Hotel') returning id`)).id;
const SERPONG = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Serpong') returning id`, [BU])).id;
const SENTUL = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Sentul') returning id`, [BU])).id;
const CK = (await satu(`insert into outlets (business_unit_id, name, outlet_role) values ($1,'CK','central_kitchen') returning id`, [BU])).id;

const ELSA = '11111111-1111-1111-1111-111111111111';   // bar, Serpong
const MASKAL = '22222222-2222-2222-2222-222222222222'; // kitchen, Serpong
const ORANG_SENTUL = '33333333-3333-3333-3333-333333333333';
const ADMIN_BU = '44444444-4444-4444-4444-444444444444';
const ORANG_LUAR = '55555555-5555-5555-5555-555555555555'; // BU lain

await q(`insert into user_profiles (id, full_name) values ($1,'Elsa'),($2,'Maskal'),($3,'Sentul'),($4,'Admin'),($5,'Luar')`,
  [ELSA, MASKAL, ORANG_SENTUL, ADMIN_BU, ORANG_LUAR]);
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values
  ($1,$6,$7,'staff'), ($2,$6,$7,'staff'), ($3,$6,$8,'staff'), ($4,$6,$7,'bu_admin'), ($5,$9,null,'staff')`,
  [ELSA, MASKAL, ORANG_SENTUL, ADMIN_BU, ORANG_LUAR, BU, SERPONG, SENTUL, BU2]);

const SIRUP = (await satu(`insert into products (business_unit_id, name) values ($1,'Sirup') returning id`, [BU])).id;
const DAGING = (await satu(`insert into products (business_unit_id, name) values ($1,'Daging') returning id`, [BU])).id;
const GULA = (await satu(`insert into products (business_unit_id, name) values ($1,'Gula') returning id`, [BU])).id;

const buatOrder = async () =>
  (await satu(
    `insert into stock_orders (business_unit_id, from_outlet_id, to_outlet_id, code, created_by)
     values ($1,$2,$3,'ORD-TEST-' || substr(gen_random_uuid()::text,1,4), $4) returning id`,
    [BU, SERPONG, CK, ELSA]
  )).id;

const isiOrder = async (id) =>
  (await q(`select product_id, qty from stock_order_items where order_id = $1 order by qty`, [id])).rows;

const ubah = (id, items) =>
  q(`select update_stock_order($1, $2::jsonb, null)`, [id, JSON.stringify(items)]);

// =====================================================================
// 1. ELSA MEMBUAT, MASKAL MENAMBAH — inti laporannya
// =====================================================================
const ORD = await buatOrder();
await sebagai(ELSA);
await ubah(ORD, [{ product_id: SIRUP, qty: 5 }]);
cek('1. Elsa mengisi 1 bahan', (await isiOrder(ORD)).length, 1);

await sebagai(MASKAL);
const tolakMaskal = await galat(() => ubah(ORD, [
  { product_id: SIRUP, qty: 5 },
  { product_id: DAGING, qty: 10 }
]));
benar('1. Maskal (rekan seoutlet) BOLEH menambah', tolakMaskal === null, String(tolakMaskal));
cek('1. isinya jadi 2 bahan', (await isiOrder(ORD)).length, 2);

// Nomor ordernya TIDAK berganti. Kalau berganti, CK menerima dua dokumen untuk
// satu permintaan dan menyiapkan dua keranjang.
const kode = (await satu(`select code from stock_orders where id=$1`, [ORD])).code;
benar('1. nomor order tidak berganti', /^ORD-TEST-/.test(kode), kode);

// Jejak pengubahnya tercatat — pembuatnya TIDAK ikut tertimpa.
const jejak = await satu(`select created_by, edited_by from stock_orders where id=$1`, [ORD]);
cek('1. pembuat tetap Elsa', jejak.created_by, ELSA);
cek('1. pengubah tercatat Maskal', jejak.edited_by, MASKAL);

// =====================================================================
// 2. YANG TETAP HARUS DITOLAK
//
// Setengah dari nilai tes ini ada di sini. `has_outlet_scope` yang tidak
// sengaja ditulis `has_bu_scope` akan LULUS §1 dengan sempurna.
// =====================================================================
await sebagai(ORANG_SENTUL);
const tolakSentul = await galat(() => ubah(ORD, [{ product_id: GULA, qty: 1 }]));
benar('2. staff outlet LAIN di BU yang sama tetap ditolak', /outlet asal/i.test(tolakSentul ?? ''), String(tolakSentul));

await sebagai(ORANG_LUAR);
const tolakLuar = await galat(() => ubah(ORD, [{ product_id: GULA, qty: 1 }]));
benar('2. orang BU lain tetap ditolak', tolakLuar !== null, String(tolakLuar));

cek('2. penolakan tidak mengubah isinya', (await isiOrder(ORD)).length, 2);

// =====================================================================
// 3. ORDER YANG SUDAH DIPROSES TETAP TERKUNCI
//
// Penjaga ini TIDAK ikut dilonggarkan: CK sudah menyiapkan barangnya
// berdasarkan isi yang lama.
// =====================================================================
const ORD2 = await buatOrder();
await sebagai(ELSA);
await ubah(ORD2, [{ product_id: SIRUP, qty: 3 }]);
await q(`update stock_orders set status='fulfilled' where id=$1`, [ORD2]);

await sebagai(MASKAL);
const tolakSelesai = await galat(() => ubah(ORD2, [{ product_id: DAGING, qty: 9 }]));
benar('3. order fulfilled tidak bisa diubah', /sudah diproses/i.test(tolakSelesai ?? ''), String(tolakSelesai));
cek('3. isinya tidak tersentuh', (await isiOrder(ORD2)).length, 1);

// =====================================================================
// 4. ORDER TIDAK BOLEH BERAKHIR KOSONG
//
// `update_stock_order` MENGHAPUS isinya dulu baru menulis ulang. Kalau yang
// masuk nol dan penjaganya hilang, ordernya tertinggal kosong — dan CK
// menerima permintaan tanpa satu pun barang.
// =====================================================================
await sebagai(MASKAL);
const tolakKosong = await galat(() => ubah(ORD, []));
benar('4. kiriman kosong ditolak', /minimal satu produk/i.test(tolakKosong ?? ''), String(tolakKosong));
cek('4. isi lamanya KEMBALI UTUH sesudah ditolak', (await isiOrder(ORD)).length, 2);

// Item bernilai nol/negatif dilewati, dan kalau hasilnya nol -> ditolak juga.
const tolakNol = await galat(() => ubah(ORD, [{ product_id: SIRUP, qty: 0 }]));
benar('4. qty 0 tidak menghasilkan order kosong', /minimal satu produk/i.test(tolakNol ?? ''), String(tolakNol));
cek('4.   dan isinya tetap utuh', (await isiOrder(ORD)).length, 2);

// =====================================================================
// 5. MEMBATALKAN — disamakan dengan mengubah
// =====================================================================
const ORD3 = await buatOrder();
await sebagai(ELSA);
await ubah(ORD3, [{ product_id: SIRUP, qty: 2 }]);

await sebagai(ORANG_SENTUL);
const batalSentul = await galat(() => q(`select cancel_stock_order($1)`, [ORD3]));
benar('5. staff outlet lain tidak bisa membatalkan', batalSentul !== null, String(batalSentul));

await sebagai(MASKAL);
const batalMaskal = await galat(() => q(`select cancel_stock_order($1)`, [ORD3]));
benar('5. rekan seoutlet BOLEH membatalkan', batalMaskal === null, String(batalMaskal));

const st = await satu(`select status, handled_by from stock_orders where id=$1`, [ORD3]);
cek('5. statusnya cancelled', st.status, 'cancelled');
// Siapa yang membatalkan HARUS tercatat. Inilah yang meredam risiko
// melonggarkan wewenang ini: "siapa yang membatalkan order saya?" bisa dijawab.
cek('5. pembatalnya tercatat', st.handled_by, MASKAL);

// Order yang sudah dibatalkan tidak bisa dibatalkan lagi.
const batalUlang = await galat(() => q(`select cancel_stock_order($1)`, [ORD3]));
benar('5. batal dua kali ditolak', /sudah diproses/i.test(batalUlang ?? ''), String(batalUlang));

// ADMIN BU TIDAK KEHILANGAN KEMAMPUANNYA.
//
// Melonggarkan tidak boleh sekaligus mencabut. Admin BU bisa membatalkan sejak
// 0031, dan mengganti syaratnya jadi `has_outlet_scope` SAJA akan diam-diam
// mencabutnya untuk admin yang tidak punya baris scope di outlet itu.
const ORD4 = await buatOrder();
await sebagai(ELSA);
await ubah(ORD4, [{ product_id: SIRUP, qty: 1 }]);
await q(`delete from membership_scopes where user_id = $1`, [ADMIN_BU]);
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values ($1,$2,null,'bu_admin')`, [ADMIN_BU, BU]);
await sebagai(ADMIN_BU);
const batalAdmin = await galat(() => q(`select cancel_stock_order($1)`, [ORD4]));
benar('5. admin BU tanpa scope outlet tetap bisa membatalkan', batalAdmin === null, String(batalAdmin));

// =====================================================================
// 6. HARUS LOGIN
// =====================================================================
await q(`select set_config('request.jwt.claim.sub', '', false)`);
const tanpaLogin = await galat(() => ubah(ORD, [{ product_id: SIRUP, qty: 1 }]));
benar('6. tanpa login ditolak', /harus login/i.test(tanpaLogin ?? ''), String(tanpaLogin));

if (gagal === 0) {
  console.log('✅ migrasi 0110: rekan seoutlet bisa menambah order, outlet lain tetap ditolak, jejaknya tercatat.');
} else {
  console.error(`\n${gagal} pemeriksaan gagal.`);
}
process.exit(gagal === 0 ? 0 : 1);
