-- =========================================================
-- 0177 — KANTONG UTAMA PER ORANG, DAN KANTONG YANG TERLIHAT ADMIN BU
--
-- Tiga temuan dari lapangan, satu migration.
--
-- ============ (A) "KAS UTAMA" MEMBINGUNGKAN, DAN MEMANG PANTAS ============
--
--   "ada staff yang punya Kas utama, tetapi ada juga yang tidak punya kas
--    utama hanya ada kantong yang saya tambahkan saja ... elsha dia hanya
--    punya satu kantong kas sentul, maka kas utama nya diubah ke nama kas
--    sentul, sehingga jika iis ck transfer dana langsung ke kas sentul"
--
-- "Kas Utama" bukan kantong. Ia nama untuk uang yang TIDAK berada di kantong
-- mana pun — keadaan yang ada sebelum kantong pertama dibuat (0063), dan yang
-- masih kebagian uang setiap kali ada jalur yang lupa bertanya kantong.
-- Orang yang cuma punya satu kantong tidak punya keputusan untuk diambil, tapi
-- tetap melihat dua baris dan tetap ditanya.
--
-- Yang ditambahkan: SATU kantong per orang ditandai utama. Form mengisinya
-- sendiri, transfer mendarat di sana, dan "Kas Utama" hanya muncul kalau ia
-- masih berisi uang — bukan sebagai pilihan, melainkan sebagai sisa yang perlu
-- dibereskan.
--
-- ============ (B) TRANSFER MENDARAT DI KANTONG UTAMA PENERIMA ============
--
-- 0176 menulis kaki penerima dengan `account_id` NULL (Kas Utama), dengan
-- alasan "kantong adalah urusan pemiliknya". Alasannya tetap benar — yang
-- salah kesimpulannya: mendaratkannya di Kas Utama BUKAN berarti tidak
-- menyentuh kantong orang lain, melainkan menaruhnya di tempat yang justru
-- harus dibereskan penerimanya. Sekarang ia mendarat di kantong UTAMA
-- penerima, yaitu kantong yang penerimanya sendiri yang menentukan.
--
-- ============ (C) ADMIN BU MELIHAT TAB KANTONG YANG SELALU KOSONG ============
--
--   "saya menambahkan kantong ke user lain dengan scope superadmin saya,
--    tetapi di user yang saya tambahkan kantongnya di admin portal user itu
--    tidak ada kantong"
--
-- `daftar_kantong_kas` (0153) berakhir dengan `where is_super_admin(auth.uid())`
-- pada KEDUA cabangnya. Tabnya sendiri sudah dibuka untuk admin BU sejak 0141,
-- jadi yang terjadi: tab yang bisa dibuka, tombol "+ Tambah Kantong" yang bisa
-- ditekan, dan tabel yang selamanya berbunyi "Belum ada kantong kas".
-- Tidak ada galat — layarnya cuma berbohong dengan tenang.
--
-- Cakupannya disamakan dengan `cash_entries_select_bu_admin` (0141): kantong
-- orang yang punya keanggotaan di BU yang ia admini, bukan seluruh organisasi.
-- =========================================================

-- ---------------------------------------------------------
-- (1) Penanda kantong utama
-- ---------------------------------------------------------
alter table cash_accounts add column if not exists is_primary boolean not null default false;

comment on column cash_accounts.is_primary is
  'Kantong yang dipakai sebagai bawaan: form kas mengisinya sendiri, dan transfer dari orang lain mendarat di sini.';

-- SATU per pemegang, dijaga database. Dijaga di layar saja berarti dua tab
-- yang terbuka bersamaan bisa menghasilkan dua kantong utama, dan sejak itu
-- "kantong utama" tidak berarti apa-apa.
create unique index if not exists idx_cash_accounts_satu_utama
  on cash_accounts (holder_id) where is_primary;

