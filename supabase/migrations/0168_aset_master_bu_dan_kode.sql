-- =========================================================
-- 0168 — ASET: SATU DAFTAR ITEM SE-BU, JUMLAHNYA PER OUTLET
--
-- Sebelum ini, satu baris `assets` adalah "barang X di outlet Y". Akibatnya
-- daftar aset tiap outlet berdiri sendiri: nama diketik ulang di tiap outlet,
-- dan "Kursi Bar" di satu outlet tidak punya hubungan apa pun dengan "Kursi
-- Bar" di outlet sebelah. Tidak ada yang bisa menjawab "berapa kursi bar yang
-- kita punya" tanpa mencocokkan nama dengan mata.
--
-- Sesudah ini:
--   `asset_items` — DAFTAR ITEM milik BU. Nama, kategori, dan KODE.
--   `asset_stock` — JUMLAHNYA di satu outlet, beserta kondisi, catatan, foto.
--
-- Yang membedakan outlet A dan outlet B cuma isi `asset_stock`.
--
-- ============ KODE DIBUAT DATABASE, BUKAN DIKETIK ORANG ============
--
-- Kode = huruf depan kategori + nomor urut: Bar -> B001, Kitchen -> K001.
-- Staff tidak pernah mengetiknya.
--
-- Prefix TIDAK dihitung ulang tiap kali dibutuhkan, melainkan DISIMPAN di
-- `asset_category_prefix`. Kalau ia dihitung ulang, menambah kategori baru
-- yang berawalan sama ("Bathroom" sesudah "Bar") bisa mengubah prefix kategori
-- yang SUDAH punya kode — dan kode yang berubah adalah kode yang sudah
-- tertempel di barang fisik, tertulis di berita acara, dan disebut di WhatsApp.
--
-- ============ KENAPA PEMBUAT KODE HANYA ADA DI SQL ============
--
-- Aturan prefix (huruf depan, diperpanjang saat bentrok) hanya ditulis SEKALI,
-- di `prefix_kategori_aset()`. Sisi JavaScript tidak pernah menghitungnya
-- sendiri — ia cuma menampilkan apa yang dikembalikan database.
--
-- Dua salinan aturan yang sama di dua bahasa pasti menyimpang pada perbaikan
-- berikutnya, dan penyimpangannya tidak akan memunculkan galat: layarnya
-- menjanjikan "B002", databasenya memberi "BA001", dan yang pertama sudah
-- terlanjur dibacakan ke orang.
--
-- ============ APA YANG TERJADI PADA DATA LAMA ============
--
-- Baris yang KATEGORI DAN NAMANYA SAMA PERSIS digabung jadi satu item; huruf
-- besar-kecil dan spasi harus identik. Itu bukan tebakan — string yang sama
-- memang barang yang sama.
--
-- Yang cuma beda huruf besar, spasi, atau ejaan ("Kursi Bar" vs "kursi bar")
-- SENGAJA TIDAK disentuh. Keputusan itu milik orang yang punya barangnya, dan
-- penggabungan yang salah tidak bisa dibatalkan. Dugaan kembarnya dilaporkan
-- lewat `v_aset_dugaan_kembar` untuk dirapikan dari Admin Portal.
--
-- Tabel lamanya TIDAK dihapus — ia diganti nama jadi `assets_sebelum_0168`.
-- Backfill yang meleset harus bisa diperiksa terhadap aslinya, bukan dipercaya.
-- =========================================================

-- ---------------------------------------------------------
-- 1. PREFIX PER KATEGORI
-- ---------------------------------------------------------
create table if not exists asset_category_prefix (
  id               uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references business_units(id) on delete cascade,
  -- Kategori kosong disimpan sebagai '' (bukan null) supaya indeks uniknya
  -- bekerja: di Postgres, null tidak pernah sama dengan null, jadi kategori
  -- tanpa nama akan mendapat prefix baru setiap kali dipanggil.
  kategori         text not null default '',
  prefix           text not null,
  created_at       timestamptz not null default now()
);

create unique index if not exists asset_prefix_kategori_uk
  on asset_category_prefix(business_unit_id, lower(btrim(kategori)));
create unique index if not exists asset_prefix_unik
  on asset_category_prefix(business_unit_id, prefix);

comment on table asset_category_prefix is
  'Huruf depan kode aset per kategori. DISIMPAN, bukan dihitung ulang — kode yang sudah tertempel di barang tidak boleh berubah karena ada kategori baru.';

