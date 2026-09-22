-- ============================================================
-- 0152 — ENTRI KAS BISA DIPINDAHKAN KE KANTONG.
--
-- ============ KEADAAN YANG DIPERBAIKI ============
--
-- Form Catat Kas Keluar hanya menggambar pilihan kantong kalau jatah kantong
-- pemegangnya LEBIH DARI SATU (`pakaiKantong = limit > 1` di `cash.page.js`).
-- Itu salah pertanyaan: jatah mengatur BERAPA BANYAK kantong boleh dipunyai,
-- bukan APAKAH perlu ditanya. Orang yang punya tepat satu kantong justru yang
-- paling jelas jawabannya — dan justru dia yang tidak pernah ditanya.
--
-- Akibatnya `account_id` NULL, dan uangnya mendarat di "Kas Utama".
--
-- Sementara itu pembayaran nota lewat modul Bahan SELALU memilih kantong
-- secara eksplisit. Dua jalur menulis tabel yang sama; satu bertanya, satu
-- tidak. Hasilnya terlihat di layar Kantong Kas sebagai angka yang mustahil:
--
--     Kas Serpong   Rp -46.000     <- pembayaran nota, membebani kantong
--     Kas Utama     Rp +101.600    <- kas masuk & keluar tanpa kantong
--
-- Saldo totalnya benar (Rp 55.600). Yang salah cuma pembagiannya — dan
-- pembagian itulah yang jadi kolom `Account` berkas ESB Disbursement (0151),
-- jadi entri Kas Utama tertahan.
--
-- ============ KENAPA "PINDAH KAS" TIDAK MENYELESAIKANNYA ============
--
-- `pindah_kas()` (0063) memindahkan SALDO dengan membuat sepasang entri baru.
-- Entri belanja aslinya tetap ber-`account_id` NULL, jadi tetap tertahan saat
-- diekspor. Yang perlu diubah adalah kantong pada entrinya sendiri.
--
-- ============ KENAPA LEWAT RPC, DAN KENAPA MENUMPANG PENJAGA LAMA ============
--
-- `cash.admin.page.js` sudah berkata: "Pemegang, kantong, jenis, dan foto
-- notanya tidak bisa diubah dari sini." Aturan itu ada alasannya, dan
-- alasannya TETAP BERLAKU untuk entri yang berpasangan dengan baris lain:
-- pembayaran nota, penyesuaian nota, transfer. Yang dibuka di sini hanya
-- entri kas yang berdiri sendiri.
--
-- Supaya "yang berdiri sendiri" tidak punya dua definisi, fungsinya MENUMPANG
-- `alasan_tolak_koreksi_kas` (0141, ditulis ulang di 0149) alih-alih menyalin
-- daftar syaratnya. Daftar yang disalin akan menyimpang, dan menyimpangnya
-- berbentuk: dialog koreksi menolak sebuah entri sementara aksi massal
-- menerimanya — untuk baris yang sama.
-- ============================================================

