-- =========================================================
-- Berjaya Hub OMS — 0135
-- Waste / Spoil jadi KEJADIAN yang berfoto, dan fotonya wajib.
--
-- =========================================================
-- YANG DIMINTA
-- =========================================================
--
--   "di sisi staff app sediakan input foto bahan yang di spoil atau menu yang
--    di waste, dan ini wajib, jika tidak diinput foto maka tidak bisa simpan,
--    lalu di sisi admin portal sediakan rekap spoil waste berdasarkan rentang
--    tanggal ... tambahkan juga keterangan yang berisi jika spoil dalam bentuk
--    bahan mentah maka keterangan berisi bahan mentah, jika waste dalam bentuk
--    menu, maka bahan yang waste sesuai resep menu yang di waste keterangannya
--    waste menu apa"
--
-- =========================================================
-- KENAPA PERLU TABEL BARU, BUKAN SATU KOLOM FOTO
-- =========================================================
--
-- Sebelum ini waste/spoil tidak punya wujud sendiri sama sekali:
--
--   spoil       -> SATU baris `stock_movements` (movement_type='waste')
--   waste menu  -> BEBERAPA baris `stock_movements`, satu per bahan resep,
--                  dibuat `record_menu_waste` (0032)
--
-- Menempelkan `photo_path` ke `stock_movements` akan menyimpan foto yang SAMA
-- berkali-kali untuk satu kejadian waste menu — dan lebih buruk, tidak ada apa
-- pun yang menyatakan bahwa lima baris itu satu kejadian. Membatalkan salah
-- satunya, atau menghitung "berapa kali waste bulan ini", jadi mustahil.
--
-- Jadi kejadiannya diberi dokumen sendiri (`waste_runs`), dan tiap baris
-- pergerakan stok menunjuk kembali ke dokumen itu.
--
-- =========================================================
-- "WAJIB" DITEGAKKAN DI SERVER, BUKAN DI LAYAR
-- =========================================================
--
-- Kalau kewajiban fotonya hanya berupa tombol yang mati di layar, ia bertahan
-- persis sampai:
--
--   - PWA di HP staff tertinggal versi (cache lama masih memanggil jalur lama),
--   - seseorang memanggil RPC-nya langsung,
--   - atau layar berikutnya ditulis orang yang tidak tahu aturannya.
--
-- Tiga-tiganya sudah pernah terjadi di repo ini. Maka:
--
--   1. `waste_runs.photo_path` NOT NULL + check tidak boleh string kosong.
--   2. Trigger menolak baris `stock_movements` bertipe 'waste' yang TIDAK
--      menunjuk sebuah `waste_run`. Ini yang menutup jalur lama — insert
--      langsung dari klien dan `record_menu_waste` sekaligus.
--   3. `record_menu_waste` (0032) diganti isinya jadi penolakan yang MENJELASKAN,
--      bukan dibiarkan gagal dengan pesan trigger yang membingungkan.
--
-- Baris waste LAMA tidak disentuh: triggernya hanya berlaku untuk insert baru.
-- Menyembunyikan sejarah yang sudah ada akan terbaca sebagai data yang hilang.
-- =========================================================

-- ---------------------------------------------------------
-- (1) Bucket foto + kebijakannya.
--
-- Path-nya `{outlet_id}/{waktu}-{acak}.{ext}` — outlet di depan supaya izinnya
-- bisa diperiksa dari nama berkasnya sendiri. Itu perlu karena fotonya
-- DIUNGGAH DULU, catatan wastenya dibuat sesudahnya: saat unggahannya
-- diperiksa, baris `waste_runs`-nya memang belum ada.
--
-- Pola ini disalin dari `receipt-photos` (0084/0130), termasuk alasan kenapa
-- bucketnya TIDAK publik — isinya bahan busuk milik outlet, bukan bahan promosi.
-- ---------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('waste-photos', 'waste-photos', false)
on conflict (id) do nothing;

drop policy if exists waste_photo_insert on storage.objects;
create policy waste_photo_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'waste-photos'
    and has_outlet_scope(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );

