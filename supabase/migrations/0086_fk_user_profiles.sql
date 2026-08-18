-- =========================================================
-- 0086 — Perbaikan FK: kolom "siapa" harus menunjuk user_profiles,
--        bukan auth.users
--
-- ============ GEJALANYA ============
--
--   Could not find a relationship between 'stock_counts' and 'user_profiles'
--   in the schema cache
--
-- Tab Opname di Admin Portal gagal total. Bukan kolom nama yang kosong —
-- SELURUH daftarnya tidak tampil, karena satu embed yang gagal membatalkan
-- seluruh query PostgREST.
--
-- ============ SEBABNYA ============
--
-- `0084` dan `0085` mendeklarasikan kolom pelakunya begini:
--
--     opened_by uuid references auth.users(id)
--
-- padahal 20+ tabel lain di repo ini konsisten memakai:
--
--     created_by uuid references user_profiles(id) on delete set null
--
-- PostgREST menyusun embed dari FOREIGN KEY yang benar-benar ada. Menulis
-- `user_profiles!opened_by(full_name)` di atas FK yang menunjuk `auth.users`
-- bukan sekadar tidak optimal — relasinya memang tidak ada, jadi permintaannya
-- ditolak.
--
-- Nilainya sendiri tidak salah: `user_profiles.id` MEMANG `auth.users.id`
-- (0001 baris 95). Yang salah cuma ke mana FK-nya menunjuk. Jadi tidak ada
-- data yang perlu dipindahkan — hanya constraint yang perlu diarahkan ulang.
--
-- ============ KENAPA INI LOLOS SEMUA PEMERIKSAAN ============
--
-- Perlu dicatat jujur: repo ini punya `audit-embed-ambigu` yang memastikan
-- setiap embed menyebut kolom FK-nya, dan `audit-kolom-tabel` yang memeriksa
-- 983 pemakaian kolom terhadap skema. Dua-duanya HIJAU untuk kode yang rusak
-- ini — karena keduanya memeriksa nama kolom dan bentuk penulisan, bukan
-- apakah relasi yang diminta benar-benar ada.
--
-- Kegagalannya hanya muncul di server sungguhan. `audit-fk-pelaku.cjs`
-- ditambahkan supaya kelas kesalahan ini tertangkap sebelum sampai ke sana.
--
-- ============ 0079 IKUT DIPERBAIKI ============
--
-- `reservations.deposit_by` punya cacat yang sama sejak `0079`, tapi BELUM
-- pernah bergejala: tidak ada satu pun layar yang meng-embed `user_profiles`
-- lewat kolom itu. Diperbaiki sekarang justru karena begitu: perangkap yang
-- diam adalah perangkap yang akan diinjak nanti, oleh orang yang wajar saja
-- mengira polanya sudah seragam.
--
-- Migration ini AMAN DIJALANKAN ULANG.
-- =========================================================

-- ---------------------------------------------------------
-- Pemeriksaan dulu, ubah belakangan.
--
-- Constraint baru ditambahkan dalam keadaan TERVALIDASI supaya PostgREST
-- pasti memakainya. Kalau ada baris yang menunjuk user tanpa profil, PG akan
-- menolak dengan pesan yang sulit dibaca di tengah migration — jadi kasusnya
-- diperiksa lebih dulu dan dilaporkan dengan jelas.
--
-- Dalam praktiknya ini nyaris mustahil: profil dibuat bersamaan dengan
-- usernya, dan menghapus auth user akan meng-cascade profilnya sekaligus.
-- Pemeriksaan ini ada supaya kalau toh terjadi, yang terbaca adalah masalah
-- sebenarnya, bukan nomor constraint.
-- ---------------------------------------------------------
do $$
declare
  yatim text := '';
  n bigint;
begin
  select count(*) into n from goods_receipts g
    where g.created_by is not null
      and not exists (select 1 from user_profiles u where u.id = g.created_by);
  if n > 0 then yatim := yatim || format('goods_receipts.created_by: %s baris; ', n); end if;

  select count(*) into n from stock_counts s
    where s.opened_by is not null
      and not exists (select 1 from user_profiles u where u.id = s.opened_by);
  if n > 0 then yatim := yatim || format('stock_counts.opened_by: %s baris; ', n); end if;

  select count(*) into n from stock_counts s
    where s.closed_by is not null
      and not exists (select 1 from user_profiles u where u.id = s.closed_by);
  if n > 0 then yatim := yatim || format('stock_counts.closed_by: %s baris; ', n); end if;

  select count(*) into n from stock_count_items s
    where s.counted_by is not null
      and not exists (select 1 from user_profiles u where u.id = s.counted_by);
  if n > 0 then yatim := yatim || format('stock_count_items.counted_by: %s baris; ', n); end if;

  select count(*) into n from reservations r
    where r.deposit_by is not null
      and not exists (select 1 from user_profiles u where u.id = r.deposit_by);
  if n > 0 then yatim := yatim || format('reservations.deposit_by: %s baris; ', n); end if;

  if yatim <> '' then
    raise exception
      'Ada baris yang menunjuk user tanpa baris di user_profiles, jadi FK-nya belum bisa dipasang: %'
      '  Perbaiki dulu (buatkan profilnya, atau set kolomnya NULL) lalu jalankan 0086 lagi.', yatim;
  end if;
end $$;

-- ---------------------------------------------------------
-- Arahkan ulang FK-nya.
--
-- Nama constraint bawaan PostgreSQL: <tabel>_<kolom>_fkey. `if exists`
-- dipakai supaya migration ini tetap jalan di database yang skemanya sudah
-- benar (mis. instalasi baru yang menjalankan 0084/0085 versi perbaikan).
-- ---------------------------------------------------------

-- goods_receipts.created_by (0084)
alter table goods_receipts drop constraint if exists goods_receipts_created_by_fkey;
alter table goods_receipts
  add constraint goods_receipts_created_by_fkey
  foreign key (created_by) references user_profiles(id) on delete set null;

-- stock_counts.opened_by / closed_by (0085)
alter table stock_counts drop constraint if exists stock_counts_opened_by_fkey;
alter table stock_counts
  add constraint stock_counts_opened_by_fkey
  foreign key (opened_by) references user_profiles(id) on delete set null;

alter table stock_counts drop constraint if exists stock_counts_closed_by_fkey;
alter table stock_counts
  add constraint stock_counts_closed_by_fkey
  foreign key (closed_by) references user_profiles(id) on delete set null;

-- stock_count_items.counted_by (0085)
alter table stock_count_items drop constraint if exists stock_count_items_counted_by_fkey;
alter table stock_count_items
  add constraint stock_count_items_counted_by_fkey
  foreign key (counted_by) references user_profiles(id) on delete set null;

-- reservations.deposit_by (0079) — belum bergejala, tetap diseragamkan.
alter table reservations drop constraint if exists reservations_deposit_by_fkey;
alter table reservations
  add constraint reservations_deposit_by_fkey
  foreign key (deposit_by) references user_profiles(id) on delete set null;

-- ---------------------------------------------------------
-- Beri tahu PostgREST supaya skemanya dibaca ulang.
--
-- TANPA INI errornya TIDAK HILANG meski constraint-nya sudah benar: PostgREST
-- menyimpan skema di cache, dan cache itu hanya disegarkan saat ada NOTIFY
-- atau saat servisnya restart. Gejalanya persis sama seperti sebelum
-- diperbaiki — mudah sekali disimpulkan "migrationnya tidak jalan".
-- ---------------------------------------------------------
notify pgrst, 'reload schema';
