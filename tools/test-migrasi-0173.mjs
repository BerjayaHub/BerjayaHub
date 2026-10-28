/**
 * 0173 — TRANSFER ASET (PGlite — Postgres sungguhan).
 *
 *   §1 Transfer antar outlet dalam satu BU.
 *   §2 Transfer LINTAS BU — itemnya dibuatkan di BU tujuan.
 *   §3 Tujuan "lain-lain" — keluar dari sistem.
 *   §4 Yang ditolak.
 *   §5 Pembatalan mengembalikan kedua sisi.
 *   §6 Riwayat & surat jalan tetap terbaca.
 *   §7 Wewenang & RLS.
 *
 * ============ YANG SEBENARNYA DIUJI DI SINI ============
 *
 * Transfer ini TIDAK punya langkah terima. Pengiriman bahan punya penerima
 * yang menghitung ulang di tempat, jadi selisihnya ketahuan hari itu juga; di
 * sini tidak ada siapa pun yang akan menolak.
 *
 * Artinya setiap kesalahan aritmetika duduk diam di DUA outlet sekaligus
 * sampai opname berikutnya. Jadi yang diuji bukan "apakah angkanya berpindah"
 * — melainkan apakah jumlah TOTAL tetap utuh di setiap jalur: lintas BU, ke
 * luar sistem, dan saat dibatalkan.
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
const q = (sql, p) => db.query(sql, p);
const satu = async (sql, p) => (await q(sql, p)).rows[0];
const semua = async (sql, p) => (await q(sql, p)).rows;
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
  create or replace function auth.uid() returns uuid language sql stable as $x$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $x$;

  create table business_units (id uuid primary key default gen_random_uuid(), name text);
  create table outlets (id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text);
  create table user_profiles (id uuid primary key, full_name text);
  create table membership_scopes (
    id uuid primary key default gen_random_uuid(),
    user_id uuid, business_unit_id uuid, outlet_id uuid, role text);
  create table assets (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid references business_units(id) on delete cascade,
    outlet_id uuid references outlets(id) on delete cascade,
    name text, category text, qty numeric default 1, size text, photo_path text,
    condition text default 'normal', condition_note text, notes text,
    created_by uuid references user_profiles(id) on delete set null,
    updated_by uuid references user_profiles(id) on delete set null,
    created_at timestamptz default now(), updated_at timestamptz default now());

  create or replace function is_bu_admin(p_uid uuid, p_bu uuid) returns boolean
    language sql security definer stable as $x$
      select exists (select 1 from membership_scopes ms where ms.user_id = p_uid
        and (ms.role = 'super_admin' or (ms.business_unit_id = p_bu and ms.role = 'bu_admin'))) $x$;
  create or replace function has_bu_scope(p_uid uuid, p_bu uuid) returns boolean
    language sql security definer stable as $x$
      select exists (select 1 from membership_scopes ms where ms.user_id = p_uid
        and (ms.role = 'super_admin' or ms.business_unit_id = p_bu)) $x$;
  create or replace function has_outlet_scope(p_uid uuid, p_outlet uuid) returns boolean
    language sql security definer stable as $x$
      select exists (
        select 1 from membership_scopes ms join outlets o on o.id = p_outlet
         where ms.user_id = p_uid
           and (ms.role = 'super_admin'
                or (ms.business_unit_id = o.business_unit_id and ms.role = 'bu_admin')
                or ms.outlet_id = p_outlet)) $x$;
  create or replace function is_admin_of_outlet(p_uid uuid, p_outlet uuid) returns boolean
    language sql security definer stable as $x$
      select exists (
        select 1 from membership_scopes ms join outlets o on o.id = p_outlet
         where ms.user_id = p_uid
           and (ms.role = 'super_admin'
                or (ms.business_unit_id = o.business_unit_id and ms.role = 'bu_admin'))) $x$;
`);

const CAFE = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const BENGKEL = (await satu(`insert into business_units (name) values ('Bengkel') returning id`)).id;
const A = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Serpong') returning id`, [CAFE])).id;
const B = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Sentul') returning id`, [CAFE])).id;
const C = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Otonix Depok') returning id`, [BENGKEL])).id;

const ADMIN = '11111111-1111-1111-1111-111111111111';
const STAFF = '22222222-2222-2222-2222-222222222222';
const STAFF_LAIN = '33333333-3333-3333-3333-333333333333';
await q(`insert into user_profiles (id, full_name) values ($1,'Pak Admin'),($2,'Budi'),($3,'Siti')`, [ADMIN, STAFF, STAFF_LAIN]);
await q(
  `insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values
     ($1,$4,null,'bu_admin'), ($2,$4,$5,'staff'), ($3,$6,$7,'staff')`,
  [ADMIN, STAFF, STAFF_LAIN, CAFE, A, BENGKEL, C]
);

await q(
  `insert into assets (business_unit_id, outlet_id, name, category, qty) values
     ($1,$2,'Kursi Bar','Bar',20), ($1,$2,'Meja Lipat','Bar',6), ($1,$3,'Kursi Bar','Bar',4)`,
  [CAFE, A, B]
);

for (const f of [
  '0168_aset_master_bu_dan_kode.sql',
  '0169_aset_pindah_dan_izin_hapus.sql',
  '0170_kerusakan_aset_dan_riwayat.sql',
  '0171_foto_acuan_item_aset.sql',
  '0172_kategori_wajib_dan_hapus_item_aset.sql',
  '0173_transfer_aset.sql'
]) {
  await db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', f), 'utf8').replace(/notify pgrst[^;]*;/g, ''));
}
console.log('  0168 … 0173 terpasang.');

const KURSI = (await satu(`select id from asset_items where name='Kursi Bar' and business_unit_id=$1`, [CAFE])).id;
const MEJA = (await satu(`select id from asset_items where name='Meja Lipat' and business_unit_id=$1`, [CAFE])).id;
const qtyDi = async (item, outlet) => {
  const r = await satu(`select qty from asset_stock where asset_item_id=$1 and outlet_id=$2`, [item, outlet]);
  return r ? Number(r.qty) : null;
};
const totalSemua = async () => Number((await satu(`select coalesce(sum(qty),0) s from asset_stock`)).s);

const kirim = (o = {}) =>
  satu(`select kirim_transfer_aset($1,$2,$3,$4,$5::jsonb,$6,$7) as h`, [
    o.dari ?? A,
    o.ke === undefined ? B : o.ke,
    o.lain ?? null,
    o.pembawa ?? 'Pak Joko',
    JSON.stringify(o.items ?? [{ item_id: KURSI, qty: 5 }]),
    o.catatan ?? null,
    o.foto ?? null
  ]);

// ===============================================================
console.log('\n§1 Transfer antar outlet dalam satu BU');
// ===============================================================
await sebagai(STAFF);
const T0 = await totalSemua();
const h1 = (await kirim({ items: [{ item_id: KURSI, qty: 5 }, { item_id: MEJA, qty: 2 }] })).h;

cek('§1 dua barang terkirim dalam satu surat jalan', Number(h1.jumlah_barang), 2);
benar('§1 nomor SJ berbentuk TA-YYMMDD-XXXX', /^TA-\d{6}-[0-9A-F]{4}$/.test(h1.kode), h1.kode);

cek('§1 kursi berkurang di asal', await qtyDi(KURSI, A), 15);
cek('§1 kursi bertambah di tujuan', await qtyDi(KURSI, B), 9);
cek('§1 meja berkurang di asal', await qtyDi(MEJA, A), 4);

// ============ MEJA BELUM PERNAH ADA DI SENTUL ============
//
// Barisnya dibuat, bukan gagal. Kalau menuntut outlet tujuan sudah mendata
// barangnya dulu, transfer barang baru jadi mustahil — dan orang akan
// menambahkannya manual lalu lupa mengurangi yang di asal.
cek('§1 barang yang belum pernah ada di tujuan: barisnya dibuat', await qtyDi(MEJA, B), 2);

// ============ PEMERIKSAAN PALING PENTING ============
//
// Tidak ada penerima yang akan menghitung ulang. Jumlah TOTAL se-BU harus
// tetap sama persis — kalau bocor, tidak ada satu pun orang yang akan
// menyadarinya sampai opname berikutnya.
cek('§1 total unit se-sistem TIDAK berubah', await totalSemua(), T0);

// ===============================================================
console.log('§2 Transfer LINTAS BU');
// ===============================================================

// Bengkel SUDAH punya satu barang berkategori Bar. Tanpa ini, barang yang
// masuk kebetulan dapat nomor 001 — sama dengan kode asalnya — dan tesnya
// hijau tanpa pernah membuktikan nomornya datang dari BU tujuan.
await sebagai(STAFF_LAIN);
await satu(`select tambah_item_aset($1,'Kursi Tunggu','Bar',null) as h`, [BENGKEL]);
await sebagai(STAFF);

const T1 = await totalSemua();
const h2 = (await kirim({ ke: C, items: [{ item_id: KURSI, qty: 3 }] })).h;
cek('§2 total tetap utuh lintas BU', await totalSemua(), T1);
cek('§2 berkurang di Cafe', await qtyDi(KURSI, A), 12);

// Kode milik BU, jadi TIDAK ikut berpindah: item padanannya dibuatkan di BU
// tujuan beserta kodenya sendiri.
const kursiBengkel = await satu(
  `select id, kode, name from asset_items where business_unit_id=$1 and name='Kursi Bar'`, [BENGKEL]
);
benar('§2 item dibuatkan di BU tujuan', !!kursiBengkel);
cek('§2 jumlahnya masuk di outlet tujuan', await qtyDi(kursiBengkel.id, C), 3);
// ============ KODENYA DINOMORI OLEH BU TUJUAN ============
//
// Kode unik PER BU, jadi dua BU boleh sama-sama punya B001 — itu bukan
// kesalahan. Yang harus benar: nomornya diambil dari urutan BU TUJUAN, bukan
// disalin dari asal. Bengkel sudah punya satu barang berkategori Bar sebelum
// transfer ini, jadi yang masuk harus jadi nomor berikutnya di sana.
benar('§2 kodenya dinomori BU tujuan, bukan disalin dari asal', kursiBengkel.kode === 'B002', kursiBengkel.kode);

// Kirim lagi: item yang SAMA dipakai, bukan dibuat kedua kalinya.
await kirim({ ke: C, items: [{ item_id: KURSI, qty: 2 }] });
cek(
  '§2 kiriman kedua memakai item yang sama, bukan membuat kembar',
  Number((await satu(`select count(*)::int c from asset_items where business_unit_id=$1 and name='Kursi Bar'`, [BENGKEL])).c),
  1
);
cek('§2 jumlahnya ditambahkan', await qtyDi(kursiBengkel.id, C), 5);

// ===============================================================
console.log('§3 Tujuan "lain-lain"');
// ===============================================================
const T2 = await totalSemua();
const h3 = (await kirim({ ke: null, lain: 'Dipinjam untuk acara CSR', items: [{ item_id: KURSI, qty: 4 }] })).h;
cek('§3 berkurang di asal', await qtyDi(KURSI, A), 6);

// Tujuannya di LUAR sistem, jadi tidak ada stok yang bertambah. Totalnya
// memang turun — itu benar, dan itu sebabnya `tujuan_lain` wajib: barang yang
// keluar tanpa keterangan ke mana adalah barang yang hilang dengan surat jalan.
cek('§3 total memang berkurang 4 (keluar dari sistem)', await totalSemua(), T2 - 4);
const sj3 = await satu(`select * from asset_transfer where kode=$1`, [h3.kode]);
cek('§3 tujuannya tercatat apa adanya', sj3.tujuan_lain, 'Dipinjam untuk acara CSR');
cek('§3 tanpa outlet tujuan', sj3.to_outlet_id, null);

// ===============================================================
console.log('§4 Yang ditolak');
// ===============================================================
const eTanpaPembawa = await galat(() => kirim({ pembawa: '   ' }));
// Tanpa penerima, pembawa adalah SATU-SATUNYA orang yang bisa ditanya
// "barangnya ke mana".
benar('§4 pembawa kosong ditolak', /pembawa barang wajib/i.test(eTanpaPembawa ?? ''), eTanpaPembawa ?? 'malah jalan');

const eTanpaTujuan = await galat(() => kirim({ ke: null, lain: null }));
benar('§4 tanpa tujuan sama sekali ditolak', /Tujuan wajib/i.test(eTanpaTujuan ?? ''), eTanpaTujuan ?? 'malah jalan');

const eDuaTujuan = await galat(() => kirim({ ke: B, lain: 'Gudang pusat' }));
benar('§4 outlet DAN lain-lain sekaligus ditolak', /salah satu/i.test(eDuaTujuan ?? ''), eDuaTujuan ?? 'malah jalan');

const eSama = await galat(() => kirim({ ke: A }));
benar('§4 asal = tujuan ditolak', /tidak boleh sama/i.test(eSama ?? ''), eSama ?? 'malah jalan');

const sisaKursi = await qtyDi(KURSI, A);
const eKebanyakan = await galat(() => kirim({ items: [{ item_id: KURSI, qty: sisaKursi + 10 }] }));
benar('§4 mengirim lebih banyak daripada yang ada ditolak', /Tercatat cuma/i.test(eKebanyakan ?? ''), eKebanyakan ?? 'malah jalan');
cek('§4 dan jumlahnya tidak tersentuh', await qtyDi(KURSI, A), sisaKursi);

const eKosong = await galat(() => kirim({ items: [] }));
benar('§4 tanpa barang ditolak', /Belum ada barang/i.test(eKosong ?? ''), eKosong ?? 'malah jalan');

// Barang yang belum didata di outlet ASAL tidak punya jumlah untuk dikirim.
const BARU = (await satu(`select tambah_item_aset($1,'Rak Baru','Gudang',null) as h`, [CAFE])).h;
const eBelum = await galat(() => kirim({ items: [{ item_id: BARU.id, qty: 1 }] }));
benar('§4 barang yang belum didata di asal ditolak', /belum didata/i.test(eBelum ?? ''), eBelum ?? 'malah jalan');

// ============ GAGAL DI TENGAH TIDAK BOLEH MENYISAKAN SEPARUH ============
//
// Barang pertama sah, yang kedua kebanyakan. Seluruh transaksinya harus
// batal — kalau tidak, surat jalannya ada tapi isinya cuma separuh, dan
// jumlah di asal sudah terlanjur berkurang untuk barang yang tidak tercantum.
const sebelumGagal = await totalSemua();
const eSebagian = await galat(() =>
  kirim({ items: [{ item_id: KURSI, qty: 1 }, { item_id: MEJA, qty: 9999 }] })
);
benar('§4 kiriman yang salah sebagian ditolak', !!eSebagian, 'malah jalan');
cek('§4 dan TIDAK menyisakan perubahan apa pun', await totalSemua(), sebelumGagal);

// ===============================================================
console.log('§5 Pembatalan mengembalikan KEDUA sisi');
// ===============================================================
const T3 = await totalSemua();
const asalSebelum = await qtyDi(KURSI, A);
const tujuanSebelum = await qtyDi(KURSI, B);
const h5 = (await kirim({ items: [{ item_id: KURSI, qty: 2 }] })).h;

await sebagai(STAFF);
const id5 = (await satu(`select id from asset_transfer where kode=$1`, [h5.kode])).id;
const eStaffBatal = await galat(() => q(`select batalkan_transfer_aset($1,'salah')`, [id5]));
benar('§5 staff tidak boleh membatalkan', /Admin BU/i.test(eStaffBatal ?? ''), eStaffBatal ?? 'malah jalan');

await sebagai(ADMIN);
const eAlasan = await galat(() => q(`select batalkan_transfer_aset($1,'  ')`, [id5]));
benar('§5 alasan wajib', /Alasan pembatalan wajib/i.test(eAlasan ?? ''), eAlasan ?? 'malah jalan');

await q(`select batalkan_transfer_aset($1,'salah outlet')`, [id5]);
cek('§5 jumlah asal kembali', await qtyDi(KURSI, A), asalSebelum);
cek('§5 jumlah tujuan ditarik', await qtyDi(KURSI, B), tujuanSebelum);
cek('§5 total tetap', await totalSemua(), T3);

const sj5 = await satu(`select * from asset_transfer where id=$1`, [id5]);
// Barisnya TIDAK dihapus: surat jalan yang dibatalkan harus tetap terlihat.
benar('§5 SJ-nya ditandai batal, bukan dihapus', !!sj5.dibatalkan_at);
cek('§5 alasannya tersimpan', sj5.alasan_batal, 'salah outlet');
cek('§5 siapa yang membatalkan', sj5.dibatalkan_by_nama, 'Pak Admin');

const eDuaKali = await galat(() => q(`select batalkan_transfer_aset($1,'lagi')`, [id5]));
benar('§5 tidak bisa dibatalkan dua kali', /sudah dibatalkan/i.test(eDuaKali ?? ''), eDuaKali ?? 'malah jalan');

// ============ BARANGNYA SUDAH TERPAKAI DI TUJUAN ============
//
// Menarik kembali 3 dari outlet yang sekarang cuma punya 1 akan membuat
// jumlahnya negatif — atau, lebih buruk, dipotong diam-diam jadi nol. Yang
// benar: menolak, dan mengatakan angkanya.
await sebagai(STAFF);
const h5b = (await kirim({ items: [{ item_id: KURSI, qty: 3 }] })).h;
const id5b = (await satu(`select id from asset_transfer where kode=$1`, [h5b.kode])).id;
await q(`update asset_stock set qty = 1 where asset_item_id=$1 and outlet_id=$2`, [KURSI, B]);
await sebagai(ADMIN);
const eTerpakai = await galat(() => q(`select batalkan_transfer_aset($1,'mau ditarik')`, [id5b]));
benar('§5 pembatalan ditolak kalau barangnya sudah terpakai di tujuan', /tinggal/i.test(eTerpakai ?? ''), eTerpakai ?? 'malah jalan');
cek('§5 dan tidak ada yang berubah', await qtyDi(KURSI, B), 1);

// ===============================================================
console.log('§6 Surat jalan & riwayat tetap terbaca');
// ===============================================================
const baris = await semua(
  `select i.item_kode, i.item_nama, i.qty from asset_transfer_item i
    join asset_transfer t on t.id = i.transfer_id where t.kode = $1 order by i.item_nama`,
  [h1.kode]
);
cek('§6 isi SJ lengkap', baris.map((b) => [b.item_nama, Number(b.qty)]), [['Kursi Bar', 5], ['Meja Lipat', 2]]);

// ============ KODE & NAMA DISIMPAN SEBAGAI TEKS ============
//
// Surat jalan adalah dokumen: ia harus tetap terbaca persis seperti saat
// dicetak, walaupun itemnya belakangan diganti nama atau dihapus.
await sebagai(ADMIN);
await q(`update asset_items set name = 'Kursi Bar Kayu' where id = $1`, [KURSI]);
const sesudahGanti = await satu(
  `select i.item_nama from asset_transfer_item i join asset_transfer t on t.id=i.transfer_id
    where t.kode=$1 and i.item_kode is not null order by i.item_nama limit 1`, [h1.kode]
);
cek('§6 nama di SJ tidak ikut berubah', sesudahGanti.item_nama, 'Kursi Bar');

const logKeluar = await satu(`select * from asset_log where aksi='transfer-keluar' and kolom=$1 limit 1`, [h1.kode]);
benar('§6 riwayat menyebut nomor SJ-nya', !!logKeluar);
benar('§6 dan ke mana perginya', /Sentul/.test(logKeluar?.catatan ?? ''), logKeluar?.catatan);

// ===============================================================
console.log('§7 Wewenang & RLS');
// ===============================================================
await sebagai(STAFF_LAIN);
const eOutletLain = await galat(() => kirim({ dari: A, ke: C, items: [{ item_id: KURSI, qty: 1 }] }));
benar('§7 staff BU lain tidak bisa mengirim dari outlet Cafe', /akses ke outlet asal/i.test(eOutletLain ?? ''), eOutletLain ?? 'malah jalan');

await db.exec(`grant usage on schema public to authenticated; grant all on all tables in schema public to authenticated;`);
const bacaSbg = async (uid, sql, p) => {
  await db.exec(`set role authenticated`);
  await sebagai(uid);
  try {
    return (await q(sql, p)).rows[0];
  } finally {
    await db.exec(`reset role`);
  }
};

// BU TUJUAN ikut melihat surat jalannya. Kalau tidak, outlet tujuan menerima
// barang yang tiba-tiba bertambah tanpa bisa melihat surat jalannya — dan yang
// pertama ia lakukan adalah menelepon untuk bertanya.
const lihatTujuan = await bacaSbg(STAFF_LAIN, `select count(*)::int c from asset_transfer where to_outlet_id=$1`, [C]);
benar('§7 BU tujuan bisa melihat SJ yang masuk', Number(lihatTujuan?.c) > 0, JSON.stringify(lihatTujuan));

const lihatAsing = await bacaSbg(STAFF_LAIN, `select count(*)::int c from asset_transfer where to_outlet_id=$1`, [B]);
cek('§7 tapi tidak melihat SJ antar outlet BU lain', Number(lihatAsing?.c), 0);

const eTulisLangsung = await (async () => {
  await db.exec(`set role authenticated`);
  await sebagai(STAFF);
  const e = await galat(() =>
    q(`insert into asset_transfer (kode, business_unit_id, from_outlet_id, to_outlet_id, pembawa) values ('X',$1,$2,$3,'Y')`, [CAFE, A, B])
  );
  await db.exec(`reset role`);
  return e;
})();
// Surat jalan yang dibuat tanpa lewat RPC tidak memindahkan stok sama sekali —
// dokumen dan angka jadi berbeda, dan tidak ada yang memberi tahu.
benar('§7 insert langsung ditolak RLS', /policy|row-level/i.test(eTulisLangsung ?? ''), eTulisLangsung ?? 'malah masuk');

// ---------------------------------------------------------------
console.log(`\n${gagal === 0 ? '✅' : '❌'} test-migrasi-0173: ${n - gagal}/${n} lulus`);
process.exit(gagal === 0 ? 0 : 1);
