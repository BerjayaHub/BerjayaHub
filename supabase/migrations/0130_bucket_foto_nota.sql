-- =========================================================
-- Berjaya Hub OMS — 0130
-- Perbaikan: foto nota tidak bisa diunggah, "Bucket not found".
--
-- =========================================================
-- APA YANG SEBENARNYA TERJADI
-- =========================================================
--
--   "di terima dari supplier masih tidak bisa upload foto nota,
--    keterangan no bucket"
--
-- Buckets-nya memang tidak ada. Bukan salah izin, bukan salah nama — wadahnya
-- sendiri belum pernah terbentuk.
--
-- Sebabnya ada di bentuk `0084`, bukan di isinya:
--
--   baris  71  create policy gr_select on goods_receipts        <-- TANPA drop
--   baris  75  create policy gr_modify on goods_receipts
--   baris  79  create policy gri_select on goods_receipt_items
--   baris  83  create policy gri_modify on goods_receipt_items
--   ...
--   baris 263  insert into storage.buckets ... 'receipt-photos'  <-- di UJUNG
--
-- `create policy` tanpa `drop policy if exists` GAGAL kalau kebijakannya sudah
-- ada. Jadi begitu `0084` dijalankan untuk kedua kalinya — hal yang wajar saat
-- sebuah migration dijalankan ulang setelah sesuatu di tengah gagal — ia
-- berhenti di baris 71, dan **tidak pernah sampai ke baris 263**.
--
-- Hasilnya keadaan yang paling sulit dikenali: tabel notanya ada, layarnya
-- ada, nota bisa disimpan, semuanya bekerja — kecuali satu tombol, dan
-- tombol itu menjawab dengan kalimat teknis yang tidak menyebut sebabnya.
--
-- =========================================================
-- KENAPA SELURUH BUCKET, BUKAN CUMA YANG DILAPORKAN
-- =========================================================
--
-- Kegagalan ini bukan sifat `receipt-photos`, melainkan sifat migration yang
-- tidak bisa dijalankan ulang — dan berkas seperti itu ada beberapa (`0006`,
-- `0013`, `0016`, `0026`, `0084` semuanya `create policy` tanpa `drop`).
-- Bucket mana pun yang pembuatannya berada SESUDAH salah satu kebijakan itu
-- bisa hilang dengan cara yang sama, dan tidak akan ada yang tahu sampai ada
-- yang menekan tombol unggahnya.
--
-- Menyisipkan seluruhnya di sini harganya nol: `on conflict do nothing` tidak
-- melakukan apa-apa untuk yang sudah ada, dan `public` sengaja disamakan
-- dengan nilai aslinya masing-masing supaya bucket yang SUDAH benar tidak
-- berubah sifatnya.
--
-- Berkas ini sendiri dibuat AMAN DIJALANKAN BERULANG — itu inti pelajarannya.
-- =========================================================

-- ---------------------------------------------------------
-- (1) Seluruh bucket yang dipakai aplikasi.
--
-- Nilai `public` mengikuti migration aslinya. Yang memuat wajah orang, uang,
-- atau harga beli TIDAK publik; yang cuma logo & tema BU boleh publik.
-- ---------------------------------------------------------
insert into storage.buckets (id, name, public) values
  ('receipt-photos',     'receipt-photos',     false),  -- 0084 — foto nota supplier
  ('attendance-selfies', 'attendance-selfies', false),  -- 0006
  ('cash-proofs',        'cash-proofs',        false),  -- 0026
  ('checklist-photos',   'checklist-photos',   false),  -- 0016
  ('leave-attachments',  'leave-attachments',  false),  -- 0013
  ('asset-photos',       'asset-photos',       false),  -- 0045
  ('staff-photos',       'staff-photos',       false),  -- 0032
  ('reservation-proofs', 'reservation-proofs', false),  -- 0078
  ('owner-signature',    'owner-signature',    false),  -- 0094
  ('documents',          'documents',          false)   -- 0094
on conflict (id) do nothing;

-- `bu-logos` dipisah karena ia satu-satunya yang PUBLIK: logo & tema BU dimuat
-- halaman reservasi publik, sebelum siapa pun login. Menyatukannya ke daftar
-- di atas mengundang seseorang menyalin barisnya lalu ikut membuat bucket baru
-- yang publik tanpa sadar.
insert into storage.buckets (id, name, public)
values ('bu-logos', 'bu-logos', true)
on conflict (id) do nothing;

-- ---------------------------------------------------------
-- (2) Kebijakan foto nota, dipasang ulang secara idempotent.
--
-- Kalau baris 263 di `0084` tidak pernah jalan, tiga kebijakan sesudahnya juga
-- tidak. Bucket tanpa kebijakan sama tidak bergunanya dengan bucket yang tidak
-- ada: unggahannya ditolak RLS, cuma dengan pesan yang berbeda.
--
-- Isinya SALINAN PERSIS dari `0084` — bukan versi yang "diperbaiki". Kalau
-- kebijakannya memang sudah ada dan sudah benar, hasil akhirnya identik; kalau
-- belum ada, ia jadi seperti seharusnya sejak awal.
--
-- Path-nya `{outlet_id}/{waktu}-{acak}.{ext}`: outlet di depan supaya izinnya
-- bisa diperiksa dari nama berkasnya sendiri. Itu penting karena foto
-- DIUNGGAH DULU, notanya dibuat sesudahnya — saat unggahannya diperiksa,
-- baris notanya memang belum ada.
-- ---------------------------------------------------------
drop policy if exists receipt_photo_insert on storage.objects;
create policy receipt_photo_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'receipt-photos'
    and has_outlet_scope(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );

drop policy if exists receipt_photo_select on storage.objects;
create policy receipt_photo_select on storage.objects
  for select using (
    bucket_id = 'receipt-photos'
    and has_outlet_scope(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );

drop policy if exists receipt_photo_delete on storage.objects;
create policy receipt_photo_delete on storage.objects
  for delete using (
    bucket_id = 'receipt-photos'
    and has_outlet_scope(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );

-- ---------------------------------------------------------
-- (3) Laporkan hasilnya.
--
-- Migration yang "berhasil" tanpa berkata apa-apa adalah persis cara masalah
-- ini bisa bertahan berbulan-bulan. Sesudah menjalankan berkas ini, panel SQL
-- Editor menampilkan daftar bucket yang ada — jadi kalau `receipt-photos`
-- masih tidak muncul, ketahuannya SEKARANG, bukan saat staff menekan tombol
-- unggah di outlet.
-- ---------------------------------------------------------
do $$
declare
  v_ada boolean;
begin
  select exists (select 1 from storage.buckets where id = 'receipt-photos') into v_ada;
  if v_ada then
    raise notice 'OK — bucket receipt-photos siap. Foto nota sudah bisa diunggah.';
  else
    raise exception 'Bucket receipt-photos TETAP tidak ada sesudah 0130. Periksa hak akses ke schema storage.';
  end if;
end $$;

notify pgrst, 'reload schema';
