-- =========================================================
-- Berjaya Hub OMS — 0123
-- Angka harga di nota adalah HARGA BELI BARIS, bukan harga per satuan.
--
-- =========================================================
-- SALAH PAHAM YANG DILAPORKAN — DAN BESARNYA
-- =========================================================
--
--   "Harga yang diinput di nota itu bukan harga satuan melainkan harga beli,
--    contoh: beras, qty 5000 gr, harga 180.000, maka yang dimaksud adalah
--    harga 5000 gr itu 180.000 bukan harga per gram nya 180.000"
--
-- Kotak isiannya berlabel "harga/gr" dan disimpan sebagai `unit_cost`. Orang
-- yang memegang nota supplier di tangannya membaca satu angka di kertas itu —
-- Rp180.000 — lalu mengetiknya. Itu perilaku yang wajar; labelnya yang salah
-- menuntut pembagian yang tidak pernah diminta siapa pun.
--
-- Akibatnya BUKAN selisih kecil:
--
--     benar : 5.000 gr seharga  180.000       -> Rp36 / gram
--     salah : 5.000 gr x 180.000 = 900.000.000
--
-- Lima ribu kali lipat. Dan tidak ada satu pun error di sepanjang jalan itu:
-- notanya tersimpan, biaya rata-rata bahannya terisi, HPP menu ikut terhitung,
-- dan seluruh angkanya terlihat seperti angka.
--
-- =========================================================
-- YANG DISIMPAN: KEDUANYA
-- =========================================================
--
-- `line_total` = angka yang DIKETIK ORANG. Ia yang harus sama persis dengan
-- kertas notanya, dan ia yang dijumlahkan jadi total nota & nominal pembayaran.
--
-- `unit_cost` = turunannya (`line_total / qty`). Tetap ada dan tetap jadi satu-
-- satunya yang dibaca `biaya_rata_bahan` (0118) — jadi seluruh perhitungan
-- biaya rata-rata TIDAK berubah bentuknya sama sekali.
--
-- Kenapa tidak menyimpan `unit_cost` saja lalu mengalikannya kembali: 175.000
-- untuk 3.000 gram adalah 58,3333… per gram, dan 3.000 x 58,3333… bukan
-- 175.000. Selisihnya recehan, tapi ia muncul di nominal kas — dan angka kas
-- yang tidak bisa dicocokkan dengan kertas notanya adalah persis hal yang
-- membuat orang berhenti mempercayai laporannya.
--
-- =========================================================
-- BARIS LAMA
-- =========================================================
--
-- `line_total` diisi `qty * unit_cost`, yaitu arti yang DINYATAKAN kolom itu
-- selama ini. Baris yang terlanjur diisi sebagai total tetap salah sesudah
-- migrasi ini — dan sengaja TIDAK ditebak: tidak ada apa pun di data yang bisa
-- membedakan "Rp36 per gram" dari "Rp36 untuk seluruh barisnya". Menebaknya
-- berarti menulis ulang angka uang orang berdasarkan firasat.
--
-- Yang salah diperbaiki dengan membukanya lewat Edit — dan sekarang kotaknya
-- menanyakan hal yang benar.
-- =========================================================

alter table goods_receipt_items add column if not exists line_total numeric;

comment on column goods_receipt_items.line_total is
  'Harga beli SELURUH baris ini menurut nota supplier — angka yang diketik orang. unit_cost adalah turunannya (line_total / qty).';

update goods_receipt_items
   set line_total = qty * unit_cost
 where line_total is null and unit_cost is not null and qty is not null;

-- ---------------------------------------------------------
-- SATU-SATUNYA tempat harga baris nota diterjemahkan.
--
-- Dipakai `simpan_nota_terima` DAN `ubah_nota_terima`. Kalau keduanya menulis
-- aturannya sendiri-sendiri, akan ada keadaan di mana menyimpan dan mengedit
-- nota yang sama menghasilkan harga yang berbeda — dan yang terlihat cuma
-- angka yang berubah sendiri setelah dibuka.
--
-- `line_total` menang atas `unit_cost` kalau keduanya dikirim: yang pertama
-- adalah angka yang diketik orang, yang kedua turunan yang mungkin sudah
-- dibulatkan klien.
-- ---------------------------------------------------------
create or replace function harga_baris_nota(
  p_item jsonb,
  p_qty numeric,
  out total numeric,
  out satuan numeric
)
language plpgsql
immutable
as $$
declare
  v_t text := nullif(p_item->>'line_total', '');
  v_s text := nullif(p_item->>'unit_cost', '');
