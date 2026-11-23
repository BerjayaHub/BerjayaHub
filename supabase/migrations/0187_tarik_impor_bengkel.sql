-- =========================================================
-- 0187 — MENARIK KEMBALI IMPOR TURBOLY
--
--   "apakah dokumen turboly yang sudah diimport bisa dihapus atau ditarik
--    kembali bila salah? jika tidak ada saya mau ada"
--
-- ============ LUBANG YANG DITUTUP ============
--
-- Impor MENGGANTI invoice/PO yang ada di berkas baru. Itu cukup untuk
-- membetulkan angka yang salah, dan TIDAK cukup untuk membatalkan berkas yang
-- salah: mengimpor ekspor store/periode yang keliru memasukkan ratusan baris
-- yang tidak akan pernah tersentuh impor berikutnya — karena nomor invoicenya
-- memang tidak ada di berkas yang benar.
--
-- Sebelum ini, satu-satunya jalan keluar adalah SQL editor.
--
-- ============ SATUANNYA "SEKALI IMPOR", BUKAN BARIS ============
--
-- Tiap penekanan tombol impor mendapat satu nomor (`bengkel_import_runs`),
-- dan tiap baris yang lahir darinya menyimpan nomor itu. Menarik kembali
-- berarti membuang baris milik nomor itu — bukan "semua baris dengan nama
-- berkas X", karena nama berkas bisa sama persis untuk dua impor berbeda.
--
-- ============ YANG SUDAH DIGANTIKAN TIDAK IKUT TERTARIK ============
--
-- Invoice yang diimpor hari Senin lalu DIGANTI oleh impor hari Rabu akan
-- membawa nomor impor hari Rabu. Jadi menarik kembali impor Senin tidak
-- menghapusnya — isinya memang bukan lagi milik Senin. Kalau aturan ini
-- dibalik, menarik impor lama akan melubangi data terbaru, dan lubangnya
-- berbentuk invoice yang hilang tanpa jejak.
-- =========================================================

create table if not exists bengkel_import_runs (
  id               uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references business_units(id) on delete cascade,
  jenis            text not null check (jenis in ('penjualan', 'pembelian')),
  berkas           text,
  periode_dari     date,
  periode_sampai   date,
  -- `invoice` = jumlah invoice (penjualan) atau PO (pembelian) yang disentuh.
  invoice          int not null default 0,
  baris            int not null default 0,
  nilai            numeric not null default 0,
  dibuat_by        uuid references user_profiles(id) on delete set null,
  dibuat_at        timestamptz not null default now(),
  ditarik_at       timestamptz,
  ditarik_by       uuid references user_profiles(id) on delete set null,
  alasan_tarik     text
);

create index if not exists idx_bengkel_run_bu on bengkel_import_runs(business_unit_id, dibuat_at desc);

comment on table bengkel_import_runs is
  'Satu baris per penekanan tombol impor. Dipakai menarik kembali impor yang salah (0187).';

alter table bengkel_sale_invoices add column if not exists import_run_id uuid references bengkel_import_runs(id) on delete set null;
alter table bengkel_purchase_lines add column if not exists import_run_id uuid references bengkel_import_runs(id) on delete set null;
create index if not exists idx_bengkel_inv_run on bengkel_sale_invoices(import_run_id) where import_run_id is not null;
create index if not exists idx_bengkel_beli_run on bengkel_purchase_lines(import_run_id) where import_run_id is not null;

alter table bengkel_import_runs enable row level security;
drop policy if exists bengkel_run_select on bengkel_import_runs;
create policy bengkel_run_select on bengkel_import_runs
  for select to authenticated using (has_bu_scope(auth.uid(), business_unit_id));

-- ---------------------------------------------------------
-- 1. KEDUA FUNGSI IMPOR: mencatat nomor impornya
--
-- Ditulis ulang dari 0185 & 0186 dengan perubahan yang BISA DIHITUNG: satu
-- `insert` ke `bengkel_import_runs` di awal, kolom `import_run_id` ikut
-- ditulis, dan satu `update` ringkasan di akhir. Auditnya membandingkan
-- baris demi baris dengan aslinya — pelajaran 0179.
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
     set invoice = v_baru + v_ganti, baris = v_baris,
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
     set invoice = v_po_baru + v_po_ganti, baris = v_baris,
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
-- 2. TARIK KEMBALI SATU IMPOR
--
-- Dua lapis yang sengaja dipisah:
--
--   `pratinjau_tarik_impor` -> berapa yang akan hilang, TANPA menghapus
--   `tarik_impor_bengkel`   -> menghapusnya
--
-- Penarikan menghapus data dan tidak bisa dibatalkan. Angka yang akan hilang
-- harus bisa dilihat selagi masih bisa dibatalkan — bukan dibaca dari pesan
-- sesudahnya.
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
  else
    select count(distinct po_no), count(*), coalesce(sum(coalesce(total, harga * qty)), 0)
      into v_inv, v_baris, v_nilai
      from bengkel_purchase_lines where import_run_id = p_run;
  end if;

  return jsonb_build_object(
    'jenis', r.jenis,
    'berkas', r.berkas,
    'dibuat_at', r.dibuat_at,
    'ditarik_at', r.ditarik_at,
    -- Yang MASIH milik impor ini — bukan angka saat diimpor dulu. Invoice yang
    -- sudah digantikan impor berikutnya tidak ikut terhitung, dan memang tidak
    -- akan ikut terhapus.
    'invoice', coalesce(v_inv, 0),
    'baris', coalesce(v_baris, 0),
    'nilai', coalesce(v_nilai, 0),
    'sudah_digantikan', greatest(r.invoice - coalesce(v_inv, 0), 0)
  );
