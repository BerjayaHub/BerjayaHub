-- =========================================================
-- Berjaya Hub OMS — 0110
-- Order ke CK milik OUTLET, bukan milik orang yang mengetiknya.
--
-- =========================================================
-- YANG DILAPORKAN
-- =========================================================
--
--   "tidak satu staff saja yang melakukan order, contoh elsa bagian bar
--    melakukan order, sudah jadi draft, lalu maskal bagian kitchen jika ingin
--    menambahkan orderan, dia tinggal edit draft yang sudah dibuat sebelumnya"
--
-- Tombol Edit-nya memang ada di layar, isinya memang termuat (RLS `select`
-- pada `stock_orders` memakai `has_bu_scope`, jadi Maskal boleh MEMBACA order
-- Elsa). Yang menolak baru muncul saat MENYIMPAN, di `0035`:
--
--     if v_o.created_by <> v_uid and not is_admin_of_outlet(v_uid, v_o.from_outlet_id) then
--       raise exception 'Hanya pembuat order atau admin outlet asal yang bisa mengubah';
--     end if;
--
-- Urutan yang paling buruk: Maskal menekan Edit, daftar Elsa muncul lengkap,
-- ia menambahkan lima bahan, menekan Simpan — lalu ditolak. Seluruh
-- pekerjaannya terbuang, dan pesannya menyebut aturan yang tidak bisa ia
-- penuhi.
--
-- =========================================================
-- ORDER ITU MILIK OUTLET
-- =========================================================
--
-- Anggapan lamanya: satu order = satu orang. Itu tidak cocok dengan cara
-- outlet bekerja. Satu order ke CK adalah kebutuhan SATU OUTLET untuk satu
-- pengiriman — bar menyumbang sirup, kitchen menyumbang daging, dan yang
-- berangkat dari CK cuma satu surat jalan.
--
-- Mengunci order ke pembuatnya memaksa tiap divisi membuat ordernya sendiri.
-- Akibatnya bukan sekadar merepotkan: CK menerima tiga order terpisah dari
-- satu outlet di hari yang sama, menyiapkan tiga keranjang, dan mengirim tiga
-- surat jalan untuk satu tujuan.
--
-- Pola yang benar sudah ada di repo ini sejak `0103`, pada draft surat jalan:
--
--     -- Draft milik OUTLET ASAL (CK), bukan milik pembuatnya. Shift pagi
--     -- menyiapkan, shift berikutnya yang mengirim — kalau dikunci ke pembuat,
--     -- draft H-1 tidak akan bisa disentuh orang yang masuk besoknya.
--     and has_outlet_scope(auth.uid(), d.from_outlet_id)
--
-- Alasannya sama persis. `0110` menyamakan order dengan draft.
--
-- =========================================================
-- APA YANG *TIDAK* DILONGGARKAN
-- =========================================================
--
--   - `has_outlet_scope`, BUKAN `has_bu_scope`. Membaca boleh selingkup BU
--     (itu yang membuat riwayat & dokumen bisa ditelusuri); MENGUBAH hanya
--     untuk orang di outlet asalnya. Staff Sentul tidak berkepentingan
--     menyunting order Serpong, dan kalau ia bisa, kesalahannya akan terlihat
--     seperti perbuatan orang Serpong.
--
--   - Order yang sudah `fulfilled` / `rejected` / `cancelled` tetap TIDAK bisa
--     disentuh. Penjaga `status <> 'open'` tidak diubah sedikit pun — CK sudah
--     terlanjur menyiapkan barangnya berdasarkan isi yang lama.
--
--   - `is_admin_of_outlet` dan `is_bu_admin` DIPAKAI apa adanya, tidak diubah.
--     Keduanya dipakai puluhan policy lain; mengubah isinya untuk keperluan
--     order akan diam-diam menggeser wewenang di seluruh modul.
--
-- =========================================================
-- MEMBATALKAN IKUT DILONGGARKAN — atas permintaan, dan itu dicatat di sini
-- =========================================================
--
-- `cancel_stock_order` (0031) dulu menuntut pembuat ATAU **admin BU**, jadi
-- admin outletnya sendiri pun tidak bisa. Sekarang disamakan dengan Edit:
-- siapa pun di outlet asal.
--
-- Ini keputusan yang saya tanyakan lebih dulu karena membatalkan itu MERUSAK
-- dan tidak bisa dikembalikan: satu orang bisa menghapus order yang sudah
-- diisi tiga rekannya. Yang dipilih adalah konsistensi — satu aturan untuk
-- satu objek, lebih mudah dijelaskan ke staff daripada "boleh mengubah tapi
-- tidak boleh membatalkan".
--
-- Yang meredam risikonya: `handled_by` sudah mencatat siapa yang membatalkan
-- (kolomnya sudah ada sejak 0031), dan ordernya tidak dihapus — statusnya
-- berubah jadi `cancelled` dan tetap terbaca di riwayat. Jadi "siapa yang
-- membatalkan order saya?" selalu bisa dijawab.
-- =========================================================

