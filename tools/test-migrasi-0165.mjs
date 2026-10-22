/**
 * 0165 — REVISI SJ YANG SUDAH DITERIMA (PGlite — Postgres sungguhan).
 *
 *   §1 Penjaga status & wewenang.
 *   §2 Ubah jumlah diterima: stok OUTLET bergeser, stok CK TIDAK.
 *   §3 Tambah barang: KEDUA stok bergerak.
 *   §4 Jejak revisi memuat angka semula DAN siapa editornya.
 *   §5 Tanda ekspor ESB dicabut berjejak.
 *   §6 Gerakan lama tidak ditimpa — riwayatnya utuh.
 *   §7 Dijalankan ulang.
 *
 * ============ YANG SEBENARNYA DIUJI DI SINI ============
 *
 * Bukan "apakah angkanya berubah" — itu bagian yang mudah. Yang diuji: apakah
 * SALDO STOK dua outlet masih cocok sesudah revisi. Revisi yang membetulkan
 * angka di SJ tapi melewatkan satu gerakan stok tidak memunculkan galat apa
 * pun; yang membacanya baru tahu saat opname berikutnya, berminggu-minggu
 * kemudian, dan saat itu sebabnya sudah tidak bisa ditelusuri.
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
  create table products (id uuid primary key default gen_random_uuid(), name text, base_unit text);
  create table dispatches (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, from_outlet_id uuid, to_outlet_id uuid,
    code text, status text default 'sent', notes text,
    esb_exported_at timestamptz, esb_exported_by uuid,
    esb_dibatalkan_at timestamptz, esb_dibatalkan_by uuid, esb_alasan_batal text,
    received_by uuid, received_at timestamptz,
    direvisi_at timestamptz, direvisi_by uuid references user_profiles(id) on delete set null, direvisi_by_nama text,
    created_by uuid, created_at timestamptz default now());
  create table dispatch_items (
    id uuid primary key default gen_random_uuid(),
    dispatch_id uuid references dispatches(id) on delete cascade,
    product_id uuid, sent_qty numeric not null, received_qty numeric, dicek_qty numeric,
    keterangan text, ordered_qty numeric);
  create table stock_movements (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, outlet_id uuid, product_id uuid, movement_type text,
    qty_delta numeric, ref_outlet_id uuid, dispatch_id uuid, notes text,
    created_by uuid, created_at timestamptz default now());

  create or replace function has_outlet_scope(p_uid uuid, p_outlet uuid) returns boolean
    language sql security definer stable as $$
      select exists (
        select 1 from membership_scopes ms join outlets o on o.id = p_outlet
         where ms.user_id = p_uid
           and (ms.role = 'super_admin'
                or (ms.business_unit_id = o.business_unit_id and ms.role = 'bu_admin')
                or ms.outlet_id = p_outlet)) $$;
`);

const SQL = fs.readFileSync(path.join(AKAR, 'supabase/migrations/0165_revisi_kiriman_diterima.sql'), 'utf8');
await db.exec(SQL.replace(/notify pgrst[^;]*;/g, ''));
console.log('  0165 terpasang.');

// ---------------------------------------------------------------
const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const CK = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Central Kitchen') returning id`, [BU])).id;
const SENTUL = (await satu(`insert into outlets (business_unit_id, name) values ($1,'AB Sentul') returning id`, [BU])).id;
const LAIN = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Outlet Lain') returning id`, [BU])).id;

const ADHE = '11111111-1111-1111-1111-111111111111'; // outlet tujuan
const ORANG_CK = '22222222-2222-2222-2222-222222222222'; // CK
const ASING = '33333333-3333-3333-3333-333333333333'; // outlet yang tidak terlibat
await q(`insert into user_profiles (id, full_name) values ($1,'Adhe'),($2,'Orang CK'),($3,'Orang Asing')`, [ADHE, ORANG_CK, ASING]);
await q(
  `insert into membership_scopes (user_id, business_unit_id, outlet_id, role) values
     ($1,$4,$5,'staff'), ($2,$4,$6,'staff'), ($3,$4,$7,'staff')`,
  [ADHE, ORANG_CK, ASING, BU, SENTUL, CK, LAIN]
);

const SANTAN = (await satu(`insert into products (name, base_unit) values ('Santan','ml') returning id`)).id;
const BERAS = (await satu(`insert into products (name, base_unit) values ('Beras','gr') returning id`)).id;
const GULA = (await satu(`insert into products (name, base_unit) values ('Gula','gr') returning id`)).id;

/** SJ yang SUDAH diterima, lengkap dengan gerakan stok seperti `receive_dispatch`. */
async function buatSjDiterima({ kirim, terima, esb = false }) {
  const d = (
    await satu(
      `insert into dispatches (business_unit_id, from_outlet_id, to_outlet_id, code, status, received_by, received_at, esb_exported_at)
       values ($1,$2,$3,'SJ-TES','received',$4, now(), $5) returning id`,
      [BU, CK, SENTUL, ADHE, esb ? new Date().toISOString() : null]
    )
  ).id;
  for (const [pid, s, r] of [
    [SANTAN, kirim, terima],
    [BERAS, 1000, 1000]
  ]) {
    await q(
      `insert into dispatch_items (dispatch_id, product_id, sent_qty, dicek_qty, received_qty) values ($1,$2,$3,$4,$4)`,
      [d, pid, s, r]
    );
    await q(
      `insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, ref_outlet_id, dispatch_id)
       values ($1,$2,$3,'transfer_out',$4,$5,$6)`,
      [BU, CK, pid, -s, SENTUL, d]
    );
    if (r > 0) {
      await q(
        `insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, ref_outlet_id, dispatch_id)
         values ($1,$2,$3,'transfer_in',$4,$5,$6)`,
        [BU, SENTUL, pid, r, CK, d]
      );
    }
  }
  return d;
}

