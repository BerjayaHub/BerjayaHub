-- =========================================================
-- Berjaya Hub OMS — 0118
-- Biaya rata-rata bahan PER OUTLET, dihitung dari harga di nota penerimaan.
--
-- =========================================================
-- YANG DIMINTA
-- =========================================================
--
--   "di modul bahan, sisi staff app, apakah benar tidak ada input harga di
--    terima dari supplier, jika iya, update menjadi ada harga, dan harga ini
--    berpengaruh ke cost rata rata bahan"
--
-- Benar. `goods_receipt_items.unit_cost` sudah ADA sejak `0084`, RPC-nya sudah
-- menerimanya, dan `laporan-nota.js` sudah membacanya — yang tidak pernah ada
-- adalah kotak isiannya di layar. Jadi kolom itu selalu NULL.
--
-- =========================================================
-- ANGKA INI TIDAK MASUK HPP — DAN ITU DISENGAJA
-- =========================================================
--
-- HPP menu tetap memakai `products.purchase_price / purchase_qty`. Rata-rata
-- nota adalah PEMBANDING: berapa yang sebenarnya dibayar belakangan, dan
-- seberapa jauh dari angka yang sedang dipakai menghitung.
--
-- Kalau ia langsung masuk HPP, satu salah ketik harga di nota akan menggeser
-- HPP, margin, dan pertimbangan harga jual SELURUH menu yang memakai bahan itu
-- — tanpa seorang pun menyetujuinya, dan tanpa satu pun error. Admin yang
-- memutuskan kapan memperbarui masternya.
--
-- Konsekuensi yang menguntungkan: karena tidak masuk HPP, "per outlet" jadi
-- murah. Mesin HPP, Profitabilitas, BEP, dan halaman Owner semuanya tetap
-- berskala BU dan TIDAK DISENTUH sama sekali oleh migration ini.
--
-- =========================================================
-- DIPUTAR ULANG DARI RIWAYAT, BUKAN DITAMBAHKAN SEDIKIT-SEDIKIT
-- =========================================================
--
-- Rata-rata tertimbang bergantung pada URUTAN: tiap pembelian dirata-ratakan
-- terhadap stok yang ada saat itu. Cara yang paling menggoda adalah memperbarui
-- angkanya sedikit demi sedikit tiap kali nota disimpan.
--
-- Masalahnya nota BISA DIEDIT (`ubah_nota_terima`, 0084). Sesudah satu edit,
-- angka yang ditambahkan sedikit-sedikit itu tidak bisa diperbaiki tanpa
-- mengulang seluruhnya — dan yang terjadi adalah angka yang tetap terlihat
-- wajar sambil diam-diam salah.
--
-- Jadi `hitung_biaya_rata()` MEMUTAR ULANG dari `stock_movements` tiap kali
-- dipanggil. Untuk satu bahan di satu outlet itu murah, dan hasilnya selalu
-- cocok dengan riwayat apa pun yang terjadi padanya.
-- =========================================================

create table if not exists biaya_rata_bahan (
  business_unit_id uuid not null references business_units(id) on delete cascade,
  outlet_id        uuid not null references outlets(id) on delete cascade,
  product_id       uuid not null references products(id) on delete cascade,
  -- NULL tidak pernah disimpan: baris hanya ada kalau memang sudah pernah ada
  -- nota berharga. "Belum ada angkanya" diwakili oleh TIDAK ADANYA BARIS, bukan
  -- oleh nol — nol berarti bahannya gratis, dan itu pernyataan yang berbeda.
  rata             numeric not null,
  qty_dasar        numeric not null,
  nota_terakhir    timestamptz,
  dihitung_at      timestamptz not null default now(),
  primary key (outlet_id, product_id)
);
create index if not exists idx_brb_bu on biaya_rata_bahan (business_unit_id);

comment on table biaya_rata_bahan is
  'Biaya rata-rata tertimbang bahan per OUTLET, dari harga di nota penerimaan. PEMBANDING saja — tidak pernah dipakai menghitung HPP menu.';

