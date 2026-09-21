/**
 * Ekspor waste/spoil Berjaya Hub ke template **ESB Item Journal**.
 *
 * ============ BENTUK TEMPLATENYA ============
 *
 * Delapan kolom, header di BARIS KE-3 — bukan baris 1 seperti Simple Purchase
 * dan Simple Transfer. Baris 1 judul, baris 2 kosong.
 *
 *   No | Product Name | Product Code | Unit | Mode | Qty | Value per Unit | Purpose
 *
 * `Product Code` ikut, dan itu baru: dua template sebelumnya hanya meminta
 * namanya. Kodenya diambil dari daftar induk ESB lewat NAMA hasil pemetaan —
 * bukan dari kode lokal Berjaya Hub, yang tidak pernah sama dengan kode ESB.
 *
 * ============ TIDAK ADA KOLOM BRANCH — DAN ITU MENULAR ============
 *
 * Berkasnya tidak menyebut outlet sama sekali, jadi outletnya ditentukan saat
 * DIIMPOR di ESB. Satu berkas = satu outlet.
 *
 * Maka fungsi ini menolak diberi waste dari lebih dari satu outlet. Bukan
 * karena tidak bisa menyusunnya — justru karena bisa: berkas gabungan akan
 * masuk seluruhnya ke outlet yang dipilih saat impor, stok outlet lain
 * berkurang di ESB tanpa pernah berkurang di sini, dan tidak ada satu pun
 * pesan yang menandakannya.
 *
 * ============ `Mode` SELALU `Deduct` ============
 *
 * Waste mengurangi stok. `Add` ada di template untuk penyesuaian opname yang
 * menambah, dan itu sumber yang berbeda — sengaja tidak dicampur ke sini.
 *
 * ============ `Purpose` DATANG DARI KEJADIANNYA, BUKAN DARI PEMETAAN ============
 *
 * Percobaan pertama (0146) memetakan `jenis` waste ('spoil'/'menu') ke satu
 * nilai Purpose. Berkas Master Purpose yang sesungguhnya membantah bentuk itu:
 *
 *     Waste Kitchen    -> COGS - Food
 *     Waste Bar        -> COGS - Beverage
 *     Packaging Spoil  -> COGS - Other
 *
 * Sumbunya bukan "rusak atau terbuang" melainkan "dapur, bar, atau kemasan",
 * dan itu tidak bisa diturunkan dari data yang ada. Kategori produk pun bukan
 * jawabannya: kategori di Berjaya Hub diketik sendiri dan tidak dibuat untuk
 * pertanyaan ini. Jadi yang memilihnya orang yang berdiri di depan barangnya,
 * dan pilihannya disimpan di `waste_runs.purpose` (0147).
 *
 * Yang belum terisi DITAHAN. Menebaknya di sini berarti mengirim biaya waste ke
 * akun COGS yang salah — angkanya tetap terlihat wajar, dan laporan yang
 * memakainya tidak punya satu pun petunjuk.
 *
 * ============ `Value per Unit` BISA TIDAK ADA ============
 *
 * Sumbernya biaya rata-rata bahan per outlet (0118), dan barisnya hanya ada
 * kalau bahan itu pernah masuk lewat nota berharga. Yang belum pernah tidak
 * punya angka.
 *
 * Mengirim 0 berarti "bahannya gratis" — pernyataan yang BERBEDA dari "belum
 * tahu", dan ESB menerimanya tanpa keluhan. Nilai kerugian jadi lebih kecil
 * dari yang sebenarnya, dan angkanya terlihat wajar. Jadi barisnya DITAHAN,
 * dan alasannya terbaca.
 *
 * Tidak ada impor di berkas ini, supaya bisa diuji tanpa Excel maupun browser.
 */

/** Header template, berurutan. Nama & urutannya harus persis. */
export const KOLOM_JOURNAL = ['No', 'Product Name', 'Product Code', 'Unit', 'Mode', 'Qty', 'Value per Unit', 'Purpose'];

/**
 * Baris header ada di indeks ke-2 (baris ke-3 di Excel).
 *
 * Disebut sebagai angka di sini supaya penulis berkasnya tidak perlu menebak,
 * dan supaya auditnya punya sesuatu yang bisa diperiksa. Dua template lain
 * memakai baris pertama; menyamakannya akan membuat seluruh berkas ditolak.
 */
export const BARIS_HEADER_JOURNAL = 2;

/** Waste mengurangi stok. Satu-satunya nilai yang dipakai ekspor ini. */
export const MODE_KURANG = 'Deduct';

