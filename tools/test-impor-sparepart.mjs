/**
 * ATURAN IMPOR MASTER SPAREPART — tes murni.
 *
 *   §1 Berkas .xlsx SUNGGUHAN dari ESB (1.926 baris).
 *   §2 Header dicari lewat judul, bukan lewat nomor kolom.
 *   §3 Bentuk baku SKU — dan kenapa harus sama dengan `upper(btrim())`.
 *   §4 Harga: yang pasti dibaca, yang ragu DITOLAK.
 *   §5 Baris cacat, nonaktif, dan kembar di dalam berkas.
 *   §6 Baru vs ditimpa, dan yang tidak ada di berkas.
 *   §7 Jenis: tebakan yang dilaporkan sebagai tebakan.
 *   §8 Peringatan: yang paling bisa merusak di atas.
 *
 * ============ DIUJI TERHADAP BERKAS SUNGGUHAN, BUKAN FIXTURE KARANGAN ============
 *
 * `tools/fixtures/contoh-product-list-esb.xlsx` adalah berkas yang diekspor
 * ESB untuk CV Awal Berjaya Bengkel pada 26 Okt 2026 — 1.926 baris, 36 kolom.
 *
 * Fixture yang saya tulis sendiri sebagai JSON akan memantulkan kembali
 * anggapan yang sedang diuji. Kalau saya salah mengira headernya di baris 6
 * (seperti ekspor ESB yang lain), saya akan menulis fixture-nya di baris 6
 * juga, dan tesnya hijau untuk kode yang tidak bisa membaca berkas aslinya.
 *
 * Yang ditemukan justru begitu: header berkas ini di baris 15, BUKAN 6; dan
 * teksnya dipecah dua cara sekaligus — header lewat sharedStrings, data lewat
 * `inlineStr`. Keduanya baru terlihat dari berkas aslinya.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  KOLOM_HARGA_DEFAULT,
  angkaHarga,
  cariHeaderProductList,
  jenisBaris,
  normalSku,
  peringatanRencana,
  susunRencanaImpor
} from '../js/modules/sparepart/impor-sparepart.js';

const require = createRequire(import.meta.url);
const { bacaXlsx } = require('./lib/baca-xlsx.cjs');
const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

let gagal = 0;
let n = 0;
const cek = (nama, dapat, harap) => {
  n++;
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};
const benar = (nama, syarat, ket = '') => {
  n++;
  if (!syarat) {
    gagal++;
    console.error(`❌ ${nama}${ket ? ' — ' + ket : ''}`);
  }
};

// ===============================================================
console.log('§1 Berkas .xlsx sungguhan dari ESB');
// ===============================================================
const { aoa } = bacaXlsx(path.join(AKAR, 'tools/fixtures/contoh-product-list-esb.xlsx'));
cek('§1 jumlah baris sheet', aoa.length, 1941);

const h = cariHeaderProductList(aoa);
benar('§1 header ketemu', !!h);
// 14 = 0-based, artinya baris ke-15 di Excel. BUKAN baris 6 seperti ekspor ESB
// yang lain (Master Supplier, Master Purpose) — perbedaan yang hanya kelihatan
// dari berkas aslinya, dan yang akan membuat pembaca berindeks tetap memuat
// baris keterangan sebagai data.
cek('§1 header di baris ke-15 Excel, bukan ke-6', h.barisHeader, 14);
cek('§1 kolom SKU = B', h.kolom.sku, 1);
cek('§1 kolom Product = C', h.kolom.nama, 2);
cek('§1 kolom Store Retail = W', h.kolom['Store Retail'], 22);

const r = susunRencanaImpor({ aoa, sparepartSekarang: [] });
benar('§1 rencana terbentuk', r.ok, r.sebab);
cek('§1 1.926 baris data siap dikirim', r.kirim.length, 1926);
cek('§1 tidak ada SKU kosong di berkas ini', r.ditolak.length, 0);
cek('§1 tidak ada SKU kembar di berkas ini', r.kembar.length, 0);
cek('§1 tidak ada harga yang ragu', r.hargaRagu.length, 0);

// 100 baris kolom Store Retail-nya nol/kosong. Angka ini bukan hiasan: ia yang
// membuat jelas kenapa nol HARUS dikirim sebagai kosong. Kalau nol dikirim apa
// adanya, 100 harga di Berjaya Hub tertimpa jadi nol setiap kali berkas ini
// diimpor — dan nol tidak terlihat seperti kesalahan, ia terlihat seperti
// barang yang memang belum dijual.
cek('§1 100 baris harganya kosong/nol', r.hargaKosong.length, 100);
benar(
  '§1 baris berharga nol dikirim sebagai harga kosong, bukan nol',
  r.kirim.filter((b) => b.harga === 0).length === 0,
  `${r.kirim.filter((b) => b.harga === 0).length} baris masih berharga 0`
);
benar(
  '§1 semua harga yang terisi positif',
  r.kirim.every((b) => b.harga === null || b.harga > 0)
);

const pertama = r.kirim[0];
cek('§1 baris pertama: nomor baris Excel', pertama.baris, 16);
cek('§1 baris pertama: SKU', pertama.sku, '555.LTR.BZ120');
cek('§1 baris pertama: nama', pertama.name, 'RACK END 555 45503-BZ120 L/R');
cek('§1 baris pertama: kategori dari kolom Type', pertama.kategori, 'PART RODA');
cek('§1 baris pertama: merek dari kolom Brand', pertama.merek, '555 JP');
// 455000 = Store Retail (kolom W). Kalau pembacanya tergeser satu kolom ke
// kiri ia akan membaca 350000 (Store Supply) — angka yang sama-sama masuk akal
// dan tidak akan dicurigai siapa pun.
cek('§1 baris pertama: harga dari Store Retail, bukan Store Supply', pertama.harga, 455000);

// ===============================================================
console.log('§2 Header dicari lewat judul, bukan lewat nomor kolom');
// ===============================================================

// Satu kolom disisipkan di depan, seperti yang terjadi kalau ESB menambah
// kolom atau orang menempel kolom catatan sendiri. Pembaca berindeks tetap
// akan membaca SKU dari kolom nama dan sebaliknya — tanpa satu pun galat.
const digeser = aoa.map((row) => ['', ...row]);
const hGeser = cariHeaderProductList(digeser);
cek('§2 kolom SKU ikut bergeser', hGeser.kolom.sku, 2);
const rGeser = susunRencanaImpor({ aoa: digeser, sparepartSekarang: [] });
cek('§2 isinya tetap terbaca benar sesudah digeser', rGeser.kirim[0].sku, '555.LTR.BZ120');
cek('§2 harganya juga', rGeser.kirim[0].harga, 455000);
cek('§2 jumlah barisnya tidak berubah', rGeser.kirim.length, 1926);

// ============ BARIS KETERANGAN YANG MENYAMAR JADI HEADER ============
//
// Berkas ini menaruh saringannya sebagai "Supplier: All Suppliers" di satu
// sel, jadi tidak ada yang persis berbunyi "SKU". Tapi ESB juga mengekspor
// saringan sebagai DUA sel di berkas lain, dan baris seperti `['SKU','All']`
// akan dikenali sebagai header kalau yang dicari hanya kolom SKU.
//
// Akibatnya bukan galat: `kolom.nama` jadi undefined, setiap nama terbaca
// kosong, dan 1.926 baris ditolak dengan alasan "Nama produk kosong" — berkas
// yang sempurna dilaporkan rusak seluruhnya. Karena itu yang dituntut DUA
// kolom: SKU dan Product.
const palsu = [
  ['Product List'],
  ['SKU', 'All'],
  [],
  ['SKU', 'Product', 'Store Retail'],
  ['A1', 'Barang A', 1000]
];
cek('§2 baris saringan ber-sel "SKU" bukan header', cariHeaderProductList(palsu).barisHeader, 3);
const rPalsu = susunRencanaImpor({ aoa: palsu, sparepartSekarang: [] });
cek('§2 dan datanya tetap terbaca, bukan ditolak semua', rPalsu.kirim.map((b) => b.sku), ['A1']);
cek('§2 tidak ada yang ditolak', rPalsu.ditolak.length, 0);

cek('§2 berkas tanpa kolom SKU ditolak dengan sebab', cariHeaderProductList([['Nama', 'Harga']]), null);
const bukanEsb = susunRencanaImpor({ aoa: [['Nama', 'Harga'], ['A', 1]] });
benar('§2 rencananya tidak ok', bukanEsb.ok === false);
benar('§2 sebabnya menyebut nama kolom yang dicari', /SKU/.test(bukanEsb.sebab), bukanEsb.sebab);

const tanpaHarga = susunRencanaImpor({ aoa, kolomHarga: 'Harga Khusus' });
benar('§2 kolom harga yang tidak ada ditolak', tanpaHarga.ok === false);
benar(
  '§2 sebabnya menyebut kolom harga yang TERSEDIA, bukan cuma yang hilang',
  /Store Retail/.test(tanpaHarga.sebab),
  tanpaHarga.sebab
);

// ===============================================================
console.log('§3 Bentuk baku SKU');
// ===============================================================
cek('§3 huruf besar', normalSku('555.ltr.bz120'), '555.LTR.BZ120');
cek('§3 spasi pinggir dibuang', normalSku('  A1  '), 'A1');
cek('§3 bukan string', normalSku(null), '');
cek('§3 angka', normalSku(123), '123');

// ============ INI YANG PALING MUDAH SALAH ============
//
// Indeks unik di database memakai `upper(btrim(sku))`. `btrim` satu argumen
// membuang SPASI saja — tab dan baris baru TIDAK. `String.trim()` membuang
// ketiganya. Jadi untuk "A1\t":
//
//   modul ini  → "A1"      (dianggap sama dengan A1 yang sudah ada)
//   btrim()    → "A1\t"    (dianggap SKU yang berbeda)
//
// Kalau yang dikirim isi sel apa adanya, pemeriksaan kembar di sini bilang
// "sudah ada" lalu `insert` di sana membuat baris KEDUA — double SKU yang
// persis dilarang, dan tidak ada galat di mana pun.
//
// Yang dikirim adalah hasil normalSku(), jadi kedua sisi menilai hal yang sama.
cek('§3 tab di pinggir dibuang (btrim tidak membuangnya)', normalSku('A1\t'), 'A1');
cek('§3 baris baru dibuang', normalSku('A1\n'), 'A1');
cek('§3 spasi tak-putus dibuang', normalSku('A1 '), 'A1');
const rTab = susunRencanaImpor({
  aoa: [['SKU', 'Product', 'Store Retail'], ['a1\t', 'Barang A', 1000]],
  sparepartSekarang: []
});
cek('§3 yang DIKIRIM sudah baku, bukan isi sel apa adanya', rTab.kirim[0].sku, 'A1');

// Spasi di TENGAH tidak disentuh — dua sisi sepakat bahwa ini dua SKU berbeda.
cek('§3 spasi di tengah dibiarkan', normalSku('A 1'), 'A 1');
benar('§3 "A 1" dan "A  1" tetap berbeda', normalSku('A 1') !== normalSku('A  1'));

// ===============================================================
console.log('§4 Harga: yang pasti dibaca, yang ragu DITOLAK');
// ===============================================================
cek('§4 angka xlsx sungguhan', angkaHarga(455000), { nilai: 455000, ragu: false });
cek('§4 angka berdesimal (bentuk ESB)', angkaHarga(350000.0), { nilai: 350000, ragu: false });
cek('§4 teks angka bulat', angkaHarga('455000'), { nilai: 455000, ragu: false });
cek('§4 teks "350000.0" = desimal Inggris', angkaHarga('350000.0'), { nilai: 350000, ragu: false });
cek('§4 "1.234.567" = pemisah ribuan', angkaHarga('1.234.567'), { nilai: 1234567, ragu: false });
cek('§4 "455.000" = 455 ribu', angkaHarga('455.000'), { nilai: 455000, ragu: false });
cek('§4 "Rp 455000"', angkaHarga('Rp 455000'), { nilai: 455000, ragu: false });
cek('§4 sel kosong = kosong, BUKAN ragu', angkaHarga(''), { nilai: null, ragu: false });
cek('§4 null', angkaHarga(null), { nilai: null, ragu: false });

// ============ KENAPA MENOLAK, BUKAN MENEBAK ============
//
// "455.000,50" bisa dibaca dua cara, dan salah satunya menghasilkan harga
// seribu kali keliru. Harga 455 di layar tidak terlihat seperti kesalahan
// baca — ia terlihat seperti barang murah. Yang ragu dilaporkan supaya
// orangnya memutuskan; harga lamanya tidak diubah.
cek('§4 koma = RAGU, tidak ditebak', angkaHarga('455.000,50'), { nilai: null, ragu: true });
cek('§4 koma desimal = RAGU', angkaHarga('455,50'), { nilai: null, ragu: true });
cek('§4 huruf = RAGU', angkaHarga('belum ada'), { nilai: null, ragu: true });
cek('§4 campur = RAGU', angkaHarga('455rb'), { nilai: null, ragu: true });

const rRagu = susunRencanaImpor({
  aoa: [
    ['SKU', 'Product', 'Store Retail'],
    ['A1', 'Barang A', '455,50'],
    ['A2', 'Barang B', 0],
    ['A3', 'Barang C', 1000]
  ],
  sparepartSekarang: []
});
cek('§4 baris ragu TETAP masuk, tanpa harga', rRagu.kirim.length, 3);
cek('§4 harganya kosong, bukan tebakan', rRagu.kirim[0].harga, null);
cek('§4 satu baris dilaporkan ragu', rRagu.hargaRagu.length, 1);
cek('§4 nomor barisnya seperti di Excel', rRagu.hargaRagu[0].baris, 2);
benar('§4 isi selnya ikut dilaporkan, supaya bisa dicari', rRagu.hargaRagu[0].isi === '455,50');
// Nol masuk ke hargaKosong; yang ragu TIDAK — dua sebab berbeda, dua daftar
// berbeda. Menggabungkannya membuat "100 harga kosong" tidak bisa dibedakan
// dari "100 harga tidak terbaca", padahal yang kedua perlu dibereskan.
cek('§4 nol masuk daftar harga kosong', rRagu.hargaKosong.length, 1);
cek('§4 yang ragu TIDAK ikut daftar harga kosong', rRagu.hargaKosong[0].sku, 'A2');

// Kolom harga lain bisa dipilih, dan hasilnya memang beda.
const rSupply = susunRencanaImpor({ aoa, kolomHarga: 'Store Supply' });
cek('§4 Store Supply memberi angka yang lain', rSupply.kirim[0].harga, 350000);
cek('§4 dan dicatat kolom mana yang dipakai', rSupply.kolomHarga, 'Store Supply');
cek('§4 default-nya Store Retail', r.kolomHarga, KOLOM_HARGA_DEFAULT);

// ===============================================================
console.log('§5 Baris cacat, nonaktif, dan kembar di dalam berkas');
// ===============================================================
const rCacat = susunRencanaImpor({
  aoa: [
    ['SKU', 'Product', 'Type', 'Active', 'Store Retail'],
    ['', 'Tanpa SKU', 'PART', 1, 1000],
    ['A2', '', 'PART', 1, 1000],
    ['A3', 'Nonaktif di ESB', 'PART', 0, 1000],
    ['A4', 'Nonaktif tertulis', 'PART', 'Inactive', 1000],
    ['', '', '', '', ''],
    ['A5', 'Kembar — yang ini diabaikan', 'PART', 1, 1000],
    ['A5', 'Kembar — yang ini dipakai', 'PART', 1, 2000],
    ['A6', 'Baris baik', 'PART', 1, 3000]
  ],
  sparepartSekarang: []
});
cek('§5 yang dikirim cuma yang sah', rCacat.kirim.map((b) => b.sku), ['A5', 'A6']);
cek('§5 dua baris ditolak', rCacat.ditolak.length, 2);
cek('§5 sebab ditolak disebutkan', rCacat.ditolak.map((d) => d.sebab), ['SKU kosong', 'Nama produk kosong']);
cek('§5 dua baris nonaktif dilewati', rCacat.nonaktif.map((d) => d.sku), ['A3', 'A4']);

// Baris benar-benar kosong TIDAK dilaporkan. Ekspor sering menyisakan beberapa
// di bawah, dan melaporkannya mengubur yang benar-benar perlu dibaca.
benar(
  '§5 baris kosong tidak ikut daftar ditolak',
  !rCacat.ditolak.some((d) => !d.sku && !d.nama),
  JSON.stringify(rCacat.ditolak)
);

// SKU kembar: yang TERAKHIR dipakai — sama dengan urutan tulis di database.
// Mengirim keduanya membuat satu SKU terhitung "baru" DAN "diperbarui", jadi
// angka yang dilaporkan database tidak akan cocok dengan pratinjaunya.
cek('§5 satu kembar dilaporkan', rCacat.kembar.length, 1);
cek('§5 yang TERAKHIR yang dipakai', rCacat.kirim.find((b) => b.sku === 'A5').name, 'Kembar — yang ini dipakai');
cek('§5 kembar menyebut baris penggantinya', rCacat.kembar[0].digantiBaris, 8);
cek('§5 hanya satu baris per SKU yang dikirim', rCacat.kirim.filter((b) => b.sku === 'A5').length, 1);

// ===============================================================
console.log('§6 Baru vs ditimpa, dan yang tidak ada di berkas');
// ===============================================================
const sudahAda = [
  { sku: '555.ltr.bz120 ', name: 'RACK END NAMA LAMA', harga_dasar: 400000, jenis: 'sparepart' },
  { sku: 'JASA.TUNE', name: 'Tune Up Mesin', harga_dasar: 350000, jenis: 'jasa' }
];
const rAda = susunRencanaImpor({ aoa, sparepartSekarang: sudahAda });

// Master lama dikunci dengan bentuk SKU yang SAMA. Kalau tidak, SKU yang di
// database tertulis huruf kecil akan terbaca sebagai "belum ada" — pratinjau
// bilang "baru", lalu database menimpanya. Keduanya tidak melempar apa pun.
cek('§6 SKU lama berhuruf kecil tetap dikenali sebagai sudah ada', rAda.ditimpa.length, 1);
cek('§6 sisanya baru', rAda.baru.length, 1925);
cek('§6 yang ditimpa menyebut nama lamanya', rAda.ditimpa[0].namaLama, 'RACK END NAMA LAMA');
cek('§6 dan harga lamanya', rAda.ditimpa[0].hargaLama, 400000);
benar('§6 ditandai namanya berubah', rAda.ditimpa[0].namaBerubah === true);

// Jasa yang diketik admin tidak ada di berkas ESB — DILAPORKAN, tidak disentuh.
// Impor yang "membersihkan yang tidak ada di berkas" akan menghapus seluruh
// daftar jasa, dan berkas ini membuktikan kenapa: 1.926 barisnya hampir
// seluruhnya barang.
cek('§6 yang tidak ada di berkas dilaporkan', rAda.tidakDiBerkas.map((s) => s.sku), ['JASA.TUNE']);
cek('§6 dan jenisnya ikut, supaya jasa kelihatan', rAda.tidakDiBerkas[0].jenis, 'jasa');
benar(
  '§6 yang tidak ada di berkas TIDAK ikut dikirim',
  !rAda.kirim.some((b) => b.sku === 'JASA.TUNE'),
  'jasa manual malah ikut dikirim'
);

// Nama yang sama persis bukan "berubah" — kalau tidak, laporannya bilang 1.926
// nama berubah setiap impor dan tidak ada lagi yang membacanya.
const rSama = susunRencanaImpor({
  aoa: [['SKU', 'Product', 'Store Retail'], ['A1', 'Barang A', 1000]],
  sparepartSekarang: [{ sku: 'A1', name: 'Barang A', harga_dasar: 1000, jenis: 'sparepart' }]
});
benar('§6 nama yang sama tidak dicap berubah', rSama.ditimpa[0].namaBerubah === false);

// ===============================================================
console.log('§7 Jenis: tebakan yang dilaporkan sebagai tebakan');
// ===============================================================
cek('§7 default sparepart', jenisBaris({ kategori: 'PART REM', tags: 'PART', nama: 'KAMPAS REM' }), 'sparepart');
cek('§7 "SERVICE" di nama → jasa', jenisBaris({ nama: 'SERVICE GANTI OLI' }), 'jasa');
cek('§7 "JASA" di kategori → jasa', jenisBaris({ kategori: 'JASA BENGKEL', nama: 'Balancing' }), 'jasa');
cek('§7 tanpa apa pun → sparepart', jenisBaris({}), 'sparepart');

// ============ ANGKA INI DIUKUR, BUKAN DIKARANG ============
//
// Dari 1.926 baris sungguhan, TEPAT SATU tertebak jasa:
// `RA.SERV.UP.LOW.01` — "SERVICE GANTI UPPER LOWER RADIATOR MATIC", Rp 750.000.
// Dan baris itu memang jasa, bukan barang.
//
// Ini juga membetulkan catatan saya sendiri yang lebih awal, yang menyebut
// berkas ini "tidak memuat satu pun baris jasa". Memuat satu.
const jasa = r.kirim.filter((b) => b.jenis === 'jasa');
cek('§7 tepat satu baris tertebak jasa di berkas sungguhan', jasa.length, 1);
cek('§7 dan SKU-nya', jasa[0].sku, 'RA.SERV.UP.LOW.01');
cek('§7 tebakan baris baru dilaporkan untuk diperiksa', r.dugaanJasa.length, 1);

// Tidak adanya tebakan palsu HARI INI bukan jaminan. "BUSHING KIT", "KIT
// KALIPER", "POWER STEERING SEAL KIT" ada 20-an di berkas ini dan semuanya
// barang — mereka lolos karena "kit" bukan kata kunci. Satu nama yang memuat
// "service" sudah cukup untuk salah menebak:
cek('§7 barang bernama "SERVICE KIT" salah tertebak jasa', jenisBaris({ nama: 'SERVICE KIT 04479-52170' }), 'jasa');
// Itu sebabnya database TIDAK menimpa jenis baris yang sudah ada, dan sebabnya
// selisihnya dilaporkan:
const rBeda = susunRencanaImpor({
  aoa: [['SKU', 'Product', 'Store Retail'], ['A1', 'SERVICE KIT 04479', 1000]],
  sparepartSekarang: [{ sku: 'A1', name: 'SERVICE KIT 04479', harga_dasar: 900, jenis: 'sparepart' }]
});
cek('§7 selisih jenis dilaporkan', rBeda.jenisBeda.length, 1);
cek('§7 menyebut kedua sisinya', [rBeda.jenisBeda[0].diBerkas, rBeda.jenisBeda[0].tersimpan], ['jasa', 'sparepart']);
cek('§7 yang sudah ada tidak masuk dugaanJasa', rBeda.dugaanJasa.length, 0);

// ===============================================================
console.log('§8 Peringatan: yang paling bisa merusak di atas');
// ===============================================================
const pWarn = peringatanRencana(
  susunRencanaImpor({
    aoa: [
      ['SKU', 'Product', 'Store Retail'],
      ['A1', 'Harganya tak terbaca', '455,50'],
      ['A2', 'Kembar satu', 1000],
      ['A2', 'Kembar dua', 2000],
      ['A3', 'Harga nol', 0],
      ['', 'Ditolak', 1000]
    ],
    sparepartSekarang: [
      { sku: 'A3', name: 'Nama lama', harga_dasar: 5000, jenis: 'sparepart' },
      { sku: 'JASA.X', name: 'Jasa manual', harga_dasar: 100, jenis: 'jasa' }
    ]
  })
);
benar('§8 ada peringatan', pWarn.length > 0);
// Urutannya bukan hiasan. Pratinjau yang menaruh "siap kirim" di baris pertama
// dan "harga tidak terbaca" di baris kesembilan sudah memberi tahu — dan sudah
// gagal memberi tahu.
cek('§8 yang pertama tingkat bahaya', pWarn[0].tingkat, 'bahaya');
benar('§8 dan menyebut harga yang tak bisa dipastikan', /TIDAK BISA DIPASTIKAN/.test(pWarn[0].teks), pWarn[0].teks);
benar('§8 kembar juga bahaya', pWarn.some((p) => p.tingkat === 'bahaya' && /lebih dari sekali/.test(p.teks)));
benar(
  '§8 "tidak pernah menghapus" dinyatakan terang-terangan',
  pWarn.some((p) => /tidak pernah menghapus/i.test(p.teks)),
  JSON.stringify(pWarn)
);
benar(
  '§8 harga lama disebut TIDAK dihapus, supaya tidak ada yang mengira sebaliknya',
  pWarn.some((p) => /TIDAK dihapus|tidak diubah/.test(p.teks))
);
cek('§8 ringkasan jumlah selalu paling akhir', /akan dikirim/.test(pWarn[pWarn.length - 1].teks), true);

const pGagal = peringatanRencana({ ok: false, sebab: 'Bukan berkas ESB.' });
cek('§8 rencana gagal cuma memberi satu peringatan bahaya', pGagal, [{ tingkat: 'bahaya', teks: 'Bukan berkas ESB.' }]);
cek('§8 rencana kosong pun tidak melempar', peringatanRencana(null)[0].tingkat, 'bahaya');

const pBersih = peringatanRencana(r);
benar(
  '§8 berkas sungguhan: tidak ada peringatan bahaya',
  !pBersih.some((p) => p.tingkat === 'bahaya'),
  JSON.stringify(pBersih.filter((p) => p.tingkat === 'bahaya'))
);
benar(
  '§8 tapi 100 harga kosong tetap diperingatkan',
  pBersih.some((p) => /100 baris/.test(p.teks)),
  JSON.stringify(pBersih)
);

// ---------------------------------------------------------------
console.log(`\n${gagal === 0 ? '✅' : '❌'} test-impor-sparepart: ${n - gagal}/${n} lulus`);
process.exit(gagal === 0 ? 0 : 1);