-- ---------------------------------------------------------
-- 2. MASTER ITEM (milik BU)
-- ---------------------------------------------------------
create table if not exists asset_items (
  id               uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references business_units(id) on delete cascade,
  kode             text not null,
  name             text not null,
  category         text,
  -- Ukuran acuan item. `asset_stock.size` boleh berbeda per outlet — lihat
  -- catatan di tabel itu.
  size             text,
  is_active        boolean not null default true,
  created_by       uuid references user_profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_by       uuid references user_profiles(id) on delete set null,
  updated_at       timestamptz not null default now()
);

create unique index if not exists asset_items_kode_uk
  on asset_items(business_unit_id, upper(btrim(kode)));

-- SENGAJA TIDAK UNIK.
--
-- Sesudah backfill, "Kursi Bar" dan "kursi bar" hidup berdampingan dengan
-- sengaja — merekalah yang menunggu diputuskan orangnya. Indeks unik di sini
-- akan membuat migrasinya gagal di tengah, pada data yang justru paling perlu
-- dibaca.
create index if not exists idx_asset_items_nama
  on asset_items(business_unit_id, lower(btrim(name)));
create index if not exists idx_asset_items_kategori
  on asset_items(business_unit_id, category);

comment on table asset_items is
  'Daftar item aset milik satu BU: nama, kategori, kode. Jumlahnya ada di asset_stock.';

-- ---------------------------------------------------------
-- 3. STOK PER OUTLET
-- ---------------------------------------------------------
create table if not exists asset_stock (
  -- ============ ID-NYA SENGAJA DIWARISI DARI `assets` LAMA ============
  --
  -- Foto tersimpan di bucket dengan path `<outlet_id>/<asset_id>.<ext>`.
  -- Memberi baris ini id baru berarti SELURUH foto aset yang sudah ada
  -- kehilangan barisnya — tidak terhapus, tapi tidak bisa ditemukan lagi, dan
  -- tidak ada galat yang memberi tahu. Backfill di bawah menyalin id lamanya.
  id             uuid primary key default gen_random_uuid(),
  asset_item_id  uuid not null references asset_items(id) on delete cascade,
  outlet_id      uuid not null references outlets(id) on delete cascade,

  qty            numeric not null default 0 check (qty >= 0),

  -- Kondisi, catatan, ukuran, dan foto melekat pada BARANG DI OUTLET INI,
  -- bukan pada itemnya. Kursi bar di outlet A bisa rusak sementara yang di
  -- outlet B normal; menaruhnya di item akan membuat satu outlet menulis
  -- kondisi barang outlet lain.
  condition      text not null default 'normal' check (condition in ('normal', 'rusak', 'lainnya')),
  condition_note text,
  size           text,
  notes          text,
  photo_path     text,

  created_by     uuid references user_profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_by     uuid references user_profiles(id) on delete set null,
  updated_at     timestamptz not null default now()
);

create unique index if not exists asset_stock_uk on asset_stock(asset_item_id, outlet_id);
create index if not exists idx_asset_stock_outlet on asset_stock(outlet_id);

comment on table asset_stock is
  'Jumlah & kondisi satu item di satu outlet. TIDAK ADANYA baris berarti outlet itu BELUM MENDATA item tersebut — berbeda dari baris berisi 0, yang berarti sudah didata dan memang tidak punya.';

-- ---------------------------------------------------------
-- 4. PEMBUAT PREFIX & KODE
-- ---------------------------------------------------------

/**
 * Ambil (atau buat) prefix untuk sebuah kategori.
 *
 * Huruf depan kategori; kalau sudah dipakai kategori lain di BU yang sama,
 * diperpanjang satu huruf, lalu dua, dst. Kalau hurufnya habis, dibubuhi angka.
 */
create or replace function prefix_kategori_aset(p_bu uuid, p_kategori text)
returns text
language plpgsql
as $$
declare
  v_kat text := btrim(coalesce(p_kategori, ''));
  v_huruf text;
  v_calon text;
  v_i int;
  v_ada text;
