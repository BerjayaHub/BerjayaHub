-- =========================================================
-- Berjaya Hub OMS — 0125
-- Nota boleh dilunasi PUSAT, tanpa menyentuh kas mana pun.
--
-- =========================================================
-- YANG DIMINTA
-- =========================================================
--
--   "untuk jatuh tempo, bisakah, selain diambil dari kas outlet dia diambil
--    dari Pusat, jadi ini dibayar oleh pusat tanpa berpengaruh ke kas manapun"
--
-- Sampai sekarang melunasi nota SELALU membuat satu entri kas keluar. Untuk
-- tagihan yang dibayar kantor pusat lewat transfer bank, entri itu salah dua
-- kali: kas pemegang berkurang padahal uangnya tidak pernah ada di tangannya,
-- dan orang yang menghitung uang fisik di outlet menemukan selisih yang tidak
-- pernah terjadi.
--
-- =========================================================
-- KONSEKUENSI YANG HARUS DIKATAKAN, BUKAN DISEMBUNYIKAN
-- =========================================================
--
-- Pembayaran Pusat TIDAK MENINGGALKAN SATU BARIS PUN di `cash_entries`. Itu
-- memang yang diminta, dan akibatnya nyata: pertanyaan "berapa total uang
-- keluar untuk supplier bulan ini" berhenti bisa dijawab dari buku kas saja.
-- Jawabannya harus dibaca dari NOTA — dan karena itu `payment_source` disimpan,
-- bukan sekadar dibiarkan sebagai "lunas tanpa entri kas".
--
-- Tanpa kolom itu, nota yang dibayar pusat tidak bisa dibedakan dari nota
-- bertotal nol yang juga lunas tanpa entri kas (barang sampel/bonus). Dua hal
-- yang sangat berbeda, terlihat persis sama.
--
-- Alternatif yang TIDAK dipilih: membuat kantong "Kas Pusat". Bukunya jadi
-- konsisten, tapi saldonya akan minus terus-menerus dan ada orang yang harus
-- merekonsiliasinya tiap bulan — pekerjaan baru yang tidak diminta siapa pun.
--
-- =========================================================
-- DUA TANDA TANGAN, SATU ISI
-- =========================================================
--
-- `bayar_nota` yang lama (4 argumen) DIPERTAHANKAN sebagai pembungkus tipis
-- yang memanggil versi 5 argumen dengan sumber 'kas'.
--
-- Bukan demi kerapian: PostgREST memilih fungsi berdasarkan HIMPUNAN NAMA
-- argumen yang dikirim, dan PWA di HP staff masih mengirim empat. Menghapus
-- yang lama membuat tombol Bayar mereka menjawab 42883 sampai aplikasinya
-- memperbarui diri. Isinya tetap satu, jadi tidak ada dua perilaku yang bisa
-- menyimpang diam-diam.
-- =========================================================

alter table goods_receipts add column if not exists payment_source text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'goods_receipts_sumber_bayar') then
    alter table goods_receipts add constraint goods_receipts_sumber_bayar
      check (payment_source is null or payment_source in ('kas', 'pusat'));
  end if;
end $$;

comment on column goods_receipts.payment_source is
  'Siapa yang melunasi: kas = kantong kas di sistem ini (ada entri kasnya), pusat = dibayar kantor pusat di luar sistem (TIDAK ada entri kas). NULL = belum lunas, atau nota lama sebelum 0125.';

-- Nota yang sudah lunas sebelum 0125 pasti dibayar lewat kas — itu satu-satunya
-- jalan yang pernah ada. Diisi supaya laporan tidak perlu menebak.
update goods_receipts
   set payment_source = 'kas'
 where payment_status = 'lunas' and payment_source is null and payment_entry_id is not null;

