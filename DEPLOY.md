# Deploy — checklist sesi ini

Urutannya **penting**: migration dulu, baru Edge Function, baru push kode.
Function yang di-deploy sebelum migration-nya jalan akan error saat memanggil
kolom/tabel yang belum ada — dan errornya muncul di runtime, bukan saat deploy.

---

## 1. Migration (SQL Editor Supabase, urut dari atas)

Jalankan satu per satu. Semuanya **idempotent** — aman kalau ada yang terlanjur
pernah dijalankan.

| # | File | Isinya |
|---|---|---|
| 0047 | `0047_push_status_for_admin.sql` | RPC status langganan push → penanda 🔕 di rekap presensi |
| 0048 | `0048_module_tutorials.sql` | Tabel video tutorial per modul |
| 0049 | `0049_user_email.sql` | Kolom `email` di `user_profiles` + trigger sinkron dari `auth.users` |
| 0050 | `0050_asset_photo_rls_fix.sql` | **Perbaikan bug**: foto Inventaris Aset gagal diunggah |
| 0051 | `0051_list_outlet_staff.sql` | RPC daftar staff per outlet (Jadwal Shift) |
| 0052 | `0052_checklist_photo_per_item.sql` | Daily Activities: foto per item |
| 0053 | `0053_bu_staff_for_admin.sql` | **Perbaikan bug**: Laporan & Jatah Cuti hanya berisi 1 orang untuk admin outlet |
| 0054 | `0054_checklist_outlet_scope.sql` | **Perbaikan bug**: admin outlet tidak bisa isi item Daily Activities |
| 0055 | `0055_reservation_hotel_mode.sql` | Mode reservasi **hotel** + tipe kamar + anti double-booking |
| 0056 | `0056_staff_check_in.sql` | Ceklis check-in oleh staff |
| 0057 | `0057_user_email_on_insert.sql` | **Perbaikan bug**: email user baru kosong di Master User (+ backfill) |
| 0058 | `0058_sembunyikan_staff_nonaktif.sql` | Staff nonaktif hilang dari daftar pilihan, tetap ada di laporan |
| 0059 | `0059_divisi.sql` | Divisi per BU + kolom divisi di scope; tabel shift & rekap presensi dikelompokkan |
| 0060 | `0060_kas_qty_unit_dan_laporan.sql` | Kas: jumlah + satuan, nota wajib, RPC Laporan Kas per Pemegang |
| 0061 | `0061_profil_terlihat_outlet_admin.sql` | **Perbaikan bug**: admin outlet melihat "-" di kolom nama pada Rekap Presensi & NBM |
| 0062 | `0062_koreksi_outlet_basis.sql` | Koreksi outlet basis pada presensi yang sudah tersimpan (satuan & massal) |
| 0063 | `0063_kas_sub_akun_dan_outlet.sql` | Kas: kantong (sub-kas) per user, outlet **peruntukan** pada kas keluar, pindah antar kantong, Laporan Kas dengan filter kategori |
| 0064 | `0064_otp_tugas_luar_admin_outlet.sql` | **Perbaikan bug**: admin outlet tidak bisa menerbitkan kode OTP Tugas Luar; `created_by` kode kini terisi |
| 0065 | `0065_batas_kantong_kas_hanya_admin.sql` | **Perbaikan bug**: jatah kantong kas bisa dinaikkan sendiri oleh yang bersangkutan |
| 0066 | `0066_hapus_kantong_kas.sql` | Hapus kantong kas: isinya dipindahkan ke kantong lain dulu, saldo total tidak berubah |
| 0067 | `0067_peringatan_jadwal_kosong.sql` | Dedupe peringatan "jadwal shift besok masih kosong" ke admin |
| 0068 | `0068_daily_activities_terlihat_satu_outlet.sql` | **Perbaikan bug**: staff hanya melihat Daily Activities miliknya sendiri, sehingga sesi dikerjakan dua kali |
| 0069 | `0069_item_per_sesi.sql` | Item aktivitas bisa berbeda per sesi (tanpa penugasan = berlaku di semua sesi) |
| 0070 | `0070_foto_item_wajib.sql` | **Perbaikan bug**: item yang dicentang bisa dikirim tanpa foto — aturannya hanya ada di tampilan |
| 0071 | `0071_lanjutkan_sesi_aktivitas.sql` | **Perbaikan bug**: mengisi 1 item mengunci seluruh sesi seharian; sesi kini bisa dilanjutkan, tiap item punya pengerjanya sendiri |
| 0072 | `0072_lanjutkan_baris_lama.sql` | **Perbaikan bug**: sesi yang dibuat SEBELUM 0071 tetap terkunci, karena baris "tidak dicentang" ikut terhitung selesai |
| 0073 | `0073_staff_koreksi_item_sendiri.sql` | Staff bisa memperbaiki & menghapus item yang **dia sendiri** kerjakan, **hari itu juga**; pemilik run tidak lagi bisa menyunting bukti rekannya |
| 0074 | `0074_hitung_ulang_status_shift.sql` | RPC hitung ulang status terlambat untuk presensi yang terlanjur "Tanpa jadwal" (jadwal disusun setelah orangnya clock in) + versi massal |
| 0075 | `0075_akurasi_lokasi_presensi.sql` | Simpan **ketelitian** GPS saat clock in/out, supaya keluhan "saya di outlet tapi ditolak" bisa ditelusuri |
| 0076 | `0076_item_multi_outlet.sql` | Item Daily Activities bisa berlaku di **beberapa outlet** (mis. Serpong + Sentul, CK tidak) |
| 0077 | `0077_jam_reservasi_fleksibel_dan_syarat.sql` | Jam reservasi bebas (kuota dihitung per slot), + **Syarat & Ketentuan per outlet** dan pencatatan persetujuannya |
| 0078 | `0078_reservasi_dp_dan_koreksi.sql` | **DP + foto bukti transfer**, bucket `reservation-proofs`, dan RPC koreksi/reschedule reservasi dengan kuota dihitung ulang |
| 0079 | `0079_dp_dari_staff_app.sql` | **DP bisa dicatat dari Staff App** (RPC `catat_dp_reservasi`), kolom `deposit_by`, nominal 0 = hapus DP, dan bukti transfer tidak lagi bisa ditimpa sembarang orang |
| 0080 | `0080_batas_pesan_h_min.sql` | **Batas pemesanan H- sekian HARI** + jam batas di hari itu (bukan cuma H- sekian jam), berlaku di jalur website |
| 0081 | `0081_outlet_yang_saya_kelola.sql` | **Perbaikan bug**: admin outlet dapat *"new row violates row-level security policy"* saat mengatur Jadwal Shift — dropdown-nya memakai daftar outlet yang boleh DILIHAT, bukan yang boleh DIATUR |