// ============ DUA HELPER, DAN BEDANYA PENTING ============
//
// `saldo` menjumlah SELURUH gerakan outlet itu — berguna untuk memastikan
// revisi tidak bocor ke SJ lain. `saldoSj` menjumlah satu SJ saja.
//
// Versi pertama tes ini cuma punya yang pertama, dan asersi §6 memakainya:
// hijau selama baru ada satu SJ, lalu merah begitu SJ kedua memakai barang
// yang sama di outlet yang sama. Tesnya yang salah, bukan kodenya — tapi
// kesalahannya menunjuk hal yang benar: angka stok TIDAK pernah milik satu
// dokumen.
const saldo = async (outlet, produk) =>
  Number((await satu(`select coalesce(sum(qty_delta),0) s from stock_movements where outlet_id=$1 and product_id=$2`, [outlet, produk])).s);

const saldoSj = async (sj, outlet, produk) =>
  Number(
    (await satu(`select coalesce(sum(qty_delta),0) s from stock_movements where dispatch_id=$1 and outlet_id=$2 and product_id=$3`, [sj, outlet, produk])).s
  );

const revisi = (d, items, alasan) =>
  q(`select revisi_kiriman_diterima($1,$2::jsonb,$3) as hasil`, [d, JSON.stringify(items), alasan]);

// =====================================================================
console.log('\n§1 Penjaga status & wewenang');
// =====================================================================

await sebagai(ADHE);

const draft = (
  await satu(`insert into dispatches (business_unit_id, from_outlet_id, to_outlet_id, status) values ($1,$2,$3,'draft') returning id`, [BU, CK, SENTUL])
).id;
const gDraft = await galat(() => revisi(draft, [{ product_id: SANTAN, received_qty: 1 }], 'coba'));
benar('1. draft ditolak', !!gDraft);
benar('1. dan pesannya menunjuk tab Draft Surat Jalan', /Draft Surat Jalan/.test(gDraft ?? ''), gDraft ?? '');

const terkirim = (
  await satu(`insert into dispatches (business_unit_id, from_outlet_id, to_outlet_id, status) values ($1,$2,$3,'sent') returning id`, [BU, CK, SENTUL])
).id;
const gSent = await galat(() => revisi(terkirim, [{ product_id: SANTAN, received_qty: 1 }], 'coba'));
benar('1. yang belum diterima ditolak', !!gSent);
benar('1. dan diarahkan ke layar Terima', /layar Terima/.test(gSent ?? ''), gSent ?? '');

// ============ YANG DIBATALKAN JUGA HARUS DITOLAK ============
//
// Cabang draft & sent menangkapnya lebih dulu, jadi penjaga `status <>
// 'received'` HANYA menjaga keadaan ini. Tanpa pemeriksaan di sini, mencabut
// penjaga itu tidak membuat satu tes pun merah — dan SJ yang dibatalkan (stok
// sudah dikembalikan) bisa digerakkan lagi. Ditemukan sabotasenya.
const dibatalkan = (
  await satu(`insert into dispatches (business_unit_id, from_outlet_id, to_outlet_id, status) values ($1,$2,$3,'cancelled') returning id`, [BU, CK, SENTUL])
).id;
await q(`insert into dispatch_items (dispatch_id, product_id, sent_qty, received_qty) values ($1,$2,10,10)`, [dibatalkan, SANTAN]);
const gBatal = await galat(() => revisi(dibatalkan, [{ product_id: SANTAN, received_qty: 5 }], 'coba'));
benar('1. yang sudah dibatalkan ditolak', !!gBatal);
benar('1. dan pesannya menyebut sudah dibatalkan', /dibatalkan/.test(gBatal ?? ''), gBatal ?? '');
cek(
  '1. dan tidak satu pun gerakan stok tertulis untuknya',
  Number((await satu(`select count(*) n from stock_movements where dispatch_id=$1`, [dibatalkan])).n),
  0
);

