/**
 * NOMOR NOTA DI DALAM KETERANGAN KAS — dipecah jadi potongan yang bisa diketuk.
 *
 * ============ YANG DIMINTA ============
 *
 *   "nomor nota di kolom keterangan saya ingin bisa di klik atau tap dan saat
 *    di klik muncul pop up rincian nota nya dan foto nota"
 *
 * Keterangannya teks bebas yang ditulis server: "Pembayaran nota TRM-260912-56F0",
 * "Pembayaran nota TRM-1, TRM-2", "Penyesuaian nota TRM-3 — koreksi isi nota",
 * atau kalimat yang diketik orangnya sendiri. Yang dicari bukan polanya,
 * melainkan KODE NOTA YANG MEMANG TERKAIT dengan entri itu — jadi tidak ada
 * tebakan regex yang bisa salah mengenali.
 *
 * ============ KODE TERPANJANG MENANG ============
 *
 * Satu kode bisa jadi awalan kode lain (`TRM-1` dan `TRM-12`). Kalau yang
 * pendek dicocokkan lebih dulu, ia memotong yang panjang di tengah dan sisanya
 * (`2`) jadi teks biasa — tautannya menunjuk nota yang SALAH, dan yang terlihat
 * di layar cuma nomor yang sedikit terpotong.
 *
 * ============ NOTA YANG KODENYA TIDAK TERTULIS ============
 *
 * Keterangan bisa diganti orangnya saat membayar ("Belanja mingguan"), atau
 * satu entri melunasi lima nota sementara keterangannya hanya menyebut dua.
 * Nota yang kodenya tidak ketemu di teks TETAP dikembalikan, sebagai potongan
 * `tambahan` — supaya notanya tidak jadi tidak bisa dibuka hanya karena
 * kalimatnya tidak menyebutnya.
 *
 * Tidak ada impor di berkas ini, supaya bisa diuji tanpa browser.
 */

/** Penjaga putaran: keterangan sepanjang apa pun tidak boleh menggantung layar. */
export const BATAS_POTONGAN = 200;

/**
 * @param {string} keterangan teks apa adanya dari `cash_entries.notes`
 * @param {{id: string, code: string}[]} notas nota yang terkait entri itu
 * @returns {{bagian: {teks: string, notaId?: string}[], tambahan: {teks: string, notaId: string}[]}}
 */
export function pecahKeterangan(keterangan, notas = []) {
  const teks = keterangan === null || keterangan === undefined ? '' : String(keterangan);
  // Kode kosong disaring lebih dulu: `''.indexOf` selalu 0, dan putarannya
  // tidak akan pernah maju.
  const daftar = (Array.isArray(notas) ? notas : []).filter((n) => n?.id && n?.code);

  const bagian = [];
  const ketemu = new Set();
  let sisa = teks;

  for (let putaran = 0; putaran < BATAS_POTONGAN && sisa; putaran++) {
    let posisi = -1;
    let pilih = null;
    for (const n of daftar) {
      const kode = String(n.code);
      const i = sisa.indexOf(kode);
      if (i < 0) continue;
      // Yang paling KIRI dulu; kalau seri, yang paling PANJANG.
      if (posisi < 0 || i < posisi || (i === posisi && kode.length > String(pilih.code).length)) {
        posisi = i;
        pilih = n;
      }
    }
    if (!pilih) break;
    if (posisi > 0) bagian.push({ teks: sisa.slice(0, posisi) });
    bagian.push({ teks: String(pilih.code), notaId: pilih.id });
    ketemu.add(pilih.id);
    sisa = sisa.slice(posisi + String(pilih.code).length);
  }

  if (sisa) bagian.push({ teks: sisa });

  return {
    bagian,
    tambahan: daftar.filter((n) => !ketemu.has(n.id)).map((n) => ({ teks: String(n.code), notaId: n.id }))
  };
}

/**
 * Pasangkan nota ke entri kasnya.
 *
 * DUA jalur, dan keduanya perlu (lihat `notaTerkaitEntriKas`): entri yang
 * MELUNASI nota ditunjuk lewat `payment_entry_id`, sementara entri KOREKSI
 * (0131) menyebut notanya sendiri lewat `penyesuaian_nota` dan tidak ditunjuk
 * siapa pun.
 *
 * @param {{id: string, penyesuaian_nota?: string}[]} entries
 * @param {{id: string, code: string, payment_entry_id?: string}[]} notas
 * @returns {Map<string, object[]>} entryId -> nota[]
 */
export function petaNotaPerEntri(entries = [], notas = []) {
  const perId = new Map();
  for (const n of Array.isArray(notas) ? notas : []) if (n?.id) perId.set(n.id, n);

  const peta = new Map();
  const tambah = (entryId, nota) => {
    if (!entryId || !nota) return;
    if (!peta.has(entryId)) peta.set(entryId, []);
    const daftar = peta.get(entryId);
    // Satu nota tidak boleh masuk dua kali ke entri yang sama: entri koreksi
    // yang kebetulan juga melunasi notanya akan menampilkan nomor kembar.
    if (!daftar.some((x) => x.id === nota.id)) daftar.push(nota);
  };

  for (const n of perId.values()) if (n.payment_entry_id) tambah(n.payment_entry_id, n);
  for (const e of Array.isArray(entries) ? entries : []) {
    if (e?.penyesuaian_nota) tambah(e.id, perId.get(e.penyesuaian_nota));
  }
  return peta;
}
