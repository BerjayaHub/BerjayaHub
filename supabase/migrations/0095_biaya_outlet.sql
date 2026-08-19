-- =========================================================
-- Berjaya Hub OMS — 0095
-- BIAYA TETAP & VARIABEL YANG DIDAFTARKAN, MENEMPEL DI OUTLET.
--
-- =========================================================
-- KENAPA TABEL BARU, PADAHAL SUDAH ADA BUKU KAS
-- =========================================================
--
-- 0093 menambahkan `cash_categories.is_fixed_cost` supaya biaya tetap bisa
-- dipisahkan dari buku kas. Itu menjawab pertanyaan "bulan lalu keluar berapa".
--
-- Yang dibutuhkan halaman BEP pertanyaannya lain: "berapa yang HARUS ditutup
-- tiap bulan". Dua-duanya perlu, dan keduanya tidak bisa saling menggantikan:
--
--   - Buku kas hanya berisi yang SUDAH dibayar. Sewa yang jatuh tempo tanggal
--     28 belum ada di kas pada tanggal 5, jadi BEP yang dihitung dari kas akan
--     terlihat sangat rendah di awal bulan lalu melonjak di akhir — tanpa ada
--     yang berubah di dunia nyata.
--   - Kas juga tidak tahu mana yang berulang. Perbaikan mesin sekali setahun
--     dan sewa bulanan sama-sama "uang keluar".
--
-- Jadi tabel ini menyimpan DAFTAR biaya yang direncanakan, bukan catatan
-- pembayaran. Halaman BEP memakai daftar ini; halaman Kas tetap memakai buku
-- kas. Mana yang dipakai ditampilkan di layarnya, supaya tidak ada dua angka
-- yang bertengkar diam-diam.
--
-- =========================================================
-- BIAYA VARIABEL TIDAK BOLEH BERSATUAN "PER BULAN"
-- =========================================================
--
-- Ini yang paling mudah salah, dan salahnya tidak akan terlihat.
--
-- Dalam rumus BEP, biaya variabel masuk sebagai pengurang MARGIN PER PORSI —
-- bukan sebagai penambah biaya tetap. Kalau "listrik 3 juta/bulan" didaftarkan
-- sebagai variabel, secara matematis ia harus jadi biaya TETAP, dan
-- memasukkannya ke tempat yang salah akan menggeser titik impas ke arah yang
-- menyenangkan tanpa satu pun tanda.
--
-- Maka satuannya dibatasi CHECK constraint:
--
--   tetap    -> per_bulan saja
--   variabel -> per_porsi atau persen_omzet saja
--
-- Kalau sebuah biaya memang bulanan, ia biaya tetap. Titik.
-- =========================================================

create table if not exists outlet_costs (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references business_units(id) on delete cascade,
  outlet_id uuid not null references outlets(id) on delete cascade,

  name text not null,
  jenis text not null check (jenis in ('tetap', 'variabel')),
  satuan text not null check (satuan in ('per_bulan', 'per_porsi', 'persen_omzet')),
  amount numeric not null,

  notes text,
  is_active boolean not null default true,

  created_by uuid references user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_outlet_costs_outlet on outlet_costs(outlet_id) where is_active;
create index if not exists idx_outlet_costs_bu on outlet_costs(business_unit_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'outlet_costs_nama_isi') then
    alter table outlet_costs add constraint outlet_costs_nama_isi check (length(btrim(name)) > 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'outlet_costs_jumlah_wajar') then
    alter table outlet_costs add constraint outlet_costs_jumlah_wajar check (amount >= 0);
  end if;

  -- Satuan harus cocok dengan jenisnya. Lihat penjelasan panjang di header:
  -- biaya variabel bersatuan bulanan adalah biaya tetap yang salah kamar, dan
  -- salah kamarnya menggeser titik impas tanpa terlihat.
  if not exists (select 1 from pg_constraint where conname = 'outlet_costs_satuan_cocok') then
    alter table outlet_costs add constraint outlet_costs_satuan_cocok check (
      (jenis = 'tetap' and satuan = 'per_bulan')
      or (jenis = 'variabel' and satuan in ('per_porsi', 'persen_omzet'))
    );
  end if;

  -- Persentase di atas 100 berarti tiap penjualan justru mengurangi uang lebih
  -- banyak daripada yang masuk. Itu mungkin saja disengaja sebagai simulasi,
  -- tapi 1000% hampir pasti salah ketik.
  if not exists (select 1 from pg_constraint where conname = 'outlet_costs_persen_wajar') then
    alter table outlet_costs add constraint outlet_costs_persen_wajar check (
      satuan <> 'persen_omzet' or amount <= 100
    );
  end if;
end $$;

comment on table outlet_costs is
  'Daftar biaya yang DIRENCANAKAN per outlet — dipakai penyebut BEP. Bukan catatan pembayaran; yang sudah dibayar ada di cash_entries.';
comment on column outlet_costs.satuan is
  'tetap selalu per_bulan. variabel: per_porsi (Rp tiap porsi) atau persen_omzet (% dari harga jual). Dijaga constraint outlet_costs_satuan_cocok.';

alter table outlet_costs enable row level security;

-- Baca: siapa pun yang punya cakupan di BU-nya (termasuk super admin lewat
-- cabang has_bu_scope sendiri).
drop policy if exists outlet_costs_select on outlet_costs;
create policy outlet_costs_select on outlet_costs
  for select to authenticated
  using (has_bu_scope(auth.uid(), business_unit_id));

-- Tulis: admin BU & super admin. SENGAJA bukan `has_bu_scope`: angka ini
-- menentukan titik impas yang dipakai mengambil keputusan, dan staff outlet
-- tidak perlu bisa mengubahnya.
drop policy if exists outlet_costs_modify on outlet_costs;
create policy outlet_costs_modify on outlet_costs
  for all to authenticated
  using (is_bu_admin(auth.uid(), business_unit_id))
  with check (is_bu_admin(auth.uid(), business_unit_id));

-- Outlet-nya harus benar-benar milik BU yang disebut. Tanpa penjaga ini, satu
-- baris bisa menyebut BU A dan outlet milik BU B — dan biayanya lalu terhitung
-- di BEP yang salah, sementara policy-nya tetap lolos karena hanya melihat
-- kolom BU.
create or replace function outlet_costs_cocokkan_bu()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bu uuid;
begin
  select business_unit_id into v_bu from outlets where id = new.outlet_id;
  if v_bu is null then
    raise exception 'Outlet tidak ditemukan';
  end if;
  if v_bu <> new.business_unit_id then
    raise exception 'Outlet ini bukan milik Business Unit yang disebut';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_outlet_costs_cocokkan_bu on outlet_costs;
create trigger trg_outlet_costs_cocokkan_bu
  before insert or update on outlet_costs
  for each row execute function outlet_costs_cocokkan_bu();

notify pgrst, 'reload schema';
