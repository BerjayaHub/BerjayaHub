-- =========================================================
-- 0172 — KATEGORI WAJIB & HAPUS ITEM ASET
--
-- Tiga hal, dan yang ketiga memperbaiki jebakan yang ditinggalkan 0170.
--
-- ============ 1. KATEGORI TIDAK BOLEH KOSONG ============
--
-- Kategori menentukan huruf depan kode (Bar -> B001). Item tanpa kategori
-- jatuh ke prefix cadangan dan berkumpul di sana — kodenya tetap unik, tapi
-- tidak lagi memberi tahu apa pun, yang justru satu-satunya gunanya.
--
-- Yang sudah terlanjur kosong diberi nama "Belum dikategorikan". Bukan
-- ditebak isinya: nama itu MENGATAKAN keadaannya, jadi bisa dicari dan
-- dibereskan. Mengarang kategori untuknya akan menyembunyikan pekerjaan yang
-- belum selesai di balik data yang terlihat rapi.
--
-- Kodenya TIDAK berubah. Kode dibuat sekali saat item lahir dan tidak ikut
-- bergeser saat kategorinya dibetulkan — kode yang berubah adalah kode yang
-- sudah tertempel di barang dan tertulis di berita acara.
--
-- ============ 2. HAPUS ITEM DARI SELURUH BU ============
--
-- Dibutuhkan untuk merapikan barang yang sama yang didata dengan nama berbeda
-- antar outlet. Lewat RPC, bukan `delete` biasa, supaya pemanggilnya TAHU apa
-- yang akan hilang sebelum menghapusnya — dan supaya yang hilang tercatat.
--
-- ============ 3. RIWAYAT TIDAK BOLEH IKUT TERHAPUS ============
--
-- `asset_log.asset_item_id` di 0170 memakai `on delete cascade`. Artinya:
-- menghapus satu item ikut menghapus SELURUH riwayatnya — termasuk catatan
-- "siapa menghapus apa", yang justru paling dicari sesudah barang hilang dari
-- daftar.
--
-- Itu baru jadi masalah begitu ada tombol Hapus, dan tombolnya dibuat di
-- berkas ini. Jadi FK-nya diubah jadi `set null`, dan kode + nama itemnya
-- DISIMPAN sebagai teks saat menulis — pelajaran yang sama dengan `oleh_nama`:
-- penunjuk yang bisa menguap tidak cukup untuk riwayat.
-- =========================================================

-- ---------------------------------------------------------
-- 1. RIWAYAT TAHAN HAPUS
-- ---------------------------------------------------------
alter table asset_log add column if not exists business_unit_id uuid references business_units(id) on delete cascade;
alter table asset_log add column if not exists item_kode text;
alter table asset_log add column if not exists item_nama text;

-- Isi untuk baris yang sudah ada, selagi itemnya masih bisa ditemukan.
update asset_log l
   set business_unit_id = i.business_unit_id,
       item_kode = coalesce(l.item_kode, i.kode),
       item_nama = coalesce(l.item_nama, i.name)
  from asset_items i
 where i.id = l.asset_item_id
   and (l.business_unit_id is null or l.item_kode is null or l.item_nama is null);

alter table asset_log drop constraint if exists asset_log_asset_item_id_fkey;
alter table asset_log
  add constraint asset_log_asset_item_id_fkey
  foreign key (asset_item_id) references asset_items(id) on delete set null;

create index if not exists idx_asset_log_bu on asset_log(business_unit_id, at desc);

comment on column asset_log.item_kode is
  'Kode item saat baris ini ditulis. Disimpan sebagai teks supaya riwayat tetap terbaca sesudah itemnya dihapus — penunjuk yang bisa menguap tidak cukup untuk riwayat.';

-- RLS-nya ikut berubah: sesudah item dihapus, `asset_item_id` jadi null dan
-- policy lama (`asset_item_id is null or ...`) akan membuka baris itu untuk
-- SIAPA PUN. `business_unit_id` yang sekarang menentukan.
drop policy if exists asset_log_select on asset_log;
create policy asset_log_select on asset_log
  for select using (
    (business_unit_id is not null and has_bu_scope(auth.uid(), business_unit_id))
    or exists (select 1 from asset_items i where i.id = asset_item_id and has_bu_scope(auth.uid(), i.business_unit_id))
  );

