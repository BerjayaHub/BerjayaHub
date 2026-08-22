-- =========================================================
-- Berjaya Hub OMS — 0101
-- Penjualan bisa diperbaiki & dihapus, dan STOK BAHANNYA IKUT TERKOREKSI.
--
-- =========================================================
-- KENAPA SEBELUMNYA TIDAK BERPENGARUH KE STOK
-- =========================================================
--
-- Bukan karena rusak: fiturnya memang tidak pernah ada.
--
-- `sales` sejak 0025 hanya punya policy SELECT. Tidak ada policy UPDATE, tidak
-- ada policy DELETE, dan tidak ada RPC yang mengubahnya. Jadi mengedit
-- penjualan mustahil, dan karena mustahil, pembalikan stoknya pun tidak pernah
-- ditulis.
--
-- Yang menyesatkan: PostgREST TIDAK menganggap penolakan RLS sebagai error. Ia
-- membalas sukses dengan NOL BARIS. Jadi klien yang mencoba `update` akan
-- melihat "berhasil" dan tidak ada yang berubah — persis gejala yang dilaporkan.
--
-- =========================================================
-- BENTUKNYA: PERGERAKAN PENYEIMBANG, BUKAN MENIMPA MASA LALU
-- =========================================================
--
-- Sama seperti produksi (0092), nota (0084), dan opname (0085): pergerakan stok
-- lama TIDAK PERNAH diubah atau dihapus. Yang ditulis adalah pergerakan BARU
-- sebesar selisihnya.
--
--   1. `stock_movements` adalah buku besar. Memperbaiki masa lalu membuat angka
--      yang pernah dilihat, dicetak, dan dipakai berdebat berubah tanpa jejak.
--   2. Kalau ada penerimaan atau opname DI ANTARA penjualan dan koreksinya,
--      menimpa angka lama menghasilkan urutan yang tidak pernah terjadi.
--      Selisih yang ditambahkan sekarang selalu benar, apa pun yang terjadi
--      di antaranya.
--
-- =========================================================
-- HAPUS = BARISNYA BENAR-BENAR HILANG (keputusan pemilik)
-- =========================================================
--
-- Berbeda dengan produksi & opname yang memakai penanda batal, di sini baris
-- `sales`-nya BENAR-BENAR DIHAPUS. Itu permintaan yang disengaja.
--
-- Konsekuensinya nyata dan ditangani, bukan diabaikan:
--
--   (a) Pergerakan stok TIDAK ikut terhapus. `sale_id` sengaja
--       `on delete set null`, BUKAN `on delete cascade`. Cascade akan
--       melenyapkan pemakaian bahan yang benar-benar terjadi, dan saldo stok
--       berubah diam-diam ke angka yang tidak pernah benar.
--
--   (b) Karena barisnya hilang, ceritanya dipindahkan ke CATATAN pergerakan:
--       "Batal penjualan Nasi Goreng 20 porsi (12 Agu)". Buku besarnya tetap
--       bisa menjawab "kok angkanya begini?" walau penjualannya sudah tiada.
--
--   (c) `sales_submissions` dihitung ulang, tidak dibiarkan menyimpan omzet
--       yang barisnya sudah tidak ada.
--
-- =========================================================
-- HARGA TIDAK PERNAH DIBACA ULANG SAAT MENGEDIT
-- =========================================================
--
-- `ubah_penjualan()` memakai `unit_price` YANG SUDAH TERSIMPAN di baris itu,
-- bukan `harga_outlet_aktif()`.
--
-- Kalau harganya dibaca ulang, membetulkan salah ketik jumlah di hari Senin
-- akan diam-diam mengubah OMZET hari Sabtu ke harga yang baru naik. Tidak ada
-- error, tidak ada tanda; omzet historis sekadar bergeser. Itu persis hal yang
-- dijaga sejak 0099 (snapshot harga), dan tidak boleh bocor lewat pintu edit.
--
-- =========================================================
-- SIAPA YANG BOLEH
-- =========================================================
--
-- Pencatatnya sendiri HARI ITU JUGA, atau Admin BU kapan saja. Bentuk yang sama
-- dipakai produksi (0092) dan koreksi Daily Activities (0073).
-- =========================================================

