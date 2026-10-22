/**
 * LABA RUGI OUTLET — empat arus dipertemukan dalam satu rumus.
 *
 * Tanpa jaringan, tanpa DOM. Seluruh masukan dikirim pemanggil supaya
 * aritmetika yang menentukan "outlet ini untung atau rugi" bisa diuji tanpa
 * database.
 *
 * ============ RUMUSNYA ============
 *
 *   Penjualan (omzet)
 *   − HPP           = stok awal + barang masuk − barang keluar − stok akhir
 *   = Laba kotor
 *   − Biaya non-bahan (buku kas)
 *   = Laba bersih outlet
 *
 * `barang masuk` punya DUA sumber yang sengaja tidak dilebur:
 *
 *   dari CK        kiriman antar-outlet, dinilai qty × HPP
 *   dari supplier  nota terima, dinilai harga nota yang sesungguhnya
 *
 * ============ DAN KENAPA ADA "BARANG KELUAR" ============
 *
 * Outlet yang MENGIRIM — Central Kitchen terutama — stoknya berkurang sebesar
 * yang dikirim. Tanpa mengurangkannya, barang yang ia KIRIM terhitung sebagai
 * barang yang ia PAKAI:
 *
 *     CK awal 100, kirim 60, akhir 40   -> HPP 60, padahal CK tidak memakai
 *                                          apa pun
 *     Outlet awal 0, masuk 60, akhir 10 -> HPP 50 (benar)
 *     TOTAL BU                          -> 110, padahal grup cuma memakai 50
 *
 * Kiriman internal terhitung DUA KALI di tingkat BU: sekali sebagai barang
 * yang hilang dari CK, sekali lagi lewat outlet penerimanya. Gejalanya di
 * lapangan: food cost CK ratusan persen, dan total BU yang selalu terlalu
 * besar — keduanya tercetak rapi tanpa satu pun galat.
 *
 * ============ KELUAR DINILAI DARI QTY DITERIMA ============
 *
 * Bukan qty dikirim, dan bedanya menentukan ke mana susut perjalanan jatuh.
 *
 *     kirim 60, diterima 50 (10 susut di jalan)
 *     keluar = 60 -> CK: 100 − 40 − 60 = 0, susutnya LENYAP dari laporan
 *     keluar = 50 -> CK: 100 − 40 − 50 = 10, susutnya jadi beban pengirim ✓
 *
 * Yang kedua yang benar: barangnya memang hilang, dan hilangnya di tangan
 * pengirim.
 *
 * Keduanya dipisah karena pertanyaannya berbeda. "Belanja outlet terlalu
 * besar" ditindaklanjuti dengan memeriksa nota; "kiriman CK terlalu besar"
 * ditindaklanjuti dengan memeriksa order. Satu angka gabungan tidak
 * memberitahu ke mana harus melihat.
 *
 * ============ KENAPA HPP BUKAN DARI RESEP ============
 *
 * Laporan Laba Kotor yang sudah ada menghitung HPP dari resep: tiap menu
 * terjual × takarannya. Itu HPP TEORETIS — ia menganggap tiap porsi memakai
 * bahan sebanyak yang tertulis.
 *
 * Yang di sini dari BARANG YANG BENAR-BENAR HILANG DARI RAK. Selisih keduanya
 * adalah tumpahan, kelebihan takar, waste tak tercatat, dan kehilangan — angka
 * yang tidak bisa dilihat dari laporan resep, dan biasanya yang paling ingin
 * diketahui pemiliknya.
 */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** null kalau benar-benar tidak ada angkanya — dibedakan dari nol. */
const numAtauNull = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const bagi = (a, b) => (num(b) === 0 ? null : num(a) / num(b));

/**
 * Hitung satu outlet.
 *
 * @param {object} o
 *   stokAwal        { nilai, tanpaHpp? }
 *   stokAkhir       { nilai, tanpaHpp? }
 *   masukCk         { nilai, tanpaHpp?, dokumen? }
 *   masukSupplier   { nilai, dokumen?, barisTanpaHarga? }
 *   omzet           number
 *   biayaNonBahan   number
 *   opnameAwal      { tanggal } | null
 *   opnameAkhir     { tanggal } | null
 */
