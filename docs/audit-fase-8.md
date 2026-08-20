# Audit Singkat sebelum Phase 8A

**Status: audit. Phase 8A dikerjakan sesudah ini.**

---

## 1. Fungsi profitabilitas yang dipakai sekarang

Semuanya di `js/modules/owner/`, tanpa impor DOM:

| Fungsi | Berkas | Peran |
|---|---|---|
| `bauranPenjualan({sales, products, biaya})` | `bep.js:101` | rata-rata harga & HPP tertimbang |
| `ringkasBiayaOutlet(daftar)` | `bep.js:312` | jumlahkan `outlet_costs` |
| `marginSetelahVariabel(...)` | `bep.js:351` | margin sesudah biaya variabel |
| `hitungBep(...)` | `bep.js:203` | titik impas |
| `hitungTarget(...)` | `bep.js:376` | target tiga arah |
| `posisiTerhadapBep(...)` | `bep.js:283` | sudah lewat BEP atau belum |
| `biayaTetapDariKas(...)` | `bep.js:61` | biaya tetap dari buku kas |
| `kpiPenjualan/Operasional/Kepatuhan/Keuangan`, `ringkasanOwner` | `kpi.js` | KPI |

Perakitannya di `muat-data.js#hitung()`.

## 2. Formula CM/BEP sekarang

```
margin kotor   = hargaTertimbang − hppTertimbang        (keduanya rata-rata SELURUH outlet)
margin efektif = margin kotor − variabelPerPorsi − harga × variabelPersen/100
BEP porsi      = (biayaTetap + targetLaba) / margin efektif
BEP omzet      = BEP porsi × hargaTertimbang
```

Tidak ada konsep Contribution Margin sebagai **nilai rupiah total** — yang ada hanya margin per porsi. §G menuntut `CM = Revenue − Total Variable Cost`, jadi ini perlu ditambahkan, bukan diganti.

## 3. Bagian yang masih mencampur outlet

Tiga tempat, dan semuanya melebur **sebelum** perhitungan:

- `bauranPenjualan()` — kata "outlet" tidak muncul sama sekali di `bep.js`. Penyaringan outlet terjadi di *query*.
- `ringkasBiayaOutlet()` — menjumlahkan biaya semua outlet jadi satu.
- `muat-data.js#hitung()` — menghasilkan **satu** himpunan angka.

Akibatnya di mode "Semua Outlet": satu biaya tetap gabungan dibagi satu margin gabungan. Outlet yang untung dan yang rugi saling menutupi, dan keduanya tidak terlihat.

**Catatan penting:** untuk *omzet* dan *CM total*, peleburan ini sebenarnya **tidak salah** — `Σ(qty × harga masing-masing)` tetap benar karena harga diambil per baris transaksi. Yang salah adalah menampilkan satu "harga rata-rata" seolah berlaku, dan membagi satu biaya tetap dengan satu margin gabungan.

## 4. Bagian yang masih memakai harga BU

**Sudah tidak ada** di jalur profitabilitas. `owner.service.js#listProductsOwner()` berhenti mengambil `sale_price`, dan `audit-harga-outlet.cjs` menjaganya (143 berkas, 37 pemakaian sah).

Tabel simulasi harga di `bep.owner.js` sudah membaca `outlet_menu_prices`, dan menampilkan "beragam per outlet" bila outletnya berbeda-beda.

## 5. Sumber HPP

`computeCosts(products, recipes)` di `product/hpp.js` — rekursif, memoized, sadar mode (`standalone` / `served_by_ck` / `production`), dengan penjaga siklus. **Dipakai kembali apa adanya**, tidak ada formula baru.

Diperiksa: **`computeCosts` TIDAK memuat packaging.** Ia murni resep + harga beli. Jadi menambahkan packaging sebagai biaya variabel **bukan** double counting.

## 6. Sumber biaya variabel

| Komponen | Sumber sekarang | Rencana |
|---|---|---|
| HPP | `computeCosts()` | tetap |
| Packaging | `products.packaging_cost` (**BU**) | `outlet_menu_prices.packaging_cost` (**outlet**) |
| Merchant fee | `outlet_costs` `variabel` + `persen_omzet` | tetap |
| Komisi | sama seperti merchant fee | tetap |
| Consumable | `outlet_costs` `variabel` + `per_porsi` | tetap |

