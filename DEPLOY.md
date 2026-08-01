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

### OPSIONAL — hanya baris import yang berubah

```bash
supabase functions deploy send-attendance-reminders
supabase functions deploy send-fleet-reminders
supabase functions deploy send-test-push
supabase functions deploy notify-telegram
supabase functions deploy create-staff-user
supabase functions deploy reset-staff-password
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
git commit -m "Mode reservasi hotel, foto per item Daily Activities, kompresi foto, perbaikan RLS outlet_admin"
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

---

## Sebelum push — jalankan semua audit

```bash
node --experimental-vm-modules tools/audit-syntax.cjs
node tools/audit-html-escape.cjs
node tools/audit-owner-filter.cjs
node tools/audit-outlet-scope.cjs
node tools/test-youtube-parser.mjs
node tools/test-image-compress.mjs
```

`audit-syntax` yang paling penting: satu SyntaxError membuat **seluruh**
aplikasi berhenti di layar "Memuat…".
