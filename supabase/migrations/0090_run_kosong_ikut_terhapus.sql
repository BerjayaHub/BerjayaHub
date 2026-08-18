-- =========================================================
-- 0090 — Menghapus item terakhir harus ikut menghapus sesinya
--
-- ============ GEJALANYA ============
--
-- Staff menghapus satu-satunya item yang sudah dikerjakan. Fotonya hilang,
-- barisnya hilang — tapi di rekap Admin Portal sesinya MASIH ADA:
--
--   2026-08-18 14.21 | Central Kitchen | Opening | iko permadi (memulai sesi)
--                    | Bukti: –        | Catatan: -
--
-- Baris itu tidak menyatakan apa pun yang benar. Tidak ada pekerjaan, tidak
-- ada bukti — tapi bagi yang membaca rekap, "Opening · Central Kitchen · iko
-- permadi" terbaca sebagai sesi yang dijalankan. Rekap yang menghitung sesi
-- yang tidak pernah menghasilkan apa-apa lebih buruk daripada rekap kosong:
-- yang kosong menimbulkan pertanyaan, yang begini menimbulkan kesimpulan.
--
-- ============ KENAPA DIKERJAKAN TRIGGER, BUKAN DI APLIKASI ============
--
-- Menghapus item bisa datang dari beberapa jalur — staff menghapus miliknya
-- sendiri (0073), admin mengoreksi, dan jalur apa pun yang ditambahkan nanti.
-- Aturan "sesi tanpa item tidak boleh ada" harus berlaku di semuanya, dan
-- satu jalur yang lupa memanggil pembersihnya akan menghasilkan baris hantu
-- yang tidak pernah terlihat salah.
--
-- Ada alasan kedua yang lebih menentukan: `checklist_runs` TIDAK punya policy
-- DELETE. Kalau pembersihan dikerjakan aplikasi lewat PostgREST, penghapusan
-- itu ditolak RLS — dan PostgREST tidak menganggap penolakan RLS sebagai
-- error. Yang kembali adalah "sukses" dengan nol baris. Pembersih yang tidak
-- pernah membersihkan apa pun, tanpa satu pun tanda.
--
-- SECURITY DEFINER dipakai SEMPIT dan sengaja: fungsinya hanya bisa menghapus
-- run yang BENAR-BENAR sudah tidak punya item. Ia tidak menambah wewenang
-- siapa pun atas data yang masih berisi — untuk sampai ke sini, orangnya
-- sudah harus berhasil menghapus item terakhirnya lewat RLS yang normal.
-- =========================================================

create or replace function bersihkan_run_kosong()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- `not exists` diperiksa DI DALAM pernyataan hapusnya, bukan di baris
  -- terpisah. Kalau dipisah, ada celah untuk item baru disisipkan di antara
  -- pemeriksaan dan penghapusan — dan yang hilang adalah pekerjaan orang lain
  -- yang baru saja tersimpan.
  delete from checklist_runs r
  where r.id = old.run_id
    and not exists (select 1 from checklist_run_items i where i.run_id = r.id);
  return old;
end $$;

drop trigger if exists trg_bersihkan_run_kosong on checklist_run_items;
create trigger trg_bersihkan_run_kosong
  after delete on checklist_run_items
  for each row
  execute function bersihkan_run_kosong();

-- ---------------------------------------------------------
-- Sesi hantu yang sudah terlanjur ada.
--
-- Bukan hanya baris dari rekaman layar tadi: run kosong juga bisa lahir kalau
-- penyimpanan per item (0089) gagal di tengah — run-nya sudah dibuat
-- `pastikan_run_aktivitas()`, lalu penulisan itemnya batal.
--
-- Dibersihkan sekali di sini. Aman: yang dihapus HANYA yang tidak punya satu
-- pun item, jadi tidak ada bukti pekerjaan yang bisa ikut terbawa.
-- ---------------------------------------------------------
delete from checklist_runs r
where not exists (select 1 from checklist_run_items i where i.run_id = r.id);

-- ---------------------------------------------------------
-- Dipanggil aplikasi kalau penyimpanan item gagal sesudah run-nya terlanjur
-- dibuat — supaya sisa sesi kosongnya tidak menunggu sampai migration
-- berikutnya.
--
-- Penjaganya sama: hanya menghapus yang benar-benar kosong.
--
-- CATATAN JUJUR SOAL BALAPAN: kalau orang kedua kebetulan sedang di antara
-- `pastikan_run_aktivitas()` dan penulisan itemnya, run yang dia pegang bisa
-- terhapus di sini dan penulisannya gagal dengan pelanggaran foreign key. Yang
-- hilang cuma satu percobaan — dia mengulang, run barunya dibuat, dan
-- pekerjaannya tersimpan. Itu ditukar dengan tidak meninggalkan sesi hantu di
-- rekap, dan pertukarannya disengaja.
-- ---------------------------------------------------------
create or replace function hapus_run_kosong(p_run uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hapus int;
begin
  delete from checklist_runs r
  where r.id = p_run
    and not exists (select 1 from checklist_run_items i where i.run_id = r.id);
  get diagnostics v_hapus = row_count;
  return v_hapus > 0;
end $$;

revoke all on function hapus_run_kosong(uuid) from public;
grant execute on function hapus_run_kosong(uuid) to authenticated;

comment on function hapus_run_kosong(uuid) is
  'Hapus sesi Daily Activities yang tidak punya satu pun item. Hanya yang benar-benar kosong (0090).';

notify pgrst, 'reload schema';
