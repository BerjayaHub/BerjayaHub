-- =========================================================
-- Berjaya Hub OMS — 0055
-- Mode reservasi HOTEL, di samping mode CAFE yang sudah ada.
--
-- BEDANYA MENDASAR, bukan sekadar tambahan kolom:
--   Cafe  : satu tanggal + satu jam, kuota dihitung dari jumlah PAX per slot.
--   Hotel : RENTANG tanggal, dan kamar tidak bisa dibagi. Pertanyaannya bukan
--           "berapa orang di slot ini" melainkan "berapa booking yang tanggalnya
--           BERTABRAKAN dengan rentang ini".
--
-- Yang dipakai ulang: identitas & kontak customer, alur status, notifikasi
-- Telegram/push, konfirmasi WhatsApp. Yang berbeda hanya APA yang dipesan —
-- karena itu satu tabel `reservations` dengan kolom per mode, bukan tabel baru.
--
-- Mode disimpan di OUTLET, bukan BU: satu BU boleh punya hotel dan cafe
-- sekaligus sebagai dua outlet. Untuk BU yang seluruhnya hotel, admin tinggal
-- mengatur semua outletnya ke 'hotel' di satu layar.
--
-- Idempotent — aman dijalankan ulang.
-- =========================================================

-- ---------------------------------------------------------
-- (1) Mode reservasi per outlet
-- ---------------------------------------------------------
alter table outlets add column if not exists reservation_mode text not null default 'cafe';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'outlets_reservation_mode_valid') then
    alter table outlets add constraint outlets_reservation_mode_valid
      check (reservation_mode in ('cafe', 'hotel'));
  end if;
end $$;

comment on column outlets.reservation_mode is
  'cafe = reservasi meja (slot jam + pax). hotel = booking kamar (rentang tanggal + tipe kamar).';

-- `list_attendance_outlets()` adalah direktori outlet yang dipakai SELURUH
-- aplikasi (lewat core/my-outlets.js). Mode harus ikut dibawa dari sini —
-- kalau tidak, tiap halaman terpaksa query outlet lagi hanya untuk tahu mode-nya,
-- dan cepat atau lambat ada yang lupa lalu menampilkan form yang salah.
-- Fungsi didefinisikan ULANG UTUH (bukan ditambal), supaya definisinya tetap
-- satu tempat yang bisa dibaca sekali jalan.
drop function if exists list_attendance_outlets();
create function list_attendance_outlets()
returns table (
  id uuid,
  name text,
  business_unit_id uuid,
  business_unit_name text,
  latitude double precision,
  longitude double precision,
  geofence_radius_m integer,
  outlet_role text,
  allow_sales boolean,
  served_by_outlet_id uuid,
  shift_enabled boolean,
  reservation_mode text
)
language sql
security definer
stable
set search_path = public
as $$
  select o.id, o.name, o.business_unit_id, bu.name, o.latitude, o.longitude, o.geofence_radius_m,
         o.outlet_role, o.allow_sales, o.served_by_outlet_id, o.shift_enabled, o.reservation_mode
  from outlets o
  join business_units bu on bu.id = o.business_unit_id
  where o.is_active
  order by bu.name, o.name;
$$;
grant execute on function list_attendance_outlets() to authenticated;

-- ---------------------------------------------------------
-- (2) Tipe kamar + JUMLAH UNIT
--
-- `qty` adalah kuota: Deluxe = 2 berarti maksimal 2 booking Deluxe yang
-- tanggalnya bertabrakan. Nomor kamar TIDAK didaftarkan di sini — sesuai
-- keputusan, nomor diketik bebas saat check-in. Konsekuensinya sistem menjaga
-- jumlahnya tapi tidak bisa mencegah dua tamu diberi nomor kamar yang sama;
-- kalau nanti perlu, tinggal tambah tabel kamar dan qty jadi hasil hitungan.
-- ---------------------------------------------------------
create table if not exists room_types (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references outlets(id) on delete cascade,
  name text not null,
  qty int not null default 1 check (qty > 0),
  capacity int,                       -- maks tamu per kamar (opsional, sekadar info)
  notes text,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (outlet_id, name)
);
create index if not exists idx_room_types_outlet on room_types(outlet_id) where is_active;

alter table room_types enable row level security;

