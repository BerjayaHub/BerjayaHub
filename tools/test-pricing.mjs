/**
 * Pricing Engine.
 *
 * Yang paling ditekankan: MASUKAN YANG MEMBUAT PEMBAGI NOL.
 *
 * Di aplikasi asalnya (Project Hub), margin 100% menghasilkan `Infinity` dan
 * angka itu diteruskan ke layar sebagai harga jual. `Infinity` tidak terlihat
 * seperti error — ia terlihat seperti harga yang sangat besar, dan orang akan
 * mengira dirinya salah ketik persentase, bukan mengira aplikasinya rusak.
 *
 * Setiap rumus di sini wajib mengembalikan `null` untuk masukan seperti itu,
 * dan tes di bawah yang memastikannya.
 */
const { hargaDariHpp, hargaOnline, foodCostAktual, ringkasHarga, METODE, LABEL_METODE } = await import(
  '../js/modules/owner/pricing.js'
);

let gagal = 0;
const cek = (nama, dapat, harap) => {
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};
const dekat = (nama, dapat, harap, toleransi = 1e-9) => {
  if (dapat == null || Math.abs(dapat - harap) > toleransi) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${dapat}\n   harap : ${harap}`);
  }
};

// =====================================================================
// FOOD COST — harga = HPP / persen
// =====================================================================
dekat('food cost 35%: HPP 3500 -> 10000', hargaDariHpp('food_cost', 3500, 35), 10000);
dekat('food cost 50%: HPP 5000 -> 10000', hargaDariHpp('food_cost', 5000, 50), 10000);
dekat('food cost 100%: harga = HPP (jual seharga modal)', hargaDariHpp('food_cost', 8000, 100), 8000);

// >100% berarti dijual DI BAWAH modal. Itu kadang disengaja (menu pancingan),
// jadi tidak ditolak — hanya menghasilkan harga yang lebih kecil dari HPP.
dekat('food cost 200%: harga di bawah HPP, tetap dihitung', hargaDariHpp('food_cost', 8000, 200), 4000);

cek('food cost 0%: null, BUKAN Infinity', hargaDariHpp('food_cost', 3500, 0), null);
cek('food cost negatif: null', hargaDariHpp('food_cost', 3500, -10), null);

// =====================================================================
// MARKUP — harga = HPP x (1 + persen)
// =====================================================================
dekat('markup 100%: HPP 5000 -> 10000', hargaDariHpp('markup', 5000, 100), 10000);
dekat('markup 0%: harga = HPP', hargaDariHpp('markup', 5000, 0), 5000);
dekat('markup 250%: HPP 4000 -> 14000', hargaDariHpp('markup', 4000, 250), 14000);
cek('markup negatif: null', hargaDariHpp('markup', 5000, -1), null);

// =====================================================================
// MARGIN — harga = HPP / (1 - persen)
// =====================================================================
dekat('margin 60%: HPP 4000 -> 10000', hargaDariHpp('margin', 4000, 60), 10000);
dekat('margin 0%: harga = HPP', hargaDariHpp('margin', 4000, 0), 4000);

// INI YANG DIJAGA. 100% = pembagi nol.
cek('margin 100%: null, BUKAN Infinity', hargaDariHpp('margin', 4000, 100), null);
cek('margin 150%: null (harga akan negatif)', hargaDariHpp('margin', 4000, 150), null);
cek('margin 99.99% masih boleh', typeof hargaDariHpp('margin', 4000, 99.99), 'number');

// =====================================================================
// FOOD COST DAN MARGIN ADALAH RUMUS YANG SAMA DILIHAT DARI DUA ARAH
//
// food_cost 35% harus menghasilkan harga yang PERSIS SAMA dengan margin 65%.
// Kalau suatu saat salah satunya diubah tanpa yang lain, tes ini yang jatuh.
// =====================================================================
dekat('food cost 35% == margin 65%', hargaDariHpp('food_cost', 3500, 35), hargaDariHpp('margin', 3500, 65), 1e-9);
dekat('food cost 40% == margin 60%', hargaDariHpp('food_cost', 9000, 40), hargaDariHpp('margin', 9000, 60), 1e-9);

// =====================================================================
// MASUKAN RUSAK
// =====================================================================
cek('metode tak dikenal: null', hargaDariHpp('entah', 3500, 35), null);
cek('metode null: null', hargaDariHpp(null, 3500, 35), null);
cek('HPP null: null', hargaDariHpp('food_cost', null, 35), null);
cek('HPP bukan angka: null', hargaDariHpp('food_cost', 'mahal', 35), null);
cek('HPP negatif: null', hargaDariHpp('food_cost', -100, 35), null);
cek('persen null: null', hargaDariHpp('food_cost', 3500, null), null);
cek('HPP 0 boleh (barang gratis)', hargaDariHpp('food_cost', 0, 35), 0);

// =====================================================================
// HARGA ONLINE
//
// Arahnya yang paling sering salah dikira: fee 20% TIDAK ditutup dengan
// menaikkan harga 20%.
// =====================================================================
dekat('fee 20%: 10000 -> 12500 (bukan 12000)', hargaOnline(10000, { feePersen: 20 }), 12500);
dekat('tanpa potongan: harga tetap', hargaOnline(10000), 10000);
dekat('promo 10% + fee 20%: 10000 -> 13888.88...', hargaOnline(10000, { feePersen: 20, promoPersen: 10 }), 10000 / (0.9 * 0.8), 1e-6);

// Urutannya tidak boleh berpengaruh — perkalian bersifat komutatif, dan kalau
// suatu saat rumusnya diubah jadi pengurangan berurutan, tes ini yang jatuh.
dekat(
  'promo & fee bisa ditukar tempat',
  hargaOnline(10000, { feePersen: 20, promoPersen: 10 }),
  hargaOnline(10000, { feePersen: 10, promoPersen: 20 }),
  1e-9
);

cek('fee 100%: null (semua uangnya hilang)', hargaOnline(10000, { feePersen: 100 }), null);
cek('promo 100%: null (digratiskan)', hargaOnline(10000, { promoPersen: 100 }), null);
cek('fee negatif: null', hargaOnline(10000, { feePersen: -5 }), null);
cek('harga null: null', hargaOnline(null, { feePersen: 20 }), null);

// =====================================================================
// FOOD COST AKTUAL
// =====================================================================
dekat('HPP 3500 dari harga 10000 = 35%', foodCostAktual(3500, 10000), 35);
cek('harga 0: null, bukan Infinity', foodCostAktual(3500, 0), null);
cek('harga null: null', foodCostAktual(3500, null), null);
cek('HPP null: null', foodCostAktual(null, 10000), null);

// =====================================================================
// RINGKAS SATU BARIS
// =====================================================================
const baris = ringkasHarga({ hpp: 3000, kemasan: 500, metode: 'food_cost', persen: 35, hargaSekarang: 12000 });
dekat('kemasan ikut masuk HPP', baris.hppTotal, 3500);
dekat('saran dari HPP+kemasan', baris.hargaSaran, 10000);
dekat('selisih bertanda: lebih mahal dari saran -> positif', baris.selisih, 2000);
cek('tidak ada sebab saat semuanya lengkap', baris.sebab, null);

const murah = ringkasHarga({ hpp: 3500, metode: 'food_cost', persen: 35, hargaSekarang: 8000 });
dekat('harga di bawah saran -> selisih NEGATIF', murah.selisih, -2000);

// HPP KOSONG TIDAK BOLEH JADI 0.
//
// Kalau `hpp: null` diperlakukan sebagai 0, `hppTotal` akan sama dengan biaya
// kemasan saja dan `hargaSaran` menjadi angka kecil yang terlihat wajar —
// lalu dipakai orang menetapkan harga jual di bawah modal.
const tanpaHpp = ringkasHarga({ hpp: null, kemasan: 500, metode: 'food_cost', persen: 35, hargaSekarang: 12000 });
cek('HPP kosong: hppTotal null, BUKAN 500', tanpaHpp.hppTotal, null);
cek('HPP kosong: tidak ada saran harga', tanpaHpp.hargaSaran, null);
cek('HPP kosong: sebabnya dikatakan', tanpaHpp.sebab, 'HPP belum bisa dihitung');
cek('HPP kosong: selisih tidak dikarang', tanpaHpp.selisih, null);

const persenNgawur = ringkasHarga({ hpp: 3500, metode: 'margin', persen: 100, hargaSekarang: 12000 });
cek('persen tak masuk akal: saran null', persenNgawur.hargaSaran, null);
cek('persen tak masuk akal: sebabnya beda dengan HPP kosong', persenNgawur.sebab, 'Persentase harga belum masuk akal');

// Harga sekarang boleh kosong (produk baru) tanpa merusak sisanya.
const belumBerharga = ringkasHarga({ hpp: 3500, metode: 'food_cost', persen: 35 });
dekat('produk belum berharga: saran tetap ada', belumBerharga.hargaSaran, 10000);
cek('produk belum berharga: selisih null', belumBerharga.selisih, null);
cek('produk belum berharga: food cost aktual null', belumBerharga.foodCostSekarang, null);

// Harga online ikut dihitung dari SARAN, bukan dari harga sekarang.
const online = ringkasHarga({ hpp: 3500, metode: 'food_cost', persen: 35, feePersen: 20 });
dekat('harga online saran = saran / (1-fee)', online.hargaOnlineSaran, 12500);

// =====================================================================
// DAFTAR METODE & LABEL HARUS SEJALAN
//
// Kalau metode baru ditambahkan tapi labelnya lupa, dropdown di layar akan
// menampilkan `undefined` sebagai nama pilihan.
// =====================================================================
for (const m of METODE) {
  if (!LABEL_METODE[m]) {
    gagal++;
    console.error(`❌ metode '${m}' tidak punya label`);
  }
  if (hargaDariHpp(m, 1000, 50) == null) {
    gagal++;
    console.error(`❌ metode '${m}' terdaftar tapi tidak menghasilkan harga pada masukan wajar`);
  }
}
cek('jumlah label sama dengan jumlah metode', Object.keys(LABEL_METODE).length, METODE.length);

console.log(gagal === 0 ? '✅ pricing: semua lulus' : `❌ pricing: ${gagal} gagal`);
process.exit(gagal === 0 ? 0 : 1);
