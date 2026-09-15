/**
 * Menyusun "buku resep": seluruh resep sebuah BU jadi satu tabel yang bisa
 * dibaca di kertas, di Excel, dan DIUNGGAH KEMBALI.
 *
 * SATU SUMBER untuk dua keluaran (xlsx & PDF), alasannya sama dengan dokumen
 * kiriman: kalau tiap keluaran menyusun barisnya sendiri, cepat atau lambat
 * keduanya menyimpang, dan yang paling mungkin menyimpang justru kolom jumlah.
 * Resep yang takarannya berbeda antara file Excel dan lembar yang ditempel di
 * dapur adalah resep yang tidak bisa dipakai memeriksa apa pun.
 *
 * BENTUKNYA SENGAJA DATAR (satu baris per bahan), bukan bersarang. Baris datar
 * bisa disaring, diurutkan, dan di-pivot di Excel; tabel bersarang dengan sel
 * tergabung terlihat lebih rapi di layar tapi mati begitu orangnya menekan
 * "Filter" — dan menyaring adalah alasan utama file ini diunduh. Kolom Produk
 * & Varian diulang di tiap baris justru supaya penyaringan tetap bekerja.
 *
 * ============ JUDUL KOLOMNYA HARUS DIKENALI PENGIMPOR ============
 *
 * Lima judul di `KOLOM_IMPOR_RESEP` sama persis dengan `template-resep.csv`.
 * Pengimpor membaca berdasarkan NAMA KOLOM (`r['yield']`), bukan posisinya —
 * jadi urutannya boleh diatur demi keterbacaan, tapi ejaannya tidak.
 *
 * Kolom "Hasil/Yield" dulu tertulis begitu, dan itu BUG YANG SENYAP: pengimpor
 * mencari `yield`, tidak menemukannya, lalu memakai nilai bawaan **1**. Berkas
 * ekspor yang diunggah untuk mengisi resep kosong — atau untuk menyalin resep
 * ke BU baru — akan menyetel yield 1800 jadi 1, dan HPP-nya melonjak 1800 kali
 * lipat. Tidak ada error, tidak ada baris merah; angkanya cuma salah.
 *
 * Tidak ada impor di file ini, supaya bisa diuji tanpa browser.
 */

const MODE_TEKS = { production: 'Produksi (CK)', standalone: 'Standalone', served_by_ck: 'Dilayani CK' };
const TIPE_TEKS = { raw: 'Bahan Baku', semi: 'Setengah Jadi', finished: 'Menu' };

/**
 * Judul kolom yang DIBACA pengimpor resep — harus sama persis dengan
 * `template-resep.csv` di `product-import.js`.
 *
 * Ditulis sebagai konstanta tersendiri supaya audit bisa membandingkannya
 * langsung dengan baris template itu. Dua daftar judul yang "kelihatannya sama"
 * adalah persis jenis hal yang menyimpang diam-diam.
 */
export const KOLOM_IMPOR_RESEP = ['Produk', 'Varian', 'Yield', 'Bahan', 'Jumlah'];

/** Penanda resep yang barisnya ada tapi bahannya tidak pernah tersimpan (0082). */
export const CATATAN_RESEP_KOSONG = 'Resep kosong — bahannya tidak tersimpan';

const angka = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  return String(Math.round(v * 10000) / 10000).replace('.', ',');
};

const rupiah = (n) => (n == null || !Number.isFinite(Number(n)) ? '-' : 'Rp ' + Math.round(Number(n)).toLocaleString('id-ID'));

const teks = (v) => (v === null || v === undefined ? '' : String(v));

