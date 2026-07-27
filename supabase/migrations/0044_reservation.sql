-- =========================================================
-- Berjaya Hub OMS — 0044
-- Modul Reservasi (Cafe).
--
-- DUA JALUR MASUK:
--   1. Staff App  -> staff mencatat reservasi (telepon/WA/walk-in)
--   2. Website    -> customer mengisi sendiri, lewat Edge Function publik
--
-- Website TIDAK menulis langsung ke tabel ini. Semua reservasi web masuk
-- lewat Edge Function `submit-reservation` yang memakai service_role setelah
-- memvalidasi kapasitas, lead time, dan anti-spam. Karena itu TIDAK ada
-- policy insert untuk role `anon` — jalur tulis publik ke database ditutup.
--
-- Idempotent — aman dijalankan ulang.
-- =========================================================

insert into modules (code, name, description)
values ('reservation', 'Reservasi', 'Reservasi meja dari Staff App & website')
on conflict (code) do nothing;

-- ---------------------------------------------------------
-- (1) Pengaturan per outlet
-- Semua angka di sini DIATUR ADMIN, tidak ada yang di-hardcode di aplikasi.
-- ---------------------------------------------------------
create table if not exists reservation_settings (
  outlet_id uuid primary key references outlets(id) on delete cascade,
  business_unit_id uuid not null references business_units(id) on delete cascade,
  open_time time not null default '10:00',
  close_time time not null default '22:00',
  slot_minutes int not null default 60 check (slot_minutes between 15 and 240),
  max_pax_per_slot int not null default 20 check (max_pax_per_slot > 0),
  min_lead_hours int not null default 2 check (min_lead_hours >= 0),   -- minimal H- berapa jam
  max_days_ahead int not null default 60 check (max_days_ahead > 0),   -- paling jauh boleh pesan
  is_public_enabled boolean not null default false,                    -- tampil di halaman web publik
  staff_input_auto_confirm boolean not null default false,             -- input staff langsung "confirmed"?
  public_note text,                                                    -- catatan yang tampil di halaman publik
  updated_at timestamptz not null default now()
);

alter table reservation_settings enable row level security;
drop policy if exists reservation_settings_select on reservation_settings;
create policy reservation_settings_select on reservation_settings
  for select using (has_bu_scope(auth.uid(), business_unit_id));
drop policy if exists reservation_settings_modify on reservation_settings;
create policy reservation_settings_modify on reservation_settings
  for all using (is_admin_of_outlet(auth.uid(), outlet_id))
  with check (is_admin_of_outlet(auth.uid(), outlet_id));

comment on column reservation_settings.staff_input_auto_confirm is
  'false = reservasi dari Staff App tetap menunggu approval Admin Portal (default).';

-- ---------------------------------------------------------
-- (2) Master area per outlet (indoor/outdoor/VIP/dst) — diisi user
-- ---------------------------------------------------------
create table if not exists reservation_areas (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references outlets(id) on delete cascade,
  business_unit_id uuid not null references business_units(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (outlet_id, name)
);
create index if not exists idx_reservation_areas_outlet on reservation_areas(outlet_id);

alter table reservation_areas enable row level security;
drop policy if exists reservation_areas_select on reservation_areas;
create policy reservation_areas_select on reservation_areas
  for select using (has_bu_scope(auth.uid(), business_unit_id));
drop policy if exists reservation_areas_modify on reservation_areas;
create policy reservation_areas_modify on reservation_areas
  for all using (is_admin_of_outlet(auth.uid(), outlet_id))
  with check (is_admin_of_outlet(auth.uid(), outlet_id));

-- ---------------------------------------------------------
-- (3) Reservasi
-- status: pending -> confirmed -> done | no_show | cancelled | rejected
-- ---------------------------------------------------------
create table if not exists reservations (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  business_unit_id uuid not null references business_units(id) on delete cascade,
  outlet_id uuid not null references outlets(id) on delete cascade,

  customer_name text not null,
  phone text not null,
  email text,

  reserve_date date not null,
  reserve_time time not null,
  pax int not null check (pax > 0),
  area_id uuid references reservation_areas(id) on delete set null,
  notes text,                       -- permintaan khusus
  referral_source text,             -- tahu dari mana

  source text not null default 'staff' check (source in ('staff', 'web')),
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'done', 'no_show', 'cancelled', 'rejected')),

  created_by uuid references user_profiles(id) on delete set null,   -- null = dari website
  reviewed_by uuid references user_profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_reservations_outlet_date on reservations(outlet_id, reserve_date);
