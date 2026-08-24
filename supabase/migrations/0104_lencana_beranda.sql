-- =========================================================
-- Berjaya Hub OMS — 0104
-- Lencana Beranda: berapa pekerjaan yang MENUNGGU di tiap modul.
--
-- =========================================================
-- KENAPA SATU RPC, BUKAN SEBELAS QUERY
-- =========================================================
--
-- Beranda Staff punya sebelas kartu. Menghitung lencananya satu per satu
-- berarti sebelas permintaan jaringan setiap kali beranda dibuka — di ponsel
-- dengan sinyal seadanya, sebagian akan tertunda lama dan kartunya menampilkan
-- angka pada waktu yang berbeda-beda. Yang terlihat: beranda "berkedip-kedip".
--
-- Satu RPC, satu perjalanan. Dan karena semua hitungan lahir dari satu
-- transaksi, angkanya konsisten satu sama lain — bukan potret sebelas momen
-- yang berbeda.
--
-- =========================================================
-- YANG DIHITUNG: PEKERJAAN TERTUNDA, BUKAN "ADA YANG BARU"
-- =========================================================
--
-- Lencana merah di sini SELALU berarti "ada yang menunggu kamu kerjakan", dan
-- ia hilang ketika pekerjaannya selesai — BUKAN ketika kartunya dibuka.
--
-- Bedanya menentukan. Lencana yang hilang saat dibuka akan lenyap ketika staff
-- membuka Pengiriman, melihat tiga kiriman perlu dikonfirmasi, lalu keburu
-- dipanggil tamu. Besoknya tidak ada lagi yang mengingatkan, dan tiga kiriman
-- itu menggantung tanpa satu pun tanda.
--
-- Penanda "ada yang baru sejak terakhir dibuka" tetap ada, tapi ia dikerjakan
-- di sisi klien (`js/core/lencana.js`) dan sengaja dibedakan bentuknya: titik
-- kecil, bukan angka.
--
-- =========================================================
-- SCOPE DIPERIKSA EKSPLISIT
-- =========================================================
--
-- `security definer` mematikan RLS, jadi tanpa pemeriksaan ini siapa pun bisa
-- membaca jumlah pekerjaan outlet mana pun sekadar dengan menebak id-nya.
-- Angka itu sendiri sudah membocorkan keadaan operasional — berapa kiriman
-- menggantung, berapa bahan minus.
-- =========================================================

