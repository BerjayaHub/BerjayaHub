-- =========================================================
-- Berjaya Hub OMS — 0111
-- Order ke CK punya tahap DRAFT. Menyusunnya bersama-sama dulu, baru dikirim.
--
-- =========================================================
-- YANG DIMINTA
-- =========================================================
--
--   "saya ingin ada draft saja di order ini, jadi sebelum kirim order jadi
--    draft dulu, edit nya ada di draft ini"
--
-- Alur barunya:
--
--   Elsa (bar)     buka Order ke CK -> isi sirup -> Simpan Draft
--   Maskal (kitchen) buka DRAFT YANG SAMA -> tambah daging -> Simpan Draft
--   siapa pun      tekan "Kirim ke CK"   -> status open, CK baru melihatnya
--
-- `0110` sudah membuat order milik OUTLET, jadi Maskal boleh menyunting punya
-- Elsa. Yang belum ada adalah TEMPAT untuk menyusunnya sebelum berangkat:
-- selama ini order langsung berstatus 'open', dan CK sudah melihat serta bisa
-- memprosesnya sementara divisi lain masih hendak menambah.
--
-- =========================================================
-- SATU DRAFT PER PASANGAN OUTLET-TUJUAN
-- =========================================================
--
-- Dijamin unique index parsial, bukan diserahkan pada disiplin orangnya:
--
--   create unique index stock_orders_satu_draft
--     on stock_orders(from_outlet_id, to_outlet_id) where status = 'draft';
--
-- Inilah yang membuat "satu outlet cukup satu order per pengiriman" berlaku
-- dengan sendirinya. Tanpa index ini, dua orang yang menekan "Buat Order"
-- pada detik yang sama menghasilkan dua draft — dan kita kembali ke masalah
-- yang baru saja dibereskan: CK menyiapkan dua keranjang untuk satu tujuan.
--
-- `buat_atau_ambil_draft_order()` MENGEMBALIKAN draft yang sudah ada alih-alih
-- meledak. Pola yang sama dengan `buka_opname()` di 0085: menekan tombolnya
-- dua kali bukan kesalahan, ia cuma berarti "bawa saya ke draft itu".
--
-- =========================================================
-- NOTIFIKASI TELEGRAM — BAHAYA YANG SUDAH PERNAH TERJADI
-- =========================================================
--
-- `trg_notify_stock_orders` (0043) menyala pada `after insert`. Draft dibuat
-- lewat INSERT, jadi tanpa perubahan di sini CK akan menerima pesan "Order
-- baru dari Serpong" untuk daftar yang masih kosong dan belum dikirim.
--
-- Ini persis kegagalan yang muncul saat draft surat jalan ditambahkan di 0103,
-- dan ditemukan hanya karena ada yang memeriksa triggernya. Diperbaiki dengan
-- pola yang sama:
--
--   INSERT  -> hanya kalau status <> 'draft'
--   UPDATE of status -> menangkap saat draft BERANGKAT jadi 'open'
--
-- Perbaikan yang sama juga dipasang di Edge Function `notify-telegram` sebagai
-- lapis kedua. Arah kegagalannya dipilih dengan sengaja: Edge Function yang
-- basi akan KEHILANGAN notifikasi, bukan mengirim notifikasi yang salah.
--
-- =========================================================
-- SESUDAH DIKIRIM, TERKUNCI
-- =========================================================
--
-- `update_stock_order` sekarang hanya menerima status 'draft'. Begitu order
-- dikirim, CK sudah melihatnya dan mungkin sudah mulai menyiapkan barangnya;
-- isi yang berubah diam-diam membuat yang disiapkan tidak cocok dengan
-- dokumennya, dan tidak ada satu pun tanda di kedua sisi.
--
-- Kalau ternyata salah: batalkan, lalu buat draft baru.
--
-- =========================================================
-- DATA LAMA
-- =========================================================
--
-- TIDAK disentuh. Order yang sekarang berstatus 'open' tetap 'open' dan tetap
-- diproses CK seperti biasa — hanya saja tidak bisa diedit lagi. Tidak ada
-- yang perlu dipindahkan, tidak ada yang perlu ditebak.
-- =========================================================

-- ---------------------------------------------------------
-- (1) Status baru
-- ---------------------------------------------------------
alter table stock_orders drop constraint if exists stock_orders_status_check;
alter table stock_orders add constraint stock_orders_status_check
  check (status in ('draft', 'open', 'fulfilled', 'rejected', 'cancelled'));

-- Kapan draft dikirim, dan oleh siapa. Pertanyaan "kok CK belum menyiapkan?"
-- paling sering berujung pada "ternyata belum ada yang menekan Kirim".
alter table stock_orders add column if not exists sent_at timestamptz;
alter table stock_orders add column if not exists sent_by uuid references user_profiles(id) on delete set null;