begin
  if v_t is not null then
    total := v_t::numeric;
    -- `p_qty` selalu > 0 di kedua pemanggilnya (baris berjumlah nol dilewati
    -- sebelum sampai ke sini), tapi dijaga juga: pembagian dengan nol di sini
    -- akan menggagalkan SELURUH nota karena satu baris yang aneh.
    satuan := case when p_qty > 0 then total / p_qty else null end;
  elsif v_s is not null then
    -- Bentuk lama — PWA di HP staff yang belum memperbarui diri masih
    -- mengirimnya. Ditafsirkan sesuai arti yang DINYATAKAN kolom itu dulu:
    -- harga per satuan.
    satuan := v_s::numeric;
    total := p_qty * satuan;
  else
    total := null;
    satuan := null;
  end if;
end;
$$;

comment on function harga_baris_nota(jsonb, numeric) is
  'Menerjemahkan harga satu baris nota. line_total = harga beli seluruh baris (bentuk baru, menang); unit_cost = harga per satuan (bentuk lama).';

-- =========================================================
-- SIMPAN NOTA — item boleh menyebut `line_total` atau `unit_cost`.
--
-- Keduanya diterima, dan itu bukan kemalasan: PWA lama di HP staff masih
-- mengirim `unit_cost` sampai ia memperbarui dirinya sendiri. Kalau fungsi ini
-- hanya menerima bentuk baru, HP yang belum sempat memuat ulang akan menyimpan
-- nota TANPA harga sama sekali — dan itu tidak muncul sebagai error, cuma
-- sebagai nota yang harganya kosong.
-- =========================================================
create or replace function simpan_nota_terima(
  p_outlet uuid,
  p_receipt_date date,
  p_supplier text,
  p_invoice_no text,
  p_photo_path text,
  p_notes text,
  p_items jsonb
) returns uuid
language plpgsql
as $$
declare
  v_bu uuid;
  v_uid uuid := auth.uid();
  v_id uuid := gen_random_uuid();
  v_code text;
  it jsonb;
  v_pid uuid;
  v_qty numeric;
  v_total numeric;
  v_satuan numeric;
  v_n int := 0;
begin
  select business_unit_id into v_bu from outlets where id = p_outlet;
  if v_bu is null then raise exception 'Outlet tidak dikenal.'; end if;

  v_code := 'TRM-' || to_char((now() at time zone 'Asia/Jakarta'), 'YYMMDD') || '-' || upper(substr(v_id::text, 1, 4));

  insert into goods_receipts (id, business_unit_id, outlet_id, code, receipt_date, supplier, invoice_no, photo_path, notes, created_by)
  values (v_id, v_bu, p_outlet, v_code,
          coalesce(p_receipt_date, (now() at time zone 'Asia/Jakarta')::date),
          nullif(p_supplier, ''), nullif(p_invoice_no, ''), nullif(p_photo_path, ''), nullif(p_notes, ''), v_uid);

  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_pid := (it->>'product_id')::uuid;
    v_qty := (it->>'qty')::numeric;
    -- Baris tanpa produk atau berjumlah nol DILEWATI, bukan menggagalkan
    -- seluruh nota: form-nya menyisakan baris kosong di bawah.
    if v_pid is null or v_qty is null or v_qty <= 0 then continue; end if;

    select total, satuan into v_total, v_satuan from harga_baris_nota(it, v_qty);

    insert into goods_receipt_items (receipt_id, product_id, qty, unit_cost, line_total, notes)
    values (v_id, v_pid, v_qty, v_satuan, v_total, nullif(it->>'notes', ''));

    insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, unit_cost, notes, created_by, receipt_id)
    values (v_bu, p_outlet, v_pid, 'receive', v_qty, v_satuan, 'Nota ' || v_code, v_uid, v_id);
    v_n := v_n + 1;
  end loop;

  if v_n = 0 then
    raise exception 'Nota harus berisi minimal satu barang dengan jumlah lebih dari 0.';
  end if;

  return v_id;
end;
$$;

-- =========================================================
-- UBAH NOTA — versi 0119 dengan SATU perubahan: cara membaca harganya.
--
-- Fungsi ini ditulis ulang untuk KEEMPAT kalinya (0084 -> 0118 -> 0119 ->
-- 0123), dan tiap penulisan ulang berisiko menghilangkan penjagaan versi
-- sebelumnya tanpa suara. Dua yang wajib selamat, dan keduanya diuji ulang di
-- `tools/test-migrasi-0123.mjs`:
--
--   0118: koreksi harga harus SAMPAI KE `stock_movements`, termasuk saat cuma
--         harganya yang berubah (selisih jumlah = 0, jadi tidak ada pergerakan
--         baru yang membawanya).
--   0119: NULL = jangan sentuh, untuk keempat kolom kepala nota.
-- =========================================================
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
  v_total numeric;
  v_satuan numeric;
