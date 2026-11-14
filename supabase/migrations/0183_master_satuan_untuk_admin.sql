-- =========================================================
-- 0183 — ADMIN BU & ADMIN OUTLET BOLEH MENAMBAH MASTER SATUAN
--
--   "saya ingin bisa... jadi scope admin BU dan admin outlet tetap bisa
--    menambahkan master satuan, walaupun bukan outlet basis nya"
--
-- ============ SEBABNYA BUKAN OUTLET BASIS ============
--
-- Yang dicurigai: "admin BU di BU yang bukan outlet basisnya tidak bisa".
-- Yang sebenarnya: `units` tidak punya `business_unit_id` sama sekali. Ia
-- tabel GLOBAL, dan sejak 0019 policy-nya berbunyi `is_super_admin` — jadi
-- SELURUH admin BU dan admin outlet ditolak, di BU mana pun, basis atau bukan.
--
-- Bedanya penting: kalau diperbaiki sebagai "masalah basis", yang disentuh
-- adalah `membership_scopes` — dan satuan tetap tidak bisa ditambah.
--
-- ============ KENAPA LEWAT RPC, BUKAN SEKADAR MELONGGARKAN POLICY ============
--
-- Daftar ini dipakai SEMUA BU. Melonggarkan `insert` begitu saja membuat tiap
-- salah ketik jadi milik semua orang: "Kg", "kg", "KG", "kg " akan hidup
-- berdampingan di dropdown setiap BU, dan tidak ada satu pun galat yang
-- menandainya.
--
-- `tambah_satuan` merapikan namanya lebih dulu dan mengembalikan satuan yang
-- SUDAH ADA kalau namanya sama (tanpa peduli huruf besar-kecil) — jadi dua
-- orang yang mengetik "Gram" dan "gram" di hari yang sama berakhir di satu
-- baris, bukan dua.
--
-- ============ MENGHAPUS TETAP LEBIH KETAT ============
--
-- Satuan yang dihapus hilang dari dropdown SEMUA BU, sementara produk
-- menyimpan satuannya sebagai TEKS (`products.base_unit`) — barisnya tidak
-- ikut hilang, ia cuma tidak bisa dipilih lagi. Maka:
--
--   super admin            -> boleh menghapus apa pun
--   admin yang membuatnya  -> boleh, selama belum dipakai produk mana pun
--   lainnya                -> tidak
--
-- Satuan bawaan (0019) tidak punya pembuat, jadi hanya super admin yang bisa
-- membuangnya. Itu disengaja: 'gram' dan 'pcs' dipakai lintas BU.
-- =========================================================

alter table units add column if not exists created_by uuid references user_profiles(id) on delete set null;

comment on column units.created_by is
  'Siapa yang menambahkan satuan ini (0183). Null = satuan bawaan 0019; hanya super admin yang boleh menghapusnya.';

-- ---------------------------------------------------------
-- 1. "ADMIN DI MANA PUN"
--
-- Sengaja TIDAK terikat BU atau outlet tertentu: `units` memang tidak punya
-- pemilik. Pertanyaannya bukan "admin BU mana", melainkan "apakah orang ini
-- mengelola sesuatu" — dan yang mengelola apa pun berhak merapikan daftar
-- satuan yang dipakainya setiap hari.
-- ---------------------------------------------------------
create or replace function adalah_admin(p_uid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from membership_scopes ms
     where ms.user_id = p_uid
       and ms.role in ('super_admin', 'bu_admin', 'outlet_admin')
  );
$$;

revoke all on function adalah_admin(uuid) from public;
grant execute on function adalah_admin(uuid) to authenticated;

comment on function adalah_admin(uuid) is
  'Apakah user ini admin di mana pun (super/BU/outlet). Untuk master GLOBAL yang tidak punya pemilik BU.';