> ⚠️ Kalau `0074` sudah terlanjur dijalankan sebelum 7 Agustus sore, **jalankan
> ulang** — versi pertamanya memakai `ss.created_at`, kolom yang tidak ada di
> `shift_schedules`, sehingga tombol ↻ selalu gagal dengan
> *"column ss.created_at does not exist"*.

> ⚠️ `0063` mendefinisikan ulang `laporan_kas_user()` dengan **parameter baru**
> (`p_category`). Versi lama (4 argumen) di-`drop` di awal file — halaman Laporan
> yang masih terbuka di browser lain akan error sampai di-refresh.

> ⚠️ `0055` mendefinisikan ulang `list_attendance_outlets()`. Kalau ada yang
> sedang membuka aplikasi saat migration jalan, minta dia refresh setelahnya.

---

## 2. Edge Functions

### WAJIB — isinya berubah di sesi ini

```bash
supabase functions deploy notify-reservation
supabase functions deploy send-reservation-digest
supabase functions deploy submit-reservation
supabase functions deploy purge-old-selfies
```

### WAJIB juga — pesan error sesi diperbaiki

```bash
supabase functions deploy create-staff-user
supabase functions deploy reset-staff-password
```

> `submit-reservation` di daftar di atas **harus di-deploy setelah `0080`**.
> Tanpa deploy ulang, tamu yang memesan di luar batas H- tetap ditolak (aturannya
> sudah di database), tapi kalimatnya masih *"penuh atau terlalu mepet"* — dan
> tamu yang sebenarnya cuma perlu memundurkan tanggal akan menyimpulkan
> tempatnya penuh, lalu pergi.

### WAJIB — perbaikan ambang reminder shift dekat tengah malam

```bash
supabase functions deploy send-attendance-reminders
```

