/**
 * URUTAN BARIS PEMETAAN ESB — yang belum dipetakan naik ke atas.
 *
 * ============ KENAPA INI PERLU ============
 *
 * Kelompok Item berisi 647 baris, dan yang belum dipetakan **delapan**. Delapan
 * baris yang tersebar di antara 639 baris lain praktis mustahil ditemukan
 * dengan menggulir — dan justru delapan itu yang membuat dokumennya tidak ikut
 * terunduh.
 *
 * Lencana "8 belum dipetakan" sudah memberi tahu JUMLAHNYA sejak dulu. Yang
 * belum ada adalah cara sampai ke barisnya.
 *
 * ============ DIURUT SAAT DIGAMBAR, BUKAN SAAT DIPETAKAN ============
 *
 * Urutannya dihitung sekali, waktu tabelnya dibuat. Baris yang baru saja
 * dipetakan TIDAK melompat turun.
 *
 * Itu keputusan sadar: baris yang berpindah tempat tepat setelah disentuh
 * membuat orangnya kehilangan tempatnya sendiri — ia baru saja memilih dari
 * dropdown, dan barisnya lenyap dari bawah jarinya. Untuk 647 baris, itu bukan
 * gangguan kecil. Urutannya menyesuaikan diri saat halaman digambar ulang.
 *
 * Tidak ada impor di berkas ini, supaya bisa diuji tanpa browser.
 */

const teks = (v) => (v === null || v === undefined ? '' : String(v));

/**
 * Susun baris pemetaan satu kelompok.
 *
 * @param {string[]} kunci nilai-nilai Berjaya Hub yang perlu padanan
 * @param {(k: string) => string} nilai padanan ESB-nya; '' = belum dipetakan
 * @returns {{baris: {kunci: string, nilai: string, dipetakan: boolean}[], belum: number, total: number}}
 */
export function susunBarisPemetaan(kunci, nilai = () => '') {
  const daftar = (Array.isArray(kunci) ? kunci : []).map((k) => {
    const v = typeof nilai === 'function' ? teks(nilai(k)).trim() : '';
    return { kunci: teks(k), nilai: v, dipetakan: v !== '' };
  });

  // Yang BELUM dipetakan dulu, lalu alfabetis di dalam tiap kelompok.
  //
  // Alfabetis di dalamnya penting: tanpa itu, urutan 639 baris yang sudah
  // dipetakan mengikuti urutan datangnya dari database — yang tidak dijamin
  // sama antar pemuatan, sehingga mencari satu nama berarti menyisir ulang
  // seluruh daftar tiap kali.
  const baris = [...daftar].sort(
    (a, b) => Number(a.dipetakan) - Number(b.dipetakan) || a.kunci.localeCompare(b.kunci, 'id')
  );

  return { baris, belum: baris.filter((b) => !b.dipetakan).length, total: baris.length };
}

/**
 * Batas jumlah baris yang membuat kotak pencarian layak ditampilkan.
 *
 * Di bawah ini, kotak carinya lebih banyak memakan tempat daripada menolong —
 * enam baris muat sekaligus di layar HP.
 */
export const AMBANG_CARI = 8;

/** Perlu kotak cari? */
export function perluCari(total) {
  return Number(total) > AMBANG_CARI;
}