-- ---------------------------------------------------------
-- (1) Pengait pergerakan stok ke penjualannya.
--
-- `on delete set null` — SENGAJA, dan ini pilihan yang paling menentukan di
-- seluruh berkas. Lihat catatan (a) di kepala.
-- ---------------------------------------------------------
alter table stock_movements add column if not exists sale_id uuid references sales(id) on delete set null;
create index if not exists idx_stock_mov_sale on stock_movements(sale_id) where sale_id is not null;

-- ---------------------------------------------------------
-- (2) Penjaga wewenang bersama.
--
-- Ditulis sekali supaya `ubah` dan `hapus` tidak bisa menyimpang satu sama
-- lain. Dua salinan aturan yang sama selalu berakhir berbeda, dan yang berbeda
-- adalah yang jarang dibaca.
-- ---------------------------------------------------------
create or replace function boleh_ubah_penjualan(p_sale uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from sales s
    where s.id = p_sale
      and (
        is_bu_admin(auth.uid(), s.business_unit_id)
        or (
          s.created_by = auth.uid()
          and (s.created_at at time zone 'Asia/Jakarta')::date = (now() at time zone 'Asia/Jakarta')::date
        )
      )
  );
$$;

-- ---------------------------------------------------------
-- (3) Resep yang dipakai memotong stok — DITULIS SEKALI.
--
-- Aturan mundurnya varian `served_by_ck` ke `standalone` harus PERSIS sama
-- dengan yang dipakai `record_sales()`. Kalau berbeda, pembalikannya akan
-- memakai resep yang lain dari yang dulu memotong — dan stok tidak akan pernah
-- kembali ke angka semula. Selisihnya kecil, terlihat wajar, dan tidak akan
-- pernah dicurigai.
-- ---------------------------------------------------------
create or replace function resep_penjualan(p_outlet uuid, p_product uuid)
returns recipes
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
  v_mode text;
  v_recipe recipes%rowtype;
begin
  select outlet_role into v_role from outlets where id = p_outlet;
  v_mode := case when v_role = 'served_by_ck' then 'served_by_ck' else 'standalone' end;

  select * into v_recipe from recipes where product_id = p_product and mode = v_mode;
  if v_recipe.id is null and v_mode <> 'standalone' then
    select * into v_recipe from recipes where product_id = p_product and mode = 'standalone';
  end if;
  return v_recipe;
end $$;

