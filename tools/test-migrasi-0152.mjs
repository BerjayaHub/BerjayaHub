/**
 * MIGRATION 0152 DI POSTGRES SUNGGUHAN (PGlite).
 *
 * ============ APA YANG DIBUKTIKAN ============
 *
 *   §0 Keadaan awalnya: entri di Kas Utama, saldo kantong NEGATIF — dan
 *      `pindah_kas` tidak akan memperbaikinya karena entrinya tetap NULL.
 *   §1 Memindahkan entri ke kantong, dan saldonya ikut benar.
 *   §2 Syarat boleh-tidaknya MENUMPANG `alasan_tolak_koreksi_kas` — bukan
 *      daftar kedua yang cepat atau lambat menyimpang.
 *   §3 Kantong milik orang lain ditolak.
 *   §4 Wewenang: staff nol, pemegangnya sendiri bisa, admin BU bisa.
 *   §5 Jejaknya tercatat, dan hanya untuk baris yang sungguh berubah.
 *   §6 `kantong_pemegang` — daftar tujuannya.
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
const melempar = async (nama, fn, pola) => {
  try {
    await fn();
    gagal++;
    console.error(`❌ ${nama} — tidak melempar sama sekali.`);
  } catch (e) {
    if (pola && !pola.test(e.message ?? '')) {
      gagal++;
      console.error(`❌ ${nama} — pesannya tidak cocok: ${e.message}`);
    } else console.log(`  ✔ ${nama}`);
  }
};

const db = new PGlite();
const q = (sql, params) => db.query(sql, params);
const satu = async (sql, params) => (await q(sql, params)).rows[0];
const semua = async (sql, params) => (await q(sql, params)).rows;
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
  create table cash_accounts (
    id uuid primary key default gen_random_uuid(),
    holder_id uuid, name text, sort_order int not null default 0,
    is_active boolean not null default true,
    outlet_id uuid references outlets(id) on delete set null);
  create table goods_receipts (id uuid primary key default gen_random_uuid(), code text, payment_entry_id uuid);

  create table cash_entries (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid,
    outlet_id uuid, holder_id uuid, entry_type text, amount numeric,
    category_id uuid, account_id uuid references cash_accounts(id) on delete set null,
    counterpart_id uuid,
    notes text, qty numeric, unit text, proof_path text,
    entry_date date not null default current_date,
    untuk_nota boolean not null default false,
    penyesuaian_nota uuid references goods_receipts(id) on delete set null,
    esb_exported_at timestamptz,
    dicoret_at timestamptz, dicoret_by uuid, alasan_coret text,
    diubah_at timestamptz, diubah_by uuid,
    created_at timestamptz not null default now());

  create or replace function is_super_admin(p_uid uuid) returns boolean
    language sql security definer stable as $$
      select exists (select 1 from membership_scopes ms
        where ms.user_id = p_uid and ms.role = 'super_admin') $$;

  -- Dibutuhkan "boleh_koreksi_kas" yang ditulis ulang 0152.
  -- (Tanda kutip, BUKAN backtick: satu backtick di dalam template literal JS
  --  mengakhirinya di tengah SQL. Sudah terjadi empat kali di repo ini.)
  create or replace function is_bu_admin(p_uid uuid, p_bu uuid) returns boolean
    language sql security definer stable as $$
      select exists (select 1 from membership_scopes ms
        where ms.user_id = p_uid
          and (ms.role = 'super_admin' or (ms.role = 'bu_admin' and ms.business_unit_id = p_bu))) $$;
`);

// `boleh_koreksi_kas` & `alasan_tolak_koreksi_kas` dipasang APA ADANYA dari
// migration aslinya — bukan ditiru. Meniru penjaganya di harness berarti tes
// ini akan tetap hijau walau penjaga sungguhannya berubah.
const jalankan = async (b) =>
  db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', b), 'utf8').replace(/notify pgrst[^;]*;/g, ''));

await db.exec(`
  -- BENTUK 0141 APA ADANYA, termasuk lubang NULL-nya. §0 membuktikan lubang
  -- itu ADA sebelum 0152 menutupnya; menuliskan versi yang sudah benar di sini
  -- akan membuat perbaikannya terlihat berhasil tanpa pernah diuji.
  create or replace function boleh_koreksi_kas(p_holder uuid) returns boolean
  language sql security definer stable as $$
    select is_super_admin(auth.uid())
        or p_holder = auth.uid()
        or exists (
          select 1 from membership_scopes ms
          where ms.user_id = p_holder
            and ms.business_unit_id is not null
            and is_bu_admin(auth.uid(), ms.business_unit_id))
  $$;

  create or replace function alasan_tolak_koreksi_kas(p_entry uuid) returns text
  language plpgsql security definer stable as $$
  declare v cash_entries%rowtype; v_kode text;
  begin
    select * into v from cash_entries where id = p_entry;
    if v.id is null then return 'Entri kasnya tidak ditemukan.'; end if;
    if not boleh_koreksi_kas(v.holder_id) then return 'Kas ini bukan wewenangmu.'; end if;
    if v.dicoret_at is not null then return 'Entri ini sudah dihapus sebelumnya.'; end if;
    if v.esb_exported_at is not null then return 'Entri ini sudah diekspor ke ESB.'; end if;
    if v.entry_type not in ('in', 'out') then return 'Transfer tidak bisa dikoreksi sepotong.'; end if;
    select string_agg(code, ', ') into v_kode from goods_receipts where payment_entry_id = p_entry;
    if v_kode is not null then return 'Entri ini pembayaran nota ' || v_kode || '.'; end if;
    if v.penyesuaian_nota is not null then return 'Entri ini penyesuaian otomatis dari koreksi nota.'; end if;
    return null;
  end $$;
`);

const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const OUT = (await satu(`insert into outlets (business_unit_id, name) values ($1,'AB Gading Serpong') returning id`, [BU])).id;
const KAT = (await satu(`insert into cash_categories (name) values ('Transportasi') returning id`)).id;

const ADMIN = '11111111-1111-1111-1111-111111111111';
const RISMA = '22222222-2222-2222-2222-222222222222';
const IIS = '33333333-3333-3333-3333-333333333333';
await q(`insert into user_profiles (id, full_name) values ($1,'Admin'), ($2,'Risma'), ($3,'Iis')`, [ADMIN, RISMA, IIS]);
await q(
  `insert into membership_scopes (user_id, business_unit_id, role)
   values ($1,$2,'bu_admin'), ($3,$2,'staff'), ($4,$2,'staff')`,
  [ADMIN, BU, RISMA, IIS]
);

const KAS_SERPONG = (
  await satu(`insert into cash_accounts (holder_id, name, outlet_id) values ($1,'Kas Serpong',$2) returning id`, [RISMA, OUT])
).id;
const KAS_NONAKTIF = (
  await satu(`insert into cash_accounts (holder_id, name, outlet_id, is_active) values ($1,'Kas Lama',$2,false) returning id`, [
    RISMA,
    OUT
  ])
).id;
const KAS_IIS = (
  await satu(`insert into cash_accounts (holder_id, name, outlet_id) values ($1,'Kas CK iis',$2) returning id`, [IIS, OUT])
).id;

const buatKas = async (o = {}) =>
  (
    await satu(
      `insert into cash_entries (outlet_id, holder_id, entry_type, amount, category_id, account_id, notes, entry_date, untuk_nota, penyesuaian_nota, dicoret_at, esb_exported_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
      [
        o.type === 'in' ? null : (o.outlet ?? OUT),
        o.holder ?? RISMA,
        o.type ?? 'out',
        o.amount ?? -30000,
        o.kat ?? KAT,
        'kantong' in o ? o.kantong : null,
        o.notes ?? 'gojek makanan',
        o.tanggal ?? '2026-09-19',
        o.untukNota ?? false,
        o.penyesuaian ?? null,
        o.dicoret ?? null,
        o.diekspor ?? null
      ]
    )
  ).id;

const saldoKantong = async (holder) =>
  (
    await semua(
      `select coalesce(a.name, 'Kas Utama') as nama, sum(ce.amount)::int as saldo
         from cash_entries ce
         left join cash_accounts a on a.id = ce.account_id
        where ce.holder_id = $1 and ce.dicoret_at is null
        group by 1 order by 1`,
      [holder]
    )
  ).map((r) => `${r.nama}=${r.saldo}`);

console.log('§0 Keadaan awalnya — angka yang mustahil');

// Persis bentuk yang terlihat di layar Kantong Kas: pembayaran nota membebani
// KANTONG, kas masuk & kas keluar biasa mendarat di KAS UTAMA.
const BAYAR_NOTA = await buatKas({ kantong: KAS_SERPONG, amount: -46000, notes: 'bayar nota' });
await q(`insert into goods_receipts (code, payment_entry_id) values ('TRM-1', $1)`, [BAYAR_NOTA]);
const MASUK = await buatKas({ type: 'in', amount: 158600, notes: 'setoran' });
const KELUAR_A = await buatKas({ amount: -30000, notes: 'gojek makanan' });
const KELUAR_B = await buatKas({ amount: -27000, notes: 'gojek makanan ke alsut' });

cek('§0 INTI: saldo kantong NEGATIF sementara Kas Utama positif', await saldoKantong(RISMA), [
  'Kas Serpong=-46000',
  'Kas Utama=101600'
]);

// LUBANG NULL-nya dibuktikan ADA lebih dulu.
await jadi(null);
benar(
  '§0 INTI: sebelum 0152, `boleh_koreksi_kas` menjawab NULL tanpa sesi — dan `not NULL` tidak menyalakan IF mana pun',
  (await satu(`select boleh_koreksi_kas($1) as b`, [RISMA])).b === null
);

await jalankan('0152_pindahkan_entri_ke_kantong.sql');
console.log('  0152 terpasang.');

benar(
  '§0 …dan sesudahnya ia menjawab false, bukan NULL',
  (await satu(`select boleh_koreksi_kas($1) as b`, [RISMA])).b === false
);
// Penjaga lamanya tetap utuh: admin BU & pemegangnya sendiri masih boleh.
await jadi(ADMIN);
benar('§0 admin BU tetap boleh', (await satu(`select boleh_koreksi_kas($1) as b`, [RISMA])).b === true);
await jadi(RISMA);
benar('§0 pemegangnya sendiri tetap boleh', (await satu(`select boleh_koreksi_kas($1) as b`, [RISMA])).b === true);

console.log('\n§1 Memindahkan entri ke kantong');

await jadi(ADMIN);
cek('§1 INTI: tiga entri Kas Utama pindah', (await satu(`select ubah_kantong_kas($1,$2) as n`, [[MASUK, KELUAR_A, KELUAR_B], KAS_SERPONG])).n, 3);
cek('§1 …dan saldonya jadi masuk akal', await saldoKantong(RISMA), ['Kas Serpong=55600']);

// Dijalankan ulang: nol, karena semuanya sudah di sana. Angka yang tetap 3
// akan membuat layarnya berkata "3 dipindahkan" untuk pekerjaan yang tidak
// terjadi.
cek('§1 memindahkan yang sudah di sana: 0', (await satu(`select ubah_kantong_kas($1,$2) as n`, [[MASUK, KELUAR_A], KAS_SERPONG])).n, 0);

cek('§1 daftar kosong: 0, bukan melempar', (await satu(`select ubah_kantong_kas($1,$2) as n`, [[], KAS_SERPONG])).n, 0);
cek('§1 daftar null: 0', (await satu(`select ubah_kantong_kas(null,$1) as n`, [KAS_SERPONG])).n, 0);

await melempar(
  '§1 INTI: memindahkan KEMBALI ke Kas Utama ditolak — itu keadaan yang sedang dibereskan',
  () => q(`select ubah_kantong_kas($1,null)`, [[KELUAR_A]]),
  /Kas Utama/
);
await melempar('§1 kantong yang tidak ada ditolak', () => q(`select ubah_kantong_kas($1,$2)`, [[KELUAR_A], ADMIN]), /tidak ditemukan/);
await melempar(
  '§1 kantong NONAKTIF ditolak, dan pesannya menyebut namanya',
  () => q(`select ubah_kantong_kas($1,$2)`, [[KELUAR_A], KAS_NONAKTIF]),
  /Kas Lama/
);

console.log('\n§2 Syaratnya menumpang alasan_tolak_koreksi_kas');

const TEREKSPOR = await buatKas({ notes: 'sudah diekspor', diekspor: new Date().toISOString() });
const DICORET = await buatKas({ notes: 'salah input', dicoret: new Date().toISOString() });
const PENYESUAIAN = await buatKas({ notes: 'penyesuaian', penyesuaian: (await semua(`select id from goods_receipts`))[0].id });
const TRANSFER = await buatKas({ type: 'transfer_out', notes: 'transfer' });

for (const [nama, id] of [
  ['yang sudah diekspor ke ESB', TEREKSPOR],
  ['yang sudah dicoret', DICORET],
  ['pembayaran nota', BAYAR_NOTA],
  ['penyesuaian nota', PENYESUAIAN],
  ['transfer', TRANSFER]
]) {
  cek(`§2 ${nama} tidak bisa dipindahkan`, (await satu(`select ubah_kantong_kas($1,$2) as n`, [[id], KAS_SERPONG])).n, 0);
}

// Dan penjaganya SUNGGUH yang itu, bukan salinan: kalau `alasan_tolak_koreksi_kas`
// membuka salah satunya, aksi ini ikut membukanya. Dibuktikan dengan
// melonggarkan penjaganya sementara.
await db.exec(`
  create or replace function alasan_tolak_koreksi_kas(p_entry uuid) returns text
    language sql security definer stable as $$ select null::text $$;
`);
cek(
  '§2 INTI: melonggarkan penjaganya ikut melonggarkan aksi ini — daftarnya TIDAK disalin',
  (await satu(`select ubah_kantong_kas($1,$2) as n`, [[TEREKSPOR], KAS_SERPONG])).n,
  1
);
await db.exec(`
  create or replace function alasan_tolak_koreksi_kas(p_entry uuid) returns text
  language plpgsql security definer stable as $$
  declare v cash_entries%rowtype; v_kode text;
  begin
    select * into v from cash_entries where id = p_entry;
    if v.id is null then return 'Entri kasnya tidak ditemukan.'; end if;
    if not boleh_koreksi_kas(v.holder_id) then return 'Kas ini bukan wewenangmu.'; end if;
    if v.dicoret_at is not null then return 'Entri ini sudah dihapus sebelumnya.'; end if;
    if v.esb_exported_at is not null then return 'Entri ini sudah diekspor ke ESB.'; end if;
    if v.entry_type not in ('in', 'out') then return 'Transfer tidak bisa dikoreksi sepotong.'; end if;
    select string_agg(code, ', ') into v_kode from goods_receipts where payment_entry_id = p_entry;
    if v_kode is not null then return 'Entri ini pembayaran nota ' || v_kode || '.'; end if;
    if v.penyesuaian_nota is not null then return 'Entri ini penyesuaian otomatis dari koreksi nota.'; end if;
    return null;
  end $$;
`);

console.log('\n§3 Kantong milik orang lain');

const KELUAR_C = await buatKas({ notes: 'parkir' });
cek(
  '§3 INTI: entri Risma tidak bisa masuk ke kantong Iis — saldo dua orang berubah sekaligus tanpa disebut transfer',
  (await satu(`select ubah_kantong_kas($1,$2) as n`, [[KELUAR_C], KAS_IIS])).n,
  0
);
benar(
  '§3 …dan entrinya memang tidak tersentuh',
  (await satu(`select account_id from cash_entries where id = $1`, [KELUAR_C])).account_id === null
);

console.log('\n§4 Wewenang');

await jadi(IIS);
// DITOLAK TERANG-TERANGAN, bukan diam-diam nol. Kantong orang lain bukan
// "tidak ada baris yang cocok" — itu penolakan wewenang, dan mengembalikan 0
// untuknya membuat layarnya berkata "0 dari 1 dipindahkan — sisanya sudah di
// kantong itu", kalimat yang menyesatkan.
await melempar(
  '§4 INTI: staff lain tidak bisa menyentuh kantong orang lain',
  () => q(`select ubah_kantong_kas($1,$2)`, [[KELUAR_C], KAS_SERPONG]),
  /bukan wewenangmu/
);
// Sebaliknya: kantongnya SENDIRI sah, tapi entrinya milik orang lain. Di sini
// penjaganya bukan wewenang melainkan `holder_id` — dan hasilnya 0, tanpa
// menyentuh apa pun. Tanpa penjaga itu, uang Risma pindah ke kantong Iis dan
// saldo keduanya berubah sekaligus tanpa satu pun layar menyebutnya transfer.
cek(
  '§4 INTI: entri orang lain tidak bisa ditarik ke kantong sendiri',
  (await satu(`select ubah_kantong_kas($1,$2) as n`, [[KELUAR_C], KAS_IIS])).n,
  0
);

// Tanpa sesi: DITOLAK, bukan diteruskan. Sebelum 0152 panggilan ini justru
// LOLOS — `boleh_koreksi_kas` menjawab NULL, `not NULL` tidak menyalakan IF,
// dan `alasan_tolak_koreksi_kas` jatuh sampai `return null` yang artinya
// "tidak ada alasan menolak".
await jadi(null);
await melempar(
  '§4 INTI: tanpa sesi ditolak — lubang NULL di penjaganya sudah ditutup',
  () => q(`select ubah_kantong_kas($1,$2)`, [[KELUAR_C], KAS_SERPONG]),
  /bukan wewenangmu/
);
benar(
  '§4 …dan entrinya memang tidak tersentuh',
  (await satu(`select account_id from cash_entries where id = $1`, [KELUAR_C])).account_id === null
);

await jadi(RISMA);
cek('§4 INTI: pemegangnya sendiri bisa', (await satu(`select ubah_kantong_kas($1,$2) as n`, [[KELUAR_C], KAS_SERPONG])).n, 1);

console.log('\n§5 Jejaknya');

await jadi(ADMIN);
const KELUAR_D = await buatKas({ notes: 'tol' });
await q(`select ubah_kantong_kas($1,$2)`, [[KELUAR_D], KAS_SERPONG]);
const jejak = await satu(`select diubah_by, diubah_at from cash_entries where id = $1`, [KELUAR_D]);
benar('§5 pengubahnya tercatat', jejak.diubah_by === ADMIN);
benar('§5 waktunya tercatat', jejak.diubah_at !== null);

// Baris yang TIDAK berubah tidak ditulisi jejak perubahan yang tidak terjadi.
const sebelum = (await satu(`select diubah_at from cash_entries where id = $1`, [KELUAR_D])).diubah_at;
await jadi(RISMA);
await q(`select ubah_kantong_kas($1,$2)`, [[KELUAR_D], KAS_SERPONG]);
benar(
  '§5 INTI: memindahkan ke kantong yang sama tidak menulis jejak baru',
  String((await satu(`select diubah_at from cash_entries where id = $1`, [KELUAR_D])).diubah_at) === String(sebelum)
);

console.log('\n§6 Daftar kantong tujuannya');

await jadi(ADMIN);
const daftar = async (holder) => (await semua(`select name from kantong_pemegang($1)`, [holder])).map((r) => r.name);
cek('§6 hanya kantong AKTIF milik orang itu', await daftar(RISMA), ['Kas Serpong']);
cek('§6 kantong orang lain tidak bocor', await daftar(IIS), ['Kas CK iis']);

await jadi(IIS);
cek('§6 INTI: staff tidak bisa melihat kantong orang lain', await daftar(RISMA), []);
cek('§6 …tapi melihat kantongnya sendiri', await daftar(IIS), ['Kas CK iis']);
await jadi(null);
cek('§6 tanpa login: kosong', await daftar(RISMA), []);

console.log('\n§7 Dijalankan ulang');

await jalankan('0152_pindahkan_entri_ke_kantong.sql');
await jadi(ADMIN);
cek('§7 aman dijalankan dua kali', await daftar(RISMA), ['Kas Serpong']);

console.log('');
if (gagal === 0) console.log('Semua pemeriksaan 0152 lolos. ✅');
else console.error(`${gagal} pemeriksaan 0152 GAGAL.`);
process.exit(gagal === 0 ? 0 : 1);
