-- =========================================================
-- 0173 — TRANSFER ASET ANTAR OUTLET, ANTAR BU, DAN KE LUAR
--
-- Berbeda dari pengiriman bahan pada satu hal yang mengubah segalanya:
-- TIDAK ADA LANGKAH TERIMA. Begitu dikirim, stok asal berkurang dan stok
-- tujuan bertambah — selesai.
--
-- ============ APA YANG HILANG KARENA TIDAK ADA PENERIMA ============
--
-- Pengiriman bahan punya penerima yang menghitung ulang di tempat, dan
-- selisihnya ketahuan hari itu juga. Di sini tidak ada. Salah ketik 50 yang
-- seharusnya 5 akan duduk diam di dua outlet sekaligus sampai opname
-- berikutnya, dan pada saat itu sebabnya sudah tidak bisa ditelusuri.
--
-- Dua hal menutup lubang itu, dan keduanya wajib:
--
--   1. PEMBAWA BARANG dicatat. Tanpa penerima, nama pembawa adalah
--      satu-satunya orang yang bisa ditanya "barangnya ke mana".
--   2. Transfer BISA DIBATALKAN Admin BU, dan jumlahnya ditarik kembali dari
--      kedua sisi. Tanpa itu, satu-satunya cara membetulkan adalah mengubah
--      jumlah manual di dua outlet — yang menghapus jejaknya sekaligus.
--
-- ============ TUJUAN "LAIN-LAIN" ============
--
-- Barang juga dipindah ke tempat yang bukan outlet mana pun: dipinjamkan,
-- dibawa ke acara, diserahkan ke pihak lain. Untuk itu `to_outlet_id` kosong
-- dan `tujuan_lain` WAJIB diisi.
--
-- Stok asal tetap berkurang; tidak ada stok tujuan yang bertambah, karena
-- tujuannya di luar sistem. Itu sebabnya `tujuan_lain` tidak boleh kosong —
-- barang yang keluar tanpa keterangan ke mana adalah barang yang hilang
-- dengan surat jalan.
--
-- ============ LINTAS BU: ITEMNYA DIBUATKAN DI BU TUJUAN ============
--
-- Kode aset milik BU, jadi ia TIDAK ikut berpindah. Item dengan nama &
-- kategori yang sama persis di BU tujuan dicari; kalau belum ada, dibuatkan
-- beserta kodenya sendiri. Kode di surat jalan karena itu adalah kode ASAL —
-- dan itu dicatat apa adanya di barisnya supaya yang membacanya nanti tidak
-- mencari kode yang memang tidak pernah ada di sana.
-- =========================================================

create table if not exists asset_transfer (
  id                 uuid primary key default gen_random_uuid(),
  kode               text not null,
  business_unit_id   uuid not null references business_units(id) on delete cascade,
  from_outlet_id     uuid not null references outlets(id) on delete cascade,

  -- Salah satu dari dua, tidak pernah keduanya, tidak pernah kosong dua-duanya.
  to_outlet_id       uuid references outlets(id) on delete set null,
  tujuan_lain        text,

  -- WAJIB. Tanpa penerima, ini satu-satunya orang yang bisa ditanya.
  pembawa            text not null check (btrim(pembawa) <> ''),
  catatan            text,
  photo_path         text,

  dikirim_by         uuid references user_profiles(id) on delete set null,
  dikirim_by_nama    text,
  created_at         timestamptz not null default now(),

  dibatalkan_at      timestamptz,
  dibatalkan_by      uuid references user_profiles(id) on delete set null,
  dibatalkan_by_nama text,
  alasan_batal       text,

  constraint asset_transfer_tujuan_check check (
    (to_outlet_id is not null and tujuan_lain is null)
    or (to_outlet_id is null and btrim(coalesce(tujuan_lain, '')) <> '')
  )
);

create index if not exists idx_asset_transfer_asal on asset_transfer(from_outlet_id, created_at desc);
create index if not exists idx_asset_transfer_tujuan on asset_transfer(to_outlet_id, created_at desc);
create index if not exists idx_asset_transfer_bu on asset_transfer(business_unit_id, created_at desc);

comment on table asset_transfer is
  'Surat jalan transfer aset. TIDAK ada langkah terima — stok berpindah saat dikirim. Tujuan boleh outlet mana pun, atau teks bebas (tujuan_lain) untuk di luar sistem.';

