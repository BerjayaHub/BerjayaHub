-- =========================================================
-- Berjaya Hub OMS — 0115
-- Menu bisa dibatasi ke outlet tertentu. TANPA pengaturan = aktif di semua.
--
-- =========================================================
-- YANG DIMINTA
-- =========================================================
--
--   "di menu apakah bisa dipilih menu ini aktif di outlet mana saja, tetapi
--    defaultnya aktif di semua outlet ... karena ada outlet yang tidak jual
--    menu A dan outlet lain jual, agar staff tidak bingung"
--
-- Staff App layar Penjualan menampilkan SELURUH 162 menu milik BU, apa pun
-- outletnya. Staff outlet yang tidak menjual sebagian besar di antaranya harus
-- menyaringnya sendiri dengan ingatan, tiap hari.
--
-- =========================================================
-- BENTUK PENYIMPANANNYA: DAFTAR IZIN, BUKAN DAFTAR LARANGAN
-- =========================================================
--
-- Tabel ini menyimpan "menu M dijual di outlet O". Menu yang TIDAK punya satu
-- baris pun berarti aktif di SEMUA outlet.
--
-- Kenapa begitu, bukan daftar larangan:
--
--   1. 162 menu yang sudah ada langsung berperilaku persis seperti sebelumnya
--      tanpa satu baris pun ditulis. Backfill untuk data yang sudah dipakai
--      produksi adalah tempat kesalahan diam-diam paling sering lahir.
--   2. Menu BARU otomatis muncul di semua outlet. Dengan daftar larangan,
--      menu baru justru harus didaftarkan satu per satu ke tiap outlet, dan
--      yang terlupa akan hilang dari layar tanpa ada yang tahu sebabnya.
--   3. Outlet BARU otomatis mendapat seluruh menu yang tidak dibatasi. Dengan
--      daftar larangan, outlet baru mewarisi larangan yang tidak pernah
--      ditujukan kepadanya.
--
-- =========================================================
-- JEBAKAN YANG DIBAWA BENTUK INI, DAN DI MANA DIJAGA
-- =========================================================
--
-- "Kosong berarti semua" punya satu sisi tajam: MENCABUT CENTANG TERAKHIR
-- membalik artinya dari "hanya AB Sentul" menjadi "semua outlet" — kebalikan
-- persis dari yang dimaksud orang yang baru saja mencabutnya.
--
-- Penjagaannya ADA DI LAYAR, bukan di sini, dan itu disengaja: di tingkat data,
-- "tidak ada baris" memang harus berarti "tidak dibatasi", kalau tidak poin (1)
-- sampai (3) di atas runtuh. Layarnya yang menyatakan maksud secara eksplisit
-- ("Semua outlet" vs "Hanya outlet terpilih"), dan menolak menyimpan "hanya
-- outlet terpilih" dengan nol outlet. Lihat `menu-outlet.js` dan
-- `audit-menu-outlet.cjs`.
--
-- =========================================================
-- RIWAYAT PENJUALAN TIDAK IKUT TERPENGARUH
-- =========================================================
--
-- Tabel ini HANYA menyaring pilihan di layar. Ia tidak disentuh oleh
-- `record_sales`, tidak masuk ke `sales`, dan tidak ada satu pun laporan yang
-- membacanya. Menonaktifkan menu di sebuah outlet hari ini tidak mengubah satu
-- angka pun pada penjualan yang sudah tercatat di sana — dan itu memang harus
-- begitu: pengaturan tampilan tidak boleh bisa menulis ulang sejarah.
-- =========================================================

create table if not exists menu_outlet_aktif (
  id                uuid primary key default gen_random_uuid(),
  business_unit_id  uuid not null references business_units(id) on delete cascade,
  product_id        uuid not null references products(id) on delete cascade,
  outlet_id         uuid not null references outlets(id) on delete cascade,
  created_by        uuid references user_profiles(id) on delete set null,
  created_at        timestamptz not null default now()
);

-- Satu pasangan menu-outlet hanya boleh ada sekali. Tanpa ini, penyimpanan yang
-- terkirim dua kali (jaringan lambat lalu tombol ditekan lagi) menghasilkan
-- baris kembar yang tidak mengubah arti apa pun tapi membuat tiap hitungan
-- "aktif di berapa outlet" salah.
create unique index if not exists menu_outlet_aktif_unik
  on menu_outlet_aktif (product_id, outlet_id);

