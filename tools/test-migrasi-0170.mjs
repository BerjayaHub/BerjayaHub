/**
 * 0170 — KERUSAKAN ASET & RIWAYAT PERUBAHAN (PGlite — Postgres sungguhan).
 *
 *   §1 Mencatat kerusakan mengurangi jumlahnya.
 *   §2 Yang ditolak — dan kenapa menolak lebih baik daripada memotong.
 *   §3 Foto wajib, dijaga database bukan cuma layar.
 *   §4 Tanggal kejadian, bukan tanggal pengetikan.
 *   §5 Riwayat diisi trigger, lewat jalur mana pun.
 *   §6 Membatalkan kerusakan mengembalikan jumlahnya.
 *   §7 Wewenang.
 *
 * ============ YANG SEBENARNYA DIUJI DI SINI ============
 *
 * Pertanyaan yang harus bisa dijawab aplikasi sesudah ini:
 *
 *     "Bulan lalu piringnya 12, sekarang 8. Ke mana yang empat?"
 *
 * Jadi yang diuji bukan "apakah angkanya berkurang" — itu bagian yang mudah.
 * Yang diuji: apakah sesudah angkanya berkurang, SEBABNYA masih bisa
 * ditemukan, lengkap dengan siapa dan kapan — termasuk setelah orang yang
 * mencatatnya keluar dari perusahaan.
 */
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let gagal = 0;
let n = 0;
const cek = (nama, dapat, harap) => {
  n++;
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};
const benar = (nama, syarat, ket = '') => {
  n++;
  if (!syarat) {
    gagal++;
    console.error(`❌ ${nama}${ket ? ' — ' + ket : ''}`);
  }
};

