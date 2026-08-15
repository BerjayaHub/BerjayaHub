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

## Bug: tabel Jadwal Shift di Staff App hanya menampilkan diri sendiri (migration `0051_list_outlet_staff.sql`)

**Penyebab bukan di logika filternya, tapi di RLS.** `membership_scopes_select_own` hanya membuka baris **milik sendiri**, dan `membership_scopes_select_admin` hanya berlaku untuk admin BU. Jadi `listBuStaff()` yang dipanggil dari Staff App memang cuma mengembalikan satu baris: si pemanggil. Filter di halamannya lalu **terlihat seolah sengaja membatasi**, padahal datanya memang tidak pernah sampai.

Ini kelas kegagalan yang sama seperti bug lain di dokumen ini: query-nya sukses, tidak ada error, hasilnya cuma "kebetulan" berisi satu orang — dan terlihat wajar bagi siapa pun yang membaca kodenya.

**Perbaikan:** RPC security-definer `list_outlet_staff(p_outlet_id)` yang mengembalikan **nama + status aktif saja** — tanpa email, telepon, atau role. Jadwal shift memang dokumen bersama (Admin Portal sudah menampilkannya); yang tidak boleh bocor adalah data pribadi lain, dan itu tetap tertutup. Pemanggil wajib anggota BU pemilik outlet, supaya uuid outlet organisasi lain tidak bisa ditebak untuk memanen daftar nama.

**Semua staff outlet ditampilkan, bukan hanya yang sudah dijadwalkan** — justru baris kosonglah yang berguna: dari situ terlihat siapa yang belum dapat jadwal minggu ini. Staff ber-scope level BU (mis. admin BU, yang otomatis mencakup semua outlet) hanya ikut tampil kalau memang punya jadwal di sana; kalau tidak, tabel outlet kecil akan penuh nama orang yang tidak pernah masuk ke situ. Kolom `tingkat` dari RPC itu yang membedakannya.

### ⚠️ RLS `membership_scopes` buta terhadap `outlet_admin` (migration `0053_bu_staff_for_admin.sql`)

`membership_scopes_select_admin` memakai `is_bu_admin()`, yang hanya mencakup **super_admin** dan **bu_admin**. Seorang **outlet_admin** jatuh ke `membership_scopes_select_own` dan hanya membaca baris scope-nya sendiri.

Jadi "hanya untuk layar admin" **bukan jaminan** — admin bukan satu kelompok yang seragam. Setiap select langsung ke `membership_scopes` yang bermaksud "daftar staff" akan mengembalikan **satu nama** untuk outlet_admin: bukan daftar kosong yang mencurigakan, melainkan daftar berisi satu orang yang terlihat masuk akal.

Dampak nyatanya berbeda-beda tergantung cara datanya dipakai — dan ini yang membuatnya sulit dilihat:

| Tempat | Gejala untuk outlet_admin |
|---|---|
| Jadwal Shift (Staff App & Admin Portal) | tabel hanya berisi satu baris |
| **Rekap Presensi & Disiplin** | laporan **iterasi `staff`** → hanya satu baris, terlihat seperti laporan sah |
| Payroll NBM & Pengganti PH | baris tetap lengkap (dari `attendance_records`), tapi namanya jadi "(staff tidak dikenal)" |
| Jatah Cuti | hanya satu staff yang bisa diatur jatahnya |

**Perbaikan.** Dua RPC security-definer yang menentukan cakupannya sendiri sesuai peran pemanggil, bukan menumpang RLS tabel yang aturannya dibuat untuk tujuan berbeda:

- `list_outlet_staff(p_outlet_id)` — staff satu outlet, untuk Jadwal Shift (kedua sisi).
- `list_bu_staff_for_admin(p_business_unit_id)` — super/bu_admin dapat seluruh BU, **outlet_admin dapat outlet yang diadminkan saja**. `listBuStaff()` kini hanya membungkus RPC ini, jadi Jatah Cuti dan seluruh Laporan ikut benar tanpa mengubah pemanggilnya.

Tabel lain **tidak** kena masalah ini: `attendance_records`, `leave_requests`, dan `shift_schedules` semuanya sudah memakai `is_admin_of_outlet()`, yang benar mencakup outlet_admin. `membership_scopes` satu-satunya yang menyimpang.

Sisa select langsung ke `membership_scopes` di `js/` semuanya membaca scope **milik sendiri** (`auth.js`, `base-scope.js`, `dispatch.service.js`, `inventory.service.js`) atau berada di Master User yang khusus super admin — aman.

**Aturan turunannya:** kalau butuh "daftar orang" untuk layar admin, pakai RPC security-definer. Jangan mengandalkan RLS `membership_scopes`.

## Modul yang menempel pada ORANG, bukan pada BU aktif (`js/core/base-scope.js`)

Satu orang bisa punya scope di banyak BU/outlet, dan shell aplikasi punya pemilih BU di pojok atas. Untuk sebagian modul, BU yang **sedang dipilih** memang yang benar (mis. melihat stok outlet mana). Tapi untuk modul yang menempel pada orangnya, yang benar selalu **tempat kerja utama** — scope bertanda ★ di Master User.

Sekarang ada tiga: **Presensi**, **Pengajuan Cuti**, **Jadwal Shift**.

**Kenapa ini penting.** Kalau tidak dibedakan, akibatnya halus dan sulit dilacak:

- Staff yang sedang melihat BU lain lalu mengajukan cuti akan mengirimnya ke **admin BU yang salah** — dan atasannya sendiri tidak pernah melihat pengajuan itu, tanpa ada pesan error apa pun. Yang terjadi berikutnya: staff merasa sudah mengajukan, atasan merasa tidak pernah menerima.
- Jadwal shift terlihat **lenyap** hanya karena BU di menu atas sedang berpindah.

`getMyBaseScope(fallback)` adalah sumber tunggal jawaban itu. `getMyNbmBase()` di `attendance.service.js` kini hanya alias — namanya dipertahankan supaya pemanggil lama tidak perlu diubah serentak, tapi logikanya satu.

**Kalau ★ belum ditetapkan**, fungsi ini mengembalikan konteks aktif apa adanya — **tidak menebak** scope pertama yang kebetulan terbaca, karena tebakan membuat perilaku aplikasi berubah-ubah tanpa sebab yang bisa dijelaskan. Halaman Cuti menampilkan **peringatan** dalam kondisi itu, supaya admin tahu harus menandai ★ di Master User.

Halaman Cuti juga menyebut tujuan pengajuannya secara eksplisit ("Pengajuanmu masuk ke *outlet X*"), supaya staff tidak perlu menebak ke mana permintaannya pergi. Jadwal Shift tetap punya pemilih outlet — outlet basis hanya jadi pilihan **awal**, bukan satu-satunya.

## Aplikasi "keluar sendiri" ke Beranda setelah memotret

**Gejala:** selesai mengisi form (mis. Inventaris Aset), aplikasi melompat ke Beranda / Dashboard.

**Penyebab:** membuka kamera dari `<input type="file">` menyerahkan layar ke aplikasi kamera bawaan. Kalau RAM sedang sempit, Android/iOS **membuang halaman web dari memori**. Saat kamera ditutup, halamannya dimuat **ulang** — dan karena aplikasi ini tidak menyimpan posisi navigasi, semuanya kembali ke titik awal. Bukan bug penyimpanan data: datanya tersimpan, yang hilang cuma posisi layarnya.

**Perbaikan:** modul/menu terakhir disimpan di `sessionStorage`, dan dipulihkan saat aplikasi dimuat. Berlaku untuk **seluruh modul sekaligus** di Staff App maupun Admin Portal — bukan hanya Inventaris Aset — karena penyebabnya di lapisan navigasi, bukan di modulnya.

`sessionStorage`, **bukan** `localStorage`: ingatan ini hanya relevan untuk sesi yang sedang berjalan. Kalau permanen, staff yang besok membuka aplikasi akan langsung mendarat di modul kemarin dan tidak pernah melihat Beranda. Menekan 🏠 Beranda menghapus ingatannya, supaya refresh setelah itu tetap di Beranda seperti yang diharapkan.

Di Admin Portal, menu tersimpan diabaikan kalau tidak ada di sidebar (mis. izinnya dicabut sejak sesi lalu) — supaya tidak mendarat di halaman "tidak punya izin".

## Jebakan: `delete()` yang ditolak RLS TIDAK menghasilkan error

PostgREST tidak menganggap "tidak ada baris yang boleh dihapus" sebagai kesalahan — ia membalas **sukses dengan 0 baris**. Jadi pola ini berbohong:

```js
const { error } = await supabase.from('assets').delete().eq('id', id);
if (error) throw error;                  // tidak pernah kena
toast('Aset dihapus.', 'success');       // padahal tidak terhapus apa pun
```

Yang benar — periksa berapa baris yang benar-benar terhapus:

```js
const { data, error } = await supabase.from('assets').delete().eq('id', id).select('id');
if (error) throw error;
if (!data?.length) throw new Error('Tidak bisa dihapus — hanya admin outlet yang boleh menghapus aset.');
```

Kebohongan yang meyakinkan jauh lebih buruk daripada penolakan yang jujur: user melihat "berhasil", lalu bingung karena datanya masih ada, dan menyalahkan aplikasinya secara umum alih-alih tahu bahwa ia memang tidak punya izin.

Sudah diterapkan di `deleteAsset()` (tombol Hapus kini tampil untuk semua, tapi RLS tetap membatasi ke admin outlet — dan penolakannya sekarang terlihat). **Masih ada ±24 pemanggilan `delete()` lain tanpa pemeriksaan ini**, semuanya di layar Admin Portal sehingga jarang kena; cari dengan:

```
grep -rn "\.delete()" js/modules/*/*.service.js | grep -v "\.select("
```

⚠️ Sebagian di antaranya **memang** boleh menghapus 0 baris (`recipe_items`, `nbm_adjustments`, `leave_entitlements` — pola hapus-lalu-isi-ulang). Jangan diperbaiki secara borongan.

Aturan turunannya: **baca path file SEBELUM menghapus barisnya.** Setelah barisnya hilang, tidak ada lagi cara menemukan file di Storage dan ia jadi sampah permanen.

## Kebijakan storage: kompresi foto & retensi selfie

Free tier Supabase = **1 GB**. Foto mentah kamera HP 2–4 MB, jadi ~300 foto sudah menghabiskan seluruh kuota.

### Kompresi di sisi klien (`js/core/image-compress.js`)

Semua foto diperkecil ke **1280 px** (avatar 512 px) dan diubah ke **WebP**, dengan **cadangan JPEG**. Hasilnya ~200 KB — **13–15× lebih kecil**.

Dikompres di **klien**, bukan server: tidak ada biaya komputasi server, yang melintasi jaringan sudah kecil (staff di sinyal lemah tidak perlu mengunggah 3 MB), dan tidak ada jendela waktu di mana file mentah sempat tersimpan.

Tiga jebakan yang ditangani, semuanya gagal **tanpa error**:

- **Dukungan WebP tidak boleh ditebak dari user-agent.** Safari lama bisa *menampilkan* WebP tapi tidak bisa *membuatnya* — dan `toDataURL('image/webp')` di sana diam-diam mengembalikan **PNG**, bukan error. Jadi hasilnya diperiksa, bukan dipercaya.
- **Orientasi EXIF.** Canvas mengabaikan EXIF, jadi foto potret dari HP tersimpan **miring** setelah digambar ulang. Dipakai `createImageBitmap(file, { imageOrientation: 'from-image' })`. Masalah ini hanya muncul *setelah* kompresi diaktifkan dan gampang disalahartikan sebagai bug kamera.
- **Jangan memperbesar, jangan membengkak.** Skala dibatasi maksimal 1, dan kalau hasilnya justru lebih besar dari aslinya, yang diunggah tetap yang asli.

`compressImage()` **tidak pernah melempar error** — kalau gagal, file aslinya yang diunggah. Kompresi adalah optimasi; menggagalkan pekerjaan staff yang sedang berdiri di depan outlet demi optimasi jelas salah prioritas. File non-gambar (PDF surat dokter) lewat tanpa disentuh.

**Logo BU sengaja TIDAK dikompres** — logo sering PNG transparan, dan WebP/JPEG di sini digambar di atas latar putih. Jumlahnya sedikit dan ukurannya kecil, jadi tidak sepadan.

**Sisa file berekstensi lain dihapus.** `upsert` hanya menimpa path yang *persis* sama; begitu ekstensinya berubah (`.jpg` → `.webp`), file lama jadi yatim dan tetap memakan kuota — ironis kalau muncul dari perubahan yang tujuannya menghemat. Aset dan foto profil membersihkannya sendiri setelah unggah berhasil.

```
node tools/test-image-compress.mjs
```

### Daily Activities: item & sesi bisa khusus outlet (migration `0054_checklist_outlet_scope.sql`)

**Gejala:** admin outlet tidak bisa mengisi Item/Sesi Aktivitas.

**Dua sebab yang bertumpuk**, dan yang kedua membuat yang pertama sulit dikenali:

1. `checklist_items_modify` & `checklist_sessions_modify` memakai `is_bu_admin()` — tidak mencakup `outlet_admin`. Pola yang sama dengan `0053`.
2. `updateItem`/`deleteItem`/`updateSession`/`deleteSession` memakai `.update()`/`.delete()` **tanpa `.select()`**, jadi penolakan RLS tidak menghasilkan error. Admin outlet menekan Hapus, melihat "Item dihapus", lalu itemnya masih ada. Hanya *Tambah* yang gagal dengan pesan jelas, karena INSERT memang melempar error — itulah kenapa perilakunya terasa tidak konsisten.

**Kenapa tidak sekadar ganti ke `is_admin_of_outlet()`:** item & sesi bersifat BU-wide, satu daftar dipakai seluruh outlet. Admin outlet Serpong akan bisa menghapus item yang dipakai Gading, dan admin Gading tidak akan pernah tahu kenapa ceklisnya berubah.

**Perbaikannya** — cakupan opsional:

```
outlet_id NULL   = milik BU, berlaku semua outlet   -> dikelola Admin BU
outlet_id terisi = khusus outlet itu                -> dikelola admin outletnya
```

**DIGABUNG, bukan menimpa** — ceklis sebuah outlet = standar BU + tambahan khusus outlet itu. Kalau menimpa, outlet yang menambah satu item akan kehilangan seluruh standar BU-nya. (Beda dengan video tutorial, yang memang menimpa: di sana perbedaan alur berarti video BU-nya justru menyesatkan.)

Detail yang mudah terlewat:

- Policy memakai `using` **dan** `with check` yang sama-sama ketat, supaya admin outlet tidak bisa **memindahkan** item BU jadi miliknya (update `outlet_id` dari NULL ke outletnya). `using` menjaga baris asal, `with check` menjaga baris hasil.
- Trigger `checklist_outlet_cocok_bu()` memastikan `outlet_id` benar-benar milik BU yang sama — tanpa itu, panggilan API langsung bisa menempelkan item ke outlet BU lain, dan itu tidak akan terlihat di UI mana pun.
- **Cakupan hanya bisa dipilih saat MEMBUAT**, tidak saat mengedit. Memindahkan item antar cakupan diam-diam mengubah ceklis outlet lain.
- Staff App memuat sesi & item **per outlet**, bukan sekali di awal — kalau tidak, berpindah outlet menampilkan ceklis outlet sebelumnya tanpa tanda apa pun.

### Daily Activities: foto per ITEM (migration `0052_checklist_photo_per_item.sql`)

Foto bukti kini **per item aktivitas**, bukan satu foto untuk seluruh sesi — satu foto tidak bisa membuktikan sepuluh pekerjaan berbeda; foto sesi yang lama praktis hanya membuktikan "seseorang hadir". **Wajib** untuk setiap item yang dicentang.

Path: `{outlet_id}/{run_id}/{item_id}.{ext}`. Preset `aktivitas` (**900 px**, lebih kecil dari modul lain) karena jumlahnya ~10× lipat, dan pertanyaan yang dijawab foto ini cuma satu: bersih atau tidak.

Policy storage-nya sekalian diperbaiki — pola lamanya sama persis dengan bug foto aset di `0050` (izin bergantung pada kolom yang baru diisi setelah unggah). Sekarang berbasis prefix path.

Keputusan UI yang penting:

- **Bagian foto disembunyikan sampai itemnya dicentang.** Menampilkan 10–15 tombol kamera sekaligus membuat form terasa mustahil dikerjakan.
- **Ada indikator progres** saat mengunggah ("Mengunggah foto 3 dari 8"). Mengunggah 10 foto butuh waktu, dan layar diam tanpa kabar membuat staff menekan tombolnya berkali-kali atau menutup aplikasi.
- **Validasi menyebut berapa item yang kurang dan menggulir ke item pertamanya.** Daftar 15 item terlalu panjang untuk dicari sendiri oleh orang yang sedang berdiri sambil memegang alat pel.
- **Kalau ada unggahan yang gagal, `checklist_runs` yang terlanjur dibuat DIHAPUS.** Tanpa itu, `unique (outlet_id, session_id, run_date)` akan menolak percobaan ulang hari itu — staff terjebak: gagal kirim, dan tidak bisa mencoba lagi sampai besok.

`checklist_runs.photo_path` **tidak dihapus** dari skema — tidak dipakai lagi untuk pengisian baru, tapi data lama tetap harus bisa dibuka di rekap.

### Retensi 90 hari (`purge-old-selfies`) — selfie presensi **dan** foto Daily Activities

Selfie presensi adalah **satu-satunya foto yang tumbuh setiap hari selamanya**: 2 foto × jumlah staff × 365 hari. Aset bertambah sesekali; presensi tidak pernah berhenti. Tanpa pembersihan, kuota pasti habis — pertanyaannya hanya kapan.

**Foto dihapus, baris presensinya TIDAK.** Jam masuk/pulang adalah dasar perhitungan gaji dan disimpan permanen. Yang nilainya habis seiring waktu hanya bukti visualnya.

**Kenapa tidak dihapus sama sekali sejak awal:** face recognition memverifikasi *kemiripan dengan descriptor tersimpan*, dan descriptor **tidak bisa dibalik menjadi gambar**. Kalau ada sengketa ("saya tidak absen jam segitu") atau kecurigaan seseorang memotret foto orang lain, foto itu satu-satunya bukti yang tersisa. Retensi 90 hari menahannya selama sengketa masih mungkin terjadi, lalu melepaskannya.

Urutannya penting: **file dihapus dulu, kolom path dikosongkan belakangan**. Kalau dibalik, file yang gagal dihapus kehilangan satu-satunya penunjuknya dan jadi sampah permanen yang tidak bisa ditemukan lagi.

```bash
supabase functions deploy purge-old-selfies
```

Uji tanpa menghapus apa pun: `{"dry_run": true}` mengembalikan jumlah + contoh path. Masa simpan bisa ditimpa dengan `{"days": 180}`.

Cron harian (jangan lupa header `Authorization` — lihat bagian *Push Notification Reminder* langkah 5):