### BARU — peringatan jadwal shift kosong

```bash
supabase functions deploy send-shift-gap-alerts
```

### OPSIONAL — hanya baris import yang berubah

```bash
supabase functions deploy send-fleet-reminders
supabase functions deploy send-test-push
supabase functions deploy notify-telegram
```

Yang sudah ter-deploy **tetap jalan normal** — dependensinya ikut ter-bundle
saat deploy dulu, jadi esm.sh tidak disentuh lagi saat function berjalan.

Tapi perubahan `npm:` baru berlaku pada **deploy berikutnya**. Kalau ditunda,
suatu saat kamu perlu memperbaiki bug di salah satunya dengan buru-buru — dan
justru di saat itulah kamu harus bertengkar dengan esm.sh. Lebih baik
dibereskan saat tidak sedang mendesak.

### Kenapa `npm:`, bukan `esm.sh`

Deploy berkali-kali gagal dengan pesan seperti:

```
Failed to bundle the function (reason: Fetch 'https://esm.sh/@supabase/supabase-js@2' timed out after 10s
```

Itu **bukan masalah kode**. esm.sh mem-bundle paket secara *on-the-fly* setiap
kali deploy; kalau layanannya sedang lambat, deploy gagal — lalu berhasil kalau
diulang, lalu gagal lagi besok. Tidak ada yang bisa diperbaiki dengan mengulang.

Specifier `npm:` diresolusi Deno lewat registry npm langsung, tanpa perantara.
Bukti bahwa ini jalan di project ini: `npm:web-push@3.6.7` sudah dipakai sejak
awal dan **tidak pernah** bermasalah. Seluruh function kini disamakan ke pola itu.

`WARNING: Docker is not running` boleh diabaikan — bundling dikerjakan di server
Supabase, bukan di komputermu.

---

## 3. Push kode ke GitHub Pages

```bash
git add .
git commit -m "Kantong kas + outlet peruntukan, kolom nama dibekukan, tutorial di Beranda, perbaikan OTP tugas luar & export Data Staff"
git push origin master
```

---

## 4. Cron baru (SQL Editor, sekali saja)

Hanya kalau **belum** pernah dipasang. Cek dulu:

```sql
select jobname, schedule, active from cron.job;
```

### Pembersih foto 90 hari (BARU — belum pernah ada)

```sql
select cron.schedule(
  'purge-old-selfies',
  '30 18 * * *',                       -- 18:30 UTC = 01:30 WIB
  $$
  select net.http_post(
    url     := 'https://<PROJECT-REF>.supabase.co/functions/v1/purge-old-selfies',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer <anon key>',
      'x-cron-secret', '<CRON_SECRET>'
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
```

### Peringatan jadwal shift kosong (BARU)

Sekali sehari sore hari, memeriksa apakah jadwal **besok** sudah ada.

```sql
select cron.schedule(
  'shift-gap-alerts',
  '0 10 * * *',                        -- 10:00 UTC = 17:00 WIB
  $$
  select net.http_post(
    url     := 'https://<PROJECT-REF>.supabase.co/functions/v1/send-shift-gap-alerts',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer <anon key>',
      'x-cron-secret', '<CRON_SECRET>'
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
```

Uji dulu tanpa mengirim apa pun ke siapa pun:

```sql
select net.http_post(
  url := 'https://<PROJECT-REF>.supabase.co/functions/v1/send-shift-gap-alerts',
  headers := jsonb_build_object('Content-Type','application/json',
    'Authorization','Bearer <anon key>', 'x-cron-secret','<CRON_SECRET>'),
  body := '{"dry_run":true}'::jsonb, timeout_milliseconds := 30000);
-- lalu baca jawabannya:
-- select left(content, 800) from net._http_response order by id desc limit 1;
```

### Rekap reservasi harian

```sql
select cron.schedule(
  'reservation-digest',
  '0 0 * * *',                         -- 00:00 UTC = 07:00 WIB
  $$
  select net.http_post(
    url     := 'https://<PROJECT-REF>.supabase.co/functions/v1/send-reservation-digest',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer <anon key>',
      'x-cron-secret', '<CRON_SECRET>'
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
```