/** Bentuk baku sebuah nama, untuk MEMBANDINGKAN. Sama aturannya dengan `core/nama.js`. */
const bakukan = (t) =>
  String(t ?? '')
    .normalize('NFKC')
    .replace(/[​-‍﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/**
 * @param {object} o
 * @param {object[]} o.products    seluruh produk BU
 * @param {object[]} o.recipes     hasil listRecipesFull()
 * @param {Function} [o.hppVarian] (productId, mode) -> number|null
 * @param {Function} [o.hppBahan]  (productId) -> number|null
 * @param {boolean}  [o.denganNilai=true]
 * @param {string}   [o.namaBu]
 * @param {{nama?: string, tipe?: string, kategori?: string, subKategori?: string}} [o.saring]
 *   saringan yang SEDANG AKTIF di layar. Berkasnya harus berisi apa yang dilihat
 *   orangnya — berkas yang isinya berbeda dari layarnya adalah perbedaan yang
 *   tidak akan pernah ia sadari.
 */
export function susunBukuResep({ products, recipes, hppVarian, hppBahan, denganNilai = true, namaBu = '', saring = {} } = {}) {
  const produkById = new Map((products ?? []).map((p) => [p.id, p]));

  const kolom = [
    { header: KOLOM_IMPOR_RESEP[0], width: 2 },
    { header: 'Tipe', width: 1 },
    { header: 'Kategori', width: 1 },
    { header: KOLOM_IMPOR_RESEP[1], width: 1.1 },
    // `numeric` supaya tetap ANGKA di Excel — Yield dan Jumlah adalah dua kolom
    // yang paling sering dipivot, dan kolom teks tidak bisa dijumlah.
    { header: KOLOM_IMPOR_RESEP[2], width: 0.9, align: 'right', numeric: true },
    { header: KOLOM_IMPOR_RESEP[3], width: 2 },
    { header: KOLOM_IMPOR_RESEP[4], width: 0.8, align: 'right', numeric: true },
    { header: 'Satuan', width: 0.7 }
  ];
  if (denganNilai) {
    kolom.push(
      { header: 'HPP Bahan/satuan', width: 1, align: 'right', numeric: true },
      { header: 'Biaya Bahan', width: 1, align: 'right', numeric: true },
      { header: 'HPP Produk/satuan', width: 1.1, align: 'right', numeric: true }
    );
  }
  // Catatan SELALU kolom terakhir, dan selalu ada — kalau ia cuma muncul saat
  // dibutuhkan, jumlah kolomnya berubah antar unduhan dan rumus yang menunjuk
  // kolom tertentu di file lama berhenti cocok.
  kolom.push({ header: 'Catatan', width: 2.4 });

  // ---- Saringan: aturannya sama dengan tabel di layar ----
  const s = {
    nama: bakukan(saring?.nama ?? ''),
    tipe: teks(saring?.tipe).trim(),
    kategori: teks(saring?.kategori).trim(),
    subKategori: teks(saring?.subKategori).trim()
  };
  const adaSaringan = Boolean(s.nama || s.tipe || s.kategori || s.subKategori);
  const lolos = (p) => {
    if (!p) return false;
    if (s.nama && !bakukan(p.name).includes(s.nama)) return false;
    if (s.tipe && (TIPE_TEKS[p.product_type] ?? p.product_type) !== s.tipe) return false;
    if (s.kategori && teks(p.category).trim() !== s.kategori) return false;
    if (s.subKategori && teks(p.subcategory).trim() !== s.subKategori) return false;
    return true;
  };

  // Diurutkan supaya file yang diunduh dua kali berturut-turut isinya sama
  // urutannya. Tanpa ini, membandingkan dua unduhan (mis. sebelum & sesudah
  // memperbaiki harga) berarti membandingkan dua urutan acak.
  const urut = [...(recipes ?? [])].sort((a, b) => {
    const pa = produkById.get(a.product_id)?.name ?? '';
    const pb = produkById.get(b.product_id)?.name ?? '';
    return pa.localeCompare(pb, 'id') || String(a.mode).localeCompare(String(b.mode));
  });

  const baris = [];
  let varianTotal = 0;
  let jumlahVarian = 0;
  let tanpaHpp = 0;
  let resepKosong = 0;
  const rekapPer = new Map();

  for (const r of urut) {
    const p = produkById.get(r.product_id);
    if (!p) continue; // resep yatim — produknya sudah terhapus
    varianTotal++;
    if (!lolos(p)) continue;
    jumlahVarian++;

    const hppProduk = hppVarian ? hppVarian(r.product_id, r.mode) : null;
    if (hppProduk == null) tanpaHpp++;

    const modeTeks = MODE_TEKS[r.mode] ?? r.mode;
    const kunci = `${p.product_type}|${r.mode}`;
    if (!rekapPer.has(kunci)) {
      rekapPer.set(kunci, { tipe: TIPE_TEKS[p.product_type] ?? p.product_type, varian: modeTeks, jumlah: 0, tanpaHpp: 0, kosong: 0, bahan: 0 });
    }
    const g = rekapPer.get(kunci);
    g.jumlah++;
    if (hppProduk == null) g.tanpaHpp++;

    const items = r.items ?? [];
    if (!items.length) {
      // Resep kosong TETAP MUNCUL, dengan keterangannya. Kalau ia dilewati,
      // file unduhan terlihat lengkap sementara di aplikasi ada peringatan —
      // dan orang akan lebih percaya file yang dipegangnya.
      //
      // Keterangannya ada di kolom CATATAN, bukan di kolom Bahan. Dulu ia
      // ditulis di kolom Bahan, dan berkas yang diunggah balik jadi mencari
      // bahan bernama "(resep kosong — ...)" — satu baris galat untuk tiap
      // resep kosong, tepat pada berkas yang dipakai MEMPERBAIKI resep kosong.
      resepKosong++;
      g.kosong++;
      baris.push([
        p.name,
        TIPE_TEKS[p.product_type] ?? p.product_type,
        p.category ?? '',
        modeTeks,
        angka(r.yield_qty),
        '',
        '',
        '',
        ...(denganNilai ? ['-', '-', rupiah(hppProduk)] : []),
        CATATAN_RESEP_KOSONG
      ]);
      continue;
    }

    for (const it of items) {
      const b = produkById.get(it.ingredient_product_id);
      const hpp = hppBahan ? hppBahan(it.ingredient_product_id) : null;
      const biaya = hpp == null ? null : hpp * Number(it.qty ?? 0);
      g.bahan++;
      const catatan = [];
      if (!b) catatan.push('Bahan sudah dihapus dari Master Produk');
      else if (hpp == null) catatan.push(`${b.name}: harganya belum ada, jadi biayanya tidak bisa dihitung`);
      baris.push([
        p.name,
        TIPE_TEKS[p.product_type] ?? p.product_type,
        p.category ?? '',
        modeTeks,
        angka(r.yield_qty),
        b?.name ?? '(bahan sudah dihapus)',
        angka(it.qty),
        b?.base_unit ?? '',
        // Bahan tanpa HPP ditandai "-", bukan 0. Nol membuat kolom Biaya
        // terlihat sah dan totalnya bisa dijumlah tanpa curiga.
        ...(denganNilai ? [hpp == null ? '-' : rupiah(hpp), biaya == null ? '-' : rupiah(biaya), rupiah(hppProduk)] : []),
        catatan.join(' · ')
      ]);
    }
  }

  const kolomRekap = [
    { header: 'Tipe', width: 1.2 },
    { header: 'Varian', width: 1.2 },
    { header: 'Jumlah resep', width: 1, align: 'right', numeric: true },
    { header: 'Baris bahan', width: 1, align: 'right', numeric: true },
    { header: 'Resep kosong', width: 1, align: 'right', numeric: true },
    { header: 'HPP belum bisa dihitung', width: 1.4, align: 'right', numeric: true }
  ];
  const rekap = [...rekapPer.values()]
    .sort((a, b) => a.tipe.localeCompare(b.tipe, 'id') || a.varian.localeCompare(b.varian, 'id'))
    .map((g) => [g.tipe, g.varian, String(g.jumlah), String(g.bahan), String(g.kosong), String(g.tanpaHpp)]);

  const sebutSaringan = [saring?.nama ? `cari "${teks(saring.nama)}"` : '', s.tipe, s.kategori, s.subKategori].filter(Boolean).join(' · ');
  const tanggal = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });

  return {
    judul: 'Daftar Resep' + (namaBu ? ` — ${namaBu}` : ''),
    subjudul:
      // Berkas yang SEBAGIAN harus mengaku. Berkas 12 baris dari 400 varian yang
      // terkirim lewat WhatsApp tidak punya cara lain memberi tahu penerimanya
      // bahwa ada saringan yang aktif.
      (adaSaringan ? `Saringan: ${sebutSaringan || '(aktif)'} · ` : '') +
      `${jumlahVarian} dari ${varianTotal} varian resep · ${baris.length} baris bahan · dicetak ${tanggal}` +
      (tanpaHpp ? ` · ${tanpaHpp} varian belum bisa dihitung HPP-nya` : '') +
      (resepKosong ? ` · ${resepKosong} resep kosong` : ''),
    namaBerkas: 'daftar-resep-' + tanggalBerkas(),
    kolom,
    baris,
    kolomRekap,
    rekap,
    jumlahVarian,
    varianTotal,
    tanpaHpp,
    resepKosong,
    adaSaringan
  };
}

/** `YYYY-MM-DD` dari komponen LOKAL — `toISOString` bisa menggeser satu hari. */
function tanggalBerkas(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