create table if not exists asset_transfer_item (
  id              uuid primary key default gen_random_uuid(),
  transfer_id     uuid not null references asset_transfer(id) on delete cascade,
  asset_item_id   uuid references asset_items(id) on delete set null,

  -- Kode & nama DISIMPAN sebagai teks.
  --
  -- Surat jalan adalah dokumen: ia harus tetap terbaca persis seperti saat
  -- dicetak, walaupun itemnya belakangan diganti nama atau dihapus. Pelajaran
  -- yang sama dengan `oleh_nama` di riwayat — penunjuk yang bisa menguap tidak
  -- cukup untuk dokumen.
  item_kode       text not null,
  item_nama       text not null,
  qty             numeric not null check (qty > 0),

  -- Item padanannya di BU tujuan (lintas BU bikin item baru di sana).
  item_tujuan_id  uuid references asset_items(id) on delete set null
);

create index if not exists idx_asset_transfer_item on asset_transfer_item(transfer_id);

-- ---------------------------------------------------------
-- KIRIM
-- ---------------------------------------------------------
create or replace function kirim_transfer_aset(
  p_from_outlet uuid,
  p_to_outlet uuid,
  p_tujuan_lain text,
  p_pembawa text,
  p_items jsonb,
  p_catatan text default null,
  p_photo_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_nama text;
  v_bu uuid;
  v_bu_tujuan uuid;
  v_id uuid := gen_random_uuid();
  v_kode text;
  v_lain text := nullif(btrim(coalesce(p_tujuan_lain, '')), '');
  it jsonb;
  v_item uuid;
  v_qty numeric;
  v_sisa numeric;
  v_kode_item text;
  v_nama_item text;
  v_kat text;
  v_size text;
  v_item_tujuan uuid;
  v_n int := 0;
begin
  if v_uid is null then raise exception 'Harus login'; end if;

  select business_unit_id into v_bu from outlets where id = p_from_outlet;
  if v_bu is null then raise exception 'Outlet asal tidak dikenal.'; end if;
  if not has_outlet_scope(v_uid, p_from_outlet) then
    raise exception 'Kamu tidak punya akses ke outlet asal.';
  end if;

  if btrim(coalesce(p_pembawa, '')) = '' then
    raise exception 'Nama pembawa barang wajib diisi.';
  end if;

  -- Tujuan: outlet, ATAU teks bebas. Tidak pernah dua-duanya.
  if p_to_outlet is not null and v_lain is not null then
    raise exception 'Pilih salah satu: outlet tujuan ATAU tujuan lain-lain.';
  end if;
  if p_to_outlet is null and v_lain is null then
    -- Barang yang keluar tanpa keterangan ke mana adalah barang yang hilang
    -- dengan surat jalan.
    raise exception 'Tujuan wajib diisi. Pilih outlet, atau tulis tujuannya kalau dikirim ke luar.';
  end if;
  if p_to_outlet is not null then
    select business_unit_id into v_bu_tujuan from outlets where id = p_to_outlet;
    if v_bu_tujuan is null then raise exception 'Outlet tujuan tidak dikenal.'; end if;
    if p_to_outlet = p_from_outlet then raise exception 'Outlet asal dan tujuan tidak boleh sama.'; end if;
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Belum ada barang yang dipilih.';
  end if;

  v_nama := nama_pengguna(v_uid);
  v_kode := 'TA-' || to_char((now() at time zone 'Asia/Jakarta'), 'YYMMDD') || '-' || upper(substr(v_id::text, 1, 4));

  insert into asset_transfer (id, kode, business_unit_id, from_outlet_id, to_outlet_id, tujuan_lain,
                              pembawa, catatan, photo_path, dikirim_by, dikirim_by_nama)
  values (v_id, v_kode, v_bu, p_from_outlet, p_to_outlet, v_lain,
          btrim(p_pembawa), nullif(btrim(coalesce(p_catatan, '')), ''),
          nullif(btrim(coalesce(p_photo_path, '')), ''), v_uid, v_nama);

  for it in select * from jsonb_array_elements(p_items) loop
    v_item := (it->>'item_id')::uuid;
    v_qty := nullif(it->>'qty', '')::numeric;
    if v_item is null or v_qty is null or v_qty <= 0 then continue; end if;

    select kode, name, category, size into v_kode_item, v_nama_item, v_kat, v_size
      from asset_items where id = v_item and business_unit_id = v_bu;
    if v_kode_item is null then
      raise exception 'Barang tidak ditemukan di BU ini.';
    end if;

    -- Kunci barisnya supaya dua pengiriman di detik yang sama tidak sama-sama
    -- membaca sisa yang sama lalu mengirim lebih banyak daripada yang ada.
    select qty into v_sisa from asset_stock
     where asset_item_id = v_item and outlet_id = p_from_outlet
     for update;

    if v_sisa is null then
      raise exception '"%" belum didata di outlet asal, jadi belum ada jumlah yang bisa dikirim.', v_nama_item;
    end if;
    -- Menolak, BUKAN memotong jadi nol: mengirim lebih banyak daripada yang
    -- tercatat berarti salah satu angkanya salah, dan memotongnya diam-diam
    -- menyembunyikan selisih itu.
    if v_qty > v_sisa then
      raise exception 'Tercatat cuma % "%" di outlet asal, tidak bisa mengirim %.', v_sisa, v_nama_item, v_qty;
    end if;

    update asset_stock set qty = qty - v_qty, updated_by = v_uid, updated_at = now()
     where asset_item_id = v_item and outlet_id = p_from_outlet;

    v_item_tujuan := null;
    if p_to_outlet is not null then
      if v_bu_tujuan = v_bu then
        v_item_tujuan := v_item;
      else
        -- Lintas BU: kode milik BU, jadi tidak ikut pindah. Item padanannya
        -- dicari lewat nama + kategori yang SAMA PERSIS, dibuatkan kalau belum
        -- ada — beserta kodenya sendiri di BU tujuan.
        select id into v_item_tujuan from asset_items
         where business_unit_id = v_bu_tujuan and name = v_nama_item and category is not distinct from v_kat
         limit 1;
        if v_item_tujuan is null then
          insert into asset_items (business_unit_id, kode, name, category, size, created_by)
          values (v_bu_tujuan, kode_aset_berikutnya(v_bu_tujuan, v_kat), v_nama_item, v_kat, v_size, v_uid)
          returning id into v_item_tujuan;
        end if;
      end if;

      insert into asset_stock (asset_item_id, outlet_id, qty, created_by, updated_by)
      values (v_item_tujuan, p_to_outlet, v_qty, v_uid, v_uid)
      on conflict (asset_item_id, outlet_id) do update
        set qty = asset_stock.qty + excluded.qty, updated_by = v_uid, updated_at = now();
    end if;

    insert into asset_transfer_item (transfer_id, asset_item_id, item_kode, item_nama, qty, item_tujuan_id)
    values (v_id, v_item, v_kode_item, v_nama_item, v_qty, v_item_tujuan);

    -- Baris riwayat yang menyebut SEBABNYA. Trigger stok sudah mencatat
    -- angkanya; tanpa baris ini, riwayatnya cuma berbunyi "12 jadi 10" dan
    -- "ke mana yang dua" tetap tidak terjawab.
    insert into asset_log (asset_item_id, business_unit_id, outlet_id, aksi, kolom, sebelum, sesudah, catatan, oleh, oleh_nama)
    values (v_item, v_bu, p_from_outlet, 'transfer-keluar', v_kode, v_qty::text, null,
            v_kode_item || ' → ' || coalesce((select name from outlets where id = p_to_outlet), v_lain), v_uid, v_nama);

    if v_item_tujuan is not null then
      insert into asset_log (asset_item_id, business_unit_id, outlet_id, aksi, kolom, sebelum, sesudah, catatan, oleh, oleh_nama)
      values (v_item_tujuan, v_bu_tujuan, p_to_outlet, 'transfer-masuk', v_kode, null, v_qty::text,
              'dari ' || (select name from outlets where id = p_from_outlet), v_uid, v_nama);
    end if;

    v_n := v_n + 1;
  end loop;

  if v_n = 0 then
    raise exception 'Tidak ada barang yang sah untuk dikirim.';
  end if;

  return jsonb_build_object('id', v_id, 'kode', v_kode, 'jumlah_barang', v_n);
end;
$$;

revoke all on function kirim_transfer_aset(uuid, uuid, text, text, jsonb, text, text) from public;
grant execute on function kirim_transfer_aset(uuid, uuid, text, text, jsonb, text, text) to authenticated;

-- ---------------------------------------------------------
-- BATALKAN
-- ---------------------------------------------------------
create or replace function batalkan_transfer_aset(p_id uuid, p_alasan text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  t record;
  r record;
  v_ada numeric;
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  if btrim(coalesce(p_alasan, '')) = '' then
    raise exception 'Alasan pembatalan wajib diisi.';
  end if;

  select * into t from asset_transfer where id = p_id for update;
  if t.id is null then raise exception 'Surat jalan tidak ditemukan.'; end if;
  if t.dibatalkan_at is not null then raise exception 'Surat jalan ini sudah dibatalkan.'; end if;
  if not is_bu_admin(v_uid, t.business_unit_id) then
    raise exception 'Hanya Admin BU pengirim yang boleh membatalkan transfer.';
  end if;

  -- ============ PERIKSA DULU SELURUHNYA, BARU UBAH ============
  --
  -- Kalau barang ketiga ternyata sudah terpakai di outlet tujuan, pembatalan
  -- harus gagal UTUH — bukan mengembalikan dua barang pertama lalu berhenti.
  -- Pembatalan separuh meninggalkan surat jalan yang tidak bisa dijelaskan
  -- oleh siapa pun.
  for r in select * from asset_transfer_item where transfer_id = p_id loop
    if r.item_tujuan_id is not null and t.to_outlet_id is not null then
      select qty into v_ada from asset_stock
       where asset_item_id = r.item_tujuan_id and outlet_id = t.to_outlet_id;
      if coalesce(v_ada, 0) < r.qty then
        raise exception 'Tidak bisa dibatalkan: "%" di outlet tujuan sekarang tinggal %, sedangkan surat jalan ini memindahkan %.',
          r.item_nama, coalesce(v_ada, 0), r.qty;
      end if;
    end if;
  end loop;

  for r in select * from asset_transfer_item where transfer_id = p_id loop
    if r.asset_item_id is not null then
      update asset_stock set qty = qty + r.qty, updated_by = v_uid, updated_at = now()
       where asset_item_id = r.asset_item_id and outlet_id = t.from_outlet_id;
    end if;
    if r.item_tujuan_id is not null and t.to_outlet_id is not null then
      update asset_stock set qty = qty - r.qty, updated_by = v_uid, updated_at = now()
       where asset_item_id = r.item_tujuan_id and outlet_id = t.to_outlet_id;
    end if;

    insert into asset_log (asset_item_id, business_unit_id, outlet_id, aksi, kolom, sebelum, sesudah, catatan, oleh, oleh_nama)
    values (r.asset_item_id, t.business_unit_id, t.from_outlet_id, 'batal-transfer', t.kode, null, r.qty::text,
            btrim(p_alasan), v_uid, nama_pengguna(v_uid));
  end loop;

  -- Barisnya TIDAK dihapus: surat jalan yang dibatalkan harus tetap terlihat
  -- beserta alasannya, kalau tidak ia cuma jadi stok yang berubah tanpa sebab.
  update asset_transfer
     set dibatalkan_at = now(), dibatalkan_by = v_uid,
         dibatalkan_by_nama = nama_pengguna(v_uid), alasan_batal = btrim(p_alasan)
   where id = p_id;

  return jsonb_build_object('kode', t.kode);
end;
$$;

revoke all on function batalkan_transfer_aset(uuid, text) from public;
grant execute on function batalkan_transfer_aset(uuid, text) to authenticated;

-- ---------------------------------------------------------
-- RLS
-- ---------------------------------------------------------
alter table asset_transfer enable row level security;
alter table asset_transfer_item enable row level security;

-- Terlihat oleh BU pengirim DAN BU tujuan.
--
-- Kalau cuma BU pengirim, outlet tujuan menerima barang yang tiba-tiba
-- bertambah tanpa bisa melihat surat jalannya — dan yang pertama ia lakukan
-- adalah menelepon untuk bertanya.
drop policy if exists asset_transfer_select on asset_transfer;
create policy asset_transfer_select on asset_transfer
  for select using (
    has_bu_scope(auth.uid(), business_unit_id)
    or exists (select 1 from outlets o where o.id = to_outlet_id and has_bu_scope(auth.uid(), o.business_unit_id))
  );

drop policy if exists asset_transfer_item_select on asset_transfer_item;
create policy asset_transfer_item_select on asset_transfer_item
  for select using (
    exists (
      select 1 from asset_transfer t
       where t.id = transfer_id
         and (
           has_bu_scope(auth.uid(), t.business_unit_id)
           or exists (select 1 from outlets o where o.id = t.to_outlet_id and has_bu_scope(auth.uid(), o.business_unit_id))
         )
    )
  );

-- Ditulis LEWAT RPC saja. Membuka `insert` langsung berarti surat jalan bisa
-- dibuat tanpa memindahkan stok — dokumen dan angka jadi berbeda, dan tidak
-- ada yang memberi tahu.

notify pgrst, 'reload schema';
