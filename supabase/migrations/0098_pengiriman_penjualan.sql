-- =========================================================
-- Berjaya Hub OMS — 0098
-- PENJUALAN GANDA: penanda kiriman dari klien.
--
-- =========================================================
-- KENAPA BUKAN `unique (outlet_id, product_id, sale_date)`
-- =========================================================
--
-- Itu jawaban yang paling wajar untuk "cegah penjualan dobel", dan itu SALAH di
-- aplikasi ini.
--
-- Layar penjualan Staff App bersifat MENAMBAH, bukan merekap sekali sehari
-- (`sales.page.js`: sesudah tersimpan, kotak isian dikosongkan dan rekap
-- menampilkan akumulasi hari itu). Jadi mengirim dua kali dalam satu hari adalah
-- ALUR YANG SAH — shift pagi lalu shift malam.
--
-- Kunci unik atas (outlet, produk, tanggal) akan menolak shift kedua, atau
-- (kalau dibuat upsert) menimpa angka shift pertama. Dua-duanya merusak
-- pencatatan yang benar demi mencegah pencatatan yang salah.
--
-- =========================================================
-- YANG DIPAKAI: PENANDA PERCOBAAN KIRIM, DIBUAT KLIEN
-- =========================================================
--
-- Yang perlu dibedakan bukan "dua penjualan di hari yang sama" melainkan "satu
-- tindakan yang terkirim dua kali". Yang tahu bedanya hanya klien — server
-- melihat dua permintaan yang identik dan tidak punya cara membedakan retry
-- dari shift kedua.
--
-- Maka `id` tabel ini SENGAJA TANPA `default gen_random_uuid()`: nilainya wajib
-- datang dari klien. Kalau server yang membuatnya, percobaan kedua mendapat
-- kunci baru dan lolos — tepat kegagalan yang mau dicegah.
-- =========================================================

create table if not exists sales_submissions (
  -- TANPA default. Dibuat klien, sama pada setiap percobaan ulang.
  id               uuid primary key,

  business_unit_id uuid not null references business_units(id) on delete cascade,
  outlet_id        uuid not null references outlets(id) on delete cascade,
  sale_date        date not null,

  item_count       int not null default 0,
  total_revenue    numeric not null default 0,

  created_by       uuid references user_profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);

create index if not exists idx_sales_subm_outlet on sales_submissions(outlet_id, sale_date);

comment on table sales_submissions is
  'Satu baris = satu kali tekan Simpan di Staff App. `id` dibuat KLIEN dan diulang pada retry, sehingga record_sales() bisa mengenali kiriman yang sama. Lihat header 0098.';

alter table sales_submissions enable row level security;

-- Baca: anggota BU. Dipakai layar untuk menampilkan riwayat kiriman.
drop policy if exists sales_subm_select on sales_submissions;
create policy sales_subm_select on sales_submissions
  for select to authenticated
  using (has_bu_scope(auth.uid(), business_unit_id));

-- Tidak ada policy INSERT/UPDATE/DELETE untuk siapa pun.
--
-- Barisnya HANYA dibuat `record_sales()` (SECURITY DEFINER). Kalau klien bisa
-- menyisipkannya sendiri, ia bisa mendaftarkan penanda lebih dulu lalu membuat
-- penjualan sungguhannya ditolak sebagai "duplikat" — penolakan yang tidak akan
-- ada yang bisa menjelaskan.

-- ---------------------------------------------------------
-- Setiap baris penjualan tahu ia datang dari kiriman yang mana.
--
-- Nullable, karena baris LAMA memang tidak punya — dan mengisinya surut berarti
-- mengarang kiriman yang tidak pernah ada.
--
-- `on delete restrict`: kiriman tidak bisa dihapus selama masih ada penjualan
-- yang menunjuk kepadanya. Menghapusnya akan membuat penjualan itu kehilangan
-- asal-usulnya tanpa satu pun tanda.
-- ---------------------------------------------------------
alter table sales add column if not exists submission_id uuid references sales_submissions(id) on delete restrict;
create index if not exists idx_sales_submission on sales(submission_id);

comment on column sales.submission_id is
  'Kiriman asal baris ini. NULL untuk penjualan sebelum 0098 — sengaja tidak diisi surut.';

notify pgrst, 'reload schema';
