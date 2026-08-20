# Audit: Outlet-Level Pricing & Pemisahan Actual / Projection / Simulation

**Status: AUDIT — belum ada kode yang diubah.**
Dokumen ini dibuat sebelum implementasi, sesuai permintaan. Setiap klaim di bawah
dibaca langsung dari kode dan migration, dan lokasinya disebutkan supaya bisa
diperiksa ulang.

---

## 0. Ringkasan temuan

Tiga hal yang perlu diketahui lebih dulu, karena mengubah bentuk pekerjaannya:

**(a) Harga historis SUDAH tersimpan per transaksi.** `sales.unit_price` dan
`sales.revenue` diisi saat transaksi dicatat, bukan dibaca ulang dari master.
Poin #5 dan #19 (price history) sebagian besar sudah terpenuhi di lapisan data —
yang belum ada adalah *tabel harga per outlet*, bukan *jejak harga transaksi*.

**(b) Tapi sumbernya harga BU.** `record_sales()` mengambil
`products.sale_price` — kolom milik BU. Jadi dua outlet yang menjual menu yang
sama **selalu** tercatat dengan harga yang sama, dan tidak ada jalan untuk
membedakannya. Ini akar masalah #2/#3.

**(c) Mesin profitabilitas tidak mengenal outlet sama sekali.** Kata "outlet"
tidak muncul satu kali pun di `js/modules/owner/bep.js`. Penyaringan outlet
terjadi di *query*, lalu seluruh baris dilebur jadi satu rata-rata tertimbang.
Memilih "Semua Outlet" hari ini menghasilkan persis yang dilarang #17.

Selain itu ditemukan **empat masalah akurasi data yang belum Anda sebutkan**, dan
salah satunya menurut saya lebih mendesak daripada outlet pricing. Ada di §9.

---

## 1. Existing Architecture

### Hierarki yang ADA sekarang

```
organizations
└── business_units                    (BU)
    ├── outlets                       (outlet_role: standalone / central_kitchen / served_by_ck)
    ├── products                      ← MASTER MENU, milik BU
    │   └── sale_price                ← HARGA JUAL ADA DI SINI (masalahnya)
    ├── recipes → recipe_items        ← HPP, per mode (standalone / served_by_ck / production)
    └── sales                         (business_unit_id + outlet_id + product_id + qty + unit_price + revenue)
```

### Yang sudah outlet-scoped

| Objek | Kolom outlet | Keterangan |
|---|---|---|
| `sales` | `outlet_id` **not null** | transaksi sudah tahu outletnya |
| `stock_movements` | `outlet_id` **not null** | |
| `menu_plans` | `outlet_id` **not null** | rencana jumlah menu per outlet per tanggal — **bukan harga** |
| `outlet_costs` (0095) | `outlet_id` **not null** | biaya tetap/variabel, baru dibuat |
| `cash_entries` | `outlet_id` (wajib untuk `out`) | outlet *peruntukan* |
| `outlets.allow_sales` | — | penjualan bisa dimatikan per outlet |

### Yang TIDAK outlet-scoped

| Objek | Level sekarang | Seharusnya |
|---|---|---|
| **`products.sale_price`** | **BU** | **outlet + periode** |
| `products.packaging_cost` | BU | outlet (bisa beda kemasan) |
| `products.fee_online_percent` | BU | outlet (marketplace beda per lokasi) |
| `products.promo_percent` | BU | outlet |
| `business_units.pricing_method` + 3 persen | BU | boleh tetap BU (metode), tapi hasilnya per outlet |
| ketersediaan menu | — (semua produk dianggap ada di semua outlet) | outlet |

---

## 2. Existing Data Flow

### Alur pencatatan penjualan

