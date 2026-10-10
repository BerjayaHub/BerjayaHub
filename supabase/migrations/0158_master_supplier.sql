-- ============================================================
-- 0158 — MASTER SUPPLIER: satu daftar, dipakai bersama, bisa dibetulkan.
--
--   "ada case dimana staff menambahkan supplier baru di staff app saat input
--    nota terima dari supplier, tetapi saat akan input lagi, supplier baru
--    tersebut tidak muncul lagi di dropdown supplier"
--
-- ============ KENAPA IA HILANG ============
--
-- Dropdown supplier di Staff App diisi dari `esb_master` jenis `supplier` —
-- daftar yang DIIMPOR dari berkas ESB. Nama yang diketik staff tidak masuk ke
-- sana; ia disimpan sebagai teks bebas di `goods_receipts.supplier`, dan
-- berakhir di situ.
--
-- Jadi bukan "hilang": ia memang tidak pernah jadi apa pun yang bisa dipilih
-- lagi. Satu-satunya tempat ia muncul kembali adalah layar Master Supplier di
-- Admin Portal, sebagai baris berstatus "belum terdaftar".
--
-- ============ DUA DAFTAR YANG TIDAK BOLEH DICAMPUR ============
--
-- `esb_master` adalah salinan daftar resmi ESB. Menambahkan ketikan staff ke
-- sana akan membuatnya berbohong: status "sudah sama dengan ESB" jadi tidak
-- bisa dibedakan dari "diketik staff tadi pagi" — padahal membedakan keduanya
-- adalah seluruh guna layar itu.
--
-- Maka master supplier jadi tabelnya sendiri. `esb_master` tetap murni hasil
-- impor; `suppliers` yang dipakai dropdown, dan ia menyimpan kode ESB-nya
-- sendiri — diisi admin belakangan.
--
-- ============ NOTA MENUNJUK ID, BUKAN TEKS ============
--
--   "setelah di edit supplier baru ini otomatis juga akan menyesuaikan di
--    staff app nya"
--
-- Supaya itu berlaku untuk SEMUA yang sudah tercatat — nota lama, daftar
-- hutang, laporan, ekspor ESB — bukan cuma dropdown ke depan.
--
-- Kolom teks `goods_receipts.supplier` DIPERTAHANKAN, tapi artinya berubah:
-- ia tidak lagi ditulis siapa pun, melainkan SALINAN yang dijaga database dari
-- `suppliers.nama`. Itu membuat sepuluh lebih pembaca lama (ekspor Purchase,
-- Disbursement, laporan nota, PDF, rekap hutang) tetap bekerja apa adanya, dan
-- ikut berubah sendiri saat namanya dibetulkan.
--
-- Perlu dikatakan terus terang: ini SALINAN, dan salinan selalu bisa
-- menyimpang. Yang membuatnya aman cuma satu hal — ia hanya pernah ditulis
-- oleh trigger di berkas ini, tidak pernah oleh layar mana pun. Trigger-nya
-- menimpa apa pun yang dikirim klien, jadi PWA lama yang masih mengirim teks
-- tidak bisa membuatnya berbeda dari induknya.
-- ============================================================

-- ---------------------------------------------------------
-- (1) NORMALISASI NAMA — satu aturan, dipakai database & layar.
--
-- Sama persis dengan `normalNama()` di `js/modules/inventory/cocok-supplier.js`:
-- rapatkan spasi ganda, buang spasi ujung, huruf kecil semua.
--
-- `immutable`, karena ia dipakai sebagai indeks unik. Tanpa itu Postgres
-- menolak indeksnya, dan tanpa indeks itu "Toko Berkah" dan "toko  berkah"
-- jadi dua supplier yang berbeda — persis kekacauan yang sedang dicegah.
-- ---------------------------------------------------------
create or replace function normal_nama_supplier(p_nama text)
returns text
language sql
immutable
as $$
  select lower(btrim(regexp_replace(coalesce(p_nama, ''), '\s+', ' ', 'g')));
$$;

