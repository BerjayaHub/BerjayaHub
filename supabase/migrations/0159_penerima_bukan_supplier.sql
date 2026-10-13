-- ============================================================
-- 0159 — YANG DIBAYAR TIDAK SELALU SUPPLIER.
--
--   "untuk pembayaran uang hadir staff di cash ledger yang memakai kas/kantong
--    outlet baiknya bagaimana? karena ada pewajiban memasukkan supplier di kas
--    keluar di cash ledger"
--
-- ============ YANG SALAH BUKAN TRANSAKSINYA, TAPI NAMA KOLOMNYA ============
--
-- Di template ESB kolomnya bernama `Payment To` — "uang ini dibayarkan ke
-- siapa". Berjaya Hub menyebutnya **Supplier** dan mewajibkannya datang dari
-- master supplier (0151, lalu 0158).
--
-- Untuk uang hadir staff, penerimanya memang bukan supplier. Jadi staff
-- berdiri di depan form yang menuntut jawaban yang tidak ada — dan pilihannya
-- cuma dua, keduanya buruk: mengisi nama supplier yang tidak ada hubungannya,
-- atau tidak mencatat pengeluarannya sama sekali.
--
-- Yang pertama merusak pembukuan dengan cara yang terlihat rapi. Yang kedua
-- membuat saldo kas outlet tidak pernah cocok dengan uang fisiknya.
--
-- ============ SATU DAFTAR, DUA JENIS PENERIMA ============
--
--   'supplier'  — vendor. Muncul di dropdown NOTA dan di kas keluar.
--   'internal'  — penerima yang bukan vendor: "Kas Operasional", uang hadir,
--                 kasbon, dan sejenisnya. HANYA di kas keluar.
--
-- Dipisah lewat kolom, bukan lewat tabel kedua. Keduanya menjawab pertanyaan
-- yang sama persis di `Payment To`, dan dua tabel untuk satu kolom tujuan akan
-- menghasilkan dua daftar yang perlahan menyimpang — lalu pertanyaan "nama ini
-- terdaftar di mana?" jadi punya dua jawaban.
--
-- Nama tabelnya tetap `suppliers`. Mengganti namanya berarti menyentuh setiap
-- query, policy, dan RPC yang sudah menyebutnya, untuk keuntungan yang murni
-- kosmetik. Yang penting komentarnya jujur: tabel ini DAFTAR PENERIMA
-- PEMBAYARAN, dan `supplier` adalah salah satu jenisnya.
--
-- ============ YANG TIDAK DILAKUKAN ============
--
-- Pewajibannya TIDAK dilonggarkan. `Payment To` yang kosong ditolak ekspor
-- Disbursement, jadi melonggarkan di form cuma memindahkan masalahnya ke dua
-- minggu kemudian — ke orang lain, dalam bentuk baris tertahan tanpa sebab
-- yang terbaca. Yang ditambahkan adalah JAWABAN yang benar, bukan izin untuk
-- tidak menjawab.
-- ============================================================

-- ---------------------------------------------------------
-- (1) Jenis penerima.
-- ---------------------------------------------------------
alter table suppliers
  add column if not exists jenis text not null default 'supplier';

alter table suppliers drop constraint if exists suppliers_jenis_check;
alter table suppliers
  add constraint suppliers_jenis_check check (jenis in ('supplier', 'internal'));

create index if not exists idx_suppliers_jenis on suppliers(business_unit_id, jenis) where aktif;

comment on table suppliers is
  'DAFTAR PENERIMA PEMBAYARAN per BU — isi kolom `Payment To` di ekspor ESB. `jenis` membedakan vendor (supplier) dari penerima internal (Kas Operasional, uang hadir, kasbon). Namanya `suppliers` karena sejarah: ia lahir di 0158 sebagai master supplier.';

comment on column suppliers.jenis is
  'supplier = vendor, muncul di dropdown nota DAN kas keluar. internal = penerima bukan vendor, HANYA di kas keluar.';

