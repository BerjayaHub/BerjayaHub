-- =========================================================
-- 0169 — ASET: PINDAH & IZIN HAPUS MENGIKUTI BENTUK BARU
--
-- 0168 memecah `assets` jadi `asset_items` + `asset_stock`, tapi meninggalkan
-- dua hal yang masih menunjuk bentuk lama:
--
--   1. `pindah_aset()` membaca tabel `assets` yang sudah tidak ada. Ia TIDAK
--      gagal saat migrasi — ia gagal nanti, saat ada yang menekan "Pindahkan",
--      dengan pesan yang menyebut tabel yang tidak dikenal siapa pun.
--
--   2. Izin HAPUS longgar. `asset_stock_write` dibuat `for all`, dan `for all`
--      ikut mencakup DELETE. 0045 sengaja membatasi penghapusan aset pada
--      admin outlet "supaya data aset tidak mudah hilang"; penjagaan itu
--      hilang tanpa ada yang memutuskannya.
--
-- Keduanya diperbaiki di sini, bukan dengan mengubah 0168 — 0168 sudah
-- terlanjur dijalankan di database sungguhan, dan mengubah migrasi yang sudah
-- jalan berarti berkasnya tidak lagi menggambarkan apa yang ada di sana.
-- =========================================================

-- ---------------------------------------------------------
-- 1. IZIN: TULIS BOLEH STAFF, HAPUS HANYA ADMIN OUTLET
-- ---------------------------------------------------------
drop policy if exists asset_stock_write on asset_stock;

drop policy if exists asset_stock_insert on asset_stock;
create policy asset_stock_insert on asset_stock
  for insert with check (has_outlet_scope(auth.uid(), outlet_id));

drop policy if exists asset_stock_update on asset_stock;
create policy asset_stock_update on asset_stock
  for update using (has_outlet_scope(auth.uid(), outlet_id))
  with check (has_outlet_scope(auth.uid(), outlet_id));

-- Menghapus baris stok mengembalikan item ini ke keadaan "belum didata" di
-- outlet tersebut — jumlah yang sudah dihitung orang hilang dari catatan.
-- Itu kewenangan admin outlet, sama seperti sebelum 0168.
drop policy if exists asset_stock_delete on asset_stock;
create policy asset_stock_delete on asset_stock
  for delete using (is_admin_of_outlet(auth.uid(), outlet_id));

-- ---------------------------------------------------------
-- 2. PINDAH ASET, DITULIS ULANG UNTUK BENTUK BARU
--
-- Yang dipindahkan sekarang BARIS STOK, bukan asetnya: item tetap milik BU.
--
-- ============ PINDAH KE BU LAIN BUKAN LAGI SEKADAR GANTI KOLOM ============
--
-- Dulu satu baris memuat `business_unit_id` sendiri, jadi memindahkannya ke BU
-- lain cukup mengubah satu kolom. Sekarang BU melekat pada ITEM-nya, dan item
-- milik BU tujuan mungkin belum ada.
--
-- Jadi: item yang namanya sama persis di BU tujuan DICARI; kalau tidak ada,
-- DIBUATKAN beserta kodenya sendiri (kode milik BU, tidak ikut berpindah).
-- Kalau outlet tujuan sudah punya item itu, jumlahnya DIJUMLAHKAN — bukan
-- ditimpa, karena dua-duanya barang yang sungguh ada.
-- ---------------------------------------------------------
drop function if exists pindah_aset(uuid[], uuid, uuid);

