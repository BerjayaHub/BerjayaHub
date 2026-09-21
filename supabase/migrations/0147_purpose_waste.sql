-- ============================================================
-- 0147 — PURPOSE DIISI STAFF, BUKAN DITEBAK DARI KATEGORI.
--
-- ============ APA YANG BERUBAH DARI 0146, DAN KENAPA ============
--
-- `0146` memperlakukan Purpose sebagai PEMETAAN: jenis waste ('spoil'/'menu')
-- dipetakan ke satu nilai Purpose ESB. Berkas Master Purpose yang sesungguhnya
-- membantah bentuk itu:
--
--   Waste Kitchen    -> COGS - Food
--   Waste Bar        -> COGS - Beverage
--   Packaging Spoil  -> COGS - Other
--
-- Sumbunya BUKAN "rusak atau terbuang", melainkan "dapur, bar, atau kemasan" —
-- dan itu tidak bisa diturunkan dari `jenis`. Menurunkannya dari kategori
-- produk pun tebakan: kategori di Berjaya Hub diketik sendiri dan tidak dibuat
-- untuk menjawab pertanyaan ini.
--
-- Jadi Purpose disimpan APA ADANYA di kejadiannya, dan yang memilihnya orang
-- yang berdiri di depan barangnya.
--
-- ============ YANG DITAMBAHKAN DI SINI ============
--
--   (1) `waste_runs.purpose` beserta jejak siapa yang mengisinya.
--   (2) `purpose_esb_sah()` — satu tempat yang memutuskan nilai Purpose sah
--       atau tidak, dipakai jalur staff DAN jalur admin.
--   (3) `catat_waste` menerima `p_purpose`. Tanda tangan lamanya DIBUANG.
--   (4) `ubah_purpose_waste` — admin mengisi kejadian yang sudah terlanjur
--       tercatat tanpa Purpose.
--   (5) `waste_rekap` memuat kolom `purpose`.
--
-- Jenis pemetaan 'purpose' di `esb_master` (dari 0146) TETAP dipakai — bukan
-- lagi sebagai pemetaan, melainkan sebagai DAFTAR PILIHAN dropdown-nya.
-- `esb_map` jenis 'purpose' jadi tidak terpakai; constraint-nya dibiarkan apa
-- adanya karena membuangnya tidak menambah keamanan apa pun dan menuntut
-- migration lain lagi.
-- ============================================================

-- ---------------------------------------------------------
-- (1) Kolomnya, beserta jejak pengisinya.
--
-- Jejaknya ada karena kolom ini akan diisi MUNDUR untuk ratusan kejadian lama
-- oleh admin, sementara kejadian baru diisi staff di outlet. Tanpa jejak, tidak
-- ada cara membedakan "dipilih orang yang melihat barangnya" dari "ditebak
-- orang kantor tiga minggu kemudian" — dan keduanya bernilai berbeda saat
-- angkanya dipertanyakan.
-- ---------------------------------------------------------
alter table waste_runs add column if not exists purpose text;
alter table waste_runs add column if not exists purpose_diisi_by uuid references user_profiles(id) on delete set null;
alter table waste_runs add column if not exists purpose_diisi_at timestamptz;

create index if not exists idx_waste_tanpa_purpose on waste_runs(business_unit_id, outlet_id)
  where purpose is null;

comment on column waste_runs.purpose is
  'Purpose ESB (Waste Kitchen / Waste Bar / Packaging Spoil), dipilih staff saat mencatat. Kosong = kejadian ini tertahan saat diekspor ke Item Journal.';

-- ---------------------------------------------------------
-- (2) SATU tempat yang memutuskan nilainya sah.
--
-- Dipakai dua jalur (staff mencatat, admin mengisi mundur). Kalau aturannya
-- ditulis dua kali, salah satunya akan menyimpang — dan yang menyimpang itu
-- mengirimkan nilai yang ditolak ESB berbulan-bulan kemudian.
--
-- Tiga keadaan, sengaja dibedakan:
--
--   kosong                      -> null. Belum diisi BUKAN kesalahan; ekspornya
--                                  yang menahan, dan alasannya terbaca.
--   daftar induk belum diimpor  -> diterima apa adanya. Aturan baru tidak boleh
--                                  mengunci pencatatan waste di BU yang belum
--                                  sempat mengimpor daftarnya.
--   ada daftar induk            -> WAJIB cocok, dan yang dikembalikan ejaan
--                                  kanonik dari daftarnya — bukan yang diketik.
-- ---------------------------------------------------------
create or replace function purpose_esb_sah(p_bu uuid, p_purpose text)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  v text := nullif(btrim(coalesce(p_purpose, '')), '');
  v_ada boolean;
  v_kanonik text;