```sql
select cron.schedule(
  'purge-old-selfies',
  '30 18 * * *',                       -- 18:30 UTC = 01:30 WIB, saat sepi
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

Sekali jalan membersihkan maksimal 500 baris presensi + 200 run aktivitas; sisanya menyusul di jalan berikutnya. Sengaja dibatasi supaya pembersihan pertama (yang bisa jadi ribuan file) tidak kadaluwarsa di tengah jalan.

⚠️ Pembersihan foto Daily Activities **wajib berjalan tanpa syarat**, bukan setelah `return` awal bagian selfie. Versi pertama function ini menaruhnya sesudah dua `return` (tidak ada selfie lama / mode dry run), sehingga begitu selfie sudah bersih, foto aktivitas **tidak pernah tersentuh** — dan responsnya tetap `ok: true`, jadi tidak ada yang curiga. Kalau nanti ada bucket ketiga yang ikut dibersihkan, jaga polanya tetap begini.

## Bug: policy Storage yang bergantung pada kolom yang baru diisi kemudian (migration `0050_asset_photo_rls_fix.sql`)

**Gejala:** menambah foto di Inventaris Aset selalu gagal.

**Penyebab.** Policy SELECT di `0045` berbunyi *"objek ini boleh dibaca kalau ada baris `assets` yang `photo_path`-nya sama dengan namanya"*. Tapi urutan penyimpanannya: simpan baris aset → unggah foto → **baru** isi `photo_path`. Pada detik file diunggah, `photo_path` masih NULL, tidak ada baris yang cocok, dan objek yang baru saja ditulis tidak bisa dibaca oleh pengunggahnya sendiri — Storage menggagalkan operasinya. Ketergantungan melingkar.

**Yang BUKAN perbaikan:** membalik urutan (isi `photo_path` dulu). Kalau unggahannya gagal, database menyimpan path ke file yang tidak pernah ada, dan tabelnya terlihat wajar sampai ada yang menekan "Lihat".

**Perbaikannya:** izin ditentukan oleh **prefix path**, bukan kolom yang ditulis kemudian — sama seperti seluruh bucket lain di repo ini (`attendance-selfies`, `bu-logos`). Path foto aset `{outlet_id}/{asset_id}.{ext}`, jadi folder pertamanya persis outlet pemiliknya dan izinnya bisa dinilai sebelum baris apa pun diperbarui.

Helper `asset_photo_outlet(text)` menjaga bentuk path sebelum di-cast ke uuid: tanpa itu, satu objek dengan nama folder non-UUID membuat cast **gagal total** dan errornya menjatuhkan seluruh query, bukan sekadar menolak satu baris.

**Aturan umum:** policy Storage tidak boleh bergantung pada kolom aplikasi yang diisi *setelah* unggahan. Pakai prefix path.

## Foto di tabel & PDF (Inventaris Aset)

Kolom **Foto** kini menampilkan thumbnail (klik = ukuran penuh), dan foto ikut tercetak di **export PDF**.

Signed URL diambil **sekali untuk seluruh halaman** lewat `getAssetPhotoUrls()` (`createSignedUrls`, jamak). Satu permintaan per baris akan menembakkan puluhan koneksi berbarengan dan sebagian tertunda lama — tabelnya lalu tampak "sebagian fotonya rusak" padahal hanya kena antrean.

Untuk PDF, `exportTablePDF` menerima sel berbentuk `{ image: dataUrl, w, h }`. **Harus data URL, bukan URL http**: jsPDF memuat gambar secara sinkron, jadi URL jaringan menghasilkan halaman kosong **tanpa error apa pun**. `imageToDataUrl()` mengurusnya sekaligus memperkecil ke 160 px / JPEG 0.7 — foto kamera HP berukuran 2–4 MB, dan 50 foto mentah menghasilkan PDF ratusan MB yang menggantungkan browser alih-alih memberi error. Konversinya dijalankan **berurutan**, bukan `Promise.all`, dengan alasan yang sama.

## Master User — email & filter (migration `0049_user_email.sql`)

Tabel Master User menampilkan **email** dan punya filter **nama/email/telp**, **BU**, dan **outlet**.

**Email disalin ke `user_profiles`, tidak dibaca langsung dari `auth.users`.** Skema `auth` sengaja tidak bisa dibaca klien lewat PostgREST — tabel itu juga memuat hash password dan token.

Kalau kolom Email kosong untuk **semua** orang, migration-nya belum dijalankan.

### Bug lanjutan: email user BARU kosong, user lama terisi (migration `0057`)

Trigger di `0049` dipasang pada `auth.users` dan melakukan `update user_profiles ... where id = new.id`. Tapi `create-staff-user` membuat akun auth **dulu**, baru barisnya di `user_profiles`. Pada detik trigger berjalan, baris profilnya **belum ada** — UPDATE mengenai **nol baris**, dan UPDATE yang tidak mengenai apa pun **bukan error**.

User lama punya email bukan karena trigger itu bekerja, melainkan karena diisi backfill saat `0049` dijalankan. Jadi trigger tersebut **tidak pernah sekali pun berhasil** untuk user baru — dan tidak ada satu tanda pun yang menunjukkannya.

**Perbaikan:** trigger kedua, `BEFORE INSERT` pada **`user_profiles`**, yang mengambil email langsung dari `auth.users`. Urutan langkah di aplikasi jadi tidak lagi berpengaruh, dan jalur pembuatan lain (dashboard Supabase, SQL manual) ikut tercakup tanpa perlu diingat.

Keduanya dipertahankan dan pembagiannya jelas: **`user_profiles` BEFORE INSERT** mengisi saat lahir, **`auth.users` AFTER UPDATE** menjaga tetap sinkron saat emailnya diganti.

`auth.users` selalu jadi sumber kebenaran — nilai yang dikirim pemanggil sengaja diabaikan. Kalau dipercaya, email di sini bisa berbeda dari email yang dipakai login, dan perbedaan itu tidak akan ketahuan sampai ada yang mencoba menghubungi orangnya.

**Pelajaran umum:** trigger yang meng-UPDATE tabel lain diam-diam gagal kalau barisnya belum ada. Kalau urutannya tidak bisa dijamin, isi dari sisi tabel yang menerima — bukan dari sisi yang mengirim.

**Filternya bekerja di sisi klien**, bukan query ulang: daftarnya memang sudah dimuat seluruhnya (RLS yang membatasi cakupan), jumlahnya puluhan bukan ribuan, dan menyaring lokal membuat hasil muncul seketika saat mengetik. Pilihan outlet dibangun dari scope yang benar-benar ada di data — outlet yang tidak dipakai siapa pun hanya akan jadi pilihan yang selalu menghasilkan tabel kosong.

Filter **disimpan di `container.dataset`** supaya tidak hilang saat halaman digambar ulang setelah aksi (nonaktifkan user, ubah scope, reset password). Tanpa itu admin harus mengetik ulang filternya untuk setiap orang yang disentuh.

⚠️ `wireRowActions()` dipanggil **di dalam** fungsi penggambar baris, dan **tidak boleh** dipanggil lagi dari `renderMasterUserPage` — kalau dobel, setiap klik dieksekusi dua kali (dialog muncul dua kali, aksi jalan dua kali).

## Mode Reservasi HOTEL (migration `0055_reservation_hotel_mode.sql`)

Modul Reservasi punya dua mode, diatur **per outlet** di menu **BU & Outlet → Edit Outlet → Mode Reservasi**:

| | Cafe | Hotel |
|---|---|---|
| Yang dipesan | meja, satu jam | kamar, rentang tanggal |
| Kuota | jumlah **pax** per slot | jumlah **unit** per tipe kamar |
| Persetujuan | ada (Menunggu → Dikonfirmasi) | **tidak ada** — admin isi langsung, status `confirmed` |
| Jalur website | ada (`reservasi.html`) | **tidak ada** |
| Staff App | bisa input | **hanya informasi + pengingat** |
| Status | Menunggu/Dikonfirmasi/Selesai/No-show | + **Check-in** & **Check-out** |

Mode di **outlet**, bukan BU: satu BU boleh punya hotel dan cafe sebagai dua outlet. Untuk BU yang seluruhnya hotel, semua outletnya diset `hotel` dan seluruh halaman Reservasi otomatis berganti.

### Anti double-booking dijaga DATABASE

`EXCLUDE USING gist` **tidak dipakai** — constraint itu melarang tabrakan sama sekali, sedangkan yang dibutuhkan "maksimal N yang bertabrakan" (Deluxe = 2 unit). Jadi dipakai trigger `cek_kuota_kamar()` dengan **`pg_advisory_xact_lock` per tipe kamar**: dua admin yang menekan Simpan di detik yang sama tidak bisa sama-sama lolos pemeriksaan lalu sama-sama menulis.

Aturannya sengaja di database, bukan di aplikasi: **double-booking baru ketahuan saat tamu sudah berdiri di depan meja resepsionis dengan koper.** Dengan trigger, aturannya tetap berlaku walau nanti ada bug di kode, atau ada yang menulis lewat SQL Editor.

**Rentang `[check_in, check_out)`** — tanggal check-out tidak dihitung bertabrakan. Tamu A keluar tanggal 5 dan tamu B masuk tanggal 5 memakai kamar yang sama itu normal. Constraint `reservations_menginap_minimal_semalam` mencegah `check_in = check_out`; tanpa itu rentangnya kosong, tidak pernah bertabrakan dengan apa pun, dan kuota bisa ditembus tanpa batas.

`room_availability()` menampilkan sisa unit **sebelum** admin menekan Simpan — supaya penolakan trigger jadi jaring pengaman, bukan cara utama memberi tahu bahwa kamarnya penuh. Kedua tempat itu harus dijaga tetap sama; kalau berbeda, yang menang selalu database dan gejalanya "kelihatan tersedia tapi ditolak".

### Ceklis check-in oleh STAFF (migration `0056_staff_check_in.sql`)

Di Staff App, tiap tamu di daftar "Datang hari ini" punya **kotak centang**. Staff biasa (bukan admin) mencentangnya untuk menandai tamu sudah datang, mengisi nomor kamar sekalian.

**Kenapa lewat RPC, bukan melonggarkan policy UPDATE.** RLS bekerja **per baris, bukan per kolom**. Sekali staff diizinkan meng-update baris booking, dia juga bisa mengubah tanggal menginap, tipe kamar, nama tamu, bahkan membatalkan booking — dan tidak ada cara menahannya di policy tanpa trigger pembanding OLD/NEW yang rumit dan mudah salah. `staff_check_in_booking()` hanya bisa melakukan satu hal karena memang tidak ada kolom lain yang ditulis di dalamnya. Izinnya jadi bisa dibaca sekali lihat.

**Check-out sengaja tidak diberikan ke staff.** Check-out melepas kamar sehingga bisa dipesan orang lain; kalau salah tekan, kamar tamu yang masih menginap bisa terjual.

Detail perilaku yang disengaja:

- **Menekan dua kali bukan error.** Kalau tamunya sudah `checked_in`, RPC mengembalikan keadaan apa adanya. Dua staff yang mencentang bersamaan tidak sedang melakukan kesalahan, dan pesan merah untuk hal yang sudah beres cuma membuat orang ragu.
- **Centang dibatalkan dulu sampai server menerima.** Kalau dibiarkan tercentang lalu gagal, staff terlanjur mengira tamunya sudah tercatat.
- **Tidak bisa di-uncheck.** Membatalkan check-in berarti mengembalikan status; itu tindakan admin. Setelah tercentang, kotaknya terkunci dan diganti keterangan **siapa** yang menandai (`checked_in_by`) dan **jam berapa**.

### Notifikasi mode hotel — dua bug yang membuatnya diam total

**1. Push tidak pernah terkirim untuk booking hotel.** `notify-reservation` dulu berbunyi `r.status === 'pending' ? pushKeAdmin(...) : lewati`. Booking hotel dibuat admin dan **langsung `confirmed`**, jadi kondisi itu tidak pernah terpenuhi — tidak ada push sama sekali, dan tidak ada error apa pun yang menandakannya. Syarat status dihapus; trigger-nya memang hanya `on insert`, jadi yang batal/ditolak tetap tidak ikut terkirim.

**2. Push hanya ke admin.** Alasan lamanya ("merekalah yang menyetujui") benar untuk reservasi cafe dari website, tapi salah begitu booking diisi admin sendiri: orang yang justru perlu tahu — resepsionis dan staf yang menyiapkan kamar — tidak pernah dapat kabar. Sekarang push ke **seluruh tim outlet**, dibatasi persis seperti apa yang orang itu lihat di app: punya scope di outlet tersebut (atau level BU), dan modul Reservasi tidak dicabut lewat `user_module_access`.

Isi pesannya sadar mode. Memaksakan satu format akan menampilkan **"null tamu"** di salah satunya, karena `pax`/`reserve_time` memang tidak diisi untuk booking kamar, dan `check_in`/`check_out` tidak diisi untuk reservasi meja.

### Rekap harian (`send-reservation-digest`) untuk kedua mode

Berlaku **cafe maupun hotel**, lewat Telegram **dan** Web Push. **Hari kosong tetap dikirim** ("Tidak ada reservasi hari ini") — supaya tim tahu rekapnya memang jalan, bukan diam karena rusak.

Untuk hotel, `reserve_date` = `check_in` (trigger 0055), jadi filter tanggal yang sama otomatis berarti **"tamu yang datang hari itu"** — tidak perlu query terpisah.

Dua detail yang mudah salah:

- **Jumlah tamu dihitung berbeda.** Cafe dari `pax`; hotel dari `adults + children`. Tanpa pembedaan ini rekap hotel selalu melaporkan **"0 tamu"**, karena `pax` memang null untuk booking kamar.
- **Status `checked_in` ikut disertakan**, supaya rekap yang dijalankan ulang siang hari tidak mendadak kehilangan tamu yang sudah keburu datang.

Judulnya mengikuti mode: 🏨 *Check-in hari ini* untuk hotel, 📅 *Reservasi hari ini* untuk cafe. Kalau seseorang membawahi keduanya, dipakai istilah cafe agar tidak ada yang terasa keliru.

### Tamu yang sudah check-out hilang dari Staff App

`getHotelHarian()` kini mengecualikan status `checked_out`. Sebelumnya tamu yang sudah pulang tetap nongkrong di daftar sampai ganti hari — terlihat seolah masih ada. Booking yang tanggal check-out-nya sudah lewat hilang sendiri lewat filter `check_out >= tanggal`.

### Batalkan vs Hapus (Admin Portal)

Dua tombol berbeda, dan bedanya sengaja ditegaskan di teks konfirmasinya:

- **Batalkan** → status `cancelled`, kamar langsung bebas, **jejaknya tetap ada**: siapa yang membatalkan, kapan, dan alasannya masih terbaca di riwayat serta laporan.
- **Hapus** → barisnya hilang permanen. Pertanyaan "kenapa kamar itu kosong tanggal segitu" jadi tidak punya jawaban.

Keduanya sama-sama membebaskan kamar, jadi tanpa penjelasan itu orang akan memilih yang salah. `deleteReservation()` memakai `.select()` — RLS menolak dengan membalas sukses 0 baris, dan tanpa pemeriksaan itu admin outlet lain melihat "terhapus" padahal bookingnya masih ada.

### Kirim konfirmasi lewat Email

`shareDialog()` kini menerima `email` dan `subject`. Kalau `email` diisi, muncul tombol **✉️ Email** yang membuka aplikasi email dengan **tujuan sudah terisi** dari formulir — bukan share sheet kosong yang memaksa admin mengetik ulang alamatnya. Tanpa ini, alamat email yang susah payah diminta di formulir tidak pernah benar-benar dipakai.

Dua detail teknis:

- Isi pesannya dibaca dari **textarea saat tombol diklik**, bukan dari `defaultMessage` — supaya suntingan admin ikut terkirim.
- Dipakai `window.location.href`, **bukan `window.open`**: sebagian browser memblokir popup ke skema non-http, dan yang muncul cuma tab kosong tanpa pesan apa pun.

Berlaku di kedua mode (cafe & hotel), untuk konfirmasi maupun penolakan. Tombolnya **tidak muncul** kalau customer tidak mengisi email — tombol yang membuka email tanpa tujuan lebih membingungkan daripada tidak ada tombol.

### Keputusan lain yang perlu diingat

**`reserve_date` jadi tanggal acuan.** Untuk hotel diisi otomatis = `check_in` lewat trigger. Dengan begitu penomoran kode `RSV-YYMMDD-XXX`, index tanggal, rekap harian, dan digest Telegram yang sudah ada **tidak perlu diubah sama sekali**.

**Kolom cafe jadi nullable, tapi dijaga CHECK per mode** (`reservations_isi_sesuai_mode`). Tanpa CHECK itu, kolom nullable berubah jadi undangan menyimpan baris setengah jadi yang baru ketahuan salah saat ditampilkan.

**Nomor kamar TIDAK divalidasi.** Sesuai keputusan, kuota dijaga per **tipe** dan nomor kamar diketik saat check-in. Sistem menjamin tidak lebih dari 2 tamu Deluxe menginap bersamaan, tapi tidak bisa mencegah resepsionis mengetik "201" untuk dua tamu. Kalau nanti perlu, tinggal tambah tabel kamar dan `qty` berubah jadi hasil hitungan — strukturnya tidak perlu dibongkar.

**Jalur website ditutup dua lapis:** Edge Function `submit-reservation` menolak outlet hotel dengan pesan yang ramah, dan constraint `reservations_hotel_bukan_dari_web` menolaknya di database kalau pemeriksaan itu terlewat.

`list_attendance_outlets()` didefinisikan ulang untuk ikut membawa `reservation_mode` — kalau tidak, tiap halaman terpaksa query outlet lagi hanya untuk tahu modenya, dan cepat atau lambat ada yang lupa lalu menampilkan form yang salah.

## Dropdown outlet wajib menghormati scope user (`js/core/my-outlets.js`)

Sumber kebenaran "outlet siapa" adalah `membership_scopes` — yang diatur super admin di **Master User**. Seluruh modul memakai satu fungsi: **`listMyOutlets(businessUnitId)`**.

```
super_admin                      -> semua outlet BU
bu_admin di BU ini               -> semua outlet BU
scope level BU (outlet_id null)  -> semua outlet BU (memang tidak terikat satu outlet)
scope per outlet                 -> hanya outlet itu (boleh lebih dari satu)
tidak punya scope di BU ini      -> KOSONG
```

**Masalah sebelumnya.** Tiap modul memanggil `listAttendanceOutlets()` — RPC security-definer yang mengembalikan **seluruh outlet aktif lintas BU** — lalu menyaring sendiri hanya berdasarkan BU. Akibatnya staf satu outlet melihat, dan bisa memilih, outlet tetangganya. Datanya tetap dibatasi RLS, jadi yang muncul cuma daftar kosong atau angka nol — user hanya bingung kenapa ada outlet yang tidak bisa dibuka. Yang benar: outlet itu tidak boleh muncul sejak awal.

**GAGAL TERTUTUP, bukan terbuka.** `getMyScopedOutlets()` yang lama mengembalikan **seluruh outlet BU** di tiga jalur kegagalan — scope kosong, query error, dan outlet tidak ketemu di daftar — dengan logika "kalau ragu, tampilkan semua". Untuk pertanyaan hak akses default itu terbalik: keraguan harus menutup. Daftar kosong yang jelas jauh lebih mudah dilaporkan user daripada kebocoran diam-diam. Fungsi lama kini hanya alias.

**Dua pengecualian yang sah**, keduanya bukan dropdown pilihan:

- **Presensi** memang lintas BU — staff bisa absen di outlet BU lain (tugas luar/storing).
- **Pengiriman**: daftar outlet **tujuan** tetap seluruh BU, karena staf outlet cabang harus bisa memilih Central Kitchen sebagai tujuan order padahal CK bukan scope-nya. Kalau ikut disaring, seluruh alur order stok mati. Outlet **pengirim** tetap dari `listMyOutlets()`.

Sisanya (peta id → nama untuk rekap, dan menu khusus super admin) terdaftar sebagai pengecualian beralasan di alat auditnya.

## Bug: menambah SATU foreign key mematikan halaman yang tidak disentuh

**Gejala:** setelah `0062` di-push — `Could not embed because more than one relationship was found for 'attendance_records' and 'user_profiles'`. Rekap Presensi mati total.

**Penyebab.** `0062` menambah `attendance_records.nbm_outlet_changed_by → user_profiles`, sementara `user_id → user_profiles` sudah ada. PostgREST menolak embed yang ambigu.

Yang membuatnya berbahaya: **query-nya tidak diubah satu baris pun**. Yang berubah cuma skema. Kolom barunya bahkan tidak dipakai UI mana pun — tapi seluruh halaman yang memakai embed itu langsung gagal.

**Perbaikan:** semua embed ke tabel yang jadi tujuan banyak FK **wajib menyebut kolomnya** — `user_profiles!user_id(...)`, bukan `user_profiles(...)`. Menyebut kolomnya juga membuat maksudnya terbaca: `!created_by` vs `!user_id` langsung menjelaskan orang mana yang dimaksud.

Sepuluh embed lain yang belum rusak tapi rentan pada jebakan yang sama ikut dieksplisitkan. `tools/audit-embed-ambigu.cjs` menjaganya — dan pengecualiannya wajib menyertakan alasan, supaya daftar pengecualian tidak berubah jadi tempat menyembunyikan risiko.

⚠️ **Ingat ini setiap kali menambah kolom FK**: cek dulu apakah tabel tujuannya sudah jadi sasaran FK lain dari tabel yang sama.

## Outlet basis adalah POTRET, dan cara membetulkannya (migration `0062`)

`attendance_records.nbm_outlet_id` diisi dari basis (★) **pada detik clock-in**, lalu ikut tersimpan di baris presensinya. Rekap NBM menghitung dari kolom itu.

**Ini desain yang benar dan sengaja dipertahankan.** Kalau basis dibaca ulang saat rekap disusun, mengubah basis seseorang hari ini akan **menulis ulang seluruh riwayat gajinya** — bulan yang sudah dibayarkan ikut berubah angkanya.

**Tapi potret hanya seakurat saat pemotretannya.** Kasus nyata: seseorang pindah outlet tanggal 2, basis (★)-nya baru diperbarui tanggal 3. Presensi tanggal 2 terlanjur tercatat di outlet lama. Akibatnya bukan cuma label:

- NBM-nya dihitung dengan **konfigurasi outlet lama** — tarif base, tier lembur, kebijakan PH;
- saat rekap difilter ke outlet **baru**, barisnya **hilang sama sekali** — bukan tampil dengan angka salah, tapi tidak muncul. Itu yang paling mudah terlewat saat memeriksa.

### Dua cara membetulkan

**Satu baris** — dialog *Koreksi* di Rekap Presensi kini punya isian **Outlet basis** + alasan. Untuk membetulkan satu hari yang meleset.

**Beberapa hari sekaligus** — tombol **⇄ Koreksi Outlet Basis** di Rekap NBM: pilih staff, rentang tanggal, outlet yang benar, dan alasan. **Selalu dihitung dulu sebelum diubah** — admin melihat berapa baris yang akan terpengaruh, baru menyetujui. Rentang yang kelewat lebar bisa memindahkan berminggu-minggu gaji dalam satu klik, dan tidak ada tombol urungkan.

### Detail yang menentukan benar-tidaknya

- **Izin GANDA.** Pemanggil harus admin di outlet **tempat absen** *dan* di outlet **basis tujuan**. Kalau hanya salah satu, admin outlet A bisa memindahkan beban gaji ke outlet B yang bukan tanggung jawabnya — dan admin B tidak akan pernah tahu angkanya bertambah dari mana. Aturan sekompleks itu tidak bisa diungkapkan lewat policy RLS biasa, jadi dipakai RPC.
- **`nbm_business_unit_id` ikut diperbarui** mengikuti BU outlet barunya. Tanpa itu barisnya jadi tidak konsisten: rekap NBM menyaring dengan kolom itu, sehingga baris yang basisnya pindah BU akan hilang dari **kedua** BU sekaligus.
- **`p_dry_run` default `true`.** Kalau pemanggil lupa mengirim parameter, yang terjadi adalah tidak terjadi apa-apa — bukan perubahan massal diam-diam.
- **Baris di luar wewenang DILEWATI, bukan menggagalkan semuanya.** Kalau digagalkan total, admin outlet tidak akan pernah bisa membetulkan barisnya sendiri hanya karena ada satu baris milik outlet lain yang kebetulan masuk rentang. Jumlah yang dilewati tetap dilaporkan.
- Baris yang pernah dikoreksi diberi tanda **"dikoreksi"** di Rekap NBM, dengan alasannya sebagai tooltip — supaya angka yang berbeda dari perkiraan bisa ditelusuri, bukan dicurigai salah hitung.

## Bug: RLS berlaku juga DI DALAM ekspresi policy (migration `0061`)

**Gejala:** admin outlet membuka Rekap Presensi / Rekap NBM — **barisnya muncul, tapi kolom nama isinya "-"**.

Gejala itu sendiri sudah menunjuk penyebabnya: data presensinya **lolos** RLS (policy presensi memakai `is_admin_of_outlet`, yang memang mencakup outlet_admin), sementara embed `user_profiles(full_name)` **ditolak**.

**Penyebabnya halus.** Policy `user_profiles_select_scoped` (dari `0001`) sudah menyebut `outlet_admin` secara eksplisit — sekilas terlihat benar. Tapi isinya menjoin ke `membership_scopes` **orang lain**:

```sql
join membership_scopes theirs on theirs.user_id = user_profiles.id
```

dan **RLS berlaku juga di dalam ekspresi policy**. Pembacaan `theirs` tunduk pada RLS `membership_scopes`, di mana `membership_scopes_select_admin` memakai `is_bu_admin()` — yang **tidak mencakup outlet_admin**. Jadi bagi outlet_admin, `theirs` selalu kosong, `EXISTS` gagal, dan namanya tidak pernah terbaca.

Untuk bu_admin kebetulan jalan. **Itulah kenapa bug ini hanya muncul pada satu peran** dan lolos dari pengujian biasa — persis pola yang berulang di dokumen ini.

**Perbaikan:** pemeriksaannya dipindah ke fungsi `SECURITY DEFINER` (`sesama_anggota_bu`), sehingga pembacaan scope di dalamnya tidak lagi disaring RLS. Pola ini sudah dipakai `is_bu_admin()` dan `has_outlet_scope()` sejak awal — policy inilah yang tertinggal karena ditulis sebagai subquery inline.

**Aturan umum:** kalau ekspresi policy membaca tabel yang juga ber-RLS, bungkus dalam fungsi `SECURITY DEFINER`. Kalau tidak, policy-nya akan berperilaku berbeda per peran dengan cara yang tidak terbaca dari policy itu sendiri.

## Rekap NBM — Total per Staff di atas, plus WhatsApp & PDF

Tabel **Total per Staff** dipindah ke **atas** tabel rincian: yang dicari saat membuka halaman ini hampir selalu angka totalnya, bukan baris per presensi.

Ditambah tombol **💬 WhatsApp** dan **⇩ PDF** khusus untuk tabel total itu. Teks WhatsApp-nya memuat **outlet dan rentang tanggal**, jadi penerima tidak perlu bertanya periode mana — dan barisnya ditutup grand total.

Judul periode dihitung **sekali** lalu dipakai kartu, teks WhatsApp, dan PDF bersama-sama. Kalau dihitung terpisah di tiga tempat, cepat atau lambat salah satunya tertinggal saat filternya berubah — dan rekap gaji yang menyebut periode salah adalah kesalahan yang mahal.

Dialog WhatsApp-nya sengaja **tanpa nomor tujuan**: rekap ini dibagikan ke grup atau atasan yang berbeda-beda, jadi pengirim memilih sendiri lewat share sheet.

## Kas: jumlah + satuan, nota wajib, dan Laporan Kas (migration `0060`)

**Jumlah barang & satuan dipisah dari keterangan** (Bensin · **10** · **liter**). Ditulis sebagai satu kalimat, "Bensin 10 liter" tidak bisa dijumlahkan di laporan — dan menjumlahkan itulah gunanya kolom.

**Foto nota WAJIB untuk kas KELUAR saja** (sejak `0063`). Kas masuk tidak selalu punya nota — setoran tunai, sisa kembalian, uang dari kasir; mewajibkannya di situ hanya menciptakan foto asal-asalan supaya formnya mau lanjut, dan bukti yang dipalsukan agar sistem diam lebih buruk daripada tidak ada bukti. Transfer antar pemegang dan perpindahan antar kantong sendiri juga dikecualikan: uang hanya berpindah tempat, tidak ada nota yang bisa difoto.

### Urutan unggah dibalik, dan itu yang membuat aturannya bisa ditegakkan

Modul lain menyimpan barisnya dulu lalu mengisi `proof_path` lewat UPDATE. Dengan pola itu, constraint "nota wajib" **tidak mungkin** ditegakkan — barisnya sudah terlanjur masuk tanpa nota, dan UPDATE yang gagal tidak menghasilkan error apa pun (persis bug email di `0057`).

Di sini fotonya diunggah **lebih dulu**, memakai id yang dibuat klien, lalu barisnya di-insert dengan `proof_path` sudah terisi. Bisa dibalik karena policy Storage bucket ini berbasis **prefix path** (`{uid}/...`), bukan berdasarkan ada-tidaknya baris kas. Kalau insert-nya gagal, fotonya dihapus supaya tidak jadi file yatim.

Constraint-nya `NOT VALID` — hanya berlaku untuk baris **baru**. Entri lama tanpa nota tidak diutak-atik: memvalidasi mundur akan menggagalkan migration hanya karena data historis, dan riwayat kas justru yang paling tidak boleh diubah belakangan.

### Kas Masuk dan Kas Keluar bukan form yang sama (migration `0063`)

Dulu satu form dipakai untuk keduanya, hanya jenisnya yang berbeda. Akibatnya pencatat kas masuk tetap dipaksa mengisi kategori pengeluaran dan memotret nota yang tidak ada.

- **Kas Masuk**: jumlah uang, keterangan, tanggal, foto **opsional**. Tidak ada outlet — uang masuk ke orangnya, belum diperuntukkan ke mana pun.
- **Kas Keluar**: kategori, **outlet peruntukan (wajib)**, jumlah + satuan, **foto nota wajib**.

### Outlet pada kas = PERUNTUKAN, bukan pemilik

Yang memegang uang tetap **user** dan sepenuhnya tanggung jawabnya. `cash_entries.outlet_id` kini berarti **untuk outlet mana uang itu dibelanjakan** — dan hanya boleh diisi outlet tempat user punya peran, **di BU mana pun**.

Dropdown-nya memakai `listMyOutletsAllBu()` (`js/core/my-outlets.js`), bukan `listMyOutlets()` yang terikat BU aktif. Alasannya sama dengan alasan kas melekat pada orang: uangnya dibawa ke mana pun dia login. Membatasi peruntukan ke BU yang kebetulan sedang dibuka berarti orang yang belanja untuk outlet BU lain harus berganti BU dulu — dan kalau lupa, dia akan memilih outlet yang salah justru karena itu satu-satunya yang tersedia. Aturan penyaringannya sama persis, diterapkan per BU, dan tetap **gagal tertutup**. Nama BU ikut ditulis di label karena dua outlet bernama mirip di BU berbeda tidak bisa dibedakan tanpa itu.

Konsekuensi di sisi baca: admin sebuah outlet bisa melihat baris kas milik orang dari BU lain, selama uangnya diperuntukkan bagi outlet yang dia adminkan. Itu memang yang diinginkan — dialah yang berkepentingan atas belanja untuk outletnya. Constraint `cash_entries_outlet_wajib_saat_keluar` menegakkannya di database, `NOT VALID` supaya baris lama tidak diutak-atik.

Ini menggantikan cara lama yang menurunkan outlet dari tempat kerja utama (★) pemegangnya. Cara lama punya sifat yang tidak enak: memindahkan basis ★ seseorang diam-diam mengubah laporan periode yang sudah lewat. Sekarang peruntukan dicatat **saat kejadian** dan tidak ikut berubah belakangan.

Konsekuensi yang perlu diketahui: baris kas **masuk** tidak punya peruntukan, jadi menyaring laporan per outlet otomatis menyisihkannya. Itu memang yang diinginkan — pertanyaan "berapa yang dibelanjakan untuk outlet X" bukan pertanyaan tentang pemasukan.

### Kantong kas (sub-kas) per user

Sebagian orang memegang lebih dari satu kas dengan peruntukan berbeda (mis. *Kas Owner* dan *Kas Operasional*). Jumlah kantong yang boleh dibuat diatur admin BU / super admin per user (`user_profiles.cash_account_limit`, default **1**).

Diatur di **Master User → Edit** pada staff yang bersangkutan. Default `1` berarti tampilannya **persis seperti sebelumnya** — tidak ada istilah "kantong" yang muncul untuk orang yang tidak membutuhkannya. Batasnya ditegakkan trigger di database (`cek_batas_kantong_kas()`), bukan hanya di form: pemeriksaan yang cuma ada di UI selalu bisa dilewati, dan yang melewatinya tidak akan tahu bahwa dia sedang melanggar apa pun.

⚠️ Batas itu **tidak cukup dijaga policy** (migration `0065`). Policy `user_profiles_update_own` mengizinkan setiap orang memperbarui barisnya sendiri, dan policy bekerja per **baris**, bukan per **kolom** — jadi siapa pun bisa menaikkan jatah kantongnya lewat API tanpa menyentuh UI. Dampaknya kecil (kantong bertambah, saldo tidak), tapi yang berbahaya adalah kalimat di dokumentasi yang menjanjikan kontrol yang tidak pernah ada: batas yang diyakini ada padahal tidak, lebih buruk daripada tidak punya batas. Penjaganya berupa trigger `jaga_batas_kantong_kas()`, supaya kolom lain tetap bisa diperbarui pemiliknya seperti biasa.

Menurunkan batas **tidak** menghapus kantong yang terlanjur dibuat — itu berarti menghapus riwayat kas di dalamnya. Yang terjadi: user tidak bisa menambah kantong baru sampai jumlahnya turun sendiri.

Nama kantong ditentukan **user sendiri**. Uangnya bisa dibagi saat mencatat, atau dipindahkan belakangan lewat `pindah_kas()` — yang menulis sepasang baris `move_out`/`move_in` supaya saldonya tetap bisa ditelusuri, bukan menyunting angka lama.

### Jebakan: opsi SAH yang bernilai string kosong di `<select>` wajib

**Gejala:** dialog Pindah Kas menolak dengan *"Dari kantong" wajib diisi* — padahal "Kas Utama" jelas-jelas sudah terpilih di layar.

**Penyebab.** `formDialog` menganggap nilai kosong sebagai "belum diisi". "Kas Utama" diberi `value: ''` karena di database ia memang `account_id` NULL, jadi memilihnya sama saja dengan tidak memilih apa pun. Formnya terlihat terisi, validasinya berpendapat sebaliknya — dan tidak ada cara mengetahuinya selain menekan tombol simpan.

**Perbaikan.** "Kas Utama" diwakili penanda `KAS_UTAMA = '__utama__'`, baru diubah jadi `null` tepat sebelum dikirim ke database (`idKantong()`). String kosong tetap dipakai untuk placeholder "-- pilih --" yang memang **harus** ditolak, mis. satuan produk. Dijaga `node tools/audit-select-wajib.cjs`.

### "Kas Utama" adalah tempat sungguhan, dan harus bisa dipindahkan

`account_id` NULL = **Kas Utama**: tempat uang berada sebelum kantong pertama dibuat, dan tempat semua entri lama sebelum `0063`. Dialog Pindah Kas dulu hanya menawarkan kantong **bernama**, sehingga saldo di Kas Utama terkunci — terlihat jelas di rincian saldo, tapi tidak ada satu pun jalan untuk memindahkannya. `pindah_kas()` di database memang sudah menerima NULL sejak awal; yang kurang cuma pilihannya di layar.

### Kelola kantong: ubah nama & hapus

Ditampilkan sebagai **panel di halaman**, bukan dialog berisi dropdown "Mau apa?". Versi dropdown menyembunyikan Ubah Nama dan Hapus di dalam daftar pilihan — secara teknis ada, tapi tidak ada yang menemukannya, dan memang tidak ditemukan. Tombol yang tidak ditemukan sama saja dengan tombol yang tidak dibuat.

**Ubah nama berlaku surut ke seluruh laporan**, termasuk periode yang sudah lewat. Itu bukan efek samping melainkan konsekuensi langsung dari desainnya: nama kantong dibaca dari `cash_accounts` lewat join, tidak disalin ke tiap transaksi. Dikatakan terus terang di dialognya, karena orang yang mengira hanya mengganti label ke depan akan kaget melihat laporan bulan lalu ikut berubah.

**Menghapus kantong tidak menghilangkan uangnya** (migration `0066`). RPC `hapus_kantong_kas()` memindahkan seluruh entri ke kantong tujuan (boleh Kas Utama) lebih dulu, baru menghapus barisnya. Saldo total pemegang tidak berubah sepeser pun.

Sebelumnya `on delete restrict` membuat kantong yang pernah dipakai **tidak bisa dihapus sama sekali** — yang muncul cuma pesan foreign key mentah, bukan jalan keluar. Praktiknya orang meninggalkan kantong tak terpakai selamanya, dan jatahnya habis oleh sampah.

Entrinya **dipindahkan** (`account_id` di-update), bukan dibuatkan sepasang baris mutasi: kantong itu cuma label untuk uang milik sendiri. Transaksinya — tanggal, nominal, nota, outlet peruntukan — tidak berubah sama sekali; yang hilang hanya nama laci tempat ia disimpan. Menambahkan mutasi ke kantong yang sudah tidak ada justru membuat riwayatnya lebih sulit dibaca, bukan lebih jujur.

Tujuan tetap ditanyakan **walau saldonya nol**: kantong bersaldo nol masih bisa berisi transaksi masuk & keluar yang saling meniadakan, dan transaksi itu tetap harus punya tempat.

### Laporan Kas per Pemegang

Filter **pemegang + outlet + kategori + periode**, dengan **Export PDF & Excel**. Kolom Outlet adalah peruntukan pada barisnya sendiri (lihat di atas) — sejak `0063` ia kolom sungguhan, bukan turunan.

Admin BU juga bisa melihat baris kas **masuk** anak buahnya. Predikat lama hanya mengizinkan lewat `is_admin_of_outlet(outlet_id)`, sementara kas masuk `outlet_id`-nya NULL — hasilnya laporan yang separuhnya hilang tanpa pesan apa pun, dan angkanya tetap terlihat wajar.

Lewat RPC `laporan_kas_user()` karena RLS `cash_entries` hanya membuka baris milik sendiri; laporan perlu lintas orang, dan itu dibuka terkendali di dalam RPC — bukan dengan melonggarkan policy tabelnya.

**Export Excel berlaku untuk SEMUA laporan**, bukan cuma kas. Kolom bertanda `numeric` ditulis sebagai **angka**, bukan teks — kalau jadi teks, `SUM` di Excel menghasilkan nol, dan justru menjumlahkan itulah alasan orang meminta Excel alih-alih PDF.

Dropdown pemegang & kategori hanya muncul untuk laporan yang memakainya (`pakaiFilterUser`, `pakaiFilterKategori`). Filter yang tidak berpengaruh apa pun lebih membingungkan daripada tidak ada filter — orang akan mengubahnya lalu heran kenapa hasilnya sama. Kategori **nonaktif** tetap ikut ditampilkan di dropdown: transaksi lama masih memakainya, dan laporan periode lampau jadi tidak bisa disaring kalau kategorinya dipensiunkan.

## Divisi (Kitchen, Bar, Mekanik) — migration `0059_divisi.sql`

Staff dikelompokkan per **divisi**, dipakai untuk mengurutkan tabel **Jadwal Shift** dan **Rekap Presensi**. Diatur di **Master User → 🏷️ Kelola Divisi**, lalu dipilih pada tiap scope.

**Melekat di SCOPE, bukan di user.** Orang yang bekerja di Cafe *dan* Bengkel bisa jadi "Kitchen" di Cafe dan "Mekanik" di Bengkel. Kalau divisi ditaruh sebagai satu kolom di `user_profiles`, nilainya pasti salah di salah satu tempat dan tidak ada cara memperbaikinya selain membongkar desainnya.

**Daftar master, bukan teks bebas.** "Kitchen", "kitchen", dan "Ktichen" akan jadi tiga kelompok terpisah — dan pengelompokannya rusak tanpa ada yang sadar, karena tabelnya tetap tampil rapi, cuma isinya salah.

**Urutan diatur admin**, bukan abjad: "Kitchen sebelum Bar" adalah urutan operasional yang masuk akal, sedangkan abjad memaksa sebaliknya.

Trigger `divisi_cocok_bu()` menjaga divisi benar-benar milik BU yang sama dengan scope-nya — tanpa itu, panggilan API langsung bisa menempelkan divisi Cafe ke scope Bengkel, dan itu tidak akan terlihat di UI mana pun karena dropdown-nya memang sudah benar.

### Aturan tampil berbeda antara dua tabel — dan itu disengaja

| | Jadwal Shift | Rekap Presensi |
|---|---|---|
| Staff **tanpa divisi** | **tidak tampil** | **tetap tampil**, dikelompokkan "Tanpa divisi" |
| Alasan | roster adalah rencana — orang yang belum ditentukan bagiannya belum siap dijadwalkan | rekap adalah **bukti kehadiran**; menghilangkan baris yang datanya ada berarti jam kerja seseorang lenyap dari catatan |

**Yang hilang selalu diberitahukan.** Di kedua tampilan shift, staff tanpa divisi disebut jumlah **dan namanya** di bawah tabel. Orang yang menghilang tanpa penjelasan adalah cara tercepat membuat admin mengira aplikasinya rusak.

Pengecualian di Admin Portal: staff tanpa divisi yang **sudah terlanjur punya jadwal** tetap ditampilkan (kelompok "Tanpa divisi (sudah terjadwal)"). Menyembunyikan baris yang punya data berarti jadwalnya tidak bisa dibatalkan, dan tidak akan ada yang tahu jadwal itu masih menggantung.

Menghapus divisi memakai `on delete set null` — staff yang memakainya **tidak** ikut terhapus, hanya kembali "belum berdivisi".

## Staff nonaktif: hilang dari daftar pilihan, TETAP ADA di riwayat (migration `0058`)

Menyembunyikan staff nonaktif "di semua tempat" terdengar benar, tapi setengahnya justru merusak. Ada dua jenis daftar yang kebetulan memakai fungsi yang sama, dengan aturan berlawanan:

| | Harus HILANG | Harus TETAP ADA |
|---|---|---|
| Jenisnya | **daftar pilihan** | **catatan riwayat** |
| Contoh | roster Jadwal Shift, Jatah Cuti, pemilih penerima kas | Laporan payroll, Rekap Disiplin, rekap presensi periode lalu |
| Alasan | orang yang sudah keluar tidak boleh bisa dijadwalkan atau diberi jatah | orang yang bekerja bulan lalu lalu keluar **tetap harus terhitung** di laporan bulan lalu |

Menyembunyikan di laporan berarti **menulis ulang sejarah**: total jam dan gaji jadi tidak cocok dengan kenyataan, dan tidak ada penjelasan kenapa.

Karena itu `list_outlet_staff()` dan `list_bu_staff_for_admin()` menerima `p_include_inactive`, **default `false`** — sisi yang aman. Yang butuh riwayat harus menyatakannya sendiri, sehingga setiap tempat yang menampilkan orang nonaktif bisa ditelusuri dari kodenya:

- `report.service.js` → `includeInactive: true` di **seluruh** laporan.
- `shift.admin.page.js` → `includeInactive: true`, lalu disaring lagi di JS agar **hanya yang masih punya jadwal** yang tampil. Kalau barisnya disembunyikan padahal jadwalnya ada, tidak akan pernah ada yang tahu jadwal itu masih menggantung.

Yang sudah benar sejak awal: `list_cash_members()` (`where up.is_active is not false`) dan **Master User** — di sana justru harus tampil semua, karena itu satu-satunya tempat mengaktifkan kembali.

## Basis (★) itu TITIK AWAL, bukan kurungan

**Gejala:** manager ber-role super admin, basisnya BU *Admin Divisi* / outlet *Admin*, tidak bisa melihat Jadwal Shift *Awal Bermula Cafe* sama sekali — memindahkan pemilih BU di menu atas tidak berpengaruh apa pun.

**Penyebab.** Waktu Jadwal Shift dibuat "menempel pada basis", halamannya memakai BU basis sebagai **satu-satunya** sumber daftar outlet dan **mengabaikan** pemilih BU. Untuk staff biasa itu benar — pertanyaannya "kapan **saya** masuk". Tapi jadwal shift bukan dokumen pribadi; ia **daftar kerja tim**.

**Bedakan dua jenis modul:**

| | Menempel pada ORANG | Mengikuti BU AKTIF |
|---|---|---|
| Contoh | Pengajuan Cuti, Presensi | **Jadwal Shift** |
| Alasan | dokumen milik orang itu — salah tujuan = atasan tidak pernah menerima | daftar kerja tim — manajer memang perlu melihat tim lain |

Untuk Jadwal Shift, basis kini hanya menentukan **outlet mana yang terpilih lebih dulu**, dan itu pun hanya kalau outletnya kebetulan ada di BU yang sedang aktif. Staff yang BU-nya cuma satu tidak merasakan perbedaan apa pun.

### Super admin tidak perlu didaftarkan ke tiap BU

Daftar BU di **Staff App** dulu dibangun murni dari baris scope. Akibatnya super admin yang scope-nya satu (mis. Admin Divisi) hanya melihat satu BU di pemilih — padahal perannya berarti "semuanya". Satu-satunya jalan keluar: menambahkan scope `bu_admin` ke **setiap** BU secara manual — pekerjaan yang tidak seharusnya ada, karena daftar scope jadi panjang dan tiap BU baru harus diingat untuk ditambahkan lagi.

Sekarang super admin otomatis mendapat seluruh BU di pemilih. **Admin Portal sudah lama begitu; Staff App yang tertinggal.**

Konsekuensi praktis: scope `bu_admin` yang ditambahkan sebagai akal-akalan boleh dihapus — cukup satu baris `super_admin` plus basis (★)-nya.

## "Invalid session" saat memanggil Edge Function (`js/core/invoke.js`)

**Gejala:** Tambah Staff / Reset Password / Kirim Tes gagal dengan *Invalid session*, padahal jelas-jelas sedang login.

**Penyebab.** `supabase.functions.invoke()` mengirim token apa pun yang sedang dipegang klien — **tanpa memeriksa apakah masih berlaku**. Access token Supabase berumur pendek (±1 jam) dan diperbarui otomatis di latar belakang, tapi perpanjangan itu bisa terlewat kalau tab dibiarkan terbuka lama, HP tertidur, atau koneksi sempat putus. Token basi tetap dikirim, server menolak, dan yang terbaca admin adalah "Invalid session" — terdengar seperti aplikasi rusak.

**Perbaikan.** Semua pemanggilan Edge Function lewat `invokeFunction()`, yang mengambil sesi (dan **memperbaruinya kalau perlu**) sebelum mengirim, dengan jeda 60 detik supaya token yang "hampir" mati tidak sempat kedaluwarsa di tengah perjalanan. Kalau memang tidak ada sesi, yang muncul kalimat yang bisa ditindaklanjuti, bukan istilah teknis.

**Dua sebab berbeda yang dulu menghasilkan pesan sama persis** — sekarang dibedakan di Edge Function:

| Yang terkirim | Artinya | Pesannya sekarang |
|---|---|---|
| tidak ada header | permintaan tidak membawa sesi | "Muat ulang halaman lalu coba lagi." |
| bukan JWT (publishable key) | klien merasa **belum login** | "Kamu terbaca belum login. Keluar lalu login ulang." |
| JWT ditolak auth | sesi **kedaluwarsa** | "Sesi login kamu sudah berakhir." |

Bentuk JWT dikenali dari tiga bagian dipisah titik. Tanpa pembedaan ini, "belum login" dan "sesi habis" mustahil dibedakan dari sisi user — padahal langkah perbaikannya berbeda.

`invokeFunction()` sekaligus membaca badan respons non-2xx, yang **tidak** dilakukan supabase-js: tanpa itu `error.message` hanya berisi *"Edge Function returned a non-2xx status code"*, yang tidak memberi tahu apa pun. Pesan asli seperti *"chat not found"* atau *"belum ada perangkat berlangganan"* jadi tetap terlihat.

## Rotasi layar: portrait & landscape

**Penyebabnya bukan CSS.** `manifest.json` berisi `"orientation": "portrait"`, yang **mengunci** PWA ke portrait — memutar HP tidak berpengaruh sama sekali karena sistem operasinya sendiri yang menolak merotasi. Kini `"orientation": "any"`.

⚠️ Perubahan manifest baru berlaku setelah PWA-nya **dipasang ulang** di HP (hapus dari layar depan, buka lagi di browser, Add to Home Screen). Membuka lewat browser biasa langsung berlaku.

### Breakpoint harus melihat TINGGI, bukan cuma lebar

Setelah kuncinya dibuka, muncul masalah kedua: HP yang diputar jadi **~800px lebar**, melewati breakpoint `768px`, sehingga dianggap desktop — sidebar dipasang permanen padahal tingginya cuma ~360px. Yang tersisa untuk konten tinggal beberapa baris.

Karena itu breakpoint mobile jadi `@media (max-width: 768px), (max-height: 500px)`. Ambang 500px menangkap kondisi "lebar tapi pendek" tanpa mengganggu laptop layar kecil sekalipun — yang paling pendek pun di atas 600px.

Ditambah blok `@media (max-height: 500px)` yang **hanya** merapatkan jarak vertikal (header, judul, hero beranda) dan memberi dialog ruang lebih besar. **Ukuran font dan target sentuh sengaja tidak dikecilkan**: layar sempit bukan alasan membuat tombol jadi susah ditekan, apalagi saat orangnya memegang HP satu tangan sambil bekerja.

## Alat audit (jalankan sebelum push)

```
node --experimental-vm-modules tools/audit-syntax.cjs   # sintaks ES module
node tools/audit-html-escape.cjs                        # data DB masuk HTML tanpa escape
node tools/audit-owner-filter.cjs                       # query "milik saya" tanpa filter pemilik
node tools/audit-outlet-scope.cjs                       # dropdown outlet menembus scope
node tools/audit-embed-ambigu.cjs                      # embed PostgREST tanpa nama FK
node tools/test-youtube-parser.mjs                      # parser link YouTube
node tools/test-image-compress.mjs                      # skala & format kompresi foto
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

