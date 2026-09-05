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
| 0082 | `0082_simpan_resep_utuh.sql` | **Perbaikan bug**: resep bisa tertinggal TANPA BAHAN kalau penyimpanan terputus di tengah — penyimpanan dijadikan satu transaksi (`simpan_resep_utuh`), dan resep kosong yang sudah telanjur ada ikut dibersihkan |
| 0083 | `0083_item_berjadwal.sql` | **Item Daily Activities beberapa hari sekali**: kolom `interval_days` + fungsi `item_terakhir_dikerjakan()` (per outlet) + 2 indeks riwayat pengerjaan |
| 0084 | `0084_nota_penerimaan.sql` | **Terima barang PER NOTA**: tabel `goods_receipts` + itemnya, nomor `TRM-YYMMDD-XXXX` otomatis, foto opsional, dan `ubah_nota_terima()` yang mengoreksi stok lewat pergerakan PENYEIMBANG (riwayat lama tidak diubah) |
| 0085 | `0085_opname_bernomor.sql` | **Stok Opname bernomor & bersama**: `stock_counts` + itemnya, satu sesi terbuka per outlet (dijamin unique index), hitungan terakhir menang tapi yang lama disimpan di `sebelumnya`, stok baru berubah saat `tutup_opname()`. Buka/tutup/batalkan HANYA Admin BU & Super Admin (`is_bu_admin`, dipakai apa adanya — fungsinya tidak diubah) |
| 0086 | `0086_fk_user_profiles.sql` | **WAJIB kalau 0079/0084/0085 sudah dijalankan.** Mengarahkan ulang FK kolom pelaku (`goods_receipts.created_by`, `stock_counts.opened_by/closed_by`, `stock_count_items.counted_by`, `reservations.deposit_by`) dari `auth.users` ke **`user_profiles`**. Tanpa ini tab **Opname** & **Nota Terima** di Admin Portal gagal total dengan *"Could not find a relationship between 'stock_counts' and 'user_profiles' in the schema cache"*. Aman dijalankan ulang; diakhiri `notify pgrst, 'reload schema'` |
| 0087 | `0087_batas_bahan.sql` | **Batas bahan menipis**: `outlets.safety_days` (1–90, default 7) + tabel `product_min_stock` (batas manual per bahan per outlet) + RPC `set_safety_days()`. Perhitungannya TIDAK di SQL — pembentangan resep memakai kode yang sama dengan HPP di `js/` |
| 0088 | `0088_run_aktivitas_semua_role.sql` | **Daily Activities: super admin tidak bisa MEMULAI sesi.** `checklist_runs_insert_own` (0016) menuntut baris `membership_scopes` di BU itu persis, bukan memakai `has_bu_scope()` — jadi super_admin (yang barisnya menunjuk satu BU tapi wewenangnya lintas BU) ditolak saat menjadi orang pertama yang mengisi. Diganti ke `has_bu_scope()`; kepemilikan baris (`user_id = auth.uid()`) tetap wajib |
| 0089 | `0089_simpan_item_langsung.sql` | **Daily Activities disimpan per item, bukan sekali di akhir.** `pastikan_run_aktivitas()` (ambil/buat run hari ini, aman dari dua orang yang menyimpan bersamaan lewat `on conflict do nothing`) + `catat_catatan_run()` + policy update catatan untuk rekan satu outlet. Rekaman layar membuktikan Android membuang halaman ini sesudah kamera dipakai — selama pekerjaan menunggu tombol Kirim, ia selalu bisa hilang |
| 0090 | `0090_run_kosong_ikut_terhapus.sql` | **Sesi ikut terhapus saat item terakhirnya dihapus.** Trigger `trg_bersihkan_run_kosong` pada `checklist_run_items` + RPC `hapus_run_kosong()` + **pembersihan sekali** untuk sesi hantu yang sudah terlanjur ada. Dikerjakan trigger karena `checklist_runs` tidak punya policy DELETE — pembersihan lewat PostgREST akan ditolak RLS dan itu terbaca sebagai sukses dengan nol baris |
| 0091 | `0091_ambang_porsi.sql` | **Bahan menipis diukur PORSI, bukan hari.** `outlets.min_porsi` (1–10.000, default 30) + RPC `set_min_porsi()`; `outlets.safety_days` & `set_safety_days()` **dibuang**. Dasarnya sekarang stok ÷ takaran resep, jadi tidak lagi menuntut penjualan diinput rajin — bekerja di hari pertama outlet dipakai. `product_min_stock` tetap, dan makin penting untuk bahan non-resep (gas, tisu, kemasan) |
| 0092 | `0092_ubah_hapus_produksi.sql` | **Produksi bisa diperbaiki & dibatalkan.** `ubah_produksi()` menulis pergerakan stok sebesar SELISIHNYA; `hapus_produksi()` membalik seluruh stoknya lalu menandai `cancelled_at` (barisnya TIDAK dihapus — pergerakan penyeimbangnya butuh asal-usul). Wewenang: pembuatnya sendiri hari itu juga, atau Admin BU kapan saja (`boleh_ubah_produksi()`, pola sama dengan 0073) |
| 0093 | `0093_role_owner.sql` | Penanda **biaya tetap** & angka penetapan harga yang dipakai halaman Owner |
| 0094 | `0094_dokumen_ttd_owner.sql` | Dokumen & **tanda tangan owner** |
| 0095 | `0095_biaya_outlet.sql` | Biaya **tetap & variabel** yang didaftarkan, menempel di outlet |
| 0096 | `0096_harga_menu_outlet.sql` | **Harga jual pindah ke OUTLET** (`outlet_menu_prices`), bukan lagi satu harga per BU |
| 0097 | `0097_isi_harga_outlet_awal.sql` | Isi harga outlet awal dari `products.sale_price` (sekali jalan) |
| 0098 | `0098_pengiriman_penjualan.sql` | **Penjualan ganda**: penanda kiriman (`sales_submissions`) dari klien, idempotent |
| 0099 | `0099_penjualan_harga_outlet.sql` | `record_sales()` mengambil harga dari **outlet**, tanpa fallback, tanpa Rp 0, tanpa ganda |
| 0100 | `0100_cakupan_biaya.sql` | Cakupan biaya: langsung outlet / bersama BU / korporat |
| 0101 | `0101_ubah_hapus_penjualan.sql` | **Penjualan bisa diperbaiki & dihapus, dan stok bahannya ikut terkoreksi.** `stock_movements.sale_id` sengaja `on delete set null`, BUKAN cascade — cascade akan menghapus pemakaian bahan yang sungguh terjadi dan mengubah saldo tanpa jejak |
| 0102 | `0102_kategori_pindah_aset.sql` | Aset punya **kategori**, dan bisa dipindah massal ke outlet / BU lain (`pindah_aset`, wewenang diperiksa di asal DAN tujuan) |
| 0103 | `0103_draft_surat_jalan.sql` | **Surat jalan punya tahap DRAFT**, dan stok baru bergeser saat outlet MENERIMA. ⚠️ Mengandung `drop function receive_dispatch(uuid, jsonb)` karena tipe kembaliannya berubah — tanpa itu gagal dengan `42P13`. **Perlu redeploy `notify-telegram`** supaya draft tidak diumumkan sebagai "barang dikirim" |
| 0104 | `0104_lencana_beranda.sql` | **Lencana Beranda**: satu RPC menghitung berapa pekerjaan yang menunggu di Dispatch, Inventory, Daily Activities, Penjualan |
| 0105 | `0105_lencana_shift_cuti_reservasi.sql` | Lencana putaran kedua: **Shift, Pengajuan Cuti, Reservasi** — yang tiga ini bersifat PRIBADI (milik user yang membuka), bukan milik outlet |
| 0106 | `0106_nilai_ulang_shift_berjejak.sql` | **Menilai ulang presensi yang sudah pernah dinilai**, saat jadwal shift dikoreksi belakangan. Penilaian aslinya disimpan di `late_status_awal`/`late_menit_awal` dan **tidak pernah ditimpa**; alasan wajib diisi |
| 0107 | `0107_kabar_shift_dari_penilaian_ulang.sql` | Kartu **Shift** ikut menyala saat presensi ORANG ITU dinilai ulang |
| 0108 | `0108_lapor_penjualan_tanpa_resep.sql` | **Menu yang terjual tapi tidak menggerakkan stok kini mengatakannya.** Stok tetap dipotong sesuai resep dan **tetap boleh minus** (itu disengaja). Yang baru: menu tanpa resep — dan menu yang resepnya ada tapi isinya kosong — dilaporkan balik lewat `tanpa_resep` / `resep_kosong`. Kunci lama tidak berubah, jadi PWA lama tetap jalan |
| 0109 | `0109_lencana_draft_semua_outlet.sql` | **Perbaikan bug**: draft transfer antar outlet & retur ke CK tidak terhitung di lencana. `v_draft` dulu dihitung di dalam `if v_role = 'central_kitchen'`, padahal `buat_draft_kiriman` tidak pernah peduli peran outlet. **Butuh kode terbaru juga** — tab Draft-nya belum ada di sisi outlet |
| 0110 | `0110_order_milik_outlet.sql` | **Perbaikan bug**: order ke CK tidak bisa diedit rekan seoutlet. `0035` mengunci ke `created_by`, jadi Elsa (bar) membuat order dan Maskal (kitchen) ditolak saat menambah bahannya — sesudah mengisi, bukan sebelum. Sekarang `has_outlet_scope(from_outlet_id)`, pola yang sama dengan draft surat jalan di `0103`. **Membatalkan ikut disamakan** (atas permintaan); pembatalnya tercatat di `handled_by` |
| 0111 | `0111_draft_order_ck.sql` | **Order ke CK punya tahap DRAFT.** Disusun bersama dulu (bar + kitchen), baru ditekan Kirim — sebelum itu CK tidak melihatnya sama sekali. Satu draft per pasangan outlet-tujuan (unique index parsial). Sesudah dikirim, isinya **terkunci**. ⚠️ **Perlu redeploy `notify-telegram`** supaya draft tidak diumumkan sebagai order baru. Jalur lama `create_stock_order` dicabut grant-nya |
| 0112 | `0112_koreksi_penjualan_berjejak.sql` | **Admin bisa memperbaiki penjualan tanggal lampau.** Wewenangnya sudah ada sejak `0101`; yang baru adalah jejaknya (`qty_awal`, `dikoreksi_at/_by/_alasan`) dan **alasan wajib untuk tanggal lampau**. Stok bahan ikut dikoreksi sesuai resep; harga tetap harga saat transaksi dicatat. ⚠️ Mengandung `drop function ubah_penjualan(uuid, numeric)` — tanda tangannya bertambah satu parameter, dan tanpa drop versi lamanya tetap hidup sebagai overload tanpa penjagaan alasan |
| 0113 | `0113_cuti_di_jadwal_shift.sql` | **Cuti yang disetujui terbaca di jadwal shift** (Staff App & Admin Portal). Dua RPC baca saja (`cuti_disetujui_rentang`, `cuti_saya_rentang`) yang menguraikan rentang pengajuan jadi satu baris per tanggal. **Tidak menulis apa pun** ke `shift_schedules` — cuti tetap satu-satunya sumber kebenaran, jadi cuti yang dibatalkan langsung hilang dari jadwal tanpa perlu disinkronkan |
| 0124 | `0124_geser_harga_ke_harga_beli.sql` | **Menggeser harga nota lama dari arti "per satuan" ke harga beli baris.** `0123` sengaja tidak menebak data lama; ini alatnya, dipakai per nota setelah orangnya melihat total sekarang vs total sesudahnya. Menambah `goods_receipts.harga_digeser_at` (sekali saja) dan RPC `geser_harga_nota(daftar)` — `line_total := unit_cost lama`, `unit_cost := lama / qty`, dalam **satu** `update`, plus `stock_movements` supaya biaya rata-rata ikut terkoreksi. **Tidak ada konversi massal otomatis**: nota yang harganya sudah benar akan rusak kalau ikut digeser. Nota **lunas ditolak** — nominal kasnya dihitung dari harga lama |
| 0123 | `0123_harga_beli_per_baris.sql` | ⚠️ **Perbaikan salah paham yang menggandakan angka ribuan kali.** Kotak harga di nota berlabel "harga/gr" dan disimpan sebagai `unit_cost`, sementara orang mengetik angka yang tertulis di kertas notanya: beras 5.000 gr seharga Rp180.000 tersimpan sebagai Rp180.000/gram = **Rp900.000.000**. Menambah `goods_receipt_items.line_total` (harga beli seluruh baris — angka yang diketik orang), fungsi `harga_baris_nota()`, dan **menulis ulang `simpan_nota_terima` + `ubah_nota_terima`** supaya `unit_cost` jadi turunan (`line_total / qty`). `nota_ringkas` & `bayar_nota` memakai `line_total`. Bentuk lama (`unit_cost`) tetap diterima untuk PWA yang belum memperbarui diri. **Baris lama diisi `line_total = qty * unit_cost`** — arti yang dinyatakan kolom itu selama ini; baris yang terlanjur diisi sebagai total **tetap salah** dan harus dibetulkan lewat Edit |
| 0122 | `0122_nota_status_bayar.sql` | **Nota punya status bayar; hutang supplier bisa dilihat & dilunasi.** Menambah `payment_status` / `due_date` / `paid_at` / `paid_by` / `payment_entry_id` pada `goods_receipts`, kolom `cash_entries.untuk_nota`, view `nota_ringkas`, serta RPC `bayar_nota` (beberapa nota → **satu** entri kas), `batalkan_pembayaran_nota` (entri **balik**, yang asli tidak dihapus) dan `set_jatuh_tempo_nota`. ⚠️ **Mengganti batasan `cash_entries_nota_wajib`** jadi pelonggaran sempit: kas keluar boleh tanpa foto **hanya** kalau `untuk_nota`, dan itu diverifikasi saat commit oleh constraint trigger. Trigger baru menolak perubahan isi nota yang sudah lunas. **Nota lama semuanya berstatus `belum`** — menebak "lunas" akan menyembunyikan hutang yang nyata |
| 0121 | `0121_kelola_kantong_kas_dari_admin.sql` | ⚠️ **Wajib, kalau tidak `0120` tidak bisa dinyalakan oleh siapa pun.** `0120` membuat kantong kas bisa diberi outlet, tapi tidak ada satu orang pun yang bisa mengisinya: layarnya cuma ada di Staff App di balik jatah kantong > 1, pemegang berjatah 1 bahkan tidak punya baris kantong sama sekali (kasnya `account_id` NULL), Admin Portal → User → Kas hanya baca, dan RLS `0063` melarang super admin menulis kantong orang lain. Menambah RPC `daftar_kantong_kas()` (semua kantong + baris semu **Kas Utama** untuk uang tanpa kantong) dan `atur_kantong_kas(id, holder, nama, outlet, aktif)` — **tulis penuh, semua parameter wajib, tanpa default**. Kebijakan `cash_accounts_own` **sengaja tidak disentuh** |
| 0120 | `0120_kas_outlet_boleh_dibebani.sql` | **Kantong kas boleh menyebut OUTLET, dan staff outlet itu boleh membebaninya.** Menambah `cash_accounts.outlet_id` (boleh kosong = perilaku lama), fungsi `boleh_membebani_kas`, RPC `catat_kas_di`, serta DUA kebijakan baca baru: kantong ber-outlet terlihat oleh staff outlet itu, dan entri kas terlihat oleh yang membuatnya. Kebijakan tulis lama (`cash_entries_insert_own`) **sengaja tidak disentuh**. **Tidak ada data yang dipindahkan** — semua kantong yang ada tetap pribadi sampai ada yang memberinya outlet |
| 0119 | `0119_ubah_nota_tanpa_menghapus.sql` | ⚠️ **Perbaikan bug penghapusan data — jalankan bersama 0118.** Menekan **"+ Foto"** pada nota MENGHAPUS nama supplier, no. invoice, dan catatannya: `ubah_nota_terima` menimpa ketiganya tanpa syarat, sementara layar hanya mengirim fotonya. Sekarang keempat kolom memakai aturan yang sama — **NULL = jangan sentuh, string kosong = hapus, string berisi = ganti**. Menulis ulang `ubah_nota_terima` lagi (versi 0118-nya digantikan utuh, termasuk penyelarasan `unit_cost`) |
| 0118 | `0118_biaya_rata_bahan.sql` | **Biaya rata-rata bahan per outlet, dari harga di nota.** Tabel turunan `biaya_rata_bahan` (tanpa kebijakan tulis — hanya trigger yang mengisinya), fungsi `hitung_biaya_rata` / `segarkan_biaya_rata`, dan trigger di `stock_movements` yang menyegarkan tiap kali ada pergerakan **bernomor nota**. ⚠️ **Menulis ulang `ubah_nota_terima`** dari `0084`: koreksi harga harus sampai ke `stock_movements`, kalau tidak layar nota menampilkan harga baru sementara rata-ratanya masih memakai yang lama. **Tidak menyentuh `products.purchase_price` sama sekali — HPP menu tidak bergeser** |
| 0117 | `0117_admin_ubah_tanggal_cuti.sql` | **Admin bisa menyetujui cuti SEBAGIAN.** Menambah kolom `start_date_awal` / `end_date_awal` / `day_count_awal` dan RPC `setujui_cuti(id, status, catatan, mulai, selesai)`. Rentang yang disetujui **wajib di dalam** yang diajukan; `day_count` dihitung ulang; tanggal asli disalin sebelum ditimpa. Kebijakan RLS lama **sengaja tidak dicabut** supaya PWA lama di HP admin tetap bisa menyetujui (hanya tanpa ubah tanggal). ⚠️ **Perlu redeploy `notify-telegram`** supaya pesan grup menyebut tanggal yang diajukan saat dipersempit |
| 0116 | `0116_bersihkan_rencana_menu_nonaktif.sql` | ⚠️ **Jalankan bersama 0115.** Menonaktifkan menu di sebuah outlet ikut menghapus `menu_plans`-nya di sana — **hari ini & ke depan saja**, tanggal lampau tidak disentuh. Tanpa ini, rencana yang sudah tidak berlaku terus memotong perkiraan "bisa dibuat" sementara barisnya tidak tampil lagi di layar: beras 17.280 gr dengan takaran 200 gr/porsi berbunyi *"bahan habis"* tanpa penyebab yang bisa dilihat. Menulis ulang `set_menu_outlet` & `set_menu_outlet_massal` (versi 0115-nya digantikan utuh) |
| 0115 | `0115_menu_aktif_per_outlet.sql` | **Menu bisa dibatasi ke outlet tertentu.** Tabel `menu_outlet_aktif` sebagai **daftar izin**: menu tanpa satu baris pun aktif di **semua** outlet, jadi setelah migration ini **tidak ada satu pun perilaku yang berubah** sampai admin benar-benar mengaturnya. Tiga RPC: `menu_aktif_outlet(outlet)` (baca), `set_menu_outlet(menu, outlet[])` dan `set_menu_outlet_massal(outlet, menu[])` (tulis, `is_bu_admin`). Tabelnya **tidak punya kebijakan tulis** sama sekali — seluruh penulisan lewat RPC. Tidak menyentuh `sales`, `record_sales`, atau laporan mana pun: penjualan yang sudah tercatat tidak terpengaruh |
| 0114 | `0114_opname_stok_sistem_dari_server.sql` | ⚠️ **Perbaikan bug stok — jalankan segera.** Opname menerima `system_qty` **dari layar**, dan peta stok di layar bisa basi berjam-jam. Nanas stok 6.400 dihitung 4.600 menghasilkan **11.000** (penyesuaian +4.600, bukan −1.800). Sekarang server yang membacanya saat menyimpan. Menambah `opname_potret_basi(sesi)` untuk memeriksa sesi yang masih terbuka |


