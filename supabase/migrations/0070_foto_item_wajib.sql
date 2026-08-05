-- =========================================================
-- 0070 — Item yang dicentang WAJIB punya foto (ditegakkan di database)
--
-- MASALAHNYA APA
-- Sejak 0052 aturan "setiap item yang dicentang harus ada fotonya" hanya hidup
-- di satu tempat: pemeriksaan di halaman staff sebelum tombol Kirim. Service
-- `submitChecklistRun()` menerima `checked: true, photo_path: null` tanpa
-- berkomentar, dan tabelnya tidak punya batasan apa pun.
--
-- Artinya aturan itu bukan aturan, melainkan kebiasaan. Siapa pun yang memanggil
-- API langsung — atau versi halaman yang tertinggal di cache HP seseorang —
-- bisa mengirim ceklis tanpa satu pun bukti, dan hasilnya masuk ke rekap
-- terlihat sama sahnya dengan yang lain.
--
-- Aturan yang hanya dijaga tampilan akan bocor cepat atau lambat, dan yang
-- paling merugikan bukan kebocorannya: melainkan kepercayaan pada rekap yang
-- ternyata tidak sekuat yang dikira.
--
-- `NOT VALID` — hanya berlaku untuk baris BARU.
-- Baris lama sengaja tidak diusik:
--   * run sebelum 0052 memang belum punya foto per item sama sekali;
--   * memvalidasi mundur akan menggagalkan migration hanya karena sejarah.
-- Riwayat pekerjaan justru yang paling tidak boleh diubah belakangan. Baris
-- lama yang "dicentang tanpa bukti" tetap terlihat apa adanya di rekap, dan
-- sekarang ditandai secara terbuka di layar.
-- =========================================================

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'checklist_run_items_foto_wajib') then
    alter table checklist_run_items add constraint checklist_run_items_foto_wajib
      check (checked = false or photo_path is not null)
      not valid;
  end if;
end $$;

comment on constraint checklist_run_items_foto_wajib on checklist_run_items is
  'Item yang dicentang wajib punya foto bukti. NOT VALID: hanya untuk baris baru — run sebelum 0052 belum punya foto per item.';