const sj1 = await buatSjDiterima({ kirim: 500, terima: 450 });
const gAlasan = await galat(() => revisi(sj1, [{ product_id: SANTAN, received_qty: 500 }], '   '));
benar('1. alasan kosong ditolak', !!gAlasan);
benar('1. alasannya menyebut akibat ke stok', /stok dua outlet/.test(gAlasan ?? ''), gAlasan ?? '');

await sebagai(ASING);
const gAsing = await galat(() => revisi(sj1, [{ product_id: SANTAN, received_qty: 500 }], 'iseng'));
benar('1. outlet yang tidak terlibat ditolak', !!gAsing);
benar('1. pesannya menyebut bukan pengirim maupun tujuan', /pengirim maupun/.test(gAsing ?? ''), gAsing ?? '');

// CK DAN outlet tujuan, dua-duanya boleh.
await sebagai(ORANG_CK);
benar('1. CK boleh merevisi', (await satu(`select boleh_revisi_kiriman($1) b`, [sj1])).b === true);
await sebagai(ADHE);
benar('1. outlet tujuan boleh merevisi', (await satu(`select boleh_revisi_kiriman($1) b`, [sj1])).b === true);

// =====================================================================
console.log('\n§2 Ubah jumlah diterima: outlet bergeser, CK TIDAK');
// =====================================================================
//
// Inilah yang dipastikan: `transfer_out` memakai `sent_qty`, yang tidak ikut
// berubah. Kalau revisi ikut menyentuh stok CK, stok CK berkurang dua kali
// untuk satu pengiriman — tanpa galat di mana pun.

const ckSebelum = await saldo(CK, SANTAN);
const outletSebelum = await saldo(SENTUL, SANTAN);
cek('2. prasyarat: CK -500', ckSebelum, -500);
cek('2. prasyarat: outlet +450', outletSebelum, 450);

await revisi(sj1, [{ product_id: SANTAN, received_qty: 500 }], 'salah ketik saat cek');

cek('2. stok OUTLET jadi 500 — selisih 50 dikoreksi', await saldo(SENTUL, SANTAN), 500);
cek('2. stok CK TIDAK berubah', await saldo(CK, SANTAN), -500);
cek(
  '2. received_qty tersimpan',
  Number((await satu(`select received_qty r from dispatch_items where dispatch_id=$1 and product_id=$2`, [sj1, SANTAN])).r),
  500
);
cek(
  '2. dicek_qty ikut, supaya layar Terima tidak menampilkan angka lama',
  Number((await satu(`select dicek_qty d from dispatch_items where dispatch_id=$1 and product_id=$2`, [sj1, SANTAN])).d),
  500
);

// Revisi turun juga harus bisa — bukan cuma naik.
await revisi(sj1, [{ product_id: SANTAN, received_qty: 400 }], 'ternyata kurang');
cek('2. revisi turun juga dikoreksi', await saldo(SENTUL, SANTAN), 400);

// Baris yang tidak disebut TIDAK tersentuh.
cek('2. baris lain tidak ikut berubah', await saldo(SENTUL, BERAS), 1000);

const gSama = await galat(() => revisi(sj1, [{ product_id: SANTAN, received_qty: 400 }], 'sama saja'));
benar('2. angka yang sama ditolak, bukan menulis gerakan nol', !!gSama);
benar('2. dan pesannya mengatakan tidak ada yang berubah', /tidak ada angka yang berubah/i.test(gSama ?? ''), gSama ?? '');

// =====================================================================
console.log('\n§3 Tambah barang: KEDUA stok bergerak');
// =====================================================================

const sj2 = await buatSjDiterima({ kirim: 200, terima: 200 });
await sebagai(ORANG_CK);

