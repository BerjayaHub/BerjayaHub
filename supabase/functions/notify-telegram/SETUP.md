# Notifikasi Telegram — langkah setup

Urutannya penting: **secret dulu → deploy → uji → baru pasang pemicu.** Kalau
uji koneksi belum hijau, memasang webhook cuma menambah variabel yang harus
ditebak saat mencari masalah.

---

## 1. Ambil ID grup

1. Tambahkan bot ke grup PIC (bot yang sudah ada bisa dipakai ulang).
2. Kirim satu pesan apa saja di grup itu.
3. Buka di browser: `https://api.telegram.org/bot<TOKEN>/getUpdates`
4. Cari `"chat":{"id":-1001234567890,...}` — **ID grup selalu diawali minus**.

Kalau `getUpdates` kosong, biasanya karena bot punya *privacy mode* aktif dan
pesanmu bukan perintah. Kirim `/start@NamaBotmu` di grup, lalu muat ulang.

---

## 2. Set secrets

```bash
supabase secrets set TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
supabase secrets set NOTIFY_SECRET=<string-acak-panjang>
```

`NOTIFY_SECRET` dipakai supaya endpoint webhook tidak bisa dipicu sembarang
orang dari internet. `CRON_SECRET` sudah ada dari reminder presensi dan dipakai
ulang untuk reminder armada.

**ID grup TIDAK diset di sini** — diatur dari Admin Portal (langkah 4), karena
tiap event bisa menuju grup berbeda. `TELEGRAM_CHAT_ID` boleh diisi sebagai
cadangan untuk event yang rutenya belum diatur, tapi tidak wajib.

> Token bot **tidak boleh** masuk folder `js/`. Repo ini publik di GitHub Pages.
> ID grup bukan rahasia — tanpa token, ia tidak bisa dipakai mengirim apa pun.

---

## 3. Deploy

```bash
supabase functions deploy notify-telegram --no-verify-jwt
supabase functions deploy send-fleet-reminders --no-verify-jwt
```

`--no-verify-jwt` diperlukan karena pemanggilnya adalah **Database Webhook** dan
**cron**, bukan user yang login — keduanya tidak membawa JWT. Keamanannya
dijaga oleh `NOTIFY_SECRET` / `CRON_SECRET` di dalam function.

---

## 4. Atur tujuan grup & uji

Admin Portal → **📣 Notifikasi Telegram**. Tiap event diatur tujuannya sendiri,
lalu diuji lewat tombol **Tes** di barisnya.

Konfigurasi saat ini:

| Event | Grup |
| --- | --- |
| 📝 Pengajuan cuti baru | **Berjaya** |
| ✅ Cuti disetujui / ditolak | **Berjaya** |
| 🚗 Dokumen kendaraan jatuh tempo | **Berjaya** |
| 📦 Order stok baru ke CK | **Awal Bermula** |

Tombol **+ Khusus BU** dipakai kalau nanti ada BU yang harus mengirim event
yang sama ke grup lain. Selama tidak dipakai, satu baris utama berlaku untuk
semua BU.

Pesan error yang sering muncul:

| Pesan | Artinya |
| --- | --- |
| `chat not found` | Bot belum ditambahkan ke grup, atau ID grup salah (lupa tanda minus) |
| `bot was kicked from the group chat` | Bot dikeluarkan dari grup |
| `TELEGRAM_BOT_TOKEN ... belum diset` | Secret belum ter-set, atau function belum di-deploy ulang setelah set secret |

---

## 5. Pasang pemicu (trigger)

Jalankan migration `0043_telegram_triggers.sql`, lalu isi URL & secret **sekali**
lewat **SQL Editor**:

```sql
insert into integration_settings (key, value) values
  ('notify_telegram_url', 'https://<PROJECT-REF>.supabase.co/functions/v1/notify-telegram'),
  ('notify_secret',       '<NOTIFY_SECRET>')
on conflict (key) do update set value = excluded.value, updated_at = now();
```

Selesai — trigger untuk `leave_requests` dan `stock_orders` sudah terpasang.

**Kenapa lewat SQL, bukan dashboard?** Database Webhook Supabase sebenarnya cuma
pembungkus trigger + `pg_net`. Membuatnya lewat migration lebih baik: masuk
kontrol versi, ikut kalau project di-restore, dan tidak bergantung letak menu
dashboard yang bisa berpindah. Nilai secret sengaja tidak ditulis di file
migration karena repo ini publik — makanya diisi lewat SQL Editor.

Sifat penting: `pg_net` **asinkron**, jadi lambatnya Telegram tidak memperlambat
app. Dan kalau pengiriman gagal, error-nya ditelan (`raise warning`) supaya
pengajuan cuti tetap tersimpan — notifikasi tidak boleh menggagalkan transaksi
bisnis.

**Cek riwayat panggilan** kalau pesan tidak sampai:

```sql
select id, status_code, content, created
from net._http_response
order by created desc
limit 10;
```

`status_code` 200 = Edge Function menerima. Kalau `content` berisi `{"ok":false,...}`,
masalahnya ada di sisi Telegram (lihat tabel error di langkah 4).

<details>
<summary>Alternatif: lewat dashboard</summary>

Menunya **bukan** lagi di bawah *Database*. Sekarang ada di
**Integrations → Webhooks** (ikon puzzle di bilah kiri), atau langsung:
`https://supabase.com/dashboard/project/_/integrations/webhooks/overview`

Buat dua hook ke function `notify-telegram`, keduanya dengan HTTP header
`x-notify-secret` = nilai `NOTIFY_SECRET`:

- `leave_requests` — events **Insert** & **Update**
- `stock_orders` — event **Insert**

Kalau memakai cara ini, **jangan** pasang trigger dari langkah SQL di atas —
nanti pesannya terkirim dua kali.

</details>

Function menyaring sendiri: `UPDATE` pada `leave_requests` hanya dikirim kalau
**status benar-benar berubah** ke `approved`/`rejected`, jadi melengkapi lampiran
atau edit lain tidak mengganggu grup.

---

## 6. Pasang cron reminder armada

Sekali sehari, mis. jam 08:00 WIB (= 01:00 UTC). Di SQL Editor:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'fleet-doc-reminder',
  '0 1 * * *',                        -- 01:00 UTC = 08:00 WIB
  $$
  select net.http_post(
    url     := 'https://<PROJECT-REF>.supabase.co/functions/v1/send-fleet-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body    := '{}'::jsonb
  );
  $$
);
```

Cek jadwal yang terpasang: `select * from cron.job;`
Hapus kalau perlu: `select cron.unschedule('fleet-doc-reminder');`

**Uji tanpa mengirim ke grup** — `dry_run` mengembalikan pratinjau teksnya saja:

```bash
curl -X POST "https://<PROJECT-REF>.supabase.co/functions/v1/send-fleet-reminders" ^
  -H "Content-Type: application/json" -H "x-cron-secret: <CRON_SECRET>" ^
  -d "{\"dry_run\":true}"
```

(`^` untuk Command Prompt Windows; ganti jadi `\` di bash/PowerShell.)

Ambang "mendekati jatuh tempo" mengikuti **reminder_lead_days** per BU di
Admin Portal → Armada → Pengaturan — tidak di-hardcode di function.

Pengiriman didedupe lewat tabel `telegram_notifications_sent` (`kind='fleet_docs'`,
`ref` = tanggal), jadi cron yang tidak sengaja jalan dua kali tidak mengirim
pesan dobel.
