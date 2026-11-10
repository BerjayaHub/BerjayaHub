/**
 * ATURAN REVISI & PEMBATALAN WASTE — tes murni.
 *
 *   §1 Siapa & apa yang boleh direvisi.
 *   §2 Satu kejadian = satu tombol, walau barisnya banyak.
 *   §3 Isian yang ditolak sebelum dikirim.
 *   §4 Ringkasan perubahan: yang tidak berubah tidak disebut.
 *   §5 Pesan sesudah revisi.
 */
import {
  SEBAB,
  PESAN_SEBAB,
  keadaanRevisiWaste,
  barisPemegangAksi,
  sahkanRevisiWaste,
  ringkasPerubahanWaste,
  pesanSesudahRevisi
} from '../js/modules/inventory/aturan-revisi-waste.js';

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
console.log('§1 Siapa & apa yang boleh direvisi');
// ===============================================================
const biasa = { wasteId: 'w1', lama: false, terkunci: false };

cek('§1 bukan admin: tidak boleh', keadaanRevisiWaste(biasa, { bolehKelola: false }).sebab, SEBAB.TAK_BERWENANG);
// Gagal memeriksa wewenang = DIANGGAP TIDAK BERWENANG. Arah sebaliknya membuka
// tombolnya untuk semua orang justru saat jaringannya sedang bermasalah.
cek('§1 tanpa keterangan wewenang: dianggap tidak berwenang', keadaanRevisiWaste(biasa).boleh, false);
cek('§1 admin: boleh', keadaanRevisiWaste(biasa, { bolehKelola: true }).boleh, true);

// Baris lama (sebelum 0135) tidak punya `waste_runs` — tidak ada kejadian yang
// bisa direvisi, dan menawarkan tombolnya berarti menjanjikan yang tidak ada.
cek(
  '§1 baris lama: tidak punya kejadian',
  keadaanRevisiWaste({ wasteId: 'w1', lama: true }, { bolehKelola: true }).sebab,
  SEBAB.LAMA
);
cek('§1 tanpa wasteId sama sekali', keadaanRevisiWaste({}, { bolehKelola: true }).sebab, SEBAB.LAMA);
cek(
  '§1 yang sudah dibatalkan tidak bisa direvisi',
  keadaanRevisiWaste({ wasteId: 'w1', dibatalkan: true }, { bolehKelola: true }).sebab,
  SEBAB.DIBATALKAN
);
benar('§1 tiap sebab punya kalimatnya', [SEBAB.LAMA, SEBAB.TAK_BERWENANG, SEBAB.DIBATALKAN].every((s) => PESAN_SEBAB[s]));

// ============ SUDAH DIEKSPOR: BOLEH, TAPI DIKATAKAN ============
const terkunci = keadaanRevisiWaste({ wasteId: 'w1', terkunci: true }, { bolehKelola: true });
cek('§1 yang sudah diekspor TETAP boleh direvisi', terkunci.boleh, true);
benar('§1 dan peringatannya berbunyi', /ESB/.test(terkunci.peringatan), terkunci.peringatan);
cek('§1 yang belum diekspor tanpa peringatan', keadaanRevisiWaste(biasa, { bolehKelola: true }).peringatan, '');

// ===============================================================
console.log('§2 Satu kejadian = satu tombol');
// ===============================================================
//
// Waste menu "Latte x2" menghasilkan dua baris (susu & gula) yang menunjuk
// kejadian yang sama. Tombol di keduanya membuat admin mengira sedang
// merevisi "baris gula" — padahal yang direvisi seluruh kejadiannya.
const daftar = [
  { wasteId: 'wA', lama: false },
  { wasteId: 'wB', lama: false },
  { wasteId: 'wB', lama: false },
  { wasteId: 'wB', lama: false },
  { wasteId: 'wA', lama: false }
];
cek('§2 hanya baris pertama tiap kejadian', [...barisPemegangAksi(daftar)], [0, 1]);
cek('§2 baris lama tidak pernah memegang tombol', [...barisPemegangAksi([{ wasteId: 'w1', lama: true }])], []);
cek('§2 tanpa wasteId tidak memegang tombol', [...barisPemegangAksi([{}, { wasteId: '' }])], []);
cek('§2 daftar kosong', [...barisPemegangAksi([])], []);
cek('§2 bukan larik tidak melempar', [...barisPemegangAksi(null)], []);
// Kejadian yang barisnya terpisah jauh (tabel terurut tanggal, lalu bahan)
// tetap hanya mendapat satu tombol.
cek(
  '§2 baris yang terpisah jauh tetap satu tombol',
  [...barisPemegangAksi([{ wasteId: 'x' }, { wasteId: 'y' }, { wasteId: 'x' }])],
  [0, 1]
);

