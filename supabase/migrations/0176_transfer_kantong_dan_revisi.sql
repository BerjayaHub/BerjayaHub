-- =========================================================
-- 0176 — TRANSFER KAS: PILIH KANTONG ASAL, DAN BISA DIREVISI
--
-- Dua hal yang diminta, dan keduanya berakar pada satu kekurangan yang sama.
--
-- (1) `transfer_cash` (0040) menulis kedua kakinya dengan `account_id` NULL —
--     selalu Kas Utama, di kedua sisi. Sejak kantong kas ada (0063), staff
--     yang uangnya ada di "Kas CK iis" tetap hanya bisa mengirim dari Kas
--     Utama, dan saldo kantongnya tidak pernah cocok dengan uang fisiknya.
--
-- (2) Transfer yang salah TIDAK BISA dibetulkan sama sekali. Penjaganya di
--     `alasan_tolak_koreksi_kas`: "berpasangan dengan baris di kas lain, jadi
--     tidak bisa dikoreksi sepotong. Catat transfer balik kalau memang salah."
--     Itu benar untuk `ubah_kas` — yang memang hanya menyentuh satu baris —
--     tapi bagi yang salah pilih kantong atau salah ketik nol, "catat transfer
--     balik" berarti riwayat kedua pihak memuat tiga baris untuk satu
--     kekeliruan, dan tidak satu pun menyebutkan bahwa itu kekeliruan.
--
-- ============ YANG TIDAK DIUBAH, DENGAN SENGAJA ============
--
-- `alasan_tolak_koreksi_kas` TETAP menolak transfer. Fungsi itu adalah
-- penjaga `ubah_kas`, dan `ubah_kas` hanya bisa menyentuh satu baris —
-- melonggarkannya berarti satu kaki transfer bisa berubah sendirian, dan
-- uang hilang dari satu sisi tanpa muncul di sisi lain. Revisi transfer
-- punya penjaganya sendiri di bawah.
--
-- ============ KEPUTUSAN YANG DIAMBIL PEMAKAINYA ============
--
--   kantong penerima    -> selalu Kas Utama penerima. Pengirim memilih
--                          kantong ASALNYA sendiri, bukan kantong orang lain.
--   yang boleh merevisi -> pengirim + admin BU-nya. Penerima tidak.
--   saldo penerima      -> BOLEH minus saat ditarik kembali. Menolaknya
--                          berarti salah transfer yang uangnya sudah terpakai
--                          tidak punya jalan keluar sama sekali.
--   bentuknya           -> diubah di tempat, berjejak. Satu kekeliruan tetap
--                          satu transaksi di riwayat.
-- =========================================================

-- ---------------------------------------------------------
-- (1) Jejak alasan perubahan
--
-- `diubah_at` & `diubah_by` sudah ada sejak 0141, alasannya belum. Perubahan
-- saldo dua orang tanpa keterangan kenapa akan diperdebatkan nanti oleh dua
-- pihak yang angkanya sama-sama bergeser.
-- ---------------------------------------------------------
alter table cash_entries add column if not exists alasan_ubah text;

comment on column cash_entries.alasan_ubah is
  'Alasan revisi. Diisi `ubah_transfer_kas`; ikut ditampilkan di riwayat kedua pihak.';

-- ---------------------------------------------------------
-- (2) `transfer_cash` menerima kantong asal
--
-- TANDA TANGAN LAMANYA DIBUANG. PostgREST memilih overload berdasarkan
-- HIMPUNAN NAMA ARGUMEN; membiarkan yang lama hidup berarti pemanggilan yang
-- lupa mengirim `p_from_account` akan diam-diam memakai jalur lama dan
-- memotong Kas Utama — persis bug yang sedang diperbaiki, tapi kali ini tanpa
-- satu pun tanda di layar.
-- ---------------------------------------------------------
drop function if exists transfer_cash(uuid, numeric, text);

