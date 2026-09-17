-- ============================================================
-- 0143 — MEMBATALKAN TANDA EKSPOR ESB: ada jalannya, dan ada jejaknya.
--
-- ============ APA YANG SEBENARNYA HILANG ============
--
-- Staff mencoba memperbaiki nota terima dan ditolak dengan pesan:
--
--     "Nota TRM-xxx sudah diekspor ke ESB. Batalkan tanda ekspornya dulu."
--
-- Lalu tidak ada satu pun tombol di aplikasi ini yang membatalkan tanda itu.
--
-- Fungsinya sendiri ADA sejak 0127, dan komentar di sana berbunyi:
--
--     "Tanpa ini, berkas yang ditolak ESB meninggalkan notanya tertandai
--      selamanya dan satu-satunya jalan keluarnya lewat SQL Editor.
--      Itu bukan jalan keluar; itu ketiadaan jalan keluar."
--
-- Layarnya tidak pernah dibuat, jadi jalan keluarnya memang tetap SQL Editor.
-- Fungsi yang ada tanpa layar yang memanggilnya sama saja dengan fungsi yang
-- tidak ada — bedanya cuma, yang pertama membuat audit terlihat hijau.
--
-- ============ KENAPA INI BUKAN SEKADAR MENAMBAH TOMBOL ============
--
-- Membatalkan tanda di Berjaya Hub TIDAK menghapus dokumennya di ESB.
--
-- Kalau notanya benar-benar sudah masuk ESB (bukan ditolak), lalu tandanya
-- dibatalkan, isinya diperbaiki, dan berkasnya diunggah ulang — ESB akan punya
-- DUA pembelian untuk barang yang sama. Keduanya terlihat wajar. Selisihnya
-- baru muncul berminggu-minggu kemudian sebagai stok yang tidak cocok, dan
-- pada saat itu tidak ada yang ingat tanda mana yang pernah dibuka.
--
-- Maka pembatalannya MENUNTUT ALASAN dan MENINGGALKAN JEJAK. Alasannya bukan
-- birokrasi: ia yang membedakan "berkasnya ditolak ESB, belum masuk" dari
-- "sudah masuk ESB, saya hapus manual di sana" — dan itu satu-satunya
-- keterangan yang akan tersedia saat selisihnya ditelusuri nanti.
--
-- ============ TANDA TANGAN LAMANYA DIBUANG, BUKAN DIBIARKAN ============
--
-- `batalkan_tanda_esb(p_notas)` yang berparameter satu DIHAPUS di sini.
--
-- Kalau ia dibiarkan hidup berdampingan dengan yang dua parameter, PostgREST
-- memilih di antara keduanya berdasarkan HIMPUNAN NAMA ARGUMEN yang dikirim.
-- Satu pemanggilan yang `p_alasan`-nya `undefined` — dan `JSON.stringify`
-- membuang kunci `undefined` diam-diam — akan jatuh ke tanda tangan lama:
-- berhasil, mengembalikan angka, tanpa alasan dan tanpa jejak. Persis bentuk
-- kegagalan yang seluruh migration ini ada untuk mencegahnya.
-- ============================================================

-- ---------------------------------------------------------
-- (1) Jejaknya.
--
-- Kolomnya TIDAK dikosongkan saat notanya diekspor ulang: ia catatan sejarah
-- "tanda ini pernah dibuka oleh siapa, kapan, kenapa". Yang menentukan sebuah
-- nota sedang bertanda atau tidak tetap `esb_exported_at` — satu-satunya.
--
-- Konsekuensinya: sebuah baris bisa punya `esb_exported_at` DAN
-- `esb_dibatalkan_at` sekaligus, artinya "pernah dibuka, lalu diekspor lagi".
-- Layar yang menampilkan jejaknya wajib membandingkan keduanya; kalau tidak, ia
-- akan melaporkan nota yang sehat sebagai nota yang tandanya sedang terbuka.
-- ---------------------------------------------------------
alter table goods_receipts add column if not exists esb_dibatalkan_at timestamptz;
alter table goods_receipts add column if not exists esb_dibatalkan_by uuid references user_profiles(id) on delete set null;
alter table goods_receipts add column if not exists esb_alasan_batal text;

alter table dispatches add column if not exists esb_dibatalkan_at timestamptz;
alter table dispatches add column if not exists esb_dibatalkan_by uuid references user_profiles(id) on delete set null;
alter table dispatches add column if not exists esb_alasan_batal text;

