-- =========================================================
-- 0179 — FOTO IKUT BERPINDAH SAAT ASET DITRANSFER ANTAR BU
--
--   "saya transfer asset dari BU awal bermula cafe ke BU Admin, item sudah
--    ter transfer, item sudah masuk ke stock BU Admin, tetapi foto item yang
--    ada di BU awal bermula tidak tampil di BU Admin"
--
-- ============ DUA HAL YANG SAMA-SAMA MENGHALANGI ============
--
-- (1) PENUNJUKNYA TIDAK ADA.
--     `asset_items.photo_path` (0171) dihitung ulang dari `asset_stock` milik
--     ITEM ITU SENDIRI. Transfer lintas BU membuat item BARU di BU tujuan,
--     dan baris stok yang baru masuk belum punya foto — jadi tidak ada yang
--     bisa dihitung, dan penunjuknya tetap kosong.
--
-- (2) BERKASNYA TIDAK BOLEH DIBACA.
--     `asset_photo_select` (0154) mengizinkan membaca foto yang prefix
--     path-nya milik outlet di BU KITA. Berkas aslinya ada di folder outlet BU
--     asal, jadi seandainya penunjuknya ada pun, gambarnya tetap gagal dimuat.
--
-- Keduanya harus dibereskan bersama. Memperbaiki satu saja menghasilkan
-- keadaan yang lebih buruk daripada sekarang: gambar yang SELALU gagal dimuat,
-- yang di layar terbaca persis seperti "barangnya belum difoto".
--
-- ============ KOLOM SENDIRI, BUKAN MENUMPANG `photo_path` ============
--
-- Foto warisan ini TIDAK ditulis ke `asset_items.photo_path`. Kolom itu milik
-- trigger 0171, yang menghitung ulang dari stok BU-nya sendiri dan
-- MENGOSONGKANNYA kalau tidak ada satu pun foto di sana — jadi penunjuk
-- warisan akan terhapus sendiri pada perubahan foto berikutnya, dan hilangnya
-- tidak meninggalkan jejak apa pun.
--
-- Dengan kolom terpisah, aturan 0171 tidak disentuh sama sekali: foto BU
-- sendiri selalu menang, warisan hanya dipakai saat belum ada.
--
-- ============ MENUNJUK, BUKAN MENYALIN — SAMA SEPERTI 0171 ============
--
-- Berkasnya tetap satu, tetap milik outlet asal. Menyalinnya berarti dua
-- berkas yang menyimpang begitu yang asli diganti, dan kuota storage yang
-- bertambah tiap kali ada transfer.
-- =========================================================

alter table asset_items add column if not exists foto_asal_path text;
alter table asset_items add column if not exists foto_asal_outlet_id uuid references outlets(id) on delete set null;

comment on column asset_items.foto_asal_path is
  'PENUNJUK ke foto milik BU ASAL, diwarisi saat aset ditransfer lintas BU. Dipakai hanya kalau BU ini belum punya fotonya sendiri (`photo_path`). Bukan salinan.';

-- ---------------------------------------------------------
-- (1) Foto yang BERLAKU untuk sebuah item: punya sendiri dulu, warisan belakangan
-- ---------------------------------------------------------
create or replace function foto_berlaku_item_aset(p_item uuid)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(nullif(btrim(coalesce(i.photo_path, '')), ''), nullif(btrim(coalesce(i.foto_asal_path, '')), ''))
    from asset_items i
   where i.id = p_item;
$$;

grant execute on function foto_berlaku_item_aset(uuid) to authenticated;

