/**
 * MIGRATION 0151 DI POSTGRES SUNGGUHAN (PGlite).
 *
 * ============ KESALAHAN YANG DIBUKTIKAN DULU ============
 *
 * 0149/0150 memetakan kolom `Account` berkas Disbursement dari KATEGORI BIAYA.
 * Contoh di templatenya berisi '1 1 02 01' — akun HARTA, bukan akun biaya.
 * Yang diminta ESB adalah dari mana uangnya keluar.
 *
 * §0 membuktikan keadaan sebelum perbaikannya: `kas_untuk_esb` tidak
 * mengembalikan satu pun keterangan tentang kantong, jadi tidak ada apa pun
 * yang bisa dipakai menjawab pertanyaan itu — sementara `kategori_nama` ada di
 * sana dan terlihat seperti jawaban yang benar.
 *
 * ============ SISANYA ============
 *
 *   §1 Outlet MILIK KANTONG ikut, dan ia BERBEDA dari outlet peruntukan.
 *   §2 Entri tanpa kantong tetap muncul (LEFT JOIN) — hilang dari daftar
 *      berarti hilang juga dari daftar tertahan.
 *   §3 Seluruh penjaga 0150 selamat dari penulisan ulang.
 *   §4 `outlet_kantong_kas_esb` — daftar nama yang perlu dipetakan.
 *   §5 Wewenang & sumbu BU tidak berubah.
 *   §6 Dijalankan dua kali tetap aman.
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
  -- KANTONG KAS ber-OUTLET (0063 + 0120). Harness 0150 hanya punya (id, name);
  -- tanpa \`outlet_id\` seluruh berkas ini tidak bisa menguji apa pun.
  create table cash_accounts (
    id uuid primary key default gen_random_uuid(),
    holder_id uuid, name text, outlet_id uuid references outlets(id) on delete set null);
  create table goods_receipts (id uuid primary key default gen_random_uuid(), code text, payment_entry_id uuid);

  create table cash_entries (
    id uuid primary key default gen_random_uuid(),
    -- DEPRECATED sejak 0040: entri baru meninggalkannya NULL.
    business_unit_id uuid,
    outlet_id uuid, holder_id uuid, entry_type text, amount numeric,
    category_id uuid, account_id uuid references cash_accounts(id) on delete set null,
    counterpart_id uuid,
    notes text, qty numeric, unit text, proof_path text,
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

  create or replace function is_admin_of_outlet(p_user_id uuid, p_outlet_id uuid) returns boolean
    language sql security definer stable as $$
      select exists (
        select 1 from membership_scopes ms
        join outlets o on o.id = p_outlet_id
        where ms.user_id = p_user_id
          and (ms.role = 'super_admin'
               or (ms.role = 'bu_admin' and ms.business_unit_id = o.business_unit_id))) $$;

  create or replace function boleh_koreksi_kas(p_holder uuid) returns boolean
    language sql security definer stable as $$ select p_holder = auth.uid() $$;
  create or replace function panjang_alasan_batal_esb() returns int language sql immutable as $$ select 10 $$;
  create or replace function alasan_batal_esb_sah(p_alasan text) returns text
  language plpgsql immutable as $$
  declare v text := btrim(coalesce(p_alasan, ''));
  begin
    if length(v) < panjang_alasan_batal_esb() then
      raise exception 'Alasan wajib diisi, minimal % huruf.', panjang_alasan_batal_esb();
    end if;
    return v;
  end $$;

  create or replace function alasan_tolak_koreksi_kas(p_entry uuid) returns text
    language sql stable as $$ select null::text $$;
  create or replace function ubah_kas(
    p_entry uuid, p_amount numeric, p_category uuid, p_outlet uuid,
    p_notes text, p_qty numeric, p_unit text, p_date date
  ) returns void language plpgsql as $lama$ begin return; end $lama$;
  create or replace function riwayat_kas_saya(p_limit int default 50)
  returns table (id uuid, entry_date date, entry_type text, amount numeric, notes text)
  language sql stable as $lama$
    select ce.id, ce.entry_date, ce.entry_type, ce.amount, ce.notes
      from cash_entries ce where ce.holder_id = auth.uid() limit coalesce(p_limit, 50)
  $lama$;
`);

const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const BU2 = (await satu(`insert into business_units (name) values ('Lain') returning id`)).id;
const OUT = (await satu(`insert into outlets (business_unit_id, name) values ($1,'AB Gading Serpong') returning id`, [BU])).id;
const OUT_B = (await satu(`insert into outlets (business_unit_id, name) values ($1,'AB Sentul') returning id`, [BU])).id;
const OUT_LAIN = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Outlet BU Lain') returning id`, [BU2])).id;
const KAT = (await satu(`insert into cash_categories (name) values ('Transportasi') returning id`)).id;

const ADMIN = '11111111-1111-1111-1111-111111111111';
const STAFF = '22222222-2222-2222-2222-222222222222';
await q(`insert into user_profiles (id, full_name) values ($1,'Admin'), ($2,'Risma')`, [ADMIN, STAFF]);
await q(`insert into membership_scopes (user_id, business_unit_id, role) values ($1,$2,'bu_admin'), ($3,$2,'staff')`, [
  ADMIN,
  BU,
  STAFF
]);

// Kantong milik Risma yang ditempeli outlet SENTUL — sementara belanjanya
// untuk Gading Serpong. Inilah keadaan yang membuat `outlet_id` entrinya tidak
// boleh dipakai sebagai COA: uangnya keluar dari kas Sentul.
const KANTONG_SENTUL = (
  await satu(`insert into cash_accounts (holder_id, name, outlet_id) values ($1,'Kas Operasional',$2) returning id`, [STAFF, OUT_B])
).id;
// Kantong yang BELUM ditempeli outlet — 0120 membuat kolomnya nullable.
const KANTONG_TANPA_OUTLET = (
  await satu(`insert into cash_accounts (holder_id, name, outlet_id) values ($1,'Kas Pribadi',null) returning id`, [STAFF])
).id;
// Kantong milik outlet BU LAIN. Kas melekat pada ORANG (0040), jadi ini sah.
const KANTONG_BU_LAIN = (
  await satu(`insert into cash_accounts (holder_id, name, outlet_id) values ($1,'Kas Titipan',$2) returning id`, [STAFF, OUT_LAIN])
).id;

const buatKas = async (o = {}) =>
  (
    await satu(
      `insert into cash_entries (outlet_id, holder_id, entry_type, amount, category_id, account_id, notes, entry_date, untuk_nota, penyesuaian_nota, dicoret_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
      [
        o.outlet ?? OUT,
        o.holder ?? STAFF,
        o.type ?? 'out',
        o.amount ?? -30000,
        o.kat ?? KAT,
        // `??` sengaja TIDAK dipakai untuk kantong: "tanpa kantong" adalah
        // keadaan yang harus bisa diminta secara eksplisit, dan `?? KANTONG`
        // akan diam-diam mengembalikan kantong bawaan untuk `null`.
        'kantong' in o ? o.kantong : KANTONG_SENTUL,
        o.notes ?? 'gojek makanan',
        o.tanggal ?? '2026-09-19',
        o.untukNota ?? false,
        o.penyesuaian ?? null,
        o.dicoret ?? null
      ]
    )
  ).id;

const jalankan = async (b) =>
  db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', b), 'utf8').replace(/notify pgrst[^;]*;/g, ''));

await jalankan('0149_disbursement_kas.sql');
await jalankan('0150_disbursement_lewat_outlet.sql');
const TRANSPORT = await buatKas();

console.log('§0 Keadaan sebelum 0151');

await jadi(ADMIN);
// `information_schema` tidak menyimpan kolom kembalian fungsi, jadi
// dibuktikan lewat query yang HARUS gagal: kolomnya memang belum ada.
let adaKolomKantong = true;
try {
  await semua(`select kantong_outlet_nama from kas_untuk_esb($1,$2,$3,null)`, [BU, '2026-09-01', '2026-09-30']);
} catch {
  adaKolomKantong = false;
}
benar('§0 INTI: sebelum 0151, tidak ada satu pun keterangan kantong di kas_untuk_esb', adaKolomKantong === false);
cek(
  '§0 sementara `kategori_nama` ada di sana, dan terlihat seperti jawaban yang benar',
  (await semua(`select kategori_nama from kas_untuk_esb($1,$2,$3,null)`, [BU, '2026-09-01', '2026-09-30']))[0].kategori_nama,
  'Transportasi'
);

await jalankan('0151_coa_disbursement_dari_kantong.sql');
console.log('  0151 terpasang.');

const ambil = async (bu = BU, outlet = null, dari = '2026-09-01', sampai = '2026-09-30') =>
  semua(`select * from kas_untuk_esb($1,$2,$3,$4)`, [bu, dari, sampai, outlet]);

console.log('\n§1 Outlet MILIK KANTONG, bukan outlet peruntukan');

let baris = await ambil();
cek('§1 entrinya ketemu', baris.length, 1);
cek('§1 outlet PERUNTUKAN (kolom Branch) tetap Gading Serpong', baris[0].outlet_nama, 'AB Gading Serpong');
cek('§1 INTI: outlet KANTONG (kolom Account) adalah Sentul — berbeda', baris[0].kantong_outlet_nama, 'AB Sentul');
cek('§1 nama kantongnya ikut, untuk alasan tertahannya', baris[0].kantong_nama, 'Kas Operasional');
benar(
  '§1 INTI: keduanya BERBEDA — kalau sama, tes ini tidak membuktikan apa pun',
  baris[0].outlet_nama !== baris[0].kantong_outlet_nama
);

console.log('\n§2 Entri tanpa kantong tetap muncul');

// `join` biasa akan MENGHILANGKANNYA — dan hilang dari daftar berarti hilang
// dari daftar tertahan juga: "1 siap, 0 tertahan" untuk 3 entri, tanpa satu
// pun tempat bagi dua sisanya untuk muncul.
const TANPA_KANTONG = await buatKas({ kantong: null, notes: 'parkir' });
const KANTONG_KOSONG = await buatKas({ kantong: KANTONG_TANPA_OUTLET, notes: 'materai' });

baris = await ambil();
cek('§2 INTI: ketiganya ada di daftar — LEFT JOIN, bukan JOIN', baris.length, 3);

const perId = new Map(baris.map((b) => [b.id, b]));
cek('§2 yang tanpa baris kantong dinamai "Kas Utama"', perId.get(TANPA_KANTONG).kantong_nama, 'Kas Utama');
benar('§2 …dan outlet kantongnya null, bukan ditebak', perId.get(TANPA_KANTONG).kantong_outlet_nama === null);
cek('§2 kantong bernama tanpa outlet menyebut namanya sendiri', perId.get(KANTONG_KOSONG).kantong_nama, 'Kas Pribadi');
benar('§2 …dan outlet kantongnya juga null', perId.get(KANTONG_KOSONG).kantong_outlet_nama === null);
// Yang paling berbahaya: jatuh diam-diam ke outlet peruntukan.
benar(
  '§2 INTI: tidak jatuh ke outlet peruntukan',
  perId.get(TANPA_KANTONG).kantong_outlet_nama !== perId.get(TANPA_KANTONG).outlet_nama
);

console.log('\n§3 Penjaga 0150 selamat dari penulisan ulang');

const BAYAR_NOTA = await buatKas({ untukNota: true });
const NOTA = (await satu(`insert into goods_receipts (code, payment_entry_id) values ('TRM-1', $1) returning id`, [BAYAR_NOTA])).id;
const PENYESUAIAN = await buatKas({ penyesuaian: NOTA });
const DICORET = await buatKas({ dicoret: new Date().toISOString() });
const MASUK = await buatKas({ type: 'in', amount: 158600 });
await buatKas({ outlet: OUT_LAIN, notes: 'belanja BU lain' });

cek('§3 pembayaran nota, penyesuaian, yang dicoret, kas masuk & BU lain tetap tidak ikut', (await ambil()).length, 3);
cek('§3 di luar rentang tanggal tetap tidak ikut', (await ambil(BU, null, '2026-10-01', '2026-10-31')).length, 0);
cek('§3 saringan per outlet masih jalan', (await ambil(BU, OUT)).length, 3);

await jadi(STAFF);
cek('§3 staff tetap tidak melihat apa pun', (await ambil()).length, 0);
await jadi(null);
cek('§3 tanpa login tetap kosong', (await ambil()).length, 0);
await jadi(ADMIN);

cek('§3 menandai masih jalan', (await satu(`select tandai_kas_esb($1) as n`, [[TRANSPORT]])).n, 1);
cek('§3 yang sudah ditandai tidak ditawarkan lagi', (await ambil()).length, 2);
cek(
  '§3 …dan ikut lagi kalau diminta',
  (await semua(`select * from kas_untuk_esb($1,$2,$3,$4,$5)`, [BU, '2026-09-01', '2026-09-30', null, true])).length,
  3
);
cek(
  '§3 tandanya masih bisa dibuka',
  (await satu(`select batalkan_tanda_kas_esb($1,$2) as n`, [[TRANSPORT], 'berkasnya ditolak ESB, belum masuk'])).n,
  1
);

console.log('\n§4 Daftar outlet kantong untuk dipetakan');

const namaKantong = async (bu = BU) => (await semua(`select nama from outlet_kantong_kas_esb($1)`, [bu])).map((r) => r.nama);

cek('§4 hanya outlet yang SUNGGUH jadi pemilik kantong', await namaKantong(), ['AB Sentul']);

// Kantong milik outlet BU LAIN, dipakai untuk belanja BU INI. Tanpa baris ini
// di daftar, namanya muncul sebagai alasan tertahan tanpa satu pun tempat
// untuk memperbaikinya.
await buatKas({ kantong: KANTONG_BU_LAIN, notes: 'beli galon' });
cek('§4 INTI: outlet kantong LINTAS BU ikut terdaftar', await namaKantong(), ['AB Sentul', 'Outlet BU Lain']);

// Entri yang TIDAK LAYAK EKSPOR tidak menyumbang nama. Daftar yang penuh nama
// dari entri yang tidak akan pernah diekspor adalah pekerjaan yang tidak
// menyelesaikan apa pun — dan yang mengerjakannya tidak punya cara tahu itu.
//
// Kantongnya sengaja BARU, milik outlet yang belum pernah muncul: memakai
// kantong yang sudah terdaftar membuat pemeriksaan ini tidak bisa membedakan
// "disaring" dari "kebetulan sudah ada".
const OUT_C = (await satu(`insert into outlets (business_unit_id, name) values ($1,'AB Bintaro') returning id`, [BU])).id;
const KANTONG_BINTARO = (
  await satu(`insert into cash_accounts (holder_id, name, outlet_id) values ($1,'Kas Bintaro',$2) returning id`, [STAFF, OUT_C])
).id;
await buatKas({ kantong: KANTONG_BINTARO, untukNota: true, notes: 'bayar nota' });
await buatKas({ kantong: KANTONG_BINTARO, dicoret: new Date().toISOString(), notes: 'salah input' });
cek('§4 INTI: kantong yang hanya dipakai entri tak-layak-ekspor tidak masuk daftar', await namaKantong(), [
  'AB Sentul',
  'Outlet BU Lain'
]);

// …dan tidak digandakan oleh entri kedua dengan kantong yang sama.
await buatKas({ kantong: KANTONG_BU_LAIN, notes: 'beli galon lagi' });
cek('§4 daftarnya tidak digandakan oleh entri kedua', await namaKantong(), ['AB Sentul', 'Outlet BU Lain']);

await jadi(STAFF);
cek('§4 staff tidak bisa membacanya', await namaKantong(), []);
await jadi(ADMIN);
cek('§4 BU lain: kosong dari sudut pandang admin ini', await namaKantong(BU2), []);

console.log('\n§5 Wewenang menandai tetap lewat outlet');

await jadi(STAFF);
cek('§5 staff tidak bisa menandai', (await satu(`select tandai_kas_esb($1) as n`, [[TRANSPORT]])).n, 0);
await jadi(ADMIN);

console.log('\n§6 Dijalankan ulang');

// Dibandingkan dengan keadaan SEBELUM dijalankan ulang, bukan dengan angka
// yang ditulis tangan: angka tetap harus diperbarui tiap kali sebuah entri
// ditambahkan di atas, dan yang lupa memperbaruinya akan melihat tes ini merah
// karena alasan yang tidak ada hubungannya dengan idempotensi.
const sebelumUlang = (await ambil()).length;
await jalankan('0151_coa_disbursement_dari_kantong.sql');
cek('§6 aman dijalankan dua kali', (await ambil()).length, sebelumUlang);
cek('§6 …dan daftar kantongnya tetap sama', await namaKantong(), ['AB Sentul', 'Outlet BU Lain']);

console.log('');
if (gagal === 0) console.log('Semua pemeriksaan 0151 lolos. ✅');
else console.error(`${gagal} pemeriksaan 0151 GAGAL.`);
process.exit(gagal === 0 ? 0 : 1);
