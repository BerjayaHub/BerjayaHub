-- =========================================================
-- 0186 — PEMBELIAN SPAREPART BENGKEL (impor Detailed Purchase Orders)
--
--   "jadi ada 2 output yaitu laporan penjualan dan pembelian... inputnya dari
--    import 2 kali yaitu detailed service invoice dan detailed purchase order"
--
-- ============ OUTLETNYA DARI `Deliver To`, BUKAN `Warehouse` ============
--
-- Pada ekspor sungguhan, `Warehouse` berisi nilai yang SAMA untuk seluruh
-- baris ("AWAL BERJAYA BENGKEL") — ia gudang pusat, bukan cabang. Yang
-- menunjuk cabang adalah `Deliver To`, berisi ALAMAT KIRIM:
--
--   "Jl. Borobudur 45, Blimbing, Malang"  -> 100 baris, Rp57.241.094
--   (kosong)                              ->  72 baris, Rp43.508.800  (HO)
--
-- Jadi pemetaannya alamat -> outlet, dengan bentuk yang sama seperti
-- `Store` -> outlet di 0185. Alamat yang belum dipetakan TIDAK ditebak:
-- barisnya tetap masuk dengan `outlet_id` NULL dan dilaporkan balik, karena
-- menebaknya berarti membebankan pembelian cabang lain ke cabang ini — dan
-- angkanya akan tetap terlihat masuk akal.
--
-- ============ `outlet_id` BOLEH NULL, DAN ITU PUNYA ARTI ============
--
-- NULL = pembelian PUSAT yang belum/tidak ditujukan ke satu cabang. Itu bukan
-- data yang kurang lengkap; 72 baris di atas memang begitu adanya. Laporan
-- memisahkannya sebagai "stok pusat", dan pencocokan memakainya hanya sebagai
-- CADANGAN (lihat `cocokkan-beli-jual.js`): pembelian outlet yang sama
-- didahulukan, dan baris yang terpaksa memakai pembelian pusat ditandai.
--
-- ============ HARGA: NOL ≠ KOSONG ≠ TIDAK ADA ============
--
-- Ekspor *store* mengembalikan harga 0 di seluruh barisnya, sementara ekspor
-- *warehouse* untuk periode yang sama berharga lengkap (Rp100.749.894).
-- Jadi 0 di sini TIDAK berarti gratis — ia berarti "tidak ikut keluar di
-- ekspor itu". `harga` NULL dipertahankan apa adanya supaya keduanya bisa
-- dibedakan, dan layar impornya mengatakannya sebelum angkanya dipakai.
-- =========================================================

-- ---------------------------------------------------------
-- 1. PEMETAAN: dipakai bersama dengan 0185
--
-- Satu tabel, dua JENIS kunci — `store` (dari ekspor penjualan) dan `kirim`
-- (alamat Deliver To dari ekspor pembelian). Dua tabel terpisah berarti dua
-- layar, dua RPC, dan dua tempat yang bisa menyimpang; yang membedakan cuma
-- dari mana namanya berasal.
-- ---------------------------------------------------------
alter table bengkel_store_map add column if not exists jenis text not null default 'store';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'bengkel_store_map_jenis_ck'
  ) then
    alter table bengkel_store_map
      add constraint bengkel_store_map_jenis_ck check (jenis in ('store', 'kirim'));
  end if;
end $$;

-- Indeks lama (tanpa `jenis`) akan menolak alamat kirim yang kebetulan sama
-- dengan nama store. Diganti, bukan ditambah.
drop index if exists bengkel_store_map_uk;
create unique index if not exists bengkel_store_map_uk
  on bengkel_store_map(business_unit_id, jenis, lower(btrim(store_name)));

comment on column bengkel_store_map.jenis is
  'store = nama Store di ekspor penjualan; kirim = alamat Deliver To di ekspor pembelian (0186).';

-- ---------------------------------------------------------
-- 2. BARIS PEMBELIAN
-- ---------------------------------------------------------
create table if not exists bengkel_purchase_lines (
  id               uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references business_units(id) on delete cascade,
  -- NULL = pembelian pusat. Lihat kepala berkas; ini bukan data yang kurang.
  outlet_id        uuid references outlets(id) on delete set null,

  po_no            text not null,
  urut             int not null,
  tanggal          date not null,
  supplier         text,
  supplier_kode    text,
  referensi        text,
  status           text,
  pengirim         text,
  warehouse        text,
  kirim_ke         text,

  sku              text,
  nama             text not null,
  product_type     text,
  product_code     text,
  qty              numeric not null default 0,
  harga            numeric,
  total            numeric,

  berkas           text,
  diimpor_at       timestamptz not null default now(),
  diimpor_by       uuid references user_profiles(id) on delete set null
);