create index if not exists idx_reservations_status on reservations(business_unit_id, status);
create index if not exists idx_reservations_phone on reservations(phone);

alter table reservations enable row level security;

-- Staff BU boleh melihat (untuk riwayat di Staff App); admin outlet mengelola.
drop policy if exists reservations_select on reservations;
create policy reservations_select on reservations
  for select using (has_bu_scope(auth.uid(), business_unit_id));

drop policy if exists reservations_insert_staff on reservations;
create policy reservations_insert_staff on reservations
  for insert with check (
    has_outlet_scope(auth.uid(), outlet_id)
    and created_by = auth.uid()
    and source = 'staff'
  );

drop policy if exists reservations_update_admin on reservations;
create policy reservations_update_admin on reservations
  for update using (is_admin_of_outlet(auth.uid(), outlet_id))
  with check (is_admin_of_outlet(auth.uid(), outlet_id));

drop policy if exists reservations_delete_admin on reservations;
create policy reservations_delete_admin on reservations
  for delete using (is_admin_of_outlet(auth.uid(), outlet_id));

-- ---------------------------------------------------------
-- (4) Kode reservasi: RSV-YYMMDD-XXX (urut per hari per outlet)
-- ---------------------------------------------------------
create or replace function set_reservation_code()
returns trigger
language plpgsql
as $$
declare
  v_seq int;
begin
  if new.code is not null then return new; end if;
  select count(*) + 1 into v_seq
  from reservations
  where outlet_id = new.outlet_id and reserve_date = new.reserve_date;
  new.code := 'RSV-' || to_char(new.reserve_date, 'YYMMDD') || '-' || lpad(v_seq::text, 3, '0');
  return new;
end;
$$;

drop trigger if exists trg_reservation_code on reservations;
create trigger trg_reservation_code
  before insert on reservations
  for each row execute function set_reservation_code();

-- ---------------------------------------------------------
-- (5) Sisa kapasitas sebuah slot
-- Hanya menghitung reservasi yang masih "hidup" (pending/confirmed) —
-- yang dibatalkan/ditolak/no-show tidak memakan kuota.
-- SECURITY DEFINER supaya halaman publik (lewat Edge Function) & staff
-- sama-sama bisa memakainya.
-- ---------------------------------------------------------
create or replace function reservation_slot_usage(p_outlet uuid, p_date date, p_time time)
returns int
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(sum(pax), 0)::int
  from reservations
  where outlet_id = p_outlet
    and reserve_date = p_date
    and reserve_time = p_time
    and status in ('pending', 'confirmed');
$$;
grant execute on function reservation_slot_usage(uuid, date, time) to authenticated, anon;

/**
 * Ketersediaan semua slot pada satu tanggal.
 * Dipakai Staff App maupun halaman publik supaya aturannya SATU sumber:
 * jam operasional, panjang slot, kuota, lead time, dan batas hari ke depan
 * semuanya dari reservation_settings.
 */
create or replace function reservation_availability(p_outlet uuid, p_date date)
returns table (slot_time time, used_pax int, max_pax int, is_open boolean)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  s reservation_settings%rowtype;
  t time;
  v_now timestamptz := now();
  v_min timestamptz;
begin
  select * into s from reservation_settings where outlet_id = p_outlet;
  if not found then return; end if;
  if p_date > (v_now at time zone 'Asia/Jakarta')::date + s.max_days_ahead then return; end if;

  v_min := v_now + (s.min_lead_hours || ' hours')::interval;
  t := s.open_time;
  while t < s.close_time loop
    slot_time := t;
    max_pax := s.max_pax_per_slot;
    used_pax := reservation_slot_usage(p_outlet, p_date, t);
    -- Slot tertutup kalau kuota habis ATAU sudah lewat batas lead time.
    is_open := used_pax < s.max_pax_per_slot
      and ((p_date + t) at time zone 'Asia/Jakarta') >= v_min;
    return next;
    t := t + (s.slot_minutes || ' minutes')::interval;
  end loop;
end;
$$;
grant execute on function reservation_availability(uuid, date) to authenticated, anon;

-- ---------------------------------------------------------
-- (6) Buat reservasi dari Staff App — ATOMIK
-- Cek kapasitas dan insert dilakukan di satu transaksi supaya dua staff yang
-- menyimpan bersamaan tidak sama-sama lolos.
-- ---------------------------------------------------------
create or replace function create_reservation(
  p_outlet uuid,
  p_name text,
  p_phone text,
  p_date date,
  p_time time,
  p_pax int,
  p_area uuid default null,
  p_email text default null,
  p_notes text default null,
  p_referral text default null
)
returns reservations
language plpgsql
security definer
set search_path = public
as $$
declare
  s reservation_settings%rowtype;
  v_bu uuid;
  v_used int;
  v_row reservations;