-- SATU draft per pasangan (outlet asal, outlet tujuan).
--
-- Parsial `where status = 'draft'` — order yang sudah dikirim/selesai tidak
-- ikut terkunci, jadi outlet boleh punya banyak order 'open' sekaligus.
create unique index if not exists stock_orders_satu_draft
  on stock_orders(from_outlet_id, to_outlet_id) where status = 'draft';

-- ---------------------------------------------------------
-- (2) AMBIL ATAU BUAT DRAFT
--
-- Mengembalikan draft yang sudah ada alih-alih meledak. Menekan "Buat Order"
-- dua kali bukan kesalahan — artinya "bawa saya ke draft itu".
-- ---------------------------------------------------------
create or replace function buat_atau_ambil_draft_order(p_from uuid, p_to uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bu uuid;
  v_uid uuid := auth.uid();
  v_id uuid;
  v_new uuid := gen_random_uuid();
begin
  if v_uid is null then raise exception 'Harus login'; end if;

  select business_unit_id into v_bu from outlets where id = p_from;
  if v_bu is null then raise exception 'Outlet pemesan tidak valid'; end if;

  -- `has_outlet_scope`, BUKAN `has_bu_scope` seperti `create_stock_order`
  -- yang lama. Draft ini akan bisa disunting siapa pun di outlet asalnya, jadi
  -- yang membuatnya pun harus benar-benar orang outlet itu.
  if not has_outlet_scope(v_uid, p_from) then
    raise exception 'Kamu tidak terdaftar di outlet pemesan ini.';
  end if;

  if p_to is null or not exists (select 1 from outlets where id = p_to) then
    raise exception 'Central Kitchen tujuan tidak valid';
  end if;
  if p_from = p_to then raise exception 'Outlet pemesan & tujuan tidak boleh sama'; end if;

  select id into v_id from stock_orders
   where from_outlet_id = p_from and to_outlet_id = p_to and status = 'draft';
  if v_id is not null then return v_id; end if;

  insert into stock_orders(id, code, business_unit_id, from_outlet_id, to_outlet_id, status, created_by)
    values (v_new,
            'OR-' || to_char((now() at time zone 'Asia/Jakarta'), 'YYMMDD') || '-' || upper(substr(v_new::text, 1, 4)),
            v_bu, p_from, p_to, 'draft', v_uid);
  return v_new;
end;
$$;

-- ---------------------------------------------------------
-- (3) MENGUBAH ISI — hanya selama masih DRAFT
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

  -- HANYA DRAFT. Pesannya membedakan dua keadaan yang berbeda sebabnya:
  -- sudah dikirim (perlu dibatalkan dulu) vs sudah diproses CK (tidak bisa
  -- apa-apa lagi). Pesan yang menggabungkan keduanya membuat orang mencoba
  -- membatalkan sesuatu yang sudah selesai.
  if v_o.status = 'open' then
    raise exception 'Order ini sudah dikirim ke CK. Isinya tidak bisa diubah lagi — batalkan dulu, lalu susun draft baru.';
  end if;
  if v_o.status <> 'draft' then
    raise exception 'Order sudah diproses, tidak bisa diubah';
  end if;

  -- Order milik OUTLET asalnya (0110), bukan milik pembuatnya.
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

  -- DRAFT BOLEH KOSONG, dan ini berubah dari sebelumnya.
  --
  -- Elsa membuka draft, menghapus satu barang yang batal, lalu menyimpan —
  -- kalau draftnya jadi kosong dan ditolak, ia terpaksa meninggalkan barang
  -- yang sudah tidak dibutuhkan di sana. Draft memang tempat yang belum jadi.
  --
  -- Yang TIDAK boleh kosong adalah order yang DIKIRIM, dan itu dijaga di
  -- `kirim_draft_order()`.
  update stock_orders
    set notes = coalesce(p_notes, notes), edited_by = v_uid, edited_at = now()
    where id = p_order;
end;
$$;

-- ---------------------------------------------------------
-- (4) KIRIM DRAFT KE CK
-- ---------------------------------------------------------
create or replace function kirim_draft_order(p_order uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_o stock_orders%rowtype;
  v_uid uuid := auth.uid();
  v_n int;
begin
  if v_uid is null then raise exception 'Harus login'; end if;

  select * into v_o from stock_orders where id = p_order;
  if v_o.id is null then raise exception 'Order tidak ditemukan'; end if;
  if v_o.status <> 'draft' then raise exception 'Order ini sudah dikirim sebelumnya.'; end if;
  if not has_outlet_scope(v_uid, v_o.from_outlet_id) then
    raise exception 'Hanya staff outlet asal yang bisa mengirim order ini.';
  end if;

  select count(*) into v_n from stock_order_items where order_id = p_order;
  if v_n = 0 then
    raise exception 'Draft masih kosong. Tambahkan minimal satu barang sebelum mengirim.';
  end if;

  -- `and status = 'draft'` DIULANG di klausa where, bukan hanya diperiksa di
  -- atas. Dua orang yang menekan Kirim pada detik yang sama akan sama-sama
  -- lolos pemeriksaan pertama; yang kedualah yang di sini tidak mengubah baris
  -- apa pun, dan `not found` menangkapnya. Tanpa ini, ordernya terkirim sekali
  -- tapi triggernya bisa menyala dua kali.
  update stock_orders
     set status = 'open', sent_at = now(), sent_by = v_uid
   where id = p_order and status = 'draft';
  if not found then raise exception 'Order ini baru saja dikirim orang lain.'; end if;
end;
$$;

-- ---------------------------------------------------------
-- (5) MEMBATALKAN — draft maupun order yang sudah dikirim
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
  if v_o.status not in ('draft', 'open') then raise exception 'Order sudah diproses'; end if;

  if not has_outlet_scope(v_uid, v_o.from_outlet_id)
     and not is_bu_admin(v_uid, v_o.business_unit_id) then
    raise exception 'Hanya staff outlet asal atau admin BU yang bisa membatalkan order ini.';
  end if;

  update stock_orders set status = 'cancelled', handled_by = v_uid, handled_at = now() where id = p_order;
end;
$$;

-- ---------------------------------------------------------
-- (6) TRIGGER TELEGRAM — draft tidak mengumumkan apa pun
--
-- Nama trigger LAMA ikut di-drop. Migration yang hanya membuat nama baru akan
-- gagal dengan 42710 saat dijalankan ulang, dan yang lebih buruk: trigger
-- lamanya tetap hidup berdampingan sehingga draft tetap diumumkan.
-- Kegagalan ini sudah pernah terjadi di 0103.
-- ---------------------------------------------------------
drop trigger if exists trg_notify_stock_orders on stock_orders;
drop trigger if exists trg_notify_stock_orders_insert on stock_orders;
drop trigger if exists trg_notify_stock_orders_update on stock_orders;

create trigger trg_notify_stock_orders_insert
  after insert on stock_orders
  for each row when (new.status <> 'draft')
  execute function notify_telegram_event();

create trigger trg_notify_stock_orders_update
  after update of status on stock_orders
  for each row when (old.status = 'draft' and new.status = 'open')
  execute function notify_telegram_event();

-- ---------------------------------------------------------
-- (7) JALUR LAMA DITUTUP
--
-- `create_stock_order` membuat order yang LANGSUNG berstatus 'open' —
-- melompati seluruh tahap draft. Selama grant-nya masih ada, siapa pun yang
-- memanggil RPC itu langsung (PWA lama yang masih ter-cache di HP staff,
-- misalnya) tetap bisa mengirim order tanpa draft.
--
-- Fungsinya TIDAK dihapus, hanya dicabut wewenangnya. Menghapusnya akan
-- membuat PWA lama gagal dengan "function does not exist" — pesan yang tidak
-- mengatakan apa-apa kepada staff. Dengan dicabut, yang muncul adalah
-- penolakan izin, dan orangnya akan memuat ulang aplikasi.
revoke execute on function create_stock_order(uuid, uuid, jsonb, text) from authenticated;

comment on function create_stock_order(uuid, uuid, jsonb, text) is
  'USANG sejak 0111 — membuat order langsung open tanpa tahap draft. Grant-nya dicabut. Pakai buat_atau_ambil_draft_order() lalu kirim_draft_order().';

revoke all on function buat_atau_ambil_draft_order(uuid, uuid) from public;
revoke all on function kirim_draft_order(uuid) from public;
grant execute on function buat_atau_ambil_draft_order(uuid, uuid) to authenticated;
grant execute on function kirim_draft_order(uuid) to authenticated;

comment on function buat_atau_ambil_draft_order(uuid, uuid) is
  'Ambil draft order yang sedang terbuka untuk pasangan outlet-tujuan ini, atau buat kalau belum ada. Satu draft per pasangan, dijamin unique index parsial.';
comment on function kirim_draft_order(uuid) is
  'Kirim draft ke CK: status draft -> open. Draft kosong ditolak. Baru pada tahap ini CK melihatnya dan notifikasi Telegram menyala.';

notify pgrst, 'reload schema';