-- ---------------------------------------------------------
-- (2) Wariskan foto ke item tujuan
--
-- Dipanggil dari jalur transfer. Tidak menimpa apa pun yang sudah ada:
-- BU tujuan yang sudah punya fotonya sendiri tidak perlu acuan, dan warisan
-- yang menimpa warisan sebelumnya membuat barang yang sama berganti rupa tiap
-- ada transfer baru.
-- ---------------------------------------------------------
create or replace function wariskan_foto_item_aset(p_dari uuid, p_ke uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_path text;
  v_outlet uuid;
begin
  if p_dari is null or p_ke is null or p_dari = p_ke then return; end if;

  -- Sudah punya foto sendiri ATAU sudah pernah mewarisi: tidak disentuh.
  if exists (
    select 1 from asset_items
     where id = p_ke
       and (btrim(coalesce(photo_path, '')) <> '' or btrim(coalesce(foto_asal_path, '')) <> '')
  ) then
    return;
  end if;

  -- Yang diwariskan adalah foto yang BERLAKU di item asal — jadi item yang
  -- sendirinya mewarisi (transfer berantai A -> B -> C) tetap meneruskan
  -- berkas yang sama, bukan rantai penunjuk yang harus ditelusuri.
  select
    coalesce(nullif(btrim(coalesce(photo_path, '')), ''), nullif(btrim(coalesce(foto_asal_path, '')), '')),
    coalesce(photo_outlet_id, foto_asal_outlet_id)
  into v_path, v_outlet
  from asset_items
  where id = p_dari;

  if v_path is null then return; end if;

  update asset_items
     set foto_asal_path = v_path,
         foto_asal_outlet_id = v_outlet
   where id = p_ke;
end;
$$;

grant execute on function wariskan_foto_item_aset(uuid, uuid) to authenticated;

-- ---------------------------------------------------------
-- (3) Izin baca: foto yang DIWARISI boleh dibuka BU penerimanya
--
-- Penjaganya tetap prefix path untuk jalur biasa (0050/0154). Yang ditambah
-- satu jalur lagi: berkas yang ditunjuk `foto_asal_path` sebuah item di BU
-- yang memang kita punya scope-nya.
--
-- `security definer` supaya pemeriksaannya tidak ikut tunduk pada RLS
-- `asset_items` — kalau ikut, ia akan menolak justru untuk baris yang sedang
-- dipertanyakan, dan hasilnya kembali "gambar yang selalu gagal dimuat".
-- ---------------------------------------------------------
create or replace function boleh_lihat_foto_warisan(p_name text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
      from asset_items i
     where i.foto_asal_path = p_name
       and has_bu_scope(auth.uid(), i.business_unit_id)
  );
$$;

revoke all on function boleh_lihat_foto_warisan(text) from public;
grant execute on function boleh_lihat_foto_warisan(text) to authenticated;

comment on function boleh_lihat_foto_warisan(text) is
  'TRUE kalau objek asset-photos ini diwarisi sebagai foto acuan oleh item di BU yang punya scope user. Dipakai policy baca; tidak mengizinkan menulis apa pun.';

drop policy if exists asset_photo_select on storage.objects;

create policy asset_photo_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'asset-photos'
    and (
      -- Jalur lama, tidak disentuh: BU pemilik berkasnya sendiri.
      has_bu_scope(auth.uid(), asset_photo_bu(name))
      -- Jalur baru: berkas yang diwarisi lewat transfer antar BU.
      or boleh_lihat_foto_warisan(name)
    )
  );