-- ---------------------------------------------------------
-- (0) `boleh_koreksi_kas` MENJAWAB NULL, dan NULL bukan "tidak boleh".
--
-- ============ DITEMUKAN SAAT MENULIS TES 0152 ============
--
-- Bentuknya (0141):
--
--     select is_super_admin(auth.uid())
--         or p_holder = auth.uid()
--         or exists (…);
--
-- Tanpa sesi, `auth.uid()` NULL. Suku pertama `false`, suku ketiga `false`,
-- dan suku kedua — `p_holder = NULL` — bernilai **NULL**. `false or NULL or
-- false` adalah NULL, bukan false.
--
-- Akibatnya di pemanggilnya:
--
--     if not boleh_koreksi_kas(v.holder_id) then return 'bukan wewenangmu';
--
-- `not NULL` juga NULL, jadi `IF`-nya TIDAK menyala — dan
-- `alasan_tolak_koreksi_kas` jatuh sampai `return null`, yang artinya
-- "tidak ada alasan menolak". Pemanggil tanpa sesi dinyatakan BOLEH.
--
-- Hari ini itu tidak bisa dicapai dari luar: `grant execute` hanya untuk
-- `authenticated`, jadi PostgREST menolak anon sebelum fungsinya jalan. Tapi
-- fungsi ini adalah SATU-SATUNYA tempat jawaban "boleh atau tidak" tinggal,
-- dan jawaban NULL dari sana akan diteruskan apa adanya oleh pemanggil
-- berikutnya yang lupa mem-`coalesce`. Ditutup di sumbernya, sekali.
--
-- Seluruh isi 0141 disalin APA ADANYA — hanya dibungkus `coalesce`. Menulis
-- ulang fungsi berarti mengetik ulang seluruh isinya, dan yang terlupa di sini
-- berbentuk "admin BU mendadak tidak bisa mengoreksi apa pun".
-- ---------------------------------------------------------
create or replace function boleh_koreksi_kas(p_holder uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    is_super_admin(auth.uid())
    -- Pemegangnya sendiri: ia yang menanggung selisihnya.
    or p_holder = auth.uid()
    -- Admin BU mana pun tempat pemegangnya bernaung. SENGAJA TANPA SYARAT
    -- OUTLET — kas masuk tidak punya peruntukan (0063), jadi syarat outlet
    -- akan diam-diam menutup SELURUH baris kas masuk. Lihat catatan panjang
    -- di 0141.
    or exists (
      select 1
      from membership_scopes ms
      where ms.user_id = p_holder
        and ms.business_unit_id is not null
        and is_bu_admin(auth.uid(), ms.business_unit_id)
    ),
    false
  );
$$;

revoke all on function boleh_koreksi_kas(uuid) from public;
grant execute on function boleh_koreksi_kas(uuid) to authenticated;

comment on function boleh_koreksi_kas(uuid) is
  'Boleh tidaknya auth.uid() mengubah/mencoret entri kas milik p_holder. Super admin, pemegangnya sendiri, atau admin BU tempat pemegangnya bernaung. Sejak 0152 TIDAK PERNAH menjawab NULL — `not NULL` tidak menyalakan IF, dan pemanggil tanpa sesi lolos.';

-- ---------------------------------------------------------
-- (1) Kantong milik seorang pemegang — untuk layar yang memindahkan.
--
-- `daftar_kantong_kas()` (0121) hanya melayani SUPER ADMIN. Admin BU boleh
-- mengoreksi kas orang yang bernaung di BU-nya sejak 0141, jadi ia juga harus
-- bisa melihat kantong apa saja yang tersedia — kalau tidak, aksi
-- "Pindahkan ke kantong" akan membuka dialog dengan daftar kosong, yang
-- terbaca sebagai "orang ini tidak punya kantong" padahal ia punya.
--
-- Wewenangnya persis `boleh_koreksi_kas`: siapa yang boleh mengubah entrinya,
-- dia pula yang boleh melihat kantong tujuannya. Satu aturan, bukan dua.
-- ---------------------------------------------------------
create or replace function kantong_pemegang(p_holder uuid)
returns table (
  id uuid,
  name text,
  outlet_id uuid,
  outlet_name text
)
language sql
security definer
stable
set search_path = public
as $$
  select a.id, a.name, a.outlet_id, o.name
    from cash_accounts a
    left join outlets o on o.id = a.outlet_id
   where a.holder_id = p_holder
     and a.is_active
     and boleh_koreksi_kas(p_holder)
   order by a.sort_order, a.name;
$$;

revoke all on function kantong_pemegang(uuid) from public;
grant execute on function kantong_pemegang(uuid) to authenticated;

comment on function kantong_pemegang(uuid) is
  'Kantong kas AKTIF milik seorang pemegang, untuk layar yang memindahkan entri. Wewenangnya sama dengan `boleh_koreksi_kas` — bukan super-admin-only seperti `daftar_kantong_kas`.';

