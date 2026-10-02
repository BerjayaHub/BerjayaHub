-- ============================================================
-- 0155 — REVISI HASIL OPNAME YANG SUDAH DITUTUP.
--
--   "setelah stock opname selesai dan ditutup, ada case staff masih salah
--    input, apakah admin bisa mengubah hasil stock opname ini agar sesuai"
--
-- ============ KENAPA INI BUKAN SEKADAR "UPDATE ANGKANYA" ============
--
-- Menutup opname (`0085`) menulis satu `adjustment` per bahan yang berselisih,
-- dan `stock_movements.created_at` adalah SUMBU WAKTU yang dipakai
-- `saldo_stok_pada` (`0137`) — yaitu stok akhir periode pada laporan COGS.
--
-- Jadi ada dua cara memperbaiki angka yang salah, dan keduanya BUKAN hal yang
-- sama:
--
--   A. tulis koreksi bertanggal HARI INI
--      -> saldo sekarang benar, saldo per tanggal opname tetap salah,
--         dan COGS bulan itu tetap memakai angka yang salah selamanya.
--
--   B. tulis koreksi bertanggal SAAT OPNAME DITUTUP
--      -> saldo pada setiap batas waktu menjadi persis seperti kalau staff
--         mengetik angka yang benar sejak awal. COGS bulan itu ikut benar.
--
-- Yang diminta adalah B — "agar sesuai". Maka `created_at` pergerakan koreksi
-- DISETEL EKSPLISIT ke `closed_at` sesi aslinya.
--
-- Harga yang dibayar untuk B harus ditulis terang-terangan: laporan yang sudah
-- diekspor atau dicetak sebelum revisi akan BERBEDA dari laporan yang sama
-- kalau dicetak ulang hari ini. Itu sebabnya setiap revisi di berkas ini
-- menuntut alasan dan menyimpan angka lamanya — tanpa jejak, laporan yang
-- berubah sendiri tidak bisa dibedakan dari laporan yang dikarang.
--
-- ============ YANG TIDAK BOLEH DIBACA ULANG: `system_qty` ============
--
-- Ini jebakan paling mahal di berkas ini.
--
-- `system_qty` adalah potret stok menurut sistem SAAT bahannya dihitung, dan
-- penyesuaiannya adalah `dihitung − sistem`. Begitu sesinya ditutup, stok
-- sekarang SUDAH MEMUAT penyesuaian itu. Membaca ulang stok saat revisi lalu
-- memakainya sebagai `system_qty` berarti menghitung selisih terhadap angka
-- yang sudah mengandung hasil opname itu sendiri — dan hasilnya menggandakan
-- koreksinya, persis bentuk bug nanas di `0114` (6.400 dihitung 4.600 jadi
-- 11.000).
--
-- Jadi `system_qty` DIBEKUKAN saat revisi. Yang ditulis ke buku stok adalah
-- selisih antara hitungan baru dan hitungan lama:
--
--     ubah   : counted_baru − counted_lama
--     tambah : counted − sistem_saat_sesi_ditutup
--     buang  : system_qty − counted_lama
--
-- Ketiganya menjawab satu pertanyaan yang sama — "berapa yang harus
-- ditambahkan supaya saldo pada saat itu menjadi seperti seharusnya" — dan
-- ketiganya benar tanpa peduli apakah penutupan dulu menulis pergerakan atau
-- tidak (bahan yang cocok dengan sistem tidak menghasilkan pergerakan sama
-- sekali).
--
-- ============ JEJAKNYA TIDAK MENUMPANG `sebelumnya` ============
--
-- `stock_count_items.sebelumnya` sudah ada dan bentuknya cocok — tapi
-- `laporan-opname.js` membacanya sebagai "bahan ini pernah dihitung dua orang
-- dengan angka berbeda, PERIKSA DULU" dan menghitungnya di `jumlahBentrok`.
--
-- Menumpang di sana akan membuat setiap bahan yang direvisi admin muncul
-- sebagai pertengkaran antar-penghitung yang tidak pernah terjadi. Kolomnya
-- sendiri tetap valid, laporannya tetap tergambar, dan tidak ada satu pun
-- galat — yang rusak cuma artinya. Jadi revisi punya kolom sendiri.
-- ============================================================

-- ---------------------------------------------------------
-- JEJAK DI BARIS HITUNGAN.
-- ---------------------------------------------------------

-- [{ qty_lama, qty_baru, by, at, alasan }, ...] — berurut, tidak pernah ditimpa.
alter table stock_count_items add column if not exists revisi jsonb not null default '[]'::jsonb;

