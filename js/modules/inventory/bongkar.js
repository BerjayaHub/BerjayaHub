/**
 * Aturan membongkar bahan setengah jadi jadi bahan bakunya (0134).
 *
 * ============ SATU ANGKA, SATU SUMBER ============
 *
 * Batas "paling banyak berapa yang bisa kembali" dihitung di sini DAN
 * ditegakkan server (`porsi_bongkar` + `bongkar_bahan`). Keduanya memakai
 * rumus yang sama persis:
 *
 *     porsi = qty_resep × (jumlah_dibongkar / yield_resep)
 *
 * Kalau keduanya menyimpang, yang menyimpang adalah jumlah stok — dan
 * penolakannya baru muncul sesudah orangnya mengisi seluruh baris. Itu
 * sebabnya rumusnya ditulis satu kali di tiap sisi dan diuji dua-duanya,
 * bukan disalin dengan angka yang "kira-kira sama".
 *
 * ============ KENAPA ADA BATAS SAMA SEKALI ============
 *
 * Tanpa batas atas, bongkar adalah alat mencetak stok dari udara: ketik 5 pack
 * keluar, 500 kg udang masuk. Stok yang dicetak begitu terlihat persis seperti
 * stok yang sungguhan — tidak ada laporan yang bisa membedakannya, dan yang
 * menemukannya adalah orang yang menghitung fisik di gudang.
 *
 * Tidak ada impor di berkas ini, supaya aturannya bisa diuji tanpa browser.
 */

const angka = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Toleransi pembulatan. Sama dengan yang dipakai server (1e-9). */
const TOLERANSI = 1e-9;

/**
 * Porsi maksimal tiap bahan untuk sejumlah produk yang dibongkar.
 *
 * @param {{yield_qty?: number, items?: Array<{ingredient_product_id: string, qty: number}>}} resep
 * @param {number} qtyBongkar
 * @returns {Map<string, number>} product_id bahan -> jumlah maksimal
 */
export function porsiBongkar(resep, qtyBongkar) {
  const hasil = new Map();
  const yieldQty = angka(resep?.yield_qty);
  const n = angka(qtyBongkar);
  // Yield nol/negatif akan membagi dengan nol. Bukan kasus pinggiran: produk
  // yang resepnya baru dibuat bisa punya yield 0 sampai seseorang mengisinya.
  if (!yieldQty || yieldQty <= 0 || !n || n <= 0) return hasil;

  const faktor = n / yieldQty;
  for (const it of Array.isArray(resep?.items) ? resep.items : []) {
    const pid = it?.ingredient_product_id;
    const q = angka(it?.qty);
    if (!pid || q === null) continue;
    hasil.set(pid, q * faktor);
  }
  return hasil;
}

/**
 * Periksa pilihan staff terhadap porsinya.
 *
 * @returns {{boleh: Array<{product_id: string, qty: number}>,
 *            masalah: Array<{product_id: string, sebab: 'lebih'|'bukan-bahan', maks?: number}>}}
 */
export function periksaBongkar(resep, qtyBongkar, pilihan) {
  const porsi = porsiBongkar(resep, qtyBongkar);
  const boleh = [];
  const masalah = [];

  for (const p of Array.isArray(pilihan) ? pilihan : []) {
    const pid = p?.product_id;
    const q = angka(p?.qty);
    if (!pid) continue;
    // Nol berarti "bahan ini tidak bisa dipisahkan" — bukan kesalahan, dan
    // bukan baris yang perlu dikirim ke server.
    if (q === null || q <= 0) continue;

    if (!porsi.has(pid)) {
      masalah.push({ product_id: pid, sebab: 'bukan-bahan' });
      continue;
    }
    const maks = porsi.get(pid);
    if (q > maks + TOLERANSI) {
      masalah.push({ product_id: pid, sebab: 'lebih', maks });
      continue;
    }
    boleh.push({ product_id: pid, qty: q });
  }

  return { boleh, masalah };
}

/**
 * Apakah stok produknya cukup?
 *
 * Keputusan pengguna: TIDAK memblokir, hanya memperingatkan — konsisten dengan
 * produksi (0020), kiriman, dan penjualan yang semuanya membolehkan stok
 * menembus nol. Stok tercatat sering tertinggal dari kenyataan di rak, dan
 * menolak pekerjaan yang benar karena angka yang basi lebih merepotkan
 * daripada selisih yang muncul di opname.
 *
 * @returns {{cukup: boolean, stok: number, kurang: number}}
 */
export function periksaStok(stokSekarang, qtyBongkar) {
  const stok = angka(stokSekarang) ?? 0;
  const n = angka(qtyBongkar) ?? 0;
  return { cukup: stok >= n, stok, kurang: Math.max(0, n - stok) };
}

/** Kalimat peringatan stok, atau string kosong kalau memang cukup. */
export function pesanStok(nama, stokSekarang, qtyBongkar, satuan = '') {
  const r = periksaStok(stokSekarang, qtyBongkar);
  if (r.cukup) return '';
  const s = satuan ? ` ${satuan}` : '';
  return (
    `Stok ${nama || 'produk ini'} sekarang ${r.stok}${s}, sedangkan kamu membongkar ${angka(qtyBongkar) ?? 0}${s}. ` +
    'Boleh dilanjutkan — selisihnya akan muncul di opname.'
  );
}
