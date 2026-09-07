-- =========================================================
-- Berjaya Hub OMS — 0126
-- Kantong kas ber-outlet boleh dibebani outlet LAIN di BU yang sama.
--
-- =========================================================
-- YANG DIMINTA
-- =========================================================
--
--   "untuk pembayaran tunai, saya ingin setiap outlet bisa memakai kas dari
--    outlet lain. contohnya, outlet sentul membeli ice batu, lalu memakai
--    kas CK"
--
-- `0120` membuka kantong kas untuk staff outlet YANG DISEBUT kantong itu.
-- Staff Sentul tidak punya cakupan di Central Kitchen, jadi Kas CK tidak
-- pernah muncul di daftarnya — dan kalau pun muncul, `boleh_membebani_kas`
-- akan menolaknya.
--
-- =========================================================
-- BATASNYA: SATU BU, DAN HARUS BER-OUTLET
-- =========================================================
--
-- Yang dibuka hanya kantong yang MENYEBUT outlet. Kantong tanpa outlet tetap
-- pribadi sepenuhnya — itu janji `0120`, dan orang yang memakainya sebagai kas
-- pribadi tidak boleh mendapati saldonya berkurang karena keputusan yang tidak
-- pernah ia ambil.
--
-- Dan hanya dalam SATU BU. Kas antar-BU adalah pertanyaan yang berbeda: ia
-- menyangkut siapa menanggung biaya siapa antar badan usaha, dan jawabannya
-- bukan "siapa saja yang kebetulan punya cakupan".
--
-- =========================================================
-- YANG SENGAJA TIDAK BERUBAH: BEBAN BIAYANYA
-- =========================================================
--
-- Es batunya masuk stok Sentul, jadi biayanya tetap beban SENTUL. Yang
-- berpindah cuma uangnya, dari kantong CK.
--
-- Itu memang sudah bentuknya: `bayar_nota` dan `catat_kas_di` mengambil
-- `outlet_id` entri kas dari NOTA/pemanggilnya, bukan dari kantongnya. Tidak
-- ada satu baris pun di sini yang menyentuhnya — dan itu dicatat justru supaya
-- tidak ada yang "merapikannya" nanti dengan mengikutkan outlet kantong.
--
-- =========================================================
-- HARGA DARI PELONGGARAN INI, DIKATAKAN TERUS TERANG
-- =========================================================
--
-- Sesudah ini, siapa pun yang bertugas di BU ini bisa mengurangi kas siapa pun
-- yang kantongnya diberi outlet. Pemegangnya tetap yang menanggung selisih
-- kalau uang fisiknya tidak cocok.
--
-- Yang menahannya bukan izin, melainkan JEJAK: tiap entri mencatat
-- `created_by`, dan layar Kas menandai kantong yang terbuka. Kalau suatu saat
-- itu terasa kurang, bentuk berikutnya adalah saklar per kantong — bukan
-- mencabut pelonggaran ini diam-diam.
-- =========================================================

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
      left join outlets o on o.id = a.outlet_id
     where a.id = p_account
       -- Kantong yang sudah ditutup tidak bisa dibebani siapa pun.
       --
       -- PERLU DICATAT JUJUR: untuk `catat_kas_di` baris ini BUKAN penjaganya
       -- — fungsi itu memeriksa `is_active` sendiri, dengan pesan yang lebih
       -- tepat. Ia load-bearing bagi pemanggil LAIN yang menanyakan izin tanpa
       -- menulis apa pun: layar yang memutuskan tombol mana yang digambar, dan
       -- pembayaran nota di 0122.
       and a.is_active
       and (
         a.holder_id = p_uid
         -- Staff outlet yang disebut kantong itu (0120).
         or (a.outlet_id is not null and has_outlet_scope(p_uid, a.outlet_id))
         -- BARU DI 0126: siapa pun yang bertugas di BU pemilik outlet itu.
         --
         -- `has_bu_scope`, BUKAN `has_outlet_scope`. Itulah seluruh isi
         -- perubahan ini: staff Sentul tidak punya cakupan di Central Kitchen,
         -- tapi keduanya outlet BU yang sama.
         --
         -- Tetap mensyaratkan `a.outlet_id is not null`. Kantong tanpa outlet
         -- adalah kas pribadi, dan janji `0120` bahwa ia tetap tertutup tidak
         -- boleh dicabut lewat pintu belakang.
         or (a.outlet_id is not null and has_bu_scope(p_uid, o.business_unit_id))
         or is_super_admin(p_uid)
       )
  );
$$;

comment on function boleh_membebani_kas(uuid, uuid) is
  'Apakah user boleh mencatat entri pada kantong kas ini. Pemegang selalu boleh; kantong BER-OUTLET boleh dibebani siapa pun yang punya cakupan di BU outlet itu (0126); kantong tanpa outlet tetap pribadi.';

-- ---------------------------------------------------------
-- BACA: kantong ber-outlet terlihat oleh seluruh BU-nya.
--
-- Tanpa ini pelonggaran di atas TIDAK BERARTI APA-APA. Kebijakan `0120`
-- (`cash_accounts_baca_outlet`) hanya membuka kantong untuk staff outlet yang
-- disebut kantong itu, jadi daftar "kas mana yang boleh kubebani" milik staff
-- Sentul tetap tidak memuat Kas CK — izinnya ada, kantongnya tak terlihat, dan
-- yang tampil di layar adalah "tidak ada kas yang bisa kamu bebani".
--
-- Bentuk kegagalan yang sudah terjadi dua kali di repo ini (0120, lalu 0121):
-- kemampuannya ada di database, jalannya tidak ada di layar.
-- ---------------------------------------------------------
drop policy if exists cash_accounts_baca_bu on cash_accounts;
create policy cash_accounts_baca_bu on cash_accounts
  for select to authenticated
  using (
    -- PERLU DICATAT JUJUR: baris ini BUKAN penjaganya.
    --
    -- Untuk kantong tanpa outlet, sub-query di bawah menghasilkan NULL, dan
    -- `has_bu_scope(uid, NULL)` sudah false dengan sendirinya. Sabotase yang
    -- membuang syarat ini TIDAK membuat tesnya merah, dan itu memang benar —
    -- kantong pribadi tetap tak terlihat.
    --
    -- Dipertahankan sebagai pertahanan berlapis: kalau suatu saat
    -- `has_bu_scope` berubah bentuk, atau `cash_accounts_own` dipersempit,
    -- baris inilah yang tetap menyatakan maksudnya secara langsung alih-alih
    -- menggantungkannya pada perilaku NULL di fungsi lain.
    outlet_id is not null
    and has_bu_scope(auth.uid(), (select o.business_unit_id from outlets o where o.id = cash_accounts.outlet_id))
  );

notify pgrst, 'reload schema';
