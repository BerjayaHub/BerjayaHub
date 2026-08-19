-- =========================================================
-- Berjaya Hub OMS — 0093
-- ROLE OWNER: hak baca yang luas, dan TIDAK BISA MENULIS APA PUN.
--
-- =========================================================
-- KENAPA BUKAN SEKADAR MENAMBAH 'owner' KE membership_scopes.role
-- =========================================================
--
-- Rencana awal (dan penjelasan yang sempat saya berikan) adalah menambahkan
-- 'owner' ke CHECK constraint `membership_scopes.role`. Alasannya kelihatan
-- kuat: `has_bu_scope()` meloloskan role APA PUN yang punya baris di BU itu,
-- jadi hak baca datang gratis; sedangkan `is_bu_admin()` tidak meloloskan
-- owner, jadi owner otomatis read-only.
--
-- BAGIAN KEDUA ITU SALAH, dan salahnya berbahaya.
--
-- `is_bu_admin()` memang hanya menjaga MASTER DATA (produk, resep, outlet,
-- modul). Yang menjaga penulisan TRANSAKSIONAL justru `has_bu_scope()` —
-- fungsi yang sama yang memberi hak baca. Kalau owner jadi anggota BU, dia
-- ikut lolos di semua tempat berikut:
--
--   stock_movements insert      0018:35   -> bisa menambah/mengurangi stok
--   menu_plans for all          0023:34   -> bisa mengubah & MENGHAPUS rencana
--   produce_batch()             0020:53   -> bisa mencatat produksi
--   transfer_stock()            0018:75   -> bisa memindahkan stok antar outlet
--   dispatch (kirim & terima)   0022:69,111
--   record_sales()              0025:54   -> bisa mencatat penjualan
--   stock_orders (3 RPC)        0031:101,142,173
--   catat_waste()               0032:86
--   goods_receipt_items         0084:81
--   stock_count_items           0085:88   -> bisa mengubah opname
--   checklist_runs insert       0088:58
--
-- Sebelas jalur tulis, tersebar di sebelas migration, tidak satu pun menyebut
-- kata "owner". Menutupnya satu per satu berarti menyunting sebelas policy dan
-- RPC yang sudah teruji — dan yang paling mungkin terjadi adalah satu terlewat,
-- lalu perlindungannya terlihat lengkap padahal berlubang.
--
-- =========================================================
-- YANG DIPAKAI: JALUR TERPISAH
-- =========================================================
--
-- Owner TIDAK didaftarkan di `membership_scopes` sama sekali. Cakupannya
-- disimpan di tabel sendiri, `owner_scopes`.
--
-- Akibatnya `has_bu_scope()` mengembalikan FALSE untuk owner — dan karena
-- itulah SEBELAS jalur tulis di atas tertutup SEKALIGUS, tanpa satu baris pun
-- di dalamnya diubah. Ketidakmampuan menulis bukan hasil sebelas penjagaan yang
-- harus dijaga tetap benar; ia sifat bawaan dari tidak pernah menjadi anggota.
--
-- Harganya jelas dan sengaja dibayar: hak BACA owner tidak lagi datang gratis.
-- Setiap tabel yang boleh dibaca owner harus disebutkan satu per satu di bawah.
-- Daftar itu panjang, tapi ia juga JAWABAN atas pertanyaan "owner sebenarnya
-- bisa lihat apa?" — pertanyaan yang, dengan cara lama, hanya bisa dijawab
-- dengan membaca seluruh skema.
--
-- Tidak ada fungsi lama yang disentuh. `is_bu_admin`, `has_bu_scope`, dan
-- `has_outlet_scope` tetap persis seperti di 0001.
-- =========================================================

