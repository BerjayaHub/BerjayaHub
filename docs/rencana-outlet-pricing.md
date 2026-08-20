# Rencana Implementasi — Outlet Pricing & Integritas Penjualan

Ditampilkan sebelum implementasi, sesuai permintaan. Tujuh butir yang diminta,
plus satu temuan yang **mengubah pilihan mekanisme idempotency**.

---

## 0. Temuan yang mengubah rencana: penjualan bersifat MENAMBAH, bukan rekap

Sebelum memilih mekanisme anti-ganda, saya baca ulang `sales.page.js:135–155`:

```js
await recordSales({ ...items });
container.querySelectorAll('.sl-qty').forEach((inp) => (inp.value = ''));  // dikosongkan
await loadSummary();                                                      // rekap AKUMULATIF
```

Staff mengisi jumlah terjual → simpan → kotaknya dikosongkan → rekap menampilkan
**akumulasi hari itu**. Jadi mengirim dua kali dalam satu hari itu **alur yang
sah** — shift pagi lalu shift malam.

**Konsekuensinya:** `unique (outlet_id, product_id, sale_date)` — yang tadinya
tampak jawaban paling wajar untuk §9.2 — **akan merusak alur yang benar**. Shift
malam akan ditolak, atau (kalau dibuat upsert) akan menimpa angka shift pagi.

Yang dibutuhkan bukan kunci alami, melainkan **penanda percobaan kirim**.

---

## 1. Berkas migration yang akan dibuat

| Berkas | Isi | Sifat |
|---|---|---|
| `0096_harga_menu_outlet.sql` | tabel `outlet_menu_prices` + constraint + trigger + RLS + fungsi pembaca harga | tabel baru |
| `0097_isi_harga_outlet_awal.sql` | backfill dari `products.sale_price` untuk tiap (outlet aktif × menu berharga) | data |
| `0098_pengiriman_penjualan.sql` | tabel `sales_submissions` + `sales.submission_id` | tabel baru + kolom |
| `0099_penjualan_harga_outlet.sql` | `record_sales()` versi baru; signature lama **di-drop** | mengganti RPC |

Semua idempoten dan akan diuji di PGlite sebelum diserahkan.

---

## 2. Skema final outlet pricing

```sql
create table outlet_menu_prices (
  id                 uuid primary key default gen_random_uuid(),
  business_unit_id   uuid not null references business_units(id) on delete cascade,
  outlet_id          uuid not null references outlets(id) on delete cascade,
  product_id         uuid not null references products(id) on delete cascade,

  selling_price      numeric not null check (selling_price >= 0),
  packaging_cost     numeric not null default 0,
  fee_online_percent numeric not null default 0,
  promo_percent      numeric not null default 0,

  effective_from     date not null,
  effective_to       date,              -- null = masih berlaku
  is_available       boolean not null default true,

  notes              text,
  created_by         uuid references user_profiles(id) on delete set null,
  created_at         timestamptz not null default now()
);
```

**Penjaga:**

| Nama | Isi |
|---|---|
| `omp_rentang_sah` | `effective_to is null or effective_to >= effective_from` |
| `omp_persen_wajar` | fee & promo `>= 0 and < 100`, packaging `>= 0` |
| `omp_tanpa_tumpang_tindih` | `exclude using gist (outlet_id with =, product_id with =, daterange(effective_from, effective_to, '[]') with &&)` |
| trigger `omp_cocokkan_bu` | outlet harus milik BU yang disebut |
| trigger `omp_tutup_harga_lama` | saat baris baru masuk tanpa `effective_to`, baris aktif sebelumnya ditutup di `effective_from - 1 hari` |

`exclude ... gist` butuh extension `btree_gist`. Kalau tidak tersedia di
Supabase, jatuh ke trigger yang memeriksa tumpang tindih — akan saya periksa di
PGlite dan pilih yang jalan.