-- ---------------------------------------------------------
-- (2) TABELNYA.
-- ---------------------------------------------------------
create table if not exists suppliers (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references business_units(id) on delete cascade,
  nama text not null,

  -- Kode & nama di ESB. Dua kolom, bukan satu:
  --
  --   `esb_kode` untuk dicocokkan admin dengan Master Supplier di ESB.
  --   `esb_nama` HANYA diisi kalau ejaan di ESB BERBEDA dari `nama`. Kosong
  --   berarti sama — dan itu keadaan yang dituju, bukan keadaan yang kurang.
  esb_kode text,
  esb_nama text,

  -- Sudah diperiksa admin? Supplier yang lahir dari ketikan staff mulai dari
  -- `false`, dan TETAP bisa dipakai semua orang sejak detik itu. Yang
  -- ditandai cuma bahwa belum ada yang memeriksanya.
  terverifikasi boolean not null default false,

  aktif boolean not null default true,
  catatan text,

  dibuat_by uuid references user_profiles(id) on delete set null,
  dibuat_at timestamptz not null default now(),
  diperbarui_by uuid references user_profiles(id) on delete set null,
  diperbarui_at timestamptz not null default now()
);

-- SATU supplier per nama ternormalkan, per BU. Ini penjaga terpentingnya:
-- tanpa ini, supplier dibuat otomatis dari ketikan staff akan beranak setiap
-- kali ada yang menekan spasi dua kali.
create unique index if not exists suppliers_nama_uk
  on suppliers(business_unit_id, normal_nama_supplier(nama));

create index if not exists idx_suppliers_bu on suppliers(business_unit_id, aktif);
create index if not exists idx_suppliers_belum
  on suppliers(business_unit_id) where not terverifikasi;

alter table suppliers enable row level security;

-- `drop ... if exists` dulu. `create policy` TIDAK punya `if not exists`, jadi
-- tanpa ini menjalankan berkas ini dua kali berhenti di tengah dengan
-- "policy already exists" — dan yang menjalankannya tidak tahu bagian mana
-- yang sudah dan belum terpasang.
drop policy if exists suppliers_select on suppliers;
drop policy if exists suppliers_modify on suppliers;

-- Baca: seluruh anggota BU — dropdown-nya dipakai staff.
create policy suppliers_select on suppliers
  for select using (has_bu_scope(auth.uid(), business_unit_id));

-- Tulis LANGSUNG: Admin BU saja.
--
-- Staff tidak pernah menulis ke tabel ini sendiri; yang membuatkan barisnya
-- adalah trigger di `goods_receipts`, yang berjalan `security definer`.
-- Membuka tabel ini untuk semua staff berarti membuka jalan membuat ratusan
-- baris tanpa satu pun nota di belakangnya.
create policy suppliers_modify on suppliers
  for all using (is_bu_admin(auth.uid(), business_unit_id))
  with check (is_bu_admin(auth.uid(), business_unit_id));

comment on table suppliers is
  'Master supplier per BU. Diisi dua arah: impor daftar ESB (terverifikasi) dan ketikan staff di nota (belum terverifikasi, tetap langsung bisa dipakai). esb_master TIDAK disentuh — ia tetap salinan murni daftar ESB.';