-- SATU BARIS PER (PO, URUT).
--
-- Impor ulang mengganti seluruh isi PO itu — sama seperti invoice di 0185.
-- Tanpa kunci ini, mengimpor berkas yang sama dua kali menggandakan nilai
-- pembelian, dan laporannya tetap tercetak rapi.
create unique index if not exists bengkel_purchase_lines_uk
  on bengkel_purchase_lines(business_unit_id, upper(btrim(po_no)), urut);
create index if not exists idx_bengkel_beli_tanggal
  on bengkel_purchase_lines(business_unit_id, tanggal desc);
create index if not exists idx_bengkel_beli_sku
  on bengkel_purchase_lines(business_unit_id, sku) where sku is not null;

comment on table bengkel_purchase_lines is
  'Baris pembelian sparepart dari ekspor Detailed Purchase Orders Turboly. `outlet_id` NULL = pembelian pusat.';
comment on column bengkel_purchase_lines.harga is
  'Harga beli per unit. NULL = tidak ikut terekspor. 0 berarti benar-benar nol — keduanya sengaja dibedakan.';

alter table bengkel_purchase_lines enable row level security;

drop policy if exists bengkel_beli_select on bengkel_purchase_lines;
create policy bengkel_beli_select on bengkel_purchase_lines
  for select to authenticated using (has_bu_scope(auth.uid(), business_unit_id));

-- Tanpa policy tulis: satu-satunya jalan masuk adalah RPC di bawah.