-- ---------------------------------------------------------
-- (1) CAKUPAN OWNER
--
-- Satu baris = satu orang berhak mengawasi satu BU. Owner beberapa BU dapat
-- beberapa baris. Tidak ada kolom outlet: owner mengawasi BU utuh, dan
-- membatasinya per outlet hanya akan membuat angka BEP tingkat BU tidak pernah
-- lengkap tanpa ada yang menyadarinya.
-- ---------------------------------------------------------
create table if not exists owner_scopes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references user_profiles(id) on delete cascade,
  business_unit_id uuid not null references business_units(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, business_unit_id)
);

create index if not exists idx_owner_scopes_user on owner_scopes(user_id);
create index if not exists idx_owner_scopes_bu on owner_scopes(business_unit_id);

comment on table owner_scopes is
  'Cakupan pengawasan owner. SENGAJA terpisah dari membership_scopes: owner yang bukan anggota BU tidak lolos has_bu_scope(), sehingga seluruh jalur tulis transaksional tertutup tanpa satu policy pun diubah. Lihat header 0093.';

alter table owner_scopes enable row level security;

-- Owner melihat barisnya sendiri (dibutuhkan owner.html untuk tahu BU mana);
-- yang mengelola hanya super admin.
drop policy if exists owner_scopes_select_own on owner_scopes;
create policy owner_scopes_select_own on owner_scopes
  for select to authenticated
  using (user_id = auth.uid() or is_super_admin(auth.uid()));

drop policy if exists owner_scopes_modify on owner_scopes;
create policy owner_scopes_modify on owner_scopes
  for all to authenticated
  using (is_super_admin(auth.uid()))
  with check (is_super_admin(auth.uid()));

-- ---------------------------------------------------------
-- (2) HELPER
--
-- SECURITY DEFINER, sama alasannya dengan 0061: fungsi ini dipanggil DARI
-- DALAM policy tabel lain, dan pembacaan `owner_scopes` di dalamnya tidak boleh
-- ikut disaring RLS `owner_scopes` — kalau ikut, hasilnya selalu kosong untuk
-- semua orang selain pemiliknya sendiri, dan policy-nya diam-diam tak berguna.
-- ---------------------------------------------------------
create or replace function owner_punya_bu(p_user_id uuid, p_business_unit_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from owner_scopes
    where user_id = p_user_id and business_unit_id = p_business_unit_id
  );
$$;

-- Lewat outletnya. Dipakai tabel yang hanya menyimpan outlet_id (presensi, dan
-- kas sejak 0063 — lihat bagian (4)).
create or replace function owner_punya_outlet(p_user_id uuid, p_outlet_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from owner_scopes os
    join outlets o on o.id = p_outlet_id
    where os.user_id = p_user_id
      and os.business_unit_id = o.business_unit_id
  );
$$;

-- Apakah orang ini owner di suatu BU mana pun? Dipakai owner.html untuk
-- memutuskan boleh masuk atau tidak — BUKAN untuk memberi hak apa pun.
create or replace function is_owner(p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from owner_scopes where user_id = p_user_id);
$$;

revoke all on function owner_punya_bu(uuid, uuid) from public;
revoke all on function owner_punya_outlet(uuid, uuid) from public;
revoke all on function is_owner(uuid) from public;
grant execute on function owner_punya_bu(uuid, uuid) to authenticated;
grant execute on function owner_punya_outlet(uuid, uuid) to authenticated;
grant execute on function is_owner(uuid) to authenticated;

-- ---------------------------------------------------------
-- (3) HAK BACA — SATU POLICY TAMBAHAN PER TABEL
--
-- Semuanya `for select` saja. Tidak ada satu pun `for all`, `for insert`,
-- `for update`, atau `for delete` di berkas ini yang menyebut owner. Itu bisa
-- diperiksa dengan satu perintah:
--
--     grep -n "owner_punya" 0093_role_owner.sql | grep -v "for select"
--
-- dan `tools/audit-owner-baca-saja.cjs` menjalankan pemeriksaan itu otomatis,
-- supaya penambahan di kemudian hari tidak diam-diam memberi hak tulis.
-- ---------------------------------------------------------

