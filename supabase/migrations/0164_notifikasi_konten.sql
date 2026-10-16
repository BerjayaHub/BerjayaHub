-- =========================================================
-- 0164 — NOTIFIKASI TELEGRAM UNTUK SETORAN KONTEN
--
-- Satu trigger saja. Seluruh jalurnya sudah ada sejak 0043:
-- `notify_telegram_event()` mengirim payload Database-Webhook ke Edge Function
-- `notify-telegram`, yang memilih grup lewat `telegram_routes`.
--
-- ============ YANG DIAWASI ADALAH `konten_berkas`, BUKAN `konten_tugas` ============
--
-- Baris `konten_tugas` LAHIR SAAT LAYAR DIBUKA (0163) — bukan saat ada yang
-- disetor. Staff yang sekadar mengintip briefnya sudah membuat barisnya.
-- Memasang pemicunya di sana berarti grup menerima "Setoran Konten" untuk
-- outlet yang belum mengunggah apa pun, dan pesan yang beberapa kali ternyata
-- bohong adalah pesan yang berhenti dibuka.
--
-- `konten_berkas` hanya bertambah kalau ada berkas yang BENAR-BENAR sampai di
-- R2: layanannya mencatat barisnya SESUDAH PUT-nya berhasil. Jadi satu baris =
-- satu berkas yang sungguh ada.
--
-- ============ KENAPA TIDAK 'SAAT LENGKAP' SAJA ============
--
-- Keputusan pemiliknya: pesan dikirim tiap berkas. Konsekuensinya diterima
-- dengan sadar — sampai 3 pesan per outlet per minggu — dan sebagai gantinya
-- tidak ada setoran yang bisa lewat tanpa terlihat. Varian "hanya saat
-- lengkap" punya lubang yang tidak kelihatan: outlet yang mengunggah 1 video
-- lalu berhenti tidak memunculkan pesan apa pun, dan diamnya tidak bisa
-- dibedakan dari "belum ada yang setor".
--
-- Lubang itu ditutup dari sisi lain: `send-konten-reminders` yang menyebut
-- outlet yang belum setor di pagi hari tenggatnya.
-- =========================================================

-- `after insert` saja: berkas yang DIHAPUS tidak diumumkan. Staff mengganti
-- unggahannya adalah hal normal (0163 memberinya izin itu dengan sengaja), dan
-- mengumumkan tiap pembatalan mengubah grup jadi catatan perubahan.
drop trigger if exists trg_notify_konten_berkas on konten_berkas;
create trigger trg_notify_konten_berkas
  after insert on konten_berkas
  for each row execute function notify_telegram_event();

-- ============ KENAPA URUTAN TRIGGER TIDAK JADI MASALAH DI SINI ============
--
-- `trg_tandai_tugas_disetor` (0163) juga `after insert` pada tabel yang sama,
-- dan Postgres menjalankan trigger AFTER menurut URUTAN NAMA — jadi
-- `trg_notify_konten_berkas` berjalan LEBIH DULU daripada
-- `trg_tandai_tugas_disetor`.
--
-- Itu tidak merusak apa pun karena `notify_telegram_event` tidak membaca status
-- tugasnya: ia hanya menitipkan permintaan HTTP lewat pg_net. Baris antrean
-- pg_net ikut transaksi, jadi permintaannya baru BERANGKAT sesudah commit —
-- dan Edge Function membaca database dalam keadaan yang sudah final.
--
-- Ditulis di sini supaya orang berikutnya tidak memindahkan pemeriksaan status
-- ke dalam trigger, tempat ia akan membaca keadaan yang belum selesai.

comment on trigger trg_notify_konten_berkas on konten_berkas is
  'Kirim notifikasi Telegram tiap berkas konten masuk. Event key: konten_setor (dirutekan di Admin Portal -> Notifikasi Telegram).';

notify pgrst, 'reload schema';
