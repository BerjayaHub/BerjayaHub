-- =========================================================
-- 0167 — SPAREPART MENYIMPAN DUA HARGA, BUKAN SATU
--
-- ============ KENAPA 0166 SALAH ============
--
-- 0166 menyimpan satu `harga_dasar`, dan layar impornya menyuruh orang MEMILIH
-- kolom mana yang dipakai: "Store Supply" atau "Store Retail".
--
-- Pilihan itu tidak pernah benar. Berkas Turboly memuat KEDUANYA — harga beli
-- dan harga jual — dan Berjaya Hub memerlukan keduanya: harga beli untuk
-- mencocokkan pengeluaran, harga jual untuk menyebut harga ke pelanggan.
-- Menyuruh memilih berarti setengah datanya dibuang setiap kali impor, dan
-- yang terbuang tidak kelihatan hilang: kolomnya terisi, angkanya masuk akal,
-- cuma artinya yang salah.
--
-- Lebih buruk lagi, salah pilih sekali membuat SELURUH harga jual tertimpa
-- harga beli. 1.926 baris sekaligus, tanpa galat, dan tidak ada apa pun di
-- dalam datanya yang bisa dipakai membedakan mana yang benar.
--
-- Sesudah ini tidak ada lagi yang perlu dipilih: sekali impor, keduanya masuk.
--
-- ============ CATATAN ISTILAH ============
--
-- Untuk BU bertipe `workshop`, aplikasi kasir & stoknya bernama TURBOLY, bukan
-- ESB. Penjualan dan stok sepenuhnya ditangani Turboly; master di Berjaya Hub
-- murni PENCATATAN — tidak memotong stok, tidak membuat penjualan. Yang
-- dihitung Berjaya Hub cuma: pengeluaran dari Cash Ledger, dan pemasukan dari
-- omzet harian yang diketik outlet.
-- =========================================================

-- ---------------------------------------------------------
-- 1. spareparts: harga_dasar -> harga_jual, + harga_beli
-- ---------------------------------------------------------
do $$
begin
  -- `rename column` tidak punya IF EXISTS, dan migrasi ini harus tetap aman
  -- dijalankan dua kali. Jadi keadaannya diperiksa dulu, bukan diasumsikan.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'spareparts' and column_name = 'harga_dasar'
  ) and not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'spareparts' and column_name = 'harga_jual'
  ) then
    -- Nilai yang sudah ada diimpor dari kolom "Store Retail" (pilihan bawaan
    -- 0166), jadi ia memang harga JUAL. Dipindahkan, bukan dibuang.
    alter table spareparts rename column harga_dasar to harga_jual;
  end if;
end $$;

alter table spareparts add column if not exists harga_jual numeric;
alter table spareparts add column if not exists harga_beli numeric;

alter table spareparts drop constraint if exists spareparts_harga_dasar_check;
alter table spareparts drop constraint if exists spareparts_harga_jual_check;
alter table spareparts drop constraint if exists spareparts_harga_beli_check;
alter table spareparts add constraint spareparts_harga_jual_check check (harga_jual is null or harga_jual >= 0);
alter table spareparts add constraint spareparts_harga_beli_check check (harga_beli is null or harga_beli >= 0);

comment on column spareparts.harga_beli is
  'Harga beli acuan se-BU (Store Supply di berkas Turboly). Null = belum diisi, BUKAN gratis.';
comment on column spareparts.harga_jual is
  'Harga jual acuan se-BU (Store Retail di berkas Turboly). Null = belum diisi, BUKAN gratis.';

-- ---------------------------------------------------------
-- 2. Harga per outlet: dua harga juga
-- ---------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'sparepart_outlet_prices' and column_name = 'harga'
  ) and not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'sparepart_outlet_prices' and column_name = 'harga_jual'
  ) then
    alter table sparepart_outlet_prices rename column harga to harga_jual;
  end if;
end $$;

alter table sparepart_outlet_prices add column if not exists harga_jual numeric;
alter table sparepart_outlet_prices add column if not exists harga_beli numeric;

-- `harga` dulu NOT NULL. Sekarang sebuah baris boleh memuat harga jual saja,
-- atau harga beli saja — outlet yang cuma berbeda harga jualnya tidak boleh
-- dipaksa mengarang harga beli.
alter table sparepart_outlet_prices alter column harga_jual drop not null;

alter table sparepart_outlet_prices drop constraint if exists sparepart_outlet_prices_harga_check;
alter table sparepart_outlet_prices drop constraint if exists sparepart_outlet_prices_jual_check;
alter table sparepart_outlet_prices drop constraint if exists sparepart_outlet_prices_beli_check;
alter table sparepart_outlet_prices add constraint sparepart_outlet_prices_jual_check check (harga_jual is null or harga_jual >= 0);
alter table sparepart_outlet_prices add constraint sparepart_outlet_prices_beli_check check (harga_beli is null or harga_beli >= 0);