const gTanpaKirim = await galat(() => revisi(sj2, [{ product_id: GULA, received_qty: 300 }], 'kelupaan ditulis'));
benar('3. barang baru tanpa jumlah kirim ditolak', !!gTanpaKirim);
benar('3. pesannya menyebut nama barangnya', /Gula/.test(gTanpaKirim ?? ''), gTanpaKirim ?? '');
benar('3. dan menyebut outlet mana yang terpotong', /Central Kitchen/.test(gTanpaKirim ?? ''), gTanpaKirim ?? '');

await revisi(sj2, [{ product_id: GULA, received_qty: 300, sent_qty: 320 }], 'kelupaan ditulis di SJ');

cek('3. stok CK berkurang sebesar jumlah KIRIM', await saldo(CK, GULA), -320);
cek('3. stok outlet bertambah sebesar jumlah DITERIMA', await saldo(SENTUL, GULA), 300);
cek(
  '3. barisnya masuk ke SJ',
  Number((await satu(`select sent_qty s from dispatch_items where dispatch_id=$1 and product_id=$2`, [sj2, GULA])).s),
  320
);

// Sesudah ditambahkan, ia jadi baris biasa — revisi berikutnya hanya menyentuh
// stok outlet, persis seperti baris lain.
await revisi(sj2, [{ product_id: GULA, received_qty: 310 }], 'dihitung ulang');
cek('3. revisi lanjutan tidak menyentuh CK lagi', await saldo(CK, GULA), -320);
cek('3. dan outlet ikut terkoreksi', await saldo(SENTUL, GULA), 310);

// =====================================================================
console.log('\n§4 Jejak revisi: angka semula DAN editornya');
// =====================================================================

const jejak = (await satu(`select revisi from dispatch_items where dispatch_id=$1 and product_id=$2`, [sj1, SANTAN])).revisi;
cek('4. dua revisi tercatat', jejak.length, 2);
cek('4. revisi pertama menyimpan angka semula', Number(jejak[0].qty_lama), 450);
cek('4. dan angka barunya', Number(jejak[0].qty_baru), 500);
cek('4. jenisnya dibedakan', jejak[0].jenis, 'ubah_diterima');
cek('4. editornya tercatat', jejak[0].by, ADHE);
// Nama disimpan SAAT perubahan, bukan dicari belakangan — supaya jejaknya
// tetap terbaca kalau baris `user_profiles`-nya hilang.
cek('4. nama editornya ikut disimpan', jejak[0].by_nama, 'Adhe');
benar('4. alasannya ikut', jejak[0].alasan === 'salah ketik saat cek', JSON.stringify(jejak[0]));
benar('4. waktunya ikut', !!jejak[0].at);

const jejakGula = (await satu(`select revisi from dispatch_items where dispatch_id=$1 and product_id=$2`, [sj2, GULA])).revisi;
cek('4. penambahan barang bertipe sendiri', jejakGula[0].jenis, 'tambah_barang');
cek('4. qty_lama null untuk barang baru — bukan 0', jejakGula[0].qty_lama, null);
cek('4. jumlah kirimnya ikut tercatat', Number(jejakGula[0].sent_qty), 320);
cek('4. editornya orang CK, bukan outlet', jejakGula[0].by, ORANG_CK);
cek('4. dan namanya ikut', jejakGula[0].by_nama, 'Orang CK');


const hdr = await satu(`select direvisi_at, direvisi_by, direvisi_by_nama from dispatches where id=$1`, [sj2]);
benar('4. header SJ ikut ditandai direvisi', !!hdr.direvisi_at);
cek('4. dan menyimpan editor terakhirnya', hdr.direvisi_by, ORANG_CK);
cek('4. beserta namanya, yang tidak ikut menguap', hdr.direvisi_by_nama, 'Orang CK');

// ============ JEJAKNYA SELAMAT DARI STAFF YANG KELUAR ============
//
// `direvisi_by` ber-`on delete set null`, jadi penunjuknya menguap. Itulah
// seluruh gunanya menyimpan namanya — dan tes ini yang menemukannya.
await q(`delete from user_profiles where id = $1`, [ORANG_CK]);
const hdrSesudah = await satu(`select direvisi_by, direvisi_by_nama from dispatches where id=$1`, [sj2]);
cek('4. penunjuk id-nya memang menguap', hdrSesudah.direvisi_by, null);
cek('4. tapi namanya tetap ada', hdrSesudah.direvisi_by_nama, 'Orang CK');
cek(
  '4. dan jejak per barisnya juga tetap terbaca',
  (await satu(`select revisi from dispatch_items where dispatch_id=$1 and product_id=$2`, [sj2, GULA])).revisi[0].by_nama,
  'Orang CK'
);
await q(`insert into user_profiles (id, full_name) values ($1,'Orang CK')`, [ORANG_CK]);

