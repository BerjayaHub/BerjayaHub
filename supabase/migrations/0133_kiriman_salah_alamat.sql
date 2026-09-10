-- =========================================================
-- Berjaya Hub OMS — 0133
-- Kiriman salah alamat punya jalan keluar.
--
-- =========================================================
-- YANG DIMINTA
-- =========================================================
--
--   "berikan solusi bila outlet salah kirim, contoh serpong seharusnya retur
--    ke ck tetapi yang dilakukan malah kirim ke outlet hampton"
--
-- =========================================================
-- APA YANG DITEMUKAN SAAT MEMERIKSA
-- =========================================================
--
-- Status `cancelled` sudah ada di batasan `dispatches` sejak 0022:
--
--     status text not null default 'sent' check (status in ('sent','received','cancelled'))
--
-- Tapi TIDAK ADA SATU PUN fungsi yang pernah mengisinya. Nilai itu berdiri di
-- sana sejak awal tanpa pernah dipakai — dan penerima juga tidak punya tombol
-- "Tolak", hanya "Simpan (Terima)".
--
-- Akibatnya: kiriman yang salah alamat WAJIB diterima oleh outlet yang salah.
-- Satu-satunya cara keluar adalah menerima barang yang bukan miliknya, lalu
-- mengarang kiriman balik tanpa hubungan apa pun ke kiriman aslinya.
--
-- Ini jenis lubang yang tidak pernah muncul sebagai error: batasannya
-- terlihat lengkap, layarnya terlihat wajar, dan yang menemukannya adalah
-- orang yang sedang menghadapi masalahnya.
--
-- =========================================================
-- DUA KEADAAN, DUA JAWABAN YANG BERBEDA
-- =========================================================
--
-- Yang menentukan bukan siapa yang salah, melainkan DI MANA BARANGNYA
-- SEKARANG:
--
--   BELUM DITERIMA -> barangnya belum diakui siapa pun, stoknya belum
--     bergeser (0103 menggesernya saat diterima). Kirimannya DIBATALKAN,
--     bersih, oleh pengirim maupun penerima — siapa pun yang lebih dulu sadar.
--
--   SUDAH DITERIMA -> barangnya SUNGGUHAN ADA di outlet yang salah, dan
--     stoknya sudah pindah ke sana. Membatalkannya akan membuat pembukuan
--     berbohong sampai ada yang benar-benar mengantarkan barangnya kembali.
--     Yang benar: TERUSKAN — surat jalan baru dari outlet yang salah ke tujuan
--     yang seharusnya. Barangnya bergerak dua kali karena memang begitu
--     kenyataannya.
-- =========================================================

-- ---------------------------------------------------------
-- (1) Jejak pembatalan & jejak koreksi.
-- ---------------------------------------------------------
alter table dispatches add column if not exists dibatalkan_at timestamptz;
alter table dispatches add column if not exists dibatalkan_by uuid references user_profiles(id) on delete set null;
alter table dispatches add column if not exists alasan_batal text;

-- Menyambungkan kiriman koreksi ke kiriman yang salah.
--
-- Tanpa kolom ini, "Hampton mengirim ke CK" adalah kiriman biasa yang tidak
-- bisa dijelaskan siapa pun sebulan kemudian — dan justru penjelasan itulah
-- yang dicari orang saat memeriksa kenapa satu barang berpindah tiga kali.
alter table dispatches add column if not exists koreksi_dari uuid references dispatches(id) on delete set null;
create index if not exists idx_dispatch_koreksi on dispatches(koreksi_dari) where koreksi_dari is not null;

comment on column dispatches.koreksi_dari is
  'Kiriman ini dibuat untuk MEMBETULKAN kiriman lain yang salah alamat. Diisi teruskan_kiriman().';
comment on column dispatches.alasan_batal is
  'Kenapa kiriman ini dibatalkan. Wajib — pembatalan tanpa alasan tidak bisa dibedakan dari kesalahan sistem oleh siapa pun yang membacanya kemudian.';

