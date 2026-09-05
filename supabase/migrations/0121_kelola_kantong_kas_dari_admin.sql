-- =========================================================
-- Berjaya Hub OMS — 0121
-- Admin bisa mengelola KANTONG KAS milik pemegang lain.
--
-- =========================================================
-- KENAPA INI ADA: 0120 TIDAK BISA DINYALAKAN OLEH SIAPA PUN
-- =========================================================
--
-- 0120 memberi `cash_accounts` sebuah kolom `outlet_id`, dan seluruh izin
-- "Shenda boleh membebani kas Risma" bergantung pada kolom itu terisi.
--
-- Ternyata tidak ada satu orang pun di sistem ini yang bisa mengisinya:
--
--   1. Satu-satunya layar yang bisa mengisi `outlet_id` adalah tombol
--      "Kelola Kas" di STAFF APP, dan tombol itu hanya digambar kalau
--      `cash_account_limit > 1`. Risma berjatah 1, jadi tombolnya tidak
--      pernah muncul untuknya.
--
--   2. Pemegang berjatah 1 bahkan TIDAK PUNYA baris `cash_accounts` sama
--      sekali — kasnya hidup sebagai `cash_entries.account_id = NULL`
--      ("Kas Utama"). Tidak ada baris, jadi tidak ada yang bisa diberi
--      outlet, dan `catat_kas_di(p_account, ...)` tidak punya apa pun untuk
--      ditunjuk.
--
--   3. Admin Portal → User → Kas hanya BACA: saldo, mutasi, kategori. Tidak
--      ada pengelolaan kantong di sana.
--
--   4. Sekalipun admin punya layarnya, RLS `cash_accounts_own` (0063)
--      ber-`with check (holder_id = auth.uid())` — super admin boleh MELIHAT
--      kantong orang lain, tapi tidak boleh MENULISNYA.
--
-- Jadi 0120 lengkap di database dan tidak bisa dicapai dari mana pun. Ini
-- persis bentuk kegagalan yang paling sering berulang di repo ini:
-- kemampuannya ada di database, jalannya tidak ada di layar.
--
-- =========================================================
-- BENTUK PERBAIKANNYA
-- =========================================================
--
-- Lewat RPC `security definer`, BUKAN dengan melonggarkan `cash_accounts_own`.
--
-- Melonggarkan `with check` menjadi "atau super admin" membuat super admin
-- bisa menulis kantong siapa pun lewat jalur tabel mana pun — termasuk yang
-- belum ada — dan RLS tidak bisa memaksakan hal-hal yang harus benar
-- bersamaan (jatah kantong, kantong berisi tidak boleh ditutup, nama tidak
-- bentrok). `atur_kantong_kas()` memeriksa semuanya di satu tempat.
--
-- Kebijakan 0063 SENGAJA tidak disentuh sedikit pun.
-- =========================================================

-- ---------------------------------------------------------
-- (1) DAFTAR KANTONG SELURUH PEMEGANG — untuk layar admin.
--
-- Termasuk baris semu "Kas Utama" (`id` NULL) untuk uang yang tidak berada di
-- kantong mana pun. Tanpa baris itu, admin melihat daftar kantong yang
-- kelihatan lengkap sementara sebagian besar uangnya justru tidak ada di
-- situ — dan ia akan menyimpulkan saldonya nol.
-- ---------------------------------------------------------
drop function if exists daftar_kantong_kas();
create function daftar_kantong_kas()
returns table (
  id uuid,
  holder_id uuid,
  holder_name text,
  name text,
  outlet_id uuid,
  outlet_name text,
  is_active boolean,
  sort_order int,
  balance numeric,
  jatah int,
  kantong_nyata boolean
)
language sql
security definer
stable
set search_path = public
as $$
  with saldo as (
    select ce.holder_id, ce.account_id, sum(ce.amount) as balance
      from cash_entries ce
     group by ce.holder_id, ce.account_id
  ),
  -- Pemegang = siapa pun yang punya kantong ATAU punya uang, supaya tidak ada
  -- saldo yang hilang dari layar hanya karena pemiliknya belum punya kantong.
  orang as (
    select holder_id from cash_accounts
    union
    select holder_id from saldo
  )
  select a.id,
         a.holder_id,
         up.full_name,
         a.name,
         a.outlet_id,
         o.name,
         a.is_active,
         a.sort_order,
         coalesce(s.balance, 0),
         coalesce(up.cash_account_limit, 1),
         true
    from cash_accounts a
    join user_profiles up on up.id = a.holder_id
    left join outlets o on o.id = a.outlet_id
    left join saldo s on s.holder_id = a.holder_id and s.account_id = a.id
   where is_super_admin(auth.uid())

  union all

  select null::uuid,
         p.holder_id,
         up.full_name,
         'Kas Utama',
         null::uuid,
         null::text,
         true,
         -1,
         coalesce(s.balance, 0),
         coalesce(up.cash_account_limit, 1),
         false
    from orang p
    join user_profiles up on up.id = p.holder_id
    left join saldo s on s.holder_id = p.holder_id and s.account_id is null
   where is_super_admin(auth.uid())
     and coalesce(s.balance, 0) <> 0

   order by 3, 11 desc, 8, 4;
$$;

revoke all on function daftar_kantong_kas() from public;
grant execute on function daftar_kantong_kas() to authenticated;

comment on function daftar_kantong_kas() is
  'Semua kantong kas di organisasi + baris semu Kas Utama untuk uang tanpa kantong. Super admin saja; kosong untuk yang lain.';