-- ---------------------------------------------------------
-- Trigger stok tahan terhadap itemnya yang sedang dihapus.
--
-- ============ BUG YANG DITEMUKAN SAAT MENGUJI HAPUS ============
--
-- Menghapus item memicu cascade ke `asset_stock`, dan trigger DELETE-nya
-- menulis baris riwayat yang menunjuk item itu — yang pada detik itu sudah
-- tidak ada. FK-nya menolak, dan SELURUH penghapusan gagal dengan pesan
-- tentang `asset_log_asset_item_id_fkey` yang tidak berarti apa pun bagi yang
-- menekan tombolnya.
--
-- Gagal memang lebih baik daripada diam-diam kehilangan riwayat, tapi
-- keduanya bisa dihindari: kalau itemnya sudah tidak ada, barisnya ditulis
-- TANPA penunjuk — identitasnya sudah tersimpan sebagai teks.
-- ---------------------------------------------------------
create or replace function catat_log_stok_aset()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_nama text := nama_pengguna(v_uid);
  v_item uuid;
  v_bu uuid;
  v_kode text;
  v_item_nama text;
begin
  if tg_op = 'INSERT' then
    insert into asset_log (asset_item_id, outlet_id, aksi, kolom, sebelum, sesudah, oleh, oleh_nama)
    values (new.asset_item_id, new.outlet_id, 'didata', 'qty', null, new.qty::text, v_uid, v_nama);
    return new;
  end if;

  if tg_op = 'DELETE' then
    select id, business_unit_id, kode, name into v_item, v_bu, v_kode, v_item_nama
      from asset_items where id = old.asset_item_id;
    if v_item is null then
      -- Itemnya sedang/sudah dihapus. BU diambil dari outletnya supaya RLS
      -- tetap punya pegangan; tanpa itu barisnya terbuka untuk siapa pun.
      select business_unit_id into v_bu from outlets where id = old.outlet_id;
    end if;
    insert into asset_log (asset_item_id, business_unit_id, item_kode, item_nama, outlet_id, aksi, kolom, sebelum, sesudah, oleh, oleh_nama)
    values (v_item, v_bu, v_kode, v_item_nama, old.outlet_id, 'hapus', 'qty', old.qty::text, null, v_uid, v_nama);
    return old;
  end if;

  if new.qty is distinct from old.qty then
    insert into asset_log (asset_item_id, outlet_id, aksi, kolom, sebelum, sesudah, oleh, oleh_nama)
    values (new.asset_item_id, new.outlet_id, 'ubah', 'qty', old.qty::text, new.qty::text, v_uid, v_nama);
  end if;
  if new.condition is distinct from old.condition then
    insert into asset_log (asset_item_id, outlet_id, aksi, kolom, sebelum, sesudah, oleh, oleh_nama)
    values (new.asset_item_id, new.outlet_id, 'ubah', 'kondisi', old.condition, new.condition, v_uid, v_nama);
  end if;
  if new.notes is distinct from old.notes then
    insert into asset_log (asset_item_id, outlet_id, aksi, kolom, sebelum, sesudah, oleh, oleh_nama)
    values (new.asset_item_id, new.outlet_id, 'ubah', 'catatan', old.notes, new.notes, v_uid, v_nama);
  end if;
  if new.outlet_id is distinct from old.outlet_id then
    insert into asset_log (asset_item_id, outlet_id, aksi, kolom, sebelum, sesudah, oleh, oleh_nama)
    values (new.asset_item_id, new.outlet_id, 'pindah', 'outlet',
            (select name from outlets where id = old.outlet_id),
            (select name from outlets where id = new.outlet_id), v_uid, v_nama);
  end if;
  return new;
end;
$$;

-- Trigger pencatat ikut mengisi ketiga kolom baru.
create or replace function isi_identitas_log_aset()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  i record;
begin
  if new.asset_item_id is null then return new; end if;
  select business_unit_id, kode, name into i from asset_items where id = new.asset_item_id;
  new.business_unit_id := coalesce(new.business_unit_id, i.business_unit_id);
  new.item_kode := coalesce(new.item_kode, i.kode);
  new.item_nama := coalesce(new.item_nama, i.name);
  return new;
end;
$$;

drop trigger if exists trg_identitas_log_aset on asset_log;
create trigger trg_identitas_log_aset
  before insert on asset_log
  for each row execute function isi_identitas_log_aset();

