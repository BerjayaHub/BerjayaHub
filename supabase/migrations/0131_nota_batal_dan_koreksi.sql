-- =========================================================
-- Berjaya Hub OMS — 0131
-- Salah input nota bisa dibetulkan: dibatalkan, atau diperbaiki walau lunas.
--
-- =========================================================
-- YANG DIMINTA
-- =========================================================
--
--   "sediakan aksi untuk hapus juga di terima dari supplier ini, jadi saat
--    dihapus maka juga berpengaruh kepada stock, berikutnya di aksi edit juga
--    bisa mengubah tanggal dan isi nota yaitu bahan dan harga walaupun sudah
--    lunas, mengantisipasi apabila ada kesalahan input"
--
-- =========================================================
-- SKEMANYA: SATU ATURAN, TIGA AKIBAT
-- =========================================================
--
-- Aturannya: **nota tidak pernah dihapus, ia dibatalkan atau diperbaiki — dan
-- tiap perubahan menarik stok, kas, dan jejaknya ikut serta.**
--
-- Tiga akibat yang harus selalu bergerak bersama, karena yang tertinggal tidak
-- akan pernah mengeluh:
--
--   STOK  -> pergerakan PENYEIMBANG, bukan penghapusan pergerakan lama.
--            Mekanismenya sudah ada sejak 0084 dan tidak ditemukan ulang di
--            sini.
--   KAS   -> entri PENYESUAIAN sebesar selisihnya. Nota yang totalnya berubah
--            setelah dibayar akan membuat kas dan nota bercerita berbeda —
--            dan yang menemukannya adalah orang yang menghitung uang fisik.
--   JEJAK -> siapa, kapan, dan ALASANNYA. Wewenangnya ada di staff outlet
--            (keputusan pengguna); yang menahan penyalahgunaan adalah jejaknya,
--            bukan izinnya.
--
-- =========================================================
-- KENAPA DIBATALKAN, BUKAN DIBUANG
-- =========================================================
--
-- Nomor nota berurutan. Nota yang dibuang meninggalkan lompatan yang tidak bisa
-- dijelaskan siapa pun enam bulan kemudian — dan pergerakan stok penyeimbangnya
-- menunjuk ke nota yang sudah tidak ada, jadi pertanyaan "stok ini asalnya dari
-- mana" berhenti bisa dijawab.
--
-- Nota yang dibatalkan tetap ada, ditandai, dan bisa dibaca. Saldonya nol,
-- ceritanya utuh.
--
-- =========================================================
-- KENAPA ADA `koreksi_nota` DI SAMPING `ubah_nota_terima`
-- =========================================================
--
-- `ubah_nota_terima` sudah ditulis ulang EMPAT kali (0084 -> 0118 -> 0119 ->
-- 0123). Tiap penulisan ulang berisiko menghilangkan penjagaan versi
-- sebelumnya diam-diam — 0122 sudah menuliskan kekhawatiran itu, dan 0123
-- membuktikannya benar.
--
-- Jadi fungsi itu TIDAK disentuh. `koreksi_nota` membungkusnya: membaca total
-- sebelum, memanggilnya, membaca total sesudah, lalu menyesuaikan kasnya.
--
-- Pembungkus itu juga yang membuka kunci "nota lunas". Kuncinya dibuka lewat
-- penanda sesi, bukan dihapus: PWA lama di HP staff yang memanggil
-- `ubah_nota_terima` langsung tetap tertahan seperti sebelumnya — kalau tidak,
-- HP itu bisa mengubah nilai nota lunas tanpa kas ikut bergerak sama sekali.
-- =========================================================

-- ---------------------------------------------------------
-- (1) Status pembatalan.
-- ---------------------------------------------------------
alter table goods_receipts add column if not exists status text not null default 'aktif';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'goods_receipts_status_chk') then
    alter table goods_receipts add constraint goods_receipts_status_chk
      check (status in ('aktif', 'dibatalkan'));
  end if;
end $$;

alter table goods_receipts add column if not exists dibatalkan_at timestamptz;
alter table goods_receipts add column if not exists dibatalkan_by uuid references user_profiles(id) on delete set null;
-- Alasan WAJIB saat membatalkan. "Salah input" pun sudah jauh lebih berguna
-- daripada kosong: enam bulan kemudian, kolom kosong tidak bisa dibedakan dari
-- pembatalan yang tidak pernah dijelaskan siapa pun.
alter table goods_receipts add column if not exists alasan_batal text;

create index if not exists idx_gr_aktif on goods_receipts(business_unit_id, outlet_id, receipt_date desc)
  where status = 'aktif';

comment on column goods_receipts.status is
  'aktif | dibatalkan. Nota tidak pernah dihapus — nomornya berurutan, dan lompatan nomor tidak bisa dijelaskan siapa pun belakangan.';

