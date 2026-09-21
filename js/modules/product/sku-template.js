/**
 * TEMPLATE KODE SKU — unduh berisi, isi di Excel, unggah kembali.
 *
 *   "sediakan template excel yang bisa didownload lalu setelah di download
 *    isinya adalah semua item yang terdaftar di berjaya hub, berserta kolom
 *    kode SKU item untuk saya isi… jika ada item yang tidak berubah maka
 *    dibiarkan saja"
 *
 * ============ DICOCOKKAN LEWAT ID, BUKAN NAMA ============
 *
 * Templatenya membawa kolom ID, dan itu bukan kerapian basis data yang bocor ke
 * layar — itu satu-satunya cara unggahannya tidak salah sasaran.
 *
 * Kalau dicocokkan lewat nama: seseorang mengunduh template hari Senin,
 * mengisi 600 baris sampai Kamis, dan di antaranya ada yang membetulkan ejaan
 * "Gula Pasir " jadi "Gula Pasir" di Master Produk. Baris itu lalu tidak cocok
 * dengan apa pun — dan yang lebih buruk, dua produk yang namanya kebetulan
 * sama (beda satuan, beda outlet asal) akan cocok dengan baris yang sama.
 *
 * ID tidak berubah saat namanya berubah. Nama tetap ikut di templatenya, tapi
 * sebagai BACAAN: ia yang membuat orangnya tahu baris mana yang sedang diisi.
 *
 * ============ SEL KOSONG BERARTI "JANGAN DIAPA-APAKAN" ============
 *
 * Bukan "hapus kodenya". Mengosongkan sel adalah cara paling wajar mengatakan
 * "yang ini belum saya urus", dan memperlakukannya sebagai perintah menghapus
 * akan membuang pekerjaan yang sudah dilakukan — diam-diam, saat unggahan
 * berikutnya.
 *
 * ============ YANG TIDAK BERUBAH TIDAK IKUT DIKIRIM ============
 *
 * Dari 647 baris, biasanya yang benar-benar berubah belasan. Mengirim
 * semuanya berarti 647 baris yang menyentuh `updated_at` tanpa mengubah apa
 * pun — dan riwayat perubahan yang penuh baris palsu tidak bisa dibaca lagi.
 *
 * Tidak ada impor di berkas ini, supaya bisa diuji tanpa Excel maupun browser.
 */

/**
 * Judul kolom template, berurutan.
 *
 * ID di depan supaya tidak sengaja terpotong saat orang menyalin sebagian
 * kolom, dan diberi peringatan di judulnya sendiri — bukan cuma di kalimat
 * pengantar yang tidak ikut terbawa ke dalam berkasnya.
 */
export const KOLOM_SKU = ['ID (jangan diubah)', 'Nama', 'Tipe', 'Kategori', 'Satuan Pakai', 'Kode SKU (ESB)'];

/** Posisi kedua kolom yang dibaca saat unggah. Diturunkan, bukan ditulis angka. */
export const KOL_ID = KOLOM_SKU.indexOf('ID (jangan diubah)');
export const KOL_SKU = KOLOM_SKU.indexOf('Kode SKU (ESB)');

export const TIPE_LABEL = { raw: 'Bahan Baku', semi: 'Setengah Jadi', finished: 'Menu' };

const teks = (v) => (v === null || v === undefined ? '' : String(v).trim());

/** Kode disamakan sebelum dibandingkan — sama dengan aturan indeks unik di 0148. */
export function normalSku(v) {
  return teks(v).toLowerCase();
}

/**
 * Baris untuk berkas yang diunduh.
 *
 * Produk NONAKTIF ikut, dan itu disengaja: ia masih punya nota lama yang suatu
 * saat perlu diekspor, dan kodenya tetap harus benar. Yang tidak ikut cuma
 * MENU — menu tidak pernah masuk nota pembelian maupun jurnal waste bahan,
 * jadi kodenya tidak dipakai di mana pun dan cuma memanjangkan daftarnya.
 *
 * @param {Array} produk hasil `listProducts`
 * @returns {Array[]} baris siap tulis, urut tipe lalu nama
 */
export function barisTemplateSku(produk) {
  const daftar = (Array.isArray(produk) ? produk : []).filter(
    (p) => p && p.id && p.product_type !== 'finished'
  );
  daftar.sort(
    (a, b) =>
      String(a.product_type ?? '').localeCompare(String(b.product_type ?? '')) ||
      teks(a.name).localeCompare(teks(b.name), 'id')
  );
  return daftar.map((p) => [
    teks(p.id),
    teks(p.name),
    TIPE_LABEL[p.product_type] ?? teks(p.product_type),
    teks(p.category),
    teks(p.base_unit),
    teks(p.sku)
  ]);
}

/**
 * Baca isi berkas yang diunggah.
 *
 * Header DICARI, bukan diasumsikan di baris pertama: orang menambahkan baris
 * judul, membekukan panel, atau menyalin datanya ke sheet baru — dan pembacaan
 * yang mengunci nomor baris akan diam-diam membaca data yang bergeser satu
 * baris, lalu mengisi kode milik produk lain.
 *
 * @param {Array[]} aoa sheet sebagai array-of-array
 * @returns {{baris: Array<{id: string, sku: string}>, tanpaId: number}}
 */
