/**
 * AUDIT: peringatan "melebihi stok" hanya di layar yang stoknya milik PENGIRIM.
 *
 * ============ KENAPA INI PERLU DIJAGA ============
 *
 * `createItemPicker` dipakai empat layar, dan `stockMap` yang dikirimkan
 * artinya BERBEDA di masing-masing:
 *
 *   Kirim / Transfer      stok outlet PENGIRIM  -> "melebihi stok" = benar
 *   Isi Draft SJ          stok outlet PENGIRIM  -> "melebihi stok" = benar
 *   Order ke CK           stok outlet PEMESAN   -> "melebihi stok" = MENYESATKAN
 *   Ubah Order ke CK      stok outlet PEMESAN   -> "melebihi stok" = MENYESATKAN
 *
 * Orang MEMESAN justru karena stoknya menipis. Menyalakan peringatan di layar
 * order berarti ia menyala pada hampir setiap baris yang benar — dan peringatan
 * yang menyala saat semuanya normal berhenti dibaca dalam hitungan hari.
 * Sesudah itu ia tidak melindungi apa pun, termasuk di dua layar yang
 * membutuhkannya.
 *
 * Kegagalannya sepenuhnya SENYAP: tidak ada error, tidak ada tes yang merah,
 * hanya tanda ⚠ yang perlahan kehilangan arti.
 */
const fs = require('fs');
const path = require('path');

const AKAR = path.dirname(__dirname);
let gagal = 0;
const salah = (pesan) => {
  gagal++;
  console.error(`❌ ${pesan}`);
};

const BERKAS = 'js/modules/dispatch/dispatch.page.js';
const isi = fs.readFileSync(path.join(AKAR, BERKAS), 'utf8');

/**
 * Ambil isi tiap panggilan `createItemPicker(...)` beserta nomor barisnya.
 *
 * Dihitung dengan menghitung kurung, bukan regex sampai `)` pertama —
 * argumennya berisi objek bersarang dan komentar, dan pemotongan yang terlalu
 * awal membuat audit ini memeriksa penggalan yang salah lalu hijau tanpa arti.
 */
function panggilanPicker(teks) {
  const hasil = [];
  const pola = /createItemPicker\s*\(/g;
  let m;
  while ((m = pola.exec(teks))) {
    let i = teks.indexOf('(', m.index);
    let dalam = 0;
    const awal = i;
    for (; i < teks.length; i++) {
      if (teks[i] === '(') dalam++;
      else if (teks[i] === ')') {
        dalam--;
        if (dalam === 0) break;
      }
    }
    hasil.push({
      argumen: teks.slice(awal, i + 1),
      baris: teks.slice(0, m.index).split('\n').length
    });
  }
  return hasil;
}

const panggilan = panggilanPicker(isi);

if (panggilan.length < 3) {
  salah(
    `${BERKAS}: hanya ${panggilan.length} panggilan createItemPicker ditemukan (diharapkan minimal 3). ` +
      'Audit ini kehilangan sasarannya, jadi dilaporkan gagal daripada lolos tanpa memeriksa apa pun.'
  );
}

for (const { argumen, baris } of panggilan) {
  const menyala = /peringatanKurang\s*:\s*true/.test(argumen);

  // Layar order dikenali dari elemen tempat pickernya dipasang. Itu penanda
  // yang paling dekat dengan maksudnya — nama variabel bisa berubah, id
  // elemennya jauh lebih jarang.
  const layarOrder = /#ord-picker|#ord-edit-picker/.test(argumen);

  if (layarOrder && menyala) {
    salah(
      `${BERKAS}:${baris}: layar Order ke CK menyalakan \`peringatanKurang\`. ` +
        'Di sana `stockMap` adalah stok outlet yang MEMESAN — dan orang memesan justru karena stoknya menipis. ' +
        'Peringatannya akan menyala pada hampir setiap baris yang benar, lalu berhenti dibaca.'
    );
  }

  if (!layarOrder && !menyala) {
    salah(
      `${BERKAS}:${baris}: panggilan createItemPicker ini TIDAK menyalakan \`peringatanKurang\`. ` +
        'Layar yang mengirim barang memakai stok pengirim, jadi kelebihan jumlah harus ketahuan sekarang — ' +
        'bukan besok saat barangnya ternyata tidak ada di rak.'
    );
  }
}

// ---------------------------------------------------------------
// Pickernya sendiri: bawaannya harus MATI.
//
// Kalau bawaannya menyala, layar order yang tidak menyebut opsi itu sama
// sekali akan ikut menyala tanpa ada yang menuliskannya di mana pun.
// ---------------------------------------------------------------
const picker = fs.readFileSync(path.join(AKAR, 'js/modules/dispatch/item-picker.js'), 'utf8');
if (!/peringatanKurang\s*=\s*false/.test(picker)) {
  salah(
    'js/modules/dispatch/item-picker.js: `peringatanKurang` tidak berbawaan `false`. ' +
      'Opsi yang menyala secara bawaan akan ikut aktif di layar Order ke CK tanpa satu baris pun yang menyatakannya.'
  );
}

// Produk yang belum pernah punya pergerakan tidak boleh ikut diperingatkan:
// `stok == null` berarti "belum ada catatannya", bukan "nol".
if (!/if \(stok == null\) return false;/.test(picker)) {
  salah(
    'js/modules/dispatch/item-picker.js: `kurang()` tidak melewati produk tanpa catatan stok (`stok == null`). ' +
      'Tanpa itu, setiap produk baru akan menyala ⚠ — bising yang membuat tandanya berhenti berarti.'
  );
}

if (gagal === 0) {
  console.log('Peringatan stok: menyala di layar pengirim, mati di layar pemesan, bawaannya aman. ✅');
}
process.exit(gagal === 0 ? 0 : 1);
