-- =========================================================
-- Berjaya Hub OMS — 0108
-- Penjualan yang TIDAK menggerakkan stok harus mengatakannya.
--
-- =========================================================
-- APA YANG SUDAH BENAR (dan sengaja tidak diubah)
-- =========================================================
--
-- Pertanyaannya: "kalau menu terjual, apakah bahannya ikut berkurang, dan
-- apakah ia tetap berkurang walaupun jadi minus?"
--
-- Jawabannya: YA, keduanya. `record_sales` sejak 0101 menulis `stock_movements`
-- bertipe `usage` dengan `qty_delta` negatif sebesar takaran resep, dan tidak
-- ada satu pun penjaga yang menahannya di nol. Stok memang boleh minus, dan
-- itu disengaja — minus adalah cara sistem mengatakan "ada penerimaan yang
-- belum tercatat", dan menahannya di nol hanya akan menyembunyikan selisihnya.
--
-- Jadi tidak ada yang perlu diperbaiki di sana.
--
-- =========================================================
-- YANG SEBENARNYA RUSAK: DIAMNYA
-- =========================================================
--
-- Yang tidak benar adalah cabang `else`-nya — yang selama ini tidak ada:
--
--     if v_recipe.id is not null and v_recipe.yield_qty > 0 then
--       ... potong stok ...
--     end if;                      <-- tidak ada else, tidak ada catatan
--
-- Menu tanpa resep melewati blok itu tanpa jejak. Penjualannya tercatat,
-- omzetnya bertambah, dan stok bahannya tidak bergerak satu gram pun. Di layar,
-- hasilnya identik dengan penjualan yang berhasil sepenuhnya.
--
-- Ada dua sebab yang bentuknya sama persis dari luar:
--
--   1. Menu memang belum punya resep         -> bahannya TIDAK PERNAH terpotong
--   2. Resepnya ada tapi `recipe_items` kosong -> sama, tapi sebabnya beda
--
-- Keduanya dikumpulkan dan dikembalikan supaya layar Penjualan bisa
-- mengatakannya sesudah menyimpan. Yang kedua lebih berbahaya karena di layar
-- Admin, menu itu terlihat berstatus "sudah ada resep".
--
-- =========================================================
-- KENAPA DILAPORKAN, BUKAN DITOLAK
-- =========================================================
--
-- Menolak transaksi menu tanpa resep akan menghentikan penjualan air mineral
-- botolan di kasir yang sedang antre. Sebagian menu memang wajar tidak punya
-- resep. Yang tahu mana yang wajar cuma orangnya — jadi sistem melaporkan, dan
-- orangnya yang memutuskan.
--
-- =========================================================
-- CATATAN TEKNIS
-- =========================================================
--
-- Tipe kembaliannya TETAP `jsonb`, jadi `create or replace` cukup dan tidak
-- akan kena `42P13` seperti yang terjadi pada `receive_dispatch` di 0103.
-- Isi jsonb-nya BERTAMBAH kunci, tidak mengubah kunci lama — pemanggil versi
-- lama (`hasil.diproses`, `hasil.item`, `hasil.omzet`) tetap jalan apa adanya.
-- Ini penting karena PWA yang sudah ter-cache di HP staff tidak ikut berganti
-- versi pada detik yang sama dengan database.
--
-- Badan fungsi ini disalin apa adanya dari 0101 lalu ditambah tiga hal, supaya
-- validasi harga (0099) dan idempotency (0098) tidak ikut bergeser tanpa
-- sengaja. Yang berubah HANYA: dua array penampung, cabang else, dan dua kunci
-- baru di nilai kembalian.
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
  -- Menu yang TERJUAL tapi tidak menggerakkan stok apa pun. Dikumpulkan supaya
  -- bisa dilaporkan balik ke layar, bukan sekadar dilewati diam-diam.
  v_tanpa_resep text[] := '{}';
  v_resep_kosong text[] := '{}';
  v_bahan int;
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
      -- Berapa bahan yang benar-benar dipotong. Dihitung dulu, karena resep
      -- yang ADA tapi ISINYA KOSONG lolos dari `v_recipe.id is not null` dan
      -- menghasilkan nol pergerakan stok — persis seperti menu tanpa resep,
      -- tapi dengan sebab yang berbeda dan perbaikan yang berbeda pula.
      v_bahan := 0;

      for r in select ingredient_product_id, qty from recipe_items where recipe_id = v_recipe.id loop
        insert into stock_movements (
          business_unit_id, outlet_id, product_id, movement_type, qty_delta, sale_id, notes, created_by
        ) values (
          p_bu, p_outlet, r.ingredient_product_id, 'usage',
          -- TIDAK DIBATASI DI NOL, DAN ITU DISENGAJA.
          --
          -- Stok boleh minus. Minus adalah kalimat yang jujur: "terpakai lebih
          -- banyak daripada yang pernah tercatat masuk" — biasanya karena nota
          -- penerimaan belum diinput atau stok awal belum diopname.
          --
          -- Menahannya di nol akan membuat neraca terlihat rapi sambil
          -- menyembunyikan selisihnya, dan selisih yang disembunyikan tidak
          -- akan pernah ditagih siapa pun.
          -(r.qty * v_qty / v_recipe.yield_qty), v_sale_id,
          format('Penjualan %s %s porsi', coalesce(v_nama, '?'), v_qty), v_uid
        );
        v_bahan := v_bahan + 1;
      end loop;

      if v_bahan = 0 then
        v_resep_kosong := array_append(v_resep_kosong, coalesce(v_nama, v_pid::text));
      end if;
    else
      -- MENU TANPA RESEP.
      --
      -- Penjualannya TETAP dicatat — omzetnya nyata dan tidak boleh hilang.
      -- Yang tidak boleh adalah diamnya: sebelum ini, menu tanpa resep
      -- menambah omzet tanpa menyentuh stok sama sekali, dan tidak ada satu
      -- pun tanda di layar. Stok bahannya lalu terlihat "masih banyak" selama
      -- berbulan-bulan sampai ada yang membuka rak dan menemukannya kosong.
      --
      -- Untuk sebagian menu ini memang benar (air mineral botolan yang dibeli
      -- jadi, misalnya, kalau ia tidak didaftarkan sebagai bahan). Karena itu
      -- ia DILAPORKAN, bukan DITOLAK — yang tahu bedanya cuma orangnya.
      v_tanpa_resep := array_append(v_tanpa_resep, coalesce(v_nama, v_pid::text));
    end if;
  end loop;

  update sales_submissions
     set item_count = v_jumlah, total_revenue = v_omzet
   where id = p_ref;

  return jsonb_build_object(
    'diproses', true,
    'item', v_jumlah,
    'omzet', v_omzet,
    -- Array KOSONG, bukan null, saat semuanya beres. Pemanggil yang menulis
    -- `hasil.tanpa_resep.length` pada null akan meledak di layar staff pada
    -- kasus yang justru paling sering terjadi: semuanya normal.
    'tanpa_resep', to_jsonb(v_tanpa_resep),
    'resep_kosong', to_jsonb(v_resep_kosong)
  );
end;
$$;

revoke all on function record_sales(uuid, uuid, date, jsonb, uuid) from public;
grant execute on function record_sales(uuid, uuid, date, jsonb, uuid) to authenticated;

comment on function record_sales(uuid, uuid, date, jsonb, uuid) is
  'Catat penjualan sehari. Stok bahan dipotong sesuai resep dan BOLEH minus. Menu yang tidak menggerakkan stok dilaporkan lewat kunci tanpa_resep / resep_kosong pada nilai kembaliannya.';

notify pgrst, 'reload schema';
