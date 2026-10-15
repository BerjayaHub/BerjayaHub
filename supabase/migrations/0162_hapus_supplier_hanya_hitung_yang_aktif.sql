-- =========================================================
-- 0162 — HAPUS SUPPLIER: YANG DIHITUNG HANYA DOKUMEN YANG AKTIF
--
--   "nota dengan supplier sudah saya batalkan dari staff app, tetapi supplier
--    yang dimaksud masih belum bisa dihapus, apa karena nota terima dari
--    supplier yang sudah dihapus masih belum terhapus, atau bagaimana?"
--
-- Tebakannya tepat arahnya. `batalkan_nota` (0131/0143) TIDAK menghapus
-- notanya — ia menandai `status = 'dibatalkan'`. Barisnya tetap ada, dan
-- `supplier_id`-nya tetap menunjuk suppliernya.
--
-- ============ DUA DEFINISI "DIPAKAI" DI SATU FITUR ============
--
-- Yang membuatnya membingungkan bukan penolakannya, melainkan bahwa LAYARNYA
-- BERKATA SEBALIKNYA:
--
--   `nama_supplier_terpakai` (0144)  menghitung `where g.status = 'aktif'`.
--                                    Inilah yang mengisi kolom "Nota" di layar
--                                    Master Supplier — dan karena nota itu
--                                    sudah dibatalkan, angkanya 0.
--
--   `hapus_supplier` (0161)          menghitung SELURUH baris, tanpa melihat
--                                    status.
--
-- Jadi: tombol Hapus MUNCUL (layar melihat 0 nota), lalu ditekan, lalu ditolak
-- ("masih dipakai 1 nota"). Dua aturan untuk satu pertanyaan, di satu fitur,
-- ditulis berselang dua hari — dan yang terjepit di antaranya adalah orang
-- yang disuruh membatalkan notanya dulu, sudah melakukannya, lalu tetap
-- ditolak tanpa penjelasan yang masuk akal.
--
-- Ini kesalahan 0161, bukan kesalahan pemakainya. Yang benar adalah definisi
-- yang sudah dipakai seluruh sistem sejak 0131: dokumen yang DIBATALKAN bukan
-- dokumen yang dipakai.
--
-- ============ HAL YANG SAMA DI SISI KAS ============
--
-- `cash_entries` punya bentuk pembatalannya sendiri — `dicoret_at` (0141) —
-- dan seluruh pembaca kas menyaringnya dengan `dicoret_at is null`. 0161 tidak
-- menyaringnya sama sekali, jadi satu entri kas yang sudah dicoret pun menahan
-- penghapusan selamanya.
--
-- Gejalanya belum dilaporkan, tapi sebabnya sama persis. Diperbaiki sekalian:
-- memperbaiki separuh dari satu kesalahan meninggalkan separuhnya untuk
-- ditemukan orang lain, bulan depan, sebagai keluhan yang terlihat baru.
--
-- ============ AMAN, DAN KENAPA ============
--
-- Menghapus supplier membuat `goods_receipts.supplier_id` jadi NULL pada nota
-- yang dibatalkan itu (FK-nya `on delete set null`, 0158). Yang TIDAK hilang
-- adalah kolom teks `goods_receipts.supplier` — ia salinan nama yang dijaga
-- trigger, dan ia tetap tertulis di dokumennya.
--
-- Jadi jejaknya utuh: nota yang dibatalkan tetap menyebut "Toko Berkah" saat
-- dibuka, hanya tidak lagi menunjuk baris master yang memang sudah tidak ada.
-- Tidak ada laporan maupun ekspor yang membaca supplier dari nota berstatus
-- `dibatalkan` — seluruhnya menyaring `status = 'aktif'` lebih dulu.
-- =========================================================

-- ---------------------------------------------------------
-- (1) SUPPLIER YANG DIHAPUS TIDAK BOLEH HIDUP KEMBALI SEKETIKA
--
-- ============ DITEMUKAN TESNYA, BUKAN DENGAN MEMIKIRKANNYA ============
--
-- Penghapusannya sendiri BERHASIL — barisnya hilang. Lalu satu baris
-- `suppliers` bernama sama muncul kembali dalam transaksi yang sama, dan
-- notanya tertaut lagi ke sana. Tesnya melaporkan "barisnya masih ada", dan
-- butuh instrumentasi untuk melihat bahwa itu bukan baris yang sama.
--
-- Rantainya:
--
--   1. `delete from suppliers`
--   2. FK `goods_receipts.supplier_id ... on delete set null` (0158) melakukan
--      UPDATE pada notanya.
--   3. UPDATE itu memicu trigger BEFORE UPDATE `tautkan_supplier_nota`.
--   4. Trigger melihat `supplier_id is null` dengan teks nama masih terisi,
--      lalu memanggil `cari_atau_buat_supplier` — yang MEMBUAT ULANG barisnya.
--
-- Tidak ada galat di satu langkah pun. Dari layar, yang terlihat adalah tombol
-- Hapus yang "tidak bekerja": ditekan, daftarnya dimuat ulang, namanya masih
-- di sana. Orang akan menekannya berkali-kali.
--
-- ============ PERBAIKANNYA SEKALIGUS MEMBETULKAN ARTINYA ============
--
-- Triggernya sekarang hanya membuat/menaut baris master untuk nota yang
-- `status = 'aktif'`. Itu bukan tambalan untuk menyelamatkan penghapusan —
-- itu aturan yang memang seharusnya sejak awal: DOKUMEN YANG DIBATALKAN BUKAN
-- ALASAN SEBUAH SUPPLIER ADA DI DAFTAR MASTER.
--
-- Nota aktif tetap tidak bisa kehilangan induknya lewat jalur ini, karena nota
-- aktif menahan penghapusannya sejak awal.
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
  --
  -- HANYA untuk nota yang aktif. Lihat alasan panjangnya di atas: tanpa
  -- syarat ini, menghapus supplier membangkitkannya kembali lewat FK
  -- `on delete set null` yang memicu trigger ini.
  if new.supplier_id is null
     and coalesce(new.status, 'aktif') = 'aktif'
     and coalesce(btrim(new.supplier), '') <> '' then
    new.supplier_id := cari_atau_buat_supplier(new.business_unit_id, new.supplier);
  end if;

  -- Lalu teksnya DITIMPA dari induknya. Klien tidak bisa membuat salinan ini
  -- berbeda dari sumbernya, bahkan kalau ia mengirim keduanya sekaligus.
  --
  -- Tetap berlaku untuk nota yang dibatalkan SELAMA induknya masih ada —
  -- supaya nama yang dibetulkan admin tetap menyebar ke dokumen lama. Begitu
  -- induknya dihapus, `supplier_id` jadi null dan blok ini dilewati, jadi teks
  -- namanya tertinggal apa adanya di dokumen itu. Itu yang diinginkan: jejaknya
  -- utuh, tautannya saja yang lepas.
  if new.supplier_id is not null then
    select nama into v_nama from suppliers where id = new.supplier_id;
    if v_nama is not null then new.supplier := v_nama; end if;
  end if;

  return new;