create or replace function pindah_aset(p_ids uuid[], p_bu uuid, p_outlet uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_bu_outlet uuid;
  v_pindah int := 0;
  v_ditolak int := 0;
  v_beda_outlet int := 0;
  v_item_tujuan uuid;
  v_ada uuid;
  r record;
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    raise exception 'Belum ada aset yang dipilih.';
  end if;
  if p_bu is null or p_outlet is null then
    raise exception 'BU dan outlet tujuan harus diisi.';
  end if;

  select business_unit_id into v_bu_outlet from outlets where id = p_outlet;
  if v_bu_outlet is null then
    raise exception 'Outlet tujuan tidak ditemukan.';
  end if;
  if v_bu_outlet <> p_bu then
    raise exception 'Outlet tujuan bukan milik BU tujuan. Pilih ulang outletnya.';
  end if;

  -- Wewenang di TUJUAN diperiksa sekali di depan: kalau tidak berhak, tidak
  -- ada gunanya memproses satu baris pun, dan pesannya jauh lebih jelas
  -- daripada "0 dari 40 berpindah".
  if not has_outlet_scope(v_uid, p_outlet) then
    raise exception 'Kamu tidak punya akses ke outlet tujuan, jadi aset tidak bisa dipindahkan ke sana.';
  end if;

  for r in
    select s.*, i.name, i.category, i.size as item_size, i.business_unit_id as bu_asal
      from asset_stock s
      join asset_items i on i.id = s.asset_item_id
     where s.id = any(p_ids)
  loop
    -- Wewenang di ASAL diperiksa per baris. Pemilihan massal gampang sekali
    -- ikut menyeret aset outlet lain — terutama saat saringannya "Semua outlet".
    if not has_outlet_scope(v_uid, r.outlet_id) then
      v_ditolak := v_ditolak + 1;
      continue;
    end if;

    if r.outlet_id = p_outlet and r.bu_asal = p_bu then
      continue; -- sudah di sana; bukan kegagalan, bukan pula perpindahan
    end if;

    -- Item di BU tujuan: dicari dulu, dibuat kalau belum ada.
    if r.bu_asal = p_bu then
      v_item_tujuan := r.asset_item_id;
    else
      select id into v_item_tujuan from asset_items
       where business_unit_id = p_bu and name = r.name and category is not distinct from r.category
       limit 1;
      if v_item_tujuan is null then
        insert into asset_items (business_unit_id, kode, name, category, size, created_by)
        values (p_bu, kode_aset_berikutnya(p_bu, coalesce(r.category, '')), r.name, r.category, r.item_size, v_uid)
        returning id into v_item_tujuan;
      end if;
    end if;

    if r.outlet_id <> p_outlet then v_beda_outlet := v_beda_outlet + 1; end if;

    -- Outlet tujuan sudah punya item ini? Jumlahnya DIJUMLAHKAN.
    select id into v_ada from asset_stock
     where asset_item_id = v_item_tujuan and outlet_id = p_outlet;

    if v_ada is not null and v_ada <> r.id then
      update asset_stock
         set qty = qty + r.qty,
             notes = nullif(concat_ws(' | ', nullif(btrim(coalesce(notes, '')), ''), nullif(btrim(coalesce(r.notes, '')), '')), ''),
             condition = case when 'rusak' in (condition, r.condition) then 'rusak'
                              when 'lainnya' in (condition, r.condition) then 'lainnya'
                              else condition end,
             updated_by = v_uid,
             updated_at = now()
       where id = v_ada;
      delete from asset_stock where id = r.id;
    else
      update asset_stock
         set asset_item_id = v_item_tujuan,
             outlet_id = p_outlet,
             -- Foto ditinggalkan di folder outlet lama dan TIDAK bisa dibaca
             -- lagi dari outlet tujuan (izinnya memakai outlet di path-nya).
             -- Kolomnya dikosongkan supaya tidak menunjuk berkas yang selalu
             -- gagal; kliennya yang memindahkan berkasnya lalu mengisi ulang.
             -- "-" yang jujur mengalahkan tautan yang pasti gagal.
             photo_path = case when r.outlet_id <> p_outlet then null else photo_path end,
             updated_by = v_uid,
             updated_at = now()
       where id = r.id;
    end if;

    v_pindah := v_pindah + 1;
    v_ada := null;
  end loop;

  return jsonb_build_object('dipindah', v_pindah, 'ditolak', v_ditolak, 'beda_outlet', v_beda_outlet);
end;
$$;

revoke all on function pindah_aset(uuid[], uuid, uuid) from public;
grant execute on function pindah_aset(uuid[], uuid, uuid) to authenticated;

-- ---------------------------------------------------------
-- 3. RPC: catat jumlah satu item di satu outlet
--
-- Dipakai layar aset. Dibuat sebagai RPC, bukan upsert dari klien, karena
-- PostgREST perlu tahu indeks mana yang jadi acuan konflik — dan baris yang
-- BARU dibuat harus mengembalikan id-nya supaya foto bisa diunggah ke
-- `<outlet>/<id>.<ext>`.
-- ---------------------------------------------------------
create or replace function catat_stok_aset(
  p_item uuid, p_outlet uuid, p_qty numeric,
  p_condition text default 'normal', p_condition_note text default null,
  p_size text default null, p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  if not has_outlet_scope(v_uid, p_outlet) then
    raise exception 'Aset ini di luar outlet yang bisa kamu kelola.';
  end if;
  if p_qty is null or p_qty < 0 then raise exception 'Jumlah tidak boleh kosong atau negatif.'; end if;
  if p_condition not in ('normal', 'rusak', 'lainnya') then
    raise exception 'Kondisi tidak dikenal: %', p_condition;
  end if;

  insert into asset_stock (asset_item_id, outlet_id, qty, condition, condition_note, size, notes, created_by, updated_by)
  values (
    p_item, p_outlet, p_qty, p_condition,
    -- Catatan kondisi hanya berarti untuk "Lain-lain". Membiarkannya saat
    -- kondisinya diubah menyisakan keterangan lama yang menyesatkan.
    case when p_condition = 'lainnya' then nullif(btrim(coalesce(p_condition_note, '')), '') else null end,
    nullif(btrim(coalesce(p_size, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''),
    v_uid, v_uid
  )
  on conflict (asset_item_id, outlet_id) do update
    set qty = excluded.qty,
        condition = excluded.condition,
        condition_note = excluded.condition_note,
        size = excluded.size,
        notes = excluded.notes,
        updated_by = v_uid,
        updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function catat_stok_aset(uuid, uuid, numeric, text, text, text, text) from public;
grant execute on function catat_stok_aset(uuid, uuid, numeric, text, text, text, text) to authenticated;

-- ---------------------------------------------------------
-- 4. RPC: simpan path foto (dipanggil sesudah unggah berhasil)
-- ---------------------------------------------------------
create or replace function set_foto_stok_aset(p_stok uuid, p_path text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_outlet uuid;
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  select outlet_id into v_outlet from asset_stock where id = p_stok;
  if v_outlet is null then raise exception 'Baris aset tidak ditemukan.'; end if;
  if not has_outlet_scope(v_uid, v_outlet) then
    raise exception 'Foto terunggah tapi tidak tercatat — aset ini di luar outlet yang bisa kamu kelola.';
  end if;

  update asset_stock set photo_path = p_path, updated_by = v_uid, updated_at = now() where id = p_stok;
  return p_stok;
end;
$$;

revoke all on function set_foto_stok_aset(uuid, text) from public;
grant execute on function set_foto_stok_aset(uuid, text) to authenticated;

notify pgrst, 'reload schema';
