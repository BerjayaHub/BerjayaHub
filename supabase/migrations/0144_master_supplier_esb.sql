-- ============================================================
-- 0144 — SUPPLIER PUNYA DAFTAR PASTI, DAN DAFTARNYA DATANG DARI ESB.
--
-- ============ MASALAHNYA ============
--
-- Kolom Supplier di nota terima adalah teks bebas. Akibatnya dua hal, dan
-- keduanya tidak pernah menampilkan error:
--
--   1. Sel Supplier berangkat ke ESB dengan nama yang mungkin tidak terdaftar
--      di sana. ESB menolak berkasnya — jauh belakangan, di layar yang berbeda.
--   2. Tab Hutang Supplier mengelompokkan per TEKS. "Pasar" dan "pasar "
--      menjadi dua kelompok hutang yang berbeda untuk satu supplier yang sama.
--
-- ============ TIDAK ADA TABEL BARU ============
--
-- Godaan pertama adalah membuat tabel `suppliers` sendiri, lalu mengisinya dari
-- nama-nama yang sudah terlanjur diketik. Itu salah arah: daftar yang benar
-- bukan milik Berjaya Hub, melainkan milik ESB. Daftar buatan sendiri akan
-- menyimpang dari ESB pada hari pertama supplier baru ditambahkan di sana.
--
-- Jadi yang dipakai `esb_master` — tabel yang memang untuk itu sejak 0127,
-- lengkap dengan alur impornya, layarnya, dan aturan "diganti tiap impor".
-- Migration ini cuma memperlebar satu `check`.
--
-- ============ KENAPA `esb_map` JUGA ============
--
-- Nota yang SUDAH terlanjur diketik tidak ditulis ulang. Teks di
-- `goods_receipts.supplier` adalah catatan apa yang dulu diketik orang, dan
-- menimpanya menghapus jejak itu tanpa bisa dikembalikan.
--
-- Maka ejaan lama dipetakan, persis seperti nama outlet dipetakan ke Branch:
-- "toko beras ridho" -> "Toko Beras Ridho". Dipetakan sekali, notanya utuh.
--
-- Pemetaan tinggal di tabel yang BERBEDA dari daftar induknya, dan itulah
-- seluruh alasan keduanya dipisah di 0127: daftar induk diganti tiap impor,
-- pemetaan adalah keputusan manusia yang harus bertahan melewatinya.
-- ============================================================

-- ---------------------------------------------------------
-- (1) Daftar induk boleh berisi supplier.
--
-- `check` diganti dengan menyebut nama constraint-nya lewat katalog, bukan
-- dengan nama yang ditebak. Postgres menamai constraint otomatis
-- (`esb_master_jenis_check`), tapi nama itu bisa berbeda kalau tabelnya pernah
-- dibuat lewat jalur lain — dan `drop constraint` dengan nama yang salah
-- menggagalkan seluruh migration di tengah jalan.
-- ---------------------------------------------------------
do $$
declare
  v_nama text;
begin
  select conname into v_nama from pg_constraint
   where conrelid = 'esb_master'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%jenis%';
  if v_nama is not null then
    execute format('alter table esb_master drop constraint %I', v_nama);
  end if;
end $$;

alter table esb_master
  add constraint esb_master_jenis_check
  check (jenis in ('branch', 'location', 'unit', 'item', 'payment_method', 'coa', 'supplier'));

-- ---------------------------------------------------------
-- (2) Pemetaan boleh berjenis supplier.
-- ---------------------------------------------------------
do $$
declare
  v_nama text;
begin
  select conname into v_nama from pg_constraint
   where conrelid = 'esb_map'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%jenis%';
  if v_nama is not null then
    execute format('alter table esb_map drop constraint %I', v_nama);
  end if;
end $$;

alter table esb_map
  add constraint esb_map_jenis_check
  check (jenis in ('branch', 'location', 'unit', 'item', 'payment_method', 'coa', 'supplier'));

