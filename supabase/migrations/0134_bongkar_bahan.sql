-- =========================================================
-- Berjaya Hub OMS — 0134
-- Bongkar bahan setengah jadi kembali menjadi bahan bakunya.
--
-- =========================================================
-- YANG DIMINTA
-- =========================================================
--
--   "saya ingin ada fitur bongkar bahan setengah jadi menjadi bahan baku
--    kembali. contoh : UDANG PACK ; resep = udang 50gr ; dibongkar bahan maka
--    di stock UDANG PACK akan jadi udang 50gr"
--
-- =========================================================
-- INI KEJADIAN BARU, BUKAN PENGHAPUSAN PRODUKSI
-- =========================================================
--
-- Godaan pertamanya adalah memakai `hapus_produksi` (0092). Itu keliru, dan
-- kekeliruannya tidak akan terlihat sampai laporan bulanan dibaca.
--
-- `hapus_produksi` membatalkan sebuah CATATAN PRODUKSI: ia menyatakan produksi
-- itu tidak pernah terjadi. Bongkar menyatakan sebaliknya — produksinya memang
-- terjadi, packnya memang jadi, dan HARI INI ia dibuka lagi. Packnya bahkan
-- mungkin tidak pernah diproduksi di outlet ini; ia bisa datang lewat kiriman
-- dari CK, dan tidak ada catatan produksi apa pun untuk dihapus.
--
-- Jadi bongkar punya nomornya sendiri, jejaknya sendiri, dan pembatalannya
-- sendiri. Sejarah produksinya tidak disentuh.
--
-- =========================================================
-- BAHAN YANG KEMBALI TIDAK MEMBAWA BIAYA
-- =========================================================
--
-- `unit_cost` pada `stock_movements` adalah sumber TUNGGAL biaya rata-rata
-- bahan (0118), dan sejak 0123 ia hanya diisi oleh pemasukan dari PEMBELIAN —
-- nota supplier. Transfer masuk, pembatalan, dan koreksi semuanya sengaja
-- tanpa `unit_cost`.
--
-- Bongkar mengikuti aturan yang sama. Kalau bahan yang kembali membawa biaya
-- turunan dari packnya, ongkos olahan pack itu merembes ke rata-rata biaya
-- bahan bakunya — dan sesudah beberapa siklus produksi-bongkar, harga udang
-- mentah di laporan tidak lagi ada hubungannya dengan harga udang di pasar.
--
-- =========================================================
-- STAFF MEMILIH BARIS MANA YANG KEMBALI
-- =========================================================
--
-- Keputusan pengguna, dan alasannya fisik: UDANG PACK berisi udang + tepung +
-- bumbu. Udangnya bisa dipisahkan; tepung yang sudah menempel tidak.
-- Mengembalikan seluruh resep secara otomatis akan menambah stok tepung yang
-- sebenarnya sudah terbuang.
--
-- Yang DIJAGA: jumlah per bahan tidak boleh MELEBIHI porsinya menurut resep.
-- Lima pack yang resepnya 50gr udang tidak bisa menghasilkan 500gr udang.
-- Tanpa batas itu, fitur ini berubah jadi alat mencetak stok dari udara.
-- =========================================================

-- ---------------------------------------------------------
-- (1) Jenis pergerakan baru.
--
-- Bukan 'usage' atau 'adjustment' yang dipinjam. Keduanya sudah punya arti —
-- "dipakai untuk menjual/memproduksi" dan "hasil opname" — dan meminjamnya
-- membuat laporan waste/opname memuat angka yang bukan miliknya, tanpa cara
-- memisahkannya kembali.
-- ---------------------------------------------------------
do $$
declare
  v_nama text;
begin
  select conname into v_nama from pg_constraint
   where conrelid = 'stock_movements'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%movement_type%';
  if v_nama is not null then
    execute format('alter table stock_movements drop constraint %I', v_nama);
  end if;
end $$;

alter table stock_movements add constraint stock_movements_movement_type_chk
  check (movement_type in (
    'receive', 'waste', 'adjustment', 'transfer_out', 'transfer_in',
    'usage', 'production',
    -- BARU: pack keluar saat dibongkar, dan bahan baku masuk kembali.
    'bongkar_out', 'bongkar_in'
  ));

-- ---------------------------------------------------------
-- (2) Dokumen bongkar.
-- ---------------------------------------------------------
create table if not exists bongkar_runs (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references business_units(id) on delete cascade,
  outlet_id uuid not null references outlets(id) on delete cascade,
  -- Produk setengah jadi yang dibongkar.
  product_id uuid not null references products(id) on delete restrict,
  qty numeric not null check (qty > 0),
  code text,
  notes text,
  created_by uuid references user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  dibatalkan_at timestamptz,
  dibatalkan_by uuid references user_profiles(id) on delete set null,
  alasan_batal text
);
create unique index if not exists bongkar_runs_code_uk on bongkar_runs(code) where code is not null;
create index if not exists idx_bongkar_outlet on bongkar_runs(business_unit_id, outlet_id, created_at desc);

