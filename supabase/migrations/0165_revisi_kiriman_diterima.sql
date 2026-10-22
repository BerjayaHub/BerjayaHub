-- =========================================================
-- 0165 — SURAT JALAN YANG SUDAH DITERIMA BISA DIREVISI
--
-- Sebelum ini, begitu outlet menekan Terima, SJ-nya beku permanen:
--
--   ubah_draft_kiriman    -> `boleh_kelola_draft` mensyaratkan status 'draft'
--   simpan_cek_kiriman    -> "Kiriman ini sudah diproses, hasil cek tidak bisa diubah lagi"
--   receive_dispatch      -> hanya menerima status 'sent'
--   batalkan_kiriman      -> menolak 'received' dengan tegas
--
-- Tidak ada satu pun jalan membetulkan salah ketik, dan yang terjadi di
-- lapangan adalah orang membuat SJ tandingan atau membiarkan angkanya salah.
-- Keduanya lebih buruk daripada revisi yang berjejak.
--
-- ============ KAPAN STOK SEBENARNYA BERGERAK ============
--
-- Ini yang menentukan seluruh bentuk berkas ini, dan sempat saya kira
-- sebaliknya:
--
--   kirim_draft_kiriman (0103)  TIDAK menulis satu pun stock_movements
--   receive_dispatch (0142)     menulis KEDUANYA sekaligus:
--                                 transfer_out  -sent_qty      di outlet ASAL
--                                 transfer_in   +dicek_qty     di outlet TUJUAN
--
-- Jadi selama status 'sent', stok CK BELUM berkurang sama sekali. (Jalur lama
-- `create_dispatch` memang memotong saat kirim, dan itulah gunanya penjaga
-- `v_ck_sudah` di `receive_dispatch` — tapi jalur itu sudah tidak dipanggil
-- aplikasi mana pun.)
--
-- Akibatnya untuk revisi:
--
--   ubah JUMLAH DITERIMA   -> hanya stok outlet TUJUAN yang bergeser.
--                             `transfer_out` memakai `sent_qty`, yang tidak
--                             ikut berubah, jadi stok CK tidak tersentuh.
--   TAMBAH BARANG          -> dua-duanya bergerak: CK berkurang `sent_qty`,
--                             outlet bertambah `received_qty`.
--
-- Kalau perbedaan ini dilebur jadi "pokoknya koreksi stok", penambahan barang
-- akan memotong stok CK dua kali atau tidak sama sekali — dan tidak ada galat
-- di mana pun. Yang membacanya baru tahu saat opname berikutnya.
--
-- ============ KOREKSI DITULIS, BUKAN MENIMPA ============
--
-- Gerakan lama TIDAK diubah. Selisihnya ditulis sebagai `stock_movements`
-- BARU yang menunjuk SJ yang sama. Alasannya sama dengan revisi opname (0155):
-- stok saat ini jadi benar, DAN riwayat "apa yang terjadi hari itu" tetap
-- utuh. Menimpa gerakan lama membuat laporan periode lampau berubah sendiri
-- berbulan-bulan sesudah ditutup.
-- =========================================================

-- Jejak revisi per baris, bentuknya sama dengan `stock_count_items.revisi`
-- (0155) supaya orang yang sudah membaca yang satu langsung mengerti yang ini.
alter table dispatch_items add column if not exists revisi jsonb not null default '[]'::jsonb;

alter table dispatches add column if not exists direvisi_at timestamptz;
alter table dispatches add column if not exists direvisi_by uuid references user_profiles(id) on delete set null;
-- ============ NAMANYA, KARENA PENUNJUKNYA BISA MENGUAP ============
--
-- `direvisi_by` ber-`on delete set null`: begitu baris `user_profiles`-nya
-- dihapus, penunjuk editornya jadi null dan header SJ berbunyi "pernah
-- direvisi, entah oleh siapa". Ditemukan tesnya, bukan dugaan.
--
-- Alasan yang sama dengan `by_nama` di jejak per baris: nama SAAT perubahan
-- itu yang benar untuk catatan pertanggungjawaban.
alter table dispatches add column if not exists direvisi_by_nama text;

comment on column dispatch_items.revisi is
  'Riwayat revisi baris ini sesudah SJ diterima: [{qty_lama, qty_baru, jenis, by, by_nama, at, alasan}]. `by_nama` disimpan saat perubahan supaya jejaknya tetap terbaca kalau barisnya hilang. Ditambah, tidak pernah ditimpa.';

