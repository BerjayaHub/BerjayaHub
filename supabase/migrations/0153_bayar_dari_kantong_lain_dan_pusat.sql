-- ============================================================
-- 0153 — KAS KELUAR BOLEH DIBEBANKAN KE KANTONG OUTLET LAIN, ATAU KE PUSAT.
--
-- ============ YANG DIMINTA ============
--
--   "untuk cash ledger, seharusnya kantong kas bisa ambil dari kantong kas
--    outlet manapun ... termasuk bisa dibayar pusat, jadi tidak mengurangi
--    jumlah kas outlet nya"
--
-- ============ BAGIAN PERTAMA SUDAH ADA SEJAK 0126 ============
--
-- `boleh_membebani_kas` sudah membuka kantong BER-OUTLET untuk siapa pun yang
-- bertugas di BU outlet itu, dan `catat_kas_di` (0120) sudah menulisnya dengan
-- holder = pemilik kantongnya. Modul Bahan memakai keduanya sejak lama.
--
-- Yang salah cuma form Kas Keluar di Staff App: ia memanggil
-- `listMyCashAccounts()` — kantong SENDIRI — alih-alih daftar yang boleh
-- dibebani. Kemampuannya ada di database, jalannya tidak ada di layar; pola
-- yang sudah berulang kali muncul di proyek ini.
--
-- Satu hal yang memang kurang di database: `catat_kas_di` lahir sebelum kolom
-- `supplier` ada (0149). Lewat jalur itu, Payment To akan diam-diam kosong —
-- dan entrinya tertahan saat diekspor dengan alasan yang terlihat datang entah
-- dari mana.
--
-- ============ BAGIAN KEDUA: "DIBAYAR PUSAT" ============
--
-- `0125` sudah menjawab pertanyaan yang sama untuk NOTA, dan jawabannya di
-- sana: pembayaran Pusat tidak meninggalkan satu baris pun di `cash_entries`;
-- faktanya disimpan di notanya (`payment_source`).
--
-- Untuk Cash Ledger jawaban itu TIDAK BISA DIPAKAI. Tidak ada nota yang bisa
-- menyimpannya — entri kas itu sendiri satu-satunya catatan yang ada. Tanpa
-- baris, pengeluarannya tidak tercatat di mana pun dan tidak bisa diekspor
-- sebagai Disbursement.
--
-- Jadi barisnya ADA, ditandai `dibayar_pusat`, dan DIKECUALIKAN dari setiap
-- perhitungan saldo. Kolom `pusat` di pemetaan COANo sudah ada sejak lama
-- (`pusat -> 1 1 02 00`), jadi ekspornya sudah punya akun untuk dituju.
--
-- ============ SATU TEMPAT YANG TERLEWAT TIDAK MELEMPAR APA PUN ============
--
-- Ia cuma menjawab angka yang berbeda dari tetangganya, dan yang membacanya
-- tidak punya cara tahu mana yang benar. `0141` menulis kalimat itu saat
-- mengecualikan `dicoret_at`, dan mengerjakan seluruh tempatnya sekaligus.
-- Migration ini melakukan hal yang sama untuk `dibayar_pusat`:
--
--   cash_balances          saldo per pemegang
--   cash_account_balances  saldo per kantong
--   pindah_kas             pemeriksaan "saldo kantong asal cukup?"
--   daftar_kantong_kas     saldo di layar admin Kantong Kas
--
-- `atur_kantong_kas` TIDAK ikut: pemeriksaan "kantong masih berisi" di sana
-- menyaring `account_id = p_id`, dan baris Pusat selalu ber-`account_id` NULL.
-- Menambahkan saringan yang tidak bisa mengubah satu pun jawaban hanya
-- membuat orang berikutnya mengira ia load-bearing.
--
-- ============ FUNGSI YANG DISALIN, BUKAN DIKETIK ULANG ============
--
-- Lima fungsi di bawah ini disalin MENTAH dari migration asalnya, lalu diubah
-- pada satu ekspresi saja. Mengetiknya ulang berarti mengetik ulang seluruh
-- isinya — dan yang terlupa tidak melempar error, ia cuma menghilangkan satu
-- penjaga. `tools/audit-bayar-pusat.cjs` memeriksa tiap penjaga lamanya masih
-- ada, satu per satu.
-- ============================================================