-- Baris yang DIBUANG tidak dihapus.
--
-- Staff yang mengisi hitungan di bahan yang salah adalah satu-satunya petunjuk
-- bahwa ada bahan lain yang mungkin belum dihitung. Menghapus barisnya
-- menghilangkan petunjuk itu dan menyisakan sesi yang terlihat rapi.
alter table stock_count_items add column if not exists dibuang_at timestamptz;
alter table stock_count_items add column if not exists dibuang_by uuid references user_profiles(id) on delete set null;
alter table stock_count_items add column if not exists dibuang_alasan text;

-- Penanda di kepala sesi, supaya daftar opname bisa menunjukkannya tanpa
-- membaca seluruh itemnya lebih dulu.
alter table stock_counts add column if not exists direvisi_at timestamptz;
alter table stock_counts add column if not exists direvisi_by uuid references user_profiles(id) on delete set null;

create index if not exists idx_sci_dibuang
  on stock_count_items(count_id) where dibuang_at is not null;

-- ---------------------------------------------------------
-- SATU PENJAGA, DIPAKAI KETIGA JALANNYA.
--
-- Mengembalikan TEKS ALASAN kalau tidak boleh, dan NULL kalau boleh.
--
-- Bentuk ini dipilih supaya pesannya ditulis SEKALI. Tiga RPC yang masing-masing
-- menyalin lima pemeriksaan adalah tiga tempat yang cepat atau lambat berbeda —
-- dan yang berbeda di penjaga tidak melempar apa pun, ia cuma mengizinkan.
-- ---------------------------------------------------------
create or replace function opname_tolak_revisi(p_count uuid)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  c stock_counts%rowtype;
begin
  select * into c from stock_counts where id = p_count;
  if c.id is null then return 'Sesi opname tidak ditemukan.'; end if;

  if not is_bu_admin(auth.uid(), c.business_unit_id) then
    return 'Hanya Admin BU atau Super Admin yang bisa merevisi hasil opname.';
  end if;

  -- Sesi yang masih berjalan punya jalannya sendiri: staff tinggal mengisi
  -- ulang, dan stok belum bergerak sama sekali.
  if c.status = 'open' then
    return 'Sesi ini masih berjalan — hitungannya bisa langsung diperbaiki dari Staff App, stok belum bergerak.';
  end if;

  -- Sesi yang dibatalkan tidak pernah menyentuh stok. "Merevisi" angkanya
  -- tidak mengubah apa pun, dan menawarkannya membuat orang mengira ia
  -- sedang memperbaiki saldo.
  if c.status <> 'closed' then
    return 'Sesi ini dibatalkan — ia tidak pernah menyentuh stok, jadi tidak ada yang bisa direvisi.';
  end if;

  -- ============ HANYA SESI TERTUTUP TERAKHIR PER OUTLET ============
  --
  -- Opname yang sudah ketiban opname berikutnya angkanya SUDAH tergantikan
  -- hitungan fisik yang lebih baru. Merevisinya menulis koreksi bertanggal
  -- lampau di bawah hitungan yang lebih sahih, dan saldo hari ini bergeser
  -- sebesar koreksi yang sudah tidak relevan.
  if exists (
    select 1 from stock_counts c2
     where c2.outlet_id = c.outlet_id
       and c2.status = 'closed'
       and c2.id <> c.id
       and c2.closed_at > c.closed_at
  ) then
    return 'Outlet ini sudah punya opname yang lebih baru — angka sesi ini sudah tergantikan hitungan fisik sesudahnya. Perbaiki di sesi terakhir.';
  end if;

  -- Sesi yang sedang berjalan juga menghalangi, dan alasannya BUKAN sekadar
  -- kerapian: `catat_hitungan_opname` memotret stok sistem saat hitungannya
  -- disimpan. Revisi menggeser saldo itu, jadi potret yang sudah terisi di sesi
  -- berjalan jadi basi — dan basi di situ tidak terlihat sebagai apa pun sampai
  -- sesinya ditutup dengan penyesuaian yang salah.
  if exists (select 1 from stock_counts c3 where c3.outlet_id = c.outlet_id and c3.status = 'open') then
    return 'Ada sesi opname yang sedang berjalan di outlet ini. Tutup atau batalkan dulu — merevisi sekarang membuat potret stok di sesi itu basi tanpa terlihat.';
  end if;

  return null;
end;
$$;

revoke all on function opname_tolak_revisi(uuid) from public;
grant execute on function opname_tolak_revisi(uuid) to authenticated;

comment on function opname_tolak_revisi(uuid) is
  'NULL kalau sesi opname ini boleh direvisi; kalau tidak, kalimat alasannya. Dipakai ketiga RPC revisi dan boleh dibaca layar untuk menjelaskan kenapa tombolnya mati.';