**Ada juga tombol ❓ di header Beranda Staff, tepat di sebelah sapaan nama.** Tombol ❓ di header modul hanya terlihat kalau orangnya **sudah** membuka modul itu — padahal yang paling butuh tutorial justru yang belum berani membukanya. Diletakkan di tempat mata sudah berhenti (nama sendiri), bukan sebagai kartu tambahan di bawah: satu kartu lagi di grid modul justru menambah yang harus dipilah sebelum orang sampai ke pekerjaannya. Menekannya membuka pemilih modul (langsung ke videonya kalau cuma satu modul yang punya). Yang ditawarkan hanya modul yang benar-benar dipakai staff tersebut: menawarkan tutorial modul yang tidak bisa dia buka bukan cuma sia-sia, itu membuat orang mengira ada bagian aplikasi yang disembunyikan darinya. Datanya diambil `listTutorialsByModule()` dalam **satu** query — versi memanggil `listTutorials()` per modul akan menembakkan 15-20 permintaan begitu Beranda dibuka, dan yang paling terasa bukan servernya melainkan Beranda yang tersendat di HP. Dialog pemutarnya sengaja dipakai bersama (`openTutorialDialog()`), bukan disalin: dua pemutar terpisah berarti dua tempat yang harus diperbaiki setiap ada perubahan, dan yang satu pasti tertinggal.

**Pemutarannya di dalam aplikasi** (`youtube-nocookie.com`), bukan membuka tab YouTube — di PWA, membuka tab baru berarti orangnya keluar dari aplikasi dan sering tidak kembali, padahal dia membuka tutorial justru karena sedang di tengah mengerjakan sesuatu. Tetap ada tautan "Buka di YouTube" sebagai cadangan, karena sebagian jaringan memblokir iframe embed sementara aplikasi YouTube-nya jalan.

## Kolom nama dibekukan di tabel yang melebar (`.table-freeze-1`)

Setiap tabel yang kolom pertamanya berisi **nama** — staff/user, nama barang, atau nama tamu — kolom itu dibekukan saat tabel digeser ke samping. Di HP, tabel rekap yang punya 8-15 kolom hampir selalu digeser; tanpa kolom nama yang menempel, angka di kolom ke-9 tidak lagi bisa dikaitkan ke siapa pun. Orang lalu menggeser bolak-balik untuk mencocokkan baris — dan salah baca hanya soal waktu.

Dipakai dengan menambahkan kelas `table-freeze-1` pada `<table class="data-table">`.

⚠️ **Tabelnya WAJIB dibungkus `.table-scroll`.** `position: sticky` butuh wadah bergulir sebagai acuan. `.data-table` sendiri punya `overflow: hidden` (untuk sudut membulat) yang justru mematikan sticky, dan di layar kecil ia berubah jadi `display: block` — dua-duanya membuat kolom beku **diam-diam tidak bekerja**, tanpa error, tanpa tampilan rusak. Yang terlihat cuma tabel biasa. Aturan pengembaliannya ada di `css/styles.css` (`.table-scroll .data-table`).

Baris pemisah divisi di Jadwal Shift dikecualikan (`tr.shift-divisi td:first-child { position: static }`) — sel `colspan` yang ikut membeku akan menutupi kolom di sebelahnya saat digeser.

Di **Inventaris Aset** urutan kolomnya ditukar: *Nama Barang* dulu, baru *Foto*. Membekukan kolom foto berarti yang menempel di layar adalah gambar 44px tanpa keterangan apa pun.

## Export PDF: sel panjang dibungkus, bukan ditumpuk (`js/core/pdf.js`)

**Gejala:** Export PDF Data Staff menghasilkan teks yang saling menimpa, makin parah pada baris yang alamat KTP-nya panjang.

**Penyebab.** `doc.text(teks, x, y, { maxWidth })` milik jsPDF memang membungkus teks — tapi baris kelanjutannya digambar **ke bawah** tanpa memberi tahu pemanggilnya. Tinggi baris di `exportTablePDF()` dipatok tetap 14pt, jadi sel dua-tiga baris menimpa baris staff berikutnya. Kolomnya benar, lebarnya benar; yang salah adalah asumsi bahwa satu baris data = satu baris teks.

**Perbaikan.** Teks dipecah lebih dulu dengan `doc.splitTextToSize()`, lalu **tinggi baris dihitung dari jumlah baris terbanyak** di baris itu (dibatasi `maxLines`, default 3, sisanya dipotong dengan `…`). Baris bergambar tetap ikut diperhitungkan seperti sebelumnya. Ditambah garis pemisah tipis antar baris, karena baris yang tingginya tidak seragam sulit diikuti mata tanpa garis.

`columns[].align` (`'right'` / `'center'`) sekarang benar-benar dipakai — sebelumnya didokumentasikan tapi diabaikan. Ditambah opsi `orientation`: **portrait** untuk daftar yang dicetak/dikirim apa adanya (Riwayat Kas), landscape tetap default untuk laporan berkolom banyak.

### Riwayat Kas (Staff App) → PDF portrait dengan foto nota

Kolom **Nota** berisi fotonya, bukan tulisan "Ada". Dua jebakan yang harus dihindari sekaligus:

- **jsPDF memuat gambar secara SINKRON.** Memberinya URL jaringan menghasilkan halaman kosong **tanpa error sama sekali**. Semua foto diubah ke data URL lebih dulu (`imageToDataUrl()`); yang gagal cukup jadi `-`, satu nota rusak tidak boleh membatalkan seluruh export.
- **Ukurannya harus diperkecil.** jsPDF menyimpan gambar apa adanya, jadi 30 nota dari kamera HP (2-4 MB masing-masing) menghasilkan PDF ratusan MB yang tidak bisa dibuka di HP — dan gejalanya bukan error, melainkan browser yang menggantung. Dicetak ~46×34 pt, jadi 220 px sudah lebih dari cukup.

Kompresinya dijalankan **berurutan**, bukan `Promise.all`: memproses 50 foto sekaligus membuat tab-nya membeku di HP kelas menengah. Signed URL-nya diambil sekali untuk semua (`getCashProofUrls()`) — satu permintaan per baris membuat sebagian tertunda lama, dan hasilnya PDF dengan sebagian foto hilang tanpa penjelasan.

Isi PDF diambil dari **entri yang sedang tampil**, bukan query ulang. Mengambil ulang saat export berisiko menghasilkan PDF yang isinya berbeda dari yang dilihat orangnya — dan perbedaan itu tidak akan pernah dia sadari.

Lebar kolom diuji tersendiri (`node tools/test-pdf-lebar.mjs`), karena kolom Nota adalah kolom **terakhir**: gambar yang lebih lebar dari kolomnya akan menembus tepi kertas, dan itu baru ketahuan setelah PDF-nya dibuka orang lain. Tanda minus panjang (−) diganti tanda hubung biasa: helvetica bawaan jsPDF tidak punya glyph-nya dan mencetaknya sebagai kotak.

**Data Staff** juga mendapat **Export .xlsx**. Definisi kolomnya satu (`KOLOM`) untuk kedua format: dua daftar terpisah berarti suatu hari salah satunya ketinggalan satu kolom, dan tidak ada yang sadar sampai ada yang membandingkan dua file. Di Excel sel kosong dibiarkan kosong, bukan diisi `-`, supaya filter dan hitungan tidak menghitungnya sebagai isi.

## Bug: kotak "No. Telp" terisi alamat email (Master User)

**Gejala:** di form Edit Staff, kotak bertuliskan *No. Telp* berisi alamat email.

**Penyebab.** Nilai awalnya dibaca dari `row.children[1].textContent` — dulu itu memang kolom Telp. Sejak kolom **Email** disisipkan di posisi kedua (migration `0049`), indeks itu menunjuk kolom yang salah. Formnya benar; isinya yang salah kolom.

**Perbaikan.** Nilai awal diambil dari atribut `data-*` pada tombol Edit, bukan dari urutan kolom tabel. Indeks DOM adalah bom waktu: ia hanya benar sampai ada yang menambah kolom, dan tidak ada satu pun tes yang gagal saat itu terjadi. Email login sekarang ditampilkan sebagai keterangan di atas form (tidak bisa diubah dari sini) supaya tidak ada lagi yang mengira kotak telepon adalah kotak email.

## Bug: mode OTP Tugas Luar tampak "tidak aktif" (migration `0064`)

Alur OTP-nya sendiri utuh: admin menerbitkan kode → staff memasukkannya saat mengaktifkan mode Tugas Luar → `redeem_exit_otp()` (SECURITY DEFINER) memvalidasi & menandai terpakai → id kode ikut tersimpan di baris presensi, dan policy insert presensi memeriksanya lagi di database. Yang bermasalah ada tiga hal di sekelilingnya:

1. **Admin outlet tidak bisa menerbitkan kode.** Policy `0006` hanya mengizinkan `is_bu_admin()`. Tombolnya tetap tampil, insert-nya ditolak RLS — bagi admin outlet fiturnya tampak mati. Padahal orang yang tahu si staff memang sedang keluar justru admin outletnya. `0064` menggantinya dengan `is_outlet_admin_in_bu()` (SECURITY DEFINER — subquery di dalam ekspresi policy ikut disaring RLS, jadi versi inline-nya akan selalu `false` untuk orang yang justru ingin diizinkan).
2. **"Simpan Mode" bisa berbohong.** `setExitTaskMode()` melakukan UPDATE tanpa `.select()`. PostgREST tidak menganggap penolakan RLS sebagai error, jadi UPDATE yang tidak menyentuh baris apa pun tetap balik sukses dan toast "Mode disimpan" muncul — sementara nilainya tidak berubah. Sekarang jumlah baris diperiksa dan pesannya jujur.
3. **Modenya mengikuti BU basis (★) staff**, bukan BU yang sedang dibuka admin di portal. Ini memang disengaja (presensi menempel pada orang, bukan pada BU aktif), tapi tidak pernah dikatakan di layar — admin mengaktifkan OTP di satu BU lalu heran kenapa stafnya tidak diminta kode. Sekarang ditulis di bawah pemilih modenya.

`created_by` kode OTP juga tidak pernah terisi sejak `0006`. Diisi lewat `DEFAULT auth.uid()`, bukan dititipkan ke client — jejak audit yang bisa diisi sembarang nilai oleh client lebih buruk daripada kolom kosong.

## Tampilan "sedang memuat" (`js/core/loading.js`)

Sebelumnya tiap halaman menulis `<p>Memuat...</p>` sendiri — **77 tempat** dengan gaya yang berbeda-beda. Selain tidak enak dilihat, teks polos itu punya masalah nyata: **ia tidak bergerak**. Layar yang diam tidak bisa dibedakan dari layar yang macet, jadi orang menekan tombolnya lagi — atau menutup aplikasi — justru saat datanya sedang dalam perjalanan.

Sekarang semuanya lewat `loadingHtml()`, dengan dua bentuk. Pilihannya bukan soal selera:

- **Kerangka (skeleton)** untuk area yang akan berubah jadi daftar atau tabel. Bentuknya sudah menyerupai hasil akhir, jadi tata letak tidak melompat saat data datang. Lebar tiap barisnya sengaja tidak seragam — kerangka yang semua barisnya sama panjang terbaca sebagai grafik, bukan sebagai "tulisan yang belum datang".
- **Pemutar (spinner)** untuk halaman penuh atau sesuatu yang bentuk akhirnya belum diketahui. Kerangka yang salah bentuk lebih mengganggu daripada tidak ada kerangka sama sekali.

`tombolSibuk(btn)` untuk proses di dalam tombol (mis. menyiapkan PDF): ia mengembalikan fungsi pemulih, jadi pemanggil tidak perlu menyimpan label aslinya sendiri — dan tidak akan lupa mengembalikannya.

**Animasinya berhenti kalau sistem meminta `prefers-reduced-motion`.** Gerakan berulang bisa memicu pusing pada sebagian orang, dan itu bukan harga yang pantas dibayar untuk sekadar terlihat manis. Indikatornya tetap terlihat, hanya tidak bergerak.

Semua blok memakai `role="status" aria-live="polite" aria-busy="true"` supaya pembaca layar ikut mengumumkannya — teks "Memuat..." yang lama tidak diumumkan sama sekali.

## Reminder clock in mengikuti jadwal shift

Untuk outlet yang **mengaktifkan modul Shift**, jam masuk reminder diambil dari **jadwal shift tiap staff hari itu** — `outlets.clock_in_time` tidak perlu diisi dan diabaikan. Outlet tanpa modul Shift tetap memakai jam tetap seperti sebelumnya. Query outletnya: `reminder_enabled = true` **dan** (`clock_in_time` terisi **atau** `shift_enabled`).

Yang ikut didapat gratis: staff yang dijadwalkan **Libur** tidak diingatkan sama sekali, dan staff shift sore tidak lagi diteror pukul 08:10 karena outletnya buka pagi.

**Konsekuensi yang harus disadari — semuanya nyata, bukan teoretis:**

1. **Tidak dijadwalkan = tidak diingatkan.** Reminder jadi bergantung pada admin yang rajin menyusun jadwal. Kalau jadwal minggu itu belum dibuat, seisi outlet tidak diingatkan — dan tidak ada satu pun tanda bahwa itu terjadi. Sebelumnya jam tetap selalu berbunyi apa pun keadaannya.
2. **Staff tanpa divisi tidak bisa dijadwalkan** (keputusan di `0059`), dan karena itu tidak akan pernah diingatkan di outlet ber-shift. Dua keputusan yang masing-masing masuk akal, tapi bertemu jadi lubang senyap.
3. **Jadwal diubah setelah reminder terkirim tidak menariknya kembali.** Dedupe-nya per (user, outlet, tanggal); begitu terkirim, mengubah shift orang itu tidak membatalkan apa pun.
4. **Shift lintas tengah malam hanya diingatkan sampai pukul 23:59.** Barisnya bertanggal hari mulai, jadi setelah lewat tengah malam ia tidak lagi ikut diperiksa.
5. **Presisi ikut irama cron** (`*/10`), jadi reminder bisa telat sampai ~10 menit dari ambangnya. Sama seperti mode jam tetap.

### Peringatan ke admin kalau jadwal besok kosong (`send-shift-gap-alerts`, migration `0067`)

Konsekuensi nomor 1 di atas ditutup dari sisi admin, bukan dengan jaring pengaman jam tetap. Sekali sehari sore hari (cron 17:00 WIB), tiap outlet ber-shift diperiksa: kalau **belum ada satu pun** baris jadwal untuk besok, adminnya diberi push.

**Satu baris jadwal sudah cukup untuk dianggap aman.** Kalau admin sudah mulai mengisi, dia jelas tidak lupa — yang dicari adalah outlet yang benar-benar kosong. Menegur orang yang sedang bekerja adalah cara tercepat membuat peringatan diabaikan.

**Siapa yang diberi tahu: berjenjang, dan berhenti di jenjang pertama yang berisi orang.**

