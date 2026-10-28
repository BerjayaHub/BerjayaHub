/**
 * SURAT JALAN TRANSFER ASET — tes murni.
 *
 *   §1 Tanggal surat.
 *   §2 Ke mana barangnya pergi.
 *   §3 Teks WhatsApp.
 *   §4 PDF memuat isi yang SAMA.
 *   §5 Pembatalan.
 *   §6 Isian aneh.
 *
 * ============ YANG SEBENARNYA DIUJI DI SINI ============
 *
 * Surat jalan ini keluar dari aplikasi lalu hidup sendiri: tercetak di kertas
 * yang dibawa supir, dan tersalin di grup WhatsApp. Keduanya dibaca orang yang
 * sedang menyerahkan barang, dan tidak satu pun dari mereka bisa memeriksanya
 * ke sistem saat itu juga.
 *
 * Jadi yang diuji bukan "apakah teksnya terbentuk" — melainkan apakah kertas
 * dan pesan itu mengatakan hal yang SAMA, dan apakah keadaan yang berbahaya
 * (tujuan di luar sistem, surat yang sudah dibatalkan) terbaca sebelum
 * barangnya terlanjur diserahkan.
 */
import {
  barisBarang,
  barisPdfTransfer,
  ringkasTransfer,
  tanggalSurat,
  transferWaText,
  tujuanTeks
} from '../js/modules/asset/pesan-transfer-aset.js';

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

const SJ = {
  kode: 'TA-261028-9F3A',
  tanggal: '2026-10-28T03:11:00.000Z',
  asal: 'AB Gading Serpong',
  tujuanOutlet: 'AB Sentul',
  pembawa: 'Pak Joko',
  items: [
    { kode: 'B001', nama: 'Kursi Bar', qty: 5 },
    { kode: 'B002', nama: 'Meja Lipat', qty: 2 }
  ],
  catatan: 'dibawa pakai pickup',
  oleh: 'Budi'
};

// ===============================================================
console.log('§1 Tanggal surat');
// ===============================================================
cek('§1 dari ISO lengkap', tanggalSurat('2026-10-28T03:11:00.000Z'), '28 Oktober 2026');
cek('§1 dari tanggal saja', tanggalSurat('2026-01-05'), '5 Januari 2026');

// ============ TIDAK LEWAT `toLocaleDateString` ============
//
// Pada peramban berzona berbeda, ia menggeser tanggalnya satu hari. Surat
// jalan yang tanggalnya meleset tidak terlihat seperti kesalahan program — ia
// terlihat seperti barang yang dikirim di hari yang berbeda, dan itu yang
// akan diperdebatkan.
benar('§1 jam dini hari UTC tidak menggeser tanggalnya', tanggalSurat('2026-10-28T00:30:00.000Z').startsWith('28'));
cek('§1 bentuk tak dikenal dikembalikan apa adanya', tanggalSurat('kemarin'), 'kemarin');
cek('§1 kosong', tanggalSurat(''), '');

// ===============================================================
console.log('§2 Ke mana barangnya pergi');
// ===============================================================
cek('§2 outlet disebut namanya', tujuanTeks({ tujuanOutlet: 'AB Sentul' }), 'AB Sentul');

// ============ TUJUAN DI LUAR SISTEM DITANDAI ============
//
// Menuliskannya seperti outlet biasa membuat yang membacanya mengira barangnya
// ada di salah satu outlet — dan ia akan mencarinya di sana, bukan menagihnya
// ke pihak yang meminjam.
cek('§2 tujuan luar ditandai', tujuanTeks({ tujuanLain: 'Acara CSR' }), 'Acara CSR (di luar outlet)');
cek('§2 outlet menang kalau dua-duanya terisi', tujuanTeks({ tujuanOutlet: 'A', tujuanLain: 'B' }), 'A');
cek('§2 tanpa tujuan dikatakan, bukan dibiarkan kosong', tujuanTeks({}), '(tujuan tidak disebut)');

// ===============================================================
console.log('§3 Teks WhatsApp');
// ===============================================================
const wa = transferWaText(SJ);
benar('§3 memuat nomor SJ', wa.includes('TA-261028-9F3A'));
benar('§3 memuat tanggal panjang', wa.includes('28 Oktober 2026'));
benar('§3 dari mana', wa.includes('AB Gading Serpong'));
benar('§3 ke mana', wa.includes('AB Sentul'));
benar('§3 PEMBAWA disebut', wa.includes('Pak Joko'), wa);
benar('§3 jumlah jenis barang', wa.includes('*Barang (2)*'));
benar('§3 baris barang berkode', wa.includes('1. Kursi Bar (B001) — 5'));
benar('§3 total unit dijumlahkan', wa.includes('Total unit: 7'));
benar('§3 catatan ikut', wa.includes('dibawa pakai pickup'));
benar('§3 pengirim ikut', wa.includes('Dikirim oleh: Budi'));

// ============ "TIDAK PERLU KONFIRMASI" HARUS DIKATAKAN ============
//
// Ini yang membedakannya dari surat jalan bahan. Yang menerimanya akan mencari
// tombol "Terima" kalau tidak diberi tahu — dan selama ia mencari, barangnya
// belum dicatat di mana pun kecuali di pesan ini.
benar('§3 menyebut bahwa stok sudah berpindah', /Stok sudah otomatis berpindah/.test(wa), wa);
benar('§3 dan tidak perlu konfirmasi terima', /Tidak perlu konfirmasi terima/.test(wa));

