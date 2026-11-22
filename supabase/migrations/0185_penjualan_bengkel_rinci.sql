-- =========================================================
-- 0185 — PENJUALAN BENGKEL PER BARIS: TURBOLY + KORPORAT
--
--   "saya ingin berjaya hub menjadi penengah bagi kedua jalur input, jalur
--    input customer umum yang diinput melalui turboly dan jalur input manual
--    spreadsheet dari customer korporate"
--
-- ============ APA YANG DISIMPAN, DAN KENAPA PER BARIS ============
--
-- `bengkel_sales` (0166) menyimpan omzet HARIAN per outlet — dua angka, tanpa
-- barang. Itu cukup untuk melihat pemasukan, dan tidak cukup untuk menjawab
-- satu pun pertanyaan yang sekarang diminta: sparepart apa yang terpakai, di
-- nopol mana, dengan modal berapa.
--
-- Tabel di sini menyimpan BARIS: satu baris = satu barang/jasa di satu
-- invoice. 0166 tidak disentuh — ia masih dipakai layar Staff App, dan
-- menggabungkan keduanya berarti satu laporan menjumlahkan angka harian
-- dengan angka per baris untuk hari yang sama.
--
-- ============ SATUANNYA INVOICE, BUKAN BARIS ============
--
-- Impor ulang periode yang sama MENGGANTI seluruh isi invoice, lalu memuatnya
-- lagi. Nomor baris dari Turboly (`No.`) cuma nomor urut DI DALAM BERKAS:
-- menyunting satu invoice di Turboly menggeser seluruh nomor sesudahnya, dan
-- impor yang memakainya sebagai kunci akan menimpa baris milik invoice lain —
-- tanpa satu pun galat.
--
-- ============ MODAL YANG TIDAK DIKETAHUI ADALAH `NULL` ============
--
-- Bukan 0. Penjualan korporat sebagian tidak diketahui modalnya, dan 0
-- membuat labanya terlihat 100% — angka yang akan masuk ke laporan dan tidak
-- akan pernah dicurigai, karena bentuknya wajar.
--
-- ============ SATU BERKAS BISA MEMUAT BANYAK STORE ============
--
-- Ekspor contohnya berjudul `Store: All Stores` dan isinya OTONIX Malang DAN
-- Mojokerto. Jadi outlet ditentukan PER INVOICE dari kolom `Store`-nya, bukan
-- dari satu pilihan di layar impor. Store yang belum dipetakan TIDAK ditebak:
-- ia dilaporkan balik supaya orangnya memetakannya dulu.
-- =========================================================

-- ---------------------------------------------------------
-- 1. PEMETAAN STORE TURBOLY -> OUTLET
-- ---------------------------------------------------------
create table if not exists bengkel_store_map (
  id               uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references business_units(id) on delete cascade,
  store_name       text not null,
  outlet_id        uuid not null references outlets(id) on delete cascade,
  created_by       uuid references user_profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);

-- Nama store dibandingkan tanpa peduli huruf besar-kecil & spasi tepi:
-- "OTONIX Malang" dan "Otonix  Malang" adalah store yang sama, dan dua baris
-- pemetaan untuk store yang sama berarti jawabannya tergantung baris mana
-- yang kebetulan terbaca lebih dulu.
create unique index if not exists bengkel_store_map_uk
  on bengkel_store_map(business_unit_id, lower(btrim(store_name)));

comment on table bengkel_store_map is
  'Nama Store di ekspor Turboly -> outlet Berjaya Hub. Store yang belum ada di sini membuat invoicenya DILEWATI, bukan ditebak.';

