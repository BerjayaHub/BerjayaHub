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
   -- Simpan URL & secret dengan aman di Vault (sekali saja)
   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/send-attendance-reminders', 'reminder_function_url');
   select vault.create_secret('<isi CRON_SECRET yang sama seperti langkah 4>', 'reminder_cron_secret');

   -- Jadwalkan tiap 10 menit
   select cron.schedule(
     'send-attendance-reminders-job',
     '*/10 * * * *',
     $$
     select net.http_post(
       url := (select decrypted_secret from vault.decrypted_secrets where name = 'reminder_function_url'),
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'reminder_cron_secret')
       ),
       body := '{}'::jsonb
     );
     $$
   );
   ```

6. **Catatan zona waktu**: Edge Function mengasumsikan semua outlet di zona waktu **WIB (Asia/Jakarta)**. Kalau ada outlet di WITA/WIT, perlu penyesuaian logic (tambah kolom timezone per outlet) — belum didukung di versi ini.

7. Kalau suatu saat mau ganti VAPID key (misal key lama bocor), staff yang sudah subscribe pakai key lama otomatis berhenti dapat notifikasi (subscription lama jadi tidak valid) — mereka perlu klik ulang tombol aktivasi.

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

## Ceklis Kebersihan

Jalankan migration `0016_cleaning_checklist.sql`, lalu aktifkan modul **Ceklis Kebersihan** untuk BU lewat Admin Portal → Master BU & Outlet → tombol **Modul**.

- **Admin Portal** (menu Ceklis Kebersihan), 3 tab:
  - **Item Ceklis** — daftar item (rata/flat), berlaku semua outlet di BU. Atur urutan & aktif/nonaktif.
  - **Sesi** — sesi per hari (mis. Buka, Tutup, atau shift), per BU.
  - **Rekap** — lihat sesi yang sudah dikerjakan per outlet/tanggal: siapa, catatan, **foto bukti**, dan detail centang item.
- **Staff App** (menu Ceklis Kebersihan): pilih outlet & sesi, centang item, **wajib 1 foto bukti**, kirim. Sesi yang sudah selesai hari itu ditandai ✅ (1 run per outlet/sesi/hari).
- Foto disimpan di bucket privat `checklist-photos` (RLS: pemilik + admin outlet). Aktivitas otomatis muncul di **Dashboard**.

## Fase 4 — Master Produk & Resep (Cafe)

Jalankan migration `0017_master_product.sql`, lalu aktifkan modul **Master Produk** untuk BU Cafe lewat Master BU & Outlet → tombol **Modul**. Admin-only (data master).

- **3 tipe produk**: Bahan Baku, Setengah Jadi, Produk Jadi.
- **Satuan pakai** (di resep/stok) + **konversi beli**: satuan beli, isi per satuan beli, harga beli. Contoh: gula — satuan pakai `gram`, beli `karung`, isi `25000`, harga `Rp150.000/karung` → biaya per gram dihitung otomatis.
- **Resep berjenjang (BOM)**: produk Setengah Jadi & Jadi punya resep dari bahan lain (baku/setengah jadi) + **yield/hasil**. **HPP** tiap produk dihitung otomatis & bertingkat; untuk Produk Jadi ditampilkan juga **margin** terhadap harga jual.
- Tab **Produk** (kelola produk + lihat HPP/margin) & **Resep** (editor bahan + yield).

## Roadmap fase

- [x] **Fase 0** — Fondasi: struktur Organization/BU/Outlet, toggle modul per BU, auth, RLS dasar, shell Staff App & Admin Portal
- [x] **Fase 1** — Master User/Staff (admin CRUD)
- [x] **Fase 2** — Presensi (lintas semua BU)
- [x] **Fase 3** — Pengajuan Cuti (lintas semua BU)
- [x] **Fase 3b** — Ceklis Kebersihan (lintas semua BU)
- [x] **Fase 4** — Master Produk & Master Formula/Resep (Cafe)
- [ ] **Fase 5** — Inventory (Cafe)
- [ ] **Fase 6** — Production di level Outlet (Cafe)
- [ ] **Fase 7** — Production di Central Kitchen + Transfer/Dispatch ke outlet (Cafe)
- [ ] **Fase 8** — Sales (Cafe)
- [ ] **Fase 9** — Cash Ledger (Cafe)
- [ ] **Fase 10** — Pengajuan Cuti, Dashboard/Reports
- [ ] **Fase berikutnya** — Modul Armada/Fleet untuk BU tipe logistik