begin
  if v is null then
    return null;
  end if;

  select exists (select 1 from esb_master m where m.business_unit_id = p_bu and m.jenis = 'purpose')
    into v_ada;
  if not v_ada then
    return v;
  end if;

  select m.nama into v_kanonik
    from esb_master m
   where m.business_unit_id = p_bu
     and m.jenis = 'purpose'
     and lower(btrim(m.nama)) = lower(v)
   limit 1;

  if v_kanonik is null then
    raise exception 'Purpose "%" tidak ada di daftar ESB. Pilih dari daftar yang tersedia — nama yang diketik sendiri akan ditolak saat berkasnya diunggah ke ESB.', v;
  end if;
  return v_kanonik;
end;
$$;

comment on function purpose_esb_sah(uuid, text) is
  'Satu-satunya tempat nilai Purpose diperiksa. Kosong boleh; di luar daftar induk tidak. Mengembalikan ejaan kanonik dari daftarnya.';

-- ---------------------------------------------------------
-- (3) catat_waste menerima Purpose.
--
-- TANDA TANGAN LAMANYA DIBUANG, dan itu disengaja.
--
-- PostgREST memilih overload berdasarkan HIMPUNAN NAMA ARGUMEN. Dua tanda
-- tangan yang hanya berbeda satu argumen berarti permintaan yang kehilangan
-- `p_purpose` di perjalanan akan diam-diam memilih yang lama — tersimpan
-- dengan sukses, tanpa Purpose, tanpa satu pun pesan. Lebih baik PWA lama
-- mendapat galat yang jelas dan memuat ulang halamannya (`sw.js` tidak
-- menyimpan aset di cache, jadi memuat ulang cukup).
--
-- Isi fungsinya disalin dari 0135 dengan DUA perubahan: argumen purpose, dan
-- kolomnya ikut ditulis. Ditulis ulang di sini, bukan menyunting 0135, supaya
-- migration yang sudah dijalankan tidak perlu dijalankan ulang.
-- ---------------------------------------------------------
drop function if exists catat_waste(uuid, text, uuid, numeric, text, text);

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

  if p_jenis = 'spoil' then
    insert into waste_items (waste_id, product_id, qty) values (v_id, p_product, p_qty);

    insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, notes, created_by, waste_run_id)
    values (v_bu, p_outlet, p_product, 'waste', -p_qty,
            'Spoil bahan' || case when p_notes is null or btrim(p_notes) = '' then '' else ' — ' || btrim(p_notes) end,
            v_uid, v_id);
    v_n := 1;
  else
    v_mode := case when v_role = 'served_by_ck' then 'served_by_ck' else 'standalone' end;
    select * into v_recipe from recipes where product_id = p_product and mode = v_mode;
    if v_recipe.id is null then
      select * into v_recipe from recipes where product_id = p_product and mode = 'standalone';
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
      values (v_id, r.ingredient_product_id, r.qty * p_qty / v_recipe.yield_qty)
      on conflict (waste_id, product_id) do update set qty = waste_items.qty + excluded.qty;

      insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, notes, created_by, waste_run_id)
      values (v_bu, p_outlet, r.ingredient_product_id, 'waste',
              -(r.qty * p_qty / v_recipe.yield_qty),
              'Waste menu: ' || v_nama || ' x' || p_qty
                || case when p_notes is null or btrim(p_notes) = '' then '' else ' — ' || btrim(p_notes) end,
              v_uid, v_id);
      v_n := v_n + 1;
    end loop;

    if v_n = 0 then
      raise exception 'Resep % tidak punya satu pun bahan berjumlah lebih dari 0.', v_nama;
    end if;
  end if;

  return v_id;
end;
$$;

revoke all on function catat_waste(uuid, text, uuid, numeric, text, text, text) from public;
grant execute on function catat_waste(uuid, text, uuid, numeric, text, text, text) to authenticated;

comment on function catat_waste(uuid, text, uuid, numeric, text, text, text) is
  'Satu-satunya jalan mencatat waste/spoil. Foto WAJIB, Purpose boleh kosong (ekspornya yang menahan). spoil -> bahan itu sendiri; menu -> bahan resepnya.';