begin
  select prefix into v_ada from asset_category_prefix
   where business_unit_id = p_bu and lower(btrim(kategori)) = lower(v_kat);
  if v_ada is not null then return v_ada; end if;

  -- Hanya huruf A-Z yang dipakai. "Alat & Perkakas" -> "ALATPERKAKAS";
  -- kategori yang tidak memuat satu pun huruf (mis. "2024") jatuh ke 'X'.
  v_huruf := upper(regexp_replace(v_kat, '[^A-Za-z]', '', 'g'));
  if v_huruf = '' then v_huruf := 'X'; end if;

  for v_i in 1..length(v_huruf) loop
    v_calon := substr(v_huruf, 1, v_i);
    exit when not exists (
      select 1 from asset_category_prefix where business_unit_id = p_bu and prefix = v_calon
    );
    v_calon := null;
  end loop;

  -- ============ CADANGAN MEMAKAI HURUF, BUKAN ANGKA ============
  --
  -- Seluruh awalannya sudah terpakai (mis. "Bar" sesudah "B", "BA", "BAR").
  -- Versi pertama membubuhkan ANGKA: prefix "X2", kode "X2007".
  --
  -- Kode itu TIDAK BISA DIBACA BALIK. "X2007" sama masuk akalnya dibaca
  -- sebagai X2 nomor 007 maupun X nomor 2007 — dan layar yang mengurutkan
  -- atau mengelompokkan kode harus menebak. Tebakannya tidak memunculkan
  -- galat; ia cuma menaruh barang di tempat yang salah dalam daftar.
  --
  -- Dengan huruf ("XA", "XB"), nomornya selalu bagian angka di belakang dan
  -- prefixnya selalu bagian huruf di depan. Tidak ada yang perlu ditebak.
  if v_calon is null then
    for v_i in 1..26 loop
      v_calon := substr(v_huruf, 1, 1) || chr(64 + v_i);
      exit when not exists (
        select 1 from asset_category_prefix where business_unit_id = p_bu and prefix = v_calon
      );
      v_calon := null;
    end loop;
  end if;
  if v_calon is null then
    raise exception 'Tidak bisa membuat kode untuk kategori "%" — terlalu banyak kategori berawalan sama.', v_kat;
  end if;

  insert into asset_category_prefix (business_unit_id, kategori, prefix)
  values (p_bu, v_kat, v_calon)
  on conflict do nothing;

  -- Dibaca ulang, bukan dipakai nilai lokalnya: kalau ada yang menyisipkan
  -- prefix untuk kategori ini di detik yang sama, yang menang adalah barisnya,
  -- dan dua pemanggil harus pulang dengan jawaban yang SAMA.
  select prefix into v_ada from asset_category_prefix
   where business_unit_id = p_bu and lower(btrim(kategori)) = lower(v_kat);
  return v_ada;
end;
$$;

/**
 * Nomor urut berikutnya untuk sebuah prefix di satu BU.
 *
 * ============ KENAPA MENGUNCI BARIS PREFIXNYA ============
 *
 * Dua staff di dua outlet menambah item di detik yang sama. Tanpa kunci,
 * keduanya membaca "nomor tertinggi = 7" dan keduanya menulis B008 — yang
 * kedua ditolak indeks unik, dan staffnya melihat galat yang tidak bisa
 * dijelaskan ("kode sudah dipakai", padahal ia tidak pernah mengetik kode).
 *
 * `for update` pada baris prefix membuat yang kedua menunggu, lalu membaca 8.
 */
create or replace function kode_aset_berikutnya(p_bu uuid, p_kategori text)
returns text
language plpgsql
as $$
declare
  v_prefix text := prefix_kategori_aset(p_bu, p_kategori);
  v_nomor int;
begin
  perform 1 from asset_category_prefix
   where business_unit_id = p_bu and prefix = v_prefix
   for update;

  select coalesce(max(substr(kode, length(v_prefix) + 1)::int), 0) + 1
    into v_nomor
    from asset_items
   where business_unit_id = p_bu
     and kode ~ ('^' || v_prefix || '[0-9]+$');

  return v_prefix || lpad(v_nomor::text, 3, '0');
end;
$$;

-- ---------------------------------------------------------
-- 5. BACKFILL
-- ---------------------------------------------------------
do $$
declare
  v_sebelum_baris bigint;
  v_sebelum_qty numeric;
  v_sesudah_baris bigint;
  v_sesudah_qty numeric;
  r record;