-- ---------------------------------------------------------
-- (2) Backfill: kantong pertama tiap orang jadi utama
--
-- Yang AKTIF saja, dan yang paling awal menurut urutan tampilannya — itu
-- kantong yang selama ini paling mungkin ia pakai.
-- ---------------------------------------------------------
with pilihan as (
  select distinct on (holder_id) id
    from cash_accounts
   where is_active
   order by holder_id, sort_order, created_at, id
)
update cash_accounts a
   set is_primary = true
  from pilihan p
 where a.id = p.id
   and not exists (select 1 from cash_accounts x where x.holder_id = a.holder_id and x.is_primary);

-- ---------------------------------------------------------
-- (3) Kantong pertama seseorang otomatis jadi utama
--
-- Lewat TRIGGER, bukan di dalam RPC pembuatnya: kantong dibuat dari beberapa
-- jalur (RPC super admin, RPC pemegangnya sendiri), dan aturan yang ditulis
-- di salah satunya akan tertinggal di yang lain tanpa satu pun tanda.
-- ---------------------------------------------------------
create or replace function tandai_kantong_utama_pertama()
returns trigger
language plpgsql
as $$
begin
  if new.is_primary then return new; end if;
  if not exists (
    select 1 from cash_accounts
     where holder_id = new.holder_id and is_primary and id is distinct from new.id
  ) then
    new.is_primary := true;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_kantong_utama_pertama on cash_accounts;
create trigger trg_kantong_utama_pertama
  before insert on cash_accounts
  for each row execute function tandai_kantong_utama_pertama();

-- ---------------------------------------------------------
-- (4) Kantong utama seseorang — null berarti ia belum punya kantong sama
--     sekali, dan uangnya memang masih di Kas Utama.
-- ---------------------------------------------------------
create or replace function kantong_utama(p_holder uuid)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select id from cash_accounts
   where holder_id = p_holder and is_primary and is_active
   limit 1;
$$;

grant execute on function kantong_utama(uuid) to authenticated;

-- ---------------------------------------------------------
-- (5) Mengganti kantong utama
--
-- Pemegangnya sendiri, atau yang berwenang atas kasnya (admin BU / super
-- admin) — aturan yang sama dengan koreksi kas, supaya tidak ada daftar
-- wewenang kedua yang harus ikut diperbarui setiap kali yang pertama berubah.
-- ---------------------------------------------------------
create or replace function atur_kantong_utama(p_account uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_holder uuid;
  v_aktif boolean;
begin
  if auth.uid() is null then raise exception 'Harus login'; end if;

  select holder_id, is_active into v_holder, v_aktif from cash_accounts where id = p_account;
  if v_holder is null then raise exception 'Kantongnya tidak ditemukan.'; end if;
  if not v_aktif then
    raise exception 'Kantong yang sudah ditutup tidak bisa dijadikan kantong utama.';
  end if;
  if not boleh_koreksi_kas(v_holder) then
    raise exception 'Kas ini bukan wewenangmu.';
  end if;

  -- Yang lama dilepas DULU: indeks uniknya menolak dua kantong utama, dan
  -- urutan terbalik membuat perintahnya gagal di tengah.
  update cash_accounts set is_primary = false where holder_id = v_holder and is_primary;
  update cash_accounts set is_primary = true where id = p_account;
end;
$$;

revoke all on function atur_kantong_utama(uuid) from public;
grant execute on function atur_kantong_utama(uuid) to authenticated;

-- ---------------------------------------------------------
-- (6) Transfer mendarat di kantong UTAMA penerima
-- ---------------------------------------------------------
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

  if p_from_account is not null then
    select name into v_nama from cash_accounts
     where id = p_from_account and holder_id = v_uid and is_active;
    if v_nama is null then
      raise exception 'Kantong asal tidak dikenal atau bukan milikmu.';
    end if;
  end if;

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

  -- Kaki penerima: kantong UTAMA-nya. Kalau ia belum punya kantong sama
  -- sekali, barulah Kas Utama — dan itu memang satu-satunya tempat yang ada.
  insert into cash_entries(holder_id, account_id, entry_type, amount, counterpart_id, transfer_id, notes, created_by)
    values (p_to_user, kantong_utama(p_to_user), 'transfer_in', p_amount, v_uid, v_tid, p_notes, v_uid);
end;
$$;

revoke all on function transfer_cash(uuid, numeric, text, uuid) from public;
grant execute on function transfer_cash(uuid, numeric, text, uuid) to authenticated;

-- Kaki penerima pada REVISI ikut mendarat di kantong utamanya. Kalau hanya
-- `transfer_cash` yang diperbarui, transfer yang direvisi akan terlempar
-- kembali ke Kas Utama — dan yang merevisinya justru sedang membetulkan.
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

  if p_from_account is not null then
    select name into v_nama from cash_accounts
     where id = p_from_account and holder_id = v_out.holder_id and is_active;
    if v_nama is null then
      raise exception 'Kantong asal tidak dikenal atau bukan milik pengirim.';
    end if;
  end if;

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

  update cash_entries
     set amount = p_amount,
         holder_id = p_to_user,
         account_id = kantong_utama(p_to_user),
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
    'saldo_penerima_lama', (
      select coalesce(sum(amount), 0) from cash_entries
       where holder_id = v_penerima_lama
         and dicoret_at is null and not dibayar_pusat
    )
  );
