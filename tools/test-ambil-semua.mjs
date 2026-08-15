/**
 * Pengambilan data bertahap.
 *
 * KENAPA INI ADA. PostgREST memotong jawaban di sekitar 1.000 baris kalau tidak
 * diminta lain — dan potongan itu BUKAN error. `listRecipesFull()` mengambil
 * seluruh `recipe_items` satu BU sekaligus; begitu bahannya lewat seribu baris,
 * resep yang berada di belakang antrean pulang tanpa bahan. Layarnya menulis
 * "Resep ini kosong — bahannya tidak pernah tersimpan", padahal di database
 * bahannya lengkap, dan editor (yang bertanya per resep) menampilkannya utuh.
 *
 * Dua layar, satu database, isi berbeda — dan tidak ada satu pun error yang
 * bisa dipakai menemukannya.
 *
 * Server tiruannya di sini SENGAJA berperilaku seperti aslinya: ia memotong di
 * batas maksimum walau diminta lebih. Tes yang servernya jujur mengembalikan
 * semua yang diminta tidak akan pernah menangkap bug ini.
 */
import { ambilSemua, ambilPerPotong, UKURAN_HALAMAN } from '../js/core/ambil-semua.js';

let gagal = 0;
const cek = (nama, dapat, harap) => {
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};

/**
 * Server tiruan: punya `total` baris, tapi tidak pernah mengirim lebih dari
 * `batas` sekaligus — persis seperti PostgREST.
 *
 * `denganCount` meniru `{ count: 'exact' }`: server ikut memberi tahu jumlah
 * seluruhnya, sehingga permintaan penutup tidak diperlukan.
 */
function server(total, { batas = 1000, denganCount = false } = {}) {
  const panggilan = [];
  const minta = async (dari, sampai) => {
    panggilan.push([dari, sampai]);
    const akhir = Math.min(sampai, dari + batas - 1, total - 1);
    const data = [];
    for (let i = dari; i <= akhir; i++) data.push({ n: i });
    return { data, error: null, ...(denganCount ? { count: total } : {}) };
  };
  return { minta, panggilan };
}

// ---- Yang kecil tetap satu permintaan ----
// Kalau tidak, tiap layar kecil ikut membayar permintaan tambahan.
// Tanpa `count`, satu-satunya cara aman berhenti adalah menunggu halaman
// kosong — jadi ada satu permintaan penutup. Itu harga yang dibayar untuk tidak
// menebak setelan server.
const kecil = server(10);
cek('10 baris terambil semua', (await ambilSemua(kecil.minta)).length, 10);
cek('tanpa count: ada permintaan penutup', kecil.panggilan.length, 2);

// DENGAN `count` (yaitu `{ count: 'exact' }` di sisi Supabase), server memberi
// tahu jumlah seluruhnya, jadi berhenti tepat waktu tanpa permintaan tambahan.
const kecilCount = server(10, { denganCount: true });
cek('dengan count: tetap utuh', (await ambilSemua(kecilCount.minta)).length, 10);
cek('dengan count: cukup satu permintaan', kecilCount.panggilan.length, 1);

const besarCount = server(2500, { denganCount: true });
cek('dengan count: 2500 baris utuh', (await ambilSemua(besarCount.minta)).length, 2500);
// 2500 / 500 = 5 halaman, tanpa penutup.
cek('dengan count: tanpa permintaan penutup', besarCount.panggilan.length, 5);

// `count` TIDAK BOLEH membuat pengambilan berhenti sebelum waktunya kalau
// server ternyata mengirim lebih sedikit per halaman daripada yang diminta.
const sempitCount = server(1200, { batas: 300, denganCount: true });
cek('count + batas server sempit tetap utuh', (await ambilSemua(sempitCount.minta)).length, 1200);

// ---- Tepat sebesar satu halaman: BUTUH permintaan kedua ----
// Halaman yang penuh tidak bisa dibedakan dari "masih ada lagi", jadi harus
// ditanya sekali lagi. Berhenti di sini adalah cara paling halus kehilangan
// data: persis kelipatan ukuran halaman yang hilang seluruh sisanya.
const pas = server(UKURAN_HALAMAN);
cek('tepat satu halaman tetap utuh', (await ambilSemua(pas.minta)).length, UKURAN_HALAMAN);
cek('ditanya sekali lagi untuk memastikan', pas.panggilan.length, 2);

