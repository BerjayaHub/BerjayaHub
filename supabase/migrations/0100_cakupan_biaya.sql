-- =========================================================
-- Berjaya Hub OMS — 0100
-- CAKUPAN BIAYA: langsung outlet / bersama BU / korporat.
--
-- =========================================================
-- KENAPA PERLU, DAN KENAPA `outlet_id` HARUS BOLEH KOSONG
-- =========================================================
--
-- `0095` membuat `outlet_costs` dengan `outlet_id` NOT NULL. Itu benar untuk
-- sewa dan gaji outlet, dan SALAH untuk biaya yang memang bukan milik satu
-- outlet — langganan perangkat lunak, gaji kantor pusat, akuntan.
--
-- Memaksa biaya semacam itu memilih satu outlet berarti ia ikut terhitung di
-- Operating Profit outlet tersebut. Outlet itu lalu terlihat lebih rugi
-- daripada kenyataannya, dan yang lain terlihat lebih untung — tanpa satu pun
-- tanda, karena angkanya tetap wajar.
--
-- Maka `outlet_id` jadi nullable, DAN dijaga constraint supaya kekosongannya
-- tidak bisa dipakai sembarangan:
--
--     direct_outlet  -> outlet_id WAJIB
--     shared_bu      -> outlet_id WAJIB KOSONG
--     corporate      -> outlet_id WAJIB KOSONG
--
-- Tanpa pasangan itu, "biaya bersama yang kebetulan menyebut outlet" bisa ada,
-- dan tidak ada yang bisa memutuskan ia harus dihitung di mana.
--
-- =========================================================
-- TIDAK ADA ALOKASI — INI KEPUTUSAN, BUKAN KETERBATASAN
-- =========================================================
--
-- Biaya `shared_bu` dan `corporate` TIDAK dibagi ke outlet dengan cara apa pun:
-- tidak pro-rata omzet, tidak rata per outlet.
--
-- Alasannya: Actual Operating Profit sebuah outlet harus mewakili biaya yang
-- benar-benar jadi tanggung jawab outlet itu. Begitu alokasi masuk, angkanya
-- berubah mengikuti rumus yang dipilih — dan dua rumus yang sama-sama masuk
-- akal menghasilkan dua kesimpulan berbeda tentang outlet yang sama.
--
-- Kalau kelak dibutuhkan, "Allocated Profit" dibuat sebagai metrik TERPISAH
-- yang tidak mengubah angka aktual.
--
-- =========================================================
-- `cost_behavior` — SIFAT biaya, bukan tempatnya di rumus
-- =========================================================
--
-- `jenis` (tetap/variabel) menjawab "masuk rumus BEP di sebelah mana".
-- `cost_behavior` menjawab "sebenarnya biaya ini berperilaku bagaimana".
--
-- Keduanya berbeda dan keduanya perlu. Listrik dan air itu SEMI-VARIABEL:
-- ada komponen tetap (beban langganan) dan komponen yang ikut naik saat ramai.
-- Memisahkan keduanya butuh regresi atas data historis yang belum ada, jadi
-- untuk sekarang ia diperlakukan sebagai TETAP di rumus BEP — tapi penandanya
-- disimpan supaya kelak bisa dipisah tanpa menebak-nebak lagi.
-- =========================================================

alter table outlet_costs add column if not exists allocation_scope text not null default 'direct_outlet';
alter table outlet_costs add column if not exists cost_behavior text not null default 'fixed';

-- Boleh kosong untuk biaya bersama. Yang lama tetap terisi, jadi tidak ada
-- baris yang berubah artinya.
alter table outlet_costs alter column outlet_id drop not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'outlet_costs_cakupan_sah') then
    alter table outlet_costs add constraint outlet_costs_cakupan_sah
      check (allocation_scope in ('direct_outlet', 'shared_bu', 'corporate'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'outlet_costs_sifat_sah') then
    alter table outlet_costs add constraint outlet_costs_sifat_sah
      check (cost_behavior in ('fixed', 'semi_variable', 'variable'));
  end if;

  -- Cakupan dan outlet harus berjalan bersama. Lihat header.
  if not exists (select 1 from pg_constraint where conname = 'outlet_costs_outlet_ikut_cakupan') then
    alter table outlet_costs add constraint outlet_costs_outlet_ikut_cakupan check (
      (allocation_scope = 'direct_outlet' and outlet_id is not null)
      or (allocation_scope in ('shared_bu', 'corporate') and outlet_id is null)
    );
  end if;

  -- Biaya VARIABEL hanya masuk akal di tingkat outlet: ia mengurangi margin
  -- per porsi, dan porsi terjual selalu milik sebuah outlet. Biaya variabel
  -- ber-cakupan BU tidak punya penyebut.
  if not exists (select 1 from pg_constraint where conname = 'outlet_costs_variabel_hanya_outlet') then
    alter table outlet_costs add constraint outlet_costs_variabel_hanya_outlet
      check (jenis <> 'variabel' or allocation_scope = 'direct_outlet');
  end if;
end $$;

comment on column outlet_costs.allocation_scope is
  'direct_outlet: masuk Operating Profit outlet. shared_bu: berhenti di tingkat BU. corporate: berhenti di tingkat korporat. TIDAK PERNAH dialokasikan ke outlet — lihat header 0100.';
comment on column outlet_costs.cost_behavior is
  'Sifat biaya: fixed / semi_variable / variable. Beda dari `jenis`, yang menentukan posisinya di rumus BEP. Listrik & air ditandai semi_variable tapi diperlakukan tetap sampai ada data untuk memisahkannya.';
comment on column outlet_costs.outlet_id is
  'Wajib untuk direct_outlet, wajib KOSONG untuk shared_bu & corporate. Dijaga constraint outlet_costs_outlet_ikut_cakupan.';

-- Trigger 0095 mencocokkan outlet dengan BU-nya. Ia harus melewati baris yang
-- outlet-nya memang kosong — tanpa ini, seluruh biaya bersama akan ditolak
-- dengan pesan "Outlet tidak ditemukan".
create or replace function outlet_costs_cocokkan_bu()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bu uuid;
begin
  if new.outlet_id is not null then
    select business_unit_id into v_bu from outlets where id = new.outlet_id;
    if v_bu is null then
      raise exception 'Outlet tidak ditemukan';
    end if;
    if v_bu <> new.business_unit_id then
      raise exception 'Outlet ini bukan milik Business Unit yang disebut';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

notify pgrst, 'reload schema';