export function barisLabaRugi({
  outlet = '-',
  outletId = null,
  stokAwal = {},
  stokAkhir = {},
  masukCk = {},
  masukSupplier = {},
  keluarKiriman = {},
  omzet = 0,
  biayaNonBahan = 0,
  opnameAwal = null,
  opnameAkhir = null
} = {}) {
  const awal = num(stokAwal.nilai);
  const akhir = num(stokAkhir.nilai);
  const ck = num(masukCk.nilai);
  const sup = num(masukSupplier.nilai);
  const masuk = ck + sup;
  const keluar = num(keluarKiriman.nilai);

  const hpp = awal + masuk - keluar - akhir;
  const jual = num(omzet);
  const labaKotor = jual - hpp;
  const biaya = num(biayaNonBahan);
  const labaBersih = labaKotor - biaya;

  // ============ PERSENTASE HANYA KALAU ADA PENYEBUTNYA ============
  //
  // Food cost dihitung terhadap omzet. Outlet yang omzetnya nol (tutup, atau
  // penjualannya belum dicatat) akan menghasilkan pembagian nol — dan angka
  // seperti `Infinity%` atau `0%` sama-sama berbohong. `null` memaksa layar
  // menuliskan "—", yang jujur.
  const foodCostPersen = bagi(hpp, jual);

  // Bahan tanpa HPP dihitung TERPISAH, tidak diam-diam dianggap nol. Nol
  // membuat HPP terlihat lebih kecil dan laba terlihat lebih besar — arah
  // kesalahan yang paling tidak akan dipertanyakan siapa pun.
  const tanpaHpp = num(stokAwal.tanpaHpp) + num(stokAkhir.tanpaHpp) + num(masukCk.tanpaHpp) + num(keluarKiriman.tanpaHpp);
  const barisTanpaHarga = num(masukSupplier.barisTanpaHarga);

  return {
    outlet,
    outletId,
    awal,
    akhir,
    masukCk,
    masukSupplier,
    nilaiCk: ck,
    nilaiSupplier: sup,
    masuk,
    keluarKiriman,
    keluar,
    masukBersih: masuk - keluar,
    hpp,
    omzet: jual,
    labaKotor,
    biayaNonBahan: biaya,
    labaBersih,
    foodCostPersen,
    tanggalAwal: opnameAwal?.tanggal ?? '',
    tanggalAkhir: opnameAkhir?.tanggal ?? '',
    terkunci: !!(opnameAwal && opnameAkhir),
    tanpaHpp,
    barisTanpaHarga,
    catatan: catatanBaris({ hpp, jual, tanpaHpp, barisTanpaHarga, opnameAwal, opnameAkhir })
  };
}

/**
 * Catatan per baris — apa yang membuat angkanya tidak bisa dipercaya penuh.
 *
 * Disusun di sini, bukan di layar, supaya tabel dan ekspor tidak pernah
 * menuliskan peringatan yang berbeda untuk baris yang sama.
 */
function catatanBaris({ hpp, jual, tanpaHpp, barisTanpaHarga, opnameAwal, opnameAkhir }) {
  const c = [];
  // ============ HPP MINUS ITU TIDAK MUNGKIN ============
  //
  // Stok akhir lebih besar dari stok awal + barang masuk berarti ada barang
  // yang muncul tanpa dokumen: kiriman yang belum ditandai diterima, nota yang
  // belum dibuat, atau opname yang menaikkan stok tanpa sebab. Angkanya tetap
  // ditampilkan apa adanya — yang ditambahkan cuma kalimat yang menyebut
  // bahwa ini mustahil, supaya tidak dibaca sebagai "untung besar".
  if (hpp < 0) c.push('HPP minus — ada barang masuk yang belum tercatat');
  if (!opnameAwal && !opnameAkhir) c.push('belum pernah opname');
  else if (!opnameAkhir) c.push('opname akhir belum ada');
  else if (!opnameAwal) c.push('opname awal belum ada');
  if (tanpaHpp) c.push(`${tanpaHpp} bahan tanpa HPP`);
  if (barisTanpaHarga) c.push(`${barisTanpaHarga} baris nota belum berharga`);
  if (num(jual) === 0) c.push('omzet nol');
  return c.join(' · ');
}

/** Jumlahkan seluruh outlet jadi ringkasan BU. */
export function ringkasLabaRugi(baris) {
  const d = Array.isArray(baris) ? baris : [];
  const jumlah = (k) => d.reduce((a, b) => a + num(b[k]), 0);
  const hpp = jumlah('hpp');
  const omzet = jumlah('omzet');
  const labaKotor = omzet - hpp;
  const biaya = jumlah('biayaNonBahan');
  return {
    outletTotal: d.length,
    outletTerkunci: d.filter((b) => b.terkunci).length,
    awal: jumlah('awal'),
    akhir: jumlah('akhir'),
    nilaiCk: jumlah('nilaiCk'),
    nilaiSupplier: jumlah('nilaiSupplier'),
    masuk: jumlah('masuk'),
    keluar: jumlah('keluar'),
    hpp,
    omzet,
    labaKotor,
    biayaNonBahan: biaya,
    labaBersih: labaKotor - biaya,
    foodCostPersen: bagi(hpp, omzet),
    tanpaHpp: jumlah('tanpaHpp'),
    barisTanpaHarga: jumlah('barisTanpaHarga'),
    // ============ DIJUMLAHKAN DARI BARIS, BUKAN DIHITUNG ULANG ============
    //
    // Total yang dihitung dari sumber terpisah cepat atau lambat menyimpang
    // dari jumlah barisnya — dan laporan yang totalnya tidak sama dengan
    // isinya membuat orang berhenti mempercayai keduanya.
    outletHppMinus: d.filter((b) => num(b.hpp) < 0).length,
    outletRugi: d.filter((b) => num(b.labaBersih) < 0).length
  };
}