-- ---------------------------------------------------------
-- (4) Admin mengisi Purpose kejadian yang sudah terlanjur tercatat.
--
-- Seluruh waste yang ada hari ini tidak punya Purpose — kolomnya baru lahir di
-- migration ini. Tanpa jalan mengisinya, satu-satunya cara adalah SQL Editor,
-- dan itu bukan jalan keluar; itu ketiadaan jalan keluar.
--
-- YANG SUDAH DIEKSPOR DITOLAK. Berkasnya sudah berangkat membawa Purpose yang
-- lama; mengubahnya di sini membuat catatan di dua tempat berbeda selamanya,
-- tanpa satu pun tanda. Bukanya lewat "Batalkan tanda ekspor" dulu.
-- ---------------------------------------------------------
create or replace function ubah_purpose_waste(p_waste uuid[], p_purpose text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_bu uuid;
  v_purpose text;
  v_kode text;
  v_n int;
begin
  if p_waste is null or array_length(p_waste, 1) is null then
    return 0;
  end if;

  -- Purpose diperiksa terhadap BU dari waste-nya sendiri, bukan terhadap BU
  -- yang dikirim klien. Daftar induk berlaku per BU, dan memercayai klien di
  -- sini berarti nilai milik BU lain bisa lolos.
  select w.business_unit_id into v_bu
    from waste_runs w
   where w.id = any(p_waste)
     and is_bu_admin(v_uid, w.business_unit_id)
   limit 1;
  if v_bu is null then
    return 0;
  end if;

  v_purpose := purpose_esb_sah(v_bu, p_purpose);
  if v_purpose is null then
    raise exception 'Pilih Purpose-nya dulu. Mengosongkannya tidak memperbaiki apa pun — kejadiannya akan tetap tertahan saat diekspor.';
  end if;

  select w.code into v_kode
    from waste_runs w
   where w.id = any(p_waste)
     and w.esb_exported_at is not null
   limit 1;
  if v_kode is not null then
    raise exception 'Waste % sudah diekspor ke ESB, jadi Purpose-nya terkunci. Buka tandanya dulu lewat Admin Portal -> Inventory -> Ekspor ESB -> "Batalkan tanda ekspor", lalu perbaiki dan unggah ulang berkasnya.',
      v_kode;
  end if;

  update waste_runs w
     set purpose = v_purpose,
         purpose_diisi_by = v_uid,
         purpose_diisi_at = now()
   where w.id = any(p_waste)
     and w.esb_exported_at is null
     and is_bu_admin(v_uid, w.business_unit_id);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function ubah_purpose_waste(uuid[], text) from public;
grant execute on function ubah_purpose_waste(uuid[], text) to authenticated;

comment on function ubah_purpose_waste(uuid[], text) is
  'Admin BU mengisi/mengubah Purpose kejadian waste. Menolak yang sudah diekspor ke ESB.';

-- ---------------------------------------------------------
-- (5) `waste_rekap` memuat Purpose.
--
-- Kolomnya DITAMBAHKAN DI UJUNG, bukan disisipkan di tengah: `create or replace
-- view` menuntut kolom yang sudah ada tetap di posisi dan tipe yang sama.
-- Menyisipkannya di tengah membuat perintah ini gagal — dan gagalnya di tengah
-- migration, sesudah sebagian sudah berubah.
--
-- Cabang kedua (catatan lama sebelum 0135) tidak punya `waste_runs`, jadi
-- Purpose-nya memang tidak ada dan tidak akan pernah ada. `null` di sana adalah
-- pernyataan yang benar, bukan lubang yang harus ditambal.
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
         (w.esb_exported_at is not null) as esb_terkunci
    from waste_runs w
    join waste_items wi on wi.waste_id = w.id
    join outlets o      on o.id = w.outlet_id
    join products p     on p.id = w.product_id
    join products b     on b.id = wi.product_id
    left join user_profiles u on u.id = w.created_by

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
         false       as esb_terkunci
    from stock_movements sm
    join outlets o  on o.id = sm.outlet_id
    join products b on b.id = sm.product_id
    left join user_profiles u on u.id = sm.created_by
   where sm.movement_type = 'waste'
     and sm.waste_run_id is null;

comment on view waste_rekap is
  'Satu baris per BAHAN yang berkurang, dari dokumen waste (0135) DAN dari catatan lama sebelum foto diwajibkan. `lama` menandai yang kedua; `purpose` kosong berarti kejadiannya akan tertahan saat diekspor ke ESB.';

alter view waste_rekap set (security_invoker = true);
grant select on waste_rekap to authenticated;

notify pgrst, 'reload schema';
