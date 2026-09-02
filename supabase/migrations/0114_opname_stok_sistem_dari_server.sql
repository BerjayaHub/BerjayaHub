-- =========================================================
-- Berjaya Hub OMS — 0114
-- Stok sistem pada opname DIBACA SERVER, bukan dikirim layar.
--
-- =========================================================
-- BUG YANG DILAPORKAN
-- =========================================================
--
--   "stock nanas ada 6000 sekian, lalu saya sesuaikan menjadi 4600 sekian,
--    tetapi di jumlah stock di bahan malah menjadi 11000"
--
-- 6.400 + 4.600 = 11.000. Penyesuaiannya ditulis +4.600, bukan -1.800 — jadi
-- `system_qty` yang tersimpan bernilai NOL, bukan 6.400.
--
-- =========================================================
-- KENAPA BISA NOL
-- =========================================================
--
-- `catat_hitungan_opname` (0085) menerima `p_system` SEBAGAI PARAMETER, dan
-- layar mengirimkannya dari peta stok yang dimuat SAAT HALAMAN DIBUKA:
--
--     isian.push({ pid, counted: Number(raw), sys: stockMap.get(pid) ?? 0 });
--
-- Peta itu bisa basi berjam-jam. Cukup halaman Bahan dibuka sebelum stoknya
-- berubah — misalnya sebelum opname sebelumnya ditutup, atau sebelum nota
-- penerimaan diinput — dan `stockMap` masih memegang angka lama. Untuk bahan
-- yang saat itu belum punya pergerakan sama sekali, yang terkirim adalah NOL.
--
-- Lalu penutupan sesi menghitung `counted_qty - system_qty` = 4.600 - 0, dan
-- menuliskannya sebagai penyesuaian POSITIF di atas stok yang sudah 6.400.
--
-- Tidak ada error di mana pun. Layar menulis "hitungan tersimpan", sesi
-- ditutup dengan sukses, dan angkanya baru terlihat salah saat seseorang
-- membuka daftar stok.
--
-- =========================================================
-- LAYAR TIDAK BOLEH JADI SUMBER ANGKA INI
-- =========================================================
--
-- Perbaikan sebelumnya menolak menyimpan saat peta stoknya HILANG (null).
-- Itu benar tapi tidak cukup: peta yang BASI tidak null — ia berisi angka,
-- angka yang salah, dan tidak ada cara membedakannya dari yang segar.
--
-- Satu-satunya perbaikan yang menutup seluruh kelasnya: `system_qty` dibaca
-- SERVER dari `stock_balances` pada detik hitungannya disimpan. Layar tidak
-- lagi punya suara dalam angka itu, jadi seberapa pun basinya peta di HP, ia
-- tidak bisa merusak apa pun.
--
-- Ini juga LEBIH sezaman daripada sebelumnya, bukan kurang: yang dulu dipakai
-- adalah keadaan saat HALAMAN DIBUKA; yang sekarang keadaan saat TOMBOL
-- SIMPAN DITEKAN. Kekhawatiran 0085 — "barang masuk di tengah sesi" — tetap
-- tertangani, karena tiap penyimpanan menyegarkan potretnya.
--
-- =========================================================
-- PARAMETERNYA DIPERTAHANKAN, TAPI DIABAIKAN
-- =========================================================
--
-- `p_system` tetap ada di tanda tangan fungsinya. Membuangnya akan mengubah
-- tanda tangan, dan PWA lama yang masih ter-cache di HP staff akan gagal
-- dengan "function does not exist" — pesan yang tidak mengatakan apa pun
-- kepada orang yang sedang berdiri di depan rak.
--
-- Dengan dipertahankan-tapi-diabaikan, PWA lama tetap jalan DAN langsung
-- ikut benar: angka basi yang ia kirim tidak dipakai sama sekali.
-- =========================================================

create or replace function catat_hitungan_opname(
  p_count uuid,
  p_product uuid,
  p_counted numeric,
  p_system numeric default null,
  p_notes text default null
) returns void
language plpgsql
as $$
declare
  v_status text;
  v_outlet uuid;
  v_sistem numeric;
  v_lama stock_count_items%rowtype;
