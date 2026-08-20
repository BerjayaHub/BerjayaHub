-- =========================================================
-- Berjaya Hub OMS — 0099
-- `record_sales()`: harga dari OUTLET, tanpa fallback, tanpa Rp 0, tanpa ganda.
--
-- =========================================================
-- TIGA HAL YANG DIPERBAIKI SEKALIGUS
-- =========================================================
--
-- (1) HARGA DARI OUTLET, BUKAN DARI BU
--     Lama : select sale_price from products where id = v_pid
--     Baru : harga_outlet_aktif(p_outlet, v_pid, p_date)
--
-- (2) TIDAK ADA LAGI `coalesce(v_price, 0)`
--     Baris lama:
--         insert into sales(... revenue ...) values (..., coalesce(v_price,0) * v_qty)
--     Menu yang belum diisi harganya tercatat sebagai penjualan BEROMZET Rp 0.
--     Bukan error, bukan penolakan — baris yang terlihat normal, qty benar,
--     omzet nol. Akibatnya berlipat: omzet BU lebih rendah dari kenyataan;
--     `bauranPenjualan()` membacanya sebagai harga nol sehingga marginnya
--     NEGATIF sebesar HPP dan menarik margin tertimbang ke bawah; BEP jadi
--     lebih jauh; dan stoknya tetap terpotong sehingga selisihnya tidak akan
--     ketahuan dari opname.
--
--     Sekarang: seluruh transaksi DITOLAK, dengan pesan yang menyebut nama menu
--     yang belum berharga.
--
-- (3) KIRIMAN GANDA TIDAK MENGHASILKAN PENJUALAN GANDA
--     Lihat header 0098 untuk alasan bentuknya.
--
-- =========================================================
-- TANPA FALLBACK KE `products.sale_price` — DISENGAJA
-- =========================================================
--
-- Rancangan awal saya menyertakan cadangan: kalau harga outlet belum ada, pakai
-- `products.sale_price`. Itu DIBATALKAN atas permintaan, dan permintaannya
-- benar.
--
-- Cadangan seperti itu membuat outlet yang harganya belum disetel tetap bisa
-- berjualan — dengan harga BU. Transaksinya berhasil, angkanya masuk akal, dan
-- tidak ada satu pun tanda bahwa harga outlet itu tidak pernah diisi. Yang
-- terjadi bukan "sementara pakai harga acuan" melainkan "harga outlet tidak
-- pernah dipakai dan tidak ada yang tahu".
--
-- Menolak transaksi berisik. Tapi berisik yang benar mengalahkan diam yang
-- salah: yang ditolak akan langsung mengisi harganya, sedangkan yang lolos akan
-- menemukan masalahnya berbulan-bulan kemudian dari angka yang tidak bisa
-- dijelaskan.
--
-- =========================================================
-- SIGNATURE LAMA DI-DROP, TIDAK DIBIARKAN HIDUP
-- =========================================================
--
-- `record_sales(uuid, uuid, date, jsonb)` dihapus. Aplikasi ini PWA — versi
-- lama bisa masih terpasang di HP staff. Kalau signature lama dibiarkan,
-- klien lama akan terus menyimpan penjualan dengan harga BU dan tanpa
-- perlindungan ganda, TANPA satu pun error.
--
-- Dengan di-drop, klien lama gagal dengan pesan yang bisa ditindaklanjuti.
-- =========================================================

drop function if exists record_sales(uuid, uuid, date, jsonb);

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
  v_mode text;
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
  v_mode := case when v_role = 'served_by_ck' then 'served_by_ck' else 'standalone' end;

  -- =====================================================================
  -- (1) IDEMPOTENCY — sebelum apa pun ditulis.
  --
  -- `on conflict do nothing` mengembalikan 0 baris kalau penandanya sudah ada.
  -- Itu satu-satunya cara membedakan retry dari shift kedua, dan pemeriksaannya
  -- ATOMIK — dua permintaan bersamaan tidak bisa dua-duanya lolos.
  -- =====================================================================
  insert into sales_submissions (id, business_unit_id, outlet_id, sale_date, created_by)
  values (p_ref, p_bu, p_outlet, p_date, v_uid)
  on conflict (id) do nothing;

  get diagnostics v_baru = row_count;

  if not v_baru then
    -- Sudah pernah diproses. Kembalikan hasil yang tersimpan, JANGAN menulis
    -- apa pun lagi — dan jangan pula melempar error: dari sudut pandang yang
    -- mengirim, kirimannya memang berhasil.
    select * into v_lama from sales_submissions where id = p_ref;
    return jsonb_build_object(
      'diproses', false,
      'alasan', 'Kiriman ini sudah pernah tersimpan',
      'item', v_lama.item_count,
      'omzet', v_lama.total_revenue
    );
  end if;

  -- =====================================================================
  -- (2) VALIDASI HARGA — SELURUH item diperiksa DULU, sebelum satu baris pun
  -- ditulis.
  --
  -- Dikumpulkan semua yang bermasalah, bukan berhenti di yang pertama: admin
  -- yang harus mengisi harga lebih baik tahu SELURUH daftarnya sekali jalan
  -- daripada menemukannya satu per satu lewat penolakan berulang.
  --
  -- Exception di sini membatalkan seluruh transaksi termasuk penyisipan
  -- `sales_submissions` di atas — jadi penandanya ikut hilang dan kiriman yang
  -- sudah diperbaiki tidak akan ditolak sebagai duplikat.
  -- =====================================================================
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

  -- =====================================================================
  -- (3) Baru menulis.
  -- =====================================================================
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
      -- Snapshot. Tidak pernah dibaca ulang dari master sesudah ini.
      v_harga.selling_price, v_harga.selling_price * v_qty, v_uid, p_ref
    );

    v_jumlah := v_jumlah + 1;
    v_omzet := v_omzet + v_harga.selling_price * v_qty;

    -- Pemotongan stok: TIDAK DIUBAH dari perilaku lama, termasuk mundurnya
    -- varian `served_by_ck` ke `standalone` bila variannya tidak ada.
    select * into v_recipe from recipes where product_id = v_pid and mode = v_mode;
    if v_recipe.id is null and v_mode <> 'standalone' then
      select * into v_recipe from recipes where product_id = v_pid and mode = 'standalone';
    end if;

    if v_recipe.id is not null and v_recipe.yield_qty > 0 then
      for r in select ingredient_product_id, qty from recipe_items where recipe_id = v_recipe.id loop
        insert into stock_movements (
          business_unit_id, outlet_id, product_id, movement_type, qty_delta, notes, created_by
        ) values (
          p_bu, p_outlet, r.ingredient_product_id, 'usage',
          -(r.qty * v_qty / v_recipe.yield_qty), 'Penjualan', v_uid
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

comment on function record_sales(uuid, uuid, date, jsonb, uuid) is
  'Catat penjualan. Harga dari outlet_menu_prices (TANPA fallback ke products.sale_price). Menolak seluruh transaksi bila ada menu yang belum berharga. p_ref = penanda kiriman dari klien untuk mencegah penjualan ganda.';

notify pgrst, 'reload schema';