const teks = (v) => (v === null || v === undefined ? '' : String(v).trim());
const angka = (v) => {
  // `Number('')` dan `Number(null)` adalah 0, bukan NaN.
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Susun baris ESB Item Journal dari waste Berjaya Hub.
 *
 * @param {object} o
 * @param {Array} o.waste baris `waste_runs`: { id, code, outlet_id, jenis, purpose, created_at }
 * @param {Map<string, Array>} o.itemsPerWaste id waste -> baris bahan
 *   { product_id, product_name, base_unit, qty }
 * @param {Record<string, Map<string,string>>} o.peta hasil `buatPeta` — dipakai
 *   BERSAMA dengan Simple Purchase. `item` dan `unit` saja; Purpose tidak
 *   dipetakan (lihat catatan di kepala berkas).
 * @param {Map<string,string>} [o.kodeItem] nama item ESB -> Product Code
 * @param {Map<string,number>} [o.biaya] product_id -> biaya rata-rata per satuan
 * @returns {{baris: Array[], wasteIds: string[], kurang: Array<{jenis: string, nilai: string, dok: string[]}>}}
 */
export function barisEsbJournal({ waste, itemsPerWaste, peta, kodeItem = new Map(), biaya = new Map() }) {
  const baris = [];
  const wasteIds = [];
  const kurang = new Map();
  const catat = (jenis, nilai, kode) => {
    const nilaiTeks = teks(nilai) || '(kosong)';
    const k = `${jenis}::${nilaiTeks.toLowerCase()}`;
    if (!kurang.has(k)) kurang.set(k, { jenis, nilai: nilaiTeks, dok: new Set() });
    kurang.get(k).dok.add(kode);
  };

  const daftar = Array.isArray(waste) ? waste : [];

  // SATU BERKAS, SATU OUTLET — diperiksa di sini, bukan dipercayakan ke layar.
  //
  // Layar memang sudah memaksa memilih outlet, tapi penjaga yang hanya ada di
  // layar adalah penjaga yang hilang saat ada jalan lain ke fungsi ini. Lihat
  // catatan panjang di kepala berkas: berkas gabungan DITERIMA ESB dengan
  // tenang, dan salahnya baru terbaca berbulan-bulan kemudian.
  const outlet = new Set(daftar.map((w) => teks(w?.outlet_id)).filter(Boolean));
  if (outlet.size > 1) {
    throw new Error(
      'Berkas Item Journal tidak punya kolom outlet, jadi satu berkas hanya boleh berisi satu outlet. ' +
        'Pilih satu outlet dulu di layar ekspor.'
    );
  }

  let no = 1;
  for (const w of daftar) {
    const kode = teks(w.code) || teks(w.id);
    const items = (itemsPerWaste?.get?.(w.id) ?? []).filter((i) => angka(i?.qty) > 0);
    // Waste tanpa rincian bahan tidak mengurangi apa pun di ESB. Mengekspor
    // kepalanya saja menghasilkan jurnal kosong yang harus dihapus manual.
    if (!items.length) continue;

    // PURPOSE DIBACA APA ADANYA dari kejadiannya — sudah berupa nama ESB
    // kanonik, dijaga `purpose_esb_sah()` di database (0147). Tidak ada
    // pemetaan, dan tidak ada tebakan; lihat catatan panjang di kepala berkas.
    const purpose = teks(w.purpose) || null;
    // Nilainya dicatat sebagai 'purpose-kosong', bukan 'purpose': layarnya
    // memakai kunci itu untuk memilih kalimat "isi di Rekap Waste / Spoil", dan
    // 'purpose' di sana sudah berarti nama jenis daftar induknya.
    // Nilainya satu kalimat yang sama untuk semua, supaya seluruh waste yang
    // kurang Purpose berkumpul jadi SATU baris di tabel penahan, dengan daftar
    // kodenya di kolom "Dokumen terpengaruh". Memakai kode waste sebagai nilai
    // akan menghasilkan satu baris per waste — tiga puluh baris yang mengulang
    // satu pesan, menenggelamkan alasan penahan yang lain.
    if (!purpose) catat('purpose-kosong', '(belum dipilih)', kode);

    const barisWaste = [];
    let adaMasalah = false;

    for (const it of items) {
      const item = peta?.item?.get?.(teks(it.product_name).toLowerCase()) ?? null;
      const unit = peta?.unit?.get?.(teks(it.base_unit).toLowerCase()) ?? null;
      if (!item) {
        catat('item', it.product_name, kode);
        adaMasalah = true;
      }
      if (!unit) {
        catat('unit', it.base_unit, kode);
        adaMasalah = true;
      }

      // NILAI PER SATUAN — lihat catatan panjang di kepala berkas. Yang tidak
      // punya angka DITAHAN, bukan dikirim sebagai nol.
      const nilai = angka(biaya?.get?.(teks(it.product_id)));
      if (nilai === null) {
        catat('nilai-bahan', it.product_name, kode);
        adaMasalah = true;
      }

      barisWaste.push([
        no,
        item ?? '',
        // Kode diambil lewat NAMA hasil pemetaan, bukan kode lokal Berjaya Hub.
        item ? kodeItem.get(item) ?? '' : '',
        unit ?? '',
        MODE_KURANG,
        angka(it.qty) ?? 0,
        nilai ?? 0,
        purpose ?? ''
      ]);
      no += 1;
    }

    // Satu baris bermasalah menahan SELURUH waste-nya — sama seperti nota &
    // kiriman. Jurnal separuh jadi di ESB memotong sebagian stok, dan sisanya
    // harus dikoreksi manual.
    if (adaMasalah || !purpose) {
      no -= barisWaste.length;
      continue;
    }

    baris.push(...barisWaste);
    wasteIds.push(w.id);
  }

  return {
    baris,
    wasteIds,
    kurang: [...kurang.values()].map((k) => ({ jenis: k.jenis, nilai: k.nilai, dok: [...k.dok] }))
  };
}

/** Ringkasan siap-tampil. */
export function ringkasJournal(hasil, totalWaste) {
  const siap = hasil?.wasteIds?.length ?? 0;
  return {
    siap,
    tertahan: Math.max(0, (totalWaste ?? 0) - siap),
    baris: hasil?.baris?.length ?? 0,
    kurang: hasil?.kurang?.length ?? 0
  };
}
