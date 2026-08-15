/**
 * Mencocokkan TEMPLATE IMPOR dengan kolom yang benar-benar dibaca penguraiannya.
 *
 * KENAPA INI PERLU DIPERIKSA MESIN. Kalau template dan pengurai menyimpang,
 * tidak ada yang error: kolom yang tidak dikenali cuma diabaikan, dan barisnya
 * masuk dengan kolom itu kosong. Impornya dilaporkan "berhasil". Yang terjadi
 * berikutnya adalah orang mengisi seratus baris harga di kolom yang tidak
 * pernah dibaca siapa pun, lalu menemukan HPP-nya tetap kosong dan menyangka
 * perhitungannya yang rusak.
 *
 * Menyimpangnya mudah sekali: mengganti judul kolom di template (mis.
 * memperjelas "Harga Beli" jadi "Harga Beli (per Satuan Beli)") adalah satu
 * baris teks yang terlihat tidak berbahaya, dan tidak ada satu pun tes yang
 * membaca berkas CSV itu.
 *
 * Tiga hal yang diperiksa:
 *   1. tiap kolom yang DIBACA pengurai ada di template;
 *   2. tiap kolom di template DIBACA oleh pengurai (kolom hiasan yang tidak
 *      berpengaruh apa-apa lebih buruk daripada tidak ada kolomnya);
 *   3. tiap baris contoh punya jumlah kolom yang sama dengan judulnya —
 *      kelebihan/kekurangan satu koma menggeser SEMUA nilai sesudahnya, dan
 *      hasilnya terlihat seperti data yang salah ketik, bukan template yang rusak.
 */

const fs = require('fs');
const path = require('path');

const BERKAS = path.join(__dirname, '..', 'js', 'modules', 'product', 'product-import.js');
const src = fs.readFileSync(BERKAS, 'utf8');

/** Kolom yang dibaca sebuah fungsi impor: r['...'] di dalam badannya. */
function kunciDibaca(namaFungsi) {
  const awal = src.indexOf(`export async function ${namaFungsi}`);
  if (awal === -1) throw new Error(`Fungsi ${namaFungsi} tidak ditemukan`);
  // Sampai `export` berikutnya — cukup untuk memisahkan importProducts dari
  // importRecipes tanpa perlu mem-parse blok.
  let akhir = src.indexOf('\nexport ', awal + 10);
  if (akhir === -1) akhir = src.length;
  const badan = src.slice(awal, akhir);
  const kunci = new Set();
  for (const m of badan.matchAll(/r\['([^']+)'\]/g)) kunci.add(m[1]);
  return kunci;
}

/** Isi template: baris pertama judul, sisanya contoh. */
function template(namaBerkasCsv) {
  const i = src.indexOf(`'${namaBerkasCsv}'`);
  if (i === -1) throw new Error(`Template ${namaBerkasCsv} tidak ditemukan`);
  const potong = src.slice(i, src.indexOf('  );', i));
  const baris = [...potong.matchAll(/'((?:[^'\\]|\\.)*)\\n'/g)].map((m) => m[1].replace(/\\'/g, "'"));
  if (!baris.length) throw new Error(`Isi template ${namaBerkasCsv} tidak terbaca`);
  return baris;
}

let masalah = 0;
const lapor = (s) => {
  masalah++;
  console.error(`❌ ${s}`);
};

/**
 * @param {string} judul       nama template untuk pesan
 * @param {string} berkasCsv   nama berkas di downloadCsv()
 * @param {Set<string>} dibaca kolom yang dibaca pengurainya
 * @param {string[]} [abaikan] kolom yang memang boleh ada tanpa dibaca, dengan alasan
 * @param {Set<string>} [alias] kolom yang dibaca lewat pembantu, bukan r['...']
 *
 * `alias` berlaku untuk KEDUA arah pemeriksaan. Versi pertama audit ini hanya
 * memakainya di arah pertama, sehingga kolom "Harga Beli (per Satuan Beli)" —
 * yang dibaca lewat `hargaBeli()` — dilaporkan sebagai kolom hiasan. Dua temuan
 * palsu di jalan pertama sudah cukup untuk membuat orang menganggap audit ini
 * cerewet dan berhenti membacanya.
 */