const waKosong = transferWaText({ kode: 'TA-1', asal: 'A', tujuanOutlet: 'B', pembawa: 'X', items: [] });
benar('§3 tanpa barang dikatakan', waKosong.includes('(tidak ada barang)'));
benar('§3 dan tidak menampilkan total palsu', !waKosong.includes('Total unit'), waKosong);

// ===============================================================
console.log('§4 PDF memuat isi yang SAMA');
// ===============================================================
const pdf = barisPdfTransfer(SJ);
cek('§4 satu baris per barang', pdf.length, 2);
cek('§4 nomor urut, kode, nama, jumlah', pdf[0], ['1', 'B001', 'Kursi Bar', '5']);

// ============ INI PEMERIKSAAN INTINYA ============
//
// Kertas di tangan supir dan pesan di HP harus mengatakan hal yang sama. Kalau
// keduanya disusun terpisah, yang menyimpang bukan tampilannya melainkan
// ISINYA — dan itu baru ketahuan saat barangnya sedang diserahkan.
for (const it of SJ.items) {
  benar(`§4 "${it.nama}" ada di WA maupun PDF`, wa.includes(it.nama) && pdf.some((b) => b[2] === it.nama));
  benar(`§4 jumlah "${it.nama}" sama di keduanya`, pdf.some((b) => b[2] === it.nama && b[3] === String(it.qty)));
}
cek('§4 baris nomor 2 benar urutannya', pdf[1][0], '2');

// ===============================================================
console.log('§5 Pembatalan');
// ===============================================================
const batal = transferWaText({ ...SJ, dibatalkan: true, alasanBatal: 'salah outlet tujuan' });

// ============ PENANDANYA DI PALING ATAS ============
//
// Surat jalan yang sudah dibatalkan beredar di WhatsApp persis seperti yang
// masih berlaku. Kalau penandanya di bawah daftar barang, yang membaca sambil
// berjalan sudah terlanjur menyerahkan barangnya.
benar('§5 ditandai DIBATALKAN', batal.includes('DIBATALKAN'));
benar('§5 penandanya di baris pertama', batal.split('\n')[0].includes('DIBATALKAN'), batal.split('\n')[0]);
benar('§5 alasannya disebut', batal.includes('salah outlet tujuan'));
// Dan kalimat "stok sudah berpindah" TIDAK boleh ikut muncul — stoknya sudah
// ditarik kembali, dan mengatakannya sebaliknya justru menyesatkan.
benar('§5 tidak lagi bilang stok sudah berpindah', !/Stok sudah otomatis berpindah/.test(batal), batal);

// ===============================================================
console.log('§5b Nomor revisi');
// ===============================================================

// ============ VERSI LAMA SUDAH BEREDAR DAN TIDAK BISA DITARIK ============
//
// Tanpa penanda revisi, dua pesan berisi angka berbeda dengan nomor yang SAMA
// beredar berdampingan di grup — dan yang membacanya tidak punya cara tahu
// mana yang berlaku. Yang memegang versi lama akan menyerahkan jumlah lama.
const rev1 = transferWaText({ ...SJ, revisiKe: 1, alasanRevisi: 'salah hitung' });
benar('§5b nomor revisi dicetak di baris nomor SJ', /No\. TA-261028-9F3A\s+\(REVISI ke-1\)/.test(rev1), rev1.split('\n')[1]);
benar('§5b alasan revisinya disebut', rev1.includes('salah hitung'));

// Surat jalan yang BELUM pernah direvisi tidak boleh membawa penanda apa pun —
// "REVISI ke-0" membuat orang mencari versi sebelumnya yang tidak pernah ada.
benar('§5b yang belum direvisi bersih dari penanda', !/REVISI/.test(transferWaText(SJ)));
benar('§5b revisiKe 0 juga bersih', !/REVISI/.test(transferWaText({ ...SJ, revisiKe: 0 })));

// ===============================================================
console.log('§6 Isian aneh');
// ===============================================================
cek('§6 tanpa argumen tidak melempar', typeof transferWaText(), 'string');
cek('§6 items bukan array', barisPdfTransfer({ items: 'x' }), []);
benar('§6 qty cacat tidak jadi NaN', !transferWaText({ items: [{ nama: 'A', qty: 'x' }] }).includes('NaN'));
benar('§6 barang tanpa nama dikatakan', barisBarang({ qty: 1 }, 0).includes('(tanpa nama)'));
benar('§6 barang tanpa kode tidak menyisakan kurung kosong', !barisBarang({ nama: 'A', qty: 1 }, 0).includes('()'));

const r = ringkasTransfer(SJ);
cek('§6 ringkasan: jenis', r.jenis, 2);
cek('§6 ringkasan: unit', r.unit, 7);
benar('§6 ringkasan: bukan ke luar', r.keLuar === false);
benar('§6 ringkasan menandai yang ke luar', ringkasTransfer({ tujuanLain: 'Acara' }).keLuar === true);
cek('§6 ringkasan tanpa argumen', ringkasTransfer().unit, 0);

// ---------------------------------------------------------------
console.log(`\n${gagal === 0 ? '✅' : '❌'} test-pesan-transfer-aset: ${n - gagal}/${n} lulus`);
process.exit(gagal === 0 ? 0 : 1);