1. **Admin outlet** outlet itu.
2. Kalau tidak ada → **admin BU** dari BU-nya.
3. Kalau tidak ada juga → **super admin**.

Mengirim ke semua admin BU sekaligus terdengar lebih aman, tapi hasilnya peringatan yang tidak jelas jadi tanggung jawab siapa — dan sesuatu yang menjadi tanggung jawab semua orang tidak dikerjakan siapa pun. Yang paling mungkin bertindak adalah admin outlet itu sendiri. Jenjang berikutnya hanya dipakai kalau jenjang sebelumnya kosong, supaya outlet tanpa admin sendiri tidak berakhir tanpa siapa pun yang tahu. Admin yang **nonaktif** tidak dihitung — dan kalau dia satu-satunya, peringatannya naik jenjang, bukan hilang.

Dedupe per (outlet, tanggal jadwal) lewat `shift_gap_alerts_sent`, dan **hanya ditandai kalau benar-benar ada push yang terkirim**. Kalau ditandai walau semua gagal, peringatannya hilang selamanya untuk tanggal itu — gagal senyap yang justru menutupi gagal senyap lain.

Punya `{"dry_run":true}`: menghitung dan melaporkan tanpa mengirim maupun menandai. Tanpa mode itu, satu-satunya cara menguji adalah dengan mengirim notifikasi ke orang sungguhan.

Jenjang penerimanya diuji tersendiri: `node tools/test-jenjang-admin.mjs` (8 kasus, termasuk admin outlet dari outlet lain, admin BU dari BU lain, dan admin nonaktif).

Yang **tidak** ditutup oleh ini: konsekuensi nomor 2 (staff tanpa divisi tidak bisa dijadwalkan sama sekali). Peringatan ini hanya melihat "ada jadwal atau tidak", bukan "semua orang sudah kebagian atau belum".

### Bug: ambang yang dibungkus modulo mengirim reminder 23 jam lebih awal

`addMinutes()` membungkus hasilnya dengan `% 1440`. Untuk shift yang mulai **23:50**, ambangnya jadi `"00:00"` — dan perbandingan `nowTime >= "00:00"` benar **sepanjang hari**. Akibatnya reminder terkirim pukul 00:0x, hampir 24 jam sebelum shift-nya, dan penerimanya cuma bingung kenapa disuruh absen tengah malam. Tidak ada error, tidak ada log yang aneh.

Sekarang ambangnya dihitung dalam **menit sejak tengah malam tanpa dibungkus**; nilai ≥ 1440 berarti reminder-nya jatuh di hari berikutnya, dan hari ini dilewati. Lebih baik tidak mengingatkan daripada mengingatkan di waktu yang salah. Diuji `node tools/test-ambang-reminder.mjs` (11 kasus, termasuk shift dekat tengah malam).

## Rekap Presensi: status keterlambatan & outlet basis

### Status terlambat mengikuti jadwal shift, dan disimpan sebagai POTRET

`evaluateLateness()` membandingkan jam clock in dengan **jam mulai shift orang itu hari itu**, bukan jam buka outlet, memakai **toleransi per BU** (`shift_settings.late_tolerance_minutes`). Lima kemungkinan: `ontime`, `tolerance`, `late`, `off_day`, `no_schedule`. Shift lintas tengah malam ditangani dengan menormalkan selisih ke ±12 jam, jadi clock in 00:05 untuk shift 23:00 terbaca +65 menit, bukan −1375.

Dua hal yang harus disadari:

1. **Hasilnya disimpan di baris presensi** (`late_status`, `late_minutes`, `shift_name`), tidak dihitung ulang saat rekap dibuka. Mengubah jadwal seseorang **setelah** dia clock in tidak mengubah penilaian yang sudah tercatat — dan itu memang disengaja: penilaian kehadiran harus mencerminkan aturan yang berlaku **saat itu**, bukan aturan yang diubah belakangan.
2. **Jadwal diambil dari OUTLET BASIS (★)**, bukan outlet tempat dia absen. Kalau outlet basisnya tidak memakai modul Shift, statusnya kosong dan kolom Shift menampilkan "–".

**Bug yang diperbaiki:** `getMyScheduleFor()` memakai `.maybeSingle()` tanpa menyaring outlet. Begitu seseorang punya dua baris jadwal di tanggal yang sama (dijadwalkan di dua outlet), PostgREST membalas error, error-nya ditelan `catch`, hasilnya `null` — dan orangnya dinilai **"Tanpa jadwal"**. Tidak ada pesan apa pun di layar; hanya penilaian yang salah. Sekarang disaring ke outlet basis dan memakai `limit(1)`: kalau toh masih ada lebih dari satu, lebih baik memakai salah satunya daripada menganggap dia tidak punya jadwal.

### Koreksi basis: apa yang ikut pindah, apa yang tidak

`koreksi_outlet_basis()` (0062) mengubah `nbm_outlet_id` **dan** `nbm_business_unit_id`. Akibatnya di Rekap Presensi — sebelum perbaikan ini — satu baris **berpindah BU tapi tidak berpindah outlet**: daftar barisnya disaring dengan `nbm_business_unit_id`, sementara kolom dan filter outletnya memakai `outlet_id` (lokasi absen). Satu layar memakai dua arti "outlet" sekaligus, tanpa satu pun keterangan.

Sekarang keduanya dinyatakan terpisah, karena **dua-duanya benar dan keduanya dibutuhkan**:

- **Kolom Outlet tetap menampilkan lokasi absen** — itu yang dibuktikan foto selfie dan koordinat geofence. Menggantinya dengan basis berarti membuang bukti fisik demi angka administratif.
- **Outlet basis ditulis di bawahnya dengan tanda ★** hanya kalau berbeda, plus ✎ dan catatan koreksinya sebagai tooltip.
- **Pemilih "Outlet yang dicari"**: *Lokasi absen* (bawaan) atau *Outlet basis (NBM)*. Mode basis memakai fallback ke `outlet_id` untuk baris lama yang belum punya basis — tanpa itu, presensi sebelum fitur basis ada akan hilang dari rekap.

Jawaban singkatnya untuk pertanyaan "apakah rekap presensi ikut berpindah setelah koreksi": **sekarang bisa, kalau kamu memintanya.** Bebannya (Rekap NBM) selalu ikut pindah; kehadirannya tetap tercatat di tempat dia benar-benar berdiri.

## Daily Activities: bukti kerja terlihat, dan bug yang menyembunyikannya

### Bug: staff hanya melihat pekerjaannya SENDIRI, jadi sesi dikerjakan dua kali (migration `0068`)

`checklist_runs_select_own` (0016) hanya membuka baris milik sendiri untuk staff biasa. Akibatnya bukan sekadar "tidak bisa lihat teman":

`getTodayDoneSessions()` menghitung sesi yang sudah selesai dengan membaca `checklist_runs` untuk outlet itu — tapi RLS memotongnya jadi "punya saya saja". Jadi sesi yang **sudah** dikerjakan rekannya tetap tampil **"Belum"** bagi staff lain, dan dia mengerjakannya lagi: dua run untuk sesi yang sama, dua set foto, tanpa satu pun pesan yang menjelaskan. Pekerjaannya bertambah, datanya kotor, dan tidak ada yang tahu kenapa.

Yang membuatnya makin janggal: **foto buktinya sudah boleh dilihat satu outlet sejak `0052`** (`checklist_photo_select` memakai `has_outlet_scope`). Jadi fotonya terbuka tapi catatan pekerjaannya tidak — dua policy untuk satu hal yang sama, dan yang lebih ketat yang menang.

`0068` menambahkan policy SELECT berbasis `has_outlet_scope()`. Daily Activities adalah pekerjaan **bersama** satu outlet, bukan catatan pribadi seperti pengajuan cuti. Hanya SELECT yang dibuka: melihat pekerjaan orang lain adalah transparansi, menyuntingnya hal yang sama sekali berbeda.

Kalau setelah menjalankan `0068` muncul sesi ganda di rekap, itu bukan bug baru — itu jejak bug lama yang akhirnya terlihat. Kartu sesinya menyebutkan hal itu apa adanya.

### Admin Portal — kolom Bukti di rekap

Kolom baru berisi **thumbnail foto per item**, maksimal 3 lalu sisanya sebagai `+N`; diketuk untuk membuka besar, dan tombol Detail tetap menampilkan seluruhnya. Kolom tabel bukan galeri — menampilkan sepuluh foto per baris membuat tabelnya tidak bisa dibaca sebagai tabel lagi.

Path fotonya ikut diambil di query yang sama (`checklist_run_items(photo_path)`), dan seluruh signed URL diambil **sekali** untuk satu halaman. 500 baris × 1 permintaan = 500 koneksi berbarengan; sebagian akan tertunda lama dan tabelnya tampak "sebagian fotonya rusak". Thumbnail yang diketuk membuat signed URL **baru**, bukan memakai yang di `<img>` — yang itu berumur 1 jam dan bisa sudah kedaluwarsa kalau halamannya dibiarkan terbuka.

### Staff App — kartu selesai bukan lagi kartu mati

Sebelumnya kartu sesi yang sudah beres di-`disabled`, jadi setelah semua sesi selesai halamannya cuma deretan kotak abu-abu: tidak ada cara melihat siapa yang mengerjakan, jam berapa, atau apa buktinya.

Sekarang kartunya jadi **pintu**, bukan batu nisan:

- Kartu selesai menampilkan **nama pengerja + jam**, dan diketuk membuka rincian: item apa saja yang dicentang, catatannya, dan foto tiap item (diketuk lagi untuk memperbesar).
- Ada **pemilih tanggal** (maksimal hari ini) untuk melihat hari-hari sebelumnya. Tanggal lampau bersifat **hanya lihat** — sesi yang tidak dikerjakan hari itu ditandai "Tidak dikerjakan" dan tidak bisa diisi surut.
- Kalau satu sesi punya lebih dari satu run, kartunya menampilkan yang pertama dan dialognya menampilkan semuanya, dengan keterangan di bawah grid.

Pendengar klik untuk foto di dalam dialog dipasang **sekali di level modul**, bukan tiap render — memasangnya tiap kali halaman dibuka membuat pendengarnya menumpuk, dan satu ketukan membuka tab yang sama berkali-kali. Pola bug yang sama pernah terjadi di Master User.

## Item aktivitas berbeda per sesi (migration `0069`)

Ceklis buka toko dan ceklis tutup toko memang beda pekerjaannya. Memaksa keduanya memakai daftar yang sama membuat staff mencentang seadanya — dan ceklis yang dicentang seadanya tidak membuktikan apa pun.

**Relasinya banyak-ke-banyak** (`checklist_session_items`), bukan kolom `session_id` di `checklist_items`. Item seperti "Cek stok" wajar muncul di sesi pagi **dan** malam; dengan satu kolom, item itu harus digandakan — dan dua item kembar berarti dua riwayat terpisah untuk satu pekerjaan yang sama.

### Aturan yang menentukan segalanya: "tanpa penugasan = berlaku di semua sesi"

Item yang tidak punya satu pun baris penugasan dianggap berlaku untuk semua sesi. Itu **persis perilaku sebelum `0069`**, jadi seluruh data lama tetap bekerja tanpa satu baris pun dipindahkan. Penugasan menambah kejelasan, bukan menjadi syarat baru yang mendadak mengosongkan ceklis orang.

Konsekuensinya harus disebut di layar, dan memang disebut di kolom penjelas tab Item: **begitu sebuah item ditugaskan ke satu sesi, ia berhenti muncul di sesi lain.** Aturan implisit yang tidak dijelaskan adalah cara tercepat membuat admin mengira itemnya hilang.

Aturan ini dikunci `node tools/test-item-per-sesi.mjs` (7 kasus) — kalau tergeser tanpa sengaja, ceklis orang akan kosong, dan gejalanya bukan error melainkan staff yang mengira pekerjaannya tidak perlu dilakukan.

### Yang berubah di layar

- **Admin → tab Item**: kolom **Sesi** (badge nama sesi, atau "Semua sesi") + tombol **Sesi** untuk mengaturnya. Dialognya memakai deretan **checkbox**, bukan `<select multiple>`: di HP, memilih dua opsi di select-multiple butuh menahan tombol yang tidak ada di papan ketik sentuh.
- **Staff App**: item dimuat **saat sesi dibuka**, bukan sekali di awal. Memuatnya di depan berarti sesi kedua menampilkan item sesi pertama — salah tanpa tanda apa pun. Sesi yang belum punya item menampilkan penjelasan + jalan keluarnya, bukan form kosong.

Kalau daftar penugasan gagal dibaca, item ditampilkan **semua**, bukan kosong: ceklis yang tiba-tiba kosong membuat staff mengira pekerjaannya tidak perlu; ceklis yang kepanjangan hanya merepotkan.

## Bug: "wajib foto" ternyata hanya kebiasaan, bukan aturan (migration `0070`)

**Pertanyaannya:** bisakah staff mengirim aktivitas tanpa foto bukti? **Bisa.**

Sejak `0052`, aturan "setiap item yang dicentang harus ada fotonya" hanya hidup di **satu** tempat: pemeriksaan di halaman staff sebelum tombol Kirim. `submitChecklistRun()` menerima `checked: true, photo_path: null` tanpa berkomentar, dan tabelnya tidak punya batasan apa pun.

Artinya itu bukan aturan, melainkan kebiasaan. Siapa pun yang memanggil API langsung — atau versi halaman lama yang masih tersimpan di cache HP seseorang — bisa mengirim ceklis tanpa satu pun bukti, dan hasilnya masuk ke rekap **terlihat sama sahnya** dengan yang lain. Yang paling merugikan bukan kebocorannya, melainkan kepercayaan pada rekap yang ternyata tidak sekuat yang dikira.

Sekarang ditegakkan di **tiga lapis**: halaman staff (supaya salahnya ketahuan sebelum apa pun terkirim), `submitChecklistRun()`, dan `CHECK` constraint di database. Pemeriksaan di service dilakukan **sebelum** run dibuat — kalau ditolak belakangan, run-nya sudah terlanjur lahir dan `unique (outlet_id, session_id, run_date)` akan menolak percobaan ulang hari itu, jadi staff terjebak sampai besok.

Constraint-nya `NOT VALID`: hanya untuk baris **baru**. Run sebelum `0052` memang belum punya foto per item sama sekali, dan memvalidasi mundur akan menggagalkan migration hanya karena sejarah. Riwayat pekerjaan justru yang paling tidak boleh diubah belakangan.

### Dan soal item yang "tidak muncul foto dan aksinya"

Sebagian besar bukan pelanggaran — itu item yang **tidak dicentang**, yang wajar tidak berfoto. Tapi keduanya dulu ditampilkan sama: kotak abu-abu bertuliskan "tanpa foto". Dua hal yang artinya berbeda jauh dijadikan satu tampilan, sehingga yang benar-benar bermasalah tenggelam di antara yang wajar.

Sekarang dibedakan di rekap admin maupun di Staff App:

- **"tidak dikerjakan"** (abu-abu) — item tidak dicentang.
- **"tanpa bukti"** (merah) — dicentang tapi tidak ada fotonya. Setelah `0070` ini hanya mungkin berasal dari data lama, dan detail rekap menyebutkannya di atas daftar.

## Bug: satu item mengunci seluruh sesi seharian (migration `0071`)

**Gejalanya:** staff mengerjakan 1 dari 15 item lalu menekan Kirim. Kartunya berubah jadi "✅ Selesai", dan 14 item sisanya **tidak bisa diisi oleh siapa pun sampai besok**.

**Penyebabnya gabungan dua keputusan yang masing-masing masuk akal:** `checklist_runs` punya `unique (outlet_id, session_id, run_date)` — satu sesi satu run per hari — sementara halaman staff hanya menuntut "centang minimal satu item". Tidak ada error, tidak ada peringatan; rekapnya bahkan menyatakan sesi itu beres. Laporan yang salah tapi terlihat rapi adalah bentuk kegagalan yang paling mahal.

**Perbaikannya mengubah arti `checklist_runs`:** ia berhenti berarti "sekali kerja" dan menjadi **wadah** untuk satu sesi pada satu hari. Yang mencatat pekerjaan adalah barisnya di `checklist_run_items`, dan tiap baris kini membawa `done_by` + `done_at` sendiri.

- Kartu sesi menampilkan **kemajuan** (`3/15 item`) dengan tiga keadaan, bukan dua: 🧹 belum · ⏳ sebagian · ✅ tuntas. "Ada run" tidak lagi sama dengan "selesai".
- Sesi yang belum tuntas bisa **dilanjutkan**; item yang sudah punya bukti dikunci dan tidak ditampilkan lagi di form.
- **Rekan satu outlet boleh melanjutkan.** Pergantian shift adalah hal biasa, dan tiap item tetap tercatat atas nama pengerjanya masing-masing — bukan atas nama orang pertama yang kebetulan menekan Kirim.
- `unique (run_id, item_id)` membuat item yang sudah berbukti tidak bisa ditimpa diam-diam: penolakannya berupa error yang terlihat, bukan bukti yang tergantikan tanpa jejak.
- Policy baru hanya membuka **INSERT**. Mengubah & menghapus tetap milik pembuatnya dan admin outlet — melanjutkan pekerjaan orang lain itu wajar, menyunting buktinya sama sekali bukan hal yang sama.

### Yang nyaris membatalkan seluruh perbaikan ini

`submitChecklistRun()` dulu juga menyimpan baris untuk item yang **tidak** dicentang. Sekilas rapi — tapi artinya setelah pengiriman pertama semua item sudah "punya baris", sehingga sesi yang baru terisi 1 dari 15 akan tetap terhitung tuntas. Fitur melanjutkan yang baru dibuat akan langsung mati.

Sekarang hanya item yang **dikerjakan** yang dicatat, dan artinya jadi tegas: ada baris = dikerjakan dan ada buktinya; tidak ada baris = belum dikerjakan, masih bisa dilanjutkan hari itu.

### Dan perbaikan itu masih meleset untuk data lama (migration `0072`)

Aturan `0071` — "ada baris = item itu sudah dikerjakan" — benar untuk data **baru**, karena sejak `0071` hanya item yang dikerjakan yang dicatat. Tapi data **lama** menyimpan baris untuk semua item, termasuk yang tidak dicentang. Jadi sesi yang benar-benar baru terisi 1 dari 6 punya 6 baris, terbaca "6 dari 6", tuntas — dan kartunya mati lagi.

Perbaikan `0071` tidak salah; asumsinya yang salah, yaitu bahwa semua data mengikuti bentuk baru. Ini jenis kesalahan yang paling mudah lolos: **diuji dengan data yang dibuat setelah perbaikannya**.

Dua hal yang diperbaiki:

1. **Kemajuan hanya menghitung baris `checked = true`**, bukan semua baris.
2. **Baris lama yang `checked = false` boleh dilanjutkan** — dengan `UPDATE`, bukan `INSERT`, karena `uq_checklist_run_item` menolak pasangan (run, item) yang sama. Policy `0072` mengizinkannya dengan satu syarat keras di klausa `using`: **hanya baris yang belum selesai**. Item yang sudah berbukti tidak akan pernah cocok dengan policy itu, jadi buktinya aman dari penimpaan.

### Pengerjaan menempel pada ITEM, bukan pada sesi

Nama di tingkat sesi (`checklist_runs.user_id`) hanya menjawab "siapa yang **memulai**". Begitu sesi boleh dilanjutkan rekan satu outlet, nama itu berhenti menjawab "siapa yang mengerjakan pekerjaan ini" — dan menisbahkan pekerjaan orang lain kepada siapa pun yang kebetulan menekan Kirim lebih dulu.

Karena itu `checklist_run_items` membawa `done_by` + `done_at` sendiri, dan ditampilkan **per baris item** di tiga tempat: form lanjutan, dialog rincian Staff App, dan detail rekap admin. Kolom "Oleh" di tabel rekap diberi keterangan *memulai sesi*, supaya tidak dibaca sebagai "yang mengerjakan semuanya".

Di **form lanjutan**, item yang sudah dikerjakan **tetap ditampilkan** — tercentang, dengan fotonya, nama pengerja, dan jamnya — dalam keadaan terkunci. Menyembunyikannya membuat orang yang melanjutkan tidak tahu apa yang sudah beres, dan harus menebak dari ingatan.

**`done_at` sengaja boleh NULL, tanpa default.** Godaannya menulis `not null default now()` — tapi baris yang sudah ada akan ikut terisi jam *migration dijalankan*, bukan jam pekerjaannya. Layar lalu menampilkan "Kebersihan Kitchen · 03.14" dengan penuh percaya diri untuk pekerjaan yang dilakukan pagi kemarin. Jam yang salah tapi terlihat pasti lebih menyesatkan daripada jam yang kosong: tidak ada yang akan curiga pada angka yang tampil rapi. Yang NULL ditampilkan sebagai nama saja, tanpa jam.

### Item yang sudah dikerjakan tetap terlihat di ceklisnya

Versi sebelumnya menghilangkan item begitu terkirim. Sekilas masuk akal — yang tersisa memang yang perlu dikerjakan — tapi itu membuang satu-satunya tempat staff bisa melihat **apa yang sudah beres**, padahal itu pertanyaan yang paling sering muncul di tengah shift. Sekarang seluruh item selalu ditampilkan dalam satu layar: yang selesai sebagai kartu berisi foto, nama pengerja, dan jamnya; yang belum sebagai isian.

Kartu sesi juga **selalu** membuka layar ini, termasuk saat sudah tuntas. Dialog rincian hanya dipakai untuk hari lampau yang kebetulan punya lebih dari satu run.

Setelah mengirim, layar **tetap di sesi itu** — yang ingin dilihat orang setelah menekan Kirim adalah hasilnya dan apa yang masih tersisa, bukan kembali ke daftar sesi.

### Staff boleh memperbaiki & menghapus pekerjaannya sendiri (migration `0073`)

Salah foto, salah item, foto buram — semuanya terjadi, dan sebelum ini satu-satunya jalan keluar adalah membiarkannya. Bukti salah yang tidak bisa dibetulkan bukan bukti yang lebih kuat; ia hanya membuat orang berhenti menganggap serius seluruh ceklisnya.

Dua batas yang membuatnya tetap layak disebut bukti, ditegakkan di **policy**, bukan hanya di tombol:

1. **Hanya item yang dia sendiri kerjakan** (`done_by = auth.uid()`). Memperbaiki pekerjaan orang lain bukan koreksi, itu penyuntingan.
2. **Hanya pada hari yang sama.** Bukti kemarin yang masih bisa diubah hari ini sama saja dengan tidak ada bukti — dan justru periode lampau itulah yang dibaca saat audit.

Admin outlet tetap bisa membereskan apa pun di outletnya kapan pun. Itu yang membuat batas "hari ini" aman: kesalahan yang ketahuan terlambat tetap ada yang bisa membetulkan, hanya saja lewat orang yang memang bertanggung jawab.

**Yang dicabut:** policy `checklist_run_items_all_own` (0016) memberi pemilik **run** kuasa penuh atas semua baris di dalamnya. Sejak `0071` satu run bisa berisi pekerjaan beberapa orang — jadi policy itu berarti siapa pun yang kebetulan memulai sesi boleh menyunting dan menghapus bukti rekan-rekannya. Diganti izin per-baris yang lebih sempit.

Menghapus baris juga menghapus fotonya, dan **barisnya dihapus lebih dulu**: kalau dibalik dan penghapusan baris ditolak, yang tersisa adalah baris yang menunjuk foto yang sudah tidak ada — "bukti" berupa gambar rusak, yang lebih buruk daripada tidak ada apa-apa. Policy Storage juga ditambah agar pengunggah bisa menghapus filenya sendiri; tanpa itu setiap penghapusan meninggalkan file yatim yang hanya bisa dibersihkan admin.

Dikunci `node tools/test-kemajuan-sesi.mjs` (11 kasus, termasuk data lama sebelum `0071` dan hari lampau yang tidak boleh diisi surut).

## Shift lintas tengah malam: clock out esok pagi

**Kasus:** clock in 6 Agustus 22:00, clock out 7 Agustus 07:00. **Satu hari kerja**, dan tanpa perlu jadwal shift diatur.

### Yang sudah benar sejak awal

Perhitungannya mengikat hari kerja ke tanggal **clock in**, bukan clock out. Jadi shift itu tercatat sebagai **satu** hari di tanggal 6 — bukan dua, bukan nol. Lembur pun dihitung dari selisih sejak clock in (`minutesSinceClockInMidnight`), yang memang menangani pergantian hari.

Jadwal shift **tidak wajib**. Tanpa jadwal, statusnya hanya kosong (kolom Shift menampilkan "–") dan tidak ada penilaian terlambat — presensinya sendiri tetap tercatat utuh. Jadwal hanya menentukan Tepat waktu / Toleransi / Terlambat.

### Yang rusak, dan sekarang diperbaiki

Halaman presensi hanya memakai `getMyTodaySession()` — yang bertanya *"apa saya clock in HARI INI"*. Pada 7 Agustus pukul 07:00 jawabannya **tidak**, karena clock in-nya tanggal 6. Akibatnya:

- Tombol **Clock Out tidak pernah muncul**. Orangnya tidak punya cara menutup shiftnya.
- Ia malah bisa **clock in lagi**, sementara baris tanggal 6 menggantung tanpa jam pulang — dan baris tanpa `clock_out_at` **tidak dihitung NBM sama sekali**. Yang bersangkutan baru sadar saat gajian.

`getMyOpenSession()` sebenarnya sudah ada di service sejak lama, tapi **tidak pernah dipanggil**. Sekarang dipakai, dan sesi terbuka lintas hari didahulukan.

**Batas 18 jam.** Tanpa batas, satu kali lupa clock out akan membuat aplikasi terus menampilkan "sedang bekerja" dan **memblokir presensi berhari-hari**. Shift yang benar-benar berjalan lebih dari 18 jam tidak ada; yang lewat dari itu hampir pasti lupa clock out.

Tapi yang lewat batas juga tidak boleh didiamkan — baris menggantung yang tidak pernah disebut akan diam-diam hilang dari NBM. Jadi ia ditampilkan sebagai **peringatan terpisah** di atas kartu presensi, menyebut tanggal dan outletnya, sambil menegaskan bahwa presensi hari ini tetap bisa berjalan.

Kartu "sedang bekerja" juga menyebut **tanggal** kalau clock in-nya bukan hari ini — "sejak 22.00" pada pukul 7 pagi terbaca seperti kekeliruan tanpa itu.

Dikunci `node tools/test-shift-lintas-hari.mjs` (8 kasus, termasuk tepat di batas 18 jam, dan shift malam berikutnya di hari yang sama setelah menutup shift semalam).

## Bug: "Tanpa jadwal" padahal jadwalnya ada (migration `0074`)

Tiga sebab berbeda, dan ketiganya menghasilkan tampilan yang sama persis.

### 1. Statusnya POTRET — jadwal yang dibuat belakangan tidak pernah menyusul

`late_status` dihitung sekali saat clock in, lalu disimpan. Itu keputusan yang benar: penilaian kehadiran harus memakai aturan yang berlaku **saat itu**, bukan aturan yang diubah belakangan.

Tapi akibatnya tidak pernah disebut di mana pun: kalau admin baru menyusun jadwal **setelah** orangnya clock in, baris itu tetap "Tanpa jadwal" selamanya. Admin lalu membuka Jadwal Shift, melihat jadwalnya ada, dan menyimpulkan aplikasinya salah. Yang salah bukan aplikasinya — yang tidak ada adalah **caranya memperbaiki**.

Sekarang ada tombol **↻** di kolom Shift, hanya pada baris yang memang belum pernah dinilai. RPC `hitung_ulang_status_shift()` menolak menyentuh baris berstatus `late`/`ontime`/`tolerance`/`off_day` kecuali dipaksa lewat parameter — penilaian yang sudah terjadi bukan sesuatu yang pantas berubah dengan satu ketukan.

### 2. Penyaring outlet yang saya tambahkan sendiri, dan salah

Saat memperbaiki bug `.maybeSingle()` di `getMyScheduleFor()`, saya menambahkan `.eq('outlet_id', outletBasis)`. Kelihatan lebih tepat. Akibatnya: orang yang **dijadwalkan membantu di outlet lain** jadi dianggap tidak punya jadwal sama sekali.

