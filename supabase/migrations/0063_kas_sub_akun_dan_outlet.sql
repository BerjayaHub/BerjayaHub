-- =========================================================
-- Berjaya Hub OMS — 0063
-- Kas: sub-kas bernama (Kas Owner / Kas Operasional), outlet peruntukan,
-- dan mutasi antar kas milik sendiri.
--
-- PRINSIP YANG TIDAK BERUBAH: kas tetap MILIK USER (sejak 0040). Yang
-- ditambahkan bukan kepemilikan baru, melainkan:
--   - sub-kas: satu orang boleh punya beberapa "kantong" bernama;
--   - outlet PERUNTUKAN: uang keluar itu untuk outlet mana — bukan pemiliknya.
-- Pemegangnya tetap satu orang yang bertanggung jawab.
-- =========================================================

-- ---------------------------------------------------------
-- (1) Berapa kantong kas yang boleh dimiliki seseorang.
--
-- Diatur ADMIN (super admin / admin BU), dinamai USER sendiri. Default 1 =
-- perilaku lama persis: satu kas, tanpa pilihan kantong di mana pun, sehingga
-- yang tidak membutuhkannya tidak melihat kerumitan tambahan.
-- ---------------------------------------------------------
alter table user_profiles add column if not exists cash_account_limit int not null default 1;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'user_profiles_cash_limit_wajar') then
    alter table user_profiles add constraint user_profiles_cash_limit_wajar
      check (cash_account_limit between 1 and 10);
  end if;
end $$;

comment on column user_profiles.cash_account_limit is
  'Berapa kantong kas yang boleh dibuat orang ini. 1 = kas tunggal (perilaku default).';