-- Struktur organisasi
drop policy if exists bu_select_owner on business_units;
create policy bu_select_owner on business_units
  for select to authenticated
  using (owner_punya_bu(auth.uid(), id));

drop policy if exists outlets_select_owner on outlets;
create policy outlets_select_owner on outlets
  for select to authenticated
  using (owner_punya_bu(auth.uid(), business_unit_id));

-- Master produk & resep — dasar HPP dan Pricing Engine
drop policy if exists products_select_owner on products;
create policy products_select_owner on products
  for select to authenticated
  using (owner_punya_bu(auth.uid(), business_unit_id));

drop policy if exists recipes_select_owner on recipes;
create policy recipes_select_owner on recipes
  for select to authenticated
  using (owner_punya_bu(auth.uid(), business_unit_id));

drop policy if exists recipe_items_select_owner on recipe_items;
create policy recipe_items_select_owner on recipe_items
  for select to authenticated
  using (
    exists (
      select 1 from recipes r
      where r.id = recipe_items.recipe_id
        and owner_punya_bu(auth.uid(), r.business_unit_id)
    )
  );

-- Penjualan — volume, omzet, dan BAURAN untuk pembobotan BEP
drop policy if exists sales_select_owner on sales;
create policy sales_select_owner on sales
  for select to authenticated
  using (owner_punya_bu(auth.uid(), business_unit_id));

-- Stok. `stock_balances` adalah view security_invoker, jadi ia ikut policy ini
-- dengan sendirinya — tidak perlu (dan tidak bisa) diberi policy terpisah.
drop policy if exists stock_mov_select_owner on stock_movements;
create policy stock_mov_select_owner on stock_movements
  for select to authenticated
  using (owner_punya_bu(auth.uid(), business_unit_id));

-- Produksi
drop policy if exists production_runs_select_owner on production_runs;
create policy production_runs_select_owner on production_runs
  for select to authenticated
  using (owner_punya_bu(auth.uid(), business_unit_id));

-- Kepatuhan: aktivitas harian
drop policy if exists checklist_sessions_select_owner on checklist_sessions;
create policy checklist_sessions_select_owner on checklist_sessions
  for select to authenticated
  using (owner_punya_bu(auth.uid(), business_unit_id));

drop policy if exists checklist_items_select_owner on checklist_items;
create policy checklist_items_select_owner on checklist_items
  for select to authenticated
  using (owner_punya_bu(auth.uid(), business_unit_id));

drop policy if exists checklist_runs_select_owner on checklist_runs;
create policy checklist_runs_select_owner on checklist_runs
  for select to authenticated
  using (owner_punya_bu(auth.uid(), business_unit_id));

drop policy if exists checklist_run_items_select_owner on checklist_run_items;
create policy checklist_run_items_select_owner on checklist_run_items
  for select to authenticated
  using (
    exists (
      select 1 from checklist_runs cr
      where cr.id = checklist_run_items.run_id
        and owner_punya_bu(auth.uid(), cr.business_unit_id)
    )
  );

-- Kepatuhan: kehadiran
drop policy if exists attendance_select_owner on attendance_records;
create policy attendance_select_owner on attendance_records
  for select to authenticated
  using (owner_punya_bu(auth.uid(), business_unit_id));

-- Nama orang. Tanpa ini, setiap embed `user_profiles(full_name)` di halaman
-- owner mengembalikan baris tanpa nama — persis gejala bug 0061: barisnya
-- muncul, namanya kosong, dan tidak ada error yang menjelaskan kenapa.
--
-- Cakupannya sengaja lewat `membership_scopes`: yang terlihat hanya orang yang
-- benar-benar bekerja di BU yang diawasi owner ini.
create or replace function orang_di_bu_owner(p_owner uuid, p_target uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from owner_scopes os
    join membership_scopes ms on ms.user_id = p_target
    where os.user_id = p_owner
      and os.business_unit_id = ms.business_unit_id
  );
