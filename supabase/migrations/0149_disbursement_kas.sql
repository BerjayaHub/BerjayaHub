-- ============================================================
-- 0149 — KAS KELUAR BISA DIEKSPOR KE ESB (Disbursement).
--
-- ============ BENTUK TEMPLATENYA ============
--
-- `ESB_FNB_DISBURSEMENT_TEMPLATE_INDEX.xlsx` dibuka dan selnya diperiksa apa
-- adanya: 18 kolom, header di baris 1.
--
--   Sequence | Payment To | Supplier Bank Account Number | Document Date |
--   Branch | Cost Center | Project | Payment Method | Account | Currency |
--   Rate | Credit Terms | Supplier Invoice Number | Branch Detail |
--   Account Detail | Amount | Description | Additional Information
--
-- ============ YANG BELUM ADA DI BERJAYA HUB ============
--
--   (1) `Payment To`. Kas keluar tidak punya kolom "dibayar ke siapa" — yang
--       ada cuma Keterangan, teks bebas berisi "Bensin" atau "Parkir".
--       Pemiliknya menjawab: itu SUPPLIER. Jadi kolomnya lahir di sini, dan
--       daftarnya daftar yang sama dengan nota (`esb_master` jenis 'supplier',
--       0144) — bukan daftar kedua yang cepat atau lambat menyimpang.
--
--   (2) `Account` (nomor COA). Dipetakan dari KATEGORI BIAYA lewat `esb_map`
--       jenis 'coa' yang sudah ada sejak 0127 — tidak ada tabel baru.
--
-- ============ HANYA PENGELUARAN SELAIN BAHAN ============
--
-- "disbursement ini hanya untuk pengeluaran selain bahan, jadi di berjaya hub
--  apa bisa dipisah juga"
--
-- Bisa, dan pemisahannya tidak perlu ditebak: `untuk_nota` (0122) menandai
-- entri yang membayar nota penerimaan barang, dan `penyesuaian_nota` (0131)
-- menandai koreksinya. Keduanya dijaga CONSTRAINT TRIGGER yang menuntut
-- notanya sungguh menunjuk entri itu, jadi flag-nya tidak bisa dikarang dari
-- klien. Pembelian bahan berangkat lewat Simple Purchase; keduanya tidak
-- pernah bertemu di satu berkas.
--
-- Penyaringannya sendiri dikerjakan di layanan, bukan di sini — migration ini
-- cuma menyediakan kolom & fungsinya.
-- ============================================================

-- ---------------------------------------------------------
-- (1) Payment To, beserta jejak pengisinya.
--
-- Jejaknya ada karena kolom ini akan diisi MUNDUR untuk entri lama oleh admin,
-- sementara entri baru diisi pemegang kasnya sendiri. Tanpa jejak, tidak ada
-- cara membedakan "dipilih orang yang membelanjakan" dari "ditebak orang
-- kantor tiga minggu kemudian".
-- ---------------------------------------------------------
alter table cash_entries add column if not exists supplier text;
alter table cash_entries add column if not exists supplier_diisi_by uuid references user_profiles(id) on delete set null;
alter table cash_entries add column if not exists supplier_diisi_at timestamptz;

comment on column cash_entries.supplier is
  'Payment To di berkas ESB Disbursement. Nama dari daftar induk supplier ESB (0144) — daftar yang SAMA dengan kolom Supplier di nota.';

-- ---------------------------------------------------------
-- (2) Penanda ekspor & jejak pembatalannya — bentuk yang sama dengan nota
--     (0127/0143), kiriman (0128), dan waste (0146).
-- ---------------------------------------------------------
alter table cash_entries add column if not exists esb_exported_at timestamptz;
alter table cash_entries add column if not exists esb_exported_by uuid references user_profiles(id) on delete set null;
alter table cash_entries add column if not exists esb_dibatalkan_at timestamptz;
alter table cash_entries add column if not exists esb_dibatalkan_by uuid references user_profiles(id) on delete set null;
alter table cash_entries add column if not exists esb_alasan_batal text;

-- Indeks parsialnya menyaring apa yang memang dicari layar ekspor: kas KELUAR
-- yang belum diekspor. Kas masuk dan transfer tidak pernah jadi Disbursement.
create index if not exists idx_kas_belum_esb on cash_entries(business_unit_id, entry_date)
  where esb_exported_at is null and entry_type = 'out';

comment on column cash_entries.esb_exported_at is
  'Kapan entri ini ikut terunduh ke berkas ESB Disbursement. Terisi = tidak ditawarkan lagi, dan isinya terkunci.';

