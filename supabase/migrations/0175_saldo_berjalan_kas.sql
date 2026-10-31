-- =========================================================
-- 0175 — SALDO BERJALAN PER KANTONG DI RIWAYAT KAS
--
-- Diminta: kolom saldo rupiah di Cash Ledger, Staff App maupun Admin Portal,
-- "untuk memudahkan membaca history dan trackingnya".
--
-- ============ KENAPA DIHITUNG DI DATABASE, BUKAN DI LAYAR ============
--
-- Menjumlahkan baris yang sedang TAMPIL terlihat jauh lebih murah, dan ia
-- salah persis saat paling dipercaya. Kedua layar menyaring: Staff App cuma
-- memuat 50 entri terakhir; Admin Portal menyaring pemegang, jenis, rentang
-- tanggal, bahan/selain bahan, dan nomor kas. Saldo yang dijumlahkan dari
-- baris tersaring bukan saldo — ia "jumlah baris yang kebetulan terlihat",
-- yang tidak bisa dibedakan dari saldo sungguhan oleh siapa pun yang
-- membacanya. Dan orang MEMBACA kolom ini untuk mencocokkan dengan uang fisik
-- di laci.
--
-- Jadi tiap entri membawa saldonya sendiri, dihitung atas SELURUH riwayat
-- kantongnya, apa pun saringan di layar.
--
-- ============ ATURANNYA SAMA PERSIS DENGAN `cash_account_balances` ============
--
-- View saldo kantong (0153) berbunyi:
--
--     sum(amount) where dicoret_at is null and not dibayar_pusat
--     group by holder_id, account_id
--
-- Ketiganya ditiru di sini. Kalau satu saja menyimpang, baris terbaru akan
-- menampilkan angka yang BERBEDA dari saldo kantong di kepala halaman — dua
-- angka untuk hal yang sama, di satu layar, dan tidak ada cara menebak mana
-- yang benar.
--
-- ============ URUTANNYA: TANGGAL ENTRI, BUKAN WAKTU KETIK ============
--
-- `entry_date, created_at, id`. Uang berpindah pada tanggal entrinya; entri
-- yang diketik menyusul untuk kemarin tetap masuk di posisi kemarin. Daftar
-- Staff App sendiri masih urut waktu ketik (supaya entri yang baru saja
-- disimpan tidak terlempar keluar dari 50 teratas), jadi pada kasus entri
-- mundur kolom saldonya bisa tidak urut naik-turun di layar. Yang dijaga di
-- sini adalah tiap angkanya BENAR untuk barisnya sendiri — bukan supaya
-- kolomnya enak dipandang.
-- =========================================================

-- ---------------------------------------------------------
-- (1) Siapa yang boleh melihat saldo kantong seseorang
--
-- Dipisah jadi fungsinya sendiri supaya aturan ini tidak tersebar: pemegangnya
-- sendiri, atau admin BU tempat pemegang itu punya scope — sama dengan
-- policy `cash_entries_select_bu_admin` (0141).
-- ---------------------------------------------------------
create or replace function boleh_lihat_saldo_kas(p_holder uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    p_holder is not null
    and (
      p_holder = auth.uid()
      or exists (
        select 1
        from membership_scopes ms
        where ms.user_id = p_holder
          and ms.business_unit_id is not null
          and is_bu_admin(auth.uid(), ms.business_unit_id)
      )
    );
$$;

comment on function boleh_lihat_saldo_kas(uuid) is
  'Pemegangnya sendiri atau admin BU-nya. Dipakai saldo berjalan supaya saldo tidak pernah dihitung dari riwayat yang hanya terbaca separuh.';

-- ---------------------------------------------------------
-- (2) Saldo berjalan untuk sekumpulan entri
--
-- Diberi daftar id yang sedang tampil, mengembalikan saldo kantong SESUDAH
-- masing-masing entri itu. Jendelanya dibatasi pada kantong-kantong yang
-- memang terlibat, bukan seluruh tabel.
--
-- Entri yang tidak berhak dilihat TIDAK dikembalikan barisnya — layar
-- menampilkannya sebagai "—". Mengembalikan 0 akan terbaca sebagai "kantongnya
-- kosong", yang berbeda jauh dari "angkanya tidak diketahui".
-- ---------------------------------------------------------
create or replace function saldo_berjalan_kas(p_ids uuid[])
returns table (id uuid, saldo numeric)
language sql
security definer
stable
set search_path = public
as $$
  with diminta as (
    select ce.id, ce.holder_id, ce.account_id
    from cash_entries ce
    where ce.id = any(coalesce(p_ids, '{}'::uuid[]))
      and boleh_lihat_saldo_kas(ce.holder_id)
  ),
  kantong as (
    select distinct holder_id, account_id from diminta
  ),
  berjalan as (
    select
      ce.id,
      sum(ce.amount) over (
        partition by ce.holder_id, ce.account_id
        order by ce.entry_date, ce.created_at, ce.id
        rows between unbounded preceding and current row
      ) as saldo
    from cash_entries ce
    join kantong k
      on k.holder_id = ce.holder_id
     -- `is not distinct from`, BUKAN `=`. Kantong NULL ("Kas Utama") adalah
     -- kantong yang sah dan punya saldonya sendiri di `cash_account_balances`;
     -- `=` tidak pernah cocok untuk NULL, jadi seluruh entri Kas Utama akan
     -- kehilangan saldonya tanpa satu pun galat.
     and k.account_id is not distinct from ce.account_id
    -- Dua aturan yang sama dengan view saldo kantong. Entri yang dicoret tidak
    -- pernah memindahkan uang, dan entri "Dibayar Pusat" tidak keluar dari
    -- kantong mana pun.
    where ce.dicoret_at is null
      and not ce.dibayar_pusat
  )
  select d.id, b.saldo
  from diminta d
  join berjalan b on b.id = d.id;
$$;

comment on function saldo_berjalan_kas(uuid[]) is
  'Saldo kantong SESUDAH tiap entri, dihitung atas seluruh riwayat kantongnya — bukan atas baris yang kebetulan lolos saringan layar.';

revoke all on function saldo_berjalan_kas(uuid[]) from public;
grant execute on function saldo_berjalan_kas(uuid[]) to authenticated;
revoke all on function boleh_lihat_saldo_kas(uuid) from public;
grant execute on function boleh_lihat_saldo_kas(uuid) to authenticated;

-- Jendela ini selalu dipartisi (holder_id, account_id) lalu diurutkan
-- entry_date — tanpa indeksnya, tiap pembukaan riwayat memindai seluruh tabel.
create index if not exists idx_cash_entries_saldo_berjalan
  on cash_entries (holder_id, account_id, entry_date, created_at, id)
  where dicoret_at is null;

notify pgrst, 'reload schema';
