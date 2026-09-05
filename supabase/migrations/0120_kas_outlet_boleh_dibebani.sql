-- =========================================================
-- Berjaya Hub OMS — 0120
-- Kantong kas boleh diberi OUTLET, dan staff outlet itu boleh membebaninya.
--
-- =========================================================
-- MASALAH YANG DILAPORKAN
-- =========================================================
--
--   "yang pegang kas user risma, tetapi user shenda boleh input terima dari
--    supplier ... bila user yang tidak pegang kas input terima dari supplier
--    maka kasnya akan mines, sedangkan kas user yang pegang kas tidak berkurang"
--
-- Sejak 0040 kas mengikuti USER (`cash_entries.holder_id`), dan RLS-nya hanya
-- mengizinkan `holder_id = auth.uid()`. Jadi apa pun yang dicatat Shenda
-- mendarat di kas Shenda — satu-satunya kas yang boleh ia tulis.
--
-- =========================================================
-- YANG DIUBAH, DAN YANG SENGAJA TIDAK
-- =========================================================
--
-- TIDAK diubah: kas tetap MILIK ORANG. Risma tetap pemegangnya dan tetap yang
-- bertanggung jawab kalau uangnya kurang. Kas milik "outlet" terdengar rapi,
-- tapi saat selisih muncul tidak ada seorang pun yang bisa ditanya — dan itu
-- kerugian yang tidak terlihat di skema mana pun.
--
-- Yang ditambahkan cuma satu: kantong kas boleh menyebut OUTLET. Artinya
-- "kantong ini dipakai untuk operasional outlet itu", dan konsekuensinya
-- siapa pun yang punya cakupan di outlet tersebut boleh MEMBEBANI-nya.
--
--   outlet_id NULL  -> persis seperti sekarang: hanya pemegangnya.
--   outlet_id diisi -> pemegang + staff outlet itu.
--
-- Opt-in per kantong. BU dan outlet yang tidak punya kasus ini tidak berubah
-- sedikit pun, dan tidak ada satu baris data pun yang perlu dipindahkan.
--
-- =========================================================
-- KENAPA BUKAN "KAS MENEMPEL DI OUTLET ATAU USER, PILIH SALAH SATU"
-- =========================================================
--
-- Dua model kepemilikan dalam satu ledger berarti setiap laporan, setiap
-- kebijakan RLS, dan setiap query saldo harus menangani dua bentuk selamanya —
-- dan "berapa saldo kas total" berhenti punya jawaban tunggal.
--
-- Bentuk di sini menghasilkan perilaku yang diminta tanpa membelah modelnya:
-- tetap satu `holder_id`, satu `cash_balances`, satu cara membaca saldo.
--
-- =========================================================
-- MENULIS LEWAT RPC, BUKAN MELONGGARKAN RLS
-- =========================================================
--
-- Kebijakan `cash_entries_insert_own` SENGAJA TIDAK DIUBAH. Melonggarkannya
-- berarti setiap jalur tulis — termasuk yang belum ada — ikut longgar, dan
-- kebijakan RLS tidak bisa memaksakan hal-hal yang harus benar bersamaan
-- (tanda nominal sesuai jenis, outlet peruntukan terisi, kantong benar-benar
-- milik orang yang dibebani).
--
-- `catat_kas_di()` di bawah memeriksa semuanya di satu tempat. Jalur lama
-- (mencatat kas sendiri lewat tabel) tetap hidup apa adanya, jadi PWA lama di
-- HP staff tidak berhenti bekerja.
-- =========================================================

alter table cash_accounts add column if not exists outlet_id uuid references outlets(id) on delete set null;
create index if not exists idx_cash_accounts_outlet on cash_accounts(outlet_id) where outlet_id is not null;

comment on column cash_accounts.outlet_id is
  'Outlet yang kantong ini layani. NULL = pribadi, hanya pemegangnya yang boleh membebani. Terisi = pemegang + siapa pun yang punya cakupan di outlet itu.';

-- ---------------------------------------------------------
-- SATU-SATUNYA definisi "boleh membebani kas ini".
--
-- Dipakai RPC penulis DAN kebijakan baca. Kalau keduanya menulis syaratnya
-- sendiri-sendiri, akan ada keadaan di mana seseorang boleh MENULIS entri yang
-- tidak boleh ia LIHAT — dan entri yang tidak terlihat sesudah disimpan
-- terbaca sebagai "gagal tersimpan", lalu dicatat ulang.
-- ---------------------------------------------------------
create or replace function boleh_membebani_kas(p_uid uuid, p_account uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from cash_accounts a
     where a.id = p_account
       -- Kantong yang sudah ditutup tidak bisa dibebani siapa pun.
       --
       -- PERLU DICATAT JUJUR: untuk `catat_kas_di` baris ini BUKAN penjaganya
       -- — fungsi itu memeriksa `is_active` sendiri, dengan pesan yang lebih
       -- tepat. Sabotase yang membuang baris ini tidak membuat tesnya lewat
       -- `catat_kas_di` merah, dan itu memang benar.
       --
       -- Ia load-bearing bagi pemanggil LAIN yang menanyakan izin tanpa
       -- menulis apa pun — layar yang memutuskan tombol mana yang digambar,
       -- dan pembayaran hutang di 0121. Karena itu kontraknya diuji langsung,
       -- bukan hanya lewat satu pemanggil.
       and a.is_active
       and (
         a.holder_id = p_uid
         or (a.outlet_id is not null and has_outlet_scope(p_uid, a.outlet_id))
         or is_super_admin(p_uid)
       )
  );
$$;

revoke all on function boleh_membebani_kas(uuid, uuid) from public;
grant execute on function boleh_membebani_kas(uuid, uuid) to authenticated;