comment on column goods_receipts.esb_dibatalkan_at is
  'Kapan tanda ekspor ESB terakhir kali dibuka. TIDAK dikosongkan saat diekspor ulang — bandingkan dengan esb_exported_at untuk tahu mana yang terakhir.';
comment on column goods_receipts.esb_alasan_batal is
  'Kenapa tandanya dibuka. Inilah yang membedakan "ditolak ESB, belum masuk" dari "sudah masuk ESB, dihapus manual di sana".';

-- ---------------------------------------------------------
-- (2) Panjang alasan minimum, ditulis sekali.
--
-- Sepuluh huruf. Cukup pendek untuk "salah unggah", cukup panjang untuk
-- menolak "x" dan "-" — dua jawaban yang secara teknis mengisi kolomnya dan
-- secara praktis membuat jejaknya tidak berguna.
--
-- Angkanya juga ada di js/modules/inventory/batal-tanda-esb.js sebagai
-- PANJANG_ALASAN_MIN. Ditulis dua kali dengan sengaja: yang di layar supaya
-- orangnya tahu sebelum menekan tombol, yang di sini supaya aturannya tetap
-- berlaku walau layarnya dilewati.
-- ---------------------------------------------------------
create or replace function panjang_alasan_batal_esb()
returns int
language sql
immutable
as $$ select 10 $$;

create or replace function alasan_batal_esb_sah(p_alasan text)
returns text
language plpgsql
immutable
as $$
declare
  v text := btrim(coalesce(p_alasan, ''));
begin
  if length(v) < panjang_alasan_batal_esb() then
    raise exception 'Alasan membatalkan tanda ekspor wajib diisi, minimal % huruf. Tulis apakah berkasnya ditolak ESB, atau sudah masuk ESB dan akan kamu hapus manual di sana.',
      panjang_alasan_batal_esb();
  end if;
  return v;
end;
$$;

-- ---------------------------------------------------------
-- (3) Nota: batalkan tandanya, dengan alasan.
-- ---------------------------------------------------------
drop function if exists batalkan_tanda_esb(uuid[]);

create or replace function batalkan_tanda_esb(p_notas uuid[], p_alasan text)
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
  if p_notas is null or array_length(p_notas, 1) is null then
    return 0;
  end if;

  update goods_receipts g
     set esb_exported_at = null,
         esb_exported_by = null,
         esb_dibatalkan_at = now(),
         esb_dibatalkan_by = v_uid,
         esb_alasan_batal = v_alasan
   where g.id = any(p_notas)
     -- Yang TIDAK bertanda dilewati, bukan ditulisi jejak. Menulis jejak
     -- "dibatalkan" pada nota yang memang tidak pernah diekspor akan membuat
     -- penelusuran nanti menemukan pembatalan yang tidak pernah terjadi.
     and g.esb_exported_at is not null
     and is_bu_admin(v_uid, g.business_unit_id);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function batalkan_tanda_esb(uuid[], text) from public;
grant execute on function batalkan_tanda_esb(uuid[], text) to authenticated;

comment on function batalkan_tanda_esb(uuid[], text) is
  'Membuka tanda ekspor ESB sebuah nota supaya isinya bisa diperbaiki. Menuntut alasan dan mencatat pelakunya. TIDAK menghapus dokumennya di ESB.';

-- ---------------------------------------------------------
-- (4) Kiriman: aturan yang sama persis.
--
-- Dikerjakan sekalian, bukan menyusul. Masalahnya identik, fungsinya sudah ada
-- sejak 0128, dan layarnya satu — mengerjakannya belakangan berarti membongkar
-- layar yang sama dua kali.
-- ---------------------------------------------------------
drop function if exists batalkan_tanda_kiriman_esb(uuid[]);

create or replace function batalkan_tanda_kiriman_esb(p_kiriman uuid[], p_alasan text)
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
  if p_kiriman is null or array_length(p_kiriman, 1) is null then
    return 0;
  end if;

  update dispatches d
     set esb_exported_at = null,
         esb_exported_by = null,
         esb_dibatalkan_at = now(),
         esb_dibatalkan_by = v_uid,
         esb_alasan_batal = v_alasan
   where d.id = any(p_kiriman)
     and d.esb_exported_at is not null
     and is_bu_admin(v_uid, d.business_unit_id);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function batalkan_tanda_kiriman_esb(uuid[], text) from public;
grant execute on function batalkan_tanda_kiriman_esb(uuid[], text) to authenticated;

