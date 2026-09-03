-- =========================================================
-- Berjaya Hub OMS — 0116
-- Menonaktifkan menu di sebuah outlet ikut membersihkan RENCANA-nya di sana.
--
-- =========================================================
-- BUG YANG DIPERBAIKI, DAN KENAPA IA TIDAK TERLIHAT
-- =========================================================
--
--   Beras: stok 17.280 gr, takaran 200 gr/porsi — 86 porsi.
--   Menunya tetap berbunyi "bahan habis".
--
-- Perkiraan "bisa dibuat" mengurangi bahan yang sudah dijanjikan menu LAIN
-- yang rencananya diisi hari itu (lihat `perkiraan.js`). Pengurangan itu benar
-- dan harus tetap ada — tanpanya, satu kilo ayam bisa terbaca sebagai
-- "Nasi Ayam 5 · Soto 10 · Ayam Goreng 4" sekaligus.
--
-- Yang salah: rencana untuk menu yang outletnya TIDAK jual ikut dihitung.
-- Sebelum 0115 seluruh 162 menu tampil di setiap outlet, jadi rencana seperti
-- itu mudah sekali terisi.
--
-- Dan sesudah 0115 keadaannya justru MEMBURUK: barisnya tidak muncul lagi di
-- layar, sehingga stoknya tetap termakan sementara penyebabnya tidak ada di
-- layar mana pun untuk dilihat, apalagi dikosongkan.
--
-- =========================================================
-- DUA PERBAIKAN, DAN KEDUANYA DIPERLUKAN
-- =========================================================
--
--   1. LAYAR berhenti menghitungnya (`aktif` di `petaPerkiraan`, 0116-js).
--      Ini yang membuat angkanya benar SEKARANG, tanpa menunggu apa pun.
--
--   2. DATANYA dibersihkan — di sini. Baris rencana yang sudah tidak berlaku
--      tidak punya arti apa pun lagi: ia tidak bisa dilihat, tidak bisa
--      diubah, dan tidak boleh berpengaruh. Membiarkannya berarti menyimpan
--      data yang satu-satunya kemampuannya adalah membingungkan orang
--      berikutnya yang membaca tabelnya.
--
-- Perbaikan (1) saja tidak cukup karena tabelnya tetap kotor. Perbaikan (2)
-- saja tidak cukup karena rencana bisa terisi lagi sebelum pembatasannya
-- diperbarui, dan karena PWA lama di HP staff masih menghitung dengan cara
-- lama sampai ia memperbarui dirinya.
--
-- =========================================================
-- HANYA HARI INI DAN KE DEPAN
-- =========================================================
--
-- `plan_date >= hari ini (WIB)`. Rencana tanggal LAMPAU adalah catatan tentang
-- apa yang direncanakan hari itu — ia tidak lagi memengaruhi perhitungan mana
-- pun (layar hanya membaca rencana hari berjalan), dan menghapusnya berarti
-- menghapus riwayat untuk membereskan sesuatu yang sudah tidak berpengaruh.
--
-- Pengaturan tampilan tidak boleh menulis ulang catatan masa lalu. Aturan yang
-- sama sudah berlaku untuk penjualan di `0115`.
-- =========================================================