-- ---------------------------------------------------------
-- (1) Nama kantong untuk DITAMPILKAN.
--
-- Tujuh tempat di repo ini menulis `coalesce(ca.name, 'Kas Utama')`. Baris
-- Pusat ber-`account_id` NULL, jadi ketujuhnya akan menyebutnya "Kas Utama" —
-- laporan yang mengatakan uangnya keluar dari kas pemegangnya, padahal ia
-- tidak pernah ada di tangannya.
--
-- Satu fungsi, dipakai semua yang menampilkan. Bukan tujuh salinan `case when`
-- yang cepat atau lambat berbeda satu sama lain.
-- ---------------------------------------------------------
create or replace function label_kantong_kas(p_nama text, p_pusat boolean)
returns text
language sql
immutable
as $$
  select case
           when coalesce(p_pusat, false) then 'Pusat'
           else coalesce(p_nama, 'Kas Utama')
         end;
$$;

comment on function label_kantong_kas(text, boolean) is
  'Nama kantong untuk ditampilkan: "Pusat" untuk entri yang dibayar kantor pusat, "Kas Utama" untuk uang tanpa kantong, selain itu nama kantongnya.';

-- ---------------------------------------------------------
-- (2) Kolomnya, dan dua hal yang TIDAK boleh berbarengan dengannya.
-- ---------------------------------------------------------
alter table cash_entries add column if not exists dibayar_pusat boolean not null default false;