```
sales.page.js (Staff App)
  └─ items = [{ product_id, qty }]          ← HANYA qty. Tidak ada harga.
     └─ recordSales()  → rpc record_sales(p_bu, p_outlet, p_date, p_items)
        └─ SELECT sale_price FROM products WHERE id = product_id     ← HARGA BU
           INSERT INTO sales (unit_price = v_price,
                              revenue    = coalesce(v_price, 0) * qty)
        └─ INSERT stock_movements 'usage' sesuai resep
```

`supabase/migrations/0025_sales.sql`

**Konsekuensinya:**

1. Harga transaksi memang dibekukan (bagus), tapi nilainya selalu harga BU.
2. Kasir/staff **tidak bisa** memasukkan harga yang berbeda, bahkan untuk promo.
3. Mengubah `products.sale_price` hari ini **tidak** merusak transaksi kemarin —
   jejak historisnya aman. Yang rusak adalah kemampuan membedakan outlet.

### Alur pembacaan profitabilitas

```
owner.html → bep.owner.js
  └─ muatDataOwner({ businessUnitId, dari, sampai, outletIds })
     ├─ listSales()            .eq(business_unit_id).in(outlet_id, outletIds)
     ├─ listProductsOwner()    seluruh produk BU (termasuk sale_price BU)
     ├─ listRecipesFull()      → computeCosts() → Map<productId, hpp>
     ├─ listCashEntries()      .in(outlet_id, …)
     └─ listBiayaOutlet()      .in(outlet_id, …)
  └─ hitung()
     ├─ bauranPenjualan({ sales, products, biaya })   ← SELURUH OUTLET DILEBUR
     ├─ ringkasBiayaOutlet(biayaOutlet)               ← SELURUH OUTLET DIJUMLAH
     └─ hitungBep({ marginTertimbang, … })            ← SATU angka untuk semua
```

`js/modules/owner/muat-data.js`

---

## 3. Existing Pricing Logic

### Di mana harga jual dibaca

| Berkas | Baris | Pemakaian |
|---|---|---|
| `0025_sales.sql` | `record_sales()` | **sumber `sales.unit_price`** |
| `product.service.js` | 37, 56, 73, 107 | CRUD master produk |
| `product.admin.page.js` | 290–294, 364, 399 | tabel & form Master Produk |
| `menu.admin.page.js` | 144–153, 421, 476, 502 | tabel Menu (edit harga massal) |
| `owner.service.js` | 84 | `listProductsOwner()` |
| `bep.owner.js` | 599 | `hargaSekarang: p.sale_price` di tabel Pricing |
| `product-import.js`, `import-merge.js` | beberapa | impor xlsx |

**Tujuh tempat**, semuanya mengasumsikan satu harga per produk per BU.

### Yang sudah benar dan tidak boleh dirusak

`bauranPenjualan()` di `bep.js` menghitung harga dari **transaksi**, bukan dari
master:

```js
const omzet = rev != null ? rev : sat != null ? sat * q : null;
const hargaRata = omzet / qty;
```

Ini sudah sesuai #5. Yang salah bukan cara membacanya, melainkan bahwa hasilnya
**dilebur lintas outlet**.

---

## 4. Existing Profitability Logic

`js/modules/owner/bep.js` — tidak ada impor, murni hitungan.

| Fungsi | Masukan | Keluaran | Sadar outlet? |
|---|---|---|---|
| `bauranPenjualan()` | seluruh `sales` + products + HPP | satu `hargaTertimbang`, `hppTertimbang`, `marginTertimbang` | **TIDAK** |
| `ringkasBiayaOutlet()` | seluruh `outlet_costs` | satu `tetapPerBulan`, `variabelPerPorsi`, `variabelPersen` | **TIDAK** |
| `marginSetelahVariabel()` | margin + harga + variabel | margin efektif | tidak relevan |
| `hitungBep()` | margin efektif + biaya tetap | porsi, omzet, harian | **TIDAK** |
| `hitungTarget()` | target 3 arah | porsi, omzet, laba | **TIDAK** |
| `biayaTetapDariKas()` | `cash_entries` + kategori | total biaya tetap | **TIDAK** |

