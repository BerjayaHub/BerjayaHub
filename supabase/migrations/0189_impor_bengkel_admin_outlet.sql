-- =========================================================
-- Berjaya Hub OMS — 0189
-- ADMIN OUTLET BISA MENGIMPOR TURBOLY (dibatasi outletnya)
--
--   "scope admin outlet juga bisa akses dan upload / import dari turboly
--    silahkan revisi"
--
-- =========================================================
-- KENAPA INI BUKAN SEKADAR MELONGGARKAN SATU `IF`
-- =========================================================
--
-- Satu berkas ekspor Turboly bisa memuat BEBERAPA store sekaligus — itu bukan
-- dugaan, berkas Oktober si pemakai memang begitu. Dan impor di modul ini
-- bekerja dengan cara MENGGANTI: tiap invoice (0185) dan tiap PO (0186)
-- dihapus isinya lalu diisi ulang, supaya impor ulang tidak menggandakan
-- omzet.
--
-- Gabungan dua sifat itu berarti: kalau `is_bu_admin` di fungsi impor diganti
-- begitu saja menjadi "admin outlet juga boleh", maka admin outlet Malang yang
-- mengunggah berkas berisi cabang lain akan MENIMPA dan MENGHAPUS data cabang
-- lain. Tidak ada galat, tidak ada penolakan; angkanya cuma berpindah pemilik,
-- dan yang menemukannya adalah cabang yang datanya hilang — kalau ia
-- menemukannya.
--
-- Jadi yang dilonggarkan bukan "siapa yang boleh memanggil", tapi "baris mana
-- yang ikut diproses":
--
--   Admin BU      -> seluruh isi berkas, seperti sebelumnya.
--   Admin outlet  -> hanya baris yang jatuh ke outlet yang ia pegang. Baris
--                    outlet lain DILEWATI dan DILAPORKAN — tidak hilang
--                    diam-diam, karena baris yang hilang tanpa keterangan
--                    adalah bentuk kegagalan yang paling lama bertahan di
--                    modul ini.
--
-- Pembelian PUSAT (alamat kirimnya tidak terpetakan ke outlet mana pun) tetap
-- BOLEH dimasukkan admin outlet: ia menambah, tidak menimpa milik siapa pun.
-- Menghapusnya tetap hanya Admin BU — sebabnya ada di bagian 5.

-- ---------------------------------------------------------
-- 1. HELPER: outlet mana yang dipegang orang ini di BU ini
--
-- Mengembalikan LARIK, bukan boolean: pertanyaan di seluruh berkas ini bukan
-- "apakah ia admin outlet" tapi "outlet yang mana" — dan boolean memaksa tiap
-- pemanggil menyusun ulang jawabannya sendiri, yang berarti empat tempat yang
-- bisa menyimpang.
--
-- Larik KOSONG berarti bukan admin outlet di BU ini. Super admin & admin BU
-- sengaja TIDAK dimasukkan ke sini: mereka dijawab `is_bu_admin`, dan
-- mencampurnya akan membuat "larik kosong" berarti dua hal berbeda.
-- ---------------------------------------------------------
create or replace function outlet_admin_saya(p_user_id uuid, p_bu uuid)
returns uuid[]
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(array_agg(distinct ms.outlet_id), '{}'::uuid[])
    from membership_scopes ms
    join outlets o on o.id = ms.outlet_id
   where ms.user_id = p_user_id
     and ms.role = 'outlet_admin'
     and ms.outlet_id is not null
     and o.business_unit_id = p_bu;
$$;

revoke all on function outlet_admin_saya(uuid, uuid) from public;
grant execute on function outlet_admin_saya(uuid, uuid) to authenticated;

comment on function outlet_admin_saya(uuid, uuid) is
  'Outlet yang dipegang user sebagai outlet_admin di satu BU. Larik kosong = bukan admin outlet di BU itu (admin BU & super admin dijawab is_bu_admin).';