> ⚠️ **Gejala setelah 0085: tab Opname kosong dengan pesan *"Could not find a relationship between 'stock_counts' and 'user_profiles'"*.**
> Itu bukan salah data — FK-nya menunjuk `auth.users`, padahal PostgREST butuh relasi
> ke `user_profiles` untuk meng-embed nama. Jalankan **`0086`**. Kalau errornya masih
> sama sesudah itu, cache skema PostgREST-nya belum tersegarkan: jalankan
> `notify pgrst, 'reload schema';` di SQL Editor, atau restart project-nya dari dashboard.

> ℹ️ Gejala yang sama muncul di **Staff App → Terima dari Supplier** dengan
> `'goods_receipts' and 'user_profiles'`. Sumbernya satu dan sama; `0086` menutup
> keduanya. Sisi Staff App juga sudah berhenti meminta nama penginput yang memang
> tidak pernah ditampilkannya, jadi layar itu kini punya satu cara gagal lebih sedikit.

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
supabase functions deploy notify-telegram
supabase functions deploy notify-reservation
supabase functions deploy send-reservation-digest
supabase functions deploy submit-reservation
supabase functions deploy purge-old-selfies
```

> `notify-telegram` sempat terdaftar di bagian **OPSIONAL** ("hanya baris import
> yang berubah") — dan itu sudah tidak benar sejak `0117`: isi pesannya berubah,
> bukan cuma importnya. Keterangan yang sudah basi lebih berbahaya daripada
> tidak ada: yang membacanya akan melewatinya dengan yakin, lalu pesan cuti di
> grup tetap memakai bentuk lama tanpa satu pun error yang menandainya.

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

---

## 5b. Draft transfer/retur yang tersangkut (sekali, setelah 0109)

Sebelum perbaikan ini, tombol **Transfer / Retur** di outlet membuat draft yang
**tidak bisa dilihat dari mana pun** — tabnya belum ada di sisi outlet, Riwayat
mengecualikan status `draft`, dan lencana tidak menghitungnya. Barangnya
kemungkinan sudah diserahkan secara fisik sementara stoknya masih tercatat di
outlet asal.

**Lihat dulu, jangan diapa-apakan.** Tidak ada satu pun yang diubah otomatis:

```sql
select d.code,
       f.name  as dari,
       t.name  as ke,
       u.full_name as disiapkan_oleh,
       d.created_at,
       d.notes,
       (select string_agg(p.name || ' ' || di.sent_qty, ', ')
          from dispatch_items di join products p on p.id = di.product_id
         where di.dispatch_id = d.id) as isinya
  from dispatches d
  join outlets f on f.id = d.from_outlet_id
  left join outlets t on t.id = d.to_outlet_id
  left join user_profiles u on u.id = d.created_by
 where d.status = 'draft'
   and f.outlet_role is distinct from 'central_kitchen'
 order by d.created_at;
