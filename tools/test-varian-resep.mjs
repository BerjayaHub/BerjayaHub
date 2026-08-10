/**
 * Varian resep saat impor Excel.
 *
 * BUG YANG MELAHIRKAN TES INI: mode resep ditebak dari tipe produk —
 * `semi ? 'production' : 'standalone'` — dan kolom varian tidak pernah dibaca.
 * Akibatnya resep **Dilayani CK** mustahil diimpor: file-nya diterima, impornya
 * dilaporkan berhasil, tapi kolom "Dilayani CK" tetap "Belum". Dari sisi yang
 * memakainya, itu tidak bisa dibedakan dari gagal — dan tidak ada satu pun
 * pesan yang bisa menuntunnya.
 *
 * Cermin dari `importRecipes()` di product-import.js. Yang dijaga: setiap
 * varian bisa dituju, varian yang salah tipe DITOLAK dengan alasan, dan tulisan
 * bebas orang ("CK", "dilayani ck", kosong) tetap terbaca.
 */

let gagal = 0;
const cek = (nama, dapat, harap) => {
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};

const VARIAN_SAH = { semi: ['production'], finished: ['standalone', 'served_by_ck'] };

function bacaVarian(teks) {
  const t = String(teks ?? '')
    .trim()
    .toLowerCase();
  if (!t) return null;
  if (['production', 'produksi', 'ck', 'produksi (ck)'].includes(t)) return 'production';
  if (['standalone', 'mandiri', 'sendiri'].includes(t)) return 'standalone';
  if (['served_by_ck', 'dilayani ck', 'dilayani_ck', 'dari ck', 'semi'].includes(t)) return 'served_by_ck';
  return 'TIDAK_DIKENAL';
}

/** @returns {{mode:string}|{tolak:string}} */
function tentukanMode(tipeProduk, kolomVarian, sudahAda = []) {
  if (tipeProduk === 'raw') return { tolak: 'bahan baku tidak punya resep' };
  const v = bacaVarian(kolomVarian);
  if (v === 'TIDAK_DIKENAL') return { tolak: 'varian tidak dikenal' };
  const sah = VARIAN_SAH[tipeProduk] ?? [];
  const mode = v ?? sah[0];
  if (!sah.includes(mode)) return { tolak: 'varian tidak berlaku untuk tipe ini' };
  if (sudahAda.includes(mode)) return { tolak: 'sudah ada' };
  return { mode };
}

// --- Inti bug-nya: menu bisa punya DUA varian, dan keduanya harus bisa dituju ---
cek('menu + "Dilayani CK" -> served_by_ck', tentukanMode('finished', 'Dilayani CK'), { mode: 'served_by_ck' });
cek('menu + "Standalone" -> standalone', tentukanMode('finished', 'Standalone'), { mode: 'standalone' });
cek('dua varian menu berdiri sendiri', tentukanMode('finished', 'Dilayani CK', ['standalone']), { mode: 'served_by_ck' });
cek('varian yang sudah ada dilewati, bukan ditimpa', tentukanMode('finished', 'Standalone', ['standalone']), { tolak: 'sudah ada' });

// --- Setengah jadi hanya punya satu varian ---
cek('setengah jadi + "Produksi"', tentukanMode('semi', 'Produksi'), { mode: 'production' });
cek('setengah jadi + kosong -> production', tentukanMode('semi', ''), { mode: 'production' });
cek('setengah jadi + "Standalone" ditolak', tentukanMode('semi', 'Standalone'), { tolak: 'varian tidak berlaku untuk tipe ini' });
cek('setengah jadi + "Dilayani CK" ditolak', tentukanMode('semi', 'Dilayani CK'), { tolak: 'varian tidak berlaku untuk tipe ini' });

// --- Menu + "Produksi" tidak berlaku: produksi hanya untuk setengah jadi ---
cek('menu + "Produksi" ditolak dengan alasan', tentukanMode('finished', 'Produksi'), { tolak: 'varian tidak berlaku untuk tipe ini' });

// --- Kolom kosong: perilaku lama dipertahankan, supaya file lama tetap jalan ---
cek('menu + kosong -> standalone (seperti file lama)', tentukanMode('finished', ''), { mode: 'standalone' });
cek('kolom Varian tidak ada sama sekali', tentukanMode('finished', undefined), { mode: 'standalone' });

// --- Tulisan bebas orang. Menolak karena beda huruf besar hanya membuat orang
//     menyerah dan kembali mengetik satu per satu. ---
for (const teks of ['ck', 'CK', ' Ck ', 'produksi', 'PRODUKSI', 'Produksi (CK)']) {
  cek(`"${teks}" terbaca sebagai produksi`, bacaVarian(teks), 'production');
}
for (const teks of ['dilayani ck', 'Dilayani CK', 'DILAYANI CK', 'dari ck', 'served_by_ck']) {
  cek(`"${teks}" terbaca sebagai dilayani CK`, bacaVarian(teks), 'served_by_ck');
}
cek('tulisan yang tidak dikenal ditolak, bukan ditebak', bacaVarian('resep CK saja'), 'TIDAK_DIKENAL');
cek('bahan baku tetap tidak punya resep', tentukanMode('raw', ''), { tolak: 'bahan baku tidak punya resep' });

// Menebak-nebak lebih berbahaya daripada menolak: resep yang masuk ke varian
// yang salah menghasilkan HPP yang salah, dan HPP yang salah dipakai untuk
// menentukan harga jual.
cek('"varian ck saja" tidak diam-diam jadi production', tentukanMode('finished', 'varian ck saja'), { tolak: 'varian tidak dikenal' });

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('Varian resep saat impor benar untuk 24 kasus, termasuk resep "Dilayani CK" yang dulu mustahil diimpor. ✅');
