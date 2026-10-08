/**
 * PENGECEKAN KIRIMAN DI SISI OUTLET — aturannya.
 *
 * ============ TIGA KEADAAN, BUKAN DUA ============
 *
 *   belum dicek  -> kotaknya KOSONG. Bukan nol, bukan "sesuai kiriman".
 *   dicek = 0    -> sudah dihitung, dan barangnya memang tidak ada.
 *   dicek > 0    -> sudah dihitung sebanyak itu.
 *
 * Sebelum `0142`, kotak "Diterima" sudah terisi angka kiriman sejak layarnya
 * dibuka. Artinya staff yang menekan Simpan tanpa menghitung apa pun
 * menghasilkan catatan yang IDENTIK dengan staff yang menghitung seluruhnya.
 * Susutnya nol, laporannya rapi, dan selisihnya baru muncul berminggu-minggu
 * kemudian sebagai angka opname yang tidak bisa dijelaskan siapa pun.
 *
 * ============ KENAPA INI PERLU BERDIRI SENDIRI ============
 *
 * Aturan "sudah dicek atau belum" dipakai di empat tempat pada layar yang sama:
 * menggambar kotaknya, menghitung kemajuan, memutuskan tombol Terima boleh
 * ditekan, dan menyusun pertanyaan saat masih ada yang kosong. Empat salinan
 * dari satu aturan pasti menyimpang, dan yang menyimpang di sini berarti tombol
 * Terima yang menerima baris yang belum dihitung siapa pun.
 *
 * Tidak ada impor di berkas ini, supaya bisa diuji tanpa browser.
 */

/**
 * Angka hasil cek, atau `null` kalau BELUM DICEK.
 *
 * `Number('')` dan `Number(null)` adalah **0**, bukan NaN. Tanpa penyaringan
 * di baris pertama, kotak yang dibiarkan kosong terbaca sebagai "dihitung, dan
 * hasilnya nol" — yang artinya barangnya dinyatakan tidak datang sama sekali.
 * Dua kesalahan yang berlawanan arah, dan tidak satu pun melempar error.
 */
