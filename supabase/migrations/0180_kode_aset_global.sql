-- =========================================================
-- 0180 — SATU KODE UNTUK SATU BARANG, DI SELURUH BU
--
--   "ada kode yang sama tetapi itemnya berbeda, antara BU satu dengan yang
--    lain... saya ingin semua kode di BU manapun selalu sama bila itemnya
--    sama"
--
-- ============ KENAPA INI TERJADI ============
--
-- Sejak 0168 kode adalah milik BU: `asset_items` unik per
-- (business_unit_id, kode), prefixnya disimpan per BU, dan
-- `kode_aset_berikutnya()` menghitung nomor tertinggi DI BU ITU SAJA.
--
-- Transfer lintas BU membuat item BARU di BU tujuan (kode milik BU, jadi tidak
-- ikut pindah) dan memberinya nomor urut berikutnya milik BU tujuan. Jadi
-- `K026 Mangkok Hitam Sup Kecil` yang dikirim ke BU Admin mendarat sebagai
-- `K004` — sementara `K004` di BU asalnya adalah barang yang sama sekali lain.
--
-- Itu bukan kerusakan: tidak ada satu pun aturan yang dilanggar, dan tidak ada
-- galat yang bisa muncul. Rancangannya yang keliru.
--
-- ============ YANG DIUBAH, DAN YANG SENGAJA TIDAK ============
--
-- DIUBAH: kode sekarang milik BARANG, bukan milik BU. Satu daftar pusat
-- (`asset_kode_global`) memetakan nama+kategori ke satu kode, dan setiap item
-- baru di BU mana pun mengambil kodenya dari daftar itu.
--
-- TIDAK DIUBAH: kode yang sudah ada tidak dinomori ulang. "kode kode sudah
-- masuk catatan owner" — jadi yang menang adalah kode yang DULUAN ADA, dan
-- item yang menyesuaikan hanyalah yang kodenya bentrok dengan pemilik yang
-- lebih dulu (praktis: item hasil transfer di BU tujuan). Setiap perubahan
-- dicatat di `asset_kode_perubahan` dan kode lamanya disimpan di
-- `asset_items.kode_lama`, supaya catatan lama masih bisa ditelusuri.
--
-- ============ KENAPA TRIGGER, BUKAN MENULIS ULANG EMPAT FUNGSI ============
--
-- Ada EMPAT jalur yang membuat `asset_items`: `tambah_item_aset` (0172),
-- `pindah_aset_ke_outlet` (0169), `kirim_transfer_aset` dan
-- `ubah_transfer_aset` (0179). Menulis ulang keempatnya untuk mengganti satu
-- pemanggilan adalah cara 0179 kehilangan dua `insert into asset_log` — dan
-- jalur kelima yang ditambahkan nanti tetap akan melewatkannya.
--
-- Trigger `before insert` pada tabelnya menutup SEMUA jalur sekaligus,
-- termasuk yang belum ditulis. Ia juga satu-satunya tempat yang pasti tahu
-- nama + kategori + BU pada saat kode dibutuhkan.
-- =========================================================

-- ---------------------------------------------------------
-- 1. TEMPAT MENYIMPANNYA
-- ---------------------------------------------------------

alter table asset_items add column if not exists kode_lama text;
comment on column asset_items.kode_lama is
  'Kode item ini SEBELUM diselaraskan 0180. Disimpan supaya catatan, surat jalan dan berita acara lama masih bisa ditelusuri.';