-- ---------------------------------------------------------
-- (3) Yang sudah diekspor TERKUNCI.
--
-- Disalin dari 0141 dengan SATU tambahan: pemeriksaan penanda ESB. Ditulis
-- ulang di sini, bukan dengan menyunting 0141, supaya migration yang sudah
-- dijalankan tidak perlu dijalankan ulang.
--
-- Ditaruh di `alasan_tolak_koreksi_kas` — bukan di `ubah_kas` — karena dari
-- sanalah KETIGA pintu membacanya: `ubah_kas`, `coret_kas`, dan layar yang
-- memutuskan tombol mana digambar. Menaruhnya di salah satu pintu saja berarti
-- dua pintu lain tetap terbuka.
-- ---------------------------------------------------------
create or replace function alasan_tolak_koreksi_kas(p_entry uuid)
returns text
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v cash_entries%rowtype;
  v_kode text;
begin
  select * into v from cash_entries where id = p_entry;
  if v.id is null then
    return 'Entri kasnya tidak ditemukan. Mungkin sudah dikoreksi orang lain — muat ulang halamannya.';
  end if;

  if not boleh_koreksi_kas(v.holder_id) then
    return 'Kas ini bukan wewenangmu. Yang bisa mengoreksinya: pemegangnya sendiri, admin BU tempat ia bernaung, atau super admin.';
  end if;

  if v.dicoret_at is not null then
    return 'Entri ini sudah dihapus sebelumnya, jadi tidak ada lagi yang bisa diubah.';
  end if;

  -- BARU DI 0149. Berkasnya sudah berangkat membawa angka yang lama; mengubahnya
  -- di sini membuat catatan berbeda di dua tempat, selamanya, tanpa satu pun tanda.
  if v.esb_exported_at is not null then
    return 'Entri ini sudah diekspor ke ESB, jadi isinya terkunci. Minta admin BU membuka tandanya lewat Admin Portal -> Inventory -> Ekspor ESB -> "Batalkan tanda ekspor", lalu perbaiki dan unggah ulang berkasnya.';
  end if;

  if v.entry_type not in ('in', 'out') then
    return 'Transfer dan perpindahan antar kantong berpasangan dengan baris di kas lain, jadi tidak bisa dikoreksi sepotong. Catat transfer balik kalau memang salah.';
  end if;

  select string_agg(code, ', ' order by code) into v_kode
    from goods_receipts where payment_entry_id = p_entry;
  if v_kode is not null then
    return 'Entri ini adalah pembayaran nota ' || v_kode ||
           '. Nominalnya mengikuti isi notanya, jadi mengubahnya dari sini akan meninggalkan nota berstatus LUNAS dengan angka yang tidak cocok. ' ||
           'Pakai modul Bahan -> Nota Terima -> Batalkan Pembayaran; stok dan status notanya ikut dibereskan di sana.';
  end if;

  if v.penyesuaian_nota is not null then
    return 'Entri ini penyesuaian otomatis dari koreksi nota, bukan catatan kas yang berdiri sendiri. Perbaiki notanya di modul Bahan.';
  end if;

  return null;
end;
$$;

revoke all on function alasan_tolak_koreksi_kas(uuid) from public;
grant execute on function alasan_tolak_koreksi_kas(uuid) to authenticated;

-- ---------------------------------------------------------
-- (4) `ubah_kas` ikut menerima Supplier.
--
-- TANDA TANGAN LAMANYA DIBUANG, dan itu disengaja. PostgREST memilih overload
-- berdasarkan HIMPUNAN NAMA ARGUMEN: dua tanda tangan yang cuma berbeda satu
-- argumen berarti permintaan yang kehilangan `p_supplier` akan diam-diam
-- memilih yang lama — tersimpan dengan sukses, dan Supplier yang baru saja
-- dipilih orangnya lenyap tanpa satu pun pesan.
-- ---------------------------------------------------------
drop function if exists ubah_kas(uuid, numeric, uuid, uuid, text, numeric, text, date);