begin
  select business_unit_id, outlet_id, code into v_bu, v_outlet, v_code from goods_receipts where id = p_id;
  if v_bu is null then raise exception 'Nota tidak ditemukan.'; end if;

  -- NULL BERARTI "JANGAN SENTUH" — untuk KEEMPAT kolomnya (0119).
  --   NULL          -> biarkan apa adanya
  --   string kosong -> hapus isinya
  --   string berisi -> ganti
  update goods_receipts
  set receipt_date = coalesce(p_receipt_date, receipt_date),
      supplier = case when p_supplier is null then supplier else nullif(p_supplier, '') end,
      invoice_no = case when p_invoice_no is null then invoice_no else nullif(p_invoice_no, '') end,
      photo_path = case when p_photo_path is null then photo_path else nullif(p_photo_path, '') end,
      notes = case when p_notes is null then notes else nullif(p_notes, '') end,
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

    select total, satuan into v_total, v_satuan from harga_baris_nota(it, v_qty);

    select qty into v_lama from goods_receipt_items where receipt_id = p_id and product_id = v_pid;
    v_selisih := v_qty - coalesce(v_lama, 0);

    if v_lama is null then
      insert into goods_receipt_items (receipt_id, product_id, qty, unit_cost, line_total, notes)
      values (p_id, v_pid, v_qty, v_satuan, v_total, nullif(it->>'notes', ''));
    else
      update goods_receipt_items
      set qty = v_qty, unit_cost = v_satuan, line_total = v_total, notes = nullif(it->>'notes', '')
      where receipt_id = p_id and product_id = v_pid;
    end if;

    if v_selisih <> 0 then
      -- Penyeimbangnya ikut membawa harga. Bukan penjaganya (`update` di bawah
      -- menyapu semuanya), tapi pertahanan berlapis kalau urutannya berubah.
      insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, unit_cost, notes, created_by, receipt_id)
      values (v_bu, v_outlet, v_pid, 'receive', v_selisih, v_satuan,
              'Koreksi nota ' || v_code || ' (' || coalesce(v_lama, 0) || ' -> ' || v_qty || ')', v_uid, p_id);
    end if;

    -- HARGA YANG DIKOREKSI HARUS SAMPAI KE `stock_movements` (0118).
    --
    -- Kalau HANYA harganya yang diubah, `v_selisih` = 0 dan tidak ada
    -- pergerakan baru sama sekali. Barisnya di `goods_receipt_items` sudah
    -- benar, tapi `stock_movements` — satu-satunya sumber yang dibaca biaya
    -- rata-rata — tetap memegang harga lama. Dua angka yang bercerita berbeda,
    -- tanpa satu pun error.
    update stock_movements
       set unit_cost = v_satuan
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
    -- pengeluaran tidak pernah menimbang biaya rata-rata.
    insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, notes, created_by, receipt_id)
    values (v_bu, v_outlet, v_pid, 'receive', -v_lama, 'Batal dari nota ' || v_code, v_uid, p_id);
    delete from goods_receipt_items where receipt_id = p_id and product_id = v_pid;
  end loop;
end;
$$;

revoke all on function ubah_nota_terima(uuid, date, text, text, text, text, jsonb) from public;
grant execute on function ubah_nota_terima(uuid, date, text, text, text, text, jsonb) to authenticated;

-- =========================================================
-- TOTAL NOTA MEMAKAI `line_total`.
--
-- `coalesce(line_total, qty * unit_cost)` supaya baris yang belum sempat
-- terisi tetap punya angka. View ini yang dibaca riwayat nota, tab Hutang
-- Supplier, DAN aturan "boleh dibayar" — jadi satu-satunya definisi total nota
-- ada di sini.
-- =========================================================
drop view if exists nota_ringkas;
create view nota_ringkas with (security_invoker = true) as
  select g.id,
         g.business_unit_id,
         g.outlet_id,
         g.code,
         g.receipt_date,
         g.supplier,
         g.invoice_no,
         g.payment_status,
         g.due_date,
         g.paid_at,
         g.payment_entry_id,
         coalesce(sum(coalesce(i.line_total, i.qty * i.unit_cost)), 0) as total,
         count(i.id) filter (where i.unit_cost is null and i.line_total is null) as baris_tanpa_harga,
         count(i.id) as baris
    from goods_receipts g
    left join goods_receipt_items i on i.receipt_id = g.id
   group by g.id;