-- ---------------------------------------------------------
-- HITUNG: putar ulang dari riwayat pergerakan stok.
-- ---------------------------------------------------------
create or replace function hitung_biaya_rata(p_product uuid, p_outlet uuid)
returns table (rata numeric, qty_dasar numeric, nota_terakhir timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r record;
  v_rata numeric := null;
  v_dasar numeric := 0;
  v_terakhir timestamptz := null;
begin
  for r in
    select sm.qty_delta,
           sm.unit_cost,
           sm.created_at,
           -- Stok PERSIS sebelum pergerakan ini. `rows between unbounded
           -- preceding and 1 preceding` — bukan `sum() over (order by …)`,
           -- yang sudah termasuk baris ini sendiri dan akan menghitung
           -- pembeliannya dua kali.
           coalesce(
             sum(sm.qty_delta) over (
               order by sm.created_at, sm.id
               rows between unbounded preceding and 1 preceding
             ), 0
           ) as stok_sebelum
      from stock_movements sm
     where sm.outlet_id = p_outlet
       and sm.product_id = p_product
     order by sm.created_at, sm.id
  loop
    -- HANYA pembelian berharga yang menggeser rata-rata.
    --
    -- Pemakaian tidak mengubahnya (barang keluar pada harga rata-rata yang
    -- berlaku), tapi ia tetap harus IKUT DIBACA di loop ini — karena ia yang
    -- menentukan `stok_sebelum` pembelian berikutnya. Menyaringnya di `where`
    -- akan membuat tiap pembelian dirata-ratakan terhadap stok yang tidak
    -- pernah ada.
    if r.qty_delta is null or r.qty_delta <= 0 then continue; end if;
    if r.unit_cost is null or r.unit_cost < 0 then continue; end if;

    if v_rata is null or r.stok_sebelum <= 0 then
      -- Belum ada apa pun untuk dirata-ratakan.
      --
      -- Stok MINUS memang mungkin di sistem ini — penjualan sengaja boleh
      -- membuat stok negatif (lihat 0108). Memasukkan angka negatif ke rumusnya
      -- menghasilkan rata-rata negatif, atau pembagian mendekati nol yang
      -- meledak jadi angka gila, justru pada bahan yang paling sibuk.
      v_rata := r.unit_cost;
    else
      v_rata := (r.stok_sebelum * v_rata + r.qty_delta * r.unit_cost)
                / (r.stok_sebelum + r.qty_delta);
    end if;

    v_dasar := v_dasar + r.qty_delta;
    v_terakhir := r.created_at;
  end loop;

  if v_rata is null then return; end if;
  rata := round(v_rata, 2);
  qty_dasar := v_dasar;
  nota_terakhir := v_terakhir;
  return next;
end;
$$;

revoke all on function hitung_biaya_rata(uuid, uuid) from public;
grant execute on function hitung_biaya_rata(uuid, uuid) to authenticated;

-- ---------------------------------------------------------
-- SEGARKAN: hitung ulang lalu simpan ke tabel bacaan.
-- ---------------------------------------------------------
create or replace function segarkan_biaya_rata(p_product uuid, p_outlet uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bu uuid;
  v record;
begin
  select business_unit_id into v_bu from outlets where id = p_outlet;
  if v_bu is null then return; end if;

  select * into v from hitung_biaya_rata(p_product, p_outlet);

  if v.rata is null then
    -- Nota terakhirnya dihapus / harganya dikosongkan -> barisnya IKUT HILANG.
    --
    -- Membiarkan angka lama tertinggal berarti layar menampilkan rata-rata
    -- untuk bahan yang sudah tidak punya satu pun nota berharga — angka tanpa
    -- asal-usul, yang tidak bisa ditelusuri siapa pun.
    delete from biaya_rata_bahan where outlet_id = p_outlet and product_id = p_product;
    return;
  end if;

  insert into biaya_rata_bahan (business_unit_id, outlet_id, product_id, rata, qty_dasar, nota_terakhir, dihitung_at)
  values (v_bu, p_outlet, p_product, v.rata, v.qty_dasar, v.nota_terakhir, now())
  on conflict (outlet_id, product_id) do update
    set rata = excluded.rata,
        qty_dasar = excluded.qty_dasar,
        nota_terakhir = excluded.nota_terakhir,
        dihitung_at = now(),
        business_unit_id = excluded.business_unit_id;
end;
$$;

revoke all on function segarkan_biaya_rata(uuid, uuid) from public;
grant execute on function segarkan_biaya_rata(uuid, uuid) to authenticated;

-- ---------------------------------------------------------
-- PEMICU: tiap pergerakan nota menyegarkan bahan yang tersentuh.
--
-- LEWAT TRIGGER, bukan ditambahkan ke tiap RPC nota.
--
-- `simpan_nota_terima` dan `ubah_nota_terima` sama-sama menulis ke
-- `stock_movements`, dan `ubah_nota_terima` menulis PENYEIMBANG saat jumlahnya
-- dikoreksi. Menambahkan panggilan segarkan ke masing-masing berarti tiga
-- tempat yang harus diingat — dan yang terlupa tidak akan menghasilkan error,
-- hanya angka yang diam-diam tertinggal di keadaan lama.
--
-- Trigger menutup seluruh jalur sekaligus, termasuk jalur yang belum ada.
-- ---------------------------------------------------------
create or replace function trg_segarkan_biaya_rata()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  v_row := coalesce(new, old);
  -- Hanya pergerakan yang BERASAL DARI NOTA. Penjualan, opname, dan transfer
  -- tidak mengubah harga beli apa pun — menyegarkan pada tiap penjualan berarti
  -- memutar ulang seluruh riwayat bahan itu puluhan kali sehari tanpa satu pun
  -- angka yang berubah.
  --
  -- Pergerakan LAIN tetap ikut terbaca saat pemutaran ulang (ia menentukan
  -- stok sebelum tiap pembelian) — yang dibatasi di sini hanya KAPAN
  -- penghitungan ulang dijalankan.
  if v_row.receipt_id is null then return null; end if;
  perform segarkan_biaya_rata(v_row.product_id, v_row.outlet_id);
  return null;
end;
$$;

drop trigger if exists stock_movements_biaya_rata on stock_movements;
create trigger stock_movements_biaya_rata
  after insert or update or delete on stock_movements
  for each row execute function trg_segarkan_biaya_rata();


-- ---------------------------------------------------------
-- `ubah_nota_terima` DITULIS ULANG — harga yang dikoreksi harus sampai ke
-- `stock_movements`, karena di situlah biaya rata-rata membacanya.
--
-- Ditulis utuh, bukan ditambal: `create or replace` memang mengganti
-- seluruhnya, dan versi yang setengah disalin adalah cara paling mudah
-- kehilangan satu penjagaan tanpa menyadarinya.
-- ---------------------------------------------------------
create or replace function ubah_nota_terima(
  p_id uuid,
  p_receipt_date date,
  p_supplier text,
  p_invoice_no text,
  p_photo_path text,
  p_notes text,
  p_items jsonb
) returns void
language plpgsql
as $$
declare
  v_bu uuid;
  v_outlet uuid;
  v_code text;
  v_uid uuid := auth.uid();
  it jsonb;
  v_pid uuid;
  v_qty numeric;
  v_lama numeric;
  v_selisih numeric;
  v_ada int;
begin
  select business_unit_id, outlet_id, code into v_bu, v_outlet, v_code from goods_receipts where id = p_id;
  if v_bu is null then raise exception 'Nota tidak ditemukan.'; end if;

  update goods_receipts
  set receipt_date = coalesce(p_receipt_date, receipt_date),
      supplier = nullif(p_supplier, ''),
      invoice_no = nullif(p_invoice_no, ''),
      -- Foto: NULL berarti "jangan sentuh", string kosong berarti "hapus".
      -- Dibedakan karena kasus paling sering adalah MENAMBAHKAN foto yang
      -- menyusul, dan itu tidak boleh menuntut mengunggah ulang yang lain.
      photo_path = case when p_photo_path is null then photo_path else nullif(p_photo_path, '') end,
      notes = nullif(p_notes, ''),
      updated_at = now()
  where id = p_id;
  get diagnostics v_ada = row_count;
  if v_ada = 0 then
    raise exception 'Tidak tersimpan — kamu tidak punya wewenang di outlet nota ini.';
  end if;

  -- Kalau `p_items` NULL, hanya kepala notanya yang diubah (mis. menambahkan
  -- foto yang menyusul). Ini jalur yang paling sering dipakai.
  if p_items is null then return; end if;

  -- 1. Item yang disebut: dibuat atau disesuaikan.
  for it in select * from jsonb_array_elements(p_items) loop
    v_pid := (it->>'product_id')::uuid;
    v_qty := (it->>'qty')::numeric;
    if v_pid is null or v_qty is null or v_qty <= 0 then continue; end if;

    select qty into v_lama from goods_receipt_items where receipt_id = p_id and product_id = v_pid;
    v_selisih := v_qty - coalesce(v_lama, 0);

    if v_lama is null then
      insert into goods_receipt_items (receipt_id, product_id, qty, unit_cost, notes)
      values (p_id, v_pid, v_qty, nullif(it->>'unit_cost', '')::numeric, nullif(it->>'notes', ''));
    else
      update goods_receipt_items
      set qty = v_qty, unit_cost = nullif(it->>'unit_cost', '')::numeric, notes = nullif(it->>'notes', '')
      where receipt_id = p_id and product_id = v_pid;
    end if;

    if v_selisih <> 0 then
      -- Penyeimbangnya ikut membawa harga.
      --
      -- PERLU DICATAT JUJUR bahwa baris ini BUKAN penjaganya: `update
      -- stock_movements` beberapa baris di bawah menyapu SEMUA pergerakan
      -- masuk milik nota ini, termasuk yang baru saja disisipkan di sini.
      -- Sabotase yang menggantinya dengan `null` tidak membuat satu pun tes
      -- merah, dan itu memang benar.
      --
      -- Dipertahankan sebagai pertahanan berlapis: kalau suatu saat urutan
      -- kedua pernyataan ini berubah, atau `update`-nya dipersempit, baris ini
      -- yang membuat penyeimbangnya tetap punya harga sejak detik ia lahir.
      insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, unit_cost, notes, created_by, receipt_id)
      values (v_bu, v_outlet, v_pid, 'receive', v_selisih, nullif(it->>'unit_cost', '')::numeric,
              'Koreksi nota ' || v_code || ' (' || coalesce(v_lama, 0) || ' -> ' || v_qty || ')', v_uid, p_id);
    end if;

    -- HARGA YANG DIKOREKSI HARUS SAMPAI KE `stock_movements`.
    --
    -- Ini celah yang paling mudah terlewat: kalau HANYA harganya yang diubah
    -- (jumlahnya tetap), `v_selisih` = 0 dan TIDAK ADA pergerakan baru sama
    -- sekali. Barisnya di `goods_receipt_items` sudah benar, tapi
    -- `stock_movements` — satu-satunya sumber yang dibaca biaya rata-rata —
    -- tetap memegang harga lama.
    --
    -- Hasilnya: layar nota menampilkan harga yang sudah dibetulkan, sementara
    -- biaya rata-rata bahannya masih dihitung dari harga yang salah. Dua angka
    -- yang bercerita berbeda, tanpa satu pun error.
    update stock_movements
       set unit_cost = nullif(it->>'unit_cost', '')::numeric
     where receipt_id = p_id
       and product_id = v_pid
       and qty_delta > 0;
  end loop;

  -- 2. Item yang HILANG dari daftar baru: dianggap dibatalkan.
  for v_pid, v_lama in
    select product_id, qty from goods_receipt_items
    where receipt_id = p_id
      and product_id not in (
        select (x->>'product_id')::uuid from jsonb_array_elements(p_items) x where (x->>'product_id') is not null
      )
  loop
    -- SENGAJA TANPA `unit_cost`. Pembatalan mengeluarkan barang, dan
    -- pengeluaran tidak pernah menimbang biaya rata-rata — ia hanya mengubah
    -- stok, yang memang sudah ikut terbaca saat perhitungannya diputar ulang.
    insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, notes, created_by, receipt_id)
    values (v_bu, v_outlet, v_pid, 'receive', -v_lama, 'Batal dari nota ' || v_code, v_uid, p_id);
    delete from goods_receipt_items where receipt_id = p_id and product_id = v_pid;
  end loop;