### ⚠ Risiko double counting yang nyata

`outlet_menu_prices.fee_online_percent` **dan** `outlet_costs` (`variabel`, `persen_omzet`) sama-sama mewakili potongan marketplace. Memakai keduanya di Actual = dihitung dua kali.

Dan ada alasan kedua yang lebih menentukan: **`sales` tidak punya kolom kanal** (dine-in vs online). Menerapkan `fee_online_percent` ke seluruh penjualan berarti menganggap semuanya online — salah untuk kafe yang sebagian besar dine-in.

**Keputusan:** di **Actual**, potongan hanya dari `outlet_costs`. `fee_online_percent` dan `promo_percent` tetap milik **Simulation** (Pricing Engine), yang memang menghitung harga *seandainya*. Ini akan dijaga tes.

## 7. Sumber biaya tetap/operasional

`outlet_costs` (`jenis='tetap'`, `satuan='per_bulan'`), dengan cadangan ke `biayaTetapDariKas()` bila daftarnya kosong.

### ⚠ `allocation_scope` BELUM ADA

Saya mengusulkannya di audit sebelumnya tapi **tidak mengimplementasikannya**: `0095` hanya punya `jenis` + `satuan`. §H menuntut tiga cakupan, jadi perlu migration `0100`.

Sekaligus masalah bentuk: `outlet_costs.outlet_id` sekarang **NOT NULL**. Biaya `shared_bu` dan `corporate` tidak menempel pada outlet mana pun — memaksanya memilih satu outlet akan membuatnya terhitung di profitabilitas outlet itu, yaitu persis yang §H larang.

## 8. Report/KPI terdampak

`kpi.js` (empat kelompok + `ringkasanOwner`), `ringkasan.owner.js`, `bep.owner.js`, dan `report/report.service.js`. Semuanya menerima angka yang sudah dilebur.

## 9. Berkas yang akan diubah — Phase 8A saja

| Berkas | Perubahan |
|---|---|
| `supabase/migrations/0100_cakupan_biaya.sql` | **baru** — `allocation_scope`, `cost_behavior`, `outlet_id` nullable + constraint |
| `js/modules/owner/profit-outlet.js` | **baru** — mesin hitung per outlet |
| `tools/test-profit-outlet.mjs` | **baru** — 12 uji dari §W |

**Tidak disentuh di 8A:** `bep.js`, `kpi.js`, `muat-data.js`, seluruh layar. Mesin lama tetap hidup sampai 8B menggantinya — supaya kalau angkanya berbeda, keduanya bisa dibandingkan.

## 10. Calculation flow baru

```
untuk tiap outlet:
    baris    = sales difilter outlet ini
    revenue  = Σ sales.revenue                     ← SNAPSHOT, bukan harga master
    units    = Σ sales.qty
    variabel = Σ(qty × hpp)  +  Σ(qty × kemasan outlet)
             + Σ(qty × biaya variabel per porsi)
             + revenue × Σ(persen omzet)/100
    CM       = revenue − variabel
    fixed    = Σ outlet_costs (tetap, allocation_scope = direct_outlet, outlet ini)
    OP       = CM − fixed
    BEP omzet= fixed / (CM/revenue)
    BEP unit = fixed / (CM/units)

konsolidasi = Σ tiap kolom dari hasil per outlet   ← BUKAN rata-rata
ASP tertimbang = Σrevenue / Σunits                 ← INFORMASI SAJA, ditandai

BU:
    OP sebelum shared = Σ OP outlet
    − shared_bu
    = BU profit setelah shared
    corporate ditampilkan terpisah
```

## Batas ketelitian historis yang harus dikatakan

Hanya **revenue** yang benar-benar historis (`sales.revenue`, snapshot saat transaksi).

**HPP dan packaging dihitung dari master SEKARANG.** Mengubah harga beli bahan hari ini akan mengubah CM bulan lalu. Itu sudah begitu sejak sebelum revisi ini — bukan kemunduran — tapi karena Anda meminta *historical accuracy*, ia harus disebut. Memperbaikinya butuh snapshot HPP per transaksi, dan itu pekerjaan tersendiri di luar 8–10.