-- ---------------------------------------------------------
-- (2) SATU penerima internal bawaan, per BU.
--
-- ============ KENAPA DISEDIAKAN, BUKAN DISERAHKAN KE ADMIN ============
--
-- Keluhan yang melahirkan berkas ini berbunyi "staff tidak bisa mencatatnya".
-- Migration yang cuma menyediakan KEMUNGKINAN penerima internal — lalu
-- menunggu admin membuatnya — meninggalkan staff pada keadaan yang sama persis
-- sampai ada yang sempat membukanya.
--
-- Namanya boleh diganti admin kapan saja lewat layar Master Supplier; yang
-- disediakan di sini cuma supaya tidak ada hari di mana uang hadir tidak bisa
-- dicatat.
--
-- `terverifikasi = true`: ia memang dibuat sistem, bukan diketik siapa pun,
-- jadi tidak ada yang perlu memeriksanya. Kode ESB-nya tetap kosong — itu
-- yang akan diisi admin, dan itu pula yang ditandai layarnya sebagai
-- pekerjaan.
-- ---------------------------------------------------------
insert into suppliers (business_unit_id, nama, jenis, terverifikasi)
select b.id, 'Kas Operasional', 'internal', true
  from business_units b
on conflict (business_unit_id, normal_nama_supplier(nama)) do nothing;

-- ============ DAN UNTUK BU YANG LAHIR SESUDAH INI ============
--
-- `insert` di atas cuma mengurus BU yang ADA saat migration dijalankan. BU
-- berikutnya akan lahir tanpa penerima internal — dan tidak ada yang tahu
-- sampai ada staff di sana yang mencoba mencatat uang hadir dan tertahan oleh
-- form, yaitu keluhan yang sama persis, berbulan-bulan kemudian, di tempat
-- yang tidak dicurigai siapa pun.
--
-- Ditemukan tesnya sendiri (§4), bukan dengan memikirkannya lebih dulu.
create or replace function seed_penerima_internal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into suppliers (business_unit_id, nama, jenis, terverifikasi)
  values (new.id, 'Kas Operasional', 'internal', true)
  on conflict (business_unit_id, normal_nama_supplier(nama)) do nothing;
  return new;
end;
$$;

revoke all on function seed_penerima_internal() from public;

drop trigger if exists trg_seed_penerima_internal on business_units;
create trigger trg_seed_penerima_internal
  after insert on business_units
  for each row
  execute function seed_penerima_internal();

-- ---------------------------------------------------------
-- (3) Admin boleh menambah penerima.
--
-- Sebelum ini baris master hanya bisa lahir dari dua jalan: impor daftar ESB,
-- dan ketikan staff di nota. Keduanya menghasilkan jenis `supplier` — jadi
-- tanpa fungsi ini, penerima internal cuma ada yang dari seed di atas.
-- ---------------------------------------------------------
create or replace function tambah_supplier(p_bu uuid, p_nama text, p_jenis text default 'supplier')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nama text := btrim(regexp_replace(coalesce(p_nama, ''), '\s+', ' ', 'g'));
  v_jenis text := coalesce(nullif(btrim(coalesce(p_jenis, '')), ''), 'supplier');
  v_id uuid;