begin
  -- Sudah pernah jalan? Jangan ulangi — menjalankannya dua kali akan
  -- menggandakan jumlah setiap aset.
  if exists (select 1 from information_schema.tables
              where table_schema = 'public' and table_name = 'assets_sebelum_0168') then
    raise notice '0168: backfill sudah pernah dijalankan, dilewati.';
    return;
  end if;
  if not exists (select 1 from information_schema.tables
                  where table_schema = 'public' and table_name = 'assets') then
    raise notice '0168: tabel assets tidak ada, tidak ada yang dipindahkan.';
    return;
  end if;

  select count(*), coalesce(sum(qty), 0) into v_sebelum_baris, v_sebelum_qty from assets;

  -- (a) Prefix untuk setiap kategori yang BENAR-BENAR dipakai.
  --
  -- Diurutkan supaya hasilnya sama setiap kali dijalankan: tanpa `order by`,
  -- kategori mana yang kebagian "B" dan mana yang jadi "BA" bergantung pada
  -- urutan baca yang tidak dijanjikan siapa pun — dan di database tes hasilnya
  -- akan berbeda dari yang di produksi.
  -- `null` dan `''` adalah KATEGORI YANG SAMA.
  --
  -- Di Postgres keduanya nilai yang berbeda, jadi mengelompokkan apa adanya
  -- membuat "Kotak P3K" tanpa kategori dan "Kotak P3K" berkategori kosong jadi
  -- DUA item berkode berbeda. Itu bukan perbedaan yang pernah diketik orang —
  -- ia datang dari form yang mengirim string kosong di satu layar dan null di
  -- layar lain. Menyamakannya bukan tebakan.
  for r in
    select distinct business_unit_id, btrim(coalesce(category, '')) as kat
      from assets
     order by business_unit_id, 2
  loop
    perform prefix_kategori_aset(r.business_unit_id, r.kat);
  end loop;

  -- (b) Satu item per (BU, kategori, nama) yang SAMA PERSIS.
  for r in
    select business_unit_id,
           -- Dibakukan: lihat catatan null-vs-'' di atas.
           nullif(btrim(coalesce(category, '')), '') as category,
           name,
           min(created_at) as created_at,
           (array_agg(size order by created_at) filter (where size is not null))[1] as size,
           (array_agg(created_by order by created_at) filter (where created_by is not null))[1] as created_by
      from assets
     group by business_unit_id, nullif(btrim(coalesce(category, '')), ''), name
     order by business_unit_id, coalesce(nullif(btrim(coalesce(category, '')), ''), ''), min(created_at), name
  loop
    insert into asset_items (business_unit_id, kode, name, category, size, created_by, created_at)
    values (
      r.business_unit_id,
      kode_aset_berikutnya(r.business_unit_id, coalesce(r.category, '')),
      r.name,
      r.category,
      r.size,
      r.created_by,
      r.created_at
    );
  end loop;

  -- (c) Stok per outlet. `id` LAMA DIPERTAHANKAN supaya foto tetap ketemu.
  --
  -- Satu outlet bisa punya BEBERAPA baris lama untuk item yang sama (mis.
  -- didata dua kali). Jumlahnya DIJUMLAHKAN — membuang salah satunya akan
  -- menghilangkan barang yang benar-benar ada, diam-diam.
  insert into asset_stock (id, asset_item_id, outlet_id, qty, condition, condition_note, size, notes, photo_path,
                           created_by, created_at, updated_by, updated_at)
  select
    (array_agg(a.id order by a.created_at))[1],
    i.id,
    a.outlet_id,
    sum(a.qty),
    -- Kondisi yang paling "berbunyi" yang menang: barang rusak tidak boleh
    -- hilang penandanya hanya karena digabung dengan baris yang normal.
    case when bool_or(a.condition = 'rusak') then 'rusak'
         when bool_or(a.condition = 'lainnya') then 'lainnya'
         else 'normal' end,
    (array_agg(a.condition_note order by a.created_at) filter (where a.condition_note is not null))[1],
    (array_agg(a.size order by a.created_at) filter (where a.size is not null))[1],
    -- Catatan dari baris yang digabung DISATUKAN, bukan dipilih salah satu.
    nullif(string_agg(distinct btrim(a.notes), ' | ') filter (where btrim(coalesce(a.notes, '')) <> ''), ''),
    (array_agg(a.photo_path order by a.created_at) filter (where a.photo_path is not null))[1],
    (array_agg(a.created_by order by a.created_at) filter (where a.created_by is not null))[1],
    min(a.created_at),
    (array_agg(a.updated_by order by a.updated_at desc) filter (where a.updated_by is not null))[1],
    max(a.updated_at)
  from assets a
  join asset_items i
    on i.business_unit_id = a.business_unit_id
   and i.name = a.name
   -- Dicocokkan dengan bentuk yang SAMA seperti saat itemnya dibuat. Kalau
   -- tidak, baris berkategori '' tidak akan ketemu itemnya yang berkategori
   -- null — dan barisnya hilang dari backfill tanpa satu pun galat.
   and i.category is not distinct from nullif(btrim(coalesce(a.category, '')), '')
  group by i.id, a.outlet_id;

  select count(*), coalesce(sum(qty), 0) into v_sesudah_baris, v_sesudah_qty from asset_stock;

  -- ============ PENJAGA YANG MEMBATALKAN SEMUANYA ============
  --
  -- Jumlah BARIS memang berkurang (itu tujuannya), tapi jumlah BARANG tidak
  -- boleh berubah satu pun. Backfill yang kehilangan aset tidak memunculkan
  -- galat — ia menghasilkan daftar yang terlihat rapi dengan isi yang kurang,
  -- dan tidak ada yang akan menyadarinya sampai stock opname berikutnya.
  if v_sesudah_qty <> v_sebelum_qty then
    raise exception '0168 DIBATALKAN: total jumlah aset berubah, % -> %. Tidak ada yang diubah.',
      v_sebelum_qty, v_sesudah_qty;
  end if;
  if v_sesudah_baris > v_sebelum_baris then
    raise exception '0168 DIBATALKAN: baris stok (%) lebih banyak daripada baris asal (%).',
      v_sesudah_baris, v_sebelum_baris;
  end if;

  alter table assets rename to assets_sebelum_0168;
  raise notice '0168: % baris -> % item, % baris stok, total jumlah tetap %.',
    v_sebelum_baris, (select count(*) from asset_items), v_sesudah_baris, v_sesudah_qty;
