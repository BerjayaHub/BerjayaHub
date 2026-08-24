-- =========================================================
-- Berjaya Hub OMS — 0103
-- Surat jalan punya tahap DRAFT, dan stok baru bergeser saat OUTLET MENERIMA.
--
-- =========================================================
-- ALUR LAMA vs BARU
-- =========================================================
--
--   LAMA : Outlet order -> CK kirim (stok CK -) -> Outlet terima (stok outlet +)
--   BARU : Outlet order -> CK siapkan DRAFT (nomor SJ sudah ada, stok diam)
--                       -> CK kirim         (stok masih diam)
--                       -> Outlet terima    (stok CK - DAN stok outlet + sekaligus)
--
-- Draft ada karena cara kerjanya memang begitu: CK menyiapkan bahan H-1, lalu
-- besoknya draftnya tinggal diperiksa ulang dan dikirim. Sebelum ini, menyiapkan
-- berarti sudah memotong stok CK semalaman untuk barang yang belum berangkat.
--
-- =========================================================
-- STOK BERGESER SEKALIGUS SAAT DITERIMA — DAN APA AKIBATNYA
-- =========================================================
--
-- Ini keputusan pemilik, dan konsekuensinya perlu diketahui, bukan disembunyikan:
--
--   Selama barang di jalan, stok CK MASIH TERLIHAT PENUH padahal barangnya
--   sudah keluar. CK bisa menjanjikan barang yang sama ke outlet lain, dan
--   opname CK di sore hari akan menemukan selisih sebesar barang yang sedang
--   dalam perjalanan.
--
-- Yang bisa dilakukan tanpa mengubah keputusannya: layar CK menampilkan berapa
-- yang sedang di jalan, supaya angka stok tidak dibaca sendirian.
--
-- Keuntungannya juga nyata: tidak ada lagi "stok hantu" — barang yang sudah
-- dipotong dari CK tapi belum pernah sampai ke outlet mana pun karena
-- kirimannya tidak pernah dikonfirmasi. Sebelum ini barang seperti itu lenyap
-- dari kedua sisi.
--
-- =========================================================
-- KIRIMAN LAMA TIDAK BOLEH TERPOTONG DUA KALI  <-- paling berbahaya
-- =========================================================
--
-- Kiriman yang sudah berstatus 'sent' SEBELUM migration ini SUDAH memotong stok
-- CK saat dibuat. Kalau `receive_dispatch()` yang baru menulis `transfer_out`
-- untuk semua kiriman, kiriman lama yang baru dikonfirmasi besok akan
-- terpotong DUA KALI di CK.
--
-- Tidak ada error, tidak ada tanda. Stok CK sekadar berkurang dua kali lipat
-- untuk kiriman-kiriman yang kebetulan berada di tengah jalan saat migration
-- dijalankan — dan selisihnya akan diserap opname sebagai "susut".
--
-- Dijaga dengan MEMERIKSA BUKU BESARNYA, bukan dengan kolom penanda:
--
--     exists (select 1 from stock_movements
--             where dispatch_id = ... and movement_type = 'transfer_out')
--
-- Pemeriksaan itu tidak bisa basi. Kolom penanda perlu di-backfill, dan
-- backfill yang meleset menghasilkan kesalahan yang persis sama tanpa cara
-- mengetahuinya.
--
-- =========================================================
-- FUNGSI LAMA DI-DROP, TIDAK DIBIARKAN HIDUP
-- =========================================================
--
-- `create_dispatch()` dan `fulfill_stock_order()` dihapus. Aplikasi ini PWA —
-- versi lama bisa masih terpasang di HP staff.
--
-- Kalau dibiarkan hidup dengan perilaku baru, staff di klien lama akan menekan
-- "Kirim", melihat "berhasil", dan yang terjadi sebenarnya hanya draft
-- tersimpan. Barangnya berangkat secara fisik, sistemnya diam, dan tidak ada
-- satu pun pesan yang menjelaskan. Dengan di-drop, klien lama gagal dengan
-- pesan yang bisa ditindaklanjuti.
-- =========================================================

-- ---------------------------------------------------------
-- (1) Status baru + jejak pengiriman
-- ---------------------------------------------------------
alter table dispatches drop constraint if exists dispatches_status_check;
alter table dispatches add constraint dispatches_status_check
  check (status in ('draft', 'sent', 'received', 'cancelled'));

