-- =========================================================
-- Berjaya Hub OMS — 0191
-- (1) PEMBELIAN MANUAL di Berjaya Hub, sejajar dengan invoice korporat
-- (2) HAPUS MASSAL master sparepart
--
--   "di jalur input manual dari berjaya hub, saya ingin bukan hanya pembelian
--    saja, tetapi penjualan juga"
--   "sediakan juga hapus massal di modul sparepart dan jasa ini"
--
-- =========================================================
-- BAGIAN 1 — PEMBELIAN MANUAL
-- =========================================================
--
-- Penjualan sudah punya dua jalur sejak 0185: `turboly` (impor) dan
-- `korporat` (diketik di sini). Pembelian baru punya satu: impor. Pembelian
-- yang tidak lewat Turboly — beli langsung di toko sebelah, bon tulis tangan —
-- tidak punya tempat sama sekali, dan yang terjadi di lapangan adalah
-- pengeluarannya tidak tercatat di mana pun.
--
-- ============ KENAPA KOLOM `sumber`, BUKAN TABEL BARU ============
--
-- Tabel kedua berarti tiap laporan, tiap pencocokan FIFO, dan tiap rekap harus
-- ingat untuk membaca KEDUANYA. Yang lupa tidak mendapat galat — ia mendapat
-- angka yang lebih kecil, dan angka yang lebih kecil terlihat seperti bulan
-- yang sepi.
--
-- Satu tabel dengan satu kolom pembeda: laporan lama ikut memuatnya tanpa
-- disentuh, dan yang perlu membedakannya bisa menyaring.
--
-- ============ YANG DIJAGA: IMPOR TIDAK BOLEH MENIMPANYA ============
--
-- Impor Turboly mengganti isi PO per nomor. Kalau pembelian manual memakai
-- ruang nomor yang sama, satu nomor PO yang kebetulan bentrok akan menghapus
-- bon yang diketik orang — dan tidak ada berkas mana pun untuk memulihkannya.
-- Jadi: nomornya berawalan `MAN/`, dan kedua fungsi impor (0189) menolak
-- menyentuh baris bersumber manual.

alter table bengkel_purchase_lines
  add column if not exists sumber text not null default 'turboly';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bengkel_purchase_sumber_ck') then
    alter table bengkel_purchase_lines
      add constraint bengkel_purchase_sumber_ck check (sumber in ('turboly', 'manual'));
  end if;
end $$;

comment on column bengkel_purchase_lines.sumber is
  'turboly = hasil impor; manual = diketik di Berjaya Hub. Impor tidak pernah menyentuh baris manual (0191).';

-- Catatan per baris: bon tulis tangan sering memuat keterangan yang tidak
-- masuk kolom mana pun ("sisa stok lama", "titip dulu").
alter table bengkel_purchase_lines add column if not exists catatan text;
alter table bengkel_purchase_lines add column if not exists dibuat_by uuid references user_profiles(id) on delete set null;
alter table bengkel_purchase_lines add column if not exists dibuat_by_nama text;

create index if not exists idx_bengkel_beli_sumber
  on bengkel_purchase_lines(business_unit_id, sumber);

-- ---------------------------------------------------------
-- 1a. View ikut membawa `sumber`
--
-- Ditulis ulang utuh dari 0186 dengan dua kolom tambahan. Laporan yang sudah
-- ada tidak berubah perilakunya — kolom baru yang tidak dibaca tidak merusak
-- apa pun, sedangkan kolom yang hilang merusak diam-diam.
-- ---------------------------------------------------------
-- DIBUANG DULU, bukan `create or replace`: Postgres menolak mengganti nama
-- atau urutan kolom sebuah view yang sudah ada, dan kolom baru di tengah
-- dibaca sebagai "mengganti nama kolom `berkas` jadi `sumber`". Tidak ada
-- yang bergantung pada view ini selain layar yang membacanya lewat PostgREST.
drop view if exists bengkel_pembelian_rinci;

create view bengkel_pembelian_rinci as
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
         coalesce(l.total, l.harga * l.qty) as nilai,
         l.sumber,
         l.catatan,
         l.berkas,
         l.import_run_id
    from bengkel_purchase_lines l
    left join outlets o on o.id = l.outlet_id;