const db = new PGlite();
const q = (sql, params) => db.query(sql, params);
const satu = async (sql, params) => (await q(sql, params)).rows[0];
const semua = async (sql, params) => (await q(sql, params)).rows;
const sebagai = (uid) => q(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
const galat = async (fn) => {
  try {
    await fn();
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
  create table assets (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid not null references business_units(id) on delete cascade,
    outlet_id uuid not null references outlets(id) on delete cascade,
    name text not null, category text, qty numeric not null default 1,
    size text, photo_path text, condition text not null default 'normal',
    condition_note text, notes text,
    created_by uuid references user_profiles(id) on delete set null,
    updated_by uuid references user_profiles(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now());

  create or replace function is_bu_admin(p_uid uuid, p_bu uuid) returns boolean
    language sql security definer stable as $$
      select exists (select 1 from membership_scopes ms where ms.user_id = p_uid
        and (ms.role = 'super_admin' or (ms.business_unit_id = p_bu and ms.role = 'bu_admin'))) $$;
  create or replace function has_bu_scope(p_uid uuid, p_bu uuid) returns boolean
    language sql security definer stable as $$
      select exists (select 1 from membership_scopes ms where ms.user_id = p_uid
        and (ms.role = 'super_admin' or ms.business_unit_id = p_bu)) $$;
  create or replace function has_outlet_scope(p_uid uuid, p_outlet uuid) returns boolean
    language sql security definer stable as $$
      select exists (
        select 1 from membership_scopes ms join outlets o on o.id = p_outlet
         where ms.user_id = p_uid
           and (ms.role = 'super_admin'
                or (ms.business_unit_id = o.business_unit_id and ms.role = 'bu_admin')
                or ms.outlet_id = p_outlet)) $$;
  create or replace function is_admin_of_outlet(p_uid uuid, p_outlet uuid) returns boolean
    language sql security definer stable as $$
      select exists (
        select 1 from membership_scopes ms join outlets o on o.id = p_outlet
         where ms.user_id = p_uid
           and (ms.role = 'super_admin'
                or (ms.business_unit_id = o.business_unit_id and ms.role = 'bu_admin')
                or (ms.outlet_id = p_outlet and ms.role = 'outlet_admin'))) $$;
`);

const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const A = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Outlet A') returning id`, [BU])).id;
const B = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Outlet B') returning id`, [BU])).id;

const ADMIN = '11111111-1111-1111-1111-111111111111';
const STAFF = '22222222-2222-2222-2222-222222222222';
const STAFF_B = '33333333-3333-3333-3333-333333333333';
const KELUAR = '44444444-4444-4444-4444-444444444444'; // staff yang nanti dihapus
await q(`insert into user_profiles (id, full_name) values ($1,'Pak Admin'),($2,'Budi'),($3,'Siti'),($4,'Rina')`, [
  ADMIN, STAFF, STAFF_B, KELUAR
]);
await q(
  `insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values
     ($1,$5,null,'bu_admin'), ($2,$5,$6,'staff'), ($3,$5,$7,'staff'), ($4,$5,$6,'staff')`,
  [ADMIN, STAFF, STAFF_B, KELUAR, BU, A, B]
);

await q(`insert into assets (business_unit_id, outlet_id, name, category, qty, created_by) values ($1,$2,'Piring Ayam','Kitchen',12,$3)`, [BU, A, STAFF]);
await q(`insert into assets (business_unit_id, outlet_id, name, category, qty, created_by) values ($1,$2,'Piring Ayam','Kitchen',5,$3)`, [BU, B, STAFF_B]);

for (const f of [
  '0168_aset_master_bu_dan_kode.sql',
  '0169_aset_pindah_dan_izin_hapus.sql',
  '0170_kerusakan_aset_dan_riwayat.sql'
]) {
  await db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', f), 'utf8').replace(/notify pgrst[^;]*;/g, ''));
}
console.log('  0168 + 0169 + 0170 terpasang.');

const PIRING = (await satu(`select id from asset_items where name = 'Piring Ayam'`)).id;
const qtyDi = async (outlet) =>
  Number((await satu(`select qty from asset_stock where asset_item_id=$1 and outlet_id=$2`, [PIRING, outlet])).qty);

const rusak = (opsi = {}) =>
  satu(
    `select catat_kerusakan_aset($1,$2,$3,$4,$5,$6,$7) as h`,
    [
      opsi.item ?? PIRING,
      opsi.outlet ?? A,
      opsi.qty ?? 2,
      opsi.jenis ?? 'pecah',
      opsi.foto === undefined ? `${A}/kerusakan/abc.jpg` : opsi.foto,
      opsi.sebab ?? 'jatuh saat cuci',
      opsi.tanggal ?? null
    ]
  );

// ===============================================================
console.log('\n§1 Kerusakan mengurangi jumlahnya');
// ===============================================================
await sebagai(STAFF);
cek('§1 jumlah awal', await qtyDi(A), 12);
const h1 = (await rusak({ qty: 2 })).h;
cek('§1 jumlah berkurang', await qtyDi(A), 10);
cek('§1 sisa yang dilaporkan RPC cocok', Number(h1.sisa), 10);

const kej = await satu(`select * from asset_damage where id = $1`, [h1.id]);
cek('§1 kejadiannya tersimpan', Number(kej.qty), 2);
cek('§1 jenisnya', kej.jenis, 'pecah');
cek('§1 sebabnya', kej.sebab, 'jatuh saat cuci');
cek('§1 pelapornya', kej.dilapor_by, STAFF);

// ============ NAMA PELAPOR DISIMPAN, BUKAN CUMA ID-NYA ============
//
// Rina keluar dari perusahaan; barisnya di user_profiles dihapus. `on delete
// set null` menghapus satu-satunya penunjuk "siapa", dan riwayat yang
// pelakunya hilang tidak lebih berguna daripada tidak ada riwayat.
cek('§1 nama pelapor ikut disimpan', kej.dilapor_by_nama, 'Budi');

// Outlet B TIDAK ikut berkurang — barang yang sama, outlet berbeda.
cek('§1 outlet lain tidak tersentuh', await qtyDi(B), 5);

// ===============================================================
console.log('§2 Yang ditolak');
// ===============================================================
const eLebih = await galat(() => rusak({ qty: 99 }));
// Menolak, BUKAN memotong jadi nol. Melaporkan 99 pecah dari 10 yang tercatat
// berarti salah satu angkanya salah; memotongnya diam-diam menyembunyikan
// selisih itu, dan selisih yang disembunyikan tidak pernah diperiksa.
benar('§2 lebih banyak daripada yang tercatat ditolak', /Tercatat cuma/.test(eLebih ?? ''), eLebih ?? 'malah jalan');
benar('§2 pesannya menyebut sisa yang ada', /10/.test(eLebih ?? ''), eLebih ?? '');
cek('§2 dan jumlahnya tidak berubah', await qtyDi(A), 10);

const eNol = await galat(() => rusak({ qty: 0 }));
benar('§2 nol ditolak', /lebih dari nol/.test(eNol ?? ''), eNol ?? 'malah jalan');
const eMinus = await galat(() => rusak({ qty: -3 }));
benar('§2 negatif ditolak', /lebih dari nol/.test(eMinus ?? ''), eMinus ?? 'malah jalan');

const eJenis = await galat(() => rusak({ jenis: 'penyok' }));
benar('§2 jenis tak dikenal ditolak', /tidak dikenal/.test(eJenis ?? ''), eJenis ?? 'malah jalan');

// Barang yang BELUM DIDATA di outlet itu tidak punya jumlah untuk dikurangi.
const LAIN = (await satu(
  `insert into asset_items (business_unit_id, kode, name) values ($1,'Z001','Barang Belum Didata') returning id`,
  [BU]
)).id;
const eBelum = await galat(() => rusak({ item: LAIN }));
benar('§2 barang yang belum didata ditolak dengan jelas', /belum didata/.test(eBelum ?? ''), eBelum ?? 'malah jalan');

// ===============================================================
console.log('§3 Foto WAJIB — dijaga database, bukan cuma layar');
// ===============================================================
const eFoto = await galat(() => rusak({ foto: '' }));
benar('§3 foto kosong ditolak RPC', /Foto bukti wajib/.test(eFoto ?? ''), eFoto ?? 'malah jalan');
const eFotoSpasi = await galat(() => rusak({ foto: '   ' }));
benar('§3 foto berisi spasi juga ditolak', /Foto bukti wajib/.test(eFotoSpasi ?? ''), eFotoSpasi ?? 'malah jalan');

// Dan kolomnya sendiri menolak — kalau "wajib" cuma dijaga RPC, jalur lain
// yang ditulis nanti akan melewatinya tanpa ada yang menyadarinya.
const eKolom = await galat(() =>
  q(`insert into asset_damage (asset_item_id, outlet_id, qty, photo_path) values ($1,$2,1,null)`, [PIRING, A])
);
benar('§3 kolomnya NOT NULL', /null/i.test(eKolom ?? ''), eKolom ?? 'malah masuk');
const eKolomKosong = await galat(() =>
  q(`insert into asset_damage (asset_item_id, outlet_id, qty, photo_path) values ($1,$2,1,'  ')`, [PIRING, A])
);
benar('§3 dan menolak teks kosong', /check|violat/i.test(eKolomKosong ?? ''), eKolomKosong ?? 'malah masuk');

// ===============================================================
console.log('§4 Tanggal kejadian, bukan tanggal pengetikan');
// ===============================================================

// Barang pecah Sabtu dan baru dicatat Senin adalah keadaan NORMAL. Memakai
// tanggal pengetikan membuat rekap bulanan meleset di tiap pergantian bulan.
const h4 = (await rusak({ qty: 1, tanggal: '2026-10-01' })).h;
cek(
  '§4 tanggal mundur diterima apa adanya',
  (await satu(`select tanggal from asset_damage where id=$1`, [h4.id])).tanggal.toISOString().slice(0, 10),
  '2026-10-01'
);

const besok = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
const eMaju = await galat(() => rusak({ qty: 1, tanggal: besok }));
benar('§4 tanggal masa depan ditolak', /masa depan/.test(eMaju ?? ''), eMaju ?? 'malah jalan');

// ===============================================================
console.log('§5 Riwayat diisi TRIGGER, lewat jalur mana pun');
// ===============================================================
const sebelumLog = Number((await satu(`select count(*)::int c from asset_log`)).c);

// ============ INI YANG MEMBEDAKAN TRIGGER DARI PENCATATAN DI LAYAR ============
//
// `update` biasa — bukan lewat RPC mana pun, persis seperti perbaikan manual
// atau layar yang ditulis nanti. Riwayat yang ditulis layar akan melewatkan
// perubahan ini tanpa galat, dan yang bolong justru perubahan yang paling
// perlu ditelusuri.
await q(`update asset_stock set qty = 7 where asset_item_id=$1 and outlet_id=$2`, [PIRING, A]);
const logQty = await satu(
  `select * from asset_log where kolom='qty' and asset_item_id=$1 order by at desc limit 1`,
  [PIRING]
);
cek('§5 update langsung tetap tercatat', [logQty.sebelum, logQty.sesudah], ['9', '7']);
cek('§5 dan siapa pelakunya', logQty.oleh, STAFF);
cek('§5 beserta namanya', logQty.oleh_nama, 'Budi');
benar('§5 jumlah baris log bertambah', Number((await satu(`select count(*)::int c from asset_log`)).c) > sebelumLog);

// Satu baris per KOLOM yang berubah, bukan satu salinan utuh.
await q(`update asset_stock set condition = 'rusak', notes = 'gompal' where asset_item_id=$1 and outlet_id=$2`, [PIRING, A]);
const kolomBerubah = (await semua(
  `select kolom from asset_log where asset_item_id=$1 and at >= now() - interval '1 minute' order by at desc limit 2`,
  [PIRING]
)).map((r) => r.kolom).sort();
cek('§5 kondisi & catatan tercatat terpisah', kolomBerubah, ['catatan', 'kondisi']);

// Nama item berlaku se-BU, jadi dicatat TANPA outlet.
await sebagai(ADMIN);
await q(`update asset_items set name = 'Piring Ayam Besar' where id = $1`, [PIRING]);
const logNama = await satu(`select * from asset_log where kolom='nama' and asset_item_id=$1`, [PIRING]);
cek('§5 ganti nama tercatat', [logNama.sebelum, logNama.sesudah], ['Piring Ayam', 'Piring Ayam Besar']);
cek('§5 tanpa outlet, karena berlaku di semua outlet', logNama.outlet_id, null);
cek('§5 oleh admin', logNama.oleh_nama, 'Pak Admin');

// Kerusakan menuliskan SEBABNYA, bukan cuma angkanya.
const logRusak = await satu(`select * from asset_log where aksi='rusak' and asset_item_id=$1 order by at limit 1`, [PIRING]);
cek('§5 kejadian rusak punya barisnya sendiri', logRusak.kolom, 'pecah');
cek('§5 berisi sebabnya', logRusak.catatan, 'jatuh saat cuci');

// ============ RIWAYAT TETAP BISA DIBACA SESUDAH ORANGNYA KELUAR ============
await sebagai(KELUAR);
await q(`update asset_stock set qty = 6 where asset_item_id=$1 and outlet_id=$2`, [PIRING, A]);
await q(`delete from user_profiles where id = $1`, [KELUAR]);
const logRina = await satu(`select * from asset_log where oleh_nama = 'Rina' limit 1`);
benar('§5 baris lognya tidak ikut hilang', !!logRina);
cek('§5 penunjuk id memang hilang (on delete set null)', logRina?.oleh, null);
cek('§5 TAPI namanya masih terbaca', logRina?.oleh_nama, 'Rina');

// ===============================================================
console.log('§6 Membatalkan kerusakan mengembalikan jumlahnya');
// ===============================================================
await sebagai(STAFF);
const sebelumBatal = await qtyDi(A);
const h6 = (await rusak({ qty: 3 })).h;
cek('§6 berkurang dulu', await qtyDi(A), sebelumBatal - 3);

const eStaffBatal = await galat(() => q(`select batalkan_kerusakan_aset($1,'salah ketik')`, [h6.id]));
benar('§6 staff tidak boleh membatalkan', /admin outlet/.test(eStaffBatal ?? ''), eStaffBatal ?? 'malah jalan');

await sebagai(ADMIN);
const eTanpaAlasan = await galat(() => q(`select batalkan_kerusakan_aset($1,'  ')`, [h6.id]));
benar('§6 alasan wajib diisi', /Alasan pembatalan wajib/.test(eTanpaAlasan ?? ''), eTanpaAlasan ?? 'malah jalan');

const h6b = (await satu(`select batalkan_kerusakan_aset($1,'salah ketik, harusnya 1') as h`, [h6.id])).h;
cek('§6 jumlah yang dikembalikan', Number(h6b.dikembalikan), 3);
cek('§6 jumlahnya kembali', await qtyDi(A), sebelumBatal);

const batal = await satu(`select * from asset_damage where id=$1`, [h6.id]);
// Barisnya TETAP ADA, bukan dihapus: yang dibatalkan harus tetap terlihat
// beserta alasannya, kalau tidak ia cuma jadi jumlah yang berubah tanpa sebab.
benar('§6 catatannya tidak dihapus, cuma ditandai batal', !!batal.dibatalkan_at);
cek('§6 alasannya tersimpan', batal.alasan_batal, 'salah ketik, harusnya 1');
cek('§6 siapa yang membatalkan', batal.dibatalkan_by_nama, 'Pak Admin');

const eDuaKali = await galat(() => q(`select batalkan_kerusakan_aset($1,'lagi')`, [h6.id]));
benar('§6 tidak bisa dibatalkan dua kali', /sudah dibatalkan/.test(eDuaKali ?? ''), eDuaKali ?? 'malah jalan');

// ===============================================================
console.log('§7 Wewenang');
// ===============================================================
await sebagai(STAFF_B);
const eOutletLain = await galat(() => rusak({ outlet: A, qty: 1 }));
benar('§7 staff outlet lain ditolak', /di luar outlet/.test(eOutletLain ?? ''), eOutletLain ?? 'malah jalan');

await sebagai('00000000-0000-0000-0000-000000000000');
await q(`select set_config('request.jwt.claim.sub', '', false)`);
const eAnon = await galat(() => rusak({ qty: 1 }));
benar('§7 belum login ditolak', /Harus login/.test(eAnon ?? ''), eAnon ?? 'malah jalan');

// Baris kerusakan tidak boleh dibuat langsung tanpa lewat RPC — kalau bisa,
// catatan dan jumlahnya jadi berbeda tanpa ada yang memberi tahu.
await db.exec(`grant usage on schema public to authenticated; grant all on all tables in schema public to authenticated;`);
await db.exec(`set role authenticated`);
await sebagai(STAFF);
const eLangsung = await galat(() =>
  q(`insert into asset_damage (asset_item_id, outlet_id, qty, photo_path) values ($1,$2,1,'x.jpg')`, [PIRING, A])
);
await db.exec(`reset role`);
benar('§7 insert langsung ditolak RLS', /policy|row-level/i.test(eLangsung ?? ''), eLangsung ?? 'malah masuk');

// ---------------------------------------------------------------
console.log(`\n${gagal === 0 ? '✅' : '❌'} test-migrasi-0170: ${n - gagal}/${n} lulus`);
process.exit(gagal === 0 ? 0 : 1);
