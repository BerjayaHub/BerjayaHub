-- 0054_checklist_outlet_scope.sql
--
-- BUG: admin outlet tidak bisa mengisi Item/Sesi Daily Activities.
--
-- PENYEBAB: `checklist_items_modify` & `checklist_sessions_modify` memakai
-- `is_bu_admin()`, yang hanya mencakup super_admin dan bu_admin. Pola yang sama
-- persis dengan bug `membership_scopes` di 0053.
--
-- TAPI mengganti begitu saja ke `is_admin_of_outlet()` SALAH: item dan sesi
-- bersifat BU-wide — satu daftar dipakai seluruh outlet BU. Admin outlet
-- Serpong akan bisa menghapus item yang dipakai Gading, dan admin Gading tidak
-- akan pernah tahu kenapa ceklisnya tiba-tiba berubah.
--
-- PERBAIKAN: beri item & sesi cakupan opsional.
--   outlet_id NULL   = milik BU, berlaku semua outlet   -> dikelola admin BU
--   outlet_id terisi = khusus outlet itu                -> dikelola admin outletnya
--
-- Pola pewarisan yang sama dengan kebijakan hari libur (outlet mewarisi BU) dan
-- video tutorial. Bedanya di sini item BU dan item outlet DIGABUNG, bukan
-- saling menimpa: ceklis outlet = standar BU + tambahan khusus outlet itu.
-- Menimpa akan berarti outlet yang menambah satu item kehilangan seluruh
-- standar BU-nya — hampir pasti bukan yang dimaksud siapa pun.

alter table checklist_items add column outlet_id uuid references outlets(id) on delete cascade;
alter table checklist_sessions add column outlet_id uuid references outlets(id) on delete cascade;

create index idx_checklist_items_outlet on checklist_items(outlet_id) where outlet_id is not null;
create index idx_checklist_sessions_outlet on checklist_sessions(outlet_id) where outlet_id is not null;

comment on column checklist_items.outlet_id is
  'NULL = item milik BU (berlaku semua outlet). Terisi = khusus outlet itu. Digabung, bukan menimpa.';
comment on column checklist_sessions.outlet_id is
  'NULL = sesi milik BU (berlaku semua outlet). Terisi = khusus outlet itu. Digabung, bukan menimpa.';

-- ---------------------------------------------------------
-- Konsistensi: outlet_id harus benar-benar milik BU yang sama.
-- Tanpa ini, admin BU A bisa membuat item yang menempel di outlet BU B lewat
-- panggilan API langsung — dan itu tidak akan terlihat di UI mana pun.
-- ---------------------------------------------------------
create or replace function checklist_outlet_cocok_bu()
returns trigger
language plpgsql
as $$
begin
  if new.outlet_id is not null then
    if not exists (
      select 1 from outlets o
      where o.id = new.outlet_id and o.business_unit_id = new.business_unit_id
    ) then
      raise exception 'Outlet tidak berada di business unit yang sama.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_checklist_items_outlet_bu on checklist_items;
create trigger trg_checklist_items_outlet_bu
  before insert or update on checklist_items
  for each row execute function checklist_outlet_cocok_bu();

drop trigger if exists trg_checklist_sessions_outlet_bu on checklist_sessions;
create trigger trg_checklist_sessions_outlet_bu
  before insert or update on checklist_sessions
  for each row execute function checklist_outlet_cocok_bu();

-- ---------------------------------------------------------
-- RLS
--
-- Baca tetap sama: seluruh anggota BU. Yang berubah hanya hak KELOLA.
--
-- Ditulis dengan `using` dan `with check` yang sama-sama ketat supaya admin
-- outlet tidak bisa MEMINDAHKAN item BU menjadi miliknya (update outlet_id dari
-- NULL ke outletnya) — `using` menjaga baris asalnya, `with check` menjaga
-- baris hasilnya.
-- ---------------------------------------------------------

drop policy if exists checklist_items_modify on checklist_items;
create policy checklist_items_modify on checklist_items
  for all to authenticated
  using (
    case
      when outlet_id is null then is_bu_admin(auth.uid(), business_unit_id)
      else is_admin_of_outlet(auth.uid(), outlet_id)
    end
  )
  with check (
    case
      when outlet_id is null then is_bu_admin(auth.uid(), business_unit_id)
      else is_admin_of_outlet(auth.uid(), outlet_id)
    end
  );

drop policy if exists checklist_sessions_modify on checklist_sessions;
create policy checklist_sessions_modify on checklist_sessions
  for all to authenticated
  using (
    case
      when outlet_id is null then is_bu_admin(auth.uid(), business_unit_id)
      else is_admin_of_outlet(auth.uid(), outlet_id)
    end
  )
  with check (
    case
      when outlet_id is null then is_bu_admin(auth.uid(), business_unit_id)
      else is_admin_of_outlet(auth.uid(), outlet_id)
    end
  );
