-- =========================================================
-- Berjaya Hub OMS — 0141
-- Kas bisa DIKOREKSI, terlihat oleh admin BU, dan kolom Outlet-nya tidak
-- lagi kosong.
--
-- =========================================================
-- YANG DIMINTA
-- =========================================================
--
--   "di staff app, ada kolom yang kosong, ini diinput oleh outlet diluar
--    pemegang kas tapi memakai kantong kas dia"
--
--   "di admin portal keluarkan modul kas dari tab modul user agar berdiri
--    sendiri, dan bisa diakses selain super admin"
--
--   "buat aksi untuk edit dan hapus juga di modul kas di staff app ini, tetapi
--    semua user yang punya akses bu admin bisa mengedit dan menghapus ... dengan
--    keterangan diedit atau dihapus oleh user siapa, tanpa melihat basis outlet,
--    karena ada case seruni yang basis nya outlet admin berhak untuk cek dan
--    edit punya kas iis yang ada di outlet ck"
--
-- =========================================================
-- (A) KOLOM OUTLET YANG KOSONG — SEBABNYA IZIN, BUKAN DATA
-- =========================================================
--
-- Risma (Serpong) menerima barang untuk outletnya dan membayarnya dari kantong
-- "Kas Iis CK". `bayar_nota` menyimpan `outlet_id` = outlet NOTANYA, jadi
-- datanya BENAR: entri itu memang berperuntukan Serpong.
--
-- Yang salah adalah cara layar membacanya. Riwayat kas mengambil nama outlet
-- lewat embed PostgREST (`outlets!outlet_id(name)`), dan kebijakan
-- `outlets_select` (0001) menuntut `has_outlet_scope`. Iis hanya bercakupan di
-- Central Kitchen, jadi baris outlet Serpong TIDAK TERBACA olehnya — PostgREST
-- tidak menolak permintaannya, ia cuma mengembalikan `null` untuk embed itu.
--
-- Hasilnya: kolom yang kosong, tanpa satu pun error, untuk data yang lengkap.
-- Persis bentuk kegagalan yang paling mahal di aplikasi ini.
--
-- Jalan keluarnya BUKAN melonggarkan `outlets_select` — itu membuka seluruh
-- daftar outlet untuk tujuan yang sempit. `riwayat_kas_saya()` di bawah
-- menyelesaikan namanya di server, sama seperti `laporan_kas_user` (0063)
-- sudah melakukannya.
--
-- =========================================================
-- (B) "HAPUS" BERARTI DICORET, BUKAN DIBUANG
-- =========================================================
--
-- Yang diminta adalah jejak "dihapus oleh siapa". Baris yang benar-benar hilang
-- tidak bisa menyimpan keterangan apa pun tentang dirinya sendiri — jadi hapus
-- permanen dan permintaan itu saling meniadakan.
--
-- Entri yang dicoret TETAP ADA, ditandai, dan BERHENTI MENGHITUNG SALDO.
-- Konsekuensinya harus dikatakan: setiap tempat yang menjumlahkan
-- `cash_entries.amount` wajib ikut menyaring `dicoret_at is null`. Yang
-- terlewat tidak akan melempar error — ia cuma menjawab angka yang berbeda dari
-- tetangganya. Karena itu SEMUANYA dikerjakan di berkas ini sekaligus:
-- `cash_balances`, `cash_account_balances`, `daftar_kantong_kas` (0121),
-- `laporan_kas_user` (0063), dan `rincian_mutasi_kas` (0140).
--
-- =========================================================
-- (C) ADMIN BU BISA MELIHAT & MENGOREKSI — PEMBALIKAN SADAR DARI 0040
-- =========================================================
--
-- `0040` menulis: "Admin BU tidak lagi bisa melihat kas siapa pun — kas
-- dianggap data tingkat organisasi." Itu DIBALIK di sini, dan pembalikannya
-- disengaja, bukan kelalaian.
--
-- Cakupannya tetap sempit: admin BU melihat kas orang yang punya keanggotaan
-- DI BU YANG IA ADMINI — bukan seluruh organisasi. Yang berubah dari 0040 cuma
-- satu: kas berhenti jadi rahasia super admin.
--
-- `is_bu_admin`, TANPA menyebut outlet sama sekali. Itu inti permintaannya:
-- Seruni berbasis outlet Admin Divisi tapi bu_admin di Awal Bermula Cafe, dan
-- ia berhak memeriksa kas Iis yang berada di Central Kitchen. Menambahkan
-- syarat outlet di sini akan menutup persis kasus yang sedang dibuka.
--
-- =========================================================
-- (D) ENTRI PEMBAYARAN NOTA TIDAK BOLEH DISENTUH DARI SINI
-- =========================================================
--
-- Nominalnya milik notanya. Mengubahnya dari modul Kas meninggalkan nota
-- berstatus LUNAS dengan angka yang sudah tidak cocok — dan tidak ada satu pun
-- layar yang akan menunjukkan ketidakcocokan itu.
--
-- Jalurnya sudah ada dan menangani stok sekalian: modul Bahan -> Batalkan
-- Pembayaran (`batalkan_pembayaran_nota`, 0122/0125). Penolakan di bawah
-- MENYEBUT jalur itu, bukan sekadar berkata tidak boleh.
-- =========================================================

