/**
 * BARIS PEMBELIAN MANUAL — tes murni (0191).
 *
 *   §1 Angka dari isian manusia.
 *   §2 Baris kosong bukan kesalahan; baris cacat disebut salahnya apa.
 *   §3 Harga BOLEH kosong — dan kosong tidak pernah jadi nol.
 *   §4 Nilai dihitung, tidak diketik.
 *   §5 Isi dari master memakai harga BELI, bukan harga jual.
 *   §6 Ringkasan menyebut berapa baris yang belum berharga.
 */
import {
  angkaIsian,
  barisBeliKosong,
  beliDariMaster,
  nilaiBarisBeli,
  sahkanBarisBeli,
  susunBarisBeli,
  ringkasBarisBeli
} from '../js/modules/bengkel/baris-pembelian-manual.js';

let gagal = 0, n = 0;
const cek = (nama, dapat, harap) => {
  n++;
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};
const benar = (nama, syarat, ket = '') => { n++; if (!syarat) { gagal++; console.error(`❌ ${nama}${ket ? ' — ' + ket : ''}`); } };

// ===============================================================
console.log('§1 Angka dari isian manusia');
// ===============================================================
cek('§1 titik ribuan', angkaIsian('150.000'), 150000);
cek('§1 awalan Rp', angkaIsian('Rp 90000'), 90000);
cek('§1 koma desimal', angkaIsian('1,5'), 1.5);
cek('§1 kosong = null', angkaIsian(''), null);
cek('§1 sampah = null', angkaIsian('dua'), null);
// `null` DIBEDAKAN dari 0: keduanya "tidak ada angka" bagi pembaca sekilas,
// tapi hanya satu di antaranya berarti gratis.
cek('§1 nol tetap nol', angkaIsian('0'), 0);

// ===============================================================
console.log('§2 Baris kosong & baris cacat');
// ===============================================================
cek('§2 baris yang masih kosong bukan kesalahan', sahkanBarisBeli(barisBeliKosong()), '');
cek('§2 nama wajib', sahkanBarisBeli({ nama: '', qty: '1', harga: '1000' }), 'nama barang belum diisi');
cek('§2 qty bukan angka', sahkanBarisBeli({ nama: 'OLI', qty: 'dua', harga: '1000' }), 'qty bukan angka');
cek('§2 qty nol ditolak', sahkanBarisBeli({ nama: 'OLI', qty: '0', harga: '1000' }), 'qty harus lebih dari 0');
cek('§2 qty minus ditolak', sahkanBarisBeli({ nama: 'OLI', qty: '-2', harga: '1000' }), 'qty harus lebih dari 0');
cek('§2 harga sampah ditolak', sahkanBarisBeli({ nama: 'OLI', qty: '1', harga: 'mahal' }), 'harga beli bukan angka');
cek('§2 harga minus ditolak', sahkanBarisBeli({ nama: 'OLI', qty: '1', harga: '-5' }), 'harga beli tidak boleh minus');
// Baris yang salah DISEBUT nomornya: "ada yang salah" tanpa menyebut baris
// mana memaksa orangnya memeriksa dua puluh baris satu per satu.
const s2 = susunBarisBeli([{ nama: 'OLI', qty: 'x', harga: '1' }, barisBeliKosong()]);
cek('§2 nomor barisnya disebut', s2.salah, ['Baris 1: qty bukan angka.']);
cek('§2 baris kosong tidak ikut dikirim', s2.baris.length, 0);

// ===============================================================
console.log('§3 Harga boleh kosong, dan tidak jadi nol');
// ===============================================================
cek('§3 harga kosong lolos', sahkanBarisBeli({ nama: 'OLI', qty: '2', harga: '' }), '');
const s3 = susunBarisBeli([{ nama: 'OLI', qty: '2', harga: '' }]);
// INI yang paling penting di berkas ini: nol adalah harga, kosong bukan.
cek('§3 kosong tetap kosong, BUKAN 0', s3.baris[0].harga, '');
cek('§3 totalnya pun kosong', s3.baris[0].total, '');
const s3b = susunBarisBeli([{ nama: 'OLI', qty: '2', harga: '0' }]);
cek('§3 nol yang DIKETIK tetap nol', s3b.baris[0].harga, '0');
cek('§3 dan totalnya nol', s3b.baris[0].total, '0');

// ===============================================================
console.log('§4 Nilai dihitung');
// ===============================================================
cek('§4 harga × qty', nilaiBarisBeli({ qty: '3', harga: '90.000' }), 270000);
cek('§4 tanpa harga = null', nilaiBarisBeli({ qty: '3', harga: '' }), null);
cek('§4 tanpa qty = null', nilaiBarisBeli({ qty: '', harga: '100' }), null);
const s4 = susunBarisBeli([{ nama: 'OLI', qty: '3', harga: '90000' }]);
cek('§4 totalnya ikut dikirim', s4.baris[0].total, '270000');

// ===============================================================
console.log('§5 Isi dari master');
// ===============================================================
const m = beliDariMaster({ id: 'x1', sku: 'OLI.5W', name: 'OLI SHELL 5W-30', harga_beli: 72000, harga_jual: 95000 });
cek('§5 sku & nama terisi', [m.sku, m.nama], ['OLI.5W', 'OLI SHELL 5W-30']);
// Harga BELI, bukan jual. Tertukar, laporan pengeluaran membengkak sebesar
// marginnya — dan angkanya tetap terlihat wajar.
cek('§5 harga BELI yang diusulkan', m.harga, '72000');
// Qty TIDAK diisi otomatis: bawaan "1" adalah cara tercepat menyimpan jumlah
// yang tidak pernah dihitung siapa pun.
cek('§5 qty tidak diisi otomatis', m.qty, '');
cek('§5 master tanpa harga beli', beliDariMaster({ id: 'x', sku: 'A', name: 'B' }).harga, '');
cek('§5 tanpa master = baris kosong', beliDariMaster(null), barisBeliKosong());

// ===============================================================
console.log('§6 Ringkasan');
// ===============================================================
const r = ringkasBarisBeli([
  { nama: 'OLI', qty: '2', harga: '90000' },
  { nama: 'BUSI', qty: '4', harga: '' },
  barisBeliKosong()
]);
cek('§6 dua baris terisi', r.baris, 2);
cek('§6 qty dijumlahkan', r.qty, 6);
cek('§6 nilai hanya dari yang berharga', r.nilai, 180000);
// Disebut TERPISAH: kalau baris tanpa harga ikut dihitung sebagai nol, total
// pengeluarannya terlihat lengkap padahal separuhnya belum diketahui.
cek('§6 yang belum berharga dihitung', r.tanpaHarga, 1);
cek('§6 daftar kosong aman', ringkasBarisBeli([]).baris, 0);
benar('§6 tanpa argumen tidak melempar', ringkasBarisBeli().baris === 0);

console.log(`\n${gagal === 0 ? '✅' : '❌'} test-baris-pembelian-manual: ${n - gagal}/${n} lulus`);
process.exit(gagal === 0 ? 0 : 1);