-- Daftar pusat: satu baris = satu barang = satu kode, berlaku di seluruh BU.
create table if not exists asset_kode_global (
  -- `kunci` dibuat `kunci_item_aset()`: nama + kategori yang sudah dirapikan.
  -- Disimpan sebagai kolom, bukan dihitung di indeks berekspresi, supaya
  -- aturan perapiannya hanya ada DI SATU TEMPAT dan bisa dibaca orang.
  kunci       text primary key,
  kode        text not null,
  nama        text not null,
  kategori    text not null default '',
  -- ============ NAMA UTAMA vs NAMA LAMA ============
  --
  -- Satu kode boleh punya BEBERAPA kunci: begitu sebuah item diganti namanya,
  -- nama lamanya tetap harus menunjuk ke kode yang sama. BU lain mungkin belum
  -- ikut mengganti nama, dan catatan lama memakai nama lama.
  --
  -- Yang `utama` adalah nama yang kodenya "milik" dia; sisanya nama lain untuk
  -- barang yang sama. Hanya yang utama yang diadu di indeks unik di bawah.
  utama       boolean not null default true,
  bu_asal     uuid references business_units(id) on delete set null,
  item_asal   uuid references asset_items(id) on delete set null,
  created_at  timestamptz not null default now()
);

alter table asset_kode_global add column if not exists utama boolean not null default true;

-- SATU KODE HANYA BOLEH BERARTI SATU BARANG.
--
-- Tanpa indeks ini, daftar pusatnya bisa memuat "K004 = Piring" dan
-- "K004 = Mangkok" sekaligus — yaitu persis keadaan yang migration ini ada
-- untuk menghapusnya, cuma dipindahkan ke tabel yang terdengar berwibawa.
drop index if exists asset_kode_global_kode_uk;
create unique index if not exists asset_kode_global_kode_uk
  on asset_kode_global(upper(btrim(kode))) where utama;

comment on table asset_kode_global is
  'Kode aset milik BARANG, bukan milik BU. Satu nama+kategori = satu kode di seluruh BU.';

-- Laporan perubahan: apa yang berubah, dari apa, jadi apa, dan kenapa.
create table if not exists asset_kode_perubahan (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid references asset_items(id) on delete cascade,
  bu_id       uuid references business_units(id) on delete cascade,
  nama        text not null,
  kategori    text,
  kode_lama   text not null,
  kode_baru   text not null,
  alasan      text not null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_asset_kode_perubahan_bu on asset_kode_perubahan(bu_id, created_at desc);

comment on table asset_kode_perubahan is
  'Jejak penyelarasan kode aset 0180. Dibaca orang yang harus menjelaskan ke owner kenapa kode di catatannya berubah.';

alter table asset_kode_global enable row level security;
alter table asset_kode_perubahan enable row level security;

-- Dibaca siapa pun yang sudah login: daftar kode bukan rahasia, dan layar
-- aset di BU mana pun boleh menyebut kode barang yang sama.
drop policy if exists asset_kode_global_select on asset_kode_global;
create policy asset_kode_global_select on asset_kode_global
  for select to authenticated using (true);

drop policy if exists asset_kode_perubahan_select on asset_kode_perubahan;
create policy asset_kode_perubahan_select on asset_kode_perubahan
  for select to authenticated using (has_bu_scope(auth.uid(), bu_id));

-- Menulis HANYA lewat trigger & fungsi di bawah (security definer). Tidak ada
-- policy insert/update/delete sama sekali: daftar kode yang bisa disunting
-- langsung dari klien adalah daftar yang tidak menjamin apa pun.

-- ---------------------------------------------------------
-- 2. KUNCINYA
-- ---------------------------------------------------------

/**
 * Nama + kategori yang sudah dirapikan, jadi satu kunci.
 *
 * ============ APA YANG DIRAPIKAN, DAN APA YANG TIDAK ============
 *
 * Dirapikan: spasi di tepi, spasi ganda di tengah, dan huruf besar-kecil.
 * "Lepek  Hitam" dan "lepek hitam" adalah barang yang sama — bedanya datang
 * dari jari yang terpeleset, bukan dari barangnya.
 *
 * TIDAK dirapikan: ejaan. "Mangkok" dan "Mangkuk" tetap dua barang. Menebak
 * ejaan berarti menggabungkan dua barang yang mungkin memang berbeda, dan
 * penggabungan kode tidak bisa dibatalkan tanpa menyentuh catatan orang lain.
 * Dugaan kembar semacam itu tetap dilaporkan `v_aset_dugaan_kembar` untuk
 * diputuskan orangnya.
 *
 * Kategori ikut jadi bagian kunci: prefix kodenya memang berasal dari
 * kategori, jadi "Piring Kayu" di Kitchen dan di Bar tidak bisa berbagi satu
 * kode tanpa membuat salah satunya berkode yang tidak sesuai kategorinya.
 */
create or replace function kunci_item_aset(p_nama text, p_kategori text)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(btrim(coalesce(p_nama, '')), '\s+', ' ', 'g'))
      || '|'
      || lower(regexp_replace(btrim(coalesce(p_kategori, '')), '\s+', ' ', 'g'));
