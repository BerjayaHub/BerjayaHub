-- =========================================================
-- 0181 — ADMIN MEREVISI & MEMBATALKAN WASTE/SPOIL
--
--   "saya ingin ada edit dan hapus di bagian waste/spoil, tapi hanya disisi
--    admin portal saja, tujuannya admin bisa edit atau hapus inputan
--    spoil/waste bahan bila staff salah input jumlah atau item nya"
--
-- ============ KENAPA INI BUKAN SEKADAR `update waste_runs` ============
--
-- Waste SUDAH MEMOTONG STOK saat dicatat. Mengubah angkanya di `waste_runs`
-- saja menghasilkan keadaan yang jauh lebih buruk daripada salah input:
-- laporan waste menyebut 2 kg sementara stok berkurang 20 kg, keduanya tampil
-- rapi, dan tidak ada satu pun galat yang menghubungkan keduanya. Salah input
-- masih bisa dilihat orang; selisih yang tersembunyi di antara dua layar
-- tidak.
--
-- Jadi setiap revisi MEMBONGKAR potongan stoknya lalu memasangnya kembali dari
-- keadaan terbaru — dan untuk waste menu, bahan resepnya ikut dihitung ulang.
--
-- ============ YANG BOLEH DAN TIDAK BOLEH DIUBAH ============
--
-- Boleh : jumlah, item (bahan/menu), catatan.
-- Tidak : foto, dan JENIS (spoil <-> menu).
--
--   Foto adalah satu-satunya bukti kejadian ini, dan admin tidak menyaksikan
--   barangnya. Mengganti bukti atas kejadian yang tidak dilihat sendiri bukan
--   koreksi, itu penggantian cerita.
--
--   Jenis menentukan ARTI `product_id`: pada spoil ia bahan yang rusak, pada
--   menu ia menu yang terbuang dan bahannya dihitung dari resep. Menukarnya
--   diam-diam sama dengan mencatat kejadian yang sama sekali berbeda di baris
--   yang sama. Salah jenis dibatalkan, lalu dicatat ulang beserta fotonya.
--
-- ============ YANG SUDAH DIEKSPOR KE ESB ============
--
-- BOLEH diubah, dengan peringatan — berbeda dari `ubah_purpose_waste` (0147)
-- yang menolak. Alasannya: Purpose adalah keterangan yang ikut berangkat ke
-- ESB, sementara ini membetulkan ANGKA yang salah. Angka yang salah dibiarkan
-- hanya karena sudah terlanjur dikirim akan salah di dua tempat selamanya.
-- Fungsinya mengembalikan `esb_terkunci` supaya layar bisa mengatakannya lebih
-- dulu, dan `waste_revisi` mencatat bahwa saat direvisi ia sudah diekspor.
-- =========================================================

-- ---------------------------------------------------------
-- 1. KOLOM JEJAK
-- ---------------------------------------------------------
alter table waste_runs add column if not exists dibatalkan_at timestamptz;
alter table waste_runs add column if not exists dibatalkan_by uuid references user_profiles(id) on delete set null;
alter table waste_runs add column if not exists alasan_batal text;
alter table waste_runs add column if not exists revisi_ke int not null default 0;
alter table waste_runs add column if not exists direvisi_at timestamptz;
alter table waste_runs add column if not exists direvisi_by uuid references user_profiles(id) on delete set null;

comment on column waste_runs.dibatalkan_at is
  'Kejadian ini dibatalkan admin; stoknya sudah dikembalikan. Barisnya SENGAJA tidak dihapus.';

create index if not exists idx_waste_runs_dibatalkan
  on waste_runs(business_unit_id, dibatalkan_at) where dibatalkan_at is not null;

