/**
 * MIGRATION 0131 DI POSTGRES SUNGGUHAN (PGlite).
 *
 * ============ YANG DIUJI ============
 *
 * Tiga hal harus SELALU bergerak bersama. Yang tertinggal tidak akan pernah
 * mengeluh — ia cuma membuat dua laporan bercerita berbeda.
 *
 *   1. Batalkan nota  -> STOK ditarik lewat pergerakan penyeimbang.
 *   2. Batalkan nota lunas -> KAS dikembalikan, dan pergerakan lamanya utuh.
 *   3. Koreksi nota lunas -> kas disesuaikan sebesar SELISIHNYA, dua arah.
 *   4. Nota batal tidak bisa diubah, dibayar, atau diekspor ke ESB.
 *   5. Nota yang sudah diekspor ESB ditahan sampai tandanya dibatalkan.
 *   6. Alasan wajib, dan wewenangnya dijaga.
 *   7. Jalur LANGSUNG ke nota lunas tetap tertutup — kunci hanya dibuka
 *      `koreksi_nota`, dan penandanya tidak tertinggal menyala.
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
  if (!syarat) { gagal++; console.error(`❌ ${nama}${ket ? ' — ' + ket : ''}`); }
};

const db = new PGlite();
const q = (sql, params) => db.query(sql, params);
const satu = async (sql, params) => (await q(sql, params)).rows[0];
const gagalkan = async (fn) => { try { await fn(); return null; } catch (e) { return String(e.message ?? e); } };

await db.exec(`
  create role authenticated;
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;
  create table business_units (id uuid primary key default gen_random_uuid(), name text);
  create table outlets (id uuid primary key default gen_random_uuid(), business_unit_id uuid, name text);
  create table user_profiles (id uuid primary key, full_name text);
  create table products (id uuid primary key default gen_random_uuid(), name text, base_unit text);
  create table cash_accounts (id uuid primary key default gen_random_uuid(), holder_id uuid);
  create table cash_entries (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, outlet_id uuid, holder_id uuid, account_id uuid,
    entry_type text, amount numeric, notes text, entry_date date,
    created_by uuid, untuk_nota boolean not null default false, proof_path text);
  create table stock_movements (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, outlet_id uuid, product_id uuid, movement_type text,
    qty_delta numeric, unit_cost numeric, notes text, created_by uuid, receipt_id uuid,
    created_at timestamptz not null default now());
  create table goods_receipts (
    id uuid primary key default gen_random_uuid(),
    business_unit_id uuid, outlet_id uuid, code text,
    receipt_date date default current_date, supplier text, invoice_no text,
    photo_path text, notes text, created_by uuid,
    created_at timestamptz default now(), updated_at timestamptz default now(),
    payment_status text default 'belum', payment_source text, due_date date,
    paid_at timestamptz, paid_by uuid, payment_entry_id uuid,
    harga_digeser_at timestamptz, esb_exported_at timestamptz, esb_exported_by uuid);
  create table goods_receipt_items (
    id uuid primary key default gen_random_uuid(),
    receipt_id uuid not null references goods_receipts(id) on delete cascade,
    product_id uuid not null, qty numeric not null check (qty > 0),
    unit_cost numeric, line_total numeric, notes text);

  create or replace function has_outlet_scope(p_uid uuid, p_outlet uuid) returns boolean
    language sql stable as $$
      select exists (select 1 from user_profiles where id = p_uid and full_name <> 'ORANG LUAR')
         and p_outlet is not null; $$;
  create or replace function is_bu_admin(p_uid uuid, p_bu uuid) returns boolean
    language sql stable as $$ select p_uid is not null $$;

  -- harga_baris_nota (0123) & ubah_nota_terima (0123), disederhanakan
  -- seperlunya tapi mempertahankan perilaku yang diandalkan 0131.
  create or replace function harga_baris_nota(p_item jsonb, p_qty numeric,
    out total numeric, out satuan numeric) language plpgsql as $$
  begin
    total := nullif(p_item->>'line_total', '')::numeric;
    if total is null then satuan := null; return; end if;
    satuan := case when p_qty > 0 then total / p_qty else null end;
  end; $$;

  create or replace function ubah_nota_terima(
    p_id uuid, p_receipt_date date, p_supplier text, p_invoice_no text,
    p_photo_path text, p_notes text, p_items jsonb) returns void
  language plpgsql as $$
  declare
    v_bu uuid; v_outlet uuid; v_code text; v_uid uuid := auth.uid();
    it jsonb; v_pid uuid; v_qty numeric; v_lama numeric; v_selisih numeric;
    v_total numeric; v_satuan numeric;
  begin
    select business_unit_id, outlet_id, code into v_bu, v_outlet, v_code from goods_receipts where id = p_id;
    update goods_receipts set receipt_date = coalesce(p_receipt_date, receipt_date),
      supplier = case when p_supplier is null then supplier else nullif(p_supplier,'') end,
      updated_at = now() where id = p_id;
    if p_items is null then return; end if;
    for it in select * from jsonb_array_elements(p_items) loop
      v_pid := (it->>'product_id')::uuid; v_qty := (it->>'qty')::numeric;
      if v_pid is null or v_qty is null or v_qty <= 0 then continue; end if;
      select total, satuan into v_total, v_satuan from harga_baris_nota(it, v_qty);
      select qty into v_lama from goods_receipt_items where receipt_id = p_id and product_id = v_pid;
      v_selisih := v_qty - coalesce(v_lama, 0);
      if v_lama is null then
        insert into goods_receipt_items (receipt_id, product_id, qty, unit_cost, line_total)
        values (p_id, v_pid, v_qty, v_satuan, v_total);
      else
        update goods_receipt_items set qty = v_qty, unit_cost = v_satuan, line_total = v_total
        where receipt_id = p_id and product_id = v_pid;
      end if;
      if v_selisih <> 0 then
        insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, unit_cost, notes, created_by, receipt_id)
        values (v_bu, v_outlet, v_pid, 'receive', v_selisih, v_satuan, 'Koreksi nota ' || v_code, v_uid, p_id);
      end if;
      update stock_movements set unit_cost = v_satuan
       where receipt_id = p_id and product_id = v_pid and qty_delta > 0;
    end loop;
    for v_pid, v_lama in
      select product_id, qty from goods_receipt_items where receipt_id = p_id
        and product_id not in (select (x->>'product_id')::uuid from jsonb_array_elements(p_items) x where (x->>'product_id') is not null)
    loop
      insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, notes, created_by, receipt_id)
      values (v_bu, v_outlet, v_pid, 'receive', -v_lama, 'Batal dari nota ' || v_code, v_uid, p_id);
      delete from goods_receipt_items where receipt_id = p_id and product_id = v_pid;
    end loop;
  end; $$;

  -- Penjaga 0122 yang digantikan 0131.
  create or replace function tolak_ubah_nota_lunas() returns trigger language plpgsql as $$
  begin
    if (select payment_status from goods_receipts where id = coalesce(new.receipt_id, old.receipt_id)) = 'lunas' then
      raise exception 'Nota sudah dibayar, isinya tidak bisa diubah.';
    end if;
    return coalesce(new, old);
  end; $$;
  create trigger trg_tolak_ubah_nota_lunas before insert or update or delete on goods_receipt_items
    for each row execute function tolak_ubah_nota_lunas();

  create or replace function cek_untuk_nota_punya_nota() returns trigger language plpgsql as $$
  begin
    if not exists (select 1 from goods_receipts where payment_entry_id = new.id) then
      raise exception 'Entri kas ditandai pembayaran nota, tetapi tidak ada nota yang menunjuknya.';
    end if;
    return null;
  end; $$;
  create constraint trigger trg_untuk_nota_punya_nota after insert or update on cash_entries
    deferrable initially deferred for each row when (new.untuk_nota)
    execute function cek_untuk_nota_punya_nota();
`);

const jalankan = async (b) =>
  db.exec(fs.readFileSync(path.join(AKAR, 'supabase/migrations', b), 'utf8').replace(/notify pgrst[^;]*;/g, ''));
await jalankan('0131_nota_batal_dan_koreksi.sql');
console.log('  0131 terpasang.');
await jalankan('0131_nota_batal_dan_koreksi.sql');
console.log('  dijalankan ulang: aman.');

const BU = (await satu(`insert into business_units (name) values ('Cafe') returning id`)).id;
const OUT = (await satu(`insert into outlets (business_unit_id, name) values ($1,'Sentul') returning id`, [BU])).id;
const STAFF = '11111111-1111-1111-1111-111111111111';
const LUAR = '22222222-2222-2222-2222-222222222222';
await q(`insert into user_profiles (id, full_name) values ($1,'Riyan'), ($2,'ORANG LUAR')`, [STAFF, LUAR]);
await q(`select set_config('request.jwt.claim.sub', $1, false)`, [STAFF]);
const AKUN = (await satu(`insert into cash_accounts (holder_id) values ($1) returning id`, [STAFF])).id;
const WORTEL = (await satu(`insert into products (name, base_unit) values ('Wortel','GR') returning id`)).id;
const BERAS = (await satu(`insert into products (name, base_unit) values ('Beras','GR') returning id`)).id;

let n = 0;
async function buatNota({ lunas = false, sumber = 'kas', items = [[WORTEL, 100, 5000]] } = {}) {
  n += 1;
  const id = (
    await satu(
      `insert into goods_receipts (business_unit_id, outlet_id, code, created_by) values ($1,$2,$3,$4) returning id`,
      [BU, OUT, `TRM-${String(n).padStart(3, '0')}`, STAFF]
    )
  ).id;
  for (const [pid, qty, harga] of items) {
    await q(
      `insert into goods_receipt_items (receipt_id, product_id, qty, unit_cost, line_total) values ($1,$2,$3,$4,$5)`,
      [id, pid, qty, harga / qty, harga]
    );
    await q(
      `insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, unit_cost, notes, created_by, receipt_id)
       values ($1,$2,$3,'receive',$4,$5,'Terima nota',$6,$7)`,
      [BU, OUT, pid, qty, harga / qty, STAFF, id]
    );
  }
  if (lunas) {
    const total = items.reduce((s, [, , h]) => s + h, 0);
    if (sumber === 'kas') {
      // SATU pernyataan, bukan dua.
      //
      // `trg_untuk_nota_punya_nota` (0122) `deferrable initially deferred` —
      // ia diperiksa saat transaksinya SELESAI. Di PGlite tiap `query()` adalah
      // transaksinya sendiri, jadi memisahkan insert dan update membuat entri
      // kasnya commit sebelum ada nota yang menunjuknya, dan pemeriksanya
      // menolak dengan benar. `bayar_nota()` yang sungguhan memang mengerjakan
      // keduanya dalam satu fungsi.
      await q(
        `with e as (
           insert into cash_entries (business_unit_id, outlet_id, holder_id, account_id, entry_type, amount, notes, entry_date, created_by, untuk_nota)
           values ($2,$3,$4,$5,'out',$6,'Pembayaran nota',current_date,$4,true) returning id
         )
         update goods_receipts g
            set payment_status='lunas', payment_source='kas', payment_entry_id=e.id, paid_at=now()
           from e where g.id = $1`,
        [id, BU, OUT, STAFF, AKUN, -total]
      );
    } else {
      await q(`update goods_receipts set payment_status='lunas', payment_source=$2, paid_at=now() where id=$1`, [id, sumber]);
    }
  }
  return id;
}

const stok = async (pid, receiptId) =>
  Number((await satu(`select coalesce(sum(qty_delta),0) as t from stock_movements where product_id=$1 and receipt_id=$2`, [pid, receiptId])).t);
const kas = async (notaId) =>
  Number(
    (await satu(`select coalesce(sum(amount),0) as t from cash_entries where penyesuaian_nota = $1`, [notaId])).t
  );

// =====================================================================
// §1. Batalkan nota BELUM dibayar -> stok ditarik.
// =====================================================================
const A = await buatNota();
cek('§1 sebelum dibatalkan, stok dari nota ini +100', await stok(WORTEL, A), 100);
const totalA = Number(await satu(`select batalkan_nota($1,'salah input') as t`, [A]).then((r) => r.t));
cek('§1 nilai yang dikembalikan = total notanya', totalA, 5000);
cek('§1 stok bersih dari nota ini jadi 0', await stok(WORTEL, A), 0);
cek(
  '§1 pergerakan LAMA tidak dihapus — riwayatnya tetap jujur',
  Number((await satu(`select count(*) as c from stock_movements where receipt_id=$1`, [A])).c),
  2
);
const rowA = await satu(`select status, alasan_batal, dibatalkan_by, payment_status from goods_receipts where id=$1`, [A]);
cek('§1 statusnya dibatalkan', rowA.status, 'dibatalkan');
cek('§1 alasannya tersimpan', rowA.alasan_batal, 'salah input');
cek('§1 pelakunya tercatat', rowA.dibatalkan_by, STAFF);
cek('§1 tidak menggantung di Hutang Supplier', rowA.payment_status, 'batal');
cek('§1 belum dibayar -> tidak ada entri kas sama sekali', await kas(A), 0);

// =====================================================================
// §2. Batalkan nota LUNAS -> kas dikembalikan.
// =====================================================================
const B = await buatNota({ lunas: true });
cek('§2 kas sebelum pembatalan: -5000 (pembayaran)', Number((await satu(`select sum(amount) as t from cash_entries where notes='Pembayaran nota'`)).t), -5000);
await q(`select batalkan_nota($1,'barang diretur')`, [B]);
cek('§2 entri penyesuaian mengembalikan 5000', await kas(B), 5000);
cek('§2 stok ikut ditarik', await stok(WORTEL, B), 0);
benar(
  '§2 entri aslinya TIDAK dihapus — buku kas bercerita apa adanya',
  Number((await satu(`select count(*) as c from cash_entries where id = (select payment_entry_id from goods_receipts where id=$1)`, [B])).c) === 1
);

// Dibayar PUSAT: tidak pernah menyentuh kas, jadi tidak ada yang dikembalikan.
const C = await buatNota({ lunas: true, sumber: 'pusat' });
await q(`select batalkan_nota($1,'salah supplier')`, [C]);
cek('§2 nota yang dibayar PUSAT tidak membuat entri kas apa pun', await kas(C), 0);
cek('§2 tapi stoknya tetap ditarik', await stok(WORTEL, C), 0);

// =====================================================================
// §3. Koreksi nota LUNAS — kas menyesuaikan sebesar SELISIHNYA, dua arah.
// =====================================================================
const D = await buatNota({ lunas: true }); // 100 gr, Rp5.000
const selisihNaik = Number(
  (
    await satu(
      `select koreksi_nota($1,null,null,null,null,null,$2::jsonb,'harga salah ketik') as s`,
      [D, JSON.stringify([{ product_id: WORTEL, qty: 100, line_total: 8000 }])]
    )
  ).s
);
cek('§3 selisih naik dilaporkan +3000', selisihNaik, 3000);
cek('§3 kas keluar lagi 3000', await kas(D), -3000);
// ARAHNYA ikut diperiksa, bukan cuma jumlahnya.
//
// `amount` dan `entry_type` bisa berbeda cerita: nominalnya benar sementara
// jenisnya terbalik. Laporan kas yang mengelompokkan per `entry_type` akan
// menampilkan pengeluaran sebagai pemasukan, dan totalnya tetap terlihat wajar.
cek(
  '§3 dan jenisnya "out" — bukan cuma nominalnya yang benar',
  (await satu(`select entry_type from cash_entries where penyesuaian_nota=$1 order by id`, [D])).entry_type,
  'out'
);
cek(
  '§3 harga di buku besar stok ikut berubah (biaya rata-rata bahan)',
  Number((await satu(`select distinct unit_cost from stock_movements where receipt_id=$1 and qty_delta>0`, [D])).unit_cost),
  80
);

const selisihTurun = Number(
  (
    await satu(
      `select koreksi_nota($1,null,null,null,null,null,$2::jsonb,'ternyata lebih murah') as s`,
      [D, JSON.stringify([{ product_id: WORTEL, qty: 100, line_total: 2000 }])]
    )
  ).s
);
cek('§3 selisih turun dilaporkan -6000', selisihTurun, -6000);
cek('§3 kas bersih dari penyesuaian: -3000 + 6000 = 3000', await kas(D), 3000);
cek(
  '§3 penyesuaian kedua jenisnya "in" — uang kembali ke kas',
  (await satu(`select entry_type from cash_entries where penyesuaian_nota=$1 and amount > 0`, [D])).entry_type,
  'in'
);

// NOTA YANG BELUM DIBAYAR TIDAK BOLEH MENYENTUH KAS SAMA SEKALI.
//
// Ini yang menahan seluruh rantai penjaga di `sesuaikan_kas_nota`. Tanpa
// pemeriksaan ini, mencabut penjaganya tidak menggagalkan satu tes pun —
// sementara akibatnya adalah entri kas untuk uang yang tidak pernah berpindah.
const BELUM = await buatNota();
await q(`select koreksi_nota($1,null,null,null,null,null,$2::jsonb,'perbaikan biasa')`, [
  BELUM,
  JSON.stringify([{ product_id: WORTEL, qty: 100, line_total: 99000 }])
]);
cek('§3 nota BELUM dibayar: tidak ada entri kas apa pun', await kas(BELUM), 0);
cek(
  '§3 dan tidak ada entri kas nyasar tanpa nota',
  Number((await satu(`select count(*) as c from cash_entries where business_unit_id is null`)).c),
  0
);

// Qty berubah -> stok ikut, lewat penyeimbang.
await q(`select koreksi_nota($1,null,null,null,null,null,$2::jsonb,'jumlah salah')`, [
  D,
  JSON.stringify([{ product_id: WORTEL, qty: 60, line_total: 2000 }])
]);
cek('§3 stok bersih mengikuti qty terbaru', await stok(WORTEL, D), 60);

// Menambah bahan baru & menghapus yang lama, pada nota lunas.
await q(`select koreksi_nota($1,null,null,null,null,null,$2::jsonb,'salah bahan')`, [
  D,
  JSON.stringify([{ product_id: BERAS, qty: 10, line_total: 2000 }])
]);
cek('§3 bahan yang dibuang: stoknya kembali 0', await stok(WORTEL, D), 0);
cek('§3 bahan pengganti masuk', await stok(BERAS, D), 10);

// Tanggal bisa diubah — inti keluhan aslinya.
await q(`select koreksi_nota($1,'2026-08-31'::date,null,null,null,null,null,'tanggal salah')`, [D]);
// Dibandingkan DI DALAM SQL. PGlite mengembalikan kolom `date` sebagai objek
// Date JavaScript, dan `String(...)` atasnya menghasilkan "Mon Aug 31" — bentuk
// yang tidak pernah sama dengan yang diharapkan, sekalipun datanya benar.
cek(
  '§3 tanggal nota lunas bisa diperbaiki',
  (await satu(`select to_char(receipt_date, 'YYYY-MM-DD') as t from goods_receipts where id=$1`, [D])).t,
  '2026-08-31'
);

// =====================================================================
// §4. Nota batal terkunci.
// =====================================================================
const E = await buatNota();
await q(`select batalkan_nota($1,'salah input')`, [E]);

benar(
  '§4 nota batal tidak bisa dikoreksi',
  /sudah dibatalkan/i.test((await gagalkan(() => q(`select koreksi_nota($1,null,null,null,null,null,$2::jsonb,'x')`, [E, JSON.stringify([{ product_id: WORTEL, qty: 1, line_total: 1 }])]))) ?? '')
);
benar(
  '§4 isinya tidak bisa disentuh langsung',
  /sudah dibatalkan/i.test((await gagalkan(() => q(`update goods_receipt_items set qty=1 where receipt_id=$1`, [E]))) ?? '')
);
benar('§4 tidak bisa dibatalkan dua kali', /memang sudah dibatalkan/i.test((await gagalkan(() => q(`select batalkan_nota($1,'lagi')`, [E]))) ?? ''));
benar(
  '§4 tidak bisa dibayar',
  /sudah dibatalkan/i.test((await gagalkan(() => q(`update goods_receipts set payment_status='lunas' where id=$1`, [E]))) ?? '')
);
cek('§4 tidak ikut ditandai ekspor ESB', Number((await satu(`select tandai_nota_esb(array[$1]::uuid[]) as n`, [E])).n), 0);

// =====================================================================
// §5. Nota yang sudah diekspor ESB ditahan.
// =====================================================================
const F = await buatNota();
await q(`update goods_receipts set esb_exported_at = now() where id=$1`, [F]);
benar('§5 tidak bisa dibatalkan', /diekspor ke ESB/i.test((await gagalkan(() => q(`select batalkan_nota($1,'x')`, [F]))) ?? ''));
benar(
  '§5 tidak bisa dikoreksi',
  /diekspor ke ESB/i.test((await gagalkan(() => q(`select koreksi_nota($1,null,null,null,null,null,null,'x')`, [F]))) ?? '')
);
// Dan jalan keluarnya ada.
await q(`update goods_receipts set esb_exported_at = null where id=$1`, [F]);
benar('§5 sesudah tanda ekspornya dibatalkan, bisa diperbaiki', (await gagalkan(() => q(`select batalkan_nota($1,'x')`, [F]))) === null);

// =====================================================================
// §6. Alasan wajib & wewenang.
// =====================================================================
const G = await buatNota();
for (const alasan of ['', '   ', null]) {
  benar(
    `§6 alasan ${JSON.stringify(alasan)} ditolak`,
    /alasan/i.test((await gagalkan(() => q(`select batalkan_nota($1,$2)`, [G, alasan]))) ?? '')
  );
}
await q(`select set_config('request.jwt.claim.sub', $1, false)`, [LUAR]);
benar('§6 orang luar tidak bisa membatalkan', /bukan wewenangmu/i.test((await gagalkan(() => q(`select batalkan_nota($1,'iseng')`, [G]))) ?? ''));
benar('§6 orang luar tidak bisa mengoreksi', /bukan wewenangmu/i.test((await gagalkan(() => q(`select koreksi_nota($1,null,null,null,null,null,null,'x')`, [G]))) ?? ''));
await q(`select set_config('request.jwt.claim.sub', $1, false)`, [STAFF]);

// =====================================================================
// §7. Jalur LANGSUNG ke nota lunas tetap tertutup.
//
// Ini penjagaan yang paling mudah hilang tanpa terasa: kalau kunci lunas
// dibuka begitu saja, PWA lama di HP staff bisa mengubah nilai nota lunas
// dan kas tidak bergerak sama sekali.
// =====================================================================
const H = await buatNota({ lunas: true });
benar(
  '§7 ubah_nota_terima langsung pada nota lunas DITOLAK',
  /sudah dibayar/i.test(
    (await gagalkan(() =>
      q(`select ubah_nota_terima($1,null,null,null,null,null,$2::jsonb)`, [H, JSON.stringify([{ product_id: WORTEL, qty: 999, line_total: 1 }])])
    )) ?? ''
  )
);
cek('§7 dan nilainya tidak berubah', Number((await satu(`select qty from goods_receipt_items where receipt_id=$1`, [H])).qty), 100);

// Penandanya tidak tertinggal menyala sesudah koreksi selesai.
await q(`select koreksi_nota($1,null,null,null,null,null,$2::jsonb,'ok')`, [
  H,
  JSON.stringify([{ product_id: WORTEL, qty: 100, line_total: 5000 }])
]);
benar(
  '§7 sesudah koreksi_nota, kuncinya menutup lagi',
  /sudah dibayar/i.test(
    (await gagalkan(() =>
      q(`select ubah_nota_terima($1,null,null,null,null,null,$2::jsonb)`, [H, JSON.stringify([{ product_id: WORTEL, qty: 5, line_total: 1 }])])
    )) ?? ''
  )
);

// Koreksi yang GAGAL di tengah juga tidak boleh meninggalkan kunci terbuka.
await gagalkan(() => q(`select koreksi_nota($1,null,null,null,null,null,$2::jsonb,'x')`, [H, '"bukan array"']));
benar(
  '§7 koreksi yang gagal pun tidak meninggalkan kunci terbuka',
  /sudah dibayar/i.test(
    (await gagalkan(() =>
      q(`select ubah_nota_terima($1,null,null,null,null,null,$2::jsonb)`, [H, JSON.stringify([{ product_id: WORTEL, qty: 7, line_total: 1 }])])
    )) ?? ''
  )
);

// =====================================================================
// §8. Ringkasan menyebut statusnya.
// =====================================================================
const v = await satu(`select status, alasan_batal, total from nota_ringkas where id=$1`, [E]);
cek('§8 nota_ringkas menyebut status', v.status, 'dibatalkan');
benar('§8 dan alasannya', v.alasan_batal === 'salah input');

if (gagal === 0) console.log('Migration 0131 di Postgres sungguhan: 8 bagian LULUS. ✅');
process.exit(gagal === 0 ? 0 : 1);
