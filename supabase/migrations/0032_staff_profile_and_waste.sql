-- =========================================================
-- Berjaya Hub OMS — 0032
--  (1) Data staff lengkap di user_profiles + foto staff (bucket privat)
--  (2) Policy UPDATE user_profiles untuk admin BU (sebelumnya admin tidak bisa
--      mengedit profil staff sama sekali — hanya pemilik akun)
--  (3) RPC waste MENU: bahan terpotong sesuai resep menu
-- =========================================================

-- ---- (1) Kolom data staff ----
alter table user_profiles add column if not exists ktp_name text;
alter table user_profiles add column if not exists ktp_number text;
alter table user_profiles add column if not exists gender text check (gender in ('L', 'P'));
alter table user_profiles add column if not exists ktp_address text;
alter table user_profiles add column if not exists postal_code text;
alter table user_profiles add column if not exists mother_name text;
alter table user_profiles add column if not exists emergency_contact text;
alter table user_profiles add column if not exists shirt_size text;
alter table user_profiles add column if not exists pants_size text;
alter table user_profiles add column if not exists shoe_size text;
alter table user_profiles add column if not exists marital_status text check (marital_status in ('kawin', 'belum_kawin'));
alter table user_profiles add column if not exists npwp text;
alter table user_profiles add column if not exists photo_path text;

-- ---- (2) Admin BU boleh memperbarui profil staff di BU-nya ----
drop policy if exists user_profiles_update_admin on user_profiles;
create policy user_profiles_update_admin on user_profiles
  for update using (
    exists (
      select 1 from membership_scopes ms
      where ms.user_id = user_profiles.id and is_bu_admin(auth.uid(), ms.business_unit_id)
    )
  )
  with check (
    exists (
      select 1 from membership_scopes ms
      where ms.user_id = user_profiles.id and is_bu_admin(auth.uid(), ms.business_unit_id)
    )
  );

-- ---- Foto staff (bucket privat). Path: {user_id}/photo.jpg ----
insert into storage.buckets (id, name, public)
values ('staff-photos', 'staff-photos', false)
on conflict (id) do nothing;

drop policy if exists staff_photo_insert on storage.objects;
create policy staff_photo_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'staff-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists staff_photo_update on storage.objects;
create policy staff_photo_update on storage.objects
  for update to authenticated
  using (bucket_id = 'staff-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'staff-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists staff_photo_select on storage.objects;
create policy staff_photo_select on storage.objects
  for select using (
    bucket_id = 'staff-photos'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from membership_scopes ms
        where ms.user_id = (storage.foldername(name))[1]::uuid
          and is_bu_admin(auth.uid(), ms.business_unit_id)
      )
    )
  );

-- ---- (3) RPC: waste MENU -> potong bahan sesuai resep menu ----
create or replace function record_menu_waste(p_bu uuid, p_outlet uuid, p_product uuid, p_qty numeric, p_notes text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_mode text;
  v_recipe recipes%rowtype;
  v_name text;
  r record;
begin
  if p_qty is null or p_qty <= 0 then raise exception 'Jumlah harus lebih dari 0'; end if;
  if not has_bu_scope(v_uid, p_bu) then raise exception 'Tidak berhak'; end if;

  select outlet_role into v_role from outlets where id = p_outlet;
  if v_role is null then raise exception 'Outlet tidak valid'; end if;
  v_mode := case when v_role = 'served_by_ck' then 'served_by_ck' else 'standalone' end;

  select name into v_name from products where id = p_product;

  select * into v_recipe from recipes where product_id = p_product and mode = v_mode;
  if v_recipe.id is null then
    select * into v_recipe from recipes where product_id = p_product and mode = 'standalone';
  end if;
  if v_recipe.id is null then raise exception 'Menu ini belum punya resep, bahan tidak bisa dihitung'; end if;
  if v_recipe.yield_qty is null or v_recipe.yield_qty <= 0 then raise exception 'Yield resep tidak valid'; end if;

  for r in select ingredient_product_id, qty from recipe_items where recipe_id = v_recipe.id loop
    insert into stock_movements(business_unit_id, outlet_id, product_id, movement_type, qty_delta, notes, created_by)
      values (p_bu, p_outlet, r.ingredient_product_id, 'waste',
              -(r.qty * p_qty / v_recipe.yield_qty),
              coalesce('Waste menu: ' || v_name || ' x' || p_qty || case when p_notes is null or p_notes = '' then '' else ' — ' || p_notes end, 'Waste menu'),
              v_uid);
  end loop;
end;
$$;
grant execute on function record_menu_waste(uuid, uuid, uuid, numeric, text) to authenticated;