-- ---------------------------------------------------------
-- 1b. RPC: simpan pembelian manual (satu dokumen, banyak baris)
--
-- Wewenangnya PER OUTLET (`is_admin_of_outlet`), bukan per BU: yang mengetik
-- bon pembelian adalah orang outlet itu. Pembelian PUSAT (tanpa outlet) hanya
-- Admin BU — ia tidak dimiliki outlet mana pun, jadi tidak ada outlet yang
-- bisa mempertanggungjawabkannya.
-- ---------------------------------------------------------
create or replace function simpan_pembelian_manual(p_bu uuid, p_dok jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_nama text;
  v_outlet uuid := nullif(p_dok->>'outlet_id', '')::uuid;
  v_tanggal date := coalesce(nullif(p_dok->>'tanggal', '')::date, (now() at time zone 'Asia/Jakarta')::date);
  v_no text := upper(btrim(coalesce(p_dok->>'po_no', '')));
  v_id_lama text := upper(btrim(coalesce(p_dok->>'po_lama', '')));
  b jsonb;
  v_urut int := 0;
  v_baris int := 0;
  v_nilai numeric := 0;
begin
  if v_uid is null then raise exception 'Harus login'; end if;

  if v_outlet is null then
    if not is_bu_admin(v_uid, p_bu) then
      raise exception 'Pembelian pusat (tanpa outlet) hanya bisa dicatat Admin BU.';
    end if;
  else
    if not exists (select 1 from outlets o where o.id = v_outlet and o.business_unit_id = p_bu) then
      raise exception 'Outlet itu bukan milik BU ini.';
    end if;
    if not is_admin_of_outlet(v_uid, v_outlet) then
      raise exception 'Outlet itu di luar wewenangmu.';
    end if;
  end if;

  if v_tanggal > (now() at time zone 'Asia/Jakarta')::date then
    raise exception 'Tanggal pembelian tidak boleh di masa depan.';
  end if;
  if jsonb_array_length(coalesce(p_dok->'baris', '[]'::jsonb)) = 0 then
    raise exception 'Isi minimal satu baris barang.';
  end if;

  v_nama := nama_pengguna(v_uid);

  -- ---- Menyunting dokumen yang sudah ada ----
  if v_id_lama <> '' then
    if not exists (select 1 from bengkel_purchase_lines
                    where business_unit_id = p_bu and upper(btrim(po_no)) = v_id_lama and sumber = 'manual') then
      raise exception 'Dokumen pembelian manual % tidak ditemukan.', v_id_lama;
    end if;
    -- Baris lamanya dibuang SELURUHNYA, bukan disamakan satu per satu: baris
    -- yang dihapus orangnya akan tetap hidup di sini kalau disamakan, dan
    -- nilainya ikut terhitung selamanya (alasan yang sama dengan 0185).
    delete from bengkel_purchase_lines
     where business_unit_id = p_bu and upper(btrim(po_no)) = v_id_lama and sumber = 'manual';
    if v_no = '' then v_no := v_id_lama; end if;
  end if;

  -- ---- Nomor dokumen ----
  if v_no = '' then
    -- Berawalan `MAN/` supaya tidak pernah bertabrakan dengan nomor PO
    -- Turboly. Tabrakan nomor berarti impor berikutnya menghapus bon yang
    -- diketik orang, dan tidak ada berkas untuk memulihkannya.
    select 'MAN/' || to_char(v_tanggal, 'YYMM') || '/' ||
           lpad((coalesce(max(substring(po_no from '[0-9]+$')::int), 0) + 1)::text, 4, '0')
      into v_no
      from bengkel_purchase_lines
     where business_unit_id = p_bu and sumber = 'manual'
       and po_no like 'MAN/' || to_char(v_tanggal, 'YYMM') || '/%';
  elsif v_no like 'MAN/%' then
    null; -- nomor manual yang diketik sendiri: boleh
  else
    -- Nomor yang diketik bebas tetap diberi awalan: tanpa itu, orang bisa
    -- mengetik nomor PO Turboly yang sudah ada, dan impor berikutnya akan
    -- menghapus bon ini tanpa satu pun peringatan.
    v_no := 'MAN/' || v_no;
  end if;

  if exists (select 1 from bengkel_purchase_lines
              where business_unit_id = p_bu and upper(btrim(po_no)) = upper(v_no)) then
    raise exception 'Nomor dokumen % sudah dipakai.', v_no;
  end if;

  for b in select * from jsonb_array_elements(p_dok->'baris') loop
    v_urut := v_urut + 1;
    insert into bengkel_purchase_lines (business_unit_id, outlet_id, po_no, urut, tanggal,
                                        supplier, referensi, kirim_ke, sku, nama, qty, harga, total,
                                        sumber, catatan, dibuat_by, dibuat_by_nama, diimpor_by)
    values (p_bu, v_outlet, v_no, v_urut, v_tanggal,
            nullif(btrim(coalesce(p_dok->>'supplier', '')), ''),
            nullif(btrim(coalesce(p_dok->>'referensi', '')), ''),
            nullif(btrim(coalesce(p_dok->>'kirim_ke', '')), ''),
            nullif(btrim(coalesce(b->>'sku', '')), ''),
            coalesce(nullif(btrim(coalesce(b->>'nama', '')), ''), '(tanpa nama)'),
            coalesce((b->>'qty')::numeric, 0),
            -- NULL dipertahankan: "belum tahu harganya" bukan "gratis" (0186).
            nullif(b->>'harga', '')::numeric,
            nullif(b->>'total', '')::numeric,
            'manual',
            nullif(btrim(coalesce(b->>'catatan', '')), ''),
            v_uid, v_nama, v_uid);
    v_baris := v_baris + 1;
    v_nilai := v_nilai + coalesce(nullif(b->>'total', '')::numeric,
                                  coalesce(nullif(b->>'harga', '')::numeric, 0) * coalesce((b->>'qty')::numeric, 0));
  end loop;

  return jsonb_build_object('po_no', v_no, 'baris', v_baris, 'nilai', v_nilai);
end;
$$;

revoke all on function simpan_pembelian_manual(uuid, jsonb) from public;
grant execute on function simpan_pembelian_manual(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------
-- 1c. RPC: hapus pembelian manual
--
-- Hanya yang BERSUMBER MANUAL. Baris hasil impor punya pintunya sendiri
-- (`hapus_dokumen_impor_bengkel`, 0187/0189) yang ikut mencatat alasannya di
-- riwayat impor; membiarkannya lewat sini akan melewati pencatatan itu.
-- ---------------------------------------------------------
create or replace function hapus_pembelian_manual(p_bu uuid, p_no text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_no text := upper(btrim(coalesce(p_no, '')));
  v_outlet uuid;
  v_sumber text;
  v_n int := 0;
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  if v_no = '' then raise exception 'Nomor dokumen wajib diisi.'; end if;

  select outlet_id, sumber into v_outlet, v_sumber from bengkel_purchase_lines
   where business_unit_id = p_bu and upper(btrim(po_no)) = v_no limit 1;
  if v_sumber is null then raise exception 'Dokumen tidak ditemukan.'; end if;
  if v_sumber <> 'manual' then
    raise exception 'Dokumen ini hasil impor Turboly. Pakai "Hapus satu dokumen" di tab Impor.';
  end if;

  if v_outlet is null then
    if not is_bu_admin(v_uid, p_bu) then
      raise exception 'Pembelian pusat hanya bisa dihapus Admin BU.';
    end if;
  elsif not is_admin_of_outlet(v_uid, v_outlet) then
    raise exception 'Dokumen ini bukan milik outlet yang kamu pegang.';
  end if;

  delete from bengkel_purchase_lines
   where business_unit_id = p_bu and upper(btrim(po_no)) = v_no and sumber = 'manual';
  get diagnostics v_n = row_count;

  return jsonb_build_object('nomor', v_no, 'dihapus', v_n);
end;
$$;

revoke all on function hapus_pembelian_manual(uuid, text) from public;
grant execute on function hapus_pembelian_manual(uuid, text) to authenticated;

-- ---------------------------------------------------------
-- 1d. IMPOR TIDAK MENYENTUH BARIS MANUAL
--
-- Ditulis ulang dari 0189. Yang berubah: tiga tempat yang menyentuh
-- `bengkel_purchase_lines` kini menyebut `sumber = 'turboly'`, dan satu
-- penjagaan baru yang MELEWATI PO yang nomornya milik dokumen manual.
--
-- Tanpa itu, satu nomor yang bertabrakan akan menghapus bon yang diketik
-- orang — dan tidak ada berkas mana pun untuk memulihkannya.
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
  v_lewat_manual text[] := '{}';
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

  insert into bengkel_import_runs (business_unit_id, jenis, berkas, dibuat_by)
  values (p_bu, 'pembelian', p_berkas, v_uid)
  returning id into v_run;

  for b in select * from jsonb_array_elements(coalesce(p_baris, '[]'::jsonb)) loop
    v_po := btrim(coalesce(b->>'po_no', ''));
    if v_po = '' or btrim(coalesce(b->>'tanggal', '')) = '' then
      v_lewat := v_lewat + 1;
      continue;
    end if;

    -- ============ NOMOR YANG SUDAH MILIK DOKUMEN MANUAL (0191) ============
    if exists (select 1 from bengkel_purchase_lines
                where business_unit_id = p_bu and upper(btrim(po_no)) = upper(v_po) and sumber = 'manual') then
      if not (upper(v_po) = any(v_lewat_manual)) then v_lewat_manual := v_lewat_manual || upper(v_po); end if;
      continue;
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

    -- Batas outlet (0189). Pembelian PUSAT tetap boleh.
    if not v_bu_admin and v_outlet is not null and not (v_outlet = any(v_saya)) then
      v_lewat_outlet := v_lewat_outlet + 1;
      if not (v_alamat = any(v_alamat_lain)) then v_alamat_lain := v_alamat_lain || v_alamat; end if;
      continue;
    end if;

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

    if not (upper(v_po) = any(v_po_terproses)) then
      v_po_terproses := v_po_terproses || upper(v_po);
      if exists (select 1 from bengkel_purchase_lines
                  where business_unit_id = p_bu and upper(btrim(po_no)) = upper(v_po) and sumber = 'turboly') then
        delete from bengkel_purchase_lines
         where business_unit_id = p_bu and upper(btrim(po_no)) = upper(v_po) and sumber = 'turboly';
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
                                        product_type, product_code, qty, harga, total, berkas, diimpor_by,
                                        import_run_id, sumber)
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
            (b->>'harga')::numeric,
            (b->>'total')::numeric,
            p_berkas, v_uid, v_run, 'turboly');
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
    'dilewati_outlet_lain', v_lewat_outlet,
    'alamat_outlet_lain', to_jsonb(v_alamat_lain),
    -- Nomor yang bertabrakan dengan dokumen manual: DISEBUT, bukan ditimpa
    -- dan bukan dilewati diam-diam. Yang mengimpornya perlu tahu bahwa ada
    -- bon miliknya sendiri yang memegang nomor itu.
    'dilewati_manual', to_jsonb(v_lewat_manual)
  );
