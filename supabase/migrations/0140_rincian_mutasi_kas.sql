-- =========================================================
-- Berjaya Hub OMS — 0140
-- RINCIAN MUTASI KAS — keluar/masuk saldo PER ITEM, bukan per nota.
--
-- =========================================================
-- YANG DIMINTA
-- =========================================================
--
--   "ingin ada tambahan di modul laporan, yaitu rincian mutasi kas, yaitu
--    keluar masuk saldo, dengan rincian, contohnya saya filter pemegang kas
--    iis, kantong kas kas iis ck, lalu disana akan muncul rincian per bahan dan
--    per keluar, seperti lombok 1 kg 10.000, karcis parkir 1 5000, jadi bukan
--    per nota, tetapi per item / saat ini memang ada 2 cara untuk mengurangi
--    kas yaitu dari pembelian bahan dari supplier dan cash ledger, yaitu yang
--    tidak berhubungan dengan bahan seperti karcis parkir, bensin, dsb / di
--    laporan ini saya ingin semua muncul dengan mapping, bahan bila dikeluarkan
--    dari modul bahan, lalu bila keluar dari cash ledger sesuai dengan
--    mapping nya"
--
-- =========================================================
-- KENAPA DI SERVER, BUKAN DI LAYAR
-- =========================================================
--
-- Dua hal yang tidak bisa dikerjakan klien:
--
--   1. RLS `cash_entries` hanya membuka baris MILIK SENDIRI. Laporan ini lintas
--      orang, dan pembukaannya harus terkendali — persis seperti
--      `laporan_kas_user` (0063).
--   2. Satu entri kas bisa melunasi BEBERAPA nota sekaligus (`bayar_nota`
--      menerima `uuid[]`), dan tiap nota punya banyak baris bahan. Merangkainya
--      dari klien berarti tiga permintaan berantai yang masing-masing bisa
--      terpotong PostgREST di ~1000 baris tanpa satu pun error.
--
-- =========================================================
-- APA YANG MENJADI SATU BARIS
-- =========================================================
--
--   sumber = 'bahan' — satu baris `goods_receipt_items` dari nota yang dibayar
--                      entri kas ini. Inilah "lombok 1 kg 10.000".
--   sumber = 'kas'   — entri kas yang TIDAK melunasi nota apa pun: parkir,
--                      bensin, setoran, transfer, pindah antar kantong, dan
--                      penyesuaian nota. Inilah "karcis parkir 1 5000".
--
-- Pembedanya SENGAJA bukan kolom `untuk_nota`, melainkan "apakah ada nota yang
-- menunjuk entri ini lewat `payment_entry_id`". Sebabnya konkret: entri
-- PENYESUAIAN dari `koreksi_nota`/`batalkan_nota` (0131) juga ber-`untuk_nota`
-- true, tapi tidak ada nota yang menunjuknya — memakai `untuk_nota` akan
-- membuat entri itu hilang dari laporan, dan yang hilang justru koreksi.
--
-- =========================================================
-- YANG TIDAK AKAN MUNCUL DI SINI, DAN ITU BENAR
-- =========================================================
--
-- Nota yang dilunasi PUSAT (`payment_source = 'pusat'`, 0125) tidak pernah
-- meninggalkan satu baris pun di `cash_entries`. Ia memang tidak menyentuh kas
-- siapa pun, jadi ia bukan mutasi kas. Pertanyaan "berapa total belanja bahan
-- bulan ini" dijawab laporan Bahan Masuk, bukan laporan ini.
--
-- =========================================================
-- `entry_amount` IKUT DIKEMBALIKAN — INI BUKAN KOLOM MUBAZIR
-- =========================================================
--
-- Nota yang DIKOREKSI SESUDAH DIBAYAR (0131) membuat isinya tidak lagi sama
-- dengan uang yang keluar saat itu: entri pembayarannya tetap bernilai total
-- LAMA, isinya kini bernilai total BARU, dan selisihnya berjalan lewat entri
-- penyesuaian tersendiri. Kalau laporan hanya menjumlahkan baris bahan, ia
-- menghitung selisih itu DUA KALI — sekali di baris bahannya, sekali di entri
-- penyesuaiannya — dan hasilnya tetap terlihat masuk akal.
--
-- Karena itu nominal entri induknya dibawa serta, supaya layar bisa
-- merekonsiliasi dan MENYEBUTKAN selisihnya alih-alih menelannya.
-- =========================================================