-- ---------------------------------------------------------
-- 3. PEMETAAN ALAMAT KIRIM -> OUTLET
-- ---------------------------------------------------------
create or replace function petakan_tujuan_kirim(p_bu uuid, p_alamat text, p_outlet uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_alamat text := regexp_replace(btrim(coalesce(p_alamat, '')), '\s+', ' ', 'g');
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  if not is_bu_admin(v_uid, p_bu) then
    raise exception 'Hanya Admin BU yang bisa memetakan alamat kirim ke outlet.';
  end if;
  if v_alamat = '' then raise exception 'Alamat kirim wajib diisi.'; end if;
  if not exists (select 1 from outlets o where o.id = p_outlet and o.business_unit_id = p_bu) then
    raise exception 'Outlet itu bukan milik BU ini.';
  end if;

  insert into bengkel_store_map (business_unit_id, store_name, outlet_id, jenis, created_by)
  values (p_bu, v_alamat, p_outlet, 'kirim', v_uid)
  on conflict (business_unit_id, jenis, lower(btrim(store_name)))
  do update set outlet_id = excluded.outlet_id, created_by = excluded.created_by, created_at = now();

  -- Baris yang SUDAH terlanjur masuk tanpa outlet ikut dibetulkan.
  --
  -- Tanpa ini, memetakan alamat hanya berlaku untuk impor BERIKUTNYA, dan
  -- yang sudah masuk tetap jadi "pusat" selamanya — padahal orangnya baru
  -- saja mengatakan outletnya yang mana.
  update bengkel_purchase_lines
     set outlet_id = p_outlet
   where business_unit_id = p_bu
     and outlet_id is null
     and lower(btrim(coalesce(kirim_ke, ''))) = lower(v_alamat);

  return jsonb_build_object('alamat', v_alamat, 'outlet', p_outlet, 'baris_dibetulkan', (select count(*) from bengkel_purchase_lines
      where business_unit_id = p_bu and outlet_id = p_outlet and lower(btrim(coalesce(kirim_ke,''))) = lower(v_alamat)));
end;
$$;

revoke all on function petakan_tujuan_kirim(uuid, text, uuid) from public;
grant execute on function petakan_tujuan_kirim(uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------
-- 4. IMPOR
-- ---------------------------------------------------------

/**
 * Impor hasil ekspor "Detailed Purchase Orders".
 *
 * Satuannya PO: tiap PO dihapus isinya lalu diisi ulang — sama seperti
 * invoice di 0185, dan karena alasan yang sama. Nomor baris dari Turboly
 * cuma urutan di dalam berkas; yang stabil adalah nomor PO-nya.
 *
 * Yang DILEWATI dan dilaporkan balik: baris tanpa nomor PO atau tanpa
 * tanggal. Baris tanpa SKU TETAP masuk — pembeliannya nyata dan nilainya
 * harus ikut terhitung; yang hilang cuma kemampuan mencocokkannya, dan itu
 * dikatakan di laporan, bukan dengan membuang barisnya.
 */
create or replace function impor_pembelian_bengkel(p_bu uuid, p_baris jsonb, p_berkas text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  b jsonb;
  v_po text;
  v_alamat text;
  v_outlet uuid;
  v_urut int;
  v_po_baru int := 0;
  v_po_ganti int := 0;
  v_baris int := 0;
  v_tanpa_sku int := 0;
  v_pusat int := 0;
  v_lewat int := 0;
  v_alamat_belum text[] := '{}';
  v_po_terproses text[] := '{}';
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  if not is_bu_admin(v_uid, p_bu) then
    raise exception 'Hanya Admin BU yang bisa mengimpor pembelian.';
  end if;

  for b in select * from jsonb_array_elements(coalesce(p_baris, '[]'::jsonb)) loop
    v_po := btrim(coalesce(b->>'po_no', ''));
    if v_po = '' or btrim(coalesce(b->>'tanggal', '')) = '' then
      v_lewat := v_lewat + 1;
      continue;
    end if;

    -- PO yang baru pertama disentuh dalam panggilan ini: buang isi lamanya
    -- SEKALI, lalu baris-baris berikutnya menumpuk di atasnya. Menghapusnya
    -- per baris akan membuang baris yang baru saja dimasukkan.
    if not (upper(v_po) = any(v_po_terproses)) then
      v_po_terproses := v_po_terproses || upper(v_po);
      if exists (select 1 from bengkel_purchase_lines
                  where business_unit_id = p_bu and upper(btrim(po_no)) = upper(v_po)) then
        delete from bengkel_purchase_lines
         where business_unit_id = p_bu and upper(btrim(po_no)) = upper(v_po);
        v_po_ganti := v_po_ganti + 1;
      else
        v_po_baru := v_po_baru + 1;
      end if;
      v_urut := 0;
    end if;

    v_alamat := regexp_replace(btrim(coalesce(b->>'kirim_ke', '')), '\s+', ' ', 'g');
    v_outlet := null;
    if v_alamat <> '' then
      select outlet_id into v_outlet from bengkel_store_map
       where business_unit_id = p_bu and jenis = 'kirim' and lower(btrim(store_name)) = lower(v_alamat);
      if v_outlet is null and not (v_alamat = any(v_alamat_belum)) then
        v_alamat_belum := v_alamat_belum || v_alamat;
      end if;
    end if;
    if v_outlet is null then v_pusat := v_pusat + 1; end if;

    v_urut := coalesce(v_urut, 0) + 1;
    insert into bengkel_purchase_lines (business_unit_id, outlet_id, po_no, urut, tanggal, supplier, supplier_kode,
                                        referensi, status, pengirim, warehouse, kirim_ke, sku, nama,
                                        product_type, product_code, qty, harga, total, berkas, diimpor_by)
    values (p_bu, v_outlet, v_po, v_urut, (b->>'tanggal')::date,
            nullif(btrim(coalesce(b->>'supplier','')), ''),
            nullif(btrim(coalesce(b->>'supplier_kode','')), ''),
            nullif(btrim(coalesce(b->>'referensi','')), ''),
            nullif(btrim(coalesce(b->>'status','')), ''),
            nullif(btrim(coalesce(b->>'pengirim','')), ''),
            nullif(btrim(coalesce(b->>'warehouse','')), ''),
            nullif(v_alamat, ''),
            nullif(btrim(coalesce(b->>'sku','')), ''),
            coalesce(nullif(btrim(coalesce(b->>'nama','')), ''), '(tanpa nama)'),
            nullif(btrim(coalesce(b->>'product_type','')), ''),
            nullif(btrim(coalesce(b->>'product_code','')), ''),
            coalesce((b->>'qty')::numeric, 0),
            -- NULL dipertahankan: "tidak ikut terekspor" bukan "gratis".
            (b->>'harga')::numeric,
            (b->>'total')::numeric,
            p_berkas, v_uid);
    v_baris := v_baris + 1;
    if nullif(btrim(coalesce(b->>'sku','')), '') is null then v_tanpa_sku := v_tanpa_sku + 1; end if;
  end loop;

  return jsonb_build_object(
    'po_baru', v_po_baru,
    'po_diganti', v_po_ganti,
    'baris', v_baris,
    'tanpa_sku', v_tanpa_sku,
    'ke_pusat', v_pusat,
    'dilewati', v_lewat,
    'alamat_belum_dipetakan', to_jsonb(v_alamat_belum)
  );
end;
$$;

revoke all on function impor_pembelian_bengkel(uuid, jsonb, text) from public;
grant execute on function impor_pembelian_bengkel(uuid, jsonb, text) to authenticated;

-- ---------------------------------------------------------
-- 5. VIEW LAPORAN PEMBELIAN
--
-- Bentuk kolomnya mengikuti sheet "Laporan Pengeluaran" yang dipakai
-- sekarang: Tanggal · Nopol · Supplier · Nama Barang · QTY · Harga Satuan ·
-- Total. Kolom Nopol TIDAK ada di sini — ia hasil pencocokan, dihitung di
-- aplikasi (`cocokkan-beli-jual.js`) supaya aturan FIFO-nya hidup di satu
-- tempat saja, bukan satu versi di SQL dan satu lagi di layar.
-- ---------------------------------------------------------
create or replace view bengkel_pembelian_rinci as
  select l.id,
         l.business_unit_id,
         l.outlet_id,
         o.name as outlet_nama,
         l.po_no,
         l.urut,
         l.tanggal,
         l.supplier,
         l.supplier_kode,
         l.status,
         l.pengirim,
         l.kirim_ke,
         l.sku,
         l.nama,
         l.product_type,
         l.product_code,
         l.qty,
         l.harga,
         -- `total` dari Turboly kalau ada; kalau kosong, dihitung harga × qty.
         -- Dibiarkan NULL kalau harganya juga tidak diketahui — 0 di sini akan
         -- membuat nilai pembelian terlihat lebih kecil daripada kenyataannya.
         coalesce(l.total, case when l.harga is null then null else l.harga * l.qty end) as nilai,
         l.berkas,
         l.diimpor_at
    from bengkel_purchase_lines l
    left join outlets o on o.id = l.outlet_id;

alter view bengkel_pembelian_rinci set (security_invoker = true);
grant select on bengkel_pembelian_rinci to authenticated;

comment on view bengkel_pembelian_rinci is
  'Baris pembelian sparepart. `outlet_nama` NULL = pembelian pusat; `nilai` NULL = harganya tidak ikut terekspor.';


-- ---------------------------------------------------------
-- 6. `petakan_store_bengkel` (0185) IKUT DIPERBARUI
--
-- ============ KENAPA INI WAJIB ADA DI SINI ============
--
-- Fungsi itu memakai `on conflict (business_unit_id, lower(btrim(store_name)))`
-- — indeks yang baru saja DIGANTI di bagian 1 dengan versi yang memuat
-- `jenis`. Tanpa penulisan ulang ini, memetakan Store akan gagal dengan
-- "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification": kalimat yang tidak berarti apa-apa bagi yang membacanya,
-- muncul di fitur yang sama sekali tidak ia sentuh hari itu.
--
-- Ketahuan oleh tes 0186, bukan oleh orang yang memakainya. Itu memang
-- gunanya menguji migration berpasangan, bukan sendiri-sendiri.
--
-- Isinya SAMA PERSIS dengan 0185 kecuali dua hal: `jenis` ikut ditulis, dan
-- sasaran `on conflict`-nya mengikuti indeks yang baru.
-- ---------------------------------------------------------
create or replace function petakan_store_bengkel(p_bu uuid, p_store text, p_outlet uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_store text := regexp_replace(btrim(coalesce(p_store, '')), '\s+', ' ', 'g');
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  if not is_bu_admin(v_uid, p_bu) then
    raise exception 'Hanya Admin BU yang bisa memetakan store Turboly ke outlet.';
  end if;
  if v_store = '' then raise exception 'Nama store wajib diisi.'; end if;
  if not exists (select 1 from outlets o where o.id = p_outlet and o.business_unit_id = p_bu) then
    raise exception 'Outlet itu bukan milik BU ini.';
  end if;

  insert into bengkel_store_map (business_unit_id, store_name, outlet_id, jenis, created_by)
  values (p_bu, v_store, p_outlet, 'store', v_uid)
  on conflict (business_unit_id, jenis, lower(btrim(store_name)))
  do update set outlet_id = excluded.outlet_id, created_by = excluded.created_by, created_at = now();

  return jsonb_build_object('store', v_store, 'outlet', p_outlet);
end;
$$;

revoke all on function petakan_store_bengkel(uuid, text, uuid) from public;
grant execute on function petakan_store_bengkel(uuid, text, uuid) to authenticated;

notify pgrst, 'reload schema';