-- ---------------------------------------------------------
-- (1) Jejak koreksi.
--
-- Yang disimpan adalah PENGUBAH TERAKHIR, bukan riwayat lengkap tiap versi.
-- Dikatakan terus terang supaya tidak ada yang mengira berkas ini menyediakan
-- audit trail penuh: kalau suatu saat dibutuhkan, tempatnya tabel tersendiri.
-- ---------------------------------------------------------
alter table cash_entries add column if not exists dicoret_at timestamptz;
alter table cash_entries add column if not exists dicoret_by uuid references user_profiles(id) on delete set null;
alter table cash_entries add column if not exists alasan_coret text;
alter table cash_entries add column if not exists diubah_at timestamptz;
alter table cash_entries add column if not exists diubah_by uuid references user_profiles(id) on delete set null;

create index if not exists idx_cash_entries_aktif on cash_entries(holder_id) where dicoret_at is null;

comment on column cash_entries.dicoret_at is
  'Entri ini dianggap DIHAPUS sejak waktu ini. Barisnya sengaja tidak dibuang supaya jejak siapa & kenapa tetap ada; semua penjumlahan saldo wajib menyaring `dicoret_at is null`.';

-- ---------------------------------------------------------
-- (2) Siapa boleh mengoreksi kas milik siapa.
--
-- SATU tempat, dipakai kedua RPC dan (lewat RPC pembaca) juga layar. Aturan
-- izin yang disalin ke beberapa tempat cepat atau lambat menyimpang, dan
-- penyimpangannya muncul sebagai tombol yang ada tapi selalu ditolak.
-- ---------------------------------------------------------
create or replace function boleh_koreksi_kas(p_holder uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    is_super_admin(auth.uid())
    -- Pemegangnya sendiri: ia yang menanggung selisihnya.
    or p_holder = auth.uid()
    -- Admin BU mana pun tempat pemegangnya bernaung. SENGAJA tanpa syarat
    -- outlet: Seruni berbasis outlet Admin Divisi tapi bu_admin di Awal
    -- Bermula Cafe, dan kas Iis berada di Central Kitchen.
    or exists (
      select 1
      from membership_scopes ms
      where ms.user_id = p_holder
        and ms.business_unit_id is not null
        and is_bu_admin(auth.uid(), ms.business_unit_id)
    );
$$;

revoke all on function boleh_koreksi_kas(uuid) from public;
grant execute on function boleh_koreksi_kas(uuid) to authenticated;

comment on function boleh_koreksi_kas(uuid) is
  'Boleh tidaknya auth.uid() mengubah/mencoret entri kas milik p_holder. Super admin, pemegangnya sendiri, atau admin BU tempat pemegangnya bernaung — tanpa melihat outlet basis (0141).';

-- ---------------------------------------------------------
-- (3) Boleh tidaknya SATU entri dikoreksi — dan kalau tidak, KENAPA.
--
-- Mengembalikan TEKS ALASAN (null = boleh), bukan boolean. Dua sebabnya:
--
--   1. Kedua RPC di bawah memakai jawaban yang sama persis, jadi pesan
--      penolakannya tidak bisa menyimpang satu sama lain.
--   2. Layar bisa MENANYAKAN lebih dulu dan menuliskan sebabnya di tempat
--      tombolnya, alih-alih membiarkan orang menekan tombol yang sudah pasti
--      ditolak. "Tidak boleh" tanpa sebab adalah cara tercepat membuat orang
--      mengira aplikasinya rusak.
-- ---------------------------------------------------------
create or replace function alasan_tolak_koreksi_kas(p_entry uuid)
returns text
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v cash_entries%rowtype;
  v_kode text;
begin
  select * into v from cash_entries where id = p_entry;
  if v.id is null then
    return 'Entri kasnya tidak ditemukan. Mungkin sudah dikoreksi orang lain — muat ulang halamannya.';
  end if;

  if not boleh_koreksi_kas(v.holder_id) then
    return 'Kas ini bukan wewenangmu. Yang bisa mengoreksinya: pemegangnya sendiri, admin BU tempat ia bernaung, atau super admin.';
  end if;

  if v.dicoret_at is not null then
    return 'Entri ini sudah dihapus sebelumnya, jadi tidak ada lagi yang bisa diubah.';
  end if;

  -- Transfer & pindah antar kantong BERPASANGAN: tiap baris punya kembaran di
  -- kas orang lain (atau kantong lain) lewat `transfer_id`. Mengubah satu sisi
  -- membuat uang muncul atau lenyap di antara keduanya, dan tidak ada satu pun
  -- layar yang menampilkan kedua sisi bersebelahan.
  if v.entry_type not in ('in', 'out') then
    return 'Transfer dan perpindahan antar kantong berpasangan dengan baris di kas lain, jadi tidak bisa dikoreksi sepotong. Catat transfer balik kalau memang salah.';
  end if;

  -- Entri PEMBAYARAN NOTA. Nominalnya milik notanya.
  select string_agg(code, ', ' order by code) into v_kode
    from goods_receipts where payment_entry_id = p_entry;
  if v_kode is not null then
    return 'Entri ini adalah pembayaran nota ' || v_kode ||
           '. Nominalnya mengikuti isi notanya, jadi mengubahnya dari sini akan meninggalkan nota berstatus LUNAS dengan angka yang tidak cocok. ' ||
           'Pakai modul Bahan -> Nota Terima -> Batalkan Pembayaran; stok dan status notanya ikut dibereskan di sana.';
  end if;

  -- Entri PENYESUAIAN nota (0131): ia lahir dari koreksi/pembatalan nota dan
  -- nilainya diturunkan dari selisih notanya sendiri.
  if v.penyesuaian_nota is not null then
    return 'Entri ini penyesuaian otomatis dari koreksi nota, bukan catatan kas yang berdiri sendiri. Perbaiki notanya di modul Bahan.';
  end if;

  return null;
end;
$$;

revoke all on function alasan_tolak_koreksi_kas(uuid) from public;
grant execute on function alasan_tolak_koreksi_kas(uuid) to authenticated;

comment on function alasan_tolak_koreksi_kas(uuid) is
  'NULL kalau entri kas boleh dikoreksi; kalau tidak, kalimat yang menyebut sebabnya dan jalan keluarnya. Dipakai ubah_kas(), coret_kas(), dan layar sebelum menggambar tombolnya.';

-- Bentuk BANYAK, untuk layar Admin Portal.
--
-- Tanpa ini, layar mutasi kas harus memanggil fungsi di atas sekali per baris:
-- lima puluh permintaan berbarengan hanya untuk memutuskan tombol mana yang
-- digambar. Sebagian akan tertunda lama, dan yang gagal akan menggambar tombol
-- yang salah tanpa satu pun error.
create or replace function alasan_tolak_koreksi_kas_banyak(p_entries uuid[])
returns table (entry_id uuid, alasan text)
language sql
security definer
stable
set search_path = public
as $$
  select e, alasan_tolak_koreksi_kas(e)
  from unnest(coalesce(p_entries, array[]::uuid[])) as e;
$$;

revoke all on function alasan_tolak_koreksi_kas_banyak(uuid[]) from public;
grant execute on function alasan_tolak_koreksi_kas_banyak(uuid[]) to authenticated;

-- ---------------------------------------------------------
-- (4) UBAH entri kas.
--
-- TULIS PENUH, semua parameter wajib disebut pemanggil (tidak ada `default`).
-- Alasannya sama dengan `atur_kantong_kas` (0121): parameter yang punya default
-- berarti ada nilai yang diam-diam menghapus field yang tidak disebut — bug
-- 0119 ("+ Foto menghapus supplier") lahir persis begitu.
--
-- Yang TIDAK bisa diubah: pemegangnya, kantongnya, jenisnya (in/out), dan
-- foto notanya. Memindahkan entri ke kas orang lain bukan koreksi, itu
-- transfer — dan ada tombolnya sendiri.
-- ---------------------------------------------------------
create or replace function ubah_kas(
  p_entry uuid,
  p_amount numeric,
  p_category uuid,
  p_outlet uuid,
  p_notes text,
  p_qty numeric,
  p_unit text,
  p_date date
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_tolak text;
  v_type text;
begin
  if v_uid is null then raise exception 'Harus login'; end if;

  v_tolak := alasan_tolak_koreksi_kas(p_entry);
  if v_tolak is not null then raise exception '%', v_tolak; end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Jumlah uang harus lebih dari 0.';
  end if;
  if coalesce(btrim(p_notes), '') = '' then
    raise exception 'Keterangan wajib diisi — entri tanpa keterangan tidak bisa dipertanggungjawabkan siapa pun.';
  end if;

  select entry_type into v_type from cash_entries where id = p_entry;

  -- Kas keluar WAJIB punya outlet peruntukan (constraint 0063). Ditangkap di
  -- sini supaya pesannya menyebut outlet, bukan nama constraint.
  if v_type = 'out' and p_outlet is null then
    raise exception 'Pilih outlet peruntukan — kas keluar harus jelas dibelanjakan untuk outlet mana.';
  end if;

  update cash_entries
     set amount = case when v_type = 'out' then -abs(p_amount) else abs(p_amount) end,
         category_id = p_category,
         -- Kas MASUK tidak punya peruntukan (0063), jadi outletnya selalu
         -- dikosongkan alih-alih menerima apa pun yang dikirim layar.
         outlet_id = case when v_type = 'out' then p_outlet else null end,
         notes = btrim(p_notes),
         qty = p_qty,
         unit = nullif(btrim(coalesce(p_unit, '')), ''),
         entry_date = coalesce(p_date, entry_date),
         diubah_at = now(),
         diubah_by = v_uid
   where id = p_entry;
end;
$$;

revoke all on function ubah_kas(uuid, numeric, uuid, uuid, text, numeric, text, date) from public;
grant execute on function ubah_kas(uuid, numeric, uuid, uuid, text, numeric, text, date) to authenticated;

-- ---------------------------------------------------------
-- (5) CORET entri kas.
--
-- Alasan WAJIB, sama seperti `batalkan_nota` (0131): entri yang dihapus tanpa
-- alasan tidak bisa dibedakan dari kesalahan sistem oleh siapa pun yang
-- membacanya kemudian.
-- ---------------------------------------------------------
create or replace function coret_kas(p_entry uuid, p_alasan text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_tolak text;
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  if coalesce(btrim(p_alasan), '') = '' then
    raise exception 'Sebutkan alasan penghapusannya — walau sesingkat "salah input".';
  end if;

  v_tolak := alasan_tolak_koreksi_kas(p_entry);
  if v_tolak is not null then raise exception '%', v_tolak; end if;

  update cash_entries
     set dicoret_at = now(),
         dicoret_by = v_uid,
         alasan_coret = btrim(p_alasan)
   where id = p_entry;
end;
$$;

revoke all on function coret_kas(uuid, text) from public;
grant execute on function coret_kas(uuid, text) to authenticated;

-- ---------------------------------------------------------
-- (6) ADMIN BU BISA MEMBACA — pembalikan sadar dari 0040.
--
-- Kebijakan lama TIDAK dihapus; yang ini ditambahkan di sebelahnya. Kebijakan
-- select di Postgres bersifat OR, jadi pemegang & super admin tetap seperti
-- sebelumnya dan tidak ada akses yang hilang diam-diam.
-- ---------------------------------------------------------
drop policy if exists cash_entries_select_bu_admin on cash_entries;
create policy cash_entries_select_bu_admin on cash_entries
  for select to authenticated
  using (
    exists (
      select 1
      from membership_scopes ms
      where ms.user_id = cash_entries.holder_id
        and ms.business_unit_id is not null
        and is_bu_admin(auth.uid(), ms.business_unit_id)
    )
  );

-- ---------------------------------------------------------
-- (7) SALDO MENGABAIKAN YANG DICORET — semua tempatnya, sekaligus.
--
-- Satu tempat yang terlewat tidak melempar error; ia cuma menjawab angka yang
-- berbeda dari tetangganya, dan yang membacanya tidak punya cara tahu mana yang
-- benar.
-- ---------------------------------------------------------
drop view if exists cash_balances;
create view cash_balances with (security_invoker = true) as
  select holder_id, sum(amount) as balance
  from cash_entries
  where dicoret_at is null
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
  group by ce.holder_id, ce.account_id, ca.name, ca.sort_order;

-- Saldo di layar admin kantong kas (0121).
create or replace function daftar_kantong_kas()
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
     where ce.dicoret_at is null
     group by ce.holder_id, ce.account_id
  ),
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

revoke all on function daftar_kantong_kas() from public;
grant execute on function daftar_kantong_kas() to authenticated;

-- Laporan Kas per Pemegang (0063).
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
    coalesce(ca.name, 'Kas Utama'),
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

revoke all on function laporan_kas_user(date, date, uuid, uuid, uuid) from public;
grant execute on function laporan_kas_user(date, date, uuid, uuid, uuid) to authenticated;

-- Laporan Rincian Mutasi Kas (0140). HANYA satu baris yang berubah —
-- `ce.dicoret_at is null` di CTE `terlihat` — tapi fungsinya ditulis ulang utuh
-- karena Postgres tidak punya cara menambal badan fungsi.
create or replace function rincian_mutasi_kas(
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
      and ce.dicoret_at is null
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
  nota as (
    select g.id, g.code, g.supplier, g.payment_entry_id, g.status
    from goods_receipts g
    join terlihat t on t.id = g.payment_entry_id
  )

  select
    gri.id,
    t.id,
    t.entry_date,
    t.holder_id,
    up.full_name,
    t.account_id,
    coalesce(ca.name, 'Kas Utama'),
    t.outlet_id,
    o.name,
    'bahan'::text,
    coalesce(cc.name, 'Pembelian bahan'),
    coalesce(p.name, '(produk terhapus)'),
    gri.qty,
    p.base_unit,
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

  select
    t.id,
    t.id,
    t.entry_date,
    t.holder_id,
    up.full_name,
    t.account_id,
    coalesce(ca.name, 'Kas Utama'),
    t.outlet_id,
    o.name,
    'kas'::text,
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

revoke all on function rincian_mutasi_kas(date, date, uuid, uuid, boolean, uuid, uuid) from public;
grant execute on function rincian_mutasi_kas(date, date, uuid, uuid, boolean, uuid, uuid) to authenticated;

-- ---------------------------------------------------------
-- (8) RIWAYAT KAS SAYA — nama outletnya diselesaikan di server.
--
-- Inilah perbaikan kolom kosong di (A). Entri yang DICORET ikut terbawa,
-- ditandai: modul Kas adalah satu-satunya tempat koreksi itu bisa dilihat, dan
-- riwayat yang diam-diam kehilangan satu baris jauh lebih membingungkan
-- daripada baris yang tertulis "dihapus".
-- ---------------------------------------------------------
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
  alasan_tolak text
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
    coalesce(ca.name, 'Kas Utama'),
    ce.outlet_id,
    -- INI yang tidak bisa dikerjakan embed PostgREST: nama outlet peruntukan
    -- yang pemegangnya sendiri tidak punya cakupan di sana.
    o.name,
    cp.full_name,
    ce.penyesuaian_nota,
    ce.dicoret_at,
    dc.full_name,
    ce.alasan_coret,
    ce.diubah_at,
    db.full_name,
    -- Sebab penolakan dihitung DI SINI, sekali per baris, supaya layar tidak
    -- perlu menebak aturannya sendiri — dan tidak perlu satu permintaan
    -- tambahan per baris hanya untuk tahu tombolnya boleh digambar atau tidak.
    alasan_tolak_koreksi_kas(ce.id)
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

revoke all on function riwayat_kas_saya(int) from public;
grant execute on function riwayat_kas_saya(int) to authenticated;

comment on function riwayat_kas_saya(int) is
  'Riwayat kas milik pemanggil, dengan nama outlet PERUNTUKAN diselesaikan di server — embed PostgREST mengembalikan null untuk outlet yang pemegangnya tidak bercakupan di sana (0141).';

-- ---------------------------------------------------------
-- (9) Penjaga: satu bentuk tiap fungsi baru.
--
-- PostgREST memilih fungsi dari HIMPUNAN NAMA argumennya. Bentuk kedua yang
-- tertinggal tidak menghasilkan error — ia menghasilkan JAWABAN LAIN.
-- ---------------------------------------------------------
do $$
declare
  v_n int;
  v_nama text;
begin
  foreach v_nama in array array['ubah_kas', 'coret_kas', 'riwayat_kas_saya', 'boleh_koreksi_kas', 'alasan_tolak_koreksi_kas', 'alasan_tolak_koreksi_kas_banyak', 'rincian_mutasi_kas', 'laporan_kas_user', 'daftar_kantong_kas']
  loop
    select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_nama;
    if v_n <> 1 then
      raise exception '% punya % bentuk, seharusnya 1.', v_nama, v_n;
    end if;
  end loop;
end $$;
