-- =========================================================
-- Berjaya Hub OMS — 0142
-- Pengecekan kiriman bisa DICICIL, dan "belum dicek" berhenti menyamar
-- jadi "dicek dan pas".
--
-- =========================================================
-- YANG DIMINTA
-- =========================================================
--
--   "Di terima bahan dari CK di sisi outlet. Bagaimana solusinya bila staff
--    melakukan pengecekan secara terpisah di satu waktu dalam satu SJ yang sama"
--
-- =========================================================
-- BUG YANG LEBIH BESAR DARIPADA YANG DITANYAKAN
-- =========================================================
--
-- Kotak "Diterima" di layar terima SUDAH TERISI angka kiriman sejak layarnya
-- dibuka. Artinya **"belum dicek" tidak bisa dibedakan dari "sudah dicek dan
-- pas"**: staff yang menekan Simpan tanpa menghitung apa pun menghasilkan
-- catatan yang identik dengan staff yang menghitung seluruhnya dengan teliti.
--
-- Susutnya nol, laporannya rapi, dan selisihnya baru muncul berminggu-minggu
-- kemudian sebagai angka opname yang tidak bisa dijelaskan siapa pun.
--
-- Pengecekan terpisah hanya memperbesar peluangnya. Bugnya sudah ada bahkan
-- untuk satu orang.
--
-- =========================================================
-- TIGA KEADAAN, BUKAN DUA
-- =========================================================
--
--   `dicek_qty` NULL   -> BELUM DICEK. Bukan nol, bukan "sesuai kiriman".
--   `dicek_qty` = 0    -> sudah dicek, dan barangnya memang tidak ada.
--   `dicek_qty` > 0    -> sudah dicek sebanyak itu.
--
-- Perbedaan NULL versus 0 itulah seluruh isi migration ini. Kolom bertipe
-- numeric yang nullable adalah satu-satunya cara menyimpan "belum dijawab"
-- yang tidak bisa tertukar dengan jawaban.
--
-- =========================================================
-- KENAPA BUKAN MEMAKAI `received_qty` SAJA
-- =========================================================
--
-- `received_qty` sudah ada dan kosong sampai kiriman diterima, jadi ia
-- kelihatan seperti tempat yang pas untuk menyimpan cicilan.
--
-- Ia TIDAK dipakai. `received_qty` berarti satu hal yang tepat — "yang
-- benar-benar diterima pada saat SJ ditutup" — dan itu dipakai menghitung
-- susut, mencetak Bukti Terima, serta diekspor ke ESB. Menitipkan angka
-- setengah jadi ke dalamnya berarti kolom yang sama punya dua arti tergantung
-- status kirimannya, dan setiap pembacanya harus tahu perbedaannya. Yang lupa
-- tidak akan mendapat error — ia akan mendapat angka.
--
-- =========================================================
-- STOK TIDAK BERGERAK SATU GRAM PUN DI SINI
-- =========================================================
--
-- `simpan_cek_kiriman` hanya menulis hitungan. Seluruh pergerakan stok tetap
-- terjadi sekali, di `receive_dispatch`, seperti sebelumnya.
--
-- Alternatif yang TIDAK dipilih: memindahkan stok per baris begitu dicek. Itu
-- benar-benar paralel, tapi SJ bisa berhenti di tengah selamanya — stok CK
-- separuh terpotong dan separuh tidak, tanpa satu momen pun yang bisa disebut
-- "diterima", dan hitungan susut maupun Bukti Terima mengandaikan satu waktu.
-- =========================================================

-- ---------------------------------------------------------
-- (1) Tiga kolom: hitungannya, siapa, kapan.
--
-- `add column if not exists` untuk tiap kolom, satu per satu. `create table if
-- not exists` TIDAK menambah kolom ke tabel yang sudah ada — jebakan yang sudah
-- menggigit di 0138 (`foto_selesai does not exist`).
-- ---------------------------------------------------------
alter table dispatch_items add column if not exists dicek_qty numeric;
alter table dispatch_items add column if not exists dicek_by uuid references user_profiles(id) on delete set null;
alter table dispatch_items add column if not exists dicek_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'dispatch_items_dicek_qty_chk') then
    -- `check` lolos saat ekspresinya NULL — dan itu memang yang diinginkan di
    -- sini: NULL berarti belum dicek, dan itu sah.
    alter table dispatch_items add constraint dispatch_items_dicek_qty_chk check (dicek_qty is null or dicek_qty >= 0);
  end if;