-- ---------------------------------------------------------
-- Siapa yang boleh merevisi.
--
-- CK (outlet asal) DAN outlet tujuan, sama seperti `batalkan_kiriman` — bukan
-- admin BU saja. Yang salah ketik biasanya yang mengetik, dan memaksanya
-- menunggu admin membuat orang memilih jalan lain: SJ tandingan, atau angka
-- yang dibiarkan salah.
-- ---------------------------------------------------------
create or replace function boleh_revisi_kiriman(p_dispatch uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from dispatches d
    where d.id = p_dispatch
      and d.status = 'received'
      and (has_outlet_scope(auth.uid(), d.from_outlet_id) or has_outlet_scope(auth.uid(), d.to_outlet_id))
  );
$$;

revoke all on function boleh_revisi_kiriman(uuid) from public;
grant execute on function boleh_revisi_kiriman(uuid) to authenticated;

-- ---------------------------------------------------------
-- RPC revisi.
--
-- p_items: [{ product_id, received_qty, sent_qty? }]
--
--   baris yang SUDAH ADA  -> `received_qty` dipakai; `sent_qty` DIABAIKAN.
--   baris BARU            -> `sent_qty` WAJIB (itu yang memotong stok CK).
--
-- Baris yang tidak disebut di `p_items` TIDAK DISENTUH. Itu bukan kelalaian:
-- layar mengirim hanya yang diubah, dan mengosongkan sisanya akan menghapus
-- seluruh SJ pada pemanggilan yang cuma membetulkan satu angka.
-- ---------------------------------------------------------
create or replace function revisi_kiriman_diterima(p_dispatch uuid, p_items jsonb, p_alasan text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  -- ============ NAMANYA DISIMPAN, BUKAN CUMA ID-NYA ============
  --
  -- Jejak audit yang menyimpan id saja bergantung pada baris `user_profiles`
  -- yang masih ada DAN masih bernama sama. Staff yang keluar lalu barisnya
  -- dihapus membuat seluruh jejak revisinya berbunyi "pengguna tak dikenal" —
  -- tepat pada catatan yang gunanya mempertanggungjawabkan perubahan stok.
  --
  -- Nama saat perubahan ITU yang benar untuk jejak, bukan nama hari ini.
  v_nama_pelaku text := coalesce((select full_name from user_profiles where id = auth.uid()), 'pengguna');
  v_d dispatches%rowtype;
  v_alasan text := btrim(coalesce(p_alasan, ''));
  it jsonb;
  v_pid uuid;
  v_recv numeric;
  v_sent numeric;
  v_lama dispatch_items%rowtype;
  v_delta numeric;
  v_ubah int := 0;
  v_tambah int := 0;
  v_esb_dicabut boolean := false;
  v_nama text;
begin
  if v_uid is null then raise exception 'Harus login'; end if;

  if v_alasan = '' then
    raise exception 'Sebutkan alasan revisinya — angka ini sudah menggerakkan stok dua outlet.';
  end if;

  select * into v_d from dispatches where id = p_dispatch;
  if v_d.id is null then raise exception 'Pengiriman tidak ditemukan.'; end if;

  -- Pesannya menyebut status SEKARANG dan jalan yang benar untuk status itu —
  -- "tidak bisa direvisi" saja meninggalkan orangnya di tempat yang sama.
  if v_d.status = 'draft' then
    raise exception 'Kiriman ini masih DRAFT. Ubah langsung di tab Draft Surat Jalan.';
  end if;
  if v_d.status = 'sent' then
    raise exception 'Kiriman ini belum diterima outlet. Outlet tujuan masih bisa membetulkan angkanya lewat layar Terima.';
  end if;
  if v_d.status <> 'received' then
    raise exception 'Kiriman % sudah dibatalkan, tidak ada yang bisa direvisi.', coalesce(v_d.code, '');
  end if;

  if not boleh_revisi_kiriman(p_dispatch) then
    raise exception 'Kiriman ini bukan wewenangmu — kamu bukan pengirim maupun outlet tujuannya.';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Tidak ada baris yang dikirim untuk direvisi.';
  end if;

  for it in select * from jsonb_array_elements(p_items) loop
    v_pid := nullif(it->>'product_id', '')::uuid;
    v_recv := nullif(it->>'received_qty', '')::numeric;
    v_sent := nullif(it->>'sent_qty', '')::numeric;
    if v_pid is null or v_recv is null or v_recv < 0 then continue; end if;

    select * into v_lama from dispatch_items
     where dispatch_id = p_dispatch and product_id = v_pid;

    if v_lama.id is null then
      -- ============ BARIS BARU ============
      --
      -- Stok CK ikut bergerak di sini, dan HANYA di sini. `sent_qty` wajib:
      -- menebaknya dari `received_qty` akan menyamarkan susut jadi nol pada
      -- barang yang justru baru ditambahkan karena ada selisih.
      if v_sent is null or v_sent < 0 then
        select name into v_nama from products where id = v_pid;
        raise exception 'Barang baru "%" harus disertai jumlah KIRIM-nya — itu yang memotong stok %.',
          coalesce(v_nama, v_pid::text), coalesce((select name from outlets where id = v_d.from_outlet_id), 'outlet asal');
      end if;

      insert into dispatch_items(dispatch_id, product_id, sent_qty, dicek_qty, received_qty, revisi)
      values (p_dispatch, v_pid, v_sent, v_recv, v_recv,
              jsonb_build_array(jsonb_build_object(
                'qty_lama', null, 'qty_baru', v_recv, 'sent_qty', v_sent,
                'jenis', 'tambah_barang', 'by', v_uid, 'by_nama', v_nama_pelaku, 'at', now(), 'alasan', v_alasan
              )));

      if v_sent > 0 then
        insert into stock_movements(business_unit_id, outlet_id, product_id, movement_type, qty_delta, ref_outlet_id, dispatch_id, notes, created_by)
        values (v_d.business_unit_id, v_d.from_outlet_id, v_pid, 'transfer_out', -v_sent, v_d.to_outlet_id, p_dispatch,
                'Revisi ' || coalesce(v_d.code, '') || ': barang ditambahkan — ' || v_alasan, v_uid);
      end if;
      if v_recv > 0 then
        insert into stock_movements(business_unit_id, outlet_id, product_id, movement_type, qty_delta, ref_outlet_id, dispatch_id, notes, created_by)
        values (v_d.business_unit_id, v_d.to_outlet_id, v_pid, 'transfer_in', v_recv, v_d.from_outlet_id, p_dispatch,
                'Revisi ' || coalesce(v_d.code, '') || ': barang ditambahkan — ' || v_alasan, v_uid);
      end if;

      v_tambah := v_tambah + 1;
    else
      -- ============ BARIS YANG SUDAH ADA ============
      --
      -- Hanya jumlah DITERIMA. `sent_qty` tidak disentuh, jadi stok CK juga
      -- tidak — lihat penjelasan panjang di kepala berkas.
      v_delta := v_recv - coalesce(v_lama.received_qty, 0);
      if v_delta = 0 then continue; end if;

      update dispatch_items
         set received_qty = v_recv,
             dicek_qty = v_recv,
             revisi = revisi || jsonb_build_object(
               'qty_lama', coalesce(v_lama.received_qty, 0), 'qty_baru', v_recv,
               'jenis', 'ubah_diterima', 'by', v_uid, 'by_nama', v_nama_pelaku, 'at', now(), 'alasan', v_alasan
             )
       where id = v_lama.id;

      insert into stock_movements(business_unit_id, outlet_id, product_id, movement_type, qty_delta, ref_outlet_id, dispatch_id, notes, created_by)
      values (v_d.business_unit_id, v_d.to_outlet_id, v_pid, 'transfer_in', v_delta, v_d.from_outlet_id, p_dispatch,
              'Revisi ' || coalesce(v_d.code, '') || ': jumlah diterima dibetulkan — ' || v_alasan, v_uid);

      v_ubah := v_ubah + 1;
    end if;
  end loop;

  if v_ubah = 0 and v_tambah = 0 then
    raise exception 'Tidak ada angka yang berubah — semuanya sama dengan yang tersimpan sekarang.';
  end if;

  -- ============ TANDA EKSPOR ESB DICABUT OTOMATIS ============
  --
  -- Berkas ESB yang sudah dikirim memuat angka yang baru saja berubah.
  -- Membiarkan tandanya berarti SJ ini tidak akan pernah ikut ekspor
  -- berikutnya, dan selisihnya tidak pernah sampai ke ESB — tanpa satu pun
  -- tanda. Jejaknya memakai kolom yang sama dengan 0143.
  if v_d.esb_exported_at is not null then
    update dispatches
       set esb_exported_at = null,
           esb_exported_by = null,
           esb_dibatalkan_at = now(),
           esb_dibatalkan_by = v_uid,
           esb_alasan_batal = 'Dicabut otomatis karena SJ direvisi sesudah diterima — ' || v_alasan
     where id = p_dispatch;
    v_esb_dicabut := true;
  end if;

  update dispatches set direvisi_at = now(), direvisi_by = v_uid, direvisi_by_nama = v_nama_pelaku where id = p_dispatch;

  return jsonb_build_object(
    'baris_diubah', v_ubah,
    'baris_ditambah', v_tambah,
    'esb_dicabut', v_esb_dicabut
  );
end;
$$;

revoke all on function revisi_kiriman_diterima(uuid, jsonb, text) from public;
grant execute on function revisi_kiriman_diterima(uuid, jsonb, text) to authenticated;

comment on function revisi_kiriman_diterima(uuid, jsonb, text) is
  'Revisi SJ yang sudah diterima: ubah jumlah diterima dan/atau tambah barang. Stok dikoreksi lewat gerakan BARU, bukan menimpa yang lama. Jejaknya di dispatch_items.revisi.';

notify pgrst, 'reload schema';