alter table dispatches add column if not exists sent_at timestamptz;
alter table dispatches add column if not exists sent_by uuid references user_profiles(id) on delete set null;
-- Order yang melahirkan draft ini. Dipakai `kirim_draft_kiriman()` untuk
-- menutup ordernya PADA SAAT DIKIRIM, bukan saat draftnya dibuat.
alter table dispatches add column if not exists stock_order_id uuid references stock_orders(id) on delete set null;

-- Kiriman yang SUDAH ADA saat migration dijalankan tidak punya `sent_at`.
-- Diisi dari `created_at` supaya riwayatnya tidak berlubang — dulu membuat dan
-- mengirim memang satu tindakan yang sama.
update dispatches set sent_at = created_at, sent_by = created_by
 where sent_at is null and status in ('sent', 'received');

create index if not exists idx_dispatches_draft on dispatches(from_outlet_id, created_at desc) where status = 'draft';

-- ---------------------------------------------------------
-- (2) Penjaga wewenang bersama.
--
-- Ditulis sekali supaya ubah/hapus/kirim tidak bisa menyimpang satu sama lain.
-- Dua salinan aturan yang sama selalu berakhir berbeda, dan yang berbeda adalah
-- yang jarang dibaca.
-- ---------------------------------------------------------
create or replace function boleh_kelola_draft(p_dispatch uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from dispatches d
    where d.id = p_dispatch
      and d.status = 'draft'
      -- Draft milik OUTLET ASAL (CK), bukan milik pembuatnya. Shift pagi
      -- menyiapkan, shift berikutnya yang mengirim — kalau dikunci ke pembuat,
      -- draft H-1 tidak akan bisa disentuh orang yang masuk besoknya.
      and has_outlet_scope(auth.uid(), d.from_outlet_id)
  );
$$;

