/**
 * TES `js/modules/cash/koreksi-kas.js`.
 *
 * ============ YANG PALING PERLU DIJAGA ============
 *
 * 1. ENTRI YANG DICORET TIDAK BOLEH IKUT TOTAL. Saldo di kartu atas halaman
 *    dihitung server (`cash_balances`, 0141) dan sudah menyaringnya; kalau
 *    layar menjumlahkan sendiri tanpa menyaring, dua angka untuk hal yang sama
 *    tampil berbeda di satu halaman — dan yang membacanya tidak punya cara tahu
 *    mana yang benar.
 *
 * 2. `alasan_tolak` YANG HILANG BERARTI BOLEH, bukan sebaliknya. Kalau server
 *    tidak mengirim kolom itu (RPC gagal sebagian, versi lama), menebak "tidak
 *    boleh" akan mematikan tombol Ubah/Hapus untuk SEMUA orang — dan servernya
 *    tetap punya penjaga sungguhan, jadi menebak "boleh" tidak membuka apa pun.
 */
import {
  keadaanKoreksi,
  jejakKoreksi,
  nominalEfektif,
  totalKas,
  LABEL_DICORET
} from '../js/modules/cash/koreksi-kas.js';

let gagal = 0;
const tandai = (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? `NON-FINITE:${String(v)}` : v);
const cek = (nama, dapat, harap) => {
  if (JSON.stringify(dapat, tandai) !== JSON.stringify(harap, tandai)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat, tandai)}\n   harap : ${JSON.stringify(harap, tandai)}`);
  }
};
const benar = (nama, syarat, ket = '') => {
  if (!syarat) {
    gagal++;
    console.error(`❌ ${nama}${ket ? ' — ' + ket : ''}`);
  }
};

const BIASA = { id: 'e1', amount: -50000, alasan_tolak: null };

// =====================================================================
// §1 BOLEH TIDAKNYA DIKOREKSI
// =====================================================================
{
  const k = keadaanKoreksi(BIASA);
  cek('§1 entri biasa boleh dikoreksi', k.bolehKoreksi, true);
  cek('§1 dan tidak dicoret', k.dicoret, false);
  cek('§1 tanpa jejak', k.jejak, '');
}
{
  const k = keadaanKoreksi({ ...BIASA, alasan_tolak: 'Entri ini adalah pembayaran nota TRM-1.' });
  cek('§1 entri pembayaran nota tidak boleh', k.bolehKoreksi, false);
  // Sebabnya DIBAWA, bukan dibuang: ia yang ditulis di tombol yang mati.
  cek('§1 dan sebabnya dibawa apa adanya', k.alasanTolak, 'Entri ini adalah pembayaran nota TRM-1.');
}
{
  const k = keadaanKoreksi({ ...BIASA, dicoret_at: '2026-09-14T03:00:00Z' });
  cek('§1 entri yang sudah dicoret tidak bisa dikoreksi lagi', k.bolehKoreksi, false);
  cek('§1 dan ditandai dicoret', k.dicoret, true);
}

// `alasan_tolak` TIDAK ADA -> boleh. Servernya tetap penjaganya.
cek('§1 kolom alasan_tolak hilang berarti boleh', keadaanKoreksi({ id: 'x', amount: 1 }).bolehKoreksi, true);
cek('§1 alasan_tolak string kosong juga berarti boleh', keadaanKoreksi({ ...BIASA, alasan_tolak: '' }).bolehKoreksi, true);
cek('§1 baris null tidak melempar', keadaanKoreksi(null).bolehKoreksi, true);

// =====================================================================
// §2 JEJAK "DIUBAH / DIHAPUS OLEH SIAPA"
// =====================================================================
{
  const j = jejakKoreksi({ dicoret_at: '2026-09-14T03:00:00Z', dicoret_oleh: 'Seruni', alasan_coret: 'salah input' });
  benar('§2 menyebut labelnya', j.includes(LABEL_DICORET), j);
  benar('§2 menyebut siapa', j.includes('Seruni'), j);
  benar('§2 menyebut alasannya', j.includes('salah input'), j);
}
{
  const j = jejakKoreksi({ diubah_at: '2026-09-13T02:00:00Z', diubah_oleh: 'iko permadi' });
  benar('§2 jejak ubah menyebut siapa', j.includes('iko permadi'), j);
  benar('§2 dan tidak mengaku dihapus', !j.includes(LABEL_DICORET), j);
}
{
  // Urutan "diubah lalu dihapus" adalah bagian dari ceritanya — membuang yang
  // pertama membuat yang kedua tidak bisa dijelaskan.
  const j = jejakKoreksi({
    dicoret_at: '2026-09-14T03:00:00Z',
    dicoret_oleh: 'Seruni',
    diubah_at: '2026-09-13T02:00:00Z',
    diubah_oleh: 'Iis'
  });
  benar('§2 keduanya ditampilkan', j.includes('Seruni') && j.includes('Iis'), j);
}
cek('§2 belum pernah disentuh: tidak ada tempat kosong', jejakKoreksi({ id: 'e1' }), '');
cek('§2 baris null aman', jejakKoreksi(null), '');
{
  // Nama penghapus yang tidak terbaca (user sudah dihapus) tidak boleh
  // menghasilkan "oleh undefined" — itu terbaca seperti kerusakan.
  const j = jejakKoreksi({ dicoret_at: '2026-09-14T03:00:00Z' });
  benar('§2 tanpa nama tetap kalimat yang wajar', !/undefined|null/.test(j), j);
  benar('§2 dan tetap mengaku dihapus', j.includes(LABEL_DICORET), j);
}

// =====================================================================
// §3 NOMINAL & TOTAL — INTI BERKAS INI
// =====================================================================
cek('§3 entri biasa bernilai apa adanya', nominalEfektif({ amount: -50000 }), -50000);
cek('§3 entri dicoret bernilai NOL', nominalEfektif({ amount: -50000, dicoret_at: '2026-09-14T03:00:00Z' }), 0);
// `Number('')` dan `Number(null)` adalah 0, bukan NaN — tapi `Infinity` lolos
// dan mencetak "Rp∞" di layar keuangan.
cek('§3 nominal non-finite dianggap nol', nominalEfektif({ amount: Infinity }), 0);
cek('§3 nominal NaN dianggap nol', nominalEfektif({ amount: 'bukan angka' }), 0);

{
  const t = totalKas([
    { amount: 500000 },
    { amount: -50000 },
    { amount: -1000000, dicoret_at: '2026-09-14T03:00:00Z' },
    { amount: 900000, dicoret_at: '2026-09-14T03:00:00Z' }
  ]);
  cek('§3 masuk mengabaikan yang dicoret', t.masuk, 500000);
  cek('§3 keluar mengabaikan yang dicoret', t.keluar, 50000);
  cek('§3 net-nya ikut benar', t.net, 450000);
  // Jumlah yang dicoret DISEBUT. Total yang diam-diam lebih kecil dari jumlah
  // barisnya adalah persis bentuk kegagalan yang paling sering lolos di sini.
  cek('§3 berapa yang dicoret ikut dilaporkan', t.dicoret, 2);
}
cek('§3 daftar kosong aman', totalKas([]), { masuk: 0, keluar: 0, net: 0, dicoret: 0 });
cek('§3 bukan array aman', totalKas('x'), { masuk: 0, keluar: 0, net: 0, dicoret: 0 });
{
  const t = totalKas([{ amount: Infinity }, { amount: NaN }]);
  benar('§3 total tetap angka wajar walau isinya rusak', Number.isFinite(t.masuk) && Number.isFinite(t.keluar));
}

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('koreksi-kas.js benar — entri dicoret tidak ikut total, jejaknya lengkap, dan tombolnya tidak mati tanpa sebab. ✅');
