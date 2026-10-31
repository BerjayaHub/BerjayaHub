/**
 * ACUAN SATUAN BELI DI OPNAME — tes murni.
 *
 * ============ YANG SEBENARNYA DIUJI DI SINI ============
 *
 * Baris ini dibaca sambil berdiri di depan rak, dan satu-satunya gunanya
 * adalah membuat dus yang belum dibuka TIDAK perlu dibongkar. Jadi yang
 * berbahaya bukan barisnya salah hitung — itu akan ketahuan saat angkanya
 * tidak cocok — melainkan barisnya MUNCUL untuk produk yang acuannya tidak
 * berarti apa-apa, atau menampilkan ekor desimal yang membuat orang ragu pada
 * angka yang sebenarnya benar.
 */
import {
  labelAcuan,
  pecahSatuanBeli,
  punyaAcuan,
  teksAcuanStok
} from '../js/modules/inventory/acuan-satuan-beli.js';

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

const DUS = { base_unit: 'pcs', purchase_unit: 'dus', purchase_qty: 50 };

// ===============================================================
console.log('§1 Kapan acuannya berguna');
// ===============================================================
benar('§1 dus isi 50 berguna', punyaAcuan(DUS));

// ============ TIGA KEADAAN YANG TERLIHAT PUNYA TAPI TIDAK BERGUNA ============
//
// Ketiganya menambah satu baris di TIAP kartu opname tanpa menambah satu pun
// keterangan — dan daftar opname bisa dua ratus baris.
benar('§1 isi 1 tidak berguna', !punyaAcuan({ ...DUS, purchase_qty: 1 }));
benar('§1 satuan yang sama tidak berguna', !punyaAcuan({ base_unit: 'pcs', purchase_unit: 'pcs', purchase_qty: 12 }));
benar('§1 beda huruf besar tetap dianggap sama', !punyaAcuan({ base_unit: 'Pcs', purchase_unit: 'pcs', purchase_qty: 12 }));
benar('§1 tanpa satuan beli', !punyaAcuan({ base_unit: 'pcs' }));
benar('§1 isi nol — pembaginya akan jadi Infinity', !punyaAcuan({ ...DUS, purchase_qty: 0 }));
benar('§1 isi negatif', !punyaAcuan({ ...DUS, purchase_qty: -5 }));

// ============ ISI PECAHAN ITU SAH ============
//
// 1 pack = 0,5 kg memang terjadi (kemasan 500 gram, satuan kecilnya kg).
// Versi pertama modul ini memakai ambang `<= 1` dan membuangnya — sementara
// `konversi-satuan.js` tetap mengonversinya saat ekspor ESB. Produk yang sama
// dianggap bersatuan beli di satu tempat dan tidak di tempat lain, tanpa satu
// pun galat.
benar('§1 isi pecahan 0,5 tetap berguna', punyaAcuan({ base_unit: 'kg', purchase_unit: 'pack', purchase_qty: 0.5 }));
cek(
  '§1 dan ikut dipecah dengan benar',
  pecahSatuanBeli(3, { base_unit: 'kg', purchase_unit: 'pack', purchase_qty: 0.5 }),
  { besar: 6, sisa: 0 }
);
benar('§1 isi bukan angka', !punyaAcuan({ ...DUS, purchase_qty: 'sepuluh' }));
benar('§1 tanpa argumen tidak melempar', !punyaAcuan());

// ===============================================================
console.log('§2 Label isinya');
// ===============================================================
cek('§2 label', labelAcuan(DUS), '1 dus = 50 pcs');
cek('§2 yang tidak berguna tidak berlabel', labelAcuan({ ...DUS, purchase_qty: 1 }), '');
cek('§2 isi pecahan ditulis apa adanya', labelAcuan({ base_unit: 'kg', purchase_unit: 'sak', purchase_qty: 25.5 }), '1 sak = 25.5 kg');

// ===============================================================
console.log('§3 Memecah ke satuan beli');
// ===============================================================
cek('§3 pas', pecahSatuanBeli(200, DUS), { besar: 4, sisa: 0 });
cek('§3 ada sisa', pecahSatuanBeli(240, DUS), { besar: 4, sisa: 40 });
cek('§3 kurang dari satu dus', pecahSatuanBeli(30, DUS), { besar: 0, sisa: 30 });
cek('§3 nol', pecahSatuanBeli(0, DUS), { besar: 0, sisa: 0 });

// ============ EKOR DESIMAL TIDAK BOLEH TERCETAK ============
//
// `240.3 % 50` menghasilkan 40.299999999999955. Angka seperti itu di layar
// membuat orang ragu pada hitungan yang sebenarnya benar — dan keraguan itu
// berakhir dengan dus yang dibongkar, persis yang ingin dihindari.
const pecahan = pecahSatuanBeli(240.3, DUS);
cek('§3 sisanya dibulatkan rapi', pecahan.sisa, 40.3);
benar('§3 tidak ada ekor panjang', String(pecahan.sisa).length <= 6, String(pecahan.sisa));

cek('§3 produk tanpa acuan tidak dipecah', pecahSatuanBeli(240, { base_unit: 'pcs' }), null);
cek('§3 jumlah negatif ditolak', pecahSatuanBeli(-5, DUS), null);
cek('§3 jumlah bukan angka', pecahSatuanBeli('x', DUS), null);

// ===============================================================
console.log('§4 Kalimat acuannya');
// ===============================================================
cek('§4 pas', teksAcuanStok(200, DUS), '≈ 4 dus');
cek('§4 ada sisa', teksAcuanStok(240, DUS), '≈ 4 dus + 40 pcs');

// Di bawah satu satuan beli, "0 dus + 30 pcs" cuma menambah kata tanpa
// menambah keterangan — yang terlihat di rak memang 30 pcs lepas.
cek('§4 kurang dari satu satuan beli: diam', teksAcuanStok(30, DUS), '');
cek('§4 nol: diam', teksAcuanStok(0, DUS), '');
cek('§4 tanpa acuan: diam', teksAcuanStok(240, { base_unit: 'pcs' }), '');

// ============ "≈" DIPAKAI WALAU ANGKANYA PERSIS ============
//
// Yang mengikat tetap angka satuan kecilnya. Tanpa tanda itu, "4 dus" terbaca
// seperti perintah mengisi 4 — dan 4 di kotak berarti 4 pcs.
benar('§4 selalu memakai tanda kira-kira', teksAcuanStok(200, DUS).startsWith('≈'));

cek('§4 tanpa argumen tidak melempar', teksAcuanStok(), '');
benar('§4 tidak pernah menulis NaN/undefined', !/NaN|undefined|Infinity/.test(teksAcuanStok(240.3, DUS)), teksAcuanStok(240.3, DUS));

// ---------------------------------------------------------------
console.log(`\n${gagal === 0 ? '✅' : '❌'} test-acuan-satuan-beli: ${n - gagal}/${n} lulus`);
process.exit(gagal === 0 ? 0 : 1);