begin
  select status, outlet_id into v_status, v_outlet from stock_counts where id = p_count;
  if v_status is null then raise exception 'Sesi opname tidak ditemukan.'; end if;
  if v_status <> 'open' then raise exception 'Opname ini sudah ditutup — buka sesi baru untuk menghitung ulang.'; end if;
  if p_counted is null or p_counted < 0 then raise exception 'Jumlah hitungan tidak sah.'; end if;

  -- POTRET SISTEM DIBACA DI SINI, SEKARANG.
  --
  -- `p_system` dari layar SENGAJA TIDAK DIPAKAI — lihat alasan panjangnya di
  -- kepala berkas. Ia masih diterima hanya supaya PWA lama tidak gagal.
  --
  -- `coalesce(..., 0)` di sini SAH dan artinya berbeda dari nol yang bikin
  -- bug: produk yang belum pernah punya satu pun pergerakan memang tidak
  -- punya baris di `stock_balances`, dan stoknya memang nol. Yang tidak sah
  -- adalah angka nol yang datang dari peta basi milik layar.
  select coalesce(sum(sm.qty_delta), 0) into v_sistem
    from stock_movements sm
   where sm.outlet_id = v_outlet
     and sm.product_id = p_product;

  select * into v_lama from stock_count_items where count_id = p_count and product_id = p_product;

  if v_lama.id is null then
    insert into stock_count_items (count_id, product_id, system_qty, counted_qty, counted_by, notes)
    values (p_count, p_product, v_sistem, p_counted, auth.uid(), nullif(p_notes, ''));
  else
    update stock_count_items
    set counted_qty = p_counted,
        -- POTRET SISTEM IKUT DIPERBARUI setiap kali dihitung ulang.
        --
        -- Alasannya sama dengan 0085: penyesuaiannya nanti dihitung SELISIH
        -- (`dihitung - sistem`), jadi selama potretnya sezaman dengan
        -- hitungannya, hasilnya tetap benar walau stok bergerak sesudahnya.
        -- Dihitung 92 saat sistem 100 -> -8; lalu masuk nota 50 (stok 150);
        -- penutupan menghasilkan 142, dan itu memang benar.
        system_qty = v_sistem,
        counted_by = auth.uid(),
        counted_at = now(),
        notes = nullif(p_notes, ''),
        sebelumnya = case
          when v_lama.counted_qty is distinct from p_counted
          then sebelumnya || jsonb_build_object('qty', v_lama.counted_qty, 'by', v_lama.counted_by, 'at', v_lama.counted_at)
          else sebelumnya
        end
    where count_id = p_count and product_id = p_product;
  end if;
end;
$$;

-- ---------------------------------------------------------
-- ALAT PERIKSA: sesi terbuka yang potret sistemnya sudah BASI.
--
-- Untuk sesi yang tersimpan SEBELUM migration ini, `system_qty`-nya bisa saja
-- angka basi dari layar. Menutupnya akan menghasilkan penyesuaian yang salah,
-- persis seperti kasus nanas.
--
-- Fungsi ini TIDAK memperbaiki apa pun — ia hanya menunjukkan barisnya, supaya
-- bisa diperiksa dan disimpan ulang lebih dulu. Memperbaiki otomatis berarti
-- menebak, dan tebakan pada angka stok adalah hal yang paling tidak boleh
-- dikerjakan diam-diam.
-- ---------------------------------------------------------
create or replace function opname_potret_basi(p_count uuid)
returns table (
  product_id uuid,
  nama text,
  system_tersimpan numeric,
  system_sebenarnya numeric,
  counted_qty numeric,
  selisih_jika_ditutup_sekarang numeric,
  selisih_seharusnya numeric
)
language sql
stable
as $$
  select i.product_id,
         p.name,
         i.system_qty,
         coalesce(b.qty, 0),
         i.counted_qty,
         i.counted_qty - i.system_qty,
         i.counted_qty - coalesce(b.qty, 0)
    from stock_count_items i
    join stock_counts c on c.id = i.count_id
    join products p on p.id = i.product_id
    left join (
      select outlet_id, product_id, sum(qty_delta) qty
        from stock_movements group by outlet_id, product_id
    ) b on b.outlet_id = c.outlet_id and b.product_id = i.product_id
   where i.count_id = p_count
     and i.system_qty is distinct from coalesce(b.qty, 0)
   order by p.name;
$$;

revoke all on function opname_potret_basi(uuid) from public;
grant execute on function opname_potret_basi(uuid) to authenticated;

comment on function catat_hitungan_opname(uuid, uuid, numeric, numeric, text) is
  'Catat satu hitungan opname. system_qty DIBACA SERVER dari stock_movements saat disimpan — parameter p_system diabaikan (dipertahankan hanya agar PWA lama tidak gagal).';
comment on function opname_potret_basi(uuid) is
  'Baris sebuah sesi opname yang system_qty tersimpannya sudah tidak cocok dengan stok sebenarnya. Tidak memperbaiki apa pun; hanya menunjukkan.';

notify pgrst, 'reload schema';
