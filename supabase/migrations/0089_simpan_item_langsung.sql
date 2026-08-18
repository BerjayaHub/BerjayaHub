-- =========================================================
-- 0089 — Daily Activities: simpan per item, bukan sekali di akhir
--
-- ============ KENAPA ============
--
-- Rekaman layar dari lapangan menunjukkan yang sebenarnya terjadi: sesudah
-- memotret satu item, Android MEMBUANG halaman ini dari memori (aplikasi
-- kamera butuh banyak RAM dan halaman web yang di latar belakang adalah yang
-- pertama dikorbankan). Halamannya dimuat ulang, dan semua yang baru ada di
-- memori — centang dan foto — hilang.
--
-- Mengecilkan foto lebih awal mengurangi pemicunya, tapi TIDAK menghapusnya.
-- Selama pekerjaan baru dikirim di akhir, akan selalu ada jendela waktu di
-- mana pekerjaan yang sudah dilakukan bisa lenyap tanpa jejak. Yang menutup
-- jendela itu bukan menghemat memori, melainkan TIDAK MENUNGGU.
--
-- Jadi: satu item yang dicentang dan difoto langsung tersimpan.
--
-- ============ YANG DIBUTUHKAN DARI DATABASE ============
--
-- Hanya satu hal: cara mendapatkan run hari itu yang AMAN DARI BALAPAN.
--
-- `checklist_runs` punya `unique (outlet_id, session_id, run_date)` — satu
-- sesi hanya boleh punya satu run per hari. Dengan penyimpanan per item, run
-- itu bisa diminta oleh dua orang pada detik yang sama (dua staff memotret
-- bersamaan di outlet yang sama, hal yang justru wajar saat buka toko).
--
-- Pola "cek dulu, lalu insert" di sisi aplikasi PASTI kalah di situ: keduanya
-- membaca "belum ada", keduanya menyisipkan, satu ditolak dengan
-- *"duplicate key value violates unique constraint"* — pesan yang tidak
-- berarti apa-apa bagi orang yang sedang memegang alat pel, dan yang membuat
-- fotonya hilang lagi.
--
-- `insert ... on conflict do nothing` lalu `select` menyelesaikannya di satu
-- tempat: siapa pun yang kalah balapan tetap mendapat run yang sama.
--
-- SECURITY INVOKER (default, TIDAK diubah): RLS harus tetap berlaku, supaya
-- perbaikan wewenang di 0088 benar-benar yang menentukan siapa boleh memulai
-- sesi. Kalau fungsi ini dibuat SECURITY DEFINER, ia akan diam-diam
-- membatalkan penjaga itu.
-- =========================================================

create or replace function pastikan_run_aktivitas(
  p_outlet uuid,
  p_session uuid,
  p_notes text default null
)
returns uuid
language plpgsql
as $$
declare
  v_bu uuid;
  v_id uuid;
  v_tgl date := (now() at time zone 'Asia/Jakarta')::date;
begin
  select business_unit_id into v_bu from outlets where id = p_outlet;
  if v_bu is null then raise exception 'Outlet tidak dikenal.'; end if;

  -- Dicoba baca DULU. Jalur ini yang paling sering dipakai: run-nya biasanya
  -- sudah dibuat oleh item pertama, dan item kedua sampai kesepuluh cuma
  -- perlu menemukannya.
  select id into v_id
  from checklist_runs
  where outlet_id = p_outlet and session_id = p_session and run_date = v_tgl;
  if v_id is not null then return v_id; end if;

  insert into checklist_runs (business_unit_id, outlet_id, session_id, run_date, user_id, notes)
  values (v_bu, p_outlet, p_session, v_tgl, auth.uid(), nullif(p_notes, ''))
  on conflict (outlet_id, session_id, run_date) do nothing
  returning id into v_id;

  if v_id is not null then return v_id; end if;

  -- Kalah balapan: orang lain menyisipkan lebih dulu di antara SELECT dan
  -- INSERT di atas. Yang benar bukan melempar error — run-nya memang sudah
  -- ada, dan itu persis yang diminta.
  select id into v_id
  from checklist_runs
  where outlet_id = p_outlet and session_id = p_session and run_date = v_tgl;

  if v_id is null then
    -- Sampai di sini berarti INSERT-nya ditolak RLS, bukan karena bentrok.
    -- PostgREST/PostgreSQL tidak selalu membedakan keduanya dengan jelas, jadi
    -- pesannya dibuat menunjuk sebabnya yang paling mungkin.
    raise exception 'Tidak bisa memulai sesi di outlet ini. Pastikan akunmu terdaftar di BU/outlet tersebut.';
  end if;

  return v_id;
end $$;

revoke all on function pastikan_run_aktivitas(uuid, uuid, text) from public;
grant execute on function pastikan_run_aktivitas(uuid, uuid, text) to authenticated;

comment on function pastikan_run_aktivitas(uuid, uuid, text) is
  'Ambil run Daily Activities hari ini untuk (outlet, sesi) — dibuat kalau belum ada. Aman dari dua orang yang menyimpan bersamaan (0089).';

-- ---------------------------------------------------------
-- Catatan sesi boleh diperbarui oleh siapa pun yang boleh mengisi.
--
-- Sebelumnya `notes` hanya ikut saat run DIBUAT. Dengan penyimpanan per item,
-- run sering sudah lahir sebelum orangnya sempat mengetik catatan — jadi
-- catatannya tidak akan pernah tersimpan, tanpa satu pun pesan galat.
--
-- Hanya kolom `notes` yang disentuh: fungsi ini tidak boleh jadi jalan
-- memindahkan run ke outlet/sesi/tanggal lain.
-- ---------------------------------------------------------
create or replace function catat_catatan_run(p_run uuid, p_notes text)
returns void
language plpgsql
as $$
begin
  update checklist_runs set notes = nullif(p_notes, '') where id = p_run;
  if not found then
    raise exception 'Catatan tidak tersimpan — run tidak ditemukan atau kamu tidak berhak mengubahnya.';
  end if;
end $$;

revoke all on function catat_catatan_run(uuid, text) from public;
grant execute on function catat_catatan_run(uuid, text) to authenticated;

-- Policy update untuk run: pemiliknya (0016) dan admin outlet (0016) sudah
-- ada. Yang belum: REKAN SATU OUTLET, padahal merekalah yang mungkin
-- menuliskan catatan pada sesi yang dimulai orang lain — persis seperti
-- mereka sudah boleh menambahkan item sejak 0071.
drop policy if exists checklist_runs_update_outlet_notes on checklist_runs;
create policy checklist_runs_update_outlet_notes on checklist_runs
  for update using (has_outlet_scope(auth.uid(), outlet_id))
  with check (has_outlet_scope(auth.uid(), outlet_id));

notify pgrst, 'reload schema';