-- ---------------------------------------------------------
-- 2. INVOICE & BARISNYA
-- ---------------------------------------------------------
create table if not exists bengkel_sale_invoices (
  id               uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references business_units(id) on delete cascade,
  outlet_id        uuid not null references outlets(id) on delete cascade,

  -- 'turboly'  -> datang dari impor; diganti utuh tiap impor ulang
  -- 'korporat' -> diketik di Berjaya Hub; TIDAK pernah disentuh impor
  sumber           text not null check (sumber in ('turboly', 'korporat')),

  invoice_no       text not null,
  tanggal          date not null,
  tipe             text,
  status           text,
  customer         text,
  company          text,
  nopol            text,
  merek            text,
  model            text,
  work_order       text,
  service_order    text,
  pembayaran       text,
  catatan          text,

  berkas           text,
  diimpor_at       timestamptz,
  diimpor_by       uuid references user_profiles(id) on delete set null,
  created_by       uuid references user_profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  diubah_at        timestamptz,
  diubah_by        uuid references user_profiles(id) on delete set null
);

-- SATU NOMOR INVOICE SEKALI SAJA PER BU.
--
-- Nomor Turboly sudah memuat kode store (`SRI/OTXM/...`), dan nomor korporat
-- diberi awalan `KRP/` — jadi keduanya tidak mungkin bertabrakan. Yang
-- dicegah indeks ini adalah impor berkas yang sama dua kali menghasilkan dua
-- invoice yang isinya sama persis.
create unique index if not exists bengkel_sale_invoices_uk
  on bengkel_sale_invoices(business_unit_id, upper(btrim(invoice_no)));
create index if not exists idx_bengkel_inv_tanggal
  on bengkel_sale_invoices(business_unit_id, tanggal desc);
create index if not exists idx_bengkel_inv_outlet
  on bengkel_sale_invoices(outlet_id, tanggal desc);

create table if not exists bengkel_sale_lines (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references bengkel_sale_invoices(id) on delete cascade,
  urut         int not null,
  item_type    text not null check (item_type in ('sparepart', 'jasa')),
  sku          text,
  nama         text not null,
  brand        text,
  product_type text,
  qty          numeric not null default 0,
  harga_satuan numeric,
  diskon       numeric not null default 0,
  total        numeric not null default 0,

  -- NULL = tidak diketahui. Lihat kepala berkas; ini bukan nol.
  modal        numeric,
  -- Laba versi Turboly, DISIMPAN APA ADANYA untuk dibandingkan — bukan untuk
  -- dipakai menghitung. Kalau ia tidak sama dengan total - modal, salah satu
  -- angkanya tidak berarti seperti yang kita kira, dan itu harus terlihat.
  laba_turboly numeric,
  catatan      text
);

create unique index if not exists bengkel_sale_lines_uk on bengkel_sale_lines(invoice_id, urut);
create index if not exists idx_bengkel_lines_sku on bengkel_sale_lines(sku) where sku is not null;

comment on column bengkel_sale_lines.modal is
  'Cost dari Turboly: TOTAL modal baris ini, bukan per unit. NULL = tidak diketahui (mis. korporat).';

-- ---------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------
alter table bengkel_store_map enable row level security;
alter table bengkel_sale_invoices enable row level security;
alter table bengkel_sale_lines enable row level security;

drop policy if exists bengkel_store_map_select on bengkel_store_map;
create policy bengkel_store_map_select on bengkel_store_map
  for select to authenticated using (has_bu_scope(auth.uid(), business_unit_id));

drop policy if exists bengkel_inv_select on bengkel_sale_invoices;
create policy bengkel_inv_select on bengkel_sale_invoices
  for select to authenticated using (has_bu_scope(auth.uid(), business_unit_id));

drop policy if exists bengkel_lines_select on bengkel_sale_lines;
create policy bengkel_lines_select on bengkel_sale_lines
  for select to authenticated using (
    exists (select 1 from bengkel_sale_invoices i
             where i.id = bengkel_sale_lines.invoice_id and has_bu_scope(auth.uid(), i.business_unit_id))
  );

-- Tanpa policy tulis sama sekali: satu-satunya jalan masuk adalah fungsi di
-- bawah. Impor yang bisa dilakukan lewat insert langsung akan melewati
-- penggantian per invoice — dan hasilnya baris kembar yang menggandakan omzet.

