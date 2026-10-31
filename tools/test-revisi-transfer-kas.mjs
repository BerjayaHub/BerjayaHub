/**
 * REVISI TRANSFER KAS — tes murni.
 *
 * ============ YANG SEBENARNYA DIUJI DI SINI ============
 *
 * Transfer menyentuh DUA orang, dan yang kedua tidak sedang memegang HP ini.
 * Jadi yang diuji bukan "apakah tombolnya muncul", melainkan apakah akibat ke
 * orang lain BENAR-BENAR dikatakan sebelum tombolnya ditekan — dan apakah
 * tombolnya menutup diri saat servernya belum mampu melayaninya.
 */
import {
  adalahTransfer,
  keadaanRevisiTransfer,
  perubahanTransfer,
  peringatanRevisi,
  pesanSesudahRevisi
} from '../js/modules/cash/revisi-transfer-kas.js';

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
console.log('§1 Mana yang transfer');
// ===============================================================
benar('§1 transfer_out', adalahTransfer({ entry_type: 'transfer_out' }));
benar('§1 transfer_in', adalahTransfer({ entry_type: 'transfer_in' }));
benar('§1 kas keluar biasa bukan', !adalahTransfer({ entry_type: 'out' }));
benar('§1 tanpa argumen', !adalahTransfer());

// ===============================================================
console.log('§2 Keadaan tombol');
// ===============================================================
const T = (o) => ({ entry_type: 'transfer_out', dicoret_at: null, alasan_tolak_transfer: '', ...o });

cek('§2 transfer yang sah: tombolnya hidup', keadaanRevisiTransfer(T({})), { tampil: true, boleh: true, alasan: '' });

// Baris biasa TIDAK digambari tombol transfer sama sekali — bukan tombol mati.
// Tombol mati hanya berguna kalau orang MENGHARAPKAN tombol di situ.
benar('§2 entri biasa tidak menampilkan tombol transfer', keadaanRevisiTransfer({ entry_type: 'out' }).tampil === false);
benar('§2 entri yang sudah dicoret juga tidak', keadaanRevisiTransfer(T({ dicoret_at: 'x' })).tampil === false);

const ditolak = keadaanRevisiTransfer(T({ alasan_tolak_transfer: 'Sudah diekspor ke ESB.' }));
benar('§2 yang ditolak: tombolnya ada tapi mati', ditolak.tampil === true && ditolak.boleh === false);
cek('§2 dan sebabnya dibawa apa adanya', ditolak.alasan, 'Sudah diekspor ke ESB.');

// ============ SERVER LAMA TIDAK BOLEH DIANGGAP MENGIZINKAN ============
//
// Kalau migrationnya belum dijalankan, kolomnya tidak ada sama sekali —
// `undefined`, bukan string kosong. Menganggapnya "boleh" berarti dialognya
// terbuka, diisi, lalu ditolak server dengan pesan yang tidak menyebut sebab
// sebenarnya.
const belumAda = keadaanRevisiTransfer({ entry_type: 'transfer_out', dicoret_at: null });
benar('§2 kolom yang belum ada = tombol MATI, bukan hidup', belumAda.tampil === true && belumAda.boleh === false);
benar('§2 dan sebabnya menyebut servernya', /belum aktif di server/i.test(belumAda.alasan), belumAda.alasan);

// ===============================================================
console.log('§3 Apa yang berubah');
// ===============================================================
const SEMULA = { jumlah: 300000, kantong: 'Kas CK iis', penerima: 'Elsha', catatan: 'bayar bahan' };

cek('§3 tidak ada yang berubah', perubahanTransfer(SEMULA, { ...SEMULA }), []);

const ubahJumlah = perubahanTransfer(SEMULA, { ...SEMULA, jumlah: 250000 });
cek('§3 jumlah', ubahJumlah, [{ apa: 'Jumlah', semula: 300000, menjadi: 250000, angka: true }]);