-- ---------------------------------------------------------
-- 2. PEMETAAN STORE & ALAMAT KIRIM
--
-- Admin outlet boleh memetakan — tapi HANYA ke outlet yang ia pegang. Tanpa
-- ini ia mentok total: store baru muncul di berkas, impornya dilewati, dan
-- satu-satunya jalan adalah menunggu Admin BU.
--
-- Yang tetap tertutup: MEMINDAHKAN pemetaan yang sekarang menunjuk outlet
-- lain. Pemetaan menentukan ke outlet mana seluruh angka berkas itu masuk,
-- jadi memindahkannya diam-diam adalah cara memindahkan omzet cabang lain ke
-- cabang sendiri tanpa menyentuh satu pun baris penjualan.
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
  v_bu_admin boolean;
  v_saya uuid[];
  v_lama uuid;
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  v_bu_admin := is_bu_admin(v_uid, p_bu);
  v_saya := outlet_admin_saya(v_uid, p_bu);
  if not v_bu_admin and coalesce(array_length(v_saya, 1), 0) = 0 then
    raise exception 'Hanya Admin BU atau admin outlet di BU ini yang bisa memetakan store Turboly.';
  end if;
  if v_store = '' then raise exception 'Nama store wajib diisi.'; end if;
  if not exists (select 1 from outlets o where o.id = p_outlet and o.business_unit_id = p_bu) then
    raise exception 'Outlet itu bukan milik BU ini.';
  end if;

  if not v_bu_admin then
    if not (p_outlet = any(v_saya)) then
      raise exception 'Kamu hanya bisa memetakan store ke outlet yang kamu pegang.';
    end if;
    select outlet_id into v_lama from bengkel_store_map
     where business_unit_id = p_bu and jenis = 'store' and lower(btrim(store_name)) = lower(v_store);
    if v_lama is not null and not (v_lama = any(v_saya)) then
      raise exception 'Store ini sekarang terpetakan ke outlet lain. Minta Admin BU kalau memang harus dipindah.';
    end if;
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

