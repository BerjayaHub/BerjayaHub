-- =========================================================
-- Berjaya Hub OMS — 0137
-- Saldo stok PADA SEBUAH TANGGAL — dasar stok awal & akhir di laporan COGS.
--
-- =========================================================
-- BUG YANG MELAHIRKANNYA
-- =========================================================
--
-- Versi pertama laporan COGS memakai NILAI SATU SESI OPNAME sebagai stok
-- akhir. Itu keliru, dan kekeliruannya baru terlihat di angka:
--
--   "stock akhir jangan diambil dari hasil opname yang paling akhir, tetapi
--    semua sesi opname di bulan itu, karena ada case, perbaikan opname ...
--    jika ada salah jumlah bahan, saya akan buka sesi opname lagi, dan yang
--    terisi hanya bahan yang salah saja, jadi nominalnya akan sangat kecil"
--
-- Sebuah sesi opname hanya berisi bahan yang DIHITUNG DI SESI ITU. Sesi
-- perbaikan berisi satu bahan, dan nilainya Rp54.701 — dipakai sebagai "nilai
-- seluruh stok outlet", angkanya salah beberapa ratus kali lipat. Laporannya
-- tetap tercetak rapi.
--
-- Menggabungkan seluruh sesi dalam periode memperbaiki kasus itu, tapi tidak
-- kasus yang lebih umum: bahan yang TIDAK PERNAH dihitung bulan itu tetap
-- bernilai nol.
--
-- =========================================================
-- SALDO SUDAH PUNYA BENTUK YANG BENAR DI REPO INI
-- =========================================================
--
-- `stock_balances` (0018) adalah:
--
--   select business_unit_id, outlet_id, product_id, sum(qty_delta)
--     from stock_movements group by 1,2,3;
--
-- Yang kurang cuma BATAS TANGGALNYA. Dan karena menutup opname MENULIS
-- penyesuaian ke `stock_movements`, hasil tiap opname — termasuk sesi
-- perbaikan — sudah otomatis ikut terhitung, tanpa perlu membaca sesinya sama
-- sekali. Bahan yang tidak pernah dihitung tetap membawa saldo terakhirnya.
--
-- Jadi fungsi ini BUKAN sumber kebenaran baru; ia `stock_balances` yang sama,
-- dilihat pada satu titik waktu.
--
-- =========================================================
-- BATASNYA WIB, BUKAN UTC
-- =========================================================
--
-- `created_at` adalah timestamptz. "Sampai akhir 12 September" berarti sampai
-- 12 Sep 23:59:59 WIB — bukan UTC. Selisih tujuh jamnya memindahkan seluruh
-- pergerakan sore hari ke tanggal berikutnya, dan stok akhir bulan jadi tidak
-- memuat pembelian sore tanggal terakhir. Angkanya tetap wajar dibaca.
-- =========================================================

create or replace function saldo_stok_pada(
  p_bu uuid,
  p_tanggal date,
  p_outlet uuid default null
)
returns table (outlet_id uuid, product_id uuid, qty numeric)
language sql
stable
-- `security invoker`, BUKAN definer.
--
-- Sengaja: `stock_balances` pun invoker (0018), jadi RLS `stock_movements`
-- tetap berlaku dan fungsi ini tidak bisa dipakai membaca stok BU yang bukan
-- hak pemanggilnya. Tidak ada alasan untuk melonggarkannya — laporan ini
-- selalu dipanggil oleh orang yang memang sudah berhak atas BU-nya.
security invoker
set search_path = public
as $$
  select sm.outlet_id, sm.product_id, sum(sm.qty_delta) as qty
    from stock_movements sm
   where sm.business_unit_id = p_bu
     and (p_outlet is null or sm.outlet_id = p_outlet)
     and sm.created_at < (((p_tanggal + 1)::timestamp) at time zone 'Asia/Jakarta')
   group by sm.outlet_id, sm.product_id
  -- Saldo NOL dibuang: ia menyumbang nol ke nilai apa pun, dan membawanya
  -- berarti mengirim ratusan baris kosong untuk tiap outlet. Saldo NEGATIF
  -- TETAP DIBAWA — stok boleh menembus nol di aplikasi ini (0020/0134), dan
  -- membuangnya akan membuat nilai stok lebih besar daripada kenyataannya.
  having sum(sm.qty_delta) <> 0;
$$;

revoke all on function saldo_stok_pada(uuid, date, uuid) from public;
grant execute on function saldo_stok_pada(uuid, date, uuid) to authenticated;

comment on function saldo_stok_pada(uuid, date, uuid) is
  'stock_balances (0018) pada satu titik waktu. Batasnya akhir hari WIB. Dipakai laporan COGS sebagai stok awal & akhir — hasil opname sudah ikut karena menutup opname menulis penyesuaian ke stock_movements.';

-- ---------------------------------------------------------
-- Laporkan hasilnya.
-- ---------------------------------------------------------
do $$
declare
  v_ada boolean;
begin
  select exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'saldo_stok_pada'
  ) into v_ada;
  raise notice 'fungsi saldo_stok_pada terpasang: %', v_ada;
  if not v_ada then
    raise exception 'saldo_stok_pada TIDAK terbuat — laporan COGS tidak akan punya stok awal/akhir.';
  end if;
end $$;
