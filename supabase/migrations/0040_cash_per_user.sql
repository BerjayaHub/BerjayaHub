-- =========================================================
-- Berjaya Hub OMS — 0040
-- KAS MENGIKUTI USER, bukan BU maupun outlet.
--
-- Sebelumnya saldo dikelompokkan per (business_unit_id, holder_id), sehingga
-- satu orang punya beberapa "dompet" terpisah dan saldonya berubah setiap
-- berganti BU. Sekarang: satu user = satu saldo, apa pun BU/outlet yang
-- sedang aktif.
--
-- Kolom business_unit_id & outlet_id TIDAK di-drop — dipertahankan supaya
-- riwayat lama tetap utuh dan bisa diaudit. Entri BARU tidak mengisinya.
--
-- Idempotent — aman dijalankan ulang.
-- =========================================================

-- ---------------------------------------------------------
-- (1) Entri baru tidak lagi butuh konteks BU
-- ---------------------------------------------------------
alter table cash_entries alter column business_unit_id drop not null;

comment on column cash_entries.business_unit_id is
  'DEPRECATED sejak 0040 (kas ikut user). Hanya terisi pada baris lama, untuk audit riwayat.';
comment on column cash_entries.outlet_id is
  'DEPRECATED sejak 0040 (kas ikut user). Hanya terisi pada baris lama, untuk audit riwayat.';

-- ---------------------------------------------------------
-- (2) Saldo: SATU per user, lintas BU
-- ---------------------------------------------------------
drop view if exists cash_balances;
create view cash_balances with (security_invoker = true) as
  select holder_id, sum(amount) as balance
  from cash_entries
  group by holder_id;

-- ---------------------------------------------------------
-- (3) RLS: pemilik kas + SUPER ADMIN saja
-- Admin BU tidak lagi bisa melihat kas siapa pun — kas dianggap data
-- tingkat organisasi.
-- ---------------------------------------------------------
drop policy if exists cash_entries_select_own on cash_entries;
drop policy if exists cash_entries_select_admin on cash_entries;
drop policy if exists cash_entries_select_super on cash_entries;

create policy cash_entries_select_own on cash_entries
  for select using (holder_id = auth.uid());
create policy cash_entries_select_super on cash_entries
  for select using (is_super_admin(auth.uid()));

-- Insert: hanya untuk kas sendiri, cukup anggota aktif (tanpa cek BU).
drop policy if exists cash_entries_insert_own on cash_entries;
create policy cash_entries_insert_own on cash_entries
  for insert with check (
    holder_id = auth.uid()
    and created_by = auth.uid()
    and entry_type in ('in', 'out')
    and exists (select 1 from membership_scopes ms where ms.user_id = auth.uid())
  );

-- ---------------------------------------------------------
-- (4) Kategori kas jadi GLOBAL (business_unit_id null)
-- Halaman Kas kini super-admin-only, jadi kategori per BU tidak lagi masuk
-- akal. Kategori lama (yang punya business_unit_id) tetap terbaca supaya
-- entri lama tidak kehilangan namanya.
-- ---------------------------------------------------------
alter table cash_categories alter column business_unit_id drop not null;

drop policy if exists cash_categories_select on cash_categories;
create policy cash_categories_select on cash_categories
  for select using (
    auth.uid() is not null
    and (business_unit_id is null or has_bu_scope(auth.uid(), business_unit_id) or is_super_admin(auth.uid()))
  );

drop policy if exists cash_categories_modify on cash_categories;
create policy cash_categories_modify on cash_categories
  for all using (is_super_admin(auth.uid()))
  with check (is_super_admin(auth.uid()));

-- ---------------------------------------------------------
-- (5) Transfer kas LINTAS BU
-- Signature lama (p_bu, p_outlet, ...) dibuang supaya tidak ada dua versi.
-- Penerima cukup anggota organisasi mana pun — konsekuensi wajar dari
-- "kas ikut user".
-- ---------------------------------------------------------
drop function if exists transfer_cash(uuid, uuid, uuid, numeric, text);
drop function if exists transfer_cash(uuid, numeric, text);

create function transfer_cash(p_to_user uuid, p_amount numeric, p_notes text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_tid uuid := gen_random_uuid();
begin
  if p_amount is null or p_amount <= 0 then raise exception 'Jumlah harus lebih dari 0'; end if;
  if p_to_user = v_uid then raise exception 'Tidak bisa transfer ke diri sendiri'; end if;
  if not exists (select 1 from membership_scopes where user_id = v_uid) then
    raise exception 'Tidak berhak';
  end if;
  if not exists (select 1 from membership_scopes where user_id = p_to_user) then
    raise exception 'Penerima belum terdaftar sebagai anggota';
  end if;

  insert into cash_entries(holder_id, entry_type, amount, counterpart_id, transfer_id, notes, created_by)
    values (v_uid, 'transfer_out', -p_amount, p_to_user, v_tid, p_notes, v_uid);
  insert into cash_entries(holder_id, entry_type, amount, counterpart_id, transfer_id, notes, created_by)
    values (p_to_user, 'transfer_in', p_amount, v_uid, v_tid, p_notes, v_uid);
end;
$$;
grant execute on function transfer_cash(uuid, numeric, text) to authenticated;

-- ---------------------------------------------------------
-- (6) Bukti kas: pemilik + super admin
-- Policy lama menempel ke is_bu_admin(ce.business_unit_id) — tidak lagi
-- berlaku karena kolom itu kini kosong pada entri baru.
-- ---------------------------------------------------------
drop policy if exists cash_proof_select on storage.objects;
create policy cash_proof_select on storage.objects
  for select using (
    bucket_id = 'cash-proofs'
    and ((storage.foldername(name))[1] = auth.uid()::text or is_super_admin(auth.uid()))
  );

-- ---------------------------------------------------------
-- (7) Daftar pemegang kas untuk Admin Portal & pilihan tujuan transfer.
-- RLS user_profiles tidak selalu mengizinkan staff melihat semua nama, padahal
-- transfer lintas BU butuh daftar penerima. Security definer, hanya
-- mengembalikan id + nama (tanpa data sensitif).
-- ---------------------------------------------------------
create or replace function list_cash_members()
returns table (user_id uuid, full_name text)
language sql
security definer
stable
set search_path = public
as $$
  select distinct up.id, up.full_name
  from user_profiles up
  join membership_scopes ms on ms.user_id = up.id
  where up.is_active is not false
  order by up.full_name;
$$;
grant execute on function list_cash_members() to authenticated;