-- ---------------------------------------------------------
-- (2) BATALKAN kiriman yang BELUM diterima.
--
-- Boleh oleh KEDUA SISI (keputusan pengguna): pengirim yang sadar sendiri, dan
-- penerima yang menolak barang yang bukan miliknya. Siapa pun yang lebih dulu
-- sadar bisa langsung membetulkan — kiriman salah yang menggantung ikut
-- menghalangi daftar kiriman yang benar di layar penerima.
-- ---------------------------------------------------------
create or replace function batalkan_kiriman(p_dispatch uuid, p_alasan text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_d dispatches%rowtype;
  r record;
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  if coalesce(btrim(p_alasan), '') = '' then
    raise exception 'Sebutkan alasan pembatalannya — walau sesingkat "salah pilih outlet tujuan".';
  end if;

  select * into v_d from dispatches where id = p_dispatch;
  if v_d.id is null then raise exception 'Pengiriman tidak ditemukan'; end if;

  if v_d.status = 'draft' then
    -- Draft belum jadi kiriman sama sekali; ia punya jalannya sendiri, dan
    -- mengarahkan ke sana lebih jujur daripada diam-diam membatalkannya
    -- lewat pintu yang berbeda.
    raise exception 'Ini masih DRAFT, belum dikirim. Pakai "Hapus draft" di tab Draft Surat Jalan.';
  end if;
  if v_d.status = 'received' then
    raise exception 'Kiriman % sudah diterima %. Barangnya sungguhan ada di sana — pakai "Teruskan ke tujuan yang benar", jangan dibatalkan.',
      coalesce(v_d.code, ''), coalesce((select name from outlets where id = v_d.to_outlet_id), 'outlet tujuan');
  end if;
  if v_d.status <> 'sent' then
    raise exception 'Kiriman % memang sudah dibatalkan.', coalesce(v_d.code, '');
  end if;

  -- KEDUA SISI berwenang.
  if not (has_outlet_scope(v_uid, v_d.from_outlet_id) or has_outlet_scope(v_uid, v_d.to_outlet_id)) then
    raise exception 'Kiriman ini bukan wewenangmu — kamu bukan pengirim maupun tujuannya.';
  end if;

  if v_d.esb_exported_at is not null then
    raise exception 'Kiriman % sudah diekspor ke ESB. Batalkan tanda ekspornya dulu, lalu perbaiki berkasnya di sana.', coalesce(v_d.code, '');
  end if;

  -- ============ STOK: BIASANYA TIDAK ADA APA-APA, TAPI TIDAK SELALU ============
  --
  -- Sejak 0103, stok baru bergeser saat kiriman DITERIMA — jadi pembatalan di
  -- tahap 'sent' tidak perlu menyentuh apa pun.
  --
  -- KECUALI kiriman lama. Sebelum 0103, stok pengirim dipotong saat kiriman
  -- DIBUAT, dan `receive_dispatch` sampai hari ini masih memeriksanya
  -- (`v_ck_sudah`). Kiriman lama yang masih menggantung di 'sent' sudah
  -- memotong stok pengirimnya, dan membatalkannya tanpa mengembalikan potongan
  -- itu akan menghilangkan barangnya dari pembukuan untuk selamanya.
  --
  -- Diperiksa dari buku besarnya sendiri, bukan dari tanggal atau kolom
  -- penanda yang bisa basi.
  for r in
    select product_id, sum(qty_delta) as delta
      from stock_movements
     where dispatch_id = p_dispatch
     group by product_id
    having sum(qty_delta) <> 0
  loop
    insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, notes, created_by, dispatch_id)
    values (v_d.business_unit_id, v_d.from_outlet_id, r.product_id, 'transfer_in', -r.delta,
            'Pembatalan kiriman ' || coalesce(v_d.code, '') || ': ' || btrim(p_alasan), v_uid, p_dispatch);
  end loop;

  update dispatches
     set status = 'cancelled',
         dibatalkan_at = now(),
         dibatalkan_by = v_uid,
         alasan_batal = btrim(p_alasan)
   where id = p_dispatch;
end;
$$;

revoke all on function batalkan_kiriman(uuid, text) from public;
grant execute on function batalkan_kiriman(uuid, text) to authenticated;