-- ---------------------------------------------------------
-- 4. PEMETAAN STORE
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

  insert into bengkel_store_map (business_unit_id, store_name, outlet_id, created_by)
  values (p_bu, v_store, p_outlet, v_uid)
  on conflict (business_unit_id, lower(btrim(store_name)))
  do update set outlet_id = excluded.outlet_id, created_by = excluded.created_by, created_at = now();

  return jsonb_build_object('store', v_store, 'outlet', p_outlet);
end;
$$;

revoke all on function petakan_store_bengkel(uuid, text, uuid) from public;
grant execute on function petakan_store_bengkel(uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------
-- 5. IMPOR
-- ---------------------------------------------------------

/**
 * Impor hasil ekspor "Detailed Service Invoice" Turboly.
 *
 * Satuannya INVOICE: tiap invoice dihapus isinya lalu diisi ulang. Jadi
 * mengimpor berkas yang sama dua kali menghasilkan keadaan yang sama persis,
 * dan mengimpor ekspor yang lebih baru untuk periode yang sama memperbarui —
 * bukan menggandakan.
 *
 * Yang TIDAK dikerjakan diam-diam:
 *
 *   store belum dipetakan   -> invoicenya DILEWATI dan namanya dikembalikan,
 *                              bukan ditebak ke outlet mana pun
 *   nomornya milik korporat -> DILEWATI. Invoice yang diketik orang tidak
 *                              boleh ditimpa berkas, walau nomornya kebetulan
 *                              sama
 *   invoice tanpa baris     -> DILEWATI. Mengganti invoice yang ada dengan
 *                              invoice kosong akan menghapus isinya tanpa ada
 *                              yang memintanya
 */
create or replace function impor_penjualan_bengkel(p_bu uuid, p_invoices jsonb, p_berkas text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  inv jsonb;
  b jsonb;
  v_store text;
  v_outlet uuid;
  v_no text;
  v_id uuid;
  v_sumber text;
  v_baru int := 0;
  v_ganti int := 0;
  v_baris int := 0;
  v_lewat_store text[] := '{}';
  v_lewat_korporat text[] := '{}';
  v_lewat_kosong text[] := '{}';
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  if not is_bu_admin(v_uid, p_bu) then
    raise exception 'Hanya Admin BU yang bisa mengimpor penjualan Turboly.';
  end if;

  for inv in select * from jsonb_array_elements(coalesce(p_invoices, '[]'::jsonb)) loop
    v_no := btrim(coalesce(inv->>'invoice_no', ''));
    v_store := regexp_replace(btrim(coalesce(inv->>'store', '')), '\s+', ' ', 'g');
    continue when v_no = '';

    if jsonb_array_length(coalesce(inv->'baris', '[]'::jsonb)) = 0 then
      v_lewat_kosong := v_lewat_kosong || v_no;
      continue;
    end if;

    select outlet_id into v_outlet from bengkel_store_map
     where business_unit_id = p_bu and lower(btrim(store_name)) = lower(v_store);
    if v_outlet is null then
      if not (v_store = any(v_lewat_store)) then v_lewat_store := v_lewat_store || v_store; end if;
      continue;
    end if;

    select id, sumber into v_id, v_sumber from bengkel_sale_invoices
     where business_unit_id = p_bu and upper(btrim(invoice_no)) = upper(v_no);

    if v_id is not null and v_sumber = 'korporat' then
      v_lewat_korporat := v_lewat_korporat || v_no;
      continue;
    end if;

    if v_id is null then
      insert into bengkel_sale_invoices (business_unit_id, outlet_id, sumber, invoice_no, tanggal, tipe, status,
                                         customer, company, nopol, merek, model, work_order, service_order,
                                         pembayaran, berkas, diimpor_at, diimpor_by, created_by)
      values (p_bu, v_outlet, 'turboly', v_no, (inv->>'tanggal')::date, inv->>'tipe', inv->>'status',
              inv->>'customer', inv->>'company', inv->>'nopol', inv->>'merek', inv->>'model',
              inv->>'work_order', inv->>'service_order', inv->>'pembayaran',
              p_berkas, now(), v_uid, v_uid)
      returning id into v_id;
      v_baru := v_baru + 1;
    else
      update bengkel_sale_invoices
         set outlet_id = v_outlet,
             tanggal = (inv->>'tanggal')::date,
             tipe = inv->>'tipe', status = inv->>'status',
             customer = inv->>'customer', company = inv->>'company', nopol = inv->>'nopol',
             merek = inv->>'merek', model = inv->>'model',
             work_order = inv->>'work_order', service_order = inv->>'service_order',
             pembayaran = inv->>'pembayaran',
             berkas = p_berkas, diimpor_at = now(), diimpor_by = v_uid,
             diubah_at = now(), diubah_by = v_uid
       where id = v_id;
      -- Isi lamanya dibuang SELURUHNYA, baru diisi ulang. Menyamakan baris
      -- satu per satu berarti baris yang dihapus di Turboly tetap hidup di
      -- sini — dan omzetnya ikut terhitung selamanya.
      delete from bengkel_sale_lines where invoice_id = v_id;
      v_ganti := v_ganti + 1;
    end if;

    for b in select * from jsonb_array_elements(inv->'baris') loop
      insert into bengkel_sale_lines (invoice_id, urut, item_type, sku, nama, brand, product_type,
                                      qty, harga_satuan, diskon, total, modal, laba_turboly)
      values (v_id,
              coalesce((b->>'urut')::int, 1),
              case when lower(coalesce(b->>'item_type','')) = 'sparepart' then 'sparepart' else 'jasa' end,
              nullif(btrim(coalesce(b->>'sku','')), ''),
              coalesce(nullif(btrim(coalesce(b->>'nama','')), ''), '(tanpa nama)'),
              nullif(btrim(coalesce(b->>'brand','')), ''),
              nullif(btrim(coalesce(b->>'product_type','')), ''),
              coalesce((b->>'qty')::numeric, 0),
              (b->>'harga_satuan')::numeric,
              coalesce((b->>'diskon')::numeric, 0),
              coalesce((b->>'total')::numeric, 0),
              (b->>'modal')::numeric,
              (b->>'laba_turboly')::numeric);
      v_baris := v_baris + 1;
    end loop;
  end loop;

  return jsonb_build_object(
    'invoice_baru', v_baru,
    'invoice_diganti', v_ganti,
    'baris', v_baris,
    'store_belum_dipetakan', to_jsonb(v_lewat_store),
    'dilewati_korporat', to_jsonb(v_lewat_korporat),
    'dilewati_kosong', to_jsonb(v_lewat_kosong)
  );
end;
$$;

revoke all on function impor_penjualan_bengkel(uuid, jsonb, text) from public;
grant execute on function impor_penjualan_bengkel(uuid, jsonb, text) to authenticated;

-- ---------------------------------------------------------
-- 6. INVOICE KORPORAT (diketik di Berjaya Hub)
-- ---------------------------------------------------------

/**
 * Simpan satu invoice korporat beserta barisnya.
 *
 * Nomornya dibuat di sini dengan awalan `KRP/` supaya tidak mungkin bentrok
 * dengan nomor Turboly — dan supaya laporan bisa menyebut asalnya tanpa
 * melihat kolom `sumber`.
 *
 * Impor TIDAK akan pernah menyentuh baris ini. Itu inti pembagiannya: satu
 * jalur diganti berkas, satu jalur milik orang yang mengetiknya.
 */
create or replace function simpan_invoice_korporat(p_bu uuid, p_invoice jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid := nullif(btrim(coalesce(p_invoice->>'id', '')), '')::uuid;
  v_outlet uuid := (p_invoice->>'outlet_id')::uuid;
  v_tanggal date := (p_invoice->>'tanggal')::date;
  v_no text := btrim(coalesce(p_invoice->>'invoice_no', ''));
  v_sumber text;
  v_urut int;
  b jsonb;
  v_baris int := 0;
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  if not is_admin_of_outlet(v_uid, v_outlet) then
    raise exception 'Hanya admin BU atau admin outlet ini yang bisa mencatat penjualan korporat.';
  end if;
  if not exists (select 1 from outlets o where o.id = v_outlet and o.business_unit_id = p_bu) then
    raise exception 'Outlet itu bukan milik BU ini.';
  end if;
  if v_tanggal is null then raise exception 'Tanggal wajib diisi.'; end if;
  if jsonb_array_length(coalesce(p_invoice->'baris', '[]'::jsonb)) = 0 then
    raise exception 'Isi minimal satu baris barang atau jasa.';
  end if;

  if v_id is not null then
    select sumber into v_sumber from bengkel_sale_invoices where id = v_id and business_unit_id = p_bu;
    if v_sumber is null then raise exception 'Invoice tidak ditemukan.'; end if;
    -- Invoice hasil impor TIDAK boleh disunting di sini: impor berikutnya
    -- akan menimpanya tanpa ampun, dan yang menyuntingnya tidak akan pernah
    -- tahu kapan suntingannya hilang.
    if v_sumber <> 'korporat' then
      raise exception 'Invoice ini berasal dari impor Turboly. Perbaiki di Turboly lalu impor ulang — suntingan di sini akan hilang pada impor berikutnya.';
    end if;

    update bengkel_sale_invoices
       set outlet_id = v_outlet, tanggal = v_tanggal,
           customer = p_invoice->>'customer', company = p_invoice->>'company',
           nopol = p_invoice->>'nopol', merek = p_invoice->>'merek', model = p_invoice->>'model',
           pembayaran = p_invoice->>'pembayaran', catatan = p_invoice->>'catatan',
           diubah_at = now(), diubah_by = v_uid
     where id = v_id;
    delete from bengkel_sale_lines where invoice_id = v_id;
  else
    if v_no = '' then
      -- Nomor urut per BU per bulan. `lpad` 4 angka: satu outlet bengkel
      -- tidak mungkin menembus 9999 invoice korporat sebulan, dan nomor
      -- berpanjang tetap lebih mudah dibaca berurutan.
      select 'KRP/' || to_char(v_tanggal, 'YYMM') || '/' ||
             lpad((coalesce(max(substring(invoice_no from '[0-9]+$')::int), 0) + 1)::text, 4, '0')
        into v_no
        from bengkel_sale_invoices
       where business_unit_id = p_bu and sumber = 'korporat'
         and invoice_no like 'KRP/' || to_char(v_tanggal, 'YYMM') || '/%';
    end if;

    insert into bengkel_sale_invoices (business_unit_id, outlet_id, sumber, invoice_no, tanggal,
                                       tipe, status, customer, company, nopol, merek, model,
                                       pembayaran, catatan, created_by)
    values (p_bu, v_outlet, 'korporat', v_no, v_tanggal,
            'Korporat', 'Completed', p_invoice->>'customer', p_invoice->>'company',
            p_invoice->>'nopol', p_invoice->>'merek', p_invoice->>'model',
            p_invoice->>'pembayaran', p_invoice->>'catatan', v_uid)
    returning id into v_id;
  end if;

  v_urut := 0;
  for b in select * from jsonb_array_elements(p_invoice->'baris') loop
    v_urut := v_urut + 1;
    insert into bengkel_sale_lines (invoice_id, urut, item_type, sku, nama, brand, product_type,
                                    qty, harga_satuan, diskon, total, modal, catatan)
    values (v_id, v_urut,
            case when lower(coalesce(b->>'item_type','')) = 'sparepart' then 'sparepart' else 'jasa' end,
            nullif(btrim(coalesce(b->>'sku','')), ''),
            coalesce(nullif(btrim(coalesce(b->>'nama','')), ''), '(tanpa nama)'),
            nullif(btrim(coalesce(b->>'brand','')), ''),
            nullif(btrim(coalesce(b->>'product_type','')), ''),
            coalesce((b->>'qty')::numeric, 0),
            (b->>'harga_satuan')::numeric,
            coalesce((b->>'diskon')::numeric, 0),
            coalesce((b->>'total')::numeric, 0),
            -- Modal yang dikosongkan tetap NULL. Lihat kepala berkas.
            nullif(btrim(coalesce(b->>'modal','')), '')::numeric,
            nullif(btrim(coalesce(b->>'catatan','')), ''));
    v_baris := v_baris + 1;
  end loop;

  return jsonb_build_object('id', v_id, 'invoice_no', v_no, 'baris', v_baris);
end;
$$;

revoke all on function simpan_invoice_korporat(uuid, jsonb) from public;
grant execute on function simpan_invoice_korporat(uuid, jsonb) to authenticated;

/**
 * Hapus invoice.
 *
 * Yang dari IMPOR tidak bisa dihapus di sini: ia akan kembali pada impor
 * berikutnya, dan "sudah saya hapus kok muncul lagi" adalah keadaan yang
 * tidak bisa dijelaskan kepada yang mengalaminya. Yang salah di Turboly
 * dibetulkan di Turboly.
 */
create or replace function hapus_invoice_korporat(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_inv bengkel_sale_invoices%rowtype;
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  select * into v_inv from bengkel_sale_invoices where id = p_id;
  if v_inv.id is null then raise exception 'Invoice tidak ditemukan.'; end if;
  if not is_admin_of_outlet(v_uid, v_inv.outlet_id) then
    raise exception 'Hanya admin BU atau admin outlet ini yang bisa menghapus.';
  end if;
  if v_inv.sumber <> 'korporat' then
    raise exception 'Invoice ini berasal dari impor Turboly dan akan muncul lagi pada impor berikutnya. Betulkan di Turboly, lalu impor ulang.';
  end if;

  delete from bengkel_sale_invoices where id = p_id;
  return jsonb_build_object('invoice_no', v_inv.invoice_no);
end;
$$;

revoke all on function hapus_invoice_korporat(uuid) from public;
grant execute on function hapus_invoice_korporat(uuid) to authenticated;

-- ---------------------------------------------------------
-- 7. VIEW LAPORAN — satu baris per barang, siap disaring
-- ---------------------------------------------------------
create or replace view bengkel_penjualan_rinci as
  select l.id              as line_id,
         i.id              as invoice_id,
         i.business_unit_id,
         i.outlet_id,
         o.name            as outlet_nama,
         i.sumber,
         i.invoice_no,
         i.tanggal,
         i.customer,
         i.company,
         i.nopol,
         i.merek,
         i.model,
         i.pembayaran,
         l.urut,
         l.item_type,
         l.sku,
         l.nama,
         l.brand,
         l.product_type,
         l.qty,
         l.harga_satuan,
         l.diskon,
         l.total,
         l.modal,
         l.laba_turboly,
         -- Laba HANYA kalau modalnya diketahui. `total - coalesce(modal,0)`
         -- akan melaporkan laba penuh untuk baris yang modalnya belum diisi —
         -- dan laporan tidak punya cara membedakannya dari laba sungguhan.
         case when l.modal is null then null else l.total - l.modal end as laba
    from bengkel_sale_lines l
    join bengkel_sale_invoices i on i.id = l.invoice_id
    join outlets o on o.id = i.outlet_id;

alter view bengkel_penjualan_rinci set (security_invoker = true);
grant select on bengkel_penjualan_rinci to authenticated;

comment on view bengkel_penjualan_rinci is
  'Satu baris per barang/jasa terjual di bengkel, dari Turboly maupun korporat. `laba` NULL berarti modalnya belum diketahui — bukan nol.';

-- ---------------------------------------------------------
-- 8. MODUL
-- ---------------------------------------------------------
insert into modules (code, name, description)
values ('penjualan_bengkel_rinci', 'Penjualan Bengkel (Rinci)',
        'Impor Detailed Service Invoice Turboly + input penjualan korporat, beserta laba per baris')
on conflict (code) do nothing;

notify pgrst, 'reload schema';
