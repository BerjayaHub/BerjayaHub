-- =========================================================
-- Berjaya Hub OMS — 0132
-- Barang yang TIDAK dikirim tetap tercatat, dan tiap baris punya keterangan.
--
-- =========================================================
-- YANG DIMINTA
-- =========================================================
--
--   "hilangkan default stock muncul di textbox stock yang akan dikirim, karena
--    setelah berjalan ternyata di lapangan ada miss apabila stock muncul di
--    textbox sesuai dengan jumlah order yang diminta outlet"
--
--   "tambahkan juga kolom keterangan disebelah kolom dikirim … keterangan ini
--    butuh apabila ada pengiriman secara online atau lain lain … apabila sisi
--    ck lupa tidak isi, maka outlet boleh isi saat terima barang masuk dari CK"
--
--   "barang yang diorder tetapi tidak dikirim karena kosong di CK, tetap
--    munculkan berapa order nya tetapi jumlah dikirim nya 0, ini untuk mengecek
--    apakah outlet order barang itu atau CK yang tidak mengirimnya, jadi tidak
--    ada saling menyalahkan"
--
-- =========================================================
-- SATU AKAR MASALAH: BARIS YANG HILANG
-- =========================================================
--
-- Ketiganya kelihatan berbeda, tapi berasal dari keputusan yang sama di 0103:
--
--     if v_pid is null or v_qty is null or v_qty <= 0 then continue; end if;
--
-- Baris ber-qty nol DIBUANG. Akibatnya barang yang diorder tapi tidak dikirim
-- lenyap dari surat jalan — bukan tercatat sebagai nol, melainkan seolah-olah
-- tidak pernah diminta.
--
-- Di lapangan itu berubah jadi pertanyaan yang tidak bisa dijawab siapa pun:
-- outlet yakin sudah memesannya, CK yakin tidak ada di daftar, dan tidak ada
-- satu pun dokumen yang bisa menengahi. Kotak "Dikirim" yang otomatis terisi
-- sebanyak yang diminta memperburuknya: staff yang tidak sempat memeriksa satu
-- baris tetap mengirimkan angka yang terlihat sengaja.
--
-- Sesudah 0132: nol adalah JAWABAN, bukan ketiadaan. "Diminta 10, dikirim 0,
-- keterangan: stok CK habis" adalah tiga fakta yang menutup perdebatan itu.
--
-- =========================================================
-- KENAPA `ordered_qty` DISIMPAN DI BARIS KIRIMAN
-- =========================================================
--
-- Jumlah yang diminta sebenarnya ada di `stock_order_items`, dan bisa dicari
-- lewat `dispatches.stock_order_id`. Tapi:
--
--   - draft yang lahir dari tab "Kirim ke Outlet" tidak punya order sama sekali;
--   - CK boleh MENAMBAH barang yang tidak ada di order;
--   - order masih bisa diubah sesudah draftnya dibuat.
--
-- Menyalinnya sekali ke barisnya membuat surat jalan menjawab sendiri
-- "berapa yang diminta saat itu" — tanpa bergantung pada dokumen lain yang
-- bisa berubah belakangan.
-- =========================================================

-- ---------------------------------------------------------
-- (1) Dua kolom baru.
-- ---------------------------------------------------------
alter table dispatch_items add column if not exists keterangan text;
alter table dispatch_items add column if not exists ordered_qty numeric;

comment on column dispatch_items.keterangan is
  'Catatan per baris: "dikirim via online", "stok CK habis", dan sebagainya. Diisi CK saat menyiapkan, dan boleh dilengkapi outlet saat menerima kalau CK lupa.';
comment on column dispatch_items.ordered_qty is
  'Jumlah yang DIMINTA outlet saat draft dibuat. Disalin ke sini supaya baris ber-qty kirim 0 tetap bisa menjawab "berapa sebenarnya yang dipesan".';

-- `sent_qty` kini boleh NOL. Kalau ada batasan lama yang menuntutnya positif,
-- ia harus dilonggarkan — kalau tidak, seluruh maksud migration ini ditolak
-- database dengan pesan tentang constraint, bukan tentang barang.
do $$
declare
  v_nama text;
begin
  -- Dicari dari NAMA KOLOMNYA saja, bukan dari bentuk tulisannya.
  --
  -- Postgres menyimpan ulang definisi constraint dalam bentuknya sendiri:
  -- `check (sent_qty > 0)` yang ditulis manusia jadi
  -- `CHECK ((sent_qty > (0)::numeric))` di katalog. Mencari teks '> 0' tidak
  -- menemukannya, dan migration-nya lolos tanpa melakukan apa pun — lalu
  -- baris nol pertama ditolak dengan pesan tentang constraint yang seharusnya
  -- sudah tidak ada.
  for v_nama in
    select conname from pg_constraint
     where conrelid = 'dispatch_items'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%sent_qty%'
       and conname <> 'dispatch_items_sent_qty_chk'
  loop
    execute format('alter table dispatch_items drop constraint %I', v_nama);
  end loop;