Menolak jadwal yang nyata-nyata ada hanya karena outletnya berbeda jauh lebih merugikan daripada memakai baris yang kurang tepat. Sekarang semua jadwal orang itu pada tanggal tersebut diambil, lalu outlet basis **diutamakan** — bukan disaring.

### 3. Modul Shift tidak aktif di outlet BASIS-nya

`shiftOutletActive` dibaca dari `baseOutlet.shift_enabled`. Kalau seseorang dijadwalkan di outlet yang memakai Shift tapi outlet **basis (★)** miliknya tidak mengaktifkan modul itu, statusnya kosong sama sekali (kolom Shift jadi "–", bukan "Tanpa jadwal"). Ini bukan bug, tapi perlu diketahui saat menelusuri.

### Dan perbaikannya sendiri gagal karena kolom yang tidak ada

Versi pertama `0074` (dan `getMyScheduleFor()`) mengurutkan jadwal dengan `created_at`. **`shift_schedules` tidak punya kolom itu** — yang ada `updated_at`. Hampir semua tabel lain di repo ini punya `created_at`, jadi jari mengetiknya begitu saja tanpa diperiksa ke skema.

Di SQL, akibatnya terlihat: *"column ss.created_at does not exist"*. Di JS jauh lebih buruk — PostgREST membalas error, error-nya ditelan `catch`, hasilnya `null`, dan orangnya dicap **"Tanpa jadwal"**. Perbaikan untuk bug "Tanpa jadwal" menghasilkan bug "Tanpa jadwal" yang baru, lewat jalur yang sama sekali berbeda.

Karena kelas kesalahan ini akan terulang, sekarang dijaga `node tools/audit-kolom-tabel.cjs`: skema dibaca langsung dari `supabase/migrations` (create table + alter table add/drop column), lalu setiap `.eq()`, `.order()`, `.gte()` dan sejenisnya di `js/` dicocokkan ke tabelnya. 312 pemakaian kolom terhadap 62 tabel.

Audit itu sendiri sempat salah: versi pertamanya memakai spasi literal antar kata, sehingga `alter table` yang ditulis berbaris-baris — bentuk yang justru paling sering dipakai di repo ini — terlewat seluruhnya. Audit yang melewatkan bentuk yang paling umum lebih berbahaya daripada tidak ada audit: ia memberi rasa aman palsu. Sekarang diuji dengan sengaja menyalahkan satu kolom lalu memastikan auditnya benar-benar menolak.

### Sekalian: koreksi presensi yang berbohong

`correctAttendanceRecord()` melakukan UPDATE tanpa `.select()`. Penolakan RLS tidak menghasilkan error — hanya 0 baris — jadi admin yang bukan admin outlet presensi itu melihat "koreksi tersimpan" untuk perubahan yang tidak pernah terjadi. Sudah diperiksa.

## Item aktivitas bisa berlaku di BEBERAPA outlet (migration `0076`)

Sebelumnya hanya ada dua kemungkinan: seluruh outlet BU, atau satu outlet. Kenyataannya ada di antaranya — "Serpong dan Sentul, tapi Central Kitchen tidak". Satu-satunya jalan sebelum ini adalah menggandakan itemnya, dan dua item bernama sama dengan riwayat terpisah membuat rekapnya tidak bisa dijumlahkan tanpa tahu sejarah penggandaannya.

### `outlet_id` tetap berarti "dikelola siapa", bukan sekadar "berlaku di mana"

Ini yang menentukan bentuknya. Kolom `outlet_id` dipakai policy `checklist_items_modify` (0054) untuk memutuskan apakah admin outlet boleh menyunting — mengubah artinya akan diam-diam melepas kendali itu. Jadi:

| Pilihan | `outlet_id` | Tabel `checklist_item_outlets` | Yang mengelola |
|---|---|---|---|
| Semua outlet BU | NULL | kosong | admin BU |
| **1 outlet** | outlet itu | kosong | **admin outlet itu** |
| **>1 outlet** | NULL | satu baris per outlet | **admin BU** |

Yang >1 outlet sengaja jadi milik BU: item yang menyentuh beberapa outlet bukan lagi urusan satu outlet saja. Membiarkannya dimiliki salah satu berarti admin outlet itu bisa mengubah pekerjaan outlet lain — dari layar yang tidak pernah menyebut outlet lain itu. Policy `cio_write` juga hanya diberikan ke admin BU, dan menuntut outlet tujuannya berada di BU yang sama.

**Data lama tidak perlu dipindahkan sama sekali.** Tanpa baris di tabel daftar, aturannya persis seperti sebelum `0076`. Diuji `node tools/test-cakupan-item.mjs` (12 kasus) — kasus "data lama tanpa daftar" ada di dalamnya, karena kalau aturan itu tergeser ceklis outlet mendadak kosong, dan gejalanya bukan error melainkan staff yang mengira tidak ada yang perlu dikerjakan.

Di layar: satu pemilih mode (*Semua outlet BU* / *Outlet tertentu*) plus centang per outlet. Modenya eksplisit, bukan "kalau tidak ada yang dicentang berarti semua" — aturan tersirat semacam itu sudah cukup sekali dipakai di penugasan sesi, dan menambahnya lagi hanya memperbanyak hal yang harus diingat orang.

## Cakupan item & sesi Daily Activities kini bisa dipindah

Sebelumnya "Berlaku di" hanya bisa dipilih **saat membuat**. Alasannya masuk akal — memindahkan item BU jadi milik satu outlet mengubah ceklis outlet lain — tapi jalan keluarnya salah: yang dibutuhkan **peringatan**, bukan larangan.

Melarangnya memaksa admin membuat item kembar lalu menonaktifkan yang lama. Dua item bernama sama dengan riwayat pengerjaan terpisah jauh lebih membingungkan daripada satu item yang cakupannya pernah berubah — dan rekapnya jadi tidak bisa dijumlahkan tanpa tahu sejarah itu.

Sekarang bisa diubah saat mengedit, dengan konfirmasi yang menyebut **dari mana ke mana** dan apa akibatnya. Berlaku untuk item maupun sesi.

**Siapa yang boleh — tidak berubah, dan memang sudah benar sejak `0054`.** Policy `checklist_items_modify` menguji baris **lama** lewat `using` dan baris **baru** lewat `with check`. Jadi admin outlet tidak bisa mengambil item BU jadi miliknya (gagal di `using`), maupun melepas itemnya jadi milik seluruh BU (gagal di `with check`). Yang bisa memindahkan hanya admin BU. Database-nya sudah siap sejak awal; hanya UI-nya yang menutup.

**Riwayat pengerjaan tidak ikut berubah.** `checklist_run_items` menunjuk item lewat id, jadi bukti yang sudah tercatat tetap utuh apa pun cakupan barunya. Yang berubah hanya ceklis mulai sesi berikutnya.

Satu pembersihan ikut dilakukan: penugasan sesi (`0069`) yang menunjuk sesi milik **outlet lain** dihapus saat cakupan menyempit. Itemnya toh tidak akan muncul di sana lagi — badge yang menyebut sesi yang tidak mungkin terjadi hanya menyesatkan pembacanya.

## Tombol Back perangkat (`js/core/navigasi.js`)

**Sebelum ini aplikasi tidak pernah menyentuh History API sama sekali.** Akibatnya menekan Back di HP — gerakan paling refleks yang ada — **keluar dari aplikasi**: di PWA terpasang ia menutup aplikasinya, di browser melompat ke situs sebelumnya. Yang sedang diisi hilang, tanpa konfirmasi apa pun.

Sekarang setiap kali orang "masuk lebih dalam", satu **lapis** didorong bersama satu entri history:

- **Modul → Back → Beranda** (Staff App) / **Dashboard** (Admin Portal).
- **Dialog → Back → dialog tertutup**, tetap di modul. Back saat dialog terbuka secara naluri berarti "batal"; sebelumnya justru melempar orangnya keluar.
- **Beranda → Back → keluar aplikasi.** Itu memang yang diharapkan pengguna Android, jadi tidak dihalangi.

Satu jebakan yang harus ditangani: kalau dialog ditutup lewat tombol Batal, lapisnya **wajib dilepas** — kalau tidak, ia jadi lapis hantu dan Back berikutnya "tidak melakukan apa-apa", yang membuat orang mengira aplikasinya menggantung. Sebaliknya, kalau penutupan datang **dari** Back, entri history-nya sudah dikonsumsi browser; memanggil pelepas lagi akan memundurkan satu langkah tambahan dan justru melempar orangnya keluar modul. Kedua arah itu diuji `node tools/test-navigasi-back.mjs` (9 kasus).

### Dua perbaikan kecil yang ikut dikerjakan

- **Toast kesalahan bertahan 7 detik**, bukan 3,4. Cukup untuk "Tersimpan", tidak cukup untuk "Koreksi tidak tersimpan — kamu bukan admin outlet presensi ini." Pesan yang hilang sebelum selesai dibaca sama saja dengan tidak pernah ada — dan justru pesan kesalahan yang paling perlu sampai.
- **Buka modul selalu mulai dari atas layar.** Tanpa itu, membuka modul setelah menggulir jauh menampilkan layar yang tampak kosong, dan orangnya mengira modulnya belum jadi.

## Tombol aksi kebal ketukan ganda (`sekaliJalan`)

Di dapur dan gudang, sinyal satu bar itu biasa. Tombol yang ditekan tidak memberi tanda apa pun selama beberapa detik, lalu orang menekannya lagi — refleks yang sepenuhnya wajar. Untuk tombol "Kirim", itu berarti **dua transaksi kas**, atau dua baris presensi. Kerugiannya bukan tampilan, melainkan data yang salah dan sulit ditelusuri kemudian.

`node tools/audit-klik-ganda.cjs` menemukan **44 tombol** seperti itu: handler klik `async` yang berisi `await` dan memanggil operasi pengubah data, tanpa satu pun penguncian. Semuanya kini dibungkus `sekaliJalan()`.

Yang dicari audit itu sengaja disempitkan ke aksi yang **mengubah** data. Tombol yang hanya membaca — filter, muat ulang, buka foto — boleh saja ditekan dua kali; hasilnya sama, dan menguncinya hanya membuat aplikasi terasa lamban.

Tombolnya dipulihkan di `finally`, **termasuk saat handler melempar error**. Tombol yang mati permanen setelah satu kegagalan jaringan memaksa orang memuat ulang halaman — kehilangan yang lebih besar daripada masalah yang sedang dicegah.

### Sub-halaman punya lapisnya sendiri

Versi pertama hanya memberi lapis pada **modul**, jadi Back dari form di tengah modul melompat langsung ke Beranda. Orangnya lalu harus masuk lagi ke modul yang sama hanya untuk kembali ke daftar yang tadi ditinggalkan — hukuman untuk gerakan yang maksudnya cuma "batal".

`dorongSubHalaman()` menutup itu: layar yang digambar **di tempat** (bukan dialog) — form sesi Daily Activities, form Tambah Staff — mendaftarkan lapisnya sendiri. Urutannya jadi wajar: **form → daftar modul → Beranda → keluar**.

Jebakannya sama dengan dialog, dan dua arah: tombol "← Kembali" harus membuang lapisnya sendiri (kalau tidak, Back berikutnya terasa tidak melakukan apa-apa), sementara penutupan yang datang *dari* Back tidak boleh membuangnya lagi (entri history-nya sudah dipakai browser).

## Konfirmasi sebelum meninggalkan isian yang belum tersimpan

Back dari modul dulu langsung membuang isian tanpa bertanya. Aman untuk layar baca, mahal untuk form panjang seperti Inventaris Aset atau Tambah Staff.

Pelacakannya sengaja **tidak** didaftarkan per halaman. Kalau tiap modul harus mendaftar sendiri, satu modul yang lupa akan diam-diam kehilangan perlindungan ini — dan justru modul yang jarang disentuh yang paling mudah terlupakan. Jadi: satu pendengar `input` di `document`, menyala kalau peristiwanya berasal dari `#module-content` dan bukan dari dalam dialog (dialog punya lapisnya sendiri, dan Back di sana memang berarti batal).

Tandanya dimatikan saat modul dibuka dan saat muncul **toast sukses** — satu-satunya isyarat "tersimpan" yang dipakai seragam di aplikasi ini.

**Ini heuristik, dan kesalahannya sengaja diarahkan ke satu sisi.** Ia bisa bertanya padahal tidak perlu (orang mengetik lalu menghapusnya lagi), tapi jarang diam padahal seharusnya bertanya. Untuk sebuah konfirmasi, pertanyaan berlebih hanya mengganggu; isian yang hilang tidak bisa dibatalkan.

Bagian tersulitnya ada di `popstate`: browser **sudah** memundurkan history sebelum kita sempat bertanya. Jadi entri itu didorong kembali **secara sinkron** sebelum dialognya muncul — kalau ditunda sampai jawaban datang, posisi history bergeser dan Back berikutnya melompati satu lapis. Saat orangnya memilih "Tinggalkan", `history.back()` dipanggil dengan penanda `abaikanSekali` supaya popstate yang dihasilkannya tidak ikut memakan lapis berikutnya.

Dikunci `node tools/test-navigasi-back.mjs` (14 kasus, gabungan lapis Back dan penjaga isian).

## Posisi gulir dipertahankan setelah aksi

Hampir semua aksi diakhiri dengan menggambar ulang seluruh daftar, dan menggambar ulang melempar layar kembali ke atas. Untuk admin yang sedang menyunting baris ke-40 di Rekap Presensi, itu berarti menggulir turun lagi setiap kali menyimpan satu koreksi — friksi kecil yang berulang puluhan kali dalam satu duduk.

Diselesaikan di `sekaliJalan()`, bukan di tiap halaman: seluruh aksi pengubah data sudah lewat sana, jadi satu tempat menutup semuanya sekaligus.

Dua hal yang membuatnya tidak berbalik jadi gangguan baru:

- **Dua frame, bukan satu.** Frame pertama biasanya baru menyisipkan HTML-nya; tingginya belum final. Memulihkan terlalu cepat menghasilkan lompatan yang justru lebih mengganggu daripada tidak dipulihkan sama sekali.
- **Dijepit ke tinggi halaman yang BARU.** Kalau daftarnya memendek — misalnya satu baris dihapus — memaksa posisi lama hanya menampilkan ruang kosong.

Posisi di bawah 100 px tidak dipulihkan: di sana orangnya praktis masih di atas, dan memaksa gulir malah terasa seperti halaman yang bergerak sendiri.

## Penanda "sedang offline" (`js/core/koneksi.js`)

PWA ini dipakai di dapur, gudang, dan halaman parkir. Sinyal hilang itu wajar — tapi sebelum ini tidak ada satu pun tanda. Yang muncul cuma tombol yang gagal dengan pesan teknis, dan orangnya menyimpulkan aplikasinya rusak lalu menekan tombol yang sama berkali-kali.

**`navigator.onLine` tidak cukup, dan tidak dijadikan sumber kebenaran.** Nilainya berarti "ada antarmuka jaringan", bukan "internet bisa dipakai" — HP yang tersambung wifi tanpa login tetap melaporkan `true`. Jadi tandanya juga dinyalakan oleh **kegagalan fetch yang sebenarnya**, lewat `fetch` khusus yang dipasang di klien Supabase. Itu satu-satunya bukti yang tidak bisa dibantah, dan semua permintaan aplikasi lewat sana.

Yang membedakannya dari penanda naif: **balasan 403 atau 500 justru MELEPAS tanda offline.** Server yang membalas apa pun adalah server yang terjangkau. Penanda offline yang menyala saat masalahnya sebenarnya izin akan membuat orang mencari sinyal selama sepuluh menit untuk masalah yang tidak ada hubungannya dengan sinyal.

Peristiwa `offline` bawaan browser tetap dipakai karena bereaksi seketika saat mode pesawat dinyalakan. Tapi peristiwa `online` **tidak** dipercaya untuk melepas tanda — tersambungnya antarmuka bukan jaminan servernya bisa dihubungi. Yang melepas hanya permintaan yang sungguh berhasil.

Bilahnya ditempel di **atas** layar, bukan bawah: yang di bawah tertutup papan ketik saat orang sedang mengisi form — persis saat kabar ini paling dibutuhkan. Saat koneksi pulih, kabarnya ditampilkan sebentar lalu hilang sendiri; kalau langsung dihilangkan, orang yang sempat melihat peringatannya tidak pernah tahu keadaannya sudah beres.

Dikunci `node tools/test-koneksi.mjs` (7 kasus, termasuk 403 dan 500 yang tidak boleh dianggap offline).

## Reservasi: jam bebas & Syarat/Ketentuan (migration `0077`)

### Jam bebas — yang berbahaya bukan jamnya, tapi kuotanya

Kolomnya sudah `time`, jadi 18:15 sebenarnya selalu bisa disimpan; yang membatasi cuma daftar pilihan di layar. Tapi melepasnya begitu saja akan **mematahkan kuota tanpa satu pun error**: `reservation_slot_usage()` menghitung dengan `reserve_time = p_time`, sehingga 18:00 dan 18:05 terhitung slot berbeda. Dua rombongan 20 orang bisa masuk berbarengan di ruangan yang muat 20, dan sistemnya melaporkan semuanya baik-baik saja sampai tamunya datang.

Jadi jamnya dibebaskan, tapi hitungannya dipindah ke **ember**: setiap jam dipetakan ke slot tempat ia jatuh (`reservation_slot_of`). Kuotanya kembali berarti, dan staff tetap bisa menulis 18:15 seperti yang sebenarnya dijanjikan ke tamu.

Layar staff berubah dari *dropdown slot* jadi *input jam* + **keterangan sisa kursi** slot yang bersangkutan. Angka sisa kursi itu tetap ditampilkan karena staff perlu tahu sebelum menjanjikan meja — yang dibuang cuma kekakuannya.

Jam di luar jam operasional tetap ditolak di database. Menerima 03:00 hanya melahirkan reservasi yang mustahil dilayani, dan yang menanggungnya staff di lapangan.

### S&K: satu sumber, tiga tempat tampil

Ditaruh **per outlet di `reservation_settings.terms`**, bukan di dalam kode. Minimal purchase, nomor rekening deposit, dan lama pemakaian ruangan berubah tanpa memerlukan programmer — begitu ada di kode, setiap perubahan kecil antre menunggu deploy. Gading Serpong dan Sentul juga bisa berbeda tanpa percabangan apa pun.

Dari satu sumber itu, teksnya muncul di tiga tempat, masing-masing dengan alasannya:

1. **Pesan WhatsApp konfirmasi** — diminta, dan memang tempat paling penting: itulah dokumen yang dipegang tamu. Ditaruh **setelah** detail reservasi, bukan sebelum. Yang pertama dicari orang saat membuka konfirmasi adalah tanggal dan jamnya; dua puluh baris ketentuan di atasnya mendorong informasi terpenting ke bawah lipatan WhatsApp, dan yang terjadi berikutnya adalah tamu bertanya "jadi jam berapa ya?" lewat pesan susulan.
2. **Form reservasi Staff App** — ditampilkan **di dalam** form, bukan sebagai tautan. Yang dibaca orang adalah yang ada di depan matanya; ketentuan yang harus diklik dulu praktis tidak pernah dibuka, dan itu justru yang jadi pangkal perselisihan soal deposit. Ada centang "customer sudah diberi tahu & menyetujui".
3. **Halaman publik** — lewat `public_note`/S&K yang sama.

**`reservations.terms_accepted_at` mencatat kapan disetujui.** Untuk kebijakan yang menyebut "deposit tidak dapat dibatalkan", persetujuan yang tidak tercatat sama saja dengan tidak ada — dan yang menanggung akibatnya adalah kasir di depan tamu yang merasa tidak pernah diberi tahu. NULL berarti memang tidak tercatat (mis. reservasi telepon), bukan berarti menolak.

Pemetaan slotnya dikunci `node tools/test-slot-fleksibel.mjs` (14 kasus, termasuk slot 30/45 menit dan jam buka yang bukan .00).

## Reservasi: DP & koreksi/reschedule (migration `0078`)

### DP: nominal + foto bukti transfer

S&K menyebut "deposit 50% … deposit tidak dapat dibatalkan". Kebijakan sebesar itu tidak boleh hidup hanya di teks: kalau nominal dan buktinya tidak tercatat, satu-satunya yang tahu berapa yang sudah masuk adalah orang yang kebetulan menerima transfernya — dan saat dia libur, tidak ada yang bisa menjawab.

Tiga kolom di `reservations`: `deposit_amount` (rupiah, NULL = belum ada DP), `deposit_proof_path`, `deposit_at`. Fotonya masuk bucket **privat** `reservation-proofs`. Privat karena bukti transfer memuat nama dan nomor rekening pengirim; bucket publik berarti siapa pun yang menebak nama filenya bisa membacanya. Policy-nya berbasis **prefix path** (`{outlet_id}/…`), bukan berdasarkan kolom di tabel reservasi — pelajaran dari `0050`: izin yang bergantung pada kolom yang baru diisi *setelah* file diunggah membuat file yang baru ditulis tidak bisa dibaca oleh pengunggahnya sendiri.

**DP tidak masuk modul Kas — ini keputusan, bukan kelalaian.** DP ditransfer ke rekening perusahaan, bukan ke kantong kas seseorang, sementara `cash_entries` seluruhnya dibangun di atas gagasan "uang yang dipegang seorang **user** dan jadi tanggung jawabnya". Mencatatnya di kas berarti menambah saldo seseorang atas uang yang tidak pernah ada di tangannya, dan saat rekonsiliasi kas dia harus menjelaskan selisih yang bukan urusannya. Angka DP hidup di reservasinya saja. Catatan ini ditulis juga di dalam migration-nya, supaya tidak ada yang membangun jembatannya belakangan dengan niat baik.

### Koreksi lewat RPC, bukan UPDATE langsung

Reschedule dan ralat nomor telepon itu kejadian harian, bukan pengecualian. Tanpa jalur koreksi, admin membatalkan lalu membuat ulang — dan itu memutus kode reservasi yang sudah terlanjur dikirim ke tamu, sekaligus menghapus jejak bahwa perubahannya pernah terjadi.

`update_reservation(...)` dipakai karena mengubah tanggal/jam/pax berarti **kuota harus dihitung ulang**. UPDATE biasa akan memindahkan rombongan 30 orang ke slot yang sudah penuh tanpa satu pun penolakan. Dua detail yang gampang salah:

- Kuota **hanya** dihitung ulang kalau tanggal/slot/jumlahnya benar-benar berubah. Kalau admin cuma membetulkan ejaan nama, memaksa pemeriksaan kuota bisa menolak reservasi yang sudah sah — slotnya memang penuh, oleh reservasi itu sendiri.
- Saat slotnya tidak berpindah, **pax barisnya sendiri dikurangkan** dari pemakaian. Tanpa itu ia bersaing melawan dirinya sendiri, dan menaikkan 20 → 21 orang ditolak karena "sudah ada 20".

Argumen `NULL` berarti "jangan diubah", dibedakan dari "kosongkan". Form yang mengirim seluruh kolom apa adanya akan menghapus catatan hanya karena kolomnya tidak diisi ulang.

Hapus permanen disediakan, tapi dialognya menyarankan **ubah status jadi Dibatalkan** untuk pembatalan biasa: jejaknya tetap ada untuk laporan, dan kursi yang dilepas juga sudah kembali ke kuota karena `reservation_slot_usage()` hanya menghitung status `pending`/`confirmed`.

## Reservasi Staff App: DP & rentang bawaan (migration `0079`)

### DP dicatat di tempat uangnya diterima

`0078` hanya membuka jalur DP di Admin Portal. Tapi yang menerima bukti transfer di WhatsApp adalah staff yang mengangkat teleponnya, bukan admin — jadi buktinya berhenti di galeri HP staff, persis keadaan yang mau dihindari `0078`.

Sekarang DP bisa diisi di **form Reservasi Baru**, dan — karena bukti transfer sering baru dikirim customer beberapa jam kemudian — juga belakangan lewat tombol **💰 Catat DP** di kolom DP. Kalau DP dipaksa harus diisi bersamaan dengan pembuatan reservasi, sebagian besar DP tidak akan pernah tercatat.

**Staff mencatat, admin mengoreksi.** Staff hanya boleh mengisi DP yang masih **kosong**, di reservasi yang **dia buat sendiri** — atau yang **datang dari website**, karena reservasi website tidak punya pembuat dan memaksakan pagar "hanya pembuatnya" di situ berarti DP-nya tidak akan pernah bisa dicatat siapa pun kecuali admin, padahal yang menerima transfernya tetap staff yang sama; database (`catat_dp_reservasi`) yang menegakkannya, bukan tampilannya. Membiarkan staff menimpa nominal yang sudah tercatat berarti angka DP bisa turun tanpa jejak, dan yang menanggung selisihnya adalah orang yang menerima uangnya. `deposit_by` menjawab pertanyaan yang selalu muncul saat angkanya diragukan: bukan "kapan", tapi "siapa".

Dua jebakan yang ditutup di jalan ini:

- **Field `money` mengembalikan `0` untuk isian kosong, bukan `''`.** Tanpa pemeriksaan `> 0`, mengosongkan kolom DP akan mencatat "DP Rp 0" — angka yang terlihat pasti padahal artinya justru "tidak ada DP", dan sesudah itu tombol Catat DP tidak muncul lagi karena barisnya sudah dianggap terisi.
- **`0` di form koreksi admin berarti HAPUS.** Di sana kolomnya sudah terisi nilai lama, jadi mengosongkannya memang niat menghapus. Tanpa arti ini, DP yang tercatat di reservasi yang keliru tidak akan pernah bisa dicabut — hanya bisa diganti angka lain, dan angka apa pun di situ tetap salah.

Policy Storage `0078` juga diperketat: menimpa bukti transfer yang sudah ada kini hanya boleh oleh **pengunggahnya sendiri** atau **admin outlet**. Nama filenya bisa ditebak (`{outlet_id}/{reservation_id}`), jadi sebelumnya bukti yang sudah diperiksa admin bisa diganti siapa pun di outlet itu tanpa jejak. Pengunggahnya tetap boleh menimpa — foto buram itu lumrah, dan tanpa jalur perbaikan orang berhenti mengunggah sama sekali.

Aturannya dikunci `node tools/test-dp-reservasi.mjs` (25 kasus).

### Rentang bawaan: hari ini → akhir bulan, tanpa menekan apa pun

Modul ini dipakai untuk **bersiap**, bukan untuk mengenang: yang berguna saat layarnya dibuka adalah tamu yang belum datang. Karena itu bawaannya **hari ini sampai akhir bulan ini**, tanggal yang sudah lewat tidak ikut, dan "Bulan ini" di sini artinya kebalikan dari "Bulan ini" di modul laporan (yang menoleh ke belakang, tanggal 1 → hari ini).

Tombol **"Tampilkan" dihapus.** Mengubah tanggal lalu menekan tombol berarti setiap perubahan punya dua langkah, dan langkah kedua itu mudah terlupakan — gejalanya staff menatap daftar yang tidak sesuai dengan tanggal di layarnya sendiri, lalu mengira reservasinya hilang.

**Konsekuensi yang perlu diketahui:** menjelang akhir bulan rentang bawaannya jadi pendek (tanggal 29 → 3 hari), dan reservasi awal bulan depan tidak ikut terlihat. Itu sebabnya ada pintasan **30 hari** — satu ketukan, bukan mengetik dua tanggal.

Dikunci `node tools/test-rentang-reservasi.mjs` (24 kasus). Yang dijaga: rentangnya tidak pernah terbalik (`dari > sampai`). Rentang terbalik tidak menghasilkan error apa pun — query-nya sah, hasilnya kosong — dan gejalanya persis sama dengan "tidak ada reservasi".

## Reservasi: batas pemesanan "H- sekian hari" (migration `0080`)

`min_lead_hours` sudah ada sejak `0044`, tapi satuannya **jam**. Untuk aturan yang diucapkan sehari-hari sebagai "H-3", jam adalah satuan yang salah: orang menghitung H-3 lewat **tanggal di kalender**, bukan lewat 72 jam. Memaksakannya ke jam membuat tamu yang memesan tanggal 17 malam untuk tanggal 20 ditolak — padahal menurut dia, dan menurut S&K yang dia baca, itu masih H-3.