drop policy if exists room_types_select on room_types;
create policy room_types_select on room_types
  for select to authenticated
  using (has_outlet_scope(auth.uid(), outlet_id));

drop policy if exists room_types_modify on room_types;
create policy room_types_modify on room_types
  for all to authenticated
  using (is_admin_of_outlet(auth.uid(), outlet_id))
  with check (is_admin_of_outlet(auth.uid(), outlet_id));

-- ---------------------------------------------------------
-- (3) Kolom hotel di `reservations`
--
-- Kolom cafe dilonggarkan jadi nullable, lalu keduanya dijaga CHECK per mode —
-- supaya baris cafe tetap wajib punya jam & pax, dan baris hotel wajib punya
-- tipe kamar & rentang tanggal. Tanpa CHECK ini, kolom nullable berubah jadi
-- undangan untuk menyimpan baris setengah jadi yang baru ketahuan salah saat
-- ditampilkan.
-- ---------------------------------------------------------
alter table reservations alter column reserve_time drop not null;
alter table reservations alter column pax drop not null;

alter table reservations add column if not exists mode text not null default 'cafe';
alter table reservations add column if not exists room_type_id uuid references room_types(id) on delete restrict;
alter table reservations add column if not exists check_in date;
alter table reservations add column if not exists check_out date;
alter table reservations add column if not exists adults int;
alter table reservations add column if not exists children int;
alter table reservations add column if not exists room_no text;
alter table reservations add column if not exists checked_in_at timestamptz;
alter table reservations add column if not exists checked_out_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reservations_mode_valid') then
    alter table reservations add constraint reservations_mode_valid check (mode in ('cafe', 'hotel'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'reservations_isi_sesuai_mode') then
    alter table reservations add constraint reservations_isi_sesuai_mode check (
      case mode
        when 'cafe' then reserve_time is not null and pax is not null and pax > 0
        when 'hotel' then room_type_id is not null and check_in is not null and check_out is not null
        else false
      end
    );
  end if;

  -- Menginap minimal satu malam. Tanpa ini, check_in = check_out lolos dan
  -- rentangnya jadi kosong -> tidak pernah bertabrakan dengan apa pun,
  -- sehingga kuota kamar bisa ditembus tanpa batas.
  if not exists (select 1 from pg_constraint where conname = 'reservations_menginap_minimal_semalam') then
    alter table reservations add constraint reservations_menginap_minimal_semalam
      check (mode <> 'hotel' or check_out > check_in);
  end if;
end $$;

-- Status tambahan untuk hotel: sudah masuk / sudah keluar.
alter table reservations drop constraint if exists reservations_status_check;
alter table reservations add constraint reservations_status_check
  check (status in ('pending', 'confirmed', 'checked_in', 'checked_out', 'done', 'no_show', 'cancelled', 'rejected'));

create index if not exists idx_reservations_hotel_range
  on reservations(outlet_id, check_in, check_out) where mode = 'hotel';

-- ---------------------------------------------------------
-- (4) reserve_date sebagai TANGGAL ACUAN
--
-- Untuk hotel, `reserve_date` diisi otomatis = check_in. Dengan begitu penomoran
-- kode, index tanggal, rekap harian, dan digest Telegram yang sudah ada TIDAK
-- perlu diubah sama sekali — semuanya sudah bekerja atas dasar reserve_date.
-- ---------------------------------------------------------
create or replace function set_reservation_anchor_date()
returns trigger
language plpgsql
as $$
begin
  if new.mode = 'hotel' then
    new.reserve_date := new.check_in;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reservation_anchor_date on reservations;
create trigger trg_reservation_anchor_date
  before insert or update on reservations
  for each row execute function set_reservation_anchor_date();

-- ---------------------------------------------------------
-- (5) KUOTA KAMAR — dijaga DATABASE, bukan aplikasi
--
-- KENAPA BUKAN `EXCLUDE USING gist`: constraint itu melarang tabrakan SAMA
-- SEKALI. Yang dibutuhkan di sini "maksimal N yang bertabrakan", karena satu
-- tipe punya beberapa unit (Deluxe = 2). Jadi dipakai trigger + advisory lock.
--
-- `pg_advisory_xact_lock` per tipe kamar membuat pemeriksaan ini bersifat
-- antre: dua admin yang menekan Simpan pada detik yang sama tidak bisa
-- sama-sama lolos pemeriksaan lalu sama-sama menulis. Tanpa lock itu, keduanya
-- akan membaca "masih ada 1 sisa" dan menghasilkan booking ke-3.
--
-- Double-booking adalah kesalahan yang ketahuannya di depan meja resepsionis,
-- saat tamu sudah datang membawa koper. Karena itu aturannya ditaruh di
-- database — supaya tetap berlaku walau nanti ada bug di kode aplikasi, atau
-- ada yang menulis lewat SQL Editor.
--
-- RENTANG `[)`: tanggal check-out TIDAK dihitung bertabrakan. Tamu A keluar
-- tanggal 5 dan tamu B masuk tanggal 5 memakai kamar yang sama itu normal.
-- ---------------------------------------------------------
create or replace function cek_kuota_kamar()
returns trigger
language plpgsql
as $$
declare
  v_qty int;
  v_terpakai int;
  v_nama text;
begin
  if new.mode <> 'hotel' then return new; end if;

  -- Booking yang sudah selesai / batal tidak memakan kuota.
  if new.status in ('cancelled', 'rejected', 'no_show', 'checked_out', 'done') then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.room_type_id::text, 0));

  select qty, name into v_qty, v_nama from room_types where id = new.room_type_id;
  if v_qty is null then
    raise exception 'Tipe kamar tidak ditemukan.';
  end if;

  select count(*) into v_terpakai
  from reservations r
  where r.room_type_id = new.room_type_id
    and r.id <> new.id
    and r.mode = 'hotel'
    and r.status not in ('cancelled', 'rejected', 'no_show', 'checked_out', 'done')
    and daterange(r.check_in, r.check_out, '[)') && daterange(new.check_in, new.check_out, '[)');

  if v_terpakai >= v_qty then
    raise exception 'Kamar % sudah penuh untuk tanggal tersebut (kuota % unit, terpakai %).',
      coalesce(v_nama, 'ini'), v_qty, v_terpakai
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_cek_kuota_kamar on reservations;
create trigger trg_cek_kuota_kamar
  before insert or update on reservations
  for each row execute function cek_kuota_kamar();