$$;

-- ---------------------------------------------------------
-- 3. NOMOR BERIKUTNYA YANG BEBAS DI SELURUH BU
-- ---------------------------------------------------------

/**
 * Nomor berikutnya untuk sebuah prefix, dihitung dari SELURUH BU.
 *
 * ============ KENAPA TIDAK BISA PER BU LAGI ============
 *
 * Kalau BU Admin tetap menomori dari urutannya sendiri, suatu hari ia membuat
 * "K005 Rak Piring" sementara BU lain sudah punya "K005 Gelas Juice". Begitu
 * salah satunya ditransfer, bentroknya kembali — dan kali ini pada barang yang
 * tidak pernah ditransfer siapa pun, jadi tidak ada peristiwa yang bisa
 * disalahkan.
 *
 * Akibat yang harus diterima: nomor di satu BU tidak lagi rapat 001, 002, 003.
 * BU yang baru mulai bisa langsung mendapat K063. Itu disengaja — nomor yang
 * rapat per BU adalah persis yang membuat kode yang sama berarti dua barang.
 *
 * Dikunci seperti aslinya (0168): dua orang yang menambah item di detik yang
 * sama tidak boleh sama-sama membaca nomor tertinggi yang sama.
 */
create or replace function kode_global_berikutnya(p_prefix text)
returns text
language plpgsql
as $$
declare
  v_prefix text := upper(btrim(coalesce(p_prefix, '')));
  v_nomor int;
begin
  if v_prefix = '' then raise exception 'Prefix kode aset kosong.'; end if;

  -- Semua baris prefix ini, di BU mana pun. Barisnya dikunci, bukan tabelnya:
  -- penambahan item berkategori lain tetap berjalan berbarengan.
  perform 1 from asset_category_prefix where prefix = v_prefix for update;

  -- Dihitung dari DUA tempat: item yang sudah ada DAN daftar pusat.
  --
  -- Daftar pusat sendirian tidak cukup — item lama yang belum pernah masuk
  -- daftar tetap memegang kodenya. Item sendirian juga tidak cukup: kode yang
  -- sudah didaftarkan untuk barang yang itemnya kebetulan terhapus tidak boleh
  -- dipakai ulang untuk barang lain, karena kode itu sudah ada di catatan.
  select coalesce(max(n), 0) + 1 into v_nomor
    from (
      select substr(upper(btrim(kode)), length(v_prefix) + 1)::int as n
        from asset_items
       where upper(btrim(kode)) ~ ('^' || v_prefix || '[0-9]+$')
      union all
      select substr(upper(btrim(kode)), length(v_prefix) + 1)::int
        from asset_kode_global
       where upper(btrim(kode)) ~ ('^' || v_prefix || '[0-9]+$')
    ) x;

  return v_prefix || lpad(v_nomor::text, 3, '0');
end;
$$;

-- ---------------------------------------------------------
-- 4. TRIGGERNYA — SATU PINTU UNTUK SEMUA JALUR
-- ---------------------------------------------------------

