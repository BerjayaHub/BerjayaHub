-- =========================================================
-- Berjaya Hub OMS — 0122
-- Nota punya STATUS BAYAR, dan hutang supplier bisa dilihat & dilunasi.
--
-- =========================================================
-- KENAPA INI ADA
-- =========================================================
--
--   "benar, jadi ada pembelian yang mengurangi kas dan tidak mengurangi
--    karena jatuh tempo"
--
-- Sejak 0118 nota membawa harga, dan sejak 0120–0121 kas outlet bisa dibebani
-- staff yang menginputnya. Yang belum ada: pembedaan antara barang yang SUDAH
-- dibayar dan barang yang baru diterima.
--
-- Tanpa pembedaan itu hanya ada dua pilihan, dan keduanya salah:
--   - semua nota mengurangi kas -> kas terlihat habis padahal uangnya masih ada,
--     dan hutangnya tidak tercatat di mana pun;
--   - tidak ada nota yang mengurangi kas -> kas terlihat utuh padahal uangnya
--     sudah keluar.
--
-- =========================================================
-- BIAYA IKUT TANGGAL NOTA, KAS IKUT TANGGAL BAYAR
-- =========================================================
--
-- Barang datang Agustus, dibayar September. Dua angka yang benar sekaligus:
-- HPP dan biaya rata-rata bahan tetap memakai `receipt_date` (Agustus, saat
-- barangnya masuk dan dipakai), sementara kas berkurang di `entry_date`
-- (September, saat uangnya benar-benar keluar).
--
-- Ini BUKAN ketidakcocokan yang perlu diperbaiki; ini memang bentuk yang
-- benar. Yang wajib ada adalah penjelasannya di layar — kalau tidak, orang
-- akan mencari selisih Agustus–September itu setiap bulan dan mengira ada yang
-- rusak.
--
-- =========================================================
-- SATU ENTRI KAS PER PEMBAYARAN, BUKAN PER NOTA
-- =========================================================
--
-- Bayar 7 nota sekaligus ke satu supplier = SATU entri kas. Kalau tiap nota
-- membuat entrinya sendiri, buku kas dipenuhi baris yang tidak pernah ada
-- padanannya di dunia nyata: yang benar-benar terjadi adalah satu amplop
-- berpindah tangan satu kali.
--
-- Konsekuensinya pembatalan juga per PEMBAYARAN, bukan per nota — dan itu
-- ditegakkan di bawah, bukan diserahkan ke layar.
-- =========================================================

-- ---------------------------------------------------------
-- (1) Kolom status bayar pada nota.
-- ---------------------------------------------------------
alter table goods_receipts add column if not exists payment_status text not null default 'belum';
alter table goods_receipts add column if not exists due_date date;
alter table goods_receipts add column if not exists paid_at timestamptz;
alter table goods_receipts add column if not exists paid_by uuid references user_profiles(id) on delete set null;
alter table goods_receipts add column if not exists payment_entry_id uuid references cash_entries(id) on delete restrict;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'goods_receipts_status_bayar') then
    alter table goods_receipts add constraint goods_receipts_status_bayar
      check (payment_status in ('lunas', 'belum'));
  end if;
end $$;

create index if not exists idx_gr_belum_bayar on goods_receipts(business_unit_id, due_date)
  where payment_status = 'belum';

comment on column goods_receipts.payment_status is
  'belum = hutang supplier, lunas = sudah dibayar. Default belum: nota lama sebelum 0122 dianggap belum dibayar sampai ada yang menandainya, karena menebak "lunas" akan menyembunyikan hutang yang nyata.';
comment on column goods_receipts.due_date is
  'Jatuh tempo untuk nota tempo. Kosong = tidak diberi tenggat (bukan berarti lunas).';
comment on column goods_receipts.payment_entry_id is
  'Entri kas yang membayar nota ini. Beberapa nota boleh menunjuk entri yang SAMA — itulah pembayaran gabungan.';

