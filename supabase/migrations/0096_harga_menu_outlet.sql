-- =========================================================
-- Berjaya Hub OMS — 0096
-- HARGA JUAL PINDAH KE OUTLET.
--
-- =========================================================
-- MASALAHNYA
-- =========================================================
--
-- `products.sale_price` adalah kolom milik BU. `record_sales()` membacanya saat
-- mencatat penjualan, jadi dua outlet yang menjual menu yang sama SELALU
-- tercatat dengan harga yang sama — dan tidak ada jalan untuk membedakannya.
--
-- Yang sudah benar dan tidak diubah: `sales.unit_price` memang dibekukan saat
-- transaksi dicatat, bukan dibaca ulang dari master. Jejak harga historis aman.
-- Yang salah bukan cara menyimpannya, melainkan dari mana angkanya datang.
--
-- =========================================================
-- KENAPA `effective_to` DISIMPAN, BUKAN HANYA `effective_from`
-- =========================================================
--
-- Mencari "harga yang berlaku pada tanggal X" dengan hanya `effective_from`
-- menuntut `max(effective_from) <= X` di setiap pembacaan. Rumus itu mudah
-- ditulis sedikit berbeda di dua tempat, dan bedanya baru terlihat saat ada
-- perubahan harga — yaitu saat paling sulit dilacak.
--
-- Dengan `effective_to`, syaratnya satu baris dan sama di mana-mana. Dan ia
-- diisi otomatis oleh trigger, bukan oleh yang mengetik.
--
-- =========================================================
-- KENAPA TRIGGER, BUKAN `exclude using gist`
-- =========================================================
--
-- Exclusion constraint dengan `daterange && ` adalah cara paling rapi mencegah
-- dua harga aktif bersamaan. Ia butuh extension `btree_gist`.
--
-- Saya menguji migration ini di PGlite (Postgres sungguhan yang dikompilasi ke
-- WASM), dan `btree_gist` TIDAK tersedia di sana. Artinya: memakai exclusion
-- constraint berarti seluruh pengujian tumpang-tindih tidak bisa dijalankan
-- sama sekali sebelum diserahkan.
--
-- Trigger lebih lemah di atas kertas tapi BISA DIUJI, dan penjagaan yang teruji
-- lebih berharga daripada penjagaan yang lebih elegan tapi tidak pernah
-- dijalankan sekali pun sebelum masuk produksi.
--
-- BATAS YANG DIAKUI: trigger punya celah balapan — dua penyisipan bersamaan
-- untuk (outlet, produk) yang sama bisa sama-sama lolos pemeriksaan. Ditutup
-- dengan `pg_advisory_xact_lock` atas pasangan (outlet, produk), yang membuat
-- keduanya berbaris. Bukan sekuat exclusion constraint, tapi cukup untuk
-- penggunaan nyata di sini: yang mengubah harga adalah admin, satu per satu.
-- =========================================================

create table if not exists outlet_menu_prices (
  id                 uuid primary key default gen_random_uuid(),
  business_unit_id   uuid not null references business_units(id) on delete cascade,
  outlet_id          uuid not null references outlets(id) on delete cascade,
  product_id         uuid not null references products(id) on delete cascade,

  selling_price      numeric not null,

  -- Biaya & potongan yang melekat pada penjualan DI OUTLET INI. Kolom yang sama
  -- ada di `products` (0093) dan tetap dipertahankan sebagai acuan; yang dipakai
  -- menghitung profitabilitas outlet adalah yang di sini.
  packaging_cost     numeric not null default 0,
  fee_online_percent numeric not null default 0,
  promo_percent      numeric not null default 0,

  effective_from     date not null,
  effective_to       date,                       -- null = masih berlaku
  is_available       boolean not null default true,

  notes              text,
  created_by         uuid references user_profiles(id) on delete set null,
  created_at         timestamptz not null default now()
);

create index if not exists idx_omp_cari on outlet_menu_prices(outlet_id, product_id, effective_from desc);
create index if not exists idx_omp_bu on outlet_menu_prices(business_unit_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'omp_harga_wajar') then
    alter table outlet_menu_prices add constraint omp_harga_wajar check (
      selling_price >= 0
      and packaging_cost >= 0
      -- Batas < 100 dua-duanya: potongan 100% berarti seluruh uangnya hilang,
      -- dan rumus harga online membaginya sehingga 100 akan membagi nol.
      and fee_online_percent >= 0 and fee_online_percent < 100
      and promo_percent >= 0 and promo_percent < 100
    );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'omp_rentang_sah') then
    alter table outlet_menu_prices add constraint omp_rentang_sah check (
      effective_to is null or effective_to >= effective_from
    );
  end if;
end $$;

comment on table outlet_menu_prices is
  'Harga jual per OUTLET per produk, ber-effective-dating. Sumber kebenaran harga saat transaksi dicatat. products.sale_price hanya acuan/nilai awal.';
comment on column outlet_menu_prices.effective_to is
  'null = masih berlaku. Diisi OTOMATIS oleh trigger saat harga baru masuk — jangan diisi tangan.';

-- ---------------------------------------------------------
-- TRIGGER: cocokkan BU, tutup harga lama, tolak tumpang tindih.
-- ---------------------------------------------------------
create or replace function omp_jaga_rentang()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bu uuid;
  v_bentrok int;