// =====================================================================
console.log('\n§5 Tanda ekspor ESB dicabut berjejak');
// =====================================================================

const sj3 = await buatSjDiterima({ kirim: 100, terima: 100, esb: true });
await sebagai(ADHE);
const hasil = (await satu(`select revisi_kiriman_diterima($1,$2::jsonb,$3) h`, [sj3, JSON.stringify([{ product_id: SANTAN, received_qty: 90 }]), 'kelebihan hitung'])).h;

cek('5. hasilnya melaporkan tanda ESB dicabut', hasil.esb_dicabut, true);
const esb = await satu(`select esb_exported_at, esb_dibatalkan_at, esb_dibatalkan_by, esb_alasan_batal from dispatches where id=$1`, [sj3]);
cek('5. tandanya benar-benar hilang', esb.esb_exported_at, null);
benar('5. dan pencabutannya berjejak', !!esb.esb_dibatalkan_at);
cek('5. siapa yang mencabut tercatat', esb.esb_dibatalkan_by, ADHE);
benar('5. alasannya menyebut sebabnya revisi', /direvisi/.test(esb.esb_alasan_batal ?? ''), esb.esb_alasan_batal ?? '');
benar('5. dan memuat alasan yang diketik', /kelebihan hitung/.test(esb.esb_alasan_batal ?? ''), esb.esb_alasan_batal ?? '');

const sj4 = await buatSjDiterima({ kirim: 100, terima: 100, esb: false });
const h4 = (await satu(`select revisi_kiriman_diterima($1,$2::jsonb,$3) h`, [sj4, JSON.stringify([{ product_id: SANTAN, received_qty: 95 }]), 'koreksi'])).h;
cek('5. SJ yang belum diekspor tidak melaporkan pencabutan palsu', h4.esb_dicabut, false);

// =====================================================================
console.log('\n§6 Gerakan lama TIDAK ditimpa');
// =====================================================================
//
// Stok sekarang jadi benar, DAN riwayat "apa yang terjadi hari itu" tetap
// utuh. Menimpa gerakan lama membuat laporan periode lampau berubah sendiri
// berbulan-bulan sesudah ditutup.

const gerakan = (
  await q(
    `select qty_delta, notes from stock_movements
      where dispatch_id=$1 and outlet_id=$2 and product_id=$3 order by created_at, id`,
    [sj1, SENTUL, SANTAN]
  )
).rows;
cek('6. gerakan aslinya masih ada apa adanya', Number(gerakan[0].qty_delta), 450);
benar('6. koreksinya ditulis sebagai baris BARU', gerakan.length >= 2, `baris: ${gerakan.length}`);
benar(
  '6. dan koreksinya menyebut dirinya revisi',
  gerakan.slice(1).every((g) => /Revisi/.test(g.notes ?? '')),
  JSON.stringify(gerakan.map((g) => g.notes))
);
cek('6. jumlah gerakan SJ ini tetap sama dengan angka terakhirnya', await saldoSj(sj1, SENTUL, SANTAN), 400);

// ============ DAN REVISINYA TIDAK BOCOR KE SJ LAIN ============
//
// Gerakan koreksi menunjuk `dispatch_id`. Kalau salah satu revisi lupa
// menyertakannya, angkanya tetap benar di saldo outlet tapi tidak bisa
// ditelusuri ke dokumennya — dan pertanyaan "kenapa stok Santan kurang 50"
// tidak akan pernah terjawab.
cek(
  '6. tiap gerakan koreksi menunjuk SJ-nya',
  Number((await satu(`select count(*) n from stock_movements where dispatch_id is null`)).n),
  0
);

// =====================================================================
console.log('\n§7 Dijalankan ulang');
// =====================================================================

const sebelum = Number((await satu(`select count(*) n from stock_movements`)).n);
await db.exec(SQL.replace(/notify pgrst[^;]*;/g, ''));
cek('7. aman dijalankan dua kali — datanya utuh', Number((await satu(`select count(*) n from stock_movements`)).n), sebelum);
cek(
  '7. jejak revisi tidak hilang',
  Number((await satu(`select jsonb_array_length(revisi) l from dispatch_items where dispatch_id=$1 and product_id=$2`, [sj1, SANTAN])).l),
  2
);

console.log('');
if (gagal === 0) console.log(`${n} pemeriksaan 0165 lolos. ✅`);
else console.error(`${gagal} dari ${n} pemeriksaan GAGAL.`);
process.exit(gagal === 0 ? 0 : 1);