create or replace function lencana_beranda(p_bu uuid, p_outlet uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_hari date := (now() at time zone 'Asia/Jakarta')::date;

  v_kiriman int := 0;
  v_order int := 0;
  v_draft int := 0;
  v_minus int := 0;
  v_aktivitas int := 0;
  v_ada_sesi boolean := false;
  v_penjualan int := 0;

  -- Waktu aktivitas TERBARU tiap modul. Dipakai klien untuk titik biru
  -- "ada yang baru sejak terakhir kamu buka" — perbandingannya dikerjakan di
  -- sisi klien karena "terakhir dibuka" memang milik perangkat, bukan server.
  v_akt_dispatch timestamptz;
  v_akt_inventory timestamptz;
  v_akt_checklist timestamptz;
  v_akt_sales timestamptz;
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  if p_outlet is null then return '{}'::jsonb; end if;

  -- Lihat kepala berkas. Dipakai `has_outlet_scope`, bukan `has_bu_scope`:
  -- lencana ini menjawab "apa yang menunggu DI OUTLET TEMPAT SAYA BEKERJA",
  -- dan staff outlet A tidak perlu tahu tumpukan pekerjaan outlet B.
  if not has_outlet_scope(v_uid, p_outlet) then
    return '{}'::jsonb;
  end if;

  select outlet_role into v_role from outlets where id = p_outlet;

  -- ---------------------------------------------------------
  -- PENGIRIMAN
  -- ---------------------------------------------------------
  -- Kiriman masuk yang belum dikonfirmasi. Ini yang paling mahal kalau
  -- terlewat: sejak 0103 stok baru bergeser saat dikonfirmasi, jadi kiriman
  -- yang menggantung berarti stok kedua outlet salah sekaligus.
  select count(*) into v_kiriman
    from dispatches
   where to_outlet_id = p_outlet and status = 'sent';

  -- Hanya untuk CK: order yang menunggu disiapkan, dan draft yang sudah
  -- disiapkan tapi belum berangkat.
  if v_role = 'central_kitchen' then
    select count(*) into v_order
      from stock_orders
     where to_outlet_id = p_outlet and status = 'open';

    select count(*) into v_draft
      from dispatches
     where from_outlet_id = p_outlet and status = 'draft';
  end if;

  -- Aktivitas terbaru: kiriman apa pun yang menyentuh outlet ini, dari arah
  -- mana pun. Yang dicari "apakah ada yang berubah", bukan "apakah ada
  -- kerjaan" — jadi kiriman yang sudah selesai pun tetap dihitung sebagai kabar.
  select greatest(
           coalesce(max(d.created_at), 'epoch'::timestamptz),
           coalesce(max(d.sent_at), 'epoch'::timestamptz),
           coalesce(max(d.received_at), 'epoch'::timestamptz)
         ) into v_akt_dispatch
    from dispatches d
   where d.to_outlet_id = p_outlet or d.from_outlet_id = p_outlet;

  -- ---------------------------------------------------------
  -- BAHAN — stok minus
  -- ---------------------------------------------------------
  -- Saldo minus BUKAN sekadar angka janggal: sistem ini memang mengizinkan
  -- produksi & penjualan menembus stok, jadi minus berarti yang tercatat masuk
  -- lebih sedikit daripada yang benar-benar dipakai. Hampir selalu karena
  -- penerimaan barang atau opname belum diisi.
  select count(*) into v_minus
    from stock_balances
   where outlet_id = p_outlet and qty < 0;

  select max(created_at) into v_akt_inventory
    from stock_movements where outlet_id = p_outlet;

  -- ---------------------------------------------------------
  -- DAILY ACTIVITIES — item hari ini yang belum dicentang
  -- ---------------------------------------------------------
  -- Dihitung dari run yang SUDAH DIBUAT hari ini. Item dari sesi yang belum
  -- dibuka sama sekali TIDAK dihitung — menghitungnya menuntut tahu sesi mana
  -- yang seharusnya jalan hari ini di outlet ini, dan tebakan yang salah di
  -- situ menghasilkan lencana yang tidak pernah bisa dihilangkan.
  --
  -- Batas ini nyata: outlet yang belum membuka satu pun sesi hari ini tidak
  -- akan berlencana. Yang menjaganya adalah `ada_sesi` di bawah, yang dipakai
  -- layar untuk menampilkan titik biru "belum mulai" alih-alih diam.
  select count(*) into v_aktivitas
    from checklist_run_items ri
    join checklist_runs r on r.id = ri.run_id
   where r.outlet_id = p_outlet
     and r.run_date = v_hari
     and ri.checked = false;

  select exists (
    select 1 from checklist_runs where outlet_id = p_outlet and run_date = v_hari
  ) into v_ada_sesi;

  select max(created_at) into v_akt_checklist
    from checklist_runs where outlet_id = p_outlet;

  -- ---------------------------------------------------------
  -- PENJUALAN — belum ada input hari ini
  -- ---------------------------------------------------------
  -- Ini satu-satunya lencana yang BUKAN hitungan pekerjaan, melainkan
  -- ketiadaan. Karena itu jenisnya 'seru' (tanda !), bukan angka: "1" di kartu
  -- Penjualan akan terbaca sebagai "ada 1 penjualan menunggu", padahal artinya
  -- justru belum ada apa-apa.
  --
  -- Hanya untuk outlet yang memang berjualan.
  if coalesce(v_role, 'standalone') <> 'central_kitchen' then
    if not exists (select 1 from sales where outlet_id = p_outlet and sale_date = v_hari) then
      v_penjualan := 1;
    end if;
  end if;

  select max(created_at) into v_akt_sales
    from sales where outlet_id = p_outlet;

  return jsonb_build_object(
    'dihitung_pada', now(),
    'outlet_id', p_outlet,
    'modul', jsonb_build_object(
      'dispatch', jsonb_build_object(
        'terakhir_aktivitas', nullif(v_akt_dispatch, 'epoch'::timestamptz),
        'jumlah', v_kiriman + v_order + v_draft,
        'jenis', 'angka',
        'rincian', jsonb_build_object('kiriman_masuk', v_kiriman, 'order_masuk', v_order, 'draft', v_draft)
      ),
      'inventory', jsonb_build_object(
        'terakhir_aktivitas', nullif(v_akt_inventory, 'epoch'::timestamptz),
        'jumlah', v_minus,
        'jenis', 'angka',
        'rincian', jsonb_build_object('stok_minus', v_minus)
      ),
      'cleaning_checklist', jsonb_build_object(
        'terakhir_aktivitas', nullif(v_akt_checklist, 'epoch'::timestamptz),
        'jumlah', v_aktivitas,
        'jenis', 'angka',
        'rincian', jsonb_build_object('belum_dicentang', v_aktivitas, 'ada_sesi_hari_ini', v_ada_sesi)
      ),
      'sales', jsonb_build_object(
        'terakhir_aktivitas', nullif(v_akt_sales, 'epoch'::timestamptz),
        'jumlah', v_penjualan,
        'jenis', 'seru',
        'rincian', jsonb_build_object('belum_input_hari_ini', v_penjualan = 1)
      )
    )
  );
end;
$$;

revoke all on function lencana_beranda(uuid, uuid) from public;
grant execute on function lencana_beranda(uuid, uuid) to authenticated;

comment on function lencana_beranda(uuid, uuid) is
  'Jumlah pekerjaan TERTUNDA per modul untuk satu outlet, dalam satu perjalanan. Lencana hilang saat pekerjaannya selesai, bukan saat kartunya dibuka.';

notify pgrst, 'reload schema';