$$;

revoke all on function orang_di_bu_owner(uuid, uuid) from public;
grant execute on function orang_di_bu_owner(uuid, uuid) to authenticated;

drop policy if exists user_profiles_select_owner on user_profiles;
create policy user_profiles_select_owner on user_profiles
  for select to authenticated
  using (orang_di_bu_owner(auth.uid(), user_profiles.id));

-- ---------------------------------------------------------
-- (4) KAS — DAN APA YANG SEBENARNYA BISA DILIHAT
--
-- Yang disepakati: "owner boleh baca kas se-BU". Ternyata itu tidak bisa
-- dilaksanakan seperti bunyinya, dan bentuk yang terpasang di bawah BERBEDA
-- dari yang dijanjikan. Alasannya:
--
--   - Sejak 0040 kas MENGIKUTI ORANG, bukan BU. `cash_entries.business_unit_id`
--     ditandai DEPRECATED dan baris baru membiarkannya NULL. Jadi "kas BU ini"
--     secara harfiah tidak ada lagi di dalam data.
--   - Tapi sejak 0063 ada `cash_entries_outlet_wajib_saat_keluar`: setiap
--     entri `out` WAJIB menyebut outlet PERUNTUKAN — uang ini dikeluarkan untuk
--     outlet mana.
--
-- Maka cakupannya dibaca dari outlet peruntukan, bukan dari pemegang kasnya.
-- Hasilnya justru lebih tepat daripada yang diminta:
--
--   TERLIHAT     uang KELUAR untuk outlet-outlet BU yang diawasi owner.
--                Itu persis yang dibutuhkan halaman BEP (biaya tetap) dan
--                satu-satunya bagian kas yang memang urusan owner.
--
--   TIDAK TERLIHAT  saldo pribadi pemegang kas, uang MASUK, transfer antar
--                orang, dan mutasi antar kantong — semuanya tidak punya outlet,
--                jadi tidak pernah lolos. Owner tidak melihat isi kantong
--                siapa pun.
--
-- Ini lebih sempit dari "kas se-BU" yang disepakati. Kalau yang diinginkan
-- memang termasuk saldo pemegang kas, itu keputusan terpisah dan harus ditulis
-- sebagai migration tersendiri — bukan diam-diam ikut di sini.
-- ---------------------------------------------------------
drop policy if exists cash_entries_select_owner on cash_entries;
create policy cash_entries_select_owner on cash_entries
  for select to authenticated
  using (
    outlet_id is not null
    and owner_punya_outlet(auth.uid(), outlet_id)
  );

-- Kategori: yang global (business_unit_id null, sejak 0040) atau milik BU-nya.
drop policy if exists cash_categories_select_owner on cash_categories;
create policy cash_categories_select_owner on cash_categories
  for select to authenticated
  using (
    is_owner(auth.uid())
    and (business_unit_id is null or owner_punya_bu(auth.uid(), business_unit_id))
  );

-- ---------------------------------------------------------
-- (5) PENANDA BIAYA TETAP
--
-- BEP menuntut pemisahan biaya TETAP (sewa, gaji pokok, langganan) dari biaya
-- VARIABEL (belanja bahan). Sampai sekarang `cash_categories` tidak menyimpan
-- bedanya, jadi satu-satunya cara memisahkan adalah menebak dari namanya —
-- dan tebakan dari nama akan salah diam-diam begitu ada kategori baru bernama
-- "Perbaikan Mesin" yang tidak jelas masuk mana.
--
-- Default FALSE: kategori yang ada sekarang dianggap variabel sampai seseorang
-- menandainya. Lebih baik BEP terlihat terlalu rendah dan janggal (sehingga
-- ditanyakan) daripada terlalu tinggi karena belanja bahan ikut dihitung tetap.
-- ---------------------------------------------------------
alter table cash_categories add column if not exists is_fixed_cost boolean not null default false;