-- ---------------------------------------------------------
-- (4) UBAH JUMLAH TERJUAL
--
-- Yang bisa diubah HANYA jumlahnya. Produk & outletnya tidak.
--
-- Mengganti produk berarti membalik seluruh pemakaian bahan resep lama lalu
-- menerapkan resep baru — hasilnya persis sama dengan "hapus lalu catat ulang",
-- tapi dengan satu baris riwayat yang menyamarkan bahwa dua hal berbeda pernah
-- terjadi. Lebih jujur menyuruh orangnya menghapus dan mencatat lagi.
-- ---------------------------------------------------------
create or replace function ubah_penjualan(p_sale uuid, p_qty numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r_sale sales%rowtype;
  v_recipe recipes%rowtype;
  v_selisih numeric;
  v_nama text;
  r record;
begin
  if auth.uid() is null then raise exception 'Harus login'; end if;

  select * into r_sale from sales where id = p_sale;
  if r_sale.id is null then raise exception 'Penjualan tidak ditemukan.'; end if;

  if not boleh_ubah_penjualan(p_sale) then
    raise exception 'Kamu hanya boleh memperbaiki penjualan yang kamu catat sendiri hari ini. Selebihnya lewat Admin BU.';
  end if;

  if p_qty is null or p_qty <= 0 then
    raise exception 'Jumlah terjual harus lebih dari 0. Kalau memang tidak jadi terjual, hapus barisnya.';
  end if;

  v_selisih := p_qty - r_sale.qty;
  if v_selisih = 0 then
    return jsonb_build_object('berubah', false, 'qty', r_sale.qty, 'omzet', r_sale.revenue);
  end if;

  -- HARGA DARI BARISNYA SENDIRI, bukan dari daftar harga sekarang.
  -- Alasannya di kepala berkas — ini yang menjaga omzet historis tetap historis.
  update sales
     set qty = p_qty,
         revenue = r_sale.unit_price * p_qty
   where id = p_sale;

  select name into v_nama from products where id = r_sale.product_id;

  -- Bahannya: selisih pemakaiannya saja.
  v_recipe := resep_penjualan(r_sale.outlet_id, r_sale.product_id);
  if v_recipe.id is not null and v_recipe.yield_qty > 0 then
    for r in select ingredient_product_id, qty from recipe_items where recipe_id = v_recipe.id loop
      insert into stock_movements (
        business_unit_id, outlet_id, product_id, movement_type, qty_delta, sale_id, notes, created_by
      ) values (
        r_sale.business_unit_id, r_sale.outlet_id, r.ingredient_product_id, 'usage',
        -(r.qty * v_selisih / v_recipe.yield_qty), p_sale,
        format('Koreksi penjualan %s: %s -> %s porsi (%s)',
               coalesce(v_nama, '?'), r_sale.qty, p_qty, to_char(r_sale.sale_date, 'DD Mon YYYY')),
        auth.uid()
      );
    end loop;
  end if;
  -- Resep hilang TIDAK menggagalkan koreksi omzet. Penjualannya nyata dan
  -- angkanya harus benar; yang tidak bisa dilakukan hanyalah menyesuaikan
  -- bahannya, dan itu dikatakan lewat `stok_disesuaikan` di bawah.

  -- Ringkasan kiriman ikut dihitung ulang supaya tidak menyimpan omzet yang
  -- sudah tidak cocok dengan barisnya.
  if r_sale.submission_id is not null then
    update sales_submissions ss
       set item_count = x.n, total_revenue = x.omzet
      from (select count(*) n, coalesce(sum(revenue), 0) omzet from sales where submission_id = r_sale.submission_id) x
     where ss.id = r_sale.submission_id;
  end if;

  return jsonb_build_object(
    'berubah', true,
    'qty', p_qty,
    'omzet', r_sale.unit_price * p_qty,
    'stok_disesuaikan', v_recipe.id is not null and v_recipe.yield_qty > 0
  );
end $$;

-- ---------------------------------------------------------
-- (5) HAPUS — balik seluruh stoknya DULU, baru barisnya dihapus.
--
-- Urutannya penting. Pergerakan penyeimbang ditulis selagi barisnya masih ada,
-- supaya `sale_id`-nya sempat terisi dan bisa ditelusuri; `on delete set null`
-- kemudian mengosongkannya, tapi CATATANNYA sudah memuat ceritanya sendiri.
-- ---------------------------------------------------------
create or replace function hapus_penjualan(p_sale uuid, p_alasan text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r_sale sales%rowtype;
  v_recipe recipes%rowtype;
  v_nama text;
  v_subm uuid;
  v_catatan text;
  r record;
begin
  if auth.uid() is null then raise exception 'Harus login'; end if;

  select * into r_sale from sales where id = p_sale;
  if r_sale.id is null then raise exception 'Penjualan tidak ditemukan.'; end if;

  if not boleh_ubah_penjualan(p_sale) then
    raise exception 'Kamu hanya boleh menghapus penjualan yang kamu catat sendiri hari ini. Selebihnya lewat Admin BU.';
  end if;

  select name into v_nama from products where id = r_sale.product_id;
  v_subm := r_sale.submission_id;

  -- Barisnya akan lenyap, jadi ceritanya dititipkan ke catatan pergerakan.
  -- Tanpa ini, buku besar akan berisi angka yang tidak bisa dijelaskan siapa pun
  -- enam bulan kemudian.
  v_catatan := format('Batal penjualan %s %s porsi (%s)',
                      coalesce(v_nama, '?'), r_sale.qty, to_char(r_sale.sale_date, 'DD Mon YYYY'))
               || coalesce(' — ' || nullif(p_alasan, ''), '');

  v_recipe := resep_penjualan(r_sale.outlet_id, r_sale.product_id);
  if v_recipe.id is not null and v_recipe.yield_qty > 0 then
    for r in select ingredient_product_id, qty from recipe_items where recipe_id = v_recipe.id loop
      -- Positif: bahannya DIKEMBALIKAN.
      insert into stock_movements (
        business_unit_id, outlet_id, product_id, movement_type, qty_delta, sale_id, notes, created_by
      ) values (
        r_sale.business_unit_id, r_sale.outlet_id, r.ingredient_product_id, 'usage',
        r.qty * r_sale.qty / v_recipe.yield_qty, p_sale, v_catatan, auth.uid()
      );
    end loop;
  end if;

  delete from sales where id = p_sale;

  if v_subm is not null then
    update sales_submissions ss
       set item_count = x.n, total_revenue = x.omzet
      from (select count(*) n, coalesce(sum(revenue), 0) omzet from sales where submission_id = v_subm) x
     where ss.id = v_subm;
  end if;

  return jsonb_build_object(
    'dihapus', true,
    'stok_dikembalikan', v_recipe.id is not null and v_recipe.yield_qty > 0
  );
end $$;

revoke all on function boleh_ubah_penjualan(uuid) from public;
revoke all on function resep_penjualan(uuid, uuid) from public;
revoke all on function ubah_penjualan(uuid, numeric) from public;
revoke all on function hapus_penjualan(uuid, text) from public;
grant execute on function boleh_ubah_penjualan(uuid) to authenticated;
grant execute on function resep_penjualan(uuid, uuid) to authenticated;
grant execute on function ubah_penjualan(uuid, numeric) to authenticated;
grant execute on function hapus_penjualan(uuid, text) to authenticated;

comment on function ubah_penjualan(uuid, numeric) is
  'Ubah jumlah terjual. Harga dipakai dari unit_price yang SUDAH tersimpan (tidak dibaca ulang dari daftar harga), dan stok bahan dikoreksi sebesar selisihnya.';
comment on function hapus_penjualan(uuid, text) is
  'Balik stok bahan lalu hapus baris penjualan. Pergerakan stok lama tidak diubah; ditulis pergerakan penyeimbang bercatatan.';

-- =========================================================
-- (6) `record_sales()` MENANDAI `sale_id` pada pergerakannya.
--
-- Tanpa ini, pemakaian bahan dari penjualan tidak bisa ditelusuri ke
-- penjualannya, dan layar Riwayat Stok hanya berbunyi "Penjualan" tanpa
-- menyebut yang mana. Sisa isinya SAMA PERSIS dengan 0099 — yang berubah hanya
-- penangkapan id barisnya dan catatan yang lebih menyebut.
-- =========================================================
create or replace function record_sales(
  p_bu uuid,
  p_outlet uuid,
  p_date date,
  p_items jsonb,
  p_ref uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_allow boolean;
  it jsonb;
  v_pid uuid;
  v_qty numeric;
  v_harga outlet_menu_prices;
  v_recipe recipes%rowtype;
  r record;
  v_baru boolean;
  v_kurang text[] := '{}';
  v_nama text;
  v_jumlah int := 0;
  v_omzet numeric := 0;
  v_lama sales_submissions;
  v_sale_id uuid;
begin
  if v_uid is null then
    raise exception 'Harus login';
  end if;
  if p_ref is null then
    raise exception 'Penanda kiriman tidak ada. Muat ulang aplikasi, lalu coba lagi.';
  end if;
  if not has_bu_scope(v_uid, p_bu) then
    raise exception 'Tidak berhak';
  end if;

  select outlet_role, allow_sales into v_role, v_allow from outlets where id = p_outlet;
  if v_role is null then
    raise exception 'Outlet tidak valid';
  end if;
  if not coalesce(v_allow, false) then
    raise exception 'Penjualan tidak diaktifkan untuk outlet ini';
  end if;

  -- (1) IDEMPOTENCY — sebelum apa pun ditulis. Alasannya di 0098.
  insert into sales_submissions (id, business_unit_id, outlet_id, sale_date, created_by)
  values (p_ref, p_bu, p_outlet, p_date, v_uid)
  on conflict (id) do nothing;

  get diagnostics v_baru = row_count;

  if not v_baru then
    select * into v_lama from sales_submissions where id = p_ref;
    return jsonb_build_object(
      'diproses', false,
      'alasan', 'Kiriman ini sudah pernah tersimpan',
      'item', v_lama.item_count,
      'omzet', v_lama.total_revenue
    );
  end if;

  -- (2) VALIDASI HARGA — SELURUH item diperiksa dulu. Alasannya di 0099.
  for it in select * from jsonb_array_elements(p_items) loop
    v_pid := (it->>'product_id')::uuid;
    v_qty := (it->>'qty')::numeric;
    if v_pid is null or v_qty is null or v_qty <= 0 then continue; end if;

    v_harga := harga_outlet_aktif(p_outlet, v_pid, p_date);

    if v_harga.id is null then
      select name into v_nama from products where id = v_pid;
      v_kurang := array_append(v_kurang, coalesce(v_nama, v_pid::text));
    end if;
  end loop;

  if array_length(v_kurang, 1) > 0 then
    raise exception 'Harga jual belum disetting untuk outlet ini: %. Minta admin mengisinya di Menu > Harga per Outlet.',
      array_to_string(v_kurang, ', ');
  end if;

  -- (3) Baru menulis.
  for it in select * from jsonb_array_elements(p_items) loop
    v_pid := (it->>'product_id')::uuid;
    v_qty := (it->>'qty')::numeric;
    if v_pid is null or v_qty is null or v_qty <= 0 then continue; end if;

    v_harga := harga_outlet_aktif(p_outlet, v_pid, p_date);

    insert into sales (
      business_unit_id, outlet_id, sale_date, product_id, qty,
      unit_price, revenue, created_by, submission_id
    ) values (
      p_bu, p_outlet, p_date, v_pid, v_qty,
      v_harga.selling_price, v_harga.selling_price * v_qty, v_uid, p_ref
    )
    returning id into v_sale_id;

    v_jumlah := v_jumlah + 1;
    v_omzet := v_omzet + v_harga.selling_price * v_qty;

    select name into v_nama from products where id = v_pid;
    v_recipe := resep_penjualan(p_outlet, v_pid);

    if v_recipe.id is not null and v_recipe.yield_qty > 0 then
      for r in select ingredient_product_id, qty from recipe_items where recipe_id = v_recipe.id loop
        insert into stock_movements (
          business_unit_id, outlet_id, product_id, movement_type, qty_delta, sale_id, notes, created_by
        ) values (
          p_bu, p_outlet, r.ingredient_product_id, 'usage',
          -(r.qty * v_qty / v_recipe.yield_qty), v_sale_id,
          format('Penjualan %s %s porsi', coalesce(v_nama, '?'), v_qty), v_uid
        );
      end loop;
    end if;
  end loop;

  update sales_submissions
     set item_count = v_jumlah, total_revenue = v_omzet
   where id = p_ref;

  return jsonb_build_object('diproses', true, 'item', v_jumlah, 'omzet', v_omzet);
end;
$$;

revoke all on function record_sales(uuid, uuid, date, jsonb, uuid) from public;
grant execute on function record_sales(uuid, uuid, date, jsonb, uuid) to authenticated;

notify pgrst, 'reload schema';