-- ---------------------------------------------------------
-- Rencana yang sudah tidak berlaku di sebuah outlet, dibersihkan.
--
-- Dipisah jadi fungsinya sendiri supaya kedua RPC penulis memanggil hal yang
-- SAMA. Menyalin `delete`-nya ke dua tempat berarti dua definisi "rencana yang
-- tidak berlaku", dan bedanya baru terlihat pada kasus yang jarang dipakai.
-- ---------------------------------------------------------
create or replace function bersihkan_rencana_menu_nonaktif(p_outlet uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hapus integer;
begin
  delete from menu_plans mp
   where mp.outlet_id = p_outlet
     and mp.plan_date >= (now() at time zone 'Asia/Jakarta')::date
     and not exists (
       select 1 from menu_aktif_outlet(p_outlet) a where a.product_id = mp.product_id
     );
  get diagnostics v_hapus = row_count;
  return v_hapus;
end;
$$;

revoke all on function bersihkan_rencana_menu_nonaktif(uuid) from public;
grant execute on function bersihkan_rencana_menu_nonaktif(uuid) to authenticated;

comment on function bersihkan_rencana_menu_nonaktif(uuid) is
  'Hapus rencana menu (hari ini & ke depan) untuk menu yang tidak lagi dijual di outlet itu. Tidak menyentuh tanggal lampau.';

-- ---------------------------------------------------------
-- `set_menu_outlet` — sesudah pembatasan disimpan, rencananya dibereskan.
--
-- Badan fungsinya sama persis dengan 0115 kecuali blok terakhir. Ditulis ulang
-- utuh, bukan ditambal, karena `create or replace` memang mengganti seluruhnya
-- — dan versi yang setengah disalin adalah cara paling mudah kehilangan satu
-- penjagaan tanpa menyadarinya.
-- ---------------------------------------------------------
create or replace function set_menu_outlet(p_product uuid, p_outlets uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bu uuid;
  v_uid uuid := auth.uid();
  v_o uuid;
begin
  select business_unit_id into v_bu from products where id = p_product;
  if v_bu is null then
    raise exception 'Menu tidak ditemukan.';
  end if;

  if not is_bu_admin(v_uid, v_bu) then
    raise exception 'Hanya admin yang boleh mengatur menu aktif per outlet.';
  end if;

  delete from menu_outlet_aktif where product_id = p_product;

  if p_outlets is not null and array_length(p_outlets, 1) is not null then
    foreach v_o in array p_outlets loop
      if not exists (select 1 from outlets where id = v_o and business_unit_id = v_bu) then
        raise exception 'Outlet % bukan milik BU menu ini.', v_o;
      end if;
      insert into menu_outlet_aktif (business_unit_id, product_id, outlet_id, created_by)
      values (v_bu, p_product, v_o, v_uid)
      on conflict (product_id, outlet_id) do nothing;
    end loop;
  end if;

  -- SESUDAH pembatasannya tersimpan, bukan sebelumnya.
  --
  -- `bersihkan_rencana_menu_nonaktif` membaca `menu_aktif_outlet`, jadi ia
  -- harus melihat keadaan yang BARU. Memanggilnya lebih dulu akan membersihkan
  -- menurut aturan lama — dan pada perubahan yang melonggarkan pembatasan, ia
  -- justru menghapus rencana yang seharusnya tetap berlaku.
  --
  -- Seluruh outlet BU disapu, bukan hanya yang ada di `p_outlets`: yang
  -- rencananya perlu dibersihkan justru outlet yang baru saja DIKELUARKAN dari
  -- daftar, dan outlet itu menurut definisinya tidak ada di sana.
  perform bersihkan_rencana_menu_nonaktif(o.id)
     from outlets o
    where o.business_unit_id = v_bu;
end;
$$;

revoke all on function set_menu_outlet(uuid, uuid[]) from public;
grant execute on function set_menu_outlet(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------
-- `set_menu_outlet_massal` — sama, untuk arah sebaliknya.
-- ---------------------------------------------------------
create or replace function set_menu_outlet_massal(p_outlet uuid, p_menus uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bu uuid;
  v_uid uuid := auth.uid();
  v_p uuid;
  v_lain uuid[];
  v_buntu text[] := '{}';
begin
  select business_unit_id into v_bu from outlets where id = p_outlet;
  if v_bu is null then raise exception 'Outlet tidak ditemukan.'; end if;
  if not is_bu_admin(v_uid, v_bu) then
    raise exception 'Hanya admin yang boleh mengatur menu aktif per outlet.';
  end if;

  select coalesce(array_agg(id), '{}') into v_lain
    from outlets where business_unit_id = v_bu and id <> p_outlet;

  -- Pemeriksaan "tidak dijual di mana pun" — lihat alasan panjangnya di 0115.
  select coalesce(array_agg(p.name order by p.name), '{}') into v_buntu
    from products p
   where p.business_unit_id = v_bu
     and p.product_type = 'finished'
     and coalesce(p.is_active, true)
     and not (p.id = any(coalesce(p_menus, '{}'::uuid[])))
     and (
       (exists (select 1 from menu_outlet_aktif m where m.product_id = p.id)
        and not exists (
          select 1 from menu_outlet_aktif m
           where m.product_id = p.id and m.outlet_id <> p_outlet
        ))
       or (not exists (select 1 from menu_outlet_aktif m where m.product_id = p.id)
           and array_length(v_lain, 1) is null)
     );

  if array_length(v_buntu, 1) is not null then
    raise exception
      'Menu ini hanya dijual di outlet ini: %. Mencabutnya berarti menu tidak dijual di mana pun, dan itu tidak bisa disimpan di sini — nonaktifkan menunya di Master Produk, atau centang dulu outlet lain yang menjualnya.',
      array_to_string(v_buntu, ', ');
  end if;

  for v_p in
    select id from products
     where business_unit_id = v_bu and product_type = 'finished' and coalesce(is_active, true)
  loop
    if v_p = any(coalesce(p_menus, '{}'::uuid[])) then
      if exists (select 1 from menu_outlet_aktif where product_id = v_p) then
        insert into menu_outlet_aktif (business_unit_id, product_id, outlet_id, created_by)
        values (v_bu, v_p, p_outlet, v_uid)
        on conflict (product_id, outlet_id) do nothing;
      end if;
    else
      if exists (select 1 from menu_outlet_aktif where product_id = v_p) then
        delete from menu_outlet_aktif where product_id = v_p and outlet_id = p_outlet;
      else
        insert into menu_outlet_aktif (business_unit_id, product_id, outlet_id, created_by)
        select v_bu, v_p, o, v_uid from unnest(v_lain) o
        on conflict (product_id, outlet_id) do nothing;
      end if;
    end if;
  end loop;

  -- Seluruh outlet BU, bukan hanya `p_outlet`.
  --
  -- Cabang "belum dibatasi, sekarang dicabut di sini" MENULIS baris untuk
  -- outlet lain. Itu tidak mengubah apa yang aktif di sana — mereka tetap
  -- menjualnya — tapi memeriksa semuanya jauh lebih murah daripada menalar
  -- outlet mana yang mungkin terpengaruh, dan penalaran seperti itu adalah
  -- tempat kesalahan diam-diam bersembunyi.
  perform bersihkan_rencana_menu_nonaktif(o.id)
     from outlets o
    where o.business_unit_id = v_bu;
end;
$$;

revoke all on function set_menu_outlet_massal(uuid, uuid[]) from public;
grant execute on function set_menu_outlet_massal(uuid, uuid[]) to authenticated;

notify pgrst, 'reload schema';