end $$;

comment on column dispatch_items.dicek_qty is
  'Hasil hitungan fisik outlet, boleh dicicil beberapa orang. NULL = BELUM DICEK (bukan nol, bukan "sesuai kiriman"). Stok tidak bergerak karena kolom ini.';
comment on column dispatch_items.dicek_by is
  'Siapa yang terakhir MENGUBAH hitungan baris ini. Tidak ditimpa saat orang lain menyimpan baris yang sama tanpa mengubah angkanya.';

-- ---------------------------------------------------------
-- (2) SIMPAN SEMENTARA — cicilan pengecekan.
--
-- Tidak menutup SJ, tidak menggerakkan stok, dan bisa dipanggil berkali-kali
-- oleh orang yang berbeda. Penyimpanannya PER BARIS, jadi dua staff yang
-- mengecek bagian berbeda tidak saling menimpa.
-- ---------------------------------------------------------
create or replace function simpan_cek_kiriman(p_dispatch uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_d dispatches%rowtype;
  v_uid uuid := auth.uid();
  it jsonb;
  v_item uuid;
  v_qty numeric;
  v_lama numeric;
  v_ada boolean;
  v_ubah int := 0;
begin
  if v_uid is null then raise exception 'Harus login'; end if;

  select * into v_d from dispatches where id = p_dispatch;
  if v_d.id is null then raise exception 'Pengiriman tidak ditemukan.'; end if;
  if v_d.status = 'draft' then
    raise exception 'Kiriman ini masih draft — CK belum mengirimkannya, jadi belum ada yang bisa dicek.';
  end if;
  if v_d.status <> 'sent' then
    raise exception 'Kiriman ini sudah diproses, hasil cek tidak bisa diubah lagi.';
  end if;
  if not has_outlet_scope(v_uid, v_d.to_outlet_id) then
    raise exception 'Hanya outlet tujuan yang boleh mengecek kiriman ini.';
  end if;

  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_item := (it->>'item_id')::uuid;
    if v_item is null then continue; end if;

    -- KUNCINYA HARUS ADA untuk bisa dibedakan dari "tidak dikirim".
    --
    -- `it->>'dicek_qty'` menghasilkan NULL baik saat nilainya JSON null MAUPUN
    -- saat kuncinya tidak ada sama sekali. Dua hal itu berbeda: yang pertama
    -- berarti "batalkan ceknya", yang kedua berarti "baris ini tidak sedang
    -- saya sentuh". Tanpa `? 'dicek_qty'`, layar yang mengirim sebagian baris
    -- akan MENGHAPUS hasil cek orang lain.
    if not (it ? 'dicek_qty') then continue; end if;

    v_qty := nullif(it->>'dicek_qty', '')::numeric;
    if v_qty is not null and v_qty < 0 then v_qty := 0; end if;

    select dicek_qty, true into v_lama, v_ada
      from dispatch_items where id = v_item and dispatch_id = p_dispatch;
    if not coalesce(v_ada, false) then continue; end if;

    -- JEJAK PENGECEK TIDAK DITIMPA KALAU ANGKANYA TIDAK BERUBAH.
    --
    -- Staff B yang menyimpan seluruh formulir setelah staff A mengecek separuh
    -- akan ikut mengirim baris-baris A. Kalau `dicek_by` ditulis ulang tanpa
    -- syarat, nama A hilang dari baris yang ia hitung sendiri — dan justru itu
    -- yang dicari saat ada selisih.
    if v_qty is distinct from v_lama then
      update dispatch_items
         set dicek_qty = v_qty,
             dicek_by = case when v_qty is null then null else v_uid end,
             dicek_at = case when v_qty is null then null else now() end
       where id = v_item and dispatch_id = p_dispatch;
      v_ubah := v_ubah + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'diubah', v_ubah,
    'dicek', (select count(*) from dispatch_items where dispatch_id = p_dispatch and dicek_qty is not null),
    'total', (select count(*) from dispatch_items where dispatch_id = p_dispatch)
  );