// ---- Server yang batasnya LEBIH KECIL dari ukuran halaman kita ----
// Ini yang menjatuhkan versi pertama: ia berhenti begitu halamannya "kurang
// dari yang diminta", padahal server boleh punya batas sendiri. Kalau PostgREST
// dipasang memotong di 300 sementara kita meminta 500, halaman pertama pulang
// 300, dianggap habis, dan sisanya hilang diam-diam — persis bug aslinya,
// cuma dengan angka yang berbeda.
const sempitAwal = server(1200, { batas: 300 });
cek('server berbatas lebih sempit tetap utuh', (await ambilSemua(sempitAwal.minta)).length, 1200);

// ---- Lebih dari batas server: inilah bug aslinya ----
const besar = server(2500);
const hasil = await ambilSemua(besar.minta);
cek('2500 baris terambil semua, bukan 1000', hasil.length, 2500);
cek('baris pertama benar', hasil[0], { n: 0 });
cek('baris terakhir benar', hasil[2499], { n: 2499 });
// Tidak ada baris yang terlewat maupun terhitung dua kali di batas halaman —
// kesalahan indeks satu langkah di sini menghasilkan data yang JUMLAHNYA benar
// tapi isinya bergeser, dan itu tidak akan pernah terlihat di layar.
cek('tidak ada yang bolong atau ganda', new Set(hasil.map((h) => h.n)).size, 2500);

// Server yang batasnya lebih kecil dari ukuran halaman kita tetap harus utuh.
cek('nol baris aman', (await ambilSemua(server(0).minta)).length, 0);

// ---- Error diteruskan, tidak ditelan ----
let kenaError = false;
try {
  await ambilSemua(async () => ({ data: null, error: new Error('jaringan putus') }));
} catch (e) {
  kenaError = e.message === 'jaringan putus';
}
cek('error tidak ditelan', kenaError, true);

// ---- Server yang mengabaikan penomoran halaman ----
// Tanpa batas putaran, aplikasinya menggantung selamanya — kegagalan yang jauh
// lebih buruk daripada data yang kurang, karena tidak ada apa pun di layar.
let berhenti = false;
try {
  await ambilSemua(async () => ({ data: Array.from({ length: UKURAN_HALAMAN }, (_, i) => ({ n: i })), error: null }));
} catch (e) {
  berhenti = e.message.includes('mengabaikan penomoran halaman');
}
cek('server yang mengabaikan range dihentikan', berhenti, true);

// ================= Pemecahan daftar id =================
// Seribu UUID di query string menghasilkan URL puluhan kilobyte, dan itu
// ditolak sebagian perantara jaringan dengan galat yang tidak menyebut sebabnya.

const ids = Array.from({ length: 450 }, (_, i) => `id-${i}`);
const potonganDilihat = [];
const gabungan = await ambilPerPotong(ids, async (potongan) => {
  potonganDilihat.push(potongan.length);
  return potongan.map((id) => ({ id }));
});
cek('semua id terlayani', gabungan.length, 450);
cek('dipecah jadi beberapa permintaan', potonganDilihat, [200, 200, 50]);
cek('urutannya terjaga', gabungan[0].id + '|' + gabungan[449].id, 'id-0|id-449');
// Tidak ada id yang hilang di sambungan antar potongan.
cek('tidak ada id yang terlewat', new Set(gabungan.map((g) => g.id)).size, 450);

cek('daftar kosong tidak memanggil apa pun', await ambilPerPotong([], async () => { throw new Error('tidak boleh dipanggil'); }), []);
cek('daftar null aman', await ambilPerPotong(null, async () => []), []);
cek('kurang dari satu potong tetap satu permintaan', (await ambilPerPotong(['a', 'b'], async (p) => p)).length, 2);

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('Pengambilan bertahap benar untuk 26 kasus — termasuk saat server memotong di 1.000 baris. ✅');