-- ============ JEJAK PER REVISI, BUKAN CUMA "PERNAH DIREVISI" ============
--
-- Kolom `revisi_ke` saja menjawab "berapa kali", bukan "dari apa jadi apa".
-- Yang membaca laporan bulan lalu dan menemukan angka yang berbeda dari
-- ingatannya butuh jawaban kedua — dan tanpa tabel ini, jawabannya tidak ada
-- di mana pun, karena yang lama sudah ditimpa.
create table if not exists waste_revisi (
  id            uuid primary key default gen_random_uuid(),
  waste_id      uuid not null references waste_runs(id) on delete cascade,
  revisi_ke     int not null,
  product_lama  uuid references products(id) on delete set null,
  qty_lama      numeric not null,
  notes_lama    text,
  product_baru  uuid references products(id) on delete set null,
  qty_baru      numeric not null,
  notes_baru    text,
  alasan        text not null,
  -- Keadaan ekspor PADA SAAT direvisi. Dibaca belakangan dari `waste_runs`
  -- tidak sama artinya: tandanya bisa sudah dibatalkan atau dipasang lagi
  -- sesudah revisi ini terjadi.
  esb_terkunci  boolean not null default false,
  oleh          uuid references user_profiles(id) on delete set null,
  oleh_nama     text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_waste_revisi_waste on waste_revisi(waste_id, created_at desc);

alter table waste_revisi enable row level security;

drop policy if exists waste_revisi_select on waste_revisi;
create policy waste_revisi_select on waste_revisi
  for select to authenticated using (
    exists (select 1 from waste_runs w where w.id = waste_revisi.waste_id and has_bu_scope(auth.uid(), w.business_unit_id))
  );

-- Tanpa policy tulis: satu-satunya jalan masuk adalah fungsi di bawah.
-- Jejak yang bisa disunting dari klien bukan jejak.

-- ---------------------------------------------------------
-- 2. MEMASANG ULANG POTONGAN STOKNYA
-- ---------------------------------------------------------

/**
 * Hapus rincian bahan & potongan stok satu kejadian waste.
 *
 * DIHAPUS, bukan ditambah pergerakan lawan.
 *
 * Pergerakan lawan ("+20 kg koreksi") jujur untuk kejadian yang BENAR-BENAR
 * terjadi lalu berubah. Yang ditangani di sini adalah salah ketik: barangnya
 * tidak pernah berkurang 20 kg. Menyimpan potongan yang salah beserta
 * pengembaliannya membuat laporan waste bulan itu memuat dua baris yang
 * keduanya tidak pernah terjadi — dan yang membacanya harus tahu bahwa mereka
 * saling meniadakan.
 *
 * Yang hilang karena itu: fakta bahwa stok sempat salah selama beberapa jam.
 * Itu disengaja; `waste_revisi` mencatat angka lamanya.
 */
create or replace function bongkar_waste(p_waste uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from stock_movements where waste_run_id = p_waste;
  delete from waste_items where waste_id = p_waste;
end;
$$;

/**
 * Pasang rincian bahan & potongan stok dari keadaan `waste_runs` saat ini.
 *
 * Isinya disalin dari paruh kedua `catat_waste` (0147) — satu-satunya
 * perbedaan: nilainya dibaca dari barisnya, bukan dari argumen. Ditaruh di
 * fungsi sendiri supaya revisi, pembatalan, dan pemulihan memakai aturan yang
 * SAMA PERSIS. Dua salinan aturan resep pasti menyimpang pada perbaikan
 * berikutnya, dan penyimpangannya tidak memunculkan galat — ia cuma membuat
 * stok yang dipotong revisi berbeda dari stok yang dipotong pencatatan.
 */
create or replace function pasang_waste(p_waste uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  w waste_runs%rowtype;
  v_role text;
  v_mode text;
  v_nama text;
  v_recipe recipes%rowtype;
  v_n int := 0;
  r record;
begin
  select * into w from waste_runs where id = p_waste;
  if w.id is null then raise exception 'Kejadian waste tidak ditemukan.'; end if;

  select name into v_nama from products where id = w.product_id;
  if v_nama is null then raise exception 'Produk tidak ditemukan.'; end if;

  if w.jenis = 'spoil' then
    insert into waste_items (waste_id, product_id, qty) values (w.id, w.product_id, w.qty);

    insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, notes, created_by, waste_run_id)
    values (w.business_unit_id, w.outlet_id, w.product_id, 'waste', -w.qty,
            'Spoil bahan' || case when w.notes is null or btrim(w.notes) = '' then '' else ' — ' || btrim(w.notes) end,
            w.created_by, w.id);
    return 1;
  end if;

  select outlet_role into v_role from outlets where id = w.outlet_id;
  v_mode := case when v_role = 'served_by_ck' then 'served_by_ck' else 'standalone' end;
  select * into v_recipe from recipes where product_id = w.product_id and mode = v_mode;
  if v_recipe.id is null then
    select * into v_recipe from recipes where product_id = w.product_id and mode = 'standalone';
  end if;
  if v_recipe.id is null then
    raise exception '% belum punya resep, jadi bahan yang terbuang tidak bisa dihitung.', v_nama;
  end if;
  if v_recipe.yield_qty is null or v_recipe.yield_qty <= 0 then
    raise exception 'Yield resep % tidak valid.', v_nama;
  end if;

  for r in select ingredient_product_id, qty from recipe_items where recipe_id = v_recipe.id loop
    if r.qty is null or r.qty <= 0 then continue; end if;

    insert into waste_items (waste_id, product_id, qty)
    values (w.id, r.ingredient_product_id, r.qty * w.qty / v_recipe.yield_qty)
    on conflict (waste_id, product_id) do update set qty = waste_items.qty + excluded.qty;

    insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, notes, created_by, waste_run_id)
    values (w.business_unit_id, w.outlet_id, r.ingredient_product_id, 'waste',
            -(r.qty * w.qty / v_recipe.yield_qty),
            'Waste menu: ' || v_nama || ' x' || w.qty
              || case when w.notes is null or btrim(w.notes) = '' then '' else ' — ' || btrim(w.notes) end,
            w.created_by, w.id);
    v_n := v_n + 1;
  end loop;

  if v_n = 0 then
    raise exception 'Resep % tidak punya satu pun bahan berjumlah lebih dari 0.', v_nama;
  end if;
  return v_n;
end;
$$;

revoke all on function bongkar_waste(uuid) from public;
revoke all on function pasang_waste(uuid) from public;

-- ---------------------------------------------------------
-- 3. REVISI
-- ---------------------------------------------------------

/**
 * Admin membetulkan jumlah / item / catatan satu kejadian waste.
 *
 * ============ ALASAN WAJIB ============
 *
 * Yang membaca angka ini belakangan bukan yang mengubahnya. "Kenapa 20 kg jadi
 * 2 kg" tidak bisa dijawab oleh `revisi_ke = 1`, dan orang yang harus
 * menjawabnya biasanya sudah lupa. Ditegakkan di sini, bukan di layar: layar
 * bisa dilewati, fungsinya tidak.
 */
create or replace function revisi_waste(
  p_waste uuid,
  p_product uuid,
  p_qty numeric,
  p_notes text,
  p_alasan text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  w waste_runs%rowtype;
  v_alasan text := nullif(btrim(coalesce(p_alasan, '')), '');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_nama_pelaku text;
  v_nama_produk text;
  v_n int;
begin
  if v_uid is null then raise exception 'Harus login'; end if;

  select * into w from waste_runs where id = p_waste;
  if w.id is null then raise exception 'Kejadian waste tidak ditemukan.'; end if;

  -- Wewenang: admin BU atau admin outlet tempat kejadiannya.
  if not is_admin_of_outlet(v_uid, w.outlet_id) then
    raise exception 'Hanya admin BU atau admin outlet ini yang bisa merevisi waste.';
  end if;

  if w.dibatalkan_at is not null then
    raise exception 'Kejadian ini sudah dibatalkan. Pulihkan dulu kalau memang mau direvisi.';
  end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Jumlah harus lebih dari 0.'; end if;
  if v_alasan is null then raise exception 'Alasan revisi wajib diisi.'; end if;

  select name into v_nama_produk from products where id = p_product;
  if v_nama_produk is null then raise exception 'Produk tidak ditemukan.'; end if;

  -- Produknya harus milik BU yang sama. Tanpa ini, satu salah pilih di layar
  -- memotong stok bahan milik BU lain — dan tidak ada laporan di BU mana pun
  -- yang menunjukkan hubungannya.
  if not exists (select 1 from products where id = p_product and business_unit_id = w.business_unit_id) then
    raise exception 'Produk itu bukan milik BU ini.';
  end if;

  select full_name into v_nama_pelaku from user_profiles where id = v_uid;

  insert into waste_revisi (waste_id, revisi_ke, product_lama, qty_lama, notes_lama,
                            product_baru, qty_baru, notes_baru, alasan, esb_terkunci, oleh, oleh_nama)
  values (w.id, w.revisi_ke + 1, w.product_id, w.qty, w.notes,
          p_product, p_qty, v_notes, v_alasan, w.esb_exported_at is not null, v_uid, v_nama_pelaku);

  update waste_runs
     set product_id = p_product,
         qty = p_qty,
         notes = v_notes,
         revisi_ke = revisi_ke + 1,
         direvisi_at = now(),
         direvisi_by = v_uid
   where id = w.id;

  -- Dibongkar SESUDAH barisnya diperbarui, lalu dipasang dari keadaan baru.
  -- Urutannya penting: `pasang_waste` membaca barisnya, bukan argumen.
  perform bongkar_waste(w.id);
  v_n := pasang_waste(w.id);

  return jsonb_build_object(
    'kode', w.code,
    'revisi_ke', w.revisi_ke + 1,
    'baris_stok', v_n,
    'esb_terkunci', w.esb_exported_at is not null
  );
end;
$$;

revoke all on function revisi_waste(uuid, uuid, numeric, text, text) from public;
grant execute on function revisi_waste(uuid, uuid, numeric, text, text) to authenticated;

comment on function revisi_waste(uuid, uuid, numeric, text, text) is
  'Admin BU/outlet membetulkan jumlah, item & catatan waste. Stoknya dibongkar lalu dipasang ulang; alasan wajib.';

-- ---------------------------------------------------------
-- 4. PEMBATALAN (dan pemulihannya)
-- ---------------------------------------------------------

/**
 * Batalkan kejadian waste: stoknya kembali, barisnya tetap ada.
 *
 * `waste_items` SENGAJA TIDAK dihapus. Ia satu-satunya catatan tentang bahan
 * apa saja yang dulu ikut terpotong — dan tanpa itu, kejadian yang dibatalkan
 * cuma berupa baris tanpa isi, yang tidak bisa diperiksa ulang oleh siapa pun
 * yang bertanya "dulu ini apa?".
 *
 * Yang membuatnya hilang dari rekap adalah `dibatalkan_at` di view-nya, bukan
 * penghapusan.
 */
create or replace function batalkan_waste(p_waste uuid, p_alasan text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  w waste_runs%rowtype;
  v_alasan text := nullif(btrim(coalesce(p_alasan, '')), '');
begin
  if v_uid is null then raise exception 'Harus login'; end if;

  select * into w from waste_runs where id = p_waste;
  if w.id is null then raise exception 'Kejadian waste tidak ditemukan.'; end if;
  if not is_admin_of_outlet(v_uid, w.outlet_id) then
    raise exception 'Hanya admin BU atau admin outlet ini yang bisa membatalkan waste.';
  end if;
  if w.dibatalkan_at is not null then
    raise exception 'Kejadian ini sudah dibatalkan sebelumnya.';
  end if;
  if v_alasan is null then raise exception 'Alasan pembatalan wajib diisi.'; end if;

  -- Hanya potongan stoknya yang dibongkar; rinciannya ditinggalkan.
  delete from stock_movements where waste_run_id = w.id;

  update waste_runs
     set dibatalkan_at = now(),
         dibatalkan_by = v_uid,
         alasan_batal = v_alasan
   where id = w.id;

  return jsonb_build_object('kode', w.code, 'esb_terkunci', w.esb_exported_at is not null);
end;
$$;

/**
 * Pulihkan kejadian yang dibatalkan: stoknya dipotong lagi.
 *
 * Ada karena membatalkan baris yang SALAH adalah persis jenis kekeliruan yang
 * fitur ini dibuat untuk membetulkannya. Tanpa jalan pulang, satu-satunya cara
 * adalah menyuruh staff mencatat ulang — beserta fotonya, atas barang yang
 * sudah lama dibuang.
 */
create or replace function pulihkan_waste(p_waste uuid, p_alasan text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  w waste_runs%rowtype;
  v_alasan text := nullif(btrim(coalesce(p_alasan, '')), '');
  v_nama text;
  v_n int;
begin
  if v_uid is null then raise exception 'Harus login'; end if;

  select * into w from waste_runs where id = p_waste;
  if w.id is null then raise exception 'Kejadian waste tidak ditemukan.'; end if;
  if not is_admin_of_outlet(v_uid, w.outlet_id) then
    raise exception 'Hanya admin BU atau admin outlet ini yang bisa memulihkan waste.';
  end if;
  if w.dibatalkan_at is null then
    raise exception 'Kejadian ini tidak sedang dibatalkan.';
  end if;
  if v_alasan is null then raise exception 'Alasan pemulihan wajib diisi.'; end if;

  select full_name into v_nama from user_profiles where id = v_uid;

  update waste_runs
     set dibatalkan_at = null,
         dibatalkan_by = null,
         alasan_batal = null
   where id = w.id;

  -- Dibongkar dulu walau seharusnya kosong: pembatalan yang gagal separuh
  -- jalan, atau dua pemulihan yang berbarengan, akan meninggalkan rincian
  -- lama — dan memasangnya lagi di atasnya memotong stok DUA KALI.
  perform bongkar_waste(w.id);
  v_n := pasang_waste(w.id);

  insert into waste_revisi (waste_id, revisi_ke, product_lama, qty_lama, notes_lama,
                            product_baru, qty_baru, notes_baru, alasan, esb_terkunci, oleh, oleh_nama)
  values (w.id, w.revisi_ke, w.product_id, w.qty, w.notes,
          w.product_id, w.qty, w.notes, 'Dipulihkan: ' || v_alasan,
          w.esb_exported_at is not null, v_uid, v_nama);

  return jsonb_build_object('kode', w.code, 'baris_stok', v_n);
end;
$$;

revoke all on function batalkan_waste(uuid, text) from public;
grant execute on function batalkan_waste(uuid, text) to authenticated;
revoke all on function pulihkan_waste(uuid, text) from public;
grant execute on function pulihkan_waste(uuid, text) to authenticated;

comment on function batalkan_waste(uuid, text) is
  'Batalkan kejadian waste: stok kembali, barisnya tetap ada beserta alasannya. Rekap tidak memuatnya lagi.';

-- ---------------------------------------------------------
-- 5. REKAPNYA TIDAK MEMUAT YANG DIBATALKAN
--
-- Ditulis ulang utuh dari 0147 dengan DUA perubahan: saringan
-- `dibatalkan_at is null` dan tiga kolom jejak di UJUNG. Kolom baru harus di
-- ujung — `create or replace view` menuntut kolom lama tetap di posisi dan
-- tipe yang sama, dan menyisipkannya di tengah membuat perintah ini gagal di
-- tengah migration, sesudah sebagiannya sudah berubah.
-- ---------------------------------------------------------
create or replace view waste_rekap as
  select w.id              as waste_id,
         w.business_unit_id,
         w.outlet_id,
         o.name            as outlet_nama,
         w.code,
         w.jenis,
         w.created_at,
         (w.created_at at time zone 'Asia/Jakarta')::date as tanggal,
         w.qty             as qty_kejadian,
         w.photo_path,
         w.notes,
         p.name            as sumber_nama,
         wi.product_id,
         b.name            as bahan_nama,
         b.base_unit       as bahan_satuan,
         wi.qty            as bahan_qty,
         u.full_name       as dicatat_oleh,
         false             as lama,
         w.purpose         as purpose,
         (w.esb_exported_at is not null) as esb_terkunci,
         w.product_id      as sumber_id,
         w.revisi_ke       as revisi_ke,
         r.full_name       as direvisi_oleh
    from waste_runs w
    join waste_items wi on wi.waste_id = w.id
    join outlets o      on o.id = w.outlet_id
    join products p     on p.id = w.product_id
    join products b     on b.id = wi.product_id
    left join user_profiles u on u.id = w.created_by
    left join user_profiles r on r.id = w.direvisi_by
   where w.dibatalkan_at is null

  union all

  select
         md5(sm.outlet_id::text || sm.created_at::text || coalesce(sm.notes, ''))::uuid as waste_id,
         sm.business_unit_id,
         sm.outlet_id,
         o.name as outlet_nama,
         null::text as code,
         case when sm.notes like 'Waste menu: %' then 'menu' else 'spoil' end as jenis,
         sm.created_at,
         (sm.created_at at time zone 'Asia/Jakarta')::date as tanggal,
         case
           when sm.notes like 'Waste menu: %'
             then nullif(substring(sm.notes from '^Waste menu: .+ x([0-9]+(?:[.,][0-9]+)?)'), '')::numeric
           else abs(sm.qty_delta)
         end as qty_kejadian,
         null::text as photo_path,
         case
           when sm.notes like 'Waste menu: %' then nullif(substring(sm.notes from ' — (.*)$'), '')
           when sm.notes like 'Spoil: %'      then nullif(substring(sm.notes from '^Spoil: (.*)$'), '')
           else nullif(sm.notes, 'Spoil')
         end as notes,
         case
           when sm.notes like 'Waste menu: %'
             then coalesce(nullif(substring(sm.notes from '^Waste menu: (.+) x[0-9]'), ''), '(menu tidak tercatat)')
           else b.name
         end as sumber_nama,
         sm.product_id,
         b.name      as bahan_nama,
         b.base_unit as bahan_satuan,
         abs(sm.qty_delta) as bahan_qty,
         u.full_name as dicatat_oleh,
         true        as lama,
         null::text  as purpose,
         false       as esb_terkunci,
         null::uuid  as sumber_id,
         0           as revisi_ke,
         null::text  as direvisi_oleh
    from stock_movements sm
    join outlets o  on o.id = sm.outlet_id
    join products b on b.id = sm.product_id
    left join user_profiles u on u.id = sm.created_by
   where sm.movement_type = 'waste'
     and sm.waste_run_id is null;

comment on view waste_rekap is
  'Satu baris per BAHAN yang berkurang. Yang DIBATALKAN tidak ikut (0181). `lama` menandai catatan sebelum 0135; `purpose` kosong berarti kejadiannya tertahan saat diekspor ke ESB.';

alter view waste_rekap set (security_invoker = true);
grant select on waste_rekap to authenticated;

-- ---------------------------------------------------------
-- 6. YANG DIBATALKAN HARUS BISA DILIHAT
--
-- Kalau tidak, "berjejak" cuma berlaku bagi yang bisa membuka SQL editor —
-- dan admin yang salah membatalkan tidak punya cara menemukan kembali barisnya
-- untuk dipulihkan.
-- ---------------------------------------------------------
create or replace function daftar_waste_dibatalkan(
  p_bu uuid,
  p_outlet uuid default null,
  p_dari date default null,
  p_sampai date default null
) returns table (
  waste_id uuid,
  code text,
  jenis text,
  tanggal date,
  outlet_nama text,
  sumber_nama text,
  qty numeric,
  notes text,
  dicatat_oleh text,
  dibatalkan_oleh text,
  dibatalkan_at timestamptz,
  alasan_batal text
)
language sql
security definer
set search_path = public
as $$
  select w.id, w.code, w.jenis,
         (w.created_at at time zone 'Asia/Jakarta')::date,
         o.name, p.name, w.qty, w.notes,
         u.full_name, d.full_name, w.dibatalkan_at, w.alasan_batal
    from waste_runs w
    join outlets o  on o.id = w.outlet_id
    join products p on p.id = w.product_id
    left join user_profiles u on u.id = w.created_by
    left join user_profiles d on d.id = w.dibatalkan_by
   where w.business_unit_id = p_bu
     and w.dibatalkan_at is not null
     and has_bu_scope(auth.uid(), w.business_unit_id)
     and (p_outlet is null or w.outlet_id = p_outlet)
     and (p_dari is null or (w.created_at at time zone 'Asia/Jakarta')::date >= p_dari)
     and (p_sampai is null or (w.created_at at time zone 'Asia/Jakarta')::date <= p_sampai)
   order by w.dibatalkan_at desc;
$$;

revoke all on function daftar_waste_dibatalkan(uuid, uuid, date, date) from public;
grant execute on function daftar_waste_dibatalkan(uuid, uuid, date, date) to authenticated;

-- ---------------------------------------------------------
-- 7. `catat_waste` MEMAKAI ATURAN YANG SAMA
--
-- Ditulis ulang dari 0147 dengan SATU perubahan: paruh keduanya diganti
-- `pasang_waste(v_id)`. Seluruh pemeriksaan di paruh pertama (foto wajib,
-- jenis, jumlah, wewenang outlet, Purpose) disalin apa adanya — dan auditnya
-- membandingkan baris demi baris dengan 0147 supaya tidak ada yang hilang
-- diam-diam, seperti yang pernah terjadi di 0179.
-- ---------------------------------------------------------
create or replace function catat_waste(
  p_outlet uuid,
  p_jenis text,
  p_product uuid,
  p_qty numeric,
  p_photo text,
  p_notes text,
  p_purpose text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_bu uuid;
  v_id uuid := gen_random_uuid();
  v_nama text;
  v_role text;
  v_mode text;
  v_recipe recipes%rowtype;
  v_foto text := nullif(btrim(coalesce(p_photo, '')), '');
  v_purpose text;
  v_n int := 0;
  r record;
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  if p_jenis is null or p_jenis not in ('spoil', 'menu') then
    raise exception 'Jenis waste tidak dikenal.';
  end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Jumlah harus lebih dari 0.'; end if;

  if v_foto is null then
    raise exception 'Foto wajib diisi. Ambil foto bahan yang rusak atau menu yang terbuang dulu, baru simpan.';
  end if;

  select business_unit_id, outlet_role into v_bu, v_role from outlets where id = p_outlet;
  if v_bu is null then raise exception 'Outlet tidak valid.'; end if;
  if not has_outlet_scope(v_uid, p_outlet) then
    raise exception 'Kamu tidak berhak mencatat waste di outlet ini.';
  end if;

  -- Diperiksa SEBELUM foto diunggah sia-sia dan sebelum stok bergerak.
  v_purpose := purpose_esb_sah(v_bu, p_purpose);

  select name into v_nama from products where id = p_product;
  if v_nama is null then raise exception 'Produk tidak ditemukan.'; end if;

  insert into waste_runs (id, business_unit_id, outlet_id, jenis, product_id, qty, photo_path, code, notes,
                          purpose, purpose_diisi_by, purpose_diisi_at, created_by)
  values (v_id, v_bu, p_outlet, p_jenis, p_product, p_qty, v_foto,
          'WST-' || to_char((now() at time zone 'Asia/Jakarta'), 'YYMMDD') || '-' || upper(substr(v_id::text, 1, 4)),
          nullif(btrim(coalesce(p_notes, '')), ''),
          v_purpose,
          case when v_purpose is null then null else v_uid end,
          case when v_purpose is null then null else now() end,
          v_uid);

  -- ============ SATU TEMPAT SAJA YANG TAHU CARA MEMOTONG STOK ============
  --
  -- Paruh kedua fungsi ini (rincian bahan + pergerakan stok, termasuk
  -- penjabaran resep untuk waste menu) dipindahkan ke `pasang_waste` (0181),
  -- supaya pencatatan dan REVISI memakai aturan yang sama persis. Dua salinan
  -- aturan resep pasti menyimpang pada perbaikan berikutnya — dan
  -- penyimpangannya tidak memunculkan galat, ia cuma membuat stok yang
  -- dipotong revisi berbeda dari stok yang dipotong pencatatan.
  v_n := pasang_waste(v_id);

  return v_id;
end;
$$;

revoke all on function catat_waste(uuid, text, uuid, numeric, text, text, text) from public;
grant execute on function catat_waste(uuid, text, uuid, numeric, text, text, text) to authenticated;

comment on function catat_waste(uuid, text, uuid, numeric, text, text, text) is
  'Satu-satunya jalan mencatat waste/spoil. Foto WAJIB. Potongan stoknya dipasang `pasang_waste` — aturan yang sama dipakai revisi (0181).';

notify pgrst, 'reload schema';