> ⚠️ Header **`Authorization` wajib**. Tanpa itu gerbang Supabase membalas
> `401` sebelum kode function jalan — sementara `cron.job_run_details` tetap
> melaporkan `succeeded`, karena bagi pg_net permintaannya memang terkirim.
> Ini yang dulu membuat reminder clock-in diam berminggu-minggu.

---

## 5. Verifikasi setelah deploy

```sql
-- Semua cron sukses?
select j.jobname, d.status, d.start_time, d.return_message
from cron.job_run_details d join cron.job j on j.jobid = d.jobid
order by d.start_time desc limit 10;

-- Apa JAWABAN function-nya? (401 di sini = header Authorization hilang)
select id, status_code, timed_out, error_msg, left(content, 300), created
from net._http_response order by id desc limit 5;
```

Uji tanpa menghapus/mengirim apa pun:

```sql
-- Pembersih foto: lihat berapa yang AKAN dihapus
select net.http_post(
  url := 'https://<PROJECT-REF>.supabase.co/functions/v1/purge-old-selfies',
  headers := jsonb_build_object('Content-Type','application/json',
    'Authorization','Bearer <anon key>', 'x-cron-secret','<CRON_SECRET>'),
  body := '{"dry_run":true}'::jsonb, timeout_milliseconds := 30000);
```

---

## 6. Yang perlu diatur lewat UI setelah deploy

- **BU & Outlet → Edit Outlet → Mode Reservasi** → pilih *Hotel* untuk outlet hotel.
- **Reservasi Hotel → Tipe Kamar** → isi tipe + jumlah unit (mis. Deluxe = 2).
  Booking belum bisa dibuat sebelum ini terisi.
- **Video Tutorial** (menu baru, super admin) → tempel link YouTube **Unlisted**.
- Cek **Master User** → kolom Email terisi. Kalau kosong untuk *semua* orang,
  berarti `0049` belum jalan.
- **Kas** → form **Kas Masuk** dan **Kas Keluar** kini berbeda:
  - *Kas Masuk*: jumlah uang, keterangan, tanggal, foto **opsional**.
  - *Kas Keluar*: kategori, **outlet peruntukan (wajib, boleh lintas BU)**,
    jumlah + satuan, dan **foto nota wajib**. Pilihan outletnya mencakup semua BU
    tempat user punya peran, dengan nama BU tertulis di depannya.
- **Kantong kas (sub-kas)** → **Master User → Edit** pada staff yang bersangkutan →
  isian *Jumlah kantong kas*.
- **Kas (Staff App) → 🏷️ Kelola Kas** → panel daftar kantong: **✎ ubah nama** dan
  **🗑 hapus** per kantong, plus tombol tambah. Ubah nama berlaku surut ke seluruh
  laporan; hapus akan meminta kantong tujuan dan memindahkan seluruh isinya ke sana.
- **Kas → ⇄ Pindah Kas** → **"Kas Utama"** kini ikut jadi pilihan asal/tujuan.
  Uang yang dicatat sebelum kantong pertama dibuat tersimpan di sana; sebelum ini
  saldo tersebut terlihat tapi tidak bisa dipindahkan ke mana pun.
  Default `1` → tampilannya persis seperti sebelumnya, tanpa istilah baru.
  Kalau > 1, user menamai sendiri kantongnya (mis. *Kas Owner*, *Kas Operasional*),
  bisa memilih kantong saat mencatat, dan bisa **memindahkan** saldo antar kantongnya.
- **Laporan → Kas per Pemegang** → filter pemegang + outlet + **kategori** + periode,
  **Export PDF & Excel**. Kolom Outlet sekarang adalah **peruntukan** yang dipilih
  saat mencatat kas keluar, bukan lagi turunan tempat kerja utama (★).
  Baris kas masuk tidak punya peruntukan, jadi menyaring per outlet menyisihkannya.
- **Presensi → Mode Tugas Luar** → kalau dipilih *OTP*, admin **outlet** kini juga
  bisa menerbitkan kode (sebelumnya hanya admin BU — tombolnya ada tapi ditolak RLS).
  Mode ini mengikuti **BU basis (★)** staff, bukan BU yang sedang dibuka di portal.
- **Kas (Staff App) → Riwayat Kas** → tombol **⇩ Export PDF** (portrait), berisi
  kolom **Nota** sebagai foto. Fotonya diperkecil dulu, jadi PDF-nya tetap ringan.