-- ---------------------------------------------------------
-- (4) Jalur transfer ikut mewariskan fotonya
--
-- `kirim_transfer_aset` (0173) dan `ubah_transfer_aset` (0174) ditulis ulang
-- UTUH di sini, dengan satu baris tambahan masing-masing. Ditulis ulang, bukan
-- ditambal: fungsi PL/pgSQL tidak bisa ditambal sepotong, dan menyalin
-- setengahnya ke migration baru adalah cara tercepat dua versi menyimpang.
-- ---------------------------------------------------------
create or replace function kirim_transfer_aset(
  p_from_outlet uuid,
  p_to_outlet uuid,
  p_tujuan_lain text,
  p_pembawa text,
  p_items jsonb,
  p_catatan text default null,
  p_photo_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_nama text;
  v_bu uuid;
  v_bu_tujuan uuid;
  v_id uuid := gen_random_uuid();
  v_kode text;
  v_lain text := nullif(btrim(coalesce(p_tujuan_lain, '')), '');
  it jsonb;
  v_item uuid;
  v_qty numeric;
  v_sisa numeric;
  v_kode_item text;
  v_nama_item text;
  v_kat text;
  v_size text;
  v_item_tujuan uuid;
  v_n int := 0;
begin
  if v_uid is null then raise exception 'Harus login'; end if;

  select business_unit_id into v_bu from outlets where id = p_from_outlet;
  if v_bu is null then raise exception 'Outlet asal tidak dikenal.'; end if;
  if not has_outlet_scope(v_uid, p_from_outlet) then
    raise exception 'Kamu tidak punya akses ke outlet asal.';
  end if;

  if btrim(coalesce(p_pembawa, '')) = '' then
    raise exception 'Nama pembawa barang wajib diisi.';
  end if;

  -- Tujuan: outlet, ATAU teks bebas. Tidak pernah dua-duanya.
  if p_to_outlet is not null and v_lain is not null then
    raise exception 'Pilih salah satu: outlet tujuan ATAU tujuan lain-lain.';
  end if;
  if p_to_outlet is null and v_lain is null then
    -- Barang yang keluar tanpa keterangan ke mana adalah barang yang hilang
    -- dengan surat jalan.
    raise exception 'Tujuan wajib diisi. Pilih outlet, atau tulis tujuannya kalau dikirim ke luar.';
  end if;
  if p_to_outlet is not null then
    select business_unit_id into v_bu_tujuan from outlets where id = p_to_outlet;
    if v_bu_tujuan is null then raise exception 'Outlet tujuan tidak dikenal.'; end if;
    if p_to_outlet = p_from_outlet then raise exception 'Outlet asal dan tujuan tidak boleh sama.'; end if;
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Belum ada barang yang dipilih.';
  end if;

  v_nama := nama_pengguna(v_uid);
  v_kode := 'TA-' || to_char((now() at time zone 'Asia/Jakarta'), 'YYMMDD') || '-' || upper(substr(v_id::text, 1, 4));

  insert into asset_transfer (id, kode, business_unit_id, from_outlet_id, to_outlet_id, tujuan_lain,
                              pembawa, catatan, photo_path, dikirim_by, dikirim_by_nama)
  values (v_id, v_kode, v_bu, p_from_outlet, p_to_outlet, v_lain,
          btrim(p_pembawa), nullif(btrim(coalesce(p_catatan, '')), ''),
          nullif(btrim(coalesce(p_photo_path, '')), ''), v_uid, v_nama);

  for it in select * from jsonb_array_elements(p_items) loop
    v_item := (it->>'item_id')::uuid;
    v_qty := nullif(it->>'qty', '')::numeric;
    if v_item is null or v_qty is null or v_qty <= 0 then continue; end if;

    select kode, name, category, size into v_kode_item, v_nama_item, v_kat, v_size
      from asset_items where id = v_item and business_unit_id = v_bu;
    if v_kode_item is null then
      raise exception 'Barang tidak ditemukan di BU ini.';
    end if;

    -- Kunci barisnya supaya dua pengiriman di detik yang sama tidak sama-sama
    -- membaca sisa yang sama lalu mengirim lebih banyak daripada yang ada.
    select qty into v_sisa from asset_stock
     where asset_item_id = v_item and outlet_id = p_from_outlet
     for update;

    if v_sisa is null then
      raise exception '"%" belum didata di outlet asal, jadi belum ada jumlah yang bisa dikirim.', v_nama_item;
    end if;
    -- Menolak, BUKAN memotong jadi nol: mengirim lebih banyak daripada yang
    -- tercatat berarti salah satu angkanya salah, dan memotongnya diam-diam
    -- menyembunyikan selisih itu.
    if v_qty > v_sisa then
      raise exception 'Tercatat cuma % "%" di outlet asal, tidak bisa mengirim %.', v_sisa, v_nama_item, v_qty;
    end if;

    update asset_stock set qty = qty - v_qty, updated_by = v_uid, updated_at = now()
     where asset_item_id = v_item and outlet_id = p_from_outlet;

    v_item_tujuan := null;
    if p_to_outlet is not null then
      if v_bu_tujuan = v_bu then
        v_item_tujuan := v_item;
      else
        -- Lintas BU: kode milik BU, jadi tidak ikut pindah. Item padanannya
        -- dicari lewat nama + kategori yang SAMA PERSIS, dibuatkan kalau belum
        -- ada — beserta kodenya sendiri di BU tujuan.
        select id into v_item_tujuan from asset_items
         where business_unit_id = v_bu_tujuan and name = v_nama_item and category is not distinct from v_kat
         limit 1;
        if v_item_tujuan is null then
          insert into asset_items (business_unit_id, kode, name, category, size, created_by)
          values (v_bu_tujuan, kode_aset_berikutnya(v_bu_tujuan, v_kat), v_nama_item, v_kat, v_size, v_uid)
          returning id into v_item_tujuan;
        end if;
        -- BARIS INTI 0179: fotonya ikut berpindah sebagai PENUNJUK.
        --
        -- Diletakkan tepat sesudah item tujuan dipastikan ada (dicari atau
        -- dibuat), dan hanya di cabang LINTAS BU — dalam satu BU itemnya sama
        -- persis, jadi fotonya memang sudah yang itu.
        perform wariskan_foto_item_aset(v_item, v_item_tujuan);
      end if;

      insert into asset_stock (asset_item_id, outlet_id, qty, created_by, updated_by)
      values (v_item_tujuan, p_to_outlet, v_qty, v_uid, v_uid)
      on conflict (asset_item_id, outlet_id) do update
        set qty = asset_stock.qty + excluded.qty, updated_by = v_uid, updated_at = now();
    end if;

    insert into asset_transfer_item (transfer_id, asset_item_id, item_kode, item_nama, qty, item_tujuan_id)
    values (v_id, v_item, v_kode_item, v_nama_item, v_qty, v_item_tujuan);

    -- Baris riwayat yang menyebut SEBABNYA. Trigger stok sudah mencatat
    -- angkanya; tanpa baris ini, riwayatnya cuma berbunyi "12 jadi 10" dan
    -- "ke mana yang dua" tetap tidak terjawab.
    insert into asset_log (asset_item_id, business_unit_id, outlet_id, aksi, kolom, sebelum, sesudah, catatan, oleh, oleh_nama)
    values (v_item, v_bu, p_from_outlet, 'transfer-keluar', v_kode, v_qty::text, null,
            v_kode_item || ' → ' || coalesce((select name from outlets where id = p_to_outlet), v_lain), v_uid, v_nama);

    if v_item_tujuan is not null then
      insert into asset_log (asset_item_id, business_unit_id, outlet_id, aksi, kolom, sebelum, sesudah, catatan, oleh, oleh_nama)
      values (v_item_tujuan, v_bu_tujuan, p_to_outlet, 'transfer-masuk', v_kode, null, v_qty::text,
              'dari ' || (select name from outlets where id = p_from_outlet), v_uid, v_nama);
    end if;

    v_n := v_n + 1;
  end loop;

  if v_n = 0 then
    raise exception 'Tidak ada barang yang sah untuk dikirim.';
  end if;

  return jsonb_build_object('id', v_id, 'kode', v_kode, 'jumlah_barang', v_n);
end;
$$;

revoke all on function kirim_transfer_aset(uuid, uuid, text, text, jsonb, text, text) from public;
grant execute on function kirim_transfer_aset(uuid, uuid, text, text, jsonb, text, text) to authenticated;

create or replace function ubah_transfer_aset(
  p_id uuid,
  p_to_outlet uuid,
  p_tujuan_lain text,
  p_pembawa text,
  p_items jsonb,
  p_alasan text,
  p_catatan text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_nama text;
  t record;
  r record;
  v_lain text := nullif(btrim(coalesce(p_tujuan_lain, '')), '');
  v_bu_tujuan uuid;
  v_ada numeric;
  it jsonb;
  v_item uuid;
  v_qty numeric;
  v_sisa numeric;
  v_kode_item text;
  v_nama_item text;
  v_kat text;
  v_size text;
  v_item_tujuan uuid;
  v_n int := 0;
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  if btrim(coalesce(p_alasan, '')) = '' then
    -- Surat jalan yang isinya berubah tanpa keterangan kenapa akan
    -- diperdebatkan nanti oleh dua outlet yang angkanya sama-sama bergeser.
    raise exception 'Alasan revisi wajib diisi.';
  end if;
  if btrim(coalesce(p_pembawa, '')) = '' then
    raise exception 'Nama pembawa barang wajib diisi.';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Belum ada barang yang dipilih. Kalau seluruh kirimannya batal, pakai Batalkan.';
  end if;

  select * into t from asset_transfer where id = p_id for update;
  if t.id is null then raise exception 'Surat jalan tidak ditemukan.'; end if;
  if t.dibatalkan_at is not null then raise exception 'Surat jalan ini sudah dibatalkan, tidak bisa direvisi.'; end if;
  if not is_bu_admin(v_uid, t.business_unit_id) then
    raise exception 'Hanya Admin BU pengirim yang boleh merevisi transfer.';
  end if;

  if p_to_outlet is not null and v_lain is not null then
    raise exception 'Pilih salah satu: outlet tujuan ATAU tujuan lain-lain.';
  end if;
  if p_to_outlet is null and v_lain is null then
    raise exception 'Tujuan wajib diisi.';
  end if;
  if p_to_outlet is not null then
    select business_unit_id into v_bu_tujuan from outlets where id = p_to_outlet;
    if v_bu_tujuan is null then raise exception 'Outlet tujuan tidak dikenal.'; end if;
    if p_to_outlet = t.from_outlet_id then raise exception 'Outlet asal dan tujuan tidak boleh sama.'; end if;
  end if;

  v_nama := nama_pengguna(v_uid);

  -- ============ 1. PERIKSA SELURUH PEMBALIKAN DULU ============
  --
  -- Kalau barang ketiga sudah terpakai di outlet tujuan, revisinya harus gagal
  -- UTUH. Membalikkan dua yang pertama lalu berhenti meninggalkan surat jalan
  -- yang isinya tidak cocok dengan stok mana pun.
  for r in select * from asset_transfer_item where transfer_id = p_id loop
    if r.item_tujuan_id is not null and t.to_outlet_id is not null then
      select qty into v_ada from asset_stock
       where asset_item_id = r.item_tujuan_id and outlet_id = t.to_outlet_id;
      if coalesce(v_ada, 0) < r.qty then
        raise exception 'Tidak bisa direvisi: "%" di outlet tujuan sekarang tinggal %, sedangkan surat jalan ini memindahkan %.',
          r.item_nama, coalesce(v_ada, 0), r.qty;
      end if;
    end if;
  end loop;

  -- ============ 2. BALIKKAN ============
  for r in select * from asset_transfer_item where transfer_id = p_id loop
    if r.asset_item_id is not null then
      update asset_stock set qty = qty + r.qty, updated_by = v_uid, updated_at = now()
       where asset_item_id = r.asset_item_id and outlet_id = t.from_outlet_id;
    end if;
    if r.item_tujuan_id is not null and t.to_outlet_id is not null then
      update asset_stock set qty = qty - r.qty, updated_by = v_uid, updated_at = now()
       where asset_item_id = r.item_tujuan_id and outlet_id = t.to_outlet_id;
    end if;
  end loop;
  delete from asset_transfer_item where transfer_id = p_id;

  -- ============ 3. TERAPKAN YANG BARU ============
  for it in select * from jsonb_array_elements(p_items) loop
    v_item := (it->>'item_id')::uuid;
    v_qty := nullif(it->>'qty', '')::numeric;
    if v_item is null or v_qty is null or v_qty <= 0 then continue; end if;

    select kode, name, category, size into v_kode_item, v_nama_item, v_kat, v_size
      from asset_items where id = v_item and business_unit_id = t.business_unit_id;
    if v_kode_item is null then raise exception 'Barang tidak ditemukan di BU ini.'; end if;

    select qty into v_sisa from asset_stock
     where asset_item_id = v_item and outlet_id = t.from_outlet_id
     for update;
    if v_sisa is null then
      raise exception '"%" belum didata di outlet asal.', v_nama_item;
    end if;
    if v_qty > v_sisa then
      raise exception 'Tercatat cuma % "%" di outlet asal, tidak bisa mengirim %.', v_sisa, v_nama_item, v_qty;
    end if;

    update asset_stock set qty = qty - v_qty, updated_by = v_uid, updated_at = now()
     where asset_item_id = v_item and outlet_id = t.from_outlet_id;

    v_item_tujuan := null;
    if p_to_outlet is not null then
      if v_bu_tujuan = t.business_unit_id then
        v_item_tujuan := v_item;
      else
        select id into v_item_tujuan from asset_items
         where business_unit_id = v_bu_tujuan and name = v_nama_item and category is not distinct from v_kat
         limit 1;
        if v_item_tujuan is null then
          insert into asset_items (business_unit_id, kode, name, category, size, created_by)
          values (v_bu_tujuan, kode_aset_berikutnya(v_bu_tujuan, v_kat), v_nama_item, v_kat, v_size, v_uid)
          returning id into v_item_tujuan;
        end if;
        -- BARIS INTI 0179: fotonya ikut berpindah sebagai PENUNJUK.
        --
        -- Diletakkan tepat sesudah item tujuan dipastikan ada (dicari atau
        -- dibuat), dan hanya di cabang LINTAS BU — dalam satu BU itemnya sama
        -- persis, jadi fotonya memang sudah yang itu.
        perform wariskan_foto_item_aset(v_item, v_item_tujuan);
      end if;

      insert into asset_stock (asset_item_id, outlet_id, qty, created_by, updated_by)
      values (v_item_tujuan, p_to_outlet, v_qty, v_uid, v_uid)
      on conflict (asset_item_id, outlet_id) do update
        set qty = asset_stock.qty + excluded.qty, updated_by = v_uid, updated_at = now();
    end if;

    insert into asset_transfer_item (transfer_id, asset_item_id, item_kode, item_nama, qty, item_tujuan_id)
    values (p_id, v_item, v_kode_item, v_nama_item, v_qty, v_item_tujuan);
    v_n := v_n + 1;
  end loop;

  if v_n = 0 then
    raise exception 'Tidak ada barang yang sah. Kalau seluruh kirimannya batal, pakai Batalkan.';
  end if;

  update asset_transfer
     set to_outlet_id = p_to_outlet,
         tujuan_lain = v_lain,
         pembawa = btrim(p_pembawa),
         catatan = nullif(btrim(coalesce(p_catatan, '')), ''),
         revisi_ke = revisi_ke + 1,
         direvisi_at = now(),
         direvisi_by = v_uid,
         direvisi_by_nama = v_nama,
         alasan_revisi = btrim(p_alasan)
   where id = p_id;

  insert into asset_log (asset_item_id, business_unit_id, outlet_id, aksi, kolom, sebelum, sesudah, catatan, oleh, oleh_nama)
  values (null, t.business_unit_id, t.from_outlet_id, 'revisi-transfer', t.kode,
          coalesce((select name from outlets where id = t.to_outlet_id), t.tujuan_lain),
          coalesce((select name from outlets where id = p_to_outlet), v_lain),
          btrim(p_alasan), v_uid, v_nama);

  return jsonb_build_object('kode', t.kode, 'revisi_ke', t.revisi_ke + 1, 'jumlah_barang', v_n);
end;
$$;

revoke all on function ubah_transfer_aset(uuid, uuid, text, text, jsonb, text, text) from public;
grant execute on function ubah_transfer_aset(uuid, uuid, text, text, jsonb, text, text) to authenticated;

-- ---------------------------------------------------------
-- (5) Backfill: transfer yang SUDAH terlanjur
--
-- Kasus yang dilaporkan sudah terjadi sebelum migration ini ada. Tanpa
-- backfill, satu-satunya cara memperbaikinya adalah mentransfer ulang
-- barangnya — pekerjaan yang tidak ada hubungannya dengan foto.
--
-- Ditelusuri dari `asset_transfer_item`: pasangan (asal -> tujuan) memang
-- disimpan di sana sejak 0173.
-- ---------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select distinct ti.asset_item_id as asal, ti.item_tujuan_id as tujuan
      from asset_transfer_item ti
      join asset_items ia on ia.id = ti.asset_item_id
      join asset_items ib on ib.id = ti.item_tujuan_id
     where ti.asset_item_id is not null
       and ti.item_tujuan_id is not null
       and ia.business_unit_id <> ib.business_unit_id
  loop
    perform wariskan_foto_item_aset(r.asal, r.tujuan);
  end loop;
end $$;

notify pgrst, 'reload schema';