-- ---------------------------------------------------------
-- (2) Kas keluar untuk membayar nota: buktinya adalah NOTANYA.
--
-- Batasan `cash_entries_nota_wajib` (0060, dipertegas 0063) mewajibkan
-- `proof_path` pada setiap entri 'out'. Untuk belanja dadakan itu benar —
-- tidak ada catatan lain yang bisa dipakai.
--
-- Untuk pembayaran nota, catatannya justru jauh lebih kuat daripada foto:
-- ada kode nota, supplier, tanggal, dan seluruh barisnya lengkap dengan harga.
-- Sementara `goods_receipts.photo_path` sendiri boleh kosong, jadi tanpa
-- pelonggaran ini nota tanpa foto tidak akan pernah bisa dibayar sama sekali.
--
-- Yang dibuka SEMPIT: hanya entri yang benar-benar dituju oleh sebuah nota.
-- Dijaga dua lapis — batasan kolom di bawah, dan CONSTRAINT TRIGGER yang
-- ditunda sampai commit untuk memastikan flag-nya tidak dipakai tanpa nota.
-- ---------------------------------------------------------
alter table cash_entries add column if not exists untuk_nota boolean not null default false;

comment on column cash_entries.untuk_nota is
  'Entri ini membayar nota penerimaan barang. Menggantikan kewajiban foto bukti, karena notanya sendiri yang jadi bukti. Diverifikasi saat commit: harus ada nota yang menunjuk entri ini.';

alter table cash_entries drop constraint if exists cash_entries_nota_wajib;
alter table cash_entries add constraint cash_entries_nota_wajib
  check (entry_type <> 'out' or proof_path is not null or untuk_nota);

-- Verifikasi DITUNDA SAMPAI COMMIT.
--
-- Tanpa ini `untuk_nota` cuma sebuah boolean yang bisa dikirim siapa saja dari
-- klien untuk melewati kewajiban foto. Diperiksa saat insert pun tidak bisa:
-- notanya baru menunjuk entri ini beberapa pernyataan kemudian, di dalam
-- transaksi yang sama. `deferrable initially deferred` membuatnya diperiksa
-- persis pada saat seluruh transaksinya sudah lengkap.
create or replace function cek_untuk_nota_punya_nota()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (select 1 from goods_receipts where payment_entry_id = new.id) then
    raise exception 'Entri kas ditandai pembayaran nota, tetapi tidak ada nota yang menunjuknya. Pakai bayar_nota().';
  end if;
  return null;
end;
$$;

drop trigger if exists trg_untuk_nota_punya_nota on cash_entries;
create constraint trigger trg_untuk_nota_punya_nota
  after insert or update on cash_entries
  deferrable initially deferred
  for each row
  when (new.untuk_nota)
  execute function cek_untuk_nota_punya_nota();

-- ---------------------------------------------------------
-- (3) Nota yang sudah LUNAS tidak boleh berubah nilainya.
--
-- Dijaga TRIGGER, bukan dengan menulis ulang `ubah_nota_terima`. Fungsi itu
-- sudah ditulis ulang tiga kali (0084 -> 0118 -> 0119) dan tiap penulisan
-- ulang berisiko menghilangkan penjagaan versi sebelumnya diam-diam. Trigger
-- juga menutup jalur tabel langsung, yang tidak akan pernah tertutup oleh
-- perubahan di dalam satu fungsi.
--
-- Yang dikunci hanya NILAINYA — jumlah, harga, dan barisnya. Kepala nota
-- (foto, catatan) tetap boleh diperbaiki: menambahkan foto ke nota yang sudah
-- dibayar tidak mengubah satu angka pun, dan melarangnya cuma membuat orang
-- membatalkan pembayaran demi hal yang tidak berbahaya.
-- ---------------------------------------------------------
create or replace function tolak_ubah_nota_lunas()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_id uuid := coalesce(new.receipt_id, old.receipt_id);
  v_status text;
  v_code text;
