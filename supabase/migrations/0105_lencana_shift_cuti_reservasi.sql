-- =========================================================
-- Berjaya Hub OMS — 0105
-- Lencana Beranda putaran kedua: Shift, Pengajuan Cuti, Reservasi.
--
-- `lencana_beranda()` ditulis ULANG UTUH, bukan ditambal. Tipe kembaliannya
-- tidak berubah (jsonb), jadi `create or replace` aman — tidak ada 42P13
-- seperti yang menjatuhkan 0103.
--
-- =========================================================
-- SHIFT — "belum clock in", dan hanya kalau outletnya MEMANG pakai shift
-- =========================================================
--
-- Tidak ada kolom "mode shift" di mana pun. Yang menandai outlet memakai shift
-- adalah ADA-TIDAKNYA jam shift aktif di `outlet_shifts` — itulah satu-satunya
-- syarat yang membuat jadwal bisa disusun sama sekali.
--
-- Memakai penanda lain (mis. jumlah shift di `shift_settings`, yang punya
-- default 2 untuk SEMUA BU) akan menyalakan lencana di outlet yang tidak pernah
-- menyentuh modul shift — dan lencana yang tidak bisa dihilangkan adalah
-- lencana yang akan diabaikan, termasuk saat ia benar.
--
-- Lencananya PRIBADI: jadwal SAYA hari ini, dan apakah SAYA sudah clock in.
-- Berbeda dengan lencana lain yang menghitung pekerjaan outlet.
--
-- BATAS YANG DIKETAHUI: shift malam yang melewati tengah malam
-- (`crosses_midnight`) tetap dihitung menurut `work_date`-nya. Orang yang masuk
-- pukul 22:00 dan clock in pukul 22:05 sudah aman; yang clock in pukul 00:30
-- akan terhitung di hari berikutnya. Menanganinya menuntut menebak shift mana
-- yang sedang berjalan dari jam berapa sekarang, dan tebakan yang salah di situ
-- menghasilkan lencana yang menyala sepanjang malam.
--
-- =========================================================
-- PENGAJUAN CUTI — kabar, bukan pekerjaan
-- =========================================================
--
-- Menyetujui cuti hanya ada di Admin Portal, jadi di Staff App tidak ada
-- pekerjaan yang menunggu di kartu ini. Yang ada cuma kabar: "pengajuanmu sudah
-- diputus".
--
-- Karena itu yang dikirim HANYA `terakhir_aktivitas`, dan jumlahnya selalu 0 —
-- kartunya bertitik biru, bukan berangka merah. Memaksakan angka merah untuk
-- sesuatu yang tidak bisa "dikerjakan" akan membuat merah kehilangan artinya.
--
-- `terakhir_aktivitas` diambil dari `reviewed_at`, BUKAN `created_at`: yang jadi
-- kabar adalah KEPUTUSANNYA. Kalau dipakai `created_at`, mengajukan cuti sendiri
-- akan menyalakan titik biru untuk diri sendiri.
--
-- =========================================================
-- RESERVASI — hari ini + yang belum diputus
-- =========================================================
--
-- Dua hal berbeda yang sengaja dijumlahkan jadi satu angka:
--
--   hari_ini         reservasi HARI INI yang masih aktif (pending/confirmed)
--                    -> yang perlu disiapkan mejanya
--   menunggu_putusan reservasi PENDING untuk hari lain
--                    -> yang perlu dikonfirmasi/ditolak
--
-- Keduanya tidak tumpang tindih: yang pending hari ini masuk `hari_ini`, dan
-- `menunggu_putusan` sengaja mengecualikan hari ini. Tanpa pengecualian itu,
-- satu reservasi terhitung dua kali dan angkanya tidak pernah bisa dicocokkan
-- dengan apa pun di layar.
--
-- Reservasi yang tanggalnya SUDAH LEWAT tapi masih pending TIDAK dihitung.
-- Ia tidak bisa lagi "disiapkan", dan menyalakannya berarti lencana yang tidak
-- akan pernah padam sampai seseorang membereskan data lama.
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

  v_pakai_shift boolean := false;
  v_shift_belum int := 0;
  v_resv_hari_ini int := 0;
  v_resv_putusan int := 0;

  v_akt_dispatch timestamptz;
  v_akt_inventory timestamptz;
  v_akt_checklist timestamptz;
  v_akt_sales timestamptz;
  v_akt_shift timestamptz;
  v_akt_leave timestamptz;
  v_akt_resv timestamptz;
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  if p_outlet is null then return '{}'::jsonb; end if;

  -- `security definer` mematikan RLS. Tanpa pemeriksaan ini siapa pun bisa
  -- membaca keadaan operasional outlet mana pun sekadar dengan menebak id-nya.
  if not has_outlet_scope(v_uid, p_outlet) then
    return '{}'::jsonb;
  end if;

  select outlet_role into v_role from outlets where id = p_outlet;

  -- ---------------------------------------------------------
  -- PENGIRIMAN
  -- ---------------------------------------------------------
  select count(*) into v_kiriman
    from dispatches where to_outlet_id = p_outlet and status = 'sent';

  if v_role = 'central_kitchen' then
    select count(*) into v_order
      from stock_orders where to_outlet_id = p_outlet and status = 'open';
    select count(*) into v_draft
      from dispatches where from_outlet_id = p_outlet and status = 'draft';
  end if;

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
  select count(*) into v_minus
    from stock_balances where outlet_id = p_outlet and qty < 0;

  select max(created_at) into v_akt_inventory
    from stock_movements where outlet_id = p_outlet;

  -- ---------------------------------------------------------
  -- DAILY ACTIVITIES — item hari ini yang belum dicentang
  -- ---------------------------------------------------------
  select count(*) into v_aktivitas
    from checklist_run_items ri
    join checklist_runs r on r.id = ri.run_id
   where r.outlet_id = p_outlet and r.run_date = v_hari and ri.checked = false;

  select exists (
    select 1 from checklist_runs where outlet_id = p_outlet and run_date = v_hari
  ) into v_ada_sesi;

  select max(created_at) into v_akt_checklist
    from checklist_runs where outlet_id = p_outlet;

  -- ---------------------------------------------------------
  -- PENJUALAN — belum ada input hari ini
  -- ---------------------------------------------------------
  if coalesce(v_role, 'standalone') <> 'central_kitchen' then
    if not exists (select 1 from sales where outlet_id = p_outlet and sale_date = v_hari) then
      v_penjualan := 1;
    end if;
  end if;

  select max(created_at) into v_akt_sales
    from sales where outlet_id = p_outlet;

  -- ---------------------------------------------------------
  -- SHIFT — jadwal SAYA hari ini yang belum di-clock-in
  -- ---------------------------------------------------------
  -- Syarat pertama: outletnya memang memakai shift. Lihat kepala berkas.
  select exists (
    select 1 from outlet_shifts where outlet_id = p_outlet and is_active
  ) into v_pakai_shift;

  if v_pakai_shift then
    select count(*) into v_shift_belum
      from shift_schedules s
     where s.outlet_id = p_outlet
       and s.user_id = v_uid
       and s.work_date = v_hari
       -- Hari libur yang dijadwalkan bukan pekerjaan. Tanpa ini, orang yang
       -- justru sedang libur akan dilencanai "belum clock in".
       --
       -- Kedua baris ini SALING MENGGANTIKAN, dan itu disengaja: constraint
       -- `shift_or_off` di 0034 sudah menjamin libur selalu ber-shift_id null,
       -- jadi menghapus salah satunya tidak mengubah hasil apa pun. Sabotase
       -- membuktikan itu — masing-masing sendirian tetap benar.
       --
       -- Dipertahankan berdua karena keduanya menyatakan maksud yang berbeda:
       -- "bukan hari libur" dan "punya shift". Kalau suatu saat constraint-nya
       -- dilonggarkan, yang tersisa di sini tetap menahan.
       and s.is_off = false
       and s.shift_id is not null
       and not exists (
         select 1 from attendance_records a
          where a.user_id = v_uid
            and a.outlet_id = p_outlet
            and (a.clock_in_at at time zone 'Asia/Jakarta')::date = v_hari
       );
  end if;

  select max(updated_at) into v_akt_shift
    from shift_schedules where outlet_id = p_outlet and user_id = v_uid;

  -- ---------------------------------------------------------
  -- PENGAJUAN CUTI — hanya kabar, tanpa angka
  -- ---------------------------------------------------------
  -- `reviewed_at`, bukan `created_at`. Lihat kepala berkas.
  select max(reviewed_at) into v_akt_leave
    from leave_requests
   where user_id = v_uid and reviewed_at is not null;

  -- ---------------------------------------------------------
  -- RESERVASI
  -- ---------------------------------------------------------
  select count(*) into v_resv_hari_ini
    from reservations
   where outlet_id = p_outlet
     and reserve_date = v_hari
     and status in ('pending', 'confirmed');

  select count(*) into v_resv_putusan
    from reservations
   where outlet_id = p_outlet
     and status = 'pending'
     -- Hari ini sudah dihitung di atas; tanpa pengecualian ini satu reservasi
     -- terhitung dua kali. Yang sudah lewat tidak dihitung sama sekali —
     -- lihat kepala berkas.
     and reserve_date > v_hari;

  select max(created_at) into v_akt_resv
    from reservations where outlet_id = p_outlet;

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
        'terakhir_aktivitas', v_akt_inventory,
        'jumlah', v_minus,
        'jenis', 'angka',
        'rincian', jsonb_build_object('stok_minus', v_minus)
      ),
      'cleaning_checklist', jsonb_build_object(
        'terakhir_aktivitas', v_akt_checklist,
        'jumlah', v_aktivitas,
        'jenis', 'angka',
        'rincian', jsonb_build_object('belum_dicentang', v_aktivitas, 'ada_sesi_hari_ini', v_ada_sesi)
      ),
      'sales', jsonb_build_object(
        'terakhir_aktivitas', v_akt_sales,
        'jumlah', v_penjualan,
        'jenis', 'seru',
        'rincian', jsonb_build_object('belum_input_hari_ini', v_penjualan = 1)
      ),
      'shift', jsonb_build_object(
        'terakhir_aktivitas', v_akt_shift,
        'jumlah', v_shift_belum,
        -- 'seru', bukan angka: seorang staff punya paling banyak SATU shift
        -- sehari (unique outlet+user+tanggal), jadi angkanya selalu 0 atau 1.
        -- "1" akan terbaca "ada 1 pekerjaan", padahal artinya "kamu belum
        -- clock in".
        'jenis', 'seru',
        'rincian', jsonb_build_object('pakai_shift', v_pakai_shift, 'belum_clock_in', v_shift_belum = 1)
      ),
      'leave', jsonb_build_object(
        'terakhir_aktivitas', v_akt_leave,
        -- SELALU 0. Tidak ada pekerjaan cuti yang menunggu di Staff App —
        -- yang ada cuma kabar, dan kabar memakai titik biru.
        'jumlah', 0,
        'jenis', 'angka',
        'rincian', jsonb_build_object('hanya_kabar', true)
      ),
      'reservation', jsonb_build_object(
        'terakhir_aktivitas', v_akt_resv,
        'jumlah', v_resv_hari_ini + v_resv_putusan,
        'jenis', 'angka',
        'rincian', jsonb_build_object('hari_ini', v_resv_hari_ini, 'menunggu_putusan', v_resv_putusan)
      )
    )
  );
end;
$$;

revoke all on function lencana_beranda(uuid, uuid) from public;
grant execute on function lencana_beranda(uuid, uuid) to authenticated;

comment on function lencana_beranda(uuid, uuid) is
  'Pekerjaan TERTUNDA per modul untuk satu outlet, dalam satu perjalanan. Shift & cuti bersifat pribadi (milik akun yang memanggil); sisanya milik outlet. Lencana hilang saat pekerjaannya selesai, bukan saat kartunya dibuka.';

notify pgrst, 'reload schema';