begin
  if not is_bu_admin(auth.uid(), p_bu) then
    raise exception 'Hanya Admin BU atau Super Admin yang bisa menambah penerima pembayaran.';
  end if;
  if v_nama = '' then raise exception 'Nama penerima tidak boleh kosong.'; end if;
  if v_jenis not in ('supplier', 'internal') then
    raise exception 'Jenis penerima tidak dikenal: %.', v_jenis;
  end if;

  select id into v_id
    from suppliers
   where business_unit_id = p_bu
     and normal_nama_supplier(nama) = normal_nama_supplier(v_nama);
  if v_id is not null then
    raise exception 'Sudah ada penerima bernama "%" di BU ini.', v_nama;
  end if;

  insert into suppliers (business_unit_id, nama, jenis, terverifikasi, dibuat_by, diperbarui_by)
  values (p_bu, v_nama, v_jenis, true, auth.uid(), auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function tambah_supplier(uuid, text, text) from public;
grant execute on function tambah_supplier(uuid, text, text) to authenticated;

-- ---------------------------------------------------------
-- (4) `ubah_supplier` ikut mengurus jenisnya.
--
-- ============ TANDA TANGAN LAMA DIBUANG ============
--
-- PostgREST memilih overload dari KUMPULAN NAMA ARGUMEN, dan `JSON.stringify`
-- membuang kunci bernilai `undefined`. Membiarkan dua tanda tangan hidup
-- berdampingan berarti panggilan yang kebetulan tidak menyertakan `p_jenis`
-- mendarat di fungsi LAMA — diam-diam, dan hanya pada sebagian panggilan.
-- Aturan di repo ini: satu nama fungsi, satu tanda tangan.
-- ---------------------------------------------------------
drop function if exists ubah_supplier(uuid, text, text, text, boolean, boolean);

create or replace function ubah_supplier(
  p_id uuid,
  p_nama text,
  p_esb_kode text default null,
  p_esb_nama text default null,
  p_terverifikasi boolean default null,
  p_aktif boolean default null,
  p_jenis text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bu uuid;
  v_nama text := btrim(regexp_replace(coalesce(p_nama, ''), '\s+', ' ', 'g'));
  v_jenis text := nullif(btrim(coalesce(p_jenis, '')), '');
begin
  select business_unit_id into v_bu from suppliers where id = p_id;
  if v_bu is null then raise exception 'Supplier tidak ditemukan.'; end if;
  if not is_bu_admin(auth.uid(), v_bu) then
    raise exception 'Hanya Admin BU atau Super Admin yang bisa mengubah master supplier.';
  end if;
  if v_nama = '' then raise exception 'Nama supplier tidak boleh kosong.'; end if;
  if v_jenis is not null and v_jenis not in ('supplier', 'internal') then
    raise exception 'Jenis penerima tidak dikenal: %.', v_jenis;
  end if;

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
         esb_nama = nullif(btrim(coalesce(p_esb_nama, '')), ''),
         terverifikasi = coalesce(p_terverifikasi, terverifikasi),
         aktif = coalesce(p_aktif, aktif),
         -- `null` berarti "jangan ubah". Penerima internal yang diam-diam
         -- berubah jadi supplier akan muncul di dropdown nota, dan staff
         -- memilih "Kas Operasional" sebagai supplier bahan.
         jenis = coalesce(v_jenis, jenis),
         diperbarui_by = auth.uid(),
         diperbarui_at = now()
   where id = p_id;
end;
$$;

revoke all on function ubah_supplier(uuid, text, text, text, boolean, boolean, text) from public;
grant execute on function ubah_supplier(uuid, text, text, text, boolean, boolean, text) to authenticated;

-- ---------------------------------------------------------
-- (5) BARIS YANG LAHIR DARI NOTA SELALU `supplier`.
--
-- ============ NAMA ADALAH KUNCINYA, JENIS TIDAK ============
--
-- Godaan pertama: batasi pencariannya ke jenis `supplier` juga, supaya nota
-- tidak pernah menunjuk penerima internal.
--
-- Itu SALAH, dan salahnya senyap. Indeks uniknya dipasang pada NAMA, bukan
-- pada (nama, jenis) — jadi kalau pencarian dibatasi jenis, nota yang
-- kebetulan menyebut "Kas Operasional" tidak akan menemukannya, lalu mencoba
-- menyisipkan baris baru, lalu ditolak indeks unik, lalu `do nothing`, lalu
-- membaca ulang dengan saringan yang sama dan tetap tidak menemukan apa pun.
-- Hasilnya `supplier_id` NULL: notanya tersimpan tanpa tertaut ke mana pun,
-- tanpa satu pun galat.
--
-- Jadi pencariannya TIDAK disaring jenis. Satu nama = satu penerima, titik.
-- Nota yang menyebut penerima internal akan tertaut ke sana — dan itu terlihat
-- di layar Master Supplier sebagai penerima internal yang punya nota, yaitu
-- keganjilan yang bisa diperiksa. Jauh lebih baik daripada nota yang
-- tidak tertaut ke apa pun.
--
-- Yang mencegahnya terjadi ada di tempat lain: dropdown NOTA hanya menampilkan
-- jenis `supplier`, jadi penerima internal tidak bisa DIPILIH di sana — harus
-- diketik persis, dan itu bukan hal yang terjadi karena kelalaian.
--
-- Yang dijaga di sini cuma satu: baris BARU yang lahir dari nota selalu
-- `supplier`, tidak pernah `internal`.
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

  insert into suppliers (business_unit_id, nama, jenis, dibuat_by, diperbarui_by)
  values (p_bu, v_nama, 'supplier', auth.uid(), auth.uid())
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

notify pgrst, 'reload schema';
