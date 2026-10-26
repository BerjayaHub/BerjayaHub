-- =========================================================
-- 0166 — BU BENGKEL: MASTER SPAREPART/JASA + PENJUALAN NOMINAL
--
-- Bengkel berbeda dari cafe pada dua hal yang mengubah seluruh bentuknya:
--
--   1. Yang dijual Sparepart & Jasa, dan staff melaporkan NOMINAL HARIAN —
--      bukan baris per barang. Tidak ada stok sama sekali.
--   2. Master Sparepart ada BUKAN untuk menghitung stok, melainkan supaya
--      nama dan kode SKU SAMA di semua outlet. Itu satu-satunya tujuannya.
--
-- ============ KENAPA TABEL SENDIRI, BUKAN MENUMPANG `products` ============
--
-- `products` memikul `product_type in ('raw','semi','finished')`, `base_unit`
-- wajib, resep, HPP, dan saldo stok. Sparepart tidak punya satu pun dari itu.
-- Menumpangkannya berarti tiap pembaca `products` — resep, opname, COGS,
-- kiriman — harus belajar menyaring baris yang bukan bahan, dan yang lupa
-- menyaring akan menghitung 1.926 sparepart sebagai bahan tanpa HPP.
--
-- Itu bukan kekhawatiran teoretis: laporan COGS di repo ini baru saja
-- diperbaiki dari kesalahan berbentuk persis sama — satu sumber angka yang
-- dibaca dengan asumsi yang berbeda-beda.
--
-- ============ KENAPA PENJUALAN BENGKEL TIDAK MASUK TABEL `sales` ============
--
-- `sales.product_id` NOT NULL. Penjualan bengkel adalah nominal harian tanpa
-- barang; memaksanya ke sana menuntut produk semu "Sparepart" dan "Jasa" yang
-- lalu muncul di Master Produk, di pemilih bahan, dan di laporan resep.
--
-- Konsekuensinya diterima dengan sadar: laporan yang membaca `sales` TIDAK
-- akan melihat omzet bengkel. Karena itu bengkel punya laporannya sendiri —
-- Laba Rugi Outlet bersandar pada stok, dan untuk bengkel kolom HPP-nya akan
-- selalu nol, yang terbaca sebagai "laba 100%".
-- =========================================================

-- ---------------------------------------------------------
-- 1. MASTER SPAREPART & JASA (per BU)
-- ---------------------------------------------------------
create table if not exists spareparts (
  id               uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references business_units(id) on delete cascade,

  -- SKU adalah KUNCI PENYAMAAN antar outlet, dan karenanya kunci impor.
  -- Wajib: tanpa SKU, impor berikutnya tidak punya cara tahu baris mana yang
  -- sama — dan "tidak ada double nama atau SKU" jadi tidak bisa dijamin.
  sku              text not null,
  name             text not null,

  jenis            text not null default 'sparepart' check (jenis in ('sparepart', 'jasa')),
  kategori         text,                 -- Type dari ESB: PART REM, FILTER, OLI…
  merek            text,                 -- Brand

  -- Harga acuan se-BU. Outlet yang berbeda menimpanya di
  -- `sparepart_outlet_prices`; impor berikutnya memperbarui YANG INI saja.
  harga_dasar      numeric check (harga_dasar is null or harga_dasar >= 0),

  is_active        boolean not null default true,

  -- ============ JEJAK ASAL BARIS ============
  --
  -- `dari_impor` membedakan baris yang datang dari berkas ESB dari yang
  -- diketik admin. Impor berikutnya TIDAK BOLEH menghapus jasa yang
  -- ditambahkan manual — dan tanpa penanda ini, "bersihkan yang tidak ada di
  -- berkas" akan menghapusnya diam-diam.
  dari_impor       boolean not null default false,
  diimpor_at       timestamptz,

  dibuat_by        uuid references user_profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  diperbarui_at    timestamptz,
  diperbarui_by    uuid references user_profiles(id) on delete set null
);

-- SKU unik PER BU, dinormalkan huruf besar & tanpa spasi pinggir.
--
-- Indeks atas ekspresi, bukan atas kolomnya: "555.LTR.BZ120" dan
-- "555.ltr.bz120 " adalah SKU yang sama di mata orang, dan membiarkan
-- keduanya masuk persis menghasilkan "double SKU" yang diminta dicegah.
create unique index if not exists spareparts_sku_uk
  on spareparts(business_unit_id, upper(btrim(sku)));

create index if not exists idx_spareparts_bu on spareparts(business_unit_id) where is_active;
create index if not exists idx_spareparts_nama on spareparts(business_unit_id, name);

comment on table spareparts is
  'Master Sparepart & Jasa BU bengkel. TIDAK menyimpan stok — tujuannya menyamakan nama & kode SKU antar outlet.';

-- ---------------------------------------------------------
-- 2. HARGA PER OUTLET (menimpa harga dasar)
-- ---------------------------------------------------------
create table if not exists sparepart_outlet_prices (
  id            uuid primary key default gen_random_uuid(),
  sparepart_id  uuid not null references spareparts(id) on delete cascade,
  outlet_id     uuid not null references outlets(id) on delete cascade,
  harga         numeric not null check (harga >= 0),
  diperbarui_at timestamptz not null default now(),
  diperbarui_by uuid references user_profiles(id) on delete set null
);