comment on view nota_ringkas is
  'Nota + totalnya + berapa barisnya yang belum berharga. Totalnya memakai line_total (harga beli baris), dengan qty*unit_cost sebagai cadangan untuk baris lama.';

-- =========================================================
-- PEMBAYARAN JUGA MEMAKAI `line_total`.
--
-- Kalau `bayar_nota` tetap menjumlahkan `qty * unit_cost` sementara layarnya
-- menampilkan `line_total`, orang akan menyetujui satu angka lalu kasnya
-- berkurang sebesar angka yang lain — dan selisihnya cuma recehan pembulatan,
-- yang justru paling lama tidak disadari.
-- =========================================================
create or replace function bayar_nota(
  p_notas uuid[],
  p_account uuid,
  p_date date,
  p_notes text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_holder uuid;
  v_outlet uuid;
  v_bu uuid;
  v_total numeric := 0;
  v_belum int;
  v_tanpa_harga int;
  v_outlet_lain int;
  v_entry uuid;
  v_kode text;
begin
  if p_notas is null or array_length(p_notas, 1) is null then
    raise exception 'Tidak ada nota yang dipilih.';
  end if;

  select count(*) into v_belum
    from goods_receipts g
   where g.id = any(p_notas)
     and g.payment_status = 'belum'
     and has_outlet_scope(v_uid, g.outlet_id);
  if v_belum <> array_length(p_notas, 1) then
    raise exception 'Ada nota yang tidak ditemukan, bukan wewenangmu, atau sudah lunas. Muat ulang daftarnya.';
  end if;

  -- Harga 0 SAH (barang sampel/bonus); yang ditolak adalah harga yang belum
  -- diisi. Sejak 0123 sebuah baris dianggap berharga kalau SALAH SATU dari
  -- `line_total` atau `unit_cost` terisi — baris lama hanya punya yang kedua.
  select count(*) into v_tanpa_harga
    from goods_receipt_items i
   where i.receipt_id = any(p_notas) and i.unit_cost is null and i.line_total is null;
  if v_tanpa_harga > 0 then
    raise exception 'Masih ada % baris tanpa harga. Lengkapi harganya dulu lewat Edit nota.', v_tanpa_harga;
  end if;

  select count(distinct outlet_id) into v_outlet_lain from goods_receipts where id = any(p_notas);
  if v_outlet_lain > 1 then
    raise exception 'Nota yang dipilih berasal dari % outlet berbeda. Bayar per outlet, supaya biayanya tercatat atas nama outlet yang benar.', v_outlet_lain;
  end if;

  select outlet_id, business_unit_id into v_outlet, v_bu
    from goods_receipts where id = any(p_notas) limit 1;

  select coalesce(sum(coalesce(i.line_total, i.qty * i.unit_cost)), 0) into v_total
    from goods_receipt_items i where i.receipt_id = any(p_notas);

  if v_total < 0 then
    raise exception 'Total nota bernilai negatif. Periksa harga dan jumlahnya.';
  end if;

  if v_total > 0 then
    if not boleh_membebani_kas(v_uid, p_account) then
      raise exception 'Kamu tidak berhak mencatat pada kantong kas ini.';
    end if;
    select holder_id into v_holder from cash_accounts where id = p_account;
    if v_holder is null then
      raise exception 'Kantong kas tidak ditemukan.';
    end if;

    select string_agg(code, ', ' order by code) into v_kode
      from goods_receipts where id = any(p_notas);

    insert into cash_entries (
      business_unit_id, outlet_id, holder_id, account_id, entry_type, amount,
      notes, entry_date, created_by, untuk_nota
    ) values (
      v_bu, v_outlet, v_holder, p_account, 'out', -v_total,
      coalesce(nullif(p_notes, ''), 'Pembayaran nota ' || v_kode),
      coalesce(p_date, (now() at time zone 'Asia/Jakarta')::date),
      v_uid, true
    )
    returning id into v_entry;
  end if;

  update goods_receipts
     set payment_status = 'lunas',
         paid_at = now(),
         paid_by = v_uid,
         payment_entry_id = v_entry
   where id = any(p_notas);

  return v_entry;
end;
$$;

revoke all on function bayar_nota(uuid[], uuid, date, text) from public;
grant execute on function bayar_nota(uuid[], uuid, date, text) to authenticated;

notify pgrst, 'reload schema';
