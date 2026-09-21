-- ============================================================
-- 0148 — KODE SKU PRODUK, DIISI LEWAT TEMPLATE EXCEL.
--
-- ============ APA YANG SEBENARNYA DIPERBAIKI INI ============
--
-- Pertanyaan aslinya: "tiap item harus punya kode sama seperti ESB, untuk
-- import ke waste spoil nya, benar atau tidak?"
--
-- Jawaban jujurnya: TIDAK. Kolom `Product Code` di berkas Item Journal sudah
-- terisi hari ini — 647 produk di ESB semuanya punya Product Code, dan Berjaya
-- Hub menariknya dari Master Product Data lewat nama hasil pemetaan. Ekspor
-- waste sudah jalan tanpa kolom ini.
--
-- Yang DIPERBAIKI kolom ini sesuatu yang lain, dan lebih dalam: **pemetaannya
-- sendiri**. Sampai sekarang satu-satunya jembatan antara produk Berjaya Hub
-- dan produk ESB adalah NAMA — lewat `esb_map`, yang kuncinya nama lokal.
-- Ganti nama sebuah produk di Master Produk, dan pemetaannya putus tanpa satu
-- pun pesan: produknya tetap ada, ekspornya tetap jalan, dan notanya mulai
-- tertahan dengan alasan "Item belum dipetakan" untuk barang yang sudah
-- dipetakan bertahun-tahun.
--
-- Kode yang tersimpan di produknya sendiri tidak ikut berubah saat namanya
-- berubah. Itu jembatan yang tidak putus.
--
-- ============ KENAPA UNIK, DAN KENAPA HANYA PER BU ============
--
-- Kode yang kembar membuat pencocokan otomatis memilih salah satu dari dua
-- produk — dan yang dipilih tergantung urutan baris dari database, yang tidak
-- dijanjikan siapa pun. Kesalahannya lalu berupa pembelian yang tercatat atas
-- barang yang salah, tanpa satu pun galat.
--
-- Uniknya PER BUSINESS UNIT karena dua BU adalah dua perusahaan dengan daftar
-- produk ESB yang berbeda; kode yang sama di keduanya bukan bentrokan.
-- ============================================================

alter table products add column if not exists sku text;

comment on column products.sku is
  'Kode produk di ESB (Product Code). Diisi lewat template Excel di Master Produk. Dipakai mencocokkan pemetaan ESB tanpa bergantung pada nama.';

-- Kosong DIBEDAKAN dari string kosong: `''` akan bentrok dengan `''` lain dan
-- membuat produk kedua yang belum berkode ditolak. Dirapikan sekali di sini,
-- bukan diserahkan ke tiap pemanggil.
update products set sku = null where sku is not null and btrim(sku) = '';

-- Indeks uniknya PARSIAL (`where sku is not null`), dan alasannya ditulis
-- jujur: BUKAN karena tanpa itu produk yang belum berkode akan bentrok.
-- Postgres menganggap setiap NULL berbeda satu sama lain, jadi ratusan produk
-- ber-`sku` NULL lolos di indeks unik biasa — diperiksa langsung, bukan
-- diduga. Alasannya UKURAN: 647 produk hari ini dan sebagian besar belum
-- berkode, jadi indeksnya cuma perlu memuat yang benar-benar berisi.
--
-- Yang SUNGGUH menjaga di sini `update … set sku = null where btrim(sku) = ''`
-- di atas: string kosong BUKAN NULL, dan dua produk ber-`sku = ''` benar-benar
-- akan bentrok.
--
-- Dan `lower(btrim(...))`: "BCK 25-0110" dan "bck 25-0110 " adalah kode yang
-- sama bagi manusia yang menyalinnya dari Excel, dan membiarkan keduanya masuk
-- berarti dua produk berkode sama tanpa satu pun tanda.
create unique index if not exists idx_produk_sku_unik
  on products (business_unit_id, lower(btrim(sku)))
  where sku is not null;