export function bacaTemplateSku(aoa) {
  const isi = Array.isArray(aoa) ? aoa : [];
  const iHeader = isi.findIndex(
    (r) => Array.isArray(r) && r.some((c) => teks(c) === KOLOM_SKU[KOL_ID]) && r.some((c) => teks(c) === KOLOM_SKU[KOL_SKU])
  );
  if (iHeader < 0) {
    throw new Error(
      `Kolom "${KOLOM_SKU[KOL_ID]}" dan "${KOLOM_SKU[KOL_SKU]}" tidak ditemukan. ` +
        'Pakai berkas hasil unduhan "Template Kode SKU" apa adanya — jangan menghapus baris judulnya.'
    );
  }
  const header = isi[iHeader].map((h) => teks(h));
  const cId = header.indexOf(KOLOM_SKU[KOL_ID]);
  const cSku = header.indexOf(KOLOM_SKU[KOL_SKU]);

  const baris = [];
  let tanpaId = 0;
  for (let i = iHeader + 1; i < isi.length; i++) {
    const r = isi[i];
    if (!Array.isArray(r)) continue;
    const id = teks(r[cId]);
    const sku = teks(r[cSku]);
    // Baris tanpa ID tidak bisa ditujukan ke produk mana pun. Yang paling
    // sering: orang menambahkan produk baru di bawah daftarnya. Fitur ini
    // MENGISI KODE, tidak membuat produk — dan itu dikatakan, bukan dibiarkan
    // jadi baris yang menghilang tanpa jejak.
    if (!id) {
      if (sku) tanpaId += 1;
      continue;
    }
    baris.push({ id, sku });
  }
  return { baris, tanpaId };
}

/**
 * Bandingkan isi unggahan dengan yang tersimpan; hanya yang BERUBAH yang keluar.
 *
 * @param {Array<{id: string, sku: string}>} baris hasil `bacaTemplateSku`
 * @param {Map<string, {name?: string, sku?: string}>} produkById
 * @returns {{ubah: Array<{id: string, sku: string}>, sama: number, kosong: number,
 *   asing: string[], kembar: string[]}}
 */
export function susunPerubahanSku(baris, produkById) {
  const daftar = Array.isArray(baris) ? baris : [];
  const peta = produkById instanceof Map ? produkById : new Map();

  const ubah = [];
  const asing = [];
  const kembar = [];
  const dilapor = new Set();
  let sama = 0;
  let kosong = 0;

  // Kode yang dipakai dua baris SEKALIGUS di berkas yang sama. Database akan
  // menolak yang kedua lewat indeks unik, tapi terlambat: pesannya menyebut
  // nama indeks, bukan dua produk mana yang bertabrakan. Di sini keduanya
  // ditahan dan namanya disebut.
  const pemakai = new Map();
  for (const b of daftar) {
    const k = normalSku(b.sku);
    if (!k) continue;
    if (!pemakai.has(k)) pemakai.set(k, []);
    pemakai.get(k).push(b.id);
  }

  for (const b of daftar) {
    const sku = teks(b.sku);
    // Sel kosong berarti "jangan diapa-apakan", BUKAN "hapus kodenya".
    if (!sku) {
      kosong += 1;
      continue;
    }
    const p = peta.get(b.id);
    if (!p) {
      asing.push(b.id);
      continue;
    }
    const k = normalSku(sku);
    const bentrok = pemakai.get(k) ?? [];
    if (bentrok.length > 1) {
      // DIKUMPULKAN LEWAT KUNCI YANG SUDAH DISAMAKAN, bukan lewat kalimatnya.
      //
      // Percobaan pertama menyusun kalimatnya dari `sku` mentah lalu membuang
      // yang kembar. "SAMA" dan "sama " menghasilkan dua kalimat berbeda untuk
      // SATU bentrokan yang sama — dan yang membacanya mengira ada dua masalah
      // yang harus dibereskan terpisah.
      if (!dilapor.has(k)) {
        dilapor.add(k);
        const nama = bentrok.map((id) => teks(peta.get(id)?.name) || id);
        kembar.push(`${sku} dipakai ${bentrok.length} baris: ${nama.join(', ')}`);
      }
      continue;
    }
    // Yang nilainya sudah sama tidak ikut dikirim. Beda huruf besar-kecil saja
    // DIANGGAP berubah — kalau ESB menulisnya "BCK 25-0110", itulah yang harus
    // tersimpan, dan menganggapnya sama berarti ejaan lamanya bertahan diam-diam.
    if (teks(p.sku) === sku) {
      sama += 1;
      continue;
    }
    ubah.push({ id: b.id, sku });
  }

  return { ubah, sama, kosong, asing, kembar };
}

/** Ringkasan siap-tampil sebelum menyimpan. */
export function pesanPerubahanSku(hasil, tanpaId = 0) {
  const bagian = [];
  const n = hasil?.ubah?.length ?? 0;
  bagian.push(n ? `${n} kode akan diisi/diubah` : 'Tidak ada kode yang berubah');
  if (hasil?.sama) bagian.push(`${hasil.sama} sudah sama, dilewati`);
  if (hasil?.kosong) bagian.push(`${hasil.kosong} baris dikosongkan, dibiarkan apa adanya`);
  if (hasil?.asing?.length) bagian.push(`${hasil.asing.length} baris tidak dikenal (produknya sudah dihapus?)`);
  if (tanpaId) bagian.push(`${tanpaId} baris berkode tapi tanpa ID — fitur ini mengisi kode, tidak membuat produk`);
  if (hasil?.kembar?.length) bagian.push(`${hasil.kembar.length} kode kembar ditahan`);
  return bagian.join(' · ');
}
