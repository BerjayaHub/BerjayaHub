-- =========================================================
-- 0170 — ASET: CATATAN KERUSAKAN & RIWAYAT PERUBAHAN
--
-- Dua hal yang selama ini tidak bisa dijawab aplikasi:
--
--   "Bulan lalu piringnya 12, sekarang 8. Ke mana yang empat?"
--   "Siapa yang mengubah jumlahnya, kapan?"
--
-- Sebelum ini jawabannya memang tidak ada di mana pun. Jumlah aset bisa
-- diturunkan siapa saja dengan mengetik angka baru, dan angka lamanya hilang
-- bersama alasannya. Selisih opname lalu jadi perdebatan tanpa bukti.
--
-- ============ KERUSAKAN MENGURANGI JUMLAH, DAN ITU DICATAT ============
--
-- `asset_damage` adalah KEJADIAN: dua piring pecah pada tanggal sekian, oleh
-- siapa dicatat, dengan fotonya. Jumlah di `asset_stock` berkurang sebagai
-- AKIBAT, bukan sebagai gantinya.
--
-- Mengurangi jumlahnya saja — tanpa baris kejadian — akan menghasilkan angka
-- yang benar hari ini dan tidak bisa dijelaskan bulan depan.
--
-- ============ FOTO WAJIB ============
--
-- Diminta begitu, dan kolomnya NOT NULL supaya betul-betul begitu. Kalau
-- "wajib" cuma dijaga layar, jalur lain (impor, perbaikan manual, layar yang
-- ditulis nanti) akan melewatinya tanpa ada yang menyadarinya.
--
-- Fotonya karena itu diunggah LEBIH DULU, dengan nama berkas yang dibuat
-- klien — bukan sesudah barisnya ada. Kalau barisnya dibuat dulu lalu fotonya
-- menyusul, kegagalan unggah meninggalkan catatan kerusakan tanpa bukti,
-- yaitu persis yang tidak boleh ada.
--
-- ============ RIWAYAT DIISI TRIGGER, BUKAN OLEH LAYAR ============
--
-- `asset_log` ditulis oleh trigger di database. Kalau ia ditulis oleh layar,
-- setiap jalur baru harus ingat menuliskannya — dan yang lupa tidak
-- menghasilkan galat, cuma riwayat yang bolong justru pada perubahan yang
-- paling perlu ditelusuri.
--
-- Nama pelakunya DISIMPAN sebagai teks, bukan cuma id. `on delete set null`
-- pada user yang keluar akan menghapus satu-satunya penunjuk "siapa", dan
-- riwayat yang pelakunya hilang tidak lebih baik daripada tidak ada riwayat.
-- =========================================================

-- ---------------------------------------------------------
-- 1. KEJADIAN KERUSAKAN
-- ---------------------------------------------------------
create table if not exists asset_damage (
  id              uuid primary key default gen_random_uuid(),
  asset_item_id   uuid not null references asset_items(id) on delete cascade,
  outlet_id       uuid not null references outlets(id) on delete cascade,

  qty             numeric not null check (qty > 0),
  jenis           text not null default 'rusak' check (jenis in ('rusak', 'pecah', 'hilang')),
  sebab           text,

  -- WAJIB. Lihat catatan di kepala berkas.
  photo_path      text not null check (btrim(photo_path) <> ''),

  -- Tanggal KEJADIAN, bukan tanggal pengetikan.
  --
  -- Barang pecah Sabtu dan baru dicatat Senin adalah keadaan normal. Memakai
  -- tanggal pengetikan membuat rekap bulanan meleset di tiap pergantian bulan,
  -- dan tidak ada yang bisa membetulkannya belakangan.
  tanggal         date not null default (now() at time zone 'Asia/Jakarta')::date,

  dilapor_by      uuid references user_profiles(id) on delete set null,
  dilapor_by_nama text,
  created_at      timestamptz not null default now(),

  dibatalkan_at   timestamptz,
  dibatalkan_by   uuid references user_profiles(id) on delete set null,
  dibatalkan_by_nama text,
  alasan_batal    text
);

create index if not exists idx_asset_damage_item on asset_damage(asset_item_id, outlet_id);
create index if not exists idx_asset_damage_tanggal on asset_damage(outlet_id, tanggal desc);

comment on table asset_damage is
  'Kejadian barang rusak/pecah/hilang. Jumlah di asset_stock berkurang sebagai AKIBAT baris ini, bukan sebagai gantinya.';

-- ---------------------------------------------------------
-- 2. RIWAYAT PERUBAHAN
-- ---------------------------------------------------------
create table if not exists asset_log (
  id            uuid primary key default gen_random_uuid(),
  asset_item_id uuid references asset_items(id) on delete cascade,
  outlet_id     uuid references outlets(id) on delete set null,

  aksi          text not null,
  kolom         text,
  sebelum       text,
  sesudah       text,
  catatan       text,

  oleh          uuid references user_profiles(id) on delete set null,
  -- Disimpan saat menulis. Lihat catatan di kepala berkas.
  oleh_nama     text,
  at            timestamptz not null default now()
);