- **Tampilan memuat** → seluruh layar "Memuat…" kini berupa animasi (kerangka untuk
  tabel, pemutar untuk halaman penuh). Tidak ada yang perlu diatur; kalau setelah
  deploy ada layar yang tampak polos tanpa animasi, berarti `css/styles.css` belum
  ikut ter-push.
- **Rekap Presensi** → baris berstatus **"Tanpa jadwal"** (atau kosong) kini punya
  tombol **↻** di kolom Shift. Tekan setelah jadwalnya dibuat, statusnya dihitung
  ulang dari jadwal yang berlaku. Baris yang sudah dinilai (Tepat waktu /
  Terlambat / dst) **tidak** diberi tombol — penilaian yang sudah terjadi bukan
  sesuatu yang pantas diubah dengan satu ketukan.
- **Reservasi → Semua Reservasi** → tiap baris punya **✎ Koreksi** (ubah nama,
  telepon, tanggal, jam, jumlah tamu, area, catatan, **DP + foto bukti
  transfer**) dan **🗑 Hapus**. Reschedule ke slot yang penuh **ditolak** —
  kuotanya dihitung ulang, bukan diterima diam-diam.
  Untuk pembatalan biasa lebih baik ubah **status** jadi Dibatalkan; jejaknya
  tetap ada untuk rekap.
- **Reservasi → Pengaturan & Area** → ada **Minimal pesan H- (hari)** + **Batas
  jam di hari itu**. Dihitung per **tanggal kalender**, seperti orang mengucapkan
  "H-3" — bukan 72 jam. H-3 dengan batas 17.00 = reservasi tanggal 20 ditutup
  tanggal 17 pukul 17.00; memesan tanggal 16 malam tetap diterima. Kosongkan
  jamnya kalau boleh sampai akhir hari. Butuh `0080`.
  ⚠️ Batasnya **hanya berlaku di website**, sama seperti batas H- jam selama ini —
  `create_reservation` dari Staff App memang tidak pernah memeriksa lead time.
  Staff tetap bisa mencatat reservasi mendadak, dan diberi tahu kalau tanggal itu
  sudah ditutup untuk publik.
- **Reservasi → Pengaturan & Area** → ada kotak **Syarat & Ketentuan** per outlet.
  ⚠️ **Isi dulu sebelum dipakai** — teks inilah yang ikut di pesan WhatsApp
  konfirmasi, form Staff App, dan halaman publik. Gading Serpong dan Sentul diisi
  masing-masing.
- **Shift → Jadwal** → dropdown outletnya kini berisi outlet yang benar-benar
  boleh **diatur** akun itu (RPC `outlets_saya_kelola`, memakai `is_admin_of_outlet()`
  yang sama dengan RLS). Butuh `0081`.
  ⚠️ Kalau setelah update daftarnya jadi **kosong** dan muncul pesan "belum
  tercatat sebagai admin outlet di satu pun", itu bukan aplikasi yang rusak —
  itu penyebab error lamanya, sekarang terbaca. Perbaikannya di **Master User**:
  scope orang tersebut harus menyebut **outlet**-nya. Peran "Admin Outlet" yang
  scope-nya dibuat di level BU (tanpa outlet) tidak memberi wewenang atas outlet
  mana pun — dia hanya bisa *melihat*.
- **Master Produk → Resep** → tabelnya kini **bisa dibuka per baris**: ketuk
  produk untuk melihat bahan tiap varian, dengan tombol **+ Isi resep** /
  **✎ Ubah resep** di dalamnya. Template impor bertambah kolom **Varian**
  (Produksi / Standalone / Dilayani CK) — **unduh ulang template-nya**, karena
  file lama tanpa kolom itu akan selalu masuk ke varian bawaan.
  ⚠️ Resep hanya bisa disimpan **Admin BU / Super Admin** (policy
  `recipes_modify`). Untuk yang lain, tombol ubah & impor tidak ditampilkan.
  Tidak ada migration.
- **Import Resep** → nama bahan kini dicocokkan setelah dibakukan (spasi ganda,
  spasi tanpa pemisah, karakter tak terlihat, huruf beraksen). Kalau tetap tidak
  ketemu, pesannya menyebut **nama terdekat**. Koma desimal (`0,5`) juga sudah
  terbaca benar — sebelumnya jadi `5`.
  ⚠️ Kalau ada resep yang sudah terlanjur diimpor dari **CSV** dengan angka
  berkoma, jumlahnya bisa 10× lipat. Periksa lewat tabel Resep (ketuk barisnya),
  dan perbaiki lewat **✎ Ubah resep**.
