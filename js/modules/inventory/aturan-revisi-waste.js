/**
 * ATURAN REVISI & PEMBATALAN WASTE/SPOIL (0181).
 *
 * Murni: tidak menyentuh DOM, tidak menyentuh Supabase.
 *
 *   "saya ingin ada edit dan hapus di bagian waste/spoil, tapi hanya disisi
 *    admin portal saja... bila staff salah input jumlah atau item nya"
 *
 * ============ KENAPA ATURANNYA DIPISAH DARI LAYARNYA ============
 *
 * Rekap waste adalah tabel SATU BARIS PER BAHAN, sementara yang direvisi adalah
 * KEJADIAN. Satu waste menu "Latte x2" menghasilkan dua baris — susu dan gula —
 * dan keduanya menunjuk kejadian yang sama.
 *
 * Tombol yang digambar di setiap baris karena itu akan muncul dua kali untuk
 * satu kejadian, dan admin yang menekan yang kedua mengira sedang merevisi
 * "baris gula". Ia tidak; ia merevisi seluruh kejadiannya. Memutuskan baris
 * mana yang memegang tombolnya adalah aturan, bukan gaya — dan aturan diuji
 * tanpa browser.
 */

const teks = (v) => (v === null || v === undefined ? '' : String(v));

/** Sebab sebuah kejadian tidak bisa direvisi. Dipakai layar untuk menjelaskan. */
export const SEBAB = {
  OK: 'ok',
  LAMA: 'lama',
  TAK_BERWENANG: 'tak-berwenang',
  DIBATALKAN: 'dibatalkan'
};

export const PESAN_SEBAB = {
  [SEBAB.LAMA]: 'Dicatat sebelum dokumen waste ada (sebelum 0135) — tidak punya kejadian yang bisa direvisi.',
  [SEBAB.TAK_BERWENANG]: 'Hanya admin BU atau admin outlet ini yang bisa merevisi.',
  [SEBAB.DIBATALKAN]: 'Kejadian ini sudah dibatalkan.'
};

/**
 * Boleh direvisi / dibatalkan?
 *
 * ============ "SUDAH DIEKSPOR" BUKAN PENOLAKAN ============
 *
 * Berbeda dari Purpose (0147) yang MENOLAK kejadian yang sudah diekspor:
 * yang ini membetulkan ANGKA. Angka yang salah dibiarkan hanya karena sudah
 * terlanjur dikirim akan salah di dua tempat selamanya.
 *
 * Jadi ia tetap boleh, tapi harus DIKATAKAN lebih dulu — kalau tidak, admin
 * membetulkan angkanya dan mengira ESB ikut terbetulkan.
 */
export function keadaanRevisiWaste(meta, { bolehKelola = false } = {}) {
  if (!bolehKelola) return { boleh: false, sebab: SEBAB.TAK_BERWENANG, peringatan: '' };
  if (!meta?.wasteId || meta?.lama) return { boleh: false, sebab: SEBAB.LAMA, peringatan: '' };
  if (meta?.dibatalkan) return { boleh: false, sebab: SEBAB.DIBATALKAN, peringatan: '' };
  return {
    boleh: true,
    sebab: SEBAB.OK,
    peringatan: meta?.terkunci
      ? 'Kejadian ini SUDAH diekspor ke ESB. Angka di berkas yang sudah berangkat tidak ikut berubah — perbaiki juga di ESB, atau batalkan tanda ekspornya lalu ekspor ulang.'
      : ''
  };
}

/**
 * Indeks baris yang memegang tombol aksi: yang PERTAMA untuk tiap kejadian.
 *
 * Bukan yang terakhir, dan bukan semuanya. Yang pertama adalah yang terbaca
 * lebih dulu saat mata menyusuri tabel, jadi tombolnya ada di tempat orang
 * berhenti — dan baris sisanya menyebut dirinya "bagian dari kejadian di atas"
 * alih-alih menawarkan tombol kedua yang mengerjakan hal yang sama.
 */
export function barisPemegangAksi(metaList) {
  const sudah = new Set();
  const hasil = new Set();
  (Array.isArray(metaList) ? metaList : []).forEach((m, i) => {
    const id = teks(m?.wasteId);
    if (!id || m?.lama) return;
    if (sudah.has(id)) return;
    sudah.add(id);
    hasil.add(i);
  });
  return hasil;
}

/**
 * Periksa isian revisi SEBELUM dikirim.
 *
 * Penjaga sebenarnya ada di `revisi_waste` — layar bisa dilewati, fungsi
 * database tidak. Yang di sini cuma supaya penolakannya datang tanpa menunggu
 * jaringan, dan berbunyi dalam kalimat yang sama.
 */
export function sahkanRevisiWaste({ productId, qty, alasan } = {}) {
  if (!teks(productId).trim()) return { ok: false, pesan: 'Pilih itemnya dulu.' };
  const n = Number(qty);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, pesan: 'Jumlah harus lebih dari 0.' };
  // Alasan wajib, dan bukan karena formalitas: yang membaca angka ini
  // belakangan bukan yang mengubahnya, dan "kenapa 20 kg jadi 2 kg" tidak
  // terjawab oleh tanggal revisi.
  if (!teks(alasan).trim()) return { ok: false, pesan: 'Alasan revisi wajib diisi.' };
  return { ok: true, pesan: '' };
}

/**
 * Apa yang berubah, dalam kalimat — untuk dialog konfirmasi.
 *
 * Yang TIDAK berubah tidak disebut. Daftar yang memuat "Jumlah: 2 → 2" membuat
 * orang membaca tiga baris untuk menemukan satu perubahan, dan yang terburu-
 * buru akan berhenti membaca sama sekali.
 */
export function ringkasPerubahanWaste(lama = {}, baru = {}) {
  const hasil = [];
  const namaLama = teks(lama.namaItem).trim();
  const namaBaru = teks(baru.namaItem).trim();
  if (namaLama !== namaBaru) hasil.push(`Item: ${namaLama || '-'} → ${namaBaru || '-'}`);

  const qLama = Number(lama.qty);
  const qBaru = Number(baru.qty);
  if (!Object.is(qLama, qBaru)) hasil.push(`Jumlah: ${angka(qLama)} → ${angka(qBaru)}`);

  const cLama = teks(lama.notes).trim();
  const cBaru = teks(baru.notes).trim();
  if (cLama !== cBaru) hasil.push(`Catatan: ${cLama || '(kosong)'} → ${cBaru || '(kosong)'}`);

  return hasil;
}

/** Pesan sesudah revisi tersimpan — menyebut akibatnya pada stok. */
export function pesanSesudahRevisi(hasil = {}) {
  const kode = teks(hasil.kode).trim();
  const n = Number(hasil.baris_stok);
  const bagian = [
    kode ? `${kode} direvisi.` : 'Waste direvisi.',
    Number.isFinite(n) && n > 0
      ? `Stok dihitung ulang (${n} ${n === 1 ? 'bahan' : 'bahan'}).`
      : 'Stok dihitung ulang.'
  ];
  if (hasil.esb_terkunci) bagian.push('Catatan: kejadian ini sudah diekspor ke ESB — berkas yang sudah berangkat tidak ikut berubah.');
  return bagian.join(' ');
}

function angka(n) {
  if (!Number.isFinite(n)) return '-';
  // Dibulatkan 4 desimal: bahan resep menghasilkan pecahan panjang
  // (150/3 × 2), dan ekor desimal di dialog konfirmasi membuat orang ragu pada
  // angka yang benar.
  return String(Math.round(n * 10000) / 10000);
}