create or replace function ubah_kas(
  p_entry uuid,
  p_amount numeric,
  p_category uuid,
  p_outlet uuid,
  p_notes text,
  p_qty numeric,
  p_unit text,
  p_date date,
  p_supplier text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_tolak text;
  v_type text;
  v_supplier text := nullif(btrim(coalesce(p_supplier, '')), '');
  v_lama text;
begin
  if v_uid is null then raise exception 'Harus login'; end if;

  v_tolak := alasan_tolak_koreksi_kas(p_entry);
  if v_tolak is not null then raise exception '%', v_tolak; end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Jumlah uang harus lebih dari 0.';
  end if;
  if coalesce(btrim(p_notes), '') = '' then
    raise exception 'Keterangan wajib diisi — entri tanpa keterangan tidak bisa dipertanggungjawabkan siapa pun.';
  end if;

  select entry_type, supplier into v_type, v_lama from cash_entries where id = p_entry;

  if v_type = 'out' and p_outlet is null then
    raise exception 'Pilih outlet peruntukan — kas keluar harus jelas dibelanjakan untuk outlet mana.';
  end if;

  update cash_entries
     set amount = case when v_type = 'out' then -abs(p_amount) else abs(p_amount) end,
         category_id = p_category,
         outlet_id = case when v_type = 'out' then p_outlet else null end,
         notes = btrim(p_notes),
         qty = p_qty,
         unit = nullif(btrim(coalesce(p_unit, '')), ''),
         entry_date = coalesce(p_date, entry_date),
         -- Kas MASUK tidak pernah jadi Disbursement, jadi supplier-nya selalu
         -- dikosongkan alih-alih menerima apa pun yang dikirim layar.
         supplier = case when v_type = 'out' then v_supplier else null end,
         -- Jejaknya hanya disentuh kalau nilainya BERUBAH: mengoreksi nominal
         -- tidak boleh membuat seolah suppliernya baru saja diisi ulang.
         supplier_diisi_by = case
           when v_type <> 'out' then null
           when v_supplier is distinct from v_lama then (case when v_supplier is null then null else v_uid end)
           else supplier_diisi_by end,
         supplier_diisi_at = case
           when v_type <> 'out' then null
           when v_supplier is distinct from v_lama then (case when v_supplier is null then null else now() end)
           else supplier_diisi_at end,
         diubah_at = now(),
         diubah_by = v_uid
   where id = p_entry;
end;
$$;

revoke all on function ubah_kas(uuid, numeric, uuid, uuid, text, numeric, text, date, text) from public;
grant execute on function ubah_kas(uuid, numeric, uuid, uuid, text, numeric, text, date, text) to authenticated;

-- ---------------------------------------------------------
-- (5) Mengisi Supplier MUNDUR, banyak entri sekaligus.
--
-- Seluruh kas keluar yang ada hari ini tidak punya Supplier — kolomnya baru
-- lahir di migration ini. `ubah_kas` menuntut seluruh kolom lain ikut dikirim
-- dan menolak entri pembayaran nota; untuk mengisi satu kolom pada ratusan
-- baris, itu jalan yang salah.
--
-- Yang TIDAK dilakukan: menyentuh entri yang sudah diekspor. Sama alasannya
-- dengan `ubah_purpose_waste` (0147).
-- ---------------------------------------------------------
create or replace function ubah_supplier_kas(p_entries uuid[], p_supplier text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_supplier text := nullif(btrim(coalesce(p_supplier, '')), '');
  v_n int;
begin
  if p_entries is null or array_length(p_entries, 1) is null then
    return 0;
  end if;
  if v_supplier is null then
    raise exception 'Pilih suppliernya dulu. Mengosongkannya tidak memperbaiki apa pun — entrinya akan tetap tertahan saat diekspor.';
  end if;

  update cash_entries c
     set supplier = v_supplier,
         supplier_diisi_by = v_uid,
         supplier_diisi_at = now()
   where c.id = any(p_entries)
     and c.entry_type = 'out'
     and c.dicoret_at is null
     and c.esb_exported_at is null
     -- Wewenangnya dipinjam dari penjaga koreksi kas yang sudah ada (0141):
     -- pemegang kasnya sendiri, admin BU-nya, atau super admin. Satu aturan
     -- wewenang untuk kas, bukan dua yang perlahan menyimpang.
     and boleh_koreksi_kas(c.holder_id);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function ubah_supplier_kas(uuid[], text) from public;
grant execute on function ubah_supplier_kas(uuid[], text) to authenticated;

comment on function ubah_supplier_kas(uuid[], text) is
  'Mengisi Payment To banyak kas keluar sekaligus. Melewati yang sudah diekspor, yang dicoret, dan yang bukan kas keluar.';

-- ---------------------------------------------------------
-- (6) Tandai yang BENAR-BENAR ikut terunduh.
--
-- Dipanggil SESUDAH berkasnya jadi, bukan sebelum — sama seperti nota (0127),
-- kiriman (0128), dan waste (0146).
-- ---------------------------------------------------------
create or replace function tandai_kas_esb(p_entries uuid[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_n int;
begin
  if p_entries is null or array_length(p_entries, 1) is null then
    return 0;
  end if;

  update cash_entries c
     set esb_exported_at = now(),
         esb_exported_by = v_uid
   where c.id = any(p_entries)
     and c.esb_exported_at is null
     and c.entry_type = 'out'
     and is_bu_admin(v_uid, c.business_unit_id);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function tandai_kas_esb(uuid[]) from public;
grant execute on function tandai_kas_esb(uuid[]) to authenticated;

-- ---------------------------------------------------------
-- (7) Batalkan tandanya — dengan alasan, sama seperti 0143.
-- ---------------------------------------------------------
create or replace function batalkan_tanda_kas_esb(p_entries uuid[], p_alasan text)
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
  if p_entries is null or array_length(p_entries, 1) is null then
    return 0;
  end if;

  update cash_entries c
     set esb_exported_at = null,
         esb_exported_by = null,
         esb_dibatalkan_at = now(),
         esb_dibatalkan_by = v_uid,
         esb_alasan_batal = v_alasan
   where c.id = any(p_entries)
     -- Yang TIDAK bertanda dilewati, bukan ditulisi jejak pembatalan yang
     -- tidak pernah terjadi.
     and c.esb_exported_at is not null
     and is_bu_admin(v_uid, c.business_unit_id);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function batalkan_tanda_kas_esb(uuid[], text) from public;
grant execute on function batalkan_tanda_kas_esb(uuid[], text) to authenticated;

comment on function batalkan_tanda_kas_esb(uuid[], text) is
  'Membuka tanda ekspor ESB beberapa kas keluar. Menuntut alasan dan mencatat pelakunya. TIDAK menghapus dokumennya di ESB.';

-- ---------------------------------------------------------
-- (8) `riwayat_kas_saya` ikut mengembalikan Supplier.
--
-- ============ KENAPA INI WAJIB, BUKAN KERAPIAN ============
--
-- Dialog koreksi kas mengisi kotaknya dari baris riwayat: `value: e.supplier`.
-- Kalau RPC-nya tidak mengembalikan kolom itu, `e.supplier` selalu `undefined`
-- — kotaknya tampil KOSONG untuk entri yang suppliernya sudah terisi, dan
-- menekan "Simpan perubahan" MENGHAPUSNYA.
--
-- Kegagalannya diam total: yang mengoreksi nominal sebuah entri tidak punya
-- alasan menduga ia baru saja membuang Payment To-nya, dan entri itu lalu
-- tertahan saat diekspor dengan alasan yang terlihat datang entah dari mana.
--
-- Kolomnya ditambahkan DI UJUNG daftar `returns table`. Menyisipkannya di
-- tengah menggeser seluruh kolom sesudahnya, dan PostgREST mengembalikannya
-- sebagai objek bernama — jadi yang bergeser bukan namanya melainkan isinya.
-- ---------------------------------------------------------
drop function if exists riwayat_kas_saya(int);

create or replace function riwayat_kas_saya(p_limit int default 50)
returns table (
  id uuid,
  entry_date date,
  entry_type text,
  amount numeric,
  notes text,
  qty numeric,
  unit text,
  proof_path text,
  created_at timestamptz,
  category_id uuid,
  category_name text,
  account_id uuid,
  account_name text,
  outlet_id uuid,
  outlet_name text,
  counterpart_name text,
  penyesuaian_nota uuid,
  dicoret_at timestamptz,
  dicoret_oleh text,
  alasan_coret text,
  diubah_at timestamptz,
  diubah_oleh text,
  alasan_tolak text,
  supplier text,
  esb_exported_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select
    ce.id,
    ce.entry_date,
    ce.entry_type,
    ce.amount,
    ce.notes,
    ce.qty,
    ce.unit,
    ce.proof_path,
    ce.created_at,
    ce.category_id,
    cc.name,
    ce.account_id,
    coalesce(ca.name, 'Kas Utama'),
    ce.outlet_id,
    o.name,
    cp.full_name,
    ce.penyesuaian_nota,
    ce.dicoret_at,
    dc.full_name,
    ce.alasan_coret,
    ce.diubah_at,
    db.full_name,
    alasan_tolak_koreksi_kas(ce.id),
    ce.supplier,
    ce.esb_exported_at
  from cash_entries ce
  left join cash_categories cc on cc.id = ce.category_id
  left join cash_accounts ca on ca.id = ce.account_id
  left join outlets o on o.id = ce.outlet_id
  left join user_profiles cp on cp.id = ce.counterpart_id
  left join user_profiles dc on dc.id = ce.dicoret_by
  left join user_profiles db on db.id = ce.diubah_by
  where ce.holder_id = auth.uid()
  order by ce.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 500));
$$;

revoke all on function riwayat_kas_saya(int) from public;
grant execute on function riwayat_kas_saya(int) to authenticated;

comment on function riwayat_kas_saya(int) is
  'Riwayat kas milik pemanggil, dengan nama outlet PERUNTUKAN diselesaikan di server (0141) dan Supplier untuk ekspor Disbursement (0149).';

notify pgrst, 'reload schema';
