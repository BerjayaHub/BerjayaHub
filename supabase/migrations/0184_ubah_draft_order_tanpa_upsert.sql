-- =========================================================
-- 0184 — MENGUBAH JUMLAH DI DRAFT ORDER TIDAK LAGI DITOLAK
--
--   "draft nya jeruk nipis 250 gr, lalu di draft ini di ubah menjadi 750 gr,
--    setelah tap simpan perubahan muncul peringatan jeruk nipis sudah ada
--    jangan membuat baris baru, padahal staff tidak membuat baris baru"
--
-- ============ SEBABNYA: `ON CONFLICT` TIDAK MENDAHULUI TRIGGER ============
--
-- `ubah_draft_order` (0145) menyimpan tiap baris begini:
--
--     insert into stock_order_items(order_id, product_id, qty)
--     values (...)
--     on conflict (order_id, product_id) do update set qty = excluded.qty;
--
-- Dan 0129 memasang trigger BEFORE INSERT `tolak_bahan_kembar_order` yang
-- melempar galat kalau produk itu sudah ada di order tersebut.
--
-- Di Postgres, trigger BEFORE INSERT berjalan **sebelum** bentrokan uniknya
-- diperiksa — jadi `on conflict do update` tidak pernah kebagian giliran. Tiap
-- penyimpanan baris yang SUDAH ADA pasti melewati trigger itu lebih dulu, dan
-- pasti ditolak.
--
-- Akibatnya: mengubah jumlah barang yang sudah ada di draft SELALU gagal,
-- dengan kalimat yang menuduh orangnya menambah baris baru. Yang hanya
-- MENAMBAH barang baru tidak pernah mengalaminya — itu sebabnya ini baru
-- ketahuan sekarang, dan sebabnya pesan galatnya terasa mengada-ada.
--
-- ============ PERBAIKANNYA: UBAH DULU, BARU SISIPKAN ============
--
-- `update ... where order_id = ... and product_id = ...` tidak menyentuh
-- `product_id` sama sekali, jadi trigger 0129 (yang hanya mengawasi
-- `insert or update of product_id`) memang tidak ikut berjalan — dan itu
-- benar: baris yang jumlahnya diubah bukan baris kembar.
--
-- `insert` hanya dijalankan kalau barisnya memang belum ada, yaitu satu-satunya
-- keadaan yang trigger itu memang bertugas menjaga.
--
-- Triggernya TIDAK disentuh. Ia yang menahan baris kembar sungguhan dari enam
-- penulis yang berbeda (lihat 0129), dan melonggarkannya demi satu pemanggil
-- berarti membuka kembali persoalan yang jauh lebih sulit dilihat.
-- =========================================================

create or replace function ubah_draft_order(
  p_order uuid,
  p_ubah jsonb,
  p_hapus uuid[],
  p_notes text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_o stock_orders%rowtype;
  v_uid uuid := auth.uid();
  it jsonb;
  v_pid uuid;
  v_qty numeric;
  v_ubah int := 0;
  v_hapus int := 0;
  v_total int;
begin
  if v_uid is null then raise exception 'Harus login'; end if;

  select * into v_o from stock_orders where id = p_order;
  if v_o.id is null then raise exception 'Order tidak ditemukan'; end if;

  -- Pesannya membedakan dua keadaan yang berbeda sebabnya: sudah dikirim
  -- (perlu dibatalkan dulu) vs sudah diproses CK (tidak bisa apa-apa lagi).
  if v_o.status = 'open' then
    raise exception 'Order ini sudah dikirim ke CK. Isinya tidak bisa diubah lagi — batalkan dulu, lalu susun draft baru.';
  end if;
  if v_o.status <> 'draft' then
    raise exception 'Order sudah diproses, tidak bisa diubah';
  end if;

  -- Order milik OUTLET asalnya (0110), bukan milik pembuatnya.
  if not has_outlet_scope(v_uid, v_o.from_outlet_id) then
    raise exception 'Hanya staff outlet asal yang bisa mengubah order ini.';
  end if;

  -- HAPUS DULU, BARU ISI.
  --
  -- Urutannya penting kalau satu produk kebetulan ada di kedua daftar —
  -- misalnya orangnya menghapus satu baris lalu menambahkannya lagi sebelum
  -- menyimpan. Mengisi dulu lalu menghapus akan membuang baris yang baru saja
  -- ia maksudkan untuk ada.
  if p_hapus is not null and array_length(p_hapus, 1) is not null then
    delete from stock_order_items
     where order_id = p_order and product_id = any(p_hapus);
    get diagnostics v_hapus = row_count;
  end if;

  for it in select * from jsonb_array_elements(coalesce(p_ubah, '[]'::jsonb)) loop
    v_pid := (it->>'product_id')::uuid;
    v_qty := (it->>'qty')::numeric;
    if v_pid is null or v_qty is null or v_qty <= 0 then continue; end if;

    -- ============ UBAH DULU, BARU SISIPKAN (0184) ============
    --
    -- BUKAN `insert ... on conflict do update`: trigger BEFORE INSERT dari
    -- 0129 berjalan lebih dulu daripada pemeriksaan bentrokannya, jadi
    -- `on conflict` tidak pernah kebagian giliran dan setiap perubahan jumlah
    -- ditolak dengan kalimat "jangan tambah baris baru".
    update stock_order_items
       set qty = v_qty
     where order_id = p_order and product_id = v_pid;

    if not found then
      -- Baris memang belum ada — ini satu-satunya keadaan yang trigger 0129
      -- bertugas menjaganya, dan di sini ia memang harus berjalan.
      insert into stock_order_items(order_id, product_id, qty)
      values (p_order, v_pid, v_qty);
    end if;
    v_ubah := v_ubah + 1;
  end loop;

  -- CATATAN HANYA DITIMPA KALAU MEMANG DIKIRIM.
  --
  -- `null` berarti "aku tidak menyentuh catatannya", bukan "kosongkan". HP yang
  -- tidak mengubah catatan tidak boleh menghapus catatan yang baru saja ditulis
  -- orang lain di HP sebelah.
  update stock_orders
     set notes = coalesce(p_notes, notes),
         edited_by = v_uid,
         edited_at = now()
   where id = p_order;

  select count(*) into v_total from stock_order_items where order_id = p_order;

  return jsonb_build_object('diubah', v_ubah, 'dihapus', v_hapus, 'total', v_total);
end;
$$;

revoke all on function ubah_draft_order(uuid, jsonb, uuid[], text) from public;
grant execute on function ubah_draft_order(uuid, jsonb, uuid[], text) to authenticated;

comment on function ubah_draft_order(uuid, jsonb, uuid[], text) is
  'Simpan selisih isi draft order. Baris yang sudah ada DIUBAH, bukan di-upsert — trigger 0129 berjalan sebelum `on conflict` (0184).';

notify pgrst, 'reload schema';