create or replace function petakan_tujuan_kirim(p_bu uuid, p_alamat text, p_outlet uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_alamat text := regexp_replace(btrim(coalesce(p_alamat, '')), '\s+', ' ', 'g');
  v_bu_admin boolean;
  v_saya uuid[];
  v_lama uuid;
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  v_bu_admin := is_bu_admin(v_uid, p_bu);
  v_saya := outlet_admin_saya(v_uid, p_bu);
  if not v_bu_admin and coalesce(array_length(v_saya, 1), 0) = 0 then
    raise exception 'Hanya Admin BU atau admin outlet di BU ini yang bisa memetakan alamat kirim.';
  end if;
  if v_alamat = '' then raise exception 'Alamat kirim wajib diisi.'; end if;
  if not exists (select 1 from outlets o where o.id = p_outlet and o.business_unit_id = p_bu) then
    raise exception 'Outlet itu bukan milik BU ini.';
  end if;

  if not v_bu_admin then
    if not (p_outlet = any(v_saya)) then
      raise exception 'Kamu hanya bisa memetakan alamat kirim ke outlet yang kamu pegang.';
    end if;
    select outlet_id into v_lama from bengkel_store_map
     where business_unit_id = p_bu and jenis = 'kirim' and lower(btrim(store_name)) = lower(v_alamat);
    if v_lama is not null and not (v_lama = any(v_saya)) then
      raise exception 'Alamat ini sekarang terpetakan ke outlet lain. Minta Admin BU kalau memang harus dipindah.';
    end if;
  end if;

  insert into bengkel_store_map (business_unit_id, store_name, outlet_id, jenis, created_by)
  values (p_bu, v_alamat, p_outlet, 'kirim', v_uid)
  on conflict (business_unit_id, jenis, lower(btrim(store_name)))
  do update set outlet_id = excluded.outlet_id, created_by = excluded.created_by, created_at = now();

  -- Baris yang SUDAH terlanjur masuk sebagai pusat ikut dibetulkan (0186).
  -- Hanya yang `outlet_id is null`: baris yang sudah punya outlet milik orang
  -- lain tidak pernah tersentuh di sini.
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
-- 3. IMPOR PENJUALAN
--
-- Ditulis ulang dari 0188. Yang berubah bisa dihitung:
--   a. wewenangnya: admin BU ATAU admin outlet;
--   b. satu penjagaan baru per invoice, SEBELUM apa pun ditulis atau dihapus;
--   c. satu larik laporan baru: `dilewati_outlet_lain`.
--
-- Sisanya SAMA PERSIS — termasuk urutan `delete` lalu `insert` baris, dan
-- perpindahan `import_run_id` pada invoice yang diganti.
-- ---------------------------------------------------------
create or replace function impor_penjualan_bengkel(p_bu uuid, p_invoices jsonb, p_berkas text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_run uuid;
  inv jsonb;
  b jsonb;
  v_store text;
  v_outlet uuid;
  v_no text;
  v_id uuid;
  v_sumber text;
  v_outlet_lama uuid;
  v_bu_admin boolean;
  v_saya uuid[];
  v_baru int := 0;
  v_ganti int := 0;
  v_baris int := 0;
  v_lewat_store text[] := '{}';
  v_lewat_korporat text[] := '{}';
  v_lewat_kosong text[] := '{}';
  v_lewat_outlet text[] := '{}';
  v_nomor text[] := '{}';
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  v_bu_admin := is_bu_admin(v_uid, p_bu);
  v_saya := outlet_admin_saya(v_uid, p_bu);
  if not v_bu_admin and coalesce(array_length(v_saya, 1), 0) = 0 then
    raise exception 'Hanya Admin BU atau admin outlet di BU ini yang bisa mengimpor penjualan Turboly.';
  end if;

  -- ============ TIAP IMPOR PUNYA NOMORNYA SENDIRI (0187) ============
  insert into bengkel_import_runs (business_unit_id, jenis, berkas, dibuat_by)
  values (p_bu, 'penjualan', p_berkas, v_uid)
  returning id into v_run;

  for inv in select * from jsonb_array_elements(coalesce(p_invoices, '[]'::jsonb)) loop
    v_no := btrim(coalesce(inv->>'invoice_no', ''));
    v_store := regexp_replace(btrim(coalesce(inv->>'store', '')), '\s+', ' ', 'g');
    continue when v_no = '';

    if jsonb_array_length(coalesce(inv->'baris', '[]'::jsonb)) = 0 then
      v_lewat_kosong := v_lewat_kosong || v_no;
      continue;
    end if;

    -- `jenis = 'store'` IKUT DISARING (perbaikan ikutan di 0189).
    --
    -- Sejak 0186 tabel ini memegang dua macam pemetaan, dan indeks uniknya
    -- (bu, jenis, nama) membolehkan satu nama hidup di keduanya. Tanpa
    -- saringan ini, nama store yang kebetulan sama dengan alamat kirim bisa
    -- terjawab oleh baris `kirim` — `select into` mengambil baris pertama
    -- tanpa galat, jadi penjualannya masuk ke outlet yang salah dan tidak ada
    -- apa pun yang menandainya.
    select outlet_id into v_outlet from bengkel_store_map
     where business_unit_id = p_bu and jenis = 'store' and lower(btrim(store_name)) = lower(v_store);
    if v_outlet is null then
      if not (v_store = any(v_lewat_store)) then v_lewat_store := v_lewat_store || v_store; end if;
      continue;
    end if;

    select id, sumber, outlet_id into v_id, v_sumber, v_outlet_lama from bengkel_sale_invoices
     where business_unit_id = p_bu and upper(btrim(invoice_no)) = upper(v_no);

    if v_id is not null and v_sumber = 'korporat' then
      v_lewat_korporat := v_lewat_korporat || v_no;
      continue;
    end if;

    -- ============ BATAS OUTLET (0189) ============
    --
    -- Diperiksa SEBELUM satu pun `delete` atau `update` di bawah. Ditaruh
    -- sesudahnya, invoice outlet lain tetap terhapus lebih dulu lalu barisnya
    -- "dilewati" — pelaporan yang rapi di atas data yang sudah hilang.
    --
    -- Dua arah sama-sama diperiksa:
    --   store berkas ini menunjuk outlet lain  -> bukan wewenangnya;
    --   invoicenya SUDAH ADA milik outlet lain  -> pemetaan store yang berubah
    --   tidak boleh jadi jalan memindahkan invoice cabang lain ke sini.
    if not v_bu_admin and (
      not (v_outlet = any(v_saya))
      or (v_id is not null and v_outlet_lama is not null and not (v_outlet_lama = any(v_saya)))
    ) then
      if not (v_store = any(v_lewat_outlet)) then v_lewat_outlet := v_lewat_outlet || v_store; end if;
      continue;
    end if;

    if not (upper(v_no) = any(v_nomor)) then v_nomor := v_nomor || upper(v_no); end if;

    if v_id is null then
      insert into bengkel_sale_invoices (business_unit_id, outlet_id, sumber, invoice_no, tanggal, tipe, status,
                                         customer, company, nopol, merek, model, work_order, service_order,
                                         pembayaran, berkas, diimpor_at, diimpor_by, created_by, import_run_id)
      values (p_bu, v_outlet, 'turboly', v_no, (inv->>'tanggal')::date, inv->>'tipe', inv->>'status',
              inv->>'customer', inv->>'company', inv->>'nopol', inv->>'merek', inv->>'model',
              inv->>'work_order', inv->>'service_order', inv->>'pembayaran',
              p_berkas, now(), v_uid, v_uid, v_run)
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
             -- Invoice yang DIGANTI ikut berpindah ke impor terbaru (0187).
             import_run_id = v_run,
             diubah_at = now(), diubah_by = v_uid
       where id = v_id;
      -- Isi lamanya dibuang SELURUHNYA, baru diisi ulang (0185).
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

  update bengkel_import_runs
     set invoice = v_baru + v_ganti, baris = v_baris, nomor_dokumen = v_nomor,
         periode_dari = (select min(tanggal) from bengkel_sale_invoices where import_run_id = v_run),
         periode_sampai = (select max(tanggal) from bengkel_sale_invoices where import_run_id = v_run),
         nilai = (select coalesce(sum(l.total), 0) from bengkel_sale_lines l
                   join bengkel_sale_invoices i on i.id = l.invoice_id where i.import_run_id = v_run)
   where id = v_run;

  return jsonb_build_object(
    'run', v_run,
    'invoice_baru', v_baru,
    'invoice_diganti', v_ganti,
    'baris', v_baris,
    'store_belum_dipetakan', to_jsonb(v_lewat_store),
    'dilewati_korporat', to_jsonb(v_lewat_korporat),
    'dilewati_kosong', to_jsonb(v_lewat_kosong),
    -- Store yang ADA di berkas tapi bukan wewenang pengunggahnya. Wajib
    -- ditampilkan: tanpa ini ia menyangka seluruh berkasnya masuk.
    'dilewati_outlet_lain', to_jsonb(v_lewat_outlet)
  );
end;
$$;
revoke all on function impor_penjualan_bengkel(uuid, jsonb, text) from public;
grant execute on function impor_penjualan_bengkel(uuid, jsonb, text) to authenticated;

-- ---------------------------------------------------------
-- 4. IMPOR PEMBELIAN
--
-- Perubahan terbesar ada DI SINI, dan bukan di baris wewenangnya.
--
-- Di 0188, blok "PO pertama kali disentuh -> hapus isi lamanya" berjalan
-- SEBELUM alamat kirim dibaca. Urutan itu tidak apa-apa selama yang mengimpor
-- adalah admin BU. Begitu admin outlet ikut boleh, urutan itu menjadi lubang
-- yang paling mahal di seluruh modul: PO milik cabang lain akan dihapus lebih
-- dulu, lalu seluruh barisnya "dilewati karena outlet lain" — laporan
-- penghapusannya rapi, datanya tetap hilang.
--
-- Jadi sekarang alamat & outlet dibaca DULU, penjagaannya jalan, baru PO-nya
-- disentuh.
-- ---------------------------------------------------------
create or replace function impor_pembelian_bengkel(p_bu uuid, p_baris jsonb, p_berkas text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_run uuid;
  b jsonb;
  v_po text;
  v_alamat text;
  v_outlet uuid;
  v_urut int;
  v_bu_admin boolean;
  v_saya uuid[];
  v_po_baru int := 0;
  v_po_ganti int := 0;
  v_baris int := 0;
  v_tanpa_sku int := 0;
  v_pusat int := 0;
  v_lewat int := 0;
  v_lewat_outlet int := 0;
  v_alamat_belum text[] := '{}';
  v_alamat_lain text[] := '{}';
  v_po_terproses text[] := '{}';
  v_po_ditolak text[] := '{}';
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  v_bu_admin := is_bu_admin(v_uid, p_bu);
  v_saya := outlet_admin_saya(v_uid, p_bu);
  if not v_bu_admin and coalesce(array_length(v_saya, 1), 0) = 0 then
    raise exception 'Hanya Admin BU atau admin outlet di BU ini yang bisa mengimpor pembelian.';
  end if;

  -- Nomor impor (0187).
  insert into bengkel_import_runs (business_unit_id, jenis, berkas, dibuat_by)
  values (p_bu, 'pembelian', p_berkas, v_uid)
  returning id into v_run;

  for b in select * from jsonb_array_elements(coalesce(p_baris, '[]'::jsonb)) loop
    v_po := btrim(coalesce(b->>'po_no', ''));
    if v_po = '' or btrim(coalesce(b->>'tanggal', '')) = '' then
      v_lewat := v_lewat + 1;
      continue;
    end if;

    -- ---- Alamat & outlet dibaca DULU (lihat kepala bagian ini) ----
    v_alamat := regexp_replace(btrim(coalesce(b->>'kirim_ke', '')), '\s+', ' ', 'g');
    v_outlet := null;
    if v_alamat <> '' then
      select outlet_id into v_outlet from bengkel_store_map
       where business_unit_id = p_bu and jenis = 'kirim' and lower(btrim(store_name)) = lower(v_alamat);
      if v_outlet is null and not (v_alamat = any(v_alamat_belum)) then
        v_alamat_belum := v_alamat_belum || v_alamat;
      end if;
    end if;

    -- ============ BATAS OUTLET (0189) ============
    --
    -- `v_outlet is null` = PEMBELIAN PUSAT, dan itu TETAP BOLEH: ia menambah
    -- baris baru, tidak menimpa milik siapa pun. Yang ditolak adalah baris
    -- yang jelas-jelas milik outlet lain.
    if not v_bu_admin and v_outlet is not null and not (v_outlet = any(v_saya)) then
      v_lewat_outlet := v_lewat_outlet + 1;
      if not (v_alamat = any(v_alamat_lain)) then v_alamat_lain := v_alamat_lain || v_alamat; end if;
      continue;
    end if;

    -- PO yang sudah ada di database tapi barisnya milik outlet lain: SELURUH
    -- PO itu dilewati. Satu PO adalah satu dokumen yang diganti utuh, jadi
    -- ikut menulis sebagiannya berarti meninggalkan dokumen setengah —
    -- separuh dari berkas lama, separuh dari yang baru, dan tidak ada apa pun
    -- di layar yang mengatakannya.
    if not v_bu_admin and not (upper(v_po) = any(v_po_terproses)) and not (upper(v_po) = any(v_po_ditolak)) then
      if exists (
        select 1 from bengkel_purchase_lines
         where business_unit_id = p_bu and upper(btrim(po_no)) = upper(v_po)
           and outlet_id is not null and not (outlet_id = any(v_saya))
      ) then
        v_po_ditolak := v_po_ditolak || upper(v_po);
      end if;
    end if;
    if upper(v_po) = any(v_po_ditolak) then
      v_lewat_outlet := v_lewat_outlet + 1;
      continue;
    end if;

    -- PO yang baru pertama disentuh dalam panggilan ini: buang isi lamanya
    -- SEKALI, lalu baris-baris berikutnya menumpuk di atasnya (0186).
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

    if v_outlet is null then v_pusat := v_pusat + 1; end if;

    v_urut := coalesce(v_urut, 0) + 1;
    insert into bengkel_purchase_lines (business_unit_id, outlet_id, po_no, urut, tanggal, supplier, supplier_kode,
                                        referensi, status, pengirim, warehouse, kirim_ke, sku, nama,
                                        product_type, product_code, qty, harga, total, berkas, diimpor_by, import_run_id)
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
            p_berkas, v_uid, v_run);
    v_baris := v_baris + 1;
    if nullif(btrim(coalesce(b->>'sku','')), '') is null then v_tanpa_sku := v_tanpa_sku + 1; end if;
  end loop;

  update bengkel_import_runs
     set invoice = v_po_baru + v_po_ganti, baris = v_baris, nomor_dokumen = v_po_terproses,
         periode_dari = (select min(tanggal) from bengkel_purchase_lines where import_run_id = v_run),
         periode_sampai = (select max(tanggal) from bengkel_purchase_lines where import_run_id = v_run),
         nilai = (select coalesce(sum(coalesce(total, harga * qty)), 0) from bengkel_purchase_lines where import_run_id = v_run)
   where id = v_run;

  return jsonb_build_object(
    'run', v_run,
    'po_baru', v_po_baru,
    'po_diganti', v_po_ganti,
    'baris', v_baris,
    'tanpa_sku', v_tanpa_sku,
    'ke_pusat', v_pusat,
    'dilewati', v_lewat,
    'alamat_belum_dipetakan', to_jsonb(v_alamat_belum),
    -- Dua angka terpisah: BERAPA baris yang dilewati, dan ALAMAT mana saja
    -- penyebabnya. Satu angka tanpa alamatnya tidak bisa ditindaklanjuti.
    'dilewati_outlet_lain', v_lewat_outlet,
    'alamat_outlet_lain', to_jsonb(v_alamat_lain)
  );
end;
$$;
revoke all on function impor_pembelian_bengkel(uuid, jsonb, text) from public;
grant execute on function impor_pembelian_bengkel(uuid, jsonb, text) to authenticated;

-- ---------------------------------------------------------
-- 5. TARIK KEMBALI
--
-- Admin outlet boleh menarik UNGGAHANNYA SENDIRI. Penghapusannya memakai
-- `import_run_id`, jadi jangkauannya memang tepat sebatas baris yang ia
-- masukkan sendiri — tidak ada cara ia menyentuh baris orang lain lewat sini.
--
-- Dua hal tetap tertutup:
--   - unggahan ORANG LAIN, walau di outlet yang sama. "Angkanya kok hilang"
--     yang jawabannya "ditarik rekan sesama admin" adalah percakapan yang
--     tidak punya ujung;
--   - `p_semua`, yang menyapu berdasar NOMOR DOKUMEN lintas impor. Jangkauannya
--     seluruh BU, jadi ia milik Admin BU.
-- ---------------------------------------------------------
create or replace function tarik_impor_bengkel(p_run uuid, p_alasan text, p_semua boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  r bengkel_import_runs%rowtype;
  v_alasan text := nullif(btrim(coalesce(p_alasan, '')), '');
  v_bu_admin boolean;
  v_inv int := 0;
  v_baris int := 0;
  v_lain int := 0;
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  select * into r from bengkel_import_runs where id = p_run;
  if r.id is null then raise exception 'Impor tidak ditemukan.'; end if;

  v_bu_admin := is_bu_admin(v_uid, r.business_unit_id);
  if not v_bu_admin then
    if coalesce(array_length(outlet_admin_saya(v_uid, r.business_unit_id), 1), 0) = 0 then
      raise exception 'Hanya Admin BU atau admin outlet di BU ini yang bisa menarik kembali impor.';
    end if;
    if r.dibuat_by is distinct from v_uid then
      raise exception 'Impor ini diunggah orang lain. Minta Admin BU untuk menariknya.';
    end if;
    if p_semua then
      raise exception 'Penarikan menyeluruh (termasuk dokumen dari impor lain) hanya bisa dilakukan Admin BU.';
    end if;
  end if;

  if r.ditarik_at is not null then
    raise exception 'Impor ini sudah ditarik sebelumnya.';
  end if;
  if v_alasan is null then raise exception 'Alasan penarikan wajib diisi.'; end if;

  if r.jenis = 'penjualan' then
    select count(*) into v_inv from bengkel_sale_invoices where import_run_id = p_run;
    select count(*) into v_baris from bengkel_sale_lines l
      join bengkel_sale_invoices i on i.id = l.invoice_id where i.import_run_id = p_run;
    delete from bengkel_sale_invoices where import_run_id = p_run;

    if p_semua and coalesce(array_length(r.nomor_dokumen, 1), 0) > 0 then
      -- SELURUH nomor yang pernah ada di berkas ini (0188). Invoice KORPORAT
      -- tidak pernah ikut.
      delete from bengkel_sale_invoices
       where business_unit_id = r.business_unit_id
         and sumber = 'turboly'
         and upper(btrim(invoice_no)) = any(r.nomor_dokumen);
      get diagnostics v_lain = row_count;
    end if;
  else
    select count(distinct po_no), count(*) into v_inv, v_baris
      from bengkel_purchase_lines where import_run_id = p_run;
    delete from bengkel_purchase_lines where import_run_id = p_run;

    if p_semua and coalesce(array_length(r.nomor_dokumen, 1), 0) > 0 then
      delete from bengkel_purchase_lines
       where business_unit_id = r.business_unit_id
         and upper(btrim(po_no)) = any(r.nomor_dokumen);
      get diagnostics v_lain = row_count;
    end if;
  end if;

  update bengkel_import_runs
     set ditarik_at = now(), ditarik_by = v_uid,
         alasan_tarik = v_alasan || case when p_semua then ' [menyeluruh: termasuk dokumen yang sudah digantikan]' else '' end
   where id = p_run;

  return jsonb_build_object(
    'jenis', r.jenis,
    'invoice', coalesce(v_inv, 0),
    'baris', coalesce(v_baris, 0),
    'ikut_terhapus', coalesce(v_lain, 0)
  );
end;
$$;

revoke all on function tarik_impor_bengkel(uuid, text, boolean) from public;
grant execute on function tarik_impor_bengkel(uuid, text, boolean) to authenticated;

-- ---------------------------------------------------------
-- 6. HAPUS SATU DOKUMEN
--
-- Admin outlet boleh — kalau dokumennya memang milik outletnya.
--
-- Pembelian PUSAT (outlet_id null) TIDAK termasuk, walau membuatnya boleh.
-- Asimetrinya disengaja: membuat menambah baris yang tidak pernah ada,
-- menghapus membuang baris yang mungkin dimasukkan orang lain untuk keperluan
-- yang tidak terlihat dari sini.
-- ---------------------------------------------------------
create or replace function hapus_dokumen_impor_bengkel(p_bu uuid, p_jenis text, p_nomor text, p_alasan text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_alasan text := nullif(btrim(coalesce(p_alasan, '')), '');
  v_no text := btrim(coalesce(p_nomor, ''));
  v_bu_admin boolean;
  v_saya uuid[];
  v_n int := 0;
  v_sumber text;
  v_outlet uuid;
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  v_bu_admin := is_bu_admin(v_uid, p_bu);
  v_saya := outlet_admin_saya(v_uid, p_bu);
  if not v_bu_admin and coalesce(array_length(v_saya, 1), 0) = 0 then
    raise exception 'Hanya Admin BU atau admin outlet di BU ini yang bisa menghapus dokumen hasil impor.';
  end if;
  if v_no = '' then raise exception 'Nomor dokumen wajib diisi.'; end if;
  if v_alasan is null then raise exception 'Alasan penghapusan wajib diisi.'; end if;

  if p_jenis = 'penjualan' then
    select sumber, outlet_id into v_sumber, v_outlet from bengkel_sale_invoices
     where business_unit_id = p_bu and upper(btrim(invoice_no)) = upper(v_no);
    if v_sumber is null then raise exception 'Invoice tidak ditemukan.'; end if;
    -- Invoice korporat punya pintunya sendiri (`hapus_invoice_korporat`), yang
    -- juga memeriksa wewenang per OUTLET (0185).
    if v_sumber <> 'turboly' then
      raise exception 'Invoice ini bukan hasil impor. Pakai tombol Hapus di tab Korporat.';
    end if;
    if not v_bu_admin and (v_outlet is null or not (v_outlet = any(v_saya))) then
      raise exception 'Invoice ini bukan milik outlet yang kamu pegang.';
    end if;
    delete from bengkel_sale_invoices
     where business_unit_id = p_bu and upper(btrim(invoice_no)) = upper(v_no);
    get diagnostics v_n = row_count;
  elsif p_jenis = 'pembelian' then
    if not exists (select 1 from bengkel_purchase_lines
                    where business_unit_id = p_bu and upper(btrim(po_no)) = upper(v_no)) then
      raise exception 'PO tidak ditemukan.';
    end if;
    -- SELURUH barisnya harus milik outletnya. Satu baris saja yang bukan —
    -- termasuk baris pusat — membuat penghapusan ini melebihi wewenangnya,
    -- dan menghapus sebagiannya akan meninggalkan PO setengah yang tidak
    -- terlihat salah di laporan mana pun.
    if not v_bu_admin and exists (
      select 1 from bengkel_purchase_lines
       where business_unit_id = p_bu and upper(btrim(po_no)) = upper(v_no)
         and (outlet_id is null or not (outlet_id = any(v_saya)))
    ) then
      raise exception 'PO ini memuat baris di luar outlet yang kamu pegang. Minta Admin BU.';
    end if;
    delete from bengkel_purchase_lines
     where business_unit_id = p_bu and upper(btrim(po_no)) = upper(v_no);
    get diagnostics v_n = row_count;
  else
    raise exception 'Jenis dokumen tidak dikenal.';
  end if;

  return jsonb_build_object('jenis', p_jenis, 'nomor', v_no, 'dihapus', v_n);
end;
$$;

revoke all on function hapus_dokumen_impor_bengkel(uuid, text, text, text) from public;
grant execute on function hapus_dokumen_impor_bengkel(uuid, text, text, text) to authenticated;

notify pgrst, 'reload schema';