comment on function boleh_membebani_kas(uuid, uuid) is
  'Apakah user boleh mencatat entri pada kantong kas ini. Pemegang selalu boleh; staff outlet boleh kalau kantongnya diberi outlet; super admin boleh untuk koreksi.';

-- ---------------------------------------------------------
-- CATAT KAS PADA KANTONG TERTENTU — boleh milik orang lain.
-- ---------------------------------------------------------
create or replace function catat_kas_di(
  p_account uuid,
  p_type text,
  p_amount numeric,
  p_category uuid default null,
  p_outlet uuid default null,
  p_notes text default null,
  p_proof text default null,
  p_date date default null,
  p_qty numeric default null,
  p_unit text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_holder uuid;
  v_aktif boolean;
  v_id uuid;
  v_amount numeric;
begin
  if p_type not in ('in', 'out') then
    raise exception 'Jenis kas hanya boleh in atau out.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Nominal harus lebih besar dari 0.';
  end if;

  -- Dipisah dari `boleh_membebani_kas` supaya PESANNYA tepat.
  --
  -- Kalau keduanya disatukan, pemegang kas yang kantongnya sudah ditutup akan
  -- dibilang "tidak berhak" — dan ia akan mencari izin yang tidak pernah
  -- hilang, alih-alih membuka kembali kantongnya.
  select holder_id, is_active into v_holder, v_aktif from cash_accounts where id = p_account;
  if v_holder is null then
    raise exception 'Kantong kas tidak ditemukan.';
  end if;
  if not v_aktif then
    raise exception 'Kantong kas ini sudah ditutup. Aktifkan lagi kalau memang masih dipakai.';
  end if;

  if not boleh_membebani_kas(v_uid, p_account) then
    raise exception 'Kamu tidak berhak mencatat pada kantong kas ini.';
  end if;

  -- TANDANYA DITENTUKAN DI SINI, bukan oleh pemanggil.
  --
  -- `cash_entries.amount` bertanda: positif menambah saldo, negatif mengurangi.
  -- Kalau pemanggil yang menentukan tandanya, satu layar yang lupa memberi
  -- minus akan MENAMBAH kas ketika seharusnya mengurangi — dan saldonya tetap
  -- terlihat wajar sampai ada yang menghitung uang fisiknya.
  v_amount := case when p_type = 'out' then -abs(p_amount) else abs(p_amount) end;

  -- Dua batasan dari 0063 diperiksa di sini juga, dengan pesan yang bisa
  -- ditindaklanjuti. Batasannya sendiri tetap ada di tabel — yang di sini
  -- hanya menerjemahkan penolakan Postgres jadi kalimat yang berarti bagi
  -- orang yang sedang berdiri di depan kasir.
  if p_type = 'out' and p_outlet is null then
    raise exception 'Kas keluar harus menyebut outlet peruntukannya.';
  end if;
  if p_type = 'out' and nullif(p_proof, '') is null then
    raise exception 'Kas keluar harus disertai foto bukti/nota.';
  end if;

  insert into cash_entries (
    holder_id, account_id, entry_type, amount, category_id, outlet_id,
    notes, proof_path, entry_date, qty, unit, created_by
  )
  values (
    v_holder, p_account, p_type, v_amount, p_category, p_outlet,
    nullif(p_notes, ''), nullif(p_proof, ''),
    coalesce(p_date, (now() at time zone 'Asia/Jakarta')::date),
    p_qty, nullif(p_unit, ''), v_uid
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function catat_kas_di(uuid, text, numeric, uuid, uuid, text, text, date, numeric, text) from public;
grant execute on function catat_kas_di(uuid, text, numeric, uuid, uuid, text, text, date, numeric, text) to authenticated;

-- ---------------------------------------------------------
-- BACA KANTONGNYA: kantong ber-outlet terlihat oleh staff outlet itu.
--
-- Tanpa ini seluruh fitur ini tidak akan pernah muncul di layar. Kebijakan
-- 0063 hanya mengizinkan `holder_id = auth.uid()`, jadi daftar "kas mana yang
-- boleh kubebani" milik Shenda akan selalu KOSONG — dan tombolnya ada, RPC-nya
-- ada, izinnya ada, tapi tidak ada satu pun pilihan yang bisa dipilih.
--
-- Yang dibuka hanya kantong yang MENYEBUT outlet tempat ia bertugas. Kantong
-- pribadi orang lain tetap tak terlihat, termasuk namanya.
-- ---------------------------------------------------------
drop policy if exists cash_accounts_baca_outlet on cash_accounts;
create policy cash_accounts_baca_outlet on cash_accounts
  for select to authenticated
  using (outlet_id is not null and has_outlet_scope(auth.uid(), outlet_id));

-- ---------------------------------------------------------
-- BACA: pembuat entri boleh melihat entri yang IA buat.
--
-- Ini penjagaan yang paling mudah terlewat, dan akibatnya paling
-- membingungkan. Tanpa baris ini, Shenda mencatat pembelian dari kas Risma,
-- penyimpanannya berhasil — lalu entrinya TIDAK MUNCUL di layar mana pun yang
-- bisa Shenda buka.
--
-- Yang terjadi berikutnya bisa ditebak: ia mengira gagal, lalu mencatatnya
-- lagi. Kas Risma terpotong dua kali, dan tidak ada satu pun error di
-- sepanjang jalan itu.
--
-- Yang DIBUKA hanya entri yang ia buat sendiri — bukan seluruh isi kas Risma.
-- Saldo dan riwayat lengkapnya tetap milik pemegangnya.
-- ---------------------------------------------------------
drop policy if exists cash_entries_select_pembuat on cash_entries;
create policy cash_entries_select_pembuat on cash_entries
  for select to authenticated
  using (created_by = auth.uid());

notify pgrst, 'reload schema';