-- ---------------------------------------------------------
-- PERGERAKAN KOREKSI — SATU TEMPAT.
--
-- `created_at` disetel eksplisit ke `closed_at` sesi aslinya. Itulah seluruh
-- inti berkas ini; kalau baris ini hilang, semuanya tetap jalan dan saldo
-- hari ini tetap benar — yang hilang cuma kebenaran saldo per tanggal, dan
-- tidak ada satu layar pun yang bisa menunjukkannya.
-- ---------------------------------------------------------
create or replace function catat_koreksi_opname(p_count uuid, p_product uuid, p_delta numeric, p_sebab text)
returns void
language plpgsql
set search_path = public
as $$
declare
  c stock_counts%rowtype;
begin
  if p_delta is null or p_delta = 0 then return; end if;
  select * into c from stock_counts where id = p_count;

  insert into stock_movements
    (business_unit_id, outlet_id, product_id, movement_type, qty_delta, notes, created_by, count_id, created_at)
  values
    (c.business_unit_id, c.outlet_id, p_product, 'adjustment', p_delta,
     p_sebab || ' ' || c.code, auth.uid(), p_count,
     -- BUKAN now(). Lihat kepala berkas.
     coalesce(c.closed_at, c.opened_at));
end;
$$;

revoke all on function catat_koreksi_opname(uuid, uuid, numeric, text) from public;
grant execute on function catat_koreksi_opname(uuid, uuid, numeric, text) to authenticated;

comment on function catat_koreksi_opname(uuid, uuid, numeric, text) is
  'Tulis satu pergerakan adjustment koreksi opname, BERTANGGAL closed_at sesi aslinya — supaya saldo per tanggal dan COGS periode itu ikut benar. Delta nol tidak menulis apa pun.';

-- ---------------------------------------------------------
-- UBAH ANGKA, atau TAMBAHKAN bahan yang terlewat.
--
-- Satu fungsi untuk dua niat, dengan alasan yang sama seperti `buka_opname`
-- menerima sesi yang sudah terbuka: dari sisi orangnya, "angka bahan ini
-- harusnya 4.600" adalah satu niat — entah barisnya sudah ada atau belum.
-- ---------------------------------------------------------
create or replace function revisi_hitungan_opname(
  p_count uuid,
  p_product uuid,
  p_counted numeric,
  p_alasan text
) returns numeric
language plpgsql
set search_path = public
as $$
declare
  v_tolak text;
  c stock_counts%rowtype;
  v_lama stock_count_items%rowtype;
  v_sistem numeric;
  v_delta numeric;
begin
  v_tolak := opname_tolak_revisi(p_count);
  if v_tolak is not null then raise exception '%', v_tolak; end if;

  if p_counted is null or p_counted < 0 then
    raise exception 'Jumlah hasil revisi tidak sah.';
  end if;
  -- Alasan WAJIB, sama seperti koreksi penjualan (0112): revisi tanpa
  -- keterangan tidak bisa dibedakan dari angka yang dikarang saat dibaca
  -- berbulan-bulan kemudian — dan yang berubah di sini adalah laporan COGS.
  if coalesce(btrim(p_alasan), '') = '' then
    raise exception 'Isi alasan revisinya — angka ini mengubah stok dan laporan COGS periode itu.';
  end if;

  select * into c from stock_counts where id = p_count;
  select * into v_lama from stock_count_items
   where count_id = p_count and product_id = p_product;

  if v_lama.id is null or v_lama.dibuang_at is not null then
    -- ============ BAHAN YANG TERLEWAT (atau pernah dibuang) ============
    --
    -- `system_qty`-nya tidak bisa dipotret ulang dari stok sekarang: stok
    -- sekarang sudah memuat seluruh pergerakan sesudah opname. Yang dipakai
    -- adalah stok PADA SAAT SESI DITUTUP, tanpa pergerakan milik sesi ini
    -- sendiri — itulah angka yang akan dilihat penghitungnya kalau ia sampai
    -- ke rak itu.
    select coalesce(sum(sm.qty_delta), 0) into v_sistem
      from stock_movements sm
     where sm.outlet_id = c.outlet_id
       and sm.product_id = p_product
       and sm.created_at <= coalesce(c.closed_at, c.opened_at)
       and sm.count_id is distinct from p_count;

    v_delta := p_counted - v_sistem;

    if v_lama.id is null then
      insert into stock_count_items
        (count_id, product_id, system_qty, counted_qty, counted_by, counted_at, revisi)
      values
        (p_count, p_product, v_sistem, p_counted, auth.uid(), now(),
         jsonb_build_array(jsonb_build_object(
           'qty_lama', null, 'qty_baru', p_counted,
           'by', auth.uid(), 'at', now(), 'alasan', btrim(p_alasan)
         )));
    else
      -- Baris yang pernah dibuang DIHIDUPKAN kembali, bukan diinsert baru:
      -- indeks uniknya (count_id, product_id) akan menolak, dan jejak
      -- pembuangannya ikut hilang kalau barisnya diganti.
      update stock_count_items
         set system_qty = v_sistem,
             counted_qty = p_counted,
             counted_by = auth.uid(),
             counted_at = now(),
             dibuang_at = null,
             dibuang_by = null,
             dibuang_alasan = null,
             revisi = revisi || jsonb_build_object(
               'qty_lama', null, 'qty_baru', p_counted,
               'by', auth.uid(), 'at', now(), 'alasan', btrim(p_alasan)
             )
       where id = v_lama.id;
    end if;
  else
    -- ============ ANGKA BARIS YANG SUDAH ADA ============
    --
    -- `system_qty` TIDAK DISENTUH — lihat kepala berkas.
    if v_lama.counted_qty = p_counted then
      raise exception 'Angkanya sama dengan yang sekarang (%); tidak ada yang perlu direvisi.', p_counted;
    end if;

    v_delta := p_counted - v_lama.counted_qty;

    update stock_count_items
       set counted_qty = p_counted,
           revisi = revisi || jsonb_build_object(
             'qty_lama', v_lama.counted_qty, 'qty_baru', p_counted,
             'by', auth.uid(), 'at', now(), 'alasan', btrim(p_alasan)
           )
     where id = v_lama.id;
  end if;

  perform catat_koreksi_opname(p_count, p_product, v_delta, 'Revisi opname');

  update stock_counts set direvisi_at = now(), direvisi_by = auth.uid() where id = p_count;

  return v_delta;