create table if not exists bongkar_items (
  id uuid primary key default gen_random_uuid(),
  bongkar_id uuid not null references bongkar_runs(id) on delete cascade,
  product_id uuid not null references products(id) on delete restrict,
  qty numeric not null check (qty >= 0)
);
-- Satu bahan, satu baris — aturan yang sama dengan 0129.
create unique index if not exists bongkar_items_produk_uk on bongkar_items(bongkar_id, product_id);

alter table bongkar_runs enable row level security;
alter table bongkar_items enable row level security;

drop policy if exists bongkar_runs_select on bongkar_runs;
create policy bongkar_runs_select on bongkar_runs
  for select using (has_bu_scope(auth.uid(), business_unit_id));

drop policy if exists bongkar_items_select on bongkar_items;
create policy bongkar_items_select on bongkar_items
  for select using (
    exists (select 1 from bongkar_runs b where b.id = bongkar_items.bongkar_id and has_bu_scope(auth.uid(), b.business_unit_id))
  );

comment on table bongkar_runs is
  'Membuka kembali bahan setengah jadi menjadi bahan bakunya. Kejadian BARU — bukan pembatalan produksi; packnya bisa saja datang dari kiriman CK dan tidak punya catatan produksi sama sekali.';

-- ---------------------------------------------------------
-- (3) Berapa maksimal tiap bahan boleh kembali.
--
-- Dipisah jadi fungsi sendiri supaya layar bisa memakai angka yang PERSIS
-- sama dengan yang ditegakkan server. Batas yang dihitung dua kali di dua
-- tempat cepat atau lambat menyimpang, dan yang menyimpang di sini adalah
-- jumlah stok.
-- ---------------------------------------------------------
create or replace function porsi_bongkar(p_product uuid, p_qty numeric)
returns table (ingredient_product_id uuid, qty_maks numeric)
language sql
stable
security definer
set search_path = public
as $$
  select ri.ingredient_product_id,
         ri.qty * (p_qty / nullif(r.yield_qty, 0))
    from recipes r
    join recipe_items ri on ri.recipe_id = r.id
   where r.product_id = p_product
     and r.yield_qty > 0;
$$;

revoke all on function porsi_bongkar(uuid, numeric) from public;
grant execute on function porsi_bongkar(uuid, numeric) to authenticated;

-- ---------------------------------------------------------
-- (4) BONGKAR.
--
-- `p_items` = [{product_id, qty}, ...] — hanya bahan yang BENAR-BENAR bisa
-- dipisahkan, dengan jumlah yang staff tentukan sendiri (≤ porsinya).
-- ---------------------------------------------------------
create or replace function bongkar_bahan(
  p_outlet uuid,
  p_product uuid,
  p_qty numeric,
  p_items jsonb,
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
  it jsonb;
  v_pid uuid;
  v_qty numeric;
  v_maks numeric;
  v_n int := 0;
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Jumlah yang dibongkar harus lebih dari 0.'; end if;

  select business_unit_id into v_bu from outlets where id = p_outlet;
  if v_bu is null then raise exception 'Outlet tidak valid.'; end if;
  if not has_outlet_scope(v_uid, p_outlet) then
    raise exception 'Kamu tidak berhak membongkar bahan di outlet ini.';
  end if;

  select name into v_nama from products where id = p_product;
  if v_nama is null then raise exception 'Produk tidak ditemukan.'; end if;

  -- RESEPNYA WAJIB ADA.
  --
  -- Resep adalah satu-satunya yang menyatakan "di dalam pack ini ada apa".
  -- Tanpa itu, bongkar berubah jadi alat mengubah stok apa pun menjadi stok
  -- apa pun — dan alat semacam itu tidak punya batas yang bisa diperiksa
  -- siapa pun.
  if not exists (select 1 from recipes where product_id = p_product and yield_qty > 0) then
    raise exception '% belum punya resep, jadi tidak ada yang bisa dibongkar darinya. Isi resepnya dulu di Master Produk.', v_nama;
  end if;

  -- STOK BOLEH MENEMBUS NOL. Konsisten dengan produksi (0020), kiriman, dan
  -- penjualan — stok tercatat sering tertinggal dari kenyataan di rak, dan
  -- menolak pekerjaan yang benar karena angka yang basi lebih merepotkan
  -- daripada selisih yang muncul di opname. Layar yang memperingatkan; server
  -- tidak menghalangi.

  insert into bongkar_runs (id, business_unit_id, outlet_id, product_id, qty, code, notes, created_by)
  values (v_id, v_bu, p_outlet, p_product, p_qty,
          'BKR-' || to_char((now() at time zone 'Asia/Jakarta'), 'YYMMDD') || '-' || upper(substr(v_id::text, 1, 4)),
          nullif(btrim(coalesce(p_notes, '')), ''), v_uid);

  -- (a) Packnya keluar.
  insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, notes, created_by)
  values (v_bu, p_outlet, p_product, 'bongkar_out', -p_qty, 'Dibongkar jadi bahan baku', v_uid);

  -- (b) Bahan yang benar-benar bisa dipisahkan masuk kembali.
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_pid := (it->>'product_id')::uuid;
    v_qty := (it->>'qty')::numeric;
    if v_pid is null or v_qty is null or v_qty <= 0 then continue; end if;

    select qty_maks into v_maks from porsi_bongkar(p_product, p_qty) where ingredient_product_id = v_pid;
    if v_maks is null then
      raise exception '% bukan bahan dari %. Yang bisa kembali hanya yang tertulis di resepnya.',
        coalesce((select name from products where id = v_pid), 'Bahan itu'), v_nama;
    end if;
    -- BATAS ATASNYA DITEGAKKAN DI SINI.
    --
    -- Lima pack yang resepnya 50gr udang tidak bisa menghasilkan 500gr udang.
    -- Tanpa batas ini, fitur bongkar adalah alat mencetak stok dari udara —
    -- dan stok yang dicetak terlihat persis seperti stok yang sungguhan.
    if v_qty > v_maks + 1e-9 then
      raise exception '% paling banyak % dari % % yang dibongkar — itu isinya menurut resep.',
        (select name from products where id = v_pid), v_maks, p_qty, v_nama;
    end if;

    insert into bongkar_items (bongkar_id, product_id, qty) values (v_id, v_pid, v_qty);

    -- SENGAJA TANPA `unit_cost`. Lihat catatan panjang di kepala berkas.
    insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, notes, created_by)
    values (v_bu, p_outlet, v_pid, 'bongkar_in', v_qty, 'Hasil bongkar ' || v_nama, v_uid);
    v_n := v_n + 1;
  end loop;

  if v_n = 0 then
    -- Bongkar yang tidak mengembalikan apa pun sama saja dengan membuang
    -- packnya. Itu tindakan yang berbeda, punya layarnya sendiri (Waste), dan
    -- laporannya dibaca orang yang berbeda.
    raise exception 'Tidak ada bahan yang dipilih untuk dikembalikan. Kalau packnya memang dibuang, pakai Waste — bukan Bongkar.';
  end if;

  return v_id;