-- ---------------------------------------------------------
-- 2. TAMBAH
-- ---------------------------------------------------------
create or replace function tambah_satuan(p_nama text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  -- Dirapikan: spasi tepi dibuang, spasi ganda di tengah dirapatkan.
  -- "kg " dan "kg" adalah satuan yang sama, dan bedanya cuma datang dari jari
  -- yang terpeleset — tapi `unique(name)` di 0019 menganggapnya dua baris.
  v_nama text := regexp_replace(btrim(coalesce(p_nama, '')), '\s+', ' ', 'g');
  v_ada units%rowtype;
  v_id uuid;
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  if not adalah_admin(v_uid) then
    raise exception 'Hanya admin (BU, outlet, atau super admin) yang bisa menambah satuan.';
  end if;
  if v_nama = '' then raise exception 'Nama satuan wajib diisi.'; end if;
  -- Batas panjang supaya dropdown tidak dirusak satu baris yang kepanjangan.
  -- 24 cukup untuk "karung besar 25kg" dan menolak kalimat.
  if length(v_nama) > 24 then raise exception 'Nama satuan terlalu panjang (maksimal 24 huruf).'; end if;

  -- SUDAH ADA (tanpa peduli huruf besar-kecil) -> kembalikan yang itu.
  --
  -- Bukan galat: yang mengetik "Gram" memang ingin satuan gram, dan menolaknya
  -- dengan "sudah ada" membuat ia mengetik variasi lain sampai lolos — persis
  -- cara daftar ini jadi berantakan.
  select * into v_ada from units where lower(btrim(name)) = lower(v_nama) limit 1;
  if v_ada.id is not null then
    return jsonb_build_object('id', v_ada.id, 'nama', v_ada.name, 'baru', false);
  end if;

  insert into units (name, created_by) values (v_nama, v_uid) returning id into v_id;
  return jsonb_build_object('id', v_id, 'nama', v_nama, 'baru', true);
end;
$$;

revoke all on function tambah_satuan(text) from public;
grant execute on function tambah_satuan(text) to authenticated;

comment on function tambah_satuan(text) is
  'Tambah satuan global. Admin BU/outlet/super. Nama dirapikan; yang sudah ada dikembalikan apa adanya (0183).';

-- ---------------------------------------------------------
-- 3. HAPUS
--
-- Dipisah dari `tambah` karena aturannya memang berbeda — dan menyamakannya
-- berarti satu salah tekan bisa mencabut 'gram' dari seluruh perusahaan.
-- ---------------------------------------------------------
create or replace function hapus_satuan(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_unit units%rowtype;
  v_dipakai int;
begin
  if v_uid is null then raise exception 'Harus login'; end if;

  select * into v_unit from units where id = p_id;
  if v_unit.id is null then raise exception 'Satuan tidak ditemukan.'; end if;

  if not is_super_admin(v_uid) then
    if not adalah_admin(v_uid) then
      raise exception 'Hanya admin yang bisa menghapus satuan.';
    end if;
    if v_unit.created_by is distinct from v_uid then
      raise exception 'Satuan ini bukan kamu yang menambahkan. Minta Super Admin kalau memang harus dihapus.';
    end if;

    -- Dipakai produk? Jangan dihapus. Produknya TIDAK ikut hilang — ia
    -- menyimpan satuannya sebagai teks — tapi satuannya tidak bisa dipilih
    -- lagi saat produk itu disunting, dan yang menyuntingnya akan mengira
    -- datanya rusak.
    select count(*) into v_dipakai from products
     where lower(btrim(coalesce(base_unit, ''))) = lower(btrim(v_unit.name))
        or lower(btrim(coalesce(purchase_unit, ''))) = lower(btrim(v_unit.name));
    if v_dipakai > 0 then
      raise exception 'Satuan "%" sudah dipakai % produk, jadi tidak bisa dihapus.', v_unit.name, v_dipakai;
    end if;
  end if;

  delete from units where id = p_id;
  return jsonb_build_object('id', p_id, 'nama', v_unit.name);
end;
$$;

revoke all on function hapus_satuan(uuid) from public;
grant execute on function hapus_satuan(uuid) to authenticated;

comment on function hapus_satuan(uuid) is
  'Hapus satuan global. Super admin bebas; admin lain hanya satuan buatannya sendiri yang belum dipakai produk (0183).';

-- ---------------------------------------------------------
-- 4. POLICY TULIS LANGSUNG TETAP SUPER ADMIN SAJA
--
-- SENGAJA TIDAK dilonggarkan. Satu-satunya jalan masuk bagi admin BU/outlet
-- adalah kedua fungsi di atas, yang merapikan nama dan memeriksa pemakaian.
-- Policy `insert` yang terbuka akan melewati keduanya — dan yang memakainya
-- adalah PWA lama, yang justru tidak tahu aturan barunya.
--
-- `units_modify` dari 0019 dibiarkan apa adanya.
-- ---------------------------------------------------------

notify pgrst, 'reload schema';