-- ---------------------------------------------------------
-- (2) Pindahkan beberapa entri ke sebuah kantong.
--
-- MENGEMBALIKAN JUMLAH BARIS YANG SUNGGUH BERUBAH, bukan void. Layarnya
-- membandingkannya dengan yang dicentang — melaporkan "berhasil" begitu saja
-- untuk 0 baris membuat orang mengira pekerjaannya selesai, lalu heran kenapa
-- ekspornya masih menahan entri yang sama.
-- ---------------------------------------------------------
create or replace function ubah_kantong_kas(p_entries uuid[], p_account uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_akun cash_accounts%rowtype;
  v_n int;
begin
  if p_entries is null or array_length(p_entries, 1) is null then
    return 0;
  end if;

  -- KANTONG TUJUAN WAJIB. Memindahkan KE Kas Utama (NULL) bukan perbaikan —
  -- itu justru keadaan yang sedang dibereskan — dan membiarkannya diterima
  -- membuat salah klik menghasilkan pekerjaan mundur tanpa pesan apa pun.
  if p_account is null then
    raise exception 'Pilih kantong tujuannya dulu. Memindahkan kembali ke Kas Utama tidak membereskan apa pun.';
  end if;

  select * into v_akun from cash_accounts where id = p_account;
  if v_akun.id is null then
    raise exception 'Kantong kasnya tidak ditemukan. Mungkin baru dihapus — muat ulang halamannya.';
  end if;
  if not v_akun.is_active then
    raise exception 'Kantong "%" sudah tidak aktif. Pilih kantong lain, atau aktifkan dulu di Kantong Kas.', v_akun.name;
  end if;
  if not boleh_koreksi_kas(v_akun.holder_id) then
    raise exception 'Kantong itu bukan wewenangmu.';
  end if;

  update cash_entries c
     set account_id = p_account,
         -- Jejaknya MENUMPANG `diubah_by`/`diubah_at`, bukan kolom baru.
         --
         -- Memindahkan kantong MEMANG koreksi, dan layar kas sudah menggambar
         -- baris "Diubah oleh … · tanggal" dari kedua kolom itu — di Admin
         -- Portal maupun di Staff App pemegangnya. Kolom jejak kelima yang
         -- tidak digambar di mana pun sama saja dengan tidak ada jejak.
         diubah_by = v_uid,
         diubah_at = now()
   where c.id = any(p_entries)
     -- Entri yang SUDAH di kantong itu dilewati, bukan ditulisi jejak
     -- perubahan yang tidak pernah terjadi.
     and c.account_id is distinct from p_account
     -- KANTONG HARUS MILIK PEMEGANG ENTRINYA. Tanpa ini, uang seseorang bisa
     -- dipindahkan ke kantong orang lain — saldo keduanya berubah sekaligus,
     -- dan tidak ada satu pun layar yang menyebutnya sebagai transfer.
     and c.holder_id = v_akun.holder_id
     -- SELURUH syarat "boleh dikoreksi" datang dari SATU tempat: sudah
     -- diekspor, sudah dicoret, transfer, pembayaran nota, penyesuaian nota,
     -- dan wewenangnya. Menyalin daftarnya ke sini berarti dua definisi yang
     -- cepat atau lambat berbeda — dan bedanya berbentuk dialog koreksi
     -- menolak baris yang aksi massal ini terima.
     and alasan_tolak_koreksi_kas(c.id) is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function ubah_kantong_kas(uuid[], uuid) from public;
grant execute on function ubah_kantong_kas(uuid[], uuid) to authenticated;

comment on function ubah_kantong_kas(uuid[], uuid) is
  'Pindahkan beberapa entri kas ke sebuah kantong milik pemegang yang sama. Syarat boleh-tidaknya menumpang `alasan_tolak_koreksi_kas`, jadi tidak bisa menyimpang dari dialog koreksi. Mengembalikan jumlah baris yang sungguh berubah.';

notify pgrst, 'reload schema';