Semua kalkulasi bekerja di atas **satu himpunan data yang sudah dilebur**.
Penyaringan outlet terjadi lebih awal, di query — jadi "per outlet" hari ini
hanya bisa dicapai dengan memuat ulang seluruh halaman untuk satu outlet.

### Pelanggaran #17 yang terjadi hari ini

Dengan "Semua Outlet" dipilih, dan data contoh Anda:

```
Serpong : 1.000 × Rp35.000 = Rp35.000.000
Sentul  :   800 × Rp32.000 = Rp25.600.000
                             ─────────────
                             Rp60.600.000  ÷ 1.800 porsi = Rp33.667/porsi
```

Angka Rp33.667 itu lalu dipakai menghitung **satu** BEP, **satu** margin, dan
**satu** target. Persis yang dilarang.

**Catatan penting:** untuk *omzet* dan *margin kontribusi* agregat, peleburan ini
sebenarnya **tidak salah** — `Σ(qty × harga masing-masing)` tetap benar karena
harga diambil per baris transaksi. Yang salah adalah:
- menampilkan satu "harga jual rata-rata" seolah berlaku di kedua outlet;
- membagi **satu** biaya tetap gabungan dengan **satu** margin gabungan untuk
  menghasilkan BEP — outlet yang sudah untung dan yang masih rugi saling menutupi
  dan keduanya tidak terlihat.

---

## 5. Proposed Architecture

```
business_units
├── products                    MASTER MENU (nama, tipe, satuan, resep)
│   └── sale_price              → DIDEPRECATE, jadi harga acuan/default saja
├── outlets
│   ├── outlet_menu_prices      ← BARU: outlet + produk + harga + berlaku sejak
│   ├── outlet_costs            (sudah ada, ditambah allocation_scope)
│   └── sales                   (sudah punya outlet_id + unit_price historis)
└── business_units.pricing_*    metode penetapan harga (tetap di BU)
```

Prinsip yang dipegang:

- **Master menu milik BU. Harga milik outlet.**
- **Transaksi memegang harganya sendiri** — tidak pernah dibaca ulang dari master.
- **Profitabilitas dihitung per outlet dulu, baru dijumlahkan.**

---

## 6. Proposed Data Model

### 6.1 `outlet_menu_prices` (baru)

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
  effective_to       date,                    -- null = masih berlaku
  is_available       boolean not null default true,

  created_by         uuid references user_profiles(id) on delete set null,
  created_at         timestamptz not null default now()
);
```

**Effective dating dengan `effective_to` nullable**, bukan hanya `effective_from`.
Alasannya: mencari "harga yang berlaku pada tanggal X" dengan hanya
`effective_from` menuntut subquery `max(effective_from) <= X` di setiap
pembacaan — mahal, dan mudah ditulis salah di satu tempat lalu berbeda dari
tempat lain. Dengan `effective_to`, syaratnya satu baris dan sama di mana-mana.

Penjaga yang diperlukan:
- **Tidak boleh ada dua harga aktif** untuk (outlet, produk) pada tanggal yang
  sama → `exclude` constraint dengan `daterange`, atau trigger yang menutup baris
  sebelumnya saat baris baru dibuat.
- `effective_to >= effective_from` bila diisi.
- Outlet harus milik BU yang disebut — trigger yang sama seperti `outlet_costs`.

**Menaikkan harga = menutup baris lama + membuat baris baru**, bukan `UPDATE`.
Ini yang membuat #19 terpenuhi: histori tidak bisa hilang karena tidak pernah
ditimpa.

### 6.2 `outlet_costs` — tambahan

```sql
alter table outlet_costs add column allocation_scope text not null default 'direct_outlet'
  check (allocation_scope in ('direct_outlet', 'shared_bu', 'corporate'));
alter table outlet_costs add column cost_behavior text not null default 'fixed'
  check (cost_behavior in ('fixed', 'semi_variable', 'variable'));
