/**
 * SELISIH ISI DRAFT — apa yang BENAR-BENAR disentuh orang ini.
 *
 * ============ KENAPA BUKAN SELURUH DAFTARNYA ============
 *
 * Draft order milik OUTLET sejak 0110: bar mengisi sirup, kitchen menambah
 * daging, ke satu nomor order yang sama. Sebelum 0145 layar mengirim SELURUH
 * daftar yang ada di layarnya, dan server menghapus isi lama lalu mengisi
 * ulang. Hasilnya, direproduksi di Postgres sungguhan:
 *
 *   10:00:03  Bar menyimpan     -> draft berisi Sirup 2000
 *   10:00:09  Kitchen menyimpan -> draft berisi Daging 5000
 *
 * Sirup milik Bar lenyap tanpa satu pun galat.
 *
 * ============ BARIS YANG CUMA TERLIHAT TIDAK IKUT DIKIRIM ============
 *
 * Ini bagian yang paling mudah terlewat, dan ia membatalkan seluruh gunanya
 * kalau salah.
 *
 * Godaannya: "kirim semua baris di layar sebagai upsert, jangan hapus apa pun".
 * Itu tetap salah. Kalau Bar mengubah Sirup dari 2000 jadi 3000 dan menyimpan,
 * sementara layar Kitchen masih memegang Sirup 2000 yang TIDAK ia sentuh, maka
 * penyimpanan Kitchen akan mengembalikannya ke 2000. Bug yang sama persis,
 * cuma pindah dari tingkat dokumen ke tingkat baris — dan jauh lebih sulit
 * dilihat karena barisnya masih ada.
 *
 * Jadi yang dikirim hanya yang NILAINYA BERBEDA dari saat panelnya dibuka.
 *
 * ============ MENGHAPUS HARUS DISEBUT EKSPLISIT ============
 *
 * Kalau baris yang tidak disebut berarti "jangan sentuh", maka menghapus tidak
 * bisa dinyatakan dengan cara menghilangkannya begitu saja. Baris yang tadinya
 * ada di layar dan sekarang tidak ada masuk ke daftar `hapus`.
 *
 * Aturan yang sama dengan `dicek_qty` di 0142: kunci yang TIDAK ADA berarti
 * "tidak saya sentuh", dan itu berbeda dari nilai yang sengaja dikosongkan.
 *
 * Tidak ada impor di berkas ini, supaya bisa diuji tanpa browser.
 */

const angka = (v) => {
  // `Number('')` dan `Number(null)` adalah 0, bukan NaN.
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const teks = (v) => (v === null || v === undefined ? '' : String(v));

/** Peta product_id -> qty, dari daftar baris apa pun. */
function petaQty(baris) {
  const peta = new Map();
  for (const b of Array.isArray(baris) ? baris : []) {
    const id = teks(b?.product_id).trim();
    if (!id) continue;
    const q = angka(b?.qty);
    // Baris ber-qty nol/kosong diperlakukan sebagai TIDAK ADA.
    //
    // Di draft order, nol tidak punya arti: "pesan 0 sirup" sama saja dengan
    // tidak memesannya. (Berbeda dengan surat jalan, tempat "diminta 10,
    // dikirim 0" adalah jawaban — lihat 0132.)
    if (q === null || q <= 0) continue;
    if (!peta.has(id)) peta.set(id, q);
  }
  return peta;
}

/**
 * Susun selisih antara isi saat panel DIBUKA dan isi di layar SEKARANG.
 *
 * @param {{product_id: string, qty: number|string}[]} awal isi saat dimuat
 * @param {{product_id: string, qty: number|string}[]} sekarang isi di layar
 * @returns {{
 *   ubah: {product_id: string, qty: number}[],
 *   hapus: string[],
 *   adaPerubahan: boolean
 * }}
 */
export function susunPerubahan(awal, sekarang) {
  const lama = petaQty(awal);
  const baru = petaQty(sekarang);

  const ubah = [];
  for (const [id, qty] of baru) {
    // HANYA yang berbeda. Baris yang nilainya sama persis dengan saat dimuat
    // tidak ikut — lihat catatan panjang di kepala berkas.
    if (lama.get(id) !== qty) ubah.push({ product_id: id, qty });
  }

  const hapus = [];
  for (const id of lama.keys()) {
    if (!baru.has(id)) hapus.push(id);
  }

  return { ubah, hapus, adaPerubahan: ubah.length > 0 || hapus.length > 0 };
}

/**
 * Kalimat hasil — dan ini yang membuat penggabungannya terlihat.
 *
 * Tanpa kalimat ini, orangnya menyimpan dua baris lalu membuka draft dan
 * menemukan enam. Yang empat datang dari HP sebelah, dan tidak ada apa pun di
 * layar yang menjelaskannya — jadi tebakan pertama yang wajar adalah
 * "aplikasinya menggandakan pesananku".
 *
 * @param {{diubah?: number, dihapus?: number, total?: number}} hasil dari `ubah_draft_order`
 * @param {number} dikirim banyaknya baris yang HP ini ubah
 */
export function pesanGabung(hasil, dikirim) {
  const diubah = Number(hasil?.diubah) || 0;
  const dihapus = Number(hasil?.dihapus) || 0;
  const total = Number(hasil?.total) || 0;

  const bagian = [];
  if (diubah) bagian.push(`${diubah} baris disimpan`);
  if (dihapus) bagian.push(`${dihapus} dihapus`);
  if (!bagian.length) bagian.push('Tidak ada yang berubah');

  // Baris yang ada di draft tapi bukan hasil penyimpanan ini datang dari orang
  // lain. Disebut hanya kalau memang ada — kalimat tambahan yang muncul pada
  // keadaan normal akan berhenti dibaca.
  const lain = Math.max(0, total - Math.max(diubah, 0));
  const ekor = lain > 0 ? ` Draft sekarang berisi ${total} baris, termasuk ${lain} dari rekanmu.` : '';

  return `${bagian.join(', ')}.${ekor}`;
}