```

Sesudah `0109` **dan kode terbaru** terpasang, semuanya muncul di **Pengiriman →
📝 Draft Kiriman** di outlet masing-masing. Putuskan satu per satu:

- **Barangnya memang sudah pindah** → buka drafnya, cocokkan jumlahnya dengan
  yang benar-benar diserahkan, lalu **Kirim sekarang**. Stok baru bergeser saat
  outlet tujuan mengonfirmasi terima.
- **Batal / salah input** → **Hapus draft**. Aman, karena selama berstatus draft
  belum ada satu pun pergerakan stok yang ditulis.

⚠️ **Jangan mengubah `status` lewat SQL.** Pergeseran stoknya dikerjakan
`kirim_draft_kiriman()` dan `receive_dispatch()`, bukan oleh kolom status. Baris
yang diubah langsung akan berstatus "sent" dengan stok yang tidak pernah
bergerak — persis kebalikan dari masalah yang sedang dibereskan, dan jauh lebih
sulit ditemukan.

---

## 5c. Redeploy Edge Function setelah 0111

```bash
supabase functions deploy notify-telegram
```

`0111` memasang trigger baru pada `stock_orders`: INSERT hanya berbunyi kalau
statusnya **bukan** draft, dan ada trigger UPDATE baru yang menangkap saat draft
berangkat jadi `open`. Edge Function versi lama hanya menangani `INSERT`, jadi
**selama belum di-redeploy, notifikasi "order dikirim" tidak akan sampai.**

Arah kegagalannya sengaja dipilih begitu: Edge Function basi **kehilangan**
notifikasi, bukan mengumumkan draft yang belum jadi. CK yang tidak diberitahu
akan bertanya; CK yang diberi tahu terlalu dini akan menyiapkan barang untuk
daftar yang masih berubah.


---

## 5d. Sesi opname yang masih terbuka — periksa sebelum ditutup (setelah 0114)

Baris yang tersimpan **sebelum** `0114` bisa memegang `system_qty` basi dari
layar. Menutup sesinya akan menghasilkan penyesuaian yang salah, persis seperti
kasus nanas.

Untuk tiap sesi yang masih `open`:

```sql
-- 1. Cari sesinya
select id, code, outlet_id from stock_counts where status = 'open';