end;
$$;
revoke all on function impor_pembelian_bengkel(uuid, jsonb, text) from public;
grant execute on function impor_pembelian_bengkel(uuid, jsonb, text) to authenticated;

-- Penarikan impor (0188) juga dibatasi ke baris turboly: `import_run_id`
-- memang sudah membatasinya, tapi sapuan `p_semua` memakai NOMOR dokumen —
-- dan nomor manual tidak boleh ikut tersapu.
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
         and sumber = 'turboly'
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

-- =========================================================
-- BAGIAN 2 — HAPUS MASSAL MASTER SPAREPART
-- =========================================================
--
-- Impor Turboly memasukkan ribuan baris sekaligus. Membersihkannya satu per
-- satu lewat tombol Hapus bukan pekerjaan yang bisa diselesaikan siapa pun,
-- dan yang terjadi adalah master dibiarkan kotor.
--
-- ============ YANG MEMBUAT HAPUS MASSAL BERBAHAYA ============
--
-- Menghapus 1.900 baris dengan satu tekanan adalah tindakan yang tidak bisa
-- dibatalkan, dan pada saat menekannya orangnya belum tentu tahu berapa
-- banyak yang kena. Jadi ada DUA fungsi:
--
--   `dampak_hapus_sparepart_massal` -> tidak mengubah apa pun, menjawab
--       berapa yang akan hilang dan berapa di antaranya yang MASIH DIPAKAI
--       invoice korporat atau punya harga khusus outlet;
--   `hapus_sparepart_massal`        -> melakukannya.
--
-- Yang masih dipakai invoice TIDAK ikut terhapus. Barisnya memang cuma master
-- nama & harga, tapi menghapusnya membuat invoice lama kehilangan rujukan ke
-- barang yang pernah dijualnya, dan harga modal di laporan jadi tidak punya
-- asal-usul.

