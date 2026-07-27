# fetch-national-holidays

Menarik daftar hari libur nasional Indonesia dari layanan publik **di sisi server**,
lalu mengembalikannya ke Admin Portal dengan header CORS yang benar.

Function ini **tidak menyentuh database sama sekali** — hasilnya masih harus
disetujui admin di Admin Portal sebelum masuk tabel `holidays`.

## Deploy

```bash
supabase functions deploy fetch-national-holidays --no-verify-jwt
```

**`--no-verify-jwt` wajib.** Tanpa flag itu, gerbang Supabase menolak request
**preflight `OPTIONS`** yang dikirim browser — preflight tidak membawa header
`Authorization`, jadi dibalas `401` sebelum kode di function ini sempat jalan.
Di browser, kegagalan itu muncul sebagai:

```
Failed to send a request to the Edge Function
```

Aman dilakukan di sini karena function ini tidak membaca/menulis data user,
tidak memakai `service_role`, dan satu-satunya input yang diterima adalah angka
tahun yang divalidasi (2000–2100).

## Cek cepat setelah deploy

```bash
supabase functions list
```

Uji langsung (ganti `<PROJECT-REF>` dan `<ANON-KEY>`):

```bash
curl -X POST "https://<PROJECT-REF>.supabase.co/functions/v1/fetch-national-holidays" ^
  -H "Content-Type: application/json" ^
  -H "Authorization: Bearer <ANON-KEY>" ^
  -d "{\"year\":2026}"
```

(`^` untuk Command Prompt Windows; ganti jadi `\` di bash/PowerShell.)

Respons sukses:

```json
{ "source": "dayoffapi", "year": 2026, "holidays": [ { "date": "2026-01-01", "name": "Tahun Baru", "isJoint": false } ] }
```

## Kalau tetap gagal

Tidak perlu memaksakan function ini. Di dialog **Tarik hari libur nasional**,
kegagalan otomatis membuka jalur **tempel manual**: buka URL sumber di tab baru
(membuka URL langsung tidak kena CORS), salin isinya, tempel ke kotak. Hasilnya
sama persis — daftar centang untuk disetujui sebelum disimpan.
