/**
 * MIGRATION 0121 DI POSTGRES SUNGGUHAN (PGlite).
 *
 * ============ YANG DIPERBAIKI ============
 *
 * 0120 memberi kantong kas sebuah `outlet_id`, dan seluruh izin "Shenda boleh
 * membebani kas Risma" bergantung padanya. Tidak ada seorang pun yang bisa
 * mengisinya: layarnya cuma ada di Staff App di balik jatah > 1, pemegang
 * berjatah 1 bahkan tidak punya baris kantong sama sekali, dan RLS 0063
 * ber-`with check (holder_id = auth.uid())` sehingga super admin pun tidak
 * boleh menulis kantong orang lain.
 *
 * ============ YANG DIUJI ============
 *
 *   1. Super admin bisa MEMBUATKAN kantong untuk orang lain — dan jalur itu
 *      lengkap sampai Shenda benar-benar bisa membebaninya (0120 + 0121).
 *   2. Non-super-admin tidak bisa, baik membaca daftarnya maupun menulis.
 *   3. Kebijakan `cash_accounts_own` (0063) TIDAK dilonggarkan: jalur tabel
 *      tetap menolak, hanya RPC-nya yang boleh.
 *   4. Kantong tidak bisa pindah pemegang.
 *   5. Jatah kantong tetap dijaga, dengan pesan untuk ADMIN.
 *   6. Kantong berisi uang tidak bisa ditutup.
 *   7. "Kas Utama" muncul di daftarnya — uang tanpa kantong tidak hilang dari layar.
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
const gagalkan = async (fn) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return String(e.message ?? e);
  }
};

await db.exec(`
  -- Perannya dibuat PALING AWAL: kebijakan di bawah menyebut "to authenticated".
  create role authenticated;

  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;

  create table business_units (id uuid primary key default gen_random_uuid(), name text);
  create table outlets (id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text);
  create table user_profiles (id uuid primary key, full_name text, cash_account_limit int not null default 1);
  create table membership_scopes (user_id uuid, business_unit_id uuid, outlet_id uuid, role text);

  create table cash_accounts (
    id uuid primary key default gen_random_uuid(),
    holder_id uuid not null references user_profiles(id) on delete cascade,
    name text not null,
    sort_order int not null default 0,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    unique (holder_id, name)
  );

  create table cash_entries (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, outlet_id uuid,
    holder_id uuid not null references user_profiles(id) on delete cascade,
    account_id uuid references cash_accounts(id) on delete restrict,
    entry_type text not null,
    amount numeric not null,
    category_id uuid, counterpart_id uuid, transfer_id uuid,
    notes text, proof_path text, qty numeric, unit text,
    entry_date date not null default (now() at time zone 'Asia/Jakarta')::date,
    created_by uuid references user_profiles(id) on delete set null,
    created_at timestamptz not null default now()
  );

  -- Fungsi cakupan didefinisikan SEBELUM kebijakan yang menyebutnya. Postgres
  -- menolak kebijakan yang memanggil fungsi yang belum ada, dan pesannya
  -- ("function is_super_admin(uuid) does not exist") menunjuk ke fungsi yang
  -- jelas-jelas tertulis beberapa baris di bawah — mudah salah dibaca sebagai
  -- salah ketik, padahal ini soal urutan.
  create or replace function has_outlet_scope(p_uid uuid, p_outlet uuid) returns boolean language sql stable as $$
    select exists (
      select 1 from membership_scopes ms
       where ms.user_id = p_uid
         and (ms.outlet_id = p_outlet
              or (ms.outlet_id is null and ms.business_unit_id = (select business_unit_id from outlets where id = p_outlet)))
    );
  $$;
  create or replace function is_super_admin(p_uid uuid) returns boolean language sql stable as $$
    select exists (select 1 from membership_scopes where user_id = p_uid and role = 'super_admin');
  $$;

  alter table cash_accounts enable row level security;
  alter table cash_entries enable row level security;

  -- Kebijakan 0063 apa adanya. Tes ini ikut menjaga agar 0121 tidak menyentuhnya.
  create policy cash_accounts_own on cash_accounts
    for all to authenticated
    using (holder_id = auth.uid() or is_super_admin(auth.uid()))
    with check (holder_id = auth.uid());
  create policy cash_entries_select_own on cash_entries
    for select to authenticated using (holder_id = auth.uid());

  -- Trigger jatah 0063, supaya interaksinya dengan 0121 ikut teruji.
  create or replace function cek_batas_kantong_kas() returns trigger language plpgsql as $$
  declare v_batas int; v_jml int;
  begin
    select cash_account_limit into v_batas from user_profiles where id = new.holder_id;
    select count(*) into v_jml from cash_accounts
     where holder_id = new.holder_id and is_active and id is distinct from new.id;
    if new.is_active and v_jml >= coalesce(v_batas, 1) then
      raise exception 'Jatah kantong kas sudah penuh (% kantong). Minta admin menambah jatahnya.', coalesce(v_batas, 1);
    end if;
    return new;
  end;
  $$;
  create trigger trg_batas_kantong_kas before insert or update on cash_accounts
    for each row execute function cek_batas_kantong_kas();
`);

const jalankan = async (b) =>
  db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', b), 'utf8').replace(/notify pgrst[^;]*;/g, ''));

await jalankan('0120_kas_outlet_boleh_dibebani.sql');
await jalankan('0121_kelola_kantong_kas_dari_admin.sql');
console.log('  0120 -> 0121 terpasang.');
await jalankan('0121_kelola_kantong_kas_dari_admin.sql');
console.log('  dijalankan ulang: aman.');

// PGlite menjalankan query sebagai PEMILIK tabel, dan Postgres TIDAK menerapkan
// RLS pada pemilik. Tanpa `set role authenticated`, setiap pemeriksaan RLS di
// bawah akan HIJAU tanpa menguji apa pun. Perannya harus `authenticated`,
// nama yang sama dengan yang disebut kebijakan produksi.
await db.exec(`
  grant usage on schema public to authenticated;
  grant select, insert, update, delete on all tables in schema public to authenticated;
  grant execute on all functions in schema public to authenticated;
`);
const sebagai = async (uid) => {
  await q(`reset role`);
  await q(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  await q(`set role authenticated`);
};
const sebagaiPemilik = () => q(`reset role`);

// =====================================================================
// DATA — kasus yang dilaporkan.
// =====================================================================
const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const SERPONG = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Serpong') returning id`, [BU])).id;
const SENTUL = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Sentul') returning id`, [BU])).id;

const IKO = '00000000-0000-0000-0000-000000000001'; // super admin
const RISMA = '11111111-1111-1111-1111-111111111111'; // pegang kas, jatah 1
const SHENDA = '22222222-2222-2222-2222-222222222222'; // input nota di Serpong
const DINA = '33333333-3333-3333-3333-333333333333'; // staff Sentul, tidak boleh

await q(`insert into user_profiles (id, full_name, cash_account_limit) values
  ($1,'Iko',1), ($2,'Risma',1), ($3,'Shenda',1), ($4,'Dina',1)`, [IKO, RISMA, SHENDA, DINA]);
await q(`insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values
  ($1,$2,null,'super_admin'),
  ($3,$2,$5,'staff'),
  ($4,$2,$5,'staff'),
  ($6,$2,$7,'staff')`, [IKO, BU, RISMA, SHENDA, SERPONG, DINA, SENTUL]);

// =====================================================================
// §1. INTI: super admin membuatkan kantong ber-outlet untuk Risma.
//
// Sebelum 0121 tidak ada satu pun jalan menuju baris ini.
// =====================================================================
await sebagai(IKO);
const KANTONG = await satu(
  `select atur_kantong_kas(null, $1, 'Kas Operasional Serpong', $2, true) as id`,
  [RISMA, SERPONG]
);
benar('§1 INTI: kantong terbuat', !!KANTONG.id);

await sebagaiPemilik();
const baris = await satu(`select holder_id, name, outlet_id, is_active from cash_accounts where id = $1`, [KANTONG.id]);
cek('§1 pemegangnya Risma, outletnya Serpong', [baris.holder_id, baris.outlet_id, baris.is_active], [RISMA, SERPONG, true]);

// =====================================================================
// §2. JALUR LENGKAP: Shenda benar-benar bisa membebaninya sekarang.
//
// Ini yang membedakan "kolomnya terisi" dari "fiturnya hidup". Tanpa §2,
// 0121 bisa lulus seluruhnya sambil tetap menghasilkan kantong yang tidak
// berguna.
// =====================================================================
await sebagai(SHENDA);
const ENTRI = await satu(
  `select catat_kas_di($1, 'out', 250000, null, $2, 'nota telur', 'foto/nota.jpg', null, null, null) as id`,
  [KANTONG.id, SERPONG]
);
benar('§2 Shenda bisa mencatat dari kantong Risma', !!ENTRI.id);

await sebagaiPemilik();
const e = await satu(`select holder_id, created_by, amount from cash_entries where id = $1`, [ENTRI.id]);
cek('§2 uangnya berkurang dari kas RISMA, dicatat oleh SHENDA', [e.holder_id, e.created_by, Number(e.amount)], [RISMA, SHENDA, -250000]);

// Dina bertugas di Sentul — kantongnya menyebut Serpong.
await sebagai(DINA);
const dinaDitolak = await gagalkan(() =>
  q(`select catat_kas_di($1, 'out', 5000, null, $2, 'x', 'foto/x.jpg', null, null, null)`, [KANTONG.id, SENTUL])
);
benar('§2 staff outlet LAIN tetap ditolak', /tidak berhak/i.test(dinaDitolak ?? ''), `dapat: ${dinaDitolak}`);

// =====================================================================
// §3. Non-super-admin tidak bisa memakai jalur admin ini.
// =====================================================================
await sebagai(SHENDA);
const shendaTulis = await gagalkan(() => q(`select atur_kantong_kas(null, $1, 'Kas Curian', $2, true)`, [RISMA, SERPONG]));
benar('§3 staff tidak bisa membuatkan kantong untuk orang lain', /super admin/i.test(shendaTulis ?? ''), `dapat: ${shendaTulis}`);

const shendaBaca = await q(`select * from daftar_kantong_kas()`);
cek('§3 daftar kantong KOSONG untuk non-super-admin', shendaBaca.rows.length, 0);

// Risma sendiri pun tidak boleh memakai fungsi admin untuk kantongnya sendiri —
// jalurnya `saveCashAccount` di Staff App, bukan ini.
await sebagai(RISMA);
const rismaTulis = await gagalkan(() => q(`select atur_kantong_kas($1, $2, 'Ganti Nama', null, true)`, [KANTONG.id, RISMA]));
benar('§3 pemegang pun bukan super admin di sini', /super admin/i.test(rismaTulis ?? ''), `dapat: ${rismaTulis}`);

// =====================================================================
// §4. RLS 0063 TIDAK DILONGGARKAN.
//
// Kalau 0121 diam-diam melonggarkan `with check`, super admin bisa menulis
// kantong siapa pun lewat jalur TABEL — dan seluruh pemeriksaan di
// `atur_kantong_kas` (jatah, kantong berisi, nama bentrok) bisa dilewati
// begitu saja oleh pemanggil mana pun yang memakai PostgREST langsung.
// =====================================================================
// Sasarannya SHENDA, bukan Risma. Percobaan pertama memakai Risma — yang
// jatahnya sudah penuh — jadi insert-nya ditolak oleh TRIGGER JATAH, bukan oleh
// RLS. Pemeriksaannya hijau tanpa menyentuh kebijakan sama sekali: persis
// bentuk "tes yang lulus karena alasan yang salah". Shenda masih punya slot
// kosong, jadi RLS satu-satunya yang bisa menolak.
await sebagai(IKO);
const lewatTabel = await gagalkan(() =>
  q(`insert into cash_accounts (holder_id, name) values ($1, 'Lewat Tabel')`, [SHENDA])
);
benar(
  '§4 super admin TIDAK bisa menulis kantong orang lain lewat tabel',
  lewatTabel !== null && /row-level security|policy/i.test(lewatTabel),
  `dapat: ${lewatTabel}`
);

// =====================================================================
// §5. Kantong tidak bisa pindah pemegang.
// =====================================================================
const pindah = await gagalkan(() =>
  q(`select atur_kantong_kas($1, $2, 'Kas Operasional Serpong', $3, true)`, [KANTONG.id, SHENDA, SERPONG])
);
benar('§5 kantong tidak bisa dipindahkan ke pemegang lain', /pemegang lain/i.test(pindah ?? ''), `dapat: ${pindah}`);

await sebagaiPemilik();
const masihRisma = await satu(`select holder_id from cash_accounts where id = $1`, [KANTONG.id]);
cek('§5 pemegangnya tidak bergeser', masihRisma.holder_id, RISMA);

// =====================================================================
// §6. Jatah kantong tetap dijaga — dengan pesan untuk ADMIN.
//
// Trigger 0063 berkata "Minta admin menambah jatahnya" — kalimat untuk staff,
// sementara yang berdiri di depan layar ini justru adminnya sendiri.
// =====================================================================
await sebagai(IKO);
const jatahPenuh = await gagalkan(() => q(`select atur_kantong_kas(null, $1, 'Kantong Kedua', null, true)`, [RISMA]));
benar('§6 jatah penuh ditolak', jatahPenuh !== null);
benar(
  '§6 pesannya ditujukan ke ADMIN, bukan ke staff',
  /Master User/i.test(jatahPenuh ?? ''),
  `pesan trigger 0063 yang bocor ke layar admin: ${jatahPenuh}`
);

await sebagaiPemilik();
await q(`update user_profiles set cash_account_limit = 2 where id = $1`, [RISMA]);
await sebagai(IKO);
const kedua = await satu(`select atur_kantong_kas(null, $1, 'Kantong Kedua', null, true) as id`, [RISMA]);
benar('§6 setelah jatah dinaikkan, berhasil', !!kedua.id);

// Nama bentrok ditolak dengan kalimat yang bisa ditindaklanjuti, bukan
// "duplicate key value violates unique constraint".
//
// Diuji lewat GANTI NAMA, bukan lewat kantong baru. Kantong baru pada titik ini
// akan ditolak lebih dulu oleh pemeriksaan JATAH — dan pemeriksaan bentroknya
// tidak pernah dijalankan sama sekali, sementara tesnya tetap merah/hijau
// karena alasan yang berbeda dari yang tertulis di namanya.
const bentrok = await gagalkan(() =>
  q(`select atur_kantong_kas($1, null, 'kas operasional serpong', null, true)`, [kedua.id])
);
benar('§6 nama bentrok (beda huruf besar-kecil) ditolak', /sudah punya kantong/i.test(bentrok ?? ''), `dapat: ${bentrok}`);

// =====================================================================
// §7. Kantong yang masih berisi uang tidak bisa ditutup.
//
// Menutupnya membuat saldonya tidak bisa disentuh siapa pun: tetap terhitung
// di total, tapi tidak ada lagi jalan memasukkan atau mengeluarkannya.
// =====================================================================
const tutupBerisi = await gagalkan(() =>
  q(`select atur_kantong_kas($1, null, 'Kas Operasional Serpong', $2, false)`, [KANTONG.id, SERPONG])
);
benar('§7 kantong berisi tidak bisa ditutup', /masih berisi/i.test(tutupBerisi ?? ''), `dapat: ${tutupBerisi}`);

const tutupKosong = await gagalkan(() => q(`select atur_kantong_kas($1, null, 'Kantong Kedua', null, false)`, [kedua.id]));
benar('§7 kantong kosong BOLEH ditutup', tutupKosong === null, `dapat: ${tutupKosong}`);

// =====================================================================
// §8. "Kas Utama" muncul di daftarnya.
//
// Pemegang berjatah 1 tidak punya baris `cash_accounts` sama sekali; uangnya
// hidup sebagai `account_id` NULL. Tanpa baris semu ini, admin melihat daftar
// yang kelihatan lengkap sementara sebagian uangnya justru tidak ada di situ.
// =====================================================================
await sebagaiPemilik();
await q(
  `insert into cash_entries (holder_id, account_id, entry_type, amount, created_by) values ($1, null, 'in', 900000, $1)`,
  [RISMA]
);

await sebagai(IKO);
const daftar = (await q(`select * from daftar_kantong_kas()`)).rows;
const utama = daftar.filter((r) => r.kantong_nyata === false);
cek('§8 ada tepat satu baris Kas Utama', utama.length, 1);
cek('§8 saldonya benar', [utama[0].holder_name, Number(utama[0].balance)], ['Risma', 900000]);
cek('§8 Kas Utama tidak punya id (tidak bisa diedit)', utama[0].id, null);
// Namanya ikut diuji. Layarnya menampilkan kolom ini apa adanya, dan "Kas
// Utama" adalah istilah yang sama dipakai `cash_account_balances` (0063) serta
// layar Staff App — nama yang berbeda di satu tempat saja sudah cukup membuat
// orang mengira ada dua kantong.
cek('§8 namanya persis "Kas Utama", sama dengan layar lain', utama[0].name, 'Kas Utama');

const nyata = daftar.filter((r) => r.kantong_nyata === true);
cek('§8 kantong nyatanya ikut terdaftar', nyata.length, 2);
const opsSerpong = nyata.find((r) => r.name === 'Kas Operasional Serpong');
cek('§8 saldo per kantong dihitung terpisah', Number(opsSerpong.balance), -250000);
cek('§8 outletnya ikut bernama', opsSerpong.outlet_name, 'Serpong');
cek('§8 jatah pemegangnya ikut terbawa', opsSerpong.jatah, 2);

// Pemegang yang tidak punya kantong DAN tidak punya uang tidak perlu muncul.
benar('§8 orang tanpa kas tidak ikut terdaftar', !daftar.some((r) => r.holder_name === 'Dina'));

// =====================================================================
// §9. Outlet yang tidak ada ditolak, dan nama kosong ditolak.
// =====================================================================
const outletHantu = await gagalkan(() =>
  q(`select atur_kantong_kas(null, $1, 'Kas Hantu', '99999999-9999-9999-9999-999999999999', true)`, [SHENDA])
);
benar('§9 outlet tidak dikenal ditolak', /Outlet tidak ditemukan/i.test(outletHantu ?? ''), `dapat: ${outletHantu}`);

const namaKosong = await gagalkan(() => q(`select atur_kantong_kas(null, $1, '   ', null, true)`, [SHENDA]));
benar('§9 nama kosong/spasi ditolak', /tidak boleh kosong/i.test(namaKosong ?? ''), `dapat: ${namaKosong}`);

await sebagaiPemilik();
if (gagal === 0) console.log('Migration 0121 di Postgres sungguhan: 9 bagian LULUS. ✅');
process.exit(gagal === 0 ? 0 : 1);