-- ---------------------------------------------------------
-- (2) BUAT / UBAH KANTONG milik siapa pun.
--
-- SEMUA PARAMETER WAJIB, tanpa satu pun `default`. Ini disengaja.
--
-- Bug 0119 ("+ Foto" menghapus nama supplier) lahir dari pemanggil yang
-- mengirim sebagian field dan diam-diam mengosongkan sisanya. Dengan tanpa
-- default, pemanggil yang lupa menyebut `p_outlet` mendapat "function does
-- not exist" — keras, langsung, di percobaan pertama — bukan kantong yang
-- kehilangan outletnya tanpa ada yang menyadari.
--
-- Konsekuensinya fungsi ini adalah TULIS PENUH: layar pemanggil wajib selalu
-- membawa keadaan lengkap kantongnya.
-- ---------------------------------------------------------
create or replace function atur_kantong_kas(
  p_id uuid,
  p_holder uuid,
  p_name text,
  p_outlet uuid,
  p_aktif boolean
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nama text := btrim(coalesce(p_name, ''));
  v_jatah int;
  v_aktif_lain int;
  v_saldo numeric;
  v_holder uuid;
  v_id uuid;
begin
  if not is_super_admin(auth.uid()) then
    raise exception 'Hanya super admin yang boleh mengatur kantong kas orang lain.';
  end if;
  if v_nama = '' then
    raise exception 'Nama kantong kas tidak boleh kosong.';
  end if;

  if p_id is null then
    v_holder := p_holder;
    if v_holder is null then
      raise exception 'Kantong baru harus menyebut pemegangnya.';
    end if;
    if not exists (select 1 from user_profiles where id = v_holder) then
      raise exception 'Pemegang kas tidak ditemukan.';
    end if;
  else
    select holder_id into v_holder from cash_accounts where id = p_id;
    if v_holder is null then
      raise exception 'Kantong kas tidak ditemukan.';
    end if;
    -- Kantong TIDAK BOLEH pindah tangan lewat fungsi ini. Memindahkannya
    -- berarti memindahkan seluruh riwayat uangnya ke orang lain tanpa satu
    -- pun entri yang mencatat perpindahan itu — dan saldo kedua orangnya
    -- berubah tanpa jejak. Transfer punya jalurnya sendiri.
    if p_holder is not null and p_holder <> v_holder then
      raise exception 'Kantong kas tidak bisa dipindahkan ke pemegang lain. Pakai Transfer.';
    end if;
  end if;

  if p_outlet is not null and not exists (select 1 from outlets where id = p_outlet) then
    raise exception 'Outlet tidak ditemukan.';
  end if;

  -- Jatah diperiksa DI SINI supaya pesannya ditujukan kepada orang yang
  -- sedang membacanya. Trigger `cek_batas_kantong_kas` (0063) berkata "Minta
  -- admin menambah jatahnya" — kalimat untuk staff, sementara yang berdiri di
  -- depan layar ini justru adminnya sendiri.
  if p_aktif then
    select coalesce(cash_account_limit, 1) into v_jatah from user_profiles where id = v_holder;
    select count(*) into v_aktif_lain
      from cash_accounts
     where holder_id = v_holder and is_active and id is distinct from p_id;
    if v_aktif_lain >= v_jatah then
      raise exception 'Jatah kantong kas orang ini sudah penuh (% kantong aktif). Naikkan dulu jatahnya di Master User → Edit.', v_jatah;
    end if;
  end if;

  -- Menutup kantong yang masih berisi uang akan membuat saldonya tidak bisa
  -- disentuh siapa pun — tetap terhitung di total, tapi tidak ada jalan
  -- memasukkan atau mengeluarkannya lagi.
  if p_id is not null and not p_aktif then
    select coalesce(sum(amount), 0) into v_saldo from cash_entries where account_id = p_id;
    if v_saldo <> 0 then
      -- Nominalnya ditulis apa adanya, bukan lewat `to_char` dengan pemisah
      -- ribuan: format `G` mengikuti `lc_numeric` server, dan di Supabase itu
      -- bukan setelan yang kita kendalikan. Angka mentah yang benar lebih
      -- berguna daripada angka rapi yang bisa salah titik-komanya.
      raise exception 'Kantong ini masih berisi Rp%. Pindahkan dulu isinya sebelum ditutup.', v_saldo;
    end if;
  end if;

  if exists (
    select 1 from cash_accounts
     where holder_id = v_holder and lower(name) = lower(v_nama) and id is distinct from p_id
  ) then
    raise exception 'Pemegang ini sudah punya kantong bernama "%".', v_nama;
  end if;

  if p_id is null then
    insert into cash_accounts (holder_id, name, outlet_id, is_active, sort_order)
    values (v_holder, v_nama, p_outlet, p_aktif,
            coalesce((select max(sort_order) + 1 from cash_accounts where holder_id = v_holder), 0))
    returning id into v_id;
  else
    update cash_accounts
       set name = v_nama,
           outlet_id = p_outlet,
           is_active = p_aktif
     where id = p_id
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

revoke all on function atur_kantong_kas(uuid, uuid, text, uuid, boolean) from public;
grant execute on function atur_kantong_kas(uuid, uuid, text, uuid, boolean) to authenticated;

comment on function atur_kantong_kas(uuid, uuid, text, uuid, boolean) is
  'Super admin membuat/mengubah kantong kas milik pemegang mana pun. TULIS PENUH: semua parameter wajib, tidak ada yang berarti "jangan sentuh".';

notify pgrst, 'reload schema';