create or replace function transfer_cash(
  p_to_user uuid,
  p_amount numeric,
  p_notes text,
  p_from_account uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_tid uuid := gen_random_uuid();
  v_saldo numeric;
  v_nama text;
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Jumlah harus lebih dari 0'; end if;
  if p_to_user = v_uid then raise exception 'Tidak bisa transfer ke diri sendiri'; end if;
  if not exists (select 1 from membership_scopes where user_id = v_uid) then
    raise exception 'Tidak berhak';
  end if;
  if not exists (select 1 from membership_scopes where user_id = p_to_user) then
    raise exception 'Penerima belum terdaftar sebagai anggota';
  end if;

  -- Kantongnya harus MILIK PENGIRIM. Tanpa ini, siapa pun bisa mengirim uang
  -- dari kantong orang lain hanya dengan menebak id-nya.
  if p_from_account is not null then
    select name into v_nama from cash_accounts
     where id = p_from_account and holder_id = v_uid and is_active;
    if v_nama is null then
      raise exception 'Kantong asal tidak dikenal atau bukan milikmu.';
    end if;
  end if;

  -- ============ KANTONG ASAL TIDAK BOLEH MINUS SAAT MENGIRIM ============
  --
  -- Saldo minus berarti catatan dan uang di laci sudah tidak mungkin cocok.
  -- Pada REVISI hal itu diterima (uangnya memang sudah terlanjur berpindah);
  -- saat MENGIRIM tidak ada yang terlanjur, jadi ia cuma salah ketik yang
  -- masih bisa ditolak. `pindah_kas` (0063) sudah menolaknya sejak dulu.
  select coalesce(sum(amount), 0) into v_saldo
    from cash_entries
   where holder_id = v_uid
     and account_id is not distinct from p_from_account
     and dicoret_at is null
     and not dibayar_pusat;
  if v_saldo < p_amount then
    raise exception 'Saldo % cuma %, tidak cukup untuk mengirim %.',
      coalesce(v_nama, 'Kas Utama'), v_saldo, p_amount;
  end if;

  insert into cash_entries(holder_id, account_id, entry_type, amount, counterpart_id, transfer_id, notes, created_by)
    values (v_uid, p_from_account, 'transfer_out', -p_amount, p_to_user, v_tid, p_notes, v_uid);

  -- Kaki penerima SELALU Kas Utama (account_id NULL): kantong adalah urusan
  -- pemiliknya, dan pengirim tidak berhak menentukan isi laci orang lain.
  insert into cash_entries(holder_id, account_id, entry_type, amount, counterpart_id, transfer_id, notes, created_by)
    values (p_to_user, null, 'transfer_in', p_amount, v_uid, v_tid, p_notes, v_uid);
end;
$$;

revoke all on function transfer_cash(uuid, numeric, text, uuid) from public;
grant execute on function transfer_cash(uuid, numeric, text, uuid) to authenticated;

-- ---------------------------------------------------------
-- (3) Boleh tidaknya sebuah transfer direvisi
--
-- Dipisah dari `alasan_tolak_koreksi_kas` dengan sengaja — lihat alasannya di
-- kepala berkas. Mengembalikan KALIMAT, bukan boolean: tombol yang mati tanpa
-- sebab membuat orang mengira aplikasinya rusak.
-- ---------------------------------------------------------
create or replace function alasan_tolak_revisi_transfer(p_entry uuid)
returns text
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v cash_entries%rowtype;
  v_out cash_entries%rowtype;
begin
  select * into v from cash_entries where id = p_entry;
  if v.id is null then
    return 'Entri kasnya tidak ditemukan. Mungkin sudah direvisi orang lain — muat ulang halamannya.';
  end if;
  if v.entry_type not in ('transfer_out', 'transfer_in') then
    return 'Ini bukan transfer antar pengguna.';
  end if;
  if v.transfer_id is null then
    return 'Transfer lama ini tidak punya pasangan yang tercatat, jadi tidak bisa direvisi berpasangan.';
  end if;

  select * into v_out from cash_entries
   where transfer_id = v.transfer_id and entry_type = 'transfer_out' limit 1;
  if v_out.id is null then
    return 'Kaki pengirimnya tidak ditemukan. Laporkan ke admin — transfer ini tidak utuh.';
  end if;

  -- PENGIRIM + ADMIN BU-nya. Penerima sengaja TIDAK: uang yang masuk ke
  -- kantongnya bukan miliknya untuk dikembalikan sendiri.
  if not boleh_koreksi_kas(v_out.holder_id) then
    return 'Hanya pengirimnya atau admin BU-nya yang bisa merevisi transfer ini.';
  end if;

  if exists (select 1 from cash_entries where transfer_id = v.transfer_id and dicoret_at is not null) then
    return 'Transfer ini sudah dibatalkan sebelumnya.';
  end if;

  -- Berkas ESB sudah berangkat membawa angka lama; mengubahnya di sini
  -- membuat catatan berbeda di dua tempat, selamanya, tanpa satu pun tanda.
  if exists (select 1 from cash_entries where transfer_id = v.transfer_id and esb_exported_at is not null) then
    return 'Salah satu sisinya sudah diekspor ke ESB, jadi terkunci. Minta admin BU membuka tandanya dulu lewat Ekspor ESB.';
  end if;

  return null;
end;
$$;

revoke all on function alasan_tolak_revisi_transfer(uuid) from public;
grant execute on function alasan_tolak_revisi_transfer(uuid) to authenticated;

-- ---------------------------------------------------------
-- (4) Revisi transfer — KEDUA kakinya, dalam satu langkah
--
-- Jumlah, kantong asal, penerima, dan keterangannya boleh berubah. Yang tidak
-- berubah: `transfer_id`-nya, supaya satu kekeliruan tetap satu transaksi.
-- ---------------------------------------------------------
create or replace function ubah_transfer_kas(
  p_entry uuid,
  p_amount numeric,
  p_to_user uuid,
  p_from_account uuid,
  p_notes text,
  p_alasan text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_tolak text;
  v_tid uuid;
  v_out cash_entries%rowtype;
  v_in cash_entries%rowtype;
  v_nama text;
  v_saldo numeric;
  v_penerima_lama uuid;
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  if btrim(coalesce(p_alasan, '')) = '' then
    raise exception 'Alasan revisi wajib diisi — saldo dua orang bergeser karenanya.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Jumlah harus lebih dari 0. Kalau transfernya memang batal, hapus entrinya.';
  end if;

  v_tolak := alasan_tolak_revisi_transfer(p_entry);
  if v_tolak is not null then raise exception '%', v_tolak; end if;

  select transfer_id into v_tid from cash_entries where id = p_entry;
  select * into v_out from cash_entries where transfer_id = v_tid and entry_type = 'transfer_out' limit 1;
  select * into v_in  from cash_entries where transfer_id = v_tid and entry_type = 'transfer_in'  limit 1;
  if v_in.id is null then
    raise exception 'Kaki penerimanya tidak ditemukan. Laporkan ke admin — transfer ini tidak utuh.';
  end if;
  v_penerima_lama := v_in.holder_id;

  if p_to_user is null then raise exception 'Penerima wajib dipilih.'; end if;
  if p_to_user = v_out.holder_id then raise exception 'Tidak bisa transfer ke diri sendiri'; end if;
  if not exists (select 1 from membership_scopes where user_id = p_to_user) then
    raise exception 'Penerima belum terdaftar sebagai anggota';
  end if;

  -- Kantong asal harus milik PENGIRIM — bukan milik yang sedang merevisi.
  -- Admin BU yang membetulkan transfer orang lain tidak boleh diam-diam
  -- memindahkannya ke kantongnya sendiri.
  if p_from_account is not null then
    select name into v_nama from cash_accounts
     where id = p_from_account and holder_id = v_out.holder_id and is_active;
    if v_nama is null then
      raise exception 'Kantong asal tidak dikenal atau bukan milik pengirim.';
    end if;
  end if;

  -- ============ SALDO PENGIRIM DIPERIKSA TANPA KAKI LAMANYA ============
  --
  -- Kaki lama masih ada di tabel saat ini. Menghitung saldo apa adanya berarti
  -- uang yang sudah keluar dihitung dua kali, dan revisi yang cuma MENAIKKAN
  -- sedikit pun akan tertolak. Jadi kaki lama dikeluarkan dari hitungan —
  -- persis seperti batas jumlah di layar revisi surat jalan aset (0174).
  select coalesce(sum(amount), 0) into v_saldo
    from cash_entries
   where holder_id = v_out.holder_id
     and account_id is not distinct from p_from_account
     and dicoret_at is null
     and not dibayar_pusat
     and id <> v_out.id;
  if v_saldo < p_amount then
    raise exception 'Saldo % cuma % (di luar transfer ini), tidak cukup untuk %.',
      coalesce(v_nama, 'Kas Utama'), v_saldo, p_amount;
  end if;

  update cash_entries
     set amount = -p_amount,
         account_id = p_from_account,
         counterpart_id = p_to_user,
         notes = nullif(btrim(coalesce(p_notes, '')), ''),
         diubah_at = now(),
         diubah_by = v_uid,
         alasan_ubah = btrim(p_alasan)
   where id = v_out.id;

  -- Kaki penerima: holder-nya ikut berpindah kalau tujuannya diganti.
  --
  -- Barisnya lalu HILANG dari riwayat penerima lama — dan itu memang yang
  -- benar: transfer itu tidak pernah seharusnya jadi miliknya. Saldonya ikut
  -- turun, dan boleh minus kalau uangnya sudah dipakai; menolaknya berarti
  -- salah alamat yang uangnya sudah terpakai tidak punya jalan keluar sama
  -- sekali. Layar yang memanggil wajib menyebutkan kedua akibat itu sebelum
  -- tombolnya ditekan.
  update cash_entries
     set amount = p_amount,
         holder_id = p_to_user,
         account_id = null,
         counterpart_id = v_out.holder_id,
         notes = nullif(btrim(coalesce(p_notes, '')), ''),
         diubah_at = now(),
         diubah_by = v_uid,
         alasan_ubah = btrim(p_alasan)
   where id = v_in.id;

  return jsonb_build_object(
    'transfer_id', v_tid,
    'penerima_berubah', v_penerima_lama is distinct from p_to_user,
    'penerima_lama', v_penerima_lama,
    -- Saldo penerima LAMA, bukan yang baru: itu yang bisa jadi minus, dan
    -- layar pengirim tidak punya cara lain membacanya (kas orang lain, RLS).
    -- Satu-satunya orang yang bisa memberitahunya adalah yang menekan tombol
    -- revisi ini.
    'saldo_penerima_lama', (
      select coalesce(sum(amount), 0) from cash_entries
       where holder_id = v_penerima_lama and account_id is null
         and dicoret_at is null and not dibayar_pusat
    )
  );
end;
$$;

revoke all on function ubah_transfer_kas(uuid, numeric, uuid, uuid, text, text) from public;
grant execute on function ubah_transfer_kas(uuid, numeric, uuid, uuid, text, text) to authenticated;

-- ---------------------------------------------------------
-- (5) `riwayat_kas_saya` membawa dua kolom baru
--
-- `alasan_tolak_transfer` dipakai layar untuk memutuskan tombolnya: ada,
-- mati-dengan-sebab, atau tidak ada sama sekali. `alasan_ubah` supaya revisinya
-- terbaca di riwayat KEDUA pihak tanpa membuka apa pun.
--
-- DI-DROP DULU: `create or replace` tidak bisa menambah kolom pada tabel
-- keluaran sebuah fungsi.
-- ---------------------------------------------------------
drop function if exists riwayat_kas_saya(int);

create or replace function riwayat_kas_saya(p_limit int default 50)
returns table (
  id uuid,
  entry_date date,
  entry_type text,
  amount numeric,
  notes text,
  qty numeric,
  unit text,
  proof_path text,
  created_at timestamptz,
  category_id uuid,
  category_name text,
  account_id uuid,
  account_name text,
  outlet_id uuid,
  outlet_name text,
  counterpart_id uuid,
  counterpart_name text,
  penyesuaian_nota uuid,
  dicoret_at timestamptz,
  dicoret_oleh text,
  alasan_coret text,
  diubah_at timestamptz,
  diubah_oleh text,
  alasan_ubah text,
  alasan_tolak text,
  alasan_tolak_transfer text,
  supplier text,
  esb_exported_at timestamptz,
  dibayar_pusat boolean
)
language sql
security definer
stable
set search_path = public
as $$
  select
    ce.id,
    ce.entry_date,
    ce.entry_type,
    ce.amount,
    ce.notes,
    ce.qty,
    ce.unit,
    ce.proof_path,
    ce.created_at,
    ce.category_id,
    cc.name,
    ce.account_id,
    label_kantong_kas(ca.name, ce.dibayar_pusat),
    ce.outlet_id,
    o.name,
    ce.counterpart_id,
    cp.full_name,
    ce.penyesuaian_nota,
    ce.dicoret_at,
    dc.full_name,
    ce.alasan_coret,
    ce.diubah_at,
    db.full_name,
    ce.alasan_ubah,
    alasan_tolak_koreksi_kas(ce.id),
    alasan_tolak_revisi_transfer(ce.id),
    ce.supplier,
    ce.esb_exported_at,
    ce.dibayar_pusat
  from cash_entries ce
  left join cash_categories cc on cc.id = ce.category_id
  left join cash_accounts ca on ca.id = ce.account_id
  left join outlets o on o.id = ce.outlet_id
  left join user_profiles cp on cp.id = ce.counterpart_id
  left join user_profiles dc on dc.id = ce.dicoret_by
  left join user_profiles db on db.id = ce.diubah_by
  where ce.holder_id = auth.uid()
  order by ce.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 500));
$$;

revoke all on function riwayat_kas_saya(int) from public;
grant execute on function riwayat_kas_saya(int) to authenticated;

notify pgrst, 'reload schema';