Dua kolom baru di `reservation_settings`:

- **`min_lead_days`** — H- berapa hari, dihitung per tanggal kalender.
- **`booking_cutoff_time`** — batas jam di hari terakhir itu. NULL = sampai akhir hari.

H-3 dengan batas 17.00, untuk reservasi tanggal 20: pemesanan ditutup **tanggal 17 pukul 17.00**. Memesan tanggal 17 pukul 16.59 masih diterima, 17.01 ditolak, tanggal 16 malam jelas diterima.

**Jam batas hanya berlaku di hari batas itu.** Tanpa pembatasan ini, "sebelum jam 17.00" akan ikut menolak pemesanan H-10 yang kebetulan dibuat jam 8 malam — aturan yang tidak pernah dimaksudkan siapa pun. Ini kasus yang paling mudah salah dibaca di dalam SQL yang panjang, jadi ia diuji tersendiri.

Batas **jam** (`min_lead_hours`) tetap berlaku berdampingan: keduanya harus terpenuhi.

**Cakupannya hanya jalur website**, sama seperti `min_lead_hours` selama ini — `create_reservation` dari Staff App memang tidak pernah memeriksa lead time, dan itu dipertahankan dengan sadar. Telepon "meja untuk besok" harus tetap bisa dicatat di aplikasi; aturan yang membuat staff mencatat di kertas bukan aturan yang menang. Yang ditambahkan: staff **diberi tahu** kalau tanggal itu sudah ditutup untuk publik, karena itulah yang menjelaskan kenapa tamu bilang "di website tidak bisa".

### Alasan penolakan ikut dibawa, bukan cuma boolean

`reservation_info_tanggal()` mengembalikan `boleh`, `alasan`, dan `batas`. Halaman yang hanya tahu "tidak boleh" akan menampilkan deretan jam mati berlabel **"penuh"** — dan tamu menyimpulkan tempatnya penuh lalu pergi, padahal yang perlu dia ubah cuma tanggalnya. Sekarang halaman publik menampilkan kalimatnya ("pemesanan paling lambat H-3 (17-08-2026 pukul 17.00)") menggantikan daftar jam, dan `submit-reservation` mengirim kalimat yang sama alih-alih "penuh atau terlalu mepet".

Label slot tertutup juga diperbaiki: **"penuh"** hanya kalau kursinya memang habis; kalau masih ada sisa, yang menutup adalah waktu, dan tulisannya "tutup".

Bentuk kembalian `reservation_availability` sengaja **tidak** diubah — mengubah tipe tabel yang dikembalikan memaksa `drop function`, dan setiap halaman yang masih terbuka di browser lain akan error sampai di-refresh, untuk perubahan yang sebenarnya cukup di dalam badan fungsinya.

Aturannya dikunci `node tools/test-batas-pesan.mjs` (23 kasus, termasuk tepi jam batas dan hari batas yang jatuh di bulan sebelumnya).

### Dua audit ikut diperbaiki sambil jalan

- **`audit-kolom-tabel.cjs` sebelumnya melewatkan justru query terpanjang.** Jendela pembacaannya 600 karakter, sementara `listReservations` punya `.select()` yang jauh lebih panjang dari itu — tanda kutip penutupnya tidak pernah ketemu, jadi seluruh rantai itu diam-diam tidak diperiksa. Sekarang kolom polos di dalam `.select()` ikut dicocokkan ke skema (885 pemeriksaan, naik dari 321). Embed dan alias tetap dilewati: audit yang sering salah tuduh akan berhenti dipercaya lalu diabaikan.
- **`audit-syntax.cjs` tidak pernah menyentuh HTML.** `reservasi.html` memuat logika sungguhan di dalam `<script type="module">` — dan halaman itu justru yang dilihat **calon tamu**. Kalau ia mati karena satu backtick liar, tidak ada satu pun staff yang tahu; yang tahu cuma orang yang sudah pergi ke tempat lain. Sekarang blok modul di dalam HTML ikut di-parse.

## "Boleh melihat" ≠ "boleh mengatur" (migration `0081`)

**Gejalanya:** admin outlet membuka Jadwal Shift, memilih shift di sebuah sel, dan mendapat *"new row violates row-level security policy"*. Tidak ada yang bisa dia lakukan dengan pesan itu, dan yang terdengar adalah "aplikasinya rusak".

**Sebabnya bukan izin yang salah — izinnya justru bekerja persis seperti seharusnya.** Dropdown outlet di layar admin diisi `listMyOutlets()`, yang menjawab pertanyaan *"outlet mana yang boleh kulihat"*. Aturannya membuka **seluruh outlet BU** untuk siapa pun yang punya scope tanpa `outlet_id` — termasuk orang berperan `outlet_admin` yang scope-nya terlanjur dibuat di level BU, dan termasuk admin outlet yang punya scope tambahan level BU. Sementara yang menentukan boleh-tidaknya **menulis** adalah `is_admin_of_outlet()`, yang untuk `outlet_admin` mensyaratkan `ms.outlet_id` menyebut outletnya persis.

Jadi orangnya ditawari outlet yang tidak pernah boleh dia sentuh, dan baru tahu setelah menekan sesuatu. Yang salah adalah layar yang memakai jawaban dari pertanyaan yang keliru.

**Perbaikannya berlapis:**

1. **RPC `outlets_saya_kelola(p_bu)`** — memanggil `is_admin_of_outlet()` yang sama persis dipakai RLS. Dua sumber jawaban untuk satu pertanyaan pasti akan menyimpang; yang ini tidak bisa, karena sumbernya memang satu.
2. **Layar Shift memakai RPC itu**, bukan `listMyOutlets()`. Kalau hasilnya kosong padahal ada outlet yang bisa dilihat, tab-nya **tidak digambar sama sekali** dan yang muncul adalah kalimat yang menyebut penyebab **dan** tempat memperbaikinya (Master User → scope harus menyebut outlet). Tiga tab yang semuanya buntu hanya membuat orang menekan ketiganya dulu sebelum percaya.
3. **Penolakan RLS diterjemahkan** (`pesanTolakan()`) jadi kalimat yang bisa ditindaklanjuti. Ini lapis kedua, bukan pengganti lapis pertama: pesan error yang bagus untuk sesuatu yang seharusnya tidak pernah muncul bukan alasan untuk membiarkannya muncul.

**Wewenangnya tidak diubah sedikit pun.** Menambal ini dengan melonggarkan `is_admin_of_outlet()` (mis. "outlet_admin tanpa outlet_id = admin seluruh BU") akan diam-diam memberi wewenang baru di **seluruh** modul yang memakainya — kas, presensi, reservasi, aktivitas harian — hanya demi memperbaiki satu dropdown.

Aturan MELIHAT dipindah ke `js/core/aturan-outlet.js` yang **tanpa impor sama sekali**, semata-mata supaya bisa diuji: `my-outlets.js` mengimpor klien Supabase, yang mengimpor dari CDN, jadi tidak bisa dijalankan di luar browser. Aturan yang tidak bisa diuji hanya diperiksa dengan cara membacanya ulang — dan aturan inilah yang diam-diam menyimpang.

Selisihnya dikunci `node tools/test-wewenang-outlet.mjs` (23 kasus). Yang dijaga: setiap bentuk scope, "yang bisa diatur" harus **selalu bagian dari** "yang bisa dilihat" — dan bentuk yang memicu bug ini diuji dengan namanya sendiri.

### Sapuan ke seluruh layar admin

Menyapu sisanya memunculkan hal yang tidak saya duga: **dua dari empat layar yang saya sebut bermasalah ternyata baik-baik saja, dan tiga yang tidak saya sebut justru bermasalah.**

- `production.admin`, `sales.admin`, `report.admin`, `inventory.admin` — **hanya membaca.** Untuk layar baca, memakai daftar "yang boleh diatur" justru merugikan: admin outlet kehilangan angka yang berhak dia baca, dan laporannya bolong tanpa tanda apa pun. Dibiarkan memakai `listMyOutlets()`, dan dicatat alasannya di pengecualian audit.
- `reservation.admin` — **dua daftar sekaligus.** Penyaring laporan tetap memakai daftar "boleh dilihat" (kalau disempitkan, laporannya bolong); tab Pengaturan & Area dan tombol per baris memakai daftar "boleh diatur".
- `cleaning.admin` — lolos dari audit versi pertama karena memanggil `listBuOutlets()`, nama lain untuk hal yang sama satu lapis di dalam service-nya. **Aturan yang hanya mengenali satu nama akan selalu kalah oleh nama kedua.**
- `attendance.admin` dan `nbm-settings.admin` — menulis ke tabel `outlets`, yang policy update-nya mensyaratkan **admin BU**, bukan admin outlet. Jadi `listOutletsSayaKelola` pun daftar yang salah di sini; tombolnya digambar berdasarkan `sayaAdminBu()`.

### Kegagalan yang lebih berbahaya daripada dropdown-nya

Sambil menyapu, ketahuan bahwa **tujuh penulisan bisa gagal tanpa suara.** PostgREST tidak menganggap penolakan RLS sebagai error pada UPDATE/DELETE — yang kembali adalah **sukses dengan 0 baris**. Yang terparah:

- **`setReservationStatus()`** — daftar "Perlu Diproses" berisi seluruh BU. Admin outlet Serpong menekan *Setujui* pada reservasi Sentul, melihat notifikasi hijau, lalu barisnya hilang dari daftarnya sendiri saat dimuat ulang — padahal statusnya masih *Menunggu*. Tamunya menunggu konfirmasi yang tidak akan pernah datang.
- **`setOutletLocation()` / `setOutletWorkHours()`** — geofence "tersimpan" padahal tidak. Ini cara paling halus untuk membuat seluruh staf sebuah outlet gagal clock in keesokan harinya.
- **`setSchedule()`** — upsert-nya menulis sel jadwal. Sel KOSONG masuk jalur INSERT (ditolak = error, terlihat), tapi sel yang SUDAH TERISI masuk jalur UPDATE (ditolak = 0 baris, senyap). Jadi bug yang dilaporkan hanya separuh dari yang sebenarnya terjadi.

Semuanya kini `.select()` lalu memeriksa `data.length`, dengan pesan yang menyebut sebabnya.

### Tiga audit baru, dan satu yang ternyata bohong

- **`audit-outlet-tulis.cjs`** — layar `*.admin.page.js` yang mengambil daftar outlet dari sumber "boleh dilihat" harus juga memakai `listOutletsSayaKelola`, atau terdaftar di pengecualian **beserta alasannya**. Daftar yang harus ditambahi manual memaksa orang menjawab "layar ini menulis atau tidak?" — pertanyaan yang dulu tidak pernah ditanyakan.
- **`audit-tulis-senyap.cjs`** — UPDATE/DELETE/upsert pada tabel ber-scope outlet wajib `.select()`. Cakupannya sengaja dibatasi ke daftar tabel yang disebut di dalamnya; audit yang mengklaim memeriksa segalanya tapi diam-diam melewatkan sebagian lebih berbahaya daripada audit yang menyebutkan batasnya.
- **`lib-rantai.cjs`** — dan inilah yang paling penting. Audit-audit lama memotong rantai `supabase.from(...)` dengan menebak dari indentasi: "baris berikutnya diawali `}` berarti rantainya selesai". Objek literal di dalam `.update({ ... })` membuat tebakan itu berhenti tepat sebelum `.select()`. Akibatnya `audit-tulis-senyap` menuduh empat file yang sudah benar, dan `audit-kolom-tabel` diam-diam melewatkan bagian rantai terpanjang. Sekarang rantainya dipotong di `;` pada kedalaman kurung 0 — definisi akhir pernyataan yang sesungguhnya. `audit-kolom-tabel` naik dari 321 → **900** pemeriksaan setelah dua perbaikan ini.

## Regresi yang saya buat sendiri: Daily Activities mati untuk seluruh staff

Layak ditulis panjang, karena bentuknya akan terulang.

Saat menyapu layar admin, satu fungsi di `cleaning.service.js` diganti dari `listMyOutlets()` (boleh dilihat) jadi `listOutletsSayaKelola()` (boleh diatur). Untuk Admin Portal itu benar. Tapi fungsi yang sama ternyata dipakai `cleaning.page.js` di **Staff App** — dan staff tidak mengelola outlet mana pun. Daftarnya kosong, dan seluruh modul Daily Activities menjawab *"Belum ada outlet untukmu di BU ini"*.

**Tidak ada error, tidak ada yang merah. Modulnya sekadar hilang.** Persis jenis kegagalan yang paling sering dibahas di dokumen ini, kali ini saya sendiri yang membuatnya — sambil memperbaiki kegagalan sejenis di tempat lain.

Akarnya bukan kecerobohan sesaat: **file `*.service.js` dipakai bersama oleh Staff App dan Admin Portal.** Menaruh konsep "yang boleh diatur" di sana berarti setiap perubahan harus mengingat kedua pemakainya sekaligus — dan ingatan bukan mekanisme yang bisa diandalkan.

Perbaikannya berlapis:

1. `listBuOutlets()` kembali menjadi daftar "boleh dilihat", dengan peringatan eksplisit di atasnya.
2. Daftar "boleh diatur" **tidak lagi hidup di service mana pun**. `cleaning.admin.page.js` memanggil `listOutletsSayaKelola()` sendiri, dan hanya untuk pemilih **cakupan** item/sesi. Nama outlet pada item yang sudah ada tetap dibaca dari daftar "boleh dilihat" — kalau tidak, item milik outlet lain tampil sebagai "Outlet" tanpa nama.
3. **`tools/audit-daftar-kelola.cjs`**: `listOutletsSayaKelola` hanya boleh disebut di `js/core/**` dan di file `*.admin.page.js`. Halaman staff dan file service dilarang menyentuhnya. Diverifikasi dengan mengembalikan bug-nya persis seperti semula — audit menangkapnya.

Audit itu sengaja **membuang komentar sebelum mencocokkan**. Tanpa itu, menjelaskan aturannya di dalam komentar ikut dianggap melanggar, dan satu-satunya cara membuat audit hijau adalah menghapus penjelasan yang justru paling dibutuhkan orang berikutnya. Audit tidak boleh menghukum dokumentasi.

### Yang ikut diperiksa, dan ternyata aman

`.select()` yang ditambahkan di sapuan sebelumnya sempat mencemaskan: kalau policy **SELECT** lebih sempit daripada **UPDATE**, penyimpanan yang berhasil akan dilaporkan gagal — bug baru yang dibuat oleh perbaikan bug. Diperiksa satu per satu: `reservation_settings`, `reservation_areas`, `assets`, `shift_schedules`, `outlet_shifts` semuanya SELECT-nya `has_bu_scope` (lebih luas) sementara MODIFY-nya `is_admin_of_outlet` (lebih sempit); `outlets` SELECT-nya `has_outlet_scope`, UPDATE-nya `is_bu_admin`. Di semua kasus, siapa pun yang boleh menulis pasti boleh membaca kembali barisnya. Aman.

Begitu juga jalur multi-outlet Daily Activities: `cio_select` memakai `has_bu_scope`, jadi staff tetap bisa membaca item yang cakupannya beberapa outlet.

## Empat bug tumpukan Back — dan kenapa tes lama tidak melihatnya

Dilaporkan dua gejala di Daily Activities (Staff App): **selesai mengisi form, aplikasi melompat ke Beranda**, dan **pop-up "lanjutkan mengisi" muncul terus sampai form tidak bisa diisi**. Setelah ditelusuri, ketiganya — lalu keempatnya — berasal dari satu tempat: `js/core/navigasi.js`.

### 1. Pembersih lapis memakan satu lapis lagi

`dorongLapis()` mengembalikan pembersih untuk dipanggil kalau layarnya ditutup lewat tombol. Pembersih itu membuang lapisnya sendiri **lalu** memanggil `history.back()`. Masalahnya: popstate yang timbul karenanya tidak membawa tanda apa pun soal siapa yang memicunya, jadi ia dibaca sebagai ketukan Back user — dan **memakan satu lapis lagi**, yaitu lapis modulnya. Menutup dialog form karena itu melempar orangnya ke Beranda.

Diperbaiki dengan penghitung `abaikanBerikutnya`: setiap `history.back()` yang kita panggil sendiri memesan satu popstate untuk diabaikan. **Penghitung, bukan boolean** — dua dialog yang tertutup hampir bersamaan mengantre dua popstate, dan satu boolean hanya menahan yang pertama.

### 2. Pertanyaan keluar yang memanggil dirinya sendiri

Dialog "tinggalkan isian?" adalah `confirmDialog`, dan setiap dialog mendaftarkan lapis Back-nya sendiri (`lapisDialog` di ui.js). Saat ditutup, pembersihnya memundurkan history; popstate susulannya memicu penjaga yang sama; penjaga membuka dialog itu lagi. Selamanya — dan form-nya tidak pernah bisa diisi.

Perbaikan penghitung di atas ternyata sudah cukup memutus lingkarannya. Yang **belum** tertutup dan baru ketahuan lewat tes: **ketukan Back saat pertanyaannya masih terbuka.** Orang yang tidak sabar menekan Back lagi alih-alih menyentuh tombol dialog; ketukan itu dulu membuka pertanyaan kedua lalu melempar keluar modul. Sekarang ketukan itu diabaikan **dan entri history-nya dikembalikan** — kalau tidak, history jadi lebih pendek daripada tumpukan lapis, dan selisihnya baru terasa jauh kemudian sebagai Back yang melompati satu layar.

### 3. Layar yang menggambar ulang dirinya sendiri menumpuk lapis

Tidak dilaporkan, tapi satu keluarga dengan yang di atas. Layar sesi Daily Activities memanggil `renderRunForm()` lagi setiap kali item **dikirim, diperbaiki, atau dihapus** — dan tiap penggambaran ulang memanggil `dorongSubHalaman()` dengan nama yang sama. Setiap kali: satu lapis dan satu entri history baru. Sesudah mengirim tiga kali, orangnya harus menekan Back **empat kali** untuk keluar, dan tiga ketukan pertama hanya menggambar ulang layar yang sama. Tidak bisa dibedakan dari aplikasi yang menggantung.

`dorongSubHalaman()` sekarang memakai ulang lapis dengan nama yang sama kalau sudah ada. Perbaikannya di lapisan navigasi, bukan di modulnya — supaya modul lain yang menggambar ulang dirinya sendiri ikut aman tanpa harus ingat.

### 4. Tombol 🏠 meninggalkan entri history basi

`bersihkanLapis()` mengosongkan tumpukan tapi membiarkan entri history-nya. Sesudah membuka beberapa modul lalu menekan 🏠, ketukan Back berikutnya hanya memundurkan entri kosong dan aplikasinya **tidak bereaksi sama sekali** — beberapa kali berturut-turut. Sekarang entrinya ikut dimundurkan satu per satu.

### Kenapa `test-navigasi-back.mjs` (19 kasus, hijau) tidak menangkap satu pun

Karena ia **mencerminkan aturannya**, bukan menjalankan kodenya. Keempat bug ini tidak lahir dari aturannya — aturannya benar — melainkan dari **interaksi antara tumpukan lapis dan entri history**. Cermin tidak punya history.

`tools/test-navigasi-popstate.mjs` mengimpor `js/core/navigasi.js` yang sebenarnya dan menjalankannya di atas tiruan `history` + `popstate`. Dua detail tiruan itu yang menentukan:

- **`back()` tidak memanggil handler langsung**, ia mengantre popstate untuk giliran berikutnya.
- **Handler dipanggil TANPA di-`await`.** Begitulah browser bekerja: event berikutnya tetap dikirim meski handler sebelumnya masih menunggu dialog dijawab. Versi pertama tes ini meng-`await` satu per satu — dan bug "Back saat dialog terbuka", yang justru paling mungkin dialami orang, tidak muncul sama sekali.

Ada juga jaring pengaman: kalau antrean popstate tidak habis dalam 50 putaran, tesnya **gagal** alih-alih menggantung. Bug nomor 2 bentuk aslinya memang antrean yang tidak pernah habis.

Keempat perbaikan diverifikasi dengan **mencabutnya satu per satu** dan memastikan tesnya merah. Satu penjagaan (`dorongLapis` yang diam selama pertanyaan tampil) ternyata **tidak** membuat tes merah saat dicabut — itu ditulis apa adanya di komentarnya sebagai pertahanan berlapis, bukan sebagai penyelamat, supaya tidak ada yang mengira ia load-bearing.

## Resep: kenapa "resep untuk CK" tidak pernah bisa masuk

Dilaporkan sebagai satu keluhan — "resep untuk CK gagal, dan sepertinya tidak ada form isian, hanya impor" — ternyata tiga hal berbeda yang saling menutupi.

### 1. Impor memang tidak bisa membuat varian CK

`product-import.js` menebak varian dari tipe produk:

```js
const mode = p.product_type === 'semi' ? 'production' : 'standalone';
```

Kolom varian tidak pernah dibaca, dan template-nya memang tidak punya kolom itu. Artinya **menu SELALU masuk sebagai "Standalone"**, dan resep **"Dilayani CK"** mustahil diimpor. Filenya diterima, impornya dilaporkan berhasil, tapi kolom "Dilayani CK" tetap "Belum". Dari sisi yang memakainya, itu tidak bisa dibedakan dari gagal — dan tidak ada satu pun pesan yang menuntun.

Sekarang template punya kolom **Varian**, dan tulisan bebas orang ikut dibaca ("CK", "dilayani ck", "Produksi (CK)"). Varian yang tidak berlaku untuk tipe produknya **ditolak dengan alasan**, bukan diam-diam dibelokkan: resep yang masuk ke varian yang salah menghasilkan HPP yang salah, dan HPP dipakai untuk menentukan harga jual. Baris yang dilewati kini menyebut varian mananya — "3 dilewati" tanpa keterangan hanya membuat orang mengulang impor yang sama.

### 2. Form isiannya ada, tapi tidak terlihat seperti tombol

Editor resep sudah ada sejak awal. Tombolnya di kolom Aksi bertuliskan **"Produksi (CK)"**, **"Standalone"**, **"Dilayani CK"** — nama varian, tanpa kata kerja. Itu terbaca sebagai **label**, bukan sesuatu yang bisa ditekan. Karena itu satu-satunya jalan yang terlihat adalah tombol Import di kanan atas.

Tabelnya sekarang bisa **dibuka per baris**: ketuk produk → muncul daftar bahan tiap varian (nama, jumlah, satuan) beserta yield-nya, langsung dari resep yang sudah tersimpan — termasuk hasil impor, yang dulu tidak bisa diperiksa tanpa membuka editor satu per satu. Tombolnya kini berbunyi **"+ Isi resep"** atau **"✎ Ubah resep"**, dan editornya terbuka **di dalam baris itu**, bukan di dasar halaman yang mudah terlewat di HP.

### 3. Menyimpan resep bisa gagal tanpa suara

`recipes_modify` mensyaratkan **admin BU** — admin outlet tidak termasuk. Dan penolakan RLS pada UPDATE/DELETE bukan error: PostgREST membalas sukses dengan 0 baris. Jadi jalur "resep sudah ada lalu diubah" berakhir dengan notifikasi hijau tanpa satu pun perubahan tersimpan, sementara jalur "resep baru" (INSERT) gagal dengan pesan. **Perilaku berbeda untuk sebab yang sama** itulah yang membuatnya terasa "kadang bisa, kadang tidak".

Yang lebih berbahaya: penghapusan `recipe_items` lama juga bisa ditolak diam-diam. Kalau itu terjadi, bahan lama **bergabung** dengan bahan baru dan HPP-nya jadi hasil penjumlahan dua resep.

Sekarang ketiganya memeriksa hasilnya, dan tombol ubah/impor **tidak digambar sama sekali** untuk yang bukan admin BU — dengan kalimat yang menyebutkan siapa yang bisa. Aturannya dikunci `node tools/test-varian-resep.mjs` (24 kasus).

### "Bahan tidak ditemukan" untuk bahan yang jelas-jelas ada

Nama dicocokkan sebagai teks — dan sebelumnya hanya `trim().toLowerCase()`, yang berarti harus **persis sama**. Teks dari Excel penuh karakter yang tidak terlihat di layar:

- **Spasi ganda** di tengah nama. "Gula  Pasir" dan "Gula Pasir" terlihat identik di sel.
- **Spasi tanpa pemisah** (U+00A0), muncul begitu saja saat menyalin dari web atau WhatsApp. `trim()` membuangnya di tepi, tidak di tengah.
- **Karakter lebar nol** (U+200B, BOM). Benar-benar tidak terlihat, dan tidak dihitung sebagai spasi.
- **Huruf beraksen tersusun dua kode** (é = e + tanda) kalau filenya dari Mac.

Semuanya menghasilkan satu gejala yang sama dan paling membingungkan: bahan yang terlihat ada dinyatakan tidak ditemukan, dan orangnya mengetik ulang nama yang sebenarnya sudah benar. `js/core/nama.js` sekarang membakukan keduanya lebih dulu (`NFKC`, buang karakter lebar nol, rapatkan semua spasi).

Yang **tidak** dilakukan: membuang tanda baca atau menyamakan kata yang mirip. "Gula Pasir" dan "Gula Aren" harus tetap berbeda — menyatukannya menaruh bahan yang salah ke dalam resep, dan itu jauh lebih buruk daripada menolak dengan jelas. Kalau tetap tidak ketemu, pesannya kini **menyebut nama terdekat** ("mirip dengan …, samakan namanya") dan mengingatkan bahwa daftar bahan diambil dari **BU yang sedang aktif** — dua penyebab tersering, dan keduanya dulu tidak pernah disebut.

### Dua jebakan lain di jalur impor yang sama

- **`"0,5"` dibaca sebagai `5`.** Pembaca angkanya membuang semua selain digit dan titik, jadi koma desimal ala Indonesia hilang — sepuluh kali lipat, tanpa satu pun tanda. Tidak pernah muncul di `.xlsx` bertipe angka (SheetJS sudah mengembalikan angka); muncul di CSV dan di sel berformat teks. Sekarang: kalau ada titik **dan** koma, yang paling kanan dianggap desimal; kalau hanya koma, koma itu desimal. `"1.000"` sengaja **tetap** dibaca 1 — menebaknya sebagai ribuan akan mengubah arti file yang selama ini sudah benar, dan salah tebak di sini meleset 1000×.
- **Sel jumlah yang tidak terbaca jadi `0`.** Sekarang jadi "tidak terbaca", dan barisnya **dilaporkan** alih-alih dibuang diam-diam: resep yang kehilangan satu bahan tanpa pemberitahuan menghasilkan HPP yang lebih murah dari kenyataan, dan tidak ada yang curiga karena impornya "berhasil".

Ditambah satu kebiasaan spreadsheet yang tadinya mematahkan impor: **kolom Varian yang hanya diisi di baris pertama**. Baris berikutnya kini mewarisi varian di atasnya — tanpa itu, satu resep terbelah dua dan yang kedua isinya tidak lengkap.

Semuanya dikunci `node tools/test-cocok-nama-bahan.mjs` (37 kasus), yang mengimpor `js/core/nama.js` langsung. Modulnya dipisah ke `core/` justru supaya bisa diuji — `product-import.js` menarik klien Supabase, yang menarik CDN, sehingga tidak bisa dijalankan di luar browser.

### Impor produk: baris yang hilang tanpa jejak

Pertanyaannya — "apa impor produk gagal karena satuannya belum ada?" — jawabannya **tidak**. `products.base_unit` cuma kolom `text`, tanpa FK ke tabel `units`; satuan yang belum terdaftar tidak pernah menggagalkan apa pun. Tabel `units` hanya mengisi dropdown pada form manual.

Yang sebenarnya terjadi ada di satu baris:

```js
if (!name) continue;
```

Baris yang kolom **Nama**-nya kosong — akibat sel tergabung, judul antar-bagian, atau baris sisa di bawah tabel — dilewati **tanpa masuk hitungan mana pun**. Bukan ditambahkan, bukan dilewati, bukan error. Seolah tidak pernah ada. Itulah "tidak ada laporan produk mana saja yang gagal": laporannya memang tidak pernah menyebut mereka. Sekarang dihitung dan dilaporkan, dan pesan error lain menyebut **nomor barisnya** supaya bisa langsung dicari di file aslinya.