begin
  select payment_status, code into v_status, v_code from goods_receipts where id = v_id;
  if v_status = 'lunas' then
    raise exception 'Nota % sudah dibayar, isinya tidak bisa diubah. Batalkan pembayarannya dulu.', coalesce(v_code, '');
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_tolak_ubah_nota_lunas on goods_receipt_items;
create trigger trg_tolak_ubah_nota_lunas
  before insert or update or delete on goods_receipt_items
  for each row execute function tolak_ubah_nota_lunas();

-- ---------------------------------------------------------
-- (4) Ringkasan nota: total, jumlah baris tanpa harga, status.
--
-- `security_invoker` supaya RLS `gr_select` tetap berlaku — tanpa itu view ini
-- membocorkan nota seluruh organisasi ke siapa pun yang bisa membacanya.
--
-- `baris_tanpa_harga` dihitung di sini, bukan di klien: ia yang menentukan
-- boleh-tidaknya sebuah nota dibayar, dan aturan yang dihitung dua kali di dua
-- tempat cepat atau lambat menyimpang.
-- ---------------------------------------------------------
drop view if exists nota_ringkas;
create view nota_ringkas with (security_invoker = true) as
  select g.id,
         g.business_unit_id,
         g.outlet_id,
         g.code,
         g.receipt_date,
         g.supplier,
         g.invoice_no,
         g.payment_status,
         g.due_date,
         g.paid_at,
         g.payment_entry_id,
         coalesce(sum(i.qty * i.unit_cost), 0) as total,
         count(i.id) filter (where i.unit_cost is null) as baris_tanpa_harga,
         count(i.id) as baris
    from goods_receipts g
    left join goods_receipt_items i on i.receipt_id = g.id
   group by g.id;

comment on view nota_ringkas is
  'Nota + totalnya + berapa barisnya yang belum berharga. Dipakai riwayat nota dan tab Hutang Supplier.';