- **Import Produk** → baris yang kolom **Nama**-nya kosong kini **dilaporkan**
  (dulu hilang tanpa masuk hitungan mana pun — itu sebabnya tidak ada laporan
  produk yang gagal). Pesan error menyebut **nomor baris**. Satuan yang belum
  ada di Master Satuan **ditambahkan otomatis**; kalau yang mengimpor bukan
  Super Admin, penambahannya ditolak tapi **impornya tetap jalan** — produknya
  tersimpan dengan satuan itu, hanya belum muncul di dropdown.
- **Master Produk → Produk & Resep** → ada **kotak cari nama** di atas tabel.
- **Menu** → tabelnya kini **bisa dibuka per baris** (bahan tiap varian tampil di
  tempat), tombolnya **+ Isi resep** / **✎ Ubah resep**, dan ada **Template Menu**
  untuk menambah menu massal lewat Master Produk → Import Excel.
  ⚠️ **Harga jual hanya bisa diubah Admin BU / Super Admin.** Sebelumnya kolom
  harga tetap bisa diketik oleh siapa pun yang membuka layarnya, muncul
  "Harga jual diperbarui", dan **tidak ada yang tersimpan**. Kalau ada harga
  yang terasa "tidak mau berubah" belakangan ini, periksa ulang harganya
  sekarang. Tidak ada migration.
- **Kembali dari aplikasi lain** → posisi gulir & sub-layar terakhir dipulihkan
  (berlaku 30 menit). Sebelumnya hanya modulnya. Tidak ada migration.
- ⚠️ **Tombol Back / navigasi (seluruh aplikasi)** → empat perbaikan sekaligus:
  selesai mengisi form **tidak lagi melompat ke Beranda**; pop-up "lanjutkan
  mengisi" **tidak lagi muncul berulang**; layar yang menggambar ulang dirinya
  (mis. sesi Daily Activities setelah kirim/perbaiki/hapus) **tidak lagi
  menumpuk ketukan Back**; dan tombol 🏠 **tidak lagi meninggalkan ketukan Back
  yang tidak melakukan apa-apa**. Murni kode, **tidak ada migration**.