```

`jenis` yang ada sekarang (`tetap`/`variabel`) menjawab **cara masuk rumus**.
`cost_behavior` menjawab **sifat biayanya**. Keduanya berbeda dan keduanya perlu:

| Biaya | `cost_behavior` | `jenis` (rumus BEP) |
|---|---|---|
| Sewa | `fixed` | `tetap` |
| Gaji | `fixed` | `tetap` |
| IPL | `fixed` | `tetap` |
| WiFi | `fixed` | `tetap` |
| Listrik | `semi_variable` | `tetap` |
| Air | `semi_variable` | `tetap` |
| HPP | `variable` | (dari resep, bukan di sini) |
| Packaging | `variable` | `variabel` per porsi |
| Merchant fee | `variable` | `variabel` persen |
| Komisi | `variable` | `variabel` persen |

Listrik & air ditandai `semi_variable` **tetapi tetap masuk BEP sebagai tetap**,
karena memisah komponen tetap dan variabelnya butuh regresi atas data historis
yang belum ada. Penandanya disimpan supaya kelak bisa dipisah tanpa menebak, dan
layar menyebutkan bahwa ia sedang diperlakukan sebagai tetap.

**`shared_bu` / `corporate` butuh aturan alokasi.** Saya usulkan **pro-rata
terhadap omzet outlet**, karena itu satu-satunya dasar yang datanya sudah ada dan
tidak perlu diketik. Alternatifnya (rata dibagi jumlah outlet) membuat outlet
kecil terlihat rugi hanya karena ada outlet besar. **Ini keputusan Anda** — dan
apa pun pilihannya, dasar alokasinya harus tertulis di layar, bukan tersembunyi.

### 6.3 `products.sale_price` — TIDAK dihapus

Dipertahankan sebagai **harga acuan BU** dengan dua fungsi:
1. nilai awal saat outlet baru dibuat atau menu baru ditambahkan;
2. cadangan bila outlet belum punya baris harga sendiri.

Menghapusnya berarti tujuh tempat di §3 harus diubah serentak, dan impor xlsx
yang sudah dipakai akan berhenti bekerja. Kolomnya diberi `comment` yang
menyatakan statusnya, dan audit baru menolak pemakaiannya di jalur profitabilitas.

---

## 7. Proposed Calculation Flow

```
untuk setiap outlet dalam cakupan:
    sales_outlet      = sales difilter outlet
    bauran_outlet     = bauranPenjualan(sales_outlet, products, hpp)
                        → harga & HPP tertimbang MILIK OUTLET INI
    biaya_outlet      = ringkasBiayaOutlet(costs difilter outlet)
                        + alokasi shared/corporate (pro-rata omzet)
    cm_outlet         = revenue_outlet - variable_cost_outlet
    op_outlet         = cm_outlet - fixed_cost_outlet
    bep_outlet        = fixed_cost_outlet / cm_persen_outlet
    gap_outlet        = revenue_outlet - bep_revenue_outlet

konsolidasi (mode "Semua Outlet"):
    Σ revenue, Σ variable, Σ CM, Σ fixed, Σ OP     ← DIJUMLAH, bukan dirata-rata
    weighted avg price ditampilkan sebagai INFORMASI, bertanda jelas,
    dan TIDAK dipakai menghitung apa pun