-- 2. Periksa barisnya
select * from opname_potret_basi('<id sesi>');
```

Kolom `selisih_jika_ditutup_sekarang` vs `selisih_seharusnya` menunjukkan
akibatnya. Kalau ada baris yang muncul, **jangan tutup sesinya dulu** —
perbaikannya sederhana: buka layar opname, **muat ulang halamannya**, lalu
**simpan ulang** hitungan bahan-bahan itu. Menyimpan ulang menyegarkan
potretnya dari server, dan `opname_potret_basi` akan kosong.

`opname_potret_basi` tidak memperbaiki apa pun sendiri — memperbaiki otomatis
berarti menebak, dan tebakan pada angka stok adalah hal yang paling tidak boleh
dikerjakan diam-diam.

---

## 5e. Hitungan yang mungkin masuk ke outlet yang salah (build sebelum perbaikan ganti-outlet)

**Tanpa SQL. Ini perbaikan sisi layar — cukup push code, lalu minta staff
menutup dan membuka lagi aplikasinya** (PWA lama masih ter-cache di HP).

Pada build sebelum perbaikan ini, mengganti outlet di halaman **Bahan** tidak
menutup panel opname yang sedang terbuka. Panelnya tetap memegang **sesi milik
outlet sebelumnya**, jadi hitungan yang diketik sesudah berganti outlet
tersimpan ke sesi outlet yang salah — tanpa error, dan judul panelnya pun
tetap menulis nama outlet lama.

Kalau ada yang pernah berganti outlet sambil panel opname terbuka, periksa
hitungan yang masuk ke sesi yang **outletnya tidak cocok dengan orang yang
mengisi**:

```sql
select c.code,
       o.name  as outlet_sesi,
       p.name  as bahan,
       i.counted_qty,
       u.full_name as diisi_oleh,
       i.counted_at
  from stock_count_items i
  join stock_counts c   on c.id = i.count_id
  join outlets o        on o.id = c.outlet_id
  join products p       on p.id = i.product_id
  left join user_profiles u on u.id = i.counted_by
 where c.status = 'open'
 order by c.code, i.counted_at desc;