comment on column cash_categories.is_fixed_cost is
  'TRUE = biaya tetap (sewa, gaji, langganan) yang dipakai penyebut BEP. FALSE = variabel. Default false; ditandai manual oleh super admin di halaman Kas.';

-- ---------------------------------------------------------
-- (6) ANGKA YANG DIPAKAI PRICING ENGINE
--
-- Diambil dari aplikasi Project Hub, tapi dipasang di tempat yang sudah punya
-- pemiliknya masing-masing.
--
-- Per BU (metode & persentasenya), karena metode penetapan harga adalah
-- keputusan tingkat usaha: kafe wajar memakai Food Cost, bengkel memakai
-- Margin. Menyimpannya per produk akan membuat 200 produk bisa memakai 200
-- metode berbeda tanpa ada yang berniat begitu.
--
-- Per produk (biaya kemasan & potongan), karena angkanya memang berbeda tiap
-- barang: gelas plastik hanya melekat pada minuman, dan fee marketplace hanya
-- kena pada yang dijual online.
-- ---------------------------------------------------------
alter table business_units add column if not exists pricing_method text not null default 'food_cost';
alter table business_units add column if not exists food_cost_percent numeric not null default 35;
alter table business_units add column if not exists markup_percent numeric not null default 100;
alter table business_units add column if not exists margin_percent numeric not null default 60;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'business_units_pricing_method_sah') then
    alter table business_units add constraint business_units_pricing_method_sah
      check (pricing_method in ('food_cost', 'markup', 'margin'));
  end if;

  -- Margin 100% berarti harga jual dibagi nol. Dijaga di sini supaya
  -- pembagian nolnya tidak pernah sampai ke perhitungan.
  if not exists (select 1 from pg_constraint where conname = 'business_units_persen_wajar') then
    alter table business_units add constraint business_units_persen_wajar
      check (
        food_cost_percent > 0 and food_cost_percent <= 100
        and markup_percent >= 0 and markup_percent <= 1000
        and margin_percent >= 0 and margin_percent < 100
      );
  end if;
end $$;

comment on column business_units.pricing_method is
  'food_cost: harga = HPP / persen. markup: harga = HPP x (1 + persen). margin: harga = HPP / (1 - persen). Rumusnya di js/modules/owner/pricing.js.';

alter table products add column if not exists packaging_cost numeric not null default 0;
alter table products add column if not exists fee_online_percent numeric not null default 0;
alter table products add column if not exists promo_percent numeric not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_biaya_tambahan_wajar') then
    alter table products add constraint products_biaya_tambahan_wajar
      check (
        packaging_cost >= 0
        -- Batas < 100 dua-duanya: fee 100% berarti seluruh uangnya hilang, dan
        -- rumus harga online membaginya, jadi 100 akan membagi nol.
        and fee_online_percent >= 0 and fee_online_percent < 100
        and promo_percent >= 0 and promo_percent < 100
      );
  end if;
end $$;

comment on column products.packaging_cost is
  'Biaya kemasan per porsi, dalam rupiah. Ikut dijumlahkan ke HPP saat menghitung harga jual & BEP.';
comment on column products.fee_online_percent is
  'Potongan marketplace (%). Dipakai menghitung harga online dari harga offline.';
comment on column products.promo_percent is
  'Diskon promo yang biasa dipasang (%). Sama gunanya dengan fee_online_percent.';

-- ---------------------------------------------------------
-- (7) Tanpa baris ini, semua kolom & policy di atas ada di database tapi
-- PostgREST masih memakai skema lamanya — dan error yang muncul di aplikasi
-- akan berbunyi "column does not exist" untuk kolom yang jelas-jelas ada.
-- ---------------------------------------------------------
notify pgrst, 'reload schema';