end $$;

comment on table assets_sebelum_0168 is
  'Tabel aset SEBELUM 0168. Tidak dipakai aplikasi. Disimpan supaya hasil backfill bisa diperiksa terhadap aslinya, bukan dipercaya begitu saja. Boleh dihapus kalau sudah yakin.';

-- ---------------------------------------------------------
-- 6. DUGAAN KEMBAR — untuk dirapikan orangnya, bukan oleh sistem
-- ---------------------------------------------------------
create or replace view v_aset_dugaan_kembar as
select
  i.business_unit_id,
  lower(btrim(regexp_replace(i.name, '\s+', ' ', 'g'))) as nama_baku,
  count(*) as jumlah_item,
  array_agg(i.id order by i.kode) as item_ids,
  array_agg(i.kode order by i.kode) as kode,
  array_agg(i.name order by i.kode) as nama,
  array_agg(coalesce(i.category, '') order by i.kode) as kategori
from asset_items i
group by i.business_unit_id, lower(btrim(regexp_replace(i.name, '\s+', ' ', 'g')))
having count(*) > 1;

comment on view v_aset_dugaan_kembar is
  'Item yang namanya SAMA kalau huruf besar & spasi diabaikan, tapi tersimpan sebagai item berbeda. Backfill sengaja tidak menggabungkannya — penggabungan yang salah tidak bisa dibatalkan.';

-- ---------------------------------------------------------
-- 7. RLS
-- ---------------------------------------------------------
alter table asset_items enable row level security;
alter table asset_stock enable row level security;
alter table asset_category_prefix enable row level security;

drop policy if exists asset_items_select on asset_items;
create policy asset_items_select on asset_items
  for select using (has_bu_scope(auth.uid(), business_unit_id));

-- Staff outlet mana pun boleh menambah item baru — pendataan aset memang
-- dikerjakan staff, dan menuntut admin untuk tiap barang baru akan membuat
-- pendataan berhenti di tengah.
drop policy if exists asset_items_insert on asset_items;
create policy asset_items_insert on asset_items
  for insert with check (has_bu_scope(auth.uid(), business_unit_id));

drop policy if exists asset_items_update on asset_items;
create policy asset_items_update on asset_items
  for update using (has_bu_scope(auth.uid(), business_unit_id))
  with check (has_bu_scope(auth.uid(), business_unit_id));

-- Menghapus item menghapus stoknya di SELURUH outlet — itu kewenangan Admin BU.
drop policy if exists asset_items_delete on asset_items;
create policy asset_items_delete on asset_items
  for delete using (is_bu_admin(auth.uid(), business_unit_id));

drop policy if exists asset_stock_select on asset_stock;
create policy asset_stock_select on asset_stock
  for select using (
    exists (select 1 from asset_items i where i.id = asset_item_id and has_bu_scope(auth.uid(), i.business_unit_id))
  );