end;
$$;


revoke all on function ubah_nota_terima(uuid, date, text, text, text, text, jsonb) from public;
grant execute on function ubah_nota_terima(uuid, date, text, text, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------
-- RLS
-- ---------------------------------------------------------
alter table biaya_rata_bahan enable row level security;

-- Baca: siapa pun yang punya cakupan di BU-nya. Staff perlu melihatnya di
-- layar Bahan, sama seperti mereka sudah bisa melihat stok.
drop policy if exists brb_select on biaya_rata_bahan;
create policy brb_select on biaya_rata_bahan
  for select to authenticated
  using (has_bu_scope(auth.uid(), business_unit_id));

-- Tulis: TIDAK ADA kebijakan sama sekali. Isinya sepenuhnya turunan dari
-- `stock_movements` dan hanya boleh ditulis trigger `security definer` di atas.
-- Tabel turunan yang bisa disunting tangan berhenti menjadi turunan, dan
-- selisihnya terhadap sumbernya tidak akan pernah terlihat.

-- ---------------------------------------------------------
-- BACKFILL
--
-- Untuk data yang ada sekarang hasilnya hampir pasti KOSONG — `unit_cost` tidak
-- pernah bisa diisi dari layar mana pun. Tetap dijalankan supaya migration ini
-- benar juga bagi siapa pun yang pernah mengisinya lewat SQL Editor, dan supaya
-- menjalankannya ulang selalu menghasilkan keadaan yang sama.
-- ---------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select distinct sm.product_id, sm.outlet_id
      from stock_movements sm
     where sm.receipt_id is not null
       and sm.unit_cost is not null
       and sm.qty_delta > 0
  loop
    perform segarkan_biaya_rata(r.product_id, r.outlet_id);
  end loop;
end;
$$;

notify pgrst, 'reload schema';