/**
 * Sebelum item aset disimpan: tentukan kodenya dari daftar pusat.
 *
 * Empat keadaan, dan yang ketiga adalah yang paling mudah dilupakan:
 *
 *   1. barangnya sudah punya kode    -> pakai kode itu, walaupun BU ini belum
 *      di daftar pusat                  pernah punya barangnya
 *   2. barangnya belum punya kode    -> pakai kode yang dibawa pemanggil,
 *                                       naikkan kalau ternyata sudah dipakai
 *                                       BU lain; lalu daftarkan
 *   3. kodenya sudah dipakai BARANG  -> JANGAN timpa. Item lama yang sudah
 *      LAIN di BU ini                   ada tidak boleh kehilangan kodenya
 *                                       karena ada barang baru masuk; yang
 *                                       baru mengalah dan dicatat di
 *                                       `asset_kode_perubahan`
 *   4. kodenya kosong                -> dibuatkan; jalur lama yang tidak
 *                                       mengisi kode tidak boleh gagal diam
 */
create or replace function kode_global_item_aset()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kunci text := kunci_item_aset(new.name, new.category);
  v_kode text;
  v_prefix text;
  v_dipakai boolean;
  v_bentrok text;
begin
  select kode into v_kode from asset_kode_global where kunci = v_kunci;

  if v_kode is not null then
    -- Keadaan 3: kode milik barang ini sudah dipakai barang LAIN di BU ini.
    select exists (
      select 1 from asset_items
       where business_unit_id = new.business_unit_id
         and upper(btrim(kode)) = upper(btrim(v_kode))
         and kunci_item_aset(name, category) <> v_kunci
    ) into v_dipakai;

    if not v_dipakai then
      new.kode := v_kode;
      return new;
    end if;

    -- Dicatat SESUDAH kode penggantinya diputuskan, bukan sekarang: `new.kode`
    -- di titik ini masih kode bawaan pemanggil, dan ia bisa berubah beberapa
    -- baris lagi. Laporan yang menyebut kode yang tidak pernah tersimpan lebih
    -- buruk daripada tidak ada laporan.
    v_bentrok := v_kode;
  end if;

  -- Keadaan 4 & 2: belum ada di daftar pusat.
  v_prefix := upper(regexp_replace(coalesce(new.kode, ''), '[0-9]+$', ''));
  if v_prefix = '' then
    v_prefix := prefix_kategori_aset(new.business_unit_id, coalesce(new.category, ''));
  end if;

  -- Kode yang dibawa pemanggil dihitung per BU (0168), jadi ia bisa saja sudah
  -- dipakai barang lain di BU lain. Dinaikkan sampai bebas di SELURUH BU.
  if new.kode is null
     or btrim(new.kode) = ''
     or exists (select 1 from asset_items where upper(btrim(kode)) = upper(btrim(new.kode)))
     or exists (select 1 from asset_kode_global where upper(btrim(kode)) = upper(btrim(new.kode)))
  then
    new.kode := kode_global_berikutnya(v_prefix);
  end if;

  if v_bentrok is not null then
    insert into asset_kode_perubahan (item_id, bu_id, nama, kategori, kode_lama, kode_baru, alasan)
    values (null, new.business_unit_id, new.name, new.category, v_bentrok, new.kode,
            'Kode pusat sudah dipakai barang lain di BU ini — item ini memakai kode sendiri.');
    -- TIDAK didaftarkan ke daftar pusat: kuncinya sudah punya pemilik, dan
    -- menimpanya akan memindahkan kode barang itu di SELURUH BU.
    return new;
  end if;

  insert into asset_kode_global (kunci, kode, nama, kategori, bu_asal)
  values (v_kunci, new.kode, btrim(new.name), btrim(coalesce(new.category, '')), new.business_unit_id)
  on conflict (kunci) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_kode_global_item_aset on asset_items;
create trigger trg_kode_global_item_aset
  before insert on asset_items
  for each row execute function kode_global_item_aset();

/**
 * Item diganti nama: kodenya IKUT, tidak dibuat yang baru.
 *
 * Tanpa ini, mengganti nama item memutus hubungan barang itu dengan kodenya di
 * daftar pusat. BU lain yang kemudian mendata barang bernama baru itu akan
 * mendapat kode berbeda — dan perbedaannya lahir dari perbaikan ketikan,
 * peristiwa yang tidak akan diingat siapa pun saat kodenya ditanyakan.
 *
 * Kode lamanya TIDAK dilepas dari daftar: kunci lama tetap menunjuk kode yang
 * sama, supaya catatan yang memakai nama lama tidak menunjuk ke mana-mana.
 */