-- ---------------------------------------------------------
-- Mengisi SKU beberapa produk sekaligus, dari unggahan template.
--
-- ============ KENAPA SATU RPC, BUKAN UPDATE PER BARIS ============
--
-- Unggahannya bisa berisi 647 baris. Update satu per satu lewat PostgREST
-- berarti 647 permintaan, dan kegagalan di baris ke-300 meninggalkan separuh
-- pekerjaan tanpa ada yang tahu separuh yang mana.
--
-- Di sini seluruhnya satu transaksi: berhasil semua, atau tidak sama sekali.
--
-- ============ YANG DILEWATI, BUKAN YANG DITOLAK ============
--
-- Baris yang kodenya KOSONG dilewati diam-diam — itu memang yang diminta:
-- "jika ada item yang tidak berubah maka dibiarkan saja". Mengosongkan sel di
-- Excel adalah cara paling wajar mengatakan "yang ini jangan diapa-apakan",
-- dan memperlakukannya sebagai perintah menghapus kode akan membuang pekerjaan
-- yang sudah dilakukan.
--
-- Menghapus kode yang terlanjur salah dilakukan lewat layar produknya sendiri,
-- bukan lewat template — di sana ia satu tindakan yang disengaja, bukan sel
-- yang kebetulan terhapus saat menggulir.
-- ---------------------------------------------------------
create or replace function ubah_sku_produk(p_bu uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_diubah int := 0;
  v_asing text[] := '{}';
  v_bentrok text[] := '{}';
  r record;
  v_nama text;
  v_pemilik text;
begin
  if not is_bu_admin(v_uid, p_bu) then
    raise exception 'Hanya Admin BU atau Super Admin yang bisa mengisi kode SKU.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    return jsonb_build_object('diubah', 0, 'asing', v_asing, 'bentrok', v_bentrok);
  end if;

  for r in
    select (x->>'id')::uuid as id, btrim(coalesce(x->>'sku', '')) as sku
      from jsonb_array_elements(p_items) x
     where coalesce(btrim(x->>'sku'), '') <> ''
  loop
    select p.name into v_nama from products p
     where p.id = r.id and p.business_unit_id = p_bu;
    if v_nama is null then
      -- Produk milik BU lain, atau yang sudah dihapus sejak templatenya
      -- diunduh. Dicatat namanya-pun tidak bisa, jadi id-nya yang dilaporkan.
      v_asing := v_asing || r.id::text;
      continue;
    end if;

    -- Bentrokan DIPERIKSA DI SINI, bukan diserahkan ke indeks uniknya.
    --
    -- Indeks itu melempar `23505` dengan pesan yang menyebut nama indeks dan
    -- tidak menyebut produk mana yang sudah memakainya — dan karena seluruhnya
    -- satu transaksi, SATU bentrokan akan membatalkan 646 baris lain tanpa
    -- penjelasan. Di sini ia jadi laporan yang bisa ditindaklanjuti.
    select p.name into v_pemilik from products p
     where p.business_unit_id = p_bu
       and p.id <> r.id
       and p.sku is not null
       and lower(btrim(p.sku)) = lower(r.sku)
     limit 1;
    if v_pemilik is not null then
      v_bentrok := v_bentrok || format('%s -> %s (sudah dipakai %s)', v_nama, r.sku, v_pemilik);
      continue;
    end if;

    -- `business_unit_id` di sini LAPIS KEDUA, dan diakui begitu: pencarian
    -- nama di atas sudah menolak id milik BU lain (ia jadi `v_asing`). Ia
    -- tetap ditulis karena kedua penjaganya bisa dicabut satu per satu, dan
    -- yang mencabut yang pertama tidak punya alasan menduga yang kedua sedang
    -- menanggungnya.
    update products p
       set sku = r.sku
     where p.id = r.id
       and p.business_unit_id = p_bu
       -- Yang nilainya SUDAH SAMA tidak ikut disentuh: `updated_at` yang
       -- berubah untuk 600 produk yang tidak berubah apa-apa membuat riwayat
       -- perubahan tidak bisa dibaca lagi.
       and (p.sku is distinct from r.sku);
    if found then
      v_diubah := v_diubah + 1;
    end if;
  end loop;

  return jsonb_build_object('diubah', v_diubah, 'asing', v_asing, 'bentrok', v_bentrok);
end;
$$;

revoke all on function ubah_sku_produk(uuid, jsonb) from public;
grant execute on function ubah_sku_produk(uuid, jsonb) to authenticated;

comment on function ubah_sku_produk(uuid, jsonb) is
  'Mengisi kode SKU banyak produk sekaligus dari unggahan template. Sel kosong DILEWATI, bukan menghapus kode. Bentrokan dilaporkan, bukan melempar 23505.';

notify pgrst, 'reload schema';