comment on column cash_entries.dibayar_pusat is
  'Pengeluaran ini dibayar kantor pusat — tercatat sebagai biaya, tapi TIDAK mengurangi kas siapa pun. Dikecualikan dari setiap perhitungan saldo (0153).';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cash_entries_pusat_tanpa_kantong') then
    alter table cash_entries add constraint cash_entries_pusat_tanpa_kantong
      -- Uang Pusat tidak keluar dari kantong mana pun. Membiarkan keduanya
      -- terisi berarti sebuah baris yang menunjuk kantong sekaligus menyatakan
      -- tidak menyentuhnya — dan layar mana pun yang membacanya akan salah.
      check (not dibayar_pusat or account_id is null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cash_entries_pusat_hanya_keluar') then
    alter table cash_entries add constraint cash_entries_pusat_hanya_keluar
      -- Uang MASUK yang "dibayar pusat" tidak berarti apa-apa, dan transfer
      -- berpasangan dengan baris di kas lain — menandainya akan membuat
      -- pasangannya timpang.
      check (not dibayar_pusat or entry_type = 'out');
  end if;
end $$;

create index if not exists idx_kas_dibayar_pusat on cash_entries(entry_date) where dibayar_pusat;

-- ---------------------------------------------------------
-- (3) SALDO MENGABAIKAN YANG DIBAYAR PUSAT — semua tempatnya, sekaligus.
-- ---------------------------------------------------------
drop view if exists cash_balances;
create view cash_balances with (security_invoker = true) as
  select holder_id, sum(amount) as balance
  from cash_entries
  where dicoret_at is null
    and not dibayar_pusat
  group by holder_id;

drop view if exists cash_account_balances;
create view cash_account_balances with (security_invoker = true) as
  select ce.holder_id,
         ce.account_id,
         coalesce(ca.name, 'Kas Utama') as account_name,
         coalesce(ca.sort_order, -1) as sort_order,
         sum(ce.amount) as balance
  from cash_entries ce
  left join cash_accounts ca on ca.id = ce.account_id
  where ce.dicoret_at is null
    and not ce.dibayar_pusat
  group by ce.holder_id, ce.account_id, ca.name, ca.sort_order;


-- ---------------------------------------------------------
-- (4) `pindah_kas` — disalin dari 0063, saldonya mengecualikan Pusat.
-- ---------------------------------------------------------
create or replace function pindah_kas(p_from uuid, p_to uuid, p_amount numeric, p_notes text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_tid uuid := gen_random_uuid();
  v_saldo numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Jumlah pindah harus lebih dari 0.';
  end if;
  if p_from is not distinct from p_to then
    raise exception 'Kantong asal dan tujuan tidak boleh sama.';
  end if;

  -- Kedua kantong harus MILIK PEMANGGIL. Tanpa ini seseorang bisa memindahkan
  -- saldo ke kantong orang lain lewat RPC ini — dan itu transfer terselubung
  -- yang tidak tercatat sebagai transfer.
  if p_from is not null and not exists (select 1 from cash_accounts where id = p_from and holder_id = v_uid) then
    raise exception 'Kantong asal bukan milikmu.';
  end if;
  if p_to is not null and not exists (select 1 from cash_accounts where id = p_to and holder_id = v_uid) then
    raise exception 'Kantong tujuan bukan milikmu.';
  end if;

  select coalesce(sum(amount), 0) into v_saldo
  from cash_entries
   where holder_id = v_uid
     and account_id is not distinct from p_from
     -- Baris DIBAYAR PUSAT tidak pernah jadi uang di tangan siapa pun.
     and not dibayar_pusat
     -- Yang dicoret juga tidak — 0141 sudah mengecualikannya di view saldo,
     -- dan pemeriksaan di sini terlewat sejak saat itu.
     and dicoret_at is null;
  if v_saldo < p_amount then
    raise exception 'Saldo kantong asal tidak cukup (tersedia %).', v_saldo;
  end if;

  insert into cash_entries (holder_id, account_id, entry_type, amount, transfer_id, notes, created_by)
  values (v_uid, p_from, 'move_out', -abs(p_amount), v_tid, p_notes, v_uid);

  insert into cash_entries (holder_id, account_id, entry_type, amount, transfer_id, notes, created_by)
  values (v_uid, p_to, 'move_in', abs(p_amount), v_tid, p_notes, v_uid);
end;
$$;

-- ---------------------------------------------------------
-- (5) `daftar_kantong_kas` — disalin dari 0121, saldonya mengecualikan Pusat.
-- ---------------------------------------------------------
drop function if exists daftar_kantong_kas();
create function daftar_kantong_kas()
returns table (
  id uuid,
  holder_id uuid,
  holder_name text,
  name text,
  outlet_id uuid,
  outlet_name text,
  is_active boolean,
  sort_order int,
  balance numeric,
  jatah int,
  kantong_nyata boolean
)
language sql
security definer
stable
set search_path = public
as $$
  with saldo as (
    select ce.holder_id, ce.account_id, sum(ce.amount) as balance
      from cash_entries ce
     -- DIBAYAR PUSAT tidak menyentuh kas siapa pun (0153), dan yang DICORET
     -- sudah dinyatakan tidak pernah terjadi (0141) — keduanya dikecualikan
     -- di sini juga, supaya layar Kantong Kas menyebut angka yang sama
     -- dengan `cash_balances`.
     where not ce.dibayar_pusat
       and ce.dicoret_at is null
     group by ce.holder_id, ce.account_id
  ),
  -- Pemegang = siapa pun yang punya kantong ATAU punya uang, supaya tidak ada
  -- saldo yang hilang dari layar hanya karena pemiliknya belum punya kantong.
  orang as (
    select holder_id from cash_accounts
    union
    select holder_id from saldo
  )
  select a.id,
         a.holder_id,
         up.full_name,
         a.name,
         a.outlet_id,
         o.name,
         a.is_active,
         a.sort_order,
         coalesce(s.balance, 0),
         coalesce(up.cash_account_limit, 1),
         true
    from cash_accounts a
    join user_profiles up on up.id = a.holder_id
    left join outlets o on o.id = a.outlet_id
    left join saldo s on s.holder_id = a.holder_id and s.account_id = a.id
   where is_super_admin(auth.uid())

  union all

  select null::uuid,
         p.holder_id,
         up.full_name,
         'Kas Utama',
         null::uuid,
         null::text,
         true,
         -1,
         coalesce(s.balance, 0),
         coalesce(up.cash_account_limit, 1),
         false
    from orang p
    join user_profiles up on up.id = p.holder_id
    left join saldo s on s.holder_id = p.holder_id and s.account_id is null
   where is_super_admin(auth.uid())
     and coalesce(s.balance, 0) <> 0

   order by 3, 11 desc, 8, 4;
$$;

-- ---------------------------------------------------------
-- (6) Tiga daftar RINCIAN — disalin, hanya nama kantongnya yang berubah.
--
-- Baris Pusat TETAP MUNCUL di ketiganya: ia pengeluaran sungguhan, dan
-- menyembunyikannya membuat "berapa biaya bulan ini" tidak bisa dijawab dari
-- laporan mana pun. Yang berubah cuma namanya — "Pusat", bukan "Kas Utama".
-- ---------------------------------------------------------
drop function if exists riwayat_kas_saya(int);

create or replace function riwayat_kas_saya(p_limit int default 50)
returns table (
  id uuid,
  entry_date date,
  entry_type text,
  amount numeric,
  notes text,
  qty numeric,
  unit text,
  proof_path text,
  created_at timestamptz,
  category_id uuid,
  category_name text,
  account_id uuid,
  account_name text,
  outlet_id uuid,
  outlet_name text,
  counterpart_name text,
  penyesuaian_nota uuid,
  dicoret_at timestamptz,
  dicoret_oleh text,
  alasan_coret text,
  diubah_at timestamptz,
  diubah_oleh text,
  alasan_tolak text,
  supplier text,
  esb_exported_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select
    ce.id,
    ce.entry_date,
    ce.entry_type,
    ce.amount,
    ce.notes,
    ce.qty,
    ce.unit,
    ce.proof_path,
    ce.created_at,
    ce.category_id,
    cc.name,
    ce.account_id,
    label_kantong_kas(ca.name, ce.dibayar_pusat),
    ce.outlet_id,
    o.name,
    cp.full_name,
    ce.penyesuaian_nota,
    ce.dicoret_at,
    dc.full_name,
    ce.alasan_coret,
    ce.diubah_at,
    db.full_name,
    alasan_tolak_koreksi_kas(ce.id),
    ce.supplier,
    ce.esb_exported_at
  from cash_entries ce
  left join cash_categories cc on cc.id = ce.category_id
  left join cash_accounts ca on ca.id = ce.account_id
  left join outlets o on o.id = ce.outlet_id
  left join user_profiles cp on cp.id = ce.counterpart_id
  left join user_profiles dc on dc.id = ce.dicoret_by
  left join user_profiles db on db.id = ce.diubah_by
  where ce.holder_id = auth.uid()
  order by ce.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 500));
$$;

create or replace function laporan_kas_user(
  p_from date,
  p_to date,
  p_user uuid default null,
  p_outlet uuid default null,
  p_category uuid default null
)
returns table (
  entry_date date,
  holder_id uuid,
  holder_name text,
  account_name text,
  outlet_id uuid,
  outlet_name text,
  entry_type text,
  category_id uuid,
  category_name text,
  notes text,
  qty numeric,
  unit text,
  amount numeric,
  counterpart_name text,
  proof_path text
)
language sql
security definer
stable
set search_path = public
as $$
  select
    ce.entry_date,
    ce.holder_id,
    up.full_name,
    label_kantong_kas(ca.name, ce.dibayar_pusat),
    ce.outlet_id,
    o.name,
    ce.entry_type,
    ce.category_id,
    cc.name,
    ce.notes,
    ce.qty,
    ce.unit,
    ce.amount,
    cp.full_name,
    ce.proof_path
  from cash_entries ce
  join user_profiles up on up.id = ce.holder_id
  left join cash_accounts ca on ca.id = ce.account_id
  left join outlets o on o.id = ce.outlet_id
  left join cash_categories cc on cc.id = ce.category_id
  left join user_profiles cp on cp.id = ce.counterpart_id
  where ce.entry_date between p_from and p_to
    and ce.dicoret_at is null
    and (p_user is null or ce.holder_id = p_user)
    and (p_outlet is null or ce.outlet_id = p_outlet)
    and (p_category is null or ce.category_id = p_category)
    and boleh_lihat_kas(ce.holder_id, ce.outlet_id)
  order by up.full_name, ce.entry_date, ce.created_at;
$$;

drop function if exists rincian_mutasi_kas(date, date, uuid, uuid, boolean, uuid, uuid);
create function rincian_mutasi_kas(
  p_from date,
  p_to date,
  p_user uuid default null,
  p_account uuid default null,
  p_tanpa_kantong boolean default false,
  p_outlet uuid default null,
  p_category uuid default null
)
returns table (
  baris_id uuid,
  entry_id uuid,
  entry_date date,
  holder_id uuid,
  holder_name text,
  account_id uuid,
  account_name text,
  outlet_id uuid,
  outlet_name text,
  sumber text,
  kategori text,
  item text,
  qty numeric,
  satuan text,
  nominal numeric,
  entry_amount numeric,
  nota_code text,
  pihak text,
  nota_batal boolean
)
language sql
security definer
stable
set search_path = public
as $$
  with terlihat as (
    select ce.*
    from cash_entries ce
    where ce.entry_date between p_from and p_to
      and (p_user is null or ce.holder_id = p_user)
      and (p_outlet is null or ce.outlet_id = p_outlet)
      and (p_category is null or ce.category_id = p_category)
      and (
        case
          when coalesce(p_tanpa_kantong, false) then ce.account_id is null
          when p_account is null then true
          else ce.account_id = p_account
        end
      )
      and boleh_lihat_kas(ce.holder_id, ce.outlet_id)
  ),
  -- Nota yang pembayarannya ADA di dalam rentang terlihat. Sengaja `join`
  -- lewat `payment_entry_id`, bukan lewat `untuk_nota` — alasannya di kepala
  -- berkas ini.
  nota as (
    select g.id, g.code, g.supplier, g.payment_entry_id, g.status
    from goods_receipts g
    join terlihat t on t.id = g.payment_entry_id
  )

  -- ---- (a) Pembayaran nota, dipecah per bahan ----
  select
    gri.id,
    t.id,
    t.entry_date,
    t.holder_id,
    up.full_name,
    t.account_id,
    label_kantong_kas(ca.name, t.dibayar_pusat),
    t.outlet_id,
    o.name,
    'bahan'::text,
    -- MAPPING. Pembelian bahan biasanya tidak berkategori kas (kategorinya ada
    -- di notanya), jadi kategori kas dipakai kalau ada dan "Pembelian bahan"
    -- kalau tidak — bukan dikosongkan, supaya kolomnya bisa dipivot.
    coalesce(cc.name, 'Pembelian bahan'),
    -- Produk yang sudah dihapus dari master TETAP MUNCUL: uangnya benar-benar
    -- keluar, dan baris yang hilang membuat total tidak cocok dengan entrinya.
    coalesce(p.name, '(produk terhapus)'),
    gri.qty,
    p.base_unit,
    -- Nilai baris memakai rumus yang SAMA dengan `nota_ringkas` dan
    -- `bayar_nota`: `line_total` dulu, lalu `qty * unit_cost`. Mengalikan
    -- balik dari `unit_cost` saja meleset ribuan rupiah pada qty yang tidak
    -- membagi habis (lihat js/modules/inventory/harga-baris.js).
    --
    -- NULL kalau barisnya memang belum berharga — bukan 0. Nol membuat total
    -- terlihat sah padahal ada barang yang belum bernilai.
    case when t.amount < 0 then -1 else 1 end * coalesce(gri.line_total, gri.qty * gri.unit_cost),
    t.amount,
    n.code,
    n.supplier,
    n.status = 'dibatalkan'
  from terlihat t
  join nota n on n.payment_entry_id = t.id
  join goods_receipt_items gri on gri.receipt_id = n.id
  join user_profiles up on up.id = t.holder_id
  left join cash_accounts ca on ca.id = t.account_id
  left join outlets o on o.id = t.outlet_id
  left join cash_categories cc on cc.id = t.category_id
  left join products p on p.id = gri.product_id

  union all

  -- ---- (b) Entri kas yang bukan pembayaran nota ----
  select
    t.id,
    t.id,
    t.entry_date,
    t.holder_id,
    up.full_name,
    t.account_id,
    label_kantong_kas(ca.name, t.dibayar_pusat),
    t.outlet_id,
    o.name,
    'kas'::text,
    -- MAPPING kas ledger: kategori yang dipilih saat mencatat. Yang tidak
    -- berkategori diberi label sesuai JENIS entrinya, bukan dibiarkan kosong —
    -- transfer dan pindah antar kantong memang tidak pernah berkategori, dan
    -- "(kosong)" di laporan terbaca seperti data yang hilang.
    coalesce(
      cc.name,
      case
        when t.penyesuaian_nota is not null then 'Penyesuaian nota'
        when t.entry_type in ('transfer_in', 'transfer_out') then 'Transfer antar pemegang'
        when t.entry_type in ('move_in', 'move_out') then 'Pindah antar kantong'
        else 'Tanpa kategori'
      end
    ),
    coalesce(nullif(btrim(t.notes), ''), cc.name, 'Tanpa keterangan'),
    t.qty,
    t.unit,
    t.amount,
    t.amount,
    null::text,
    cp.full_name,
    false
  from terlihat t
  join user_profiles up on up.id = t.holder_id
  left join cash_accounts ca on ca.id = t.account_id
  left join outlets o on o.id = t.outlet_id
  left join cash_categories cc on cc.id = t.category_id
  left join user_profiles cp on cp.id = t.counterpart_id
  where not exists (select 1 from nota n where n.payment_entry_id = t.id)

  order by 3, 5, 2, 1;
$$;

-- ---------------------------------------------------------
-- (7) `catat_kas_di` — Supplier ikut, dan Pusat jadi salah satu jawabannya.
--
-- ============ TANDA TANGAN LAMA DIBUANG ============
--
-- PostgREST memilih overload berdasarkan HIMPUNAN NAMA ARGUMEN yang dikirim.
-- Dua tanda tangan yang cuma berbeda satu argumen berarti permintaan lama
-- diam-diam memilih yang lama — dan Supplier yang baru saja dipilih orangnya
-- lenyap tanpa satu pun pesan. Bug itu sudah terjadi di `ubah_kas` (0149).
--
-- ============ SATU FUNGSI, BUKAN DUA JALUR ============
--
-- Form Kas Keluar sekarang punya tiga kemungkinan sumber dana: kantong
-- sendiri, kantong outlet lain, dan Pusat. Menuliskannya sebagai dua jalur di
-- klien (`.insert()` untuk yang sendiri, RPC untuk yang lain) berarti dua
-- kumpulan penjaga yang cepat atau lambat berbeda — dan bedanya baru terlihat
-- sebagai entri yang lolos lewat jalur yang lebih longgar.
-- ---------------------------------------------------------
drop function if exists catat_kas_di(uuid, text, numeric, uuid, uuid, text, text, date, numeric, text);

create or replace function catat_kas_di(
  p_account uuid,
  p_type text,
  p_amount numeric,
  p_category uuid default null,
  p_outlet uuid default null,
  p_notes text default null,
  p_proof text default null,
  p_date date default null,
  p_qty numeric default null,
  p_unit text default null,
  p_supplier text default null,
  p_dibayar_pusat boolean default false
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_holder uuid;
  v_aktif boolean;
  v_id uuid;
  v_amount numeric;
  v_pusat boolean := coalesce(p_dibayar_pusat, false);
begin
  if v_uid is null then
    raise exception 'Sesi tidak ditemukan, silakan login ulang.';
  end if;
  if p_type not in ('in', 'out') then
    raise exception 'Jenis kas hanya boleh in atau out.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Nominal harus lebih besar dari 0.';
  end if;

  if v_pusat then
    -- DIBAYAR PUSAT: tidak ada kantong yang dibebani, jadi tidak ada wewenang
    -- kantong yang perlu diperiksa. Pemegangnya tetap yang mencatat — dialah
    -- yang tahu pengeluarannya terjadi, dan barisnya toh tidak menyentuh
    -- saldonya.
    if p_type <> 'out' then
      raise exception 'Hanya kas keluar yang bisa dibayar Pusat.';
    end if;
    if p_account is not null then
      raise exception 'Pengeluaran yang dibayar Pusat tidak keluar dari kantong mana pun. Pilih salah satu, bukan keduanya.';
    end if;
    v_holder := v_uid;
  else
    if p_account is null then
      raise exception 'Pilih dulu kantong kasnya — uangnya keluar dari kantong mana.';
    end if;

    -- Dipisah dari `boleh_membebani_kas` supaya PESANNYA tepat: pemegang yang
    -- kantongnya sudah ditutup akan dibilang "tidak berhak", dan ia akan
    -- mencari izin yang tidak pernah hilang alih-alih membuka kantongnya.
    select holder_id, is_active into v_holder, v_aktif from cash_accounts where id = p_account;
    if v_holder is null then
      raise exception 'Kantong kas tidak ditemukan.';
    end if;
    if not v_aktif then
      raise exception 'Kantong kas ini sudah ditutup. Aktifkan lagi kalau memang masih dipakai.';
    end if;
    if not boleh_membebani_kas(v_uid, p_account) then
      raise exception 'Kamu tidak berhak mencatat pada kantong kas ini.';
    end if;
  end if;

  -- TANDANYA DITENTUKAN DI SINI, bukan oleh pemanggil. Satu layar yang lupa
  -- memberi minus akan MENAMBAH kas ketika seharusnya mengurangi — dan
  -- saldonya tetap terlihat wajar sampai ada yang menghitung uang fisiknya.
  v_amount := case when p_type = 'out' then -abs(p_amount) else abs(p_amount) end;

  if p_type = 'out' and p_outlet is null then
    raise exception 'Kas keluar harus menyebut outlet peruntukannya.';
  end if;
  if p_type = 'out' and nullif(p_proof, '') is null then
    raise exception 'Kas keluar harus disertai foto bukti/nota.';
  end if;

  insert into cash_entries (
    holder_id, account_id, entry_type, amount, category_id, outlet_id,
    notes, proof_path, entry_date, qty, unit, supplier, dibayar_pusat, created_by
  )
  values (
    v_holder, p_account, p_type, v_amount, p_category, p_outlet,
    nullif(p_notes, ''), nullif(p_proof, ''),
    coalesce(p_date, (now() at time zone 'Asia/Jakarta')::date),
    p_qty, nullif(p_unit, ''),
    -- Hanya kas KELUAR yang pernah jadi Disbursement, jadi kas masuk tidak
    -- pernah mengisinya — aturan yang sama dengan `recordCashEntry` (0149).
    case when p_type = 'out' then nullif(btrim(p_supplier), '') else null end,
    v_pusat,
    v_uid
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function catat_kas_di(uuid, text, numeric, uuid, uuid, text, text, date, numeric, text, text, boolean) from public;
grant execute on function catat_kas_di(uuid, text, numeric, uuid, uuid, text, text, date, numeric, text, text, boolean) to authenticated;

comment on function catat_kas_di(uuid, text, numeric, uuid, uuid, text, text, date, numeric, text, text, boolean) is
  'Catat entri kas pada kantong tertentu — boleh milik orang lain (0120/0126) — atau tanpa kantong sama sekali kalau dibayar Pusat (0153). Ikut menyimpan Supplier untuk ekspor Disbursement.';

-- ---------------------------------------------------------
-- (8) `ubah_kantong_kas` (0152) menolak baris Pusat.
--
-- Memberinya kantong berarti menyatakan uangnya keluar dari kas seseorang —
-- kebalikan persis dari apa yang baris itu katakan. Dan constraint
-- `cash_entries_pusat_tanpa_kantong` akan menolaknya di tengah UPDATE dengan
-- pesan yang berbicara tentang nama constraint, bukan tentang uang.
-- ---------------------------------------------------------
create or replace function ubah_kantong_kas(p_entries uuid[], p_account uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_akun cash_accounts%rowtype;
  v_n int;
begin
  if p_entries is null or array_length(p_entries, 1) is null then
    return 0;
  end if;

  if p_account is null then
    raise exception 'Pilih kantong tujuannya dulu. Memindahkan kembali ke Kas Utama tidak membereskan apa pun.';
  end if;

  select * into v_akun from cash_accounts where id = p_account;
  if v_akun.id is null then
    raise exception 'Kantong kasnya tidak ditemukan. Mungkin baru dihapus — muat ulang halamannya.';
  end if;
  if not v_akun.is_active then
    raise exception 'Kantong "%" sudah tidak aktif. Pilih kantong lain, atau aktifkan dulu di Kantong Kas.', v_akun.name;
  end if;
  if not boleh_koreksi_kas(v_akun.holder_id) then
    raise exception 'Kantong itu bukan wewenangmu.';
  end if;

  update cash_entries c
     set account_id = p_account,
         diubah_by = v_uid,
         diubah_at = now()
   where c.id = any(p_entries)
     and c.account_id is distinct from p_account
     and c.holder_id = v_akun.holder_id
     -- BARIS PUSAT DILEWATI (0153). Uangnya tidak pernah keluar dari kantong
     -- siapa pun, jadi memberinya kantong adalah pernyataan yang salah.
     and not c.dibayar_pusat
     and alasan_tolak_koreksi_kas(c.id) is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function ubah_kantong_kas(uuid[], uuid) from public;
grant execute on function ubah_kantong_kas(uuid[], uuid) to authenticated;

-- ---------------------------------------------------------
-- (9) Ekspor: baris Pusat membawa tandanya.
--
-- Kolom `Account` berkas Disbursement dibaca dari outlet MILIK KANTONG (0151).
-- Baris Pusat tidak punya kantong, jadi tanpa tanda ini ia akan tertahan
-- dengan alasan "Kantong kasnya belum punya outlet" — untuk pengeluaran yang
-- memang SENGAJA tidak punya kantong, dan yang tidak bisa dibereskan di layar
-- mana pun.
--
-- Yang dikirim tandanya, BUKAN nama kantong palsu berisi 'pusat'. Menuliskan
-- nama yang tidak ada di `cash_accounts` membuat tiap pembaca berikutnya harus
-- menebak apakah itu kantong sungguhan.
-- ---------------------------------------------------------
drop function if exists kas_untuk_esb(uuid, date, date, uuid, boolean);

create function kas_untuk_esb(
  p_bu uuid,
  p_from date,
  p_to date,
  p_outlet uuid default null,
  p_termasuk_sudah_ekspor boolean default false
)
returns table (
  id uuid,
  entry_date date,
  amount numeric,
  notes text,
  supplier text,
  outlet_id uuid,
  outlet_nama text,
  kategori_nama text,
  kantong_nama text,
  kantong_outlet_nama text,
  dibayar_pusat boolean,
  esb_exported_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select
    ce.id,
    ce.entry_date,
    ce.amount,
    ce.notes,
    ce.supplier,
    ce.outlet_id,
    o.name,
    cc.name,
    label_kantong_kas(ca.name, ce.dibayar_pusat),
    ko.name,
    ce.dibayar_pusat,
    ce.esb_exported_at
  from cash_entries ce
  join outlets o on o.id = ce.outlet_id
  left join cash_categories cc on cc.id = ce.category_id
  -- KEDUANYA `left join`. `join` biasa akan MENGHILANGKAN entri yang
  -- kantongnya tidak punya outlet — dan hilang dari daftar berarti hilang dari
  -- daftar tertahan juga.
  left join cash_accounts ca on ca.id = ce.account_id
  left join outlets ko on ko.id = ca.outlet_id
  where ce.entry_type = 'out'
    -- HANYA PENGELUARAN SELAIN BAHAN. Keduanya dijaga constraint trigger
    -- (0122/0131), jadi flag-nya tidak bisa dikarang dari klien.
    and ce.untuk_nota = false
    and ce.penyesuaian_nota is null
    and ce.dicoret_at is null
    and o.business_unit_id = p_bu
    and (p_outlet is null or ce.outlet_id = p_outlet)
    and ce.entry_date between p_from and p_to
    and (p_termasuk_sudah_ekspor or ce.esb_exported_at is null)
    -- Wewenangnya lewat outlet, sama dengan `tandai_kas_esb`.
    and is_admin_of_outlet(auth.uid(), ce.outlet_id)
  order by ce.entry_date, ce.id;
$$;

revoke all on function kas_untuk_esb(uuid, date, date, uuid, boolean) from public;
grant execute on function kas_untuk_esb(uuid, date, date, uuid, boolean) to authenticated;

comment on function kas_untuk_esb(uuid, date, date, uuid, boolean) is
  'Kas keluar SELAIN pembelian bahan, untuk berkas ESB Disbursement. Membawa outlet MILIK KANTONGNYA (0151) dan tanda dibayar Pusat (0153) — keduanya sumber kolom Account.';

notify pgrst, 'reload schema';