-- ---------------------------------------------------------
-- (2) Kantong kas — DINAMAI USER SENDIRI.
--
-- Konsekuensi yang perlu diketahui: nama antar user bisa berbeda ("Kas Ops" vs
-- "Kas Operasional"), sehingga laporan TIDAK bisa dijumlahkan per jenis kas
-- lintas orang. Laporan tetap bisa dikelompokkan per ORANG dan per KAS-nya
-- sendiri. Kalau nanti perlu rekap per jenis, daftar master per BU bisa
-- ditambahkan tanpa membongkar struktur ini.
-- ---------------------------------------------------------
create table if not exists cash_accounts (
  id uuid primary key default gen_random_uuid(),
  holder_id uuid not null references user_profiles(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (holder_id, name),
  constraint cash_accounts_nama_isi check (length(btrim(name)) > 0)
);
create index if not exists idx_cash_accounts_holder on cash_accounts(holder_id) where is_active;

alter table cash_accounts enable row level security;

-- Pemilik mengelola kantongnya sendiri; super admin boleh melihat untuk audit.
drop policy if exists cash_accounts_own on cash_accounts;
create policy cash_accounts_own on cash_accounts
  for all to authenticated
  using (holder_id = auth.uid() or is_super_admin(auth.uid()))
  with check (holder_id = auth.uid());

-- Jangan sampai user membuat kantong melebihi jatah yang diberikan admin.
-- Dijaga di DATABASE, bukan hanya di UI: batas yang cuma dijaga tampilan akan
-- tembus lewat panggilan API langsung, dan tidak akan ada yang menyadarinya.
create or replace function cek_batas_kantong_kas()
returns trigger
language plpgsql
as $$
declare
  v_batas int;
  v_jml int;
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

drop trigger if exists trg_batas_kantong_kas on cash_accounts;
create trigger trg_batas_kantong_kas
  before insert or update on cash_accounts
  for each row execute function cek_batas_kantong_kas();

-- ---------------------------------------------------------
-- (3) Kolom baru di entri kas
-- ---------------------------------------------------------
alter table cash_entries add column if not exists account_id uuid references cash_accounts(id) on delete restrict;
create index if not exists idx_cash_entries_account on cash_entries(account_id);

comment on column cash_entries.account_id is
  'Kantong kas. NULL = kas tunggal (user yang jatahnya 1, atau entri lama sebelum 0063).';
comment on column cash_entries.outlet_id is
  'Sejak 0063: outlet PERUNTUKAN untuk kas KELUAR — uang ini dibelanjakan untuk outlet mana. Bukan pemilik kasnya.';

-- Jenis transaksi baru: mutasi antar kantong MILIK SENDIRI.
-- Sepasang baris (move_out negatif + move_in positif) dengan transfer_id yang
-- sama. Total saldo orang itu TIDAK berubah — hanya berpindah kantong.
alter table cash_entries drop constraint if exists cash_entries_entry_type_check;
alter table cash_entries add constraint cash_entries_entry_type_check
  check (entry_type in ('in', 'out', 'transfer_out', 'transfer_in', 'move_out', 'move_in'));

-- Nota wajib hanya untuk transaksi uang sungguhan. Transfer antar orang dan
-- mutasi antar kantong tidak punya nota yang bisa difoto.
alter table cash_entries drop constraint if exists cash_entries_nota_wajib;
alter table cash_entries add constraint cash_entries_nota_wajib
  check (entry_type <> 'out' or proof_path is not null)
  not valid;

-- Outlet peruntukan WAJIB untuk kas keluar (keputusan: hanya kas keluar).
-- `not valid` supaya entri lama tidak menggagalkan migration — riwayat kas
-- justru yang paling tidak boleh diubah surut.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cash_entries_outlet_wajib_saat_keluar') then
    alter table cash_entries add constraint cash_entries_outlet_wajib_saat_keluar
      check (entry_type <> 'out' or outlet_id is not null)
      not valid;
  end if;
end $$;

-- ---------------------------------------------------------
-- (4) Saldo per kantong, DAN total per orang.
--
-- Dua bentuk sengaja disediakan: UI menampilkan total di atas (pertanyaan
-- "berapa uang saya") lalu rincian per kantong di bawahnya. Kalau hanya ada
-- saldo per kantong, totalnya harus dijumlahkan di klien — dan itu akan
-- berbeda dari database begitu ada baris yang tidak ikut terbaca.
-- ---------------------------------------------------------
drop view if exists cash_balances;
create view cash_balances with (security_invoker = true) as
  select holder_id, sum(amount) as balance
  from cash_entries
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
  group by ce.holder_id, ce.account_id, ca.name, ca.sort_order;

-- ---------------------------------------------------------
-- (5) Pindah saldo antar kantong milik sendiri.
--
-- Lewat RPC supaya kedua barisnya SELALU lahir bersama. Kalau dikerjakan dua
-- insert dari klien, kegagalan di tengah menghasilkan uang yang keluar dari
-- satu kantong tanpa pernah masuk ke kantong lain — dan selisihnya tidak akan
-- pernah ketahuan karena totalnya memang tidak dicatat terpisah.
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
  from cash_entries where holder_id = v_uid and account_id is not distinct from p_from;
  if v_saldo < p_amount then
    raise exception 'Saldo kantong asal tidak cukup (tersedia %).', v_saldo;
  end if;

  insert into cash_entries (holder_id, account_id, entry_type, amount, transfer_id, notes, created_by)
  values (v_uid, p_from, 'move_out', -abs(p_amount), v_tid, p_notes, v_uid);

  insert into cash_entries (holder_id, account_id, entry_type, amount, transfer_id, notes, created_by)
  values (v_uid, p_to, 'move_in', abs(p_amount), v_tid, p_notes, v_uid);
end;
$$;

revoke all on function pindah_kas(uuid, uuid, numeric, text) from public;
grant execute on function pindah_kas(uuid, uuid, numeric, text) to authenticated;

-- ---------------------------------------------------------
-- (6) Laporan kas — ikut membawa kantong, outlet SUNGGUHAN, dan kategori.
--
-- Outlet kini kolom SUNGGUHAN pada barisnya (peruntukan), bukan lagi diturunkan
-- dari tempat kerja utama (★) pemegangnya seperti di 0060. Turunan ★ itu
-- pendekatan darurat karena dulu tidak ada kolomnya; sekarang datanya ada, dan
-- jawabannya jadi tepat alih-alih diperkirakan.
-- ---------------------------------------------------------
drop function if exists laporan_kas_user(date, date, uuid, uuid);
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
    and (p_user is null or ce.holder_id = p_user)
    and (p_outlet is null or ce.outlet_id = p_outlet)
    and (p_category is null or ce.category_id = p_category)
    and (
      is_super_admin(auth.uid())
      or ce.holder_id = auth.uid()
      or (ce.outlet_id is not null and is_admin_of_outlet(auth.uid(), ce.outlet_id))
      -- Kas MASUK tidak punya outlet peruntukan. Tanpa cabang ini, admin BU
      -- melihat pengeluaran anak buahnya tapi tidak pemasukannya — laporan yang
      -- separuhnya hilang tanpa pesan apa pun, dan angkanya tetap terlihat wajar.
      or exists (
        select 1
        from membership_scopes ms
        where ms.user_id = ce.holder_id
          and ms.business_unit_id is not null
          and is_bu_admin(auth.uid(), ms.business_unit_id)
      )
    )
  order by up.full_name, ce.entry_date, ce.created_at;
$$;

revoke all on function laporan_kas_user(date, date, uuid, uuid, uuid) from public;
grant execute on function laporan_kas_user(date, date, uuid, uuid, uuid) to authenticated;

comment on function laporan_kas_user(date, date, uuid, uuid, uuid) is
  'Laporan kas. Outlet = PERUNTUKAN pada barisnya sendiri (sejak 0063), bukan lagi turunan dari tempat kerja utama pemegangnya.';