-- ---------------------------------------------------------
-- BAYAR NOTA — dengan sumber pembayaran.
-- ---------------------------------------------------------
create or replace function bayar_nota(
  p_notas uuid[],
  p_account uuid,
  p_date date,
  p_notes text,
  p_sumber text
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
  v_sumber text := coalesce(nullif(p_sumber, ''), 'kas');
begin
  if v_sumber not in ('kas', 'pusat') then
    raise exception 'Sumber pembayaran hanya boleh kas atau pusat.';
  end if;
  if p_notas is null or array_length(p_notas, 1) is null then
    raise exception 'Tidak ada nota yang dipilih.';
  end if;

  select count(*) into v_belum
    from goods_receipts g
   where g.id = any(p_notas)
     and g.payment_status = 'belum'
     and has_outlet_scope(v_uid, g.outlet_id);
  if v_belum <> array_length(p_notas, 1) then
    raise exception 'Ada nota yang tidak ditemukan, bukan wewenangmu, atau sudah lunas. Muat ulang daftarnya.';
  end if;

  -- HARGANYA TETAP HARUS LENGKAP, termasuk untuk pembayaran Pusat.
  --
  -- Di sini alasannya berbeda dari jalur kas. Untuk kas, harga yang bolong
  -- membuat nominal yang keluar salah. Untuk pusat tidak ada nominal yang
  -- keluar sama sekali — tapi menandai lunas menghapus notanya dari daftar
  -- hutang, dan biayanya jadi tidak pernah tercatat oleh siapa pun. Hutangnya
  -- hilang dari layar tanpa pernah jadi angka.
  select count(*) into v_tanpa_harga
    from goods_receipt_items i
   where i.receipt_id = any(p_notas) and i.unit_cost is null and i.line_total is null;
  if v_tanpa_harga > 0 then
    raise exception 'Masih ada % baris tanpa harga. Lengkapi harganya dulu lewat Edit nota.', v_tanpa_harga;
  end if;

  -- Batas satu outlet HANYA berlaku untuk pembayaran kas.
  --
  -- Alasannya memang cuma satu: `cash_entries.outlet_id` hanya punya satu
  -- nilai, jadi membayar dua outlet sekaligus akan mencatat separuh biayanya
  -- atas nama outlet yang tidak pernah menerima barangnya. Pembayaran Pusat
  -- tidak membuat entri kas, jadi tidak ada kolom yang harus dipaksa memilih —
  -- dan pusat memang biasanya melunasi satu supplier untuk semua outlet
  -- sekaligus.
  if v_sumber = 'kas' then
    select count(distinct outlet_id) into v_outlet_lain from goods_receipts where id = any(p_notas);
    if v_outlet_lain > 1 then
      raise exception 'Nota yang dipilih berasal dari % outlet berbeda. Bayar per outlet, supaya biayanya tercatat atas nama outlet yang benar.', v_outlet_lain;
    end if;
  end if;

  select outlet_id, business_unit_id into v_outlet, v_bu
    from goods_receipts where id = any(p_notas) limit 1;

  select coalesce(sum(coalesce(i.line_total, i.qty * i.unit_cost)), 0) into v_total
    from goods_receipt_items i where i.receipt_id = any(p_notas);

  if v_total < 0 then
    raise exception 'Total nota bernilai negatif. Periksa harga dan jumlahnya.';
  end if;

  -- Entri kas hanya lahir untuk sumber 'kas' dan total di atas nol.
  if v_sumber = 'kas' and v_total > 0 then
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
         payment_entry_id = v_entry,
         payment_source = v_sumber
   where id = any(p_notas);

  return v_entry;
end;
$$;

revoke all on function bayar_nota(uuid[], uuid, date, text, text) from public;
grant execute on function bayar_nota(uuid[], uuid, date, text, text) to authenticated;

comment on function bayar_nota(uuid[], uuid, date, text, text) is
  'Melunasi beberapa nota sekaligus. Sumber kas = satu entri kas keluar, satu outlet saja. Sumber pusat = tanpa entri kas, boleh lintas outlet.';

-- ---------------------------------------------------------
-- PEMBUNGKUS 4 ARGUMEN — untuk PWA lama di HP staff.
--
-- Isinya satu baris supaya tidak ada dua perilaku yang bisa menyimpang.
-- ---------------------------------------------------------
create or replace function bayar_nota(
  p_notas uuid[],
  p_account uuid,
  p_date date,
  p_notes text
) returns uuid
language sql
security definer
set search_path = public
as $$
  select bayar_nota(p_notas, p_account, p_date, p_notes, 'kas');
$$;

revoke all on function bayar_nota(uuid[], uuid, date, text) from public;
grant execute on function bayar_nota(uuid[], uuid, date, text) to authenticated;

comment on function bayar_nota(uuid[], uuid, date, text) is
  'Bentuk lama untuk PWA yang belum memperbarui diri. Meneruskan ke versi 5 argumen dengan sumber kas.';

-- ---------------------------------------------------------
-- BATALKAN PEMBAYARAN — pusat tidak punya entri untuk dibalik.
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

  -- Tidak ada entri kas: nota bertotal 0, atau dibayar PUSAT. Keduanya cukup
  -- dikembalikan statusnya — tidak ada uang yang perlu dibalik, karena tidak
  -- ada uang yang pernah tercatat keluar.
  --
  -- Dan hanya nota INI yang dikembalikan. Pembayaran pusat tidak punya entri
  -- yang mengikat beberapa nota jadi satu, jadi tidak ada "seluruh pembayaran"
  -- yang bisa ikut terbawa — membatalkannya satu per satu justru yang benar.
  if v_entry is null then
    update goods_receipts
       set payment_status = 'belum', paid_at = null, paid_by = null,
           payment_entry_id = null, payment_source = null
     where id = p_nota;
    return 1;
  end if;

  select * into v_asli from cash_entries where id = v_entry;
  select count(*) into v_jml from goods_receipts where payment_entry_id = v_entry;

  -- Entri baliknya 'in' dan TIDAK ber-`untuk_nota`: setelah pembatalan tidak
  -- akan ada nota yang menunjuknya, dan pemeriksa yang ditunda sampai commit
  -- akan menolaknya dengan benar.
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
     set payment_status = 'belum', paid_at = null, paid_by = null,
         payment_entry_id = null, payment_source = null
   where payment_entry_id = v_entry;

  return v_jml;
end;
$$;

revoke all on function batalkan_pembayaran_nota(uuid) from public;
grant execute on function batalkan_pembayaran_nota(uuid) to authenticated;

-- ---------------------------------------------------------
-- Sumbernya ikut terlihat, supaya layar bisa membedakan "lunas (pusat)" dari
-- "lunas" biasa — dan supaya laporan bisa menjumlahkan yang dibayar pusat
-- tanpa mengaduknya dengan yang keluar dari kas.
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
         g.payment_source,
         g.due_date,
         g.paid_at,
         g.payment_entry_id,
         g.harga_digeser_at,
         coalesce(sum(coalesce(i.line_total, i.qty * i.unit_cost)), 0) as total,
         coalesce(sum(i.unit_cost) filter (where i.unit_cost is not null), 0) as total_jika_digeser,
         count(i.id) filter (where i.unit_cost is null and i.line_total is null) as baris_tanpa_harga,
         count(i.id) filter (where i.unit_cost is not null) as baris_berharga,
         count(i.id) as baris
    from goods_receipts g
    left join goods_receipt_items i on i.receipt_id = g.id
   group by g.id;

comment on view nota_ringkas is
  'Nota + totalnya + status & SUMBER pembayarannya + berapa barisnya yang belum berharga.';

notify pgrst, 'reload schema';
