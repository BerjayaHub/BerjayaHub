-- =========================================================
-- Berjaya Hub OMS — 0112
-- Admin bisa MEMPERBAIKI penjualan tanggal lampau — dengan alasan & jejak.
--
-- =========================================================
-- YANG DILAPORKAN
-- =========================================================
--
--   "penjualan yang sudah diinput bisa diedit lagi kapanpun, setelah di edit
--    ini akan berpengaruh pada stock juga, karena ada case staff salah input
--    jumlah menu terjual"
--
-- Wewenangnya SUDAH ADA sejak 0101: `boleh_ubah_penjualan()` mengizinkan
-- `is_bu_admin` mengubah penjualan tanggal kapan pun, dan `ubah_penjualan()`
-- sudah menulis pergerakan stok penyeimbang sebesar SELISIHNYA.
--
-- Yang tidak ada adalah PINTUNYA. Admin Portal > Penjualan cuma menampilkan
-- laporan agregat per menu (Menu, Kategori, Terjual, Omzet) — tidak ada baris
-- per transaksi, jadi tidak ada yang bisa ditekan. Staff App punya tombolnya,
-- tapi hanya untuk transaksi HARI INI.
--
-- Bentuknya sama persis dengan bug draft surat jalan (0109): kemampuannya ada
-- di database, jalannya tidak ada di layar.
--
-- =========================================================
-- YANG DITAMBAHKAN DI SINI
-- =========================================================
--
-- Membuka layarnya saja sudah cukup untuk membuat fiturnya jalan. Tapi
-- mengubah angka yang SUDAH MASUK REKAP adalah tindakan yang berbeda sifatnya
-- dari membetulkan salah ketik semenit yang lalu, dan perbedaan itu harus
-- terlihat di datanya:
--
--   qty_awal            jumlah yang PERTAMA diinput staff, disimpan sekali
--                       seumur hidup baris itu dan tidak pernah ditimpa
--   dikoreksi_at/_by/_alasan   siapa, kapan, kenapa
--
-- Dengan begitu rekap bisa menampilkan "15 porsi (semula 50 — dikoreksi Budi,
-- 2 Sep: salah ketik nol)". Riwayatnya bertambah, bukan tergantikan — pola
-- yang sama dengan pergerakan stok (0084/0092/0101) dan penilaian ulang shift
-- (0106).
--
-- ALASAN WAJIB HANYA UNTUK TANGGAL LAMPAU. Hari ini bebas: staff membetulkan
-- ketikannya sendiri beberapa menit kemudian, dan menuntut alasan di situ cuma
-- memperlambat tanpa menambah apa pun yang berguna.
--
-- =========================================================
-- HARGA TIDAK IKUT DIHITUNG ULANG
-- =========================================================
--
-- Perilaku 0101 dipertahankan apa adanya: omzet = `unit_price` DARI BARISNYA
-- SENDIRI dikali jumlah baru. Bukan dari daftar harga hari ini.
--
-- Kalau harga sekarang yang dipakai, mengoreksi satu salah ketik di bulan lalu
-- akan menggeser omzet seluruh periode itu — dan laporan yang dicetak ulang
-- tidak akan cocok dengan yang sudah beredar, tanpa ada yang menyentuh angka
-- lain mana pun.
--
-- =========================================================
-- CATATAN TEKNIS: TANDA TANGAN FUNGSI BERUBAH
-- =========================================================
--
-- `ubah_penjualan(uuid, numeric)` -> `ubah_penjualan(uuid, numeric, text)`.
--
-- Yang lama HARUS di-drop. `create or replace` dengan parameter tambahan tidak
-- menimpa melainkan membuat OVERLOAD baru, dan versi dua-parameternya akan
-- tetap hidup — tanpa penjagaan alasan sama sekali. PostgREST bisa memilih
-- yang mana saja, jadi penjagaan yang baru saja ditulis akan bisa dilewati
-- tanpa satu pun tanda.
--
-- Parameter ketiganya diberi DEFAULT null supaya PWA lama yang masih memanggil
-- dengan dua argumen tetap jalan untuk koreksi HARI INI — yang memang tidak
-- menuntut alasan. Untuk tanggal lampau ia akan ditolak dengan pesan yang
-- jelas, dan itu perilaku yang benar untuk versi layar yang belum punya kotak
-- alasannya.
-- =========================================================

-- ---------------------------------------------------------
-- (1) Kolom jejak
-- ---------------------------------------------------------
alter table sales add column if not exists qty_awal numeric;
alter table sales add column if not exists dikoreksi_at timestamptz;
alter table sales add column if not exists dikoreksi_by uuid references user_profiles(id) on delete set null;
alter table sales add column if not exists dikoreksi_alasan text;

-- Indeks parsial: yang dicari biasanya "koreksi apa saja bulan ini", dan
-- barisnya sedikit dibanding seluruh penjualan.
create index if not exists idx_sales_dikoreksi
  on sales(business_unit_id, dikoreksi_at)
  where dikoreksi_at is not null;