comment on function batalkan_kiriman(uuid, text) is
  'Membatalkan kiriman yang BELUM diterima. Boleh oleh pengirim maupun outlet tujuan. Alasan wajib. Stok kiriman lama (yang potongannya terjadi saat dibuat) dikembalikan.';

-- ---------------------------------------------------------
-- (3) TERUSKAN kiriman yang SUDAH diterima ke tujuan yang benar.
--
-- Barangnya sungguhan ada di outlet yang salah. Yang dibuat di sini adalah
-- surat jalan BARU dari sana ke tujuan yang seharusnya — bukan pembatalan.
--
-- Bentuknya DRAFT, bukan langsung terkirim: barangnya masih harus dinaikkan ke
-- mobil, dan surat jalan yang sudah "terkirim" untuk barang yang masih di rak
-- adalah dokumen yang menyesatkan siapa pun yang memegangnya (alasan yang sama
-- dengan 0103).
--
-- Jumlahnya diambil dari yang DITERIMA, bukan yang dikirim: yang bisa
-- diteruskan hanyalah yang benar-benar sampai.
-- ---------------------------------------------------------
create or replace function teruskan_kiriman(p_dispatch uuid, p_tujuan uuid, p_alasan text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_d dispatches%rowtype;
  v_items jsonb;
  v_baru uuid;
begin
  if v_uid is null then raise exception 'Harus login'; end if;

  select * into v_d from dispatches where id = p_dispatch;
  if v_d.id is null then raise exception 'Pengiriman tidak ditemukan'; end if;
  if v_d.status <> 'received' then
    raise exception 'Kiriman % belum diterima. Kalau salah alamat dan belum diterima, BATALKAN saja — barangnya belum berpindah ke mana pun.',
      coalesce(v_d.code, '');
  end if;

  -- Hanya outlet yang MENERIMA barangnya. Ia yang memegang barangnya, dan ia
  -- yang akan mengantarkannya.
  if not has_outlet_scope(v_uid, v_d.to_outlet_id) then
    raise exception 'Hanya outlet yang menerima kiriman ini yang bisa meneruskannya.';
  end if;
  if p_tujuan is null then raise exception 'Pilih outlet tujuan yang benar.'; end if;
  if p_tujuan = v_d.to_outlet_id then
    raise exception 'Tujuannya sama dengan tempat barangnya sekarang — tidak ada yang perlu diteruskan.';
  end if;

  -- Yang bisa diteruskan hanyalah yang BENAR-BENAR SAMPAI.
  select coalesce(
           jsonb_agg(jsonb_build_object(
             'product_id', product_id,
             'qty', received_qty,
             'keterangan', 'Koreksi salah alamat dari ' || coalesce(v_d.code, 'kiriman sebelumnya')
           )),
           '[]'::jsonb)
    into v_items
    from dispatch_items
   where dispatch_id = p_dispatch and coalesce(received_qty, 0) > 0;

  if v_items = '[]'::jsonb then
    raise exception 'Tidak ada barang yang benar-benar diterima di kiriman ini, jadi tidak ada yang bisa diteruskan.';
  end if;

  v_baru := buat_draft_kiriman(
    v_d.to_outlet_id,
    p_tujuan,
    v_items,
    'Koreksi salah alamat ' || coalesce(v_d.code, '') || ': ' || coalesce(nullif(btrim(p_alasan), ''), 'diteruskan ke tujuan yang benar'),
    null
  );

  update dispatches set koreksi_dari = p_dispatch where id = v_baru;
  return v_baru;
end;
$$;

revoke all on function teruskan_kiriman(uuid, uuid, text) from public;
grant execute on function teruskan_kiriman(uuid, uuid, text) to authenticated;

comment on function teruskan_kiriman(uuid, uuid, text) is
  'Membuat DRAFT surat jalan baru dari outlet yang salah menerima ke tujuan yang benar, sebanyak yang BENAR-BENAR diterima. Bukan pembatalan: barangnya memang ada di sana.';

notify pgrst, 'reload schema';