end;
$$;

revoke all on function simpan_cek_kiriman(uuid, jsonb) from public;
grant execute on function simpan_cek_kiriman(uuid, jsonb) to authenticated;

comment on function simpan_cek_kiriman(uuid, jsonb) is
  'Menyimpan hasil pengecekan fisik tanpa menutup SJ dan tanpa menggerakkan stok. Baris yang kuncinya tidak dikirim TIDAK disentuh, supaya cicilan orang lain tidak terhapus.';

-- ---------------------------------------------------------
-- (3) TERIMA — tidak pernah menebak baris yang belum dicek.
--
-- Isinya sama dengan 0103 kecuali cara `received_qty` ditentukan:
--
--   1. angka yang dikirim layar, kalau ada;
--   2. kalau tidak, hasil cek yang tersimpan (`dicek_qty`);
--   3. kalau dua-duanya kosong -> DITOLAK, dengan menyebut nama barangnya.
--
-- Langkah 3 itu yang baru. Sebelumnya layar mengirim angka kiriman sebagai
-- nilai bawaan, jadi baris yang tidak pernah disentuh siapa pun tetap tercatat
-- "diterima penuh" — dan tidak ada apa pun di database yang bisa membedakannya
-- dari hitungan sungguhan.
-- ---------------------------------------------------------
create or replace function receive_dispatch(p_dispatch uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_d dispatches%rowtype;
  v_uid uuid := auth.uid();
  it jsonb;
  v_item_id uuid;
  v_recv numeric;
  v_prod uuid;
  v_sent numeric;
  v_ck_sudah boolean;
  v_susut numeric := 0;
  v_belum text;
  r record;
begin
  if v_uid is null then raise exception 'Harus login'; end if;

  select * into v_d from dispatches where id = p_dispatch;
  if v_d.id is null then raise exception 'Pengiriman tidak ditemukan'; end if;
  if v_d.status = 'draft' then
    raise exception 'Kiriman ini masih draft — CK belum mengirimkannya.';
  end if;
  if v_d.status <> 'sent' then raise exception 'Pengiriman sudah diproses'; end if;
  if not has_outlet_scope(v_uid, v_d.to_outlet_id) then
    raise exception 'Hanya outlet tujuan yang boleh mengonfirmasi penerimaan kiriman ini.';
  end if;

  -- Angka dari layar dituangkan dulu ke `dicek_qty`, memakai aturan yang SAMA
  -- dengan Simpan Sementara — termasuk penjagaan jejak pengeceknya. Dengan
  -- begitu tidak ada dua jalan berbeda yang menulis hasil cek.
  perform simpan_cek_kiriman(p_dispatch, p_items);

  -- BARIS YANG BELUM DICEK MENGHENTIKAN SELURUH PENERIMAAN, dan namanya
  -- disebut. Menerima diam-diam "sesuai kiriman" adalah persis kebiasaan yang
  -- sedang diperbaiki; menerima diam-diam nol sama buruknya ke arah lain.
  select string_agg(p.name, ', ' order by p.name) into v_belum
    from dispatch_items di
    join products p on p.id = di.product_id
   where di.dispatch_id = p_dispatch and di.dicek_qty is null;
  if v_belum is not null then
    raise exception 'Masih ada bahan yang belum dicek: %. Isi jumlah diterimanya dulu — boleh 0 kalau memang tidak ada.', v_belum;
  end if;

  v_ck_sudah := exists (
    select 1 from stock_movements
    where dispatch_id = p_dispatch and movement_type = 'transfer_out'
  );

  -- Dibaca dari TABELNYA, bukan dari `p_items`. Layar yang tertinggal versi
  -- bisa mengirim sebagian baris saja, dan baris yang tidak ikut terkirim akan
  -- kehilangan pergerakan stoknya tanpa satu pun tanda.
  for r in
    select di.id, di.product_id, di.sent_qty, di.dicek_qty
      from dispatch_items di
     where di.dispatch_id = p_dispatch
  loop
    v_item_id := r.id;
    v_prod := r.product_id;
    v_sent := r.sent_qty;
    -- PERLU DICATAT JUJUR: `coalesce(..., 0)` di sini BUKAN penjaganya.
    --
    -- Penjagaan sebenarnya ada di `raise exception` di atas, yang menghentikan
    -- seluruh penerimaan selama masih ada `dicek_qty` NULL — jadi baris ini
    -- tidak pernah tercapai selama penjaga itu berdiri, dan sabotase yang
    -- mengubahnya TIDAK membuat tesnya merah. Itu memang benar.
    --
    -- Ia dipertahankan sebagai lapis kedua: kalau suatu saat penjaga di atas
    -- dilonggarkan, yang tersisa di bawah harus tetap 0 — bukan diam-diam
    -- berubah jadi "terima sesuai kiriman", yang persis kebiasaan yang sedang
    -- diperbaiki berkas ini.
    v_recv := coalesce(r.dicek_qty, 0);

    update dispatch_items set received_qty = v_recv where id = v_item_id;

    -- (a) Stok CK berkurang sebesar YANG DIKIRIM.
    if not v_ck_sudah and v_sent > 0 then
      insert into stock_movements(business_unit_id, outlet_id, product_id, movement_type, qty_delta, ref_outlet_id, dispatch_id, notes, created_by)
        values (v_d.business_unit_id, v_d.from_outlet_id, v_prod, 'transfer_out', -v_sent, v_d.to_outlet_id, p_dispatch,
                'Kiriman ' || coalesce(v_d.code, '') || ' diterima', v_uid);
    end if;

    -- (b) Stok outlet bertambah sebesar YANG DITERIMA.
    if v_recv > 0 then
      insert into stock_movements(business_unit_id, outlet_id, product_id, movement_type, qty_delta, ref_outlet_id, dispatch_id, notes, created_by)
        values (v_d.business_unit_id, v_d.to_outlet_id, v_prod, 'transfer_in', v_recv, v_d.from_outlet_id, p_dispatch,
                'Terima kiriman ' || coalesce(v_d.code, ''), v_uid);
    end if;

    if v_sent > v_recv then v_susut := v_susut + (v_sent - v_recv); end if;
  end loop;

  update dispatches set status = 'received', received_by = v_uid, received_at = now() where id = p_dispatch;

  return jsonb_build_object(
    'diterima', true,
    'susut', v_susut,
    'stok_ck_sudah_terpotong_sebelumnya', v_ck_sudah
  );
end;
$$;

revoke all on function receive_dispatch(uuid, jsonb) from public;
grant execute on function receive_dispatch(uuid, jsonb) to authenticated;

comment on function receive_dispatch(uuid, jsonb) is
  'Konfirmasi terima. DI SINI seluruh stok bergeser. MENOLAK selama masih ada baris yang belum dicek (dicek_qty NULL) — menerima diam-diam "sesuai kiriman" adalah kebiasaan yang diperbaiki 0142.';

-- ---------------------------------------------------------
-- (4) Penjaga: satu bentuk tiap fungsi.
--
-- PostgREST memilih fungsi dari HIMPUNAN NAMA argumennya. Bentuk kedua yang
-- tertinggal tidak menghasilkan error — ia menghasilkan JAWABAN LAIN, dari kode
-- yang tidak sedang dibaca siapa pun.
-- ---------------------------------------------------------
do $$
declare
  v_n int;
  v_nama text;
begin
  foreach v_nama in array array['simpan_cek_kiriman', 'receive_dispatch']
  loop
    select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_nama;
    if v_n <> 1 then
      raise exception '% punya % bentuk, seharusnya 1.', v_nama, v_n;
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
