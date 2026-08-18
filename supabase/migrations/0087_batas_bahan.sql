-- =========================================================
-- 0087 — Batas "bahan menipis"
--
-- Menyimpan DUA hal saja, dan sengaja tidak lebih:
--
--   1. `outlets.safety_days` — berapa hari stok harus cukup di outlet itu.
--   2. `product_min_stock`   — batas MANUAL per bahan per outlet, yang
--                              menimpa hitungan otomatis.
--
-- ============ KENAPA PERHITUNGANNYA TIDAK ADA DI SINI ============
--
-- Menghitung "bahan menipis" menuntut MEMBENTANGKAN RESEP secara rekursif:
-- menu → setengah jadi → bahan baku. Logika itu SUDAH ADA dan sudah teruji di
-- `js/modules/product/hpp.js` (dipakai menghitung HPP), lengkap dengan penjaga
-- siklus dan penanganan varian Standalone vs Dilayani CK.
--
-- Menulis ulang pembentangan yang sama dalam SQL berarti dua sumber kebenaran
-- untuk pertanyaan yang sama. Keduanya akan menyimpang — dan yang menyimpang
-- lebih dulu hampir pasti bukan yang dipakai menghitung HPP, melainkan yang
-- ini, karena ia lebih jarang diperiksa. Akibatnya: daftar belanja yang salah
-- tanpa ada yang tahu, karena angkanya tetap masuk akal.
--
-- Jadi migration ini hanya menyimpan PENGATURAN. Hitungannya di
-- `js/modules/inventory/bahan-menipis.js`, memakai pembentangan yang sama.
--
-- ============ KENAPA `safety_days` DI TABEL OUTLETS ============
--
-- Bukan per BU: Gading Serpong yang ramai dan Sentul yang sepi tidak masuk
-- akal memakai angka yang sama, dan pengiriman ke keduanya tidak sesering
-- satu sama lain. Angka ini menjawab "berapa lama sampai kiriman berikutnya",
-- dan itu sifat outlet.
-- =========================================================

-- ---------------------------------------------------------
-- 1. Hari aman per outlet.
--
-- Default 7 = seminggu. Bukan angka ajaib; ia cuma titik mulai yang tidak
-- membuat seluruh daftar langsung merah atau langsung hijau di hari pertama.
-- `not null` supaya tidak perlu ada cabang "kalau belum diatur" di UI —
-- cabang seperti itu adalah tempat paling sering munculnya batas 0 yang
-- membuat semua bahan terlihat aman.
-- ---------------------------------------------------------
alter table outlets add column if not exists safety_days integer not null default 7;

alter table outlets drop constraint if exists outlets_safety_days_wajar;
alter table outlets add constraint outlets_safety_days_wajar
  check (safety_days between 1 and 90);

comment on column outlets.safety_days is
  'Berapa hari stok harus cukup di outlet ini. Batas otomatis = pemakaian/hari x safety_days.';

-- ---------------------------------------------------------
-- 2. Batas manual per bahan per outlet.
--
-- PER OUTLET, bukan per produk saja: stoknya per outlet, raknya per outlet,
-- dan gula 20 kg yang wajar untuk Central Kitchen tidak wajar untuk gerai
-- kecil. Batas per-produk-saja akan memaksa memakai angka outlet terbesar,
-- dan itu membuat outlet kecil selamanya terlihat menipis.
--
-- `min_qty = 0` BERBEDA dari "tidak ada baris":
--   - tidak ada baris  -> pakai hitungan otomatis
--   - 0                -> sengaja dinyatakan "tidak perlu diawasi"
-- Kalau keduanya disamakan, satu-satunya cara mematikan peringatan untuk
-- bahan tertentu adalah menghapus barisnya, dan niat itu jadi tidak tercatat.
-- ---------------------------------------------------------
create table if not exists product_min_stock (
  outlet_id uuid not null references outlets(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  min_qty numeric not null check (min_qty >= 0),
  notes text,
  updated_by uuid references user_profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (outlet_id, product_id)
);
create index if not exists idx_pms_outlet on product_min_stock(outlet_id);

alter table product_min_stock enable row level security;

-- Semua yang boleh melihat outletnya boleh membaca batasnya: staff perlu tahu
-- kenapa sebuah bahan ditandai menipis, dan angka yang tidak bisa dilihat
-- hanya menghasilkan pertanyaan yang tidak bisa dijawab di lapangan.
create policy pms_select on product_min_stock
  for select using (has_outlet_scope(auth.uid(), outlet_id));

-- Yang MENGUBAH batas hanya admin. `is_bu_admin()` dipakai APA ADANYA —
-- fungsinya tidak disentuh sama sekali. Ia dipakai puluhan policy lain, dan
-- mengubah isinya demi keperluan modul ini akan diam-diam menggeser wewenang
-- di kas, presensi, reservasi, dan produk sekaligus.
create policy pms_modify on product_min_stock
  for all using (
    exists (select 1 from outlets o where o.id = product_min_stock.outlet_id and is_bu_admin(auth.uid(), o.business_unit_id))
  )
  with check (
    exists (select 1 from outlets o where o.id = product_min_stock.outlet_id and is_bu_admin(auth.uid(), o.business_unit_id))
  );

-- ---------------------------------------------------------
-- 3. Mengubah hari aman outlet.
--
-- Lewat RPC, bukan UPDATE langsung ke `outlets`: kolom lain di tabel itu
-- (nama, geofence, outlet_role) tidak boleh ikut tersentuh hanya karena
-- seseorang mengatur ambang stok.
-- ---------------------------------------------------------
create or replace function set_safety_days(p_outlet uuid, p_days integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bu uuid;
begin
  select business_unit_id into v_bu from outlets where id = p_outlet;
  if v_bu is null then raise exception 'Outlet tidak dikenal.'; end if;

  if not is_bu_admin(auth.uid(), v_bu) then
    raise exception 'Hanya Admin BU atau Super Admin yang bisa mengatur hari aman stok.';
  end if;

  -- Diperiksa di sini JUGA, bukan hanya mengandalkan constraint tabelnya:
  -- pesan constraint berbunyi "violates check constraint
  -- outlets_safety_days_wajar", yang tidak berarti apa-apa bagi yang membaca.
  if p_days is null or p_days < 1 or p_days > 90 then
    raise exception 'Hari aman harus antara 1 dan 90 hari.';
  end if;

  update outlets set safety_days = p_days where id = p_outlet;
end $$;

revoke all on function set_safety_days(uuid, integer) from public;
grant execute on function set_safety_days(uuid, integer) to authenticated;

notify pgrst, 'reload schema';