-- ---------------------------------------------------------
-- (5) Pesan penolakannya menyebut SIAPA yang bisa membukanya, dan DI MANA.
--
-- Pesan lamanya menyuruh "batalkan tanda ekspornya dulu" tanpa mengatakan
-- bahwa staff tidak bisa melakukannya sendiri. Jadi staff mencari tombol yang
-- memang tidak ada di aplikasinya, lalu menyimpulkan aplikasinya rusak. Itulah
-- keluhan yang melahirkan migration ini.
--
-- Pesannya kini tinggal di SATU fungsi, dan ketiga penjaga memanggilnya.
-- Sebelumnya kalimat yang sama ditulis tiga kali di 0131 — dan dua di antaranya
-- berbeda kata. Kalimat yang diulang akan menyimpang; pertanyaannya cuma kapan.
--
-- Ketiga fungsi di bawah disalin dari 0131 dengan SATU perubahan: barisnya
-- memanggil penjaga ini. Ditulis ulang di sini, bukan dengan menyunting 0131,
-- supaya migration yang sudah dijalankan tidak perlu dijalankan ulang.
-- ---------------------------------------------------------
create or replace function tolak_karena_terekspor_esb(p_code text)
returns void
language plpgsql
immutable
as $$
begin
  raise exception 'Nota % sudah diekspor ke ESB, jadi isinya terkunci. Minta admin BU membuka tandanya lewat Admin Portal -> Inventory -> Ekspor ESB -> "Batalkan tanda ekspor", lalu perbaiki dan unggah ulang berkasnya.',
    coalesce(p_code, '');
end;
$$;

comment on function tolak_karena_terekspor_esb(text) is
  'Satu-satunya tempat kalimat "nota terkunci karena sudah diekspor" ditulis. Dipanggil jaga_ubah_item_nota, koreksi_nota, dan batalkan_nota.';

create or replace function jaga_ubah_item_nota()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_id uuid := coalesce(new.receipt_id, old.receipt_id);
  v_status text;
  v_bayar text;
  v_esb timestamptz;
  v_code text;
begin
  select status, payment_status, esb_exported_at, code
    into v_status, v_bayar, v_esb, v_code
    from goods_receipts where id = v_id;

  if v_status = 'dibatalkan' then
    raise exception 'Nota % sudah dibatalkan, isinya tidak bisa diubah lagi.', coalesce(v_code, '');
  end if;

  if v_esb is not null then
    perform tolak_karena_terekspor_esb(v_code);
  end if;

  if v_bayar = 'lunas' and coalesce(current_setting('berjaya.koreksi_nota', true), '') <> 'on' then
    raise exception 'Nota % sudah dibayar. Pakai aksi Edit di layar nota — kasnya ikut disesuaikan otomatis.', coalesce(v_code, '');
  end if;

  return coalesce(new, old);
end;
$$;

-- Triggernya TIDAK dibuat ulang: `create or replace function` sudah cukup,
-- trigger menunjuk fungsinya berdasarkan nama. Membuat ulang triggernya justru
-- berisiko — kalau namanya meleset, yang tertinggal adalah tabel tanpa penjaga.

-- Aksi "Edit" di layar nota. Inilah jalur yang paling sering ditempuh staff,
-- jadi inilah pesan yang paling sering dibaca.
create or replace function koreksi_nota(
  p_id uuid,
  p_receipt_date date,
  p_supplier text,
  p_invoice_no text,
  p_photo_path text,
  p_notes text,
  p_items jsonb,
  p_alasan text
) returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_g goods_receipts%rowtype;
  v_sebelum numeric;
  v_sesudah numeric;
  v_selisih numeric;
begin
  select * into v_g from goods_receipts where id = p_id;
  if v_g.id is null then raise exception 'Nota tidak ditemukan.'; end if;
  if not has_outlet_scope(auth.uid(), v_g.outlet_id) then
    raise exception 'Nota ini bukan wewenangmu.';
  end if;
  if v_g.status = 'dibatalkan' then
    raise exception 'Nota % sudah dibatalkan, isinya tidak bisa diperbaiki lagi.', coalesce(v_g.code, '');
  end if;
  if v_g.esb_exported_at is not null then
    perform tolak_karena_terekspor_esb(v_g.code);
  end if;

  select coalesce(sum(coalesce(line_total, qty * unit_cost)), 0) into v_sebelum
    from goods_receipt_items where receipt_id = p_id;

  -- Kunci "nota lunas" dibuka HANYA selama pemanggilan ini, dan hanya untuk
  -- sesi ini. `true` di argumen ketiga = berlaku sampai transaksinya selesai,
  -- jadi tidak ada penanda yang tertinggal menyala untuk permintaan berikutnya.
  perform set_config('berjaya.koreksi_nota', 'on', true);
  begin
    perform ubah_nota_terima(p_id, p_receipt_date, p_supplier, p_invoice_no, p_photo_path, p_notes, p_items);
  exception when others then
    perform set_config('berjaya.koreksi_nota', '', true);
    raise;
  end;
  perform set_config('berjaya.koreksi_nota', '', true);

  select coalesce(sum(coalesce(line_total, qty * unit_cost)), 0) into v_sesudah
    from goods_receipt_items where receipt_id = p_id;

  v_selisih := v_sesudah - v_sebelum;
  perform sesuaikan_kas_nota(p_id, v_selisih, coalesce(nullif(btrim(p_alasan), ''), 'perbaikan isi nota'));

  update goods_receipts set updated_at = now() where id = p_id;
  return v_selisih;