create or replace function kode_global_ganti_nama_aset()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kunci text := kunci_item_aset(new.name, new.category);
begin
  if kunci_item_aset(old.name, old.category) = v_kunci then return new; end if;

  -- Kuncinya baru: daftarkan kode item ini untuknya, sebagai nama TAMBAHAN
  -- (`utama = false`) — kode utamanya tetap milik nama yang pertama.
  -- `do nothing` kalau nama barunya ternyata sudah punya kode sendiri;
  -- menimpanya berarti memindahkan kode barang orang lain.
  insert into asset_kode_global (kunci, kode, nama, kategori, utama, bu_asal, item_asal)
  values (v_kunci, new.kode, btrim(new.name), btrim(coalesce(new.category, '')), false, new.business_unit_id, new.id)
  on conflict (kunci) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_kode_global_ganti_nama_aset on asset_items;
create trigger trg_kode_global_ganti_nama_aset
  after update of name, category on asset_items
  for each row execute function kode_global_ganti_nama_aset();

-- ---------------------------------------------------------
-- 5. PENYELARASAN SEKALI JALAN
-- ---------------------------------------------------------
--
-- ============ SIAPA YANG MENANG ============
--
-- Pemilik kode adalah item yang DULUAN DIBUAT (`created_at`, lalu `id` supaya
-- hasilnya sama setiap kali dijalankan). Itu yang paling mendekati "input
-- awal": BU yang pertama kali mendata barangnya.
--
-- Yang menyesuaikan karena itu hampir selalu item hasil transfer di BU tujuan
-- — item yang lahir justru karena transfernya, dan yang kodenya belum pernah
-- ada di catatan siapa pun sebelum hari transfer itu.
--
-- ============ KENAPA LEWAT KODE SEMENTARA ============
--
-- Di satu BU, A harus jadi K004 sementara K004 masih dipegang B yang sendiri
-- akan pindah ke K026. Mengerjakannya langsung berarti separuh baris ditolak
-- indeks unik, dan BU-nya berhenti setengah jalan — sebagian item berkode
-- baru, sebagian berkode lama, tanpa satu pun catatan tentang yang mana.
--
-- Semua yang akan berubah dipindahkan dulu ke kode sementara yang pasti bebas,
-- baru diturunkan ke kode finalnya.
do $$
declare
  r record;
  v_ubah int := 0;
  v_bentrok int := 0;
