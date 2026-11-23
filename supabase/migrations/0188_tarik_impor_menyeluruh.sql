-- =========================================================
-- 0188 — MENARIK IMPOR SAMPAI KE DOKUMEN YANG SUDAH DIGANTIKAN
--
--   "tambahkan lagi bisa hapus satu dokumen excel import yang sudah terlanjur
--    diupload, jadi semua nomor SRI atau PO dalam satu excel yang diimport
--    hilang semua"
--
-- ============ DUA ARTI "HAPUS SATU BERKAS", DAN KEDUANYA MASUK AKAL ============
--
-- 0187 menarik dokumen yang MASIH MILIK impor itu. Dokumen yang sudah
-- digantikan impor berikutnya dibiarkan, karena isinya memang bukan lagi
-- berasal dari berkas yang ditarik.
--
-- Yang diminta di sini lebih keras: seluruh nomor yang PERNAH ADA di berkas
-- itu dihapus, apa pun yang terjadi sesudahnya.
--
-- Keduanya benar untuk keadaan yang berbeda:
--
--   berkas salah, lalu yang benar diimpor   -> yang 0187. Menghapus "semua
--     menimpanya                               nomor di berkas salah" akan
--                                              ikut membuang data yang BENAR.
--
--   berkas salah diimpor dua kali, atau      -> yang ini. Nomornya harus
--     isinya memang harus lenyap seluruhnya    hilang sampai bersih.
--
-- Maka pilihannya diserahkan ke orangnya, DENGAN ANGKANYA: layar menyebut
-- berapa dokumen yang masih milik impor itu dan berapa yang sudah digantikan,
-- sebelum tombolnya ditekan.
--
-- ============ NOMORNYA HARUS DISIMPAN SAAT IMPOR ============
--
-- Sesudah dokumennya dihapus atau berpindah ke impor lain, tidak ada lagi
-- cara mengetahui isi berkas itu dulu apa. Jadi daftar nomornya disimpan di
-- `bengkel_import_runs.nomor_dokumen` pada saat impor — bukan dihitung
-- belakangan dari data yang sudah berubah.
-- =========================================================

alter table bengkel_import_runs add column if not exists nomor_dokumen text[] not null default '{}';

comment on column bengkel_import_runs.nomor_dokumen is
  'Seluruh nomor invoice/PO yang ADA di berkas ini saat diimpor. Dipakai menarik sampai ke dokumen yang sudah digantikan impor lain (0188).';

-- ---------------------------------------------------------
-- 1. KEDUA FUNGSI IMPOR: mencatat nomor dokumennya
--
-- Ditulis ulang dari 0187 dengan perubahan yang bisa dihitung: satu larik
-- pengumpul, dan `nomor_dokumen` ikut ditulis di ringkasan akhirnya.
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
  v_baru int := 0;
  v_ganti int := 0;
  v_baris int := 0;
  v_lewat_store text[] := '{}';
  v_lewat_korporat text[] := '{}';
  v_lewat_kosong text[] := '{}';
  v_nomor text[] := '{}';
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  if not is_bu_admin(v_uid, p_bu) then
    raise exception 'Hanya Admin BU yang bisa mengimpor penjualan Turboly.';
  end if;

  -- ============ TIAP IMPOR PUNYA NOMORNYA SENDIRI (0187) ============
  --
  -- Tanpa ini, "tarik kembali impor yang barusan" tidak punya sasaran: nama
  -- berkas bisa sama, dan baris dari dua impor berbeda tidak bisa dipisahkan.
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
             -- Invoice yang DIGANTI ikut berpindah ke impor terbaru: menarik
             -- kembali impor lama tidak boleh menghapus isi yang sudah
             -- digantikan berkas yang lebih baru.
             import_run_id = v_run,
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
    'dilewati_kosong', to_jsonb(v_lewat_kosong)
  );
end;
$$;
revoke all on function impor_penjualan_bengkel(uuid, jsonb, text) from public;
grant execute on function impor_penjualan_bengkel(uuid, jsonb, text) to authenticated;

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

  -- Nomor impor (0187) — lihat alasannya di `impor_penjualan_bengkel`.
  insert into bengkel_import_runs (business_unit_id, jenis, berkas, dibuat_by)
  values (p_bu, 'pembelian', p_berkas, v_uid)
  returning id into v_run;

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
    'alamat_belum_dipetakan', to_jsonb(v_alamat_belum)
  );
end;
$$;
revoke all on function impor_pembelian_bengkel(uuid, jsonb, text) from public;
grant execute on function impor_pembelian_bengkel(uuid, jsonb, text) to authenticated;

