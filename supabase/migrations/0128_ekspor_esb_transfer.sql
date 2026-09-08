-- =========================================================
-- Berjaya Hub OMS — 0128
-- Ekspor kiriman antar-outlet ke template ESB "Simple Transfer".
--
-- =========================================================
-- YANG DIMINTA
-- =========================================================
--
--   "sekarang lanjut ke bagian lain, di esb namanya simple transfer
--    di berjaya hub kita pakai modul pengiriman"
--
-- Lanjutan langsung dari 0127. Bentuknya sengaja dibuat sama persis, sampai ke
-- nama kolomnya: penanda `esb_exported_at` + `esb_exported_by`, sepasang fungsi
-- tandai/batalkan, dan indeks parsial untuk yang belum berangkat.
--
-- =========================================================
-- TIDAK ADA TABEL BARU
-- =========================================================
--
-- `esb_master` dan `esb_map` dari 0127 dipakai apa adanya. Origin/Destination
-- Branch & Location sumbernya sama-sama NAMA OUTLET — persis yang sudah
-- dipetakan untuk Purchase — dan Unit serta Product Name juga.
--
-- Menambah jenis pemetaan baru khusus transfer justru berbahaya: admin akan
-- memetakan "AB Sentul" dua kali, lalu suatu hari yang satu diperbarui dan yang
-- lain tidak. Dua jawaban untuk satu pertanyaan tidak pernah terlihat salah di
-- layar; ia hanya membuat dua berkas ESB tidak konsisten.
--
-- =========================================================
-- YANG DIEKSPOR HANYA YANG SUDAH DITERIMA
-- =========================================================
--
-- Keputusan pengguna: Qty = `received_qty`, tanggal = `received_at`, dan hanya
-- status 'received'.
--
-- Kiriman berstatus 'sent' adalah barang yang sedang di jalan. Mengekspornya
-- akan menambah stok tujuan di ESB sebelum barangnya sampai — dan kalau yang
-- sampai kemudian ternyata lebih sedikit, selisihnya tidak pernah dikoreksi
-- oleh siapa pun karena tidak ada yang tahu ia ada.
--
-- Aturan itu ditegakkan DI SINI, di fungsi penanda, bukan cuma di layar.
-- Penyaringan di layar hanya menyembunyikan barisnya; penyaringan di sini
-- membuat kirimannya tidak bisa ditandai berangkat sama sekali.
-- =========================================================

-- ---------------------------------------------------------
-- (1) Penanda kiriman yang sudah diekspor.
-- ---------------------------------------------------------
alter table dispatches add column if not exists esb_exported_at timestamptz;
alter table dispatches add column if not exists esb_exported_by uuid references user_profiles(id) on delete set null;

-- Indeks parsial: daftar yang dibaca layar selalu "yang belum berangkat".
-- Setelah beberapa bulan, baris yang sudah ditandai jauh lebih banyak daripada
-- yang belum, dan indeks penuh akan sebagian besar berisi baris yang tidak
-- pernah dicari.
create index if not exists idx_dispatch_belum_esb on dispatches(business_unit_id, received_at)
  where esb_exported_at is null;

comment on column dispatches.esb_exported_at is
  'Kapan kiriman ini ikut terunduh ke berkas ESB Simple Transfer. Terisi = tidak ditawarkan lagi, supaya mutasi stok tidak terunggah dua kali.';

-- ---------------------------------------------------------
-- (2) Tandai kiriman yang BENAR-BENAR ikut terunduh.
--
-- Dipanggil SESUDAH berkasnya jadi. Urutan yang sama dengan 0127 dan karena
-- alasan yang sama: kalau ditandai lebih dulu lalu pembuatan berkasnya gagal,
-- kirimannya hilang dari daftar tanpa pernah sampai ke ESB.
-- ---------------------------------------------------------
create or replace function tandai_kiriman_esb(p_kiriman uuid[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_n int;
begin
  if p_kiriman is null or array_length(p_kiriman, 1) is null then
    return 0;
  end if;

  update dispatches d
     set esb_exported_at = now(),
         esb_exported_by = v_uid
   where d.id = any(p_kiriman)
     and d.esb_exported_at is null
     -- Hanya kiriman yang sudah DITERIMA. Lihat catatan di kepala berkas:
     -- barang yang masih di jalan belum boleh menambah stok di ESB.
     and d.status = 'received'
     -- Tanpa tanggal terima, sel Date-nya kosong, dan ESB mengisi sel Date yang
     -- kosong dengan tanggal unggah — seluruh kiriman lama akan masuk sebagai
     -- mutasi hari ini.
     and d.received_at is not null
     and is_bu_admin(v_uid, d.business_unit_id);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function tandai_kiriman_esb(uuid[]) from public;
grant execute on function tandai_kiriman_esb(uuid[]) to authenticated;

comment on function tandai_kiriman_esb(uuid[]) is
  'Menandai kiriman sebagai sudah diekspor ke ESB Simple Transfer. Hanya status received dan yang punya received_at. Kiriman yang sudah bertanda dilewati, bukan ditimpa.';

-- ---------------------------------------------------------
-- (3) Batalkan penandaan — untuk berkas yang ditolak ESB.
-- ---------------------------------------------------------
create or replace function batalkan_tanda_kiriman_esb(p_kiriman uuid[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  if p_kiriman is null or array_length(p_kiriman, 1) is null then
    return 0;
  end if;
  update dispatches d
     set esb_exported_at = null, esb_exported_by = null
   where d.id = any(p_kiriman)
     and d.esb_exported_at is not null
     and is_bu_admin(auth.uid(), d.business_unit_id);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function batalkan_tanda_kiriman_esb(uuid[]) from public;
grant execute on function batalkan_tanda_kiriman_esb(uuid[]) to authenticated;

-- ---------------------------------------------------------
-- (4) Kiriman yang sudah diekspor tidak boleh berubah isinya.
--
-- Tanpa ini, qty terima bisa dikoreksi SESUDAH berkasnya diunggah, dan ESB
-- menyimpan angka yang berbeda dari Berjaya Hub selamanya — tanpa satu pun
-- baris yang terlihat aneh di kedua sistem.
--
-- Yang dilarang cuma mengubah angkanya. Membatalkan penandaan (3) lalu
-- memperbaiki tetap bisa, dan itu memang jalan yang benar: berkas lamanya
-- dihapus di ESB, yang baru diunggah.
-- ---------------------------------------------------------
create or replace function tolak_ubah_kiriman_terekspor()
returns trigger
language plpgsql
as $$
declare
  v_ada boolean;
begin
  select true into v_ada
    from dispatches d
   where d.id = coalesce(new.dispatch_id, old.dispatch_id)
     and d.esb_exported_at is not null;

  if v_ada then
    raise exception 'Kiriman ini sudah diekspor ke ESB. Batalkan tanda ekspornya dulu sebelum mengubah jumlah.'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_tolak_ubah_kiriman_terekspor on dispatch_items;
create trigger trg_tolak_ubah_kiriman_terekspor
  before insert or update or delete on dispatch_items
  for each row execute function tolak_ubah_kiriman_terekspor();

notify pgrst, 'reload schema';
