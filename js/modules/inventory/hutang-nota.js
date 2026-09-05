/**
 * Aturan hutang supplier — MURNI, tanpa DOM dan tanpa jaringan (0122).
 *
 * Dipisah supaya bisa diuji langsung. Tiga pertanyaan yang jawabannya harus
 * sama di setiap layar yang menanyakannya:
 *
 *   1. Nota mana yang BOLEH dibayar sekarang?
 *   2. Mana yang sudah lewat jatuh tempo?
 *   3. Berapa hutang ke tiap supplier?
 *
 * Aturan yang dihitung ulang di tiap layar cepat atau lambat menyimpang, dan
 * penyimpangannya muncul sebagai tombol yang ada tapi ditolak server — bentuk
 * kegagalan yang tidak bisa ditindaklanjuti siapa pun.
 */

/** Nama yang dipakai kalau notanya tidak menyebut supplier. */
export const TANPA_SUPPLIER = '(tanpa nama supplier)';

const angka = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v) || 0);

/**
 * Status jatuh tempo satu nota.
 *
 * `hariIni` WAJIB dikirim, tidak diambil dari `new Date()` di dalam sini.
 * Fungsi yang membaca jam sistem sendiri tidak bisa diuji untuk "besok", dan
 * seluruh gunanya justru terletak pada perbandingan tanggal.
 *
 * @returns {'lunas'|'terlambat'|'hari-ini'|'akan-datang'|'tanpa-tempo'}
 */
export function statusTempo(nota, hariIni) {
  if (nota?.payment_status === 'lunas') return 'lunas';
  const due = nota?.due_date ?? null;
  if (!due) return 'tanpa-tempo';
  if (due < hariIni) return 'terlambat';
  if (due === hariIni) return 'hari-ini';
  return 'akan-datang';
}

/**
 * Boleh tidaknya sekumpulan nota dibayar bersama.
 *
 * Menirukan aturan server (`bayar_nota`) supaya tombolnya bisa dimatikan
 * SEBELUM ditekan, dengan alasan yang sama persis. Server tetap memeriksanya
 * lagi — ini bukan penjagaan, ini penjelasan.
 *
 * @returns {{boleh: boolean, alasan: string|null, total: number}}
 */
export function bolehDibayar(notas, { lintasOutlet = false } = {}) {
  const daftar = Array.isArray(notas) ? notas : [];
  if (!daftar.length) return { boleh: false, alasan: 'Belum ada nota yang dicentang.', total: 0 };

  const lunas = daftar.filter((n) => n.payment_status === 'lunas');
  if (lunas.length) {
    return { boleh: false, alasan: `${lunas.length} nota yang dicentang sudah lunas. Muat ulang daftarnya.`, total: 0 };
  }

  const kurang = daftar.filter((n) => angka(n.baris_tanpa_harga) > 0);
  if (kurang.length) {
    return {
      boleh: false,
      alasan:
        `${kurang.length} nota masih punya barang tanpa harga (${kurang.map((n) => n.code).join(', ')}). ` +
        'Lengkapi harganya lewat Edit dulu — kalau tidak, kas berkurang sebesar sebagian isinya saja.',
      total: 0
    };
  }

  // Satu outlet saja: `cash_entries.outlet_id` cuma punya satu nilai, jadi
  // membayar dua outlet sekaligus akan mencatat separuh biayanya atas nama
  // outlet yang tidak pernah menerima barangnya.
  //
  // `lintasOutlet` dipakai untuk pembayaran PUSAT (0125). Batas ini memang
  // hanya punya SATU sebab — kolom outlet di entri kas — dan pembayaran pusat
  // tidak membuat entri kas sama sekali. Menahannya di situ berarti melarang
  // sesuatu tanpa alasan, dan pusat justru biasanya melunasi satu supplier
  // untuk beberapa outlet sekaligus.
  const outlet = new Set(daftar.map((n) => n.outlet_id));
  if (!lintasOutlet && outlet.size > 1) {
    return { boleh: false, alasan: `Nota yang dicentang berasal dari ${outlet.size} outlet berbeda. Bayar per outlet.`, total: 0 };
  }

  return { boleh: true, alasan: null, total: daftar.reduce((s, n) => s + angka(n.total), 0) };
}

/**
 * Kelompokkan nota BELUM LUNAS per supplier.
 *
 * Yang lunas disaring di sini, bukan diserahkan ke pemanggil: "hutang supplier"
 * yang diam-diam memuat nota lunas adalah angka yang salah dan terlihat wajar.
 *
 * Urutannya: yang punya tunggakan terlambat dulu, lalu jatuh tempo terdekat,
 * lalu abjad. Supplier yang menagih hari ini harus berada di atas layar tanpa
 * seorang pun perlu mengurutkannya.
 *
 * @returns {Array<{supplier: string, notas: object[], total: number,
 *                  terlambat: number, tempoTerdekat: string|null}>}
 */
export function kelompokPerSupplier(notas, hariIni) {
  const peta = new Map();
  for (const n of Array.isArray(notas) ? notas : []) {
    if (n?.payment_status === 'lunas') continue;
    const nama = String(n?.supplier ?? '').trim() || TANPA_SUPPLIER;
    // DIKELOMPOKKAN TANPA MEMBEDAKAN HURUF BESAR-KECIL.
    //
    // "Mitra Plastik" dan "Mitra plastik" tampil sebagai DUA supplier dengan
    // dua total terpisah — dan orang yang menagih ke supplier itu membawa
    // angka yang kurang, tanpa satu pun tanda bahwa ada sisanya di kartu lain
    // beberapa baris di bawah.
    //
    // Ejaan yang DITAMPILKAN adalah yang pertama ditemui; yang dipakai
    // menggabungkan cuma kuncinya.
    const kunci = nama.toLowerCase();
    if (!peta.has(kunci)) peta.set(kunci, { supplier: nama, notas: [], total: 0, terlambat: 0, tempoTerdekat: null });
    const g = peta.get(kunci);
    g.notas.push(n);
    g.total += angka(n.total);
    if (statusTempo(n, hariIni) === 'terlambat') g.terlambat++;
    if (n.due_date && (g.tempoTerdekat === null || n.due_date < g.tempoTerdekat)) g.tempoTerdekat = n.due_date;
  }

  return [...peta.values()].sort(
    (a, b) =>
      (b.terlambat > 0) - (a.terlambat > 0) ||
      // Tanpa tempo diletakkan setelah yang bertempo: yang punya tenggat lebih
      // mendesak daripada yang tidak pernah diberi tenggat.
      (a.tempoTerdekat === null) - (b.tempoTerdekat === null) ||
      String(a.tempoTerdekat ?? '').localeCompare(String(b.tempoTerdekat ?? '')) ||
      a.supplier.localeCompare(b.supplier)
  );
}

/**
 * Ringkasan untuk lencana Beranda: berapa nota jatuh tempo hari ini & terlambat.
 */
export function ringkasTempo(notas, hariIni) {
  let terlambat = 0;
  let hariIniJml = 0;
  let totalHutang = 0;
  for (const n of Array.isArray(notas) ? notas : []) {
    if (n?.payment_status === 'lunas') continue;
    totalHutang += angka(n.total);
    const s = statusTempo(n, hariIni);
    if (s === 'terlambat') terlambat++;
    if (s === 'hari-ini') hariIniJml++;
  }
  return { terlambat, hariIni: hariIniJml, totalHutang };
}