**Kenapa `effective_to` disimpan, bukan hanya `effective_from`:** mencari harga
aktif pada tanggal X dengan hanya `effective_from` menuntut `max(effective_from)
<= X` di setiap pembacaan. Rumus itu mudah ditulis berbeda di dua tempat, dan
bedanya baru terlihat saat ada perubahan harga. Dengan `effective_to`, syaratnya
satu baris dan sama di mana-mana.

**Fungsi pembaca — satu-satunya pintu:**

```sql
create function harga_outlet_aktif(p_outlet uuid, p_product uuid, p_tanggal date)
returns outlet_menu_prices
```

`record_sales()`, layar, dan laporan semuanya memanggil fungsi ini. Kalau
masing-masing menulis `where`-nya sendiri, definisi "harga aktif" akan bercabang.

### Backfill (`0097`)

`effective_from = current_date`, **bukan** tanggal transaksi paling awal.

Alasannya persis instruksi Anda: data historis yang dulu tidak membedakan harga
antar outlet **tidak direkonstruksi secara spekulatif**. Menuliskan
`effective_from = 2026-01-01` berarti menyatakan harga itu berlaku di outlet itu
sejak Januari — pernyataan yang tidak pernah benar-benar diketahui sistem.

Akibat yang harus diketahui: bertanya "berapa harga Nasi Goreng di Sentul pada 10
Agustus" akan menjawab **tidak diketahui**. Omzet Agustus tetap benar karena
diambil dari `sales.unit_price`, bukan dari tabel ini.

Menu yang `sale_price`-nya `NULL` **tidak** dibuatkan baris — outlet belum bisa
menjualnya sampai admin mengisi harganya. Itu disengaja (§4).

---

## 3. Perubahan `record_sales()`

```sql
create or replace function record_sales(
  p_bu uuid, p_outlet uuid, p_date date, p_items jsonb, p_ref uuid   -- ← param baru
) returns jsonb
```

Urutannya:

```
1. Idempotency
   insert into sales_submissions(id, ...) values (p_ref, ...) on conflict (id) do nothing
   → 0 baris  ⇒  kiriman ini SUDAH pernah diproses.
                 kembalikan hasil yang tersimpan. TIDAK menulis apa pun.

2. Validasi harga — SELURUH item diperiksa DULU
   untuk tiap item: harga_outlet_aktif(p_outlet, product_id, p_date)
   yang kosong dikumpulkan namanya
   → kalau ada  ⇒  raise exception menyebut SEMUA menu yang belum berharga
                   (bukan satu per satu, supaya admin bisa mengisi sekali jalan)

3. Baru menulis
   insert sales (unit_price = harga aktif, revenue = harga × qty, submission_id = p_ref)
   insert stock_movements 'usage' sesuai resep
```

**Yang dibuang:**

| Lama | Baru |
|---|---|
| `select sale_price from products` | `harga_outlet_aktif(outlet, product, tanggal)` |
| `coalesce(v_price, 0) * v_qty` | **dihapus** — tidak ada revenue Rp 0 |
| harga kosong → tetap tersimpan | harga kosong → **seluruh transaksi ditolak** |

Karena langkah 2 melempar exception sebelum langkah 3, **tidak ada** baris
`sales` maupun `stock_movements` yang tertinggal. Itu jaminan dari transaksi
Postgres, bukan dari urutan kode saya — dan akan tetap benar walau nanti
urutannya diubah.

**Signature lama (4 argumen) di-DROP.** Klien lama yang masih terpasang di HP
akan gagal dengan pesan yang jelas, bukan diam-diam menyimpan tanpa idempotency
dan dengan harga BU. Gagal berisik lebih baik daripada benar sebagian.

---

## 4. Mekanisme idempotency yang dipilih

**Referensi kiriman dari klien (`p_ref` UUID) + `sales_submissions`.**

```sql
create table sales_submissions (
  id            uuid primary key,          -- ← dibuat KLIEN, bukan default
  business_unit_id uuid not null references business_units(id) on delete cascade,
  outlet_id     uuid not null references outlets(id) on delete cascade,
  sale_date     date not null,
  item_count    int  not null,
  total_revenue numeric not null,
  created_by    uuid references user_profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

alter table sales add column submission_id uuid references sales_submissions(id) on delete restrict;
```