create index if not exists idx_moa_outlet on menu_outlet_aktif (outlet_id);
create index if not exists idx_moa_bu on menu_outlet_aktif (business_unit_id);

comment on table menu_outlet_aktif is
  'Daftar IZIN: menu M dijual di outlet O. Menu tanpa satu baris pun aktif di SEMUA outlet. Hanya menyaring tampilan; tidak pernah menyentuh penjualan yang sudah tercatat.';

-- ---------------------------------------------------------
-- BACA: menu yang aktif di satu outlet.
--
-- SATU-SATUNYA definisi "menu aktif di outlet ini". Staff App Penjualan, modul
-- Menu, dan layar admin semuanya lewat sini. Kalau masing-masing menulis
-- `where`-nya sendiri, definisinya akan bercabang — dan cabangnya baru terlihat
-- berbeda pada menu yang dibatasi, yaitu justru kasus yang jarang dilihat saat
-- menguji.
-- ---------------------------------------------------------
create or replace function menu_aktif_outlet(p_outlet uuid)
returns table (product_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select p.id
    from products p
   where p.product_type = 'finished'
     and coalesce(p.is_active, true)
     and p.business_unit_id = (select business_unit_id from outlets where id = p_outlet)
     and (
       -- Tidak dibatasi sama sekali -> aktif di mana pun.
       not exists (select 1 from menu_outlet_aktif m where m.product_id = p.id)
       -- Dibatasi, dan outlet ini termasuk.
       or exists (
         select 1 from menu_outlet_aktif m
          where m.product_id = p.id and m.outlet_id = p_outlet
       )
     );
$$;

revoke all on function menu_aktif_outlet(uuid) from public;
grant execute on function menu_aktif_outlet(uuid) to authenticated;

comment on function menu_aktif_outlet(uuid) is
  'Menu yang boleh dijual di satu outlet. Menu tanpa pembatasan ikut terhitung aktif.';

-- ---------------------------------------------------------
-- TULIS: ganti seluruh daftar outlet untuk satu menu, dalam satu langkah.
--
-- SENGAJA "GANTI SEMUANYA", BUKAN "TAMBAH SATU / HAPUS SATU".
--
-- Layarnya menampilkan sekumpulan kotak centang dan satu tombol Simpan. Kalau
-- server menerima perubahan per baris, keadaan yang tersimpan bisa berhenti di
-- tengah jalan saat jaringan putus — separuh centang tersimpan, separuh tidak,
-- dan hasilnya adalah pembatasan yang tidak pernah dimaksudkan siapa pun.
--
-- Dengan mengganti seluruhnya dalam satu transaksi, keadaan akhir selalu persis
-- seperti yang terlihat di layar saat Simpan ditekan.
-- ---------------------------------------------------------
create or replace function set_menu_outlet(p_product uuid, p_outlets uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bu uuid;
  v_uid uuid := auth.uid();
  v_o uuid;
begin
  select business_unit_id into v_bu from products where id = p_product;
  if v_bu is null then
    raise exception 'Menu tidak ditemukan.';
  end if;

  -- Hanya admin BU & super admin. `is_bu_admin` dipakai APA ADANYA (0001) —
  -- tidak diubah, hanya dirujuk.
  if not is_bu_admin(v_uid, v_bu) then
    raise exception 'Hanya admin yang boleh mengatur menu aktif per outlet.';
  end if;

  delete from menu_outlet_aktif where product_id = p_product;

  -- Array kosong / null -> tidak ada baris -> menu aktif di SEMUA outlet.
  -- Ini jalan yang sah dan dipakai tombol "Semua outlet" di layar.
  if p_outlets is null or array_length(p_outlets, 1) is null then
    return;
  end if;

  foreach v_o in array p_outlets loop
    -- Outlet dari BU LAIN ditolak, tidak diabaikan diam-diam. Menyimpannya
    -- akan membuat pembatasan yang tidak pernah bisa dipenuhi: menunya milik
    -- BU ini, outletnya bukan — sehingga menu itu lenyap dari SEMUA outlet BU
    -- ini sekaligus, dan penyebabnya tidak terlihat di layar mana pun.
    if not exists (select 1 from outlets where id = v_o and business_unit_id = v_bu) then
      raise exception 'Outlet % bukan milik BU menu ini.', v_o;
    end if;
    insert into menu_outlet_aktif (business_unit_id, product_id, outlet_id, created_by)
    values (v_bu, p_product, v_o, v_uid)
    on conflict (product_id, outlet_id) do nothing;
  end loop;
end;
$$;

revoke all on function set_menu_outlet(uuid, uuid[]) from public;
grant execute on function set_menu_outlet(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------
-- TULIS MASSAL: tetapkan daftar menu yang dijual di SATU outlet.
--
-- Arahnya kebalikan dari `set_menu_outlet`, dan itu bukan kemewahan: menyiapkan
-- 162 menu satu per satu berarti membuka 162 baris. Layar massalnya bekerja per
-- outlet, jadi RPC-nya pun harus per outlet.
--
-- YANG PALING MUDAH SALAH DI SINI: menu yang tidak dicentang TIDAK BOLEH
-- otomatis dilarang di mana-mana. Menu yang selama ini tidak dibatasi harus
-- TETAP tidak dibatasi kalau ia tidak dicentang — mencabut centang di layar
-- outlet A hanya berarti "tidak dijual di A", dan itu hanya bisa dinyatakan
-- dengan mendaftarkan outlet LAIN yang menjualnya.
-- ---------------------------------------------------------
create or replace function set_menu_outlet_massal(p_outlet uuid, p_menus uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bu uuid;
  v_uid uuid := auth.uid();
  v_p uuid;
  v_lain uuid[];
  v_buntu text[] := '{}';
begin
  select business_unit_id into v_bu from outlets where id = p_outlet;
  if v_bu is null then raise exception 'Outlet tidak ditemukan.'; end if;
  if not is_bu_admin(v_uid, v_bu) then
    raise exception 'Hanya admin yang boleh mengatur menu aktif per outlet.';
  end if;

  -- Outlet lain di BU ini — dipakai saat sebuah menu yang selama ini TIDAK
  -- dibatasi harus berhenti dijual di outlet ini.
  select coalesce(array_agg(id), '{}') into v_lain
    from outlets where business_unit_id = v_bu and id <> p_outlet;

  -- =========================================================
  -- PEMERIKSAAN LEBIH DULU, SEBELUM SATU BARIS PUN DIUBAH.
  --
  -- Ada satu keadaan yang TIDAK BISA dinyatakan model ini: "menu tidak dijual
  -- di mana pun". Tidak ada baris berarti "di semua outlet", jadi menu yang
  -- outlet terakhirnya dicabut tidak punya bentuk penyimpanan yang benar.
  --
  -- Percobaan pertama menanganinya dengan mendaftarkan menu itu ke seluruh
  -- outlet LAIN. Untuk menu yang sebelumnya tidak dibatasi itu benar — ia
  -- memang dijual di mana-mana, dan sekarang di mana-mana kecuali di sini.
  -- Tapi untuk menu yang HANYA dijual di outlet ini, hasilnya terbalik total:
  -- menu yang seharusnya berhenti dijual justru muncul di SELURUH outlet lain
  -- yang tidak pernah menjualnya. Tes §7 yang menemukannya.
  --
  -- Jadi keadaan itu DITOLAK, bukan ditebak. Menonaktifkan menu sepenuhnya
  -- adalah keputusan yang berbeda, dan tempatnya di Master Produk
  -- (`is_active`) — bukan efek samping diam-diam dari mencabut satu centang.
  --
  -- Ditolaknya SEBELUM ada yang berubah, dan menyebut SELURUH menu yang
  -- bermasalah sekaligus. Menggagalkan satu per satu memaksa admin menyimpan
  -- berkali-kali untuk menemukan daftar yang sama.
  -- =========================================================
  select coalesce(array_agg(p.name order by p.name), '{}') into v_buntu
    from products p
   where p.business_unit_id = v_bu
     and p.product_type = 'finished'
     and coalesce(p.is_active, true)
     and not (p.id = any(coalesce(p_menus, '{}'::uuid[])))
     and (
       -- Dibatasi, dan outlet ini satu-satunya yang tersisa.
       (exists (select 1 from menu_outlet_aktif m where m.product_id = p.id)
        and not exists (
          select 1 from menu_outlet_aktif m
           where m.product_id = p.id and m.outlet_id <> p_outlet
        ))
       -- Atau: belum dibatasi, tapi BU ini cuma punya satu outlet — sehingga
       -- "tidak dijual di sini" sama saja dengan tidak dijual di mana pun.
       or (not exists (select 1 from menu_outlet_aktif m where m.product_id = p.id)
           and array_length(v_lain, 1) is null)
     );

  if array_length(v_buntu, 1) is not null then
    raise exception
      'Menu ini hanya dijual di outlet ini: %. Mencabutnya berarti menu tidak dijual di mana pun, dan itu tidak bisa disimpan di sini — nonaktifkan menunya di Master Produk, atau centang dulu outlet lain yang menjualnya.',
      array_to_string(v_buntu, ', ');
  end if;

  for v_p in
    select id from products
     where business_unit_id = v_bu and product_type = 'finished' and coalesce(is_active, true)
  loop
    if v_p = any(coalesce(p_menus, '{}'::uuid[])) then
      -- DICENTANG: dijual di sini.
      --
      -- Kalau menunya belum dibatasi sama sekali, ia sudah aktif di sini —
      -- dan menambahkan satu baris justru akan MEMBATASINYA hanya ke outlet
      -- ini, mematikannya di semua outlet lain. Jadi dibiarkan.
      if exists (select 1 from menu_outlet_aktif where product_id = v_p) then
        insert into menu_outlet_aktif (business_unit_id, product_id, outlet_id, created_by)
        values (v_bu, v_p, p_outlet, v_uid)
        on conflict (product_id, outlet_id) do nothing;
      end if;
    else
      -- TIDAK DICENTANG: tidak dijual di sini.
      if exists (select 1 from menu_outlet_aktif where product_id = v_p) then
        -- Sudah dibatasi: cukup keluarkan outlet ini dari daftarnya. Pasti
        -- masih ada outlet lain yang tersisa — pemeriksaan di atas sudah
        -- menolak kasus sebaliknya.
        delete from menu_outlet_aktif where product_id = v_p and outlet_id = p_outlet;
      else
        -- Belum dibatasi sama sekali: didaftarkan ke SELURUH outlet LAIN,
        -- sehingga artinya "di mana pun kecuali outlet ini".
        insert into menu_outlet_aktif (business_unit_id, product_id, outlet_id, created_by)
        select v_bu, v_p, o, v_uid from unnest(v_lain) o
        on conflict (product_id, outlet_id) do nothing;
      end if;
    end if;
  end loop;
end;
$$;

revoke all on function set_menu_outlet_massal(uuid, uuid[]) from public;
grant execute on function set_menu_outlet_massal(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------
-- RLS
-- ---------------------------------------------------------
alter table menu_outlet_aktif enable row level security;

-- Baca: siapa pun yang punya cakupan di BU-nya. Staff App HARUS bisa
-- membacanya untuk menyaring layar penjualannya sendiri.
drop policy if exists moa_select on menu_outlet_aktif;
create policy moa_select on menu_outlet_aktif
  for select to authenticated
  using (has_bu_scope(auth.uid(), business_unit_id));

-- Tulis: TIDAK ADA kebijakan insert/update/delete untuk peran biasa.
--
-- Seluruh penulisan lewat RPC `security definer` di atas, yang memeriksa
-- `is_bu_admin` sendiri. Ini bukan pengulangan yang mubazir: tanpa kebijakan
-- tulis, staff yang memanggil PostgREST langsung ke tabelnya tidak bisa
-- mengubah apa pun, sekalipun ia tahu nama tabelnya.
--
-- Perlu diingat PostgREST TIDAK menganggap penolakan RLS sebagai error pada
-- UPDATE/DELETE — ia mengembalikan sukses dengan nol baris. Itulah kenapa
-- jalannya lewat RPC yang melempar exception, bukan lewat tabel langsung.

notify pgrst, 'reload schema';