-- ---------------------------------------------------------
-- (2) Versi DUA-PARAMETER dibuang lebih dulu. Alasannya di kepala berkas.
-- ---------------------------------------------------------
drop function if exists ubah_penjualan(uuid, numeric);

-- ---------------------------------------------------------
-- (3) UBAH
-- ---------------------------------------------------------
create or replace function ubah_penjualan(p_sale uuid, p_qty numeric, p_alasan text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r_sale sales%rowtype;
  v_recipe recipes%rowtype;
  v_selisih numeric;
  v_nama text;
  v_lampau boolean;
  r record;
begin
  if auth.uid() is null then raise exception 'Harus login'; end if;

  select * into r_sale from sales where id = p_sale;
  if r_sale.id is null then raise exception 'Penjualan tidak ditemukan.'; end if;

  if not boleh_ubah_penjualan(p_sale) then
    raise exception 'Kamu hanya boleh memperbaiki penjualan yang kamu catat sendiri hari ini. Selebihnya lewat Admin BU.';
  end if;

  if p_qty is null or p_qty <= 0 then
    raise exception 'Jumlah terjual harus lebih dari 0. Kalau memang tidak jadi terjual, hapus barisnya.';
  end if;

  -- KOREKSI TANGGAL LAMPAU MENUNTUT ALASAN.
  --
  -- Hari ini bebas: staff membetulkan salah ketiknya sendiri beberapa menit
  -- kemudian, dan menuntut alasan di situ cuma memperlambat tanpa menambah
  -- apa pun yang berguna.
  --
  -- Tanggal lampau lain sepenuhnya. Angkanya sudah masuk rekap harian, mungkin
  -- sudah dibahas di grup, mungkin sudah dipakai menghitung bonus. Mengubahnya
  -- tanpa keterangan membuat "kok omzet Selasa berubah?" tidak bisa dijawab
  -- siapa pun — dan yang paling merugikan, koreksi yang sah jadi tidak bisa
  -- dibedakan dari kesalahan yang tidak sengaja.
  v_lampau := r_sale.sale_date < (now() at time zone 'Asia/Jakarta')::date;
  if v_lampau and coalesce(btrim(p_alasan), '') = '' then
    raise exception 'Penjualan tanggal % sudah masuk rekap. Isi alasan koreksinya supaya bisa dibaca nanti.',
      to_char(r_sale.sale_date, 'DD Mon YYYY');
  end if;

  v_selisih := p_qty - r_sale.qty;
  if v_selisih = 0 then
    return jsonb_build_object('berubah', false, 'qty', r_sale.qty, 'omzet', r_sale.revenue);
  end if;

  -- HARGA DARI BARISNYA SENDIRI, bukan dari daftar harga sekarang.
  -- Alasannya di kepala berkas — ini yang menjaga omzet historis tetap historis.
  update sales
     set qty = p_qty,
         revenue = r_sale.unit_price * p_qty,
         -- POTRET PERTAMA DISIMPAN SEKALI SEUMUR HIDUP BARIS INI.
         --
         -- `is null` di sini penting, dan alasannya sama dengan penilaian ulang
         -- shift di 0106: koreksi KEDUA tidak boleh menimpa `qty_awal` dengan
         -- hasil koreksi pertama. Kalau ditimpa, angka yang benar-benar diinput
         -- staff hilang sesudah dua kali koreksi — dan yang tersisa justru
         -- angka yang paling tidak berarti.
         qty_awal = coalesce(r_sale.qty_awal, r_sale.qty),
         dikoreksi_at = now(),
         dikoreksi_by = auth.uid(),
         dikoreksi_alasan = nullif(btrim(p_alasan), '')
   where id = p_sale;

  select name into v_nama from products where id = r_sale.product_id;

  -- Bahannya: selisih pemakaiannya saja.
  v_recipe := resep_penjualan(r_sale.outlet_id, r_sale.product_id);
  if v_recipe.id is not null and v_recipe.yield_qty > 0 then
    for r in select ingredient_product_id, qty from recipe_items where recipe_id = v_recipe.id loop
      insert into stock_movements (
        business_unit_id, outlet_id, product_id, movement_type, qty_delta, sale_id, notes, created_by
      ) values (
        r_sale.business_unit_id, r_sale.outlet_id, r.ingredient_product_id, 'usage',
        -(r.qty * v_selisih / v_recipe.yield_qty), p_sale,
        -- Alasannya ikut ke catatan pergerakan stok, bukan cuma disimpan di
        -- baris penjualannya. Yang membaca buku besar stok biasanya sedang
        -- menelusuri selisih opname, dan ia tidak akan tahu harus membuka
        -- tabel `sales` untuk mencari sebabnya.
        format('Koreksi penjualan %s: %s -> %s porsi (%s)',
               coalesce(v_nama, '?'), r_sale.qty, p_qty, to_char(r_sale.sale_date, 'DD Mon YYYY'))
          || coalesce(' — ' || nullif(btrim(p_alasan), ''), ''),
        auth.uid()
      );
    end loop;
  end if;
  -- Resep hilang TIDAK menggagalkan koreksi omzet. Penjualannya nyata dan
  -- angkanya harus benar; yang tidak bisa dilakukan hanyalah menyesuaikan
  -- bahannya, dan itu dikatakan lewat `stok_disesuaikan` di bawah.

  -- Ringkasan kiriman ikut dihitung ulang supaya tidak menyimpan omzet yang
  -- sudah tidak cocok dengan barisnya.
  if r_sale.submission_id is not null then
    update sales_submissions ss
       set item_count = x.n, total_revenue = x.omzet
      from (select count(*) n, coalesce(sum(revenue), 0) omzet from sales where submission_id = r_sale.submission_id) x
     where ss.id = r_sale.submission_id;
  end if;

  return jsonb_build_object(
    'berubah', true,
    'qty', p_qty,
    'omzet', r_sale.unit_price * p_qty,
    'stok_disesuaikan', v_recipe.id is not null and v_recipe.yield_qty > 0,
    'tanggal_lampau', v_lampau
  );
end $$;

-- ---------------------------------------------------------
-- (4) HAPUS
-- ---------------------------------------------------------
create or replace function hapus_penjualan(p_sale uuid, p_alasan text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r_sale sales%rowtype;
  v_recipe recipes%rowtype;
  v_nama text;
  v_subm uuid;
  v_catatan text;
  r record;
begin
  if auth.uid() is null then raise exception 'Harus login'; end if;

  select * into r_sale from sales where id = p_sale;
  if r_sale.id is null then raise exception 'Penjualan tidak ditemukan.'; end if;

  if not boleh_ubah_penjualan(p_sale) then
    raise exception 'Kamu hanya boleh menghapus penjualan yang kamu catat sendiri hari ini. Selebihnya lewat Admin BU.';
  end if;

  -- Sama seperti mengubah: tanggal lampau menuntut alasan. Menghapus lebih
  -- keras lagi akibatnya — barisnya benar-benar lenyap, dan satu-satunya
  -- tempat ceritanya bisa dibaca lagi adalah catatan pergerakan stok di bawah.
  if r_sale.sale_date < (now() at time zone 'Asia/Jakarta')::date
     and coalesce(btrim(p_alasan), '') = '' then
    raise exception 'Penjualan tanggal % sudah masuk rekap. Isi alasan penghapusannya supaya bisa dibaca nanti.',
      to_char(r_sale.sale_date, 'DD Mon YYYY');
  end if;

  select name into v_nama from products where id = r_sale.product_id;
  v_subm := r_sale.submission_id;

  -- Barisnya akan lenyap, jadi ceritanya dititipkan ke catatan pergerakan.
  -- Tanpa ini, buku besar akan berisi angka yang tidak bisa dijelaskan siapa pun
  -- enam bulan kemudian.
  v_catatan := format('Batal penjualan %s %s porsi (%s)',
                      coalesce(v_nama, '?'), r_sale.qty, to_char(r_sale.sale_date, 'DD Mon YYYY'))
               || coalesce(' — ' || nullif(p_alasan, ''), '');

  v_recipe := resep_penjualan(r_sale.outlet_id, r_sale.product_id);
  if v_recipe.id is not null and v_recipe.yield_qty > 0 then
    for r in select ingredient_product_id, qty from recipe_items where recipe_id = v_recipe.id loop
      -- Positif: bahannya DIKEMBALIKAN.
      insert into stock_movements (
        business_unit_id, outlet_id, product_id, movement_type, qty_delta, sale_id, notes, created_by
      ) values (
        r_sale.business_unit_id, r_sale.outlet_id, r.ingredient_product_id, 'usage',
        r.qty * r_sale.qty / v_recipe.yield_qty, p_sale, v_catatan, auth.uid()
      );
    end loop;
  end if;

  delete from sales where id = p_sale;

  if v_subm is not null then
    update sales_submissions ss
       set item_count = x.n, total_revenue = x.omzet
      from (select count(*) n, coalesce(sum(revenue), 0) omzet from sales where submission_id = v_subm) x
     where ss.id = v_subm;
  end if;

  return jsonb_build_object(
    'dihapus', true,
    'stok_dikembalikan', v_recipe.id is not null and v_recipe.yield_qty > 0
  );
end $$;

revoke all on function ubah_penjualan(uuid, numeric, text) from public;
revoke all on function hapus_penjualan(uuid, text) from public;
grant execute on function ubah_penjualan(uuid, numeric, text) to authenticated;
grant execute on function hapus_penjualan(uuid, text) to authenticated;

comment on function ubah_penjualan(uuid, numeric, text) is
  'Ubah jumlah terjual. Stok bahan dikoreksi sebesar SELISIHNYA, harga tetap harga saat transaksi dicatat. Untuk tanggal lampau, alasan WAJIB. Jumlah pertama disimpan di qty_awal dan tidak pernah ditimpa.';

notify pgrst, 'reload schema';