-- ---------------------------------------------------------
-- (2) Entri kas penyesuaian perlu tempat menyebut notanya.
--
-- `trg_untuk_nota_punya_nota` (0122) menuntut tiap entri ber-`untuk_nota`
-- ditunjuk oleh `goods_receipts.payment_entry_id`. Entri penyesuaian tidak
-- pernah ditunjuk begitu — ia bukan pembayarannya, melainkan koreksinya.
--
-- Tanpa kolom ini, satu-satunya cara melewati pemeriksa itu adalah mengalihkan
-- `payment_entry_id` ke entri penyesuaian, dan itu memutus jejak ke pembayaran
-- aslinya. Kolom ini membuat hubungannya dinyatakan, bukan disiasati.
-- ---------------------------------------------------------
alter table cash_entries add column if not exists penyesuaian_nota uuid references goods_receipts(id) on delete set null;
create index if not exists idx_cash_penyesuaian on cash_entries(penyesuaian_nota) where penyesuaian_nota is not null;

comment on column cash_entries.penyesuaian_nota is
  'Entri ini KOREKSI nilai sebuah nota, bukan pembayarannya. Dibuat koreksi_nota()/batalkan_nota() saat total notanya berubah sesudah dibayar.';

create or replace function cek_untuk_nota_punya_nota()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Entri penyesuaian sah dengan sendirinya: ia menyebut notanya di kolomnya.
  if new.penyesuaian_nota is not null then
    return null;
  end if;
  if not exists (select 1 from goods_receipts where payment_entry_id = new.id) then
    raise exception 'Entri kas ditandai pembayaran nota, tetapi tidak ada nota yang menunjuknya. Pakai bayar_nota().';
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------
-- (3) Penjaga isi nota, menggantikan `tolak_ubah_nota_lunas` (0122).
--
-- Yang BERTAMBAH dijaga:
--   - nota yang sudah DIBATALKAN tidak boleh diubah sama sekali;
--   - nota yang sudah diekspor ke ESB ditahan sampai tanda ekspornya
--     dibatalkan (aturan yang sama dengan kiriman di 0128).
--
-- Yang BERKURANG: nota lunas kini boleh diubah — TAPI hanya lewat
-- `koreksi_nota`, yang memasang penanda sesi di bawah ini. Jalur langsung tetap
-- tertutup, dan itu penting: yang membuat perubahan pada nota lunas aman
-- bukanlah izinnya, melainkan penyesuaian kas yang menyertainya.
-- ---------------------------------------------------------
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
    raise exception 'Nota % sudah diekspor ke ESB. Batalkan tanda ekspornya dulu, perbaiki, lalu unggah ulang berkasnya.', coalesce(v_code, '');
  end if;

  if v_bayar = 'lunas' and coalesce(current_setting('berjaya.koreksi_nota', true), '') <> 'on' then
    raise exception 'Nota % sudah dibayar. Pakai aksi Edit di layar nota — kasnya ikut disesuaikan otomatis.', coalesce(v_code, '');
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_tolak_ubah_nota_lunas on goods_receipt_items;
drop trigger if exists trg_jaga_ubah_item_nota on goods_receipt_items;
create trigger trg_jaga_ubah_item_nota
  before insert or update or delete on goods_receipt_items
  for each row execute function jaga_ubah_item_nota();