create unique index if not exists sparepart_outlet_prices_uk
  on sparepart_outlet_prices(sparepart_id, outlet_id);

comment on table sparepart_outlet_prices is
  'Harga khusus satu outlet. Baris yang TIDAK ada di sini berarti outlet itu memakai harga_dasar — bukan berarti harganya nol.';

-- ---------------------------------------------------------
-- 3. PENJUALAN BENGKEL — nominal harian, tanpa barang
-- ---------------------------------------------------------
create table if not exists bengkel_sales (
  id               uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references business_units(id) on delete cascade,
  outlet_id        uuid not null references outlets(id) on delete cascade,
  sale_date        date not null,

  omzet_sparepart  numeric not null default 0 check (omzet_sparepart >= 0),
  omzet_jasa       numeric not null default 0 check (omzet_jasa >= 0),
  catatan          text,

  dilapor_by       uuid references user_profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  diperbarui_at    timestamptz,
  diperbarui_by    uuid references user_profiles(id) on delete set null
);

-- SATU BARIS PER OUTLET PER TANGGAL.
--
-- Tanpa ini, staff yang menekan Simpan dua kali — atau dua staff di satu
-- outlet — menghasilkan omzet hari itu terhitung dua kali. Laporannya tetap
-- tercetak rapi, dan selisihnya baru ketahuan saat dicocokkan dengan kas.
create unique index if not exists bengkel_sales_uk on bengkel_sales(outlet_id, sale_date);
create index if not exists idx_bengkel_sales_bu on bengkel_sales(business_unit_id, sale_date desc);

comment on table bengkel_sales is
  'Omzet harian bengkel per outlet: sparepart & jasa, nominal saja. Tidak ada stok dan tidak ada baris barang.';

-- ---------------------------------------------------------
-- 4. MODUL
-- ---------------------------------------------------------
insert into modules (code, name, description)
values
  ('sparepart', 'Sparepart & Jasa', 'Master nama, kode SKU, dan harga sparepart/jasa — tanpa stok'),
  ('penjualan_bengkel', 'Penjualan Bengkel', 'Laporan omzet harian: sparepart & jasa, nominal saja')
on conflict (code) do nothing;

-- ---------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------
alter table spareparts enable row level security;
alter table sparepart_outlet_prices enable row level security;
alter table bengkel_sales enable row level security;

drop policy if exists spareparts_select on spareparts;
create policy spareparts_select on spareparts
  for select using (has_bu_scope(auth.uid(), business_unit_id));

-- Master dikelola ADMIN BU. Staff cuma membacanya untuk menyebut harga ke
-- pelanggan; membiarkannya menulis berarti nama & kode bisa berbeda lagi
-- antar outlet, yaitu persis masalah yang tabel ini ada untuk menyelesaikan.
drop policy if exists spareparts_modify on spareparts;
create policy spareparts_modify on spareparts
  for all using (is_bu_admin(auth.uid(), business_unit_id))
  with check (is_bu_admin(auth.uid(), business_unit_id));

drop policy if exists sparepart_prices_select on sparepart_outlet_prices;
create policy sparepart_prices_select on sparepart_outlet_prices
  for select using (
    exists (select 1 from spareparts s where s.id = sparepart_id and has_bu_scope(auth.uid(), s.business_unit_id))
  );

drop policy if exists sparepart_prices_modify on sparepart_outlet_prices;
create policy sparepart_prices_modify on sparepart_outlet_prices
  for all using (
    exists (select 1 from spareparts s where s.id = sparepart_id and is_bu_admin(auth.uid(), s.business_unit_id))
  )
  with check (
    exists (select 1 from spareparts s where s.id = sparepart_id and is_bu_admin(auth.uid(), s.business_unit_id))
  );

drop policy if exists bengkel_sales_select on bengkel_sales;
create policy bengkel_sales_select on bengkel_sales
  for select using (has_bu_scope(auth.uid(), business_unit_id));

-- Staff MELAPOR omzet outletnya sendiri; admin BU boleh membetulkan yang mana
-- pun di BU-nya.
drop policy if exists bengkel_sales_insert on bengkel_sales;
create policy bengkel_sales_insert on bengkel_sales
  for insert with check (
    has_outlet_scope(auth.uid(), outlet_id) or is_bu_admin(auth.uid(), business_unit_id)
  );

drop policy if exists bengkel_sales_update on bengkel_sales;
create policy bengkel_sales_update on bengkel_sales
  for update using (
    has_outlet_scope(auth.uid(), outlet_id) or is_bu_admin(auth.uid(), business_unit_id)
  )
  with check (
    has_outlet_scope(auth.uid(), outlet_id) or is_bu_admin(auth.uid(), business_unit_id)
  );

drop policy if exists bengkel_sales_delete on bengkel_sales;
create policy bengkel_sales_delete on bengkel_sales
  for delete using (is_bu_admin(auth.uid(), business_unit_id));

