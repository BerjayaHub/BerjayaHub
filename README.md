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

## Arsitektur modular per Business Unit

Setiap Business Unit punya daftar modul aktif sendiri (tabel `bu_modules`), jadi menu & fitur yang muncul di Staff App/Admin Portal beda-beda tergantung BU tempat staff login. Modul baru didaftarkan lewat `registerModule(code, renderFn)` di `module-loader.js` — tidak perlu ubah kode shell.

## Central Kitchen

Outlet punya `outlet_role`: `standalone`, `central_kitchen`, atau `served_by_ck`. Outlet ber-role `served_by_ck` menunjuk ke outlet CK lewat kolom `served_by_outlet_id`. Satu CK bisa melayani banyak outlet. Owner bisa ubah role ini kapan saja lewat Admin Portal (modul Organization — belum dibangun di Fase 0 ini).

## Roadmap fase

- [x] **Fase 0** — Fondasi: struktur Organization/BU/Outlet, toggle modul per BU, auth, RLS dasar, shell Staff App & Admin Portal
- [x] **Fase 1** — Master User/Staff (admin CRUD)
- [x] **Fase 2** — Presensi (lintas semua BU)
- [ ] **Fase 3** — Ceklis Kebersihan (lintas semua BU)
- [ ] **Fase 4** — Master Produk & Master Formula/Resep (Cafe)
- [ ] **Fase 5** — Inventory (Cafe)
- [ ] **Fase 6** — Production di level Outlet (Cafe)
- [ ] **Fase 7** — Production di Central Kitchen + Transfer/Dispatch ke outlet (Cafe)
- [ ] **Fase 8** — Sales (Cafe)
- [ ] **Fase 9** — Cash Ledger (Cafe)
- [ ] **Fase 10** — Pengajuan Cuti, Dashboard/Reports
- [ ] **Fase berikutnya** — Modul Armada/Fleet untuk BU tipe logistik
