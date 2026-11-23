/**
 * BARIS INVOICE KORPORAT — tes murni.
 *
 *   §1 Angka dari isian manusia.
 *   §2 Baris kosong bukan kesalahan.
 *   §3 Pemeriksaan per baris, dengan sebab yang bisa ditindaklanjuti.
 *   §4 Total dihitung, tidak diketik.
 *   §5 Modal kosong tetap kosong, bukan 0.
 *   §6 Isian dari master sparepart.
 */
import {
  angkaIsian, barisKosong, barisKosongSemua, dariMaster, totalBaris,
  sahkanBaris, susunBarisKorporat, ringkasBarisKorporat
} from '../js/modules/bengkel/baris-korporat.js';

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
cek('§1 angka biasa', angkaIsian('150000'), 150000);
cek('§1 titik ribuan', angkaIsian('150.000'), 150000);
cek('§1 berawalan Rp', angkaIsian('Rp 150.000'), 150000);
cek('§1 koma desimal', angkaIsian('1,5'), 1.5);
cek('§1 kosong = null', angkaIsian(''), null);
// Menolak, bukan mengubahnya jadi 0: "seratus ribu" yang jadi 0 akan tersimpan
// sebagai barang gratis.
cek('§1 teks sampah = null', angkaIsian('seratus ribu'), null);
cek('§1 null', angkaIsian(null), null);

// ===============================================================
console.log('§2–§3 Baris kosong & pemeriksaan');
// ===============================================================
benar('§2 baris baru = kosong semua', barisKosongSemua(barisKosong()));
// Selalu ada satu baris kosong di bawah daftar; menandainya merah membuat
// form merah sejak dibuka.
cek('§2 baris kosong bukan kesalahan', sahkanBaris(barisKosong()), '');
cek('§3 nama kosong', sahkanBaris({ nama: '', qty: '1', harga: '1000' }), 'nama barang/jasa belum diisi');
cek('§3 qty bukan angka', sahkanBaris({ nama: 'A', qty: 'dua', harga: '1000' }), 'qty bukan angka');
cek('§3 qty nol', sahkanBaris({ nama: 'A', qty: '0', harga: '1000' }), 'qty harus lebih dari 0');
cek('§3 harga bukan angka', sahkanBaris({ nama: 'A', qty: '1', harga: 'mahal' }), 'harga jual bukan angka');
cek('§3 harga minus', sahkanBaris({ nama: 'A', qty: '1', harga: '-5' }), 'harga jual tidak boleh minus');
cek('§3 modal bukan angka', sahkanBaris({ nama: 'A', qty: '1', harga: '1000', modal: 'xx' }), 'modal bukan angka');
// Harga 0 SAH — barang pelengkap/garansi memang bisa nol.
cek('§3 harga nol sah', sahkanBaris({ nama: 'A', qty: '1', harga: '0' }), '');
cek('§3 modal kosong sah', sahkanBaris({ nama: 'A', qty: '1', harga: '1000', modal: '' }), '');

// ===============================================================
console.log('§4–§5 Susunan & modal');
// ===============================================================
const rows = [
  { item_type: 'sparepart', sku: 'OLI.X', nama: 'OLI MESIN', qty: '4', harga: '150.000', modal: '100.000' },
  { item_type: 'jasa', sku: '', nama: 'SERVICE BERKALA', qty: '1', harga: '250000', modal: '' },
  barisKosong(),
  { item_type: 'sparepart', sku: 'X', nama: 'RUSAK', qty: 'dua', harga: '1000', modal: '' }
];
const { baris, salah } = susunBarisKorporat(rows);
cek('§4 dua baris sah', baris.length, 2);
// Total dihitung, tidak diminta diketik: dua angka yang harus cocok satu sama
// lain selalu berakhir tidak cocok.
cek('§4 total = harga × qty', baris[0].total, 600000);
cek('§4 harga satuan ikut dirapikan', baris[0].harga_satuan, 150000);
cek('§4 baris kosong dilewati tanpa pesan', salah.length, 1);
benar('§4 baris cacat menyebut nomor & sebabnya', /Baris 4: qty bukan angka/.test(salah[0]), salah[0]);
cek('§5 modal terisi tersimpan sebagai angka', baris[0].modal, '100000');
// '' bukan '0': laporan harus bisa membedakan "belum diketahui" dari "gratis".
cek('§5 modal kosong tetap kosong', baris[1].modal, '');
cek('§4 totalBaris tanpa qty', totalBaris({ qty: '', harga: '100' }), null);

const r = ringkasBarisKorporat(rows);
cek('§5 ringkas: total', r.total, 850000);
cek('§5 ringkas: sparepart vs jasa dipisah', [r.sparepart, r.jasa], [600000, 250000]);
cek('§5 ringkas: baris tanpa modal dihitung', r.tanpaModal, 0);
cek('§5 jasa tidak dihitung sebagai tanpa-modal',
  ringkasBarisKorporat([{ item_type: 'jasa', nama: 'J', qty: '1', harga: '100', modal: '' }]).tanpaModal, 0);
cek('§5 sparepart tanpa modal dihitung',
  ringkasBarisKorporat([{ item_type: 'sparepart', nama: 'S', qty: '1', harga: '100', modal: '' }]).tanpaModal, 1);

// ===============================================================
console.log('§6 Isian dari master sparepart');
// ===============================================================
const sp = { id: 'u1', sku: 'AF.AVZ', name: 'A/F AVANZA', jenis: 'sparepart', harga_jual: 136500, harga_beli: 90000 };
const dari = dariMaster(sp);
cek('§6 SKU & nama ikut', [dari.sku, dari.nama], ['AF.AVZ', 'A/F AVANZA']);
cek('§6 harga jual jadi usulan', dari.harga, '136500');
cek('§6 harga beli jadi modal', dari.modal, '90000');
// Qty TIDAK diisi otomatis: nilai bawaan "1" adalah cara tercepat menyimpan
// jumlah yang tidak pernah dihitung siapa pun.
cek('§6 qty tetap kosong', dari.qty, '');
cek('§6 jenis jasa ikut terbawa', dariMaster({ ...sp, jenis: 'jasa' }).item_type, 'jasa');
cek('§6 tanpa harga di master: kosong, bukan 0', dariMaster({ id: 'x', sku: 'A', name: 'B', jenis: 'sparepart' }).harga, '');
cek('§6 tanpa master = baris kosong', dariMaster(null), barisKosong());

console.log(`\n${gagal === 0 ? '✅' : '❌'} test-baris-korporat: ${n - gagal}/${n} lulus`);
process.exit(gagal === 0 ? 0 : 1);