end;
$$;

revoke all on function revisi_hitungan_opname(uuid, uuid, numeric, text) from public;
grant execute on function revisi_hitungan_opname(uuid, uuid, numeric, text) to authenticated;

comment on function revisi_hitungan_opname(uuid, uuid, numeric, text) is
  'Perbaiki hasil opname yang sudah ditutup, atau tambahkan bahan yang terlewat. Pergerakan koreksinya bertanggal closed_at sesi aslinya, jadi saldo per tanggal & COGS periode itu ikut benar. system_qty baris yang sudah ada TIDAK dibaca ulang. Alasan wajib. Mengembalikan delta stok yang ditulis.';

-- ---------------------------------------------------------
-- BUANG baris yang salah barang.
--
-- Stoknya dikembalikan ke angka SEBELUM opname untuk bahan itu — bukan ke nol.
-- Opname tidak pernah mengklaim stok nol untuk bahan yang tidak dihitung
-- (`tutup_opname` sengaja tidak menyentuhnya), jadi membuang hitungannya harus
-- mengembalikan keadaan itu persis.
-- ---------------------------------------------------------
create or replace function hapus_hitungan_opname(p_count uuid, p_product uuid, p_alasan text)
returns numeric
language plpgsql
set search_path = public
as $$
declare
  v_tolak text;
  v_lama stock_count_items%rowtype;
  v_delta numeric;
begin
  v_tolak := opname_tolak_revisi(p_count);
  if v_tolak is not null then raise exception '%', v_tolak; end if;

  if coalesce(btrim(p_alasan), '') = '' then
    raise exception 'Isi alasan pembuangannya — barisnya tetap tersimpan sebagai riwayat.';
  end if;

  select * into v_lama from stock_count_items
   where count_id = p_count and product_id = p_product;
  if v_lama.id is null then raise exception 'Bahan ini tidak ada di sesi opname tersebut.'; end if;
  if v_lama.dibuang_at is not null then raise exception 'Baris ini sudah dibuang sebelumnya.'; end if;

  -- Membalik penyesuaian yang dulu ditulis penutupan: `counted − system`
  -- menjadi `system − counted`. Kalau dulu angkanya cocok dengan sistem,
  -- hasilnya nol dan tidak ada pergerakan yang perlu ditulis.
  v_delta := v_lama.system_qty - v_lama.counted_qty;

  update stock_count_items
     set dibuang_at = now(),
         dibuang_by = auth.uid(),
         dibuang_alasan = btrim(p_alasan)
   where id = v_lama.id;

  perform catat_koreksi_opname(p_count, p_product, v_delta, 'Buang hitungan opname');

  update stock_counts set direvisi_at = now(), direvisi_by = auth.uid() where id = p_count;

  return v_delta;
end;
$$;

revoke all on function hapus_hitungan_opname(uuid, uuid, text) from public;
grant execute on function hapus_hitungan_opname(uuid, uuid, text) to authenticated;

comment on function hapus_hitungan_opname(uuid, uuid, text) is
  'Buang satu baris hitungan dari opname yang sudah ditutup. Barisnya TIDAK dihapus, hanya ditandai — dan stok bahan itu dikembalikan ke angka sebelum opname, bukan ke nol. Alasan wajib.';

notify pgrst, 'reload schema';
