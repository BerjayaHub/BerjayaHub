/**
 * DAFTAR PILIHAN **Purpose** untuk form Waste / Spoil.
 *
 * ============ KENAPA INI DIPILIH ORANG, BUKAN DITURUNKAN ============
 *
 * Berkas Master Purpose dari ESB berisi tiga baris:
 *
 *     Waste Kitchen    -> COGS - Food
 *     Waste Bar        -> COGS - Beverage
 *     Packaging Spoil  -> COGS - Other
 *
 * Sumbunya "dapur, bar, atau kemasan" — bukan "rusak atau terbuang". Jadi ia
 * TIDAK bisa diturunkan dari `waste_runs.jenis`, dan tidak bisa diturunkan dari
 * kategori produk: kategori di Berjaya Hub diketik sendiri dan tidak pernah
 * dibuat untuk menjawab pertanyaan ini. Gula yang sama bisa terbuang di dapur
 * hari ini dan di bar besok.
 *
 * Yang tahu jawabannya orang yang berdiri di depan barangnya. Jadi ia yang
 * memilih, dan pilihannya disimpan apa adanya.
 *
 * ============ DAFTAR KOSONG BUKAN BERARTI WAJIB DIISI ============
 *
 * Sebelum admin mengimpor Master Purpose, daftarnya kosong — dan waste tetap
 * harus bisa dicatat. Barang yang sudah rusak tidak menunggu daftar induk.
 *
 * Maka: WAJIB hanya kalau daftarnya ada. Kalau tidak ada, kolomnya disembunyikan
 * dan kejadiannya tersimpan tanpa Purpose; ekspor ESB yang menahannya nanti,
 * dan admin mengisinya lewat Rekap Waste / Spoil. Aturan baru tidak boleh
 * mematikan pekerjaan yang selama ini jalan.
 *
 * Tidak ada impor di berkas ini, supaya bisa diuji tanpa browser.
 */

const teks = (v) => (v === null || v === undefined ? '' : String(v).trim());

/** Disamakan sebelum dibandingkan: beda huruf besar-kecil & spasi rangkap bukan beda pilihan. */
export function normalPurpose(v) {
  return teks(v).replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Opsi dropdown dari daftar induk ESB.
 *
 * @param {Array<{jenis?: string, nama?: string, kode?: string, keterangan?: string}>} master
 * @returns {Array<{value: string, label: string, hint: string}>}
 */
export function opsiPurpose(master) {
  const keluar = [];
  const sudah = new Set();
  for (const m of Array.isArray(master) ? master : []) {
    if (teks(m?.jenis) !== 'purpose') continue;
    const nama = teks(m?.nama);
    if (!nama) continue;
    const k = normalPurpose(nama);
    // Nama kembar beda huruf besar-kecil: yang PERTAMA menang, bukan yang
    // terakhir. Kalau yang terakhir menang, ejaan yang dipakai jadi tergantung
    // urutan datangnya baris dari database — dan urutan itu tidak dijanjikan
    // siapa pun.
    if (sudah.has(k)) continue;
    sudah.add(k);
    keluar.push({
      value: nama,
      label: nama,
      // Purpose Account ("COGS - Food"). Ia tidak dikirim ke mana pun — ia yang
      // membuat tiga nama yang mirip bisa dibedakan oleh orang yang harus
      // memilih salah satunya, sambil berdiri di dapur.
      hint: teks(m?.keterangan)
    });
  }
  keluar.sort((a, b) => a.label.localeCompare(b.label, 'id'));
  return keluar;
}

/** Ada daftarnya berarti wajib dipilih. Tidak ada daftarnya berarti tidak bisa dipilih. */
export function purposeWajib(opsi) {
  return Array.isArray(opsi) && opsi.length > 0;
}

export const PESAN_BELUM_ADA_DAFTAR =
  'Daftar Purpose ESB belum diimpor, jadi kolomnya belum bisa diisi. Kejadian ini tetap tersimpan, ' +
  'tapi akan tertahan saat diekspor sampai admin mengisinya lewat Rekap Waste / Spoil.';

export const PESAN_WAJIB = 'Pilih Purpose-nya — itu yang menentukan biaya waste ini masuk ke akun COGS yang mana di ESB.';

/**
 * Periksa satu nilai sebelum dikirim.
 *
 * @returns {{boleh: boolean, nilai: string|null, sebab: string}}
 */
export function periksaPurpose(nilai, opsi) {
  const v = teks(nilai);
  const daftar = Array.isArray(opsi) ? opsi : [];

  if (!daftar.length) {
    // Tidak ada daftar: apa pun yang tersisa di kotaknya diabaikan. Mengirim
    // nilai yang tidak berasal dari daftar mana pun cuma menumbuhkan ejaan
    // liar yang harus dibereskan seseorang nanti.
    return { boleh: true, nilai: null, sebab: '' };
  }
  if (!v) return { boleh: false, nilai: null, sebab: PESAN_WAJIB };

  const cocok = daftar.find((o) => normalPurpose(o.value) === normalPurpose(v));
  if (!cocok) {
    return {
      boleh: false,
      nilai: null,
      sebab: `Purpose "${v}" tidak ada di daftar ESB. Pilih dari daftar — nama yang diketik sendiri ditolak saat berkasnya diunggah.`
    };
  }
  // Yang dikembalikan ejaan DARI DAFTARNYA, bukan yang ada di kotak.
  return { boleh: true, nilai: cocok.value, sebab: '' };
}