-- ---------------------------------------------------------
-- (3) CARI-ATAU-BUAT — satu pintu, dipakai trigger & layar.
--
-- `security definer`: pemanggilnya staff biasa yang tidak punya hak tulis ke
-- `suppliers`. Yang dibatasi bukan siapa yang boleh membuat, melainkan APA
-- yang bisa dibuat — satu baris per nama, di BU-nya sendiri, dan hanya kalau
-- ia memang sedang mencatat nota.
-- ---------------------------------------------------------
create or replace function cari_atau_buat_supplier(p_bu uuid, p_nama text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nama text := btrim(regexp_replace(coalesce(p_nama, ''), '\s+', ' ', 'g'));
  v_id uuid;
begin
  if v_nama = '' or p_bu is null then return null; end if;

  select id into v_id
    from suppliers
   where business_unit_id = p_bu
     and normal_nama_supplier(nama) = normal_nama_supplier(v_nama);
  if v_id is not null then return v_id; end if;

  -- `on conflict do nothing` + baca ulang, bukan sekadar insert.
  --
  -- Dua staff di dua HP bisa menyimpan nota dengan supplier baru yang sama
  -- pada detik yang sama. Tanpa ini, yang kedua gagal dengan pelanggaran
  -- indeks unik — dan notanya ikut gagal tersimpan, padahal barangnya sudah
  -- ada di gudang.
  insert into suppliers (business_unit_id, nama, dibuat_by, diperbarui_by)
  values (p_bu, v_nama, auth.uid(), auth.uid())
  on conflict (business_unit_id, normal_nama_supplier(nama)) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id
      from suppliers
     where business_unit_id = p_bu
       and normal_nama_supplier(nama) = normal_nama_supplier(v_nama);
  end if;

  return v_id;
end;
$$;

revoke all on function cari_atau_buat_supplier(uuid, text) from public;
grant execute on function cari_atau_buat_supplier(uuid, text) to authenticated;

-- ---------------------------------------------------------
-- (4) ISI AWALNYA.
-- ---------------------------------------------------------

-- (a) Daftar resmi ESB -> terverifikasi, lengkap dengan kodenya.
insert into suppliers (business_unit_id, nama, esb_kode, terverifikasi)
select m.business_unit_id, btrim(m.nama), nullif(btrim(coalesce(m.kode, '')), ''), true
  from esb_master m
 where m.jenis = 'supplier'
   and coalesce(btrim(m.nama), '') <> ''
on conflict (business_unit_id, normal_nama_supplier(nama)) do nothing;

-- (b) Ejaan yang BENAR-BENAR dipakai nota -> belum terverifikasi.
--
-- Termasuk yang sudah dijembatani `esb_map`: penjembatanannya tetap berlaku
-- untuk ekspor, dan di daftar ini ia tetap perlu terlihat sebagai supplier
-- yang pernah dipakai.
insert into suppliers (business_unit_id, nama)
select g.business_unit_id, btrim(g.supplier)
  from goods_receipts g
 where coalesce(btrim(g.supplier), '') <> ''
 group by g.business_unit_id, btrim(g.supplier)
on conflict (business_unit_id, normal_nama_supplier(nama)) do nothing;

-- ---------------------------------------------------------
-- (5) NOTA MENUNJUK BARISNYA.
-- ---------------------------------------------------------
alter table goods_receipts
  add column if not exists supplier_id uuid references suppliers(id) on delete set null;

create index if not exists idx_goods_receipts_supplier on goods_receipts(supplier_id);

update goods_receipts g
   set supplier_id = s.id
  from suppliers s
 where g.supplier_id is null
   and s.business_unit_id = g.business_unit_id
   and normal_nama_supplier(s.nama) = normal_nama_supplier(g.supplier);

comment on column goods_receipts.supplier is
  'SALINAN dari suppliers.nama, dijaga trigger. Tidak pernah ditulis layar — kolom ini ada supaya pembaca lama (ekspor ESB, laporan, PDF) tetap bekerja DAN ikut berubah saat namanya dibetulkan admin. Sumber kebenarannya `supplier_id`.';

-- ---------------------------------------------------------
-- (6) TRIGGER: teks jadi tautan, lalu tautan jadi teks.
--
-- ============ KENAPA DI DATABASE ============
--
-- Layar nota yang baru akan mengirim `supplier_id`. Tapi ada jalan masuk lain
-- yang tidak lewat sana: PWA lama yang masih di cache HP staff, RPC
-- `simpan_nota`/`ubah_nota`/`koreksi_nota` yang menerima `p_supplier text`,
-- dan siapa pun yang memanggil PostgREST sendiri.
--
-- Kalau penautannya diserahkan ke layar, semua jalan itu menghasilkan nota
-- ber-`supplier_id` NULL — dan supplier barunya tetap tidak pernah muncul di
-- dropdown, yaitu persis keluhan yang sedang diperbaiki.
-- ---------------------------------------------------------
create or replace function tautkan_supplier_nota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nama text;
begin
  -- Teks yang dikirim -> cari atau buat barisnya.
  if new.supplier_id is null and coalesce(btrim(new.supplier), '') <> '' then
    new.supplier_id := cari_atau_buat_supplier(new.business_unit_id, new.supplier);
  end if;

  -- Lalu teksnya DITIMPA dari induknya. Klien tidak bisa membuat salinan ini
  -- berbeda dari sumbernya, bahkan kalau ia mengirim keduanya sekaligus.
  if new.supplier_id is not null then
    select nama into v_nama from suppliers where id = new.supplier_id;
    if v_nama is not null then new.supplier := v_nama; end if;
  end if;

  return new;
end;
$$;

revoke all on function tautkan_supplier_nota() from public;

drop trigger if exists trg_tautkan_supplier_nota on goods_receipts;
create trigger trg_tautkan_supplier_nota
  before insert or update on goods_receipts
  for each row
  execute function tautkan_supplier_nota();

-- Nama dibetulkan admin -> seluruh nota ikut, tanpa ada yang menyinkronkan.
create or replace function sebarkan_nama_supplier()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.nama is distinct from old.nama then
    update goods_receipts set supplier = new.nama where supplier_id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function sebarkan_nama_supplier() from public;

drop trigger if exists trg_sebarkan_nama_supplier on suppliers;
create trigger trg_sebarkan_nama_supplier
  after update on suppliers
  for each row
  execute function sebarkan_nama_supplier();

-- ---------------------------------------------------------
-- (7) ADMIN: betulkan, verifikasi, GABUNGKAN.
--
-- ============ GABUNG BUKAN FITUR TAMBAHAN ============
--
-- Begitu supplier bisa lahir dari ketikan, "Toko Berkah", "Tk Berkah", dan
-- "Toko Berkah Jaya" akan muncul dengan sendirinya dalam hitungan minggu.
-- Daftar master tanpa cara menggabungkan akan berubah jadi daftar yang tidak
-- ada gunanya dibaca — dan pada saat itu orang kembali ke Excel.
-- ---------------------------------------------------------
create or replace function ubah_supplier(
  p_id uuid,
  p_nama text,
  p_esb_kode text default null,
  p_esb_nama text default null,
  p_terverifikasi boolean default null,
  p_aktif boolean default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bu uuid;
  v_nama text := btrim(regexp_replace(coalesce(p_nama, ''), '\s+', ' ', 'g'));
begin
  select business_unit_id into v_bu from suppliers where id = p_id;
  if v_bu is null then raise exception 'Supplier tidak ditemukan.'; end if;
  if not is_bu_admin(auth.uid(), v_bu) then
    raise exception 'Hanya Admin BU atau Super Admin yang bisa mengubah master supplier.';
  end if;
  if v_nama = '' then raise exception 'Nama supplier tidak boleh kosong.'; end if;

  -- Bentrok nama DIKATAKAN, bukan dibiarkan jadi galat indeks yang tidak bisa
  -- dibaca siapa pun — dan jawabannya ditunjukkan sekalian.
  if exists (
    select 1 from suppliers
     where business_unit_id = v_bu
       and id <> p_id
       and normal_nama_supplier(nama) = normal_nama_supplier(v_nama)
  ) then
    raise exception 'Sudah ada supplier lain bernama "%" di BU ini. Kalau keduanya memang sama, pakai Gabungkan.', v_nama;
  end if;

  update suppliers
     set nama = v_nama,
         esb_kode = nullif(btrim(coalesce(p_esb_kode, '')), ''),
         -- Kosong berarti "ejaannya sama dengan nama" — bukan "belum diisi".
         esb_nama = nullif(btrim(coalesce(p_esb_nama, '')), ''),
         terverifikasi = coalesce(p_terverifikasi, terverifikasi),
         aktif = coalesce(p_aktif, aktif),
         diperbarui_by = auth.uid(),
         diperbarui_at = now()
   where id = p_id;
end;
$$;

revoke all on function ubah_supplier(uuid, text, text, text, boolean, boolean) from public;
grant execute on function ubah_supplier(uuid, text, text, text, boolean, boolean) to authenticated;

create or replace function gabung_supplier(p_dari uuid, p_ke uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bu_dari uuid;
  v_bu_ke uuid;
  v_n int;
begin
  if p_dari = p_ke then raise exception 'Pilih dua supplier yang berbeda.'; end if;
  select business_unit_id into v_bu_dari from suppliers where id = p_dari;
  select business_unit_id into v_bu_ke from suppliers where id = p_ke;
  if v_bu_dari is null or v_bu_ke is null then raise exception 'Supplier tidak ditemukan.'; end if;
  if v_bu_dari <> v_bu_ke then raise exception 'Keduanya harus di BU yang sama.'; end if;
  if not is_bu_admin(auth.uid(), v_bu_dari) then
    raise exception 'Hanya Admin BU atau Super Admin yang bisa menggabungkan supplier.';
  end if;

  -- Notanya dipindahkan. Trigger `tautkan_supplier_nota` akan menimpa kolom
  -- teksnya dari induk yang baru, jadi dokumen lama ikut menyebut nama yang
  -- benar tanpa ada yang menyentuhnya satu per satu.
  update goods_receipts set supplier_id = p_ke where supplier_id = p_dari;
  get diagnostics v_n = row_count;

  -- Yang digabung DIHAPUS, bukan dinonaktifkan.
  --
  -- Baris nonaktif yang tidak lagi ditunjuk nota mana pun cuma memanjangkan
  -- daftar yang gunanya justru supaya pendek. Jejaknya tidak hilang: notanya
  -- tetap ada, sekarang menunjuk induk yang benar.
  delete from suppliers where id = p_dari;

  return v_n;
end;
$$;

revoke all on function gabung_supplier(uuid, uuid) from public;
grant execute on function gabung_supplier(uuid, uuid) to authenticated;

comment on function gabung_supplier(uuid, uuid) is
  'Pindahkan seluruh nota dari satu supplier ke supplier lain, lalu hapus yang asal. Mengembalikan jumlah nota yang berpindah.';

notify pgrst, 'reload schema';
