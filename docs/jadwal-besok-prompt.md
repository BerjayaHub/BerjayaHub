# Prompt untuk jadwal "Berjaya Hub — tanya rencana kerja hari ini"

Dibuat dari sidebar **Scheduled**. Judul yang disarankan:
**Berjaya Hub — tanya rencana kerja hari ini**, jalan **Kamis 29 Oktober 2026, 09:00**
(atau jadikan harian kalau mau dipakai tiap pagi kerja).

Tempel teks di bawah ini sebagai prompt-nya.

---

Buka sesi kerja Berjaya Hub OMS bersama iko.

Proyeknya ada di folder kerja yang sudah terhubung (`Berjaya HUB`): PWA multi-BU,
ES modules murni tanpa build step, Supabase, dipublikasikan di GitHub Pages
(`admin.html`). Gaya rumahnya: modul murni tanpa DOM/Supabase + tes PGlite untuk
migrasi + harness `tools/audit-*.cjs` dan `tools/sabotase-*.mjs` yang harus
benar-benar menangkap kerusakan yang ditanam. Bahasa untuk iko dan untuk komentar
kode: Indonesia.

JANGAN langsung mengerjakan apa pun. Yang perlu dilakukan:

1. Baca dulu keadaan terkini supaya daftarnya akurat, bukan hafalan:
   - `git log --oneline -12` dan `git status --short` di folder itu — lihat apakah
     ada yang belum di-commit atau belum di-push.
   - Jalankan seluruh `tools/audit-*.cjs` dan catat mana yang MERAH. Catatan:
     `audit-syntax.cjs` butuh flag `--experimental-vm-modules`; tanpa flag itu ia
     keluar dengan galat dan BUKAN berarti ada masalah kode.
   - Lihat migrasi tertinggi di `supabase/migrations/` (per 28 Okt 2026 yang
     terakhir `0174_revisi_transfer_aset.sql`, dan iko sudah menjalankan sampai
     0174).
2. Sampaikan ringkasan SINGKAT: apa yang selesai terakhir dan apa yang masih
   tertunda.

Yang tertunda per akhir 28 Oktober 2026 (periksa ulang, mungkin sudah berubah):

   - Layar admin "prediksi item kembar" di Inventaris Aset — menampilkan dugaan
     item kembar beserta FOTO keduanya berdampingan, admin yang memutuskan gabung
     atau tidak. Mesin gabungnya (`gabung_item_aset`) dan view
     `v_aset_dugaan_kembar` sudah ada dan sudah teruji. iko tegas: JANGAN
     penggabungan otomatis.
   - Label "ESB" masih muncul di Cash Ledger untuk BU bertipe `workshop`; untuk
     tipe itu labelnya harus "Turboly". Perlu `type` BU dibawa ke `ctx` di kedua
     shell (`js/main-admin.js` dan `js/main-staff.js`).
   - Laporan "Kinerja Outlet Bengkel": income dari penjualan harian (sparepart &
     jasa), pengeluaran dari Cash Ledger, per outlet.
   - Verifikasi penutup untuk pekerjaan bengkel (tes dengan xlsx sungguhan,
     README, DEPLOY).
   - Empat audit yang merah sejak lama dan belum pernah ditangani:
     `ambil-terpotong`, `fk-pelaku`, `html-escape`, `outlet-tulis`.

3. Lalu TANYAKAN ke iko mana yang mau ditangani hari ini, pakai tool
   AskUserQuestion dengan pilihan-pilihan di atas (plus pilihan lain kalau ada
   temuan baru dari langkah 1). Tunggu jawabannya sebelum mulai bekerja.

Aturan yang tetap berlaku: jangan pernah menempelkan Secret Access Key atau
kredensial apa pun ke chat — rahasia R2 masuk langsung ke Supabase Edge Function
secrets. Jangan menyarankan menjalankan ulang migrasi 0134–0141 kecuali isinya
benar-benar berubah.