// ===============================================================
console.log('§3 Isian yang ditolak sebelum dikirim');
// ===============================================================
cek('§3 lengkap: lolos', sahkanRevisiWaste({ productId: 'p1', qty: 2, alasan: 'salah input' }).ok, true);
cek('§3 tanpa item', sahkanRevisiWaste({ qty: 2, alasan: 'x' }).ok, false);
cek('§3 jumlah nol', sahkanRevisiWaste({ productId: 'p1', qty: 0, alasan: 'x' }).ok, false);
cek('§3 jumlah negatif', sahkanRevisiWaste({ productId: 'p1', qty: -3, alasan: 'x' }).ok, false);
cek('§3 jumlah bukan angka', sahkanRevisiWaste({ productId: 'p1', qty: 'dua', alasan: 'x' }).ok, false);
cek('§3 alasan kosong', sahkanRevisiWaste({ productId: 'p1', qty: 2, alasan: '' }).ok, false);
cek('§3 alasan cuma spasi', sahkanRevisiWaste({ productId: 'p1', qty: 2, alasan: '   ' }).ok, false);
cek('§3 tanpa argumen tidak melempar', sahkanRevisiWaste().ok, false);
benar('§3 penolakannya berbunyi kalimat', /lebih dari 0/.test(sahkanRevisiWaste({ productId: 'p1', qty: 0, alasan: 'x' }).pesan));

// ===============================================================
console.log('§4 Ringkasan perubahan');
// ===============================================================
cek(
  '§4 jumlah saja yang berubah',
  ringkasPerubahanWaste({ namaItem: 'Beras', qty: 2000, notes: '' }, { namaItem: 'Beras', qty: 200, notes: '' }),
  ['Jumlah: 2000 → 200']
);
cek(
  '§4 item & jumlah',
  ringkasPerubahanWaste({ namaItem: 'Beras', qty: 2 }, { namaItem: 'Gula', qty: 5 }),
  ['Item: Beras → Gula', 'Jumlah: 2 → 5']
);
cek(
  '§4 catatan yang dikosongkan tetap disebut',
  ringkasPerubahanWaste({ namaItem: 'Beras', qty: 2, notes: 'kena air' }, { namaItem: 'Beras', qty: 2, notes: '' }),
  ['Catatan: kena air → (kosong)']
);
// Tidak ada yang berubah -> daftar kosong, dan layar memakai itu untuk
// menolak menyimpan revisi yang tidak merevisi apa pun.
cek(
  '§4 tidak ada yang berubah: kosong',
  ringkasPerubahanWaste({ namaItem: 'Beras', qty: 2, notes: 'a' }, { namaItem: 'Beras', qty: 2, notes: 'a' }),
  []
);
cek(
  '§4 spasi di tepi bukan perubahan',
  ringkasPerubahanWaste({ namaItem: 'Beras', qty: 2, notes: 'a' }, { namaItem: ' Beras ', qty: 2, notes: ' a ' }),
  []
);
cek(
  '§4 pecahan panjang dibulatkan',
  ringkasPerubahanWaste({ qty: 1, namaItem: 'x' }, { qty: 100 / 3, namaItem: 'x' }),
  ['Jumlah: 1 → 33.3333']
);

// ===============================================================
console.log('§5 Pesan sesudah revisi');
// ===============================================================
benar('§5 menyebut kodenya', /WST-1/.test(pesanSesudahRevisi({ kode: 'WST-1', baris_stok: 2 })));
benar('§5 menyebut stok dihitung ulang', /[Ss]tok/.test(pesanSesudahRevisi({ kode: 'WST-1', baris_stok: 2 })));
benar(
  '§5 yang sudah diekspor tetap diingatkan sesudahnya',
  /ESB/.test(pesanSesudahRevisi({ kode: 'WST-1', baris_stok: 1, esb_terkunci: true }))
);
benar('§5 tanpa esb tidak menyebut ESB', !/ESB/.test(pesanSesudahRevisi({ kode: 'WST-1', baris_stok: 1 })));
benar('§5 tanpa argumen tidak melempar', typeof pesanSesudahRevisi() === 'string');

console.log(`\n${gagal === 0 ? '✅' : '❌'} test-aturan-revisi-waste: ${n - gagal}/${n} lulus`);
process.exit(gagal === 0 ? 0 : 1);