-- ---------------------------------------------------------
-- (1) MENGUBAH ORDER
-- ---------------------------------------------------------
create or replace function update_stock_order(p_order uuid, p_items jsonb, p_notes text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_o stock_orders%rowtype;
  v_uid uuid := auth.uid();
  it jsonb;
  v_pid uuid;
  v_qty numeric;
  v_count int := 0;
begin
  if v_uid is null then raise exception 'Harus login'; end if;

  select * into v_o from stock_orders where id = p_order;
  if v_o.id is null then raise exception 'Order tidak ditemukan'; end if;
  if v_o.status <> 'open' then raise exception 'Order sudah diproses, tidak bisa diubah'; end if;

  -- ORDER MILIK OUTLET ASALNYA. Lihat alasan panjangnya di kepala berkas.
  if not has_outlet_scope(v_uid, v_o.from_outlet_id) then
    raise exception 'Hanya staff outlet asal yang bisa mengubah order ini.';
  end if;

  delete from stock_order_items where order_id = p_order;

  for it in select * from jsonb_array_elements(p_items) loop
    v_pid := (it->>'product_id')::uuid;
    v_qty := (it->>'qty')::numeric;
    if v_pid is null or v_qty is null or v_qty <= 0 then continue; end if;
    insert into stock_order_items(order_id, product_id, qty) values (p_order, v_pid, v_qty);
    v_count := v_count + 1;
  end loop;

  -- ISINYA DIHAPUS DULU, BARU DITULIS ULANG — jadi kalau yang masuk nol, order
  -- akan tertinggal KOSONG. Penjagaan ini yang mencegahnya, dan ia harus
  -- `raise` (bukan sekadar `return`) supaya seluruh transaksinya dibatalkan
  -- dan isi lamanya kembali utuh.
  if v_count = 0 then raise exception 'Order harus berisi minimal satu produk'; end if;

  update stock_orders
    set notes = coalesce(p_notes, notes), edited_by = v_uid, edited_at = now()
    where id = p_order;
end;
$$;

-- ---------------------------------------------------------
-- (2) MEMBATALKAN ORDER
-- ---------------------------------------------------------
create or replace function cancel_stock_order(p_order uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_o stock_orders%rowtype;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Harus login'; end if;

  select * into v_o from stock_orders where id = p_order;
  if v_o.id is null then raise exception 'Order tidak ditemukan'; end if;
  if v_o.status <> 'open' then raise exception 'Order sudah diproses'; end if;

  -- Disamakan dengan Edit. `is_bu_admin` tetap diterima supaya admin BU yang
  -- TIDAK punya scope outlet itu (mis. super admin yang barisnya menunjuk satu
  -- BU saja) tidak kehilangan kemampuan yang sudah ia punya sejak 0031 —
  -- melonggarkan tidak boleh sekaligus mencabut.
  if not has_outlet_scope(v_uid, v_o.from_outlet_id)
     and not is_bu_admin(v_uid, v_o.business_unit_id) then
    raise exception 'Hanya staff outlet asal atau admin BU yang bisa membatalkan order ini.';
  end if;

  update stock_orders set status = 'cancelled', handled_by = v_uid, handled_at = now() where id = p_order;
end;
$$;

revoke all on function update_stock_order(uuid, jsonb, text) from public;
revoke all on function cancel_stock_order(uuid) from public;
grant execute on function update_stock_order(uuid, jsonb, text) to authenticated;
grant execute on function cancel_stock_order(uuid) to authenticated;

comment on function update_stock_order(uuid, jsonb, text) is
  'Ubah isi order yang masih open. Order milik OUTLET asal, bukan pembuatnya — siapa pun yang punya scope di outlet itu boleh menambah/mengurangi. Pengubah terakhir tercatat di edited_by/edited_at.';
comment on function cancel_stock_order(uuid) is
  'Batalkan order yang masih open. Wewenangnya sama dengan mengubah: staff outlet asal, atau admin BU. Pembatalnya tercatat di handled_by.';

notify pgrst, 'reload schema';