```

Baris yang jelas salah tempat cukup **dihitung ulang di outlet yang benar**;
yang salah masuk bisa disimpan ulang dengan angka yang benar selama sesinya
masih `open`. Yang penting: **jangan tutup sesi yang isinya masih diragukan** —
penutupan sesi itulah yang menuliskan penyesuaian ke stok.


## 5f. Menu per outlet — cara memakainya (setelah 0115)

**Setelah migration ini dijalankan, tidak ada yang berubah.** Semua menu tetap
aktif di semua outlet sampai kamu benar-benar mengaturnya. Itu disengaja: tidak
ada backfill, jadi tidak ada yang bisa salah diam-diam.

Dua jalan, keduanya di **Admin Portal → Inventory**:

- **Tab Menu → buka satu baris menu** → blok *"Dijual di outlet mana"*.
  Cocok untuk satu-dua menu yang khusus.
- **Tab Menu per Outlet** → pilih outlet → centang menu mana saja yang dijual
  di sana. **Ini yang dipakai untuk penyiapan awal** — 162 menu tidak masuk
  akal dibuka satu per satu. Ada tombol *Centang semua yang tampil* /
  *Kosongkan yang tampil* yang bekerja pada hasil saringan kategori & pencarian.

Dua hal yang akan ditolak, dan keduanya disengaja:

1. **"Hanya outlet terpilih" tanpa satu pun outlet.** Nol outlet tersimpan
   sebagai nol baris, dan nol baris berarti *aktif di semua outlet* — kebalikan
   dari maksudmu. Pilih "Aktif di semua outlet" kalau memang itu yang dimaksud.
2. **Mencabut outlet terakhir sebuah menu di layar massal.** Kalau menu X hanya
   dijual di Sentul, mencabutnya dari layar Sentul berarti tidak dijual di mana
   pun — dan itu bukan hal yang bisa disimpan di sini. Pesannya menyebut menu
   mana saja. Jalan keluarnya: **nonaktifkan menunya di Master Produk**, atau
   centang dulu outlet lain yang menjualnya.

Sesudah diatur, staff di outlet yang tidak menjual menu itu **tidak akan
melihatnya sama sekali** di layar Penjualan maupun modul Menu. Penjualan yang
sudah pernah tercatat di outlet mana pun **tidak berubah sedikit pun** —
pengaturan ini hanya menyaring pilihan di layar.

**Rencana menu (`menu_plans`) ikut dibereskan.** Menu yang dinonaktifkan di
sebuah outlet kehilangan rencananya di sana untuk **hari ini dan ke depan**;
tanggal lampau tidak disentuh. Ini yang menutup gejala *"bahan ada stoknya tapi
menunya bahan habis"*: rencana yang sudah tidak berlaku tetap memotong
perkiraan, sementara barisnya sendiri tidak tampil lagi untuk dikosongkan.

Kalau kamu ingin memeriksa keadaan sekarang sebelum mengatur apa pun, ini
menunjukkan siapa yang memakan sebuah bahan hari ini di satu outlet:

```sql
select p.name as menu, mp.qty as rencana, ri.qty as per_porsi,
       mp.qty * ri.qty as terpakai
  from menu_plans mp
  join products p      on p.id = mp.product_id
  join recipes r       on r.product_id = mp.product_id
  join recipe_items ri on ri.recipe_id = r.id
  join products b      on b.id = ri.ingredient_product_id
 where mp.outlet_id = '<id outlet>'
   and mp.plan_date = (now() at time zone 'Asia/Jakarta')::date
   and b.name ilike '%beras%'
   and mp.qty > 0
 order by terpakai desc;