**Kenapa bukan `unique (outlet, product, tanggal)`:** lihat §0 — itu akan menolak
shift kedua, yang merupakan alur yang sah.

**Kenapa UUID dibuat klien:** kunci harus **sama** di seluruh percobaan ulang
untuk satu tindakan yang sama. Kalau server yang membuatnya, percobaan kedua
mendapat kunci baru dan lolos — tepat kegagalan yang mau dicegah.

Aturan pemakaian di klien (dan `sekaliJalan()` **tidak cukup** untuk ini):

```
tombol ditekan → kalau belum ada, buat ref sekali dan simpan di state
              → kirim dengan ref yang sama pada setiap percobaan
              → SUKSES → ref dibuang, siap untuk kiriman berikutnya
              → GAGAL karena jaringan → ref DIPERTAHANKAN, retry memakai yang sama
              → GAGAL karena validasi (harga kosong) → ref dibuang
                (isinya akan diubah, jadi ini kiriman yang berbeda)
```

Perbedaan gagal-jaringan vs gagal-validasi itu penting: mempertahankan ref
sesudah validasi gagal akan membuat kiriman yang **sudah diperbaiki** ditolak
sebagai duplikat.

`submission_id` juga memberi hal yang selama ini tidak ada: satu kiriman bisa
ditelusuri, dan kelak dibatalkan utuh — `sales` tidak punya policy UPDATE/DELETE,
jadi pembatalan harus lewat RPC yang mencatat pembalikannya. Itu **di luar
lingkup putaran ini**, tapi strukturnya sudah menyiapkannya.

---

## 5. Impacted files

### Database
`0096`, `0097`, `0098`, `0099` (baru) · `0025_sales.sql` **tidak disentuh**
(diganti lewat `create or replace` + `drop function` di `0099`).

### Service
| Berkas | Perubahan |
|---|---|
| `js/modules/owner/harga-outlet.service.js` | **baru** — CRUD harga per outlet + daftar yang belum berharga |
| `js/modules/sales/sales.service.js` | `recordSales()` mengirim `p_ref`; `listSalesReport()` `.limit(2000)` → `ambilSemua()` |

### Layar
| Berkas | Perubahan |
|---|---|
| `js/modules/sales/sales.page.js` | harga dari daftar harga outlet (baca saja); pengelolaan ref |
| `js/modules/menu/menu.admin.page.js` | tab **Harga per Outlet** + peringatan menu belum berharga |
| `js/modules/owner/bep.owner.js` | harga acuan → harga outlet |
| `js/modules/product/product.admin.page.js` | `sale_price` diberi label "harga acuan" |

### Modul murni (putaran berikutnya, §6 di bawah)
`bep.js` dipecah per outlet · `proyeksi.js` baru · `kpi.js` menerima per outlet.

### Audit
| Berkas | Isi |
|---|---|
| `tools/audit-harga-outlet.cjs` | `products.sale_price` dilarang di jalur penjualan & profitabilitas |
| `tools/audit-idempotency-penjualan.cjs` | `record_sales` tidak boleh dipanggil tanpa `p_ref` |

---

## 6. Urutan implementasi

Mengikuti urutan Anda, dengan satu catatan kejujuran soal cakupan:

| # | Langkah | Putaran |
|---|---|---|
| 1 | Migration skema harga outlet | **ini** |
| 2 | Backfill harga awal | **ini** |
| 3 | Validasi outlet-produk-harga | **ini** |
| 4 | Revisi `record_sales()` | **ini** |
| 5 | Proteksi duplikat/idempotency | **ini** |
| 6 | Staff App: tampilkan harga outlet, tidak bisa mengubah | **ini** |
| 7 | Admin Portal: harga per outlet | **ini** |
| 8 | Profitabilitas outlet-aware | berikutnya |
| 9 | Pisah Actual / Projection / Simulation | berikutnya |
| 10 | Report & KPI yang masih memakai harga BU | berikutnya |
| 11 | Seluruh test plan | keduanya |
| 12 | Regresi stok & penjualan | keduanya |