function periksa(judul, berkasCsv, dibacaAsli, { abaikan = [], alias = new Set() } = {}) {
  const dibaca = new Set([...dibacaAsli, ...alias]);
  const baris = template(berkasCsv);
  const kolom = baris[0].split(',').map((s) => s.trim());
  const kolomKecil = kolom.map((s) => s.toLowerCase());

  // 1. Yang dibaca harus ada di template.
  for (const k of dibaca) {
    // Ejaan alternatif memang tidak wajib ada di template — yang wajib ada
    // hanya salah satunya, dan itu terjamin oleh arah pemeriksaan kedua.
    if (alias.has(k)) continue;
    if (!kolomKecil.includes(k)) {
      lapor(`${judul}: pengurai membaca kolom "${k}" tapi template tidak punya kolom itu`);
    }
  }

  // 2. Yang ada di template harus dibaca.
  for (const [i, k] of kolomKecil.entries()) {
    if (dibaca.has(k) || abaikan.includes(k)) continue;
    lapor(`${judul}: kolom "${kolom[i]}" ada di template tapi tidak pernah dibaca pengurai — orang akan mengisinya sia-sia`);
  }

  // 3. Jumlah kolom tiap baris contoh.
  for (const [i, b] of baris.slice(1).entries()) {
    const n = b.split(',').length;
    if (n !== kolom.length) {
      lapor(`${judul}: baris contoh ke-${i + 1} punya ${n} kolom, judulnya ${kolom.length} — satu koma lebih/kurang menggeser semua nilai sesudahnya`);
    }
  }
  console.log(`   ${judul}: ${kolom.length} kolom, ${baris.length - 1} baris contoh`);
}

const kunciProduk = kunciDibaca('importProducts');
const kunciResep = kunciDibaca('importRecipes');

periksa('template-produk', 'template-produk.csv', kunciProduk, {
  // Dibaca lewat `hargaBeli()` yang menerima judul lama DAN baru, jadi tidak
  // muncul sebagai r['...'] di badan fungsinya.
  alias: new Set(['harga beli', 'harga beli (per satuan beli)', 'subkategori'])
});
periksa('template-menu', 'template-menu.csv', kunciProduk, {
  alias: new Set(['harga beli', 'harga beli (per satuan beli)', 'subkategori']),
  // Template menu memakai jalur impor yang SAMA, jadi kolomnya sama persis.
  // Kolom bahan-baku dibiarkan ada supaya satu berkas bisa memuat menu dan
  // bahan sekaligus kalau orangnya mau — bukan karena terlupa.
  abaikan: []
});
periksa('template-resep', 'template-resep.csv', kunciResep);

// Kolom harga beli harus dibaca lewat kedua ejaan, kalau tidak, berkas lama
// yang sudah beredar di WhatsApp diam-diam kehilangan kolom harganya.
if (!/harga beli \(per satuan beli\)/.test(src) || !/\br\['harga beli'\]/.test(src.replace(/\(per satuan beli\)/g, ''))) {
  if (!src.includes("r['harga beli (per satuan beli)'] ?? r['harga beli']")) {
    lapor('Kolom harga beli tidak menerima kedua ejaan — berkas lama akan kehilangan harganya tanpa pesan apa pun');
  }
}

// Keterangan kolom di dialog impor harus menyebut judul yang SAMA dengan
// template. Kalau berbeda, orang membuat sendiri berkasnya menurut keterangan
// itu, dan kolomnya tidak pernah terbaca.
const halaman = fs.readFileSync(path.join(__dirname, '..', 'js', 'modules', 'product', 'product.admin.page.js'), 'utf8');
const judulProduk = template('template-produk.csv')[0].split(',').map((s) => s.trim());
const ket = halaman.match(/'Kolom: ([^']+)\./);
if (!ket) lapor('Keterangan kolom di dialog impor produk tidak ditemukan');
else {
  const disebut = ket[1].split(',').map((s) => s.trim());
  for (const k of judulProduk) {
    if (!disebut.some((d) => d.toLowerCase() === k.toLowerCase())) {
      lapor(`Dialog impor menyebut kolom yang tidak sama dengan template: "${k}" tidak disebut (yang disebut: ${disebut.join(', ')})`);
      break;
    }
  }
}

if (masalah) {
  console.error(`\n${masalah} ketidakcocokan. Ini TIDAK menimbulkan error saat impor — kolomnya cuma diabaikan diam-diam.`);
  process.exit(1);
}
console.log('Template impor cocok dengan kolom yang dibaca penguraiannya. ✅');