end;
$$;

revoke all on function koreksi_nota(uuid, date, text, text, text, text, jsonb, text) from public;
grant execute on function koreksi_nota(uuid, date, text, text, text, text, jsonb, text) to authenticated;

-- Aksi "Batalkan nota". Pesan lamanya di sini bahkan berbeda kata dari dua
-- lainnya ("lalu perbaiki berkasnya di sana") — bukti kecil bahwa kalimat yang
-- diulang tiga kali memang menyimpang.
create or replace function batalkan_nota(p_nota uuid, p_alasan text)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_g goods_receipts%rowtype;
  v_total numeric;
  r record;
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  if coalesce(btrim(p_alasan), '') = '' then
    -- Alasan WAJIB. Nota yang dibatalkan tanpa alasan tidak bisa dibedakan dari
    -- kesalahan sistem oleh siapa pun yang membacanya kemudian.
    raise exception 'Sebutkan alasan pembatalannya — walau sesingkat "salah input".';
  end if;

  select * into v_g from goods_receipts where id = p_nota;
  if v_g.id is null then raise exception 'Nota tidak ditemukan.'; end if;
  if not has_outlet_scope(v_uid, v_g.outlet_id) then
    raise exception 'Nota ini bukan wewenangmu.';
  end if;
  if v_g.status = 'dibatalkan' then
    raise exception 'Nota % memang sudah dibatalkan.', coalesce(v_g.code, '');
  end if;
  if v_g.esb_exported_at is not null then
    perform tolak_karena_terekspor_esb(v_g.code);
  end if;

  select coalesce(sum(coalesce(line_total, qty * unit_cost)), 0) into v_total
    from goods_receipt_items where receipt_id = p_nota;

  -- (a) STOK: pergerakan penyeimbang negatif sebesar isi terakhirnya.
  --
  -- Pergerakan lamanya TIDAK dihapus — ia catatan sejarah "pada tanggal sekian
  -- masuk sekian". Menghapusnya membuat saldo hari-hari di antaranya tidak bisa
  -- direkonstruksi. Alasan panjangnya ada di kepala 0084.
  --
  -- Sengaja tanpa `unit_cost`: pembatalan MENGELUARKAN barang, dan pengeluaran
  -- tidak pernah ikut menimbang biaya rata-rata (0118).
  for r in select product_id, qty from goods_receipt_items where receipt_id = p_nota loop
    insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, notes, created_by, receipt_id)
    values (v_g.business_unit_id, v_g.outlet_id, r.product_id, 'receive', -r.qty,
            'Nota ' || coalesce(v_g.code, '') || ' dibatalkan: ' || btrim(p_alasan), v_uid, p_nota);
  end loop;

  -- (b) KAS: nota yang sudah dibayar mengembalikan seluruh nilainya.
  perform sesuaikan_kas_nota(p_nota, -v_total, 'nota dibatalkan: ' || btrim(p_alasan));

  -- (c) JEJAK.
  update goods_receipts
     set status = 'dibatalkan',
         dibatalkan_at = now(),
         dibatalkan_by = v_uid,
         alasan_batal = btrim(p_alasan),
         -- Hutangnya ikut lunas-secara-nol: nota batal tidak boleh menggantung
         -- di tab Hutang Supplier menunggu pembayaran yang tidak akan datang.
         payment_status = case when payment_status = 'lunas' then 'lunas' else 'batal' end,
         updated_at = now()
   where id = p_nota;

  return v_total;
end;
$$;

revoke all on function batalkan_nota(uuid, text) from public;
grant execute on function batalkan_nota(uuid, text) to authenticated;

notify pgrst, 'reload schema';