-- ---------------------------------------------------------
-- 2. KATEGORI WAJIB
-- ---------------------------------------------------------
do $$
begin
  -- Prefix kategori kosong diganti namanya, BUKAN dibuat baru.
  --
  -- Item yang sudah ada memakai prefix itu; membuat baris baru untuk
  -- "Belum dikategorikan" akan memberi kategori yang sama DUA prefix, dan
  -- item berikutnya mendapat kode yang tidak sejalan dengan saudaranya.
  update asset_category_prefix
     set kategori = 'Belum dikategorikan'
   where btrim(coalesce(kategori, '')) = ''
     and not exists (
       select 1 from asset_category_prefix p2
        where p2.business_unit_id = asset_category_prefix.business_unit_id
          and lower(btrim(p2.kategori)) = 'belum dikategorikan'
     );
end $$;

update asset_items
   set category = 'Belum dikategorikan'
 where btrim(coalesce(category, '')) = '';

alter table asset_items alter column category set not null;
alter table asset_items drop constraint if exists asset_items_category_check;
alter table asset_items add constraint asset_items_category_check check (btrim(category) <> '');

comment on column asset_items.category is
  'WAJIB. Menentukan huruf depan kode. "Belum dikategorikan" dipakai untuk baris lama yang kosong — namanya mengatakan keadaannya supaya bisa dicari dan dibereskan.';

-- `tambah_item_aset` ikut menolak kategori kosong, bukan diam-diam menyimpan
-- null — kalau tidak, satu-satunya penjaga cuma layar, dan jalur lain lolos.
create or replace function tambah_item_aset(p_bu uuid, p_nama text, p_kategori text, p_size text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_nama text := btrim(coalesce(p_nama, ''));
  v_kat text := nullif(btrim(coalesce(p_kategori, '')), '');
  v_id uuid;
  v_kode text;
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  if not has_bu_scope(v_uid, p_bu) then
    raise exception 'Kamu tidak punya akses ke BU ini.';
  end if;
  if v_nama = '' then raise exception 'Nama item wajib diisi.'; end if;
  if v_kat is null then
    raise exception 'Kategori wajib diisi. Pilih dari daftar, atau ketik kategori baru.';
  end if;

  select id, kode into v_id, v_kode from asset_items
   where business_unit_id = p_bu and name = v_nama and category is not distinct from v_kat
   limit 1;
  if v_id is not null then
    return jsonb_build_object('id', v_id, 'kode', v_kode, 'baru', false);
  end if;

  v_kode := kode_aset_berikutnya(p_bu, v_kat);
  insert into asset_items (business_unit_id, kode, name, category, size, created_by)
  values (p_bu, v_kode, v_nama, v_kat, nullif(btrim(coalesce(p_size, '')), ''), v_uid)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'kode', v_kode, 'baru', true);
end;
$$;