create or replace function dampak_hapus_sparepart_massal(p_bu uuid, p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_total int := 0;
  v_dipakai int := 0;
  v_harga int := 0;
  v_contoh text[];
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  if not is_bu_admin(v_uid, p_bu) then
    raise exception 'Hanya Admin BU yang boleh menghapus master sparepart.';
  end if;

  select count(*) into v_total from spareparts
   where business_unit_id = p_bu and id = any(coalesce(p_ids, '{}'::uuid[]));

  -- Dipakai = SKU-nya pernah muncul di baris penjualan BU ini. Dicocokkan
  -- lewat SKU, bukan foreign key: baris penjualan menyimpan SKU sebagai teks
  -- (ia datang dari berkas Turboly, bukan dari master).
  select count(*) into v_dipakai from spareparts s
   where s.business_unit_id = p_bu and s.id = any(coalesce(p_ids, '{}'::uuid[]))
     and s.sku is not null
     and exists (
       select 1 from bengkel_sale_lines l
        join bengkel_sale_invoices i on i.id = l.invoice_id
       where i.business_unit_id = p_bu and upper(btrim(coalesce(l.sku, ''))) = upper(btrim(s.sku))
     );

  select count(*) into v_harga from sparepart_outlet_prices p
   where p.sparepart_id = any(coalesce(p_ids, '{}'::uuid[]));

  select array_agg(x) into v_contoh from (
    select coalesce(s.sku, '') || ' ' || s.name as x from spareparts s
     where s.business_unit_id = p_bu and s.id = any(coalesce(p_ids, '{}'::uuid[]))
     order by s.name limit 5
  ) t;

  return jsonb_build_object(
    'total', v_total,
    'dipakai_invoice', v_dipakai,
    'bisa_dihapus', v_total - v_dipakai,
    'harga_outlet', v_harga,
    'contoh', to_jsonb(coalesce(v_contoh, '{}'::text[]))
  );
end;
$$;

revoke all on function dampak_hapus_sparepart_massal(uuid, uuid[]) from public;
grant execute on function dampak_hapus_sparepart_massal(uuid, uuid[]) to authenticated;

create or replace function hapus_sparepart_massal(p_bu uuid, p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_bisa uuid[];
  v_dipakai int := 0;
  v_n int := 0;
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  if not is_bu_admin(v_uid, p_bu) then
    raise exception 'Hanya Admin BU yang boleh menghapus master sparepart.';
  end if;
  if coalesce(array_length(p_ids, 1), 0) = 0 then
    raise exception 'Tidak ada baris yang dipilih.';
  end if;

  -- Hanya yang BENAR-BENAR milik BU ini. Tanpa saringan ini, daftar id yang
  -- dikirim dari layar lain bisa menghapus master BU tetangga — dan RLS tidak
  -- menahannya, karena fungsinya `security definer`.
  select array_agg(s.id) into v_bisa from spareparts s
   where s.business_unit_id = p_bu and s.id = any(p_ids)
     and not (
       s.sku is not null and exists (
         select 1 from bengkel_sale_lines l
          join bengkel_sale_invoices i on i.id = l.invoice_id
         where i.business_unit_id = p_bu and upper(btrim(coalesce(l.sku, ''))) = upper(btrim(s.sku))
       )
     );

  select count(*) into v_dipakai from spareparts s
   where s.business_unit_id = p_bu and s.id = any(p_ids)
     and not (s.id = any(coalesce(v_bisa, '{}'::uuid[])));

  if coalesce(array_length(v_bisa, 1), 0) > 0 then
    delete from spareparts where id = any(v_bisa);
    get diagnostics v_n = row_count;
  end if;

  -- Yang dilewati DISEBUTKAN, bukan didiamkan. "20 terhapus" dari 25 yang
  -- dipilih tanpa keterangan membuat orangnya mengulang penghapusan yang
  -- sama berkali-kali, mengira tekanannya tidak masuk.
  return jsonb_build_object('dihapus', v_n, 'dilewati_dipakai', v_dipakai);
end;
$$;

revoke all on function hapus_sparepart_massal(uuid, uuid[]) from public;
grant execute on function hapus_sparepart_massal(uuid, uuid[]) to authenticated;

notify pgrst, 'reload schema';
