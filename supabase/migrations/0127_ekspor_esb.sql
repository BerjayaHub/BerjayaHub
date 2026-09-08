-- =========================================================
-- Berjaya Hub OMS — 0127
-- Ekspor nota penerimaan ke template ESB "Simple Purchase".
--
-- =========================================================
-- YANG DIMINTA
-- =========================================================
--
--   "saya ingin berjaya hub sebagai input utama, lalu menghasilkan template
--    yang sesuai dengan esb, jadi admin portal tinggal download excel yang
--    sesuai dengan template esb, dan upload saja di esb"
--
-- Berhenti mengetik dua kali. Berjaya Hub tempat input; ESB menerima berkas
-- yang bentuknya sudah persis.
--
-- =========================================================
-- DUA TABEL, DAN KENAPA BUKAN SATU
-- =========================================================
--
-- `esb_master` — SALINAN daftar induk milik ESB (branch, satuan, item, COA).
--   Diisi dengan mengunggah berkas ekspor ESB itu sendiri, bukan diketik ulang.
--   Gunanya supaya editor pemetaan bisa menawarkan PILIHAN, bukan kotak ketik:
--   279 nama produk yang diketik tangan pasti melahirkan salah ketik, dan salah
--   ketik di sini tidak muncul sebagai error — ia muncul sebagai berkas yang
--   ditolak ESB berminggu-minggu kemudian.
--
-- `esb_map` — jembatan nilai LOKAL ke nilai ESB. "Central Kitchen Tangerang"
--   -> "HEAD OFFICE", "gr" -> "GR", "Telur" -> "Telur Ayam".
--
-- Dipisah karena umurnya berbeda: master ikut berubah setiap kali ESB
-- memperbarui datanya, sementara pemetaan adalah keputusan manusia yang harus
-- bertahan melewati pembaruan itu. Digabung, satu impor master akan menghapus
-- pekerjaan pemetaan berhari-hari.
--
-- =========================================================
-- PENANDA SUDAH DIEKSPOR
-- =========================================================
--
-- Pembelian ganda di ESB sulit ditelusuri: kedua barisnya terlihat wajar, dan
-- yang menyadarinya biasanya baru orang yang mencocokkan stok akhir bulan.
-- Bentuk penandanya sama dengan `harga_digeser_at` (0124) — sekali ditandai,
-- notanya tidak ditawarkan lagi.
-- =========================================================

-- ---------------------------------------------------------
-- (1) Salinan daftar induk ESB.
-- ---------------------------------------------------------
create table if not exists esb_master (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references business_units(id) on delete cascade,
  jenis text not null check (jenis in ('branch', 'location', 'unit', 'item', 'payment_method', 'coa')),
  -- Kode ESB (Product Code / Branch Code / nomor COA). Boleh kosong: daftar
  -- satuan & metode bayar tidak punya kode.
  kode text,
  -- NAMA inilah yang ditulis ke sel template. Bukan kodenya.
  nama text not null,
  -- Keterangan yang membantu manusia memilih: kategori produk, satuan
  -- default-purchase, dan sebagainya. Tidak pernah ikut ke template.
  keterangan text,
  diperbarui_at timestamptz not null default now(),
  unique (business_unit_id, jenis, nama)
);
create index if not exists idx_esb_master_bu on esb_master(business_unit_id, jenis);

comment on table esb_master is
  'Salinan daftar induk ESB, diisi dengan mengunggah berkas ekspor ESB. Dipakai editor pemetaan supaya nilainya dipilih, bukan diketik.';

-- ---------------------------------------------------------
-- (2) Pemetaan nilai lokal -> nilai ESB.
-- ---------------------------------------------------------
create table if not exists esb_map (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references business_units(id) on delete cascade,
  jenis text not null check (jenis in ('branch', 'location', 'unit', 'item', 'payment_method', 'coa')),
  -- Nilai LOKAL: nama outlet, satuan dasar produk, nama produk, atau cara
  -- bayar ('kas' / 'tempo' / 'pusat').
  kunci text not null,
  -- Nilai ESB yang ditulis ke template.
  nilai text not null,
  diperbarui_at timestamptz not null default now(),
  diperbarui_by uuid references user_profiles(id) on delete set null
);