-- ---------------------------------------------------------
-- 6. RPC IMPOR
--
-- Satu panggilan untuk seluruh berkas. 1.926 baris lewat `upsert` dari
-- browser berarti 1.926 permintaan atau satu badan raksasa yang sebagian
-- gagal di tengah — dan impor yang berhasil separuh lebih buruk daripada
-- impor yang gagal, karena tidak ada yang tahu separuh mana.
--
-- `p_rows`: [{ sku, name, jenis, kategori, merek, harga }]
-- ---------------------------------------------------------
create or replace function impor_sparepart(p_bu uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  it jsonb;
  v_sku text;
  v_nama text;
  v_jenis text;
  v_harga numeric;
  v_baru int := 0;
  v_diperbarui int := 0;
  v_dilewati int := 0;
  v_ada boolean;
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  if not is_bu_admin(v_uid, p_bu) then
    raise exception 'Hanya Admin BU yang boleh mengimpor master sparepart.';
  end if;
  if p_rows is null or jsonb_array_length(p_rows) = 0 then
    raise exception 'Tidak ada baris yang dikirim.';
  end if;

  for it in select * from jsonb_array_elements(p_rows) loop
    v_sku := upper(btrim(coalesce(it->>'sku', '')));
    v_nama := btrim(coalesce(it->>'name', ''));
    if v_sku = '' or v_nama = '' then
      v_dilewati := v_dilewati + 1;
      continue;
    end if;

    v_jenis := lower(btrim(coalesce(it->>'jenis', 'sparepart')));
    if v_jenis not in ('sparepart', 'jasa') then v_jenis := 'sparepart'; end if;
    v_harga := nullif(it->>'harga', '')::numeric;
    if v_harga is not null and v_harga < 0 then v_harga := null; end if;

    select true into v_ada from spareparts
     where business_unit_id = p_bu and upper(btrim(sku)) = v_sku limit 1;

    insert into spareparts (business_unit_id, sku, name, jenis, kategori, merek, harga_dasar, dari_impor, diimpor_at, dibuat_by)
    values (p_bu, v_sku, v_nama, v_jenis,
            nullif(btrim(coalesce(it->>'kategori', '')), ''),
            nullif(btrim(coalesce(it->>'merek', '')), ''),
            v_harga, true, now(), v_uid)
    on conflict (business_unit_id, upper(btrim(sku))) do update
      set name = excluded.name,
          -- ============ `jenis` TIDAK DITIMPA ============
          --
          -- Berkas ESB tidak punya kolom "ini jasa atau barang". Satu-satunya
          -- cara menebaknya dari berkas adalah mencari kata "SERVICE"/"JASA"
          -- di nama atau kategorinya — dan tebakan itu salah ke dua arah:
          -- "SERVICE KIT" adalah barang, dan jasa yang dinamai "GANTI OLI"
          -- tidak memuat satu pun kata kuncinya.
          --
          -- Jadi `jenis` baris yang SUDAH ADA adalah keputusan admin, bukan
          -- isi berkas. Menimpanya dengan tebakan membuat jasa yang sudah
          -- dibetulkan dengan tangan kembali jadi sparepart setiap kali
          -- berkasnya diimpor ulang — tanpa galat, tanpa jejak, dan orang yang
          -- membetulkannya tidak akan tahu kecuali ia memeriksanya lagi.
          --
          -- Baris BARU tetap memakai tebakan itu (lihat `insert` di atas);
          -- yang lama dibiarkan dan bisa diubah dari layar Sparepart.
          kategori = excluded.kategori,
          merek = excluded.merek,
          -- ============ HARGA KOSONG TIDAK MENGHAPUS HARGA LAMA ============
          --
          -- Baris berkas yang kolom harganya kosong berarti "tidak disebut",
          -- bukan "gratis". Menimpanya dengan null membuat harga yang sudah
          -- benar hilang tanpa ada yang menyadarinya.
          harga_dasar = coalesce(excluded.harga_dasar, spareparts.harga_dasar),
          -- `is_active` TIDAK disentuh: sparepart yang sengaja dinonaktifkan
          -- admin tidak boleh hidup lagi hanya karena ikut terbawa berkas.
          dari_impor = true,
          diimpor_at = now(),
          diperbarui_at = now(),
          diperbarui_by = v_uid;

    if v_ada then v_diperbarui := v_diperbarui + 1; else v_baru := v_baru + 1; end if;
    v_ada := null;
  end loop;

  return jsonb_build_object('baru', v_baru, 'diperbarui', v_diperbarui, 'dilewati', v_dilewati);
end;
$$;

revoke all on function impor_sparepart(uuid, jsonb) from public;
grant execute on function impor_sparepart(uuid, jsonb) to authenticated;

comment on function impor_sparepart(uuid, jsonb) is
  'Impor master sparepart dari berkas ESB. Cocok lewat SKU (huruf besar, tanpa spasi pinggir) — yang sudah ada DITIMPA, yang baru ditambahkan. Harga kosong tidak menghapus harga lama, dan is_active tidak disentuh.';

notify pgrst, 'reload schema';