-- ---------------------------------------------------------
-- (4) Penyesuaian kas sebesar SELISIHNYA.
--
-- Selisih, bukan "bagian nota ini dari pembayarannya". Satu entri kas bisa
-- memuat beberapa nota sekaligus (0122), jadi bagian per nota tidak tersimpan
-- di mana pun — sementara selisih sebelum-sesudah selalu diketahui persis oleh
-- yang memanggil.
--
-- Entri aslinya TIDAK disentuh. Menambah baris koreksi membuat buku kas
-- bercerita apa adanya: dibayar sekian, lalu dikoreksi sekian, karena ini.
-- ---------------------------------------------------------
create or replace function sesuaikan_kas_nota(p_nota uuid, p_selisih numeric, p_sebab text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_g goods_receipts%rowtype;
  v_asli cash_entries%rowtype;
  v_id uuid;
begin
  if p_selisih is null or p_selisih = 0 then return null; end if;

  select * into v_g from goods_receipts where id = p_nota;
  if v_g.id is null then return null; end if;

  -- Belum dibayar: tidak ada uang yang sudah berpindah, jadi tidak ada yang
  -- perlu dikoreksi. Hutangnya sendiri ikut berubah dengan sendirinya karena
  -- dihitung dari isi notanya.
  if v_g.payment_status is distinct from 'lunas' then return null; end if;

  -- Dibayar PUSAT (0125): tidak pernah menyentuh kas mana pun, jadi tidak ada
  -- kas yang perlu menyesuaikan diri.
  if v_g.payment_source = 'pusat' then return null; end if;
  if v_g.payment_entry_id is null then return null; end if;

  select * into v_asli from cash_entries where id = v_g.payment_entry_id;
  if v_asli.id is null then return null; end if;

  insert into cash_entries (
    business_unit_id, outlet_id, holder_id, account_id, entry_type, amount,
    notes, entry_date, created_by, untuk_nota, penyesuaian_nota
  ) values (
    v_asli.business_unit_id, v_asli.outlet_id, v_asli.holder_id, v_asli.account_id,
    -- Nota jadi LEBIH MAHAL -> uang keluar lagi. Jadi LEBIH MURAH -> uang
    -- kembali ke kas.
    case when p_selisih > 0 then 'out' else 'in' end,
    case when p_selisih > 0 then -p_selisih else abs(p_selisih) end,
    'Penyesuaian nota ' || coalesce(v_g.code, '') || ' — ' || coalesce(nullif(btrim(p_sebab), ''), 'koreksi isi nota'),
    (now() at time zone 'Asia/Jakarta')::date,
    v_uid,
    -- `untuk_nota` menahan kewajiban foto bukti untuk entri keluar (0122).
    -- Sah di sini karena `penyesuaian_nota` menyatakan notanya.
    p_selisih > 0,
    p_nota
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function sesuaikan_kas_nota(uuid, numeric, text) from public;

-- ---------------------------------------------------------
-- (5) KOREKSI NOTA — termasuk yang sudah lunas.
-- ---------------------------------------------------------
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
    raise exception 'Nota % sudah diekspor ke ESB. Batalkan tanda ekspornya dulu, perbaiki, lalu unggah ulang berkasnya.', coalesce(v_g.code, '');
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

comment on function koreksi_nota(uuid, date, text, text, text, text, jsonb, text) is
  'Memperbaiki nota, termasuk yang sudah lunas. Stok dikoreksi lewat ubah_nota_terima, kas disesuaikan sebesar selisih totalnya. Mengembalikan selisihnya.';

-- ---------------------------------------------------------
-- (6) BATALKAN NOTA — stok ditarik, kas dikembalikan, jejaknya tertulis.
-- ---------------------------------------------------------
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
    raise exception 'Nota % sudah diekspor ke ESB. Batalkan tanda ekspornya dulu, lalu perbaiki berkasnya di sana.', coalesce(v_g.code, '');
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

comment on function batalkan_nota(uuid, text) is
  'Membatalkan nota: stok ditarik lewat pergerakan penyeimbang, kas dikembalikan kalau sudah dibayar, alasan wajib. Notanya tetap ada dan tetap terbaca.';

-- `payment_status` bertambah satu nilai. Kalau ada check constraint lamanya,
-- ia harus ikut mengenal 'batal' — kalau tidak, pembatalan nota yang belum
-- dibayar akan ditolak dengan pesan tentang constraint, bukan tentang nota.
do $$
declare
  v_nama text;
begin
  select conname into v_nama from pg_constraint
   where conrelid = 'goods_receipts'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%payment_status%';
  if v_nama is not null then
    execute format('alter table goods_receipts drop constraint %I', v_nama);
  end if;
  alter table goods_receipts add constraint goods_receipts_payment_status_chk
    check (payment_status in ('belum', 'lunas', 'batal'));
exception when duplicate_object then
  null;
end $$;

-- ---------------------------------------------------------
-- (7) Ringkasan ikut menyebut statusnya.
--
-- Tanpa kolom ini, layar tidak punya cara membedakan nota batal dari nota biasa
-- — dan nota batal yang tampil seperti nota biasa jauh lebih berbahaya daripada
-- nota yang dihapus.
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
         g.status,
         g.dibatalkan_at,
         g.alasan_batal,
         g.esb_exported_at,
         coalesce(sum(coalesce(i.line_total, i.qty * i.unit_cost)), 0) as total,
         coalesce(sum(i.unit_cost) filter (where i.unit_cost is not null), 0) as total_jika_digeser,
         count(i.id) filter (where i.unit_cost is null and i.line_total is null) as baris_tanpa_harga,
         count(i.id) filter (where i.unit_cost is not null) as baris_berharga,
         count(i.id) as baris
    from goods_receipts g
    left join goods_receipt_items i on i.receipt_id = g.id
   group by g.id;

comment on view nota_ringkas is
  'Nota + totalnya + status bayar & SUMBER pembayarannya + status batal + berapa barisnya yang belum berharga.';

-- ---------------------------------------------------------
-- (8) Nota batal tidak ikut ke ESB, dan tidak ikut dibayar.
--
-- Dua tempat yang paling mudah terlupakan, dan dua-duanya senyap: nota batal
-- yang ikut terekspor jadi pembelian sungguhan di ESB, dan nota batal yang
-- masih bisa dibayar mengeluarkan uang untuk barang yang sudah ditarik.
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

  update goods_receipts g
     set esb_exported_at = now(),
         esb_exported_by = v_uid
   where g.id = any(p_notas)
     and g.esb_exported_at is null
     and g.status = 'aktif'
     and is_bu_admin(v_uid, g.business_unit_id);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function tolak_bayar_nota_batal()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.payment_status = 'lunas' and new.status = 'dibatalkan' and coalesce(old.payment_status, '') <> 'lunas' then
    raise exception 'Nota % sudah dibatalkan, tidak bisa dibayar.', coalesce(new.code, '');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tolak_bayar_nota_batal on goods_receipts;
create trigger trg_tolak_bayar_nota_batal
  before update on goods_receipts
  for each row execute function tolak_bayar_nota_batal();

notify pgrst, 'reload schema';
