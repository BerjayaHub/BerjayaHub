-- =========================================================
-- Berjaya Hub OMS — 0062
-- Koreksi OUTLET BASIS pada baris presensi yang sudah terlanjur tersimpan.
--
-- MASALAHNYA. `attendance_records.nbm_outlet_id` adalah POTRET basis (★) pada
-- detik clock-in. Itu desain yang benar dan sengaja dipertahankan: kalau basis
-- dibaca ulang saat rekap disusun, mengubah basis seseorang hari ini akan
-- MENULIS ULANG seluruh riwayat gajinya — bulan yang sudah dibayarkan ikut
-- berubah angkanya.
--
-- Tapi potret hanya seakurat saat pemotretannya. Kalau seseorang pindah outlet
-- tanggal 2 dan basisnya baru diperbarui tanggal 3, presensi tanggal 2 terlanjur
-- tercatat di outlet lama. Akibatnya bukan cuma label:
--   - NBM-nya dihitung dengan konfigurasi outlet LAMA (tarif, tier lembur, PH);
--   - saat rekap difilter ke outlet BARU, barisnya HILANG sama sekali —
--     bukan tampil dengan angka salah, tapi tidak muncul. Itu yang paling
--     mudah terlewat saat memeriksa.
--
-- PERBAIKAN: beri admin cara membetulkan basis pada baris tertentu, dengan
-- alasan yang tercatat. Bukan mengubah cara kerja potretnya.
-- =========================================================

alter table attendance_records add column if not exists nbm_outlet_note text;
alter table attendance_records add column if not exists nbm_outlet_changed_by uuid references user_profiles(id) on delete set null;
alter table attendance_records add column if not exists nbm_outlet_changed_at timestamptz;

comment on column attendance_records.nbm_outlet_note is
  'Alasan koreksi outlet basis. Terisi berarti basisnya BUKAN hasil potret otomatis saat clock-in.';

/**
 * Koreksi outlet basis satu baris presensi.
 *
 * IZIN SENGAJA GANDA: pemanggil harus admin di outlet TEMPAT ABSEN sekaligus
 * admin di outlet BASIS BARU. Kalau hanya salah satu, admin outlet A bisa
 * memindahkan beban gaji seseorang ke outlet B yang bukan tanggung jawabnya —
 * dan admin B tidak akan pernah tahu angkanya bertambah dari mana.
 *
 * `nbm_business_unit_id` IKUT diperbarui mengikuti BU outlet barunya. Tanpa itu
 * barisnya jadi tidak konsisten: rekap NBM menyaring dengan
 * `nbm_business_unit_id`, sehingga baris yang basis outletnya sudah pindah BU
 * akan hilang dari kedua BU sekaligus.
 */
create or replace function koreksi_outlet_basis(p_record uuid, p_outlet uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r attendance_records%rowtype;
  v_bu uuid;
begin
  select * into r from attendance_records where id = p_record;
  if not found then
    raise exception 'Baris presensi tidak ditemukan.';
  end if;

  select business_unit_id into v_bu from outlets where id = p_outlet;
  if v_bu is null then
    raise exception 'Outlet basis tujuan tidak ditemukan.';
  end if;

  if not is_admin_of_outlet(auth.uid(), r.outlet_id) then
    raise exception 'Kamu bukan admin di outlet tempat presensi ini dicatat.';
  end if;
  if not is_admin_of_outlet(auth.uid(), p_outlet) then
    raise exception 'Kamu bukan admin di outlet basis tujuan, jadi tidak boleh memindahkan beban NBM ke sana.';
  end if;

  if coalesce(btrim(p_note), '') = '' then
    raise exception 'Alasan koreksi wajib diisi.';
  end if;

  update attendance_records
  set nbm_outlet_id = p_outlet,
      nbm_business_unit_id = v_bu,
      nbm_outlet_note = btrim(p_note),
      nbm_outlet_changed_by = auth.uid(),
      nbm_outlet_changed_at = now()
  where id = p_record;
end;
$$;

revoke all on function koreksi_outlet_basis(uuid, uuid, text) from public;
grant execute on function koreksi_outlet_basis(uuid, uuid, text) to authenticated;

/**
 * Koreksi massal: semua presensi milik satu orang dalam rentang tanggal.
 *
 * Dipisahkan dari versi satu baris — bukan sekadar perulangan — karena
 * risikonya berbeda. Rentang yang kelewat lebar bisa memindahkan berminggu-
 * minggu gaji ke outlet yang salah dalam satu klik.
 *
 * `p_dry_run` (default TRUE) mengembalikan JUMLAH yang AKAN terpengaruh tanpa
 * mengubah apa pun, supaya UI bisa memperlihatkan akibatnya lebih dulu.
 * Defaultnya sengaja tidak-mengubah: kalau pemanggil lupa mengirim parameter,
 * yang terjadi adalah tidak terjadi apa-apa — bukan perubahan massal diam-diam.
 *
 * Baris yang pemanggilnya tidak berwenang DILEWATI, bukan menggagalkan seluruh
 * operasi. Kalau digagalkan semua, admin outlet tidak akan pernah bisa
 * membetulkan barisnya sendiri hanya karena ada satu baris milik outlet lain
 * yang kebetulan masuk rentang.
 */
create or replace function koreksi_outlet_basis_massal(
  p_user uuid,
  p_from date,
  p_to date,
  p_outlet uuid,
  p_note text,
  p_dry_run boolean default true
)
returns table (terpengaruh int, dilewati int)
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_bu uuid;
  v_ok int := 0;
  v_skip int := 0;
begin
  select business_unit_id into v_bu from outlets where id = p_outlet;
  if v_bu is null then
    raise exception 'Outlet basis tujuan tidak ditemukan.';
  end if;
  if not is_admin_of_outlet(auth.uid(), p_outlet) then
    raise exception 'Kamu bukan admin di outlet basis tujuan.';
  end if;
  if not p_dry_run and coalesce(btrim(p_note), '') = '' then
    raise exception 'Alasan koreksi wajib diisi.';
  end if;

  for r in
    select ar.id, ar.outlet_id
    from attendance_records ar
    where ar.user_id = p_user
      and (ar.clock_in_at at time zone 'Asia/Jakarta')::date between p_from and p_to
      and coalesce(ar.nbm_outlet_id, ar.outlet_id) is distinct from p_outlet
  loop
    if not is_admin_of_outlet(auth.uid(), r.outlet_id) then
      v_skip := v_skip + 1;
      continue;
    end if;
    v_ok := v_ok + 1;
    if not p_dry_run then
      update attendance_records
      set nbm_outlet_id = p_outlet,
          nbm_business_unit_id = v_bu,
          nbm_outlet_note = btrim(p_note),
          nbm_outlet_changed_by = auth.uid(),
          nbm_outlet_changed_at = now()
      where id = r.id;
    end if;
  end loop;

  return query select v_ok, v_skip;
end;
$$;

revoke all on function koreksi_outlet_basis_massal(uuid, date, date, uuid, text, boolean) from public;
grant execute on function koreksi_outlet_basis_massal(uuid, date, date, uuid, text, boolean) to authenticated;