drop policy if exists asset_stock_write on asset_stock;
create policy asset_stock_write on asset_stock
  for all using (has_outlet_scope(auth.uid(), outlet_id))
  with check (has_outlet_scope(auth.uid(), outlet_id));

drop policy if exists asset_prefix_select on asset_category_prefix;
create policy asset_prefix_select on asset_category_prefix
  for select using (has_bu_scope(auth.uid(), business_unit_id));

-- ---------------------------------------------------------
-- 8. RPC: tambah item (kode dibuat di sini, bukan di layar)
-- ---------------------------------------------------------
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

  -- Nama + kategori yang SAMA PERSIS tidak menghasilkan item kedua; yang sudah
  -- ada dikembalikan. Tanpa ini, dua staff yang mendata barang yang sama pada
  -- hari yang sama membuat dua kode untuk satu barang — dan dua-duanya benar
  -- menurut sistem.
  select id, kode into v_id, v_kode from asset_items
   where business_unit_id = p_bu and name = v_nama and category is not distinct from v_kat
   limit 1;
  if v_id is not null then
    return jsonb_build_object('id', v_id, 'kode', v_kode, 'baru', false);
  end if;

  v_kode := kode_aset_berikutnya(p_bu, coalesce(v_kat, ''));
  insert into asset_items (business_unit_id, kode, name, category, size, created_by)
  values (p_bu, v_kode, v_nama, v_kat, nullif(btrim(coalesce(p_size, '')), ''), v_uid)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'kode', v_kode, 'baru', true);
end;
$$;

revoke all on function tambah_item_aset(uuid, text, text, text) from public;
grant execute on function tambah_item_aset(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------
-- 9. RPC: gabungkan dua item (dipakai layar "rapikan kembar")
-- ---------------------------------------------------------
create or replace function gabung_item_aset(p_dipertahankan uuid, p_digabung uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_bu uuid;
  v_bu2 uuid;
  v_dipindah int := 0;
  v_dijumlah int := 0;
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  if p_dipertahankan = p_digabung then raise exception 'Dua item yang sama tidak bisa digabung.'; end if;

  select business_unit_id into v_bu from asset_items where id = p_dipertahankan;
  select business_unit_id into v_bu2 from asset_items where id = p_digabung;
  if v_bu is null or v_bu2 is null then raise exception 'Item tidak ditemukan.'; end if;
  if v_bu <> v_bu2 then raise exception 'Kedua item harus di BU yang sama.'; end if;
  if not is_bu_admin(v_uid, v_bu) then
    raise exception 'Hanya Admin BU yang boleh menggabungkan item aset.';
  end if;

  -- Outlet yang punya KEDUANYA: jumlahnya DIJUMLAHKAN.
  --
  -- Bukan diambil salah satu. Dua baris itu adalah barang yang benar-benar
  -- ada di gudang; memilih salah satunya menghapus sisanya dari catatan tanpa
  -- ada yang memindahkannya ke mana pun.
  with gabung as (
    update asset_stock t
       set qty = t.qty + s.qty,
           notes = nullif(concat_ws(' | ', nullif(btrim(coalesce(t.notes, '')), ''), nullif(btrim(coalesce(s.notes, '')), '')), ''),
           condition = case when 'rusak' in (t.condition, s.condition) then 'rusak'
                            when 'lainnya' in (t.condition, s.condition) then 'lainnya'
                            else t.condition end,
           photo_path = coalesce(t.photo_path, s.photo_path),
           updated_at = now(),
           updated_by = v_uid
      from asset_stock s
     where s.asset_item_id = p_digabung
       and t.asset_item_id = p_dipertahankan
       and t.outlet_id = s.outlet_id
    returning s.id
  )
  select count(*) into v_dijumlah from gabung;

  -- Outlet yang HANYA punya yang digabung: barisnya dipindahkan apa adanya.
  update asset_stock
     set asset_item_id = p_dipertahankan, updated_at = now(), updated_by = v_uid
   where asset_item_id = p_digabung
     and outlet_id not in (select outlet_id from asset_stock where asset_item_id = p_dipertahankan);
  get diagnostics v_dipindah = row_count;

  delete from asset_stock where asset_item_id = p_digabung;
  delete from asset_items where id = p_digabung;

  return jsonb_build_object('dijumlahkan', v_dijumlah, 'dipindahkan', v_dipindah);
end;
$$;

revoke all on function gabung_item_aset(uuid, uuid) from public;
grant execute on function gabung_item_aset(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
