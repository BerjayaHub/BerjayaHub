/**
 * MIGRATION 0149 DI POSTGRES SUNGGUHAN (PGlite).
 *
 * ============ YANG DIUJI ============
 *
 *   §1 Kolom supplier, jejaknya, dan penanda ekspornya terpasang.
 *   §2 `alasan_tolak_koreksi_kas` menolak yang sudah diekspor — dan penolakan
 *      itu menular ke KETIGA pintu, bukan cuma ke `ubah_kas`.
 *   §3 `ubah_kas` menyimpan Supplier, mengosongkannya untuk kas MASUK, dan
 *      tidak menyentuh jejaknya saat nilainya tidak berubah.
 *   §4 Tanda tangan 8-argumen BENAR-BENAR hilang.
 *   §5 `ubah_supplier_kas` — melewati yang dicoret, yang bukan kas keluar,
 *      yang sudah diekspor, dan yang bukan wewenangnya.
 *   §6 `tandai_kas_esb` & `batalkan_tanda_kas_esb`.
 *   §7 Dijalankan dua kali tetap aman.
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
  } else console.log(`  ✔ ${nama}`);
};
const benar = (nama, syarat, ket = '') => {
  if (!syarat) {
    gagal++;
    console.error(`❌ ${nama}${ket ? ' — ' + ket : ''}`);
  } else console.log(`  ✔ ${nama}`);
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
const jadi = async (uid) => q(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? '']);

await db.exec(`
  create role authenticated;
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;
  create table membership_scopes (
    id uuid primary key default gen_random_uuid(),
    user_id uuid, business_unit_id uuid, outlet_id uuid, role text);
  create table business_units (id uuid primary key default gen_random_uuid(), name text);
  create table outlets (id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text);
  create table user_profiles (id uuid primary key, full_name text);
  create table cash_categories (id uuid primary key default gen_random_uuid(), name text);
  create table cash_accounts (id uuid primary key default gen_random_uuid(), name text);
  create table goods_receipts (
    id uuid primary key default gen_random_uuid(),
    code text, payment_entry_id uuid);

  -- cash_entries APA ADANYA sebelum 0149: kolom 0141 & 0131 sudah ada,
  -- supplier & penanda ESB belum. Kalau 0149 tidak menambahkannya, §1 gagal.
  create table cash_entries (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid not null references business_units(id) on delete cascade,
    outlet_id uuid, holder_id uuid, entry_type text, amount numeric,
    category_id uuid, account_id uuid, counterpart_id uuid, notes text, qty numeric, unit text, proof_path text,
    entry_date date not null default current_date,
    untuk_nota boolean not null default false,
    penyesuaian_nota uuid references goods_receipts(id) on delete set null,
    dicoret_at timestamptz, dicoret_by uuid, alasan_coret text,
    diubah_at timestamptz, diubah_by uuid,
    created_at timestamptz not null default now());

  create or replace function is_bu_admin(p_uid uuid, p_bu uuid) returns boolean
    language sql security definer stable as $$
      select exists (select 1 from membership_scopes ms
        where ms.user_id = p_uid
          and (ms.role = 'super_admin' or (ms.role = 'bu_admin' and ms.business_unit_id = p_bu))) $$;

  -- Tiruan 0141: wewenang koreksi kas.
  create or replace function boleh_koreksi_kas(p_holder uuid) returns boolean
    language sql security definer stable as $$
      select p_holder = auth.uid()
          or exists (select 1 from membership_scopes ms
               where ms.user_id = auth.uid()
                 and (ms.role = 'super_admin'
                      or (ms.role = 'bu_admin'
                          and ms.business_unit_id = (select business_unit_id from cash_entries
                                                      where holder_id = p_holder limit 1)))) $$;

  -- Tiruan 0143: penjaga alasan pembatalan.
  create or replace function panjang_alasan_batal_esb() returns int
    language sql immutable as $$ select 10 $$;
  create or replace function alasan_batal_esb_sah(p_alasan text) returns text
  language plpgsql immutable as $$
  declare v text := btrim(coalesce(p_alasan, ''));
  begin
    if length(v) < panjang_alasan_batal_esb() then
      raise exception 'Alasan membatalkan tanda ekspor wajib diisi, minimal % huruf.', panjang_alasan_batal_esb();
    end if;
    return v;
  end $$;
`);

// Tiruan 0141 `ubah_kas` & `alasan_tolak_koreksi_kas` dengan TANDA TANGAN LAMA.
//
// Dipasang sungguhan supaya §4 menguji 0149 MEMBUANGNYA — bukan lolos karena
// yang dicari memang tidak pernah ada.
await db.exec(`
  create or replace function alasan_tolak_koreksi_kas(p_entry uuid) returns text
  language sql stable as $$ select null::text $$;
  create or replace function ubah_kas(
    p_entry uuid, p_amount numeric, p_category uuid, p_outlet uuid,
    p_notes text, p_qty numeric, p_unit text, p_date date
  ) returns void language plpgsql as $lama$ begin return; end $lama$;

  -- riwayat_kas_saya LAMA, dengan daftar kolom 0141 yang BELUM memuat
  -- supplier. Dipasang sungguhan supaya 0149 benar-benar harus membuangnya:
  -- "create or replace function" MENOLAK perubahan daftar kolom, jadi tanpa
  -- "drop function" migrationnya gagal di tengah jalan. Kalau fungsinya tidak
  -- pernah ada di sini, drop yang dihapus tidak menghapus apa pun dan
  -- sabotasenya lolos — bukan karena aman, melainkan karena tidak diuji.
  --
  -- (Tanda petik biasa, BUKAN backtick: blok ini ada di dalam template literal
  -- JavaScript. Ini KETIGA kalinya jebakan yang sama menggigit di sesi ini.)
  create or replace function riwayat_kas_saya(p_limit int default 50)
  returns table (id uuid, entry_date date, entry_type text, amount numeric, notes text)
  language sql stable as $lama$
    select ce.id, ce.entry_date, ce.entry_type, ce.amount, ce.notes
      from cash_entries ce where ce.holder_id = auth.uid() limit coalesce(p_limit, 50)
  $lama$;
`);

const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const BU2 = (await satu(`insert into business_units (name) values ('Lain') returning id`)).id;
const OUT = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Sentul') returning id`, [BU])).id;
const KAT = (await satu(`insert into cash_categories (name) values ('Bensin') returning id`)).id;

const ADMIN = '11111111-1111-1111-1111-111111111111';
const STAFF = '22222222-2222-2222-2222-222222222222';
const ORANG_LAIN = '33333333-3333-3333-3333-333333333333';
await q(`insert into user_profiles (id, full_name) values ($1,'Admin'), ($2,'Staff'), ($3,'Lain')`, [ADMIN, STAFF, ORANG_LAIN]);
await q(
  `insert into membership_scopes (user_id, business_unit_id, role)
   values ($1,$2,'bu_admin'), ($3,$2,'staff'), ($4,$2,'staff')`,
  [ADMIN, BU, STAFF, ORANG_LAIN]
);

const buatKas = async (o = {}) =>
  (
    await satu(
      `insert into cash_entries (business_unit_id, outlet_id, holder_id, entry_type, amount, category_id, notes, entry_date, untuk_nota)
       values ($1, $2, $3, $4, $5, $6, $7, '2026-09-10', $8) returning id`,
      [
        o.bu ?? BU,
        o.outlet ?? OUT,
        o.holder ?? STAFF,
        o.type ?? 'out',
        o.amount ?? -120000,
        o.kat ?? KAT,
        o.notes ?? 'Bensin',
        o.untukNota ?? false
      ]
    )
  ).id;

const jalankan = async (b) =>
  db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', b), 'utf8').replace(/notify pgrst[^;]*;/g, ''));

await jalankan('0149_disbursement_kas.sql');
console.log('  0149 terpasang.');

console.log('\n§1 Kolom & indeksnya');

const kolom = (
  await q(
    `select column_name from information_schema.columns
      where table_name = 'cash_entries' and (column_name like 'supplier%' or column_name like 'esb%')
      order by column_name`
  )
).rows.map((r) => r.column_name);
cek('§1 delapan kolom baru terpasang', kolom, [
  'esb_alasan_batal',
  'esb_dibatalkan_at',
  'esb_dibatalkan_by',
  'esb_exported_at',
  'esb_exported_by',
  'supplier',
  'supplier_diisi_at',
  'supplier_diisi_by'
]);
benar('§1 indeks parsial yang belum diekspor ada', (await satu(`select 1 from pg_indexes where indexname = 'idx_kas_belum_esb'`)) !== undefined);

console.log('\n§2 Yang sudah diekspor terkunci');

const K1 = await buatKas();
await jadi(STAFF);
cek('§2 entri biasa boleh dikoreksi', await satu(`select alasan_tolak_koreksi_kas($1) as a`, [K1]).then((r) => r.a), null);

await q(`update cash_entries set esb_exported_at = now() where id = $1`, [K1]);
const tolak = (await satu(`select alasan_tolak_koreksi_kas($1) as a`, [K1])).a;
benar('§2 sudah diekspor -> ditolak', tolak !== null);
benar(
  '§2 dan penolakannya menyebut jalan keluarnya',
  /Batalkan tanda ekspor/.test(tolak ?? ''),
  'penolakan tanpa jalan keluar membuat orangnya membuka SQL Editor'
);
// Penjaganya ada di `alasan_tolak_koreksi_kas`, jadi ia menular ke SEMUA yang
// membacanya — bukan cuma ke pintu yang kebetulan diingat.
benar(
  '§2 INTI: `ubah_kas` ikut menolak karena membaca penjaga yang sama',
  (await galat(`select ubah_kas($1, 1000, $2, $3, 'x', null, null, null, 'Pasar')`, [K1, KAT, OUT])) !== null
);
await q(`update cash_entries set esb_exported_at = null where id = $1`, [K1]);

console.log('\n§3 ubah_kas menyimpan Supplier');

await jadi(STAFF);
await q(`select ubah_kas($1, 150000, $2, $3, 'Bensin motor', null, null, null, '  Pasar  ')`, [K1, KAT, OUT]);
let r = await satu(`select supplier, supplier_diisi_by, supplier_diisi_at, amount from cash_entries where id = $1`, [K1]);
cek('§3 supplier tersimpan & spasi tepi dirapikan', r.supplier, 'Pasar');
benar('§3 pengisinya tercatat', r.supplier_diisi_by === STAFF && r.supplier_diisi_at !== null);
cek('§3 kas keluar tetap bertanda minus', Number(r.amount), -150000);

// MENGOREKSI NOMINAL TIDAK BOLEH MENGKLAIM PENGISIAN SUPPLIER.
//
// Dikoreksi ADMIN, bukan staff yang tadi memilihnya — dan itu yang membuat
// pemeriksaan ini berarti. Dengan orang yang sama, `supplier_diisi_by` tetap
// bernilai sama entah jejaknya disentuh atau tidak, dan pemeriksaannya hijau
// tanpa menguji apa pun.
//
// Jejaknya menjawab "siapa yang MEMILIH suppliernya", bukan "siapa yang
// terakhir menyentuh barisnya". Kalau ia ditulis ulang tiap koreksi, jawaban
// itu berpindah ke orang kantor yang cuma membetulkan satu angka.
const jejakLama = r.supplier_diisi_at;
await jadi(ADMIN);
await q(`select ubah_kas($1, 175000, $2, $3, 'Bensin motor', null, null, null, 'Pasar')`, [K1, KAT, OUT]);
r = await satu(`select supplier_diisi_at, supplier_diisi_by from cash_entries where id = $1`, [K1]);
cek('§3 INTI: waktu jejaknya tidak tersentuh saat suppliernya tidak berubah', String(r.supplier_diisi_at), String(jejakLama));
benar(
  '§3 INTI: jejaknya tetap menyebut yang MEMILIH, bukan yang terakhir mengoreksi',
  r.supplier_diisi_by === STAFF,
  `tercatat ${r.supplier_diisi_by === ADMIN ? 'ADMIN' : r.supplier_diisi_by}`
);
await jadi(STAFF);

// Kas MASUK tidak pernah jadi Disbursement.
const MASUK = await buatKas({ type: 'in', amount: 50000, outlet: null });
await q(`select ubah_kas($1, 50000, $2, null, 'Setoran', null, null, null, 'Pasar')`, [MASUK, KAT]);
cek(
  '§3 kas MASUK selalu berakhir tanpa supplier, apa pun yang dikirim layar',
  (await satu(`select supplier from cash_entries where id = $1`, [MASUK])).supplier,
  null
);

console.log('\n§4 Tanda tangan lama benar-benar hilang');

const nArg = (await q(`select pronargs from pg_proc where proname = 'ubah_kas' order by pronargs`)).rows.map((x) => x.pronargs);
cek('§4 hanya ada SATU ubah_kas, berargumen 9', nArg, [9]);
benar(
  '§4 memanggilnya dengan 8 argumen gagal',
  (await galat(`select ubah_kas($1, 1000, $2, $3, 'x', null, null, null)`, [K1, KAT, OUT])) !== null,
  'dua overload berarti Supplier yang baru dipilih lenyap tanpa satu pun pesan'
);

console.log('\n§5 ubah_supplier_kas');

const K2 = await buatKas();
const K3 = await buatKas();
await jadi(STAFF);
cek('§5 dua entri terisi', (await satu(`select ubah_supplier_kas($1,'AICE') as n`, [[K2, K3]])).n, 2);
cek('§5 nilainya benar', (await satu(`select supplier from cash_entries where id = $1`, [K2])).supplier, 'AICE');

benar(
  '§5 mengosongkannya DITOLAK',
  (await galat(`select ubah_supplier_kas($1,'  ')`, [[K2]])) !== null,
  'mengosongkan tidak memperbaiki apa pun — entrinya tetap tertahan, tanpa jejak kenapa'
);

const DICORET = await buatKas();
await q(`update cash_entries set dicoret_at = now() where id = $1`, [DICORET]);
cek('§5 yang dicoret dilewati', (await satu(`select ubah_supplier_kas($1,'AICE') as n`, [[DICORET]])).n, 0);

cek('§5 kas masuk dilewati', (await satu(`select ubah_supplier_kas($1,'AICE') as n`, [[MASUK]])).n, 0);

const SUDAH = await buatKas();
await q(`update cash_entries set esb_exported_at = now() where id = $1`, [SUDAH]);
cek('§5 yang sudah diekspor dilewati', (await satu(`select ubah_supplier_kas($1,'AICE') as n`, [[SUDAH]])).n, 0);

// Wewenangnya dipinjam dari penjaga koreksi kas (0141), bukan ditulis ulang.
const KAS_ORANG_LAIN = await buatKas({ holder: ORANG_LAIN });
await jadi(STAFF);
cek('§5 kas orang lain dilewati', (await satu(`select ubah_supplier_kas($1,'AICE') as n`, [[KAS_ORANG_LAIN]])).n, 0);
await jadi(ADMIN);
cek('§5 admin BU boleh mengisinya', (await satu(`select ubah_supplier_kas($1,'AICE') as n`, [[KAS_ORANG_LAIN]])).n, 1);

cek('§5 daftar kosong: 0 tanpa melempar', (await satu(`select ubah_supplier_kas(null,'AICE') as n`)).n, 0);

console.log('\n§6 Tandai & batalkan tandanya');

await jadi(ADMIN);
cek('§6 dua entri ditandai', (await satu(`select tandai_kas_esb($1) as n`, [[K2, K3]])).n, 2);
benar('§6 penandanya tercatat', (await satu(`select esb_exported_by from cash_entries where id = $1`, [K2])).esb_exported_by === ADMIN);
cek('§6 menandai ulang: 0', (await satu(`select tandai_kas_esb($1) as n`, [[K2, K3]])).n, 0);
cek('§6 kas masuk tidak bisa ditandai', (await satu(`select tandai_kas_esb($1) as n`, [[MASUK]])).n, 0);

await jadi(STAFF);
cek('§6 staff tidak bisa menandai', (await satu(`select tandai_kas_esb($1) as n`, [[await buatKas()]])).n, 0);
cek(
  '§6 staff tidak bisa membuka tanda',
  (await satu(`select batalkan_tanda_kas_esb($1,$2) as n`, [[K2], 'berkasnya ditolak ESB, belum masuk'])).n,
  0
);

await jadi(ADMIN);
benar('§6 alasan terlalu pendek DITOLAK', (await galat(`select batalkan_tanda_kas_esb($1,'salah')`, [[K2]])) !== null);
cek(
  '§6 satu tanda dibuka',
  (await satu(`select batalkan_tanda_kas_esb($1,$2) as n`, [[K2], 'berkasnya ditolak ESB, belum masuk ke sana'])).n,
  1
);
const jejak = await satu(
  `select esb_exported_at, esb_dibatalkan_by, esb_alasan_batal from cash_entries where id = $1`,
  [K2]
);
benar('§6 tandanya terbuka & jejaknya lengkap', jejak.esb_exported_at === null && jejak.esb_dibatalkan_by === ADMIN && /ditolak ESB/.test(jejak.esb_alasan_batal));

// Yang TIDAK bertanda dilewati — bukan ditulisi jejak yang tidak pernah terjadi.
const BELUM = await buatKas();
cek('§6 yang tidak bertanda dilewati', (await satu(`select batalkan_tanda_kas_esb($1,$2) as n`, [[BELUM], 'coba-coba membukanya'])).n, 0);
benar('§6 dan TIDAK ditulisi jejak palsu', (await satu(`select esb_dibatalkan_at from cash_entries where id = $1`, [BELUM])).esb_dibatalkan_at === null);

const KAS_BU_LAIN = await buatKas({ bu: BU2, holder: ORANG_LAIN });
await q(`update cash_entries set esb_exported_at = now() where id = $1`, [KAS_BU_LAIN]);
cek('§6 kas BU lain tidak tersentuh', (await satu(`select tandai_kas_esb($1) as n`, [[KAS_BU_LAIN]])).n, 0);
cek(
  '§6 dan tandanya tidak bisa dibuka dari BU ini',
  (await satu(`select batalkan_tanda_kas_esb($1,$2) as n`, [[KAS_BU_LAIN], 'mencoba dari BU yang salah'])).n,
  0
);

console.log('\n§7 riwayat_kas_saya mengembalikan Supplier');

// Dialog koreksi mengisi kotaknya dari `e.supplier`. Kalau RPC-nya tidak
// mengembalikan kolom itu, kotaknya tampil KOSONG untuk entri yang sudah
// terisi — dan menekan "Simpan perubahan" MENGHAPUSNYA, tanpa satu pun tanda.
const kolomRiwayat = (
  await q(`select p.proargnames from pg_proc p where p.proname = 'riwayat_kas_saya'`)
).rows[0].proargnames;
benar('§7 riwayat_kas_saya memuat kolom supplier', kolomRiwayat.includes('supplier'));
benar('§7 dan penanda ekspornya', kolomRiwayat.includes('esb_exported_at'));
// Kolom LAMA tidak bergeser: yang menyisipkan di tengah memindahkan isinya,
// bukan namanya, dan tiap layar yang membacanya diam-diam membaca yang salah.
cek(
  '§7 kolom lama tetap di urutannya',
  kolomRiwayat.slice(1, 6),
  ['id', 'entry_date', 'entry_type', 'amount', 'notes']
);

await jadi(STAFF);
const riwayat = (await q(`select * from riwayat_kas_saya(50)`)).rows;
const barisK1 = riwayat.find((x) => x.id === K1);
benar('§7 nilainya benar-benar terbaca', barisK1 !== undefined && barisK1.supplier === 'Pasar');

console.log('\n§8 Dijalankan ulang');

await jalankan('0149_disbursement_kas.sql');
cek(
  '§8 aman dijalankan dua kali — suppliernya tetap',
  (await satu(`select count(*)::int as n from cash_entries where supplier is not null`)).n,
  4
);

console.log('');
if (gagal === 0) console.log('Semua pemeriksaan 0149 lolos. ✅');
else console.error(`${gagal} pemeriksaan 0149 GAGAL.`);
process.exit(gagal === 0 ? 0 : 1);
