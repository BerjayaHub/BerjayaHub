/**
 * Pemotong rantai `supabase.from('tabel')…` yang bisa dipercaya.
 *
 * KENAPA TIDAK CUKUP REGEX:
 * Versi pertama audit-audit ini memotong rantai memakai lookahead "baris
 * berikutnya diawali const/let/return/}". Terdengar masuk akal — sampai
 * rantainya memuat objek literal:
 *
 *     .update({
 *       status,
 *       reviewed_at: ...
 *     })              <-- baris ini diawali '}', jadi dianggap AKHIR rantai
 *     .select('id')   <-- tidak pernah ikut terbaca
 *
 * Akibatnya audit menuduh kode yang sudah benar, dan — lebih buruk — memberi
 * rasa aman palsu di tempat lain karena rantainya terpotong sebelum bagian
 * yang seharusnya diperiksa.
 *
 * Yang benar: telusuri karakter demi karakter, hitung kedalaman kurung, dan
 * berhenti di `;` pertama pada kedalaman 0. Itu definisi akhir pernyataan yang
 * sesungguhnya, bukan tebakan berdasarkan bentuk indentasi.
 */

/**
 * @param {string} isi seluruh isi file
 * @returns {{tabel: string, badan: string, index: number}[]}
 */
function rantaiFrom(isi) {
  const hasil = [];
  const pola = /\.from\('([a-z_]+)'\)/g;
  let m;
  while ((m = pola.exec(isi))) {
    const mulai = m.index + m[0].length;
    let dalam = 0;
    let i = mulai;
    for (; i < isi.length; i++) {
      const c = isi[i];
      if (c === '(' || c === '[' || c === '{') dalam++;
      else if (c === ')' || c === ']' || c === '}') {
        dalam--;
        // Kedalaman negatif = kita sudah keluar dari blok yang memuat rantai
        // ini (mis. rantai berada di dalam sebuah if tanpa titik koma sesudahnya).
        if (dalam < 0) break;
      } else if (c === ';' && dalam === 0) break;
    }
    hasil.push({ tabel: m[1], badan: isi.slice(mulai, i), index: m.index });
  }
  return hasil;
}

module.exports = { rantaiFrom };