begin
  if exists (select 1 from asset_kode_global) then
    raise notice '0180: daftar kode global sudah terisi, penyelarasan dilewati.';
    return;
  end if;

  -- (a) Pemilik kode per barang: yang paling dulu dibuat.
  insert into asset_kode_global (kunci, kode, nama, kategori, bu_asal, item_asal)
  select distinct on (kunci_item_aset(i.name, i.category))
         kunci_item_aset(i.name, i.category),
         btrim(i.kode),
         btrim(i.name),
         btrim(coalesce(i.category, '')),
         i.business_unit_id,
         i.id
    from asset_items i
   where btrim(coalesce(i.kode, '')) <> ''
   order by kunci_item_aset(i.name, i.category), i.created_at, i.id
  on conflict do nothing;

  -- ============ KODE YANG DIPEREBUTKAN DUA BARANG ============
  --
  -- `on conflict do nothing` di atas membuang baris yang KODENYA sudah
  -- didaftarkan barang lain (mis. `K004` di dua BU untuk dua barang berbeda).
  -- Barang yang kalah itu belum punya kode pusat sama sekali — kalau dibiarkan,
  -- ia tidak akan pernah diselaraskan dan BU lain akan membuatkan kode baru
  -- untuknya tiap kali ditransfer. Jadi ia diberi kode baru yang bebas, dari
  -- prefix yang sama.
  for r in
    select distinct on (kunci_item_aset(i.name, i.category))
           kunci_item_aset(i.name, i.category) as kunci,
           i.id as item,
           i.business_unit_id as bu,
           i.name as nama,
           coalesce(i.category, '') as kat,
           upper(regexp_replace(btrim(i.kode), '[0-9]+$', '')) as prefix
      from asset_items i
     where btrim(coalesce(i.kode, '')) <> ''
       and not exists (
         select 1 from asset_kode_global g where g.kunci = kunci_item_aset(i.name, i.category)
       )
     order by kunci_item_aset(i.name, i.category), i.created_at, i.id
  loop
    insert into asset_kode_global (kunci, kode, nama, kategori, bu_asal, item_asal)
    values (r.kunci, kode_global_berikutnya(coalesce(nullif(r.prefix, ''), 'X')), r.nama, r.kat, r.bu, r.item);
    v_bentrok := v_bentrok + 1;
  end loop;

  -- (b) Semua item yang kodenya belum sesuai daftar pusat, lewat kode
  --     sementara. Prefix `~` tidak pernah dipakai pembuat kode (huruf saja),
  --     jadi ia pasti tidak bentrok dengan kode sungguhan.
  update asset_items i
     set kode_lama = coalesce(i.kode_lama, i.kode),
         kode = '~' || left(i.id::text, 8)
    from asset_kode_global g
   where g.kunci = kunci_item_aset(i.name, i.category)
     and upper(btrim(i.kode)) <> upper(btrim(g.kode));

  update asset_items i
     set kode = g.kode,
         updated_at = now()
    from asset_kode_global g
   where g.kunci = kunci_item_aset(i.name, i.category)
     and i.kode like '~%';

  insert into asset_kode_perubahan (item_id, bu_id, nama, kategori, kode_lama, kode_baru, alasan)
  select i.id, i.business_unit_id, i.name, i.category, i.kode_lama, i.kode,
         'Penyelarasan 0180: kode mengikuti BU yang lebih dulu mendata barang ini.'
    from asset_items i
   where i.kode_lama is not null
     and upper(btrim(i.kode_lama)) <> upper(btrim(i.kode));

  get diagnostics v_ubah = row_count;

  -- ============ YANG TIDAK BISA DISELARASKAN ============
  --
  -- Masih ada kode sementara yang tersangkut berarti ada item yang kode
  -- pusatnya sudah dipegang item LAIN di BU yang sama — dua barang berbeda
  -- dengan nama yang menurut `kunci_item_aset` sama. Itu harus diputuskan
  -- orangnya, bukan ditebak di sini. Kodenya dikembalikan apa adanya.
  update asset_items
     set kode = kode_lama,
         kode_lama = null
   where kode like '~%';

  raise notice '0180: % kode diselaraskan, % barang mendapat kode baru karena kodenya diperebutkan.', v_ubah, v_bentrok;
end;
$$;

-- ---------------------------------------------------------
-- 6. `tambah_item_aset` MENGEMBALIKAN KODE YANG BENAR-BENAR TERSIMPAN
-- ---------------------------------------------------------
--
-- Sejak triggernya ada, kode yang dihitung SEBELUM insert bukan lagi kode yang
-- tersimpan. Layar menampilkan apa yang dikembalikan fungsi ini — dan kode
-- yang salah di layar adalah kode yang terlanjur ditulis orang di bukunya.
--
-- Hanya baris `returning`-nya yang berubah dari 0172.
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
  returning id, kode into v_id, v_kode;

  return jsonb_build_object('id', v_id, 'kode', v_kode, 'baru', true);
end;
$$;

revoke all on function tambah_item_aset(uuid, text, text, text) from public;
grant execute on function tambah_item_aset(uuid, text, text, text) to authenticated;

revoke all on function kode_global_berikutnya(text) from public;
revoke all on function kunci_item_aset(text, text) from public;
grant execute on function kunci_item_aset(text, text) to authenticated;