-- ---------------------------------------------------------
-- (6) Ketersediaan tipe kamar untuk sebuah rentang tanggal
-- Dipakai UI untuk menampilkan sisa unit SEBELUM admin menekan Simpan —
-- supaya penolakan dari trigger jadi jaring pengaman, bukan cara utama
-- memberi tahu bahwa kamarnya penuh.
-- ---------------------------------------------------------
create or replace function room_availability(p_outlet uuid, p_check_in date, p_check_out date)
returns table (room_type_id uuid, name text, qty int, terpakai int, sisa int)
language sql
security definer
stable
set search_path = public
as $$
  select
    rt.id,
    rt.name,
    rt.qty,
    coalesce(t.jml, 0)::int as terpakai,
    (rt.qty - coalesce(t.jml, 0))::int as sisa
  from room_types rt
  left join lateral (
    select count(*) as jml
    from reservations r
    where r.room_type_id = rt.id
      and r.mode = 'hotel'
      and r.status not in ('cancelled', 'rejected', 'no_show', 'checked_out', 'done')
      and daterange(r.check_in, r.check_out, '[)') && daterange(p_check_in, p_check_out, '[)')
  ) t on true
  where rt.outlet_id = p_outlet
    and rt.is_active
    and has_outlet_scope(auth.uid(), rt.outlet_id)
  order by rt.sort_order, rt.name;
$$;

revoke all on function room_availability(uuid, date, date) from public;
grant execute on function room_availability(uuid, date, date) to authenticated;

-- ---------------------------------------------------------
-- (7) Booking hotel TIDAK menerima jalur website.
-- Halaman publik `reservasi.html` hanya untuk mode cafe. Edge Function
-- `submit-reservation` menolak outlet ber-mode hotel (lihat kodenya).
-- Di sini dijaga juga di database supaya tidak bergantung pada satu lapis saja.
-- ---------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reservations_hotel_bukan_dari_web') then
    alter table reservations add constraint reservations_hotel_bukan_dari_web
      check (mode <> 'hotel' or source = 'staff');
  end if;
end $$;