File resep punya lubang yang sama dan lebih sering kena, karena orang lumrah mengisi kolom Produk hanya di baris pertama tiap kelompok bahan. Baris "punya Bahan tapi Produk kosong" kini dilaporkan.

Satu lagi yang saya perbaiki sendiri: pemeriksaan duplikat masih memakai `name.toLowerCase()` sementara daftarnya sudah dibangun dengan `bakukanNama()` — sisa dari perubahan sebelumnya, dan bentuk kecil dari kesalahan yang sama persis (dua sisi perbandingan yang tidak dibakukan sama).

### Satuan baru didaftarkan otomatis

Diminta, dan berguna meski bukan penyebab kegagalannya: satuan yang dipakai file tapi belum ada di Master Satuan kini **ditambahkan otomatis**, sehingga muncul di dropdown saat produk itu disunting manual nanti.

Tapi `units_modify` hanya membuka untuk **super admin**. Jadi kalau yang mengimpor admin BU, penambahannya akan ditolak — dan itu **tidak boleh menggagalkan impor**, karena produknya memang tetap tersimpan dengan satuan itu. Hasilnya dilaporkan sebagai **catatan terpisah**, bukan di daftar merah: menaruhnya di antara error akan membuat impor yang sebenarnya mulus terlihat bermasalah.

### Filter nama di tabel Produk & Resep

Memakai `bakukanNama()` yang sama dengan impor. Kalau penyaringnya memakai pencocokan lain, orang yang mengetik "gula pasir" untuk mencari "Gula  Pasir" akan menyimpulkan produknya tidak ada — persis kesalahan yang membuat impor menolak bahan yang jelas ada.

Penyaringan dikerjakan di sisi tampilan, bukan dengan memuat ulang dari server: daftarnya sudah ada di memori, dan menunggu jaringan untuk tiap huruf membuat pencarian terasa berat justru saat dipakai menelusuri daftar panjang. Baris yang tersembunyi tetap ada di DOM, jadi tombol yang sudah tersambung tidak perlu dipasang ulang tiap ketikan. Keterangan di bawah kotaknya menyebut "**7 dari 132 produk**" — daftar yang menyusut tanpa keterangan mudah disalahartikan sebagai data yang hilang.

## Modul Menu disamakan sistematikanya dengan Resep

Pertanyaannya — "bagaimana cara saya isi menu?" — jawabannya ternyata: **menu tidak diisi di modul Menu.** Menu adalah produk bertipe `finished` di Master Produk. Modul Menu hanya *menampilkan* yang sudah ada, plus mengatur harga jual & resepnya. Tidak ada tombol tambah di sana, dan tidak pernah ada.

Itu sah sebagai desain, tapi tidak pernah dikatakan di layarnya. Sekarang dikatakan, lengkap dengan **Template Menu** — kolomnya sama persis dengan template produk, hanya kolom Tipe sudah terisi "Menu". Filenya diimpor lewat jalur yang **sama** (Master Produk → Import Excel); pengimpor kedua khusus menu akan berarti dua kode pembuat produk yang perlahan menyimpang, dan yang paling mungkin menyimpang justru pemeriksaan duplikat dan satuan — dua hal yang baru saja diperbaiki di satu tempat.

Selebihnya, layar Menu kini bekerja persis seperti tab Resep:

| | Sebelum | Sekarang |
|---|---|---|
| Melihat bahan | harus buka editor satu per satu | ketuk baris → tampil di tempat |
| Tombol resep | "Standalone" / "Dilayani CK" | "+ Isi resep" / "✎ Ubah resep" |
| Letak editor | dasar halaman | di dalam baris yang diketuk |
| Pencarian | pencocokan sendiri | `bakukanNama()` yang sama dengan impor |
| Izin | tombol selalu tampil | mengikuti `sayaAdminBu()` |

Tombol bernama varian tanpa kata kerja adalah akar dari "sepertinya tidak ada form isian" — sama persis seperti di tab Resep. Dan editor yang muncul di dasar halaman, jauh dari baris yang baru diketuk, di HP berarti keluar dari layar.

### Satu lagi yang gagal tanpa suara: harga jual

`products_modify` mensyaratkan **admin BU**, dan `updateSalePrice()` tidak memeriksa hasilnya. Admin outlet mengetik harga baru di tabel Menu, melihat *"Harga jual diperbarui"*, dan harganya tidak berubah sama sekali.

Ini yang paling mahal dari seluruh keluarga bug ini: **harga jual adalah angka yang dipakai kasir.** Salah di sini berarti salah tagih ke tamu — dan yang mengubahnya yakin sudah mengubahnya. `updateProduct()` dan `deleteProduct()` punya lubang yang sama dan ikut ditutup; `products` sekarang masuk daftar tabel yang dijaga `audit-tulis-senyap.cjs`.

### Hapus satu varian resep

Diminta untuk membereskan hasil impor yang keliru: sekarang ada **🗑 Hapus resep** di dalam baris yang terbuka, di tab Resep maupun di modul Menu. Yang dihapus **hanya varian yang disebut** — menghapus "Standalone" tidak menyentuh "Dilayani CK", karena keduanya menjawab cara produksi yang berbeda dan dipakai outlet yang berbeda. Produknya sendiri tetap ada; hanya resepnya yang hilang, jadi bisa diisi ulang atau diimpor ulang. `recipe_items` ikut terhapus lewat `on delete cascade`.

**Dialognya menyebut apa yang ikut terdampak, bukan cuma "yakin hapus?".** HPP dihitung berantai: menghapus resep Produksi sebuah setengah jadi membuat biayanya tidak diketahui, dan **semua menu yang memakainya ikut kehilangan HPP** — diam-diam, di layar lain, tanpa ada yang menghubungkannya dengan penghapusan tadi. Konfirmasi yang hanya bertanya "yakin?" tidak menambah apa pun yang belum diketahui orangnya; yang berguna adalah daftar namanya.

Penelusurannya (`js/modules/product/recipe-graph.js`) sengaja **melebar, bukan rekursif** — resep yang saling memakai akibat salah input akan membuat rekursi tidak berhenti, dan yang muncul ke user bukan peringatan melainkan halaman yang membeku.

Dikunci `node tools/test-dampak-hapus-resep.mjs` (14 kasus). Fixture siklus versi pertama ternyata **tidak menguji apa yang dikira diujinya**: siklusnya melewati produk yang sedang dihapus, jadi berhenti karena alasan lain. Yang benar-benar berbahaya adalah siklus di **hulu** — penelusuran masuk ke lingkaran tanpa pernah bertemu produk yang dihapus — dan itu yang sekarang jadi fixture-nya. Komentar di modulnya menyebut dengan jujur bahwa dari dua dedup di sana, hanya satu yang benar-benar menjaga; yang lain sekadar memangkas kunjungan berulang.

### Stok Opname di HP: kartu, bukan tabel

Opname dikerjakan sambil berdiri di depan rak, satu tangan memegang HP. Bentuk tabel memaksa kolom nama **dibekukan** supaya tidak hilang saat digulir — dan nama bahan panjang ("Susu UHT Full Cream 1L") memakan hampir seluruh lebar layar, sehingga kolom **Stok Fisik** terdorong ke luar layar. Orangnya harus menggulir mendatar untuk **setiap** baris, lalu menggulir balik untuk memastikan sedang mengisi bahan yang benar. Di rak yang sempit, itu jalan tercepat menuju salah isi.

Sekarang tiap bahan jadi **kartu**: nama di atas, kotak isian di bawahnya dengan lebar penuh. Gulir mendatar hilang sama sekali — tidak ada yang perlu dibekukan karena tidak ada yang bisa hilang. Ditambah beberapa hal kecil yang baru terasa saat dipakai berdiri:

- Nama panjang **dibungkus, bukan dipotong**. "Susu UHT Full Cream 1L" dan "…250ml" hanya berbeda di ujungnya; elipsis membuat keduanya terlihat sama persis.
- `font-size: 16px` pada kotak isian — di bawah itu, iOS memperbesar halaman saat kotaknya disentuh, dan pembesaran itu menggeser tata letak sehingga kartu berikutnya melompat.
- Penghitung "**12 dari 48** sudah diisi" diperbarui **di tempat**, bukan dengan menggambar ulang daftarnya: menggambar ulang membuat kotak yang sedang diketik kehilangan fokus, dan papan ketiknya ikut tertutup setiap angka.

### Kategori menu: diketik bebas, bukan daftar tetap

Penyaring kategori sebenarnya sudah tidak di-hardcode — ia dibangun dari kategori yang sudah dipakai. Yang tidak ada adalah **cara mengisinya**: kolom Kategori tidak pernah ada di template impor, dan di layar Menu tidak bisa diubah.

Sekarang keduanya ada. Di tabel Menu, kategori **diketik langsung di kolomnya** dengan saran dari yang sudah dipakai (`datalist`) — bukan dropdown tertutup, karena "Minuman", "Makanan", "Snack", "Frozen" adalah urusan yang punya usaha, bukan urusan kode. Daftar tetap berarti setiap kategori baru menunggu deploy, dan sementara menunggu, menunya ditaruh di kategori yang salah karena itu satu-satunya yang tersedia. Template impor produk & menu juga bertambah kolom **Kategori** dan **Sub Kategori**.

Detail kecil yang mudah terlewat: setelah kategori baru diketik, penyaring di atas **ikut diperbarui**. Kalau tidak, kategori yang baru saja dibuat tidak bisa dipakai menyaring sampai halamannya dibuka ulang. Dan kalau kategori yang sedang disaring habis dipakai, penyaringnya kembali ke "Semua" — daftar kosong tanpa sebab yang terlihat lebih membingungkan daripada daftar penuh.

### Impor ulang nama yang sudah ada: melengkapi, tidak menumpuk

Pertanyaannya: *"minyak goreng diimpor pertama dengan kolom lain kosong; impor kedua kolomnya sudah terisi — menumpuk atau mengedit?"*

Jawaban lamanya: **tidak keduanya.** Barisnya dilewati begitu saja, dan kolom yang kosong tetap kosong selamanya kecuali dibuka satu per satu di form. Impor kedua terasa "berhasil" padahal tidak mengubah apa pun — dan ringkasannya tidak menyebut itu.

(Catatan: untuk produk, baris yang **Tipe** atau **Satuan Pakai**-nya kosong sebenarnya ditolak sejak awal, jadi `minyakgoreng,,,` tidak pernah benar-benar masuk. Yang bisa setengah terisi adalah kolom selebihnya — harga beli, kategori, isi per satuan.)

Aturan barunya, dan tiap butir punya alasan yang berdiri sendiri:

1. **Kolom yang di sistem masih kosong → diisi dari file.** Ini yang sebenarnya diinginkan orang saat mengimpor ulang.
2. **Kolom yang sudah terisi dan berbeda → tidak diubah, tapi dilaporkan.** Menimpa diam-diam adalah cara termudah kehilangan harga beli yang sudah dikoreksi manual: seseorang membetulkannya di aplikasi, tiga hari kemudian file lama diimpor ulang, dan koreksinya lenyap tanpa jejak.
3. **Tipe dan Satuan Pakai tidak pernah diubah lewat impor.** Keduanya struktural — satuan pakai adalah satuan seluruh resep dan stok yang sudah tercatat, dan mengubahnya membuat semua angka lama berpindah arti tanpa satu pun yang ikut dikonversi.
4. **File yang kolomnya kosong tidak mengosongkan data lama.** Kebalikan dari (1), dan sama berbahayanya: mengimpor file ringkas yang cuma berisi nama tidak boleh menghapus harga yang sudah ada.

Hasilnya dilaporkan terpisah — "**5 dilengkapi**" berdiri sendiri dari "ditambahkan" dan "dilewati", karena justru itu yang ingin diketahui saat mengimpor ulang.

Dikunci `node tools/test-impor-ulang.mjs` (21 kasus). Satu perbandingan di sana (`samaAngka`) awalnya **tidak terbukti perlu** — kasusnya sudah tertangkap perbandingan teks. Baru setelah ditambah kasus `25000` vs `"25000.00"` — bentuk yang gemar dipakai Excel — ia benar-benar dijaga.

## Admin Portal melompat ke Staff App — tiga perbaikan sebelum yang benar

Bug ini dilaporkan **dua kali**, dan dua perbaikan pertama saya gagal. Layak ditulis lengkap, karena kegagalannya lebih berguna daripada perbaikannya.

**Perbaikan 1** — mengganti `history.back()` beruntun jadi satu `history.go(-n)`, dengan pagar "jangan mundur lebih jauh dari yang kita dorong". Tesnya hijau. Di HP, bug-nya tetap ada.

**Perbaikan 2** — pagar penghitung diganti kedalaman yang dibaca dari `history.state`, supaya tidak bisa melenceng saat `pushState` memotong entri di depan. Tesnya hijau. Bug-nya, ternyata, masih ada juga — dan saya baru tahu itu setelah memeriksa `git log` dan memastikan versi yang sedang dipakai memang sudah memuat perbaikan pertama.

**Yang sebenarnya salah bukan "berapa langkah", melainkan "kapan".**

`history.go()` tidak berpindah saat itu juga; ia menjadwalkan perpindahan. Sementara `pushState` di baris berikutnya jalan **sekarang**. Di `openModule()` Admin Portal urutannya persis begitu: `bersihkanLapis()` lalu `dorongLapis()`. Dan browser menghitung tujuan `go()` dari entri yang aktif **saat dipanggil** — jadi perpindahannya mendarat satu entri lebih dalam daripada yang dikira. Aplikasinya berakhir duduk di entri **akar** sambil menampilkan sebuah modul; ketukan Back berikutnya lalu meninggalkan halaman sama sekali, ke Staff App.

Pagar sebanyak apa pun tidak menutup itu. Yang menutupnya: **operasi history dijalankan berurutan** — mundur dulu sampai popstate-nya benar-benar tiba, baru mendorong. Dorongan yang tidak sedang menunggu apa pun tetap dikerjakan seketika; menundanya membuat entri belum ada saat orangnya menekan Back sepersekian detik kemudian, dan itu kegagalan yang persis sama parahnya (tesnya merah kalau semua dorongan diantrekan).

### Tiruan history-nya, lagi — dan ini yang paling perlu dicatat

Tes ini sudah ada sejak perbaikan Back yang pertama, dan **hijau di ketiga versi yang salah.** Dua kali saya harus memperbaiki tiruannya sebelum ia bisa melihat apa pun:

1. **`back()` dibuat asinkron** — sebelumnya memindahkan posisi seketika, sehingga urutan `back()` → `pushState` mustahil terjadi.
2. **Tujuan `go()` dikunci saat DIPANGGIL**, bukan saat antreannya diproses. Ini yang menentukan: dengan tujuan dihitung belakangan, `pushState` yang menyusul ikut menggeser sasarannya dan posisinya seolah stabil — persis yang membuat tes hijau padahal aplikasinya melompat ke Staff App di HP orangnya.

Sesudah dua koreksi itu, versi asli **dan** perbaikan pertama sama-sama membuat tes merah. Baru di titik itu saya punya alasan untuk percaya perbaikan ketiga benar.

Pelajarannya bukan "tesnya kurang banyak" — kasusnya sudah 54 dan semuanya lewat. Yang kurang adalah **kesetiaan tiruannya pada satu detail yang justru jadi sumber masalah**. Tiruan yang lebih rapi daripada kenyataan akan selalu menyembunyikan kelas bug yang paling sulit dilihat dengan membaca kode, dan akan melakukannya sambil tampak meyakinkan. 77 kasus sekarang, termasuk 12 kali berpindah menu berturut-turut dan enam putaran berselang sub-halaman + dialog.

## Kembali dari aplikasi lain: pulihkan tempatnya, bukan cuma modulnya

Aplikasi ini halaman web. Saat orangnya membuka Excel, WhatsApp, atau kamera, Android/iOS boleh **membuang halaman ini dari memori** kalau RAM sedang sempit; begitu kembali, halamannya dimuat ulang dari nol. Tidak ada yang bisa mencegahnya dari sisi kode — yang bisa diperbaiki adalah seberapa banyak yang hilang.

Yang diingat sebelumnya hanya **kode modul**. Orangnya kembali ke Daily Activities, tapi ke layar depannya: bukan ke sesi yang sedang dia isi, dan bukan ke posisi gulir daftar panjang yang sedang dia baca. Untuk sesuatu yang terjadi setiap kali orang menyalin angka dari Excel, itu terasa seperti aplikasi yang membatalkan pekerjaannya sendiri.

`js/core/ingatan-layar.js` sekarang mengingat **modul + sub-layar + posisi gulir**. Tiga keputusan di dalamnya yang layak disebut:

- **Ada batas usianya: 30 menit.** Ingatan yang tidak pernah kedaluwarsa lebih buruk daripada tidak ada ingatan — membuka aplikasi besok pagi lalu mendarat di layar sesi kemarin bukan "melanjutkan", itu membingungkan, dan orangnya harus mencari jalan keluar dulu sebelum bisa bekerja. Kembali dalam hitungan menit = melanjutkan; kembali besok = mulai baru.
- **Dibedakan dari membuka modul lewat ketukan.** Membuka modul dengan menekan kartunya harus selalu mulai dari atas; hanya pemuatan ULANG yang memulihkan posisi. Satu parameter `pulihkan`, bukan perilaku diam-diam.
- **Guliran dicatat saat berhenti dan saat halaman disembunyikan**, bukan tiap piksel. Menulis ke `sessionStorage` puluhan kali per detik membuat guliran tersendat di HP kelas bawah — yang justru dipakai kebanyakan orang di sini. `visibilitychange` dipakai karena `beforeunload` tidak dijalankan saat OS membunuh halaman di latar belakang.

Sub-layar dipulihkan lewat `layarAwal` yang diteruskan ke modulnya; modul yang tidak mengenalnya cukup mengabaikannya, jadi tidak ada modul yang perlu diubah supaya tetap jalan. Yang sudah memakainya: **Daily Activities** (layar sesi), dan hanya untuk **hari ini** — memulihkan layar sesi tanggal kemarin bukan melanjutkan apa pun.

Dikunci `node tools/test-ingatan-layar.mjs` (26 kasus, menguji modulnya langsung — termasuk saat `sessionStorage` diblokir mode privat, yang tidak boleh menjatuhkan aplikasi).

## "Resep belum lengkap" — label yang menunjuk ke tempat yang salah

Pertanyaannya masuk akal: *resep yang lengkap itu harus bagaimana, apakah harus ada stok bahannya?* Jawabannya **tidak** — stok tidak pernah ikut menentukan HPP. HPP adalah biaya per satuan, bukan ketersediaan barang; sebuah resep tetap punya HPP walaupun stok bahannya nol.

Yang sebenarnya dilaporkan badge itu adalah: **HPP-nya tidak bisa dihitung.** Sebabnya hampir tidak pernah ada di resep yang sedang dilihat — resepnya biasanya sudah lengkap. Sebabnya ada di **bahannya**, sering dua tingkat ke bawah:

- bahan baku yang **Harga Beli**-nya belum diisi;
- bahan baku yang **isi per satuan beli** (`purchase_qty`) masih 0, jadi harga per gram tidak bisa dibagi;
- **setengah jadi yang resep Produksi-nya belum dibuat** — HPP dihitung berantai, jadi satu yang kosong mengosongkan semua yang memakainya;
- hasil/yield 0.

Label lamanya menyuruh orang membongkar benda yang tidak rusak. Kalau resepnya diperiksa dan ternyata baik-baik saja, kesimpulan yang wajar adalah aplikasinya yang salah — dan setelah itu badge apa pun berhenti dipercaya.

Sekarang badge-nya berbunyi **"HPP belum bisa dihitung"**, dan panel rinciannya menyebut **nama bahan yang bermasalah beserta jalurnya** ("Gula: harga belinya belum diisi (dipakai Sirup Gula)"). Jalurnya penting karena Gula tidak muncul di layar menu itu sama sekali — tanpa jalur, orangnya tahu ada yang salah tapi tidak tahu harus membuka mana.

Mesin HPP-nya dipindah ke `js/modules/product/hpp.js`, **tanpa impor**, supaya bisa diuji di luar browser. Penjelasan sebabnya sengaja ditaruh bersebelahan dengan perhitungannya: kalau ditulis terpisah, ia akan menyimpang dari aturan sebenarnya, dan penjelasan yang salah lebih buruk daripada tidak ada penjelasan.

### Memindahkan resep antar varian

Tombol **⇄ Pindahkan ke Dilayani CK / Standalone** ada di panel rincian, baik di Master Produk → Resep maupun di modul Menu. Yang berubah hanya `recipes.mode`; `recipe_items` ikut karena tidak disentuh. Menyalin lalu menghapus akan membuka celah kehilangan data kalau langkah keduanya gagal.

Tiga hal yang dijaga:

- **Tidak menimpa.** `(product_id, mode)` unik sejak `0021_recipe_modes.sql`, jadi memindah ke varian yang sudah terisi akan ditolak database dengan pesan *duplicate key* yang tidak berarti apa-apa bagi penggunanya. Tombolnya tidak digambar kalau tujuan sudah punya resep, dan `pindahVarianResep()` tetap menerjemahkan error `23505` kalau ada dua tab terbuka bersamaan. Menimpa diam-diam berarti menghapus pekerjaan orang lain tanpa diminta.
- **`.eq('mode', dari)` membuatnya aman diulang.** Panggilan kedua tidak menemukan baris dan berhenti dengan pesan, bukan memindahkan resep tujuan ke tempat lain.
- **Setengah jadi tidak punya tombol ini** — ia cuma punya satu varian (Produksi), jadi tidak ada tujuan. Ditolak dengan kalimat itu, bukan dengan diam.

Aturannya di `js/modules/product/varian-pindah.js` (murni). Dikunci `node tools/test-hpp-sebab.mjs` (30 kasus). Lima sabotase dicoba dan **semuanya merah**: berhenti di sebab pertama, jalur "dipakai …" dihapus, pesan dua kolom yang berbeda disamakan, tabrakan varian dibiarkan lolos, dan menu diizinkan pindah ke Produksi.

## "Harga Beli" itu per satuan beli — dan kolom yang bisa dibaca dua arah

Rumusnya `HPP per satuan pakai = Harga Beli ÷ Isi per Satuan Beli`. Jadi **Harga Beli = harga SATU satuan beli**: harga sekarung, bukan harga segram.

| Kolom | Gula |
|---|---|
| Satuan pakai | gram |
| Satuan beli | karung |
| Isi per satuan beli | 25000 |
| Harga beli | 250.000 |

→ HPP = Rp 10/gram.

Form isiannya sudah menyebut "Harga beli / satuan beli", tapi **kolom di template impor cuma bertuliskan "Harga Beli"** — dan itu bisa dibaca dua arah. Kalau terbaca salah, tidak ada yang menolak dan tidak ada yang merah: impornya sukses, tabelnya rapi, HPP-nya Rp 0,0004/gram, semua menu terlihat untung hampir 100%, dan harga jual ditetapkan di atas angka itu. Salah yang tidak menimbulkan gejala adalah yang paling mahal, karena ia baru ketahuan setelah keputusan diambil di atasnya.

Tiga perubahan:

- **Judul kolomnya jadi "Harga Beli (per Satuan Beli)"**, dan pembacanya menerima **kedua ejaan**. File lama yang sudah beredar di WhatsApp tetap jalan — memaksa orang mengunduh template baru untuk mengimpor data yang sudah benar bukan perbaikan.
- **Peringatan setelah impor**, terpisah dari daftar merah dan diberi warna sendiri. Datanya tetap tersimpan: ini dugaan, bukan aturan. Tidak ada rumus yang bisa memastikan angka mana yang dimaksud orangnya, dan impor yang menolak data yang sebenarnya benar akan lebih cepat membuat orang berhenti memakainya daripada salah hitung yang sesekali lolos.
- **Badge ⚠ "cek satuan" di tabel Produk**, karena peringatan yang cuma muncul sekali saat impor tidak menolong siapa pun yang datanya sudah telanjur salah — dan justru itu yang sudah ada di database sekarang.

Dua pola yang ditandai (`js/modules/product/harga-curiga.js`, murni):

1. **HPP hasilnya di bawah Rp 1 per satuan pakai.** Ambangnya Rp 1 bukan karena mustahil, tapi karena setara Rp 1.000/kg — di bawah harga air kemasan. Tidak ada bahan dapur di situ.
2. **Satuan beli berbeda dari satuan pakai tapi isinya cuma 1.** "1 karung = 1 gram" tidak berarti apa-apa; ini arah salah yang berlawanan dan tidak tertangkap aturan pertama karena hasil baginya justru besar.

Dikunci `node tools/test-harga-curiga.mjs` (26 kasus). Yang paling ditekankan di tesnya bukan "yang salah ketangkap", tapi **"yang benar tidak ikut ditandai"** — peringatan yang muncul di data normal akan diabaikan dalam seminggu, dan setelah itu ia tidak menjaga apa pun. Karena itu ada kasus "Pcs" vs "pcs " yang harus tetap diam.

Satu catatan jujur soal tesnya: fixture setengah-jadi/menu versi pertama memakai angka yang **kebetulan wajar**, jadi saringan tipe produknya hijau tanpa pernah diuji. Ketahuan saat sabotase kelima tetap lolos. Fixture-nya diganti dengan angka yang pasti memicu kedua aturan, dan sekarang kelima sabotase merah.

## Resep yang "ada tapi tidak berisi bahan" — dari mana asalnya

Pertanyaannya wajar, karena keadaan itu memang tidak bisa dibuat lewat layar mana pun: editor resep menolak menyimpan tanpa bahan ("Tambahkan minimal satu bahan"), dan pengimpor menolak kelompok tanpa bahan ("tidak ada bahan"). Jadi resep kosong itu muncul entah dari mana.

Asalnya dari `saveRecipe()`, yang mengerjakan **tiga perintah HTTP terpisah**:

1. insert/update baris `recipes`
2. delete **semua** `recipe_items` milik resep itu
3. insert bahan yang baru

Kalau langkah 3 tidak sampai — sinyal putus, halaman ditutup, aplikasi dibunuh OS karena RAM sempit — langkah 1 dan 2 **sudah terjadi** dan tidak dibatalkan siapa pun.

Yang paling berbahaya bukan resep baru, tapi **mengubah resep yang sudah benar**: bahan lamanya sudah dihapus di langkah 2. Resep yang tadinya lengkap jadi kosong, HPP-nya hilang, dan semua menu yang memakainya ikut kehilangan HPP — tanpa satu pun pesan, karena pesannya ikut hilang bersama halaman yang tertutup.

`0082_simpan_resep_utuh.sql` menjadikannya **satu transaksi**. Di dalam fungsi plpgsql semua perintah hidup-mati bersama: kalau ada yang gagal, penghapusan bahan lama ikut dibatalkan dan resepnya tetap seperti semula. Tiga hal yang disengaja di sana:

- **SECURITY INVOKER dipertahankan.** RLS tetap berlaku atas nama pemanggilnya, jadi fungsi ini tidak memberi wewenang baru kepada siapa pun. `SECURITY DEFINER` akan membuat siapa saja yang bisa memanggilnya menulis resep sebagai pemilik fungsi — kebocoran yang tidak sepadan untuk memperbaiki masalah keutuhan data.
- **Jumlah baris dicocokkan, bukan sekadar "ada yang masuk".** RLS bisa meloloskan sebagian baris dan menolak sisanya; resep yang kehilangan satu bahan menghasilkan HPP lebih murah dari kenyataan, dan tidak ada yang curiga karena penyimpanannya dilaporkan berhasil.
- **Resep kosong yang sudah telanjur ada ikut dihapus** di migration yang sama, supaya tampilannya kembali ke "Belum" — keadaan yang sebenarnya — dan tombol "+ Isi resep" muncul lagi.

Sisi aplikasi punya **jalur mundur yang sempit**: kalau `simpan_resep_utuh` belum ada (kode PostgREST `PGRST202`), ia memakai cara lama supaya pemasangan yang migration-nya tertinggal tidak kehilangan fitur menyimpan resep. Hanya untuk sebab itu — menangkap semua error di sana akan membuat penolakan RLS diam-diam dicoba ulang lewat jalur yang justru bisa meninggalkan resep kosong.