-- ---------------------------------------------------------
-- 2. PRATINJAU: dua angka, bukan satu
-- ---------------------------------------------------------
create or replace function pratinjau_tarik_impor(p_run uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r bengkel_import_runs%rowtype;
  v_inv int := 0;
  v_baris int := 0;
  v_nilai numeric := 0;
  v_lain_dok int := 0;
  v_lain_baris int := 0;
  v_lain_nilai numeric := 0;
begin
  select * into r from bengkel_import_runs where id = p_run;
  if r.id is null then raise exception 'Impor tidak ditemukan.'; end if;
  if not has_bu_scope(auth.uid(), r.business_unit_id) then
    raise exception 'Kamu tidak punya akses ke BU ini.';
  end if;

  if r.jenis = 'penjualan' then
    select count(*) into v_inv from bengkel_sale_invoices where import_run_id = p_run;
    select count(*), coalesce(sum(l.total), 0) into v_baris, v_nilai
      from bengkel_sale_lines l join bengkel_sale_invoices i on i.id = l.invoice_id
     where i.import_run_id = p_run;

    -- Dokumen yang nomornya ADA di berkas ini tapi sekarang milik impor lain.
    -- Angka inilah yang membuat pilihan "hapus semuanya" bisa diputuskan
    -- dengan sadar, bukan ditebak.
    select count(*) into v_lain_dok from bengkel_sale_invoices
     where business_unit_id = r.business_unit_id
       and upper(btrim(invoice_no)) = any(r.nomor_dokumen)
       and (import_run_id is distinct from p_run);
    select count(*), coalesce(sum(l.total), 0) into v_lain_baris, v_lain_nilai
      from bengkel_sale_lines l join bengkel_sale_invoices i on i.id = l.invoice_id
     where i.business_unit_id = r.business_unit_id
       and upper(btrim(i.invoice_no)) = any(r.nomor_dokumen)
       and (i.import_run_id is distinct from p_run);
  else
    select count(distinct po_no), count(*), coalesce(sum(coalesce(total, harga * qty)), 0)
      into v_inv, v_baris, v_nilai
      from bengkel_purchase_lines where import_run_id = p_run;
    select count(distinct po_no), count(*), coalesce(sum(coalesce(total, harga * qty)), 0)
      into v_lain_dok, v_lain_baris, v_lain_nilai
      from bengkel_purchase_lines
     where business_unit_id = r.business_unit_id
       and upper(btrim(po_no)) = any(r.nomor_dokumen)
       and (import_run_id is distinct from p_run);
  end if;

  return jsonb_build_object(
    'jenis', r.jenis,
    'berkas', r.berkas,
    'dibuat_at', r.dibuat_at,
    'ditarik_at', r.ditarik_at,
    'invoice', coalesce(v_inv, 0),
    'baris', coalesce(v_baris, 0),
    'nilai', coalesce(v_nilai, 0),
    'nomor_di_berkas', coalesce(array_length(r.nomor_dokumen, 1), 0),
    -- Dulu bernama `sudah_digantikan` dan cuma berupa selisih hitungan.
    -- Sekarang dihitung dari nomornya sendiri, beserta baris & nilainya —
    -- supaya yang memilih "hapus semuanya" tahu persis apa yang ikut hilang.
    'sudah_digantikan', coalesce(v_lain_dok, 0),
    'digantikan_baris', coalesce(v_lain_baris, 0),
    'digantikan_nilai', coalesce(v_lain_nilai, 0)
  );
end;
$$;

revoke all on function pratinjau_tarik_impor(uuid) from public;
grant execute on function pratinjau_tarik_impor(uuid) to authenticated;

-- ---------------------------------------------------------
-- 3. TARIK, DENGAN PILIHAN
--
-- Tanda tangan LAMA (2 argumen) sengaja DIBUANG, bukan dibiarkan hidup
-- berdampingan. PostgREST memilih fungsi lewat himpunan nama argumen; kalau
-- yang lama tetap ada, PWA versi lama akan memanggilnya dan mendapat
-- penarikan yang TIDAK menyeluruh — diam-diam berbeda dari yang terlihat di
-- layar barunya.
-- ---------------------------------------------------------
drop function if exists tarik_impor_bengkel(uuid, text);

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
  v_inv int := 0;
  v_baris int := 0;
  v_lain int := 0;
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  select * into r from bengkel_import_runs where id = p_run;
  if r.id is null then raise exception 'Impor tidak ditemukan.'; end if;
  if not is_bu_admin(v_uid, r.business_unit_id) then
    raise exception 'Hanya Admin BU yang bisa menarik kembali impor.';
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
      -- SELURUH nomor yang pernah ada di berkas ini — termasuk yang sudah
      -- digantikan impor lain. Invoice KORPORAT tidak pernah ikut: ia tidak
      -- pernah berasal dari berkas mana pun, dan nomornya tidak mungkin sama.
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
         -- Cara penarikannya ikut tercatat di alasannya. Yang membaca riwayat
         -- ini bulan depan perlu tahu apakah data dari impor LAIN ikut
         -- terbawa — itu pertanyaan pertama saat ada angka yang hilang.
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

comment on function tarik_impor_bengkel(uuid, text, boolean) is
  'Tarik kembali satu impor. `p_semua` = ikut menghapus dokumen yang nomornya ada di berkas itu tapi sudah digantikan impor lain (0188).';

notify pgrst, 'reload schema';