revoke all on function tambah_item_aset(uuid, text, text, text) from public;
grant execute on function tambah_item_aset(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------
-- 3. APA YANG AKAN HILANG KALAU ITEM INI DIHAPUS
--
-- Dipanggil layar SEBELUM menghapus. Konfirmasi yang cuma berbunyi "yakin?"
-- tidak memberi tahu apa pun — dan yang menekannya baru tahu isinya sesudah
-- tidak ada lagi.
-- ---------------------------------------------------------
create or replace function dampak_hapus_item_aset(p_item uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_bu uuid;
  v_hasil jsonb;
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  select business_unit_id into v_bu from asset_items where id = p_item;
  if v_bu is null then raise exception 'Item tidak ditemukan.'; end if;
  if not has_bu_scope(v_uid, v_bu) then raise exception 'Item ini di luar BU yang bisa kamu lihat.'; end if;

  select jsonb_build_object(
    'outlet', coalesce((
      select jsonb_agg(jsonb_build_object('outlet', o.name, 'qty', s.qty) order by o.name)
        from asset_stock s join outlets o on o.id = s.outlet_id
       where s.asset_item_id = p_item
    ), '[]'::jsonb),
    'total_unit', coalesce((select sum(qty) from asset_stock where asset_item_id = p_item), 0),
    'outlet_berisi', coalesce((select count(*) from asset_stock where asset_item_id = p_item and qty > 0), 0),
    'kerusakan', coalesce((select count(*) from asset_damage where asset_item_id = p_item), 0),
    'foto', coalesce((
      select count(*) from asset_stock
       where asset_item_id = p_item and btrim(coalesce(photo_path, '')) <> ''
    ), 0)
  ) into v_hasil;

  return v_hasil;
end;
$$;

revoke all on function dampak_hapus_item_aset(uuid) from public;
grant execute on function dampak_hapus_item_aset(uuid) to authenticated;

-- ---------------------------------------------------------
-- 4. HAPUS ITEM
--
-- ============ YANG MENCATAT PENGHAPUSAN ADALAH TRIGGER, BUKAN RPC ============
--
-- RLS mengizinkan Admin BU `delete from asset_items` langsung, tanpa lewat
-- RPC. Kalau yang mencatat cuma RPC-nya, penghapusan lewat jalur itu lenyap
-- tanpa jejak — dan jalur itu justru yang dipakai saat ada yang membereskan
-- data dari luar aplikasi.
--
-- Jadi barisnya ditulis trigger BEFORE DELETE, selagi kode dan namanya masih
-- bisa dibaca. Sesudah itemnya hilang, keduanya tidak ada lagi di mana pun —
-- itu sebabnya trigger cascade di `asset_stock` menuliskan `item_kode` null:
-- bukan karena lupa, tapi karena sudah tidak ada yang bisa dibaca.
--
-- ALASANNYA dititipkan lewat setelan sesi, bukan argumen: trigger tidak punya
-- cara menerima argumen, dan menyalin penulisan log ke dua tempat berarti dua
-- salinan yang pasti menyimpang.
-- ---------------------------------------------------------
create or replace function catat_hapus_item_aset()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_unit numeric;
  v_alasan text := nullif(btrim(coalesce(current_setting('app.alasan_hapus_aset', true), '')), '');
begin
  select coalesce(sum(qty), 0) into v_unit from asset_stock where asset_item_id = old.id;

  insert into asset_log (asset_item_id, business_unit_id, item_kode, item_nama, outlet_id, aksi, kolom, sebelum, sesudah, catatan, oleh, oleh_nama)
  values (
    old.id, old.business_unit_id, old.kode, old.name, null, 'hapus-item', 'item', v_unit::text, null,
    -- Dihapus dari luar aplikasi tidak punya alasan tertulis. Itu DIKATAKAN,
    -- bukan dibiarkan kosong — kosong terbaca seperti alasan yang hilang,
    -- padahal memang tidak pernah ada.
    coalesce(v_alasan, '(dihapus langsung, tanpa alasan tertulis)'),
    v_uid, nama_pengguna(v_uid)
  );
  return old;
end;
$$;

drop trigger if exists trg_hapus_item_aset on asset_items;
create trigger trg_hapus_item_aset
  before delete on asset_items
  for each row execute function catat_hapus_item_aset();
create or replace function hapus_item_aset(p_item uuid, p_alasan text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_bu uuid;
  v_kode text;
  v_nama text;
  v_unit numeric;
  v_outlet int;
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  if btrim(coalesce(p_alasan, '')) = '' then
    -- Alasan WAJIB. Barang yang hilang dari daftar tanpa keterangan akan
    -- dicari orang berminggu-minggu kemudian, dan satu-satunya yang tahu
    -- sudah lupa.
    raise exception 'Alasan penghapusan wajib diisi.';
  end if;

  select business_unit_id, kode, name into v_bu, v_kode, v_nama from asset_items where id = p_item;
  if v_bu is null then raise exception 'Item tidak ditemukan.'; end if;
  if not is_bu_admin(v_uid, v_bu) then
    raise exception 'Hanya Admin BU yang boleh menghapus item — penghapusan berlaku di SEMUA outlet.';
  end if;

  select coalesce(sum(qty), 0), count(*) filter (where qty > 0)
    into v_unit, v_outlet
    from asset_stock where asset_item_id = p_item;

  -- Alasannya dititipkan ke trigger `trg_hapus_item_aset`, yang menulis baris
  -- riwayatnya. Satu penulis saja — lihat catatan di atas.
  perform set_config('app.alasan_hapus_aset', btrim(p_alasan), true);

  -- Stoknya dihapus LEBIH DULU, selagi itemnya masih ada.
  --
  -- Kalau diserahkan ke cascade, trigger DELETE-nya menulis riwayat untuk item
  -- yang pada detik itu sudah hilang — penunjuknya jadi null dan baris "hapus"
  -- per outlet kehilangan identitasnya. Dihapus di sini, tiap outlet tetap
  -- punya barisnya sendiri lengkap dengan kode dan namanya.
  delete from asset_stock where asset_item_id = p_item;

  delete from asset_items where id = p_item;

  return jsonb_build_object('kode', v_kode, 'nama', v_nama, 'unit_hilang', v_unit, 'outlet_berisi', v_outlet);
end;
$$;

revoke all on function hapus_item_aset(uuid, text) from public;
grant execute on function hapus_item_aset(uuid, text) to authenticated;

notify pgrst, 'reload schema';
