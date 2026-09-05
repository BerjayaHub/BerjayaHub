-- =========================================================
-- Berjaya Hub OMS — 0119
-- "+ Foto" pada nota berhenti MENGHAPUS nama supplier.
--
-- =========================================================
-- BUG YANG DIPERBAIKI
-- =========================================================
--
-- `ubah_nota_terima` (0084, ditulis ulang di 0118) menimpa `supplier`,
-- `invoice_no`, dan `notes` tanpa syarat. Layar yang cuma menambahkan foto
-- tidak menyebut ketiganya, service mengirim string kosong, dan `nullif('','')`
-- menjadikannya NULL.
--
-- Jadi menekan "+ Foto" pada nota yang sudah berisi "Gerobak Telur" menghapus
-- nama supplier itu. Tombolnya bernama "+ Foto", toast-nya hijau, fotonya
-- benar-benar tersimpan — dan satu-satunya yang berubah selain foto adalah
-- tiga kolom yang tidak pernah disebut siapa pun.
--
-- Aturan "NULL = jangan sentuh" sudah ada dan sudah benar untuk `photo_path`
-- sejak 0084. Yang salah adalah ia hanya dipakai pada SATU kolom, sementara
-- pemanggilnya memperlakukan keempatnya sama.
--
-- =========================================================
-- KENAPA DITULIS UTUH
-- =========================================================
--
-- `create or replace` mengganti seluruh badan fungsinya. Menyalin sebagian
-- adalah cara paling mudah kehilangan penjagaan yang ditambahkan 0118 —
-- penyelarasan `unit_cost` ke `stock_movements`, yang tanpa itu koreksi harga
-- tidak pernah sampai ke biaya rata-rata.
--
-- Sisi klien ikut diperbaiki: `ubahNota()` tidak lagi mengubah `undefined`
-- menjadi string kosong. Keduanya diperlukan — server menjaga jalur mana pun,
-- klien menjaga PWA lama yang masih ter-cache di HP staff.
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
begin
  select business_unit_id, outlet_id, code into v_bu, v_outlet, v_code from goods_receipts where id = p_id;
  if v_bu is null then raise exception 'Nota tidak ditemukan.'; end if;

  -- NULL BERARTI "JANGAN SENTUH" — untuk KEEMPAT kolomnya, bukan cuma foto.
  --
  -- ============ BUG YANG DIPERBAIKI DI SINI ============
  --
  -- Aturan itu sudah benar untuk `photo_path` sejak 0084. Tiga kolom lainnya
  -- ditimpa TANPA SYARAT — dan pemanggil yang cuma ingin menambahkan foto
  -- mengirim string kosong untuk ketiganya:
  --
  --     ubahNota(id, { photoPath: path, items: null })
  --       -> supplier tidak disebut -> service mengirim ''
  --       -> nullif('', '') = NULL
  --       -> nama supplier, no. invoice, dan catatan notanya LENYAP.
  --
  -- Tombolnya bernama "+ Foto", toast-nya hijau, fotonya benar-benar tersimpan.
  -- Yang hilang baru ketahuan saat ada yang mencocokkan tagihan dengan
  -- supplier — dan pada saat itu tidak ada cara mengetahui nama yang terhapus.
  --
  -- Sekarang keempatnya memakai aturan yang sama, dan aturannya cuma satu:
  --   NULL         -> biarkan apa adanya
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

comment on function ubah_nota_terima(uuid, date, text, text, text, text, jsonb) is
  'Ubah nota penerimaan. Untuk supplier/invoice/foto/catatan: NULL = jangan sentuh, string kosong = hapus, string berisi = ganti. p_items NULL = jangan sentuh barangnya.';

notify pgrst, 'reload schema';
