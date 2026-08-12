-- =========================================================
-- 0082 — Resep yang ada tapi tidak berisi bahan
--
-- GEJALANYA: di tab Resep muncul keterangan *"Resepnya ada, tapi belum berisi
-- bahan"*, dan tidak ada cara masuk akal untuk sampai ke keadaan itu. Editor
-- resep menolak menyimpan tanpa bahan ("Tambahkan minimal satu bahan"), dan
-- pengimpor menolak kelompok tanpa bahan ("tidak ada bahan"). Jadi dari sisi
-- yang memakainya, resep itu muncul entah dari mana.
--
-- SEBABNYA ada di `saveRecipe()` di sisi aplikasi, yang mengerjakan TIGA
-- perintah terpisah:
--
--   1. insert/update baris `recipes`
--   2. delete SEMUA `recipe_items` milik resep itu
--   3. insert bahan yang baru
--
-- Ketiganya perintah HTTP sendiri-sendiri. Kalau langkah 3 tidak sampai —
-- sinyal putus di tengah, halaman ditutup, aplikasi dibunuh OS karena RAM
-- sempit, atau RLS menolak baris itemnya — langkah 1 dan 2 SUDAH TERJADI dan
-- tidak dibatalkan siapa pun. Yang tertinggal: baris resep tanpa bahan.
--
-- Dan yang paling berbahaya bukan yang baru dibuat, melainkan MENGUBAH resep
-- yang sudah benar: bahan lamanya sudah dihapus di langkah 2. Resep yang tadinya
-- lengkap jadi kosong, HPP-nya hilang, dan semua menu yang memakainya ikut
-- kehilangan HPP — tanpa satu pun pesan error, karena dari sisi aplikasi
-- langkah 3-lah yang gagal dan pesannya sudah telanjur ditelan penutupan halaman.
--
-- PERBAIKANNYA: satu fungsi, satu transaksi. Di dalam fungsi plpgsql, semua
-- perintah hidup-mati bersama — kalau ada yang gagal, penghapusan bahan lama
-- ikut dibatalkan dan resepnya tetap seperti semula. Tidak ada lagi keadaan
-- setengah jadi yang bisa tertinggal.
--
-- SECURITY INVOKER (bawaan) DIPERTAHANKAN dengan sengaja: RLS tetap berlaku
-- atas nama pemanggilnya, jadi fungsi ini tidak memberi wewenang baru kepada
-- siapa pun. Membuatnya SECURITY DEFINER akan membuat siapa saja yang bisa
-- memanggilnya menulis resep sebagai pemilik fungsi — persis kebocoran yang
-- tidak sepadan untuk memperbaiki masalah keutuhan data.
--
-- Karena RLS berlaku, penolakan tidak muncul sebagai error melainkan sebagai
-- NOL BARIS. Itulah sebabnya tiap langkah di bawah memeriksa jumlah barisnya
-- sendiri dan melempar pesan yang bisa dibaca manusia.
-- =========================================================

create or replace function simpan_resep_utuh(
  p_product_id uuid,
  p_business_unit_id uuid,
  p_mode text,
  p_yield numeric,
  p_notes text,
  p_items jsonb
) returns uuid
language plpgsql
as $$
declare
  v_recipe_id uuid;
  v_count int;
  v_items int;
begin
  if p_mode not in ('production', 'standalone', 'served_by_ck') then
    raise exception 'Varian resep "%" tidak dikenal.', p_mode;
  end if;
  if coalesce(p_yield, 0) <= 0 then
    raise exception 'Hasil (yield) harus lebih dari 0.';
  end if;

  v_items := coalesce(jsonb_array_length(p_items), 0);
  -- Resep tanpa bahan ditolak DI SINI juga, bukan hanya di layar. Editor dan
  -- pengimpor sama-sama sudah menolaknya, tapi keduanya bisa dilewati (mis.
  -- pemanggilan langsung), dan resep kosong adalah persis keadaan yang sedang
  -- diberantas migration ini.
  if v_items = 0 then
    raise exception 'Resep harus berisi minimal satu bahan.';
  end if;

  select id into v_recipe_id
  from recipes
  where product_id = p_product_id and mode = p_mode;

  if v_recipe_id is null then
    insert into recipes (product_id, business_unit_id, mode, yield_qty, notes)
    values (p_product_id, p_business_unit_id, p_mode, p_yield, nullif(p_notes, ''))
    returning id into v_recipe_id;
  else
    update recipes
    set yield_qty = p_yield, notes = nullif(p_notes, '')
    where id = v_recipe_id;
    get diagnostics v_count = row_count;
    if v_count = 0 then
      raise exception 'Tidak tersimpan — resep hanya bisa diubah Admin BU atau Super Admin.';
    end if;
  end if;

  delete from recipe_items where recipe_id = v_recipe_id;

  insert into recipe_items (recipe_id, ingredient_product_id, qty)
  select v_recipe_id, (x->>'ingredient_product_id')::uuid, (x->>'qty')::numeric
  from jsonb_array_elements(p_items) as x;
  get diagnostics v_count = row_count;

  -- Jumlahnya dicocokkan, bukan sekadar "ada yang masuk". RLS bisa meloloskan
  -- sebagian baris dan menolak sisanya; resep yang kehilangan satu bahan
  -- menghasilkan HPP yang lebih murah dari kenyataan, dan tidak ada yang
  -- curiga karena penyimpanannya dilaporkan berhasil.
  if v_count <> v_items then
    raise exception 'Hanya % dari % bahan yang bisa disimpan — resep hanya bisa diubah Admin BU atau Super Admin.', v_count, v_items;
  end if;

  return v_recipe_id;
end;
$$;

revoke all on function simpan_resep_utuh(uuid, uuid, text, numeric, text, jsonb) from public;
grant execute on function simpan_resep_utuh(uuid, uuid, text, numeric, text, jsonb) to authenticated;

-- =========================================================
-- Membersihkan yang sudah telanjur tertinggal.
--
-- Resep tanpa bahan tidak menyimpan informasi apa pun — ia hanya membuat kolom
-- HPP menampilkan peringatan yang tidak bisa ditindaklanjuti. Menghapusnya
-- mengembalikan tampilannya ke "Belum", yang memang keadaan sebenarnya, dan
-- tombol "+ Isi resep" kembali muncul.
-- =========================================================
delete from recipes r
where not exists (select 1 from recipe_items i where i.recipe_id = r.id);
