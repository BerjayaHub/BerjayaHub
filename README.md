# Berjaya Hub OMS

Aplikasi manajemen operasional multi-Business Unit (Cafe, Workshop, Armada, dst) — vanilla HTML/CSS/JS + Supabase, tanpa build tool.

## Setup

1. Buat project baru di [Supabase](https://supabase.com).
2. Jalankan migration di `supabase/migrations/0001_foundation.sql` lewat SQL editor Supabase, atau via Supabase CLI:
   ```bash
   supabase link --project-ref YOUR-PROJECT-REF
   supabase db push
   ```
3. Isi `js/config/supabase-client.js` dengan `SUPABASE_URL` dan `SUPABASE_ANON_KEY` project kamu.
4. Buka `index.html` (Staff App) atau `admin.html` (Admin Portal) langsung di browser, atau serve pakai server statis apapun (contoh: ekstensi "Live Server" di VS Code).
5. Buat user pertama lewat Supabase Auth (dashboard atau `supabase.auth.signUp`), lalu insert manual baris ke `user_profiles` dan `membership_scopes` dengan role `super_admin` supaya bisa mulai kelola data dari Admin Portal.

## Struktur folder

```
berjaya-hub/
├── index.html              Staff App
├── admin.html               Admin Portal
├── css/styles.css
├── js/
│   ├── config/supabase-client.js
│   ├── auth/auth.js
│   ├── core/module-loader.js   Registry modul + resolusi modul aktif per BU
│   ├── main-staff.js
│   ├── main-admin.js
│   └── modules/                 Satu folder per modul, ditambah bertahap
└── supabase/migrations/
```

## Fase 1 — Master User: deploy Edge Functions

Bikin staff baru & reset password butuh `service_role key`, jadi harus lewat Supabase Edge Function (jalan di server, bukan di browser).

```bash
supabase functions deploy create-staff-user
supabase functions deploy reset-staff-password
```

`SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY` otomatis tersedia sebagai environment variable di Edge Function — tidak perlu di-set manual.

**Cara login staff baru:** admin isi password awal langsung di form "Tambah Staff" (bukan lewat email invite). Staff login pakai email + password itu, lalu bisa ganti sendiri kapan saja lewat tombol **"Ubah Password"** di nav Staff App/Admin Portal. Kalau staff lupa password, admin bisa reset dari tombol **"Reset Password"** di Master User.

### Membuat Super Admin pertama (manual, sebelum ada staff lain)

Karena Master User butuh admin yang sudah ada untuk menambah staff baru, user **pertama** harus dibuat manual:

1. Supabase Dashboard → Authentication → Add User (isi email + password)
2. SQL Editor, jalankan (ganti `<AUTH_USER_ID>` dan `<BUSINESS_UNIT_ID>` sesuai punya kamu):
   ```sql
   insert into user_profiles (id, full_name) values ('<AUTH_USER_ID>', 'Nama Admin');
   insert into membership_scopes (user_id, business_unit_id, role)
     values ('<AUTH_USER_ID>', '<BUSINESS_UNIT_ID>', 'super_admin');
   ```
   (Business Unit & Outlet pertama juga masih perlu di-insert manual lewat SQL Editor sampai modul Organization dibangun.)

## Fase 2 — Presensi: aktifkan modulnya untuk BU kamu

Modul "attendance" tersedia di sistem sejak Fase 0, tapi baru muncul di menu Staff App/Admin Portal kalau di-toggle aktif untuk BU tertentu. Karena modul Organization (buat toggle ini lewat UI) belum dibangun, aktifkan manual lewat SQL Editor:

```sql
insert into bu_modules (business_unit_id, module_id, is_active)
select '<BUSINESS_UNIT_ID>', id, true from modules where code = 'attendance';
```

### Geofencing (validasi lokasi presensi)

Jalankan migration `0004_attendance_geofence.sql` (nambah kolom lokasi & radius ke `outlets`). Atur koordinat tiap outlet lewat Admin Portal → Master Presensi → buka panel "Pengaturan Lokasi Outlet" → klik "Atur Lokasi". Selama koordinat belum diisi, staff tetap bisa clock in dari mana saja (geofence belum aktif buat outlet itu).

### Logo

Ganti `images/logo.svg` (masih placeholder badge "BH") dengan logo asli kamu — timpa file dengan nama sama, atau ganti referensinya di `index.html`/`admin.html`/`main-staff.js`/`main-admin.js` kalau pakai format lain (.png). Detail ada di `images/README.md`.

### NBM (Uang Hadir)

Jalankan migration `0005_nbm.sql`. Semua nominal diatur lewat Admin Portal → Master Presensi → tab **"Pengaturan NBM & Lembur"**, per outlet — tidak ada nominal yang di-hardcode:
- NBM normal & NBM hari libur (kalau hari libur, NBM normal **digantikan**, bukan ditambah)
- Bonus storing
- Bonus lembur bertingkat — bebas jumlah tingkatannya, tiap tingkat punya jam & nominal sendiri. Centang "Keesokan hari" untuk tingkatan yang jamnya lewat tengah malam (misal 00:00)
- Hari libur — tambah tanggal + nama, per outlet

Tab **"Rekap NBM"** menghitung otomatis dari data presensi + pengaturan di atas, dengan total per staff untuk periode yang dipilih.

**Fitur storing untuk staff (khususnya bengkel):** saat clock in, staff bisa centang "Tugas storing (di luar outlet)" — ini melewati validasi geofence (karena memang sedang bertugas di luar outlet) sekaligus menandai sesi itu dapat bonus storing di perhitungan NBM.

Shift yang melewati tengah malam otomatis tetap terhitung di tanggal clock-in (bukan hari baru), karena 1 sesi kerja = 1 baris data yang sama dari clock-in sampai clock-out.

### Selfie Presensi & Tugas Keluar (OTP)

Jalankan migration `0006_attendance_selfie_otp.sql` — ini otomatis membuat Storage bucket `attendance-selfies` (privat) beserta RLS-nya, jadi gak perlu bikin bucket manual di dashboard.

- Staff **wajib foto selfie** setiap clock in & clock out, diambil **langsung dari kamera depan di dalam app** (bukan pilih dari galeri) — pakai komponen kamera custom (`camera-capture.js`), bukan file picker biasa.
- Setiap foto otomatis ditempeli **watermark**: nama outlet, jam, dan jenis presensi (contoh: "Gading Serpong; 07.56; Clock In").
- **Penting**: akses kamera browser (`getUserMedia`) cuma jalan di **HTTPS** (atau `localhost`) — gak akan jalan kalau app dibuka lewat `http://` biasa atau `file://`. GitHub Pages sudah otomatis HTTPS, jadi harusnya aman.
- Admin atur **mode tugas keluar per BU** di tab Presensi → "Mode Tugas Keluar": **Storing** (staff tinggal centang, tanpa approval) atau **OTP** (admin generate kode 6 digit di Admin Portal, kasih tau staff lewat WA/lisan, staff input kodenya saat clock in). Kode OTP manual ini berlaku 15 menit dan sekali pakai.
- Foto & alamat lokasi (hasil reverse-geocoding dari OpenStreetMap Nominatim, di-load on-demand biar gak kena rate limit) bisa dilihat admin dari tabel Presensi.

**Catatan penggunaan Nominatim**: layanan gratis ini punya batas wajar (jangan spam request). Alamat cuma di-fetch saat admin klik "Lihat Alamat" per baris, bukan otomatis semua baris sekaligus.

### Face Recognition saat Clock In/Out

Jalankan migration `0007_face_recognition.sql`.

- Staff **daftar wajah sendiri** (bukan admin yang upload), sekali saja, sebelum bisa clock in pertama kali — halaman Presensi otomatis menampilkan gerbang "Daftarkan Wajah Dulu" kalau belum daftar.
- Pakai **face-api.js** (`@vladmandic/face-api`, gratis, jalan 100% di browser lewat CDN, tanpa API key/server ML terpisah). Model di-load dari CDN jsDelivr, tidak perlu hosting sendiri.
- Yang disimpan ke database adalah **descriptor wajah** (128 angka mewakili pola wajah), **bukan foto wajah** — lebih aman dari sisi privasi data biometrik.
- Setiap clock in/out, wajah di foto selfie dibandingkan dengan descriptor acuan. **Kalau tidak cocok, presensi tetap berhasil disimpan** (tidak diblokir) tapi ditandai "⚠️ Perlu Review" di tabel Presensi Admin Portal — supaya staff tidak stuck gara-gara pencahayaan buruk/sudut kamera, tapi admin tetap bisa audit kalau ada yang mencurigakan.
- Admin bisa **reset** wajah staff dari Master User (kolom "Wajah" → tombol "Reset"), misal karena staff ganti penampilan drastis (potong rambut, dll) dan jadi sering gagal cocok.
- **Model face-api.js cukup berat** (beberapa MB, di-load sekali lalu di-cache browser) — di HP low-end mungkin perlu beberapa detik saat pertama buka halaman Presensi. Proses load dijalankan di background begitu halaman dibuka, jadi biasanya sudah siap saat staff selesai isi form.

### Push Notification: Reminder Belum Clock In

Jalankan migration `0008_shift_schedule_push.sql`. Fitur ini butuh setup manual tambahan (gratis, tapi ada beberapa langkah) — lihat "Setup Push Notification" di bawah.

- Admin atur **jam masuk & jam pulang per outlet** di tab Presensi → "Jam Kerja & Reminder".
- Kalau staff belum clock in **10 menit** setelah jam masuk outletnya lewat, dia dapat **push notification** asli (muncul di notification tray HP seperti notifikasi chat, bukan cuma banner dalam app) — **sekali per hari**, walau app sedang tidak dibuka.
- Staff harus **aktifkan sendiri** lewat tombol "🔔 Aktifkan Notifikasi Pengingat" di halaman Presensi (minta izin notifikasi browser).
- **Khusus iPhone**: push notification web di iOS **hanya jalan kalau app sudah di-"Add to Home Screen"** dulu (jadi PWA ter-install) — kalau staff cuma buka lewat Safari biasa tanpa install, iOS tidak akan izinkan push sama sekali. Di Android (Chrome dkk), push langsung jalan tanpa perlu install. `manifest.json` sudah disiapkan supaya tombol "Add to Home Screen" muncul dengan benar di iOS.

#### Setup Push Notification (sekali saja)

1. **Generate VAPID key** (gratis, dari terminal manapun yang ada Node.js):
   ```
   npx web-push generate-vapid-keys
   ```
   Simpan `Public Key` dan `Private Key` yang muncul.

2. **Public key**: buka `js/modules/attendance/push-notifications.js`, ganti nilai `VAPID_PUBLIC_KEY` dengan public key hasil generate (aman terlihat publik, ini bukan rahasia).

3. **Deploy Edge Function baru**:
   ```
   supabase functions deploy send-attendance-reminders
   ```

4. **Set secret Edge Function** (private key WAJIB lewat sini, jangan pernah ditaruh di kode frontend):
   ```
   supabase secrets set VAPID_PRIVATE_KEY=isi_private_key_kamu
   supabase secrets set VAPID_PUBLIC_KEY=isi_public_key_kamu
   supabase secrets set VAPID_SUBJECT=mailto:admin@emailkamu.com
   supabase secrets set CRON_SECRET=teks_rahasia_bebas_buat_kamu_sendiri
   ```

5. **Jadwalkan pemanggilan otomatis** (Edge Function perlu dipanggil tiap ±5–10 menit sepanjang hari — pakai `pg_cron` + `pg_net`, gratis, sudah diaktifkan lewat migration `0008`). Di **SQL Editor** dashboard Supabase, jalankan (ganti bagian `<...>` sesuai project kamu):
   ```sql
   -- Simpan URL & secret dengan aman di Vault (sekali saja).
   -- PENTING: jangan sisakan kurung '<' '>' dari contoh ini di dalam URL-nya.
   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/send-attendance-reminders', 'reminder_function_url');
   select vault.create_secret('<isi CRON_SECRET yang sama seperti langkah 4>', 'reminder_cron_secret');
   -- anon key (Project Settings → API). Bukan rahasia, tapi WAJIB ada -- lihat catatan di bawah.
   select vault.create_secret('<anon key>', 'supabase_anon_key');

   -- Jadwalkan tiap 10 menit
   select cron.schedule(
     'send-attendance-reminders-job',
     '*/10 * * * *',
     $$
     select net.http_post(
       url := (select decrypted_secret from vault.decrypted_secrets where name = 'reminder_function_url'),
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'supabase_anon_key'),
         'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'reminder_cron_secret')
       ),
       body := '{}'::jsonb,
       timeout_milliseconds := 30000   -- default 5 detik terlalu pendek untuk cold start
     );
     $$
   );
   ```

   **Kenapa perlu header `Authorization`.** Gerbang Edge Function memeriksa JWT **sebelum** kode function-nya jalan. Tanpa header itu panggilan dibalas `401 UNAUTHORIZED_NO_AUTH_HEADER` dan function-mu tidak pernah dieksekusi — sementara `cron.job_run_details` tetap melaporkan `succeeded`, karena dari sudut pandang pg_net permintaannya memang berhasil terkirim. `x-cron-secret` sama sekali tidak menggantikan ini: ia dicek di dalam function, yaitu setelah gerbang dilewati.

   **Cara membaca kegagalannya** (dua tempat, jangan hanya melihat salah satu):
   ```sql
   -- Apakah cron-nya berhasil MENGIRIM permintaan?
   select j.jobname, d.status, d.start_time, d.return_message
   from cron.job_run_details d join cron.job j on j.jobid = d.jobid
   order by d.start_time desc limit 10;

   -- Apa JAWABAN dari Edge Function-nya? (401 di sini = header Authorization hilang)
   select id, status_code, timed_out, error_msg, left(content, 500), created
   from net._http_response order by id desc limit 5;
   ```

   Kalau `timed_out = true` dan `status_code` kosong, **jangan disimpulkan function-nya tidak jalan**. Yang kadaluwarsa hanya penantian pg_net; function-nya di Supabase tetap dieksekusi sampai selesai dan tetap menulis penanda `attendance_reminders_sent`. Efek sampingnya membingungkan saat menguji: percobaan berikutnya di hari yang sama akan menjawab `sent: 0` karena penandanya sudah ada. Untuk menguji ulang, hapus dulu penandanya:
   ```sql
   delete from attendance_reminders_sent where reminder_date = current_date;
   ```

6. **Penanda 🔕 di rekap presensi** (migration `0047_push_status_for_admin.sql`). Staff yang belum pernah menekan *Aktifkan Notifikasi* tidak akan pernah menerima reminder — dan `send-attendance-reminders` melewatinya **diam-diam**. Sekarang namanya diberi 🔕 di tabel rekap presensi Admin Portal, jadi kondisinya terlihat tanpa perlu query manual.

   Datanya lewat RPC security-definer `list_push_enabled_user_ids()`, bukan select langsung: RLS `push_subscriptions` sengaja hanya membuka baris milik sendiri, karena endpoint push itu rahasia — siapa pun yang memegangnya bisa mengirim notifikasi ke device tersebut. RPC-nya hanya mengembalikan `user_id` + jumlah langganan, tidak pernah endpoint maupun kuncinya. Kalau RPC gagal (mis. migration belum dijalankan) UI **tidak menampilkan penanda apa pun**, bukan menandai semua orang — alarm palsu lebih buruk daripada tidak ada penanda.

7. **Catatan zona waktu**: Edge Function mengasumsikan semua outlet di zona waktu **WIB (Asia/Jakarta)**. Kalau ada outlet di WITA/WIT, perlu penyesuaian logic (tambah kolom timezone per outlet) — belum didukung di versi ini.

8. Kalau suatu saat mau ganti VAPID key (misal key lama bocor), staff yang sudah subscribe pakai key lama otomatis berhenti dapat notifikasi (subscription lama jadi tidak valid) — mereka perlu klik ulang tombol aktivasi.

## Bagian 2 — Dashboard, Beranda Card, Tema per BU

Jalankan migration `0009_bu_theme.sql` (dinomori setelah migration face-recognition/shift yang sudah ada di project ini — cek dulu `supabase/migrations/` kamu belum ada bentrok nomor sebelum apply).

- **Staff App**: tampilan awal sekarang berupa **grid kartu** (bukan daftar menu di sidebar) — satu kartu per modul aktif, mobile-friendly. Tiap buka modul, ada tombol **"🏠 Beranda"** di atas buat balik ke grid kartu.
- **Admin Portal**: ada halaman **Dashboard** baru sebagai landing setelah login — nampilin feed aktivitas terbaru (saat ini dari Presensi; Cuti & Inventory akan otomatis ikut muncul begitu modul itu dibangun).
- **Tema & Logo per BU**: menu baru **"Tampilan BU"** di Admin Portal — admin BU bisa atur warna utama & upload logo sendiri. Otomatis kepakai di Staff App (warna tombol/aksen + logo di header) begitu staff BU itu login. Logo disimpan di bucket publik baru `bu-logos` (dibuat otomatis lewat migration).

**Catatan**: tema warna cuma berlaku setelah login (di halaman login sendiri masih pakai warna/logo default, karena sebelum login sistem belum tahu staff itu dari BU mana).

## Bagian 3 — Perbaikan RLS logo, presensi 1x/hari, UI pop up, Master BU & Outlet

Jalankan migration `0010_bu_logo_rls_fix_and_attendance_daily.sql`. Isinya:

- **Fix upload logo** (`new row violates row-level security policy`): bucket `bu-logos` dan policy insert/update/delete/select dibuat ulang lengkap & idempotent. Kalau masih gagal setelah migration ini, artinya akun yang login belum punya scope `bu_admin`/`super_admin` untuk BU tersebut.
- **Presensi 1x per hari**: index unik `uniq_attendance_one_per_day` (per user, per tanggal WIB) sebagai pertahanan di database, selain validasi di aplikasi. Kalau tabel `attendance_records` sudah punya data ganda di hari sama, bersihkan dulu sebelum menjalankan migration.

Perubahan aplikasi (tanpa migration tambahan):

- **Staff App tanpa menu samping** — header atas berisi logo, nama, tombol Beranda/Ubah Password/Keluar. Semua notifikasi (berhasil clock in/out, ubah password, dll) tampil sebagai **pop up toast**.
- **Presensi**: kalau hari ini sudah clock in & clock out, halaman menampilkan "Presensi hari ini sudah lengkap" — tidak bisa clock in lagi (biar rekap NBM tidak kacau).
- **Admin Portal**: semua input/edit (tambah scope, edit staff, reset password, BU, outlet) pakai **pop up form dengan dropdown** — tidak perlu ketik UUID lagi.
- **Menu baru "Master BU & Outlet"** di Admin Portal — tambah/edit/hapus Organisasi, Business Unit, dan Outlet langsung dari UI, tanpa SQL. Insert/hapus BU butuh `super_admin`; kelola outlet & edit BU cukup `bu_admin`.

## Bagian 4 — Presensi "roaming" & NBM berlabuh ke basis

Jalankan migration `0011_nbm_base_and_roaming_attendance.sql` **dan** `0012_attendance_outlets_rpc.sql`.

**Konsep**: lokasi absen dipisah dari acuan NBM.
- Staff boleh clock in di **outlet Berjaya mana pun**. Saat clock in, app auto-deteksi GPS ke semua outlet ber-geofence lintas-BU → pop up "Terdeteksi di BU X / Outlet Y". Kalau di luar semua geofence → pop up peringatan, lalu isi **OTP** (kalau BU basis mode OTP) atau tandai **tugas luar** (kalau mode storing).
- **NBM tidak ikut lokasi absen**, tapi ikut **outlet basis** (tempat kerja utama) staff. Di Master User, tandai satu scope tiap staff sebagai basis lewat tombol ★. Tiap record presensi menyimpan lokasi fisik + basis NBM terpisah.
- **Rekap NBM** kini dihitung & difilter berdasarkan outlet basis, dengan kolom tambahan "Lokasi Absen" untuk transparansi.

**Toggle modul per BU**: di Master BU & Outlet, tombol **Modul** per BU untuk memilih modul yang tampil di Staff App (mis. BU Admin → Presensi saja). Pakai tabel `bu_modules` yang sudah ada.

**Face recognition memblokir**: sejak revisi ini, wajah yang tidak cocok (atau tak terdeteksi jelas) langsung **menolak** clock in/out — tidak ada lagi jalur "ditandai untuk review admin".

**Catatan teknis migration 0011/0012**:
- RLS insert presensi dilonggarkan: staff aktif boleh mencatat presensi dirinya di outlet mana pun (validasi geofence pindah ke sisi app). Upload selfie juga dilonggarkan seiring itu.
- `attendance_records` dapat FK kedua ke `outlets` (`nbm_outlet_id`) & ke `business_units` — query embed `outlets(...)` diberi hint `!outlet_id`/`!nbm_outlet_id` agar tidak ambigu.
- RPC `list_attendance_outlets()` (security definer) memberi staff koordinat semua outlet aktif untuk deteksi lokasi.

### Rekap presensi ikut BU basis staff

Riwayat presensi di Admin Portal disaring berdasarkan **BU basis** staff (tempat kerja utama), **bukan** BU lokasi absen. Contoh: staff dengan basis **BU Admin** yang absen di outlet **Central Kitchen** (BU Cafe) tetap muncul di rekap **BU Admin**, sedangkan kolom **Outlet** tetap menampilkan *Central Kitchen* (dengan keterangan kecil "di BU Cafe" bila BU-nya berbeda). Pilihan filter Outlet otomatis ditambah outlet BU lain yang muncul di data. Baris lama yang belum punya basis di-fallback ke BU lokasi. Ini menyamakan perilakunya dengan **Rekap NBM**, yang memang sudah berbasis outlet/BU basis.

**Perbaikan: catatan shift bocor ke BU non-shift.** Halaman Presensi Staff App dulu menyalakan info shift dengan `allOutlets.some((o) => o.shift_enabled)`. `allOutlets` berasal dari RPC `list_attendance_outlets()` yang mengembalikan outlet **semua BU**, jadi cukup satu outlet BU lain mengaktifkan Shift dan **semua staff di semua BU** ikut kena catatan "belum dijadwalkan" + status `Tanpa jadwal` di record presensinya. Sekarang dicek dari **outlet basis staff** (`baseOutlet.shift_enabled`) saja. Tidak ada logika hari Minggu/akhir pekan di sistem — sebuah hari hanya dianggap libur kalau admin menandainya `Libur` di Jadwal Shift.

**Catatan: Mode Tugas Keluar (Storing/OTP) mengikuti BU basis.** `getExitTaskMode(nbmBase.business_unit_id)` dan `redeemExitOtp(..., nbmBase.business_unit_id)` — jadi staff dengan basis BU Admin **tidak** diminta OTP walau absen di outlet BU Cafe yang modenya OTP. Ini disengaja dan konsisten dengan aturan NBM: kebijakan mengikuti BU yang mengupah, bukan BU lokasi fisik.

**Catatan teknis (perbaikan lanjutan):** nama outlet/BU lokasi absen **tidak lagi di-embed** lewat PostgREST. RLS `outlets_select`/`business_units_select` hanya mengizinkan admin membaca baris dalam scope-nya sendiri, sehingga presensi di outlet BU lain balik `null` dan kolom Outlet tampil "-". Nama outlet sekarang diresolusi di sisi UI lewat RPC security-definer `list_attendance_outlets()`. Berlaku untuk tabel rekap di tab **Presensi**, kolom *Lokasi Absen* di **Rekap NBM**, dan **Riwayat Terakhir** di Staff App. Tabel rekap juga kini menampilkan pesan error kalau query gagal (sebelumnya diam-diam kosong).

## Fase 3 — Pengajuan Cuti

Jalankan migration `0013_leave.sql`, lalu aktifkan modul **Cuti** untuk BU lewat Admin Portal → Master BU & Outlet → tombol **Modul** (centang "Pengajuan Cuti").

- **Staff App** (menu Cuti): lihat **sisa jatah cuti tahunan**, **ajukan cuti** (jenis, tanggal, alasan, lampiran opsional), lihat riwayat & status, dan **batalkan** pengajuan yang masih menunggu.
- **Admin Portal** (menu Cuti), 3 tab:
  - **Pengajuan** — approve/tolak dengan catatan, lihat lampiran, filter per status.
  - **Jenis Cuti** — kelola jenis (default global: Cuti Tahunan [potong jatah], Sakit, Izin). Admin BU bisa tambah jenis khusus BU; jenis global hanya Super Admin.
  - **Jatah Cuti** — atur jatah tahunan per staff; sisa dihitung otomatis dari cuti disetujui yang memotong jatah.
- **Approver**: admin mana pun di scope staff (outlet_admin/bu_admin/super_admin), lewat RLS `is_admin_of_outlet` / `is_bu_admin`.
- **Lampiran** disimpan di bucket privat `leave-attachments` (RLS: pemilik + admin scope).
- **Integrasi presensi**: staff yang punya cuti disetujui mencakup hari ini **tidak** dikirimi reminder "belum clock in" (perlu deploy ulang `send-attendance-reminders`).

## Arsitektur modular per Business Unit

Setiap Business Unit punya daftar modul aktif sendiri (tabel `bu_modules`), jadi menu & fitur yang muncul di Staff App/Admin Portal beda-beda tergantung BU tempat staff login. Modul baru didaftarkan lewat `registerModule(code, renderFn)` di `module-loader.js` — tidak perlu ubah kode shell.

## Central Kitchen

Outlet punya `outlet_role`: `standalone`, `central_kitchen`, atau `served_by_ck`. Outlet ber-role `served_by_ck` menunjuk ke outlet CK lewat kolom `served_by_outlet_id`. Satu CK bisa melayani banyak outlet. Owner bisa ubah role ini kapan saja lewat Admin Portal (modul Organization — belum dibangun di Fase 0 ini).

## Daily Activities (dulu Ceklis Kebersihan)

Jalankan migration `0016_cleaning_checklist.sql`, lalu aktifkan modul **Daily Activities** untuk BU lewat Admin Portal → Master BU & Outlet → tombol **Modul**.

> Modul ini dulu bernama *Ceklis Kebersihan*. Penggantian namanya ada di migration `0045` — nama modul disimpan di tabel `modules`, jadi mengubah teks di kode saja tidak cukup: kartu Staff App & menu Admin Portal membacanya dari database.

- **Admin Portal** (menu Daily Activities), 3 tab:
  - **Item Ceklis** — daftar item (rata/flat), berlaku semua outlet di BU. Atur urutan & aktif/nonaktif.
  - **Sesi** — sesi per hari (mis. Buka, Tutup, atau shift), per BU.
  - **Rekap** — lihat sesi yang sudah dikerjakan per outlet/tanggal: siapa, catatan, **foto bukti**, dan detail centang item.
- **Staff App** (menu Daily Activities): pilih outlet & sesi, centang item, **wajib 1 foto bukti**, kirim. Sesi yang sudah selesai hari itu ditandai ✅ (1 run per outlet/sesi/hari).
- Foto disimpan di bucket privat `checklist-photos` (RLS: pemilik + admin outlet). Aktivitas otomatis muncul di **Dashboard**.

## Fase 4 — Master Produk & Resep (Cafe)

Jalankan migration `0017_master_product.sql`, lalu aktifkan modul **Master Produk** untuk BU Cafe lewat Master BU & Outlet → tombol **Modul**. Admin-only (data master).

- **3 tipe produk**: Bahan Baku, Setengah Jadi, Produk Jadi.
- **Satuan pakai** (di resep/stok) + **konversi beli**: satuan beli, isi per satuan beli, harga beli. Contoh: gula — satuan pakai `gram`, beli `karung`, isi `25000`, harga `Rp150.000/karung` → biaya per gram dihitung otomatis.
- **Resep berjenjang (BOM)**: produk Setengah Jadi & Jadi punya resep dari bahan lain (baku/setengah jadi) + **yield/hasil**. **HPP** tiap produk dihitung otomatis & bertingkat; untuk Produk Jadi ditampilkan juga **margin** terhadap harga jual.
- Tab **Produk** (kelola produk + lihat HPP/margin) & **Resep** (editor bahan + yield).

## Fase 5 — Inventory (Cafe)

Jalankan migration `0018_inventory.sql`, lalu aktifkan modul **Inventory** untuk BU Cafe lewat Master BU & Outlet → tombol **Modul**.

- **Ledger pergerakan stok** (append-only) + view saldo `stock_balances`. Jenis: **Penerimaan**, **Waste**, **Opname** (input jumlah fisik → sistem hitung selisih), **Transfer** antar-outlet (lewat RPC `transfer_stock`, otomatis catat keluar+masuk).
- **Staff App** (menu Inventory): pilih outlet, lihat stok, catat Penerimaan/Waste/Opname/Transfer di outletnya.
- **Admin Portal** (menu Inventory), 2 tab: **Stok** (saldo per produk + nilai HPP + total; bisa per outlet atau gabungan) & **Riwayat** (semua pergerakan, filter outlet/jenis/tanggal).
- Nilai stok memakai **HPP dari Master Produk**. Aktivitas otomatis muncul di **Dashboard** (📦). Konsumsi produksi & penjualan akan mengurangi stok otomatis di fase berikutnya.

### Revisi Fase 5 (migration `0019_units_and_opname_toggle.sql`)

- **Master Satuan (global)** — tab **Satuan** di Master Produk (hanya Super Admin yang ubah). Field satuan di produk kini **dropdown** dari daftar ini, biar konsisten.
- **Dropdown pencarian fuzzy** — pemilih produk (resep & inventory, staff + admin) kini bisa diketik untuk mencari.
- **Toggle opname staff** (per BU) — hanya **Super Admin** yang bisa mengaktifkan (kontrol di Admin Portal → Inventory). Kalau mati, tombol Opname di Staff App disembunyikan. Dijaga RPC `set_allow_staff_opname`.
- **Import Excel** — di Master Produk, tombol **Template** + **Import Excel** untuk Produk & Resep (.xlsx/.csv, pakai SheetJS dari CDN, mode tambah-baru-saja).

## Fase 6 — Produksi di Outlet (Cafe)

Jalankan migration `0020_production.sql`, lalu aktifkan modul **Production** untuk BU Cafe lewat Master BU & Outlet → tombol **Modul**.

- **Staff App** (menu Produksi): pilih outlet & produk (yang punya resep), isi **jumlah hasil (output)**. Sistem menampilkan **kebutuhan bahan** (proporsional dari resep) + stok saat ini. Saat dicatat: stok bahan **berkurang** & stok produk hasil **bertambah** otomatis (atomik lewat RPC `record_production`). Stok bahan **boleh minus** (produksi tidak diblokir).
- **Admin Portal** (menu Produksi): riwayat produksi (filter outlet/tanggal). Pergerakan **Pemakaian**/**Produksi** juga muncul di Inventory → Riwayat dan di **Dashboard** (🏭).
- Selain "Produk" (lihat-saja: nama + stok) kini juga tersedia di Staff App bila modul Master Produk aktif.

### Revisi Fase 5 & 6 (migration `0021_recipe_modes.sql`)

- **Resep ber-mode**: produk **Setengah Jadi** = 1 resep **Produksi** (dibuat di CK); produk **Jadi** bisa 2 varian resep — **Standalone** (dari bahan baku) & **Dilayani CK** (dari setengah jadi). HPP dihitung per varian. Diatur di Master Produk → tab Resep (tombol per varian).
- **Produksi khusus Central Kitchen**: fitur Produksi di Staff App hanya bisa dipakai di outlet ber-peran **Central Kitchen** (outlet standalone/dilayani-CK tidak produksi — stok bahannya berkurang saat penjualan, Fase 8).
- **Toggle penjualan per outlet** (`allow_sales`): ada di Master BU & Outlet saat tambah/edit outlet. Default nyala untuk outlet biasa; Central Kitchen bisa diaktifkan bila suatu saat ikut menjual. (Dipakai penuh di Fase 8.)

## Revisi Fase 6 — Fitur Menu (outlet) & perbaikan

Jalankan migration `0023_menu_plan.sql`, lalu aktifkan modul **Menu** untuk BU Cafe.

- **Outlet tidak produksi** — kartu **Produksi** kini hanya tampil di outlet **Central Kitchen**; outlet penjualan melihat kartu **Menu**. (Digating otomatis berdasarkan peran outlet.)
- **Fitur Menu (Staff App)** — tabel menu (Produk Jadi) dengan **filter kategori**; kolom **Jumlah tersedia** bisa **diedit langsung** (tersimpan otomatis). Ketuk nama menu untuk melihat **resep** (sesuai mode outlet: Standalone/Dilayani CK) + **stok bahan di outlet** + perkiraan "bisa dibuat berapa menu". Mengisi jumlah **tidak** mengurangi stok — hanya panduan POS agar tidak salah sold-out. Stok berkurang saat penjualan (Fase 8). Jumlah bersifat per hari.
- **Kategori produk** — ditambahkan di Master Produk (field opsional) untuk pengelompokan/ filter menu.
- **Perbaikan dropdown pencarian** — daftar hasil pencarian di "Tambah Bahan" (Resep) & "Tambah Produk" (Pengiriman) tidak lagi terpotong.

## Fase 7 — Pengiriman/Dispatch CK → Outlet (Cafe)

Jalankan migration `0022_dispatch.sql`, lalu aktifkan modul **Pengiriman** untuk BU Cafe lewat Master BU & Outlet → tombol **Modul**.

- Alur **dua langkah**: **Central Kitchen mengirim** (surat jalan multi-produk; stok CK langsung berkurang) → **outlet tujuan konfirmasi terima** (isi jumlah aktual diterima; stok outlet bertambah sebesar yang diterima). Selisih dikirim vs diterima = susut di perjalanan.
- **Staff App** (menu Pengiriman): bagian **Kirim ke Outlet** hanya muncul di outlet Central Kitchen; bagian **Kiriman Masuk** untuk konfirmasi penerimaan. Atomik lewat RPC `create_dispatch` & `receive_dispatch`.
- **Admin Portal** (menu Pengiriman): daftar semua pengiriman (filter status/tanggal) + detail item (dikirim vs diterima). Aktivitas muncul di **Dashboard** (🚚 kirim / 📥 terima).

## Revisi Fase 7 — Transfer/Retur, surat jalan PDF, format angka

Jalankan migration `0024_dispatch_code.sql` (nomor surat jalan). Perubahan aplikasi:

- **Sisi outlet (non-CK)**: form "Kirim dari CK" diganti jadi **Transfer antar Outlet** & **Retur ke Central Kitchen** (pilih jenis) — tetap alur dua langkah + surat jalan. **CK** tetap "Kirim ke Outlet". Menu adaptif per peran outlet basis.
- **Kirim & Kiriman Masuk kini tabel yang langsung diedit** (bukan pop up form). Saat **Simpan/Kirim** → muncul info **"Surat jalan XXX"**, PDF surat jalan **terunduh otomatis**, lalu dialog **Bagikan via WhatsApp** (teks ringkas; lampirkan PDF-nya manual). PDF dibuat client-side (jsPDF dari CDN, butuh internet).
- **Nomor surat jalan** otomatis: `SJ-YYMMDD-XXXX`.
- **Separator ribuan** dirapikan menyeluruh: tampilan angka pakai format Indonesia (`1.500,5` — ribuan titik, desimal koma) via `formatNum`; input uang tetap berpemisah ribuan; input jumlah (bisa desimal) tetap angka biasa agar pecahan tidak rusak.

## Fase 8 — Penjualan (Cafe)

Jalankan migration `0025_sales.sql`, lalu aktifkan modul **Penjualan** untuk BU Cafe. Outlet harus punya **Bisa Penjualan** (`allow_sales`) menyala (Master BU & Outlet).

- **Staff App** (menu Penjualan): pilih outlet & kategori, isi **jumlah terjual per menu** hari ini → **Simpan**. Stok bahan otomatis berkurang sesuai **resep menu** (mode outlet: Standalone/Dilayani CK) via RPC `record_sales`; **omzet** (qty × harga jual) tercatat. Stok boleh minus. Rekap penjualan hari ini + total omzet tampil di bawah.
- **Admin Portal** (menu Penjualan): laporan per menu (jumlah terjual + omzet), filter outlet & rentang tanggal, plus total omzet. Aktivitas muncul di **Dashboard** (💰).
- Pemakaian bahan penjualan juga muncul di **Inventory → Riwayat** (jenis "Pemakaian", catatan "Penjualan").

## Fase 9 — Kas (Cash Ledger)

Jalankan migration `0026_cash_ledger.sql`, lalu aktifkan modul **Kas** untuk BU lewat Master BU & Outlet → tombol **Modul**.

- **Kas dipegang per user** (pemegang kas), outlet dicatat sebagai konteks. Saldo dihitung dari buku kas (view `cash_balances`).
- **Staff App** (menu Kas): kartu **Saldo Kas Saya** + tombol **Kas Masuk**, **Kas Keluar**, **Transfer** (ke pengguna lain di BU, atomik lewat RPC `transfer_cash`). Tiap entri bisa pilih **kategori** & lampirkan **foto bukti** (bucket privat `cash-proofs`). Riwayat kas tampil di bawah.
- **Admin Portal** (menu Kas), 2 tab: **Saldo & Mutasi** (saldo per pemegang + total BU; mutasi dengan filter pemegang/jenis/tanggal + ringkasan masuk/keluar/net) dan **Kategori** (kelola kategori kas per BU, arah Masuk/Keluar/keduanya).
- **Kas dicatat manual** — omzet penjualan **tidak** otomatis masuk kas (menghindari dobel-hitung karena ada pembayaran non-tunai). Aktivitas kas muncul di **Dashboard** (💵).

### Revisi: kas melekat pada USER (migration `0040_cash_per_user.sql`)

Sebelumnya saldo dikelompokkan per `(business_unit_id, holder_id)`, sehingga satu orang punya beberapa "dompet" terpisah dan **saldonya berubah setiap berganti BU**. Sekarang **satu user = satu saldo**, apa pun BU/outlet yang sedang aktif.

- `cash_balances` mengelompokkan **hanya per `holder_id`**.
- Entri baru **tidak lagi menyimpan** `business_unit_id`/`outlet_id`. Kolomnya **tidak di-drop** — dipertahankan supaya riwayat lama tetap utuh dan bisa diaudit (`drop not null` + komentar DEPRECATED).
- **Akses: hanya Super Admin.** Kas dianggap data tingkat organisasi — admin BU tidak lagi bisa melihat kas siapa pun. Tab `cash_ledger` jadi `superAdminOnly` (tidak bisa diberikan lewat Izin Admin) dan `core: true` (tidak lagi bergantung toggle modul per BU).
- **Transfer lintas BU** — RPC `transfer_cash(p_to_user, p_amount, p_notes)`; signature lama yang membawa `p_bu`/`p_outlet` di-drop. Penerima cukup anggota organisasi mana pun. Daftar penerima dari RPC security-definer `list_cash_members()` (id + nama saja).
- **Kategori kas jadi global** (`business_unit_id` nullable, entri baru NULL), dikelola Super Admin. Kategori lama per-BU tetap terbaca supaya entri lama tidak kehilangan namanya.
- **Bukti kas**: policy storage berubah jadi pemilik + Super Admin (policy lama menempel ke `is_bu_admin(ce.business_unit_id)` yang kini kosong).
- **Menu Staff App tetap muncul saat pindah BU.** Kalau BU yang sedang aktif tidak mengaktifkan modul Kas, menunya tetap ditampilkan selama **salah satu** BU milik user mengaktifkannya (`getModulesActiveInAnyBu()`). Tanpa ini, saldo pribadi jadi tidak terjangkau hanya karena berpindah BU — persis masalah yang mau diperbaiki.

**Konsekuensi yang perlu diketahui:** karena pengeluaran kas tidak lagi menyimpan outlet penanggungnya, **laporan Laba Rugi kehilangan komponen beban**. Laporannya diubah jadi **Laba Kotor** (Omzet − HPP) — sengaja *tidak* dibiarkan menampilkan "laba bersih" yang salah. Untuk laba bersih, beban perlu punya atribusi outlet sendiri (mis. modul Biaya/Expense terpisah dari kas pribadi).

## Revisi UI — pengelompokan menu & tema

Tanpa migration (frontend saja).

- **Warna bar HP**: `theme-color` default kini **#f5f5f5** (bukan hijau), dan otomatis **mengikuti warna tema BU** setelah login (Staff App & Admin Portal).
- **Pengelompokan menu Admin Portal** (sub-tab dalam satu menu):
  - **BU & Outlet** (dulu "Master BU & Outlet") → tab *Organisasi & Outlet*, *Tampilan BU*
  - **User** (dulu "Master User") → tab *Master User*, *Pengajuan Cuti*, *Kas*
  - **Inventory** → tab *Stok & Riwayat*, *Master Produk*, *Produksi*, *Penjualan*
  - Tab hanya muncul kalau modulnya aktif untuk BU tersebut. Modul lain (Presensi, Ceklis, Pengiriman, Menu) tetap menu tersendiri.
- **UI dipercantik**: tab grup bergaya "pill" dengan warna BU, menu sidebar punya penanda aktif, animasi transisi halaman (fade-in), efek fokus pada input, hover baris tabel, dan tombol sekunder yang seragam. Semua animasi otomatis nonaktif bila perangkat menyetel *reduce motion*.

## Revisi Presensi (migration `0027_storage_upsert_fix.sql`)

- **Perbaikan foto gagal terunggah** — upload memakai `upsert:true` sehingga Storage juga memeriksa izin **UPDATE** pada `storage.objects`, padahal policy sebelumnya hanya INSERT+SELECT → muncul error RLS dan presensi sempat tersimpan **tanpa foto**. Migration ini menambah policy UPDATE untuk bucket selfie presensi, lampiran cuti, foto ceklis, dan bukti kas; policy SELECT selfie juga diperbaiki (sebelumnya tidak pernah cocok karena `storage.foldername()` tidak memuat nama file).
- **Urutan disimpan diubah**: foto **diunggah lebih dulu**, baru record presensi dibuat — jadi tidak mungkin lagi ada presensi tanpa foto.
- **Daftar wajah tidak lagi langsung lanjut** — setelah wajah terdaftar muncul layar konfirmasi ("Wajah Berhasil Didaftarkan") dan staff harus menekan **Lanjut ke Presensi**. Pendaftaran wajah tidak pernah mencatat presensi.
- **Mode Tugas Luar (Storing)** — saat terdeteksi di luar area outlet, muncul ajakan **Aktifkan Mode Tugas Luar**; **keterangan wajib diisi** (plus OTP bila BU memakai mode OTP), lalu ada **dialog konfirmasi**. Setelah aktif, tampil banner menetap "🚩 Kamu dalam mode Tugas Luar" beserta keterangannya, dan bisa dibatalkan. Clock in di luar area diblokir sampai mode ini dikonfirmasi.
- **UI presensi dipercantik** — kartu status, tombol ambil foto bergaya khusus, indikator "sedang bekerja" berdenyut, modal kamera lebih halus, dan pesan/toast yang lebih jelas.
- **Admin → Presensi**: tabel rekap dapat kolom **Tipe** (Normal / Tugas Luar-Storing, plus penanda OTP) dan **Keterangan**, serta tombol **⇩ Export PDF**.
- **Admin → Rekap NBM**: tombol **⇩ Export PDF**, dan filter tanggal otomatis terisi **tanggal 1 bulan berjalan s/d hari ini** (langsung tampil saat tab dibuka).

## Koreksi nominal NBM & pintasan Admin Portal

Jalankan migration `0028_nbm_adjustments.sql`.

- **Edit nominal NBM langsung di tabel** (Admin Portal → Presensi → Rekap NBM): klik kolom **Total**, ketik nominal baru, tekan Enter/keluar kolom → muncul **dialog konfirmasi** (bisa diisi alasan). Setelah disimpan, kolom baru **Keterangan** menampilkan *"Diedit oleh {nama} · {tanggal} — {catatan}"*, nominalnya ditandai kuning, dan tersedia tombol **Kembalikan hitungan sistem**. Total per staff & **Export PDF** otomatis memakai nominal hasil koreksi (kolom Keterangan ikut di PDF).
- Nominal asli hasil hitungan sistem tidak ditimpa — koreksi disimpan terpisah di tabel `nbm_adjustments` (hanya admin BU yang boleh mengubah), jadi jejak audit tetap ada.
- **Pindah mode lewat header** (Staff App ↔ Admin Portal): akun ber-peran admin mendapat **segmented switcher** di header — *📱 Staff App | 🛠️ Admin Portal* — dengan mode aktif ditandai. Di Staff App switcher menyatu dengan header bertema BU (di layar sempit turun ke baris kedua, rata tengah); di Admin Portal ada **header bar baru** berisi nama BU aktif + switcher di kanan (sticky, aman dari tombol menu ☰ di mobile). Navigasi memakai halaman yang sama sehingga **tetap di dalam PWA** yang ter-install.

## Revisi Pengiriman — Order dari Outlet ke CK

Jalankan migration `0031_stock_orders.sql`. Alur pengiriman kini punya langkah awal **Order**:

1. **Outlet buat order** (Staff App → Pengiriman → *Order ke Central Kitchen*): pilih produk + jumlah. Tujuan **otomatis** ke CK yang melayani outlet itu (dari setelan `served_by_outlet_id`); kalau belum diatur, staff pilih manual. Nomor order otomatis: `OR-YYMMDD-XXXX`. Outlet bisa memantau status ordernya & **membatalkan** selama masih menunggu.
2. **CK memproses**: di outlet CK muncul daftar **Order Masuk**; ketuk nomor order → tabel berisi *Diminta* vs **Dikirim** (bisa diubah) → **Kirim & Buat Surat Jalan** → otomatis jadi dispatch (stok CK berkurang) + **PDF surat jalan** + share WhatsApp. CK juga bisa **Tolak Order** dengan alasan.
3. **Outlet terima**: surat jalan muncul di *Kiriman Masuk* → ketuk → isi jumlah diterima → simpan (alur lama, tidak berubah).

Aturan yang dipakai: **sekali kirim order langsung selesai** (kekurangan dipesan ulang), dan **CK boleh menolak dengan alasan**. Order & kiriman masuk ikut auto-refresh 15 detik.

### Order bisa diedit (migration `0035_stock_order_edit.sql`)

Order yang **sudah bernomor** tetap bisa diubah outlet selama statusnya masih *Menunggu diproses* — nomor order **tidak berubah**. Tombol **Edit** ada di tabel *Order Saya*; isinya dimuat ulang ke pemilih produk (lengkap dengan filter kategori & stok), lalu disimpan lewat RPC `update_stock_order`.
Tabel *Order Saya* dapat kolom **Keterangan** berisi **“✎ Diedit oleh {nama} · {tanggal & jam}”**. Yang boleh mengubah: pembuat order atau admin outlet asal; order yang sudah dikirim/ditolak tidak bisa diubah.

### Tampilan Pengiriman (Staff App)

- **Bertab, tidak lagi form bertumpuk**. Tab menyesuaikan peran outlet: outlet biasa → *🧾 Order ke CK*, *🔁 Transfer / Retur*, *📦 Kiriman Masuk*; Central Kitchen → *📥 Order Masuk*, *🚚 Kirim ke Outlet*, *📦 Kiriman Masuk*.
- **Pemilih produk baru** (`item-picker.js`) dipakai di semua form tambah produk: **filter Kategori & Sub-kategori** (sub-kategori mengikuti kategori terpilih) + pencarian fuzzy per baris, dan kolom **Stok Akhir** di outlet asal supaya staff tahu sisa stok saat menentukan jumlah order/kirim.
- **Produk bertipe Menu tidak ditampilkan** di Order maupun Pengiriman (hanya bahan baku & setengah jadi), supaya tidak membingungkan staff.
- Di sisi CK, tabel proses order juga menampilkan **Stok CK** per produk (merah bila stok kurang dari yang diminta).

## Revisi Inventory, Kategori Produk & Modul Menu

Jalankan migration `0030_product_subcategory.sql`.

- **Stok Opname jadi tabel isi-langsung** (Staff App → Inventory → **📋 Stok Opname**): menampilkan **semua bahan** dengan kolom *Stok Akhir*, **Stok Fisik** (diisi langsung di tabel), *Satuan*, dan **Selisih** yang dihitung otomatis saat mengetik (hijau/merah). Ada **filter kategori** + **pencarian fuzzy** untuk mempercepat pencarian saat opname. Baris yang dikosongkan diabaikan; simpan sekali untuk semua koreksi (dengan konfirmasi). Menggantikan pop up per-produk.
- **Kategori & Sub-kategori produk**: field kategori kini **dropdown pencarian fuzzy** yang otomatis terisi dari kategori yang sudah ada, plus opsi **“+ Tambah …”** untuk membuat kategori/sub-kategori baru langsung dari dropdown. Ditampilkan juga di tabel Master Produk.
- **Modul Menu di Admin Portal** (BU & Outlet → grup **Inventory** → tab **Menu**): daftar seluruh produk bertipe **Menu**, lengkap dengan **HPP Standalone** & **HPP Dilayani CK** (dihitung dari resep + harga bahan/setengah jadi), **margin**, **edit harga jual langsung di tabel**, serta tombol **atur resep per varian**. Ada filter kategori & pencarian fuzzy. Editor resep kini komponen bersama (`recipe-editor.js`) yang dipakai Master Produk maupun Menu.

## Update: Data Staff, Profil, & penyesuaian UI

Jalankan migration `0032_staff_profile_and_waste.sql`.

- **Data staff lengkap** di `user_profiles`: nama KTP, no. KTP, jenis kelamin, alamat KTP, kode pos, nama ibu kandung, nomor darurat, ukuran baju/celana/sepatu, status kawin, NPWP, dan **foto staff** (bucket privat `staff-photos`).
  Migration ini juga menambah **policy UPDATE untuk admin BU** pada `user_profiles` — sebelumnya admin sama sekali tidak bisa mengubah profil staff (hanya pemilik akun), sehingga tombol Edit/Nonaktifkan di Master User bisa gagal diam-diam.
- **Tab “Data Staff”** (Admin Portal → User): tabel seluruh data staff + **filter BU & outlet**, indikator kelengkapan data, detail per staff (termasuk foto), dan **Export PDF**.
- **Profil di Staff App** (ikon 👤 di header): staff mengisi/mengubah data pribadinya sendiri & mengunggah foto. Scope, role, modul, BU, dan outlet tetap hanya bisa diubah di Admin Portal.
- **Beranda Staff App**: **foto staff** tampil di samping sapaan (fallback inisial nama), dan **kartu ringkasan Presensi hari ini** dipindah ke sebelah sapaan (status belum absen / sedang bekerja / selesai, ketuk untuk membuka modul Presensi).
- **Pengiriman**: **Kiriman Masuk dikeluarkan dari sub-tab** dan disorot di atas (kartu bergaris kuning + jumlah kiriman), sementara Order/Transfer tetap sebagai sub-tab.
- **Inventory**: label diperjelas — “+ Penerimaan” → **📥 Terima dari Supplier**, “Waste” → **🗑️ Waste / Spoil** dengan pilihan **tipe**: *Spoil* (bahan/setengah jadi rusak → stok bahan berkurang langsung) atau *Waste* (menu jadi terbuang → **bahan dipotong sesuai resep menu** lewat RPC `record_menu_waste`).
- **Audit tipe Menu**: produk bertipe Menu tidak lagi muncul di form penambahan bahan mana pun (Inventory, Opname, Transfer, Order/Pengiriman, Resep) — hanya di modul Menu, Penjualan, dan pilihan Waste menu.

## Fase 10 — Modul Armada (Fleet)

Jalankan migration `0036_fleet.sql`, lalu aktifkan modul **Armada** untuk BU lewat Master BU & Outlet → tombol **Modul**. Modul ini **admin-only** (tidak ada halaman Staff App).

Admin Portal → **Armada**, 4 tab:

- **Kendaraan** — data lengkap: nomor polisi, **Merk & Tipe** (dropdown master), jenis, tahun, warna, **no. rangka & no. mesin**, **Nama STNK**, **Area Rental** (dropdown master), status (**Tersedia / Direntalkan / Perawatan / Nonaktif**), dokumen, dan catatan. Tombol **Detail**, **Edit**, **Rentalkan/Selesai Rental**, **Import xlsx**, dan **Export PDF**.
- **Rental** — daftar kendaraan yang **sedang direntalkan** beserta **area rental**, penyewa, dan periodenya, plus **riwayat rental**.
- **Dokumen & Reminder** — kotak sorot **🔔 Perlu Perpanjangan** berisi dokumen yang **kedaluwarsa** atau mendekati jatuh tempo (STNK pajak tahunan, STNK 5 tahun, KIR), diurutkan paling mendesak. Bisa **Kirim via WhatsApp** (tanpa API) dan **Export PDF**. Di bawahnya ada tabel semua dokumen + catatan kendaraan yang tanggalnya belum diisi.
- **Pengaturan** — **ambang reminder** (default 30 hari sebelum jatuh tempo) + **Master Data** (kelola Merk, Tipe, Area Rental).

### Revisi Armada (migration `0037_fleet_masters.sql`)

Jalankan `0037_fleet_masters.sql`. Master merk/tipe/area **tidak di-seed hardcode** — isinya murni dari input user, dan data kendaraan yang sudah ada otomatis dijadikan isi master awal.

- **Merk & Tipe jadi dropdown bertingkat.** Tabel `vehicle_brands` dan `vehicle_models` (tipe selalu menempel pada satu merk). Pilih **Toyota** → dropdown Tipe hanya menampilkan Avanza/Innova/…; pilih **Daihatsu** → Xenia/Gran Max/… Keduanya **bisa ditambah langsung dari form kendaraan**: ketik nama baru lalu pilih **“+ Tambah”**, tersimpan ke master saat form disimpan.
- **Kepemilikan → Nama STNK.** Kolom `vehicles.ownership` di-*rename* jadi `stnk_owner_name` dan berubah dari pilihan hardcode menjadi **teks bebas** (nama pemilik sesuai STNK). Ikut tampil di tabel (di bawah plat), Detail, dan Export PDF.
- **Outlet/Pool → Area Rental.** Tabel `rental_areas` sebagai master; field di form kendaraan jadi dropdown (bisa tambah dari form) supaya penulisan area seragam antar admin. Nilai lama dari outlet/pool otomatis dipindah jadi area. `vehicles.rental_area` kini berarti **area kendaraan yang menetap** — **Selesai Rental tidak lagi mengosongkannya**; area sesi rental tetap tersimpan di `vehicle_rentals.rental_area`.
- **Filter baru** di tab Kendaraan: **Area Rental**, **rentang jatuh tempo pajak STNK**, dan **rentang masa berlaku KIR** (selain status & pencarian). Ada tombol **Reset filter**, jumlah baris yang tampil, dan ringkasan filter ikut tercetak di **Export PDF**.
- **Import massal .xlsx/.csv** (`fleet-import.js`, SheetJS via CDN). Kolom wajib hanya **Nomor Polisi**; nama kolom fleksibel (mis. `Merk`/`Merek`/`Brand`, `Nopol`/`Plat`). Tanggal menerima `YYYY-MM-DD`, `DD/MM/YYYY`, dan serial Excel. Merk/Tipe/Area baru **otomatis masuk ke master**. Ada opsi **perbarui kendaraan yang nopolnya sudah ada** (status kendaraan yang sedang direntalkan tidak ditimpa), tombol **Download template**, dan ringkasan hasil (ditambah/diperbarui/dilewati/master baru + daftar error per baris).
- **Kelola master** di tab Pengaturan: tambah/ubah nama/hapus Merk, Tipe, dan Area. Mengubah nama master ikut memperbarui kendaraan yang memakainya.
- `formDialog` kini mendukung `onChange` pada field `searchselect`, dipakai untuk dropdown bertingkat Merk → Tipe.

## Modul Shift (jadwal kerja)

Jalankan migration `0034_shift.sql`, lalu **deploy ulang** `send-attendance-reminders` (reminder kini sadar jadwal shift).

- **Aktivasi per outlet** — hanya **Super Admin** (Admin Portal → Shift → tab *Pengaturan*), lewat RPC `set_outlet_shift_enabled`.
- **Pengaturan per BU** (admin BU): **jumlah shift 2–4** + **toleransi terlambat** (menit).
- **Jam shift per outlet** (admin BU & admin outlet): nama + jam mulai/selesai tiap slot. **Mendukung shift lintas tengah malam** (jam selesai < jam mulai otomatis dianggap +1 hari).
- **Jadwal** (admin BU & admin outlet): tabel mingguan **diedit langsung** — baris staff, kolom tanggal, pilih shift atau **Libur** per sel, tersimpan otomatis. Bisa geser minggu / pilih tanggal acuan.
- **Staff App** (menu Shift): tabel jadwal 1 minggu (default minggu berjalan), baris staff & kolom tanggal, baris sendiri disorot, hari ini ditandai.
- **Integrasi presensi**:
  - Halaman Presensi menampilkan **shift hari ini** + toleransi; kalau libur/belum dijadwalkan diberi catatan khusus.
  - Saat clock in, sistem menilai keterlambatan dan menyimpan **snapshot** di record: `Tepat waktu` / **`Toleransi`** (masih dalam batas) / **`Terlambat`** (lewat batas, beserta selisih menit) / `Tanpa jadwal` / `Hari libur`.
  - Riwayat **Admin Portal → Presensi** dapat kolom **Shift** berisi nama shift + badge status & menit keterlambatan; ikut juga di **Export PDF**.
  - **Push reminder clock in** memakai **jam shift masing-masing staff** saat modul Shift aktif (staff libur/tidak dijadwalkan tidak diingatkan); outlet non-shift tetap memakai jam masuk outlet.
- Modul Shift juga bisa dibatasi lewat **Izin Admin** per user, dan muncul di Staff App sesuai **akses modul** & toggle modul BU.

## Kebijakan Hari Libur & Public Holiday

Jalankan migration `0038_public_holidays.sql`.

Sistem sengaja memisahkan **dua jenis "libur"** — menggabungkannya akan salah, karena staff cafe yang masuk saat Idul Fitri **dapat tarif libur tapi bukan sedang libur**:

| | Apa | Efeknya |
|---|---|---|
| `holidays` | Hari libur nasional/perusahaan | NBM tarif libur + bonus PH + hak cuti pengganti |
| `shift_schedules.is_off` | Libur **pribadi** staff | Tidak dinilai terlambat |

### Kebijakan libur: outlet dulu, baru BU (migration `0039`)

Satu BU bisa punya dua outlet dengan **hari libur rutin berbeda** (mis. CK libur Senin, cafe libur Selasa), sementara BU tanpa outlet (Divisi Admin) tetap butuh pengaturan di level BU. Karena itu kolom di `outlets` dibuat **nullable**:

- `outlets.holiday_policy` / `outlets.weekly_off_days` **NULL** → warisi dari BU
- terisi → menimpa kebijakan BU khusus outlet itu

Nullable (bukan default `'{}'`) supaya **“belum diatur”** bisa dibedakan dari **“sengaja tanpa libur mingguan”**. Resolusinya di `getHolidayPolicy(businessUnitId, outletId)`, per-field, dan mengembalikan `from: { policy, days }` yang menandai asal nilainya.

Dua modenya:

- **Tetap beroperasi** (`operational`, default) — Minggu & hari besar **tetap hari kerja**. Staff yang masuk dapat kompensasi PH. Untuk Cafe, Bengkel, Armada.
- **Ikut kalender libur nasional** (`follow_calendar`) — tanggal libur nasional **dan** hari libur rutin yang dicentang otomatis muncul sebagai **Libur** di Jadwal Shift, tanpa admin mengisi satu-satu.

Di Admin Portal: kartu **Kebijakan Hari Libur — Default BU** di atas (juga satu-satunya pengaturan untuk BU tanpa outlet), lalu **Hari Libur Rutin Outlet Ini** di tiap outlet dengan checkbox *Ikut kebijakan BU*.

Libur otomatis hanya **default tampilan** — admin tetap bisa menimpanya per tanggal kalau ada yang masuk. Tidak ada asumsi hari Minggu yang berlaku global: `resolveAutoOff()` hanya aktif untuk scope ber-policy `follow_calendar`. (Asumsi global semacam ini pernah jadi sumber bug lintas BU — lihat catatan perbaikan di bagian Presensi.)

Daftar hari libur tetap diisi untuk **kedua** mode; yang berbeda hanya efeknya.

### Menarik hari libur nasional (butuh Edge Function)

```bash
supabase functions deploy fetch-national-holidays --no-verify-jwt
```

Layanan hari libur publik Indonesia tidak mengirim header CORS, jadi fetch langsung dari browser selalu gagal dengan `Failed to fetch`. Edge Function `fetch-national-holidays` menariknya di sisi server, menormalkan bentuknya, dan mengembalikannya dengan header CORS yang benar. Function ini **tidak menulis apa pun ke database**.

**`--no-verify-jwt` wajib.** Tanpa flag itu, gerbang Supabase menolak request **preflight `OPTIONS`** dari browser — preflight tidak membawa header `Authorization`, jadi dibalas `401` sebelum kode function sempat jalan. Di browser gejalanya: `Failed to send a request to the Edge Function`. Aman karena function ini tidak menyentuh data user, tidak memakai `service_role`, dan satu-satunya input adalah angka tahun yang divalidasi. Detail & cara uji ada di `supabase/functions/fetch-national-holidays/README.md`.

**Jalur darurat (selalu berhasil).** Kalau penarikan otomatis gagal — apa pun sebabnya — dialognya otomatis beralih ke mode **tempel manual**: tersedia tombol untuk membuka **tiap** sumber di tab baru (membuka URL secara langsung tidak kena CORS), lalu isinya tinggal disalin-tempel. Menerima JSON dari layanan mana pun maupun baris sederhana `2026-01-01, Tahun Baru`. Hasilnya masuk ke daftar centang yang sama untuk disetujui.

Tombol **⇩ Tarik hari libur nasional** di Pengaturan NBM & Lembur → hasilnya **ditampilkan sebagai daftar centang untuk disetujui admin** sebelum masuk tabel `holidays`.

**Urutan sumber** (sengaja, berdasarkan ketahanan):

1. **`date.nager.at`** — open source, tanpa rate limit, **CORS terbuka** sehingga bisa ditarik langsung dari browser tanpa Edge Function. Namanya diambil dari `localName` (bahasa Indonesia). **Tidak memuat cuti bersama** — dialog persetujuan memperingatkan ini, dan cuti bersama ditambah manual setelah SKB 3 Menteri terbit.
2. `dayoffapi.vercel.app` — punya flag cuti bersama, tapi menumpang hosting gratis Vercel. Per Juli 2026 statusnya *"This deployment is temporarily paused"*.
3. `api-harilibur.vercel.app` — cadangan terakhir, hosting sejenis.

Sumber yang CORS-nya tertutup tetap dicoba lewat Edge Function. Kalau function membalas non-2xx, badan responsnya dibaca manual (`error.context.json()`) supaya pesan errornya menyebut **sumber mana** yang gagal, bukan sekadar "non-2xx status code".

API ini **pintasan input, bukan dependensi** — kalau layanannya mati, aplikasi tidak terganggu dan hari libur tetap bisa ditambah manual.

**Penarikan ulang menambal, bukan menduplikasi** — tapi *bukan* lewat `ON CONFLICT`. Index unik `uniq_holiday_bu_date` bersifat **partial** (`where outlet_id is null`), dan Postgres hanya mau memakai index partial untuk `ON CONFLICT` bila predikat `WHERE`-nya ikut disebutkan — yang tidak bisa dikirim lewat PostgREST. Gejalanya: *"there is no unique or exclusion constraint matching the ON CONFLICT specification"*. Karena itu `addHolidaysBulk()` membaca dulu tanggal yang sudah ada, meng-`UPDATE` yang cocok, dan meng-`INSERT` sisanya. Index partialnya tetap dipertahankan sebagai pengaman duplikat di level database.

Dua hal yang **tidak bisa** diandalkan dari API mana pun, jadi harus tetap bisa dikoreksi manual:

- **Cuti bersama** ditetapkan SKB 3 Menteri, biasanya baru terbit akhir tahun sebelumnya.
- **Idul Fitri/Adha** ditentukan sidang isbat dan bisa geser sehari dari prediksi hisab.

### Kompensasi PH (dinamis, per outlet)

Diatur di form NBM tiap outlet — semuanya default 0 supaya perhitungan lama tidak berubah sampai admin mengisinya:

- `holiday_amount` (sudah ada) — **menggantikan** NBM normal di hari libur.
- `ph_bonus_amount` — bonus **tambahan** di atas NBM hari libur, untuk yang tetap masuk.
- `ph_replacement_days` — hak **cuti pengganti** (hari) per hari kerja yang jatuh di hari libur nasional. Rekapnya di **Laporan → Hak Cuti Pengganti (PH)**.

Catatan: laporan PH baru menghitung **hak**-nya; pemberian ke jatah cuti staff masih manual lewat modul Cuti.

**RLS:** policy `holidays_select_member` ditambahkan supaya Staff App bisa membaca **tanggal** libur (untuk catatan di halaman Presensi & Jadwal Shift). Nominalnya (`outlet_nbm_config`, tier lembur) tetap admin-only.

### Penyeragaman istilah "Storing"

Semua label & teks bantuan yang sebelumnya hanya menulis **“Storing”** kini konsisten memakai **“Tugas Luar/Storing”** — di mode tugas keluar (Admin Portal), banner & dialog Staff App, kolom Rekap NBM, form Bonus, dan laporan. Nama kolom database (`is_storing`, `storing_bonus_amount`) dan kelas CSS **tidak** diubah supaya data lama tetap kompatibel.

Rekap NBM juga dapat kolom **Bonus PH** — sebelumnya `phBonus` sudah masuk ke Total tapi tidak punya kolom sendiri, sehingga jumlah kolom tidak sama dengan Total saat bonus PH diisi.

## Fase 11 — Laporan (Report)

**Tidak perlu migration.** Modul Laporan hanya membaca data yang sudah ada. Menunya bersifat **core** (tidak di-toggle per BU) karena isinya lintas modul, tapi tetap bisa dibatasi lewat **Izin Admin per user** (kode tab `report`).

Admin Portal → **📊 Laporan**: pilih **jenis laporan**, **outlet**, dan **periode** (default tanggal 1 bulan berjalan s/d hari ini), lalu **Tampilkan** / **Export PDF**. Tiap laporan menampilkan kartu KPI ringkas, tabel, dan **catatan metodologi** supaya angkanya bisa diaudit.

Laporan yang sudah tersedia:

- **Laba Kotor** (Keuangan) — Omzet penjualan − HPP bahan (dari resep aktif: mode *Standalone*, mundur ke *Dilayani CK*). Menu yang belum punya HPP disebutkan di catatan, bukan diam-diam dianggap nol. **Beban operasional belum termasuk** sejak modul Kas menjadi milik user (`0040`) — pengeluaran kas tidak lagi menyimpan outlet penanggungnya, jadi tidak bisa dibebankan per outlet. Laporan sengaja diberi nama *Laba Kotor*, bukan *Laba Rugi*, supaya angkanya tidak salah dibaca sebagai laba bersih.
- **Rekap Penggajian (NBM)** (SDM) — satu baris per staff: hari hadir, hari libur, storing, NBM dasar, lembur, bonus storing, **penyesuaian manual** (selisih terhadap hitungan otomatis dari tab Rekap NBM), dan total. Ada baris TOTAL.
- **Rekap Presensi & Disiplin** (SDM) — satu baris per staff: hadir, tepat waktu, toleransi, terlambat, total menit terlambat, tugas luar, hari cuti (dari pengajuan disetujui yang jatuh di periode), dan sesi belum clock out. Diurutkan dari yang paling sering terlambat, dan **staff dengan 0 hari hadir tetap ditampilkan**.
- **Hak Cuti Pengganti (PH)** (SDM) — staff yang tetap masuk di tanggal yang terdaftar sebagai hari libur nasional, beserta hak cuti penggantinya (dari `ph_replacement_days` outlet basis) dan daftar tanggalnya.

Laporan SDM mengikuti **BU/outlet basis** staff (tanda ★ di Master User), bukan lokasi absen fisik — konsisten dengan Rekap NBM.

### Menambah laporan baru

Kerangkanya generik: `report.admin.page.js` tidak tahu isi laporan apa pun. Cukup tambah satu entri di `REPORTS` pada `js/modules/report/report.service.js`:

```js
{
  key: 'stock_value',
  label: 'Nilai Persediaan',
  group: 'Inventory',
  description: 'Nilai stok per outlet.',
  build: async ({ businessUnitId, outletId, from, to }) => ({
    columns: [{ header: 'Produk', width: 2 }, { header: 'Nilai', width: 1, numeric: true }],
    rows: [['Gula', 'Rp150.000']],
    summary: [{ label: 'Total nilai', value: 'Rp150.000' }],  // opsional
    bold: [],                                                  // indeks baris tebal, opsional
    note: 'Catatan metodologi.'                                // opsional, mendukung **tebal**
  })
}
```

Pemilih periode/outlet, render tabel, kartu KPI, dan Export PDF otomatis ikut — UI tidak perlu disentuh.

### Kandidat laporan berikutnya

Selisih pemakaian bahan (resep × penjualan vs `stock_movements` — penangkap kebocoran), penjualan per menu & tren harian, arus kas, nilai persediaan, produksi & yield CK, pemenuhan order/pengiriman, utilisasi armada, sisa jatah cuti, kepatuhan ceklis kebersihan.

## Perbaikan: query "milik saya" wajib menyaring pemiliknya

**Gejala:** akun ber-role **super admin / admin BU** melihat "sudah clock in" di Staff App padahal belum absen. Dicek di Admin Portal, yang clock in ternyata **staff lain**. Akun staff biasa normal.

**Penyebab:** `getMyOpenSession()`, `getMyTodaySession()`, `getMyRecentAttendance()`, dan `listMyLeaveRequests()` menggantungkan pembatasan "milik saya" pada **RLS**, bukan menyaringnya sendiri. Padahal RLS presensi & cuti **sengaja** mengizinkan admin membaca baris staff lain (untuk rekap, koreksi, approval). Jadi untuk staff biasa hanya barisnya sendiri yang lolos — benar; tapi untuk admin, query `.limit(1)` mengambil baris **terbaru milik siapa pun**.

Karena itu bug ini hanya muncul pada akun admin, dan **bukan** karena role-nya salah.

**Perbaikan:** keempat fungsi kini menyaring `user_id` secara eksplisit.

**Pencegahan:** ada `tools/audit-owner-filter.cjs` — memindai semua fungsi ber-nama `*My*` yang menyentuh tabel dan memastikan pemiliknya disaring eksplisit (atau lewat RPC security-definer).

```bash
node tools/audit-owner-filter.cjs
```

Fungsi yang memang bukan milik satu orang (mis. `listMyOrders`, yang di-scope per **outlet**) didaftarkan di `PENGECUALIAN` beserta alasannya. Jalankan tiap menambah fungsi baru — kelas bug ini sulit terlihat saat uji coba karena staff biasa selalu melihat hasil yang benar.

## Perbaikan: data dari database di-escape sebelum masuk HTML

Seluruh UI dibangun dengan template literal + `innerHTML`. Nama outlet/BU/produk diketik manusia, jadi cepat atau lambat ada yang mengandung kutip atau `<`. Nama seperti `Cafe "Awal" Bermula` akan **merusak dropdown** kalau disisipkan mentah — dan karena hanya muncul pada data tertentu, bug seperti ini lolos dari uji coba biasa.

**31 interpolasi di 20 file** kini dibungkus `esc()`/`escapeHtml()`. `escapeHtml` diekspor dari `js/core/ui.js` supaya modul yang belum punya helper sendiri tidak perlu menyalin ulang.

```bash
node tools/audit-html-escape.cjs
```

Bukan celah keamanan dari luar (semua input berasal dari akun yang login), tapi tetap bug tampilan yang nyata.

### Menjalankan semua pemeriksaan

```bash
node tools/audit-owner-filter.cjs   # query "milik saya" tanpa filter pemilik
node tools/audit-html-escape.cjs    # data DB masuk HTML tanpa escape
```

## PWA & Push Notification

### Ikon Home Screen

Ikon PNG di-generate dari `images/logo.svg`: `icon-180.png` (iOS), `icon-192.png`, `icon-512.png`, dan `icon-maskable-512.png` (Android).

**iOS tidak mendukung SVG untuk `apple-touch-icon`.** Sebelumnya `<link rel="apple-touch-icon">` menunjuk ke `logo.svg`, sehingga ikon di Home Screen iPhone kosong / jadi screenshot halaman. Latar ikon juga dibuat **putih solid** karena area transparan dirender **hitam** oleh iOS. Ikon di dalam notifikasi (`sw.js`) ikut diganti ke PNG — SVG sering tidak dirender di notifikasi.

Admin Portal punya **`manifest-admin.json`** sendiri supaya bisa di-install terpisah ("Berjaya Admin") tanpa menimpa Staff App.

> Setelah deploy, **hapus dulu PWA lama dari Home Screen** lalu Add to Home Screen ulang — iOS meng-cache ikon dengan agresif.

### Mengaktifkan notifikasi

```bash
supabase functions deploy send-test-push
```

Kartu notifikasi ada di **Staff App → 👤 Profil → Notifikasi di Perangkat Ini**, dan juga di halaman Presensi. Sebelumnya tombol aktivasi **hanya** ada di halaman Presensi — staff yang tidak pernah membukanya tidak punya langganan sama sekali, sehingga push apa pun (termasuk reservasi) tidak akan sampai. Komponennya sekarang dipakai bersama di `js/core/push-card.js`.

Kartunya punya tombol **📨 Kirim Tes** yang mengirim push ke perangkat sendiri lewat Edge Function `send-test-push` — bisa dibuktikan sekarang juga tanpa menunggu jadwal cron atau menunggu ada reservasi masuk. Function itu mengenali pemanggil dari **JWT-nya sendiri** dan hanya mengirim ke langganan milik user itu; tidak ada cara mengirim ke orang lain. Langganan yang sudah mati (404/410) otomatis dibersihkan.

### Rekap reservasi harian (push)

```bash
supabase functions deploy send-reservation-digest
```

Cron sekali sehari, mis. 07:00 WIB (= 00:00 UTC):

```sql
select cron.schedule(
  'reservation-digest',
  '0 0 * * *',                         -- 00:00 UTC = 07:00 WIB
  $$
  select net.http_post(
    url     := 'https://<PROJECT-REF>.supabase.co/functions/v1/send-reservation-digest',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer <anon key>',   -- WAJIB, kalau tidak: 401 sebelum function jalan
      'x-cron-secret', '<CRON_SECRET>'
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
```

Header `Authorization` itu bukan opsional — lihat penjelasannya di bagian *Push Notification Reminder* langkah 5. Berlaku untuk **semua** cron yang memanggil Edge Function (`send-attendance-reminders`, `send-reservation-digest`, `send-fleet-reminders`).

Untuk rekap **H-1 malam** (dapur bisa siapkan bahan lebih awal), pasang jadwal kedua dengan `body := '{"offset_days":1}'::jsonb`.

**Uji tanpa mengirim** — `{"dry_run":true}` mengembalikan jumlah penerima + contoh isi pesannya.

Aturan penerimanya sengaja mengikuti apa yang orang itu lihat di dalam app:

- hanya BU yang **mengaktifkan modul Reservasi**;
- isinya dibatasi ke **outlet yang jadi scope** orang itu (scope level BU → semua outlet BU tersebut);
- **`user_module_access` dihormati** — staff yang modul Reservasi-nya dicabut admin tidak ikut diberi tahu;
- **hari kosong tidak dikirim**, karena notifikasi "hari ini tidak ada reservasi" setiap pagi hanya melatih orang mengabaikan notifikasi.

Isi pesan: jumlah reservasi + total tamu + berapa yang **belum dikonfirmasi**, lalu daftar `jam nama (pax)` maksimal 6 baris, sisanya diringkas. Nama outlet hanya disertakan kalau orang itu memang membawahi lebih dari satu outlet. Dedupe lewat `telegram_notifications_sent` (`kind='reservation_digest'`).

### Bug penting: penanda dedupe ditulis sebelum pengiriman

**Gejala:** tombol *Kirim Tes* berhasil, tapi begitu `send-fleet-reminders` / `send-reservation-digest` dijalankan lewat cron atau manual, **tidak ada notifikasi apa pun** dan responsnya `skipped`.

**Penyebab:** kedua function menulis penanda `telegram_notifications_sent` **di awal**, sebelum tahu ada yang benar-benar dikirim. Jadi satu kali jalan yang belum menemukan data (atau gagal) langsung **mengunci sisa hari itu** — semua percobaan berikutnya membaca penanda itu dan berhenti.

**Perbaikan:** penandanya kini ditulis **setelah** ada pengiriman yang berhasil. Kalau tidak ada data, penanda tidak ditulis sama sekali, sehingga cron berikutnya masih bisa mengirim ketika datanya baru diisi siang hari.

`send-attendance-reminders` tidak kena — ia memang sudah menulis penandanya per-staff setelah pengiriman.

### Yang mengirim push

Tiga: **`send-attendance-reminders`** (pengingat clock in, butuh cron), **`notify-reservation`** (reservasi baru → admin outlet), dan **`send-reservation-digest`** (rekap harian). Plus **`send-test-push`** untuk uji manual. Modul lain seperti Pengiriman **belum pernah** punya push — bukan rusak, memang belum dibuat.

**Catatan iOS:** Web Push di iPhone hanya bekerja kalau app sudah **ditambahkan ke Home Screen** lewat Safari dan dibuka dari ikon itu — tidak bekerja di tab Safari biasa.

## Modul Inventaris Aset

Jalankan migration `0045_asset_inventory.sql`, lalu aktifkan modul **Inventaris Aset** untuk BU lewat Master BU & Outlet → tombol **Modul**.

Data per barang: **Nama Barang, Jumlah, Ukuran Barang, Foto, Kondisi** (Normal / Rusak / **Lain-lain** dengan keterangan bebas), plus catatan opsional. Kolom keterangan kondisi hanya muncul saat kondisi *Lain-lain* dipilih, dan otomatis dikosongkan kalau kondisinya diubah — supaya tidak menyisakan keterangan lama yang menyesatkan.

- **Staff App** & **Admin Portal** memakai halaman yang sama (`asset.page.js`); bedanya hanya cakupan outlet — staff melihat outlet dalam scope-nya, admin melihat seluruh outlet BU dan bisa menghapus.
- Filter outlet, kondisi, dan pencarian nama; ada **Export PDF** dan ringkasan jumlah unit + berapa yang rusak.
- Foto disimpan di bucket privat `asset-photos` dengan path `<outlet>/<asset-id>.<ext>`, jadi satu aset selalu punya paling banyak satu foto dan tidak ada file yatim. Foto diunggah **setelah** baris asetnya ada.
- RLS: anggota BU bisa melihat, siapa pun yang punya scope di outlet bisa mencatat & mengubah (pendataan aset biasanya dikerjakan staff), tapi **menghapus dibatasi admin outlet**.

## Modul Reservasi

Jalankan migration `0044_reservation.sql`, lalu aktifkan modul **Reservasi** untuk BU lewat Master BU & Outlet → tombol **Modul**.

```bash
supabase functions deploy submit-reservation --no-verify-jwt
supabase functions deploy notify-reservation --no-verify-jwt
```

Daftarkan URL pemicunya sekali di **SQL Editor** (nilainya tidak ditulis di migration karena repo ini publik):

```sql
insert into integration_settings (key, value) values
  ('notify_reservation_url', 'https://<PROJECT-REF>.supabase.co/functions/v1/notify-reservation')
on conflict (key) do update set value = excluded.value, updated_at = now();
```

### Dua jalur masuk

Di Admin Portal, **Reservasi berdiri sendiri sebagai menu 📅** — sengaja tidak digabung ke grup Inventory supaya mudah dicari.

**Staff App** (menu Reservasi) — staff mencatat reservasi telepon/WA/walk-in. Pilihan jam otomatis menampilkan **sisa kursi** per slot; yang penuh atau sudah lewat batas waktu tidak muncul. Di bawahnya ada **riwayat inline** dengan filter rentang tanggal dan pilihan outlet. Rentang default-nya **hari ini** — beda dari modul lain yang memakai tgl 1 s/d hari ini, karena yang dibutuhkan staff saat membuka halaman ini adalah tamu yang datang hari ini, bukan riwayat sebulan. Ada pintasan **Hari ini / Besok / 7 hari / Bulan ini**, dan periodenya ikut tertulis di atas tabel supaya angkanya tidak salah dibaca. Outlet yang muncul hanya yang jadi scope staff itu, dan **Central Kitchen dikecualikan** karena tidak melayani tamu.

**Website** — halaman **`reservasi.html`** hidup di repo ini dan otomatis ter-hosting GitHub Pages, jadi website tinggal menaruh tombol:

```html
<a href="https://<user>.github.io/<repo>/reservasi.html">Reservasi Meja</a>
```

Atau di-*embed*: `<iframe src="…/reservasi.html" style="width:100%;height:900px;border:0"></iframe>`

Pilihan ini diambil supaya seluruh kode reservasi ada di satu tempat dan **tidak bergantung developer website** untuk tiap revisi. Halamannya memakai tema yang sama (`css/styles.css`).

**Website tidak menulis langsung ke database.** Semua reservasi web lewat Edge Function `submit-reservation` yang memakai `service_role` setelah memvalidasi. Karena itu **tidak ada policy insert untuk role `anon`** — jalur tulis publik ke database ditutup. Membuka RLS untuk `anon` jauh lebih rapuh daripada satu pintu server. Yang terbuka untuk publik hanya tiga RPC `security definer` yang cuma mengembalikan data tidak sensitif: `public_reservation_outlets()`, `public_reservation_areas()`, dan `reservation_availability()`.

Perlindungan di Edge Function: **honeypot** (field tersembunyi; bot yang mengisinya dibalas sukses palsu agar tidak belajar), **rate limit 3 reservasi per nomor per 24 jam**, normalisasi nomor telepon, validasi ulang kapasitas & lead time, dan pembatasan `area_id` hanya milik outlet tersebut.

### Kapasitas & alur

Diatur per outlet di **Admin Portal → Reservasi → Pengaturan & Area** — semuanya data, bukan hardcode: jam buka/tutup, panjang slot, **maksimal tamu per slot**, minimal pesan H- berapa jam, paling jauh berapa hari, catatan halaman publik, dan toggle **buka reservasi lewat website**.

Aturan slot dihitung di database lewat `reservation_availability()`, sehingga Staff App dan halaman publik memakai **satu sumber aturan**. Hanya reservasi berstatus *Menunggu* & *Dikonfirmasi* yang memakan kuota. `create_reservation()` mengunci baris pengaturan outlet (`for update`) sebelum menghitung, jadi dua staff yang menyimpan bersamaan tidak bisa sama-sama lolos kuota.

Alur: **Menunggu → Dikonfirmasi → Selesai / Tidak datang**, plus *Dibatalkan* dan *Ditolak*. Semua reservasi masuk sebagai *Menunggu* dan disetujui di **Admin Portal → Reservasi → Perlu Diproses**. Kalau itu terasa merepotkan untuk staff yang menerima telepon, nyalakan **"Input dari Staff App langsung dikonfirmasi"** di pengaturan outlet — tidak perlu ubah kode.

Begitu **Setujui** diklik, dialog WhatsApp langsung terbuka dengan teks konfirmasi siap kirim ke nomor customer (`wa.me`, tanpa API) — sengaja otomatis supaya customer tidak menunggu tanpa kabar hanya karena admin lupa menekan tombol WA. `shareDialog()` sekarang menerima parameter `phone` untuk membuka chat ke nomor tertentu.

### Notifikasi

Reservasi baru memicu `notify-reservation` yang mengirim **dua** hal sekaligus:

- **Telegram** ke grup sesuai rute event `reservation` (grup Awal Bermula) — lihat bagian Notifikasi Telegram.
- **Web Push** ke **admin outlet terkait** (super admin / admin BU / admin outlet itu), supaya yang berwenang menyetujui tahu tanpa memantau grup. Push hanya dikirim untuk yang berstatus *Menunggu*; yang sudah auto-confirm tidak mengganggu admin. Langganan push yang sudah mati (404/410) otomatis dibersihkan.

**Penting saat migrasi:** Google Form reservasi yang sekarang masih mengirim ke grup Awal Bermula harus **dimatikan** begitu modul ini jalan. Kalau tidak, ada dua jalur masuk yang tidak saling tahu — dan itu justru menyebabkan double-booking, karena reservasi dari Google Form tidak ikut memakan kuota slot.

## Notifikasi Telegram ke grup PIC

Jalankan migration `0041_telegram_notifications.sql`, `0042_telegram_routes.sql`, dan `0043_telegram_triggers.sql`. Langkah setup lengkap ada di **`supabase/functions/notify-telegram/SETUP.md`** — ringkasnya: set secret → deploy → atur tujuan grup & uji → pasang webhook & cron.

**Token bot disimpan sebagai secret Edge Function, tidak pernah masuk folder `js/`** — repo ini publik di GitHub Pages, jadi apa pun di frontend bisa dibaca siapa saja. **ID grup sebaliknya disimpan di database** (`telegram_routes`) supaya bisa diubah/ditambah dari Admin Portal tanpa redeploy; ini aman karena chat ID hanyalah pengenal — tanpa token bot ia tidak bisa dipakai mengirim apa pun. Aksesnya tetap dikunci super admin lewat RLS.

**Rute per event, bukan per BU.** Kondisi nyatanya ada dua grup dengan pembagian menurut jenis event:

| Event | Grup | Pemicu |
| --- | --- | --- |
| 📝 Pengajuan cuti baru | Berjaya | Database Webhook · `INSERT` pada `leave_requests` |
| ✅ Cuti disetujui / ditolak | Berjaya | Database Webhook · `UPDATE` pada `leave_requests`, **hanya saat status berubah** |
| 🚗 Dokumen kendaraan jatuh tempo | Berjaya | Cron harian · `send-fleet-reminders` |
| 📦 Order stok baru ke CK | Awal Bermula | Database Webhook · `INSERT` pada `stock_orders` |
| 📅 Reservasi baru | Awal Bermula | Trigger DB · `INSERT` pada `reservations` → `notify-reservation` |

Resolusi tujuan: **rute khusus BU → rute global (`business_unit_id` NULL) → secret `TELEGRAM_CHAT_ID`** sebagai cadangan terakhir. Kolom `business_unit_id` nullable memakai pola pewarisan yang sama dengan kebijakan hari libur, jadi kalau nanti satu BU perlu grup berbeda untuk event yang sama, cukup tambah baris *Khusus BU* — tanpa mengubah kode.

Reminder armada mengelompokkan kendaraan **per grup tujuan**, sehingga saat rute per-BU dipakai, tiap grup hanya menerima kendaraan miliknya.

**Pemicunya dipasang lewat SQL, bukan dashboard.** Database Webhook Supabase sebenarnya hanya pembungkus trigger + `pg_net`, dan menunya sempat berpindah dari *Database* ke *Integrations → Webhooks*. Migration `0043` memasang trigger `trg_notify_leave_requests` & `trg_notify_stock_orders` langsung — masuk kontrol versi, ikut saat project di-restore, dan tidak bergantung navigasi dashboard. URL & `NOTIFY_SECRET` dibaca dari tabel `integration_settings` yang diisi sekali lewat SQL Editor, **tidak ditulis di file migration** karena repo ini publik.

Dua sifat yang disengaja: `pg_net` **asinkron** sehingga lambatnya Telegram tidak memperlambat app, dan kegagalan kirim **ditelan** (`raise warning`) supaya pengajuan cuti tetap tersimpan — notifikasi tidak boleh menggagalkan transaksi bisnis. Riwayat panggilan bisa dicek di `net._http_response`.

Katalog event ada di `js/modules/notifications/telegram.service.js` (`TELEGRAM_EVENTS`). Menambah event baru = satu entri di situ + penanganan `event_key`-nya di Edge Function; UI kelola rute otomatis ikut. Slot `reservation` disiapkan untuk modul reservasi Awal Bermula.

Dipilih **Database Webhook**, bukan panggilan dari app, supaya notifikasi tetap terkirim walau HP staff mati atau sinyal putus tepat setelah data tersimpan — dan tetap jalan untuk data yang masuk dari luar Staff App.

- **Admin Portal → 📣 Notifikasi Telegram** (super admin): tombol **Kirim Pesan Tes** + daftar event + panduan membaca error. Ini cara tercepat memastikan token/ID grup/keanggotaan bot benar sebelum menunggu event sungguhan.
- Pesan error Telegram yang sebenarnya (mis. `chat not found`) dibaca dari badan respons non-2xx (`error.context.json()`), bukan sekadar "non-2xx status code".
- Telegram membalas **HTTP 200 dengan `{ok:false}`** kalau chat ID salah atau bot dikeluarkan dari grup — jadi status HTTP saja tidak cukup, `body.ok` ikut diperiksa.
- Reminder armada memakai **`reminder_lead_days` per BU** (Admin Portal → Armada → Pengaturan), tidak di-hardcode. Dedupe lewat `telegram_notifications_sent` supaya cron yang jalan dua kali tidak mengirim pesan dobel. Mendukung `{"dry_run":true}` untuk pratinjau tanpa mengirim.

## Izin akses Admin Portal per user

Jalankan migration `0033_admin_tab_access.sql`.

Menu & sub-tab Admin Portal kini bisa dibatasi **per user, per BU** — contoh: ada user yang hanya boleh membuka **Data Staff**, atau **Data Staff + Pengajuan Cuti** saja.

- **Cara atur**: Admin Portal → **User → Master User** → tombol **Izin Admin** di baris staff → centang menu/tab yang boleh dibuka. Daftarnya dikelompokkan (BU & Outlet, User, Inventory, Modul lain).
- **Hanya Super Admin** yang bisa membuka pengaturan ini (dijaga di UI **dan** RLS).
- **Tab "Master User" khusus Super Admin** — pengatur role & scope tidak bisa diberikan ke role lain, bahkan lewat pengaturan izin. Karena itu tab ini sengaja tidak muncul di daftar yang bisa dicentang.
- **Default aman**: user yang belum pernah diatur boleh membuka semua menu (sesuai role-nya). Mencentang semua = kembali ke default, sehingga menu baru nanti otomatis ikut.
- **Dashboard selalu tersedia** supaya portal tidak pernah kosong. Super Admin tidak pernah dibatasi.
- Ini pembatasan **tampilan menu**; keamanan data tetap dijaga RLS di database.

## Akses modul per user

Jalankan migration `0029_user_module_access.sql`.

Selain toggle modul **per BU** (BU & Outlet → Modul), admin kini bisa membatasi modul **per staff**: Admin Portal → **User → Master User** → tombol **Akses Modul** di baris staff → centang modul yang boleh dia akses di Staff App.

- **Default aman**: staff yang belum pernah diatur otomatis boleh **semua modul aktif BU**. Kalau semua modul dicentang, sistem menyimpannya sebagai "default" — jadi modul baru yang diaktifkan BU nanti otomatis ikut terlihat.
- Berlaku per **BU aktif** (ikut switcher BU di Admin Portal), jadi staff multi-BU bisa punya akses berbeda di tiap BU.
- Dijaga RLS: staff hanya bisa membaca aksesnya sendiri; hanya admin BU yang boleh mengubah.
- Catatan: ini mengatur **modul yang tampil di Staff App**. Pembatasan lain tetap berlaku seperti sebelumnya — akses Admin Portal ditentukan **role**, dan Produksi/Menu/Penjualan ditentukan **peran outlet** (CK vs outlet penjualan).

## Standar filter periode (semua modul)

Semua filter periode di Admin Portal kini **default: tanggal 1 bulan berjalan s/d hari ini** (WIB), lewat helper bersama `js/core/dates.js` (`monthRangeWIB`, `isoFrom`, `isoTo`).

Berlaku di: **Presensi**, **Rekap NBM**, **Inventory → Riwayat**, **Produksi**, **Pengiriman**, **Penjualan**, **Kas → Mutasi**, dan **Ceklis → Rekap** (yang tadinya filter satu tanggal, kini rentang Dari–Sampai).

## Master User — email & filter (migration `0049_user_email.sql`)

Tabel Master User menampilkan **email** dan punya filter **nama/email/telp**, **BU**, dan **outlet**.

**Email disalin ke `user_profiles`, tidak dibaca langsung dari `auth.users`.** Skema `auth` sengaja tidak bisa dibaca klien lewat PostgREST — tabel itu juga memuat hash password dan token. Salinannya dijaga trigger `trg_sync_user_profile_email` pada `auth.users` (insert + update email), bukan diisi dari Edge Function: kalau pengisiannya diserahkan ke `create-staff-user`, user yang dibuat lewat dashboard Supabase atau yang mengganti emailnya sendiri akan punya email basi — dan yang paling menyesatkan, tabelnya tetap terlihat normal, cuma isinya salah.

Kalau kolom Email kosong untuk **semua** orang, migration-nya belum dijalankan.

**Filternya bekerja di sisi klien**, bukan query ulang: daftarnya memang sudah dimuat seluruhnya (RLS yang membatasi cakupan), jumlahnya puluhan bukan ribuan, dan menyaring lokal membuat hasil muncul seketika saat mengetik. Pilihan outlet dibangun dari scope yang benar-benar ada di data — outlet yang tidak dipakai siapa pun hanya akan jadi pilihan yang selalu menghasilkan tabel kosong.

Filter **disimpan di `container.dataset`** supaya tidak hilang saat halaman digambar ulang setelah aksi (nonaktifkan user, ubah scope, reset password). Tanpa itu admin harus mengetik ulang filternya untuk setiap orang yang disentuh.

⚠️ `wireRowActions()` dipanggil **di dalam** fungsi penggambar baris, dan **tidak boleh** dipanggil lagi dari `renderMasterUserPage` — kalau dobel, setiap klik dieksekusi dua kali (dialog muncul dua kali, aksi jalan dua kali).

## Alat audit (jalankan sebelum push)

```
node --experimental-vm-modules tools/audit-syntax.cjs   # sintaks ES module
node tools/audit-html-escape.cjs                        # data DB masuk HTML tanpa escape
node tools/audit-owner-filter.cjs                       # query "milik saya" tanpa filter pemilik
node tools/test-youtube-parser.mjs                      # parser link YouTube
```

**`audit-syntax` adalah yang paling penting.** Satu SyntaxError di file mana pun membuat SELURUH aplikasi berhenti di layar "Memuat..." — browser membatalkan seluruh graf impor, dan gejalanya sama persis apa pun penyebabnya.

Jangan mengandalkan `node --check` untuk ini: ia mem-parse sebagai CommonJS, bukan ES module, sehingga bisa **lolos** padahal ada kesalahan nyata. Itu benar-benar terjadi — sebuah backtick di dalam komentar HTML memotong template literal, `--check` diam saja, dan Staff App mati total.

Jebakan paling sering: **backtick atau `${...}` liar di dalam template literal**, termasuk di dalam komentar HTML — secara visual terlihat seperti komentar, tapi bagi JavaScript tetap bagian dari string.

## Ambil foto: kamera diutamakan, galeri tetap ada

Komponen bersama `js/core/photo-input.js` — dua tombol berdampingan: **📷 Ambil Foto** (utama) dan **🖼️ Dari Galeri**, plus pratinjau gambar sebelum disimpan.

**Kenapa dua tombol, bukan satu input.** Atribut `capture` pada `<input type="file">` memang membuka kamera langsung — tapi efek sampingnya, opsi "pilih dari galeri" **hilang sama sekali** di kebanyakan browser HP. Tidak ada satu input pun yang bisa memberi keduanya. Karena itu dipakai dua input tersembunyi: satu ber-`capture`, satu polos.

`facing: 'environment'` = kamera belakang (barang, nota, kebersihan). `facing: 'user'` = kamera depan (foto profil). Nilai ini hanya saran — di desktop browser jatuh ke pemilih berkas biasa, jadi aman.

**Jangan pisahkan pemilihan dengan dialog asinkron.** `input.click()` harus dipanggil langsung di dalam handler klik, tanpa `await` apa pun sebelumnya. Kalau ada `await` di tengah, Safari iOS menganggap gestur penggunanya sudah habis dan **memblokir kamera tanpa pesan apa pun** — gagal sunyi yang sulit dilacak karena di Android dan desktop tetap jalan.

Dipakai di: **Inventaris Aset**, **Foto Profil**, **Daily Activities**, **Kas (foto bukti)**. Di `formDialog` tinggal `{ type: 'photo', facing: 'environment' }`.

Catatan: **Lampiran Cuti** sengaja tetap `type: 'file'` biasa, karena menerima PDF (surat dokter) — bukan hanya gambar.

## Video Tutorial per modul (migration `0048_module_tutorials.sql`)

Tombol **❓ Tutorial** di header modul membuka video cara pakai modul itu — di Staff App maupun Admin Portal. Dikelola super admin lewat menu **Video Tutorial** di Admin Portal.

**Tombolnya hanya muncul kalau modulnya punya video.** Tombol bantuan yang membuka daftar kosong lebih merugikan daripada tidak ada tombol sama sekali: sekali orang menekannya dan tidak menemukan apa-apa, dia berhenti mencoba.

**Pakai video Unlisted di YouTube.** Private tidak bisa di-embed sama sekali; Public membuat SOP internal muncul di hasil pencarian. Unlisted pas — hanya yang punya link.

**Yang disimpan adalah ID video, bukan URL mentah.** YouTube punya banyak bentuk link, dan yang disalin dari tombol Share di HP (`youtu.be/`) berbeda dari address bar desktop (`watch?v=`), Shorts (`/shorts/`), maupun kode embed (`/embed/`). Kalau URL disimpan apa adanya, bentuk embed-nya harus ditebak ulang setiap render dan tebakan yang meleset baru ketahuan saat staff melihat pemutar kosong. `parseYoutubeId()` mengurainya sekali saat menyimpan, sehingga link yang salah **ditolak di depan mata admin**. Formatnya dijaga dua lapis — regex di JS dan `CHECK` di database, supaya baris yang masuk lewat SQL Editor pun tetap valid.

Parser itu diuji tersendiri karena kegagalannya sunyi (tombol tidak muncul, bukan error):
```
node tools/test-youtube-parser.mjs
```
27 kasus, termasuk penolakan domain menyamar seperti `youtu.be.evil.com` dan `evil.com/watch?v=…`.

**Cakupan.** `business_unit_id` NULL = berlaku semua BU. Terisi = khusus BU itu dan **menimpa** yang global untuk modul yang sama — bukan ditambahkan di sebelahnya. Kalau satu BU sampai perlu video sendiri, biasanya justru karena alurnya berbeda; menampilkan keduanya membuat staff tidak tahu mana yang berlaku. Pola pewarisan ini sama dengan kebijakan hari libur (outlet mewarisi BU).

**Hak akses.** Baca: semua yang login (global + BU tempat dia punya scope). Tulis: super admin saja, sejajar dengan Master User dan Notifikasi Telegram.

**Pemutarannya di dalam aplikasi** (`youtube-nocookie.com`), bukan membuka tab YouTube — di PWA, membuka tab baru berarti orangnya keluar dari aplikasi dan sering tidak kembali, padahal dia membuka tutorial justru karena sedang di tengah mengerjakan sesuatu. Tetap ada tautan "Buka di YouTube" sebagai cadangan, karena sebagian jaringan memblokir iframe embed sementara aplikasi YouTube-nya jalan.

## Roadmap fase

- [x] **Fase 0** — Fondasi: struktur Organization/BU/Outlet, toggle modul per BU, auth, RLS dasar, shell Staff App & Admin Portal
- [x] **Fase 1** — Master User/Staff (admin CRUD)
- [x] **Fase 2** — Presensi (lintas semua BU)
- [x] **Fase 3** — Pengajuan Cuti (lintas semua BU)
- [x] **Fase 3b** — Daily Activities (dulu "Ceklis Kebersihan", lintas semua BU)
- [x] **Fase 4** — Master Produk & Master Formula/Resep (Cafe)
- [x] **Fase 5** — Inventory (Cafe)
- [x] **Fase 6** — Production di level Outlet (Cafe)
- [x] **Fase 7** — Production di Central Kitchen + Transfer/Dispatch ke outlet (Cafe)
- [x] **Fase 8** — Sales (Cafe)
- [x] **Fase 9** — Cash Ledger (Cafe)
- [x] **Fase 10** — Armada/Fleet: data kendaraan, rental, dokumen STNK/KIR + reminder, master Merk/Tipe/Area Rental, filter & import xlsx
- [ ] **Fase 11** — Report/Laporan lintas modul
- [x] **Modul Inventaris Aset** — nama, jumlah, ukuran, foto, kondisi (Normal/Rusak/Lain-lain)
- [x] **Modul Reservasi** — input Staff App + halaman publik `reservasi.html`, kuota per slot, approval Admin Portal, notifikasi Telegram & Web Push
- [x] **Video Tutorial per modul** — tombol ❓ di header modul (Staff App + Admin Portal), video YouTube Unlisted, global atau khusus BU, dikelola super admin