```

### Tiga konteks, tiga fungsi terpisah

| Konteks | Sumber | Fungsi |
|---|---|---|
| **ACTUAL** | transaksi + biaya nyata | `hitungActualOutlet()` |
| **PROJECTED** | actual ÷ hari berjalan × hari periode | `proyeksiAkhirPeriode()` |
| **SIMULATED** | asumsi yang diketik | `simulasiOutlet()` |

Ketiganya **fungsi berbeda dengan tipe keluaran berbeda**, bukan satu fungsi
dengan flag. Alasannya: flag bisa lupa dibaca di layar, dan angka simulasi yang
lolos ke kartu "Actual" tidak akan terlihat salah oleh siapa pun.

Setiap keluaran membawa `konteks: 'actual' | 'projected' | 'simulated'`, dan
komponen kartu **menolak menggambar** bila konteksnya tidak dikenal — sehingga
angka tanpa label tidak mungkin tampil.

### Projection — batas yang harus dikatakan

`omzet_harian_rata2 × jumlah_hari_periode` mengasumsikan sisa bulan sama dengan
yang sudah lewat. Itu **salah** untuk usaha yang ramai di akhir pekan bila
periodenya baru berjalan di hari kerja. Proyeksi akan diberi keterangan:
jumlah hari yang dipakai, dan peringatan bila hari berjalan < 7.

---

## 8. Migration Plan

| # | Migration | Isi | Risiko |
|---|---|---|---|
| `0096` | `harga_menu_outlet` | tabel `outlet_menu_prices` + constraint + trigger + RLS | rendah — tabel baru |
| `0097` | `isi_harga_outlet_awal` | backfill: satu baris per (outlet aktif × produk finished ber-`sale_price`), `effective_from` = tanggal transaksi paling awal, `effective_to` = null | **sedang** — lihat di bawah |
| `0098` | `sifat_biaya_outlet` | `allocation_scope` + `cost_behavior` di `outlet_costs` | rendah — kolom baru berdefault |
| `0099` | `harga_saat_transaksi` | `record_sales()` membaca `outlet_menu_prices` dulu, jatuh ke `products.sale_price` bila kosong; **dan menolak menyimpan bila harga tidak ada sama sekali** | **tinggi** — lihat §9.1 |

### Backfill (`0097`) — apa yang benar-benar terjadi

Backfill **tidak mengubah transaksi lama**. `sales.unit_price` yang sudah
tersimpan tetap apa adanya, dan itu memang harga yang berlaku waktu itu.

Yang dibuat hanyalah baris harga *mulai sekarang*. Artinya:

- Laporan Agustus tetap memakai harga transaksi Agustus. Benar.
- Tapi **tidak akan pernah bisa diketahui** apakah Serpong dan Sentul dulu
  benar-benar menjual dengan harga yang sama, karena sistem memang tidak
  membedakannya. Data lama **tidak bisa dipulihkan**, hanya bisa dilanjutkan.

Ini perlu Anda sadari sebelum implementasi: pemisahan harga per outlet berlaku
**ke depan**, bukan surut.

---

## 9. Risk Analysis

### 9.1 `coalesce(v_price, 0)` — menurut saya ini lebih mendesak daripada outlet pricing

```sql
select sale_price into v_price from products where id = v_pid;
insert into sales(... unit_price, revenue ...)
  values (..., v_price, coalesce(v_price, 0) * v_qty, ...);