end;
$$;

revoke all on function tautkan_supplier_nota() from public;

-- ---------------------------------------------------------
-- (2) YANG DIHITUNG HANYA DOKUMEN YANG AKTIF
-- ---------------------------------------------------------
create or replace function hapus_supplier(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bu uuid;
  v_nama text;
  v_nota int;
  v_kas int;
  v_nota_batal int;
  v_kas_batal int;
begin
  select business_unit_id, nama into v_bu, v_nama from suppliers where id = p_id;
  if v_bu is null then
    raise exception 'Supplier tidak ditemukan.';
  end if;
  if not is_bu_admin(auth.uid(), v_bu) then
    raise exception 'Hanya Admin BU atau Super Admin yang bisa menghapus supplier.';
  end if;

  -- `status = 'aktif'` — ATURAN YANG SAMA dengan `nama_supplier_terpakai`
  -- (0144), yaitu angka yang ditampilkan layar Master Supplier. Keduanya harus
  -- menjawab pertanyaan yang sama dengan cara yang sama; kalau tidak, tombolnya
  -- muncul untuk sesuatu yang lalu ditolak.
  select count(*) into v_nota
    from goods_receipts
   where supplier_id = p_id
     and status = 'aktif';

  -- Yang dibatalkan dihitung TERPISAH — bukan untuk menahan, tapi untuk bisa
  -- disebut. Lihat alasannya di kalimat penolakan di bawah.
  select count(*) into v_nota_batal
    from goods_receipts
   where supplier_id = p_id
     and status <> 'aktif';

  -- `cash_entries.supplier` TEKS, bukan FK (0149), jadi dicocokkan lewat nama
  -- ternormalkan — aturan yang sama dengan indeks unik `suppliers`. Entri yang
  -- sudah DICORET (0141) tidak dihitung, sama seperti seluruh pembaca kas.
  select count(*) into v_kas
    from cash_entries c
   where coalesce(btrim(c.supplier), '') <> ''
     and c.dicoret_at is null
     and normal_nama_supplier(c.supplier) = normal_nama_supplier(v_nama);

  select count(*) into v_kas_batal
    from cash_entries c
   where coalesce(btrim(c.supplier), '') <> ''
     and c.dicoret_at is not null
     and normal_nama_supplier(c.supplier) = normal_nama_supplier(v_nama);

  if v_nota > 0 or v_kas > 0 then
    raise exception
      '"%" masih dipakai % nota dan % entri kas yang AKTIF, jadi tidak bisa dihapus. Kalau ini nama kembar, pakai Gabungkan supaya dokumennya pindah ke induk yang benar. Kalau supplier ini memang sudah tidak dipakai lagi, batalkan dulu dokumennya, atau nonaktifkan saja lewat Edit.',
      v_nama, v_nota, v_kas;
  end if;

  -- ============ YANG DIBATALKAN TIDAK MENAHAN, TAPI DISEBUT ============
  --
  -- Penghapusannya diteruskan. Tapi kalau ada dokumen batal yang menunjuk
  -- supplier ini, itu DIBERITAHUKAN lewat `notice` — bukan didiamkan.
  --
  -- Alasannya: `supplier_id` pada dokumen itu akan jadi NULL, dan walau nama
  -- teksnya tetap tertulis, itu perubahan yang pantas diketahui orang yang
  -- menekan tombolnya. Keputusan yang diam-diam mengubah sesuatu di tempat
  -- lain adalah keputusan yang baru terasa saat sudah tidak bisa ditarik.
  if v_nota_batal > 0 or v_kas_batal > 0 then
    raise notice 'Supplier "%" dihapus; % nota dan % entri kas yang sudah dibatalkan kehilangan tautannya, tapi namanya tetap tertulis di dokumen itu.',
      v_nama, v_nota_batal, v_kas_batal;
  end if;

  delete from suppliers where id = p_id;
end;
$$;

revoke all on function hapus_supplier(uuid) from public;
grant execute on function hapus_supplier(uuid) to authenticated;

comment on function hapus_supplier(uuid) is
  'Hapus satu supplier, HANYA kalau tidak dipakai nota/entri kas yang AKTIF. Dokumen yang dibatalkan (status <> aktif, dicoret_at) tidak menahan — aturan yang sama dengan nama_supplier_terpakai (0144) dan pembaca kas (0141).';

notify pgrst, 'reload schema';
