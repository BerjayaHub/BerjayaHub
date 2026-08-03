-- =========================================================
-- Berjaya Hub OMS — 0060
-- Kas: jumlah + satuan, foto nota wajib, dan RPC laporan kas per user.
-- =========================================================

-- ---------------------------------------------------------
-- (1) Jumlah & satuan. Contoh: Bensin — 10 liter — Rp 150.000
-- ---------------------------------------------------------
alter table cash_entries add column if not exists qty numeric;
alter table cash_entries add column if not exists unit text;

comment on column cash_entries.qty is 'Kuantitas barang/jasa (mis. 10). Opsional untuk transfer.';
comment on column cash_entries.unit is 'Satuan (mis. liter, pcs, kg). Bebas diketik.';

-- ---------------------------------------------------------
-- (2) Foto nota WAJIB untuk transaksi (masuk/keluar).
--
-- `not valid`: aturan ini hanya berlaku untuk baris BARU. Entri lama yang
-- terlanjur tanpa nota TIDAK diutak-atik — memvalidasi mundur berarti migration
-- gagal total hanya karena data historis, dan riwayat kas justru yang paling
-- tidak boleh diubah belakangan.
--
-- Transfer DIKECUALIKAN: uang berpindah antar pemegang kas, tidak ada nota
-- yang bisa difoto. Memaksakannya berarti transfer jadi mustahil dilakukan.
-- ---------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cash_entries_nota_wajib') then
    alter table cash_entries add constraint cash_entries_nota_wajib
      check (entry_type in ('transfer_in', 'transfer_out') or proof_path is not null)
      not valid;
  end if;
end $$;

-- ---------------------------------------------------------
-- (3) Laporan kas per user.
--
-- KENAPA LEWAT RPC:
--   a) Sejak 0040 kas mengikuti USER — `cash_entries.business_unit_id` dan
--      `outlet_id` tidak lagi diisi. Jadi filter "outlet" TIDAK bisa membaca
--      kolom di baris kasnya; outlet harus diturunkan dari TEMPAT KERJA UTAMA
--      (★) si pemegang kas. Kalau tidak, filter outlet akan selalu kosong dan
--      terlihat seperti tidak ada datanya.
--   b) RLS `cash_entries` hanya membuka baris milik sendiri + super admin.
--      Laporan butuh melihat lintas orang, dan itu dibuka di sini secara
--      terkendali, bukan dengan melonggarkan policy tabelnya.
--
-- Cakupan pemanggil: super admin (semua), atau admin BU/outlet (pemegang kas
-- yang punya scope di BU/outlet yang dia adminkan). Staff biasa: kosong.
-- ---------------------------------------------------------
create or replace function laporan_kas_user(
  p_from date,
  p_to date,
  p_user uuid default null,
  p_outlet uuid default null
)
returns table (
  entry_date date,
  holder_id uuid,
  holder_name text,
  outlet_id uuid,
  outlet_name text,
  entry_type text,
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
  with basis as (
    -- Tempat kerja utama (★) tiap orang. `distinct on` + urutan eksplisit:
    -- yang bertanda primary didahulukan, sisanya sekadar cadangan supaya orang
    -- tanpa ★ tetap punya outlet acuan alih-alih hilang dari laporan.
    select distinct on (ms.user_id)
      ms.user_id,
      ms.outlet_id,
      ms.business_unit_id
    from membership_scopes ms
    order by ms.user_id, (case when ms.is_primary then 0 else 1 end), ms.created_at
  )
  select
    ce.entry_date,
    ce.holder_id,
    up.full_name,
    b.outlet_id,
    o.name,
    ce.entry_type,
    cc.name,
    ce.notes,
    ce.qty,
    ce.unit,
    ce.amount,
    cp.full_name,
    ce.proof_path
  from cash_entries ce
  join user_profiles up on up.id = ce.holder_id
  left join basis b on b.user_id = ce.holder_id
  left join outlets o on o.id = b.outlet_id
  left join cash_categories cc on cc.id = ce.category_id
  left join user_profiles cp on cp.id = ce.counterpart_id
  where ce.entry_date between p_from and p_to
    and (p_user is null or ce.holder_id = p_user)
    and (p_outlet is null or b.outlet_id = p_outlet)
    and (
      is_super_admin(auth.uid())
      or (b.business_unit_id is not null and is_bu_admin(auth.uid(), b.business_unit_id))
      or (b.outlet_id is not null and is_admin_of_outlet(auth.uid(), b.outlet_id))
    )
  order by up.full_name, ce.entry_date, ce.created_at;
$$;

revoke all on function laporan_kas_user(date, date, uuid, uuid) from public;
grant execute on function laporan_kas_user(date, date, uuid, uuid) to authenticated;

comment on function laporan_kas_user(date, date, uuid, uuid) is
  'Laporan kas per pemegang. Outlet DITURUNKAN dari tempat kerja utama (★) pemegangnya, karena sejak 0040 baris kas sendiri tidak menyimpan outlet.';