- ⚠️ **Daily Activities (Staff App)** → **perbaikan regresi.** Sapuan sebelumnya
  membuat modul ini mati untuk seluruh staff ("Belum ada outlet untukmu di BU
  ini"). **Push kode terbaru sebelum staff memakainya lagi.** Tidak ada migration.
- **Reservasi (Admin Portal)** → tab **Pengaturan & Area** kini hanya menampilkan
  outlet yang benar-benar bisa kamu atur. Di tab **Perlu Diproses** dan **Semua
  Reservasi**, baris milik outlet lain tetap terlihat tapi **tombol aksinya
  dicabut** — dulu tombolnya ada, ditekan, dan "berhasil" tanpa mengubah apa pun.
- **Presensi (Admin Portal)** → tombol **Atur Lokasi** & **Atur Jam Kerja** hanya
  muncul untuk **Admin BU / Super Admin**, sesuai policy `outlets_update`. Sama
  untuk **Simpan Libur Outlet** di Pengaturan NBM. Tidak ada migration.
- **Reservasi (Staff App)** → daftarnya **langsung tampil** saat modul dibuka,
  bawaan **hari ini → akhir bulan ini**, dan ikut berubah begitu tanggalnya
  diganti (tombol "Tampilkan" dihapus). Tanggal yang sudah lewat sengaja tidak
  ikut; untuk melihat awal bulan depan pakai pintasan **30 hari**.
- **Reservasi (Staff App) → DP** → nominal DP + foto bukti transfer bisa diisi
  langsung di form Reservasi Baru, atau belakangan lewat tombol **💰 Catat DP**
  di kolom DP. Bukti yang sudah ada dibuka lewat **📎**.
  ⚠️ Staff hanya bisa **mengisi DP yang masih kosong**, di reservasi yang **dia
  buat sendiri** atau yang **datang dari website** (reservasi website tidak punya
  pembuat). Mengubah DP yang sudah tercatat adalah pekerjaan admin (Reservasi →
  Semua Reservasi → ✎ Koreksi), dan di sana **mengosongkan kolom DP = menghapus
  DP-nya**. Butuh `0079`.
- **Reservasi → form staff** → **Jam kini bebas** (tidak harus .00). Sisa kursi
  slotnya tampil sebagai keterangan setelah tanggal & jam dipilih.
  ⚠️ `0077` mengganti `create_reservation` dengan versi 11 argumen dan
  **men-drop yang 10 argumen** — halaman lama yang masih terbuka akan error
  sampai di-refresh.
- **Penanda offline** muncul di atas layar saat permintaan benar-benar gagal
  (bukan sekadar `navigator.onLine`), dan hilang setelah ada permintaan yang
  berhasil. Balasan 403/500 **tidak** dianggap offline.
- **Posisi gulir dipertahankan** setelah aksi yang menggambar ulang daftar.
- **Tombol aksi kebal ketukan ganda** — 44 tombol yang mengubah data kini
  terkunci selama prosesnya berjalan. **Tidak ada migration.**
- **Konfirmasi sebelum meninggalkan isian** — Back dari modul saat ada yang
  diketik akan bertanya dulu ("Tinggalkan" / "Lanjut mengisi").
- **Tombol Back perangkat** kini ditangani: dari modul kembali ke **Beranda**
  (Staff) / **Dashboard** (Admin), dari dialog menutup dialognya. Sebelum ini
  Back **keluar dari aplikasi**. **Tidak ada migration** — murni kode.
- **Presensi (Staff App) → deteksi lokasi** dirombak: pencarian lebih sabar
  (sampai 20 dtk, akurasi tinggi, berhenti lebih awal kalau sudah ±50 m), pesan
  kegagalan **per jenis** (izin ditolak / GPS mati / kelamaan), tombol **↻ Coba
  Deteksi Lagi**, dan banner menyebut **jarak ke outlet terdekat + ketelitian**.
  Presensi diterima juga kalau lingkaran ketelitian menyentuh area outlet
  (maksimal ±250 m) — angkanya tercatat, jadi bukan kelonggaran diam-diam.
- **Rekap Presensi** → kolom Clock In menampilkan `±N m` (merah) kalau ketelitian
  GPS-nya di atas 100 m.
- **Presensi (Staff App)** → shift lintas tengah malam kini bisa **clock out
  esok paginya** (masuk 6 Agu 22:00 → pulang 7 Agu 07:00, terhitung 1 hari kerja
  di tanggal 6). Tidak perlu jadwal shift. Sesi yang lebih dari **18 jam** belum
  ditutup dianggap tertinggal: tidak memblokir presensi hari ini, tapi
  ditampilkan sebagai peringatan supaya diminta koreksi ke admin.
  **Ini murni perubahan kode — tidak ada migration.**
- **Daily Activities (Staff App)** → kartu sesi yang sudah selesai kini
  menampilkan **nama pengerja + jam** dan bisa diketuk untuk melihat rincian +
  foto bukti tiap item. Ada pemilih **tanggal** untuk melihat hari sebelumnya.
  ⚠️ Setelah `0068` jalan, sesi yang dulu terlanjur dikerjakan dua kali akan
  mulai terlihat di rekap — itu jejak bug lama, bukan bug baru.
- **Daily Activities (Admin Portal → Rekap)** → ada kolom **Bukti** berisi
  thumbnail foto per item.
- **Daily Activities (Staff App)** → ⚠️ `0071` **belum cukup** tanpa `0072`.
  Sesi yang sudah terlanjur dibuat sebelumnya tetap terkunci sampai `0072` jalan
  — jalankan keduanya. Di form lanjutan, item yang sudah dikerjakan tetap tampil
  **terkunci** beserta foto, nama pengerja, dan jamnya; pengerjaan menempel pada
  **item**, bukan pada sesi. Kolom "Oleh" di rekap admin = yang **memulai** sesi.
  Item yang sudah dikerjakan **tidak lagi hilang** dari ceklis — tetap tampil
  sebagai informasi (foto, pengerja, jam), dan yang miliknya sendiri punya
  tombol **✎ Perbaiki** dan **🗑 Hapus** (hari itu juga saja).
  Kartu sesi kini menampilkan **kemajuan**
  (`3/15 item`) dan ikon ⏳ untuk sesi yang baru sebagian. Diketuk → melanjutkan
  item yang belum dikerjakan; item yang sudah punya bukti dikunci. Rekan satu
  outlet boleh melanjutkan (pergantian shift), dan tiap item tercatat atas nama
  pengerjanya sendiri.
- **Daily Activities** → aturan "item yang dicentang wajib berfoto" kini juga
  ditegakkan **di database**, bukan hanya di layar. Setelah `0070`, baris lama
  yang dicentang tanpa bukti tetap ada (tidak divalidasi mundur) tapi ditandai
  merah **"tanpa bukti"** di detail rekap, dibedakan dari item yang memang
  **"tidak dikerjakan"**.
- **Daily Activities (Admin Portal → Item)** → **"Berlaku di"** kini punya dua
  mode: *Semua outlet BU* atau *Outlet tertentu* dengan **centang beberapa
  outlet** (mis. Serpong + Sentul, CK tidak). Item yang dicentang **satu** outlet
  tetap dimiliki outlet itu (admin outletnya bisa mengelola); yang **lebih dari
  satu** jadi milik BU dan hanya bisa diatur **admin BU**.
  ⚠️ Data lama tidak berubah sama sekali sampai kamu menyentuhnya.
- **Daily Activities (Admin Portal → Item & Sesi)** → kolom **"Berlaku di"** kini
  bisa diubah lewat **Edit**, tidak lagi terkunci sejak dibuat. Ada konfirmasi
  yang menyebut dari mana ke mana. Hanya **admin BU** yang bisa memindahkan
  antara "semua outlet" dan outlet tertentu — itu dijaga policy, bukan tombol.
  **Tidak ada migration untuk ini.**
- **Daily Activities (Admin Portal → Item)** → kolom **Sesi** + tombol **Sesi**
  untuk memilih sesi mana yang memakai item itu. Item yang belum ditugaskan tetap
  berlaku di **semua** sesi, jadi setelah `0069` tidak ada yang berubah sampai
  kamu mulai menugaskan. ⚠️ Begitu sebuah item ditugaskan ke satu sesi, ia
  **berhenti muncul di sesi lain**.
- **Rekap Presensi** → ada pemilih baru **"Outlet yang dicari"**: *Lokasi absen*
  (bawaan) atau *Outlet basis (NBM)*. Baris yang basisnya sudah dikoreksi kini
  menampilkan `★ basis: <outlet>` di bawah nama outlet lokasinya.
- **Data Staff** → ada **Export .xlsx** di samping Export PDF; PDF-nya tidak lagi
  bertumpuk teks (sel panjang dibungkus, tinggi baris menyesuaikan).
- **Master User → 🏷️ Kelola Divisi** → isi divisi tiap BU (mis. Kitchen, Bar),
  lalu tetapkan divisi pada scope tiap staff lewat tombol ✎ di badge scope-nya.
  ⚠️ **Staff tanpa divisi tidak akan muncul di Jadwal Shift** — jadi ini wajib
  diisi sebelum menyusun jadwal. Yang belum terisi disebut namanya di bawah tabel.

---

## Sebelum push — jalankan semua audit

```bash
node --experimental-vm-modules tools/audit-syntax.cjs
node tools/audit-html-escape.cjs
node tools/audit-owner-filter.cjs
node tools/audit-outlet-scope.cjs
node tools/audit-embed-ambigu.cjs
node tools/audit-select-wajib.cjs
node tools/audit-kolom-tabel.cjs
node tools/audit-klik-ganda.cjs
node tools/test-youtube-parser.mjs
node tools/test-image-compress.mjs
node tools/test-pdf-lebar.mjs
node tools/test-ambang-reminder.mjs
node tools/test-jenjang-admin.mjs
node tools/test-item-per-sesi.mjs
node tools/test-kemajuan-sesi.mjs
node tools/test-shift-lintas-hari.mjs
node tools/test-geofence-akurasi.mjs
node tools/test-cakupan-item.mjs
node tools/test-navigasi-back.mjs
node tools/test-koneksi.mjs
node tools/test-slot-fleksibel.mjs
```

`audit-syntax` yang paling penting: satu SyntaxError membuat **seluruh**
aplikasi berhenti di layar "Memuat…".