create index if not exists idx_asset_log_item on asset_log(asset_item_id, at desc);
create index if not exists idx_asset_log_outlet on asset_log(outlet_id, at desc);

comment on table asset_log is
  'Riwayat perubahan aset: dari berapa jadi berapa, oleh siapa, kapan. Diisi TRIGGER supaya tidak bisa terlewat lewat jalur mana pun.';

-- ---------------------------------------------------------
-- 3. TRIGGER PENCATAT
-- ---------------------------------------------------------
create or replace function nama_pengguna(p_uid uuid)
returns text
language sql
stable
as $$ select full_name from user_profiles where id = p_uid $$;

create or replace function catat_log_stok_aset()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_nama text := nama_pengguna(v_uid);
begin
  if tg_op = 'INSERT' then
    insert into asset_log (asset_item_id, outlet_id, aksi, kolom, sebelum, sesudah, oleh, oleh_nama)
    values (new.asset_item_id, new.outlet_id, 'didata', 'qty', null, new.qty::text, v_uid, v_nama);
    return new;
  end if;

  if tg_op = 'DELETE' then
    insert into asset_log (asset_item_id, outlet_id, aksi, kolom, sebelum, sesudah, oleh, oleh_nama)
    values (old.asset_item_id, old.outlet_id, 'hapus', 'qty', old.qty::text, null, v_uid, v_nama);
    return old;
  end if;

  -- UPDATE: satu baris log per KOLOM yang berubah.
  --
  -- Bukan satu baris berisi seluruh isinya. Riwayat yang menyimpan salinan
  -- utuh memaksa yang membacanya membandingkan sendiri dua baris panjang untuk
  -- menemukan apa yang sebenarnya berubah — dan itulah satu-satunya hal yang
  -- ingin ia ketahui.
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

drop trigger if exists trg_log_stok_aset on asset_stock;
create trigger trg_log_stok_aset
  after insert or update or delete on asset_stock
  for each row execute function catat_log_stok_aset();

create or replace function catat_log_item_aset()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_nama text := nama_pengguna(v_uid);
begin
  -- Nama & kategori berlaku di SELURUH outlet, jadi perubahannya dicatat tanpa
  -- outlet — kalau tidak, ia akan terlihat seperti kejadian milik satu outlet.
  if new.name is distinct from old.name then
    insert into asset_log (asset_item_id, outlet_id, aksi, kolom, sebelum, sesudah, oleh, oleh_nama)
    values (new.id, null, 'ubah', 'nama', old.name, new.name, v_uid, v_nama);
  end if;
  if new.category is distinct from old.category then
    insert into asset_log (asset_item_id, outlet_id, aksi, kolom, sebelum, sesudah, oleh, oleh_nama)
    values (new.id, null, 'ubah', 'kategori', old.category, new.category, v_uid, v_nama);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_log_item_aset on asset_items;
create trigger trg_log_item_aset
  after update on asset_items
  for each row execute function catat_log_item_aset();

