/**
 * Aturan koreksi presensi oleh admin — terutama: MENAMBAHKAN CLOCK OUT SAJA.
 *
 * KENAPA INI TIDAK BISA SEBELUMNYA. Dialog koreksi mengisi nilai awalnya dengan
 * membaca TEKS yang tertulis di sel tabel, lalu memasukkannya ke `new Date()`.
 * Teks itu diformat gaya Indonesia — "17 Agu, 08.15" — dan `new Date()` tidak
 * bisa membacanya. Hasilnya `Invalid Date`, isian tanggalnya terbuka KOSONG,
 * dan karena Clock In ditandai wajib, tombol simpan tidak pernah bisa ditekan.
 *
 * Jadi kasus yang paling sering terjadi — staff lupa absen pulang, admin cuma
 * ingin menambahkan jam pulangnya — justru satu-satunya yang mustahil. Dan
 * teks yang dibaca itu bahkan tidak memuat TAHUN, sehingga andai admin
 * mengetik ulang clock-in-nya, ia mengetik dari tebakan.
 *
 * DUA KEPUTUSAN DI FILE INI:
 *
 *   1. Yang tidak diisi TIDAK DIKIRIM, bukan dikirim sebagai kosong.
 *      Koreksi bersifat tambal: mengosongkan satu isian berarti "jangan
 *      sentuh", bukan "hapus". Kalau tidak begini, membetulkan jam masuk akan
 *      diam-diam menghapus jam pulang yang sudah benar — dan sebaliknya.
 *      Menghapus jam pulang tetap MUNGKIN, tapi harus diminta terpisah dan
 *      sadar (`hapusClockOut`), bukan sebagai akibat samping isian kosong.
 *
 *   2. Jam pulang sebelum jam masuk DITOLAK.
 *      NBM dihitung dari selisih keduanya. Selisih negatif tidak menghasilkan
 *      error di mana pun — ia menghasilkan jam kerja negatif atau nol yang
 *      ikut dijumlahkan ke rekap gaji, dan angka itu terlihat seperti angka
 *      biasa. Salah ketik tanggal (mis. tahun lalu) adalah cara paling mudah
 *      menghasilkannya.
 *
 * Tidak ada impor di file ini, supaya bisa diuji tanpa browser.
 */

const waktu = (v) => {
  if (v == null || v === '') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d; // undefined = tidak terbaca
};

const jam = (d) => d.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * @param {object} o
 * @param {string|null} o.inSekarang  ISO clock-in yang tersimpan
 * @param {string|null} o.outSekarang ISO clock-out yang tersimpan
 * @param {string} [o.inBaru]         isian form; kosong = jangan sentuh
 * @param {string} [o.outBaru]        isian form; kosong = jangan sentuh
 * @param {boolean} [o.hapusClockOut] minta hapus jam pulang dengan sadar
 * @returns {{patch: object, masalah: string[], berubah: string[]}}
 */
export function rencanaKoreksi({ inSekarang, outSekarang, inBaru, outBaru, hapusClockOut = false } = {}) {
  const patch = {};
  const masalah = [];
  const berubah = [];

  const tIn = waktu(inBaru);
  const tOut = waktu(outBaru);
  if (tIn === undefined) masalah.push('Jam masuk tidak terbaca — periksa isiannya.');
  if (tOut === undefined) masalah.push('Jam pulang tidak terbaca — periksa isiannya.');
  if (masalah.length) return { patch: {}, masalah, berubah };

  const lamaIn = waktu(inSekarang) || null;
  const lamaOut = waktu(outSekarang) || null;

  if (tIn && (!lamaIn || tIn.getTime() !== lamaIn.getTime())) {
    patch.clock_in_at = tIn.toISOString();
    berubah.push(`Jam masuk: ${lamaIn ? jam(lamaIn) : '(kosong)'} → ${jam(tIn)}`);
  }

  if (hapusClockOut) {
    // Dipisahkan dari "isian dikosongkan" dengan sengaja — lihat catatan di atas.
    if (lamaOut) {
      patch.clock_out_at = null;
      berubah.push(`Jam pulang DIHAPUS (sebelumnya ${jam(lamaOut)})`);
    }
  } else if (tOut && (!lamaOut || tOut.getTime() !== lamaOut.getTime())) {
    patch.clock_out_at = tOut.toISOString();
    berubah.push(`Jam pulang: ${lamaOut ? jam(lamaOut) : '(kosong)'} → ${jam(tOut)}`);
  }

  // Diperiksa terhadap nilai AKHIR — gabungan yang baru diisi dan yang lama —
  // bukan hanya terhadap yang diketik. Memeriksa yang diketik saja meloloskan
  // jam pulang keliru yang dibandingkan dengan jam masuk yang tidak disentuh,
  // dan itu justru bentuk koreksi yang paling sering dilakukan di sini.
  const akhirIn = patch.clock_in_at ? new Date(patch.clock_in_at) : lamaIn;
  const akhirOut = 'clock_out_at' in patch ? (patch.clock_out_at ? new Date(patch.clock_out_at) : null) : lamaOut;
  if (akhirIn && akhirOut && akhirOut.getTime() <= akhirIn.getTime()) {
    masalah.push(`Jam pulang (${jam(akhirOut)}) tidak boleh sama atau lebih awal dari jam masuk (${jam(akhirIn)}).`);
  }

  return { patch: masalah.length ? {} : patch, masalah, berubah: masalah.length ? [] : berubah };
}

/** Nilai untuk `<input type="datetime-local">` dari ISO — waktu LOKAL, bukan UTC. */
export function keInputLokal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  // Sengaja memakai getFullYear/getMonth (lokal), bukan toISOString() yang UTC:
  // di WIB perbedaannya 7 jam, cukup untuk memindahkan presensi malam ke hari
  // sebelumnya di layar admin.
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