/** Persen siap-tampil. null -> '—', bukan '0%'. */
export function persen(v, desimal = 1) {
  const n = numAtauNull(v);
  if (n === null) return '—';
  return `${(n * 100).toFixed(desimal)}%`;
}

/**
 * Rekap BARANG MASUK per bahan, menggabungkan dua sumber.
 *
 * @param {Array} ck       [{ product_id, nama, qty, satuan, nilai, adaHpp }]
 * @param {Array} supplier [{ product_id, nama, qty, satuan, nilai }]
 *
 * Satu baris per bahan, dengan kolom CK dan supplier terpisah — supaya
 * terlihat bahan mana yang dibeli sendiri padahal CK juga mengirimkannya.
 * Itu pertanyaan yang tidak bisa dijawab dua tabel terpisah.
 */
export function rekapPerBahan(ck, supplier) {
  const peta = new Map();
  const ambil = (pid, nama, satuan) => {
    if (!peta.has(pid)) {
      peta.set(pid, {
        productId: pid,
        nama: nama || '(tanpa nama)',
        satuan: satuan || '',
        qtyCk: 0,
        nilaiCk: 0,
        qtySupplier: 0,
        nilaiSupplier: 0,
        tanpaHpp: 0
      });
    }
    const b = peta.get(pid);
    // Nama & satuan diisi dari sumber mana pun yang punya — baris CK dan
    // baris supplier tidak selalu sama-sama membawanya.
    if (!b.nama || b.nama === '(tanpa nama)') b.nama = nama || b.nama;
    if (!b.satuan) b.satuan = satuan || '';
    return b;
  };

  for (const r of Array.isArray(ck) ? ck : []) {
    const b = ambil(r?.product_id, r?.nama, r?.satuan);
    b.qtyCk += num(r?.qty);
    b.nilaiCk += num(r?.nilai);
    if (r?.adaHpp === false) b.tanpaHpp += 1;
  }
  for (const r of Array.isArray(supplier) ? supplier : []) {
    const b = ambil(r?.product_id, r?.nama, r?.satuan);
    b.qtySupplier += num(r?.qty);
    b.nilaiSupplier += num(r?.nilai);
  }

  return [...peta.values()]
    .map((b) => ({ ...b, nilaiTotal: b.nilaiCk + b.nilaiSupplier, qtyTotal: b.qtyCk + b.qtySupplier }))
    // Terbesar di atas: yang dibaca orang pertama kali adalah bahan yang
    // paling menyedot biaya, bukan yang namanya paling awal menurut abjad.
    .sort((a, b) => b.nilaiTotal - a.nilaiTotal || String(a.nama).localeCompare(String(b.nama)));
}

/**
 * Kalimat ringkas untuk di bawah tabel.
 *
 * Menyebut yang perlu DIKERJAKAN, bukan mengulang angka yang sudah tercetak
 * di atasnya.
 */
export function pesanLabaRugi(r) {
  if (!r || !r.outletTotal) return 'Tidak ada outlet pada periode ini.';
  const bagian = [];
  if (r.outletHppMinus) bagian.push(`${r.outletHppMinus} outlet HPP-nya MINUS — ada barang masuk yang belum tercatat`);
  if (r.outletRugi) bagian.push(`${r.outletRugi} outlet rugi`);
  if (r.outletTerkunci < r.outletTotal) {
    bagian.push(`${r.outletTotal - r.outletTerkunci} outlet belum dikunci opname — angkanya hanya sebaik pencatatannya`);
  }
  if (r.tanpaHpp) bagian.push(`${r.tanpaHpp} bahan tanpa HPP dihitung nol`);
  if (r.barisTanpaHarga) bagian.push(`${r.barisTanpaHarga} baris nota belum berharga`);
  if (!bagian.length) return `${r.outletTotal} outlet, semuanya untung dan sudah dikunci opname.`;
  return bagian.join(' · ') + '.';
}