Pesannya juga diperbaiki: **"resepnya ada tapi KOSONG — bahannya tidak pernah tersimpan (penyimpanan terputus di tengah)"**. Yang lama, "belum berisi bahan", terbaca seperti pekerjaan yang belum dimulai, padahal justru sebaliknya.

## Bahan bermasalah disorot di barisnya sendiri

Daftar sebab di bawah tabel sudah menyebut nama, tapi masih menyuruh orangnya mencocokkan sendiri — pada resep berisi 15 bahan itu pekerjaan yang tidak perlu ada, dan yang biasanya terjadi adalah daftarnya tidak dibaca. Sekarang **baris bahannya sendiri** yang berwarna, dengan sebabnya di bawah namanya ("⚠ Gula: harga belinya belum diisi"). `sebabBahan()` di `hpp.js` menjawab pertanyaan yang lebih sempit dari `sebabHppKosong()`: bukan "kenapa resep ini tidak punya HPP", tapi "kenapa baris ini yang bermasalah".

## Filter tipe & kategori, dan unduhan buku resep

Tab **Produk** dan tab **Resep** kini punya tiga saringan yang bekerja bersama: nama, tipe, kategori. Aturannya di `js/modules/product/saringan.js` (murni), dengan dua hal yang dikunci tes:

- **Digabung dengan DAN, bukan ATAU.** Penyaring yang justru melebarkan hasil saat dipersempit membuat orang berhenti memakainya.
- **Produk tanpa kategori punya kelompok sendiri**, "(tanpa kategori)", ditaruh di akhir daftar. Kalau ia ikut muncul di kategori mana pun, orangnya menyangka kategorinya sudah terisi dan tidak pernah membetulkannya.

Tab Resep juga punya **⬇ Excel** dan **⬇ PDF** untuk seluruh resep sekaligus. Satu penyusun (`buku-resep.js`) untuk dua keluaran — alasannya sama dengan dokumen kiriman: resep yang takarannya berbeda antara file Excel dan lembar yang ditempel di dapur tidak bisa dipakai memeriksa apa pun. Bentuknya **datar**, satu baris per bahan, dengan kolom Produk & Varian **diulang di tiap baris**. Terlihat mubazir, tapi itu yang membuat Filter dan pivot di Excel bekerja — dan menyaring adalah alasan utama file ini diunduh. Resep kosong tetap muncul dengan keterangannya: kalau dilewati, file unduhan terlihat lengkap sementara aplikasinya memperingatkan, dan orang lebih percaya file yang dipegangnya.

## Kembali dari aplikasi lain: tab-nya juga, bukan cuma modulnya

Perbaikan sebelumnya berhenti di **kode menu**. Untuk Staff App itu cukup, tapi Admin Portal punya **dua lapis tab**: "Inventory" adalah grup berisi Master Produk / Menu / Produksi, dan Master Produk sendiri punya tab Produk / Resep / Satuan. Jadi kembali dari aplikasi lain selalu mendarat di tab pertama — Stok & Riwayat — padahal orangnya baru saja mengisi resep. Tab pertama cukup mirip halaman yang benar untuk membuat orang ragu sesaat apakah pekerjaannya tersimpan.

Tempatnya sekarang disimpan sebagai **jalur**: `master_product/recipes`. Tiap lapis mengambil potongan pertama untuk dirinya dan meneruskan sisanya ke bawah (`js/core/jalur-layar.js`, murni), jadi menambah lapis ketiga nanti tidak menyentuh lapis yang sudah ada. Tiga hal yang dijaga:

- **Tab yang dipulihkan diperiksa masih ada.** Daftar tab bergantung modul yang aktif untuk BU dan hak akses orangnya — keduanya bisa berubah setelah tempat itu disimpan. Tanpa pemeriksaan ini, kembali dari aplikasi lain mendarat di halaman kosong yang tidak punya tombol keluar.
- **Grup dengan satu tab tidak memakan potongan.** Tanpa tab bar ia tidak mewakili pilihan apa pun, dan memakannya membuat modul di dalamnya menerima sisa yang salah.
- **Ketukan tetap mulai dari atas.** Hanya pemulihan yang membawa sub-layar; menekan tab dengan sengaja harus selalu memulai bersih.

Dikunci `node tools/test-saringan-jalur.mjs` (47 kasus, mencakup saringan + jalur + buku resep). Enam sabotase dicoba, semuanya merah — termasuk "gabung meninggalkan potongan kosong", yang menghasilkan `master_product/` dan membuat tab yang dipulihkan meleset diam-diam.

## Panel bahan tidak muncul — dua nama yang tidak pernah diimpor

Gejalanya: mengetuk baris produk di tab Resep tidak menampilkan apa-apa. Sebabnya `sebabBahan()` dipakai di `product.admin.page.js` tanpa pernah diimpor. Berkasnya tetap **sah** sebagai ES module, jadi `audit-syntax` hijau; kesalahannya baru muncul saat baris itu dijalankan — yaitu tepat ketika seseorang mengetuk baris produk. Tidak ada pesan di layar, panelnya hanya diam.

Ini kelas kesalahan yang paling mudah lolos di proyek tanpa build step: tidak ada penyusun yang memeriksa, dan tes modul murni tidak menyentuh berkas layar sama sekali. `tools/audit-nama-tak-dikenal.cjs` sekarang menutupnya — dan pada jalan pertamanya ia menemukan **kesalahan kedua yang belum dilaporkan siapa pun**: `listOutletsSayaKelola()` dipanggil di `cleaning.admin.page.js` tanpa impor, yang berarti halaman admin Daily Activities gagal dimuat sejak perbaikan scope beberapa waktu lalu.

Audit ini butuh dua kali perbaikan sebelum layak dipakai:

- Versi regex-nya menghasilkan **16 temuan palsu** — kata-kata Indonesia dari komentar dan template literal bersarang ("dihitung(", "Catatan(", "tengah(") bocor sebagai panggilan fungsi. Diganti **pemindai karakter** yang melacak `${…}` bersarang dan literal regex. Audit yang sering salah akan dimatikan orang, dan setelah itu tidak menjaga apa pun.
- Nomor barisnya berbohong: ia mencari nama itu lagi di sumber ASLI dan menunjuk kemunculan pertama di mana pun — termasuk di dalam komentar, yaitu tempat yang justru sedang dibuang. Sekarang dipakai indeks kecocokan yang sebenarnya (panjang teks bersihnya sengaja sama dengan aslinya).

Dibuktikan dengan mengembalikan kedua bug aslinya: keduanya merah.

## Bahan resep bisa dilihat di Staff App juga

Staff App belum pernah punya layar resep sama sekali. Sekarang ada tombol **📖 Resep** di modul Inventory: daftar setengah jadi & menu, ketuk untuk melihat bahannya. **Tanpa rupiah** — yang dibutuhkan orang yang membukanya sambil berdiri di dapur cuma bahan dan takarannya. Bentuknya **kartu, bukan tabel**: tabel dengan gulir mendatar di HP berarti takarannya ada di kolom yang harus digeser dulu, dan takaran adalah satu-satunya alasan layar itu dibuka.

Perlu dicatat jujur: menyembunyikan rupiah di sana **bukan pengaman**. `products_select` membuka harga beli untuk semua anggota BU, jadi staff tetap bisa melihat HPP lewat layar lain. Yang diatur adalah apa yang ikut terbaca di layar yang dipegang sambil bekerja.

Aturannya — bahan mana, ditandai apa, dihitung berapa — datang dari **satu** modul murni, `panel-bahan.js`, dipakai kedua sisi. Tampilannya memang beda (Admin punya kolom HPP/satuan, Biaya, total bahan, dan HPP per satuan di kaki tabel); yang tidak boleh beda adalah isinya. Dua layar yang menampilkan resep yang sama dengan isi berbeda lebih merusak daripada salah satunya salah: setelah orang menemukan bedanya, keduanya berhenti dipercaya dan resepnya dicek ulang manual — pekerjaan yang justru mau dihilangkan aplikasi ini.

Tesnya (`tools/test-panel-bahan.mjs`, 33 kasus) menemukan satu bug nyata saat pertama dijalankan: **bahan yang produknya sudah dihapus tidak menandai biaya sebagai "tidak diketahui"**, sehingga resep berisi satu bahan hantu menghasilkan total **Rp 0** yang terlihat sah — dan nol adalah angka yang paling mudah dipercaya karena tidak terlihat seperti kesalahan.

Satu lagi yang layak dicatat: dari lima sabotase, satu **lolos**. Fixture "Staff App" saya tidak pernah mengirim `hppBahan`, jadi hasilnya null karena fungsinya memang tidak ada — bukan karena penjaga `denganNilai` bekerja. Fixture-nya diperbaiki supaya sengaja mengirimkannya; sekarang satu-satunya yang bisa membuat baris itu lolos adalah penjaganya sendiri.

## Template impor dicocokkan mesin, bukan mata

Kalau template dan pengurai menyimpang, **tidak ada yang error**: kolom yang tidak dikenali cuma diabaikan, barisnya masuk dengan kolom itu kosong, dan impornya dilaporkan berhasil. Yang terjadi berikutnya adalah orang mengisi seratus baris harga di kolom yang tidak pernah dibaca siapa pun, lalu menemukan HPP-nya tetap kosong dan menyangka perhitungannya yang rusak.

Menyimpangnya mudah sekali — memperjelas judul "Harga Beli" jadi "Harga Beli (per Satuan Beli)" adalah satu baris teks yang terlihat tidak berbahaya, dan tidak ada satu pun tes yang membaca berkas CSV itu. Persis itu yang terjadi: templatenya berubah, keterangan kolom di dialog impor tidak.

`tools/audit-template-impor.cjs` memeriksa tiga hal:

1. tiap kolom yang **dibaca** pengurai ada di template;
2. tiap kolom **di template** dibaca pengurai — kolom hiasan yang tidak berpengaruh apa-apa lebih buruk daripada tidak ada kolomnya;
3. tiap baris contoh punya jumlah kolom yang sama dengan judulnya. Satu koma lebih/kurang menggeser **semua** nilai sesudahnya, dan hasilnya terlihat seperti salah ketik data, bukan template yang rusak.

Ditambah dua pemeriksaan silang: kolom harga beli harus tetap menerima **kedua ejaan** (berkas lama yang sudah beredar di WhatsApp tidak boleh diam-diam kehilangan harganya), dan keterangan kolom di dialog impor harus menyebut judul yang sama dengan template — kalau berbeda, orang membuat sendiri berkasnya menurut keterangan itu.

Empat sabotase dicoba, semuanya merah. Audit ini sendiri sempat menghasilkan **dua temuan palsu** di jalan pertama karena `alias` hanya dipakai di satu arah pemeriksaan; diperbaiki sebelum dipakai, karena audit yang cerewet akan berhenti dibaca orang.

Satu hal yang **sudah** benar dan sempat saya curigai: berkas CSV yang diunduh diawali BOM (`﻿`) supaya Excel membaca huruf beraksen dengan benar, sementara `lc()` yang menormalkan judul kolom hanya `trim().toLowerCase()` — tidak membuang BOM. Kalau SheetJS meneruskan BOM itu ke judul kolom pertama, `r['nama']` akan selalu kosong dan **seluruh baris** dilewati dengan pesan "kolom Nama kosong". Diuji langsung dengan SheetJS 0.18.5: BOM-nya dibuang saat parsing, jadi tidak ada masalah.

## Impor mode "timpa" — dan kenapa ia tidak jadi perilaku bawaan

Impor bawaannya hanya **melengkapi** kolom yang masih kosong; nilai yang sudah terisi tidak pernah diganti. Itu tetap benar untuk pemakaian sehari-hari: impor sering dijalankan dari berkas lama yang beredar di WhatsApp, dan menimpa diam-diam berarti harga yang baru dikoreksi seseorang bisa mundur ke angka bulan lalu tanpa jejak.

Tapi untuk update massal — harga beli bulanan, misalnya — melengkapi saja tidak cukup. Sekarang ada kotak centang **"Ganti juga nilai yang sudah terisi"** di dialog impor produk, dengan tiga pengaman:

- **Dihitung dulu, tidak langsung disimpan.** Mode timpa menjalankan impor dalam `hanyaRencana`, menampilkan daftar `"Harga Beli: 25000 -> 30000"` per produk, dan baru menyimpan kalau disetujui. Nilai **lama ikut ditulis** — daftar yang cuma berbunyi "Harga Beli diubah" tidak bisa diperiksa siapa pun sebelum menekan Simpan, dan pratinjau yang tidak bisa diperiksa hanya menambah satu ketukan.
- **Pratinjaunya lewat jalur yang sama** dengan penyimpanan sungguhan, bukan kode tersendiri. Pratinjau yang disusun kode lain akan menyimpang dari yang benar-benar terjadi — dan pratinjau yang berbohong lebih berbahaya daripada tidak ada, karena orang menekan Simpan justru karena sudah memeriksanya. `hanyaRencana` juga tidak mendaftarkan satuan baru: membatalkan harus benar-benar tidak meninggalkan sisa.
- **Tipe & Satuan Pakai tetap tertutup**, walau kotaknya dicentang. Satuan pakai adalah satuan seluruh resep dan stok yang sudah tercatat; menggantinya membuat semua angka lama berpindah arti tanpa satu pun ikut dikonversi. Tidak ada kotak centang yang pantas membuka pintu itu.

`tools/test-impor-ulang.mjs` naik jadi 39 kasus. Empat sabotase merah, termasuk "timpa jadi perilaku bawaan" dan "struktural ikut ditimpa".

## Tiga bug di jalur pengisian resep

Ketiganya menghasilkan HPP yang **salah tapi terlihat wajar** — jauh lebih mahal daripada gagal simpan, karena angkanya dipakai menetapkan harga jual dan tidak ada yang curiga.

1. **Bahan yang dipilih tapi jumlahnya kosong dibuang diam-diam.** Editor menyaringnya dengan `.filter(i => i.qty > 0)`. Orang memilih lima bahan, lupa mengisi satu jumlah, menekan Simpan, dan mendapat "Resep disimpan." Resepnya berisi empat. Tidak ada layar mana pun yang bisa memberi tahu ada bahan hilang — dari sisi database resep itu memang tidak pernah punya bahan kelima. Sekarang dilaporkan dengan menyebut nama bahannya.

2. **Bahan yang sama dua kali tersimpan dua baris.** `recipe_items` tidak punya unique index, jadi biayanya dijumlahkan dan HPP-nya terlalu mahal. Sekarang **digabung**, bukan ditolak — mengetik bahan yang sama dua kali di spreadsheet panjang itu lumrah, dan yang dimaksudkan hampir selalu total keduanya. Penggabungannya diberitahukan, tidak diam-diam.

3. **Produk bisa jadi bahan bagi dirinya sendiri lewat impor.** Editor sudah mencegahnya (pilihan dirinya sendiri tidak ditawarkan di dropdown), tapi pengimpor tidak — dan di sana itu satu baris yang mudah salah ketik. Akibatnya siklus: HPP-nya `null` selamanya, dengan pesan "belum bisa dihitung" yang menunjuk ke bahan yang kelihatan baik-baik saja.

4. **Menu bisa jadi bahan lewat impor.** Editor tidak menawarkannya — dropdown bahannya hanya bahan baku & setengah jadi — tapi pengimpor cuma mencocokkan nama. Jadi "menu di dalam menu" bisa masuk lewat impor, dan resepnya kemudian **tidak bisa dibuka di editor**: dua layar yang menjawab hal yang sama, satu di antaranya menolak isinya sendiri. Pesannya menyebut jalan keluarnya, bukan cuma larangan — kalau barang itu memang dipakai membuat barang lain, yang salah tipenya, bukan resepnya.

Keempatnya dijaga satu modul murni, `periksa-resep.js`, dipakai **editor dan pengimpor**. Dikunci `node tools/test-periksa-resep.mjs` (38 kasus); enam sabotase merah, termasuk mengembalikan bug pertama persis seperti aslinya dan versi yang terlalu ketat (setengah jadi ikut ditolak).

### Aturan susunan produk, ringkas

| Tipe | Punya resep? | Boleh jadi bahan? | HPP dari |
|---|---|---|---|
| **Bahan Baku** | tidak | ya | Harga Beli ÷ Isi per Satuan Beli |
| **Setengah Jadi** | ya — varian *Produksi* | ya | resep Produksi-nya |
| **Menu** | ya — *Standalone* &/atau *Dilayani CK* | **tidak** | resep varian yang dipilih |

Bahan sebuah resep boleh **bahan baku maupun setengah jadi**, di kedua varian menu — nama varian menggambarkan cara produksinya (dirakit di outlet vs memakai kiriman CK), bukan batasan tipe bahan. Setengah jadi boleh berisi setengah jadi lain, tanpa batas kedalaman; siklus dijaga `buildCostFn` dan sekarang juga ditolak di muka oleh `periksaBahan`.

Yang **diperiksa dan ternyata sudah benar**, supaya tidak dicari lagi nanti: semua penulisan di ketiga modul sudah memeriksa barisnya benar-benar kena (`audit-tulis-senyap`, 41 titik); tidak ada error yang ditelan `catch` kosong; semua input jumlah memakai `<input type="number">` sehingga `Number()` di sana aman dari jebakan koma desimal; dan `record_menu_waste` sudah memilih varian resep yang benar dengan mundur ke Standalone kalau varian CK tidak ada.

## Harga Beli hanya untuk Bahan Baku — dan dua jalur impor yang menyimpang

Setengah jadi **tidak perlu** diisi Harga Beli. HPP-nya dihitung dari resep Produksi-nya (`Σ bahan ÷ yield`), bukan dari kolom itu — mengisinya tidak akan membuat HPP-nya muncul, dan tidak akan menggantikan resep yang belum dibuat.

Pertanyaannya menyingkap ketidakkonsistenan: **kedua jalur impor memperlakukannya berbeda.**

- Jalur **buat baru** membuang `purchase_*` untuk produk non-bahan-baku (`type === 'raw' ? … : null`).
- Jalur **lengkapi produk yang sudah ada** menulisnya apa adanya.

Jadi mengisi Harga Beli untuk sebuah setengah jadi **diabaikan kalau produknya baru, tapi tersimpan kalau produknya sudah ada**.

Nilai itu tidak salah hari ini — tidak dipakai menghitung apa pun, dan tidak ditampilkan di tabel mana pun. Yang membuatnya berbahaya adalah nanti: begitu tipe produknya diubah jadi "Bahan Baku", harga basi itu **langsung hidup dan ikut menghitung HPP**, tanpa seorang pun pernah mengetiknya untuk produk itu.

`saringMenurutTipe()` sekarang jadi satu-satunya tempat aturannya tinggal, dipakai **kedua** jalur:

- `purchase_unit` / `purchase_qty` / `purchase_price` → hanya `raw`
- `sale_price` → hanya `finished`

Satu keputusan yang perlu disebut: tipe yang dipakai memutuskan adalah **tipe di sistem**, bukan yang di file. Impor tidak pernah mengubah tipe (lihat STRUKTURAL), jadi memakai tipe dari file akan membuka celah yang sama lewat pintu lain — cukup menulis "Bahan Baku" di file untuk menitipkan harga beli ke sebuah setengah jadi.

`tools/test-impor-ulang.mjs` naik jadi 62 kasus. Lima sabotase merah, termasuk "harga beli boleh menempel di setengah jadi". Keterangan di dialog impor dan contoh di template ikut diperjelas.

### Membuangnya benar, membuangnya diam-diam tidak

Sesudah aturannya disatukan, mengisi Harga Beli untuk sebuah setengah jadi berarti nilainya **dibuang tanpa pesan apa pun**. Itu perbaikan setengah jalan: orang mengetik harga beli untuk lima puluh setengah jadi, impornya dilaporkan berhasil, kolomnya tetap kosong, dan tidak ada satu kalimat pun yang menjelaskan kenapa. Yang disimpulkan berikutnya hampir selalu "impornya tidak jalan" — lalu diulang, dengan hasil yang sama persis.

Hasil impor sekarang memuat catatan **"Harga Beli diabaikan di 50 baris — kolom itu hanya berlaku untuk tipe tertentu"**, diringkas per kolom (bukan per baris: laporan lima puluh baris tidak akan dibaca, sedangkan satu baris dengan angkanya langsung memberi tahu bahwa ini pola, bukan salah ketik sekali).

Ini **bukan** error dan tidak diberi warna merah: filenya tidak salah, isinya cuma tidak berlaku di tipe itu. Kolom yang **kosong** juga tidak ikut dilaporkan — kalau ikut, setiap impor menu biasa akan memunculkan catatan tentang kolom yang memang sengaja dikosongkan, dan catatan yang selalu muncul berhenti dibaca.

## Resep kosong yang tidak bisa diperbaiki lewat impor

Gejala yang dilaporkan: *"produknya sudah ada, tapi tetap belum bisa masuk ke resep, sebagian besar seperti ini."* Layarnya menampilkan "Resep ini kosong — bahannya tidak pernah tersimpan", bahannya ada di Master Produk, dan impor ulang tidak memperbaikinya.

Penyebab pertama sudah diketahui: `saveRecipe` lama mengerjakan tiga perintah HTTP terpisah, dan kalau yang ketiga tidak sampai, baris resepnya tertinggal tanpa bahan (`0082` menjadikannya satu transaksi + membersihkan sisanya).

Yang belum ketahuan adalah **kenapa keadaannya tidak bisa keluar sendiri.** Pengimpor mengukur "resep sudah ada" dari **adanya baris**, bukan dari isinya:

```js
const hasRecipe = new Set(recipesFull.map((r) => `${r.product_id}|${r.mode}`));
…
if (hasRecipe.has(`${p.id}|${mode}`)) { skipped++; errors.push('dilewati — resep varian ini sudah ada'); continue; }
```

Jadi resep kosong dihitung sebagai "sudah ada". Tiap impor ulang menjawab *"dilewati, resep sudah ada, ubah lewat tombol Ubah di tabel"*, sementara layarnya tetap bilang resepnya kosong. Dua pesan yang saling bertentangan, dan yang tersisa buat penggunanya cuma membuka serta mengisi ratusan resep satu per satu — justru pekerjaan yang mau dihindari dengan mengimpor.

`petaResep()` sekarang memisahkan **berisi** dari **kosong**, dan pengimpor hanya melewati yang berisi. Resep kosong diisi, lalu dilaporkan (*"resep yang tadinya kosong sekarang terisi"*) supaya perbedaannya dengan "ditambahkan baru" tetap terlihat.

Tiga hal kecil yang ikut dikunci tes: `items` yang tidak ada sama sekali diperlakukan sama dengan array kosong (dua bentuk yang sama artinya — membedakannya akan menyisakan sebagian resep tetap tidak bisa diperbaiki); pemisahannya **per varian**, bukan per produk (satu menu bisa punya Standalone berisi dan Dilayani CK kosong); dan baris resepnya **tidak dihapus dulu** sebelum diisi, karena menghapus lebih dulu membuka lagi celah setengah jadi yang sama.

Dikunci `tools/test-impor-ulang.mjs` (69 kasus), tiga sabotase merah termasuk mengembalikan bug aslinya persis.

## "Resep kosong" yang sebenarnya tidak kosong — potongan 1.000 baris

Ini penyebab sesungguhnya dari laporan *"produknya sudah ada, tapi tetap belum bisa masuk ke resep, sebagian besar seperti ini"*. Dua perbaikan sebelumnya (0082 dan impor yang tidak lagi melewati resep kosong) benar, tapi keduanya menangani **akibat**.

Petunjuk yang membongkarnya ada di tangkapan layar pengguna sendiri: panelnya menulis "Resep ini kosong", sementara **editor resep yang sama menampilkan bahannya lengkap** — Ayam Utuh 1200 gr, Bawang Merah 200 gr. Satu database, dua layar, isi berbeda.

Bedanya ada di cara bertanya:

| | Query | Hasil |
|---|---|---|
| Editor | `recipe_items` **satu resep** | selalu jauh di bawah batas → utuh |
| Panel & tabel | `recipe_items` **seluruh BU sekaligus** | dipotong di ~1.000 baris |

PostgREST membatasi jawaban pada sekitar 1.000 baris kalau tidak diminta lain, dan **potongan itu bukan error** — jawabannya sukses, cuma kurang. Dengan 785 produk, bahan resep satu BU melewati seribu baris dengan mudah; resep yang kebetulan berada di belakang antrean pulang tanpa bahan.

Yang membuatnya sulit sekali ditemukan: aplikasinya berjalan lama tanpa gejala apa pun, lalu mulai kehilangan data begitu tabelnya tumbuh. Tidak ada perubahan kode yang bisa disalahkan, tidak ada error yang bisa dicari, dan gejalanya ("resepnya kosong") menunjuk ke tempat yang salah — sampai membuat saya menulis pesan yang dengan yakin menuduh penyimpanan terputus.

`js/core/ambil-semua.js` mengambil bertahap sampai habis. Tiga keputusan di dalamnya:

- **Maju sebanyak yang DITERIMA, bukan yang diminta.** Server boleh punya batas sendiri yang lebih kecil dari ukuran halaman kita.
- **Berhenti hanya saat halaman kosong** — kecuali server menyebutkan jumlah totalnya. Berhenti pada "halaman lebih kecil dari yang diminta" adalah bug yang sama persis dengan angka berbeda; **tes yang menemukannya**, bukan saya. Pemanggil menyertakan `{ count: 'exact' }` supaya tidak perlu permintaan penutup.
- **Ada batas putaran.** Server yang mengabaikan penomoran halaman akan membuat aplikasinya menggantung selamanya — kegagalan yang lebih buruk daripada data yang kurang.

Daftar id untuk `.in(...)` juga dipecah: seribu UUID di query string menghasilkan URL puluhan kilobyte yang ditolak sebagian perantara jaringan dengan galat yang tidak menyebut sebabnya.

Yang sudah diperbaiki: `listProducts` (785 produk — tinggal sedikit lagi menyentuh batas), `listRecipesFull` (dua query), `listStockBalances` (satu baris per outlet × produk — yang terpotong tampil sebagai **stok 0**), dan `listIncomingDispatches` (kiriman yang belum dikonfirmasi; kalau terpotong, barang yang sudah berangkat tidak pernah muncul untuk diterima).

`tools/audit-ambil-terpotong.cjs` menjaga 26 pembacaan tabel yang bisa tumbuh. Tujuh **dikecualikan dengan alasan tertulis** (`baris-terbatas: …`) — bahan satu resep, item satu kiriman, reservasi satu tanggal; memaksanya bertahap cuma menambah permintaan tanpa menambah keamanan. Pengecualian tanpa alasan tidak diterima: setahun lagi tidak ada yang bisa membedakannya dari kelalaian.

Dikunci `tools/test-ambil-semua.mjs` (26 kasus, server tiruannya **memotong seperti aslinya** — tes dengan server yang jujur tidak akan pernah menangkap bug ini). Lima sabotase merah.

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
- [x] **Mode Reservasi Hotel** — booking kamar (rentang tanggal + tipe kamar), kuota per tipe dijaga trigger database, check-in/check-out, tanpa persetujuan & tanpa jalur website
- [x] **Video Tutorial per modul** — tombol ❓ di header modul (Staff App + Admin Portal) **dan daftar per modul di Beranda Staff**, video YouTube Unlisted, global atau khusus BU, dikelola super admin
- [x] **Reservasi: batas pesan H- hari + jam batas** — "H-3 sebelum pukul 17.00" dihitung per tanggal kalender, hanya mengikat jalur website
- [x] **Reservasi: jam bebas, S&K per outlet, DP + bukti transfer, koreksi/reschedule oleh admin** — jam tidak harus .00 (kuota tetap dihitung per slot), S&K ikut di pesan WhatsApp, DP dicatat beserta fotonya **dari Staff App maupun Admin Portal** (**tidak masuk modul Kas**)
- [x] **Kantong kas (sub-kas) & outlet peruntukan** — form Kas Masuk/Keluar dibedakan, jumlah kantong per user diatur admin, pindah saldo antar kantong sendiri, Laporan Kas bisa disaring per outlet & kategori