drop policy if exists waste_photo_select on storage.objects;
create policy waste_photo_select on storage.objects
  for select using (
    bucket_id = 'waste-photos'
    and has_outlet_scope(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );

drop policy if exists waste_photo_delete on storage.objects;
create policy waste_photo_delete on storage.objects
  for delete using (
    bucket_id = 'waste-photos'
    and has_outlet_scope(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );

-- ---------------------------------------------------------
-- (2) Dokumen waste/spoil.
-- ---------------------------------------------------------
create table if not exists waste_runs (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references business_units(id) on delete cascade,
  outlet_id uuid not null references outlets(id) on delete cascade,
  -- 'spoil' = bahan mentah/setengah jadi rusak.
  -- 'menu'  = menu jadi terbuang; bahannya dipotong sesuai resep.
  jenis text not null check (jenis in ('spoil', 'menu')),
  -- Yang RUSAK/TERBUANG: bahannya sendiri (spoil), atau menunya (menu).
  product_id uuid not null references products(id) on delete restrict,
  qty numeric not null check (qty > 0),
  -- WAJIB. `not null` saja tidak cukup: string kosong lolos dari `not null`,
  -- dan string kosong persis yang dikirim sebuah form yang bidangnya tidak
  -- diisi. Yang tersimpan akan tampak punya foto sampai ada yang mengkliknya.
  photo_path text not null check (btrim(photo_path) <> ''),
  code text,
  notes text,
  created_by uuid references user_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists waste_runs_code_uk on waste_runs(code) where code is not null;
create index if not exists idx_waste_runs_outlet on waste_runs(business_unit_id, outlet_id, created_at desc);

-- Rincian bahan yang benar-benar berkurang. Untuk spoil isinya satu baris
-- (bahan itu sendiri); untuk waste menu, satu baris per bahan resepnya.
--
-- Disimpan walau bisa dihitung ulang dari resep, dan itu disengaja: resep
-- BERUBAH. Menghitung ulang waste bulan lalu dengan resep hari ini menghasilkan
-- angka yang tidak pernah cocok dengan stok yang benar-benar terpotong saat itu.
create table if not exists waste_items (
  id uuid primary key default gen_random_uuid(),
  waste_id uuid not null references waste_runs(id) on delete cascade,
  product_id uuid not null references products(id) on delete restrict,
  qty numeric not null check (qty > 0)
);
create unique index if not exists waste_items_produk_uk on waste_items(waste_id, product_id);
create index if not exists idx_waste_items_run on waste_items(waste_id);

alter table waste_runs enable row level security;
alter table waste_items enable row level security;

drop policy if exists waste_runs_select on waste_runs;
create policy waste_runs_select on waste_runs
  for select using (has_bu_scope(auth.uid(), business_unit_id));

drop policy if exists waste_items_select on waste_items;
create policy waste_items_select on waste_items
  for select using (
    exists (select 1 from waste_runs w where w.id = waste_items.waste_id and has_bu_scope(auth.uid(), w.business_unit_id))
  );

-- SENGAJA TANPA policy insert/update/delete.
--
-- Satu-satunya jalan masuk adalah `catat_waste` (security definer). Membuka
-- insert langsung berarti membuka jalan menyimpan waste tanpa foto — yaitu
-- persis yang sedang ditutup.

comment on table waste_runs is
  'Satu kejadian waste/spoil, dengan fotonya. Fotonya WAJIB dan ditegakkan di sini, bukan di layar.';

-- ---------------------------------------------------------
-- (3) Pergerakan stok menunjuk balik ke dokumennya.
-- ---------------------------------------------------------
alter table stock_movements add column if not exists waste_run_id uuid references waste_runs(id) on delete set null;
create index if not exists idx_sm_waste_run on stock_movements(waste_run_id) where waste_run_id is not null;

comment on column stock_movements.waste_run_id is
  'Dokumen waste/spoil yang melahirkan baris ini. Wajib untuk baris waste BARU — lihat trigger trg_waste_wajib_dokumen.';

-- ---------------------------------------------------------
-- (4) YANG MENUTUP JALUR LAMA.
--
-- Tanpa ini, seluruh fitur ini adalah aturan yang berlaku hanya bagi orang yang
-- memakai layar barunya. Staff dengan PWA lama tetap bisa menyimpan spoil tanpa
-- foto — lewat insert langsung ke `stock_movements`, persis seperti yang
-- dilakukan `inventory.page.js` sebelum perubahan ini — dan tidak ada satu pun
-- error yang menandainya. Rekapnya cuma diam-diam tidak lengkap.
-- ---------------------------------------------------------
create or replace function jaga_waste_berdokumen()
returns trigger
language plpgsql
as $$
begin
  if new.movement_type = 'waste' and new.waste_run_id is null then
    raise exception 'Waste/Spoil harus dicatat lewat layar Waste/Spoil beserta fotonya. Kalau tombolnya belum ada, tutup aplikasi lalu buka lagi supaya versinya diperbarui.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_waste_wajib_dokumen on stock_movements;
create trigger trg_waste_wajib_dokumen
  before insert on stock_movements
  for each row execute function jaga_waste_berdokumen();

-- ---------------------------------------------------------
-- (5) `record_menu_waste` (0032) menolak dengan MENJELASKAN.
--
-- Kalau dibiarkan apa adanya, ia akan gagal karena trigger di atas — dengan
-- pesan yang menyebut "layar Waste/Spoil" kepada orang yang merasa sedang
-- memakai layar Waste/Spoil. Dihapus juga tidak bisa: PWA lama akan mendapat
-- 42883 "function does not exist", pesan yang tidak berarti apa-apa bagi staff.
--
-- Argumennya dipertahankan persis supaya PostgREST tetap menemukannya.
-- ---------------------------------------------------------
create or replace function record_menu_waste(p_bu uuid, p_outlet uuid, p_product uuid, p_qty numeric, p_notes text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'Pencatatan waste sekarang wajib menyertakan foto. Tutup aplikasi ini lalu buka lagi supaya versinya diperbarui, kemudian catat ulang lewat tombol Waste / Spoil.'
    using errcode = 'check_violation';
end;
$$;

comment on function record_menu_waste(uuid, uuid, uuid, numeric, text) is
  'USANG sejak 0135 — diganti catat_waste yang mewajibkan foto. Sengaja tetap ada supaya PWA lama mendapat pesan yang bisa ditindaklanjuti, bukan 42883.';

-- ---------------------------------------------------------
-- (6) CATAT WASTE — satu-satunya jalan masuk.
--
-- `p_jenis`:
--   'spoil' -> `p_product` adalah BAHAN. Yang berkurang bahan itu sendiri.
--   'menu'  -> `p_product` adalah MENU. Yang berkurang bahan-bahan resepnya,
--              sebanyak porsinya — rumus yang sama dengan `record_menu_waste`
--              lama supaya angka historisnya tetap sebanding.
-- ---------------------------------------------------------
create or replace function catat_waste(
  p_outlet uuid,
  p_jenis text,
  p_product uuid,
  p_qty numeric,
  p_photo text,
  p_notes text
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
  v_n int := 0;
  r record;
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  if p_jenis is null or p_jenis not in ('spoil', 'menu') then
    raise exception 'Jenis waste tidak dikenal.';
  end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Jumlah harus lebih dari 0.'; end if;

  -- FOTONYA DIPERIKSA SEBELUM APA PUN DITULIS.
  --
  -- Bukan sekadar mengandalkan `not null` di tabelnya: pesan constraint
  -- ("null value violates not-null constraint") tidak memberi tahu staff apa
  -- yang harus ia lakukan, dan yang membacanya sedang berdiri di dapur.
  if v_foto is null then
    raise exception 'Foto wajib diisi. Ambil foto bahan yang rusak atau menu yang terbuang dulu, baru simpan.';
  end if;

  select business_unit_id, outlet_role into v_bu, v_role from outlets where id = p_outlet;
  if v_bu is null then raise exception 'Outlet tidak valid.'; end if;
  if not has_outlet_scope(v_uid, p_outlet) then
    raise exception 'Kamu tidak berhak mencatat waste di outlet ini.';
  end if;

  select name into v_nama from products where id = p_product;
  if v_nama is null then raise exception 'Produk tidak ditemukan.'; end if;

  insert into waste_runs (id, business_unit_id, outlet_id, jenis, product_id, qty, photo_path, code, notes, created_by)
  values (v_id, v_bu, p_outlet, p_jenis, p_product, p_qty, v_foto,
          'WST-' || to_char((now() at time zone 'Asia/Jakarta'), 'YYMMDD') || '-' || upper(substr(v_id::text, 1, 4)),
          nullif(btrim(coalesce(p_notes, '')), ''), v_uid);

  if p_jenis = 'spoil' then
    -- Bahan mentah rusak: yang berkurang bahan itu sendiri, apa adanya.
    insert into waste_items (waste_id, product_id, qty) values (v_id, p_product, p_qty);

    -- SENGAJA TANPA `unit_cost`. Ia sumber tunggal biaya rata-rata (0118) dan
    -- sejak 0123 hanya diisi pembelian dari nota. Waste adalah pengeluaran
    -- barang, bukan pemasukan berharga.
    insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, notes, created_by, waste_run_id)
    values (v_bu, p_outlet, p_product, 'waste', -p_qty,
            'Spoil bahan' || case when p_notes is null or btrim(p_notes) = '' then '' else ' — ' || btrim(p_notes) end,
            v_uid, v_id);
    v_n := 1;
  else
    -- Waste MENU: bahannya dipotong sesuai resep.
    --
    -- Pemilihan modenya sama dengan `record_menu_waste` lama — outlet yang
    -- dilayani CK memakai resep 'served_by_ck' kalau ada, karena di sana
    -- sebagian bahan datang sudah setengah jadi.
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
      -- Bahan berjumlah 0 di resep dilewati: baris waste bernilai nol tidak
      -- memberi tahu apa pun dan cuma memanjangkan rekapnya.
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

revoke all on function catat_waste(uuid, text, uuid, numeric, text, text) from public;
grant execute on function catat_waste(uuid, text, uuid, numeric, text, text) to authenticated;

comment on function catat_waste(uuid, text, uuid, numeric, text, text) is
  'Satu-satunya jalan mencatat waste/spoil. Foto WAJIB. spoil -> bahan itu sendiri; menu -> bahan resepnya.';

-- ---------------------------------------------------------
-- (7) Rekap untuk Admin Portal — SATU BARIS PER BAHAN.
--
-- Bentuknya mengikuti apa yang diminta: spoil beras jadi satu baris berketerangan
-- "Bahan mentah"; waste 2 porsi Nasi Goreng jadi tiga baris (beras, telur,
-- minyak) yang masing-masing berketerangan "Waste menu Nasi Goreng".
--
-- Dibuat VIEW, bukan disusun di klien, supaya layar dan ekspor membaca baris
-- yang sama persis. Nilai rupiahnya TIDAK dihitung di sini — biaya rata-rata
-- per outlet sudah punya view sendiri (`biaya_rata_bahan`, 0118) dan
-- menggandakan rumusnya berarti dua angka yang cepat atau lambat berbeda.
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
         u.full_name       as dicatat_oleh
    from waste_runs w
    join waste_items wi on wi.waste_id = w.id
    join outlets o      on o.id = w.outlet_id
    join products p     on p.id = w.product_id
    join products b     on b.id = wi.product_id
    left join user_profiles u on u.id = w.created_by;

comment on view waste_rekap is
  'Satu baris per BAHAN yang berkurang. Tanggalnya WIB, bukan UTC — rekap sehari yang bergeser tujuh jam akan memindahkan waste tengah malam ke tanggal yang salah.';

-- View tidak mewarisi RLS tabelnya secara otomatis di semua versi; dijalankan
-- sebagai pemanggil supaya `waste_runs_select` tetap berlaku.
alter view waste_rekap set (security_invoker = true);

grant select on waste_rekap to authenticated;

-- ---------------------------------------------------------
-- (8) Laporkan hasilnya.
--
-- Migration yang "berhasil" tanpa berkata apa-apa adalah persis cara bucket
-- foto nota bisa tidak ada selama berbulan-bulan (0130).
-- ---------------------------------------------------------
do $$
declare
  v_bucket boolean;
  v_trigger boolean;
begin
  select exists (select 1 from storage.buckets where id = 'waste-photos') into v_bucket;
  select exists (
    select 1 from pg_trigger where tgname = 'trg_waste_wajib_dokumen' and not tgisinternal
  ) into v_trigger;

  raise notice 'bucket waste-photos ada: %', v_bucket;
  raise notice 'trigger trg_waste_wajib_dokumen terpasang: %', v_trigger;

  if not v_bucket then
    raise exception 'Bucket waste-photos TIDAK terbuat — unggah foto akan gagal dengan "Bucket not found".';
  end if;
  if not v_trigger then
    raise exception 'Trigger trg_waste_wajib_dokumen TIDAK terpasang — waste tanpa foto masih bisa masuk lewat jalur lama.';
  end if;
end $$;