end;
$$;

revoke all on function bongkar_bahan(uuid, uuid, numeric, jsonb, text) from public;
grant execute on function bongkar_bahan(uuid, uuid, numeric, jsonb, text) to authenticated;

comment on function bongkar_bahan(uuid, uuid, numeric, jsonb, text) is
  'Membongkar bahan setengah jadi jadi bahan bakunya. Bahan yang kembali dibatasi porsi resepnya dan TIDAK membawa unit_cost.';

-- ---------------------------------------------------------
-- (5) BATALKAN BONGKAR — salah bongkar harus bisa dibetulkan.
--
-- Pergerakan penyeimbang, bukan penghapusan: pergerakan stok adalah catatan
-- sejarah, dan menghapusnya membuat saldo hari-hari di antaranya tidak bisa
-- direkonstruksi. Alasannya sama persis dengan 0084 dan 0131.
-- ---------------------------------------------------------
create or replace function batalkan_bongkar(p_bongkar uuid, p_alasan text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_b bongkar_runs%rowtype;
  v_nama text;
  r record;
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  if coalesce(btrim(p_alasan), '') = '' then
    raise exception 'Sebutkan alasan pembatalannya — walau sesingkat "salah input".';
  end if;

  select * into v_b from bongkar_runs where id = p_bongkar;
  if v_b.id is null then raise exception 'Catatan bongkar tidak ditemukan.'; end if;
  if v_b.dibatalkan_at is not null then raise exception 'Bongkar % memang sudah dibatalkan.', coalesce(v_b.code, ''); end if;
  if not has_outlet_scope(v_uid, v_b.outlet_id) then
    raise exception 'Catatan bongkar ini bukan wewenangmu.';
  end if;

  select name into v_nama from products where id = v_b.product_id;

  -- Packnya kembali.
  insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, notes, created_by)
  values (v_b.business_unit_id, v_b.outlet_id, v_b.product_id, 'bongkar_in', v_b.qty,
          'Pembatalan bongkar ' || coalesce(v_b.code, '') || ': ' || btrim(p_alasan), v_uid);

  -- Bahan yang tadi dikembalikan ditarik lagi.
  for r in select product_id, qty from bongkar_items where bongkar_id = p_bongkar loop
    insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, notes, created_by)
    values (v_b.business_unit_id, v_b.outlet_id, r.product_id, 'bongkar_out', -r.qty,
            'Pembatalan bongkar ' || coalesce(v_b.code, '') || ': ' || btrim(p_alasan), v_uid);
  end loop;

  update bongkar_runs
     set dibatalkan_at = now(), dibatalkan_by = v_uid, alasan_batal = btrim(p_alasan)
   where id = p_bongkar;
end;
$$;

revoke all on function batalkan_bongkar(uuid, text) from public;
grant execute on function batalkan_bongkar(uuid, text) to authenticated;

comment on function batalkan_bongkar(uuid, text) is
  'Membatalkan catatan bongkar lewat pergerakan penyeimbang. Catatannya tetap ada, ditandai dibatalkan beserta alasannya.';

notify pgrst, 'reload schema';
