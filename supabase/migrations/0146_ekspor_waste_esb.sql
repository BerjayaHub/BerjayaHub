-- ============================================================
-- 0146 — WASTE/SPOIL BISA DIEKSPOR KE ESB (Item Journal).
--
-- ============ BENTUK TEMPLATENYA ============
--
-- `ESB_FNB_ITEM_JOURNAL_TEMPLATE.xlsx` dibuka dan diperiksa apa adanya:
-- delapan kolom, header di BARIS KE-3 (baris 1 judul, baris 2 kosong).
--
--   No | Product Name | Product Code | Unit | Mode | Qty | Value per Unit | Purpose
--
-- ============ TIDAK ADA KOLOM BRANCH ============
--
-- Dan itu keputusan yang menular ke seluruh fitur ini: berkasnya tidak
-- menyebut outlet sama sekali, jadi outletnya ditentukan SAAT DIIMPOR di ESB.
-- Satu berkas = satu outlet.
--
-- Konsekuensinya, layar ekspor WAJIB memaksa memilih satu outlet. Berkas
-- gabungan beberapa outlet akan masuk seluruhnya ke outlet yang dipilih saat
-- impor — stok outlet lain berkurang di ESB tanpa pernah berkurang di sini,
-- dan tidak ada satu pun pesan yang menandakannya.
--
-- ============ YANG DITAMBAHKAN DI SINI ============
--
--   (1) Penanda "sudah diekspor" pada `waste_runs`, berikut jejak pembatalannya
--       — bentuk yang sama dengan nota (0127/0143) dan kiriman (0128).
--   (2) Jenis pemetaan 'purpose'. Kolom Purpose ESB tidak punya padanan apa pun
--       di Berjaya Hub: yang ada cuma `jenis` ('spoil' / 'menu') dan catatan
--       teks bebas. Jadi ia dipetakan, persis seperti cara bayar dipetakan ke
--       COA — dua baris, diisi sekali.
--
-- Begitu ESB bisa mengekspor daftar Purpose-nya, daftar itu diimpor ke
-- `esb_master` dan kotak isiannya berubah sendiri jadi dropdown. Layar
-- pemetaan sudah begitu sejak 0127: ada daftar induk -> `<select>`, belum ada
-- -> kotak ketik. Tidak ada yang perlu diubah lagi saat daftarnya datang.
-- ============================================================

-- ---------------------------------------------------------
-- (1) Penanda ekspor & jejak pembatalannya.
-- ---------------------------------------------------------
alter table waste_runs add column if not exists esb_exported_at timestamptz;
alter table waste_runs add column if not exists esb_exported_by uuid references user_profiles(id) on delete set null;
alter table waste_runs add column if not exists esb_dibatalkan_at timestamptz;
alter table waste_runs add column if not exists esb_dibatalkan_by uuid references user_profiles(id) on delete set null;
alter table waste_runs add column if not exists esb_alasan_batal text;

create index if not exists idx_waste_belum_esb on waste_runs(business_unit_id, outlet_id, created_at)
  where esb_exported_at is null;

comment on column waste_runs.esb_exported_at is
  'Kapan waste ini ikut terunduh ke berkas ESB Item Journal. Terisi = tidak ditawarkan lagi, supaya stoknya tidak dikurangi dua kali di ESB.';

-- ---------------------------------------------------------
-- (2) Jenis pemetaan 'purpose'.
--
-- Nama constraint-nya DICARI di katalog, bukan ditebak — alasannya sama dengan
-- di 0144, dan di sini nama itu memang sudah berubah sekali (0144 membuatnya
-- ulang dengan nama eksplisit).
-- ---------------------------------------------------------
do $$
declare
  v_nama text;
begin
  select conname into v_nama from pg_constraint
   where conrelid = 'esb_master'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%jenis%';
  if v_nama is not null then
    execute format('alter table esb_master drop constraint %I', v_nama);
  end if;
end $$;

alter table esb_master
  add constraint esb_master_jenis_check
  check (jenis in ('branch', 'location', 'unit', 'item', 'payment_method', 'coa', 'supplier', 'purpose'));

do $$
declare
  v_nama text;
begin
  select conname into v_nama from pg_constraint
   where conrelid = 'esb_map'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%jenis%';
  if v_nama is not null then
    execute format('alter table esb_map drop constraint %I', v_nama);
  end if;
end $$;

alter table esb_map
  add constraint esb_map_jenis_check
  check (jenis in ('branch', 'location', 'unit', 'item', 'payment_method', 'coa', 'supplier', 'purpose'));

-- ---------------------------------------------------------
-- (3) Waste yang BENAR-BENAR ikut terunduh.
--
-- Dipanggil SESUDAH berkasnya jadi, bukan sebelum — sama seperti nota (0127).
-- Menandai lebih dulu lalu gagal membuat berkasnya membuat waste itu hilang
-- dari daftar tanpa pernah sampai ke ESB, dan tidak ada yang tahu sampai
-- stoknya tidak cocok.
-- ---------------------------------------------------------
create or replace function tandai_waste_esb(p_waste uuid[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_n int;
begin
  if p_waste is null or array_length(p_waste, 1) is null then
    return 0;
  end if;

  update waste_runs w
     set esb_exported_at = now(),
         esb_exported_by = v_uid
   where w.id = any(p_waste)
     and w.esb_exported_at is null
     and is_bu_admin(v_uid, w.business_unit_id);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function tandai_waste_esb(uuid[]) from public;
grant execute on function tandai_waste_esb(uuid[]) to authenticated;

-- ---------------------------------------------------------
-- (4) Batalkan tandanya — dengan alasan, sama seperti 0143.
-- ---------------------------------------------------------
create or replace function batalkan_tanda_waste_esb(p_waste uuid[], p_alasan text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_alasan text := alasan_batal_esb_sah(p_alasan);
  v_n int;
begin
  if p_waste is null or array_length(p_waste, 1) is null then
    return 0;
  end if;

  update waste_runs w
     set esb_exported_at = null,
         esb_exported_by = null,
         esb_dibatalkan_at = now(),
         esb_dibatalkan_by = v_uid,
         esb_alasan_batal = v_alasan
   where w.id = any(p_waste)
     -- Yang TIDAK bertanda dilewati, bukan ditulisi jejak pembatalan yang
     -- tidak pernah terjadi.
     and w.esb_exported_at is not null
     and is_bu_admin(v_uid, w.business_unit_id);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function batalkan_tanda_waste_esb(uuid[], text) from public;
grant execute on function batalkan_tanda_waste_esb(uuid[], text) to authenticated;

comment on function batalkan_tanda_waste_esb(uuid[], text) is
  'Membuka tanda ekspor ESB sebuah waste. Menuntut alasan dan mencatat pelakunya. TIDAK menghapus jurnalnya di ESB.';

notify pgrst, 'reload schema';