```

---


---

## 5g. HP menampilkan layar yang berbeda dari desktop — versi lama di cache

**Gejalanya khas:** satu layar benar di desktop dan salah di HP, tanpa satu pun
error. Contoh nyata: dialog **Edit Nota** menampilkan daftar barang lengkap di
desktop, tapi di HP hanya kotak kosong berlabel "Barang".

**Sebabnya:** berkas JS di repo ini **tidak punya penanda versi** (`js/core/ui.js`,
bukan `js/core/ui.js?v=12`). Browser boleh menyimpannya di cache HTTP, dan
setelah push code sebagian berkas bisa sudah baru sementara sebagian masih lama.
Modul lama yang tidak mengenal isian baru akan menggambarnya sebagai kotak teks
biasa — dan kotak teks biasa terlihat sempurna wajar.

Service worker di repo ini **tidak** menyimpan cache (tidak ada handler `fetch`),
jadi ini murni cache browser.

**Cara membereskannya di HP:**

1. Kalau dipasang sebagai aplikasi (Add to Home Screen): **tutup penuh** aplikasinya
   dari daftar aplikasi berjalan, lalu buka lagi.
2. Kalau lewat browser: buka menu → **Muat ulang paksa**, atau Setelan → Privasi →
   hapus cache untuk situs ini.
3. Kalau masih sama: buka lewat mode penyamaran sekali untuk memastikan versinya
   memang sudah yang terbaru di server.

**Sejak perbaikan ini, gejalanya tidak lagi diam.** Isian bertipe tak dikenal
menolak menggambar dirinya dan menampilkan pesan yang menyebut sebabnya, dan
tombol Simpan menolak menyimpan dari dialog yang separuh tergambar — supaya
tidak ada perubahan yang terkirim berdasarkan keadaan yang tidak pernah dilihat
siapa pun.

> Kalau ini sering mengganggu, langkah berikutnya yang masuk akal: satu berkas
> `version.json` yang dibaca saat aplikasi dibuka (`cache: 'no-store'`) dan
> dibandingkan dengan versi yang tertanam di kode — kalau berbeda, tampilkan
> "Versi baru tersedia, muat ulang". Belum dikerjakan karena butuh menaikkan
> nomor versinya tiap deploy, dan langkah manual yang mudah terlupa akan
> menghasilkan peringatan yang salah.

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
- **Mencari nota lama** → **Terima dari Supplier → Nota terakhir** punya kotak
  cari (nomor / supplier / tanggal) dan tombol **Muat … nota lagi**. Sebelumnya
  daftarnya berhenti di 15 baris teratas, jadi nota yang lebih tua tidak bisa
  dijangkau dari layar mana pun — termasuk tombol Edit-nya.
- **Mengubah cara bayar nota yang sudah tersimpan** → tombol **Tunai/Tempo** di
  baris notanya (ada di kedua tab). Tempo → isi/kosongkan jatuh temponya;
  Tunai → pilih kas, dan notanya langsung ditandai lunas. Arah sebaliknya
  (lunas → hutang lagi) tetap lewat **Batalkan pembayaran**, karena itu
  menyentuh buku kas.
- **Isi harga dari tab Hutang Supplier** → tombol **Isi harga** di baris
  notanya, tanpa perlu pindah tab.
- **Memperbaiki harga nota lama yang kebalik** → **Staff App → Bahan → Terima
  dari Supplier → ⇄ Perbaiki harga kebalik**. Dialognya menampilkan tiap nota
  dengan **total sekarang** dan **total sesudah digeser**; centang yang angkanya
  memang harga beli, bukan harga per satuan. Sekali digeser, nota itu tidak
  ditawarkan lagi. Nota yang sudah **lunas** tidak ikut muncul — batalkan
  pembayarannya dulu, karena nominal kasnya dihitung dari harga yang lama.
- **Tunai atau tempo saat menerima barang** → **Staff App → Bahan → Terima dari
  Supplier**, isian *Pembayaran*. Defaultnya **Tempo**: stok bertambah, kas belum
  berkurang, notanya masuk ke tab **Hutang Supplier** di layar yang sama.
  **Tunai** meminta kantong kas dan langsung memotongnya — hanya bisa dipakai
  kalau semua barang sudah ada harganya.
- **Melunasi hutang** → tab **Hutang Supplier**: centang beberapa nota dari satu
  supplier, pilih kasnya, tekan Bayar. Beberapa nota yang dibayar bersama
  menghasilkan **satu** baris di buku kas. Nota yang masih punya barang tanpa
  harga tidak bisa dicentang.
- **Membatalkan pembayaran** → tombolnya menggantikan *Edit* pada nota lunas.
  Pembatalan berlaku untuk **seluruh** pembayaran (semua nota yang dibayar
  bersama), dan uangnya kembali lewat baris **baru** di buku kas — baris
  pembayaran lama tetap ada.
- **Kantong kas milik ORANG LAIN, dan outletnya** → **Admin Portal → User → Kas →
  tab "Kantong Kas"** (`0121`, super admin). Ini satu-satunya tempat kantong bisa
  dibuatkan untuk pemegang berjatah 1 — di Staff App tombol *Kelola Kas* hanya
  digambar kalau jatahnya > 1, jadi Risma tidak akan pernah melihatnya.
  Beri **outlet** pada kantongnya supaya staff outlet itu (mis. Shenda) bisa
  mencatat nota supplier yang mengurangi kas pemegangnya. Baris **Kas Utama**
  di tabel itu adalah uang yang tidak berada di kantong mana pun; ia tidak bisa
  diberi outlet, dan membuat kantong baru **tidak** memindahkan isinya.
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
- ⚠️ **Import Produk/Menu berubah perilakunya.** Nama yang sudah ada kini
  **dilengkapi**, bukan dilewati: kolom yang masih kosong di sistem diisi dari
  file. Nilai yang sudah terisi **tidak pernah ditimpa** — selisihnya
  dilaporkan supaya kamu yang memutuskan. **Tipe** & **Satuan Pakai** tidak
  pernah diubah lewat impor. Template bertambah kolom **Kategori** &
  **Sub Kategori** — unduh ulang templatenya.
- **Menu** → kategori bisa **diketik langsung** di kolomnya (bebas, dengan saran
  dari yang sudah dipakai). Butuh Admin BU.
- **Stok Opname (Staff App)** → tampilannya berubah dari tabel jadi **kartu**,
  supaya kotak "stok fisik" tidak lagi terdorong ke luar layar HP. Tidak ada
  migration.
- **Resep & Menu** → ada **🗑 Hapus resep** di dalam baris yang terbuka, per
  varian (Produksi / Standalone / Dilayani CK). Berguna untuk membereskan hasil
  impor yang keliru: hapus satu varian, lalu impor ulang atau isi manual.
  Dialognya menyebut **produk lain yang HPP-nya ikut jadi kosong**. Tidak ada
  migration.
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
- **Pengiriman** → **nomor dokumen bisa diketuk** di kedua sisi: dialog berisi
  daftar barang + tombol unduh **PDF** dan **Excel**. Staff App dapat tab baru
  **📄 Riwayat & Dokumen** (rentang tanggal, bawaan tanggal 1 s/d hari ini).
  Unduhan Admin memuat **nilai (HPP × jumlah)**; unduhan Staff App tidak.
  ⚠️ Nomor surat jalan sebelumnya **tidak pernah tampil** di layar admin —
  `listDispatchesAdmin()` tidak membaca kolomnya. Sekarang jadi kolom pertama.
  Tidak ada migration.
- **Inventory → Stok** (staff & admin) → ada **filter kategori + cari nama**.
- 🔴 **Admin Portal: klik modul melompat ke Staff App** — **perbaikan KETIGA**,
  dan yang pertama benar-benar terbukti. Dua sebelumnya (sudah ter-push) hanya
  menambal gejalanya; penyebabnya bukan jumlah langkah mundur, melainkan
  urutannya — `history.go()` menjadwalkan perpindahan, sementara `pushState` di
  baris berikutnya jalan lebih dulu. Operasi history kini dijalankan berurutan.
  **Push kode terbaru.** Tidak ada migration.
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

Atau semuanya sekaligus (41 audit + 83 tes):

```bash
node --experimental-vm-modules tools/audit-syntax.cjs
for f in tools/audit-*.cjs; do [ "$f" = "tools/audit-syntax.cjs" ] && continue; node "$f" || echo "GAGAL $f"; done
for f in tools/test-*.mjs; do node "$f" >/dev/null || echo "GAGAL $f"; done
```

Tes yang butuh paket luar (`@electric-sql/pglite` untuk tes migration,
`linkedom` untuk tes DOM) **melewatkan dirinya sendiri** kalau paketnya tidak
ada — dan tes yang melewatkan diri itu hijau tanpa memeriksa apa pun. Pasang
**sekaligus dalam satu perintah**:

```bash
npm install --no-save @electric-sql/pglite linkedom
```

⚠️ Satu per satu **tidak bisa**: `--no-save` membuat npm memangkas paket lain
yang juga tidak tercatat di `package.json`, jadi memasang `linkedom` sendirian
akan **membuang `pglite`** — dan tujuh tes migration langsung mati dengan
`ERR_MODULE_NOT_FOUND`. `node_modules/` ada di `.gitignore`, jadi ini aman
diulang kapan saja.

`audit-syntax` yang paling penting: satu SyntaxError membuat **seluruh**
aplikasi berhenti di layar "Memuat…".