end;
$$;

revoke all on function pratinjau_tarik_impor(uuid) from public;
grant execute on function pratinjau_tarik_impor(uuid) to authenticated;

create or replace function tarik_impor_bengkel(p_run uuid, p_alasan text)
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
  -- Alasan wajib: penarikan membuang ratusan baris sekaligus, dan yang
  -- bertanya "ke mana angkanya" bulan depan bukan yang menekan tombolnya.
  if v_alasan is null then raise exception 'Alasan penarikan wajib diisi.'; end if;

  if r.jenis = 'penjualan' then
    select count(*) into v_inv from bengkel_sale_invoices where import_run_id = p_run;
    select count(*) into v_baris from bengkel_sale_lines l
      join bengkel_sale_invoices i on i.id = l.invoice_id where i.import_run_id = p_run;
    -- Barisnya ikut terhapus lewat `on delete cascade` di `bengkel_sale_lines`.
    delete from bengkel_sale_invoices where import_run_id = p_run;
  else
    select count(distinct po_no), count(*) into v_inv, v_baris
      from bengkel_purchase_lines where import_run_id = p_run;
    delete from bengkel_purchase_lines where import_run_id = p_run;
  end if;

  -- Barisnya ditandai ditarik, TIDAK dihapus: riwayat impor adalah
  -- satu-satunya tempat yang bisa menjawab "siapa memasukkan ini, kapan, dan
  -- siapa yang menariknya".
  update bengkel_import_runs
     set ditarik_at = now(), ditarik_by = v_uid, alasan_tarik = v_alasan
   where id = p_run;

  return jsonb_build_object('jenis', r.jenis, 'invoice', coalesce(v_inv, 0), 'baris', coalesce(v_baris, 0));
end;
$$;

revoke all on function tarik_impor_bengkel(uuid, text) from public;
grant execute on function tarik_impor_bengkel(uuid, text) to authenticated;

-- ---------------------------------------------------------
-- 3. HAPUS SATU DOKUMEN HASIL IMPOR
--
-- 0185 MENOLAK ini dengan alasan "ia akan muncul lagi pada impor berikutnya".
-- Alasannya masih benar, tapi menolak sama sekali membuat satu invoice yang
-- jelas keliru hanya bisa dibuang lewat SQL editor.
--
-- Jadi sekarang: BOLEH, dengan kalimat yang mengatakan akibatnya — dan
-- alasannya wajib, supaya yang membaca riwayatnya tahu ini disengaja.
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
  v_n int := 0;
  v_sumber text;
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  if not is_bu_admin(v_uid, p_bu) then
    raise exception 'Hanya Admin BU yang bisa menghapus dokumen hasil impor.';
  end if;
  if v_no = '' then raise exception 'Nomor dokumen wajib diisi.'; end if;
  if v_alasan is null then raise exception 'Alasan penghapusan wajib diisi.'; end if;

  if p_jenis = 'penjualan' then
    select sumber into v_sumber from bengkel_sale_invoices
     where business_unit_id = p_bu and upper(btrim(invoice_no)) = upper(v_no);
    if v_sumber is null then raise exception 'Invoice tidak ditemukan.'; end if;
    -- Invoice korporat punya pintunya sendiri (`hapus_invoice_korporat`), yang
    -- juga memeriksa wewenang per OUTLET. Membiarkannya lewat sini akan
    -- melewati pemeriksaan itu.
    if v_sumber <> 'turboly' then
      raise exception 'Invoice ini bukan hasil impor. Pakai tombol Hapus di tab Korporat.';
    end if;
    delete from bengkel_sale_invoices
     where business_unit_id = p_bu and upper(btrim(invoice_no)) = upper(v_no);
    get diagnostics v_n = row_count;
  elsif p_jenis = 'pembelian' then
    delete from bengkel_purchase_lines
     where business_unit_id = p_bu and upper(btrim(po_no)) = upper(v_no);
    get diagnostics v_n = row_count;
    if v_n = 0 then raise exception 'PO tidak ditemukan.'; end if;
  else
    raise exception 'Jenis dokumen tidak dikenal.';
  end if;

  return jsonb_build_object('jenis', p_jenis, 'nomor', v_no, 'dihapus', v_n);
end;
$$;

revoke all on function hapus_dokumen_impor_bengkel(uuid, text, text, text) from public;
grant execute on function hapus_dokumen_impor_bengkel(uuid, text, text, text) to authenticated;

notify pgrst, 'reload schema';