begin
  -- (1) Outlet harus benar-benar milik BU yang disebut.
  --
  -- Tanpa ini, satu baris bisa menyebut BU A dan outlet milik BU B — dan
  -- harganya lalu terbaca di BU yang salah, sementara policy-nya tetap lolos
  -- karena policy hanya melihat kolom BU.
  select business_unit_id into v_bu from outlets where id = new.outlet_id;
  if v_bu is null then
    raise exception 'Outlet tidak ditemukan';
  end if;
  if v_bu <> new.business_unit_id then
    raise exception 'Outlet ini bukan milik Business Unit yang disebut';
  end if;

  -- (2) Rentang tanggalnya diperiksa DI SINI, sebelum `daterange` dibangun.
  --
  -- Constraint `omp_rentang_sah` sudah menjaga hal yang sama, tapi CHECK baru
  -- dijalankan SESUDAH trigger. Jadi `effective_to < effective_from` akan lebih
  -- dulu ditolak oleh pembangunan `daterange` di bawah, dengan pesan internal
  -- Postgres: "range lower bound must be less than or equal to range upper
  -- bound". Benar, tapi tidak ada yang bisa menindaklanjutinya dari layar.
  --
  -- Ditemukan saat menguji migration ini di Postgres sungguhan.
  if new.effective_to is not null and new.effective_to < new.effective_from then
    raise exception 'Tanggal berakhir (%) lebih awal daripada tanggal mulai (%)', new.effective_to, new.effective_from;
  end if;

  -- (3) Serialkan per (outlet, produk). Lihat catatan celah balapan di header.
  perform pg_advisory_xact_lock(hashtextextended(new.outlet_id::text || '|' || new.product_id::text, 0));

  -- (4) HANYA saat menyisipkan: tutup harga yang masih terbuka dan mulai lebih
  -- awal. Inilah yang membuat "menaikkan harga" tidak pernah menimpa baris lama
  -- — histori harga bertambah, tidak tergantikan.
  --
  -- Tidak dilakukan saat UPDATE, karena menyunting satu baris tidak boleh
  -- diam-diam menutup baris lain.
  if tg_op = 'INSERT' then
    update outlet_menu_prices
       set effective_to = new.effective_from - 1
     where outlet_id = new.outlet_id
       and product_id = new.product_id
       and effective_to is null
       and effective_from < new.effective_from;
  end if;

  -- (5) Sesudah penutupan di atas, tidak boleh ada lagi yang bertumpang tindih.
  select count(*) into v_bentrok
    from outlet_menu_prices p
   where p.outlet_id = new.outlet_id
     and p.product_id = new.product_id
     and p.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
     and daterange(p.effective_from, p.effective_to, '[]')
         && daterange(new.effective_from, new.effective_to, '[]');

  if v_bentrok > 0 then
    raise exception 'Sudah ada harga aktif untuk menu ini di outlet ini pada rentang tanggal tersebut';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_omp_jaga_rentang on outlet_menu_prices;
create trigger trg_omp_jaga_rentang
  before insert or update on outlet_menu_prices
  for each row execute function omp_jaga_rentang();

-- ---------------------------------------------------------
-- SATU-SATUNYA PINTU PEMBACAAN HARGA.
--
-- `record_sales()`, layar Staff App, layar Admin, dan laporan semuanya lewat
-- sini. Kalau masing-masing menulis `where`-nya sendiri, definisi "harga aktif"
-- akan bercabang — dan cabangnya baru terlihat berbeda saat ada perubahan
-- harga, yaitu saat paling sulit dilacak.
-- ---------------------------------------------------------
create or replace function harga_outlet_aktif(p_outlet uuid, p_product uuid, p_tanggal date)
returns outlet_menu_prices
language sql
stable
security definer
set search_path = public
as $$
  select *
    from outlet_menu_prices
   where outlet_id = p_outlet
     and product_id = p_product
     and is_available
     and effective_from <= p_tanggal
     and (effective_to is null or effective_to >= p_tanggal)
   order by effective_from desc
   limit 1;
$$;

revoke all on function harga_outlet_aktif(uuid, uuid, date) from public;
grant execute on function harga_outlet_aktif(uuid, uuid, date) to authenticated;

-- ---------------------------------------------------------
-- RLS
-- ---------------------------------------------------------
alter table outlet_menu_prices enable row level security;

-- Baca: siapa pun yang punya cakupan di BU-nya. Staff perlu MELIHAT harga di
-- layar penjualan, jadi ini sengaja tidak dibatasi ke admin.
drop policy if exists omp_select on outlet_menu_prices;
create policy omp_select on outlet_menu_prices
  for select to authenticated
  using (has_bu_scope(auth.uid(), business_unit_id));

-- Tulis: admin BU & super admin saja.
--
-- Sengaja BUKAN `has_bu_scope`. Harga jual adalah keputusan usaha, dan Staff App
-- tidak boleh jadi sumber kebenaran harga — kalau staff bisa mengubahnya, harga
-- transaksi berhenti bisa dipertanggungjawabkan.
drop policy if exists omp_modify on outlet_menu_prices;
create policy omp_modify on outlet_menu_prices
  for all to authenticated
  using (is_bu_admin(auth.uid(), business_unit_id))
  with check (is_bu_admin(auth.uid(), business_unit_id));

-- ---------------------------------------------------------
-- `products.sale_price` TIDAK dihapus — statusnya berubah.
-- ---------------------------------------------------------
comment on column products.sale_price is
  'ACUAN SAJA sejak 0096. Nilai awal saat harga outlet dibuat, dan tampilan di Master Produk. BUKAN sumber harga transaksi — record_sales() membaca outlet_menu_prices, tanpa fallback ke kolom ini.';

notify pgrst, 'reload schema';