export function bacaCek(v) {
  if (v === null || v === undefined) return null;
  const t = typeof v === 'string' ? v.trim() : v;
  if (t === '') return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/** Sudah dicek? `0` dihitung SUDAH — itu jawaban, bukan ketiadaan jawaban. */
export function sudahDicek(nilai) {
  return bacaCek(nilai) !== null;
}

/**
 * Ringkasan kemajuan satu SJ.
 *
 * @param {{id: string, sent_qty: number, dicek_qty: number|null, products?: {name?: string}}[]} items
 * @param {Map<string, number|null>} [isian] nilai yang sedang DIKETIK di layar,
 *   per item id. Yang sedang diketik menang atas yang tersimpan — layarnya
 *   harus menghitung apa yang dilihat orangnya, bukan apa yang ada di server
 *   beberapa detik lalu.
 */
export function ringkasCek(items, isian = new Map()) {
  const daftar = Array.isArray(items) ? items : [];
  const belum = [];
  let dicek = 0;
  let susut = 0;
  let lebih = 0;

  for (const it of daftar) {
    const dari = isian instanceof Map && isian.has(it?.id) ? isian.get(it.id) : it?.dicek_qty;
    const n = bacaCek(dari);
    if (n === null) {
      belum.push(it?.products?.name || '(tanpa nama)');
      continue;
    }
    dicek++;
    const kirim = Number(it?.sent_qty);
    if (Number.isFinite(kirim)) {
      if (kirim > n) susut += kirim - n;
      else if (n > kirim) lebih += n - kirim;
    }
  }

  return {
    total: daftar.length,
    dicek,
    belum: belum.length,
    // Nama-namanya dibawa, bukan cuma jumlahnya: "3 bahan belum dicek" membuat
    // orangnya menyisir ulang seluruh tabel, sementara menyebut namanya
    // langsung menunjuk barisnya.
    namaBelum: belum,
    selesai: daftar.length > 0 && belum.length === 0,
    susut,
    lebih
  };
}

/** Kalimat kemajuan untuk kepala kartu SJ. */
export function teksKemajuan(ringkas, pengecekTerakhir = null) {
  if (!ringkas?.total) return '';
  const inti = ringkas.selesai
    ? `${ringkas.total} bahan sudah dicek — siap diterima`
    : `${ringkas.dicek} dari ${ringkas.total} bahan sudah dicek`;
  if (!pengecekTerakhir?.nama) return inti;
  const waktu = pengecekTerakhir.waktu ? ` ${pengecekTerakhir.waktu}` : '';
  return `${inti} · terakhir oleh ${pengecekTerakhir.nama}${waktu}`;
}

/**
 * Siapa yang paling terakhir mengubah hitungan, untuk ditulis di kepala kartu.
 *
 * Dipisah supaya bisa diuji: jam yang dibaca dari `dicek_at` gampang tertukar
 * urutannya, dan nama yang salah di layar serah-terima adalah nama yang akan
 * ditanyai saat ada selisih.
 */
export function pengecekTerakhir(items, fmtJam = (t) => String(t ?? '')) {
  let terbaru = null;
  for (const it of Array.isArray(items) ? items : []) {
    if (!it?.dicek_at || !it?.pengecek?.full_name) continue;
    const t = new Date(it.dicek_at).getTime();
    if (!Number.isFinite(t)) continue;
    if (!terbaru || t > terbaru.t) terbaru = { t, nama: it.pengecek.full_name, at: it.dicek_at };
  }
  return terbaru ? { nama: terbaru.nama, waktu: fmtJam(terbaru.at) } : null;
}

/**
 * Isi yang dikirim ke `simpan_cek_kiriman` — HANYA baris yang DISENTUH.
 *
 * ============ DUA DEVICE, SATU SURAT JALAN ============
 *
 *   "staff bar pakai device a, dia cek hitung dan input bahan bar yang datang,
 *    begitu pula dengan staff kitchen dia memakai device b, lalu tap simpan
 *    sementara keduanya … masih ada isu salah satu dari mereka input nya tidak
 *    masuk"
 *
 * Versi sebelumnya menyertakan kunci `dicek_qty` untuk SETIAP kotak di layar,
 * dan berkomentar bahwa itu benar karena "layar ini memang sedang menyentuh
 * semua baris yang ditampilkannya". Anggapan itu runtuh begitu ada device
 * kedua.
 *
 * Di sisi server (`simpan_cek_kiriman`, 0142) dua keadaan itu SENGAJA
 * dibedakan:
 *
 *     kunci TIDAK ADA          -> "baris ini tidak sedang saya sentuh"
 *     kunci ADA, nilainya null -> "batalkan ceknya"
 *
 * Penjaga itu ditulis persis untuk kasus ini — komentarnya di `0142` bahkan
 * menyebutnya: *"layar yang mengirim sebagian baris akan MENGHAPUS hasil cek
 * orang lain"*. Tapi layarnya tidak pernah mengirim sebagian: ia mengirim
 * SEMUA baris, dan yang kosong dikirim sebagai null.
 *
 * Jadi staff bar yang menekan Simpan Sementara mengirim `null` untuk seluruh
 * baris kitchen — dan menghapus hitungan yang baru saja disimpan staff
 * kitchen. Tidak ada galat. Keduanya melihat "Tersimpan sementara", dan yang
 * satu baru tahu hitungannya hilang saat menekan Terima.
 *
 * Yang membuatnya sulit ditemukan: urutannya menentukan siapa yang kalah, dan
 * kalau keduanya kebetulan menyimpan sebelum yang lain mulai mengisi, tidak
 * ada yang hilang sama sekali.
 *
 * @param {Map<string, any>} isian  nilai kotak SEKARANG, per item_id
 * @param {Map<string, any>} [awal] nilai saat barisnya DIGAMBAR (dari server)
 * @returns {Array<{item_id: string, dicek_qty?: number|null}>}
 */
export function muatanCek(isian, awal = new Map()) {
  const peta = isian instanceof Map ? isian : new Map();
  const semula = awal instanceof Map ? awal : new Map();

  const hasil = [];
  for (const [item_id, v] of peta.entries()) {
    if (!item_id) continue;
    const sekarang = bacaCek(v);
    const sebelum = bacaCek(semula.get(item_id));
    // TIDAK BERUBAH = TIDAK DISENTUH, dan barisnya tidak ikut dikirim sama
    // sekali. Termasuk kotak kosong yang memang kosong sejak digambar — itu
    // bukan pernyataan "batalkan", itu ketiadaan pernyataan.
    //
    // Baris yang DIKOSONGKAN dengan sengaja (tadinya berisi, sekarang kosong)
    // tetap ikut, dengan `dicek_qty: null` — dan di server itulah yang berarti
    // "batalkan ceknya".
    if (sekarang === sebelum) continue;
    hasil.push({ item_id, dicek_qty: sekarang });
  }
  return hasil;
}