-- ---------------------------------------------------------
-- (5) BAYAR NOTA — satu entri kas untuk beberapa nota sekaligus.
-- ---------------------------------------------------------
create or replace function bayar_nota(
  p_notas uuid[],
  p_account uuid,
  p_date date,
  p_notes text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_holder uuid;
  v_outlet uuid;
  v_bu uuid;
  v_total numeric := 0;
  v_belum int;
  v_tanpa_harga int;
  v_outlet_lain int;
  v_entry uuid;
  v_kode text;
begin
  if p_notas is null or array_length(p_notas, 1) is null then
    raise exception 'Tidak ada nota yang dipilih.';
  end if;

  -- Semua nota harus ADA, milik outlet yang boleh ditulis orang ini, dan
  -- belum lunas. Diperiksa sebagai satu himpunan: kalau satu saja gagal,
  -- TIDAK ADA yang dibayar. Pembayaran sebagian yang diam-diam berhasil jauh
  -- lebih sulit ditelusuri daripada penolakan yang jelas.
  select count(*) into v_belum
    from goods_receipts g
   where g.id = any(p_notas)
     and g.payment_status = 'belum'
     and has_outlet_scope(v_uid, g.outlet_id);
  if v_belum <> array_length(p_notas, 1) then
    raise exception 'Ada nota yang tidak ditemukan, bukan wewenangmu, atau sudah lunas. Muat ulang daftarnya.';
  end if;

  -- HARGANYA HARUS LENGKAP.
  --
  -- Harga 0 SAH (barang sampel, bonus); yang ditolak adalah harga yang belum
  -- diisi. Membayar nota yang barisnya belum berharga akan mengurangi kas
  -- sebesar angka yang kebetulan sudah terisi saja — dan selisihnya tidak
  -- akan pernah muncul sebagai error, cuma sebagai kas yang tidak cocok.
  select count(*) into v_tanpa_harga
    from goods_receipt_items i
   where i.receipt_id = any(p_notas) and i.unit_cost is null;
  if v_tanpa_harga > 0 then
    raise exception 'Masih ada % baris tanpa harga. Lengkapi harganya dulu lewat Edit nota.', v_tanpa_harga;
  end if;

  -- SATU OUTLET SAJA per pembayaran.
  --
  -- `cash_entries.outlet_id` adalah outlet PERUNTUKAN, dan satu entri hanya
  -- punya satu. Membayar nota dua outlet sekaligus memaksa memilih salah
  -- satunya — lalu separuh biayanya tercatat atas nama outlet yang tidak
  -- pernah menerima barangnya. Lebih baik dua pembayaran yang benar.
  select count(distinct outlet_id) into v_outlet_lain from goods_receipts where id = any(p_notas);
  if v_outlet_lain > 1 then
    raise exception 'Nota yang dipilih berasal dari % outlet berbeda. Bayar per outlet, supaya biayanya tercatat atas nama outlet yang benar.', v_outlet_lain;
  end if;

  select outlet_id, business_unit_id into v_outlet, v_bu
    from goods_receipts where id = any(p_notas) limit 1;

  select coalesce(sum(i.qty * i.unit_cost), 0) into v_total
    from goods_receipt_items i where i.receipt_id = any(p_notas);

  if v_total < 0 then
    raise exception 'Total nota bernilai negatif. Periksa harga dan jumlahnya.';
  end if;

  -- Total 0 -> DITANDAI LUNAS TANPA ENTRI KAS.
  --
  -- Nota bonus/sampel memang tidak memindahkan uang. Memaksa entri kas Rp0
  -- akan mengisi buku kas dengan baris yang tidak pernah terjadi, dan
  -- `catat_kas_di` sendiri menolak nominal <= 0.
  if v_total > 0 then
    if not boleh_membebani_kas(v_uid, p_account) then
      raise exception 'Kamu tidak berhak mencatat pada kantong kas ini.';
    end if;
    select holder_id into v_holder from cash_accounts where id = p_account;
    if v_holder is null then
      raise exception 'Kantong kas tidak ditemukan.';
    end if;

    select string_agg(code, ', ' order by code) into v_kode
      from goods_receipts where id = any(p_notas);

    insert into cash_entries (
      business_unit_id, outlet_id, holder_id, account_id, entry_type, amount,
      notes, entry_date, created_by, untuk_nota
    ) values (
      v_bu, v_outlet, v_holder, p_account, 'out', -v_total,
      coalesce(nullif(p_notes, ''), 'Pembayaran nota ' || v_kode),
      coalesce(p_date, (now() at time zone 'Asia/Jakarta')::date),
      v_uid, true
    )
    returning id into v_entry;
  end if;

  update goods_receipts
     set payment_status = 'lunas',
         paid_at = now(),
         paid_by = v_uid,
         payment_entry_id = v_entry
   where id = any(p_notas);

  return v_entry;
end;
$$;

revoke all on function bayar_nota(uuid[], uuid, date, text) from public;
grant execute on function bayar_nota(uuid[], uuid, date, text) to authenticated;

comment on function bayar_nota(uuid[], uuid, date, text) is
  'Melunasi beberapa nota sekaligus dengan SATU entri kas. Semua nota harus belum lunas, berharga lengkap, dan dari satu outlet. Total 0 ditandai lunas tanpa entri kas.';

-- ---------------------------------------------------------
-- (6) BATALKAN PEMBAYARAN — dengan entri BALIK, bukan penghapusan.
--
-- Menghapus entri kas yang salah akan membuat saldo hari ini benar sementara
-- laporan yang sudah dicetak kemarin tidak akan pernah bisa dijelaskan lagi.
-- Entri balik meninggalkan kedua kejadiannya di buku: uang keluar, lalu uang
-- kembali.
--
-- Pembatalan berlaku untuk SELURUH pembayaran, bukan satu nota di dalamnya.
-- Membatalkan satu nota dari pembayaran gabungan akan meninggalkan entri kas
-- yang nominalnya tidak lagi sama dengan nota-nota yang menunjuknya — angka
-- yang tidak salah di baris mana pun, tapi tidak cocok kalau dijumlahkan.
-- ---------------------------------------------------------
create or replace function batalkan_pembayaran_nota(p_nota uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_entry uuid;
  v_status text;
  v_outlet uuid;
  v_jml int;
  v_asli cash_entries%rowtype;
begin
  select payment_status, payment_entry_id, outlet_id
    into v_status, v_entry, v_outlet
    from goods_receipts where id = p_nota;

  if v_status is null then
    raise exception 'Nota tidak ditemukan.';
  end if;
  if not has_outlet_scope(v_uid, v_outlet) then
    raise exception 'Nota ini bukan wewenangmu.';
  end if;
  if v_status <> 'lunas' then
    raise exception 'Nota ini memang belum ditandai lunas.';
  end if;

  if v_entry is null then
    -- Nota bertotal 0: lunas tanpa entri kas, jadi tidak ada yang dibalik.
    update goods_receipts
       set payment_status = 'belum', paid_at = null, paid_by = null, payment_entry_id = null
     where id = p_nota;
    return 1;
  end if;

  select * into v_asli from cash_entries where id = v_entry;
  select count(*) into v_jml from goods_receipts where payment_entry_id = v_entry;

  -- Entri baliknya 'in' dan TIDAK ber-`untuk_nota`: setelah pembatalan tidak
  -- akan ada satu pun nota yang menunjuknya, dan pemeriksa yang ditunda itu
  -- akan menolaknya dengan benar. Kewajiban foto memang hanya berlaku untuk
  -- kas KELUAR, jadi tidak ada yang perlu dilonggarkan di sini.
  insert into cash_entries (
    business_unit_id, outlet_id, holder_id, account_id, entry_type, amount,
    notes, entry_date, created_by, untuk_nota
  ) values (
    v_asli.business_unit_id, v_asli.outlet_id, v_asli.holder_id, v_asli.account_id,
    'in', abs(v_asli.amount),
    'Pembatalan: ' || coalesce(v_asli.notes, 'pembayaran nota'),
    (now() at time zone 'Asia/Jakarta')::date,
    v_uid, false
  );

  update goods_receipts
     set payment_status = 'belum', paid_at = null, paid_by = null, payment_entry_id = null
   where payment_entry_id = v_entry;

  return v_jml;
end;
$$;

revoke all on function batalkan_pembayaran_nota(uuid) from public;
grant execute on function batalkan_pembayaran_nota(uuid) to authenticated;

comment on function batalkan_pembayaran_nota(uuid) is
  'Membatalkan SELURUH pembayaran yang memuat nota ini (bisa lebih dari satu nota) dengan entri kas BALIK. Entri aslinya tidak dihapus. Mengembalikan jumlah nota yang ikut dibatalkan.';

-- ---------------------------------------------------------
-- (7) Menandai TEMPO / jatuh tempo pada nota yang belum lunas.
-- ---------------------------------------------------------
create or replace function set_jatuh_tempo_nota(p_nota uuid, p_due date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_outlet uuid;
begin
  select payment_status, outlet_id into v_status, v_outlet from goods_receipts where id = p_nota;
  if v_status is null then
    raise exception 'Nota tidak ditemukan.';
  end if;
  if not has_outlet_scope(auth.uid(), v_outlet) then
    raise exception 'Nota ini bukan wewenangmu.';
  end if;
  if v_status = 'lunas' then
    raise exception 'Nota ini sudah lunas, jatuh temponya tidak berlaku lagi.';
  end if;
  update goods_receipts set due_date = p_due where id = p_nota;
end;
$$;

revoke all on function set_jatuh_tempo_nota(uuid, date) from public;
grant execute on function set_jatuh_tempo_nota(uuid, date) to authenticated;

notify pgrst, 'reload schema';