**Kenapa 8–10 dipisah:** 1–7 adalah perubahan *integritas data* — begitu
terpasang, setiap transaksi baru sudah benar. 8–10 adalah perubahan *cara
membaca*, dan ia tidak mengubah kebenaran data satu pun.

Berhenti sesudah 7 menghasilkan keadaan yang **utuh dan aman**: harga sudah per
outlet, tidak ada Rp 0, tidak ada baris ganda, dan halaman profitabilitas tetap
bekerja seperti sekarang (memakai `sales.unit_price` yang memang sudah benar).
Menggabungkan 1–10 dalam satu putaran berarti mengubah data DAN cara membacanya
sekaligus — kalau angkanya lalu terlihat janggal, tidak akan ketahuan mana
penyebabnya.

---

## 7. Test cases

### Migration (PGlite, Postgres sungguhan)
| Uji | Harapan |
|---|---|
| Dua skenario: DB bersih & DB berisi data lama | keduanya sukses |
| Dijalankan dua kali | idempoten |
| Harga tumpang tindih tanggalnya | **ditolak** |
| `effective_to < effective_from` | **ditolak** |
| Outlet milik BU lain | **ditolak** trigger |
| Harga baru masuk | harga lama otomatis ditutup, tidak tumpang tindih |
| Backfill | satu baris per (outlet aktif × menu berharga); menu tanpa harga **tidak** dibuatkan |

### `record_sales()` — perilaku
| Uji | Harapan |
|---|---|
| Outlet punya harga | tersimpan; `unit_price` = harga outlet, bukan `products.sale_price` |
| Dua outlet, harga beda, menu sama | dua `unit_price` berbeda |
| Satu menu belum berharga | **seluruh** transaksi ditolak; pesan menyebut nama menunya |
| Tiga menu, dua belum berharga | pesan menyebut **kedua**-duanya |
| Transaksi ditolak | `sales` **kosong**, `stock_movements` **kosong** |
| `products.sale_price` diisi, harga outlet tidak | **tetap ditolak** — tidak ada fallback |
| Kirim ulang dengan `p_ref` sama | baris **tidak** bertambah; stok **tidak** bergerak |
| Kirim dengan `p_ref` berbeda, isi sama | baris bertambah (shift kedua yang sah) |
| Harga berubah di tengah periode | transaksi sebelum & sesudah memakai harganya masing-masing |
| Transaksi lama | `unit_price` & `revenue` **tidak berubah sama sekali** |

### Regresi
| Uji | Harapan |
|---|---|
| Stok terpotong sesuai resep | sama seperti sebelum perubahan |
| Varian resep `served_by_ck` → fallback `standalone` | perilaku lama dipertahankan |
| `allow_sales = false` | tetap ditolak |
| Bukan anggota BU | tetap ditolak |

### Sabotase yang harus merah
1. `coalesce(v_price, 0)` dikembalikan → uji tolak-harga-kosong merah.
2. Fallback ke `products.sale_price` ditambahkan → uji no-fallback merah.
3. `on conflict do nothing` dibuang → uji kirim-ulang merah.
4. Validasi dipindah ke dalam loop penulisan → uji stok-kosong-saat-gagal merah.
5. `p_ref` dibuat server → uji kirim-ulang merah.

---

## 8. Satu hal yang tidak bisa saya janjikan

Backfill memberi setiap outlet harga yang **sama** (dari `products.sale_price`).
Harga yang benar-benar berbeda per outlet harus diketik seseorang.

Sampai itu dikerjakan, "profitabilitas per outlet" akan menunjukkan margin yang
identik di semua outlet — bukan karena sistemnya salah, tapi karena harganya
memang belum dibedakan. Layar Admin akan menampilkan berapa outlet×menu yang
masih memakai harga hasil backfill, supaya keadaan itu terlihat dan tidak
disalahartikan sebagai kesimpulan.