-- ---------------------------------------------------------
-- (3) BUAT DRAFT — nomor SJ langsung ada, stok DIAM.
-- ---------------------------------------------------------
create or replace function buat_draft_kiriman(p_from uuid, p_to uuid, p_items jsonb, p_notes text, p_order uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bu uuid;
  v_uid uuid := auth.uid();
  v_did uuid := gen_random_uuid();
  v_code text;
  it jsonb;
  v_pid uuid;
  v_qty numeric;
  v_jumlah int := 0;
begin
  if v_uid is null then raise exception 'Harus login'; end if;

  select business_unit_id into v_bu from outlets where id = p_from;
  if v_bu is null then raise exception 'Outlet asal tidak valid'; end if;
  if not has_outlet_scope(v_uid, p_from) then raise exception 'Tidak berhak mengirim dari outlet ini'; end if;
  if p_to is null or (select 1 from outlets where id = p_to) is null then raise exception 'Outlet tujuan tidak valid'; end if;
  if p_from = p_to then raise exception 'Outlet asal & tujuan tidak boleh sama'; end if;

  -- Nomornya dibuat SEKARANG, saat draft. Itu justru gunanya: CK menyiapkan
  -- barang H-1 sambil menempelkan nomor SJ ke keranjangnya.
  v_code := 'SJ-' || to_char((now() at time zone 'Asia/Jakarta'), 'YYMMDD') || '-' || upper(substr(v_did::text, 1, 4));

  insert into dispatches(id, business_unit_id, from_outlet_id, to_outlet_id, status, notes, created_by, code, stock_order_id)
    values (v_did, v_bu, p_from, p_to, 'draft', p_notes, v_uid, v_code, p_order);

  for it in select * from jsonb_array_elements(p_items) loop
    v_pid := (it->>'product_id')::uuid;
    v_qty := (it->>'qty')::numeric;
    if v_pid is null or v_qty is null or v_qty <= 0 then continue; end if;
    insert into dispatch_items(dispatch_id, product_id, sent_qty) values (v_did, v_pid, v_qty);
    v_jumlah := v_jumlah + 1;
  end loop;

  -- Draft kosong tidak ada gunanya, dan lebih buruk: ia memakai satu nomor SJ
  -- yang lalu muncul di daftar tanpa isi.
  if v_jumlah = 0 then
    raise exception 'Draft tidak jadi dibuat — tidak ada barang yang diisi.';
  end if;

  -- TIDAK ADA PERGERAKAN STOK DI SINI. Itu inti perubahannya.
  return v_did;
end;
$$;

-- ---------------------------------------------------------
-- (4) UBAH DRAFT — isinya diganti seluruhnya.
--
-- Diganti utuh, bukan ditambal per baris: draft adalah daftar siapan, dan yang
-- dikirim klien memang seluruh daftarnya. Menambal per baris memerlukan klien
-- mengirim "yang dihapus" secara terpisah — satu jalur lagi yang bisa lupa.
--
-- Aman karena belum ada satu pun pergerakan stok yang menempel padanya.
-- ---------------------------------------------------------
create or replace function ubah_draft_kiriman(p_dispatch uuid, p_items jsonb, p_notes text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  it jsonb;
  v_pid uuid;
  v_qty numeric;
  v_jumlah int := 0;
begin
  if not boleh_kelola_draft(p_dispatch) then
    raise exception 'Draft ini tidak bisa kamu ubah — mungkin sudah dikirim, atau di luar outlet yang kamu kelola.';
  end if;

  delete from dispatch_items where dispatch_id = p_dispatch;

  for it in select * from jsonb_array_elements(p_items) loop
    v_pid := (it->>'product_id')::uuid;
    v_qty := (it->>'qty')::numeric;
    if v_pid is null or v_qty is null or v_qty <= 0 then continue; end if;
    insert into dispatch_items(dispatch_id, product_id, sent_qty) values (p_dispatch, v_pid, v_qty);
    v_jumlah := v_jumlah + 1;
  end loop;

  if v_jumlah = 0 then
    -- Membatalkan seluruh transaksi, termasuk `delete` di atas. Draft yang
    -- dikosongkan akan tetap muncul di daftar sebagai nomor SJ tanpa isi.
    raise exception 'Draft tidak boleh kosong. Kalau memang batal, hapus draftnya.';
  end if;

  update dispatches set notes = p_notes where id = p_dispatch;
end;
$$;

-- ---------------------------------------------------------
-- (5) HAPUS DRAFT — benar-benar hilang.
--
-- Boleh dihapus sungguhan karena TIDAK ADA jejak yang menggantung padanya:
-- belum ada pergerakan stok, dan ordernya masih 'open'. Berbeda dengan
-- penjualan atau produksi, di sini tidak ada angka masa lalu yang perlu
-- dijelaskan.
-- ---------------------------------------------------------
create or replace function hapus_draft_kiriman(p_dispatch uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not boleh_kelola_draft(p_dispatch) then
    raise exception 'Draft ini tidak bisa kamu hapus — mungkin sudah dikirim, atau di luar outlet yang kamu kelola.';
  end if;

  -- Penjagaan berlapis: kalaupun suatu saat ada jalur yang menulis pergerakan
  -- stok lebih awal, draftnya tidak akan bisa lenyap tanpa jejak.
  if exists (select 1 from stock_movements where dispatch_id = p_dispatch) then
    raise exception 'Kiriman ini sudah menyentuh stok, jadi tidak bisa dihapus begitu saja.';
  end if;

  delete from dispatches where id = p_dispatch;  -- item ikut lewat cascade
end;
$$;

-- ---------------------------------------------------------
-- (6) KIRIM DRAFT — barang berangkat. Stok MASIH DIAM.
--
-- Di sinilah ordernya ditutup, bukan saat draft dibuat: selama masih draft,
-- outlet pemesan memang belum menerima apa pun, dan menutup ordernya lebih awal
-- akan membuat layar outlet berbunyi "sudah dikirim" untuk barang yang masih
-- di rak CK.
-- ---------------------------------------------------------
create or replace function kirim_draft_kiriman(p_dispatch uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_d dispatches%rowtype;
begin
  if not boleh_kelola_draft(p_dispatch) then
    raise exception 'Draft ini tidak bisa kamu kirim — mungkin sudah dikirim, atau di luar outlet yang kamu kelola.';
  end if;

  select * into v_d from dispatches where id = p_dispatch;

  if not exists (select 1 from dispatch_items where dispatch_id = p_dispatch) then
    raise exception 'Draft ini kosong, tidak ada yang bisa dikirim.';
  end if;

  update dispatches
     set status = 'sent', sent_at = now(), sent_by = auth.uid()
   where id = p_dispatch;

  -- Ordernya baru ditutup SEKARANG.
  if v_d.stock_order_id is not null then
    update stock_orders
       set status = 'fulfilled', handled_by = auth.uid(), handled_at = now(), dispatch_id = p_dispatch
     where id = v_d.stock_order_id and status = 'open';
  end if;
end;
$$;

-- ---------------------------------------------------------
-- (7) TERIMA — DI SINI seluruh stok bergeser.
--
-- Stok CK berkurang sebesar yang DIKIRIM; stok outlet bertambah sebesar yang
-- DITERIMA. Selisihnya adalah susut di perjalanan, dan ia tetap terlihat
-- sebagai selisih dua angka — bukan hilang begitu saja.
-- ---------------------------------------------------------
-- TIPE KEMBALIANNYA BERUBAH: `void` (0022) -> `jsonb`.
--
-- `create or replace function` TIDAK BISA mengubah tipe kembalian — Postgres
-- menolak dengan `42P13: cannot change return type of existing function`.
-- Harus di-drop dulu.
--
-- Kesalahan ini lolos dari uji PGlite saya karena kerangka ujinya membuat
-- `receive_dispatch` dari nol, jadi tidak ada versi lama yang bertabrakan.
-- Ujinya sekarang membuat versi `void` yang lama lebih dulu, persis seperti
-- keadaan produksi.
drop function if exists receive_dispatch(uuid, jsonb);

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

  -- KIRIMAN LAMA: stok CK-nya SUDAH terpotong saat dibuat (lihat kepala berkas).
  -- Diperiksa dari buku besarnya sendiri, bukan dari kolom penanda yang bisa basi.
  v_ck_sudah := exists (
    select 1 from stock_movements
    where dispatch_id = p_dispatch and movement_type = 'transfer_out'
  );

  for it in select * from jsonb_array_elements(p_items) loop
    v_item_id := (it->>'item_id')::uuid;
    v_recv := (it->>'received_qty')::numeric;
    if v_item_id is null then continue; end if;
    if v_recv is null or v_recv < 0 then v_recv := 0; end if;

    select product_id, sent_qty into v_prod, v_sent
      from dispatch_items where id = v_item_id and dispatch_id = p_dispatch;
    if v_prod is null then continue; end if;

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

  -- Susut dikembalikan supaya layar bisa menyebutkannya. Selisih kirim-vs-terima
  -- yang tidak pernah dikatakan akan ditemukan berminggu-minggu kemudian sebagai
  -- angka opname yang tidak bisa dijelaskan.
  return jsonb_build_object(
    'diterima', true,
    'susut', v_susut,
    'stok_ck_sudah_terpotong_sebelumnya', v_ck_sudah
  );
end;
$$;

-- ---------------------------------------------------------
-- (8) CK MENYIAPKAN ORDER -> DRAFT. Order TETAP 'open'.
-- ---------------------------------------------------------
create or replace function siapkan_order_jadi_draft(p_order uuid, p_items jsonb, p_notes text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_o stock_orders%rowtype;
  v_uid uuid := auth.uid();
  v_did uuid;
begin
  select * into v_o from stock_orders where id = p_order;
  if v_o.id is null then raise exception 'Order tidak ditemukan'; end if;
  if v_o.status <> 'open' then raise exception 'Order sudah diproses'; end if;
  if not has_outlet_scope(v_uid, v_o.to_outlet_id) then
    raise exception 'Hanya outlet yang dituju order ini yang boleh menyiapkannya.';
  end if;

  -- Satu order = satu draft. Tanpa penjagaan ini, menekan "Siapkan" dua kali
  -- menghasilkan dua nomor SJ untuk order yang sama, dan yang kedua akan
  -- dikirim tanpa ada yang sadar barangnya dobel.
  if exists (select 1 from dispatches where stock_order_id = p_order and status = 'draft') then
    raise exception 'Order ini sudah punya draft surat jalan. Buka draftnya, jangan buat baru.';
  end if;

  v_did := buat_draft_kiriman(v_o.to_outlet_id, v_o.from_outlet_id, p_items,
                              coalesce(p_notes, '') || ' (Order ' || coalesce(v_o.code, '') || ')',
                              p_order);

  -- Ordernya SENGAJA tidak ditutup di sini. Lihat (6).
  return v_did;
end;
$$;

-- ---------------------------------------------------------
-- (9) Fungsi lama di-drop. Alasannya di kepala berkas.
-- ---------------------------------------------------------
drop function if exists create_dispatch(uuid, uuid, jsonb, text);
drop function if exists fulfill_stock_order(uuid, jsonb, text);

revoke all on function boleh_kelola_draft(uuid) from public;
revoke all on function buat_draft_kiriman(uuid, uuid, jsonb, text, uuid) from public;
revoke all on function ubah_draft_kiriman(uuid, jsonb, text) from public;
revoke all on function hapus_draft_kiriman(uuid) from public;
revoke all on function kirim_draft_kiriman(uuid) from public;
revoke all on function siapkan_order_jadi_draft(uuid, jsonb, text) from public;
revoke all on function receive_dispatch(uuid, jsonb) from public;

grant execute on function boleh_kelola_draft(uuid) to authenticated;
grant execute on function buat_draft_kiriman(uuid, uuid, jsonb, text, uuid) to authenticated;
grant execute on function ubah_draft_kiriman(uuid, jsonb, text) to authenticated;
grant execute on function hapus_draft_kiriman(uuid) to authenticated;
grant execute on function kirim_draft_kiriman(uuid) to authenticated;
grant execute on function siapkan_order_jadi_draft(uuid, jsonb, text) to authenticated;
grant execute on function receive_dispatch(uuid, jsonb) to authenticated;

comment on function receive_dispatch(uuid, jsonb) is
  'Konfirmasi terima. DI SINI seluruh stok bergeser: CK berkurang sebesar yang dikirim, outlet bertambah sebesar yang diterima. Kiriman lama yang stok CK-nya sudah terpotong saat dibuat TIDAK dipotong dua kali.';
comment on function buat_draft_kiriman(uuid, uuid, jsonb, text, uuid) is
  'Buat draft surat jalan. Nomor SJ langsung ada; TIDAK ada pergerakan stok sama sekali.';

-- =========================================================
-- (10) NOTIFIKASI: DRAFT TIDAK BOLEH MENGUMUMKAN "BARANG DIKIRIM"
--
-- Trigger 0046 berbunyi `after insert or update of status`, dan Edge Function
-- memetakan INSERT -> 'dispatch_sent'.
--
-- Dengan alur baru, INSERT adalah pembuatan DRAFT. Tanpa perubahan ini, grup
-- Telegram akan menerima "barang dikirim" untuk barang yang masih di rak CK —
-- dan outlet tujuan akan menunggu kiriman yang belum berangkat.
--
-- Sebaliknya, momen kirim yang sebenarnya kini adalah UPDATE draft -> sent,
-- yang oleh Edge Function lama dikembalikan `null` alias tidak diberitahukan
-- sama sekali.
--
-- Dijaga di DUA lapis, dan urutan gagalnya disengaja:
--
--   SQL  : INSERT berstatus 'draft' TIDAK memicu trigger sama sekali.
--   Edge : UPDATE ke 'sent' dipetakan jadi 'dispatch_sent'.
--
-- Kalau Edge Function belum sempat di-deploy ulang, yang terjadi adalah
-- notifikasi kirim HILANG — bukan notifikasi SALAH. Diam lebih baik daripada
-- mengumumkan barang berangkat padahal belum.
-- =========================================================
-- Ketiganya di-drop, bukan hanya yang lama. Tanpa dua baris terakhir,
-- menjalankan ulang berkas ini gagal dengan 42710 — dan migration yang tidak
-- bisa diulang adalah migration yang tidak bisa diperbaiki di tengah jalan.
drop trigger if exists trg_notify_dispatches on dispatches;
drop trigger if exists trg_notify_dispatches_insert on dispatches;
drop trigger if exists trg_notify_dispatches_update on dispatches;

create trigger trg_notify_dispatches_insert
  after insert on dispatches
  for each row
  when (new.status <> 'draft')
  execute function notify_telegram_event();

create trigger trg_notify_dispatches_update
  after update of status on dispatches
  for each row execute function notify_telegram_event();

notify pgrst, 'reload schema';