-- ---------------------------------------------------------
-- 4. RPC: catat kerusakan (mengurangi jumlah)
-- ---------------------------------------------------------
create or replace function catat_kerusakan_aset(
  p_item uuid, p_outlet uuid, p_qty numeric, p_jenis text,
  p_photo_path text, p_sebab text default null, p_tanggal date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_nama text;
  v_sisa numeric;
  v_tgl date := coalesce(p_tanggal, (now() at time zone 'Asia/Jakarta')::date);
  v_id uuid;
  v_nama_barang text;
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  if not has_outlet_scope(v_uid, p_outlet) then
    raise exception 'Aset ini di luar outlet yang bisa kamu kelola.';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'Jumlah yang rusak harus lebih dari nol.';
  end if;
  if p_jenis not in ('rusak', 'pecah', 'hilang') then
    raise exception 'Jenis "%" tidak dikenal. Isi: rusak, pecah, atau hilang.', p_jenis;
  end if;
  if btrim(coalesce(p_photo_path, '')) = '' then
    raise exception 'Foto bukti wajib dilampirkan.';
  end if;
  -- Tanggal mundur BOLEH (barang pecah Sabtu, dicatat Senin). Tanggal MAJU
  -- tidak: ia tidak pernah berarti apa pun, dan membuat rekap bulan berjalan
  -- memuat kejadian yang belum terjadi.
  if v_tgl > (now() at time zone 'Asia/Jakarta')::date then
    raise exception 'Tanggal kerusakan tidak boleh di masa depan.';
  end if;

  v_nama := nama_pengguna(v_uid);

  select qty into v_sisa from asset_stock
   where asset_item_id = p_item and outlet_id = p_outlet
   for update;

  if v_sisa is null then
    raise exception 'Barang ini belum didata di outlet tersebut, jadi belum ada jumlah yang bisa dikurangi.';
  end if;

  -- Menolak, BUKAN memotong jadi nol.
  --
  -- Melaporkan 12 pecah dari 8 yang tercatat berarti salah satu angkanya
  -- salah — entah jumlah tercatatnya, entah yang baru diketik. Memotongnya
  -- diam-diam jadi nol menyembunyikan selisih itu, dan selisih yang
  -- disembunyikan tidak pernah diperiksa siapa pun.
  if p_qty > v_sisa then
    select name into v_nama_barang from asset_items where id = p_item;
    raise exception 'Tercatat cuma % "%" di outlet ini, tidak bisa mencatat % rusak. Betulkan dulu jumlahnya kalau catatannya yang keliru.',
      v_sisa, coalesce(v_nama_barang, '-'), p_qty;
  end if;

  insert into asset_damage (asset_item_id, outlet_id, qty, jenis, sebab, photo_path, tanggal, dilapor_by, dilapor_by_nama)
  values (p_item, p_outlet, p_qty, p_jenis, nullif(btrim(coalesce(p_sebab, '')), ''), p_photo_path, v_tgl, v_uid, v_nama)
  returning id into v_id;

  update asset_stock
     set qty = qty - p_qty, updated_by = v_uid, updated_at = now()
   where asset_item_id = p_item and outlet_id = p_outlet;

  -- Baris log dari trigger sudah mencatat angkanya; yang ini menjelaskan
  -- SEBABNYA. Tanpa ini, riwayatnya cuma berbunyi "12 jadi 10" dan pertanyaan
  -- "ke mana yang dua" tetap tidak terjawab.
  insert into asset_log (asset_item_id, outlet_id, aksi, kolom, sebelum, sesudah, catatan, oleh, oleh_nama)
  values (p_item, p_outlet, 'rusak', p_jenis, null, p_qty::text,
          nullif(btrim(coalesce(p_sebab, '')), ''), v_uid, v_nama);

  return jsonb_build_object('id', v_id, 'sisa', v_sisa - p_qty);
end;
$$;

revoke all on function catat_kerusakan_aset(uuid, uuid, numeric, text, text, text, date) from public;
grant execute on function catat_kerusakan_aset(uuid, uuid, numeric, text, text, text, date) to authenticated;

-- ---------------------------------------------------------
-- 5. RPC: batalkan kerusakan (admin outlet) — jumlahnya kembali
--
-- Tanpa ini, salah ketik "50" yang seharusnya "5" cuma bisa dibetulkan dengan
-- mengubah jumlahnya langsung — dan itu menghapus jejak kejadiannya sambil
-- meninggalkan catatan kerusakan yang salah berdiri sendiri.
-- ---------------------------------------------------------
create or replace function batalkan_kerusakan_aset(p_id uuid, p_alasan text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  r record;
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  if btrim(coalesce(p_alasan, '')) = '' then
    raise exception 'Alasan pembatalan wajib diisi.';
  end if;

  select * into r from asset_damage where id = p_id for update;
  if r.id is null then raise exception 'Catatan kerusakan tidak ditemukan.'; end if;
  if r.dibatalkan_at is not null then raise exception 'Catatan ini sudah dibatalkan.'; end if;
  if not is_admin_of_outlet(v_uid, r.outlet_id) then
    raise exception 'Hanya admin outlet yang boleh membatalkan catatan kerusakan.';
  end if;

  update asset_damage
     set dibatalkan_at = now(), dibatalkan_by = v_uid,
         dibatalkan_by_nama = nama_pengguna(v_uid), alasan_batal = btrim(p_alasan)
   where id = p_id;

  -- Jumlahnya DIKEMBALIKAN, bukan barisnya dihapus: yang dibatalkan tetap
  -- terlihat di riwayat beserta alasannya.
  update asset_stock
     set qty = qty + r.qty, updated_by = v_uid, updated_at = now()
   where asset_item_id = r.asset_item_id and outlet_id = r.outlet_id;

  insert into asset_log (asset_item_id, outlet_id, aksi, kolom, sebelum, sesudah, catatan, oleh, oleh_nama)
  values (r.asset_item_id, r.outlet_id, 'batal-rusak', r.jenis, r.qty::text, null,
          btrim(p_alasan), v_uid, nama_pengguna(v_uid));

  return jsonb_build_object('dikembalikan', r.qty);
end;
$$;

revoke all on function batalkan_kerusakan_aset(uuid, text) from public;
grant execute on function batalkan_kerusakan_aset(uuid, text) to authenticated;

-- ---------------------------------------------------------
-- 6. RLS
-- ---------------------------------------------------------
alter table asset_damage enable row level security;
alter table asset_log enable row level security;

drop policy if exists asset_damage_select on asset_damage;
create policy asset_damage_select on asset_damage
  for select using (
    exists (select 1 from asset_items i where i.id = asset_item_id and has_bu_scope(auth.uid(), i.business_unit_id))
  );

-- Ditulis LEWAT RPC saja (`security definer`), jadi tidak ada policy insert/
-- update/delete di sini. Membuka `insert` langsung berarti baris kerusakan
-- bisa dibuat tanpa mengurangi jumlahnya — catatan dan angka jadi berbeda,
-- dan tidak ada yang memberi tahu.
drop policy if exists asset_log_select on asset_log;
create policy asset_log_select on asset_log
  for select using (
    asset_item_id is null
    or exists (select 1 from asset_items i where i.id = asset_item_id and has_bu_scope(auth.uid(), i.business_unit_id))
  );

notify pgrst, 'reload schema';