-- ---------------------------------------------------------
-- (1) Aturan keterlihatan kas — SATU tempat, dua pemakai.
--
-- Isinya persis aturan yang sudah berlaku di `laporan_kas_user` (0063). Ditarik
-- keluar supaya dua fungsi tidak menyimpan salinan aturan masing-masing; dua
-- salinan aturan izin cepat atau lambat berbeda, dan bedanya muncul sebagai
-- baris yang hilang tanpa pesan apa pun.
-- ---------------------------------------------------------
create or replace function boleh_lihat_kas(p_holder uuid, p_outlet uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    is_super_admin(auth.uid())
    or p_holder = auth.uid()
    or (p_outlet is not null and is_admin_of_outlet(auth.uid(), p_outlet))
    -- Kas MASUK tidak punya outlet peruntukan. Tanpa cabang ini, admin BU
    -- melihat pengeluaran anak buahnya tapi tidak pemasukannya — laporan yang
    -- separuhnya hilang tanpa pesan apa pun, dan angkanya tetap terlihat wajar.
    or exists (
      select 1
      from membership_scopes ms
      where ms.user_id = p_holder
        and ms.business_unit_id is not null
        and is_bu_admin(auth.uid(), ms.business_unit_id)
    );
$$;

revoke all on function boleh_lihat_kas(uuid, uuid) from public;
grant execute on function boleh_lihat_kas(uuid, uuid) to authenticated;

comment on function boleh_lihat_kas(uuid, uuid) is
  'Boleh tidaknya auth.uid() melihat satu baris kas milik p_holder berperuntukan p_outlet. Aturan yang sama dipakai laporan_kas_user (0063) dan rincian_mutasi_kas (0140).';

-- ---------------------------------------------------------
-- (2) Daftar kantong kas yang BISA DILAPORKAN orang ini.
--
-- `daftar_kantong_kas()` (0121) tidak bisa dipakai: ia super admin saja,
-- sementara laporan ini juga untuk admin BU/outlet. Daftarnya diturunkan dari
-- entri yang memang terlihat, jadi dropdown filternya tidak pernah menawarkan
-- kantong yang hasilnya pasti kosong.
--
-- Baris ber-`account_id` NULL adalah **Kas Utama** — tempat uang pemegang
-- berjatah satu kantong sebenarnya berada. Ia bukan baris semu yang
-- dibuat-buat: itu keadaan sungguhan sebelum kantong mana pun dibuat, dan
-- menghilangkannya dari daftar berarti sebagian besar uang tidak bisa disaring.
-- ---------------------------------------------------------
create or replace function kantong_kas_terlihat()
returns table (
  account_id uuid,
  account_name text,
  holder_id uuid,
  holder_name text,
  outlet_name text
)
language sql
security definer
stable
set search_path = public
as $$
  select distinct
    ce.account_id,
    coalesce(ca.name, 'Kas Utama'),
    ce.holder_id,
    up.full_name,
    o.name
  from cash_entries ce
  join user_profiles up on up.id = ce.holder_id
  left join cash_accounts ca on ca.id = ce.account_id
  left join outlets o on o.id = ca.outlet_id
  where boleh_lihat_kas(ce.holder_id, ce.outlet_id)
  order by 4, 2;
$$;

revoke all on function kantong_kas_terlihat() from public;
grant execute on function kantong_kas_terlihat() to authenticated;

comment on function kantong_kas_terlihat() is
  'Kantong kas yang barisnya boleh dilihat pemanggil, termasuk Kas Utama (account_id NULL). Untuk dropdown filter laporan Rincian Mutasi Kas.';

-- ---------------------------------------------------------
-- (3) RINCIAN MUTASI KAS.
--
-- KAS UTAMA PUNYA PENANDANYA SENDIRI.
--
-- `p_account` NULL berarti "semua kantong", jadi ia tidak bisa sekaligus
-- berarti "kantong kosong / Kas Utama" — dua pertanyaan yang sangat berbeda.
-- `p_tanpa_kantong` boolean yang membedakannya. Alternatif yang TIDAK dipilih:
-- uuid sentinel nol. Sentinel terlihat seperti id sungguhan di log, di URL, dan
-- di kepala orang yang membacanya enam bulan lagi.
-- ---------------------------------------------------------
drop function if exists rincian_mutasi_kas(date, date, uuid, uuid, boolean, uuid, uuid);
create function rincian_mutasi_kas(
  p_from date,
  p_to date,
  p_user uuid default null,
  p_account uuid default null,
  p_tanpa_kantong boolean default false,
  p_outlet uuid default null,
  p_category uuid default null
)
returns table (
  baris_id uuid,
  entry_id uuid,
  entry_date date,
  holder_id uuid,
  holder_name text,
  account_id uuid,
  account_name text,
  outlet_id uuid,
  outlet_name text,
  sumber text,
  kategori text,
  item text,
  qty numeric,
  satuan text,
  nominal numeric,
  entry_amount numeric,
  nota_code text,
  pihak text,
  nota_batal boolean
)
language sql
security definer
stable
set search_path = public
as $$
  with terlihat as (
    select ce.*
    from cash_entries ce
    where ce.entry_date between p_from and p_to
      and (p_user is null or ce.holder_id = p_user)
      and (p_outlet is null or ce.outlet_id = p_outlet)
      and (p_category is null or ce.category_id = p_category)
      and (
        case
          when coalesce(p_tanpa_kantong, false) then ce.account_id is null
          when p_account is null then true
          else ce.account_id = p_account
        end
      )
      and boleh_lihat_kas(ce.holder_id, ce.outlet_id)
  ),
  -- Nota yang pembayarannya ADA di dalam rentang terlihat. Sengaja `join`
  -- lewat `payment_entry_id`, bukan lewat `untuk_nota` — alasannya di kepala
  -- berkas ini.
  nota as (
    select g.id, g.code, g.supplier, g.payment_entry_id, g.status
    from goods_receipts g
    join terlihat t on t.id = g.payment_entry_id
  )

  -- ---- (a) Pembayaran nota, dipecah per bahan ----
  select
    gri.id,
    t.id,
    t.entry_date,
    t.holder_id,
    up.full_name,
    t.account_id,
    coalesce(ca.name, 'Kas Utama'),
    t.outlet_id,
    o.name,
    'bahan'::text,
    -- MAPPING. Pembelian bahan biasanya tidak berkategori kas (kategorinya ada
    -- di notanya), jadi kategori kas dipakai kalau ada dan "Pembelian bahan"
    -- kalau tidak — bukan dikosongkan, supaya kolomnya bisa dipivot.
    coalesce(cc.name, 'Pembelian bahan'),
    -- Produk yang sudah dihapus dari master TETAP MUNCUL: uangnya benar-benar
    -- keluar, dan baris yang hilang membuat total tidak cocok dengan entrinya.
    coalesce(p.name, '(produk terhapus)'),
    gri.qty,
    p.base_unit,
    -- Nilai baris memakai rumus yang SAMA dengan `nota_ringkas` dan
    -- `bayar_nota`: `line_total` dulu, lalu `qty * unit_cost`. Mengalikan
    -- balik dari `unit_cost` saja meleset ribuan rupiah pada qty yang tidak
    -- membagi habis (lihat js/modules/inventory/harga-baris.js).
    --
    -- NULL kalau barisnya memang belum berharga — bukan 0. Nol membuat total
    -- terlihat sah padahal ada barang yang belum bernilai.
    case when t.amount < 0 then -1 else 1 end * coalesce(gri.line_total, gri.qty * gri.unit_cost),
    t.amount,
    n.code,
    n.supplier,
    n.status = 'dibatalkan'
  from terlihat t
  join nota n on n.payment_entry_id = t.id
  join goods_receipt_items gri on gri.receipt_id = n.id
  join user_profiles up on up.id = t.holder_id
  left join cash_accounts ca on ca.id = t.account_id
  left join outlets o on o.id = t.outlet_id
  left join cash_categories cc on cc.id = t.category_id
  left join products p on p.id = gri.product_id

  union all

  -- ---- (b) Entri kas yang bukan pembayaran nota ----
  select
    t.id,
    t.id,
    t.entry_date,
    t.holder_id,
    up.full_name,
    t.account_id,
    coalesce(ca.name, 'Kas Utama'),
    t.outlet_id,
    o.name,
    'kas'::text,
    -- MAPPING kas ledger: kategori yang dipilih saat mencatat. Yang tidak
    -- berkategori diberi label sesuai JENIS entrinya, bukan dibiarkan kosong —
    -- transfer dan pindah antar kantong memang tidak pernah berkategori, dan
    -- "(kosong)" di laporan terbaca seperti data yang hilang.
    coalesce(
      cc.name,
      case
        when t.penyesuaian_nota is not null then 'Penyesuaian nota'
        when t.entry_type in ('transfer_in', 'transfer_out') then 'Transfer antar pemegang'
        when t.entry_type in ('move_in', 'move_out') then 'Pindah antar kantong'
        else 'Tanpa kategori'
      end
    ),
    coalesce(nullif(btrim(t.notes), ''), cc.name, 'Tanpa keterangan'),
    t.qty,
    t.unit,
    t.amount,
    t.amount,
    null::text,
    cp.full_name,
    false
  from terlihat t
  join user_profiles up on up.id = t.holder_id
  left join cash_accounts ca on ca.id = t.account_id
  left join outlets o on o.id = t.outlet_id
  left join cash_categories cc on cc.id = t.category_id
  left join user_profiles cp on cp.id = t.counterpart_id
  where not exists (select 1 from nota n where n.payment_entry_id = t.id)

  order by 3, 5, 2, 1;
$$;

revoke all on function rincian_mutasi_kas(date, date, uuid, uuid, boolean, uuid, uuid) from public;
grant execute on function rincian_mutasi_kas(date, date, uuid, uuid, boolean, uuid, uuid) to authenticated;

comment on function rincian_mutasi_kas(date, date, uuid, uuid, boolean, uuid, uuid) is
  'Mutasi kas PER ITEM: pembayaran nota dipecah per baris bahan, entri kas lain tampil apa adanya dengan mapping kategorinya. entry_amount = nominal entri induk, untuk merekonsiliasi nota yang dikoreksi sesudah dibayar.';

-- ---------------------------------------------------------
-- (4) Penjaga: hanya boleh ada SATU bentuk tiap fungsi.
--
-- PostgREST memilih fungsi berdasarkan HIMPUNAN NAMA argumen yang dikirim.
-- Bentuk kedua yang tertinggal dari percobaan sebelumnya tidak menghasilkan
-- error — ia menghasilkan JAWABAN LAIN, dari kode yang tidak sedang dibaca
-- siapa pun.
-- ---------------------------------------------------------
do $$
declare
  v_n int;
begin
  select count(*) into v_n from pg_proc where proname = 'rincian_mutasi_kas';
  if v_n <> 1 then
    raise exception 'rincian_mutasi_kas punya % bentuk, seharusnya 1.', v_n;
  end if;

  select count(*) into v_n from pg_proc where proname = 'kantong_kas_terlihat';
  if v_n <> 1 then
    raise exception 'kantong_kas_terlihat punya % bentuk, seharusnya 1.', v_n;
  end if;
end $$;