// Tanda minus pada kaki keluar tidak boleh bocor ke ringkasan: "−300.000 →
// 250.000" terbaca seperti arah uangnya ikut berubah.
cek(
  '§3 tanda minus kaki keluar tidak ikut tampil',
  perubahanTransfer({ ...SEMULA, jumlah: -300000 }, { ...SEMULA, jumlah: 250000 })[0].semula,
  300000
);

cek('§3 kantong kosong disebut Kas Utama', perubahanTransfer({ ...SEMULA, kantong: '' }, SEMULA)[0], {
  apa: 'Kantong asal',
  semula: 'Kas Utama',
  menjadi: 'Kas CK iis',
  angka: false
});
cek('§3 penerima', perubahanTransfer(SEMULA, { ...SEMULA, penerima: 'Iis' })[0].apa, 'Penerima');
cek('§3 keterangan kosong ditulis apa adanya', perubahanTransfer(SEMULA, { ...SEMULA, catatan: '' })[0].menjadi, '(kosong)');
cek('§3 beberapa sekaligus', perubahanTransfer(SEMULA, { jumlah: 1, kantong: 'X', penerima: 'Y', catatan: 'Z' }).length, 4);
cek('§3 tanpa argumen tidak melempar', perubahanTransfer().length, 0);

// ===============================================================
console.log('§4 Peringatan SEBELUM disimpan');
// ===============================================================
cek('§4 penerima tidak berubah: tidak ada peringatan', peringatanRevisi({ penerimaLama: 'Iis', penerimaBaru: 'Iis', jumlahLama: 1 }), []);

const p = peringatanRevisi({ penerimaLama: 'Iis', penerimaBaru: 'Elsha', jumlahLama: -300000 });
cek('§4 dua kalimat', p.length, 2);
benar('§4 menyebut barisnya hilang dari riwayat penerima lama', /HILANG dari riwayat kas Iis/.test(p[0]), p[0]);
benar('§4 dan jumlahnya tanpa tanda minus', p[0].includes('300000'), p[0]);
benar('§4 menyebut kemungkinan MINUS', /MINUS/.test(p[1]), p[1]);

// ============ ANGKA YANG TIDAK PERNAH DIKETAHUI TIDAK DISEBUT ============
//
// Saldo penerima lama ada di kas orang lain dan tidak terbaca layar pengirim.
// Percobaan pertama berkas ini menghitung "sisa = saldo − jumlah" dengan
// saldo yang selalu salah, jadi cabang MINUS-nya tidak pernah bisa menyala —
// peringatan yang mustahil muncul lebih buruk daripada tidak ada.
benar('§4 tidak mengarang angka sisa saldo', !/MINUS \d/.test(p[1]), p[1]);

// ===============================================================
console.log('§5 Kalimat SESUDAH tersimpan');
// ===============================================================
cek('§5 penerima tidak berubah: diam', pesanSesudahRevisi({ penerima_berubah: false }, 'Iis'), '');
cek('§5 tanpa jawaban server', pesanSesudahRevisi(null, 'Iis'), '');

const minus = pesanSesudahRevisi({ penerima_berubah: true, saldo_penerima_lama: -200000 }, 'Iis');
benar('§5 saldo minus disebut terang-terangan', /MINUS 200000/.test(minus), minus);
benar('§5 dan menyuruh memberi tahu orangnya', /Beri tahu dia/.test(minus), minus);

const aman = pesanSesudahRevisi({ penerima_berubah: true, saldo_penerima_lama: 50000 }, 'Iis');
benar('§5 saldo masih positif: dikabarkan tanpa alarm', !/MINUS/.test(aman) && aman.includes('50000'), aman);
benar('§5 nama kosong tetap jadi kalimat yang terbaca', pesanSesudahRevisi({ penerima_berubah: true, saldo_penerima_lama: 0 }, '').includes('penerima lama'));

// ---------------------------------------------------------------
console.log(`\n${gagal === 0 ? '✅' : '❌'} test-revisi-transfer-kas: ${n - gagal}/${n} lulus`);
process.exit(gagal === 0 ? 0 : 1);