comment on table sparepart_outlet_prices is
  'Harga khusus satu outlet (beli dan/atau jual). Baris yang TIDAK ada berarti outlet memakai harga BU — bukan berarti harganya nol. Kolom yang null di dalam baris yang ada juga berarti ikut harga BU.';

-- ---------------------------------------------------------
-- 3. RPC impor: dua harga sekali jalan
-- ---------------------------------------------------------
drop function if exists impor_sparepart(uuid, jsonb);

create or replace function impor_sparepart(p_bu uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  it jsonb;
  v_sku text;
  v_nama text;
  v_jenis text;
  v_beli numeric;
  v_jual numeric;
  v_baru int := 0;
  v_diperbarui int := 0;
  v_dilewati int := 0;
  v_ada boolean;
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  if not is_bu_admin(v_uid, p_bu) then
    raise exception 'Hanya Admin BU yang boleh mengimpor master sparepart.';
  end if;
  if p_rows is null or jsonb_array_length(p_rows) = 0 then
    raise exception 'Tidak ada baris yang dikirim.';
  end if;

  for it in select * from jsonb_array_elements(p_rows) loop
    v_sku := upper(btrim(coalesce(it->>'sku', '')));
    v_nama := btrim(coalesce(it->>'name', ''));
    if v_sku = '' or v_nama = '' then
      v_dilewati := v_dilewati + 1;
      continue;
    end if;

    v_jenis := lower(btrim(coalesce(it->>'jenis', 'sparepart')));
    if v_jenis not in ('sparepart', 'jasa') then v_jenis := 'sparepart'; end if;

    v_beli := nullif(it->>'harga_beli', '')::numeric;
    v_jual := nullif(it->>'harga_jual', '')::numeric;
    if v_beli is not null and v_beli < 0 then v_beli := null; end if;
    if v_jual is not null and v_jual < 0 then v_jual := null; end if;

    select true into v_ada from spareparts
     where business_unit_id = p_bu and upper(btrim(sku)) = v_sku limit 1;

    insert into spareparts (business_unit_id, sku, name, jenis, kategori, merek, harga_beli, harga_jual, dari_impor, diimpor_at, dibuat_by)
    values (p_bu, v_sku, v_nama, v_jenis,
            nullif(btrim(coalesce(it->>'kategori', '')), ''),
            nullif(btrim(coalesce(it->>'merek', '')), ''),
            v_beli, v_jual, true, now(), v_uid)
    on conflict (business_unit_id, upper(btrim(sku))) do update
      set name = excluded.name,
          -- `jenis` TIDAK ditimpa — lihat catatan panjang di 0166. Singkatnya:
          -- berkas Turboly tidak punya kolom "ini jasa atau barang", jadi
          -- jenisnya cuma tebakan dari namanya, dan tebakan tidak boleh
          -- membatalkan keputusan yang sudah dibetulkan admin dengan tangan.
          kategori = excluded.kategori,
          merek = excluded.merek,
          -- HARGA KOSONG TIDAK MENGHAPUS HARGA LAMA — berlaku untuk KEDUANYA.
          -- Sel kosong di berkas berarti "tidak disebut", bukan "gratis";
          -- menimpanya dengan null menghilangkan harga yang sudah benar tanpa
          -- ada yang menyadarinya.
          harga_beli = coalesce(excluded.harga_beli, spareparts.harga_beli),
          harga_jual = coalesce(excluded.harga_jual, spareparts.harga_jual),
          -- `is_active` tidak disentuh: yang sengaja dinonaktifkan admin tidak
          -- boleh hidup lagi hanya karena ikut terbawa berkas.
          dari_impor = true,
          diimpor_at = now(),
          diperbarui_at = now(),
          diperbarui_by = v_uid;

    if v_ada then v_diperbarui := v_diperbarui + 1; else v_baru := v_baru + 1; end if;
    v_ada := null;
  end loop;

  return jsonb_build_object('baru', v_baru, 'diperbarui', v_diperbarui, 'dilewati', v_dilewati);
end;
$$;

revoke all on function impor_sparepart(uuid, jsonb) from public;
grant execute on function impor_sparepart(uuid, jsonb) to authenticated;

comment on function impor_sparepart(uuid, jsonb) is
  'Impor master sparepart dari berkas Product List Turboly. Cocok lewat SKU (huruf besar, tanpa spasi pinggir). Harga BELI dan JUAL masuk sekaligus; harga kosong tidak menghapus harga lama, is_active dan jenis tidak disentuh.';

notify pgrst, 'reload schema';