comment on table esb_master is
  'Salinan daftar induk ESB (Branch, Location, Unit, Item, COA, Payment Method, Supplier), diisi dengan mengunggah berkas ekspor ESB. Dipakai supaya nilainya dipilih, bukan diketik.';

-- ---------------------------------------------------------
-- (3) STAFF BOLEH MEMBACA daftar induknya.
--
-- Tanpa bagian ini seluruh fitur ini tidak berguna bagi orang yang dituju.
--
-- Kebijakan 0127 memberi `esb_master` satu policy `for all` dengan syarat
-- `is_bu_admin`. Itu benar untuk MENULIS — daftar induk memang keputusan
-- administratif. Tapi ia juga menutup MEMBACA, dan yang perlu memilih supplier
-- dari daftar justru staff, bukan admin.
--
-- Kegagalannya diam: RLS yang menolak SELECT tidak melempar galat, ia
-- mengembalikan NOL BARIS. Layar nota melihat daftar kosong, menyimpulkan
-- "daftarnya belum diimpor", lalu menampilkan kotak teks bebas — persis seperti
-- sebelum fitur ini ada. Tidak ada error di mana pun, dan admin yang mengujinya
-- sendiri melihat dropdown yang berfungsi, karena ia memang admin.
--
-- Yang dibuka hanya SELECT, dan hanya untuk anggota BU-nya. Menulis tetap
-- `is_bu_admin`: staff boleh memilih dari daftar, tidak boleh mengubahnya.
--
-- `esb_map` TIDAK ikut dibuka. Isinya keputusan pemetaan yang tidak pernah
-- dibaca layar staff, dan membuka yang tidak perlu adalah kebiasaan yang mahal.
-- ---------------------------------------------------------
drop policy if exists esb_master_baca_anggota on esb_master;
create policy esb_master_baca_anggota on esb_master
  for select to authenticated
  using (has_bu_scope(auth.uid(), business_unit_id));

comment on policy esb_master_baca_anggota on esb_master is
  'Staff boleh MEMBACA daftar induk ESB supaya bisa memilih supplier dari daftar. Menulis tetap hanya is_bu_admin lewat policy esb_master_admin.';

-- ---------------------------------------------------------
-- (4) Daftar nama supplier yang PERNAH diketik, beserta jumlah notanya.
--
-- Dipakai layar pemetaan untuk tahu ejaan lama apa saja yang masih beredar.
-- Tanpa ini, layarnya cuma bisa menampilkan daftar ESB — dan yang justru perlu
-- dibereskan adalah nama-nama yang TIDAK ada di daftar itu.
--
-- Jumlah notanya ikut: "toko beras ridho" yang muncul di 40 nota dan yang
-- muncul di 1 nota memerlukan perhatian yang berbeda, dan tanpa angkanya
-- keduanya terlihat sama mendesaknya.
--
-- Hanya nota AKTIF yang dihitung. Nota yang dibatalkan tidak akan pernah
-- diekspor, jadi ejaannya tidak perlu dibereskan siapa pun.
-- ---------------------------------------------------------
create or replace function nama_supplier_terpakai(p_bu uuid)
returns table (nama text, jumlah bigint, belum_ekspor bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select btrim(g.supplier) as nama,
         count(*) as jumlah,
         count(*) filter (where g.esb_exported_at is null) as belum_ekspor
    from goods_receipts g
   where g.business_unit_id = p_bu
     and coalesce(btrim(g.supplier), '') <> ''
     and g.status = 'aktif'
   group by btrim(g.supplier)
   order by count(*) filter (where g.esb_exported_at is null) desc, count(*) desc, btrim(g.supplier);
$$;

revoke all on function nama_supplier_terpakai(uuid) from public;
grant execute on function nama_supplier_terpakai(uuid) to authenticated;

comment on function nama_supplier_terpakai(uuid) is
  'Nama supplier yang pernah diketik di nota aktif BU ini, beserta jumlah notanya dan berapa yang belum diekspor. Untuk layar pemetaan supplier.';

notify pgrst, 'reload schema';