end $$;

-- Nol boleh, MINUS tidak. Jumlah kirim negatif tidak punya arti apa pun di
-- dunia nyata, dan kalau lolos ia akan menambah stok CK saat diterima.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'dispatch_items_sent_qty_chk') then
    alter table dispatch_items add constraint dispatch_items_sent_qty_chk check (sent_qty >= 0);
  end if;
end $$;

-- ---------------------------------------------------------
-- (2) BUAT DRAFT — baris nol dipertahankan.
--
-- Ditulis ulang seutuhnya dari 0103 dengan TIGA perubahan, dan tidak lebih:
--   `v_qty <= 0`  -> `v_qty < 0`   (nol lolos, minus tetap ditolak)
--   `keterangan` & `ordered_qty` ikut disimpan
--   syarat "draft tidak boleh kosong" jadi soal JUMLAH BARIS, bukan jumlah
--   barang — draft berisi tiga baris nol tetap dokumen yang bercerita.
-- ---------------------------------------------------------
create or replace function buat_draft_kiriman(p_from uuid, p_to uuid, p_items jsonb, p_notes text, p_order uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bu uuid;
  v_uid uuid := auth.uid();
  v_did uuid := gen_random_uuid();
  v_code text;
  it jsonb;
  v_pid uuid;
  v_qty numeric;
  v_jumlah int := 0;
  v_positif int := 0;
begin
  if v_uid is null then raise exception 'Harus login'; end if;

  select business_unit_id into v_bu from outlets where id = p_from;
  if v_bu is null then raise exception 'Outlet asal tidak valid'; end if;
  if not has_outlet_scope(v_uid, p_from) then raise exception 'Tidak berhak mengirim dari outlet ini'; end if;
  if p_to is null or (select 1 from outlets where id = p_to) is null then raise exception 'Outlet tujuan tidak valid'; end if;
  if p_from = p_to then raise exception 'Outlet asal & tujuan tidak boleh sama'; end if;

  v_code := 'SJ-' || to_char((now() at time zone 'Asia/Jakarta'), 'YYMMDD') || '-' || upper(substr(v_did::text, 1, 4));

  insert into dispatches(id, business_unit_id, from_outlet_id, to_outlet_id, status, notes, created_by, code, stock_order_id)
    values (v_did, v_bu, p_from, p_to, 'draft', p_notes, v_uid, v_code, p_order);

  for it in select * from jsonb_array_elements(p_items) loop
    v_pid := (it->>'product_id')::uuid;
    v_qty := (it->>'qty')::numeric;
    -- NOL DIPERTAHANKAN. Inti seluruh migration ini ada di baris ini.
    if v_pid is null or v_qty is null or v_qty < 0 then continue; end if;
    insert into dispatch_items(dispatch_id, product_id, sent_qty, keterangan, ordered_qty)
    values (v_did, v_pid, v_qty,
            nullif(btrim(coalesce(it->>'keterangan', '')), ''),
            nullif(it->>'ordered_qty', '')::numeric);
    v_jumlah := v_jumlah + 1;
    if v_qty > 0 then v_positif := v_positif + 1; end if;
  end loop;

  if v_jumlah = 0 then
    raise exception 'Draft tidak jadi dibuat — tidak ada barang yang diisi.';
  end if;
  -- Draft yang SELURUH barisnya nol tidak memindahkan apa pun. Kalau memang
  -- tidak ada yang bisa dikirim, yang benar adalah MENOLAK ordernya dengan
  -- alasan — bukan menerbitkan surat jalan kosong yang tetap harus diterima
  -- outlet, dicetak, dan diarsipkan.
  if v_positif = 0 then
    raise exception 'Semua barang jumlah kirimnya 0. Kalau memang tidak ada yang bisa dikirim, pakai "Tolak Order" beserta alasannya.';
  end if;

  return v_did;
end;
$$;

-- ---------------------------------------------------------
-- (3) UBAH DRAFT — keterangan & jumlah diminta tidak boleh hilang.
--
-- Draft diganti isinya SELURUHNYA (0103). Tanpa membawa dua kolom baru itu
-- ikut, satu kali menekan "Simpan perubahan" akan menghapus seluruh keterangan
-- yang sudah diketik dan seluruh jejak berapa yang diminta — diam-diam, dan
-- tepat pada dokumen yang gunanya menengahi perselisihan.
-- ---------------------------------------------------------
create or replace function ubah_draft_kiriman(p_dispatch uuid, p_items jsonb, p_notes text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  it jsonb;
  v_pid uuid;
  v_qty numeric;
  v_jumlah int := 0;
  v_positif int := 0;
  v_lama jsonb;
begin
  if not boleh_kelola_draft(p_dispatch) then
    raise exception 'Draft ini tidak bisa kamu ubah — mungkin sudah dikirim, atau di luar outlet yang kamu kelola.';
  end if;

  -- Isi lamanya disalin ke jsonb sebelum dihapus, supaya `ordered_qty` dan
  -- keterangan yang TIDAK dikirim ulang klien tetap bertahan. PWA lama di HP
  -- staff tidak mengenal kedua kolom itu sama sekali, dan tanpa penyelamatan
  -- ini satu kali "Simpan perubahan" dari HP itu menghapus keduanya.
  --
  -- Variabel, bukan temp table: fungsi ini dipanggil lewat koneksi yang
  -- dipakai bergantian banyak permintaan, dan temp table yang menumpang di
  -- sana adalah keadaan yang bocor antar permintaan.
  select coalesce(jsonb_object_agg(product_id::text, jsonb_build_object('k', keterangan, 'o', ordered_qty)), '{}'::jsonb)
    into v_lama
    from dispatch_items where dispatch_id = p_dispatch;

  delete from dispatch_items where dispatch_id = p_dispatch;

  for it in select * from jsonb_array_elements(p_items) loop
    v_pid := (it->>'product_id')::uuid;
    v_qty := (it->>'qty')::numeric;
    if v_pid is null or v_qty is null or v_qty < 0 then continue; end if;
    insert into dispatch_items(dispatch_id, product_id, sent_qty, keterangan, ordered_qty)
    values (p_dispatch, v_pid, v_qty,
            coalesce(
              nullif(btrim(coalesce(it->>'keterangan', '')), ''),
              v_lama -> v_pid::text ->> 'k'
            ),
            coalesce(
              nullif(it->>'ordered_qty', '')::numeric,
              (v_lama -> v_pid::text ->> 'o')::numeric
            ));
    v_jumlah := v_jumlah + 1;
    if v_qty > 0 then v_positif := v_positif + 1; end if;
  end loop;

  if v_jumlah = 0 then
    raise exception 'Draft tidak boleh kosong. Kalau memang batal, hapus draftnya.';
  end if;
  if v_positif = 0 then
    raise exception 'Semua barang jumlah kirimnya 0. Kalau memang tidak ada yang bisa dikirim, hapus draftnya dan tolak ordernya beserta alasan.';
  end if;

  update dispatches set notes = p_notes where id = p_dispatch;
end;
$$;

-- ---------------------------------------------------------
-- (4) TERIMA — outlet boleh melengkapi keterangan yang CK lupa isi.
--
-- Hanya MELENGKAPI, tidak menimpa: keterangan dari CK adalah keterangan
-- pengirim, dan outlet yang menimpanya menghapus keterangan orang lain tanpa
-- ada yang tahu. Kalau keduanya perlu bicara, yang kedua menambah barisnya
-- sendiri di catatan kiriman, bukan menghapus yang pertama.
--
-- `receive_dispatch` versi 0103 diperluas, bukan ditulis ulang: seluruh
-- perhitungan stoknya dipanggil apa adanya lewat fungsi lamanya.
-- ---------------------------------------------------------
create or replace function lengkapi_keterangan_kiriman(p_dispatch uuid, p_items jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_d dispatches%rowtype;
  v_uid uuid := auth.uid();
  it jsonb;
  v_n int := 0;
  v_ket text;
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  if p_items is null then return 0; end if;

  select * into v_d from dispatches where id = p_dispatch;
  if v_d.id is null then raise exception 'Pengiriman tidak ditemukan'; end if;

  -- Kedua sisi boleh: CK saat menyiapkan, outlet tujuan saat menerima.
  if not (has_outlet_scope(v_uid, v_d.from_outlet_id) or has_outlet_scope(v_uid, v_d.to_outlet_id)) then
    raise exception 'Kiriman ini bukan wewenangmu.';
  end if;

  for it in select * from jsonb_array_elements(p_items) loop
    v_ket := nullif(btrim(coalesce(it->>'keterangan', '')), '');
    if v_ket is null then continue; end if;
    update dispatch_items
       set keterangan = v_ket
     where id = (it->>'item_id')::uuid
       and dispatch_id = p_dispatch
       -- HANYA yang masih kosong. Lihat catatan di atas.
       and keterangan is null;
    if found then v_n := v_n + 1; end if;
  end loop;

  return v_n;
end;
$$;

revoke all on function lengkapi_keterangan_kiriman(uuid, jsonb) from public;
grant execute on function lengkapi_keterangan_kiriman(uuid, jsonb) to authenticated;

comment on function lengkapi_keterangan_kiriman(uuid, jsonb) is
  'Mengisi keterangan baris kiriman yang MASIH KOSONG. Tidak pernah menimpa yang sudah ada — keterangan pengirim bukan milik penerima.';

notify pgrst, 'reload schema';