begin
  if not has_outlet_scope(auth.uid(), p_outlet) then
    raise exception 'Tidak berhak membuat reservasi di outlet ini';
  end if;
  if p_pax is null or p_pax <= 0 then raise exception 'Jumlah tamu harus lebih dari 0'; end if;

  select business_unit_id into v_bu from outlets where id = p_outlet;
  select * into s from reservation_settings where outlet_id = p_outlet;
  if not found then raise exception 'Pengaturan reservasi outlet ini belum diisi'; end if;

  -- Kunci baris pengaturan outlet: membuat pemesanan bersamaan di outlet yang
  -- sama antre, sehingga hitungan kuota tidak bisa dilewati bersamaan.
  perform 1 from reservation_settings where outlet_id = p_outlet for update;

  v_used := reservation_slot_usage(p_outlet, p_date, p_time);
  if v_used + p_pax > s.max_pax_per_slot then
    raise exception 'Slot % penuh — tersisa % kursi', to_char(p_time, 'HH24:MI'), greatest(s.max_pax_per_slot - v_used, 0);
  end if;

  insert into reservations (
    business_unit_id, outlet_id, customer_name, phone, email,
    reserve_date, reserve_time, pax, area_id, notes, referral_source,
    source, status, created_by
  ) values (
    v_bu, p_outlet, p_name, p_phone, nullif(p_email, ''),
    p_date, p_time, p_pax, p_area, nullif(p_notes, ''), nullif(p_referral, ''),
    'staff',
    case when s.staff_input_auto_confirm then 'confirmed' else 'pending' end,
    auth.uid()
  )
  returning * into v_row;

  return v_row;
end;
$$;
grant execute on function create_reservation(uuid, text, text, date, time, int, uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------
-- (7) Outlet yang membuka reservasi publik — untuk halaman website.
-- Halaman publik belum login, jadi butuh jalur security definer yang hanya
-- mengembalikan data tidak sensitif.
-- ---------------------------------------------------------
create or replace function public_reservation_outlets()
returns table (
  outlet_id uuid,
  outlet_name text,
  business_unit_name text,
  address text,
  open_time time,
  close_time time,
  slot_minutes int,
  min_lead_hours int,
  max_days_ahead int,
  public_note text
)
language sql
security definer
stable
set search_path = public
as $$
  select o.id, o.name, bu.name, o.address,
         s.open_time, s.close_time, s.slot_minutes, s.min_lead_hours, s.max_days_ahead, s.public_note
  from reservation_settings s
  join outlets o on o.id = s.outlet_id
  join business_units bu on bu.id = s.business_unit_id
  where s.is_public_enabled and o.is_active
  order by bu.name, o.name;
$$;
grant execute on function public_reservation_outlets() to anon, authenticated;

create or replace function public_reservation_areas(p_outlet uuid)
returns table (id uuid, name text)
language sql
security definer
stable
set search_path = public
as $$
  select a.id, a.name
  from reservation_areas a
  join reservation_settings s on s.outlet_id = a.outlet_id and s.is_public_enabled
  where a.outlet_id = p_outlet and a.is_active
  order by a.name;
$$;
grant execute on function public_reservation_areas(uuid) to anon, authenticated;

-- ---------------------------------------------------------
-- (8) Pemicu notifikasi (Telegram + Web Push)
-- Memakai pola yang sama dengan 0043: URL dibaca dari integration_settings,
-- kegagalan kirim TIDAK boleh membatalkan reservasi.
-- ---------------------------------------------------------
create or replace function notify_reservation_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_secret text;
begin
  select value into v_url from integration_settings where key = 'notify_reservation_url';
  if v_url is null or v_url = '' then return new; end if;
  select value into v_secret from integration_settings where key = 'notify_secret';

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', coalesce(v_secret, '')),
    body    := jsonb_build_object(
                 'type', tg_op,
                 'table', tg_table_name,
                 'record', to_jsonb(new),
                 'old_record', case when tg_op = 'UPDATE' then to_jsonb(old) else null end
               )
  );
  return new;
exception
  when others then
    raise warning 'notify_reservation_event gagal: %', sqlerrm;
    return new;
end;
$$;

drop trigger if exists trg_notify_reservations on reservations;
create trigger trg_notify_reservations
  after insert on reservations
  for each row execute function notify_reservation_event();