```

Menu yang **belum diisi harga jualnya** tercatat sebagai penjualan dengan
**omzet Rp 0**. Bukan error, bukan penolakan — baris penjualan yang terlihat
normal, qty benar, omzet nol.

Akibatnya berlipat:
- omzet BU lebih rendah dari kenyataan;
- `bauranPenjualan()` menganggapnya harga Rp 0, jadi **margin per porsinya
  negatif sebesar HPP** dan menarik margin tertimbang ke bawah;
- BEP jadi lebih jauh dari kenyataan;
- stoknya tetap terpotong, jadi selisihnya tidak akan ketahuan dari opname.

Ini juga **kandidat penjelasan** kenapa angka di halaman BEP terasa janggal.
Saya sarankan diperiksa lebih dulu, sebelum apa pun diubah:

```sql
select o.name outlet, p.name menu, count(*) baris, sum(s.qty) porsi, s.sale_date
from sales s
join products p on p.id = s.product_id
join outlets  o on o.id = s.outlet_id
where s.unit_price is null or s.unit_price = 0
group by 1,2,5 order by 5 desc limit 50;
```

Kalau ada hasilnya, itu harus dibereskan lebih dulu — dan perbaikannya bukan
mengubah data lama diam-diam, melainkan memutuskan bersama apa yang benar.

### 9.2 Tidak ada penjaga penjualan ganda

`sales` **tidak punya unique constraint** apa pun, dan `record_sales()` selalu
`INSERT`. Mengirim rekap hari yang sama dua kali menghasilkan **dua** baris —
omzet dan pemakaian stok terhitung dobel.

`sales` juga **tidak punya policy UPDATE maupun DELETE**, jadi kelebihannya
tidak bisa diperbaiki dari aplikasi sama sekali. Ini menyentuh langsung prioritas
"NO DOUBLE COUNTING" Anda, dan tidak bisa diselesaikan oleh perubahan pricing.

Saya belum memeriksa apakah layar Staff App mencegahnya secara visual — perlu
dicek sebelum memutuskan bentuk perbaikannya.

### 9.3 `listSalesReport` memotong di 2.000 baris

```js
.limit(2000)
```

`js/modules/sales/sales.service.js:43`. Batas yang ditulis tangan lebih berbahaya
daripada batas bawaan PostgREST, karena ia **terlihat disengaja**. Laporan
penjualan BU yang ramai akan diam-diam kehilangan baris tertua. Harus dipindah ke
`ambilSemua()` seperti pembacaan lain.

### 9.4 Beban query mode "Semua Outlet"

Menghitung per outlet berarti mengelompokkan data di klien. Untuk 5 outlet ×
sebulan penjualan, ini masih ringan — pengelompokan dilakukan sekali atas data
yang sudah diunduh, bukan 5 query terpisah. Tapi begitu outletnya belasan dan
rentangnya setahun, ini perlu pindah ke view/RPC di database.

### 9.5 Harga hilang setelah migrasi

Bila `record_sales()` diubah membaca `outlet_menu_prices` **tanpa** cadangan ke
`products.sale_price`, seluruh penjualan berhenti bekerja di outlet yang belum
punya baris harga. Karena itu `0099` menyertakan cadangan, dan penolakan hanya
terjadi bila **dua-duanya** kosong — menolak lebih baik daripada mencatat Rp 0
(lihat §9.1).

### 9.6 HPP tetap tidak outlet-specific

Resep milik BU (per `mode`, bukan per outlet). Jadi HPP menu yang sama di dua
outlet akan **selalu sama**, walau harga belinya berbeda. Contoh di §16
permintaan Anda memang mengasumsikan HPP sama (Rp15.000 di kedua outlet), jadi
ini konsisten dengan yang Anda minta — tapi perlu dicatat bahwa "profitabilitas
per outlet" yang dihasilkan **hanya membedakan sisi harga jual**, belum sisi
biaya bahan.

---

## 10. Impacted Files

### Database
| Berkas | Perubahan |
|---|---|
| `0096`–`0099` (baru) | tabel harga, backfill, kolom scope, RPC |
| `0025_sales.sql` | **tidak disentuh** — `record_sales()` diganti lewat `create or replace` di `0099` |

### Modul murni (diuji tanpa browser)
| Berkas | Perubahan |
|---|---|
| `js/modules/owner/bep.js` | `bauranPenjualan()` dipecah jadi per outlet; `hitungActualOutlet()`, `konsolidasiOutlet()` baru |
| `js/modules/owner/proyeksi.js` | **baru** — `proyeksiAkhirPeriode()` |
| `js/modules/owner/simulasi.js` | **baru** — dipisah dari `pricing.js` |
| `js/modules/owner/pricing.js` | tetap; hanya dipakai simulasi |
| `js/modules/owner/kpi.js` | menerima hasil per outlet |

### Service
| Berkas | Perubahan |
|---|---|
| `js/modules/owner/harga-outlet.service.js` | **baru** — CRUD harga per outlet |
| `js/modules/owner/muat-data.js` | mengambil harga outlet; mengelompokkan per outlet |
| `js/modules/owner/owner.service.js` | `listSales` mengembalikan `outlet_id` (sudah) |
| `js/modules/sales/sales.service.js` | `listSalesReport` → `ambilSemua` |

### Layar
| Berkas | Perubahan |
|---|---|
| `js/modules/owner/bep.owner.js` | dipecah tiga tab: Actual / Projection / Simulation |
| `js/modules/owner/ringkasan.owner.js` | rincian per outlet |
| `js/modules/menu/menu.admin.page.js` | edit harga **per outlet** (paling besar perubahannya) |
| `js/modules/product/product.admin.page.js` | `sale_price` diberi keterangan "harga acuan" |

### Audit baru
| Berkas | Isi |
|---|---|
| `tools/audit-harga-outlet.cjs` | `products.sale_price` **dilarang** dipakai di jalur profitabilitas |
| `tools/audit-konteks-angka.cjs` | tiap kartu angka wajib membawa `konteks` |

---

## 11. Test Plan

### Modul murni — kasus yang menentukan

| Uji | Harapan |
|---|---|
| Dua outlet, harga beda, menu sama | dua margin berbeda; tidak ada rata-rata tunggal yang dipakai |
| Skenario §21 Anda | Serpong Rp35 jt, Sentul Rp25,6 jt; **tidak ada Rp33.667 di mana pun sebagai dasar hitung** |
| Konsolidasi | Σ per outlet **persis sama** dengan total; selisih 0 |
| Outlet A untung, B rugi | BEP masing-masing benar; konsolidasi tidak menyembunyikan B |
| Harga naik di tengah periode | transaksi sebelum & sesudah memakai harganya masing-masing |
| Biaya `shared_bu` | terbagi pro-rata omzet; Σ alokasi = biaya aslinya (tidak hilang, tidak dobel) |
| Proyeksi 20 dari 31 hari | `actual/20×31`; ditandai `projected` |
| Proyeksi hari berjalan 0 | `null`, bukan pembagian nol |
| Simulasi | tidak pernah mengubah nilai actual pada objek yang sama |
| `unit_price = 0` | dikeluarkan dari bauran **dan dilaporkan**, tidak dianggap harga nol |

### Sabotase yang harus merah

1. `bauranPenjualan()` dikembalikan melebur outlet → uji dua-outlet merah.
2. Konsolidasi memakai rata-rata alih-alih Σ → uji selisih-nol merah.
3. Alokasi `shared_bu` dibagi rata → uji pro-rata merah.
4. Proyeksi dilabeli `actual` → uji konteks merah.
5. `record_sales()` kembali membaca `products.sale_price` → uji harga-outlet merah.
6. `coalesce(v_price, 0)` dikembalikan → uji penolakan merah.

### Migration
Dijalankan di PGlite (Postgres sungguhan) seperti `0093`–`0095`: dua skenario
(database bersih & database berisi data lama), idempoten, dan setiap constraint
diuji satu per satu.

---

## 12. Yang perlu Anda putuskan sebelum saya mulai

1. **Alokasi biaya `shared_bu` / `corporate`** — pro-rata omzet, rata per outlet,
   atau tidak dialokasikan sama sekali (ditampilkan terpisah di tingkat BU)?
2. **Harga dimasukkan di mana** — Admin Portal (Menu per outlet), halaman Owner,
   atau keduanya?
3. **Apakah harga boleh diketik saat mencatat penjualan** (untuk promo dadakan),
   atau selalu mengikuti daftar harga outlet?
4. **§9.1 dan §9.2 dikerjakan lebih dulu atau bersamaan?** Menurut saya lebih
   dulu — outlet pricing yang dibangun di atas data yang mengandung omzet Rp 0
   dan kemungkinan baris ganda akan menghasilkan angka yang tetap salah, hanya
   dengan pemisahan yang lebih rapi.