end;
$$;

revoke all on function ubah_transfer_kas(uuid, numeric, uuid, uuid, text, text) from public;
grant execute on function ubah_transfer_kas(uuid, numeric, uuid, uuid, text, text) to authenticated;

-- ---------------------------------------------------------
-- (7) `daftar_kantong_kas` dibuka untuk admin BU, dan membawa `is_primary`
-- ---------------------------------------------------------
drop function if exists daftar_kantong_kas();

create or replace function daftar_kantong_kas()
returns table (
  id uuid,
  holder_id uuid,
  holder_name text,
  name text,
  outlet_id uuid,
  outlet_name text,
  is_active boolean,
  sort_order int,
  balance numeric,
  jatah int,
  kantong_nyata boolean,
  is_primary boolean
)
language sql
security definer
stable
set search_path = public
as $$
  with saldo as (
    select ce.holder_id, ce.account_id, sum(ce.amount) as balance
      from cash_entries ce
     where not ce.dibayar_pusat
       and ce.dicoret_at is null
     group by ce.holder_id, ce.account_id
  ),
  orang as (
    select holder_id from cash_accounts
    union
    select holder_id from saldo
  )
  select a.id,
         a.holder_id,
         up.full_name,
         a.name,
         a.outlet_id,
         o.name,
         a.is_active,
         a.sort_order,
         coalesce(s.balance, 0),
         coalesce(up.cash_account_limit, 1),
         true,
         a.is_primary
    from cash_accounts a
    join user_profiles up on up.id = a.holder_id
    left join outlets o on o.id = a.outlet_id
    left join saldo s on s.holder_id = a.holder_id and s.account_id = a.id
   -- Cakupan yang sama dengan `boleh_koreksi_kas`: pemegangnya sendiri, admin
   -- BU tempat ia bernaung, atau super admin. Sebelumnya `is_super_admin`
   -- saja, sehingga admin BU melihat tabel yang selamanya kosong.
   where boleh_koreksi_kas(a.holder_id)

  union all

  select null::uuid,
         p.holder_id,
         up.full_name,
         'Kas Utama',
         null::uuid,
         null::text,
         true,
         -1,
         coalesce(s.balance, 0),
         coalesce(up.cash_account_limit, 1),
         false,
         false
    from orang p
    join user_profiles up on up.id = p.holder_id
    left join saldo s on s.holder_id = p.holder_id and s.account_id is null
   where boleh_koreksi_kas(p.holder_id)
     -- Kas Utama yang KOSONG tidak ditampilkan: ia bukan kantong, dan
     -- menampilkannya sebagai baris membuat orang mengira ia punya dua tempat
     -- uang padahal yang satu cuma sisa sejarah.
     and coalesce(s.balance, 0) <> 0

   order by 3, 11 desc, 8, 4;
$$;

revoke all on function daftar_kantong_kas() from public;
grant execute on function daftar_kantong_kas() to authenticated;

notify pgrst, 'reload schema';
