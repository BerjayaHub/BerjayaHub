-- ============================================================
-- 0145 — DUA HP MENGISI SATU DRAFT ORDER, DAN KEDUANYA TERSIMPAN.
--
-- ============ APA YANG TERJADI SEBELUM INI ============
--
-- Direproduksi di Postgres sungguhan sebelum baris ini ditulis:
--
--   10:00:03  Bar menyimpan     -> draft berisi Sirup Vanila 2000
--   10:00:09  Kitchen menyimpan -> draft berisi Daging Sapi 5000
--
-- Sirup milik Bar LENYAP. Tidak ada galat, kedua orang melihat toast hijau
-- "Order diperbarui", dan `edited_by` justru mencatat Kitchen — orang yang
-- tidak menghapus apa pun dengan sengaja.
--
-- Sebabnya `update_stock_order` (0111): ia MENGHAPUS SELURUH ISI lalu mengisi
-- ulang dengan daftar yang dikirim HP itu. Dan daftar yang dikirim HP adalah
-- apa yang dimuatnya SAAT PANEL DIBUKA — bukan isi terkini.
--
-- Ironisnya inilah skenario yang 0110 rancang. Komentarnya sendiri berbunyi
-- "bar mengisi sirup, kitchen menambah daging, ke satu nomor order yang sama".
-- Kepemilikan order sudah dipindah ke outlet; cara menyimpannya tidak ikut.
--
-- ============ YANG DIKIRIM SEKARANG: SELISIH, BUKAN SELURUHNYA ============
--
-- HP mengirim hanya baris yang IA sentuh:
--
--   p_ubah  — baris yang ditambah atau diubah jumlahnya
--   p_hapus — produk yang ia buang dari daftarnya
--
-- Baris yang tidak disebut TIDAK DISENTUH. Sirup yang ditambahkan Bar tidak
-- pernah ikut dalam kiriman Kitchen, jadi tidak ada yang bisa menghapusnya.
--
-- Baris yang HANYA TERLIHAT di layar tapi tidak diubah juga tidak dikirim, dan
-- itu bagian yang mudah terlewat: mengirimnya sebagai "upsert" akan
-- mengembalikan nilai lama ke baris yang baru saja diubah orang lain — bug
-- yang sama persis, cuma pindah dari tingkat dokumen ke tingkat baris.
--
-- ============ KENAPA `update_stock_order` LAMA TIDAK DIBUANG ============
--
-- Tab yang sudah terbuka lama masih memegang kode lama dan akan memanggilnya.
-- Membuangnya membuat layar itu gagal total di tengah penyusunan order.
--
-- Ia dibiarkan apa adanya — perilakunya sama seperti kemarin, tidak lebih
-- buruk. Risiko sisanya jujur disebut: tab lama yang menyimpan MASIH bisa
-- menimpa tambahan orang lain. Memuat ulang halaman menghilangkannya, dan
-- `sw.js` tidak menyimpan aset apa pun di cache, jadi muat ulang sudah cukup.
-- ============================================================

-- ---------------------------------------------------------
-- (1) Simpan selisih, bukan seluruh daftar.
-- ---------------------------------------------------------
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
  -- Disalin apa adanya dari 0111 — kalimat yang diulang akan menyimpang, tapi
  -- menyatukannya berarti menyentuh fungsi lama yang sengaja dibiarkan utuh.
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

    -- `on conflict` memakai indeks unik dari 0129 (order_id, product_id).
    -- Tanpa indeks itu, dua penyimpanan yang bersamaan bisa menghasilkan dua
    -- baris untuk satu produk — dan CK akan menyiapkan barangnya dua kali.
    insert into stock_order_items(order_id, product_id, qty)
    values (p_order, v_pid, v_qty)
    on conflict (order_id, product_id) do update set qty = excluded.qty;
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

  -- Ringkasannya dikembalikan supaya layarnya bisa berkata jujur: berapa yang
  -- ia simpan, dan berapa baris yang ADA di draft sekarang. Selisih keduanya
  -- itulah pekerjaan orang lain — dan orangnya berhak tahu tanpa harus
  -- membuka ulang draftnya.
  return jsonb_build_object('diubah', v_ubah, 'dihapus', v_hapus, 'total', v_total);
end;
$$;

revoke all on function ubah_draft_order(uuid, jsonb, uuid[], text) from public;
grant execute on function ubah_draft_order(uuid, jsonb, uuid[], text) to authenticated;

comment on function ubah_draft_order(uuid, jsonb, uuid[], text) is
  'Menyimpan SELISIH isi draft order: baris yang tidak disebut tidak disentuh. Dibuat supaya dua HP yang mengisi satu draft tidak saling menghapus (0145). Mengembalikan ringkasan {diubah, dihapus, total}.';

-- ---------------------------------------------------------
-- (2) Jejak siapa yang menyentuh baris mana.
--
-- Tanpa ini, `stock_orders.edited_by` hanya menyebut penyimpan TERAKHIR — dan
-- itulah yang membuat kejadian kemarin sulit ditelusuri: jejaknya menunjuk
-- orang yang justru tidak menghapus apa pun dengan sengaja.
-- ---------------------------------------------------------
alter table stock_order_items add column if not exists diubah_by uuid references user_profiles(id) on delete set null;
alter table stock_order_items add column if not exists diubah_at timestamptz;

comment on column stock_order_items.diubah_by is
  'Siapa yang terakhir menyentuh BARIS ini. Berbeda dari stock_orders.edited_by yang hanya mencatat penyimpan terakhir seluruh draft.';

create or replace function catat_pengubah_baris_order()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.diubah_by := auth.uid();
  new.diubah_at := now();
  return new;
end;
$$;

drop trigger if exists trg_catat_pengubah_baris_order on stock_order_items;
create trigger trg_catat_pengubah_baris_order
  before insert or update on stock_order_items
  for each row execute function catat_pengubah_baris_order();

notify pgrst, 'reload schema';