-- Kunci unik TANPA membedakan huruf besar-kecil.
--
-- "Telur" dan "telur" adalah satu produk yang sama, dan dua baris pemetaan
-- untuk nama yang sama akan membuat hasilnya bergantung pada baris mana yang
-- kebetulan terbaca lebih dulu — perbedaan yang tidak akan pernah terlihat di
-- layar.
create unique index if not exists esb_map_kunci_uk
  on esb_map(business_unit_id, jenis, lower(btrim(kunci)));

comment on table esb_map is
  'Jembatan nilai lokal Berjaya Hub ke nilai ESB. Dipisah dari esb_master karena umurnya berbeda: master ikut berubah tiap impor, pemetaan adalah keputusan manusia yang harus bertahan melewatinya.';

alter table esb_master enable row level security;
alter table esb_map enable row level security;

-- Keduanya keputusan administratif, bukan data operasional harian.
drop policy if exists esb_master_admin on esb_master;
create policy esb_master_admin on esb_master
  for all to authenticated
  using (is_bu_admin(auth.uid(), business_unit_id))
  with check (is_bu_admin(auth.uid(), business_unit_id));

drop policy if exists esb_map_admin on esb_map;
create policy esb_map_admin on esb_map
  for all to authenticated
  using (is_bu_admin(auth.uid(), business_unit_id))
  with check (is_bu_admin(auth.uid(), business_unit_id));

-- ---------------------------------------------------------
-- (3) Penanda nota yang sudah diekspor.
-- ---------------------------------------------------------
alter table goods_receipts add column if not exists esb_exported_at timestamptz;
alter table goods_receipts add column if not exists esb_exported_by uuid references user_profiles(id) on delete set null;

create index if not exists idx_gr_belum_esb on goods_receipts(business_unit_id, receipt_date)
  where esb_exported_at is null;

comment on column goods_receipts.esb_exported_at is
  'Kapan nota ini ikut terunduh ke berkas ESB. Terisi = tidak ditawarkan lagi di ekspor berikutnya, supaya tidak terunggah dua kali.';

-- ---------------------------------------------------------
-- (4) Tandai nota yang BENAR-BENAR ikut terunduh.
--
-- Dipanggil SESUDAH berkasnya jadi, bukan sebelum. Kalau ditandai lebih dulu
-- lalu pembuatan berkasnya gagal, notanya hilang dari daftar tanpa pernah
-- sampai ke ESB — dan tidak ada yang tahu sampai stoknya tidak cocok.
-- ---------------------------------------------------------
create or replace function tandai_nota_esb(p_notas uuid[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_n int;
begin
  if p_notas is null or array_length(p_notas, 1) is null then
    return 0;
  end if;

  -- Hanya nota yang boleh ditulis orang ini, dan yang BELUM ditandai.
  -- Menandai ulang akan menggeser tanggalnya dan menghapus jejak kapan ia
  -- sebenarnya berangkat.
  update goods_receipts g
     set esb_exported_at = now(),
         esb_exported_by = v_uid
   where g.id = any(p_notas)
     and g.esb_exported_at is null
     and is_bu_admin(v_uid, g.business_unit_id);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function tandai_nota_esb(uuid[]) from public;
grant execute on function tandai_nota_esb(uuid[]) to authenticated;

comment on function tandai_nota_esb(uuid[]) is
  'Menandai nota sebagai sudah diekspor ke ESB. Dipanggil sesudah berkasnya jadi. Nota yang sudah bertanda dilewati, bukan ditimpa.';

-- ---------------------------------------------------------
-- (5) Batalkan penandaan — untuk unggahan yang gagal di ESB.
--
-- Tanpa ini, berkas yang ditolak ESB meninggalkan notanya tertandai selamanya
-- dan satu-satunya jalan keluarnya lewat SQL Editor. Itu bukan jalan keluar;
-- itu ketiadaan jalan keluar.
-- ---------------------------------------------------------
create or replace function batalkan_tanda_esb(p_notas uuid[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  if p_notas is null or array_length(p_notas, 1) is null then
    return 0;
  end if;
  update goods_receipts g
     set esb_exported_at = null, esb_exported_by = null
   where g.id = any(p_notas)
     and g.esb_exported_at is not null
     and is_bu_admin(auth.uid(), g.business_unit_id);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function batalkan_tanda_esb(uuid[]) from public;
grant execute on function batalkan_tanda_esb(uuid[]) to authenticated;

notify pgrst, 'reload schema';
